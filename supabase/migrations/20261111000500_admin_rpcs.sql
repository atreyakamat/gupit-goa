-- Admin (reviewer) API. Every function checks the admin allowlist and writes an audit row
-- for anything that changes data. There is no direct table write path for any client role.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function private.j_text(p_data jsonb, p_key text, p_current text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_data ? p_key then nullif(trim(p_data ->> p_key), '') else p_current end;
$$;

create function private.j_arr(p_data jsonb, p_key text, p_current text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p_data ? p_key then private.jsonb_text_array(p_data -> p_key) else p_current end;
$$;

create function private.spot_snapshot(s public.spots)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select (to_jsonb(s) - 'location' - 'search_text')
         || jsonb_build_object(
              'lat', extensions.st_y(s.location::extensions.geometry),
              'lng', extensions.st_x(s.location::extensions.geometry));
$$;

create function private.make_point(p_lat double precision, p_lng double precision)
returns extensions.geography
language plpgsql
immutable
set search_path = ''
as $$
begin
  perform private.check_lat_lng(p_lat, p_lng);
  -- Goa and a small margin. Anything else is a data-entry or geocoding error.
  if p_lat < 14.7 or p_lat > 15.95 or p_lng < 73.5 or p_lng > 74.5 then
    raise exception 'coordinates_outside_goa' using errcode = '22023';
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
end;
$$;

create function private.unique_spot_slug(p_name text, p_locality text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_base text := left(private.slugify(concat_ws(' ', p_name, p_locality)), 80);
  v_slug text;
  v_n integer := 1;
begin
  if v_base = '' then
    v_base := 'place';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.spots where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n;
  end loop;
  return v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- Publication checklist (spec 7.6 and 16.2). Used by the editor and enforced on publish.
-- ---------------------------------------------------------------------------
create function private.publish_checklist(p_spot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.spots;
  v_strict boolean;
  v_media integer;
  v_sources integer;
  v_open_flags integer;
begin
  select * into s from public.spots sp where sp.id = p_spot_id;
  if not found then
    raise exception 'spot_not_found' using errcode = 'P0002';
  end if;
  select c.requires_strict_verification into v_strict
  from public.categories c where c.id = s.primary_category_id;
  select count(*) into v_media from public.spot_media m
  where m.spot_id = s.id
    and m.rights_status in ('owned', 'licensed', 'permission_granted', 'public_domain');
  select count(*) into v_sources from public.spot_sources src
  where src.spot_id = s.id and src.verification_status = 'verified';
  select count(*) into v_open_flags
  from public.spot_candidates c, jsonb_array_elements(c.risk_flags) f
  where c.approved_spot_id = s.id and f ->> 'severity' = 'block' and f ->> 'resolved_at' is null;

  return jsonb_build_array(
    jsonb_build_object('code', 'name_category', 'label', 'Name and category confirmed',
      'ok', s.name is not null and s.primary_category_id is not null),
    jsonb_build_object('code', 'locality_region', 'label', 'Locality and region confirmed',
      'ok', s.locality is not null and s.region is not null),
    jsonb_build_object('code', 'location', 'label', 'Map pin checked',
      'ok', s.location is not null and s.location_precision <> 'needs_review'),
    jsonb_build_object('code', 'public_access', 'label', 'Public access confirmed',
      'ok', s.public_access_status in ('verified_public', 'business_premises', 'permit_required')),
    jsonb_build_object('code', 'description', 'label', 'Original short description',
      'ok', s.short_description is not null),
    jsonb_build_object('code', 'access_notes', 'label', 'Directions and access notes',
      'ok', s.access_notes is not null),
    jsonb_build_object('code', 'media', 'label', 'At least one photo with rights recorded',
      'ok', v_media >= 1),
    jsonb_build_object('code', 'sources', 'label', 'At least one verified source',
      'ok', v_sources >= 1),
    jsonb_build_object('code', 'safety_review', 'label',
      case when v_strict then 'Safety review done, with at least one safety tag or note'
           else 'Safety and respect review done' end,
      'ok', s.safety_reviewed_at is not null
            and (not v_strict or s.safety_notes is not null or cardinality(s.safety_tags) > 0)),
    jsonb_build_object('code', 'verification', 'label',
      case when v_strict then 'Verified by a team visit, or an authority source plus a second check'
           else 'Verified by a team visit or two independent local sources' end,
      'ok', s.last_verified_at is not null
            and s.verification_method is not null
            and (not v_strict or s.verification_method in ('team_visit', 'authority_plus_second'))),
    jsonb_build_object('code', 'no_open_blocks', 'label', 'No safety block or unresolved risk flag',
      'ok', not s.safety_blocked and v_open_flags = 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Spots
-- ---------------------------------------------------------------------------
create function public.admin_get_spot(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.spots;
begin
  perform private.require_admin();
  select * into s from public.spots sp where sp.id = p_id;
  if not found then
    raise exception 'spot_not_found' using errcode = 'P0002';
  end if;
  return private.spot_snapshot(s) || jsonb_build_object(
    'primary_category_slug', (select c.slug from public.categories c where c.id = s.primary_category_id),
    'secondary_category_slugs', coalesce((select jsonb_agg(c.slug) from public.categories c
                                           where c.id = any (s.secondary_category_ids)), '[]'::jsonb),
    'media', coalesce((select jsonb_agg(to_jsonb(m) order by m.sort_order, m.created_at)
                         from public.spot_media m where m.spot_id = s.id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(to_jsonb(src) order by src.created_at)
                           from public.spot_sources src where src.spot_id = s.id), '[]'::jsonb),
    'partners', coalesce((select jsonb_agg(to_jsonb(p) - 'claim_code' order by p.starts_at desc)
                            from public.partners p where p.spot_id = s.id), '[]'::jsonb),
    'checklist', private.publish_checklist(s.id));
end;
$$;

create function public.admin_save_spot(p_id uuid, p_data jsonb, p_reason text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_before public.spots;
  v_after public.spots;
  v_category uuid;
  v_secondary uuid[];
  v_location extensions.geography;
  v_safety_edit boolean;
begin
  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  if p_data ? 'primary_category_slug' then
    select c.id into v_category from public.categories c
    where c.slug = p_data ->> 'primary_category_slug' and c.parent_id is not null and c.is_active;
    if v_category is null then
      raise exception 'unknown_category' using errcode = '22023';
    end if;
  end if;
  if p_data ? 'secondary_category_slugs' then
    select coalesce(array_agg(c.id), '{}') into v_secondary from public.categories c
    where c.slug = any (private.jsonb_text_array(p_data -> 'secondary_category_slugs'));
  end if;
  if p_data ? 'lat' or p_data ? 'lng' then
    v_location := private.make_point((p_data ->> 'lat')::double precision, (p_data ->> 'lng')::double precision);
  end if;

  if p_id is null then
    if nullif(trim(p_data ->> 'name'), '') is null or v_category is null then
      raise exception 'name_and_category_required' using errcode = '22023';
    end if;
    insert into public.spots (slug, name, primary_category_id)
    values (private.unique_spot_slug(p_data ->> 'name', p_data ->> 'locality'), trim(p_data ->> 'name'), v_category)
    returning * into v_before;
    p_id := v_before.id;
  else
    select * into v_before from public.spots sp where sp.id = p_id for update;
    if not found then
      raise exception 'spot_not_found' using errcode = 'P0002';
    end if;
  end if;

  update public.spots sp set
    name = coalesce(private.j_text(p_data, 'name', sp.name), sp.name),
    aliases = private.j_arr(p_data, 'aliases', sp.aliases),
    short_description = private.j_text(p_data, 'short_description', sp.short_description),
    description = private.j_text(p_data, 'description', sp.description),
    primary_category_id = coalesce(v_category, sp.primary_category_id),
    secondary_category_ids = coalesce(v_secondary, sp.secondary_category_ids),
    discovery_labels = private.j_arr(p_data, 'discovery_labels', sp.discovery_labels),
    region = private.j_text(p_data, 'region', sp.region),
    locality = private.j_text(p_data, 'locality', sp.locality),
    address_text = private.j_text(p_data, 'address_text', sp.address_text),
    location = coalesce(v_location, sp.location),
    location_precision = coalesce(private.j_text(p_data, 'location_precision', sp.location_precision), sp.location_precision),
    public_access_status = coalesce(private.j_text(p_data, 'public_access_status', sp.public_access_status), sp.public_access_status),
    price_band = private.j_text(p_data, 'price_band', sp.price_band),
    best_time = private.j_text(p_data, 'best_time', sp.best_time),
    parking_info = private.j_text(p_data, 'parking_info', sp.parking_info),
    opening_hours = case when p_data ? 'opening_hours' then nullif(p_data -> 'opening_hours', 'null'::jsonb) else sp.opening_hours end,
    safety_tags = private.j_arr(p_data, 'safety_tags', sp.safety_tags),
    respect_tags = private.j_arr(p_data, 'respect_tags', sp.respect_tags),
    safety_notes = private.j_text(p_data, 'safety_notes', sp.safety_notes),
    respect_notes = private.j_text(p_data, 'respect_notes', sp.respect_notes),
    access_notes = private.j_text(p_data, 'access_notes', sp.access_notes),
    verified_attributes = private.j_arr(p_data, 'verified_attributes', sp.verified_attributes),
    search_tags = private.j_arr(p_data, 'search_tags', sp.search_tags),
    crowd_guide = case when p_data ? 'crowd_guide' then nullif(p_data -> 'crowd_guide', 'null'::jsonb) else sp.crowd_guide end,
    verification_method = private.j_text(p_data, 'verification_method', sp.verification_method),
    last_visited_at = case when p_data ? 'last_visited_at' then (p_data ->> 'last_visited_at')::timestamptz else sp.last_visited_at end,
    internal_notes = private.j_text(p_data, 'internal_notes', sp.internal_notes),
    safety_reviewed_at = case when (p_data ->> 'safety_reviewed')::boolean is true then now()
                              when (p_data ->> 'safety_reviewed')::boolean is false then null
                              else sp.safety_reviewed_at end,
    safety_reviewed_by = case when (p_data ->> 'safety_reviewed')::boolean is true then v_uid
                              when (p_data ->> 'safety_reviewed')::boolean is false then null
                              else sp.safety_reviewed_by end
  where sp.id = p_id
  returning * into v_after;

  v_safety_edit :=
       v_before.location is distinct from v_after.location
    or v_before.access_notes is distinct from v_after.access_notes
    or v_before.safety_notes is distinct from v_after.safety_notes
    or v_before.safety_tags is distinct from v_after.safety_tags
    or v_before.public_access_status is distinct from v_after.public_access_status
    or v_before.opening_hours is distinct from v_after.opening_hours;

  -- A material safety or access change to a live listing must say why.
  if v_safety_edit and v_before.verification_status in ('published', 'stale')
     and nullif(trim(p_reason), '') is null then
    raise exception 'reason_required_for_safety_edit' using errcode = '22023';
  end if;

  perform private.audit(
    case when v_safety_edit then 'spot.safety_edit' else 'spot.edit' end,
    'spot', p_id::text, private.spot_snapshot(v_before), private.spot_snapshot(v_after), p_reason);
  return p_id;
end;
$$;

create function public.admin_set_spot_status(p_id uuid, p_action text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_before public.spots;
  v_after public.spots;
  v_missing jsonb;
begin
  select * into v_before from public.spots sp where sp.id = p_id for update;
  if not found then
    raise exception 'spot_not_found' using errcode = 'P0002';
  end if;

  if p_action in ('suspend', 'withdraw', 'block_unsafe', 'unblock', 'mark_permanently_closed')
     and nullif(trim(p_reason), '') is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  if p_action = 'publish' then
    select coalesce(jsonb_agg(item), '[]'::jsonb) into v_missing
    from jsonb_array_elements(private.publish_checklist(p_id)) item
    where not (item ->> 'ok')::boolean;
    if jsonb_array_length(v_missing) > 0 then
      return jsonb_build_object('ok', false, 'missing', v_missing);
    end if;
    update public.spots set
      verification_status = 'published',
      published_at = coalesce(published_at, now()),
      published_by = v_uid
    where id = p_id returning * into v_after;
  elsif p_action = 'unpublish' then
    update public.spots set verification_status = 'review' where id = p_id returning * into v_after;
  elsif p_action = 'mark_stale' then
    update public.spots set verification_status = 'stale'
    where id = p_id and verification_status = 'published' returning * into v_after;
  elsif p_action = 'reverify' then
    -- Reviewer confirms the facts are still right today.
    update public.spots set
      last_verified_at = now(),
      verification_status = case when verification_status = 'stale' then 'published' else verification_status end
    where id = p_id returning * into v_after;
  elsif p_action = 'suspend' then
    update public.spots set verification_status = 'suspended' where id = p_id returning * into v_after;
  elsif p_action = 'withdraw' then
    update public.spots set verification_status = 'withdrawn' where id = p_id returning * into v_after;
  elsif p_action = 'block_unsafe' then
    update public.spots set safety_blocked = true, safety_block_reason = trim(p_reason)
    where id = p_id returning * into v_after;
  elsif p_action = 'unblock' then
    update public.spots set safety_blocked = false, safety_block_reason = null
    where id = p_id returning * into v_after;
  elsif p_action = 'mark_temporarily_unavailable' then
    update public.spots set availability_status = 'temporarily_unavailable' where id = p_id returning * into v_after;
  elsif p_action = 'mark_open' then
    update public.spots set availability_status = 'open' where id = p_id returning * into v_after;
  elsif p_action = 'mark_permanently_closed' then
    update public.spots set availability_status = 'permanently_closed' where id = p_id returning * into v_after;
  else
    raise exception 'unknown_action' using errcode = '22023';
  end if;

  if v_after.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_applicable');
  end if;

  perform private.audit('spot.' || p_action, 'spot', p_id::text,
    jsonb_build_object('verification_status', v_before.verification_status,
                       'availability_status', v_before.availability_status,
                       'safety_blocked', v_before.safety_blocked,
                       'last_verified_at', v_before.last_verified_at),
    jsonb_build_object('verification_status', v_after.verification_status,
                       'availability_status', v_after.availability_status,
                       'safety_blocked', v_after.safety_blocked,
                       'last_verified_at', v_after.last_verified_at),
    p_reason);
  return jsonb_build_object('ok', true, 'verification_status', v_after.verification_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Media and sources
-- ---------------------------------------------------------------------------
create function public.admin_save_media(p_id uuid, p_spot_id uuid, p_data jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_before jsonb;
  v_row public.spot_media;
begin
  if p_id is null then
    if nullif(p_data ->> 'storage_path', '') is null then
      raise exception 'storage_path_required' using errcode = '22023';
    end if;
    insert into public.spot_media
      (spot_id, storage_path, thumb_path, alt_text, sort_order, rights_status, rights_evidence_url, credit_line, created_by)
    values (
      p_spot_id, p_data ->> 'storage_path', nullif(p_data ->> 'thumb_path', ''),
      nullif(trim(p_data ->> 'alt_text'), ''),
      coalesce((select max(m.sort_order) + 1 from public.spot_media m where m.spot_id = p_spot_id), 0),
      coalesce(nullif(p_data ->> 'rights_status', ''), 'not_approved'),
      nullif(trim(p_data ->> 'rights_evidence_url'), ''), nullif(trim(p_data ->> 'credit_line'), ''), v_uid)
    returning * into v_row;
  else
    select to_jsonb(m) into v_before from public.spot_media m where m.id = p_id;
    update public.spot_media m set
      alt_text = private.j_text(p_data, 'alt_text', m.alt_text),
      rights_status = coalesce(private.j_text(p_data, 'rights_status', m.rights_status), m.rights_status),
      rights_evidence_url = private.j_text(p_data, 'rights_evidence_url', m.rights_evidence_url),
      credit_line = private.j_text(p_data, 'credit_line', m.credit_line)
    where m.id = p_id returning * into v_row;
    if v_row.id is null then
      raise exception 'media_not_found' using errcode = 'P0002';
    end if;
  end if;
  perform private.audit(case when p_id is null then 'media.add' else 'media.edit' end,
    'spot_media', v_row.id::text, v_before, to_jsonb(v_row));
  return v_row.id;
end;
$$;

create function public.admin_delete_media(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.spot_media;
begin
  perform private.require_admin();
  delete from public.spot_media m where m.id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('media.delete', 'spot_media', p_id::text, to_jsonb(v_row), null);
  -- The client removes these objects from storage after the record is gone.
  return jsonb_build_object('storage_path', v_row.storage_path, 'thumb_path', v_row.thumb_path);
end;
$$;

create function public.admin_reorder_media(p_spot_id uuid, p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.spot_media m
  set sort_order = o.ord
  from unnest(p_ids) with ordinality as o (id, ord)
  where m.id = o.id and m.spot_id = p_spot_id;
  perform private.audit('media.reorder', 'spot', p_spot_id::text, null, to_jsonb(p_ids));
end;
$$;

create function public.admin_save_source(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_row public.spot_sources;
begin
  perform private.require_admin();
  if p_id is null then
    insert into public.spot_sources
      (spot_id, candidate_id, source_type, source_url, source_title, publisher, author, published_at,
       checked_at, evidence_excerpt, claims_supported, source_quality, attribution, rights_notes,
       verification_status, is_public)
    values (
      (p_data ->> 'spot_id')::uuid, (p_data ->> 'candidate_id')::uuid,
      p_data ->> 'source_type', nullif(trim(p_data ->> 'source_url'), ''),
      nullif(trim(p_data ->> 'source_title'), ''), nullif(trim(p_data ->> 'publisher'), ''),
      nullif(trim(p_data ->> 'author'), ''), (p_data ->> 'published_at')::date, now(),
      nullif(trim(p_data ->> 'evidence_excerpt'), ''),
      private.jsonb_text_array(p_data -> 'claims_supported'),
      (p_data ->> 'source_quality')::smallint, nullif(trim(p_data ->> 'attribution'), ''),
      nullif(trim(p_data ->> 'rights_notes'), ''),
      coalesce(nullif(p_data ->> 'verification_status', ''), 'unverified'),
      coalesce((p_data ->> 'is_public')::boolean, false))
    returning * into v_row;
  else
    select to_jsonb(src) into v_before from public.spot_sources src where src.id = p_id;
    update public.spot_sources src set
      source_type = coalesce(private.j_text(p_data, 'source_type', src.source_type), src.source_type),
      source_url = private.j_text(p_data, 'source_url', src.source_url),
      source_title = private.j_text(p_data, 'source_title', src.source_title),
      publisher = private.j_text(p_data, 'publisher', src.publisher),
      author = private.j_text(p_data, 'author', src.author),
      evidence_excerpt = private.j_text(p_data, 'evidence_excerpt', src.evidence_excerpt),
      claims_supported = private.j_arr(p_data, 'claims_supported', src.claims_supported),
      source_quality = case when p_data ? 'source_quality' then (p_data ->> 'source_quality')::smallint else src.source_quality end,
      attribution = private.j_text(p_data, 'attribution', src.attribution),
      rights_notes = private.j_text(p_data, 'rights_notes', src.rights_notes),
      verification_status = coalesce(private.j_text(p_data, 'verification_status', src.verification_status), src.verification_status),
      is_public = case when p_data ? 'is_public' then (p_data ->> 'is_public')::boolean else src.is_public end,
      checked_at = now()
    where src.id = p_id returning * into v_row;
    if v_row.id is null then
      raise exception 'source_not_found' using errcode = 'P0002';
    end if;
  end if;
  perform private.audit(case when p_id is null then 'source.add' else 'source.edit' end,
    'spot_source', v_row.id::text, v_before, to_jsonb(v_row));
  return v_row.id;
end;
$$;

create function public.admin_delete_source(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.spot_sources;
begin
  perform private.require_admin();
  delete from public.spot_sources src where src.id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('source.delete', 'spot_source', p_id::text, to_jsonb(v_row), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Candidates (review queue)
-- ---------------------------------------------------------------------------
create function public.admin_get_candidate(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.spot_candidates;
begin
  perform private.require_admin();
  select * into c from public.spot_candidates sc where sc.id = p_id;
  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;
  return (to_jsonb(c) - 'proposed_location') || jsonb_build_object(
    'lat', extensions.st_y(c.proposed_location::extensions.geometry),
    'lng', extensions.st_x(c.proposed_location::extensions.geometry),
    'sources', coalesce((select jsonb_agg(to_jsonb(src) order by src.source_quality desc nulls last, src.created_at)
                           from public.spot_sources src where src.candidate_id = c.id), '[]'::jsonb),
    'cluster', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', o.id, 'candidate_name', o.candidate_name,
                                  'proposed_locality', o.proposed_locality, 'review_status', o.review_status))
                           from public.spot_candidates o
                          where o.duplicate_cluster_id = c.duplicate_cluster_id and o.id <> c.id), '[]'::jsonb),
    'possible_duplicate_spot', (select jsonb_build_object('id', s.id, 'name', s.name, 'locality', s.locality,
                                                           'verification_status', s.verification_status)
                                  from public.spots s where s.id = c.possible_duplicate_spot_id));
end;
$$;

create function public.admin_save_candidate(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_row public.spot_candidates;
  v_location extensions.geography;
begin
  perform private.require_admin();
  if p_data ? 'lat' or p_data ? 'lng' then
    v_location := private.make_point((p_data ->> 'lat')::double precision, (p_data ->> 'lng')::double precision);
  end if;
  if p_id is null then
    if nullif(trim(p_data ->> 'candidate_name'), '') is null then
      raise exception 'name_required' using errcode = '22023';
    end if;
    insert into public.spot_candidates (candidate_name, discovered_by, review_status)
    values (trim(p_data ->> 'candidate_name'), 'manual', 'needs_more_evidence')
    returning * into v_row;
    p_id := v_row.id;
  else
    select to_jsonb(c) - 'proposed_location' into v_before from public.spot_candidates c where c.id = p_id;
    if v_before is null then
      raise exception 'candidate_not_found' using errcode = 'P0002';
    end if;
  end if;

  update public.spot_candidates c set
    candidate_name = coalesce(private.j_text(p_data, 'candidate_name', c.candidate_name), c.candidate_name),
    aliases = private.j_arr(p_data, 'aliases', c.aliases),
    proposed_category_slug = private.j_text(p_data, 'proposed_category_slug', c.proposed_category_slug),
    proposed_labels = private.j_arr(p_data, 'proposed_labels', c.proposed_labels),
    proposed_region = private.j_text(p_data, 'proposed_region', c.proposed_region),
    proposed_locality = private.j_text(p_data, 'proposed_locality', c.proposed_locality),
    proposed_location = coalesce(v_location, c.proposed_location),
    location_status = coalesce(private.j_text(p_data, 'location_status', c.location_status), c.location_status),
    extracted_fields = case when jsonb_typeof(p_data -> 'extracted_fields') = 'object'
                            then c.extracted_fields || (p_data -> 'extracted_fields') else c.extracted_fields end,
    review_notes = private.j_text(p_data, 'review_notes', c.review_notes)
  where c.id = p_id returning * into v_row;

  perform private.audit(case when v_before is null then 'candidate.add' else 'candidate.edit' end,
    'spot_candidate', p_id::text, v_before, to_jsonb(v_row) - 'proposed_location');
  return p_id;
end;
$$;

-- A reviewer pastes a link (for example an Instagram post) or a local tip.
-- Nothing is fetched from the source: the URL and the reviewer's own note are stored as a lead.
create function public.admin_add_lead(p_name text, p_url text default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_host text;
  v_rule text;
begin
  perform private.require_admin();
  if nullif(trim(p_name), '') is null then
    raise exception 'name_required' using errcode = '22023';
  end if;
  if p_url is not null then
    if p_url !~* '^https?://' then
      raise exception 'invalid_url' using errcode = '22023';
    end if;
    v_host := lower(regexp_replace(substring(p_url from '^https?://([^/?#]+)'), '^www\.', ''));
    select r.rule into v_rule from public.research_domain_rules r
    where v_host = r.domain or v_host like '%.' || r.domain
    order by length(r.domain) desc limit 1;
    if v_rule = 'block' then
      raise exception 'source_domain_blocked' using errcode = '22023';
    end if;
  end if;

  insert into public.spot_candidates (candidate_name, discovered_by, review_status, review_notes)
  values (trim(p_name), 'manual', 'needs_more_evidence', nullif(trim(p_note), ''))
  returning id into v_id;

  insert into public.spot_sources (candidate_id, source_type, source_url, publisher, evidence_excerpt, rights_notes)
  values (v_id,
          case when p_url is null then 'local_knowledge'
               when v_rule = 'lead_only' then 'social_lead'
               else 'editorial' end,
          p_url, v_host, left(nullif(trim(p_note), ''), 500),
          case when v_rule = 'lead_only'
               then 'Lead only. Verify the place through independent permitted sources. Do not reuse media without documented permission.' end);

  perform private.audit('candidate.add_lead', 'spot_candidate', v_id::text, null,
    jsonb_build_object('name', p_name, 'url', p_url));
  return v_id;
end;
$$;

create function public.admin_flag_candidate(
  p_id uuid,
  p_code text,
  p_action text,
  p_note text,
  p_severity text default 'block'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  c public.spot_candidates;
  v_flags jsonb;
  v_open integer;
begin
  select * into c from public.spot_candidates sc where sc.id = p_id for update;
  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;
  if nullif(trim(p_note), '') is null then
    raise exception 'note_required' using errcode = '22023';
  end if;

  if p_action = 'add' then
    if p_severity not in ('block', 'warn') then
      raise exception 'invalid_severity' using errcode = '22023';
    end if;
    v_flags := c.risk_flags || jsonb_build_array(jsonb_build_object(
      'code', p_code, 'severity', p_severity, 'source', 'human', 'note', trim(p_note),
      'created_at', now()));
  elsif p_action = 'resolve' then
    -- Only a human reviewer can clear a flag; the worker has no path to this function.
    select coalesce(jsonb_agg(
             case when f ->> 'code' = p_code and f ->> 'resolved_at' is null
                  then f || jsonb_build_object('resolved_at', now(), 'resolved_by', v_uid, 'resolution_note', trim(p_note))
                  else f end), '[]'::jsonb)
      into v_flags
    from jsonb_array_elements(c.risk_flags) f;
  else
    raise exception 'unknown_action' using errcode = '22023';
  end if;

  select count(*) into v_open from jsonb_array_elements(v_flags) f
  where f ->> 'severity' = 'block' and f ->> 'resolved_at' is null;

  update public.spot_candidates sc set
    risk_flags = v_flags,
    review_status = case
      when v_open > 0 and sc.review_status in ('new', 'needs_more_evidence', 'ready_for_review') then 'blocked'
      when v_open = 0 and sc.review_status = 'blocked' then 'ready_for_review'
      else sc.review_status end
  where sc.id = p_id;

  perform private.audit('candidate.flag_' || p_action, 'spot_candidate', p_id::text,
    jsonb_build_object('risk_flags', c.risk_flags), jsonb_build_object('risk_flags', v_flags), p_note);
  return jsonb_build_object('open_blocks', v_open);
end;
$$;

-- Approve creates a spot in `review`; it is NOT public until admin_set_spot_status('publish')
-- passes the full checklist.
create function public.admin_decide_candidate(
  p_id uuid,
  p_decision text,
  p_notes text default null,
  p_merge_into_candidate uuid default null,
  p_merge_into_spot uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  c public.spot_candidates;
  v_category uuid;
  v_spot_id uuid;
  v_open integer;
  f jsonb;
begin
  select * into c from public.spot_candidates sc where sc.id = p_id for update;
  if not found then
    raise exception 'candidate_not_found' using errcode = 'P0002';
  end if;
  if c.review_status in ('approved', 'merged') then
    raise exception 'candidate_already_closed' using errcode = '22023';
  end if;

  if p_decision in ('needs_more_evidence', 'ready_for_review') then
    update public.spot_candidates set review_status = p_decision, review_notes = coalesce(nullif(trim(p_notes), ''), review_notes),
      reviewer_id = v_uid, reviewed_at = now() where id = p_id;

  elsif p_decision = 'reject' then
    if nullif(trim(p_notes), '') is null then
      raise exception 'reason_required' using errcode = '22023';
    end if;
    update public.spot_candidates set review_status = 'rejected', review_notes = trim(p_notes),
      reviewer_id = v_uid, reviewed_at = now() where id = p_id;

  elsif p_decision = 'merge' then
    if (p_merge_into_candidate is null) = (p_merge_into_spot is null) then
      raise exception 'exactly_one_merge_target_required' using errcode = '22023';
    end if;
    if p_merge_into_candidate = p_id then
      raise exception 'cannot_merge_into_self' using errcode = '22023';
    end if;
    if p_merge_into_candidate is not null then
      if not exists (select 1 from public.spot_candidates where id = p_merge_into_candidate) then
        raise exception 'merge_target_not_found' using errcode = 'P0002';
      end if;
      -- Evidence moves to the surviving candidate; identical URLs are dropped.
      delete from public.spot_sources src
      where src.candidate_id = p_id
        and exists (select 1 from public.spot_sources t
                     where t.candidate_id = p_merge_into_candidate and t.source_url = src.source_url);
      update public.spot_sources set candidate_id = p_merge_into_candidate where candidate_id = p_id;
      update public.spot_candidates t set aliases = (
        select coalesce(array_agg(distinct a), '{}') from unnest(t.aliases || c.aliases || array[c.candidate_name]) a
        where a <> t.candidate_name)
      where t.id = p_merge_into_candidate;
    else
      if not exists (select 1 from public.spots where id = p_merge_into_spot) then
        raise exception 'merge_target_not_found' using errcode = 'P0002';
      end if;
      update public.spot_sources set spot_id = p_merge_into_spot where candidate_id = p_id;
    end if;
    update public.spot_candidates set review_status = 'merged', merged_into_candidate_id = p_merge_into_candidate,
      approved_spot_id = p_merge_into_spot, review_notes = coalesce(nullif(trim(p_notes), ''), review_notes),
      reviewer_id = v_uid, reviewed_at = now() where id = p_id;

  elsif p_decision = 'approve' then
    select count(*) into v_open from jsonb_array_elements(c.risk_flags) fl
    where fl ->> 'severity' = 'block' and fl ->> 'resolved_at' is null;
    if v_open > 0 then
      return jsonb_build_object('ok', false, 'reason', 'unresolved_risk_flags', 'open_blocks', v_open);
    end if;
    select cat.id into v_category from public.categories cat
    where cat.slug = c.proposed_category_slug and cat.parent_id is not null and cat.is_active;
    if v_category is null then
      return jsonb_build_object('ok', false, 'reason', 'category_required');
    end if;
    f := c.extracted_fields;

    insert into public.spots
      (slug, name, aliases, short_description, primary_category_id, discovery_labels, region, locality,
       address_text, location, location_precision, best_time, parking_info, access_notes, safety_notes,
       price_band, verification_status)
    values (
      private.unique_spot_slug(c.candidate_name, c.proposed_locality), c.candidate_name, c.aliases,
      left(nullif(trim(f ->> 'description_draft'), ''), 280), v_category, c.proposed_labels,
      c.proposed_region, c.proposed_locality, nullif(trim(f ->> 'address_text'), ''),
      c.proposed_location,
      -- The pin always starts unchecked: a reviewer must confirm it on the map before publishing.
      'needs_review',
      nullif(trim(f ->> 'best_time'), ''), nullif(trim(f ->> 'parking_info'), ''),
      nullif(trim(f ->> 'access_notes'), ''), nullif(trim(f ->> 'safety_notes'), ''),
      case when f ->> 'price_band' in ('free', 'budget', 'mid', 'premium') then f ->> 'price_band' end,
      'review')
    returning id into v_spot_id;

    update public.spot_sources set spot_id = v_spot_id where candidate_id = p_id;
    update public.spot_candidates set review_status = 'approved', approved_spot_id = v_spot_id,
      review_notes = coalesce(nullif(trim(p_notes), ''), review_notes), reviewer_id = v_uid, reviewed_at = now()
    where id = p_id;
  else
    raise exception 'unknown_decision' using errcode = '22023';
  end if;

  perform private.audit('candidate.' || p_decision, 'spot_candidate', p_id::text,
    jsonb_build_object('review_status', c.review_status),
    jsonb_build_object('spot_id', coalesce(v_spot_id, p_merge_into_spot),
                       'merged_into_candidate', p_merge_into_candidate),
    p_notes);
  return jsonb_build_object('ok', true, 'spot_id', v_spot_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Partners
-- ---------------------------------------------------------------------------
create function public.admin_save_partner(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_row public.partners;
begin
  perform private.require_admin();
  if p_id is null then
    insert into public.partners (business_name, spot_id, whatsapp_number, website_url, partner_status, plan,
                                 starts_at, ends_at, label_text)
    values (
      trim(p_data ->> 'business_name'), (p_data ->> 'spot_id')::uuid,
      regexp_replace(coalesce(p_data ->> 'whatsapp_number', ''), '[^0-9]', '', 'g'),
      nullif(trim(p_data ->> 'website_url'), ''),
      coalesce(nullif(p_data ->> 'partner_status', ''), 'pilot'), nullif(trim(p_data ->> 'plan'), ''),
      coalesce((p_data ->> 'starts_at')::timestamptz, now()), (p_data ->> 'ends_at')::timestamptz,
      coalesce(nullif(trim(p_data ->> 'label_text'), ''), 'Partner'))
    returning * into v_row;
  else
    select to_jsonb(p) - 'claim_code' into v_before from public.partners p where p.id = p_id;
    update public.partners p set
      business_name = coalesce(private.j_text(p_data, 'business_name', p.business_name), p.business_name),
      whatsapp_number = case when p_data ? 'whatsapp_number'
                             then regexp_replace(p_data ->> 'whatsapp_number', '[^0-9]', '', 'g') else p.whatsapp_number end,
      website_url = private.j_text(p_data, 'website_url', p.website_url),
      partner_status = coalesce(private.j_text(p_data, 'partner_status', p.partner_status), p.partner_status),
      plan = private.j_text(p_data, 'plan', p.plan),
      starts_at = case when p_data ? 'starts_at' then coalesce((p_data ->> 'starts_at')::timestamptz, p.starts_at) else p.starts_at end,
      ends_at = case when p_data ? 'ends_at' then (p_data ->> 'ends_at')::timestamptz else p.ends_at end,
      label_text = coalesce(private.j_text(p_data, 'label_text', p.label_text), p.label_text)
    where p.id = p_id returning * into v_row;
    if v_row.id is null then
      raise exception 'partner_not_found' using errcode = 'P0002';
    end if;
  end if;
  perform private.audit(case when p_id is null then 'partner.add' else 'partner.edit' end,
    'partner', v_row.id::text, v_before, to_jsonb(v_row) - 'claim_code');
  return v_row.id;
end;
$$;

create function public.admin_issue_partner_claim_code(p_partner_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text := upper(encode(extensions.gen_random_bytes(4), 'hex'));
  v_expires timestamptz := now() + interval '7 days';
begin
  perform private.require_admin();
  update public.partners set claim_code = v_code, claim_code_expires_at = v_expires where id = p_partner_id;
  if not found then
    raise exception 'partner_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('partner.issue_claim_code', 'partner', p_partner_id::text, null, null);
  return jsonb_build_object('claim_code', v_code, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------------
-- User reports, research controls, dashboard
-- ---------------------------------------------------------------------------
create function public.admin_resolve_user_report(p_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_before text;
begin
  if p_status not in ('open', 'in_review', 'resolved', 'dismissed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  select r.status into v_before from public.user_reports r where r.id = p_id for update;
  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  update public.user_reports set status = p_status, resolution_note = nullif(trim(p_note), ''),
    reviewed_by = v_uid, reviewed_at = now() where id = p_id;
  perform private.audit('user_report.' || p_status, 'user_report', p_id::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status), p_note);
end;
$$;

create function public.admin_set_research_adapter(p_adapter text, p_enabled boolean, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
begin
  insert into public.research_adapters (adapter, is_enabled, notes, updated_at, updated_by)
  values (p_adapter, p_enabled, p_note, now(), v_uid)
  on conflict (adapter) do update
    set is_enabled = excluded.is_enabled, notes = coalesce(excluded.notes, public.research_adapters.notes),
        updated_at = now(), updated_by = v_uid;
  perform private.audit('research.adapter_' || case when p_enabled then 'enabled' else 'disabled' end,
    'research_adapter', p_adapter, null, jsonb_build_object('is_enabled', p_enabled), p_note);
end;
$$;

create function public.admin_set_domain_rule(p_domain text, p_rule text, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_domain text := lower(regexp_replace(trim(p_domain), '^www\.', ''));
begin
  if v_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'invalid_domain' using errcode = '22023';
  end if;
  insert into public.research_domain_rules (domain, rule, reason, updated_at, updated_by)
  values (v_domain, p_rule, p_reason, now(), v_uid)
  on conflict (domain) do update
    set rule = excluded.rule, reason = excluded.reason, updated_at = now(), updated_by = v_uid;
  perform private.audit('research.domain_rule', 'research_domain_rule', v_domain, null,
    jsonb_build_object('rule', p_rule), p_reason);
end;
$$;

create function public.admin_enqueue_research_job(p_query text, p_region text default null, p_category_slug text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_query text := trim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'));
begin
  perform private.require_admin();
  if char_length(v_query) not between 3 and 160 then
    raise exception 'invalid_query' using errcode = '22023';
  end if;
  insert into public.research_jobs (job_type, query, region, category_id, source_adapter, idempotency_key)
  values ('discovery', v_query, p_region,
          (select c.id from public.categories c where c.slug = p_category_slug),
          'web_search',
          'discovery:' || md5(lower(v_query)) || ':' || to_char(now(), 'IYYY-IW'))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform private.audit('research.enqueue', 'research_job', v_id::text, null, jsonb_build_object('query', v_query));
  end if;
  return v_id;
end;
$$;

create function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return jsonb_build_object(
    'candidates', coalesce((select jsonb_object_agg(review_status, n)
                              from (select review_status, count(*) n from public.spot_candidates group by 1) t), '{}'::jsonb),
    'spots', coalesce((select jsonb_object_agg(verification_status, n)
                         from (select verification_status, count(*) n from public.spots group by 1) t), '{}'::jsonb),
    'open_user_reports', (select count(*) from public.user_reports where status in ('open', 'in_review')),
    'high_priority_reports', (select count(*) from public.user_reports where status in ('open', 'in_review') and priority = 'high'),
    'active_partners', (select count(*) from public.partners p where private.partner_is_active(p)),
    'jobs', coalesce((select jsonb_object_agg(status, n)
                        from (select status, count(*) n from public.research_jobs group by 1) t), '{}'::jsonb),
    'research_errors_24h', (select count(*) from public.research_events
                             where level = 'error' and created_at > now() - interval '24 hours'),
    'workers', coalesce((select jsonb_agg(to_jsonb(w) order by w.last_seen_at desc) from public.worker_heartbeats w), '[]'::jsonb),
    'stale_listings', (select count(*) from public.spots
                        where verification_status = 'published' and last_verified_at < now() - interval '180 days'));
end;
$$;

-- Privacy-safe internal reporting (no public dashboard in v1).
create function public.admin_analytics_summary(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365));
begin
  perform private.require_admin();
  return jsonb_build_object(
    'since', v_since,
    'events', coalesce((select jsonb_object_agg(name, n)
                          from (select name, count(*) n from public.analytics_events
                                 where created_at >= v_since group by 1) t), '{}'::jsonb),
    'sessions', (select count(distinct session_id) from public.analytics_events where created_at >= v_since),
    'crowd_reports', (select jsonb_build_object(
                               'valid', count(*) filter (where is_valid),
                               'rejected_too_far', count(*) filter (where rejection_reason = 'too_far'),
                               'rejected_partner_device', count(*) filter (where rejection_reason = 'partner_device'))
                        from public.crowd_reports where reported_at >= v_since),
    'partner_enquiries', coalesce((
      select jsonb_agg(jsonb_build_object('partner_id', p.id, 'business_name', p.business_name, 'taps', t.n)
                       order by t.n desc)
      from (select partner_id, count(*) n from public.partner_enquiries
             where created_at >= v_since group by 1) t
      join public.partners p on p.id = t.partner_id), '[]'::jsonb));
end;
$$;
