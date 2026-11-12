import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStubExtractor } from '../../services/research-worker/src/adapters/llm';
import { planDiscoveryJobs } from '../../services/research-worker/src/discovery/queryPlanner';
import { createNoopGeocoder } from '../../services/research-worker/src/geocoding/geocoder';
import { runWorker } from '../../services/research-worker/src/jobs/runner';
import type {
  Extractor,
  Repository,
  SearchProvider,
} from '../../services/research-worker/src/types';
import {
  call,
  createTestDatabase,
  rpc,
  seedSpot,
  seedUser,
  type Db,
  type TestDatabase,
} from './helpers';

/**
 * Contract test: the real worker pipeline against the real SQL, using the service role.
 * Only the outside world (search, pages, model) is faked.
 */
let t: TestDatabase;
let db: Db;
let adminId: string;

const worker = <T>(fn: string, params: unknown[] = []) =>
  call<T>(db, 'service_role', null, fn, params);

function pgRepository(): Repository {
  return {
    async getConfig() {
      const raw = await worker<{
        adapters: Record<string, boolean>;
        domain_rules: Record<string, 'allow' | 'block' | 'lead_only'>;
        category_slugs: string[];
      }>('public.worker_get_config');
      return {
        adapters: raw.adapters,
        domainRules: raw.domain_rules,
        categorySlugs: raw.category_slugs,
      };
    },
    enqueueJobs: (jobs) => worker<number>('public.worker_enqueue_jobs', [JSON.stringify(jobs)]),
    claimJob: (workerId) => worker('public.worker_claim_job', [workerId]),
    async finishJob(jobId, result) {
      await worker('public.worker_finish_job', [
        jobId,
        result.ok,
        result.errorCode ?? null,
        result.cost ? JSON.stringify(result.cost) : null,
        result.retryInSeconds ?? null,
      ]);
    },
    async upsertCandidate(candidate) {
      const r = await worker<{ id: string; was_new: boolean; closed: boolean }>(
        'public.worker_upsert_candidate',
        [JSON.stringify(candidate)],
      );
      return { id: r.id, wasNew: r.was_new, closed: r.closed };
    },
    async logEvent(jobId, level, code, message, details) {
      await worker('public.worker_log_event', [
        jobId,
        level,
        code,
        message ?? null,
        JSON.stringify(details ?? {}),
      ]);
    },
    async heartbeat(workerId, status, details) {
      await worker('public.worker_heartbeat', [workerId, status, JSON.stringify(details ?? {})]);
    },
  };
}

const extracted = (name: string, locality: string, extra: Record<string, unknown> = {}) => ({
  name,
  aliases: [],
  category_slug: 'cafe',
  secondary_category_slugs: [],
  locality,
  region: 'north',
  address_text: null,
  stated_lat: null,
  stated_lng: null,
  description_draft: 'A café.',
  best_time: null,
  visit_duration: null,
  price_band: null,
  access_notes: null,
  parking_info: null,
  opening_hours_text: null,
  contact_phone: null,
  website_url: null,
  crowd_notes: null,
  safety_notes: null,
  respect_notes: null,
  positioning: ['lesser_known'],
  positioning_reason: null,
  risk_notes: [],
  evidence_excerpt: `${name} in ${locality}`,
  claims_supported: ['name'],
  ...extra,
});

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.db;
  adminId = await seedUser(db, true);
});

afterAll(async () => {
  await t.drop();
});

describe('worker pipeline against the database', () => {
  it('plans jobs idempotently', async () => {
    const repo = pgRepository();
    const jobs = planDiscoveryJobs({
      regions: ['north'],
      limit: 3,
      now: new Date('2026-11-11T00:00:00Z'),
    });
    expect(await repo.enqueueJobs(jobs)).toBe(3);
    expect(await repo.enqueueJobs(jobs)).toBe(0);
    const rows = await db.query(
      `select count(*)::int n from public.research_jobs where category_id is not null`,
    );
    expect(rows.rows[0].n).toBe(3);
  });

  it('turns permitted pages into review candidates and nothing else', async () => {
    const spotsBefore = (await db.query(`select count(*)::int n from public.spots`)).rows[0].n;
    const search: SearchProvider = {
      name: 'fake',
      search: async () => [
        { url: 'https://www.instagram.com/p/abc/', title: 'Post', snippet: null },
        { url: 'https://journal.test/a', title: 'A', snippet: null },
        { url: 'https://coast.test/b', title: 'B', snippet: null },
      ],
    };
    const requested: string[] = [];
    const fetcher = {
      fetch: async (url: string) => {
        if (url.includes('instagram')) return { ok: false as const, reason: 'lead_only' as const };
        requested.push(url);
        const text = url.includes('coast')
          ? 'Hidden Cove in Morjim is a turtle nesting site.'
          : 'Casa Verde in Siolim serves breakfast.';
        return {
          ok: true as const,
          page: {
            url,
            host: new URL(url).hostname,
            title: 'T',
            siteName: null,
            author: null,
            publishedAt: '2026-10-01',
            text,
          },
        };
      },
    };
    const extractor: Extractor = {
      name: 'fake',
      extract: async (page) => ({
        usage: { inputTokens: 10, outputTokens: 5 },
        raw: {
          candidates: page.url.includes('coast')
            ? [extracted('Hidden Cove', 'Morjim', { category_slug: 'beach' })]
            : [extracted('Casa Verde', 'Siolim')],
        },
      }),
    };

    const summary = await runWorker(
      {
        repo: pgRepository(),
        search,
        fetcher,
        extractor,
        geocoder: createNoopGeocoder(),
        maxPagesPerJob: 5,
      },
      { workerId: 'test-worker', maxJobs: 1 },
    );
    expect(summary).toEqual({ completed: 1, failed: 0, retried: 0 });
    expect(requested).toEqual(['https://journal.test/a', 'https://coast.test/b']);

    const candidates = (
      await db.query(
        `select candidate_name, review_status, proposed_category_slug, prompt_version, confidence_score from public.spot_candidates order by candidate_name`,
      )
    ).rows;
    expect(candidates.map((c) => [c.candidate_name, c.review_status])).toEqual([
      ['Casa Verde', 'new'],
      ['Hidden Cove', 'blocked'],
    ]);
    expect(candidates[0].prompt_version).toBeTruthy();
    expect(candidates[0].confidence_score).toBeGreaterThan(0);

    const sources = (
      await db.query(
        `select source_url, published_at::text from public.spot_sources order by source_url`,
      )
    ).rows;
    expect(sources).toEqual([
      { source_url: 'https://coast.test/b', published_at: '2026-10-01' },
      { source_url: 'https://journal.test/a', published_at: '2026-10-01' },
    ]);

    // Nothing became a place, nothing is public, and the skip was logged for admins.
    expect((await db.query(`select count(*)::int n from public.spots`)).rows[0].n).toBe(
      spotsBefore,
    );
    expect(await rpc(db, 'anon', null, `select * from public.search_spots('casa verde')`)).toEqual(
      [],
    );
    const events = (await db.query(`select code from public.research_events`)).rows.map(
      (r) => r.code,
    );
    expect(events).toContain('fetch_lead_only');
    const job = (
      await db.query(
        `select status, cost_metadata from public.research_jobs where status = 'completed'`,
      )
    ).rows[0];
    expect(job.cost_metadata).toMatchObject({
      pages_fetched: 2,
      pages_skipped: 1,
      candidates_stored: 2,
      candidates_blocked: 1,
    });
    const dashboard = await call<{ workers: { worker_id: string; status: string }[] }>(
      db,
      'authenticated',
      adminId,
      'public.admin_dashboard',
    );
    expect(dashboard.workers[0]).toMatchObject({ worker_id: 'test-worker', status: 'idle' });
  });

  it('runs with the development stubs without inventing candidates', async () => {
    const before = (await db.query(`select count(*)::int n from public.spot_candidates`)).rows[0].n;
    const search: SearchProvider = {
      name: 'fake',
      search: async () => [{ url: 'https://journal.test/c', title: 'C', snippet: null }],
    };
    const fetcher = {
      fetch: async (url: string) => ({
        ok: true as const,
        page: {
          url,
          host: 'journal.test',
          title: null,
          siteName: null,
          author: null,
          publishedAt: null,
          text: 'Some place in Goa.',
        },
      }),
    };
    await runWorker(
      {
        repo: pgRepository(),
        search,
        fetcher,
        extractor: createStubExtractor(),
        geocoder: createNoopGeocoder(),
        maxPagesPerJob: 2,
      },
      { workerId: 'test-worker', maxJobs: 1 },
    );
    expect((await db.query(`select count(*)::int n from public.spot_candidates`)).rows[0].n).toBe(
      before,
    );
  });
});

describe('scheduled maintenance', () => {
  it('labels long-unverified listings as stale, keeps them visible, and logs it', async () => {
    const fresh = await seedSpot(db, { name: 'Fresh Place', lat: 15.5, lng: 73.8 });
    const old = await seedSpot(db, { name: 'Old Place', lat: 15.5, lng: 73.81 });
    await db.query(
      `update public.spots set last_verified_at = now() - interval '200 days' where id = $1`,
      [old],
    );
    const changed = (await db.query(`select private.mark_stale_listings() as n`)).rows[0].n;
    expect(changed).toBe(1);
    const cards = await rpc<{ id: string; needs_recheck: boolean }[]>(
      db,
      'anon',
      null,
      `select id, needs_recheck from public.search_spots('place')`,
    );
    expect(cards.find((c) => c.id === old)?.needs_recheck).toBe(true);
    expect(cards.find((c) => c.id === fresh)?.needs_recheck).toBe(false);
    const log = await db.query(
      `select 1 from public.admin_audit_logs where action = 'spot.auto_mark_stale' and entity_id = $1`,
      [old],
    );
    expect(log.rowCount).toBe(1);
    await expect(call(db, 'authenticated', adminId, 'private.mark_stale_listings')).rejects.toThrow(
      /permission denied/,
    );
  });

  it('purges raw crowd reports after 30 days but keeps the anonymous hourly totals', async () => {
    const spot = await seedSpot(db, { name: 'Purge Place', lat: 15.4, lng: 73.9 });
    await db.query(
      `insert into public.crowd_reports (spot_id, crowd_level, installation_hash, reported_at, is_valid) values
         ($1, 2, 'old-device', now() - interval '31 days', true), ($1, 2, 'new-device', now() - interval '1 day', true)`,
      [spot],
    );
    await db.query(
      `insert into public.crowd_hourly_stats (spot_id, day_of_week, hour_of_day, report_count, level_sum) values ($1, 1, 10, 2, 4)`,
      [spot],
    );
    expect((await db.query(`select private.purge_old_crowd_reports() as n`)).rows[0].n).toBe(1);
    expect(
      (
        await db.query(`select installation_hash from public.crowd_reports where spot_id = $1`, [
          spot,
        ])
      ).rows,
    ).toEqual([{ installation_hash: 'new-device' }]);
    expect(
      (
        await db.query(`select report_count from public.crowd_hourly_stats where spot_id = $1`, [
          spot,
        ])
      ).rows[0].report_count,
    ).toBe(2);
  });
});

describe('creator posts linked to a place', () => {
  const posts = (spotId: string) =>
    call<{ url: string; creator_handle: string | null; note: string | null }[]>(
      db,
      'anon',
      null,
      'public.get_spot_social_posts',
      [spotId],
    );
  const save = (
    spotId: string,
    url: string,
    handle: string | null = null,
    note: string | null = null,
  ) =>
    call<string>(db, 'authenticated', adminId, 'public.admin_save_social_post', [
      spotId,
      url,
      handle,
      note,
    ]);

  it('stores a cleaned link, handle and note, and nothing else', async () => {
    const spot = await seedSpot(db, { name: 'Tagged Café', lat: 15.52, lng: 73.82 });
    await save(
      spot,
      'https://instagram.com/reel/Cabc_123-x/?igsh=tracking123&utm_source=x',
      '@Goa.Frames',
      'Breakfast in the courtyard.',
    );
    await save(spot, 'http://m.instagram.com/p/Dxyz789', null, null);
    expect(await posts(spot)).toEqual([
      {
        id: expect.any(String),
        platform: 'instagram',
        url: 'https://www.instagram.com/reel/Cabc_123-x/',
        creator_handle: 'goa.frames',
        note: 'Breakfast in the courtyard.',
      },
      {
        id: expect.any(String),
        platform: 'instagram',
        url: 'https://www.instagram.com/p/Dxyz789/',
        creator_handle: null,
        note: null,
      },
    ]);
    const columns = (
      await db.query(
        `select column_name from information_schema.columns where table_name = 'spot_social_posts'`,
      )
    ).rows.map((r) => r.column_name as string);
    expect(columns.some((c) => /caption|image|media|video|thumbnail/.test(c))).toBe(false);
  });

  it('saving the same post again updates it instead of duplicating', async () => {
    const spot = await seedSpot(db, {
      name: 'Tagged Fort',
      category: 'fort',
      lat: 15.53,
      lng: 73.83,
    });
    await save(spot, 'https://www.instagram.com/p/Same123/', 'first.handle');
    await save(spot, 'https://www.instagram.com/p/Same123/?x=1', 'second.handle', 'Updated.');
    expect((await posts(spot)).map((p) => [p.creator_handle, p.note])).toEqual([
      ['second.handle', 'Updated.'],
    ]);
  });

  it('rejects profiles, stories, other sites and bad handles', async () => {
    const spot = await seedSpot(db, { name: 'Strict Place', lat: 15.54, lng: 73.84 });
    for (const url of [
      'https://www.instagram.com/goa.frames/',
      'https://www.instagram.com/stories/x/123/',
      'https://example.com/p/abc/',
      'https://www.instagram.com.evil.test/p/abc/',
      'javascript:alert(1)',
    ]) {
      await expect(save(spot, url)).rejects.toThrow(/invalid_instagram_post_url/);
    }
    await expect(save(spot, 'https://www.instagram.com/p/Ok123/', 'not a handle!')).rejects.toThrow(
      /invalid_instagram_handle/,
    );
  });

  it('is hidden for places that are not public, and only reviewers can add or remove', async () => {
    const draft = await seedSpot(db, {
      name: 'Draft With Post',
      lat: 15.55,
      lng: 73.85,
      status: 'draft',
    });
    const id = await save(draft, 'https://www.instagram.com/p/Hidden1/', 'someone');
    expect(await posts(draft)).toEqual([]);
    await expect(
      call(db, 'anon', null, 'public.admin_save_social_post', [
        draft,
        'https://www.instagram.com/p/Nope1/',
        null,
        null,
      ]),
    ).rejects.toThrow(/permission denied/);
    await expect(rpc(db, 'anon', null, `select * from public.spot_social_posts`)).rejects.toThrow(
      /permission denied/,
    );
    await call(db, 'authenticated', adminId, 'public.admin_delete_social_post', [id]);
    expect(
      (
        await db.query(`select count(*)::int n from public.spot_social_posts where spot_id = $1`, [
          draft,
        ])
      ).rows[0].n,
    ).toBe(0);
    const audit = (
      await db.query(
        `select action from public.admin_audit_logs where entity_type = 'spot_social_post' and entity_id = $1 order by id`,
        [id],
      )
    ).rows.map((r) => r.action);
    expect(audit).toEqual(['social_post.save', 'social_post.delete']);
  });
});
