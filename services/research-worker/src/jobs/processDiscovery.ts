import { EXTRACTION_SCHEMA_VERSION, type ExtractedCandidate, type RiskFlag } from '@gupit/shared';
import { dedupeKey } from '../deduplication/dedupe';
import { PROMPT_VERSION } from '../extraction/prompt';
import { sanitizeExtraction } from '../extraction/sanitize';
import { hostOf } from '../policy/domains';
import { screenCandidate } from '../safety/rules';
import { scoreCandidate } from '../scoring/confidence';
import type {
  CandidateSource,
  CandidateUpsert,
  Extractor,
  FetchedPage,
  Geocoder,
  PageFetcher,
  Repository,
  ResearchJob,
  SearchProvider,
  WorkerConfig,
} from '../types';

export interface PipelineDeps {
  repo: Repository;
  search: SearchProvider;
  fetcher: PageFetcher;
  extractor: Extractor;
  geocoder: Geocoder;
  maxPagesPerJob: number;
  now?: () => Date;
}

const PUBLIC_AUTHORITY =
  /(^|\.)(gov\.in|nic\.in|goa-tourism\.com|goatourism\.gov\.in|asi\.nic\.in|incredibleindia\.gov\.in)$/;

function classifySource(
  page: FetchedPage,
  candidate: ExtractedCandidate,
): Pick<CandidateSource, 'source_type' | 'source_quality'> {
  if (PUBLIC_AUTHORITY.test(page.host)) return { source_type: 'tourism_public', source_quality: 5 };
  const own = candidate.website_url ? hostOf(candidate.website_url) : null;
  if (own && own === page.host) return { source_type: 'official_business', source_quality: 5 };
  return { source_type: 'editorial', source_quality: 3 };
}

interface Draft {
  candidate: ExtractedCandidate;
  sources: CandidateSource[];
  flags: RiskFlag[];
}

/** Later pages fill gaps but never overwrite what an earlier page stated. */
function mergeInto(target: ExtractedCandidate, next: ExtractedCandidate): void {
  for (const key of Object.keys(next) as (keyof ExtractedCandidate)[]) {
    const current = target[key];
    const incoming = next[key];
    if (Array.isArray(current) && Array.isArray(incoming)) {
      (target[key] as unknown[]) = [...new Set([...current, ...incoming])];
    } else if (current == null && incoming != null) {
      (target[key] as unknown) = incoming;
    }
  }
  if (next.name !== target.name && !target.aliases.includes(next.name))
    target.aliases.push(next.name);
}

function mergeFlags(existing: RiskFlag[], incoming: RiskFlag[]): RiskFlag[] {
  const out = [...existing];
  for (const flag of incoming) {
    if (!out.some((f) => f.code === flag.code && f.note === flag.note)) out.push(flag);
  }
  return out;
}

/**
 * One discovery job: search, fetch the permitted pages, extract, validate, screen, score
 * and store candidates with their evidence. Search results are leads, not facts, and
 * nothing here can publish.
 */
export async function processDiscoveryJob(
  job: ResearchJob,
  deps: PipelineDeps,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const { repo, search, fetcher, extractor, geocoder } = deps;
  if (!job.query) throw new Error('discovery job has no query');

  const hits = await search.search(job.query, deps.maxPagesPerJob * 2);
  const cost = {
    search_provider: search.name,
    extractor: extractor.name,
    search_hits: hits.length,
    pages_fetched: 0,
    pages_skipped: 0,
    llm_input_tokens: 0,
    llm_output_tokens: 0,
    candidates_stored: 0,
    candidates_blocked: 0,
  };
  const drafts = new Map<string, Draft>();

  for (const hit of hits) {
    if (cost.pages_fetched >= deps.maxPagesPerJob) break;
    const outcome = await fetcher.fetch(hit.url);
    if (!outcome.ok) {
      cost.pages_skipped += 1;
      // Policy skips are expected and logged for visibility; they are never retried or worked around.
      await repo.logEvent(
        job.id,
        outcome.reason === 'lead_only' ? 'info' : 'warn',
        `fetch_${outcome.reason}`,
        undefined,
        { host: hostOf(hit.url), detail: outcome.detail ?? null },
      );
      continue;
    }
    cost.pages_fetched += 1;
    const page = outcome.page;

    const output = await extractor.extract(page, {
      query: job.query,
      region: job.region,
      categorySlug: job.category_slug,
      allowedCategorySlugs: config.categorySlugs,
    });
    cost.llm_input_tokens += output.usage?.inputTokens ?? 0;
    cost.llm_output_tokens += output.usage?.outputTokens ?? 0;

    const { candidates, issues } = sanitizeExtraction(output.raw, config.categorySlugs);
    if (issues.length)
      await repo.logEvent(job.id, 'warn', 'extraction_issues', undefined, {
        host: page.host,
        issues: issues.slice(0, 20),
      });

    for (const candidate of candidates) {
      const source: CandidateSource = {
        ...classifySource(page, candidate),
        source_url: page.url,
        source_title: page.title,
        publisher: page.siteName ?? page.host,
        author: page.author,
        published_at: page.publishedAt,
        evidence_excerpt: candidate.evidence_excerpt,
        claims_supported: candidate.claims_supported,
      };
      const flags = screenCandidate(candidate, page.text);
      const key = dedupeKey(candidate.name, candidate.locality);
      const existing = drafts.get(key);
      if (existing) {
        mergeInto(existing.candidate, candidate);
        existing.sources.push(source);
        existing.flags = mergeFlags(existing.flags, flags);
      } else {
        drafts.set(key, {
          candidate: { ...candidate, aliases: [...candidate.aliases] },
          sources: [source],
          flags,
        });
      }
    }
  }

  for (const [key, draft] of drafts) {
    const c = draft.candidate;
    let lat = c.stated_lat;
    let lng = c.stated_lng;
    let locationConfidence: number | null = lat != null ? 0.8 : null;
    let geocodedBy: string | null = null;
    let location: Parameters<typeof scoreCandidate>[0]['location'] =
      lat != null ? { kind: 'stated' } : { kind: 'none' };

    // Geocode only once the place has an identity (name + locality). Never from a locality alone.
    if (lat == null && c.locality) {
      const geo = await geocoder.geocode({ name: c.name, locality: c.locality });
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
        locationConfidence = geo.confidence;
        geocodedBy = geo.provider;
        location = { kind: 'geocoded', confidence: geo.confidence };
      }
    }

    const dates = draft.sources
      .map((s) => s.published_at)
      .filter((d): d is string => Boolean(d))
      .sort();
    const { total, breakdown } = scoreCandidate({
      bestSourceQuality: Math.max(...draft.sources.map((s) => s.source_quality)),
      independentSources: new Set(draft.sources.map((s) => hostOf(s.source_url))).size,
      hasCategory: c.category_slug != null,
      hasLocality: c.locality != null,
      location,
      newestEvidenceDate: dates[dates.length - 1] ?? null,
      hasAccessNotes: c.access_notes != null,
      hasSafetyNotes: c.safety_notes != null,
      now: deps.now?.(),
    });

    const upsert: CandidateUpsert = {
      candidate_name: c.name,
      dedupe_key: key,
      aliases: c.aliases,
      proposed_category_slug: c.category_slug,
      proposed_labels: c.positioning,
      proposed_region: c.region,
      proposed_locality: c.locality,
      lat,
      lng: lat != null ? lng : null,
      location_confidence: locationConfidence,
      location_status: lat != null ? 'approximate' : 'needs_review',
      extracted_fields: {
        description_draft: c.description_draft,
        address_text: c.address_text,
        best_time: c.best_time,
        visit_duration: c.visit_duration,
        price_band: c.price_band,
        access_notes: c.access_notes,
        parking_info: c.parking_info,
        opening_hours_text: c.opening_hours_text,
        contact_phone: c.contact_phone,
        website_url: c.website_url,
        crowd_notes: c.crowd_notes,
        safety_notes: c.safety_notes,
        respect_notes: c.respect_notes,
        positioning_reason: c.positioning_reason,
        secondary_category_slugs: c.secondary_category_slugs,
        coordinates_from:
          lat == null ? null : geocodedBy ? `geocoder:${geocodedBy}` : 'stated_by_source',
        discovered_by_query: job.query,
      },
      schema_version: EXTRACTION_SCHEMA_VERSION,
      prompt_version: PROMPT_VERSION,
      confidence_score: total,
      confidence_breakdown: breakdown,
      risk_flags: draft.flags,
      sources: draft.sources,
    };
    await repo.upsertCandidate(upsert);
    cost.candidates_stored += 1;
    if (draft.flags.some((f) => f.severity === 'block')) cost.candidates_blocked += 1;
  }

  return cost;
}
