-- Creator posts linked to a place.
--
-- A reviewer pastes the link to a public Instagram post or reel, the creator's handle and a
-- one-line note in their own words. The app shows a tagged card that opens the post in
-- Instagram. Nothing is fetched or copied from Instagram: no captions, images or video.
-- Reusing a creator's photo in the app is a separate step (spot_media, with permission
-- recorded in rights_status / rights_evidence_url and the creator credited in credit_line).

create table public.spot_social_posts (
  id uuid primary key default gen_random_uuid(),
  spot_id uuid not null references public.spots (id) on delete cascade,
  platform text not null default 'instagram' check (platform in ('instagram')),
  post_url text not null
    check (post_url ~ '^https://www\.instagram\.com/(p|reel|reels|tv)/[A-Za-z0-9_-]+/$'),
  creator_handle text check (creator_handle ~ '^[a-z0-9._]{1,30}$'),
  note text check (char_length(note) <= 140),
  sort_order integer not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (spot_id, post_url)
);
create index spot_social_posts_spot_idx on public.spot_social_posts (spot_id, sort_order);

alter table public.spot_social_posts enable row level security;
revoke all on table public.spot_social_posts from anon, authenticated;
grant select on table public.spot_social_posts to authenticated;
grant all on table public.spot_social_posts to service_role;
create policy admins_read_spot_social_posts on public.spot_social_posts
  for select to authenticated using ((select private.is_admin()));

-- Public: posts for a place that is itself public.
create function public.get_spot_social_posts(p_spot_id uuid)
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
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'platform', p.platform, 'url', p.post_url,
             'creator_handle', p.creator_handle, 'note', p.note)
           order by p.sort_order, p.created_at)
    from public.spot_social_posts p
    where p.spot_id = s.id), '[]'::jsonb);
end;
$$;

create function public.admin_save_social_post(p_spot_id uuid, p_url text, p_handle text default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin();
  v_url text;
  v_handle text := nullif(lower(regexp_replace(trim(coalesce(p_handle, '')), '^@', '')), '');
  v_row public.spot_social_posts;
begin
  -- Drop tracking parameters and normalise the host, then insist on a post or reel link.
  v_url := regexp_replace(trim(coalesce(p_url, '')), '[?#].*$', '');
  v_url := regexp_replace(v_url, '^https?://(www\.|m\.)?instagram\.com', 'https://www.instagram.com', 'i');
  if v_url !~ '/$' then
    v_url := v_url || '/';
  end if;
  if v_url !~ '^https://www\.instagram\.com/(p|reel|reels|tv)/[A-Za-z0-9_-]+/$' then
    raise exception 'invalid_instagram_post_url' using errcode = '22023';
  end if;
  if v_handle is not null and v_handle !~ '^[a-z0-9._]{1,30}$' then
    raise exception 'invalid_instagram_handle' using errcode = '22023';
  end if;
  if not exists (select 1 from public.spots where id = p_spot_id) then
    raise exception 'spot_not_found' using errcode = 'P0002';
  end if;

  insert into public.spot_social_posts (spot_id, post_url, creator_handle, note, sort_order, created_by)
  values (p_spot_id, v_url, v_handle, nullif(left(trim(coalesce(p_note, '')), 140), ''),
          coalesce((select max(sort_order) + 1 from public.spot_social_posts where spot_id = p_spot_id), 0),
          v_uid)
  on conflict (spot_id, post_url) do update
    set creator_handle = excluded.creator_handle, note = excluded.note
  returning * into v_row;

  perform private.audit('social_post.save', 'spot_social_post', v_row.id::text, null, to_jsonb(v_row));
  return v_row.id;
end;
$$;

create function public.admin_delete_social_post(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.spot_social_posts;
begin
  perform private.require_admin();
  delete from public.spot_social_posts p where p.id = p_id returning * into v_row;
  if v_row.id is null then
    raise exception 'social_post_not_found' using errcode = 'P0002';
  end if;
  perform private.audit('social_post.delete', 'spot_social_post', p_id::text, to_jsonb(v_row), null);
end;
$$;

revoke all on function
  public.get_spot_social_posts(uuid),
  public.admin_save_social_post(uuid, text, text, text),
  public.admin_delete_social_post(uuid)
from public, anon, authenticated;

grant execute on function public.get_spot_social_posts(uuid) to anon, authenticated;
grant execute on function
  public.admin_save_social_post(uuid, text, text, text),
  public.admin_delete_social_post(uuid)
to authenticated;
grant execute on function
  public.get_spot_social_posts(uuid),
  public.admin_save_social_post(uuid, text, text, text),
  public.admin_delete_social_post(uuid)
to service_role;
