import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  call,
  createTestDatabase,
  rpc,
  seedSpot,
  seedUser,
  type Db,
  type TestDatabase,
} from './helpers';

interface Saved {
  list_name: string;
  spot_id: string;
  slug: string;
}

let t: TestDatabase;
let db: Db;
let alice: string;
let bob: string;
let admin: string;
let cafe: string;
let fort: string;
let draft: string;

const sync = (userId: string | null, add: object[] = [], remove: object[] = []) =>
  call<Saved[]>(db, userId ? 'authenticated' : 'anon', userId, 'public.sync_saved_spots', [
    JSON.stringify(add),
    JSON.stringify(remove),
  ]);

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.db;
  alice = await seedUser(db, false);
  bob = await seedUser(db, false);
  admin = await seedUser(db, true);
  cafe = await seedSpot(db, { name: 'Sync Cafe', ...ORIGIN });
  fort = await seedSpot(db, { name: 'Sync Fort', category: 'fort', ...ORIGIN });
  draft = await seedSpot(db, { name: 'Sync Draft', status: 'draft', ...ORIGIN });
});

afterAll(async () => {
  await t.drop();
});

describe('optional accounts: saved places sync', () => {
  it('refuses guests, who keep everything on the device', async () => {
    await expect(sync(null, [{ list_name: 'Goa trip', spot_id: cafe }])).rejects.toThrow();
    await expect(
      call(db, 'authenticated', null, 'public.sync_saved_spots', ['[]', '[]']),
    ).rejects.toThrow(/sign_in_required/);
  });

  it('stores saves and returns the merged set with slugs', async () => {
    const first = await sync(alice, [{ list_name: 'Goa trip', spot_id: cafe }]);
    expect(first).toEqual([expect.objectContaining({ list_name: 'Goa trip', spot_id: cafe })]);
    expect(first[0]!.slug).toMatch(/^sync-cafe/);

    // A second device uploads a different place and gets both back.
    const second = await sync(alice, [{ list_name: 'Goa trip', spot_id: fort }]);
    expect(second.map((s) => s.spot_id).sort()).toEqual([cafe, fort].sort());
  });

  it('is idempotent and treats list names case-insensitively', async () => {
    const again = await sync(alice, [
      { list_name: 'goa TRIP', spot_id: cafe },
      { list_name: 'Goa trip', spot_id: cafe },
    ]);
    expect(again.filter((s) => s.spot_id === cafe)).toHaveLength(1);
  });

  it('keeps each user separate', async () => {
    expect(await sync(bob)).toEqual([]);
    await sync(bob, [{ list_name: 'Weekend', spot_id: fort }]);
    const mine = await sync(alice);
    expect(mine.every((s) => s.list_name === 'Goa trip')).toBe(true);
  });

  it('applies removals so a removed place does not come back', async () => {
    const after = await sync(alice, [], [{ list_name: 'GOA TRIP', spot_id: fort }]);
    expect(after.map((s) => s.spot_id)).toEqual([cafe]);
  });

  it('ignores unpublished, unknown and malformed entries', async () => {
    const result = await sync(alice, [
      { list_name: 'Goa trip', spot_id: draft },
      { list_name: 'Goa trip', spot_id: '00000000-0000-4000-8000-000000000000' },
      { list_name: 'Goa trip', spot_id: 'not-a-uuid' },
      { list_name: '', spot_id: fort },
      { list_name: 'x'.repeat(41), spot_id: fort },
      { spot_id: fort },
      'nonsense',
    ]);
    expect(result.map((s) => s.spot_id)).toEqual([cafe]);
  });

  it('rejects oversized batches', async () => {
    const many = Array.from({ length: 501 }, () => ({ list_name: 'Goa trip', spot_id: cafe }));
    await expect(sync(alice, many)).rejects.toThrow(/too_many_items/);
  });

  it('stops returning a place once it is unpublished', async () => {
    await sync(alice, [{ list_name: 'Goa trip', spot_id: fort }]);
    await db.query(`update public.spots set verification_status = 'suspended' where id = $1`, [
      fort,
    ]);
    expect((await sync(alice)).map((s) => s.spot_id)).toEqual([cafe]);
    await db.query(`update public.spots set verification_status = 'published' where id = $1`, [
      fort,
    ]);
  });

  it('gives no direct table access, even to reviewers', async () => {
    for (const [role, user] of [
      ['anon', null],
      ['authenticated', alice],
      ['authenticated', admin],
    ] as const) {
      const rows = await rpc<unknown[]>(
        db,
        role,
        user,
        'select * from public.user_saved_spots',
      ).catch((error: Error) => error);
      // Either the privilege is missing or RLS hides every row.
      expect(rows instanceof Error || (rows as unknown[]).length === 0).toBe(true);
    }
    await expect(
      rpc(db, 'authenticated', alice, 'insert into public.user_saved_spots values ($1, $2, $3)', [
        alice,
        'Hack',
        cafe,
      ]),
    ).rejects.toThrow();
  });
});

describe('optional accounts: deletion', () => {
  it('refuses guests', async () => {
    await expect(call(db, 'anon', null, 'public.delete_my_account')).rejects.toThrow();
  });

  it('refuses reviewer accounts, which are managed by hand', async () => {
    await expect(call(db, 'authenticated', admin, 'public.delete_my_account')).rejects.toThrow(
      /reviewer_account/,
    );
  });

  it('removes the account and its saved places, and nobody else', async () => {
    await call(db, 'authenticated', bob, 'public.delete_my_account');
    const users = await db.query('select id from auth.users where id = any($1)', [[alice, bob]]);
    expect(users.rows.map((r) => r.id)).toEqual([alice]);
    const saved = await db.query('select distinct user_id from public.user_saved_spots');
    expect(saved.rows.map((r) => r.user_id)).toEqual([alice]);
  });
});
