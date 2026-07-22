begin;

drop function if exists public.superadmin_score_feed_health(integer);

create or replace function public.superadmin_score_feed_health(p_season integer default null)
returns table (
  season integer,
  week integer,
  total_games integer,
  final_games integer,
  in_progress_games integer,
  scheduled_games integer,
  missing_scores integer,
  final_missing_winner_count integer,
  stale_games integer,
  latest_kickoff_at timestamptz,
  latest_final_kickoff_at timestamptz,
  latest_sync_at timestamptz,
  issue_count integer
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
  with latest_sync as (
    select max(l.created_at) as synced_at
    from public.app_event_logs l
    where l.source = 'cron'
      and l.event_type in (
        'cron_score_sync_completed',
        'cron_score_sync_completed_with_errors',
        'cron_score_sync_failed'
      )
  ),
  games as (
    select
      g.season,
      g.week,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at,
      coalesce(g.status, 'scheduled') as status,
      g.winner,
      g.home_score,
      g.away_score
    from public.nfl_games g
    where p_season is null or g.season = p_season
  ),
  weekly as (
    select
      g.season,
      g.week,
      count(*)::integer as total_games,
      count(*) filter (where g.status = 'final')::integer as final_games,
      count(*) filter (where g.status = 'in_progress')::integer as in_progress_games,
      count(*) filter (where g.status = 'scheduled')::integer as scheduled_games,
      count(*) filter (
        where g.status in ('final', 'in_progress')
          and (g.home_score is null or g.away_score is null)
      )::integer as missing_scores,
      count(*) filter (
        where g.status = 'final'
          and g.winner is null
          and not (g.home_score is not null and g.away_score is not null and g.home_score = g.away_score)
      )::integer as final_missing_winner_count,
      count(*) filter (
        where g.status <> 'final'
          and g.kickoff_at < now() - interval '4 hours'
      )::integer as stale_games,
      max(g.kickoff_at)::timestamptz as latest_kickoff_at,
      max(g.kickoff_at) filter (where g.status = 'final')::timestamptz as latest_final_kickoff_at
    from games g
    group by g.season, g.week
  )
  select
    w.season,
    w.week,
    w.total_games,
    w.final_games,
    w.in_progress_games,
    w.scheduled_games,
    w.missing_scores,
    w.final_missing_winner_count,
    w.stale_games,
    w.latest_kickoff_at,
    w.latest_final_kickoff_at,
    ls.synced_at as latest_sync_at,
    (
      case when w.total_games > 16 then 1 else 0 end
      + case when w.total_games < 12 then 1 else 0 end
      + case when w.missing_scores > 0 then 1 else 0 end
      + case when w.final_missing_winner_count > 0 then 1 else 0 end
      + case when w.stale_games > 0 then 1 else 0 end
    )::integer as issue_count
  from weekly w
  cross join latest_sync ls
  order by w.season desc, w.week;
end;
$function$;

revoke execute on function public.superadmin_score_feed_health(integer) from public, anon;
grant execute on function public.superadmin_score_feed_health(integer) to authenticated, service_role;

commit;
