import type { ConfidenceBreakdown, ExtractedCandidate, Region, RiskFlag } from '@gupit/shared';

/** Provider-agnostic contracts. Swap an implementation without touching the pipeline. */

export interface SearchHit {
  url: string;
  title: string;
  snippet: string | null;
}

export interface SearchProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<SearchHit[]>;
}

export interface FetchedPage {
  url: string;
  host: string;
  title: string | null;
  siteName: string | null;
  author: string | null;
  publishedAt: string | null;
  /** Visible text only, truncated. Used for extraction and then discarded: never stored. */
  text: string;
}

export type FetchOutcome =
  | { ok: true; page: FetchedPage }
  | {
      ok: false;
      reason:
        | 'policy_block'
        | 'lead_only'
        | 'robots_disallow'
        | 'access_restricted'
        | 'not_html'
        | 'too_large'
        | 'http_error'
        | 'network_error';
      detail?: string;
    };

export interface PageFetcher {
  fetch(url: string): Promise<FetchOutcome>;
}

export interface ExtractionContext {
  query: string | null;
  region: Region | null;
  categorySlug: string | null;
  allowedCategorySlugs: string[];
}

export interface ExtractionOutput {
  /** Raw model output. Always validated by `sanitizeExtraction` before use. */
  raw: unknown;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export interface Extractor {
  readonly name: string;
  extract(page: FetchedPage, context: ExtractionContext): Promise<ExtractionOutput>;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** 0 to 1. How sure the provider is that this is the named place. */
  confidence: number;
  provider: string;
}

export interface Geocoder {
  readonly name: string;
  geocode(input: { name: string; locality: string | null }): Promise<GeocodeResult | null>;
}

export type DomainRule = 'allow' | 'block' | 'lead_only';

export interface WorkerConfig {
  adapters: Record<string, boolean>;
  domainRules: Record<string, DomainRule>;
  categorySlugs: string[];
}

export interface ResearchJob {
  id: string;
  job_type: 'discovery' | 'lead' | 'freshness';
  query: string | null;
  region: Region | null;
  category_slug: string | null;
  source_adapter: string;
  attempt_count: number;
  max_attempts: number;
  payload: Record<string, unknown>;
}

export interface CandidateSource {
  source_type: 'official_business' | 'editorial' | 'tourism_public' | 'directory';
  source_url: string;
  source_title: string | null;
  publisher: string | null;
  author: string | null;
  published_at: string | null;
  evidence_excerpt: string | null;
  claims_supported: string[];
  source_quality: number;
}

export interface CandidateUpsert {
  candidate_name: string;
  dedupe_key: string;
  aliases: string[];
  proposed_category_slug: string | null;
  proposed_labels: string[];
  proposed_region: Region | null;
  proposed_locality: string | null;
  lat: number | null;
  lng: number | null;
  location_confidence: number | null;
  location_status: 'approximate' | 'needs_review';
  extracted_fields: Record<string, unknown>;
  schema_version: string;
  prompt_version: string;
  confidence_score: number;
  confidence_breakdown: ConfidenceBreakdown;
  risk_flags: RiskFlag[];
  sources: CandidateSource[];
}

/**
 * Everything the worker may do to the database. Note what is absent: there is no method
 * that creates, edits or publishes a spot. The worker's database role cannot call one either.
 */
export interface Repository {
  getConfig(): Promise<WorkerConfig>;
  enqueueJobs(jobs: PlannedJob[]): Promise<number>;
  claimJob(workerId: string): Promise<ResearchJob | null>;
  finishJob(
    jobId: string,
    result: {
      ok: boolean;
      errorCode?: string;
      cost?: Record<string, unknown>;
      retryInSeconds?: number;
    },
  ): Promise<void>;
  upsertCandidate(
    candidate: CandidateUpsert,
  ): Promise<{ id: string; wasNew: boolean; closed: boolean }>;
  logEvent(
    jobId: string | null,
    level: 'info' | 'warn' | 'error',
    code: string,
    message?: string,
    details?: Record<string, unknown>,
  ): Promise<void>;
  heartbeat(workerId: string, status: string, details?: Record<string, unknown>): Promise<void>;
}

export interface PlannedJob {
  job_type: 'discovery';
  query: string;
  region: Region;
  category_slug: string;
  source_adapter: 'web_search';
  idempotency_key: string;
}

export type { ExtractedCandidate };
