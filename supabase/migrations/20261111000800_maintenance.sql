-- Scheduled maintenance. These run inside the database (for example with pg_cron), not from
-- the research worker, so the worker keeps having no way to change a place.
--
-- To schedule on a hosted project (run once in the SQL editor, after enabling pg_cron):
--   select cron.schedule('gupit-mark-stale', '15 2 * * *', $$select private.mark_stale_listings()$$);
--   select cron.schedule('gupit-purge-crowd', '45 2 * * *', $$select private.purge_old_crowd_reports()$$);

-- Freshness: a listing nobody has re-verified for a while is labelled "Details need rechecking".
-- It stays visible (with that label) and drops in Try-instead ranking until a reviewer confirms it.
create function private.mark_stale_listings(p_max_age interval default interval '180 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with changed as (
    update public.spots
       set verification_status = 'stale'
     where verification_status = 'published'
       and last_verified_at < now() - p_max_age
    returning id, last_verified_at
  ),
  logged as (
    insert into public.admin_audit_logs (actor_user_id, action, entity_type, entity_id, before_snapshot, after_snapshot, reason)
    select null, 'spot.auto_mark_stale', 'spot', c.id::text,
           jsonb_build_object('verification_status', 'published', 'last_verified_at', c.last_verified_at),
           jsonb_build_object('verification_status', 'stale'),
           'Not re-verified within ' || p_max_age::text
    from changed c
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

revoke all on function private.mark_stale_listings(interval) from public, anon, authenticated;
revoke all on function private.purge_old_crowd_reports() from public, anon, authenticated;
