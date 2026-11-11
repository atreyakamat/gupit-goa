import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

export const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';

export type Db = pg.Client;
export type Role = 'anon' | 'authenticated' | 'service_role';

export interface TestDatabase {
  db: Db;
  name: string;
  drop: () => Promise<void>;
}

/** Creates a fresh database, applies the test shim and every migration in order. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `gupit_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();

  await db.query(readFileSync(join(here, 'bootstrap.sql'), 'utf8'));
  for (const file of readdirSync(migrationsDir).sort()) {
    if (!file.endsWith('.sql')) continue;
    try {
      await db.query(readFileSync(join(migrationsDir, file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
    }
  }

  return {
    db,
    name,
    drop: async () => {
      await db.end();
      const cleanup = new pg.Client({ connectionString: ADMIN_URL });
      await cleanup.connect();
      await cleanup.query(`drop database if exists ${name} with (force)`);
      await cleanup.end();
    },
  };
}

/**
 * Runs `fn` as an API role inside a transaction, the way PostgREST does.
 * `userId` becomes auth.uid(). The transaction commits unless `fn` throws.
 */
export async function asRole<T>(
  db: Db,
  role: Role,
  userId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query('begin');
  try {
    await db.query(`set local role ${role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    const result = await fn();
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

export async function rpc<T = unknown>(
  db: Db,
  role: Role,
  userId: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  return asRole(db, role, userId, async () => {
    const result = await db.query(sql, params);
    return result.rows as T;
  });
}

/** Single-value helper for functions that return jsonb or a scalar. */
export async function call<T = unknown>(
  db: Db,
  role: Role,
  userId: string | null,
  fn: string,
  params: unknown[] = [],
): Promise<T> {
  const placeholders = params.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await rpc<{ result: T }[]>(
    db,
    role,
    userId,
    `select ${fn}(${placeholders}) as result`,
    params,
  );
  return rows[0]!.result;
}

export interface SpotSeed {
  name: string;
  category?: string;
  lat: number;
  lng: number;
  status?: string;
  locality?: string;
  region?: string;
  labels?: string[];
  tags?: string[];
  blocked?: boolean;
  availability?: string;
  access?: string;
  publishedAt?: string;
}

/** Inserts a spot directly (superuser). Only for arranging test data. */
export async function seedSpot(db: Db, seed: SpotSeed): Promise<string> {
  const result = await db.query(
    `insert into public.spots
       (slug, name, primary_category_id, location, location_precision, public_access_status,
        verification_status, locality, region, discovery_labels, search_tags, safety_blocked,
        safety_block_reason, availability_status, access_notes, short_description,
        last_verified_at, published_at)
     values (
       private.slugify($1) || '-' || substr(md5(random()::text), 1, 6), $1,
       (select id from public.categories where slug = $2),
       extensions.st_setsrid(extensions.st_makepoint($4, $3), 4326)::extensions.geography,
       'exact', $5, $6, $7, $8, $9, $10, $11, $12, $13, 'Follow the main road.', 'Test listing.',
       now(), coalesce($14::timestamptz, now()))
     returning id`,
    [
      seed.name,
      seed.category ?? 'cafe',
      seed.lat,
      seed.lng,
      seed.access ?? 'verified_public',
      seed.status ?? 'published',
      seed.locality ?? 'Panaji',
      seed.region ?? 'central',
      seed.labels ?? [],
      seed.tags ?? [],
      seed.blocked ?? false,
      seed.blocked ? 'Unsafe approach reported.' : null,
      seed.availability ?? 'open',
      seed.publishedAt ?? null,
    ],
  );
  return result.rows[0].id as string;
}

/** Inserts an already-validated crowd report at a chosen age (superuser, test arrangement only). */
export async function seedCrowdReport(
  db: Db,
  spotId: string,
  level: 1 | 2 | 3,
  installation: string,
  minutesAgo: number,
): Promise<void> {
  await db.query(
    `insert into public.crowd_reports (spot_id, crowd_level, installation_hash, reported_at, is_valid)
     values ($1, $2, $3, now() - make_interval(mins => $4), true)`,
    [spotId, level, installation, minutesAgo],
  );
}

export async function seedUser(db: Db, admin: boolean): Promise<string> {
  const result = await db.query(`insert into auth.users (email) values ($1) returning id`, [
    `${randomBytes(4).toString('hex')}@example.test`,
  ]);
  const id = result.rows[0].id as string;
  if (admin) {
    await db.query(`insert into public.admins (user_id, display_name) values ($1, 'Test Admin')`, [
      id,
    ]);
  }
  return id;
}

export const token = (n: number): string => `test-installation-token-${String(n).padStart(4, '0')}`;

// Panaji, used as the origin for geospatial tests.
export const ORIGIN = { lat: 15.4909, lng: 73.8278 };
/** Roughly `metres` north of the origin (1 degree of latitude is about 111.2 km). */
export const northOf = (metres: number) => ({
  lat: ORIGIN.lat + metres / 111_200,
  lng: ORIGIN.lng,
});
