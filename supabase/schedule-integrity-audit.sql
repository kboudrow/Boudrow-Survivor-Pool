create or replace function public.superadmin_schedule_integrity_audit(p_season integer default null)
returns table (
  season integer,
  week integer,
  game_count integer,
  duplicate_event_count integer,
  future_result_count integer,
  final_missing_winner_count integer,
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
      g.espn_game_id,
      g.home_team,
      g.away_team,
      g.status,
      g.winner,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at
    from public.nfl_games g
    where p_season is null or g.season = p_season
  ),
  week_counts as (
    select
      g.season,
      g.week,
      count(*)::integer as game_count,
      count(distinct nullif(g.espn_game_id, ''))::integer as distinct_event_count,
      count(*) filter (
        where g.kickoff_at > now()
          and (
            coalesce(g.status, 'scheduled') <> 'scheduled'
            or g.winner is not null
          )
      )::integer as future_result_count,
      count(*) filter (
        where g.status = 'final'
          and g.winner is null
      )::integer as final_missing_winner_count
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
  )
  select
    wc.season,
    wc.week,
    wc.game_count,
    greatest(wc.game_count - wc.distinct_event_count, 0)::integer as duplicate_event_count,
    wc.future_result_count,
    wc.final_missing_winner_count,
    coalesce(tc.team_appearance_count, 0)::integer as team_appearance_count,
    (
      case when wc.game_count > 16 then 1 else 0 end
      + case when wc.game_count < 12 then 1 else 0 end
      + case when greatest(wc.game_count - wc.distinct_event_count, 0) > 0 then 1 else 0 end
      + case when wc.future_result_count > 0 then 1 else 0 end
      + case when wc.final_missing_winner_count > 0 then 1 else 0 end
      + case when coalesce(tc.team_appearance_count, 0) <> wc.game_count * 2 then 1 else 0 end
    )::integer as issue_count
  from week_counts wc
  left join team_counts tc
    on tc.season = wc.season
   and tc.week = wc.week
  order by wc.season desc, wc.week;
end;
$function$;
