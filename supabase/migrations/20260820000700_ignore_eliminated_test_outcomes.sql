begin;

-- Retained drafts and picks belonging to eliminated entries are historical
-- evidence. They must not make a game require an outcome in later weeks.
create or replace function public.superadmin_test_pool_week_options(p_pool_id uuid, p_week integer)
returns table (
  game_id text, season integer, week integer, away_team text, home_team text,
  game_time timestamptz, away_pick_count integer, home_pick_count integer,
  total_pick_count integer, fake_outcome text, needs_outcome boolean
)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1), public.pool_max_pick_week(p_pool_id)
    into v_start_week, v_max_week
  from public.pools p where p.id = p_pool_id;

  if p_week < v_start_week or p_week > coalesce(v_max_week, 18) then
    raise exception 'Week must be between this pool''s start week (%) and Week %.', v_start_week, coalesce(v_max_week, 18);
  end if;
  if p_week > 18 then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  end if;

  return query
  with pick_counts as (
    select picked_teams.team_abbr, count(*)::integer as pick_count
    from (
      select d.team_abbr
      from public.pool_pick_drafts d
      join public.pool_members pm on pm.pool_id = d.pool_id and pm.id = d.entry_id
      left join public.pool_member_stats stats on stats.pool_id = d.pool_id and stats.entry_id = d.entry_id
      where d.pool_id = p_pool_id and d.week = p_week and d.team_abbr not like 'NO_PICK%'
        and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
        and coalesce(stats.eliminated, false) = false
      union all
      select pp.team_abbr
      from public.pool_picks pp
      join public.pool_members pm on pm.pool_id = pp.pool_id and pm.id = pp.entry_id
      left join public.pool_member_stats stats on stats.pool_id = pp.pool_id and stats.entry_id = pp.entry_id
      where pp.pool_id = p_pool_id and pp.week = p_week and pp.team_abbr not like 'NO_PICK%'
        and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
        and coalesce(stats.eliminated, false) = false
    ) picked_teams
    group by picked_teams.team_abbr
  )
  select
    g.id as game_id, g.season, g.week, g.away_team, g.home_team,
    coalesce(g.kickoff_at_utc, g.game_time) as game_time,
    coalesce(away_counts.pick_count, 0)::integer as away_pick_count,
    coalesce(home_counts.pick_count, 0)::integer as home_pick_count,
    (coalesce(away_counts.pick_count, 0) + coalesce(home_counts.pick_count, 0))::integer as total_pick_count,
    outcome.fake_outcome,
    ((coalesce(away_counts.pick_count, 0) + coalesce(home_counts.pick_count, 0)) > 0 and outcome.fake_outcome is null)::boolean as needs_outcome
  from public.pool_week_games(p_pool_id, p_week) g
  left join pick_counts away_counts on away_counts.team_abbr = g.away_team
  left join pick_counts home_counts on home_counts.team_abbr = g.home_team
  left join lateral (
    select public.test_pool_game_outcome(p_pool_id, p_week, g.home_team, g.away_team) as fake_outcome
  ) outcome on true
  order by coalesce(g.kickoff_at_utc, g.game_time), g.away_team, g.home_team;
end;
$function$;

revoke execute on function public.superadmin_test_pool_week_options(uuid, integer) from public, anon;
grant execute on function public.superadmin_test_pool_week_options(uuid, integer) to authenticated, service_role;

commit;
