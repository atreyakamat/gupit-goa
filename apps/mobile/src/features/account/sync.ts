import type { SpotDetail } from '@gupit/shared';
import type { LocalStore, SavedRef } from '../../lib/db/repo';

export type { SavedRef };

export interface RemoteSaved extends SavedRef {
  slug: string;
}

/** The account backup. `sync` applies removals, then additions, and returns everything it holds. */
export interface SavedRemote {
  sync(add: SavedRef[], remove: SavedRef[]): Promise<RemoteSaved[]>;
}

export interface SyncResult {
  /** Places on this phone that were sent to the backup. */
  uploaded: number;
  /** Places from the backup that were added to this phone. */
  restored: number;
  /** Places in the backup that are no longer listed, or could not be loaded right now. */
  unavailable: number;
}

const keyOf = (item: SavedRef) => `${item.listName.trim().toLowerCase()}|${item.spotId}`;

/**
 * Two-way merge between the phone and the signed-in account.
 *
 * The phone stays the source of truth for what the person sees: nothing is ever deleted
 * from the phone by a sync. Removals made on this phone are sent once so the place does
 * not return from the backup; if the call fails they are kept and sent next time.
 */
export async function syncSavedPlaces(deps: {
  store: LocalStore;
  remote: SavedRemote;
  fetchDetail: (slug: string) => Promise<SpotDetail | null>;
}): Promise<SyncResult> {
  const { store, remote, fetchDetail } = deps;
  const local = await store.listAllSaved();
  const removals = await store.listRemovals();

  const merged = await remote.sync(local, removals);
  await store.clearRemovals(removals);

  const have = new Set(local.map(keyOf));
  let restored = 0;
  let unavailable = 0;
  for (const item of merged) {
    if (have.has(keyOf(item))) continue;
    try {
      const detail =
        (await store.getCachedSpot(item.slug))?.detail ?? (await fetchDetail(item.slug));
      if (!detail) {
        unavailable += 1;
        continue;
      }
      const list = await store.ensureListNamed(item.listName);
      await store.saveSpot(list.id, detail);
      have.add(keyOf(item));
      restored += 1;
    } catch {
      // One place failing to load must not stop the rest; it is retried on the next sync.
      unavailable += 1;
    }
  }
  return { uploaded: local.length, restored, unavailable };
}
