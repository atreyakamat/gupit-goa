import { DatabaseSync } from 'node:sqlite';
import type { SpotDetail } from '@gupit/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLocalDb } from '../../lib/db/migrations';
import { nodeDriver } from '../../lib/db/nodeDriver.testutil';
import { createLocalStore, type LocalStore } from '../../lib/db/repo';
import { syncSavedPlaces, type RemoteSaved, type SavedRef } from './sync';

const detail = (n: number): SpotDetail =>
  ({ id: `id-${n}`, slug: `spot-${n}`, name: `Spot ${n}` }) as SpotDetail;

/** Behaves like the server function: removals first, then additions, case-insensitive lists. */
function fakeServer(initial: RemoteSaved[] = []) {
  let rows = [...initial];
  const key = (r: SavedRef) => `${r.listName.toLowerCase()}|${r.spotId}`;
  const calls: { add: SavedRef[]; remove: SavedRef[] }[] = [];
  return {
    calls,
    rows: () => rows,
    sync: async (add: SavedRef[], remove: SavedRef[]) => {
      calls.push({ add, remove });
      const gone = new Set(remove.map(key));
      rows = rows.filter((r) => !gone.has(key(r)));
      for (const item of add) {
        if (!rows.some((r) => key(r) === key(item))) {
          rows.push({ ...item, slug: item.spotId.replace('id-', 'spot-') });
        }
      }
      return rows;
    },
  };
}

let store: LocalStore;
let fetched: string[];
const fetchDetail = async (slug: string) => {
  fetched.push(slug);
  const n = Number(slug.replace('spot-', ''));
  return n >= 90 ? null : detail(n);
};

beforeEach(async () => {
  const driver = nodeDriver(new DatabaseSync(':memory:'));
  await migrateLocalDb(driver);
  let clock = 1_000;
  let id = 0;
  store = createLocalStore(driver, { now: () => (clock += 1), newId: () => `list-${(id += 1)}` });
  fetched = [];
});

describe('syncSavedPlaces', () => {
  it('uploads what is on the phone', async () => {
    const list = await store.createList('Goa trip');
    await store.saveSpot(list.id, detail(1));
    const server = fakeServer();
    const result = await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(server.rows()).toEqual([{ listName: 'Goa trip', spotId: 'id-1', slug: 'spot-1' }]);
    expect(result).toEqual({ uploaded: 1, restored: 0, unavailable: 0 });
    expect(fetched).toEqual([]);
  });

  it('restores places saved on another phone, creating lists as needed', async () => {
    const server = fakeServer([
      { listName: 'Goa trip', spotId: 'id-2', slug: 'spot-2' },
      { listName: 'Monsoon', spotId: 'id-3', slug: 'spot-3' },
    ]);
    const result = await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(result).toEqual({ uploaded: 0, restored: 2, unavailable: 0 });
    const lists = await store.listLists();
    expect(lists.map((l) => l.name).sort()).toEqual(['Goa trip', 'Monsoon']);
    const monsoon = lists.find((l) => l.name === 'Monsoon')!;
    expect((await store.listSpots(monsoon.id)).map((s) => s.detail.slug)).toEqual(['spot-3']);
  });

  it('matches an existing list whatever its capitalisation', async () => {
    await store.createList('goa TRIP');
    const server = fakeServer([{ listName: 'Goa trip', spotId: 'id-2', slug: 'spot-2' }]);
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    const lists = await store.listLists();
    expect(lists).toHaveLength(1);
    expect(lists[0]!.count).toBe(1);
  });

  it('sends removals so a removed place does not come back', async () => {
    const list = await store.createList('Goa trip');
    await store.saveSpot(list.id, detail(1));
    await store.saveSpot(list.id, detail(2));
    const server = fakeServer();
    await syncSavedPlaces({ store, remote: server, fetchDetail });

    await store.unsaveSpot(list.id, 'id-2');
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(server.rows().map((r) => r.spotId)).toEqual(['id-1']);
    expect((await store.listSpots(list.id)).map((s) => s.detail.id)).toEqual(['id-1']);

    // Removals are sent once, then forgotten.
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(server.calls.at(-1)!.remove).toEqual([]);
  });

  it('removes a whole deleted list from the backup', async () => {
    const list = await store.createList('Goa trip');
    await store.saveSpot(list.id, detail(1));
    const server = fakeServer();
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    await store.deleteList(list.id);
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(server.rows()).toEqual([]);
    expect(await store.listLists()).toEqual([]);
  });

  it('keeps a place that was removed and then saved again', async () => {
    const list = await store.createList('Goa trip');
    await store.saveSpot(list.id, detail(1));
    await store.unsaveSpot(list.id, 'id-1');
    await store.saveSpot(list.id, detail(1));
    const server = fakeServer([{ listName: 'Goa trip', spotId: 'id-1', slug: 'spot-1' }]);
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(server.calls[0]!.remove).toEqual([]);
    expect(server.rows()).toHaveLength(1);
  });

  it('skips places that are no longer available and reports the count', async () => {
    const server = fakeServer([
      { listName: 'Goa trip', spotId: 'id-95', slug: 'spot-95' },
      { listName: 'Goa trip', spotId: 'id-4', slug: 'spot-4' },
    ]);
    const result = await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(result).toEqual({ uploaded: 0, restored: 1, unavailable: 1 });
  });

  it('keeps pending removals when the network call fails', async () => {
    const list = await store.createList('Goa trip');
    await store.saveSpot(list.id, detail(1));
    await store.unsaveSpot(list.id, 'id-1');
    const failing = { sync: async () => Promise.reject(new Error('offline')) };
    await expect(syncSavedPlaces({ store, remote: failing, fetchDetail })).rejects.toThrow(
      'offline',
    );
    expect(await store.listRemovals()).toEqual([{ listName: 'Goa trip', spotId: 'id-1' }]);
  });

  it('uses the offline snapshot instead of the network when it has one', async () => {
    await store.cacheSpot(detail(5));
    const server = fakeServer([{ listName: 'Goa trip', spotId: 'id-5', slug: 'spot-5' }]);
    await syncSavedPlaces({ store, remote: server, fetchDetail });
    expect(fetched).toEqual([]);
  });
});
