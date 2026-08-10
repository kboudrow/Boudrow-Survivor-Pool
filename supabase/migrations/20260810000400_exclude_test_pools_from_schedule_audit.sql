create or replace function public.superadmin_schedule_integrity_audit(p_season integer default null)
returns table (
  season integer,
  week integer,
  game_count integer,
  duplicate_event_count integer,
  future_result_count integer,
  final_missing_winner_count integer,
  invalid_winner_count integer,
  duplicate_team_count integer,
  future_pick_result_count integer,
  team_appearance_count integer,
  issue_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then raise exception 'not authorized'; end if;

  return query
  with games as (
    select g.season, g.week, g.id, g.espn_event_id, g.home_team, g.away_team,
           g.status, g.winner, g.home_score, g.away_score,
           coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at
    from public.nfl_games g
    where p_season is null or g.season = p_season
  ),
  week_counts as (
    select games.season, games.week,
      count(*)::integer as game_count,
      count(distinct coalesce(nullif(games.espn_event_id, ''), games.id::text))::integer as distinct_event_count,
      count(*) filter (
        where games.kickoff_at > now() and (
          coalesce(games.status, 'scheduled') <> 'scheduled' or games.winner is not null
          or games.home_score is not null or games.away_score is not null
        )
      )::integer as future_result_count,
      count(*) filter (
        where games.status = 'final' and games.winner is null
          and not (games.home_score is not null and games.away_score is not null and games.home_score = games.away_score)
      )::integer as final_missing_winner_count,
      count(*) filter (
        where games.status = 'final' and games.winner is not null
          and games.winner not in (games.home_team, games.away_team)
      )::integer as invalid_winner_count
    from games
    group by games.season, games.week
  ),
  team_counts as (
    select teams.season, teams.week, count(*)::integer as team_appearance_count
    from (
      select games.season, games.week, games.home_team as team from games
      union all
      select games.season, games.week, games.away_team as team from games
    ) teams
    where nullif(teams.team, '') is not null
    group by teams.season, teams.week
  ),
  duplicate_teams as (
    select teams.season, teams.week,
           (count(*) - count(distinct teams.team))::integer as duplicate_team_count
    from (
      select games.season, games.week, games.home_team as team from games
      union all
      select games.season, games.week, games.away_team as team from games
    ) teams
    where nullif(teams.team, '') is not null
    group by teams.season, teams.week
  ),
  future_pick_results as (
    select games.season, games.week,
      count(distinct (pick.pool_id, pick.entry_id, pick.week, pick.slot))::integer as future_pick_result_count
    from public.pool_picks pick
    join public.pools pool on pool.id = pick.pool_id
    join games
      on games.week = pick.week
     and pick.team_abbr in (games.home_team, games.away_team)
     and (pool.season is null or pool.season = games.season)
    where pick.result is not null
      and games.kickoff_at > now()
      and not coalesce(pool.test_mode, false)
    group by games.season, games.week
  )
  select
    wc.season, wc.week, wc.game_count,
    greatest(wc.game_count - wc.distinct_event_count, 0)::integer,
    wc.future_result_count,
    wc.final_missing_winner_count,
    wc.invalid_winner_count,
    coalesce(dt.duplicate_team_count, 0)::integer,
    coalesce(fpr.future_pick_result_count, 0)::integer,
    coalesce(tc.team_appearance_count, 0)::integer,
    (
      case when wc.game_count > 16 then 1 else 0 end
      + case when wc.game_count < 12 then 1 else 0 end
      + case when greatest(wc.game_count - wc.distinct_event_count, 0) > 0 then 1 else 0 end
      + case when wc.future_result_count > 0 then 1 else 0 end
      + case when wc.final_missing_winner_count > 0 then 1 else 0 end
      + case when wc.invalid_winner_count > 0 then 1 else 0 end
      + case when coalesce(dt.duplicate_team_count, 0) > 0 then 1 else 0 end
      + case when coalesce(fpr.future_pick_result_count, 0) > 0 then 1 else 0 end
      + case when coalesce(tc.team_appearance_count, 0) <> wc.game_count * 2 then 1 else 0 end
    )::integer
  from week_counts wc
  left join team_counts tc on tc.season = wc.season and tc.week = wc.week
  left join duplicate_teams dt on dt.season = wc.season and dt.week = wc.week
  left join future_pick_results fpr on fpr.season = wc.season and fpr.week = wc.week
  order by wc.season desc, wc.week;
end;
$function$;

revoke execute on function public.superadmin_schedule_integrity_audit(integer) from public, anon;
grant execute on function public.superadmin_schedule_integrity_audit(integer) to authenticated, service_role;
