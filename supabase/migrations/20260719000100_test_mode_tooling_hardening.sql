begin;

create or replace function public.superadmin_set_test_pool_week(
  p_pool_id uuid,
  p_week integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1)
    into v_start_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > 18 then
    raise exception 'Week must be between this pool''s start week (%) and Week 18.', v_start_week;
  end if;

  update public.pools
     set test_current_week = p_week
   where id = p_pool_id;

  return 'Test week set to Week ' || p_week || '.';
end;
$function$;

drop function if exists public.superadmin_test_pool_week_options(uuid, integer);

create function public.superadmin_test_pool_week_options(
  p_pool_id uuid,
  p_week integer
)
returns table (
  game_id text,
  season integer,
  week integer,
  away_team text,
  home_team text,
  game_time timestamptz,
  away_pick_count integer,
  home_pick_count integer,
  total_pick_count integer,
  fake_outcome text,
  needs_outcome boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_season integer;
  v_start_week integer;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select
    coalesce(p.season, extract(year from now())::integer),
    coalesce(p.start_week, 1)
    into v_season, v_start_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > 18 then
    raise exception 'Week must be between this pool''s start week (%) and Week 18.', v_start_week;
  end if;

  return query
  with pick_counts as (
    select picked_teams.team_abbr, count(*)::integer as pick_count
    from (
      select d.team_abbr
      from public.pool_pick_drafts d
      where d.pool_id = p_pool_id
        and d.week = p_week
        and d.team_abbr not like 'NO_PICK%'
      union all
      select pp.team_abbr
      from public.pool_picks pp
      where pp.pool_id = p_pool_id
        and pp.week = p_week
        and pp.team_abbr not like 'NO_PICK%'
    ) picked_teams
    group by picked_teams.team_abbr
  )
  select
    g.id::text as game_id,
    g.season,
    g.week,
    g.away_team::text,
    g.home_team::text,
    coalesce(g.kickoff_at_utc, g.game_time) as game_time,
    coalesce(away_counts.pick_count, 0)::integer as away_pick_count,
    coalesce(home_counts.pick_count, 0)::integer as home_pick_count,
    (coalesce(away_counts.pick_count, 0) + coalesce(home_counts.pick_count, 0))::integer as total_pick_count,
    outcome.fake_outcome,
    ((coalesce(away_counts.pick_count, 0) + coalesce(home_counts.pick_count, 0)) > 0 and outcome.fake_outcome is null)::boolean as needs_outcome
  from public.nfl_games g
  left join pick_counts away_counts on away_counts.team_abbr = g.away_team
  left join pick_counts home_counts on home_counts.team_abbr = g.home_team
  left join lateral (
    select public.test_pool_game_outcome(p_pool_id, p_week, g.home_team::text, g.away_team::text) as fake_outcome
  ) outcome on true
  where g.season = v_season
    and g.week = p_week
  order by coalesce(g.kickoff_at_utc, g.game_time), g.away_team, g.home_team;
end;
$function$;

create or replace function public.superadmin_score_test_pool_week(
  p_pool_id uuid,
  p_week integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_scored integer := 0;
  v_no_picks integer := 0;
  v_start_week integer;
  v_missing_outcomes integer := 0;
  v_missing_outcome_teams text;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1)
    into v_start_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > 18 then
    raise exception 'Week must be between this pool''s start week (%) and Week 18.', v_start_week;
  end if;

  perform public.superadmin_finalize_test_week_drafts(p_pool_id, p_week);

  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  ),
  active_entries as (
    select pm.pool_id, pm.profile_id as user_id, pm.id as entry_id
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and coalesce(pm.status, 'active') = 'active'
      and coalesce(s.eliminated, false) = false
  ),
  missing as (
    select ae.pool_id, ae.user_id, ae.entry_id, p_week as week, slots.slot, ('NO_PICK_' || slots.slot)::text as team_abbr
    from active_entries ae
    cross join slots
    where not exists (
      select 1
      from public.pool_picks pp
      where pp.pool_id = ae.pool_id
        and pp.entry_id = ae.entry_id
        and pp.week = p_week
        and pp.slot = slots.slot
    )
  ),
  inserted_no_picks as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, now(), 'loss', now(), now()
    from missing
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  )
  select count(*) into v_no_picks from inserted_no_picks;

  select
    count(*)::integer,
    string_agg(distinct pp.team_abbr, ', ' order by pp.team_abbr)
    into v_missing_outcomes, v_missing_outcome_teams
  from public.pool_picks pp
  left join public.test_pool_team_results tr
    on tr.pool_id = pp.pool_id
   and tr.week = pp.week
   and tr.team_abbr = pp.team_abbr
  where pp.pool_id = p_pool_id
    and pp.week = p_week
    and pp.team_abbr not like 'NO_PICK%'
    and tr.team_abbr is null;

  if coalesce(v_missing_outcomes, 0) > 0 then
    raise exception 'Set fake outcomes for picked teams before scoring Week %: %.', p_week, coalesce(v_missing_outcome_teams, 'unknown');
  end if;

  with graded as (
    select
      pp.pool_id,
      pp.entry_id,
      pp.week,
      pp.slot,
      case
        when tr.result = 'push' then coalesce(nullif(po.tie_rule, ''), 'loss')
        else tr.result
      end as result
    from public.pool_picks pp
    join public.pools po on po.id = pp.pool_id
    join public.test_pool_team_results tr
      on tr.pool_id = pp.pool_id
     and tr.week = pp.week
     and tr.team_abbr = pp.team_abbr
    where pp.pool_id = p_pool_id
      and pp.week = p_week
      and pp.team_abbr not like 'NO_PICK%'
  ),
  updated as (
    update public.pool_picks pp
       set result = g.result,
           adjudicated_at = now()
      from graded g
     where pp.pool_id = g.pool_id
       and pp.entry_id = g.entry_id
       and pp.week = g.week
       and pp.slot = g.slot
       and pp.result is distinct from g.result
    returning 1
  )
  select count(*) into v_scored from updated;

  with entry_results as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
      count(pp.*) filter (where pp.result = 'win')::int as wins,
      count(pp.*) filter (where pp.result = 'loss')::int as losses,
      count(pp.*) filter (where pp.result = 'push')::int as pushes,
      count(pp.*) filter (where pp.result = 'loss')::int as strikes_used
    from public.pool_members pm
    join public.pools po on po.id = pm.pool_id
    left join public.pool_picks pp
      on pp.pool_id = pm.pool_id
     and pp.entry_id = pm.id
     and pp.result is not null
    where pm.pool_id = p_pool_id
    group by pm.pool_id, pm.profile_id, pm.id, po.strikes_allowed
  ),
  first_elimination as (
    select pool_id, entry_id, min(week) as eliminated_week
    from (
      select
        pp.pool_id,
        pp.entry_id,
        pp.week,
        coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
        count(*) filter (where pp.result = 'loss') over (
          partition by pp.pool_id, pp.entry_id
          order by pp.week, pp.slot
          rows between unbounded preceding and current row
        ) as running_strikes
      from public.pool_picks pp
      join public.pools po on po.id = pp.pool_id
      where pp.pool_id = p_pool_id
        and pp.result is not null
    ) progress
    where running_strikes > strikes_allowed
    group by pool_id, entry_id
  )
  insert into public.pool_member_stats (
    pool_id,
    user_id,
    entry_id,
    wins,
    losses,
    pushes,
    strikes_used,
    eliminated,
    eliminated_week,
    updated_at
  )
  select
    er.pool_id,
    er.user_id,
    er.entry_id,
    er.wins,
    er.losses,
    er.pushes,
    er.strikes_used,
    er.strikes_used > er.strikes_allowed,
    fe.eliminated_week,
    now()
  from entry_results er
  left join first_elimination fe
    on fe.pool_id = er.pool_id
   and fe.entry_id = er.entry_id
  on conflict (pool_id, entry_id) do update
  set user_id = excluded.user_id,
      wins = excluded.wins,
      losses = excluded.losses,
      pushes = excluded.pushes,
      strikes_used = excluded.strikes_used,
      eliminated = excluded.eliminated,
      eliminated_week = excluded.eliminated_week,
      updated_at = excluded.updated_at;

  update public.pools
     set test_current_week = least(18, greatest(coalesce(test_current_week, p_week), p_week + 1))
   where id = p_pool_id;

  return 'Week ' || p_week || ' scored. ' || v_scored || ' picks graded, ' || v_no_picks || ' no-picks recorded.';
end;
$function$;

create or replace function public.superadmin_randomize_test_week_picks(
  p_pool_id uuid,
  p_week integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_allowed integer;
  v_inserted integer := 0;
  v_entry record;
  v_slot integer;
  v_team text;
  v_used text[];
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1)
    into v_start_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > 18 then
    raise exception 'Week must be between this pool''s start week (%) and Week 18.', v_start_week;
  end if;

  select public.picks_allowed(p_pool_id, p_week)
    into v_allowed;

  if coalesce(v_allowed, 0) < 1 then
    raise exception 'This pool does not allow picks for Week %.', p_week;
  end if;

  for v_entry in
    select pm.pool_id, pm.profile_id as user_id, pm.id as entry_id
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and coalesce(pm.status, 'active') = 'active'
      and coalesce(s.eliminated, false) = false
    order by pm.entry_number, pm.id
  loop
    select coalesce(array_agg(distinct used.team_abbr), '{}'::text[])
      into v_used
    from (
      select pp.team_abbr
      from public.pool_picks pp
      where pp.pool_id = p_pool_id
        and pp.entry_id = v_entry.entry_id
        and pp.team_abbr not like 'NO_PICK%'
      union all
      select d.team_abbr
      from public.pool_pick_drafts d
      where d.pool_id = p_pool_id
        and d.entry_id = v_entry.entry_id
        and d.team_abbr not like 'NO_PICK%'
    ) used;

    for v_slot in 1..v_allowed loop
      if exists (
        select 1
        from public.pool_picks pp
        where pp.pool_id = p_pool_id
          and pp.entry_id = v_entry.entry_id
          and pp.week = p_week
          and pp.slot = v_slot
      ) or exists (
        select 1
        from public.pool_pick_drafts d
        where d.pool_id = p_pool_id
          and d.entry_id = v_entry.entry_id
          and d.week = p_week
          and d.slot = v_slot
      ) then
        continue;
      end if;

      select candidate.team_abbr
        into v_team
      from (
        select g.away_team::text as team_abbr
        from public.nfl_games g
        join public.pools p on p.id = p_pool_id
        where g.season = coalesce(p.season, extract(year from now())::integer)
          and g.week = p_week
        union
        select g.home_team::text as team_abbr
        from public.nfl_games g
        join public.pools p on p.id = p_pool_id
        where g.season = coalesce(p.season, extract(year from now())::integer)
          and g.week = p_week
      ) candidate
      where not (candidate.team_abbr = any(v_used))
      order by random()
      limit 1;

      if v_team is null then
        raise exception 'No available teams left to randomize Week % for entry %.', p_week, v_entry.entry_id;
      end if;

      insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
      values (p_pool_id, v_entry.user_id, v_entry.entry_id, p_week, v_slot, v_team, now())
      on conflict (pool_id, entry_id, week, slot) do update
      set team_abbr = excluded.team_abbr,
          user_id = excluded.user_id,
          updated_at = now();

      v_used := array_append(v_used, v_team);
      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  return 'Randomized ' || v_inserted || ' missing pick(s) for Week ' || p_week || '.';
end;
$function$;

grant execute on function public.superadmin_set_test_pool_week(uuid, integer) to authenticated;
grant execute on function public.superadmin_test_pool_week_options(uuid, integer) to authenticated;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated;
grant execute on function public.superadmin_randomize_test_week_picks(uuid, integer) to authenticated;

commit;
