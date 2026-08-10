begin;

-- Scoring the configured final week used to clamp the test clock back to the
-- beginning of that same week. With multiple survivors, lifecycle detection
-- therefore reported "between weeks" forever. Keep the clock after the final
-- kickoff so the ordinary completion function can recognize season end.
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
  v_max_week integer;
  v_next_week integer;
  v_next_clock timestamptz;
  v_missing_outcomes integer := 0;
  v_missing_outcome_teams text;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if public.pool_has_declared_winner(p_pool_id) then
    perform public.prune_pool_picks_after_winner(p_pool_id);
    return 'This pool already has a winner. No more weeks need to be scored.';
  end if;

  select coalesce(p.start_week, 1), public.pool_max_pick_week(p_pool_id)
    into v_start_week, v_max_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > coalesce(v_max_week, 18) then
    raise exception 'Week must be between this pool''s start week (%) and Week %.', v_start_week, coalesce(v_max_week, 18);
  end if;

  if p_week > 18 then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
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
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
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
    select pool_id, user_id, entry_id, week, slot, team_abbr, public.pool_test_clock_at(p_pool_id, p_week, 'week_done'), 'loss', now(), now()
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

  perform public.superadmin_rebuild_test_pool_stats(p_pool_id);
  perform public.prune_pool_picks_after_winner(p_pool_id);

  if public.pool_has_declared_winner(p_pool_id) then
    return 'Week ' || p_week || ' scored. A winner has been decided, so the pool is complete.';
  end if;

  if p_week >= coalesce(v_max_week, 18) then
    update public.pools
       set test_current_week = p_week,
           test_now_at = public.pool_test_clock_at(p_pool_id, p_week, 'week_done')
     where id = p_pool_id;
    return 'Week ' || p_week || ' scored. The configured season is complete with ' || v_scored || ' official pick(s) scored and ' || v_no_picks || ' no-pick(s) recorded.';
  end if;

  if p_week >= 18 and coalesce(v_max_week, 18) > 18 then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  end if;

  v_next_week := least(coalesce(v_max_week, 18), greatest(coalesce(p_week, v_start_week), p_week + 1));
  v_next_clock := public.pool_test_clock_at(p_pool_id, v_next_week, 'before_week');

  update public.pools
     set test_current_week = v_next_week,
         test_now_at = v_next_clock
   where id = p_pool_id;

  return 'Week ' || p_week || ' scored. ' || v_scored || ' official pick(s) scored, ' || v_no_picks || ' no-pick(s) recorded.';
end;
$function$;

revoke execute on function public.superadmin_score_test_pool_week(uuid, integer) from public, anon;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated, service_role;

commit;
