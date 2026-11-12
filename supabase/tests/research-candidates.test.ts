import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, createTestDatabase, type Db, type TestDatabase } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, '..', 'research', 'candidates-2026-11.sql'), 'utf8');
const expected = (
  JSON.parse(
    readFileSync(join(here, '..', 'research', 'candidates-2026-11.json'), 'utf8'),
  ) as unknown[]
).length;

let t: TestDatabase;
let db: Db;

const load = () => asRole(db, 'service_role', null, () => db.query(sql));

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.db;
  await load();
});

afterAll(async () => {
  await t.drop();
});

describe('desk research candidates', () => {
  it('loads every lead into the review queue', async () => {
    const { rows } = await db.query('select count(*)::int as n from public.spot_candidates');
    expect(rows[0].n).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(30);
  });

  it('publishes nothing: no place is created without a reviewer', async () => {
    const spots = await db.query('select count(*)::int as n from public.spots');
    expect(spots.rows[0].n).toBe(0);
    const open = await db.query(
      `select count(*)::int as n from public.spot_candidates
        where review_status = 'needs_more_evidence' and approved_spot_id is null
          and proposed_location is null and location_status = 'needs_review'`,
    );
    expect(open.rows[0].n).toBe(expected);
  });

  it('gives every lead a valid category and at least one linked source', async () => {
    const bad = await db.query(
      `select c.candidate_name from public.spot_candidates c
        where c.proposed_category_slug is null
           or not exists (select 1 from public.spot_sources s
                           where s.candidate_id = c.id and s.source_url ~ '^https://')`,
    );
    expect(bad.rows).toEqual([]);
  });

  it('never uses a blocked or lead-only site as evidence', async () => {
    const bad = await db.query(
      `select source_url from public.spot_sources
        where source_url ~* '(google\\.|instagram\\.|facebook\\.|reddit\\.|tripadvisor\\.|zomato\\.)'`,
    );
    expect(bad.rows).toEqual([]);
  });

  it('can be loaded twice without duplicates', async () => {
    await load();
    const { rows } = await db.query(
      `select (select count(*) from public.spot_candidates)::int as c,
              (select count(*) from public.spot_sources)::int as s,
              (select count(distinct (candidate_id, source_url)) from public.spot_sources)::int as d`,
    );
    expect(rows[0].c).toBe(expected);
    expect(rows[0].s).toBe(rows[0].d);
  });
});
