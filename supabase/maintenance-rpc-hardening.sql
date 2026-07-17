begin;

-- Maintenance/scoring RPCs are run by the protected cron route with the service role.
-- Browser users should not be able to finalize picks or score arbitrary pools/seasons.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'adjudicate_completed_weeks',
        'adjudicate_results',
        'finalize_locked_picks',
        'finalize_locked_picks_for_pool',
        'finalize_no_pick_losses',
        'finalize_picks_week',
        'finalize_week_picks'
      ])
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('revoke execute on function %s from authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

commit;
