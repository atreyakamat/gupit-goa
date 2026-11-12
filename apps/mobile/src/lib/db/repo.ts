import type { SpotDetail } from '@gupit/shared';
import type { SqlDriver } from './driver';

export interface SavedList {
  id: string;
  name: string;
  count: number;
  updatedAt: number;
}

export interface CachedSpot {
  detail: SpotDetail;
  cachedAt: number;
}

export interface QueuedEvent {
  id: number;
  name: string;
  props: Record<string, unknown>;
}

/** A saved place identified the way the account backup identifies it. */
export interface SavedRef {
  listName: string;
  spotId: string;
}

export class LocalStoreError extends Error {
  constructor(
    readonly code: 'invalid_name' | 'duplicate_name' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'LocalStoreError';
  }
}

export const DEFAULT_LIST_NAME = 'Goa trip';
const MAX_UNSAVED_CACHE = 40;
const MAX_QUEUED_EVENTS = 300;
const MAX_PENDING_REMOVALS = 500;

function cleanName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (trimmed.length < 1 || trimmed.length > 40) {
    throw new LocalStoreError('invalid_name', 'A list name needs 1 to 40 characters.');
  }
  return trimmed;
}

/** All on-device persistence: saved lists, offline place snapshots and the analytics queue. */
export function createLocalStore(db: SqlDriver, deps: { now: () => number; newId: () => string }) {
  const { now, newId } = deps;

  async function assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await db.first<{ id: string }>(
      'select id from saved_lists where lower(name) = lower(?)',
      [name],
    );
    if (clash && clash.id !== exceptId) {
      throw new LocalStoreError('duplicate_name', 'You already have a list with that name.');
    }
  }

  const store = {
    // -- Saved lists -------------------------------------------------------
    async listLists(): Promise<SavedList[]> {
      const rows = await db.all<{ id: string; name: string; updated_at: number; n: number }>(
        `select l.id, l.name, l.updated_at, count(s.spot_id) as n
           from saved_lists l left join saved_spots s on s.list_id = l.id
          group by l.id order by l.updated_at desc`,
      );
      return rows.map((r) => ({ id: r.id, name: r.name, count: r.n, updatedAt: r.updated_at }));
    },

    async createList(name: string): Promise<SavedList> {
      const clean = cleanName(name);
      await assertNameFree(clean);
      const id = newId();
      const t = now();
      await db.run(
        'insert into saved_lists (id, name, created_at, updated_at) values (?, ?, ?, ?)',
        [id, clean, t, t],
      );
      return { id, name: clean, count: 0, updatedAt: t };
    },

    async renameList(id: string, name: string): Promise<void> {
      const clean = cleanName(name);
      await assertNameFree(clean, id);
      const existing = await db.first<{ id: string }>('select id from saved_lists where id = ?', [
        id,
      ]);
      if (!existing) throw new LocalStoreError('not_found', 'That list no longer exists.');
      await db.run('update saved_lists set name = ?, updated_at = ? where id = ?', [
        clean,
        now(),
        id,
      ]);
    },

    async deleteList(id: string): Promise<void> {
      await db.transaction(async () => {
        await db.run(
          `insert or replace into sync_removals (list_key, list_name, spot_id, removed_at)
           select lower(l.name), l.name, s.spot_id, ?
             from saved_spots s join saved_lists l on l.id = s.list_id where l.id = ?`,
          [now(), id],
        );
        await db.run('delete from saved_spots where list_id = ?', [id]);
        await db.run('delete from saved_lists where id = ?', [id]);
      });
      await store.pruneCache();
    },

    /** Finds a list by name, ignoring capitalisation, or creates it. */
    async ensureListNamed(name: string): Promise<SavedList> {
      const clean = cleanName(name);
      const row = await db.first<{ id: string }>(
        'select id from saved_lists where lower(name) = lower(?)',
        [clean],
      );
      if (!row) return store.createList(clean);
      return (await store.listLists()).find((l) => l.id === row.id)!;
    },

    /** The list a first-time save goes into. Created on demand. */
    async ensureDefaultList(): Promise<SavedList> {
      const lists = await store.listLists();
      return lists[0] ?? (await store.createList(DEFAULT_LIST_NAME));
    },

    // -- Saved places ------------------------------------------------------
    /** Saves the place and pins a full snapshot so it can be read with no network. */
    async saveSpot(listId: string, detail: SpotDetail): Promise<void> {
      const list = await db.first<{ id: string; name: string }>(
        'select id, name from saved_lists where id = ?',
        [listId],
      );
      if (!list) throw new LocalStoreError('not_found', 'That list no longer exists.');
      const t = now();
      await db.transaction(async () => {
        // Saving again cancels a removal that has not been sent yet.
        await db.run('delete from sync_removals where list_key = lower(?) and spot_id = ?', [
          list.name,
          detail.id,
        ]);
        await db.run(
          'insert or ignore into saved_spots (list_id, spot_id, slug, added_at) values (?, ?, ?, ?)',
          [listId, detail.id, detail.slug, t],
        );
        await db.run('update saved_lists set updated_at = ? where id = ?', [t, listId]);
      });
      await store.cacheSpot(detail);
    },

    async unsaveSpot(listId: string, spotId: string): Promise<void> {
      const t = now();
      await db.transaction(async () => {
        await db.run(
          `insert or replace into sync_removals (list_key, list_name, spot_id, removed_at)
           select lower(l.name), l.name, s.spot_id, ?
             from saved_spots s join saved_lists l on l.id = s.list_id
            where s.list_id = ? and s.spot_id = ?`,
          [t, listId, spotId],
        );
        await db.run('delete from saved_spots where list_id = ? and spot_id = ?', [listId, spotId]);
        await db.run('update saved_lists set updated_at = ? where id = ?', [t, listId]);
        await db.run(
          `delete from sync_removals where rowid not in
             (select rowid from sync_removals order by removed_at desc limit ?)`,
          [MAX_PENDING_REMOVALS],
        );
      });
    },

    // -- Account backup (only used when signed in) ---------------------------
    async listAllSaved(): Promise<SavedRef[]> {
      const rows = await db.all<{ name: string; spot_id: string }>(
        `select l.name, s.spot_id from saved_spots s join saved_lists l on l.id = s.list_id
          order by s.added_at`,
      );
      return rows.map((r) => ({ listName: r.name, spotId: r.spot_id }));
    },

    async listRemovals(): Promise<SavedRef[]> {
      const rows = await db.all<{ list_name: string; spot_id: string }>(
        'select list_name, spot_id from sync_removals order by removed_at',
      );
      return rows.map((r) => ({ listName: r.list_name, spotId: r.spot_id }));
    },

    async clearRemovals(sent: SavedRef[]): Promise<void> {
      await db.transaction(async () => {
        for (const item of sent) {
          await db.run('delete from sync_removals where list_key = lower(?) and spot_id = ?', [
            item.listName,
            item.spotId,
          ]);
        }
      });
    },

    async clearAllRemovals(): Promise<void> {
      await db.run('delete from sync_removals');
    },

    async listIdsContaining(spotId: string): Promise<string[]> {
      const rows = await db.all<{ list_id: string }>(
        'select list_id from saved_spots where spot_id = ?',
        [spotId],
      );
      return rows.map((r) => r.list_id);
    },

    async listSpots(listId: string): Promise<CachedSpot[]> {
      const rows = await db.all<{ payload: string; cached_at: number }>(
        `select c.payload, c.cached_at
           from saved_spots s join spot_cache c on c.slug = s.slug
          where s.list_id = ? order by s.added_at desc`,
        [listId],
      );
      return rows.map((r) => ({
        detail: JSON.parse(r.payload) as SpotDetail,
        cachedAt: r.cached_at,
      }));
    },

    // -- Offline snapshots -------------------------------------------------
    async cacheSpot(detail: SpotDetail): Promise<void> {
      await db.run(
        `insert into spot_cache (slug, spot_id, payload, cached_at) values (?, ?, ?, ?)
         on conflict (slug) do update set spot_id = excluded.spot_id, payload = excluded.payload, cached_at = excluded.cached_at`,
        [detail.slug, detail.id, JSON.stringify(detail), now()],
      );
    },

    async getCachedSpot(slug: string): Promise<CachedSpot | null> {
      const row = await db.first<{ payload: string; cached_at: number }>(
        'select payload, cached_at from spot_cache where slug = ?',
        [slug],
      );
      return row
        ? { detail: JSON.parse(row.payload) as SpotDetail, cachedAt: row.cached_at }
        : null;
    },

    /** Keeps every saved place plus the most recently viewed unsaved ones. */
    async pruneCache(): Promise<void> {
      await db.run(
        `delete from spot_cache
          where slug not in (select slug from saved_spots)
            and slug not in (
              select slug from spot_cache
               where slug not in (select slug from saved_spots)
               order by cached_at desc limit ?)`,
        [MAX_UNSAVED_CACHE],
      );
    },

    // -- Settings ----------------------------------------------------------
    async getSetting(key: string): Promise<string | null> {
      const row = await db.first<{ value: string }>('select value from kv where key = ?', [key]);
      return row?.value ?? null;
    },

    async setSetting(key: string, value: string): Promise<void> {
      await db.run(
        'insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value',
        [key, value],
      );
    },

    // -- Analytics queue (survives offline; bounded) -------------------------
    async enqueueEvent(name: string, props: Record<string, unknown>): Promise<void> {
      await db.run('insert into event_queue (name, props, created_at) values (?, ?, ?)', [
        name,
        JSON.stringify(props),
        now(),
      ]);
      await db.run(
        'delete from event_queue where id not in (select id from event_queue order by id desc limit ?)',
        [MAX_QUEUED_EVENTS],
      );
    },

    async peekEvents(limit: number): Promise<QueuedEvent[]> {
      const rows = await db.all<{ id: number; name: string; props: string }>(
        'select id, name, props from event_queue order by id limit ?',
        [limit],
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        props: JSON.parse(r.props) as Record<string, unknown>,
      }));
    },

    async deleteEventsThrough(lastId: number): Promise<void> {
      await db.run('delete from event_queue where id <= ?', [lastId]);
    },
  };

  return store;
}

export type LocalStore = ReturnType<typeof createLocalStore>;
