-- Research worker API. Granted to service_role only (see the security migration).
-- Nothing here can create, edit or publish a spot: the worker only writes candidates,
-- evidence, job state and logs.

create function public.worker_get_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'adapters', coalesce((select jsonb_object_agg(a.adapter, a.is_enabled) from public.research_adapters a), '{}'::jsonb),
    'domain_rules', coalesce((select jsonb_object_agg(r.domain, r.rule) from public.research_domain_rules r), '{}'::jsonb),
    'category_slugs', coalesce((select jsonb_agg(c.slug order by c.slug) from public.categories c
                                 where c.parent_id is not null and c.is_active), '[]'::jsonb));
$$;

create function public.worker_enqueue_jobs(p_jobs jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) > 200 then
    raise exception 'invalid_jobs' using errcode = '22023';
  end if;
  insert into public.research_jobs
    (job_type, query, region, category_id, source_adapter, payload, idempotency_key, max_attempts)
  select coalesce(j ->> 'job_type', 'discovery'), j ->> 'query', j ->> 'region',
         (select c.id from public.categories c where c.slug = j ->> 'category_slug'),
         coalesce(j ->> 'source_adapter', 'web_search'), coalesce(j -> 'payload', '{}'::jsonb),
         j ->> 'idempotency_key', coalesce((j ->> 'max_attempts')::integer, 3)
  from jsonb_array_elements(p_jobs) j
  on conflict (idempotency_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Claims one queued job whose adapter is enabled. SKIP LOCKED makes this safe with several workers.
create function public.worker_claim_job(p_worker_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.research_jobs;
begin
  -- Recover jobs left running by a crashed worker.
  update public.research_jobs j set
    status = case when j.attempt_count >= j.max_attempts then 'failed' else 'queued' end,
    error_code = 'worker_timeout',
    completed_at = case when j.attempt_count >= j.max_attempts then now() end
  where j.status = 'running' and j.started_at < now() - interval '30 minutes';

  update public.research_jobs j set
    status = 'running', attempt_count = j.attempt_count + 1, started_at = now(),
    completed_at = null, error_code = null, claimed_by = left(p_worker_id, 64)
  where j.id = (
    select q.id
    from public.research_jobs q
    join public.research_adapters a on a.adapter = q.source_adapter and a.is_enabled
    where q.status = 'queued' and q.run_after <= now()
    order by q.run_after, q.created_at
    for update of q skip locked
    limit 1)
  returning * into v_job;

  if v_job.id is null then
    return null;
  end if;
  return to_jsonb(v_job) || jsonb_build_object(
    'category_slug', (select c.slug from public.categories c where c.id = v_job.category_id));
end;
$$;

create function public.worker_finish_job(
  p_job_id uuid,
  p_ok boolean,
  p_error_code text default null,
  p_cost jsonb default null,
  p_retry_in_seconds integer default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.research_jobs j set
    status = case
      when p_ok then 'completed'
      when p_retry_in_seconds is not null and j.attempt_count < j.max_attempts then 'queued'
      else 'failed' end,
    run_after = case
      when not p_ok and p_retry_in_seconds is not null and j.attempt_count < j.max_attempts
      then now() + make_interval(secs => least(greatest(p_retry_in_seconds, 1), 86400))
      else j.run_after end,
    completed_at = now(),
    error_code = case when p_ok then null else left(p_error_code, 80) end,
    cost_metadata = coalesce(p_cost, j.cost_metadata)
  where j.id = p_job_id and j.status = 'running'
  returning j.status into v_status;
  return v_status;
end;
$$;

create function public.worker_log_event(
  p_job_id uuid,
  p_level text,
  p_code text,
  p_message text default null,
  p_details jsonb default '{}'
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.research_events (job_id, level, code, message, details)
  values (p_job_id, p_level, left(p_code, 80), left(p_message, 1000), coalesce(p_details, '{}'::jsonb));
$$;

create function public.worker_heartbeat(p_worker_id text, p_status text, p_details jsonb default '{}')
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.worker_heartbeats (worker_id, last_seen_at, status, details)
  values (left(p_worker_id, 64), now(), left(p_status, 40), coalesce(p_details, '{}'::jsonb))
  on conflict (worker_id) do update
    set last_seen_at = now(), status = excluded.status, details = excluded.details;
$$;

-- Insert or enrich a candidate. Idempotent on dedupe_key. Closed candidates are never reopened.
create function public.worker_upsert_candidate(p_data jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_existing public.spot_candidates;
  v_id uuid;
  v_name text := nullif(trim(p_data ->> 'candidate_name'), '');
  v_key text := nullif(p_data ->> 'dedupe_key', '');
  v_lat double precision := (p_data ->> 'lat')::double precision;
  v_lng double precision := (p_data ->> 'lng')::double precision;
  v_location geography;
  v_flags jsonb := case when jsonb_typeof(p_data -> 'risk_flags') = 'array' then p_data -> 'risk_flags' else '[]'::jsonb end;
  v_score integer := (p_data ->> 'confidence_score')::integer;
  v_blocked boolean;
  v_status text;
  v_similar public.spot_candidates;
  v_cluster uuid;
  v_dup_spot uuid;
  v_norm text;
  v_was_new boolean := false;
begin
  if v_name is null or v_key is null then
    raise exception 'candidate_name_and_dedupe_key_required' using errcode = '22023';
  end if;

  if v_lat is not null and v_lng is not null then
    if v_lat between 14.7 and 15.95 and v_lng between 73.5 and 74.5 then
      v_location := st_setsrid(st_makepoint(v_lng, v_lat), 4326)::geography;
    else
      v_flags := v_flags || jsonb_build_array(jsonb_build_object(
        'code', 'location_outside_goa', 'severity', 'warn', 'source', 'deterministic',
        'note', 'Geocoded point is outside Goa and was discarded.'));
    end if;
  end if;

  v_blocked := exists (select 1 from jsonb_array_elements(v_flags) f
                        where f ->> 'severity' = 'block' and f ->> 'resolved_at' is null);
  v_status := case when v_blocked then 'blocked'
                   when v_score >= 80 then 'ready_for_review'
                   when v_score >= 60 then 'needs_more_evidence'
                   else 'new' end;

  select * into v_existing from public.spot_candidates c where c.dedupe_key = v_key for update;

  if found then
    v_id := v_existing.id;
    if v_existing.review_status in ('approved', 'rejected', 'merged') then
      return jsonb_build_object('id', v_id, 'was_new', false, 'closed', true);
    end if;
    update public.spot_candidates c set
      aliases = (select coalesce(array_agg(distinct a), '{}')
                   from unnest(c.aliases || private.jsonb_text_array(p_data -> 'aliases')) a
                  where a <> c.candidate_name),
      proposed_location = coalesce(c.proposed_location, v_location),
      location_confidence = greatest(c.location_confidence, (p_data ->> 'location_confidence')::numeric),
      extracted_fields = coalesce(p_data -> 'extracted_fields', '{}'::jsonb) || c.extracted_fields,
      confidence_score = greatest(c.confidence_score, v_score),
      confidence_breakdown = case when v_score > coalesce(c.confidence_score, -1)
                                  then p_data -> 'confidence_breakdown' else c.confidence_breakdown end,
      -- New flags are added; flags a human already resolved stay resolved.
      risk_flags = c.risk_flags || coalesce((
        select jsonb_agg(f) from jsonb_array_elements(v_flags) f
        where not exists (select 1 from jsonb_array_elements(c.risk_flags) e where e ->> 'code' = f ->> 'code')),
        '[]'::jsonb),
      review_status = case when v_blocked and not exists (
                                  select 1 from jsonb_array_elements(c.risk_flags) e
                                  where e ->> 'resolved_at' is not null
                                    and e ->> 'code' in (select f ->> 'code' from jsonb_array_elements(v_flags) f))
                           then 'blocked' else c.review_status end
    where c.id = v_id;
  else
    v_was_new := true;
    insert into public.spot_candidates
      (candidate_name, aliases, proposed_category_slug, proposed_labels, proposed_region, proposed_locality,
       proposed_location, location_confidence, location_status, extracted_fields, schema_version,
       prompt_version, confidence_score, confidence_breakdown, risk_flags, review_status, dedupe_key,
       discovered_by)
    values (
      v_name, private.jsonb_text_array(p_data -> 'aliases'),
      (select c.slug from public.categories c where c.slug = p_data ->> 'proposed_category_slug' and c.parent_id is not null),
      (select coalesce(array_agg(l), '{}') from unnest(private.jsonb_text_array(p_data -> 'proposed_labels')) l
        where l in ('iconic', 'popular', 'lesser_known', 'local_favourite')),
      case when p_data ->> 'proposed_region' in ('north', 'central', 'south', 'inland') then p_data ->> 'proposed_region' end,
      nullif(trim(p_data ->> 'proposed_locality'), ''),
      v_location, (p_data ->> 'location_confidence')::numeric,
      case when v_location is null then 'needs_review'
           when p_data ->> 'location_status' in ('confirmed', 'approximate') then p_data ->> 'location_status'
           else 'needs_review' end,
      coalesce(p_data -> 'extracted_fields', '{}'::jsonb), p_data ->> 'schema_version', p_data ->> 'prompt_version',
      v_score, p_data -> 'confidence_breakdown', v_flags, v_status, v_key, 'research_worker')
    returning id, normalized_name into v_id, v_norm;

    -- Duplicate detection: a similar name is never enough on its own. It must also share
    -- the locality or sit within 200 m.
    select c.* into v_similar
    from public.spot_candidates c
    where c.id <> v_id
      and c.review_status not in ('rejected', 'merged')
      and similarity(c.normalized_name, v_norm) >= 0.55
      and ((c.proposed_locality is not null
            and private.normalize_text(c.proposed_locality) = private.normalize_text(p_data ->> 'proposed_locality'))
        or (c.proposed_location is not null and v_location is not null
            and st_dwithin(c.proposed_location, v_location, 200)))
    order by similarity(c.normalized_name, v_norm) desc
    limit 1;
    if found then
      v_cluster := coalesce(v_similar.duplicate_cluster_id, gen_random_uuid());
      update public.spot_candidates set duplicate_cluster_id = v_cluster where id in (v_id, v_similar.id);
    end if;

    select s.id into v_dup_spot
    from public.spots s
    where s.verification_status <> 'withdrawn'
      and similarity(trim(regexp_replace(private.normalize_text(s.name), '[^a-z0-9]+', ' ', 'g')), v_norm) >= 0.55
      and ((s.locality is not null
            and private.normalize_text(s.locality) = private.normalize_text(p_data ->> 'proposed_locality'))
        or (s.location is not null and v_location is not null and st_dwithin(s.location, v_location, 200)))
    limit 1;
    if v_dup_spot is not null then
      update public.spot_candidates set possible_duplicate_spot_id = v_dup_spot where id = v_id;
    end if;
  end if;

  insert into public.spot_sources
    (candidate_id, source_type, source_url, source_title, publisher, author, published_at,
     evidence_excerpt, claims_supported, source_quality)
  select v_id,
         case when src ->> 'source_type' in ('official_business', 'editorial', 'tourism_public', 'directory', 'social_lead', 'local_knowledge')
              then src ->> 'source_type' else 'editorial' end,
         src ->> 'source_url', left(src ->> 'source_title', 300), left(src ->> 'publisher', 200),
         left(src ->> 'author', 200),
         case when src ->> 'published_at' ~ '^\d{4}-\d{2}-\d{2}' then left(src ->> 'published_at', 10)::date end,
         left(src ->> 'evidence_excerpt', 500),
         private.jsonb_text_array(src -> 'claims_supported'),
         least(greatest((src ->> 'source_quality')::integer, 1), 5)
  from jsonb_array_elements(case when jsonb_typeof(p_data -> 'sources') = 'array' then p_data -> 'sources' else '[]'::jsonb end) src
  where src ->> 'source_url' ~* '^https?://'
  on conflict (candidate_id, source_url) where candidate_id is not null and source_url is not null
  do nothing;

  return jsonb_build_object('id', v_id, 'was_new', v_was_new, 'closed', false,
                            'duplicate_cluster_id', v_cluster, 'possible_duplicate_spot_id', v_dup_spot);
end;
$$;
