-- Research pipeline, crowd reports, user reports, partner enquiries, analytics and audit log.

-- ---------------------------------------------------------------------------
-- Research candidates: agent or manual output awaiting a human decision.
-- A candidate is never a public listing.
-- ---------------------------------------------------------------------------
create table public.spot_candidates (
  id uuid primary key default gen_random_uuid(),
  candidate_name text not null check (char_length(candidate_name) between 1 and 160),
  normalized_name text not null default '',
  aliases text[] not null default '{}',
  proposed_category_slug text,
  proposed_labels text[] not null default '{}'
    check (proposed_labels <@ array['iconic', 'popular', 'lesser_known', 'local_favourite']),
  proposed_region text check (proposed_region in ('north', 'central', 'south', 'inland')),
  proposed_locality text,
  proposed_location extensions.geography (Point, 4326),
  location_confidence numeric(3, 2) check (location_confidence between 0 and 1),
  location_status text not null default 'needs_review'
    check (location_status in ('confirmed', 'approximate', 'needs_review')),
  extracted_fields jsonb not null default '{}',
  schema_version text,
  prompt_version text,
  confidence_score integer check (confidence_score between 0 and 100),
  confidence_breakdown jsonb,
  -- [{ code, severity: block|warn, source: deterministic|llm|human, note, resolved_at, resolved_by, resolution_note }]
  risk_flags jsonb not null default '[]',
  duplicate_cluster_id uuid,
  possible_duplicate_spot_id uuid references public.spots (id) on delete set null,
  review_status text not null default 'new'
    check (review_status in
      ('new', 'needs_more_evidence', 'ready_for_review', 'approved', 'rejected', 'merged', 'blocked')),
  approved_spot_id uuid references public.spots (id) on delete set null,
  merged_into_candidate_id uuid references public.spot_candidates (id) on delete set null,
  reviewer_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  dedupe_key text unique,
  discovered_by text not null default 'research_worker'
    check (discovered_by in ('research_worker', 'manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index spot_candidates_status_idx on public.spot_candidates (review_status, confidence_score desc);
create index spot_candidates_name_trgm_idx
  on public.spot_candidates using gin (normalized_name extensions.gin_trgm_ops);
create index spot_candidates_location_gix on public.spot_candidates using gist (proposed_location);

create function private.candidates_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.normalized_name := trim(regexp_replace(private.normalize_text(new.candidate_name), '[^a-z0-9]+', ' ', 'g'));
  new.updated_at := now();
  return new;
end;
$$;

create trigger spot_candidates_before_write
before insert or update on public.spot_candidates
for each row execute function private.candidates_before_write();

-- ---------------------------------------------------------------------------
-- Source evidence for a candidate and/or a published spot.
-- Short excerpts and links only; never article bodies or copied media.
-- ---------------------------------------------------------------------------
create table public.spot_sources (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid references public.spots (id) on delete cascade,
  candidate_id uuid references public.spot_candidates (id) on delete cascade,
  source_type text not null
    check (source_type in
      ('official_business', 'editorial', 'tourism_public', 'directory', 'social_lead',
       'local_knowledge', 'team_visit')),
  source_url text check (source_url is null or source_url ~* '^https?://'),
  source_title text,
  publisher text,
  author text,
  published_at date,
  discovered_at timestamptz not null default now(),
  checked_at timestamptz,
  evidence_excerpt text check (char_length(evidence_excerpt) <= 500),
  claims_supported text[] not null default '{}',
  source_quality smallint check (source_quality between 1 and 5),
  attribution text,
  rights_notes text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'conflicting', 'rejected')),
  -- Shown on the public place page as "Sources" only when true and verified.
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  check (spot_id is not null or candidate_id is not null)
);
create index spot_sources_spot_idx on public.spot_sources (spot_id);
create index spot_sources_candidate_idx on public.spot_sources (candidate_id);
create unique index spot_sources_candidate_url_uidx
  on public.spot_sources (candidate_id, source_url)
  where candidate_id is not null and source_url is not null;

-- ---------------------------------------------------------------------------
-- Research jobs, adapter kill switches, domain rules, worker health and logs
-- ---------------------------------------------------------------------------
create table public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type in ('discovery', 'lead', 'freshness')),
  query text,
  region text check (region in ('north', 'central', 'south', 'inland')),
  category_id uuid references public.categories (id) on delete set null,
  source_adapter text not null,
  payload jsonb not null default '{}',
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'paused')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  idempotency_key text not null unique,
  run_after timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  cost_metadata jsonb,
  claimed_by text,
  created_at timestamptz not null default now()
);
create index research_jobs_queue_idx on public.research_jobs (status, run_after);

create table public.research_adapters (
  adapter text primary key,
  is_enabled boolean not null default true,
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.research_adapters is
  'Per-adapter kill switch. A disabled adapter''s jobs are not claimed by the worker.';

insert into public.research_adapters (adapter, notes) values
  ('web_search', 'Search-provider leads followed by a policy-checked page fetch.'),
  ('manual_lead', 'A URL or tip added by a reviewer. No automated collection from the source site.');

create table public.research_domain_rules (
  domain text primary key check (domain = lower(domain)),
  rule text not null check (rule in ('allow', 'block', 'lead_only')),
  reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
comment on table public.research_domain_rules is
  'lead_only: the URL may be stored as a lead but the worker never fetches the page. block: never used.';

insert into public.research_domain_rules (domain, rule, reason) values
  ('instagram.com', 'lead_only', 'Meta terms: no automated collection without written permission.'),
  ('facebook.com', 'lead_only', 'Meta terms: no automated collection without written permission.'),
  ('threads.net', 'lead_only', 'Meta terms: no automated collection without written permission.'),
  ('tiktok.com', 'lead_only', 'No permitted interface configured.'),
  ('youtube.com', 'lead_only', 'Only through a permitted API; none configured.'),
  ('x.com', 'lead_only', 'No permitted interface configured.'),
  ('twitter.com', 'lead_only', 'No permitted interface configured.'),
  ('google.com', 'block', 'Places/Maps data has storage and display restrictions.'),
  ('tripadvisor.com', 'block', 'Terms prohibit automated access.'),
  ('tripadvisor.in', 'block', 'Terms prohibit automated access.'),
  ('zomato.com', 'block', 'Terms prohibit automated access.');

create table public.worker_heartbeats (
  worker_id text primary key,
  last_seen_at timestamptz not null default now(),
  status text not null default 'idle',
  details jsonb not null default '{}'
);

create table public.research_events (
  id bigint generated always as identity primary key,
  job_id uuid references public.research_jobs (id) on delete cascade,
  level text not null check (level in ('info', 'warn', 'error')),
  code text not null,
  message text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index research_events_created_idx on public.research_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Crowd reports. Coordinates are validated in memory and never stored.
-- ---------------------------------------------------------------------------
create table public.crowd_reports (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  crowd_level smallint not null check (crowd_level between 1 and 3),
  installation_hash text not null,
  reported_at timestamptz not null default now(),
  validation_method text not null default 'server_geofence_300m',
  is_valid boolean not null,
  rejection_reason text check (rejection_reason in ('too_far', 'partner_device')),
  check (is_valid = (rejection_reason is null))
);
create index crowd_reports_live_idx on public.crowd_reports (spot_id, reported_at desc) where is_valid;
create index crowd_reports_installation_idx on public.crowd_reports (installation_hash, reported_at desc);
comment on table public.crowd_reports is
  'Raw reports are kept for 30 days for aggregation and abuse review, then purged by private.purge_old_crowd_reports().';

-- Long-lived aggregate that survives the raw-report purge. No installation data.
create table public.crowd_hourly_stats (
  spot_id uuid not null references public.spots (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  hour_of_day smallint not null check (hour_of_day between 0 and 23),
  report_count integer not null default 0,
  level_sum integer not null default 0,
  primary key (spot_id, day_of_week, hour_of_day)
);

create function private.purge_old_crowd_reports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.crowd_reports where reported_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- User problem reports (no public comments)
-- ---------------------------------------------------------------------------
create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  report_type text not null
    check (report_type in ('closed', 'unsafe', 'wrong_pin', 'wrong_hours', 'private_access', 'other')),
  message text check (char_length(message) <= 1000),
  installation_hash text,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  resolution_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index user_reports_status_idx on public.user_reports (status, priority, created_at desc);

-- ---------------------------------------------------------------------------
-- Analytics (first-party, privacy-safe) and partner enquiry intent
-- ---------------------------------------------------------------------------
create table public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null
    check (name in (
      'app_opened', 'explore_viewed', 'map_viewed', 'list_viewed', 'filter_applied',
      'search_submitted', 'spot_opened', 'spot_saved', 'spot_unsaved', 'directions_opened',
      'share_opened', 'crowd_report_submitted', 'alternatives_opened', 'partner_profile_opened',
      'partner_whatsapp_tapped', 'problem_report_submitted')),
  props jsonb not null default '{}',
  session_id text check (char_length(session_id) <= 64),
  platform text check (platform in ('android', 'ios')),
  app_version text check (char_length(app_version) <= 32),
  created_at timestamptz not null default now()
);
create index analytics_events_name_created_idx on public.analytics_events (name, created_at desc);

create table public.partner_enquiries (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  spot_id uuid not null references public.spots (id) on delete cascade,
  event_id bigint references public.analytics_events (id) on delete set null,
  source_surface text not null check (source_surface in ('spot_detail', 'map_card', 'list_card', 'search')),
  campaign_id text,
  anonymous_session_id text check (char_length(anonymous_session_id) <= 64),
  created_at timestamptz not null default now()
);
create index partner_enquiries_partner_idx on public.partner_enquiries (partner_id, created_at desc);
comment on table public.partner_enquiries is
  'A WhatsApp tap is enquiry intent only. It is not a confirmed enquiry, booking or sale.';

-- ---------------------------------------------------------------------------
-- Admin audit log. Server-side writes only.
-- ---------------------------------------------------------------------------
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_entity_idx on public.admin_audit_logs (entity_type, entity_id, created_at desc);
create index admin_audit_logs_created_idx on public.admin_audit_logs (created_at desc);

create function private.audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb,
  p_reason text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_logs
    (actor_user_id, action, entity_type, entity_id, before_snapshot, after_snapshot, reason)
  values ((select auth.uid()), p_action, p_entity_type, p_entity_id, p_before, p_after, p_reason);
$$;
