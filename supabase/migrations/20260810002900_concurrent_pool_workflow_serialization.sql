begin;

-- Pick saves already serialize per entry. Deadline finalization, scoring, and
-- commissioner corrections must participate in that same lock order so a
-- finalizer can never commit an older draft and then delete a newer one.
create or replace function public.acquire_pool_workflow_lock(p_pool_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_pool_id is null then
    raise exception 'Pool is required.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('pool-workflow:' || p_pool_id::text, 0)
  );
end;
$function$;

create or replace function public.acquire_pool_entry_pick_lock(
  p_pool_id uuid,
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_pool_id is null or p_entry_id is null then
    raise exception 'Pool and entry are required.';
  end if;

  -- This key intentionally matches save_entry_draft_pick and the draft table
  -- write trigger introduced by 20260810000600/20260810000800.
  perform pg_advisory_xact_lock(
    hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0)
  );
end;
$function$;

create or replace function public.acquire_all_pool_entry_pick_locks(p_pool_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry_id uuid;
begin
  -- UUID ordering makes two workers acquire entry locks in the same order.
  for v_entry_id in
    select pm.id
    from public.pool_members pm
    where pm.pool_id = p_pool_id
    order by pm.id
  loop
    perform public.acquire_pool_entry_pick_lock(p_pool_id, v_entry_id);
  end loop;
end;
$function$;

revoke all on function public.acquire_pool_workflow_lock(uuid) from public, anon, authenticated;
revoke all on function public.acquire_pool_entry_pick_lock(uuid, uuid) from public, anon, authenticated;
revoke all on function public.acquire_all_pool_entry_pick_locks(uuid) from public, anon, authenticated;
grant execute on function public.acquire_pool_workflow_lock(uuid) to service_role;
grant execute on function public.acquire_pool_entry_pick_lock(uuid, uuid) to service_role;
grant execute on function public.acquire_all_pool_entry_pick_locks(uuid) to service_role;

-- Preserve the latest implementations behind transaction-safe public wrappers.
-- The existence checks make this migration safe if its SQL is applied manually
-- before the migration ledger is synchronized.
do $function$
begin
  if to_regprocedure('public.finalize_locked_picks_concurrency_internal(uuid,integer)') is null then
    alter function public.finalize_locked_picks(uuid, integer)
      rename to finalize_locked_picks_concurrency_internal;
  end if;
  if to_regprocedure('public.finalize_no_pick_losses_concurrency_internal(uuid,integer)') is null then
    alter function public.finalize_no_pick_losses(uuid, integer)
      rename to finalize_no_pick_losses_concurrency_internal;
  end if;
  if to_regprocedure('public.finalize_locked_picks_for_pool_concurrency_internal(uuid)') is null then
    alter function public.finalize_locked_picks_for_pool(uuid)
      rename to finalize_locked_picks_for_pool_concurrency_internal;
  end if;
  if to_regprocedure('public.rebuild_pool_member_stats_concurrency_internal(uuid)') is null then
    alter function public.rebuild_pool_member_stats(uuid)
      rename to rebuild_pool_member_stats_concurrency_internal;
  end if;
  if to_regprocedure('public.adjudicate_results_concurrency_internal(integer,integer)') is null then
    alter function public.adjudicate_results(integer, integer)
      rename to adjudicate_results_concurrency_internal;
  end if;
  if to_regprocedure('public.admin_override_entry_final_pick_concurrency_internal(uuid,uuid,integer,text,text,integer)') is null then
    alter function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer)
      rename to admin_override_entry_final_pick_concurrency_internal;
  end if;
  if to_regprocedure('public.superadmin_score_test_pool_week_concurrency_internal(uuid,integer)') is null then
    alter function public.superadmin_score_test_pool_week(uuid, integer)
      rename to superadmin_score_test_pool_week_concurrency_internal;
  end if;
end;
$function$;

create or replace function public.finalize_locked_picks(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  return public.finalize_locked_picks_concurrency_internal(p_pool_id, p_week);
end;
$function$;

create or replace function public.finalize_no_pick_losses(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  return public.finalize_no_pick_losses_concurrency_internal(p_pool_id, p_week);
end;
$function$;

create or replace function public.finalize_locked_picks_for_pool(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  return public.finalize_locked_picks_for_pool_concurrency_internal(p_pool_id);
end;
$function$;

create or replace function public.rebuild_pool_member_stats(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;
  perform public.acquire_pool_workflow_lock(p_pool_id);
  return public.rebuild_pool_member_stats_concurrency_internal(p_pool_id);
end;
$function$;

create or replace function public.adjudicate_results(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid;
begin
  -- A scoring run can touch several pools. Acquire every pool lock in stable
  -- order before grading so overlapping cron jobs cannot interleave rebuilds.
  for v_pool_id in
    select p.id
    from public.pools p
    where coalesce(p.season, p_season) = p_season
      and coalesce(p.test_mode, false) = false
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
    order by p.id
  loop
    perform public.acquire_pool_workflow_lock(v_pool_id);
  end loop;

  return public.adjudicate_results_concurrency_internal(p_season, p_week);
end;
$function$;

create or replace function public.admin_override_entry_final_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_reason text default null,
  p_slot integer default 1
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid;
  v_season integer;
  v_test_mode boolean;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select coalesce(p.season, extract(year from now())::integer), coalesce(p.test_mode, false)
    into v_season, v_test_mode
  from public.pools p
  where p.id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if v_test_mode then
    perform public.acquire_pool_workflow_lock(p_pool_id);
  else
    -- The existing correction routine re-adjudicates every active pool in the
    -- season. Match that scope and lock order before changing the corrected row.
    for v_pool_id in
      select p.id
      from public.pools p
      where coalesce(p.season, v_season) = v_season
        and coalesce(p.test_mode, false) = false
        and coalesce(p.archived, false) = false
        and coalesce(p.activation_status, 'active') = 'active'
      order by p.id
    loop
      perform public.acquire_pool_workflow_lock(v_pool_id);
    end loop;
  end if;

  perform public.acquire_pool_entry_pick_lock(p_pool_id, p_entry_id);
  perform public.admin_override_entry_final_pick_concurrency_internal(
    p_pool_id, p_entry_id, p_week, p_team_abbr, p_reason, p_slot
  );
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
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  return public.superadmin_score_test_pool_week_concurrency_internal(p_pool_id, p_week);
end;
$function$;

revoke all on function public.finalize_locked_picks_concurrency_internal(uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_no_pick_losses_concurrency_internal(uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_locked_picks_for_pool_concurrency_internal(uuid) from public, anon, authenticated;
revoke all on function public.rebuild_pool_member_stats_concurrency_internal(uuid) from public, anon, authenticated;
revoke all on function public.adjudicate_results_concurrency_internal(integer, integer) from public, anon, authenticated;
revoke all on function public.admin_override_entry_final_pick_concurrency_internal(uuid, uuid, integer, text, text, integer) from public, anon, authenticated;
revoke all on function public.superadmin_score_test_pool_week_concurrency_internal(uuid, integer) from public, anon, authenticated;

revoke all on function public.finalize_locked_picks(uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_no_pick_losses(uuid, integer) from public, anon, authenticated;
revoke all on function public.finalize_locked_picks_for_pool(uuid) from public, anon, authenticated;
revoke all on function public.adjudicate_results(integer, integer) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks(uuid, integer) to service_role;
grant execute on function public.finalize_no_pick_losses(uuid, integer) to service_role;
grant execute on function public.finalize_locked_picks_for_pool(uuid) to service_role;
grant execute on function public.adjudicate_results(integer, integer) to service_role;

revoke all on function public.rebuild_pool_member_stats(uuid) from public, anon;
grant execute on function public.rebuild_pool_member_stats(uuid) to authenticated, service_role;
revoke all on function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer) from public, anon;
grant execute on function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer) to authenticated, service_role;
revoke all on function public.superadmin_score_test_pool_week(uuid, integer) from public, anon;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated, service_role;

commit;
