begin;

-- One function owns the complete simultaneous-elimination rule. Both scoring
-- and the table safety trigger consume this result so they cannot drift apart.
create or replace function public.pool_wipeout_survival_credits(
  p_pool_id uuid,
  p_week integer
)
returns table(entry_id uuid, week integer, strike_credits integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with settings as (
    select greatest(0, coalesce(nullif(pool.strikes_allowed, '')::integer, 0)) as base_mulligans
    from public.pools pool
    where pool.id = p_pool_id
  ), prior_graces as (
    select grace.entry_id, coalesce(sum(grace.strike_credits), 0)::integer as credits
    from public.pool_entry_survival_graces grace
    where grace.pool_id = p_pool_id
      and grace.week < p_week
    group by grace.entry_id
  ), entry_state as (
    select entry.id as entry_id,
      settings.base_mulligans + coalesce(prior_graces.credits, 0) as allowance,
      count(pick.*) filter (
        where pick.result = 'loss' and pick.week < p_week
      )::integer as losses_before,
      count(pick.*) filter (
        where pick.result = 'loss' and pick.week <= p_week
      )::integer as losses_through
    from public.pool_members entry
    cross join settings
    left join prior_graces on prior_graces.entry_id = entry.id
    left join public.pool_picks pick
      on pick.pool_id = entry.pool_id
     and pick.entry_id = entry.id
     and pick.result is not null
     and pick.week <= p_week
    where entry.pool_id = p_pool_id
    group by entry.id, settings.base_mulligans, prior_graces.credits
  ), alive_entering as (
    select state.*
    from entry_state state
    where state.losses_before <= state.allowance
  ), qualification as (
    select count(*)::integer as alive_count,
      bool_and(alive.losses_through > alive.allowance) as everyone_eliminated
    from alive_entering alive
  )
  select alive.entry_id,
    p_week,
    (alive.losses_through - alive.allowance)::integer as strike_credits
  from alive_entering alive
  cross join qualification qualified
  where p_week is not null
    and qualified.alive_count >= 2
    and coalesce(qualified.everyone_eliminated, false)
    and public.pool_week_grading_complete(p_pool_id, p_week)
    and alive.losses_through > alive.allowance
$function$;

create or replace function public.guard_survival_grace_grading_complete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (
    select 1
    from public.pool_wipeout_survival_credits(new.pool_id, new.week) credit
    where credit.entry_id = new.entry_id
      and credit.week = new.week
      and credit.strike_credits = new.strike_credits
  ) then
    return null;
  end if;
  return new;
end;
$function$;

-- Replace the old inline wipeout calculation with the canonical result above.
create or replace function public.rebuild_pool_member_stats_concurrency_internal(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
  v_latest_week integer;
begin
  if p_pool_id is null or not exists (select 1 from public.pools p where p.id = p_pool_id) then
    raise exception 'Pool not found.';
  end if;
  if auth.uid() is not null and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select max(pick.week)::integer into v_latest_week
  from public.pool_picks pick
  where pick.pool_id = p_pool_id and pick.result is not null;

  insert into public.pool_entry_survival_graces(pool_id, entry_id, week, strike_credits)
  select p_pool_id, credit.entry_id, credit.week, credit.strike_credits
  from public.pool_wipeout_survival_credits(p_pool_id, v_latest_week) credit
  on conflict (pool_id, entry_id, week) do nothing;

  delete from public.pool_member_stats stats where stats.pool_id = p_pool_id;

  with pool_settings as (
    select pool.id as pool_id,
      greatest(0, coalesce(nullif(pool.strikes_allowed, '')::integer, 0)) as base_strikes
    from public.pools pool where pool.id = p_pool_id
  ), grace_totals as (
    select grace.entry_id, coalesce(sum(grace.strike_credits), 0)::integer as credits
    from public.pool_entry_survival_graces grace
    where grace.pool_id = p_pool_id
    group by grace.entry_id
  ), pick_progress as (
    select pick.pool_id, pick.entry_id, pick.week, pick.slot,
      settings.base_strikes + coalesce(grace.credits, 0) as strikes_allowed,
      count(*) filter (where pick.result = 'loss') over (
        partition by pick.pool_id, pick.entry_id
        order by pick.week, pick.slot rows between unbounded preceding and current row
      ) as running_strikes
    from public.pool_picks pick
    join pool_settings settings on settings.pool_id = pick.pool_id
    left join grace_totals grace on grace.entry_id = pick.entry_id
    where pick.pool_id = p_pool_id and pick.result is not null
  ), first_elimination as (
    select progress.pool_id, progress.entry_id, min(progress.week)::integer as eliminated_week
    from pick_progress progress
    where progress.running_strikes > progress.strikes_allowed
    group by progress.pool_id, progress.entry_id
  ), entry_results as (
    select entry.pool_id, entry.profile_id as user_id, entry.id as entry_id,
      settings.base_strikes + coalesce(grace.credits, 0) as strikes_allowed,
      eliminated.eliminated_week,
      count(pick.*) filter (where pick.result = 'win')::integer as wins,
      count(pick.*) filter (where pick.result = 'loss')::integer as losses,
      count(pick.*) filter (where pick.result = 'push')::integer as pushes,
      count(pick.*) filter (where pick.result = 'loss')::integer as strikes_used
    from public.pool_members entry
    join pool_settings settings on settings.pool_id = entry.pool_id
    left join grace_totals grace on grace.entry_id = entry.id
    left join first_elimination eliminated
      on eliminated.pool_id = entry.pool_id and eliminated.entry_id = entry.id
    left join public.pool_picks pick
      on pick.pool_id = entry.pool_id
     and pick.entry_id = entry.id
     and pick.result is not null
     and (eliminated.eliminated_week is null or pick.week <= eliminated.eliminated_week)
    where entry.pool_id = p_pool_id
    group by entry.pool_id, entry.profile_id, entry.id, settings.base_strikes,
      grace.credits, eliminated.eliminated_week
  ), inserted as (
    insert into public.pool_member_stats(
      pool_id,user_id,entry_id,wins,losses,pushes,strikes_used,
      eliminated,eliminated_week,updated_at
    )
    select result.pool_id,result.user_id,result.entry_id,result.wins,result.losses,
      result.pushes,result.strikes_used,result.eliminated_week is not null,
      result.eliminated_week,now()
    from entry_results result
    on conflict (pool_id,entry_id) do update set
      user_id=excluded.user_id,wins=excluded.wins,losses=excluded.losses,
      pushes=excluded.pushes,strikes_used=excluded.strikes_used,
      eliminated=excluded.eliminated,eliminated_week=excluded.eliminated_week,
      updated_at=excluded.updated_at
    returning 1
  )
  select count(*)::integer into v_rows from inserted;

  perform public.prune_picks_after_elimination(p_pool_id);

  update public.pool_members entry
  set status = case when coalesce(stats.eliminated,false) then 'eliminated' else 'alive' end,
      eliminated_week = stats.eliminated_week,
      lives_remaining = greatest(0, allowance.allowed - stats.strikes_used)
  from public.pool_member_stats stats
  join (
    select pool.id as pool_id, member.id as entry_id,
      greatest(0,coalesce(nullif(pool.strikes_allowed,'')::integer,0))
        + coalesce(sum(grace.strike_credits),0)::integer as allowed
    from public.pools pool
    join public.pool_members member on member.pool_id=pool.id
    left join public.pool_entry_survival_graces grace
      on grace.pool_id=pool.id and grace.entry_id=member.id
    where pool.id=p_pool_id
    group by pool.id,member.id,pool.strikes_allowed
  ) allowance on allowance.pool_id=stats.pool_id and allowance.entry_id=stats.entry_id
  where entry.pool_id=stats.pool_id and entry.id=stats.entry_id;

  return coalesce(v_rows,0);
end;
$function$;

-- Remove any credit that the canonical rule cannot reproduce, then rebuild
-- only pools whose ledger changed.
do $function$
declare
  v_pool_id uuid;
begin
  for v_pool_id in
    with removed as (
      delete from public.pool_entry_survival_graces grace
      where not exists (
        select 1
        from public.pool_wipeout_survival_credits(grace.pool_id, grace.week) credit
        where credit.entry_id = grace.entry_id
          and credit.week = grace.week
          and credit.strike_credits = grace.strike_credits
      )
      returning grace.pool_id
    )
    select distinct removed.pool_id from removed
  loop
    perform public.rebuild_pool_member_stats(v_pool_id);
  end loop;
end;
$function$;

drop function if exists public.pool_alive_entries_entering_week(uuid, integer);

-- Ordinary Test Admin actions may operate only on the current simulated week.
create or replace function public.superadmin_assert_current_test_week(
  p_pool_id uuid,
  p_week integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_week integer;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
  select coalesce(pool.test_current_week, pool.start_week, 1)
    into v_current_week
  from public.pools pool where pool.id = p_pool_id;
  if p_week is distinct from v_current_week then
    raise exception 'Week % is not the current test week. This pool is currently on Week %. Use the Advanced week override first.', p_week, v_current_week;
  end if;
end;
$function$;

-- The exceptional path is separate, explicit, reasoned, and serialized.
create or replace function public.superadmin_override_test_pool_week(
  p_pool_id uuid,
  p_week integer,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
  v_old_week integer;
  v_clock timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Explain why this advanced week override is needed.';
  end if;
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);

  select coalesce(pool.start_week, 1), public.pool_max_pick_week(p_pool_id),
    coalesce(pool.test_current_week, pool.start_week, 1)
    into v_start_week, v_max_week, v_old_week
  from public.pools pool where pool.id = p_pool_id;

  if p_week < v_start_week or p_week > coalesce(v_max_week, 18) then
    raise exception 'Week must be between this pool''s start week (%) and Week %.', v_start_week, coalesce(v_max_week, 18);
  end if;
  if p_week > 18 then perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id); end if;
  v_clock := public.pool_test_clock_at(p_pool_id, p_week, 'before_week');

  update public.pools
  set test_current_week = p_week, test_now_at = v_clock
  where id = p_pool_id;

  insert into public.admin_actions(
    pool_id,admin_id,target_user_id,week,action,old_team_abbr,new_team_abbr,reason
  ) values (
    p_pool_id,auth.uid(),auth.uid(),p_week,'test_week_override',
    'Week ' || v_old_week,'Week ' || p_week,v_reason
  );

  return 'Advanced override moved the test pool from Week ' || v_old_week ||
    ' to Week ' || p_week || '. Skipped weeks were not scored. Reason: ' || v_reason;
end;
$function$;

create or replace function public.superadmin_set_test_pool_week(p_pool_id uuid, p_week integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clock timestamptz;
begin
  perform public.superadmin_assert_current_test_week(p_pool_id, p_week);
  v_clock := public.pool_test_clock_at(p_pool_id, p_week, 'before_week');
  update public.pools set test_now_at = v_clock where id = p_pool_id;
  return 'Week ' || p_week || ' reset to before the first kickoff.';
end;
$function$;

create or replace function public.superadmin_set_test_pool_clock(
  p_pool_id uuid,
  p_week integer,
  p_stage text default 'before_week'
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clock timestamptz;
  v_restored integer := 0;
  v_finalized integer := 0;
begin
  perform public.superadmin_assert_current_test_week(p_pool_id, p_week);
  if p_week > 18 then perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id); end if;
  v_clock := public.pool_test_clock_at(p_pool_id, p_week, p_stage);
  update public.pools set test_now_at = v_clock where id = p_pool_id;

  with restore_rows as (
    select pick.* from public.pool_picks pick
    where pick.pool_id = p_pool_id and pick.week = p_week
      and pick.team_abbr not like 'NO_PICK%' and pick.result is null
      and pick.locked_at > v_clock
  ), restored as (
    insert into public.pool_pick_drafts(pool_id,user_id,entry_id,week,slot,team_abbr,updated_at)
    select pool_id,user_id,entry_id,week,slot,team_abbr,now() from restore_rows
    on conflict (pool_id,entry_id,week,slot) do update set
      team_abbr=excluded.team_abbr,user_id=excluded.user_id,updated_at=now()
    returning 1
  ), deleted as (
    delete from public.pool_picks pick using restore_rows restored_row
    where pick.pool_id=restored_row.pool_id and pick.entry_id=restored_row.entry_id
      and pick.week=restored_row.week and pick.slot=restored_row.slot
    returning 1
  )
  select count(*)::integer into v_restored from restored;

  v_finalized := public.superadmin_finalize_test_locked_picks(p_pool_id, p_week);
  return 'Test clock set to ' || to_char(v_clock at time zone 'America/New_York', 'Dy, Mon FMDD HH12:MI AM') ||
    ' ET. Finalized ' || coalesce(v_finalized,0) || ' pick(s), restored ' || coalesce(v_restored,0) || ' unlocked pick(s).';
end;
$function$;

create or replace function public.superadmin_score_test_pool_week(p_pool_id uuid, p_week integer)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.superadmin_assert_current_test_week(p_pool_id, p_week);
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  return public.superadmin_score_test_pool_week_concurrency_internal(p_pool_id, p_week);
end;
$function$;

-- Owners retain only competitively meaningful drafts. Commissioner evidence
-- remains available through the existing protected administration functions.
drop policy if exists pool_pick_drafts_select_own on public.pool_pick_drafts;
create policy pool_pick_drafts_select_own_active_history
on public.pool_pick_drafts
for select
to authenticated
using (
  exists (
    select 1
    from public.pool_members entry
    left join public.pool_member_stats stats
      on stats.pool_id = entry.pool_id and stats.entry_id = entry.id
    where entry.pool_id = pool_pick_drafts.pool_id
      and entry.id = pool_pick_drafts.entry_id
      and entry.profile_id = (select auth.uid())
      and (
        not coalesce(stats.eliminated, false)
        or stats.eliminated_week is null
        or pool_pick_drafts.week <= stats.eliminated_week
      )
  )
);

revoke all on function public.pool_wipeout_survival_credits(uuid,integer) from public,anon,authenticated;
revoke all on function public.superadmin_assert_current_test_week(uuid,integer) from public,anon,authenticated;
revoke all on function public.superadmin_override_test_pool_week(uuid,integer,text) from public,anon;
grant execute on function public.pool_wipeout_survival_credits(uuid,integer) to service_role;
grant execute on function public.superadmin_assert_current_test_week(uuid,integer) to service_role;
grant execute on function public.superadmin_override_test_pool_week(uuid,integer,text) to authenticated,service_role;

commit;
