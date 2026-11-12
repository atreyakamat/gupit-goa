-- Optional accounts.
--
-- Browsing, saving and crowd reports never need an account. Signing in does one thing:
-- it backs saved places up so they follow the person to another phone.
--
-- Privacy model
--   * Only (user, list name, place) is stored. No location, no device identifier.
--   * No role can read this table through the API, reviewers included. Access is only
--     through the two functions below, which act on auth.uid() and nobody else.
--   * delete_my_account() removes the account and everything attached to it.

create table public.user_saved_spots (
  user_id uuid not null references auth.users (id) on delete cascade,
  list_name text not null check (char_length(list_name) between 1 and 40),
  spot_id uuid not null references public.spots (id) on delete cascade,
  added_at timestamptz not null default now()
);
create unique index user_saved_spots_uidx
  on public.user_saved_spots (user_id, lower(list_name), spot_id);
create index user_saved_spots_spot_idx on public.user_saved_spots (spot_id);

alter table public.user_saved_spots enable row level security;
-- No policies on purpose: with RLS on and no policy, API roles see and write nothing.
revoke all on table public.user_saved_spots from public, anon, authenticated;
grant all on table public.user_saved_spots to service_role;

-- ---------------------------------------------------------------------------
-- sync_saved_spots: apply removals, then additions, then return the full set.
-- Items are [{ "list_name": text, "spot_id": uuid }]. Bad entries are skipped,
-- so one stale row on a phone can never block a sync.
-- ---------------------------------------------------------------------------
create function public.sync_saved_spots(p_add jsonb default '[]', p_remove jsonb default '[]')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_add jsonb := case when jsonb_typeof(p_add) = 'array' then p_add else '[]'::jsonb end;
  v_remove jsonb := case when jsonb_typeof(p_remove) = 'array' then p_remove else '[]'::jsonb end;
  v_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_user is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  if jsonb_array_length(v_add) > 500 or jsonb_array_length(v_remove) > 500 then
    raise exception 'too_many_items' using errcode = '22023';
  end if;

  delete from public.user_saved_spots s
  using (
    select lower(trim(item ->> 'list_name')) as list_key, (item ->> 'spot_id')::uuid as spot_id
    from jsonb_array_elements(v_remove) as item
    where jsonb_typeof(item) = 'object'
      and (item ->> 'spot_id') ~ v_uuid
      and char_length(trim(coalesce(item ->> 'list_name', ''))) between 1 and 40
  ) r
  where s.user_id = v_user and lower(s.list_name) = r.list_key and s.spot_id = r.spot_id;

  insert into public.user_saved_spots (user_id, list_name, spot_id)
  select distinct on (lower(a.list_name), a.spot_id) v_user, a.list_name, a.spot_id
  from (
    select trim(item ->> 'list_name') as list_name, (item ->> 'spot_id')::uuid as spot_id
    from jsonb_array_elements(v_add) as item
    where jsonb_typeof(item) = 'object'
      and (item ->> 'spot_id') ~ v_uuid
      and char_length(trim(coalesce(item ->> 'list_name', ''))) between 1 and 40
  ) a
  join public.spots sp on sp.id = a.spot_id and private.is_public_spot(sp)
  on conflict (user_id, lower(list_name), spot_id) do nothing;

  -- A hard ceiling per account keeps the table bounded; the oldest rows go first.
  delete from public.user_saved_spots s
  where s.user_id = v_user
    and (s.list_name, s.spot_id) in (
      select o.list_name, o.spot_id from public.user_saved_spots o
      where o.user_id = v_user
      order by o.added_at desc, o.spot_id offset 2000);

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'list_name', s.list_name, 'spot_id', s.spot_id, 'slug', sp.slug, 'added_at', s.added_at)
      order by s.added_at, sp.slug)
    from public.user_saved_spots s
    join public.spots sp on sp.id = s.spot_id and private.is_public_spot(sp)
    where s.user_id = v_user
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_my_account: in-app account deletion (also a store listing requirement).
-- Reviewer accounts are created and removed by hand, never from the app.
-- ---------------------------------------------------------------------------
create function public.delete_my_account()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'sign_in_required' using errcode = '42501';
  end if;
  if exists (select 1 from public.admins a where a.user_id = v_user) then
    raise exception 'reviewer_account' using errcode = '42501';
  end if;
  delete from public.user_saved_spots where user_id = v_user;
  delete from auth.users where id = v_user;
end;
$$;

revoke all on function public.sync_saved_spots(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.sync_saved_spots(jsonb, jsonb) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
