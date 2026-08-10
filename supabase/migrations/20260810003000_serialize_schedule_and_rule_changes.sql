begin;

-- NFL schedule/result rows are written outside the pick RPCs. Make a kickoff
-- correction, a score import, and a pick submission cross one atomic boundary:
-- whichever transaction obtains the entry lock first is authoritative.
create or replace function public.serialize_nfl_game_write_with_pool_workflows()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid;
  v_season integer;
begin
  v_season := case when tg_op = 'DELETE' then old.season else new.season end;
  for v_pool_id in
    select p.id
    from public.pools p
    where coalesce(p.season, v_season) = v_season
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
      and coalesce(p.test_mode, false) = false
    order by p.id
  loop
    perform public.acquire_pool_workflow_lock(v_pool_id);
    perform public.acquire_all_pool_entry_pick_locks(v_pool_id);
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists aaa_serialize_nfl_game_write_with_pool_workflows on public.nfl_games;
create trigger aaa_serialize_nfl_game_write_with_pool_workflows
before insert or update or delete on public.nfl_games
for each row execute function public.serialize_nfl_game_write_with_pool_workflows();

-- Test-mode outcomes model the same production score feed. Keeping their lock
-- behavior identical lets concurrency simulations exercise the real boundary.
create or replace function public.serialize_test_pool_outcome_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid;
begin
  v_pool_id := case when tg_op = 'DELETE' then old.pool_id else new.pool_id end;
  perform public.acquire_pool_workflow_lock(v_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(v_pool_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists aaa_serialize_test_pool_outcome_write on public.test_pool_team_results;
create trigger aaa_serialize_test_pool_outcome_write
before insert or update or delete on public.test_pool_team_results
for each row execute function public.serialize_test_pool_outcome_write();

-- Before kickoff, commissioners may still change competitive settings. Make a
-- simultaneous save observe either the complete old rules or complete new
-- rules, never a mix chosen by statement timing.
create or replace function public.serialize_competitive_pool_settings_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if row(
    new.season, new.start_week, new.include_playoffs, new.strikes_allowed,
    new.mulligans, new.tie_rule, new.ties, new.deadline_mode,
    new.deadline_fixed, new.deadline, new.double_pick_weeks, new.max_members,
    new.allow_multiple_entries, new.max_entries_per_user, new.activation_status,
    new.test_mode
  ) is distinct from row(
    old.season, old.start_week, old.include_playoffs, old.strikes_allowed,
    old.mulligans, old.tie_rule, old.ties, old.deadline_mode,
    old.deadline_fixed, old.deadline, old.double_pick_weeks, old.max_members,
    old.allow_multiple_entries, old.max_entries_per_user, old.activation_status,
    old.test_mode
  ) then
    perform public.acquire_pool_workflow_lock(old.id);
    perform public.acquire_all_pool_entry_pick_locks(old.id);
  end if;

  return new;
end;
$function$;

drop trigger if exists aaa_serialize_competitive_pool_settings_write on public.pools;
create trigger aaa_serialize_competitive_pool_settings_write
before update on public.pools
for each row execute function public.serialize_competitive_pool_settings_write();

revoke all on function public.serialize_nfl_game_write_with_pool_workflows() from public, anon, authenticated;
revoke all on function public.serialize_test_pool_outcome_write() from public, anon, authenticated;
revoke all on function public.serialize_competitive_pool_settings_write() from public, anon, authenticated;
grant execute on function public.serialize_nfl_game_write_with_pool_workflows() to service_role;
grant execute on function public.serialize_test_pool_outcome_write() to service_role;
grant execute on function public.serialize_competitive_pool_settings_write() to service_role;

commit;
