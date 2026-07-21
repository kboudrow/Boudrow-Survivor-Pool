begin;

create or replace function public.superadmin_rebuild_test_pool_stats(
  p_pool_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  delete from public.pool_member_stats
  where pool_id = p_pool_id;

  if not exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = p_pool_id
      and pp.result is not null
  ) then
    return;
  end if;

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
   and fe.entry_id = er.entry_id;
end;
$function$;

create or replace function public.superadmin_randomize_test_week_outcomes(
  p_pool_id uuid,
  p_week integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_season integer;
  v_start_week integer;
  v_randomized integer := 0;
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

  with games_to_fill as (
    select
      g.week,
      g.away_team::text as away_team,
      g.home_team::text as home_team,
      case when random() < 0.5 then 'away' else 'home' end as outcome
    from public.nfl_games g
    where g.season = v_season
      and g.week = p_week
      and (
        select count(*)
        from public.test_pool_team_results tr
        where tr.pool_id = p_pool_id
          and tr.week = p_week
          and tr.team_abbr in (g.away_team, g.home_team)
      ) < 2
  ),
  cleared_partial_rows as (
    delete from public.test_pool_team_results tr
    using games_to_fill gtf
    where tr.pool_id = p_pool_id
      and tr.week = p_week
      and tr.team_abbr in (gtf.away_team, gtf.home_team)
    returning 1
  ),
  inserted as (
    insert into public.test_pool_team_results (pool_id, week, team_abbr, result, created_by, updated_at)
    select
      p_pool_id,
      p_week,
      team_result.team_abbr,
      team_result.result,
      auth.uid(),
      now()
    from games_to_fill gtf
    cross join lateral (
      values
        (
          gtf.away_team,
          case when gtf.outcome = 'away' then 'win' else 'loss' end
        ),
        (
          gtf.home_team,
          case when gtf.outcome = 'home' then 'win' else 'loss' end
        )
    ) as team_result(team_abbr, result)
    on conflict (pool_id, week, team_abbr) do update
    set result = excluded.result,
        created_by = excluded.created_by,
        updated_at = now()
    returning 1
  )
  select (count(*) / 2)::integer
    into v_randomized
  from inserted;

  return 'Randomized outcomes for ' || coalesce(v_randomized, 0) || ' game(s) in Week ' || p_week || '.';
end;
$function$;

create or replace function public.superadmin_clear_test_week_results(
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

  delete from public.test_pool_team_results
  where pool_id = p_pool_id
    and week = p_week;

  update public.pool_picks
     set result = null,
         adjudicated_at = null
   where pool_id = p_pool_id
     and week = p_week
     and team_abbr not like 'NO_PICK%';

  delete from public.pool_picks
  where pool_id = p_pool_id
    and week = p_week
    and team_abbr like 'NO_PICK%';

  perform public.superadmin_rebuild_test_pool_stats(p_pool_id);

  update public.pools
     set test_current_week = case
       when coalesce(test_current_week, start_week, v_start_week) > p_week then p_week
       else coalesce(test_current_week, start_week, v_start_week)
     end
   where id = p_pool_id;

  return 'Week ' || p_week || ' cleared. Picks stay in place, fake outcomes and scoring were removed.';
end;
$function$;

create or replace function public.superadmin_reset_test_pool(
  p_pool_id uuid
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

  select coalesce(start_week, 1)
    into v_start_week
  from public.pools
  where id = p_pool_id;

  delete from public.pool_pick_drafts
  where pool_id = p_pool_id;

  delete from public.pool_picks
  where pool_id = p_pool_id;

  delete from public.pool_member_stats
  where pool_id = p_pool_id;

  delete from public.test_pool_team_results
  where pool_id = p_pool_id;

  update public.pools
     set test_current_week = v_start_week
   where id = p_pool_id;

  return 'Test pool reset to Week ' || v_start_week || '. Members and settings were kept; picks, fake outcomes, and stats were cleared.';
end;
$function$;

grant execute on function public.superadmin_randomize_test_week_outcomes(uuid, integer) to authenticated;
grant execute on function public.superadmin_clear_test_week_results(uuid, integer) to authenticated;
grant execute on function public.superadmin_reset_test_pool(uuid) to authenticated;

commit;
