-- Grade finalized pool picks from final NFL games and rebuild member standings.

create or replace function public.adjudicate_results(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_graded int := 0;
begin
  with eligible_picks as (
    select
      pp.pool_id,
      pp.user_id,
      pp.week,
      pp.team_abbr,
      coalesce(nullif(po.tie_rule, ''), 'loss') as tie_rule
    from public.pool_picks pp
    join public.pools po on po.id = pp.pool_id
    where coalesce(po.season, p_season) = p_season
      and pp.week = p_week
  ),
  final_games as (
    select
      g.week,
      g.home_team,
      g.away_team,
      g.winner
    from public.nfl_games g
    where g.season = p_season
      and g.week = p_week
      and g.status = 'final'
  ),
  graded as (
    select
      ep.pool_id,
      ep.user_id,
      ep.week,
      ep.team_abbr,
      case
        when fg.winner is null then ep.tie_rule
        when ep.team_abbr = fg.winner then 'win'
        else 'loss'
      end as result
    from eligible_picks ep
    join final_games fg
      on fg.week = ep.week
     and ep.team_abbr in (fg.home_team, fg.away_team)
  ),
  updated as (
    update public.pool_picks pp
       set result = g.result,
           adjudicated_at = now()
      from graded g
     where pp.pool_id = g.pool_id
       and pp.user_id = g.user_id
       and pp.week = g.week
       and pp.team_abbr = g.team_abbr
       and pp.result is distinct from g.result
    returning 1
  )
  select count(*) into v_graded from updated;

  with member_results as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
      count(pp.*) filter (where pp.result = 'win')::int as wins,
      count(pp.*) filter (where pp.result = 'loss')::int as losses,
      count(pp.*) filter (where pp.result = 'push')::int as pushes,
      count(pp.*) filter (where pp.result = 'loss')::int as strikes_used
    from public.pool_members pm
    join public.pools po on po.id = pm.pool_id
    left join public.pool_picks pp
      on pp.pool_id = pm.pool_id
     and pp.user_id = pm.profile_id
     and pp.result is not null
    where coalesce(po.season, p_season) = p_season
    group by pm.pool_id, pm.profile_id, po.strikes_allowed
  ),
  first_elimination as (
    select pool_id, user_id, min(week) as eliminated_week
    from (
      select
        pp.pool_id,
        pp.user_id,
        pp.week,
        coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
        count(*) filter (where pp.result = 'loss') over (
          partition by pp.pool_id, pp.user_id
          order by pp.week
          rows between unbounded preceding and current row
        ) as running_strikes
      from public.pool_picks pp
      join public.pools po on po.id = pp.pool_id
      where coalesce(po.season, p_season) = p_season
        and pp.result is not null
    ) progress
    where running_strikes > strikes_allowed
    group by pool_id, user_id
  )
  insert into public.pool_member_stats (
    pool_id,
    user_id,
    wins,
    losses,
    pushes,
    strikes_used,
    eliminated,
    eliminated_week,
    updated_at
  )
  select
    mr.pool_id,
    mr.user_id,
    mr.wins,
    mr.losses,
    mr.pushes,
    mr.strikes_used,
    mr.strikes_used > mr.strikes_allowed,
    fe.eliminated_week,
    now()
  from member_results mr
  left join first_elimination fe
    on fe.pool_id = mr.pool_id
   and fe.user_id = mr.user_id
  on conflict (pool_id, user_id) do update
  set wins = excluded.wins,
      losses = excluded.losses,
      pushes = excluded.pushes,
      strikes_used = excluded.strikes_used,
      eliminated = excluded.eliminated,
      eliminated_week = excluded.eliminated_week,
      updated_at = excluded.updated_at;

  return coalesce(v_graded, 0);
end;
$function$;

create or replace function public.adjudicate_completed_weeks(p_season integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  week_number int;
  total_graded int := 0;
begin
  for week_number in
    select distinct week
    from public.nfl_games
    where season = p_season
      and status = 'final'
    order by week
  loop
    total_graded := total_graded + public.adjudicate_results(p_season, week_number);
  end loop;

  return total_graded;
end;
$function$;
