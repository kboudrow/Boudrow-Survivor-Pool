begin;

drop function if exists public.superadmin_cron_health();

create or replace function public.superadmin_cron_health()
returns table (
  job_name text,
  route text,
  expected_every_minutes integer,
  live_every_minutes integer,
  fallback_every_minutes integer,
  current_cadence text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  latest_severity text,
  latest_message text,
  latest_metadata jsonb,
  minutes_since_success integer,
  next_expected_at timestamptz,
  live_next_expected_at timestamptz,
  status text,
  health_note text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with jobs as (
    select *
    from (values
      (
        'Score sync'::text,
        '/api/cron/sync-scores'::text,
        10::integer,
        1440::integer,
        array['cron_score_sync_completed', 'cron_score_sync_completed_with_errors', 'cron_score_sync_failed', 'cron_score_sync_finalize_failed', 'cron_score_sync_adjudicate_failed']::text[],
        array['cron_score_sync_completed']::text[],
        array['cron_score_sync_failed', 'cron_score_sync_finalize_failed', 'cron_score_sync_adjudicate_failed']::text[]
      ),
      (
        'Pick locking'::text,
        '/api/cron/lock-picks'::text,
        5::integer,
        1440::integer,
        array['cron_lock_picks_completed', 'cron_lock_picks_completed_with_errors', 'cron_pool_load_failed', 'cron_finalize_pool_failed', 'cron_adjudicate_season_failed']::text[],
        array['cron_lock_picks_completed']::text[],
        array['cron_pool_load_failed', 'cron_finalize_pool_failed', 'cron_adjudicate_season_failed']::text[]
      )
    ) as j(job_name, route, live_every_minutes, fallback_every_minutes, event_types, success_types, error_types)
  ),
  latest as (
    select distinct on (j.job_name)
      j.job_name,
      l.created_at,
      l.severity,
      l.message,
      l.metadata,
      l.event_type
    from jobs j
    left join public.app_event_logs l
      on l.source = 'cron'
      and l.event_type = any(j.event_types)
    order by j.job_name, l.created_at desc nulls last
  ),
  success as (
    select
      j.job_name,
      max(l.created_at) as created_at
    from jobs j
    left join public.app_event_logs l
      on l.source = 'cron'
      and l.event_type = any(j.success_types)
    group by j.job_name
  ),
  errors as (
    select
      j.job_name,
      max(l.created_at) as created_at
    from jobs j
    left join public.app_event_logs l
      on l.source = 'cron'
      and (
        l.event_type = any(j.error_types)
        or (
          l.event_type = any(j.event_types)
          and l.severity = 'error'
        )
      )
    group by j.job_name
  )
  select
    j.job_name,
    j.route,
    j.fallback_every_minutes as expected_every_minutes,
    j.live_every_minutes,
    j.fallback_every_minutes,
    'daily fallback'::text as current_cadence,
    latest.created_at as last_run_at,
    success.created_at as last_success_at,
    errors.created_at as last_error_at,
    coalesce(latest.severity, 'warning') as latest_severity,
    latest.message as latest_message,
    coalesce(latest.metadata, '{}'::jsonb) as latest_metadata,
    case
      when success.created_at is null then null
      else floor(extract(epoch from (now() - success.created_at)) / 60)::integer
    end as minutes_since_success,
    case
      when success.created_at is null then null
      else success.created_at + make_interval(mins => j.fallback_every_minutes)
    end as next_expected_at,
    case
      when success.created_at is null then null
      else success.created_at + make_interval(mins => j.live_every_minutes)
    end as live_next_expected_at,
    case
      when success.created_at is null then 'missing'
      when errors.created_at is not null and errors.created_at > success.created_at then 'error'
      when latest.severity = 'warning' then 'warning'
      when now() > success.created_at + make_interval(mins => j.fallback_every_minutes * 2) then 'late'
      else 'healthy'
    end as status,
    case
      when success.created_at is null then 'No successful run has been recorded yet.'
      when errors.created_at is not null and errors.created_at > success.created_at then 'The latest recorded cron event failed after the last success.'
      when latest.severity = 'warning' then 'The latest run completed with warnings. Review the run summary.'
      when now() > success.created_at + make_interval(mins => j.fallback_every_minutes * 2) then 'The daily fallback appears overdue. Check Vercel cron history or the external scheduler.'
      else 'Daily fallback is current. Use Vercel Pro or an external scheduler for live game-day cadence.'
    end as health_note
  from jobs j
  left join latest on latest.job_name = j.job_name
  left join success on success.job_name = j.job_name
  left join errors on errors.job_name = j.job_name
  order by j.job_name;
end;
$function$;

revoke execute on function public.superadmin_cron_health() from public, anon;
grant execute on function public.superadmin_cron_health() to authenticated, service_role;

commit;
