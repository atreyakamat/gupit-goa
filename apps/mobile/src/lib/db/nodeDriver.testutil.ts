import type { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from './driver';

/** Test-only driver backed by Node's built-in SQLite. Never imported by app code. */
export function nodeDriver(db: DatabaseSync): SqlDriver {
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
