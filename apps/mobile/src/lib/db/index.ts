import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import type { SqlDriver, SqlValue } from './driver';
import { migrateLocalDb } from './migrations';
import { createLocalStore, type LocalStore } from './repo';

function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await db.runAsync(sql, params);
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    first: <T>(sql: string, params: SqlValue[] = []) => db.getFirstAsync<T>(sql, params),
    transaction: (task) => db.withTransactionAsync(task),
  };
}

let ready: Promise<LocalStore> | null = null;

/** Opens (and migrates) the on-device database once. */
export function getLocalStore(): Promise<LocalStore> {
  ready ??= (async () => {
    const db = await SQLite.openDatabaseAsync('gupit.db');
    const driver = expoDriver(db);
    await migrateLocalDb(driver);
    return createLocalStore(driver, { now: () => Date.now(), newId: () => Crypto.randomUUID() });
  })();
  return ready;
}

export { LocalStoreError, DEFAULT_LIST_NAME } from './repo';
export type { CachedSpot, LocalStore, SavedList } from './repo';
