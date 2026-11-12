import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  asRole,
  call,
  createTestDatabase,
  northOf,
  rpc,
  seedCrowdReport,
  seedSpot,
  seedUser,
  token,
  type Db,
  type TestDatabase,
} from './helpers';

interface Card {
  id: string;
  name: string;
  is_partner: boolean;
  crowd_status: string | null;
  crowd_level: number | null;
  distance_m: number | null;
}

interface Crowd {
  status: string;
  level?: number | null;
  report_count?: number;
  guide_source?: string;
}

let t: TestDatabase;
let db: Db;
let adminId: string;
let guestUserId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.db;
  adminId = await seedUser(db, true);
  guestUserId = await seedUser(db, false);
});

afterAll(async () => {
  await t.drop();
});

const nearby = (radius = 5000, filters: object = {}) =>
  rpc<Card[]>(db, 'anon', null, `select * from public.nearby_spots($1, $2, $3, $4)`, [
    ORIGIN.lat,
    ORIGIN.lng,
    radius,
    JSON.stringify(filters),
  ]);

describe('catalogue reads', () => {
  let nearId: string;

  beforeAll(async () => {
    nearId = await seedSpot(db, { name: 'Near Café', ...northOf(400), labels: ['lesser_known'] });
    await seedSpot(db, { name: 'Far Café', ...northOf(9000) });
    await seedSpot(db, { name: 'Draft Café', ...northOf(300), status: 'draft' });
    await seedSpot(db, { name: 'Review Café', ...northOf(300), status: 'review' });
    await seedSpot(db, { name: 'Suspended Café', ...northOf(300), status: 'suspended' });
    await seedSpot(db, { name: 'Withdrawn Café', ...northOf(300), status: 'withdrawn' });
    await seedSpot(db, { name: 'Blocked Café', ...northOf(300), blocked: true });
    await seedSpot(db, {
      name: 'Closed Café',
      ...northOf(300),
      availability: 'permanently_closed',
    });
    await seedSpot(db, { name: 'Old Fort', category: 'fort', ...northOf(700), labels: ['iconic'] });
  });

  it('nearby returns only published, unblocked records within the radius', async () => {
    const names = (await nearby(5000)).map((c) => c.name);
    expect(names).toEqual(['Near Café', 'Old Fort']);
  });

  it('nearby orders by distance and reports it', async () => {
    const cards = await nearby(20000);
    expect(cards.map((c) => c.name)).toEqual(['Near Café', 'Old Fort', 'Far Café']);
    expect(cards[0]!.distance_m).toBeGreaterThan(350);
    expect(cards[0]!.distance_m).toBeLessThan(450);
  });

  it('filters combine: category group, label and region', async () => {
    expect((await nearby(20000, { category_slugs: ['fort'] })).map((c) => c.name)).toEqual([
      'Old Fort',
    ]);
    expect((await nearby(20000, { category_slugs: ['eat-drink'] })).map((c) => c.name)).toEqual([
      'Near Café',
      'Far Café',
    ]);
    expect(
      (await nearby(20000, { category_slugs: ['eat-drink'], labels: ['lesser_known'] })).map(
        (c) => c.name,
      ),
    ).toEqual(['Near Café']);
    expect(await nearby(20000, { regions: ['south'] })).toEqual([]);
  });

  it('rejects out-of-range coordinates and radius', async () => {
    await expect(
      rpc(db, 'anon', null, `select * from public.nearby_spots(95, 73.8, 1000)`),
    ).rejects.toThrow(/invalid_coordinates/);
    await expect(
      rpc(db, 'anon', null, `select * from public.nearby_spots(15.4, 73.8, 5000000)`),
    ).rejects.toThrow(/invalid_radius/);
  });

  it('viewport query respects filters and caps the result size', async () => {
    const all = await rpc<Card[]>(
      db,
      'anon',
      null,
      `select * from public.spots_in_bbox(15.48, 73.80, 15.60, 73.86, '{}', 2)`,
    );
    expect(all).toHaveLength(2);
    const forts = await rpc<Card[]>(
      db,
      'anon',
      null,
      `select * from public.spots_in_bbox(15.48, 73.80, 15.60, 73.86, $1)`,
      [JSON.stringify({ category_slugs: ['fort'] })],
    );
    expect(forts.map((c) => c.name)).toEqual(['Old Fort']);
    const elsewhere = await rpc<Card[]>(
      db,
      'anon',
      null,
      `select * from public.spots_in_bbox(15.00, 73.90, 15.10, 74.00)`,
    );
    expect(elsewhere).toEqual([]);
  });

  it('search handles plurals, accents, category terms, locality and intent tags', async () => {
    await seedSpot(db, {
      name: 'Sunset Rock',
      category: 'sunset-point',
      ...northOf(1500),
      locality: 'Dona Paula',
      tags: ['quiet', 'family-friendly'],
    });
    const search = async (q: string) =>
      (await rpc<Card[]>(db, 'anon', null, `select * from public.search_spots($1)`, [q])).map(
        (c) => c.name,
      );

    expect(await search('cafes')).toEqual(expect.arrayContaining(['Near Café', 'Far Café']));
    expect(await search('cafés')).toContain('Near Café');
    expect(await search('forts')).toEqual(['Old Fort']);
    expect(await search('dona paula')).toEqual(['Sunset Rock']);
    expect(await search('quiet sunset')).toEqual(['Sunset Rock']);
    expect(await search('family-friendly')).toEqual(['Sunset Rock']);
    expect(await search('draft')).toEqual([]);
    expect(await search('zzzz-no-such-place')).toEqual([]);
    // Only stop words: falls back to browsing rather than returning nothing.
    expect((await search('things to do nearby')).length).toBeGreaterThan(0);
  });

  it('detail is null for non-public spots and hides unverified hours and uncleared media', async () => {
    const slugOf = async (id: string) =>
      (await db.query(`select slug from public.spots where id = $1`, [id])).rows[0].slug as string;

    const draftId = await seedSpot(db, { name: 'Hidden Draft', ...northOf(100), status: 'draft' });
    expect(
      await call(db, 'anon', null, 'public.get_spot_detail', [await slugOf(draftId)]),
    ).toBeNull();

    await db.query(
      `update public.spots set opening_hours = '{"text": "9 to 5", "verified_at": null}' where id = $1`,
      [nearId],
    );
    await db.query(
      `insert into public.spot_media (spot_id, storage_path, rights_status, sort_order) values
         ($1, 'a/ok.jpg', 'owned', 0), ($1, 'a/unknown.jpg', 'not_approved', 1)`,
      [nearId],
    );
    await db.query(
      `insert into public.spot_sources (spot_id, source_type, source_url, source_title, verification_status, is_public) values
         ($1, 'editorial', 'https://example.test/a', 'Public source', 'verified', true),
         ($1, 'local_knowledge', null, 'Private tip', 'verified', false)`,
      [nearId],
    );
    const detail = await call<{
      name: string;
      opening_hours: unknown;
      media: { storage_path: string }[];
      sources: { title: string }[];
      crowd: { status: string };
    }>(db, 'anon', null, 'public.get_spot_detail', [await slugOf(nearId)]);
    expect(detail.name).toBe('Near Café');
    expect(detail.opening_hours).toBeNull();
    expect(detail.media.map((m: { storage_path: string }) => m.storage_path)).toEqual(['a/ok.jpg']);
    expect(detail.sources.map((s: { title: string }) => s.title)).toEqual(['Public source']);
    expect(detail).not.toHaveProperty('internal_notes');
    expect(detail.crowd.status).toBe('unavailable');
  });
});

describe('access control', () => {
  const tables = [
    'spots',
    'spot_candidates',
    'spot_sources',
    'admin_audit_logs',
    'partners',
    'crowd_reports',
    'user_reports',
    'analytics_events',
    'research_jobs',
    'admins',
  ];

  it('anon cannot read any table directly', async () => {
    for (const table of tables) {
      await expect(rpc(db, 'anon', null, `select * from public.${table} limit 1`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('a signed-in non-admin sees no rows; an admin does', async () => {
    for (const table of ['spots', 'spot_candidates', 'admin_audit_logs', 'partners']) {
      const rows = await rpc<unknown[]>(
        db,
        'authenticated',
        guestUserId,
        `select * from public.${table}`,
      );
      expect(rows).toEqual([]);
    }
    const spots = await rpc<unknown[]>(db, 'authenticated', adminId, `select id from public.spots`);
    expect(spots.length).toBeGreaterThan(0);
  });

  it('no client role can write canonical data directly', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(
        rpc(db, role, role === 'anon' ? null : adminId, `update public.spots set name = 'hacked'`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        rpc(
          db,
          role,
          role === 'anon' ? null : adminId,
          `insert into public.partners (business_name, spot_id, whatsapp_number)
           select 'x', id, '919999999999' from public.spots limit 1`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        rpc(
          db,
          role,
          role === 'anon' ? null : adminId,
          `insert into public.admin_audit_logs (action, entity_type) values ('x', 'y')`,
        ),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('guests cannot call admin, worker or private functions', async () => {
    await expect(call(db, 'anon', null, 'public.admin_dashboard')).rejects.toThrow(
      /permission denied/,
    );
    await expect(call(db, 'authenticated', guestUserId, 'public.admin_dashboard')).rejects.toThrow(
      /admin_required/,
    );
    await expect(
      call(db, 'authenticated', adminId, 'public.worker_claim_job', ['w']),
    ).rejects.toThrow(/permission denied/);
    await expect(call(db, 'anon', null, 'public.worker_get_config')).rejects.toThrow(
      /permission denied/,
    );
    await expect(call(db, 'anon', null, 'private.installation_hash', [token(1)])).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      rpc(db, 'authenticated', adminId, `select * from private.app_secrets`),
    ).rejects.toThrow(/permission denied/);
  });

  it('the service role can use the worker API', async () => {
    const config = await call<{ adapters: Record<string, boolean> }>(
      db,
      'service_role',
      null,
      'public.worker_get_config',
    );
    expect(config.adapters.web_search).toBe(true);
  });
});

describe('crowd reports', () => {
  const report = (spotId: string, level: number, at: { lat: number; lng: number }, n: number) =>
    call<{ accepted: boolean; reason?: string; crowd?: Crowd }>(
      db,
      'anon',
      null,
      'public.submit_crowd_report',
      [spotId, level, at.lat, at.lng, token(n)],
    );
  const status = (spotId: string) =>
    call<Crowd>(db, 'anon', null, 'public.get_crowd_status', [spotId]);
  const here = { lat: 15.3, lng: 73.95 };
  const newSpot = (name: string) => seedSpot(db, { name, ...here, region: 'south' });

  it('rejects a report from more than about 300 m away and never stores coordinates', async () => {
    const spot = await newSpot('Crowd A');
    const far = await report(spot, 3, { lat: here.lat + 400 / 111_200, lng: here.lng }, 1);
    expect(far).toEqual({ accepted: false, reason: 'too_far' });
    const edge = await report(spot, 3, { lat: here.lat + 250 / 111_200, lng: here.lng }, 2);
    expect(edge.accepted).toBe(true);

    const columns = await db.query(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'crowd_reports'`,
    );
    const names = columns.rows.map((r) => r.column_name as string);
    expect(names.some((n) => /^(lat|lng|lon|location|coord|geo)/.test(n))).toBe(false);
    const stored = await db.query(
      `select installation_hash from public.crowd_reports where spot_id = $1`,
      [spot],
    );
    expect(
      stored.rows.every((r) => !String(r.installation_hash).includes('test-installation')),
    ).toBe(true);
  });

  it('one or two reports never produce a live label; three distinct devices do', async () => {
    const spot = await newSpot('Crowd B');
    expect((await report(spot, 3, here, 10)).crowd?.status).toBe('unavailable');
    expect((await report(spot, 3, here, 11)).crowd?.status).toBe('unavailable');
    expect((await status(spot)).status).toBe('unavailable');
    const third = await report(spot, 2, here, 12);
    expect(third.crowd).toMatchObject({ status: 'live', level: 3, report_count: 3 });
  });

  it('a second report within the hour from the same device is refused and does not count', async () => {
    const spot = await newSpot('Crowd C');
    await report(spot, 3, here, 20);
    await report(spot, 3, here, 21);
    const again = await report(spot, 3, here, 21);
    expect(again.accepted).toBe(false);
    expect(again.reason).toBe('already_reported');
    expect((await status(spot)).status).toBe('unavailable');
  });

  it('counts each installation once, using its most recent report', async () => {
    const spot = await newSpot('Crowd D');
    await seedCrowdReport(db, spot, 1, 'device-a', 100);
    await seedCrowdReport(db, spot, 3, 'device-a', 10);
    await seedCrowdReport(db, spot, 3, 'device-b', 20);
    expect((await status(spot)).status).toBe('unavailable');
    await seedCrowdReport(db, spot, 3, 'device-c', 30);
    expect(await status(spot)).toMatchObject({ status: 'live', level: 3, report_count: 3 });
  });

  it('reports older than two hours do not count', async () => {
    const spot = await newSpot('Crowd E');
    await seedCrowdReport(db, spot, 3, 'device-a', 121);
    await seedCrowdReport(db, spot, 3, 'device-b', 30);
    await seedCrowdReport(db, spot, 3, 'device-c', 10);
    expect((await status(spot)).status).toBe('unavailable');
    await seedCrowdReport(db, spot, 3, 'device-d', 119);
    expect((await status(spot)).status).toBe('live');
  });

  it('conflicting evidence is reported as mixed, not guessed', async () => {
    const spot = await newSpot('Crowd F');
    await seedCrowdReport(db, spot, 1, 'device-a', 5);
    await seedCrowdReport(db, spot, 2, 'device-b', 5);
    await seedCrowdReport(db, spot, 3, 'device-c', 5);
    expect(await status(spot)).toMatchObject({ status: 'mixed', level: null });

    const even = await newSpot('Crowd G');
    for (const [i, level] of ([1, 1, 2, 2] as const).entries()) {
      await seedCrowdReport(db, even, level, `device-${i}`, 5);
    }
    expect((await status(even)).status).toBe('mixed');
  });

  it("a partner's linked device cannot report on the partner's own place", async () => {
    const spot = await newSpot('Crowd Partner');
    const other = await newSpot('Crowd Other');
    const partnerId = await call<string>(
      db,
      'authenticated',
      adminId,
      'public.admin_save_partner',
      [
        null,
        JSON.stringify({
          business_name: 'Shack Co',
          spot_id: spot,
          whatsapp_number: '+91 98765 43210',
        }),
      ],
    );
    const issued = await call<{ claim_code: string }>(
      db,
      'authenticated',
      adminId,
      'public.admin_issue_partner_claim_code',
      [partnerId],
    );
    const bad = await call<{ linked: boolean }>(db, 'anon', null, 'public.link_partner_device', [
      'WRONGCODE',
      token(30),
    ]);
    expect(bad.linked).toBe(false);
    const linked = await call<{ linked: boolean }>(db, 'anon', null, 'public.link_partner_device', [
      issued.claim_code.toLowerCase(),
      token(30),
    ]);
    expect(linked.linked).toBe(true);

    expect(await report(spot, 1, here, 30)).toEqual({ accepted: false, reason: 'partner_device' });
    expect((await report(other, 1, here, 30)).accepted).toBe(true);
  });

  it('rejects invalid levels, tokens and unknown spots', async () => {
    const spot = await newSpot('Crowd H');
    await expect(report(spot, 4, here, 40)).rejects.toThrow(/invalid_level/);
    await expect(
      call(db, 'anon', null, 'public.submit_crowd_report', [spot, 2, here.lat, here.lng, 'short']),
    ).rejects.toThrow(/invalid_installation_token/);
    const draft = await seedSpot(db, { name: 'Crowd Draft', ...here, status: 'draft' });
    expect(await report(draft, 2, here, 41)).toEqual({
      accepted: false,
      reason: 'spot_unavailable',
    });
  });

  it('caps reports per installation per hour across places', async () => {
    const spots: string[] = [];
    for (let i = 0; i < 13; i += 1) spots.push(await newSpot(`Crowd Cap ${i}`));
    const results = [];
    for (const spot of spots) results.push(await report(spot, 2, here, 50));
    expect(results.slice(0, 12).every((r) => r.accepted)).toBe(true);
    expect(results[12]).toEqual({ accepted: false, reason: 'rate_limited' });
  });

  it('shows an editorial guide only inside its busy window, and labels it as a guide', async () => {
    const spot = await newSpot('Crowd Guide');
    const allWeek = [0, 1, 2, 3, 4, 5, 6];
    await db.query(`update public.spots set crowd_guide = $2 where id = $1`, [
      spot,
      JSON.stringify({
        note: 'Evenings fill up.',
        busy_windows: [{ days: allWeek, start_hour: 0, end_hour: 24 }],
      }),
    ]);
    expect(await status(spot)).toMatchObject({ status: 'guide', guide_source: 'editorial' });
    await db.query(`update public.spots set crowd_guide = $2 where id = $1`, [
      spot,
      JSON.stringify({ note: 'Never.', busy_windows: [{ days: [], start_hour: 0, end_hour: 24 }] }),
    ]);
    expect((await status(spot)).status).toBe('unavailable');
  });
});

describe('try instead', () => {
  const base = { lat: 15.55, lng: 73.76 };
  const at = (metres: number) => ({ lat: base.lat + metres / 111_200, lng: base.lng });
  let origin: string;
  let quiet: string;
  let unknown: string;
  let busy: string;

  const alternatives = (id: string, radius = 15000) =>
    call<{
      crowd_comparison_available: boolean;
      alternatives: { name: string; reason: string }[];
    }>(db, 'anon', null, 'public.get_spot_alternatives', [id, radius, 5]);

  const setCrowd = async (spot: string, level: 1 | 2 | 3) => {
    for (const device of ['x', 'y', 'z'])
      await seedCrowdReport(db, spot, level, `${spot}-${device}`, 5);
  };

  beforeAll(async () => {
    const north = { region: 'north', locality: 'Assagao' };
    origin = await seedSpot(db, { name: 'Origin Beach', category: 'beach', ...at(0), ...north });
    quiet = await seedSpot(db, { name: 'Quiet Beach', category: 'beach', ...at(4000), ...north });
    unknown = await seedSpot(db, {
      name: 'Unknown Beach',
      category: 'beach',
      ...at(2000),
      ...north,
    });
    busy = await seedSpot(db, { name: 'Busy Beach', category: 'beach', ...at(1000), ...north });
    await seedSpot(db, { name: 'Access Path', category: 'beach-access', ...at(3000), ...north });
    await seedSpot(db, {
      name: 'Unsafe Beach',
      category: 'beach',
      ...at(500),
      ...north,
      blocked: true,
    });
    await seedSpot(db, {
      name: 'Draft Beach',
      category: 'beach',
      ...at(500),
      ...north,
      status: 'draft',
    });
    await seedSpot(db, {
      name: 'Restricted Beach',
      category: 'beach',
      ...at(500),
      ...north,
      access: 'restricted',
    });
    await seedSpot(db, {
      name: 'Shut Beach',
      category: 'beach',
      ...at(500),
      ...north,
      availability: 'temporarily_unavailable',
    });
    await seedSpot(db, { name: 'Distant Beach', category: 'beach', ...at(20000), ...north });
    await seedSpot(db, { name: 'Nearby Café', category: 'cafe', ...at(300), ...north });
  });

  it('without live data it returns neutral, safe, same-type places and says so', async () => {
    const result = await alternatives(origin);
    expect(result.crowd_comparison_available).toBe(false);
    const names = result.alternatives.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining(['Busy Beach', 'Unknown Beach', 'Access Path', 'Quiet Beach']),
    );
    expect(result.alternatives.every((a) => a.reason === 'similar_nearby')).toBe(true);
    for (const excluded of [
      'Unsafe Beach',
      'Draft Beach',
      'Restricted Beach',
      'Shut Beach',
      'Distant Beach',
      'Nearby Café',
      'Origin Beach',
    ]) {
      expect(names).not.toContain(excluded);
    }
  });

  it('with live data it ranks reliably quieter places first and drops equally busy ones', async () => {
    await setCrowd(origin, 3);
    await setCrowd(quiet, 1);
    await setCrowd(busy, 3);
    const result = await alternatives(origin);
    expect(result.crowd_comparison_available).toBe(true);
    expect(result.alternatives[0]).toMatchObject({ name: 'Quiet Beach', reason: 'quieter' });
    const names = result.alternatives.map((a) => a.name);
    expect(names).not.toContain('Busy Beach');
    expect(names).not.toContain('Unsafe Beach');
    expect(result.alternatives.find((a) => a.name === 'Unknown Beach')?.reason).toBe(
      'similar_nearby',
    );
  });

  it('respects the radius', async () => {
    const names = (await alternatives(origin, 2500)).alternatives.map((a) => a.name);
    expect(names).toContain('Unknown Beach');
    expect(names).not.toContain('Quiet Beach');
  });

  it('partner status changes neither crowd state nor organic order', async () => {
    const list = () =>
      rpc<Card[]>(db, 'anon', null, `select * from public.nearby_spots($1, $2, 6000, $3)`, [
        base.lat,
        base.lng,
        JSON.stringify({ category_slugs: ['beach'] }),
      ]);
    const before = await list();
    await call(db, 'authenticated', adminId, 'public.admin_save_partner', [
      null,
      JSON.stringify({
        business_name: 'Far Shack',
        spot_id: quiet,
        whatsapp_number: '919876500000',
        partner_status: 'active',
      }),
    ]);
    const after = await list();
    expect(after.map((c) => c.name)).toEqual(before.map((c) => c.name));
    expect(after.map((c) => [c.crowd_status, c.crowd_level])).toEqual(
      before.map((c) => [c.crowd_status, c.crowd_level]),
    );
    expect(after.find((c) => c.id === quiet)?.is_partner).toBe(true);
    expect(before.find((c) => c.id === quiet)?.is_partner).toBe(false);

    const partnerOnly = await rpc<Card[]>(
      db,
      'anon',
      null,
      `select * from public.nearby_spots($1, $2, 6000, '{"partner_only": true}')`,
      [base.lat, base.lng],
    );
    expect(partnerOnly.map((c) => c.id)).toEqual([quiet]);
    const quietNow = await rpc<Card[]>(
      db,
      'anon',
      null,
      `select * from public.nearby_spots($1, $2, 6000, '{"crowd": ["quiet"]}')`,
      [base.lat, base.lng],
    );
    expect(quietNow.map((c) => c.id)).toEqual([quiet]);
    void unknown;
  });

  it('an ended or paused partnership is not shown as a partner', async () => {
    await db.query(`update public.partners set partner_status = 'paused' where spot_id = $1`, [
      quiet,
    ]);
    const cards = await rpc<Card[]>(
      db,
      'anon',
      null,
      `select * from public.nearby_spots($1, $2, 6000, '{"partner_only": true}')`,
      [base.lat, base.lng],
    );
    expect(cards).toEqual([]);
    await db.query(`update public.partners set partner_status = 'active' where spot_id = $1`, [
      quiet,
    ]);
  });

  it('logs partner enquiry intent without any message content', async () => {
    const partner = (await db.query(`select id from public.partners where spot_id = $1`, [quiet]))
      .rows[0].id;
    const ok = await call<{ ok: boolean }>(db, 'anon', null, 'public.track_partner_enquiry', [
      partner,
      quiet,
      'spot_detail',
      'session-1',
    ]);
    expect(ok.ok).toBe(true);
    const wrongSpot = await call<{ ok: boolean }>(
      db,
      'anon',
      null,
      'public.track_partner_enquiry',
      [partner, origin, 'spot_detail', 'session-1'],
    );
    expect(wrongSpot.ok).toBe(false);
    const rows = await db.query(`select * from public.partner_enquiries where partner_id = $1`, [
      partner,
    ]);
    expect(rows.rows).toHaveLength(1);
    expect(Object.keys(rows.rows[0])).not.toContain('message');
  });
});

describe('reports and analytics', () => {
  it('stores problem reports, prioritises safety and rate-limits per installation', async () => {
    const spot = await seedSpot(db, {
      name: 'Report Target',
      lat: 15.2,
      lng: 74.0,
      region: 'south',
    });
    const submit = (type: string, n: number) =>
      call<{ accepted: boolean; reason?: string }>(db, 'anon', null, 'public.submit_spot_problem', [
        spot,
        type,
        'The path is washed out.',
        token(n),
      ]);
    expect((await submit('unsafe', 60)).accepted).toBe(true);
    const row = await db.query(
      `select priority, installation_hash from public.user_reports where spot_id = $1`,
      [spot],
    );
    expect(row.rows[0].priority).toBe('high');
    expect(row.rows[0].installation_hash).not.toContain('test-installation');
    for (let i = 0; i < 4; i += 1) await submit('other', 60);
    expect(await submit('other', 60)).toEqual({ accepted: false, reason: 'rate_limited' });
    await expect(submit('nonsense', 61)).rejects.toThrow(/invalid_report_type/);
  });

  it('strips coordinates and free text from analytics and ignores unknown events', async () => {
    const inserted = await call<number>(db, 'anon', null, 'public.track_events', [
      JSON.stringify([
        {
          name: 'spot_opened',
          props: { spot_id: 'abc', lat: 15.1, lng: 73.9, message: 'hi', region: 'north' },
        },
        { name: 'not_a_real_event', props: {} },
        { name: 'partner_whatsapp_tapped', props: {} },
      ]),
      'session-xyz',
      'android',
      '0.1.0',
    ]);
    expect(inserted).toBe(1);
    const row = await db.query(
      `select props from public.analytics_events where session_id = 'session-xyz'`,
    );
    expect(row.rows[0].props).toEqual({ spot_id: 'abc', region: 'north' });
  });
});

describe('research pipeline and admin review', () => {
  const candidate = (overrides: Record<string, unknown> = {}) => ({
    candidate_name: 'Casa Azul Café',
    dedupe_key: 'casa-azul-cafe|assagao',
    proposed_category_slug: 'cafe',
    proposed_labels: ['lesser_known', 'not_a_label'],
    proposed_region: 'north',
    proposed_locality: 'Assagao',
    lat: 15.5935,
    lng: 73.7712,
    location_confidence: 0.8,
    location_status: 'approximate',
    confidence_score: 84,
    confidence_breakdown: { source_quality: 20 },
    extracted_fields: { description_draft: 'A small courtyard café.', best_time: 'Mornings' },
    schema_version: '1',
    prompt_version: '1',
    risk_flags: [],
    sources: [
      {
        source_type: 'editorial',
        source_url: 'https://example.test/casa-azul',
        source_title: 'Ten cafés',
        evidence_excerpt: 'Casa Azul in Assagao serves breakfast.',
        source_quality: 3,
      },
    ],
    ...overrides,
  });
  const upsert = (data: object) =>
    call<{ id: string; was_new: boolean; closed: boolean; duplicate_cluster_id: string | null }>(
      db,
      'service_role',
      null,
      'public.worker_upsert_candidate',
      [JSON.stringify(data)],
    );
  const admin = <T>(fn: string, params: unknown[]) =>
    call<T>(db, 'authenticated', adminId, fn, params);
  const isPublic = async (name: string) =>
    (await rpc<Card[]>(db, 'anon', null, `select * from public.search_spots($1)`, [name])).length >
    0;

  let candidateId: string;

  it('the worker creates a candidate, never a spot, and upserts are idempotent', async () => {
    const before = (await db.query(`select count(*)::int n from public.spots`)).rows[0].n;
    const first = await upsert(candidate());
    candidateId = first.id;
    expect(first.was_new).toBe(true);
    const second = await upsert(
      candidate({
        sources: [
          {
            source_type: 'editorial',
            source_url: 'https://example.test/casa-azul',
            source_title: 'Ten cafés',
          },
          {
            source_type: 'official_business',
            source_url: 'https://casa-azul.example.test',
            source_title: 'Official',
          },
        ],
      }),
    );
    expect(second).toMatchObject({ id: first.id, was_new: false });
    const after = (await db.query(`select count(*)::int n from public.spots`)).rows[0].n;
    expect(after).toBe(before);
    const row = (
      await db.query(
        `select review_status, proposed_labels from public.spot_candidates where id = $1`,
        [first.id],
      )
    ).rows[0];
    expect(row.review_status).toBe('ready_for_review');
    expect(row.proposed_labels).toEqual(['lesser_known']);
    const sources = await db.query(`select 1 from public.spot_sources where candidate_id = $1`, [
      first.id,
    ]);
    expect(sources.rowCount).toBe(2);
    expect(await isPublic('Casa Azul')).toBe(false);
  });

  it('links likely duplicates but never on the name alone', async () => {
    const same = await upsert(
      candidate({ candidate_name: 'Casa Azul Cafe Assagao', dedupe_key: 'k2' }),
    );
    expect(same.duplicate_cluster_id).not.toBeNull();
    const elsewhere = await upsert(
      candidate({
        candidate_name: 'Casa Azul Café',
        dedupe_key: 'k3',
        proposed_locality: 'Palolem',
        proposed_region: 'south',
        lat: 15.01,
        lng: 74.02,
      }),
    );
    expect(elsewhere.duplicate_cluster_id).toBeNull();
  });

  it('a blocking risk flag stops approval until a human resolves it', async () => {
    const risky = await upsert(
      candidate({
        candidate_name: 'Turtle Cove',
        dedupe_key: 'turtle-cove|morjim',
        proposed_category_slug: 'beach',
        proposed_locality: 'Morjim',
        lat: 15.63,
        lng: 73.73,
        confidence_score: 95,
        risk_flags: [
          {
            code: 'sensitive_ecology',
            severity: 'block',
            source: 'deterministic',
            note: 'turtle nesting',
          },
        ],
      }),
    );
    const status = async () =>
      (await db.query(`select review_status from public.spot_candidates where id = $1`, [risky.id]))
        .rows[0].review_status;
    expect(await status()).toBe('blocked');
    expect(await admin('public.admin_decide_candidate', [risky.id, 'approve'])).toMatchObject({
      ok: false,
      reason: 'unresolved_risk_flags',
    });
    // A later worker pass cannot clear or bypass the block.
    await upsert(
      candidate({
        candidate_name: 'Turtle Cove',
        dedupe_key: 'turtle-cove|morjim',
        confidence_score: 99,
        risk_flags: [],
      }),
    );
    expect(await status()).toBe('blocked');
    await admin('public.admin_flag_candidate', [
      risky.id,
      'sensitive_ecology',
      'resolve',
      'Not the nesting stretch; checked with the forest office.',
    ]);
    expect(await status()).toBe('ready_for_review');
  });

  it('a manual Instagram link is stored as a lead only; blocked domains are refused', async () => {
    const id = await admin<string>('public.admin_add_lead', [
      'Reel Spot',
      'https://www.instagram.com/reel/abc123/',
      'Seen in a reel; looks like a riverside café.',
    ]);
    const source = (
      await db.query(
        `select source_type, rights_notes from public.spot_sources where candidate_id = $1`,
        [id],
      )
    ).rows[0];
    expect(source.source_type).toBe('social_lead');
    expect(source.rights_notes).toMatch(/Lead only/);
    await expect(
      admin('public.admin_add_lead', ['Maps Spot', 'https://maps.google.com/?q=1', null]),
    ).rejects.toThrow(/source_domain_blocked/);
  });

  it('approval creates a non-public spot; publishing enforces the full checklist; all of it is audited', async () => {
    const approved = await admin<{ ok: boolean; spot_id: string }>(
      'public.admin_decide_candidate',
      [candidateId, 'approve', 'Looks right.'],
    );
    expect(approved.ok).toBe(true);
    const spotId = approved.spot_id;
    expect(await isPublic('Casa Azul')).toBe(false);

    const blockedPublish = await admin<{ ok: boolean; missing: { code: string }[] }>(
      'public.admin_set_spot_status',
      [spotId, 'publish'],
    );
    expect(blockedPublish.ok).toBe(false);
    expect(blockedPublish.missing.map((m) => m.code)).toEqual(
      expect.arrayContaining([
        'location',
        'public_access',
        'access_notes',
        'media',
        'sources',
        'safety_review',
        'verification',
      ]),
    );
    expect(await isPublic('Casa Azul')).toBe(false);

    await admin('public.admin_save_spot', [
      spotId,
      JSON.stringify({
        lat: 15.5936,
        lng: 73.7713,
        location_precision: 'exact',
        public_access_status: 'business_premises',
        access_notes: 'On the main Assagao road; park along the wall.',
        safety_reviewed: true,
        verification_method: 'two_local_sources',
        search_tags: ['quiet'],
      }),
    ]);
    await admin('public.admin_save_media', [
      null,
      spotId,
      JSON.stringify({
        storage_path: 'spots/x/full.jpg',
        thumb_path: 'spots/x/thumb.jpg',
        rights_status: 'owned',
        alt_text: 'Courtyard tables',
      }),
    ]);
    const sourceId = (
      await db.query(`select id from public.spot_sources where spot_id = $1 limit 1`, [spotId])
    ).rows[0].id;
    await admin('public.admin_save_source', [
      sourceId,
      JSON.stringify({ verification_status: 'verified' }),
    ]);

    // Still missing last_verified_at: reverify records today's check.
    const stillMissing = await admin<{ ok: boolean; missing: { code: string }[] }>(
      'public.admin_set_spot_status',
      [spotId, 'publish'],
    );
    expect(stillMissing.missing.map((m) => m.code)).toEqual(['verification']);
    await admin('public.admin_set_spot_status', [spotId, 'reverify']);

    const published = await admin<{ ok: boolean }>('public.admin_set_spot_status', [
      spotId,
      'publish',
    ]);
    expect(published.ok).toBe(true);
    expect(await isPublic('Casa Azul')).toBe(true);

    // A material safety edit on a live listing needs a reason.
    await expect(
      admin('public.admin_save_spot', [
        spotId,
        JSON.stringify({ access_notes: 'Use the back lane.' }),
      ]),
    ).rejects.toThrow(/reason_required_for_safety_edit/);
    await admin('public.admin_save_spot', [
      spotId,
      JSON.stringify({ access_notes: 'Use the front gate.' }),
      'Owner confirmed.',
    ]);

    // Suspend first when a credible risk is reported.
    await expect(admin('public.admin_set_spot_status', [spotId, 'suspend'])).rejects.toThrow(
      /reason_required/,
    );
    await admin('public.admin_set_spot_status', [spotId, 'suspend', 'Report of a collapsed wall.']);
    expect(await isPublic('Casa Azul')).toBe(false);

    const actions = (
      await db.query(
        `select action from public.admin_audit_logs where actor_user_id = $1 and (entity_id = $2 or entity_id = $3) order by id`,
        [adminId, spotId, candidateId],
      )
    ).rows.map((r) => r.action as string);
    expect(actions).toEqual(
      expect.arrayContaining([
        'candidate.approve',
        'spot.safety_edit',
        'spot.reverify',
        'spot.publish',
        'spot.suspend',
      ]),
    );

    // The worker cannot reopen a closed candidate.
    expect((await upsert(candidate())).closed).toBe(true);
  });

  it('strict categories need a visit or an authority source before publishing', async () => {
    const id = await admin<string>('public.admin_save_spot', [
      null,
      JSON.stringify({
        name: 'Test Falls',
        primary_category_slug: 'waterfall',
        locality: 'Netravali',
        region: 'inland',
        lat: 15.09,
        lng: 74.21,
        location_precision: 'exact',
        public_access_status: 'verified_public',
        short_description: 'A seasonal waterfall.',
        access_notes: 'Ten minute walk from the gate.',
        safety_reviewed: true,
        verification_method: 'two_local_sources',
      }),
    ]);
    await admin('public.admin_save_media', [
      null,
      id,
      JSON.stringify({ storage_path: 's/f.jpg', rights_status: 'owned' }),
    ]);
    await admin('public.admin_save_source', [
      null,
      JSON.stringify({ spot_id: id, source_type: 'team_visit', verification_status: 'verified' }),
    ]);
    await admin('public.admin_set_spot_status', [id, 'reverify']);
    const first = await admin<{ ok: boolean; missing: { code: string }[] }>(
      'public.admin_set_spot_status',
      [id, 'publish'],
    );
    expect(first.missing.map((m) => m.code).sort()).toEqual(['safety_review', 'verification']);
    await admin('public.admin_save_spot', [
      id,
      JSON.stringify({
        verification_method: 'team_visit',
        safety_tags: ['slippery_rocks', 'monsoon_hazard'],
      }),
    ]);
    expect((await admin<{ ok: boolean }>('public.admin_set_spot_status', [id, 'publish'])).ok).toBe(
      true,
    );
  });

  it('rejects coordinates outside Goa', async () => {
    await expect(
      admin('public.admin_save_spot', [
        null,
        JSON.stringify({
          name: 'Mumbai Place',
          primary_category_slug: 'cafe',
          lat: 19.07,
          lng: 72.87,
        }),
      ]),
    ).rejects.toThrow(/coordinates_outside_goa/);
  });

  it('jobs: enqueue is idempotent, claim honours the kill switch, failures retry then stop', async () => {
    const jobs = [
      {
        query: 'cafes in Assagao Goa',
        region: 'north',
        category_slug: 'cafe',
        idempotency_key: 'job-1',
        max_attempts: 2,
      },
    ];
    expect(
      await call<number>(db, 'service_role', null, 'public.worker_enqueue_jobs', [
        JSON.stringify(jobs),
      ]),
    ).toBe(1);
    expect(
      await call<number>(db, 'service_role', null, 'public.worker_enqueue_jobs', [
        JSON.stringify(jobs),
      ]),
    ).toBe(0);

    await admin('public.admin_set_research_adapter', [
      'web_search',
      false,
      'Provider terms changed.',
    ]);
    expect(await call(db, 'service_role', null, 'public.worker_claim_job', ['w1'])).toBeNull();
    await admin('public.admin_set_research_adapter', ['web_search', true, null]);

    const claimed = await call<{ id: string; attempt_count: number; category_slug: string }>(
      db,
      'service_role',
      null,
      'public.worker_claim_job',
      ['w1'],
    );
    expect(claimed).toMatchObject({ attempt_count: 1, category_slug: 'cafe' });
    expect(await call(db, 'service_role', null, 'public.worker_claim_job', ['w2'])).toBeNull();

    expect(
      await call(db, 'service_role', null, 'public.worker_finish_job', [
        claimed.id,
        false,
        'provider_429',
        null,
        1,
      ]),
    ).toBe('queued');
    await db.query(`update public.research_jobs set run_after = now() where id = $1`, [claimed.id]);
    const again = await call<{ id: string; attempt_count: number }>(
      db,
      'service_role',
      null,
      'public.worker_claim_job',
      ['w1'],
    );
    expect(again.attempt_count).toBe(2);
    expect(
      await call(db, 'service_role', null, 'public.worker_finish_job', [
        again.id,
        false,
        'provider_429',
        null,
        1,
      ]),
    ).toBe('failed');

    await call(db, 'service_role', null, 'public.worker_log_event', [
      again.id,
      'error',
      'provider_429',
      'Quota exhausted',
      '{}',
    ]);
    await call(db, 'service_role', null, 'public.worker_heartbeat', ['w1', 'idle', '{}']);
    const dashboard = await admin<{ research_errors_24h: number; workers: unknown[] }>(
      'public.admin_dashboard',
      [],
    );
    expect(dashboard.research_errors_24h).toBeGreaterThanOrEqual(1);
    expect(dashboard.workers).toHaveLength(1);
  });

  it('admins can read through RLS inside the same transaction model the app uses', async () => {
    const rows = await asRole(db, 'authenticated', adminId, async () => {
      const result = await db.query(
        `select candidate_name from public.spot_candidates order by created_at limit 1`,
      );
      return result.rows;
    });
    expect(rows[0].candidate_name).toBe('Casa Azul Café');
  });
});
