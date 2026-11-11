import { DatabaseSync } from 'node:sqlite';
import type { SpotDetail } from '@gupit/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { describePrivilegedKey, readPublicEnv } from '../envCheck';
import type { SqlDriver, SqlValue } from './driver';
import { LOCAL_MIGRATIONS, migrateLocalDb } from './migrations';
import { createLocalStore, type LocalStore } from './repo';

function nodeDriver(db: DatabaseSync): SqlDriver {
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params: SqlValue[] = []) => {
      db.prepare(sql).run(...params);
    },
    all: async <T>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    first: async <T>(sql: string, params: SqlValue[] = []) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    transaction: async (task) => {
      db.exec('begin');
      try {
        await task();
        db.exec('commit');
      } catch (error) {
        db.exec('rollback');
        throw error;
      }
    },
  };
}

const detail = (n: number): SpotDetail => ({
  id: `id-${n}`,
  slug: `spot-${n}`,
  name: `Spot ${n}`,
  short_description: 'A place.',
  description: null,
  category: { slug: 'cafe', label: 'Café', group_slug: 'eat-drink', group_label: 'Eat & drink' },
  discovery_labels: [],
  region: 'north',
  locality: 'Assagao',
  address_text: null,
  lat: 15.59,
  lng: 73.77,
  location_precision: 'exact',
  public_access_status: 'business_premises',
  price_band: null,
  best_time: null,
  parking_info: null,
  opening_hours: null,
  safety_tags: [],
  respect_tags: [],
  safety_notes: null,
  respect_notes: null,
  access_notes: 'Main road.',
  verified_attributes: [],
  needs_recheck: false,
  temporarily_unavailable: false,
  last_verified_at: '2026-11-01T00:00:00Z',
  last_visited_at: null,
  media: [],
  sources: [],
  partner: null,
  crowd: { status: 'unavailable' },
});

let driver: SqlDriver;
let store: LocalStore;
let clock: number;

beforeEach(async () => {
  driver = nodeDriver(new DatabaseSync(':memory:'));
  await migrateLocalDb(driver);
  clock = 1_000;
  let id = 0;
  store = createLocalStore(driver, { now: () => (clock += 1), newId: () => `list-${(id += 1)}` });
});

describe('local migrations', () => {
  it('applies every migration once and is safe to re-run', async () => {
    expect(await migrateLocalDb(driver)).toBe(LOCAL_MIGRATIONS.length);
    const version = await driver.first<{ user_version: number }>('pragma user_version');
    expect(version?.user_version).toBe(LOCAL_MIGRATIONS.length);
  });
});

describe('saved lists', () => {
  it('creates, renames and deletes lists', async () => {
    const list = await store.createList('  Weekend   ideas ');
    expect(list.name).toBe('Weekend ideas');
    await store.renameList(list.id, 'Monsoon');
    expect((await store.listLists()).map((l) => l.name)).toEqual(['Monsoon']);
    await store.deleteList(list.id);
    expect(await store.listLists()).toEqual([]);
  });

  it('rejects empty, over-long and duplicate names', async () => {
    await store.createList('Goa trip');
    await expect(store.createList('   ')).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(store.createList('x'.repeat(41))).rejects.toMatchObject({ code: 'invalid_name' });
    await expect(store.createList('goa TRIP')).rejects.toMatchObject({ code: 'duplicate_name' });
    await expect(store.renameList('missing', 'Other')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('creates the default list on a first save', async () => {
    const list = await store.ensureDefaultList();
    expect(list.name).toBe('Goa trip');
    expect((await store.ensureDefaultList()).id).toBe(list.id);
  });
});

describe('saved places and offline snapshots', () => {
  it('a saved place is readable from the device alone', async () => {
    const list = await store.ensureDefaultList();
    await store.saveSpot(list.id, detail(1));
    await store.saveSpot(list.id, detail(1));
    expect(await store.listIdsContaining('id-1')).toEqual([list.id]);
    const spots = await store.listSpots(list.id);
    expect(spots).toHaveLength(1);
    expect(spots[0]!.detail.access_notes).toBe('Main road.');
    expect((await store.getCachedSpot('spot-1'))?.detail.name).toBe('Spot 1');
    expect((await store.listLists())[0]!.count).toBe(1);
  });

  it('unsaving removes it from the list', async () => {
    const list = await store.ensureDefaultList();
    await store.saveSpot(list.id, detail(1));
    await store.unsaveSpot(list.id, 'id-1');
    expect(await store.listSpots(list.id)).toEqual([]);
    expect(await store.listIdsContaining('id-1')).toEqual([]);
  });

  it('refreshes a snapshot in place', async () => {
    await store.cacheSpot(detail(1));
    await store.cacheSpot({ ...detail(1), name: 'Renamed' });
    expect((await store.getCachedSpot('spot-1'))?.detail.name).toBe('Renamed');
  });

  it('pruning keeps saved places and only the most recent unsaved views', async () => {
    const list = await store.ensureDefaultList();
    await store.saveSpot(list.id, detail(0));
    for (let n = 1; n <= 45; n += 1) await store.cacheSpot(detail(n));
    await store.pruneCache();
    expect(await store.getCachedSpot('spot-0')).not.toBeNull();
    expect(await store.getCachedSpot('spot-1')).toBeNull();
    expect(await store.getCachedSpot('spot-45')).not.toBeNull();
    const count = await driver.first<{ n: number }>('select count(*) as n from spot_cache');
    expect(count?.n).toBe(41);
  });

  it('deleting a list drops its saves but other lists keep theirs', async () => {
    const a = await store.createList('A');
    const b = await store.createList('B');
    await store.saveSpot(a.id, detail(1));
    await store.saveSpot(b.id, detail(1));
    await store.deleteList(a.id);
    expect(await store.listIdsContaining('id-1')).toEqual([b.id]);
    expect(await store.getCachedSpot('spot-1')).not.toBeNull();
    await expect(store.saveSpot(a.id, detail(2))).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('settings and analytics queue', () => {
  it('stores settings', async () => {
    expect(await store.getSetting('onboarded')).toBeNull();
    await store.setSetting('onboarded', '1');
    await store.setSetting('onboarded', '2');
    expect(await store.getSetting('onboarded')).toBe('2');
  });

  it('queues events in order and removes them once sent', async () => {
    await store.enqueueEvent('app_opened', {});
    await store.enqueueEvent('spot_opened', { spot_id: 'id-1' });
    const batch = await store.peekEvents(10);
    expect(batch.map((e) => e.name)).toEqual(['app_opened', 'spot_opened']);
    await store.deleteEventsThrough(batch[0]!.id);
    expect((await store.peekEvents(10)).map((e) => e.name)).toEqual(['spot_opened']);
  });

  it('bounds the offline queue', async () => {
    for (let n = 0; n < 305; n += 1) await store.enqueueEvent('list_viewed', { n });
    const all = await store.peekEvents(1000);
    expect(all).toHaveLength(300);
    expect(all[0]!.props.n).toBe(5);
  });
});

describe('public environment guard', () => {
  const jwt = (role: string) =>
    `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;

  it('accepts client-safe keys', () => {
    expect(describePrivilegedKey(jwt('anon'))).toBeNull();
    expect(describePrivilegedKey('sb_publishable_abc')).toBeNull();
    expect(
      readPublicEnv({ supabaseUrl: ' https://a.supabase.co ', supabaseAnonKey: jwt('anon') })
        .supabaseUrl,
    ).toBe('https://a.supabase.co');
    expect(readPublicEnv({})).toEqual({
      supabaseUrl: null,
      supabaseAnonKey: null,
      mapStyleUrl: null,
    });
  });

  it('refuses privileged keys, plain http and the public OSM tile server', () => {
    expect(() =>
      readPublicEnv({ supabaseUrl: 'https://a.supabase.co', supabaseAnonKey: jwt('service_role') }),
    ).toThrow(/service-role/);
    expect(() => readPublicEnv({ supabaseAnonKey: 'sb_secret_abc' })).toThrow(/secret key/);
    expect(() => readPublicEnv({ supabaseUrl: 'http://example.com' })).toThrow(/https/);
    expect(() =>
      readPublicEnv({ mapStyleUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' }),
    ).toThrow(/tile provider/);
  });
});
