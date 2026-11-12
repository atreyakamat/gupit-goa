-- Catalogue: categories, places ("spots"), media, sources and partners.

-- ---------------------------------------------------------------------------
-- Categories (what a place is). Discovery labels (how it is positioned) live on spots.
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  label text not null,
  search_terms text[] not null default '{}',
  sort_order integer not null default 0,
  -- Nature, swimming, trail and remote places need a visit or an authority source before publishing.
  requires_strict_verification boolean not null default false,
  is_active boolean not null default true
);
create index categories_parent_idx on public.categories (parent_id);

create table public.category_equivalents (
  category_id uuid not null references public.categories (id) on delete cascade,
  equivalent_category_id uuid not null references public.categories (id) on delete cascade,
  primary key (category_id, equivalent_category_id),
  check (category_id <> equivalent_category_id)
);
comment on table public.category_equivalents is
  'Approved "close enough" categories for Try-instead. Stored once per pair; read in both directions.';

-- ---------------------------------------------------------------------------
-- Spots: canonical place records
-- ---------------------------------------------------------------------------
create table public.spots (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 120),
  aliases text[] not null default '{}',
  short_description text check (char_length(short_description) <= 280),
  description text,
  primary_category_id uuid not null references public.categories (id) on delete restrict,
  secondary_category_ids uuid[] not null default '{}',
  discovery_labels text[] not null default '{}'
    check (discovery_labels <@ array['iconic', 'popular', 'lesser_known', 'local_favourite']),
  region text check (region in ('north', 'central', 'south', 'inland')),
  locality text,
  address_text text,
  location extensions.geography (Point, 4326),
  location_precision text not null default 'needs_review'
    check (location_precision in ('exact', 'approximate', 'needs_review')),
  public_access_status text not null default 'unknown'
    check (public_access_status in
      ('verified_public', 'business_premises', 'permit_required', 'restricted', 'unknown')),
  price_band text check (price_band in ('free', 'budget', 'mid', 'premium')),
  best_time text,
  parking_info text,
  -- { "text": "...", "verified_at": "YYYY-MM-DD" | null }
  opening_hours jsonb,
  safety_tags text[] not null default '{}',
  respect_tags text[] not null default '{}',
  safety_notes text,
  respect_notes text,
  access_notes text,
  -- Only facts a reviewer has verified, e.g. family_suitable, step_free_access, wifi.
  verified_attributes text[] not null default '{}',
  -- Curated intent words for search, e.g. quiet, sunset, family-friendly.
  search_tags text[] not null default '{}',
  -- Editorial guide: { "note": "...", "busy_windows": [{ "days": [0..6], "start_hour": 17, "end_hour": 20 }] }
  crowd_guide jsonb,
  verification_status text not null default 'draft'
    check (verification_status in ('draft', 'review', 'published', 'stale', 'suspended', 'withdrawn')),
  availability_status text not null default 'open'
    check (availability_status in ('open', 'temporarily_unavailable', 'permanently_closed')),
  safety_blocked boolean not null default false,
  safety_block_reason text,
  safety_reviewed_at timestamptz,
  safety_reviewed_by uuid references auth.users (id) on delete set null,
  verification_method text
    check (verification_method in ('team_visit', 'two_local_sources', 'authority_plus_second')),
  last_verified_at timestamptz,
  last_visited_at timestamptz,
  published_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  internal_notes text,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not safety_blocked or safety_block_reason is not null)
);

create index spots_location_gix on public.spots using gist (location);
create index spots_status_idx on public.spots (verification_status);
create index spots_category_idx on public.spots (primary_category_id);
create index spots_search_trgm_idx on public.spots using gin (search_text extensions.gin_trgm_ops);

create trigger spots_touch_updated_at
before update on public.spots
for each row execute function private.touch_updated_at();

-- A spot is visible to the public only when all of these hold. Every public RPC uses this.
create function private.is_public_spot(s public.spots)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select s.verification_status in ('published', 'stale')
     and not s.safety_blocked
     and s.availability_status <> 'permanently_closed'
     and s.location is not null;
$$;

create function private.spots_build_search_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_category text;
begin
  select concat_ws(' ', c.label, c.slug, array_to_string(c.search_terms, ' '),
                   g.label, array_to_string(g.search_terms, ' '))
    into v_category
  from public.categories c
  left join public.categories g on g.id = c.parent_id
  where c.id = new.primary_category_id;

  new.search_text := private.normalize_text(concat_ws(' ',
    new.name,
    array_to_string(new.aliases, ' '),
    new.locality,
    case new.region
      when 'north' then 'north goa'
      when 'central' then 'central goa panaji panjim'
      when 'south' then 'south goa'
      when 'inland' then 'inland goa'
    end,
    v_category,
    (select string_agg(concat_ws(' ', sc.label, array_to_string(sc.search_terms, ' ')), ' ')
       from public.categories sc where sc.id = any (new.secondary_category_ids)),
    array_to_string(new.search_tags, ' '),
    replace(array_to_string(new.discovery_labels, ' '), '_', ' ')
  ));
  return new;
end;
$$;

create trigger spots_search_text
before insert or update of name, aliases, locality, region, primary_category_id,
  secondary_category_ids, search_tags, discovery_labels
on public.spots
for each row execute function private.spots_build_search_text();

-- ---------------------------------------------------------------------------
-- Media. Only rights-cleared media is ever returned to the public.
-- ---------------------------------------------------------------------------
create table public.spot_media (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  storage_path text not null,
  thumb_path text,
  media_type text not null default 'image' check (media_type in ('image')),
  alt_text text,
  sort_order integer not null default 0,
  rights_status text not null default 'not_approved'
    check (rights_status in
      ('owned', 'licensed', 'permission_granted', 'public_domain', 'not_approved')),
  rights_evidence_url text,
  credit_line text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index spot_media_spot_idx on public.spot_media (spot_id, sort_order);

-- ---------------------------------------------------------------------------
-- Partners (commercial relationship). Never an input to organic ranking or crowd data.
-- ---------------------------------------------------------------------------
create table public.partners (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  spot_id uuid not null references public.spots (id) on delete cascade,
  whatsapp_number text not null check (whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  website_url text check (website_url is null or website_url ~* '^https://'),
  partner_status text not null default 'pilot'
    check (partner_status in ('pilot', 'active', 'paused', 'ended')),
  plan text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  label_text text not null default 'Partner' check (label_text ~* 'partner|sponsored'),
  claim_code text unique,
  claim_code_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);
create index partners_spot_idx on public.partners (spot_id);

create trigger partners_touch_updated_at
before update on public.partners
for each row execute function private.touch_updated_at();

create function private.partner_is_active(p public.partners)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p.partner_status in ('pilot', 'active')
     and p.starts_at <= now()
     and (p.ends_at is null or p.ends_at > now());
$$;

-- App installations that belong to a partner's staff. Their crowd reports for the
-- partner's own place are rejected.
create table public.partner_devices (
  installation_hash text not null,
  partner_id uuid not null references public.partners (id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (installation_hash, partner_id)
);

-- ---------------------------------------------------------------------------
-- Taxonomy seed (production data, so it lives in a migration)
-- ---------------------------------------------------------------------------
with groups (slug, label, terms, ord) as (
  values
    ('eat-drink', 'Eat & drink', array['food', 'eat', 'drink', 'dining'], 10),
    ('beaches-coast', 'Beaches & coast', array['coast', 'sea', 'seaside'], 20),
    ('nature-outdoors', 'Nature & outdoors', array['nature', 'outdoor', 'hike'], 30),
    ('sightseeing-heritage', 'Sightseeing & heritage', array['sightseeing', 'heritage', 'history', 'landmark'], 40),
    ('culture-local-life', 'Culture & local life', array['culture', 'local'], 50),
    ('activities-experiences', 'Activities & experiences', array['activity', 'experience', 'things to do'], 60),
    ('stay', 'Stay', array['stay', 'accommodation', 'sleep'], 70)
)
insert into public.categories (slug, label, search_terms, sort_order)
select slug, label, terms, ord from groups;

with subs (parent, slug, label, terms, strict, ord) as (
  values
    ('eat-drink', 'cafe', 'Café', array['cafe', 'coffee', 'brunch'], false, 1),
    ('eat-drink', 'restaurant', 'Restaurant', array['restaurant', 'dinner', 'lunch'], false, 2),
    ('eat-drink', 'beach-shack', 'Beach shack', array['shack'], false, 3),
    ('eat-drink', 'bakery', 'Bakery', array['bakery', 'bread', 'pastry'], false, 4),
    ('eat-drink', 'dessert', 'Dessert & ice cream', array['dessert', 'ice cream', 'gelato'], false, 5),
    ('eat-drink', 'bar', 'Bar', array['bar', 'cocktail', 'nightlife'], false, 6),
    ('eat-drink', 'pub', 'Pub', array['pub', 'beer', 'nightlife'], false, 7),
    ('eat-drink', 'nightclub', 'Nightclub', array['club', 'nightclub', 'party', 'nightlife', 'dance'], false, 8),
    ('eat-drink', 'brewery', 'Brewery & taproom', array['brewery', 'taproom', 'craft beer'], false, 9),
    ('eat-drink', 'food-market', 'Food market', array['food market', 'street food'], false, 10),
    ('beaches-coast', 'beach', 'Beach', array['beach'], true, 1),
    ('beaches-coast', 'beach-access', 'Beach access', array['beach', 'access'], true, 2),
    ('beaches-coast', 'sunset-point', 'Sunset point', array['sunset', 'view'], false, 3),
    ('beaches-coast', 'coastal-viewpoint', 'Coastal viewpoint', array['viewpoint', 'view', 'cliff'], true, 4),
    ('beaches-coast', 'waterfront', 'Waterfront promenade', array['promenade', 'waterfront', 'walk'], false, 5),
    ('nature-outdoors', 'waterfall', 'Waterfall', array['waterfall', 'falls'], true, 1),
    ('nature-outdoors', 'trail', 'Trail', array['trail', 'trek', 'hike', 'walk'], true, 2),
    ('nature-outdoors', 'viewpoint', 'Viewpoint', array['viewpoint', 'view', 'sunset'], true, 3),
    ('nature-outdoors', 'spring', 'Spring', array['spring'], true, 4),
    ('nature-outdoors', 'riverfront', 'Riverfront', array['river', 'riverfront'], true, 5),
    ('nature-outdoors', 'island-boat-access', 'Island / boat access', array['island', 'boat'], true, 6),
    ('nature-outdoors', 'nature-reserve', 'Nature reserve', array['sanctuary', 'reserve', 'wildlife'], true, 7),
    ('sightseeing-heritage', 'fort', 'Fort', array['fort'], false, 1),
    ('sightseeing-heritage', 'museum', 'Museum', array['museum'], false, 2),
    ('sightseeing-heritage', 'heritage-site', 'Heritage site', array['heritage', 'church', 'temple', 'historic'], false, 3),
    ('sightseeing-heritage', 'lighthouse', 'Lighthouse', array['lighthouse'], false, 4),
    ('sightseeing-heritage', 'historic-precinct', 'Historic neighbourhood', array['heritage walk', 'old quarter', 'latin quarter'], false, 5),
    ('sightseeing-heritage', 'public-monument', 'Public monument', array['monument', 'statue'], false, 6),
    ('sightseeing-heritage', 'gallery', 'Gallery', array['gallery', 'art'], false, 7),
    ('culture-local-life', 'market', 'Market', array['market', 'bazaar', 'shopping', 'flea'], false, 1),
    ('culture-local-life', 'village-attraction', 'Public village attraction', array['village'], false, 2),
    ('culture-local-life', 'local-experience', 'Local craft / food experience', array['craft', 'feni', 'pottery'], false, 3),
    ('culture-local-life', 'festival-venue', 'Festival venue', array['festival'], false, 4),
    ('culture-local-life', 'community-attraction', 'Community-run attraction', array['community'], false, 5),
    ('activities-experiences', 'water-sports', 'Water sports', array['water sports', 'kayak', 'surf', 'scuba', 'parasailing'], true, 1),
    ('activities-experiences', 'boat-trip', 'Boat trip', array['boat', 'cruise', 'dolphin'], true, 2),
    ('activities-experiences', 'guided-tour', 'Guided tour', array['tour', 'walk', 'guide'], false, 3),
    ('activities-experiences', 'workshop', 'Workshop', array['workshop', 'class'], false, 4),
    ('activities-experiences', 'spice-farm', 'Spice farm', array['spice', 'plantation', 'farm'], false, 5),
    ('activities-experiences', 'adventure-activity', 'Adventure activity', array['adventure', 'bungee', 'paragliding', 'rafting'], true, 6),
    ('activities-experiences', 'food-experience', 'Food experience', array['cooking class', 'food tour', 'tasting'], false, 7),
    ('stay', 'hostel', 'Hostel', array['hostel', 'backpacker'], false, 1),
    ('stay', 'homestay', 'Homestay', array['homestay'], false, 2),
    ('stay', 'guesthouse', 'Guesthouse', array['guesthouse', 'guest house'], false, 3),
    ('stay', 'hotel', 'Hotel', array['hotel'], false, 4),
    ('stay', 'resort', 'Resort', array['resort'], false, 5),
    ('stay', 'campsite', 'Campsite', array['camping', 'camp', 'glamping'], false, 6)
)
insert into public.categories (parent_id, slug, label, search_terms, requires_strict_verification, sort_order)
select g.id, s.slug, s.label, s.terms, s.strict, s.ord
from subs s
join public.categories g on g.slug = s.parent;

with pairs (a, b) as (
  values
    ('cafe', 'bakery'), ('cafe', 'dessert'), ('bakery', 'dessert'),
    ('restaurant', 'beach-shack'),
    ('bar', 'pub'), ('bar', 'brewery'), ('pub', 'brewery'),
    ('beach', 'beach-access'),
    ('sunset-point', 'coastal-viewpoint'), ('sunset-point', 'viewpoint'), ('coastal-viewpoint', 'viewpoint'),
    ('fort', 'heritage-site'), ('heritage-site', 'public-monument'), ('heritage-site', 'historic-precinct'),
    ('museum', 'gallery'),
    ('hostel', 'guesthouse'), ('homestay', 'guesthouse'),
    ('market', 'food-market')
)
insert into public.category_equivalents (category_id, equivalent_category_id)
select ca.id, cb.id
from pairs p
join public.categories ca on ca.slug = p.a
join public.categories cb on cb.slug = p.b;
