-- Public (guest) API. Clients never read tables directly: every function below is
-- SECURITY DEFINER, returns curated fields only and filters on private.is_public_spot().

-- ---------------------------------------------------------------------------
-- Live crowd state
--   * valid reports only, from the last 2 hours
--   * one vote per installation (its most recent report)
--   * at least 3 distinct installations, otherwise no row
--   * level = median; conflicting evidence is reported as 'mixed', never guessed
-- ---------------------------------------------------------------------------
create view private.live_crowd as
with latest as (
  select distinct on (r.spot_id, r.installation_hash)
         r.spot_id, r.installation_hash, r.crowd_level, r.reported_at
  from public.crowd_reports r
  where r.is_valid
    and r.reported_at > now() - interval '2 hours'
  order by r.spot_id, r.installation_hash, r.reported_at desc
),
agg as (
  select spot_id,
         count(*)::integer as report_count,
         percentile_cont(0.5) within group (order by crowd_level::double precision) as median_level,
         min(crowd_level) as min_level,
         max(crowd_level) as max_level,
         greatest(count(*) filter (where crowd_level = 1),
                  count(*) filter (where crowd_level = 2),
                  count(*) filter (where crowd_level = 3)) as top_votes,
         max(reported_at) as latest_report_at,
         -- The label stops being supported when the third-newest vote expires.
         (array_agg(reported_at order by reported_at desc))[3] + interval '2 hours' as valid_until
  from latest
  group by spot_id
  having count(*) >= 3
)
select spot_id,
       report_count,
       latest_report_at,
       valid_until,
       case
         when median_level <> floor(median_level) then 'mixed'
         when min_level = 1 and max_level = 3 and top_votes * 2 <= report_count then 'mixed'
         else 'live'
       end as status,
       case
         when median_level <> floor(median_level) then null
         when min_level = 1 and max_level = 3 and top_votes * 2 <= report_count then null
         else median_level::smallint
       end as level
from agg;

create function private.crowd_label(p_level smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_level when 1 then 'Quiet' when 2 then 'Moderate' when 3 then 'Busy' end;
$$;

-- Crowd payload for one spot: live -> mixed -> guide (history, then editorial) -> unavailable.
create function private.crowd_for(p_spot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_live record;
  v_stats record;
  v_guide jsonb;
  v_local timestamp := now() at time zone 'Asia/Kolkata';
  v_dow integer := extract(dow from v_local)::integer;
  v_hour integer := extract(hour from v_local)::integer;
  v_window jsonb;
  v_level smallint;
begin
  select * into v_live from private.live_crowd lc where lc.spot_id = p_spot_id;
  if found then
    return jsonb_build_object(
      'status', v_live.status,
      'level', v_live.level,
      'label', private.crowd_label(v_live.level),
      'report_count', v_live.report_count,
      'latest_report_at', v_live.latest_report_at,
      'valid_until', v_live.valid_until
    );
  end if;

  -- History-backed guide: needs a meaningful sample for this weekday and hour.
  select * into v_stats
  from public.crowd_hourly_stats h
  where h.spot_id = p_spot_id and h.day_of_week = v_dow and h.hour_of_day = v_hour;
  if found and v_stats.report_count >= 8 then
    v_level := round(v_stats.level_sum::numeric / v_stats.report_count)::smallint;
    return jsonb_build_object(
      'status', 'guide',
      'guide_source', 'history',
      'level', v_level,
      'label', private.crowd_label(v_level),
      'sample_size', v_stats.report_count
    );
  end if;

  -- Editorial guide entered by a reviewer; shown only inside a stated busy window.
  select s.crowd_guide into v_guide from public.spots s where s.id = p_spot_id;
  if jsonb_typeof(v_guide -> 'busy_windows') = 'array' then
    for v_window in select * from jsonb_array_elements(v_guide -> 'busy_windows') loop
      if (v_window -> 'days') @> to_jsonb(v_dow)
         and v_hour >= (v_window ->> 'start_hour')::integer
         and v_hour < (v_window ->> 'end_hour')::integer then
        return jsonb_build_object(
          'status', 'guide',
          'guide_source', 'editorial',
          'level', 3,
          'label', 'Busy',
          'note', v_guide ->> 'note'
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object('status', 'unavailable');
end;
$$;

-- ---------------------------------------------------------------------------
-- Cards (map pins and list rows)
-- ---------------------------------------------------------------------------
create type public.spot_card as (
  id uuid,
  slug text,
  name text,
  category_slug text,
  category_label text,
  group_slug text,
  locality text,
  region text,
  discovery_labels text[],
  lat double precision,
  lng double precision,
  thumb_path text,
  is_partner boolean,
  partner_label text,
  crowd_status text,
  crowd_level smallint,
  distance_m double precision,
  needs_recheck boolean,
  temporarily_unavailable boolean,
  last_verified_at timestamptz
);

-- One query builder shared by nearby, viewport and search so filters behave identically.
-- Partner status is never part of the ordering.
create function private.spot_cards(
  p_filters jsonb,
  p_origin extensions.geography,
  p_radius_m double precision,
  p_bbox extensions.geometry,
  p_tokens text[],
  p_limit integer,
  p_offset integer
)
returns setof public.spot_card
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with f as (
    select private.jsonb_text_array(p_filters -> 'category_slugs') as category_slugs,
           private.jsonb_text_array(p_filters -> 'regions') as regions,
           private.jsonb_text_array(p_filters -> 'labels') as labels,
           private.jsonb_text_array(p_filters -> 'price_bands') as price_bands,
           private.jsonb_text_array(p_filters -> 'attributes') as attributes,
           private.jsonb_text_array(p_filters -> 'crowd') as crowd,
           coalesce((p_filters ->> 'partner_only')::boolean, false) as partner_only
  ),
  base as (
    select s.id, s.slug, s.name, c.slug as category_slug, c.label as category_label,
           g.slug as group_slug, s.locality, s.region, s.discovery_labels,
           st_y(s.location::geometry) as lat, st_x(s.location::geometry) as lng,
           (select m.thumb_path
              from public.spot_media m
             where m.spot_id = s.id
               and m.rights_status in ('owned', 'licensed', 'permission_granted', 'public_domain')
             order by m.sort_order, m.created_at
             limit 1) as thumb_path,
           p.id is not null as is_partner,
           p.label_text as partner_label,
           lc.status as crowd_status,
           lc.level as crowd_level,
           case when p_origin is not null then st_distance(s.location, p_origin) end as distance_m,
           s.verification_status = 'stale' as needs_recheck,
           s.availability_status = 'temporarily_unavailable' as temporarily_unavailable,
           s.last_verified_at, s.published_at, s.search_text,
           s.price_band, s.verified_attributes, s.secondary_category_ids
    from public.spots s
    join public.categories c on c.id = s.primary_category_id
    left join public.categories g on g.id = c.parent_id
    left join private.live_crowd lc on lc.spot_id = s.id
    left join lateral (
      select pp.id, pp.label_text
      from public.partners pp
      where pp.spot_id = s.id and private.partner_is_active(pp)
      order by pp.starts_at desc
      limit 1
    ) p on true
    where private.is_public_spot(s)
      and (p_origin is null or p_radius_m is null or st_dwithin(s.location, p_origin, p_radius_m))
      and (p_bbox is null or st_intersects(s.location::geometry, p_bbox))
      and (p_tokens is null
           or not exists (select 1 from unnest(p_tokens) t where s.search_text not like '%' || t || '%'))
  )
  select b.id, b.slug, b.name, b.category_slug, b.category_label, b.group_slug, b.locality,
         b.region, b.discovery_labels, b.lat, b.lng, b.thumb_path, b.is_partner, b.partner_label,
         b.crowd_status, b.crowd_level, b.distance_m, b.needs_recheck, b.temporarily_unavailable,
         b.last_verified_at
  from base b, f
  where (cardinality(f.category_slugs) = 0
         or b.category_slug = any (f.category_slugs)
         or b.group_slug = any (f.category_slugs)
         or exists (select 1 from public.categories sc
                     where sc.id = any (b.secondary_category_ids) and sc.slug = any (f.category_slugs)))
    and (cardinality(f.regions) = 0 or b.region = any (f.regions))
    and (cardinality(f.labels) = 0 or b.discovery_labels && f.labels)
    and (cardinality(f.price_bands) = 0 or b.price_band = any (f.price_bands))
    and (cardinality(f.attributes) = 0 or b.verified_attributes @> f.attributes)
    and (not f.partner_only or b.is_partner)
    and (cardinality(f.crowd) = 0
         or (b.crowd_status = 'live' and (
               (b.crowd_level = 1 and 'quiet' = any (f.crowd))
            or (b.crowd_level = 2 and 'moderate' = any (f.crowd))
            or (b.crowd_level = 3 and 'busy' = any (f.crowd))))
         or (b.crowd_status is distinct from 'live' and 'unavailable' = any (f.crowd)))
  order by
    case when p_tokens is not null
         then similarity(b.search_text, array_to_string(p_tokens, ' ')) end desc nulls last,
    b.distance_m asc nulls last,
    b.published_at desc nulls last,
    b.id
  limit p_limit offset p_offset;
$$;

create function private.check_lat_lng(p_lat double precision, p_lng double precision)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;
end;
$$;

create function public.nearby_spots(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision default 10000,
  p_filters jsonb default '{}',
  p_limit integer default 30,
  p_cursor integer default 0
)
returns setof public.spot_card
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform private.check_lat_lng(p_lat, p_lng);
  if p_radius_m is null or p_radius_m <= 0 or p_radius_m > 100000 then
    raise exception 'invalid_radius' using errcode = '22023';
  end if;
  return query
    select * from private.spot_cards(
      coalesce(p_filters, '{}'),
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_radius_m, null, null,
      least(greatest(coalesce(p_limit, 30), 1), 50),
      greatest(coalesce(p_cursor, 0), 0));
end;
$$;

create function public.spots_in_bbox(
  p_min_lat double precision,
  p_min_lng double precision,
  p_max_lat double precision,
  p_max_lng double precision,
  p_filters jsonb default '{}',
  p_limit integer default 150
)
returns setof public.spot_card
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  perform private.check_lat_lng(p_min_lat, p_min_lng);
  perform private.check_lat_lng(p_max_lat, p_max_lng);
  if p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    raise exception 'invalid_bbox' using errcode = '22023';
  end if;
  return query
    select * from private.spot_cards(
      coalesce(p_filters, '{}'), null, null,
      st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326),
      null,
      least(greatest(coalesce(p_limit, 150), 1), 200),
      0);
end;
$$;

-- Search and browse. With an origin, distance is returned and used as the tie-breaker.
create function public.search_spots(
  p_query text default null,
  p_filters jsonb default '{}',
  p_limit integer default 30,
  p_cursor integer default 0,
  p_lat double precision default null,
  p_lng double precision default null
)
returns setof public.spot_card
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_tokens text[] := private.search_tokens(p_query);
  v_origin geography;
begin
  if p_lat is not null or p_lng is not null then
    perform private.check_lat_lng(p_lat, p_lng);
    v_origin := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  end if;
  return query
    select * from private.spot_cards(
      coalesce(p_filters, '{}'), v_origin, null, null,
      case when cardinality(v_tokens) = 0 then null else v_tokens end,
      least(greatest(coalesce(p_limit, 30), 1), 50),
      greatest(coalesce(p_cursor, 0), 0));
end;
$$;

create function public.list_categories()
returns table (
  id uuid,
  parent_slug text,
  slug text,
  label text,
  sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, g.slug, c.slug, c.label, c.sort_order
  from public.categories c
  left join public.categories g on g.id = c.parent_id
  where c.is_active
  order by coalesce(g.sort_order, c.sort_order), (c.parent_id is not null), c.sort_order;
$$;

-- ---------------------------------------------------------------------------
-- Place detail. Unknown facts stay null; the client shows "Not verified".
-- ---------------------------------------------------------------------------
create function public.get_spot_detail(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.spots;
  v_result jsonb;
begin
  select * into s from public.spots sp where sp.slug = p_slug;
  if not found or not private.is_public_spot(s) then
    return null;
  end if;

  select jsonb_build_object(
    'id', s.id,
    'slug', s.slug,
    'name', s.name,
    'short_description', s.short_description,
    'description', s.description,
    'category', jsonb_build_object('slug', c.slug, 'label', c.label, 'group_slug', g.slug, 'group_label', g.label),
    'discovery_labels', s.discovery_labels,
    'region', s.region,
    'locality', s.locality,
    'address_text', s.address_text,
    'lat', st_y(s.location::geometry),
    'lng', st_x(s.location::geometry),
    'location_precision', s.location_precision,
    'public_access_status', s.public_access_status,
    'price_band', s.price_band,
    'best_time', s.best_time,
    'parking_info', s.parking_info,
    'opening_hours', case when s.opening_hours ->> 'verified_at' is not null then s.opening_hours end,
    'safety_tags', s.safety_tags,
    'respect_tags', s.respect_tags,
    'safety_notes', s.safety_notes,
    'respect_notes', s.respect_notes,
    'access_notes', s.access_notes,
    'verified_attributes', s.verified_attributes,
    'needs_recheck', s.verification_status = 'stale',
    'temporarily_unavailable', s.availability_status = 'temporarily_unavailable',
    'last_verified_at', s.last_verified_at,
    'last_visited_at', s.last_visited_at,
    'media', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'storage_path', m.storage_path, 'thumb_path', m.thumb_path,
               'alt_text', m.alt_text, 'credit_line', m.credit_line)
             order by m.sort_order, m.created_at)
      from public.spot_media m
      where m.spot_id = s.id
        and m.rights_status in ('owned', 'licensed', 'permission_granted', 'public_domain')), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', coalesce(src.source_title, src.publisher), 'publisher', src.publisher,
               'url', src.source_url, 'attribution', src.attribution)
             order by src.created_at)
      from public.spot_sources src
      where src.spot_id = s.id and src.is_public and src.verification_status = 'verified'), '[]'::jsonb),
    'partner', (
      select jsonb_build_object(
               'id', p.id, 'business_name', p.business_name, 'label_text', p.label_text,
               'whatsapp_number', p.whatsapp_number, 'website_url', p.website_url)
      from public.partners p
      where p.spot_id = s.id and private.partner_is_active(p)
      order by p.starts_at desc
      limit 1),
    'crowd', private.crowd_for(s.id)
  )
  into v_result
  from public.categories c
  left join public.categories g on g.id = c.parent_id
  where c.id = s.primary_category_id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Crowd reports
-- ---------------------------------------------------------------------------
create function public.submit_crowd_report(
  p_spot_id uuid,
  p_level integer,
  p_lat double precision,
  p_lng double precision,
  p_installation_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.spots;
  v_hash text;
  v_recent integer;
  v_last timestamptz;
  v_local timestamp;
begin
  if p_level is null or p_level not between 1 and 3 then
    raise exception 'invalid_level' using errcode = '22023';
  end if;
  perform private.check_lat_lng(p_lat, p_lng);
  v_hash := private.installation_hash(p_installation_token);

  select * into s from public.spots sp where sp.id = p_spot_id;
  if not found or not private.is_public_spot(s) then
    return jsonb_build_object('accepted', false, 'reason', 'spot_unavailable');
  end if;

  -- Serialise per installation so concurrent submissions cannot slip past the limits.
  perform pg_advisory_xact_lock(hashtextextended(v_hash, 0));

  -- Overall cap per installation (valid or not) to bound abuse and table growth.
  select count(*) into v_recent
  from public.crowd_reports r
  where r.installation_hash = v_hash and r.reported_at > now() - interval '1 hour';
  if v_recent >= 12 then
    return jsonb_build_object('accepted', false, 'reason', 'rate_limited');
  end if;

  -- A partner's own staff devices cannot report on the partner's place.
  if exists (
    select 1
    from public.partner_devices d
    join public.partners p on p.id = d.partner_id
    where d.installation_hash = v_hash and p.spot_id = s.id
  ) then
    insert into public.crowd_reports (spot_id, crowd_level, installation_hash, is_valid, rejection_reason)
    values (s.id, p_level, v_hash, false, 'partner_device');
    return jsonb_build_object('accepted', false, 'reason', 'partner_device');
  end if;

  -- Proximity is decided here, on the server. The coordinate is used once and not stored.
  if not st_dwithin(s.location, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 300) then
    insert into public.crowd_reports (spot_id, crowd_level, installation_hash, is_valid, rejection_reason)
    values (s.id, p_level, v_hash, false, 'too_far');
    return jsonb_build_object('accepted', false, 'reason', 'too_far');
  end if;

  -- One valid report per installation, per place, per hour.
  select max(r.reported_at) into v_last
  from public.crowd_reports r
  where r.installation_hash = v_hash and r.spot_id = s.id and r.is_valid
    and r.reported_at > now() - interval '1 hour';
  if v_last is not null then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'already_reported',
      'retry_after_seconds', greatest(0, ceil(extract(epoch from (v_last + interval '1 hour' - now())))::integer));
  end if;

  insert into public.crowd_reports (spot_id, crowd_level, installation_hash, is_valid)
  values (s.id, p_level, v_hash, true);

  v_local := now() at time zone 'Asia/Kolkata';
  insert into public.crowd_hourly_stats (spot_id, day_of_week, hour_of_day, report_count, level_sum)
  values (s.id, extract(dow from v_local)::smallint, extract(hour from v_local)::smallint, 1, p_level)
  on conflict (spot_id, day_of_week, hour_of_day)
  do update set report_count = public.crowd_hourly_stats.report_count + 1,
                level_sum = public.crowd_hourly_stats.level_sum + excluded.level_sum;

  return jsonb_build_object('accepted', true, 'crowd', private.crowd_for(s.id));
end;
$$;

create function public.get_crowd_status(p_spot_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.spots;
begin
  select * into s from public.spots sp where sp.id = p_spot_id;
  if not found or not private.is_public_spot(s) then
    return jsonb_build_object('status', 'unavailable');
  end if;
  return private.crowd_for(s.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Try instead
-- ---------------------------------------------------------------------------
create function public.get_spot_alternatives(
  p_spot_id uuid,
  p_radius_m double precision default 15000,
  p_limit integer default 3
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  s public.spots;
  v_origin record;
  v_origin_level smallint;
  v_radius double precision := least(greatest(coalesce(p_radius_m, 15000), 500), 50000);
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 5);
  v_items jsonb;
begin
  select * into s from public.spots sp where sp.id = p_spot_id;
  if not found or not private.is_public_spot(s) then
    return jsonb_build_object('crowd_comparison_available', false, 'alternatives', '[]'::jsonb);
  end if;

  select lc.status, lc.level into v_origin from private.live_crowd lc where lc.spot_id = s.id;
  if found and v_origin.status = 'live' then
    v_origin_level := v_origin.level;
  end if;

  with eligible as (
    select a.id, a.slug, a.name, c.slug as category_slug, c.label as category_label,
           a.locality, a.region, a.discovery_labels,
           st_y(a.location::geometry) as lat, st_x(a.location::geometry) as lng,
           st_distance(a.location, s.location) as distance_m,
           lc.status as crowd_status, lc.level as crowd_level,
           (a.verification_status = 'stale') as needs_recheck,
           a.last_verified_at,
           (a.access_notes is not null)::integer
             + (a.safety_notes is not null or cardinality(a.safety_tags) > 0)::integer as completeness,
           (select m.thumb_path from public.spot_media m
             where m.spot_id = a.id
               and m.rights_status in ('owned', 'licensed', 'permission_granted', 'public_domain')
             order by m.sort_order, m.created_at limit 1) as thumb_path,
           coalesce(v_origin_level is not null and lc.status = 'live' and lc.level < v_origin_level, false) as is_quieter
    from public.spots a
    join public.categories c on c.id = a.primary_category_id
    left join private.live_crowd lc on lc.spot_id = a.id
    where a.id <> s.id
      and private.is_public_spot(a)
      and a.availability_status = 'open'
      and a.public_access_status in ('verified_public', 'business_premises', 'permit_required')
      and st_dwithin(a.location, s.location, v_radius)
      and (a.primary_category_id = s.primary_category_id
           or exists (
             select 1 from public.category_equivalents e
             where (e.category_id = s.primary_category_id and e.equivalent_category_id = a.primary_category_id)
                or (e.category_id = a.primary_category_id and e.equivalent_category_id = s.primary_category_id)))
      -- A place with reliable evidence of being just as busy (or busier) is not an alternative.
      and not coalesce(v_origin_level is not null and lc.status = 'live' and lc.level >= v_origin_level, false)
  ),
  ranked as (
    select * from eligible
    order by is_quieter desc, needs_recheck asc, completeness desc,
             last_verified_at desc nulls last, distance_m asc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'slug', r.slug, 'name', r.name,
           'category_slug', r.category_slug, 'category_label', r.category_label,
           'locality', r.locality, 'region', r.region, 'discovery_labels', r.discovery_labels,
           'lat', r.lat, 'lng', r.lng, 'thumb_path', r.thumb_path,
           'distance_m', round(r.distance_m),
           'crowd_status', r.crowd_status, 'crowd_level', r.crowd_level,
           'same_category', r.category_slug = (select cc.slug from public.categories cc where cc.id = s.primary_category_id),
           'reason', case when r.is_quieter then 'quieter' else 'similar_nearby' end)
         order by r.is_quieter desc, r.needs_recheck asc, r.completeness desc,
                  r.last_verified_at desc nulls last, r.distance_m asc), '[]'::jsonb)
  into v_items
  from ranked r;

  return jsonb_build_object(
    'origin_crowd_level', v_origin_level,
    -- True only when at least one suggestion is backed by a live comparison.
    'crowd_comparison_available', v_items @> '[{"reason": "quieter"}]'::jsonb,
    'radius_m', v_radius,
    'alternatives', v_items);
end;
$$;

-- ---------------------------------------------------------------------------
-- Problem reports, partner enquiry intent, analytics, partner device link
-- ---------------------------------------------------------------------------
create function public.submit_spot_problem(
  p_spot_id uuid,
  p_type text,
  p_message text default null,
  p_installation_token text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s public.spots;
  v_hash text;
  v_recent integer;
begin
  if p_type is null or p_type not in ('closed', 'unsafe', 'wrong_pin', 'wrong_hours', 'private_access', 'other') then
    raise exception 'invalid_report_type' using errcode = '22023';
  end if;
  if char_length(coalesce(p_message, '')) > 1000 then
    raise exception 'message_too_long' using errcode = '22023';
  end if;
  select * into s from public.spots sp where sp.id = p_spot_id;
  if not found or not private.is_public_spot(s) then
    return jsonb_build_object('accepted', false, 'reason', 'spot_unavailable');
  end if;

  if p_installation_token is not null then
    v_hash := private.installation_hash(p_installation_token);
    select count(*) into v_recent
    from public.user_reports r
    where r.installation_hash = v_hash and r.created_at > now() - interval '1 hour';
    if v_recent >= 5 then
      return jsonb_build_object('accepted', false, 'reason', 'rate_limited');
    end if;
  end if;

  insert into public.user_reports (spot_id, report_type, message, installation_hash, priority)
  values (s.id, p_type, nullif(trim(p_message), ''), v_hash,
          case when p_type in ('unsafe', 'private_access') then 'high' else 'normal' end);
  return jsonb_build_object('accepted', true);
end;
$$;

create function private.clean_event_props(p_props jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  -- Exact coordinates and free text never enter analytics.
  select case
           when jsonb_typeof(p_props) <> 'object' then '{}'::jsonb
           when pg_column_size(p_props) > 2000 then '{}'::jsonb
           else p_props - array['lat', 'lng', 'latitude', 'longitude', 'coords', 'coordinates',
                                'location', 'message', 'text', 'query', 'installation_token']
         end;
$$;

create function public.track_events(
  p_events jsonb,
  p_session_id text default null,
  p_platform text default null,
  p_app_version text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception 'invalid_events' using errcode = '22023';
  end if;
  insert into public.analytics_events (name, props, session_id, platform, app_version, created_at)
  select e ->> 'name',
         private.clean_event_props(coalesce(e -> 'props', '{}'::jsonb)),
         left(p_session_id, 64),
         case when p_platform in ('android', 'ios') then p_platform end,
         left(p_app_version, 32),
         now()
  from jsonb_array_elements(p_events) e
  where e ->> 'name' in (
    'app_opened', 'explore_viewed', 'map_viewed', 'list_viewed', 'filter_applied',
    'search_submitted', 'spot_opened', 'spot_saved', 'spot_unsaved', 'directions_opened',
    'share_opened', 'crowd_report_submitted', 'alternatives_opened', 'partner_profile_opened',
    'problem_report_submitted');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Logs enquiry intent, then the client opens WhatsApp. No message content is ever captured.
create function public.track_partner_enquiry(
  p_partner_id uuid,
  p_spot_id uuid,
  p_source_surface text,
  p_session_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.partners;
  v_event_id bigint;
begin
  if p_source_surface is null or p_source_surface not in ('spot_detail', 'map_card', 'list_card', 'search') then
    raise exception 'invalid_source_surface' using errcode = '22023';
  end if;
  select * into p from public.partners pp where pp.id = p_partner_id and pp.spot_id = p_spot_id;
  if not found or not private.partner_is_active(p) then
    return jsonb_build_object('ok', false, 'reason', 'partner_inactive');
  end if;

  insert into public.analytics_events (name, props, session_id)
  values ('partner_whatsapp_tapped',
          jsonb_build_object('partner_id', p.id, 'spot_id', p.spot_id, 'surface', p_source_surface),
          left(p_session_id, 64))
  returning id into v_event_id;

  insert into public.partner_enquiries (partner_id, spot_id, event_id, source_surface, anonymous_session_id)
  values (p.id, p.spot_id, v_event_id, p_source_surface, left(p_session_id, 64));

  return jsonb_build_object('ok', true);
end;
$$;

-- A partner's staff enter a one-time code (issued by an admin) so their device is
-- excluded from crowd reports on the partner's own place.
create function public.link_partner_device(p_claim_code text, p_installation_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.partners;
  v_hash text := private.installation_hash(p_installation_token);
begin
  select * into p
  from public.partners pp
  where pp.claim_code = upper(trim(p_claim_code))
    and pp.claim_code_expires_at > now();
  if not found then
    return jsonb_build_object('linked', false, 'reason', 'invalid_or_expired_code');
  end if;
  insert into public.partner_devices (installation_hash, partner_id)
  values (v_hash, p.id)
  on conflict do nothing;
  return jsonb_build_object('linked', true, 'business_name', p.business_name);
end;
$$;

create function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin();
$$;
