import type { SqlDriver } from './driver';

/**
 * On-device schema, versioned with PRAGMA user_version. Append new entries; never edit
 * one that has shipped. Nothing in this database is uploaded: saves stay on the device.
 */
export const LOCAL_MIGRATIONS: readonly string[] = [
  // 1: saved lists, saved places, offline place snapshots, key-value settings, analytics queue
  `
  create table saved_lists (
    id text primary key,
    name text not null,
    created_at integer not null,
    updated_at integer not null
  );
  create unique index saved_lists_name_uidx on saved_lists (lower(name));

  create table saved_spots (
    list_id text not null references saved_lists (id) on delete cascade,
    spot_id text not null,
    slug text not null,
    added_at integer not null,
    primary key (list_id, spot_id)
  );
  create index saved_spots_slug_idx on saved_spots (slug);

  create table spot_cache (
    slug text primary key,
    spot_id text not null,
    payload text not null,
    cached_at integer not null
  );

  create table kv (
    key text primary key,
    value text not null
  );

  create table event_queue (
    id integer primary key autoincrement,
    name text not null,
    props text not null,
    created_at integer not null
  );
  `,
];

export async function migrateLocalDb(db: SqlDriver): Promise<number> {
  await db.exec('pragma foreign_keys = on');
  const row = await db.first<{ user_version: number }>('pragma user_version');
  let version = row?.user_version ?? 0;
  while (version < LOCAL_MIGRATIONS.length) {
    const sql = LOCAL_MIGRATIONS[version]!;
    const next = version + 1;
    await db.transaction(async () => {
      await db.exec(sql);
      await db.exec(`pragma user_version = ${next}`);
    });
    version = next;
  }
  return version;
}
