begin;

create or replace function public.pool_visible_picks(
  p_pool_id uuid,
  p_week integer default null,
  p_through_week boolean default false
)
returns table (
  user_id uuid,
  entry_id uuid,
  week integer,
  slot integer,
  team_abbr text,
  locked_at timestamptz,
  result text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view picks.';
  end if;

  select public.admin_can_manage(p_pool_id) into v_can_manage;

  if not v_can_manage and not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pp.user_id,
    pp.entry_id,
    pp.week,
    pp.slot,
    pp.team_abbr::text,
    pp.locked_at,
    pp.result::text
  from public.pool_picks pp
  join public.pools po on po.id = pp.pool_id
  where pp.pool_id = p_pool_id
    and (
      p_week is null
      or (p_through_week and pp.week <= p_week)
      or (not p_through_week and pp.week = p_week)
    )
    and (
      v_can_manage
      or pp.user_id = auth.uid()
      or pp.locked_at <= now()
      or (
        coalesce(po.test_mode, false)
        and pp.week <= coalesce(po.test_current_week, po.start_week, pp.week)
      )
    )
  order by pp.week, pp.slot, pp.entry_id;
end;
$function$;

create or replace function public.restore_unlocked_picks_for_pool(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  restored integer := 0;
  can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;

  select public.admin_can_manage(p_pool_id) into can_manage;

  if not can_manage and not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  if exists (
    select 1
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.test_mode, false)
  ) then
    return 0;
  end if;

  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  unlocked as (
    select
      pp.pool_id,
      pp.user_id,
      pp.entry_id,
      pp.week,
      pp.slot,
      pp.team_abbr
    from public.pool_picks pp
    join pool_settings ps on ps.id = pp.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = pp.week
     and pp.team_abbr in (g.home_team, g.away_team)
    where pp.pool_id = p_pool_id
      and pp.result is null
      and now() < case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(pp.pool_id, pp.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end
      and (can_manage or pp.user_id = auth.uid())
  ),
  restored_rows as (
    insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, now()
    from unlocked
    on conflict (pool_id, entry_id, week, slot) do update
      set team_abbr = excluded.team_abbr,
          updated_at = now()
    returning pool_id, entry_id, week, slot
  ),
  deleted as (
    delete from public.pool_picks pp
    using restored_rows r
    where pp.pool_id = r.pool_id
      and pp.entry_id = r.entry_id
      and pp.week = r.week
      and pp.slot = r.slot
    returning 1
  )
  select count(*) into restored from restored_rows;

  return coalesce(restored, 0);
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
  v_changed integer := 0;
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
  select count(*) into v_changed from updated;

  select count(*)::integer
    into v_scored
  from public.pool_picks pp
  where pp.pool_id = p_pool_id
    and pp.week = p_week
    and pp.result is not null;

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

  return 'Week ' || p_week || ' scored. ' || v_scored || ' official pick(s) scored, ' || v_no_picks || ' no-pick(s) recorded.';
end;
$function$;

grant execute on function public.pool_visible_picks(uuid, integer, boolean) to authenticated;
grant execute on function public.restore_unlocked_picks_for_pool(uuid) to authenticated;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated;

commit;
