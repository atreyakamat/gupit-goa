-- LOCAL DEVELOPMENT ONLY. Applied by `supabase db reset`; never run this on a hosted project.
--
-- These are placeholder records so the app has something to render. They are NOT real
-- listings: names say "Sample", descriptions say so, and the pins are arbitrary points
-- around Panaji. Real places enter through the review queue and the publish checklist.

insert into public.spots
  (slug, name, short_description, primary_category_id, discovery_labels, region, locality, location,
   location_precision, public_access_status, access_notes, safety_notes, search_tags,
   verification_status, verification_method, last_verified_at, published_at, safety_reviewed_at)
select
  'sample-' || s.slug,
  'Sample: ' || s.name,
  'Development placeholder. Not a real listing.',
  (select id from public.categories where slug = s.category),
  s.labels,
  s.region,
  s.locality,
  extensions.st_setsrid(extensions.st_makepoint(s.lng, s.lat), 4326)::extensions.geography,
  'approximate',
  'verified_public',
  'Placeholder access notes.',
  'Placeholder safety notes.',
  s.tags,
  'published',
  'team_visit',
  now(),
  now(),
  now()
from (values
  ('cafe-one', 'Café One', 'cafe', array['lesser_known'], 'central', 'Panaji', 15.4989, 73.8278, array['quiet']),
  ('cafe-two', 'Café Two', 'cafe', array['popular'], 'central', 'Panaji', 15.4935, 73.8310, array[]::text[]),
  ('fort-one', 'Fort One', 'fort', array['iconic'], 'north', 'Sample North', 15.5450, 73.7640, array['sunset']),
  ('beach-one', 'Beach One', 'beach', array['popular'], 'north', 'Sample North', 15.5520, 73.7560, array['family-friendly']),
  ('beach-two', 'Beach Two', 'beach', array['lesser_known'], 'north', 'Sample North', 15.5810, 73.7400, array['quiet']),
  ('market-one', 'Market One', 'market', array['local_favourite'], 'south', 'Sample South', 15.2750, 73.9590, array[]::text[])
) as s (slug, name, category, labels, region, locality, lat, lng, tags)
on conflict (slug) do nothing;
