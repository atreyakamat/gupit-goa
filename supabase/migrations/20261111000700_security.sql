-- Row Level Security, privileges and storage.
--
-- Model
--   anon / authenticated guests : no table access at all; public RPCs only.
--   authenticated admins        : read-only table access through RLS; writes through admin_* RPCs.
--   service_role (worker)       : worker_* RPCs; bypasses RLS by Supabase design.
--
-- NOTE FOR FUTURE MIGRATIONS: new functions are not executable by app roles by default.
-- Grant each one explicitly, as below.

-- ---------------------------------------------------------------------------
-- RLS on every table in public
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
    execute format('grant select on table public.%I to authenticated', t.tablename);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_admin()))',
      'admins_read_' || t.tablename, t.tablename);
    execute format('grant all on table public.%I to service_role', t.tablename);
  end loop;
end;
$$;

grant usage, select on all sequences in schema public to service_role;

-- RLS policies evaluate private.is_admin() as the calling role.
grant usage on schema private to authenticated;
revoke all on all tables in schema private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Function privileges: start from nothing, then grant by audience
-- ---------------------------------------------------------------------------
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
  end loop;
end;
$$;

grant execute on function private.is_admin() to authenticated;

-- Guest API
grant execute on function
  public.list_categories(),
  public.nearby_spots(double precision, double precision, double precision, jsonb, integer, integer),
  public.spots_in_bbox(double precision, double precision, double precision, double precision, jsonb, integer),
  public.search_spots(text, jsonb, integer, integer, double precision, double precision),
  public.get_spot_detail(text),
  public.get_crowd_status(uuid),
  public.submit_crowd_report(uuid, integer, double precision, double precision, text),
  public.get_spot_alternatives(uuid, double precision, integer),
  public.submit_spot_problem(uuid, text, text, text),
  public.track_events(jsonb, text, text, text),
  public.track_partner_enquiry(uuid, uuid, text, text),
  public.link_partner_device(text, text)
to anon, authenticated;

-- Admin API (each function re-checks the allowlist)
grant execute on function
  public.am_i_admin(),
  public.admin_get_spot(uuid),
  public.admin_save_spot(uuid, jsonb, text),
  public.admin_set_spot_status(uuid, text, text),
  public.admin_save_media(uuid, uuid, jsonb),
  public.admin_delete_media(uuid),
  public.admin_reorder_media(uuid, uuid[]),
  public.admin_save_source(uuid, jsonb),
  public.admin_delete_source(uuid),
  public.admin_get_candidate(uuid),
  public.admin_save_candidate(uuid, jsonb),
  public.admin_add_lead(text, text, text),
  public.admin_flag_candidate(uuid, text, text, text, text),
  public.admin_decide_candidate(uuid, text, text, uuid, uuid),
  public.admin_save_partner(uuid, jsonb),
  public.admin_issue_partner_claim_code(uuid),
  public.admin_resolve_user_report(uuid, text, text),
  public.admin_set_research_adapter(text, boolean, text),
  public.admin_set_domain_rule(text, text, text),
  public.admin_enqueue_research_job(text, text, text),
  public.admin_dashboard(),
  public.admin_analytics_summary(integer)
to authenticated;

-- Worker API
grant execute on function
  public.worker_get_config(),
  public.worker_enqueue_jobs(jsonb),
  public.worker_claim_job(text),
  public.worker_finish_job(uuid, boolean, text, jsonb, integer),
  public.worker_log_event(uuid, text, text, text, jsonb),
  public.worker_heartbeat(text, text, jsonb),
  public.worker_upsert_candidate(jsonb)
to service_role;

-- ---------------------------------------------------------------------------
-- Storage: listing photos. Public read by URL; only admins can write or list.
-- Only rights-cleared media is ever linked from a public place page.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spot-media', 'spot-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy spot_media_admin_select on storage.objects
  for select to authenticated
  using (bucket_id = 'spot-media' and (select private.is_admin()));

create policy spot_media_admin_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'spot-media' and (select private.is_admin()));

create policy spot_media_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'spot-media' and (select private.is_admin()))
  with check (bucket_id = 'spot-media' and (select private.is_admin()));

create policy spot_media_admin_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'spot-media' and (select private.is_admin()));
