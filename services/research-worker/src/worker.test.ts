import { describe, expect, it } from 'vitest';
import { createStubExtractor } from './adapters/llm';
import { createPageFetcher, extractPage } from './adapters/pageFetcher';
import { ProviderError, createStubSearchProvider } from './adapters/search';
import { loadEnv } from './config';
import {
  dedupeKey,
  isLikelyDuplicate,
  nameSimilarity,
  normalizeName,
} from './deduplication/dedupe';
import { planDiscoveryJobs } from './discovery/queryPlanner';
import { extractionJsonSchema } from './extraction/prompt';
import { sanitizeExtraction } from './extraction/sanitize';
import { createNoopGeocoder } from './geocoding/geocoder';
import type { PipelineDeps } from './jobs/processDiscovery';
import { backoffSeconds, runWorker } from './jobs/runner';
import { classifyUrl } from './policy/domains';
import { isAllowedByRobots } from './policy/robots';
import { hasBlockingFlag, screenCandidate } from './safety/rules';
import { WEIGHTS, scoreCandidate } from './scoring/confidence';
import type {
  CandidateUpsert,
  Extractor,
  PlannedJob,
  Repository,
  ResearchJob,
  SearchProvider,
  WorkerConfig,
} from './types';

const CATEGORIES = ['cafe', 'beach', 'waterfall', 'fort'];

const candidate = (overrides: Record<string, unknown> = {}) => ({
  name: 'Casa Azul',
  aliases: [],
  category_slug: 'cafe',
  secondary_category_slugs: [],
  locality: 'Assagao',
  region: 'north',
  address_text: null,
  stated_lat: null,
  stated_lng: null,
  description_draft: 'A small courtyard café.',
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
  positioning: [],
  positioning_reason: null,
  risk_notes: [],
  evidence_excerpt: 'Casa Azul in Assagao serves breakfast.',
  claims_supported: ['name', 'locality'],
  ...overrides,
});

describe('query planner', () => {
  const now = new Date('2026-11-11T00:00:00Z');

  it('covers every region and both popular and lesser-known phrasings', () => {
    const jobs = planDiscoveryJobs({ now });
    expect(new Set(jobs.map((j) => j.region))).toEqual(
      new Set(['north', 'central', 'south', 'inland']),
    );
    const queries = jobs.map((j) => j.query);
    expect(queries).toContain('popular beaches in North Goa');
    expect(queries).toContain('quiet beaches South Goa public access');
    expect(queries).toContain('cafes in Assagao Goa');
    expect(queries).toContain('nightclubs in North Goa');
    expect(queries.every((q) => !/hidden gem/i.test(q))).toBe(true);
  });

  it('is deterministic and idempotent within a week, and bounded', () => {
    const a = planDiscoveryJobs({ now });
    const b = planDiscoveryJobs({ now: new Date('2026-11-13T00:00:00Z') });
    expect(a.map((j) => j.idempotency_key)).toEqual(b.map((j) => j.idempotency_key));
    expect(new Set(a.map((j) => j.idempotency_key)).size).toBe(a.length);
    const nextWeek = planDiscoveryJobs({ now: new Date('2026-11-18T00:00:00Z') });
    expect(nextWeek[0]!.idempotency_key).not.toBe(a[0]!.idempotency_key);
    expect(a.length).toBeLessThan(400);
    expect(planDiscoveryJobs({ now, regions: ['south'], limit: 5 })).toHaveLength(5);
  });
});

describe('source policy', () => {
  it('never allows fetching Instagram or other lead-only platforms, whatever the config says', () => {
    for (const url of [
      'https://www.instagram.com/reel/abc/',
      'https://instagram.com/somecafe',
      'https://m.facebook.com/page',
      'https://www.youtube.com/watch?v=1',
      'https://x.com/user/status/1',
    ]) {
      expect(classifyUrl(url, {})).toBe('lead_only');
      // An admin "allow" rule cannot lower the built-in floor.
      expect(
        classifyUrl(url, {
          'instagram.com': 'allow',
          'facebook.com': 'allow',
          'youtube.com': 'allow',
          'x.com': 'allow',
        }),
      ).toBe('lead_only');
    }
  });

  it('applies configured rules to subdomains and lets a stricter rule win', () => {
    const rules = { 'google.com': 'block', 'example.com': 'lead_only' } as const;
    expect(classifyUrl('https://maps.google.com/?q=1', rules)).toBe('block');
    expect(classifyUrl('https://blog.example.com/post', rules)).toBe('lead_only');
    expect(classifyUrl('https://goa-blog.test/cafes', rules)).toBe('allow');
    expect(classifyUrl('https://notexample.com/x', rules)).toBe('allow');
    expect(classifyUrl('https://instagram.com/x', { 'instagram.com': 'block' })).toBe('block');
  });

  it('blocks anything that is not a plain web URL', () => {
    expect(classifyUrl('ftp://example.com/x', {})).toBe('block');
    expect(classifyUrl('not a url', {})).toBe('block');
  });
});

describe('robots.txt', () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/press/
Disallow: /*.pdf$

User-agent: GupitGoaResearch
Disallow: /no-research/
`;
  it('uses the specific group when one matches, otherwise the wildcard group', () => {
    expect(isAllowedByRobots(robots, '/no-research/x', 'GupitGoaResearch/0.1 (+a@b.c)')).toBe(
      false,
    );
    expect(isAllowedByRobots(robots, '/private/x', 'GupitGoaResearch/0.1')).toBe(true);
    expect(isAllowedByRobots(robots, '/private/x', 'OtherBot')).toBe(false);
  });
  it('prefers the longest match and supports wildcards', () => {
    expect(isAllowedByRobots(robots, '/private/press/kit', 'OtherBot')).toBe(true);
    expect(isAllowedByRobots(robots, '/files/menu.pdf', 'OtherBot')).toBe(false);
    expect(isAllowedByRobots(robots, '/files/menu.pdf?x=1', 'OtherBot')).toBe(true);
    expect(isAllowedByRobots('', '/anything', 'OtherBot')).toBe(true);
    expect(isAllowedByRobots('User-agent: *\nDisallow:', '/anything', 'OtherBot')).toBe(true);
  });
});

describe('page fetcher', () => {
  const html = `<html><head><title>Ten cafés in Assagao</title>
    <meta property="og:site_name" content="Goa Journal"><meta name="author" content="A. Writer">
    <meta property="article:published_time" content="2026-08-02T10:00:00Z"></head>
    <body><nav>Menu Home</nav><article><h1>Ten cafés</h1><p>Casa Azul in Assagao serves breakfast.</p></article>
    <script>track()</script><footer>Copyright</footer></body></html>`;

  it('extracts visible article text and metadata only', () => {
    const page = extractPage('https://www.goajournal.test/cafes', html);
    expect(page).toMatchObject({
      host: 'goajournal.test',
      title: 'Ten cafés in Assagao',
      siteName: 'Goa Journal',
      author: 'A. Writer',
      publishedAt: '2026-08-02',
    });
    expect(page.text).toContain('Casa Azul in Assagao');
    expect(page.text).not.toMatch(/track\(\)|Copyright|Menu Home/);
  });

  function harness(
    responses: Record<string, { status?: number; body?: string; type?: string; finalUrl?: string }>,
  ) {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const r = responses[url];
      if (!r) return new Response('', { status: 404 });
      const response = new Response(r.body ?? '', {
        status: r.status ?? 200,
        headers: { 'content-type': r.type ?? 'text/html; charset=utf-8' },
      });
      Object.defineProperty(response, 'url', { value: r.finalUrl ?? url });
      return response;
    }) as unknown as typeof fetch;
    const fetcher = createPageFetcher({
      userAgent: 'GupitGoaResearch/0.1 (+test@example.test)',
      getDomainRules: () => ({ 'blocked.test': 'block' }),
      fetchImpl,
      sleep: async () => undefined,
    });
    return { fetcher, requested };
  }

  it('makes no network request at all for lead-only or blocked domains', async () => {
    const { fetcher, requested } = harness({});
    expect(await fetcher.fetch('https://www.instagram.com/reel/abc/')).toEqual({
      ok: false,
      reason: 'lead_only',
    });
    expect(await fetcher.fetch('https://blocked.test/page')).toEqual({
      ok: false,
      reason: 'policy_block',
    });
    expect(requested).toEqual([]);
  });

  it('obeys robots.txt and stops at an access wall', async () => {
    const { fetcher, requested } = harness({
      'https://a.test/robots.txt': {
        body: 'User-agent: *\nDisallow: /members/',
        type: 'text/plain',
      },
      'https://a.test/open': { body: html },
      'https://b.test/robots.txt': { status: 404 },
      'https://b.test/login-only': { status: 403 },
      'https://c.test/robots.txt': { status: 403 },
    });
    expect(await fetcher.fetch('https://a.test/members/list')).toEqual({
      ok: false,
      reason: 'robots_disallow',
    });
    const ok = await fetcher.fetch('https://a.test/open');
    expect(ok.ok).toBe(true);
    expect(await fetcher.fetch('https://b.test/login-only')).toMatchObject({
      ok: false,
      reason: 'access_restricted',
    });
    expect(await fetcher.fetch('https://c.test/anything')).toEqual({
      ok: false,
      reason: 'robots_disallow',
    });
    expect(requested.filter((u) => u.endsWith('/robots.txt'))).toHaveLength(3);
  });

  it('rejects a redirect that lands on a restricted domain, and non-HTML content', async () => {
    const { fetcher } = harness({
      'https://d.test/robots.txt': { status: 404 },
      'https://d.test/go': { body: html, finalUrl: 'https://www.instagram.com/p/xyz/' },
      'https://d.test/file': { body: '%PDF', type: 'application/pdf' },
    });
    expect(await fetcher.fetch('https://d.test/go')).toMatchObject({
      ok: false,
      reason: 'policy_block',
    });
    expect(await fetcher.fetch('https://d.test/file')).toEqual({ ok: false, reason: 'not_html' });
  });
});

describe('extraction output validation', () => {
  it('keeps valid candidates and turns blanks and "unknown" into null', () => {
    const { candidates, issues } = sanitizeExtraction(
      {
        candidates: [
          candidate({
            opening_hours_text: '',
            best_time: 'Unknown',
            parking_info: ' Street parking ',
          }),
        ],
      },
      CATEGORIES,
    );
    expect(issues).toEqual([]);
    expect(candidates[0]).toMatchObject({
      opening_hours_text: null,
      best_time: null,
      parking_info: 'Street parking',
    });
  });

  it('drops invalid items individually and nulls invented categories', () => {
    const { candidates, issues } = sanitizeExtraction(
      {
        candidates: [
          candidate({ name: '' }),
          'nonsense',
          candidate({ category_slug: 'secret-spot', region: 'north' }),
          candidate({ name: 'Other', region: 'west' }),
        ],
      },
      CATEGORIES,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.category_slug).toBeNull();
    expect(issues).toEqual([
      'candidate_0_invalid:name',
      'candidate_1_not_an_object',
      'candidate_2_unknown_category:secret-spot',
      'candidate_3_invalid:region',
    ]);
  });

  it('discards half-stated or out-of-Goa coordinates instead of trusting them', () => {
    const { candidates, issues } = sanitizeExtraction(
      {
        candidates: [
          candidate({ stated_lat: 15.59 }),
          candidate({ name: 'Second', stated_lat: 19.07, stated_lng: 72.87 }),
          candidate({ name: 'Third', stated_lat: 15.59, stated_lng: 73.77 }),
        ],
      },
      CATEGORIES,
    );
    expect(candidates.map((c) => [c.stated_lat, c.stated_lng])).toEqual([
      [null, null],
      [null, null],
      [15.59, 73.77],
    ]);
    expect(issues).toHaveLength(2);
  });

  it('survives malformed output', () => {
    expect(sanitizeExtraction(null, CATEGORIES).candidates).toEqual([]);
    expect(sanitizeExtraction({ candidates: 'none' }, CATEGORIES).issues).toEqual([
      'output_has_no_candidates_array',
    ]);
  });

  it('publishes a JSON schema for structured output', () => {
    expect(extractionJsonSchema).toMatchObject({ type: 'object' });
    expect(JSON.stringify(extractionJsonSchema)).toContain('evidence_excerpt');
  });
});

describe('duplicate detection', () => {
  it('normalises names', () => {
    expect(normalizeName('  Café  Bodega & Co.! ')).toBe('cafe bodega and co');
    expect(dedupeKey('Café Bodega', 'Panaji')).toBe('cafe-bodega|panaji');
    expect(dedupeKey('Café Bodega', null)).toBe('cafe-bodega|unknown-locality');
  });

  it('scores similar names high and different names low', () => {
    expect(nameSimilarity('Casa Azul Café', 'Casa Azul Cafe Goa')).toBe(1);
    expect(nameSimilarity('Casa Azul', 'Casa Azzul')).toBeGreaterThan(0.82);
    expect(nameSimilarity('Casa Azul', 'Blue Tokai')).toBeLessThan(0.4);
  });

  it('never merges on name alone', () => {
    const a = { name: 'Sunset Point', locality: 'Vagator', position: { lat: 15.6, lng: 73.73 } };
    expect(
      isLikelyDuplicate(a, {
        name: 'Sunset Point',
        locality: 'Dona Paula',
        position: { lat: 15.45, lng: 73.8 },
      }),
    ).toBe(false);
    expect(isLikelyDuplicate(a, { name: 'Sunset Point', locality: null, position: null })).toBe(
      false,
    );
    expect(
      isLikelyDuplicate(a, { name: 'Sunset Point Vagator', locality: 'vagator', position: null }),
    ).toBe(false);
    expect(
      isLikelyDuplicate(a, { name: 'Sunset Point', locality: 'VAGATOR', position: null }),
    ).toBe(true);
    expect(
      isLikelyDuplicate(a, {
        name: 'Sunset Point',
        locality: null,
        position: { lat: 15.6005, lng: 73.7301 },
      }),
    ).toBe(true);
  });
});

describe('safety screening', () => {
  const parsed = (overrides: Record<string, unknown>) =>
    sanitizeExtraction({ candidates: [candidate(overrides)] }, CATEGORIES).candidates[0]!;

  it('blocks sensitive ecology, private access, restricted areas, danger and community objection', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ description_draft: 'A beach known as a turtle nesting site.' }, 'sensitive_ecology'],
      [{ access_notes: 'You have to jump the fence behind the villa.' }, 'private_property'],
      [{ risk_notes: ['Inside a restricted area near the naval base'] }, 'restricted_access'],
      [
        { safety_notes: 'Popular for cliff jumping; two people drowned last year.' },
        'unsafe_access',
      ],
      [{ positioning_reason: 'Locals do not want tourists here.' }, 'community_objection'],
    ];
    for (const [overrides, code] of cases) {
      const flags = screenCandidate(parsed(overrides), '');
      expect(flags.find((f) => f.code === code)).toMatchObject({
        severity: 'block',
        source: 'deterministic',
      });
      expect(hasBlockingFlag(flags)).toBe(true);
    }
  });

  it('reads the page text near the place name, not unrelated parts of a list page', () => {
    const page = `Casa Azul in Assagao is a calm courtyard café. ${'Filler sentence. '.repeat(80)} Another beach is a turtle nesting site.`;
    expect(hasBlockingFlag(screenCandidate(parsed({}), page))).toBe(false);
    const close = 'Casa Azul sits beside a turtle nesting site and has no signage.';
    expect(hasBlockingFlag(screenCandidate(parsed({}), close))).toBe(true);
  });

  it('adds model risk notes as warnings and marks strict categories for a visit', () => {
    const flags = screenCandidate(
      parsed({ category_slug: 'waterfall', risk_notes: ['Slippery after rain'] }),
      '',
    );
    expect(flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'model_risk_note', severity: 'warn', source: 'llm' }),
        expect.objectContaining({ code: 'needs_visit_or_authority', severity: 'warn' }),
      ]),
    );
    expect(hasBlockingFlag(flags)).toBe(false);
    expect(screenCandidate(parsed({}), '')).toEqual([]);
  });
});

describe('confidence scoring', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  it('uses the spec weights, which sum to 100', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('scores a well-evidenced candidate high and a thin lead low, with reasons', () => {
    const strong = scoreCandidate({
      bestSourceQuality: 5,
      independentSources: 3,
      hasCategory: true,
      hasLocality: true,
      location: { kind: 'stated' },
      newestEvidenceDate: '2026-08-01',
      hasAccessNotes: true,
      hasSafetyNotes: true,
      now,
    });
    expect(strong.total).toBe(96);
    const thin = scoreCandidate({
      bestSourceQuality: 3,
      independentSources: 1,
      hasCategory: false,
      hasLocality: true,
      location: { kind: 'none' },
      newestEvidenceDate: null,
      hasAccessNotes: false,
      hasSafetyNotes: false,
      now,
    });
    expect(thin.total).toBe(28);
    expect(thin.breakdown.notes).toEqual(
      expect.arrayContaining([
        'Only one publisher so far: needs a second source.',
        'No coordinates: a reviewer must place the pin.',
      ]),
    );
    const { notes, ...parts } = strong.breakdown;
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(strong.total);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('never exceeds a dimension weight', () => {
    const { breakdown } = scoreCandidate({
      bestSourceQuality: 99,
      independentSources: 99,
      hasCategory: true,
      hasLocality: true,
      location: { kind: 'geocoded', confidence: 5 },
      newestEvidenceDate: '2026-11-01',
      hasAccessNotes: true,
      hasSafetyNotes: true,
      now,
    });
    expect(breakdown.source_quality).toBeLessThanOrEqual(WEIGHTS.source_quality);
    expect(breakdown.location).toBeLessThanOrEqual(WEIGHTS.location);
  });
});

// -- Pipeline with in-memory fakes ----------------------------------------------

function fakeRepo(jobs: ResearchJob[], config: Partial<WorkerConfig> = {}) {
  const state = {
    upserts: [] as CandidateUpsert[],
    events: [] as { level: string; code: string; details?: Record<string, unknown> }[],
    finished: [] as {
      id: string;
      ok: boolean;
      errorCode?: string;
      retryInSeconds?: number;
      cost?: Record<string, unknown>;
    }[],
    heartbeats: [] as string[],
    enqueued: [] as PlannedJob[],
  };
  const repo: Repository = {
    getConfig: async () => ({
      adapters: { web_search: true },
      domainRules: {},
      categorySlugs: CATEGORIES,
      ...config,
    }),
    enqueueJobs: async (planned) => {
      state.enqueued.push(...planned);
      return planned.length;
    },
    claimJob: async () => jobs.shift() ?? null,
    finishJob: async (id, result) => {
      state.finished.push({ id, ...result });
    },
    upsertCandidate: async (c) => {
      state.upserts.push(c);
      return { id: `cand-${state.upserts.length}`, wasNew: true, closed: false };
    },
    logEvent: async (_job, level, code, _message, details) => {
      state.events.push({ level, code, details });
    },
    heartbeat: async (_id, status) => {
      state.heartbeats.push(status);
    },
  };
  return { repo, state };
}

const job = (overrides: Partial<ResearchJob> = {}): ResearchJob => ({
  id: 'job-1',
  job_type: 'discovery',
  query: 'cafes in Assagao Goa',
  region: 'north',
  category_slug: 'cafe',
  source_adapter: 'web_search',
  attempt_count: 1,
  max_attempts: 3,
  payload: {},
  ...overrides,
});

const pageFor = (url: string, text: string) => ({
  ok: true as const,
  page: {
    url,
    host: new URL(url).hostname,
    title: 'Page',
    siteName: null,
    author: null,
    publishedAt: '2026-09-01',
    text,
  },
});

describe('discovery pipeline', () => {
  const search: SearchProvider = {
    name: 'fake',
    search: async () => [
      { url: 'https://www.instagram.com/reel/abc/', title: 'Reel', snippet: null },
      { url: 'https://goa-journal.test/cafes', title: 'Cafés', snippet: null },
      { url: 'https://casa-azul.test/', title: 'Casa Azul', snippet: null },
      { url: 'https://coast-blog.test/beaches', title: 'Beaches', snippet: null },
    ],
  };
  const fetched: string[] = [];
  const fetcher = {
    fetch: async (url: string) => {
      if (url.includes('instagram.com'))
        return { ok: false as const, reason: 'lead_only' as const };
      fetched.push(url);
      return pageFor(
        url,
        url.includes('coast-blog')
          ? 'Turtle Cove in Morjim is a turtle nesting site. Keep it a secret.'
          : 'Casa Azul in Assagao serves breakfast.',
      );
    },
  };
  const extractor: Extractor = {
    name: 'fake',
    extract: async (page) => ({
      usage: { inputTokens: 100, outputTokens: 20 },
      raw: {
        candidates: page.url.includes('coast-blog')
          ? [
              candidate({
                name: 'Turtle Cove',
                category_slug: 'beach',
                locality: 'Morjim',
                evidence_excerpt: 'Turtle Cove in Morjim',
              }),
            ]
          : page.url.includes('casa-azul')
            ? [
                candidate({
                  name: 'Casa Azul',
                  website_url: 'https://casa-azul.test/',
                  access_notes: 'On the main road.',
                  opening_hours_text: '8am to 4pm',
                }),
              ]
            : [candidate(), { name: '' }],
      },
    }),
  };

  it('stores candidates with evidence, merges the same place across pages, and never fetches Instagram', async () => {
    const { repo, state } = fakeRepo([job()]);
    const deps: PipelineDeps = {
      repo,
      search,
      fetcher,
      extractor,
      geocoder: createNoopGeocoder(),
      maxPagesPerJob: 5,
      now: () => new Date('2026-11-11T00:00:00Z'),
    };
    const summary = await runWorker(deps, { workerId: 'w', maxJobs: 3 });

    expect(summary).toEqual({ completed: 1, failed: 0, retried: 0 });
    expect(fetched).toEqual([
      'https://goa-journal.test/cafes',
      'https://casa-azul.test/',
      'https://coast-blog.test/beaches',
    ]);
    expect(state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: 'info', code: 'fetch_lead_only' }),
        expect.objectContaining({ level: 'warn', code: 'extraction_issues' }),
      ]),
    );

    expect(state.upserts).toHaveLength(2);
    const casa = state.upserts.find((u) => u.candidate_name === 'Casa Azul')!;
    expect(casa.dedupe_key).toBe('casa-azul|assagao');
    expect(casa.sources.map((s) => [s.source_type, s.source_quality])).toEqual([
      ['editorial', 3],
      ['official_business', 5],
    ]);
    expect(casa.extracted_fields).toMatchObject({
      access_notes: 'On the main road.',
      opening_hours_text: '8am to 4pm',
      coordinates_from: null,
    });
    expect(casa.lat).toBeNull();
    expect(casa.location_status).toBe('needs_review');
    expect(casa.confidence_breakdown.notes).toContain('2 independent publishers mention it.');
    expect(casa.risk_flags).toEqual([]);
    expect(casa.schema_version).toBe('1');

    const cove = state.upserts.find((u) => u.candidate_name === 'Turtle Cove')!;
    expect(
      cove.risk_flags
        .filter((f) => f.severity === 'block')
        .map((f) => f.code)
        .sort(),
    ).toEqual(['community_objection', 'sensitive_ecology']);

    expect(state.finished[0]).toMatchObject({ id: 'job-1', ok: true });
    expect(state.finished[0]!.cost).toMatchObject({
      pages_fetched: 3,
      pages_skipped: 1,
      candidates_stored: 2,
      candidates_blocked: 1,
      llm_input_tokens: 300,
    });
    expect(state.heartbeats).toEqual(['running', 'idle']);
  });

  it('exposes no way to publish: the repository contract has only worker operations', () => {
    const { repo } = fakeRepo([]);
    expect(Object.keys(repo).sort()).toEqual([
      'claimJob',
      'enqueueJobs',
      'finishJob',
      'getConfig',
      'heartbeat',
      'logEvent',
      'upsertCandidate',
    ]);
  });

  it('with the development stubs it runs cleanly and invents nothing', async () => {
    const { repo, state } = fakeRepo([job()]);
    const summary = await runWorker(
      {
        repo,
        search: createStubSearchProvider(),
        fetcher,
        extractor: createStubExtractor(),
        geocoder: createNoopGeocoder(),
        maxPagesPerJob: 3,
      },
      { workerId: 'w', maxJobs: 1 },
    );
    expect(summary.completed).toBe(1);
    expect(state.upserts).toEqual([]);
  });

  it('respects the page budget', async () => {
    const { repo, state } = fakeRepo([job()]);
    await runWorker(
      { repo, search, fetcher, extractor, geocoder: createNoopGeocoder(), maxPagesPerJob: 1 },
      { workerId: 'w', maxJobs: 1 },
    );
    expect(state.finished[0]!.cost).toMatchObject({ pages_fetched: 1 });
  });
});

describe('job runner failure handling', () => {
  const base = {
    fetcher: { fetch: async () => ({ ok: false as const, reason: 'http_error' as const }) },
    extractor: createStubExtractor(),
    geocoder: createNoopGeocoder(),
    maxPagesPerJob: 2,
  };

  it('retries a retryable provider error with backoff, logs it, and stops the run on quota exhaustion', async () => {
    const { repo, state } = fakeRepo([job(), job({ id: 'job-2' })]);
    const search: SearchProvider = {
      name: 'fake',
      search: async () => {
        throw new ProviderError('quota_exhausted', 'Quota reached', true);
      },
    };
    const summary = await runWorker({ ...base, repo, search }, { workerId: 'w', maxJobs: 5 });
    expect(summary).toEqual({ completed: 0, failed: 0, retried: 1 });
    expect(state.finished).toEqual([
      { id: 'job-1', ok: false, errorCode: 'provider_quota_exhausted', retryInSeconds: 300 },
    ]);
    expect(state.events[0]).toMatchObject({ level: 'error', code: 'provider_quota_exhausted' });
  });

  it('does not retry a non-retryable error or a job out of attempts', async () => {
    const { repo, state } = fakeRepo([job()]);
    const search: SearchProvider = {
      name: 'fake',
      search: async () => {
        throw new ProviderError('unauthorized', 'Key rejected', false);
      },
    };
    expect(await runWorker({ ...base, repo, search }, { workerId: 'w', maxJobs: 1 })).toMatchObject(
      { failed: 1, retried: 0 },
    );
    expect(state.finished[0]!.retryInSeconds).toBeUndefined();

    const second = fakeRepo([job({ attempt_count: 3 })]);
    const crashing: SearchProvider = {
      name: 'fake',
      search: async () => {
        throw new Error('boom');
      },
    };
    expect(
      await runWorker(
        { ...base, repo: second.repo, search: crashing },
        { workerId: 'w', maxJobs: 1 },
      ),
    ).toMatchObject({ failed: 1, retried: 0 });
    expect(second.state.finished[0]).toMatchObject({ errorCode: 'internal_error' });
  });

  it('honours the adapter kill switch and rejects unsupported job types', async () => {
    const disabled = fakeRepo([job()], { adapters: { web_search: false } });
    const search = createStubSearchProvider();
    await runWorker({ ...base, repo: disabled.repo, search }, { workerId: 'w', maxJobs: 1 });
    expect(disabled.state.finished[0]).toMatchObject({ ok: false, errorCode: 'adapter_disabled' });

    const other = fakeRepo([job({ job_type: 'freshness' })]);
    await runWorker({ ...base, repo: other.repo, search }, { workerId: 'w', maxJobs: 1 });
    expect(other.state.finished[0]).toMatchObject({ ok: false, errorCode: 'unsupported_job_type' });
  });

  it('backs off exponentially with a ceiling', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([300, 600, 1200, 2400]);
    expect(backoffSeconds(20)).toBe(21_600);
  });
});

describe('worker environment', () => {
  const base = {
    SUPABASE_URL: 'https://a.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    RESEARCH_CONTACT: 'research@example.test',
  };
  it('defaults to stubs and requires keys for real providers', () => {
    expect(loadEnv(base)).toMatchObject({
      SEARCH_PROVIDER: 'stub',
      LLM_PROVIDER: 'stub',
      GEOCODER: 'none',
      MAX_PAGES_PER_JOB: 4,
    });
    expect(() => loadEnv({ ...base, SEARCH_PROVIDER: 'brave' })).toThrow(/SEARCH_PROVIDER_API_KEY/);
    expect(() =>
      loadEnv({ ...base, LLM_PROVIDER: 'anthropic', LLM_PROVIDER_API_KEY: 'k' }),
    ).toThrow(/LLM_MODEL/);
    expect(() => loadEnv({ SUPABASE_URL: 'https://a.supabase.co' })).toThrow(/not valid/);
    expect(() => loadEnv({ ...base, MAX_PAGES_PER_JOB: '500' })).toThrow(/not valid/);
  });
});
