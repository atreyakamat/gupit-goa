-- Gupit Goa: foundation.
-- Extensions live in the dedicated `extensions` schema (never in `public`).
-- `private` holds helpers and secrets; it is not exposed through the Data API.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- Nothing in `public` is reachable by app clients unless a later migration grants it.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin allowlist
-- ---------------------------------------------------------------------------
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now()
);
comment on table public.admins is
  'Allowlisted reviewers. Rows are added by hand with the service role; there is no client write path.';

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

create function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-side secrets (never readable by clients)
-- ---------------------------------------------------------------------------
create table private.app_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Key used to hash app-installation tokens. Generated inside the database so it
-- never appears in source control, the mobile bundle or a dashboard.
insert into private.app_secrets (key, value)
values ('installation_hmac_key', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create function private.installation_hash(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'invalid_installation_token' using errcode = '22023';
  end if;
  select value into v_key from private.app_secrets where key = 'installation_hmac_key';
  if v_key is null then
    raise exception 'installation_hmac_key_missing';
  end if;
  return encode(extensions.hmac(p_token, v_key, 'sha256'), 'hex');
end;
$$;

-- ---------------------------------------------------------------------------
-- Small utilities
-- ---------------------------------------------------------------------------
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function private.normalize_text(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p_text, '')));
$$;

create function private.slugify(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select trim(both '-' from regexp_replace(private.normalize_text(p_text), '[^a-z0-9]+', '-', 'g'));
$$;

create function private.jsonb_text_array(p_json jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(x), '{}'::text[])
  from jsonb_array_elements_text(
    case when jsonb_typeof(p_json) = 'array' then p_json else '[]'::jsonb end
  ) as x;
$$;

-- Search tokens: lower-case, accent-free, stop words removed, naive plural stemming.
-- Output only ever contains [a-z0-9], so tokens are safe inside LIKE patterns.
create function private.search_tokens(p_query text)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct tok), '{}'::text[])
  from (
    select case
             when w ~ 'ies$' and length(w) > 4 then regexp_replace(w, 'ies$', 'y')
             when w ~ '(ch|sh|ss|x)es$' then regexp_replace(w, 'es$', '')
             when w ~ 's$' and w !~ 'ss$' and length(w) > 3 then regexp_replace(w, 's$', '')
             else w
           end as tok
    from regexp_split_to_table(
           regexp_replace(private.normalize_text(left(coalesce(p_query, ''), 120)), '[^a-z0-9]+', ' ', 'g'),
           '\s+'
         ) as w
    where length(w) >= 2
      and w not in (
        'in', 'at', 'on', 'of', 'to', 'do', 'the', 'and', 'for', 'near', 'nearby', 'me', 'my',
        'goa', 'place', 'places', 'thing', 'things', 'best', 'good', 'top', 'with', 'around'
      )
  ) t
  where length(tok) >= 2;
$$;
