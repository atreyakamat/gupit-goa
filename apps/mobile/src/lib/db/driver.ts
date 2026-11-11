/**
 * Minimal SQL interface the local store is written against. On device it is backed by
 * expo-sqlite (see ./index.ts); in unit tests by Node's built-in SQLite.
 */
export type SqlValue = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  transaction(task: () => Promise<void>): Promise<void>;
}
