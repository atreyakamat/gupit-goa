import type { ConfidenceBreakdown, RiskFlag } from '@gupit/shared';
import { getSupabase } from '@/lib/supabase';

/**
 * Admin data access. Reads go through RLS (admins only); every write goes through an
 * `admin_*` RPC that re-checks the allowlist and writes the audit log.
 */
export class AdminError extends Error {}

/** Turns server error codes into something a reviewer can act on. */
export function adminErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const known: Record<string, string> = {
    admin_required: 'Your account is not on the reviewer list.',
    reason_required: 'Give a reason for this action.',
    reason_required_for_safety_edit:
      'This changes safety or access details on a live listing. Add a reason.',
    coordinates_outside_goa: 'Those coordinates are outside Goa. Check latitude and longitude.',
    invalid_coordinates: 'Latitude or longitude is not valid.',
    unknown_category: 'Pick a category from the list.',
    name_and_category_required: 'A name and a category are required.',
    source_domain_blocked: 'That site is on the blocked list and cannot be used as a source.',
    invalid_url: 'Enter a full link starting with https://',
    note_required: 'Add a note explaining the decision.',
    candidate_already_closed: 'This candidate has already been decided.',
  };
  for (const [code, text] of Object.entries(known)) if (message.includes(code)) return text;
  return message;
}

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new AdminError(error.message);
  return data as T;
}

// The Supabase query builder's generic types depend on a generated schema we do not ship yet,
// so the builder callback is loosely typed here and each caller declares its row type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

async function rows<T>(table: string, columns: string, build?: (q: Query) => Query): Promise<T[]> {
  let query = getSupabase().from(table).select(columns);
  if (build) query = build(query);
  const { data, error } = await query;
  if (error) throw new AdminError(error.message);
  return (data ?? []) as T[];
}

export interface Dashboard {
  candidates: Record<string, number>;
  spots: Record<string, number>;
  open_user_reports: number;
  high_priority_reports: number;
  active_partners: number;
  jobs: Record<string, number>;
  research_errors_24h: number;
  workers: { worker_id: string; last_seen_at: string; status: string }[];
  stale_listings: number;
}

export interface CandidateRow {
  id: string;
  candidate_name: string;
  proposed_category_slug: string | null;
  proposed_locality: string | null;
  proposed_region: string | null;
  confidence_score: number | null;
  review_status: string;
  risk_flags: RiskFlag[];
  discovered_by: string;
  created_at: string;
}

export interface SourceRow {
  id: string;
  source_type: string;
  source_url: string | null;
  source_title: string | null;
  publisher: string | null;
  evidence_excerpt: string | null;
  claims_supported: string[];
  source_quality: number | null;
  rights_notes: string | null;
  verification_status: string;
  is_public: boolean;
}

export interface CandidateDetail extends CandidateRow {
  aliases: string[];
  proposed_labels: string[];
  lat: number | null;
  lng: number | null;
  location_confidence: number | null;
  location_status: string;
  extracted_fields: Record<string, unknown>;
  confidence_breakdown: ConfidenceBreakdown | null;
  review_notes: string | null;
  approved_spot_id: string | null;
  sources: SourceRow[];
  cluster: {
    id: string;
    candidate_name: string;
    proposed_locality: string | null;
    review_status: string;
  }[];
  possible_duplicate_spot: {
    id: string;
    name: string;
    locality: string | null;
    verification_status: string;
  } | null;
}

export interface SpotRow {
  id: string;
  name: string;
  locality: string | null;
  region: string | null;
  verification_status: string;
  availability_status: string;
  safety_blocked: boolean;
  last_verified_at: string | null;
  updated_at: string;
}

export interface MediaRow {
  id: string;
  storage_path: string;
  thumb_path: string | null;
  alt_text: string | null;
  rights_status: string;
  rights_evidence_url: string | null;
  credit_line: string | null;
}

export interface PartnerRow {
  id: string;
  business_name: string;
  spot_id: string;
  whatsapp_number: string;
  website_url: string | null;
  partner_status: string;
  plan: string | null;
  starts_at: string;
  ends_at: string | null;
  label_text: string;
}

export interface ChecklistItem {
  code: string;
  label: string;
  ok: boolean;
}

export interface SpotEditorData {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  short_description: string | null;
  description: string | null;
  primary_category_slug: string;
  discovery_labels: string[];
  region: string | null;
  locality: string | null;
  address_text: string | null;
  lat: number | null;
  lng: number | null;
  location_precision: string;
  public_access_status: string;
  price_band: string | null;
  best_time: string | null;
  parking_info: string | null;
  opening_hours: { text?: string | null; verified_at?: string | null } | null;
  safety_tags: string[];
  respect_tags: string[];
  safety_notes: string | null;
  respect_notes: string | null;
  access_notes: string | null;
  verified_attributes: string[];
  search_tags: string[];
  crowd_guide: { note?: string | null } | null;
  verification_status: string;
  availability_status: string;
  safety_blocked: boolean;
  safety_block_reason: string | null;
  safety_reviewed_at: string | null;
  verification_method: string | null;
  last_verified_at: string | null;
  internal_notes: string | null;
  media: MediaRow[];
  sources: SourceRow[];
  partners: PartnerRow[];
  checklist: ChecklistItem[];
}

export interface UserReportRow {
  id: string;
  spot_id: string;
  report_type: string;
  message: string | null;
  priority: string;
  status: string;
  created_at: string;
  spots: { name: string } | null;
}

export interface AuditRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  reason: string | null;
  created_at: string;
  actor_user_id: string | null;
}

export const adminApi = {
  dashboard: () => call<Dashboard>('admin_dashboard'),
  analytics: (days: number) =>
    call<Record<string, unknown>>('admin_analytics_summary', { p_days: days }),

  candidates: (status: string | null) =>
    rows<CandidateRow>(
      'spot_candidates',
      'id, candidate_name, proposed_category_slug, proposed_locality, proposed_region, confidence_score, review_status, risk_flags, discovered_by, created_at',
      (q) =>
        (status ? q.eq('review_status', status) : q)
          .order('confidence_score', { ascending: false, nullsFirst: false })
          .limit(100),
    ),
  candidate: (id: string) => call<CandidateDetail>('admin_get_candidate', { p_id: id }),
  saveCandidate: (id: string | null, data: Record<string, unknown>) =>
    call<string>('admin_save_candidate', { p_id: id, p_data: data }),
  addLead: (name: string, url: string | null, note: string | null) =>
    call<string>('admin_add_lead', { p_name: name, p_url: url, p_note: note }),
  flagCandidate: (
    id: string,
    code: string,
    action: 'add' | 'resolve',
    note: string,
    severity: 'block' | 'warn' = 'block',
  ) =>
    call<{ open_blocks: number }>('admin_flag_candidate', {
      p_id: id,
      p_code: code,
      p_action: action,
      p_note: note,
      p_severity: severity,
    }),
  decideCandidate: (
    id: string,
    decision: string,
    notes: string | null,
    merge?: { candidate?: string; spot?: string },
  ) =>
    call<{ ok: boolean; spot_id?: string | null; reason?: string }>('admin_decide_candidate', {
      p_id: id,
      p_decision: decision,
      p_notes: notes,
      p_merge_into_candidate: merge?.candidate ?? null,
      p_merge_into_spot: merge?.spot ?? null,
    }),

  spots: (status: string | null) =>
    rows<SpotRow>(
      'spots',
      'id, name, locality, region, verification_status, availability_status, safety_blocked, last_verified_at, updated_at',
      (q) =>
        (status ? q.eq('verification_status', status) : q)
          .order('updated_at', { ascending: false })
          .limit(200),
    ),
  spot: (id: string) => call<SpotEditorData>('admin_get_spot', { p_id: id }),
  saveSpot: (id: string | null, data: Record<string, unknown>, reason: string | null) =>
    call<string>('admin_save_spot', { p_id: id, p_data: data, p_reason: reason }),
  setSpotStatus: (id: string, action: string, reason: string | null) =>
    call<{ ok: boolean; missing?: ChecklistItem[]; reason?: string }>('admin_set_spot_status', {
      p_id: id,
      p_action: action,
      p_reason: reason,
    }),

  saveMedia: (id: string | null, spotId: string, data: Record<string, unknown>) =>
    call<string>('admin_save_media', { p_id: id, p_spot_id: spotId, p_data: data }),
  deleteMedia: (id: string) =>
    call<{ storage_path: string; thumb_path: string | null }>('admin_delete_media', { p_id: id }),
  reorderMedia: (spotId: string, ids: string[]) =>
    call<null>('admin_reorder_media', { p_spot_id: spotId, p_ids: ids }),
  saveSource: (id: string | null, data: Record<string, unknown>) =>
    call<string>('admin_save_source', { p_id: id, p_data: data }),
  deleteSource: (id: string) => call<null>('admin_delete_source', { p_id: id }),

  partners: () =>
    rows<PartnerRow & { spots: { name: string } | null }>(
      'partners',
      'id, business_name, spot_id, whatsapp_number, website_url, partner_status, plan, starts_at, ends_at, label_text, spots(name)',
      (q) => q.order('starts_at', { ascending: false }),
    ),
  savePartner: (id: string | null, data: Record<string, unknown>) =>
    call<string>('admin_save_partner', { p_id: id, p_data: data }),
  issueClaimCode: (partnerId: string) =>
    call<{ claim_code: string; expires_at: string }>('admin_issue_partner_claim_code', {
      p_partner_id: partnerId,
    }),

  userReports: (openOnly: boolean) =>
    rows<UserReportRow>(
      'user_reports',
      'id, spot_id, report_type, message, priority, status, created_at, spots(name)',
      (q) =>
        (openOnly ? q.in('status', ['open', 'in_review']) : q)
          .order('priority', { ascending: true })
          .order('created_at', { ascending: false })
          .limit(100),
    ),
  resolveUserReport: (id: string, status: string, note: string | null) =>
    call<null>('admin_resolve_user_report', { p_id: id, p_status: status, p_note: note }),

  audit: () =>
    rows<AuditRow>(
      'admin_audit_logs',
      'id, action, entity_type, entity_id, reason, created_at, actor_user_id',
      (q) => q.order('id', { ascending: false }).limit(150),
    ),

  adapters: () =>
    rows<{ adapter: string; is_enabled: boolean; notes: string | null }>(
      'research_adapters',
      'adapter, is_enabled, notes',
    ),
  setAdapter: (adapter: string, enabled: boolean, note: string | null) =>
    call<null>('admin_set_research_adapter', {
      p_adapter: adapter,
      p_enabled: enabled,
      p_note: note,
    }),
  domainRules: () =>
    rows<{ domain: string; rule: string; reason: string | null }>(
      'research_domain_rules',
      'domain, rule, reason',
      (q) => q.order('domain'),
    ),
  setDomainRule: (domain: string, rule: string, reason: string | null) =>
    call<null>('admin_set_domain_rule', { p_domain: domain, p_rule: rule, p_reason: reason }),
  enqueueJob: (query: string, region: string | null, categorySlug: string | null) =>
    call<string | null>('admin_enqueue_research_job', {
      p_query: query,
      p_region: region,
      p_category_slug: categorySlug,
    }),
  jobs: () =>
    rows<{
      id: string;
      query: string | null;
      status: string;
      attempt_count: number;
      error_code: string | null;
      created_at: string;
    }>('research_jobs', 'id, query, status, attempt_count, error_code, created_at', (q) =>
      q.order('created_at', { ascending: false }).limit(40),
    ),
  researchEvents: () =>
    rows<{ id: number; level: string; code: string; message: string | null; created_at: string }>(
      'research_events',
      'id, level, code, message, created_at',
      (q) => q.in('level', ['warn', 'error']).order('id', { ascending: false }).limit(40),
    ),
};
