drop function if exists public.superadmin_schedule_integrity_audit(integer);

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
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with games as (
    select
      g.season,
      g.week,
      g.id,
      g.espn_event_id,
      g.home_team,
      g.away_team,
      g.status,
      g.winner,
      g.home_score,
      g.away_score,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at
    from public.nfl_games g
    where p_season is null or g.season = p_season
  ),
  week_counts as (
    select
      g.season,
      g.week,
      count(*)::integer as game_count,
      count(distinct nullif(g.espn_event_id, ''))::integer as distinct_event_count,
      count(*) filter (
        where g.kickoff_at > now()
          and (
            coalesce(g.status, 'scheduled') <> 'scheduled'
            or g.winner is not null
            or g.home_score is not null
            or g.away_score is not null
          )
      )::integer as future_result_count,
      count(*) filter (
        where g.status = 'final'
          and g.winner is null
          and not (g.home_score is not null and g.away_score is not null and g.home_score = g.away_score)
      )::integer as final_missing_winner_count,
      count(*) filter (
        where g.status = 'final'
          and g.winner is not null
          and g.winner not in (g.home_team, g.away_team)
      )::integer as invalid_winner_count
    from games g
    group by g.season, g.week
  ),
  team_counts as (
    select
      t.season,
      t.week,
      count(*)::integer as team_appearance_count
    from (
      select g.season, g.week, g.home_team as team from games g
      union all
      select g.season, g.week, g.away_team as team from games g
    ) t
    where nullif(t.team, '') is not null
    group by t.season, t.week
  ),
  duplicate_teams as (
    select
      t.season,
      t.week,
      (count(*) - count(distinct t.team))::integer as duplicate_team_count
    from (
      select g.season, g.week, g.home_team as team from games g
      union all
      select g.season, g.week, g.away_team as team from games g
    ) t
    where nullif(t.team, '') is not null
    group by t.season, t.week
  ),
  future_pick_results as (
    select
      g.season,
      g.week,
      count(distinct (pp.pool_id, pp.entry_id, pp.week, pp.slot))::integer as future_pick_result_count
    from public.pool_picks pp
    join public.pools po
      on po.id = pp.pool_id
    join games g
      on g.week = pp.week
     and pp.team_abbr in (g.home_team, g.away_team)
     and (po.season is null or po.season = g.season)
    where pp.result is not null
      and g.kickoff_at > now()
    group by g.season, g.week
  )
  select
    wc.season,
    wc.week,
    wc.game_count,
    greatest(wc.game_count - wc.distinct_event_count, 0)::integer as duplicate_event_count,
    wc.future_result_count,
    wc.final_missing_winner_count,
    wc.invalid_winner_count,
    coalesce(dt.duplicate_team_count, 0)::integer as duplicate_team_count,
    coalesce(fpr.future_pick_result_count, 0)::integer as future_pick_result_count,
    coalesce(tc.team_appearance_count, 0)::integer as team_appearance_count,
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
    )::integer as issue_count
  from week_counts wc
  left join team_counts tc
    on tc.season = wc.season
   and tc.week = wc.week
  left join duplicate_teams dt
    on dt.season = wc.season
   and dt.week = wc.week
  left join future_pick_results fpr
    on fpr.season = wc.season
   and fpr.week = wc.week
  order by wc.season desc, wc.week;
end;
$function$;
