begin;

-- One authoritative clock boundary for roster, settings, and lifecycle checks.
-- Test pools use their simulated clock; real pools use database time.
create or replace function public.pool_start_at(p_pool_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  with selected_pool as (
    select p.id, p.season, p.start_week
    from public.pools p
    where p.id = p_pool_id
  ),
  first_game as (
    select min(coalesce(g.kickoff_at_utc, g.game_time)) as starts_at
    from selected_pool p
    join public.nfl_games g
      on g.season = p.season
     and g.week = p.start_week
     and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(p.season, 1, 1, 0, 0, 0, 'UTC')
  )
  select coalesce(
    first_game.starts_at,
    sw.week_sunday_date::timestamp at time zone 'America/New_York'
  )
  from selected_pool p
  cross join first_game
  left join public.season_weeks sw
    on sw.season = p.season
   and sw.week = p.start_week
$function$;

create or replace function public.pool_has_started(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    case
      when p.test_mode then coalesce(p.test_current_week, p.start_week, 1) >= coalesce(p.start_week, 1)
      else public.pool_start_at(p.id) is not null
        and public.pool_effective_now(p.id) >= public.pool_start_at(p.id)
    end,
    false
  )
  from public.pools p
  where p.id = p_pool_id
$function$;

create or replace function public.pool_competition_is_complete(p_pool_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_final_week integer;
  v_test_mode boolean := false;
  v_effective_now timestamptz;
  v_last_kickoff timestamptz;
  v_game_count integer := 0;
  v_all_final boolean := false;
  v_expected_picks integer := 0;
  v_recorded_picks integer := 0;
  v_ungraded_picks integer := 0;
begin
  if public.pool_has_declared_winner(p_pool_id) then return true; end if;

  select public.pool_max_pick_week(p.id), coalesce(p.test_mode, false), public.pool_effective_now(p.id)
    into v_final_week, v_test_mode, v_effective_now
  from public.pools p where p.id = p_pool_id;
  if v_final_week is null then return false; end if;

  select count(*)::integer,
         coalesce(bool_and(lower(coalesce(g.status, '')) = 'final'), false),
         max(coalesce(g.kickoff_at_utc, g.game_time))
    into v_game_count, v_all_final, v_last_kickoff
  from public.pool_week_games(p_pool_id, v_final_week) g;

  if v_test_mode then v_all_final := v_last_kickoff is not null and v_effective_now > v_last_kickoff; end if;
  if v_game_count = 0 or not v_all_final then return false; end if;

  select count(*)::integer * public.picks_allowed(p_pool_id, v_final_week)
    into v_expected_picks
  from public.pool_members pm
  left join public.pool_member_stats stats
    on stats.pool_id = pm.pool_id and stats.entry_id = pm.id
  where pm.pool_id = p_pool_id
    and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('alive', 'active')
    and (stats.eliminated_week is null or stats.eliminated_week >= v_final_week);

  select count(*)::integer,
         count(*) filter (where pick.result is null)::integer
    into v_recorded_picks, v_ungraded_picks
  from public.pool_picks pick
  where pick.pool_id = p_pool_id and pick.week = v_final_week;

  return v_recorded_picks >= v_expected_picks and v_ungraded_picks = 0;
end;
$function$;

create or replace function public.pool_lifecycle_status(p_pool_id uuid)
returns table (
  pool_id uuid,
  phase text,
  label text,
  description text,
  starts_at timestamptz,
  current_week integer,
  final_week integer,
  total_entries integer,
  alive_entries integer,
  join_allowed boolean,
  entry_creation_allowed boolean,
  pick_submission_allowed boolean,
  settings_editable boolean,
  archive_allowed boolean,
  result_processing_pending boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_now timestamptz;
  v_start_at timestamptz;
  v_current_week integer;
  v_final_week integer;
  v_total_entries integer := 0;
  v_alive_entries integer := 0;
  v_week integer;
  v_first_kickoff timestamptz;
  v_week_game_count integer := 0;
  v_week_all_final boolean := false;
  v_week_started boolean := false;
  v_expected_week_picks integer := 0;
  v_recorded_week_picks integer := 0;
  v_ungraded_week_picks integer := 0;
  v_pending boolean := false;
  v_complete boolean := false;
  v_phase text;
  v_label text;
  v_description text;
  v_join boolean := false;
  v_pick boolean := false;
  v_settings boolean := false;
  v_archive boolean := false;
begin
  if auth.uid() is null then raise exception 'Please sign in to view this pool.'; end if;
  if not public.admin_can_manage(p_pool_id) and not exists (
    select 1 from public.pool_members mine where mine.pool_id = p_pool_id and mine.profile_id = auth.uid()
  ) then raise exception 'not authorized'; end if;

  select * into v_pool from public.pools p where p.id = p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;

  v_now := public.pool_effective_now(p_pool_id);
  v_start_at := public.pool_start_at(p_pool_id);
  v_final_week := public.pool_max_pick_week(p_pool_id);
  v_current_week := v_pool.start_week;

  select count(*)::integer,
         count(*) filter (
           where lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('alive', 'active')
             and not coalesce(stats.eliminated, false)
         )::integer
    into v_total_entries, v_alive_entries
  from public.pool_members pm
  left join public.pool_member_stats stats
    on stats.pool_id = pm.pool_id and stats.entry_id = pm.id
  where pm.pool_id = p_pool_id;

  if v_pool.test_mode then
    v_current_week := least(v_final_week, greatest(v_pool.start_week, coalesce(v_pool.test_current_week, v_pool.start_week)));
  else
    for v_week in v_pool.start_week..v_final_week loop
      select min(coalesce(g.kickoff_at_utc, g.game_time))
        into v_first_kickoff
      from public.pool_week_games(p_pool_id, v_week) g;
      if v_first_kickoff is not null and v_first_kickoff <= v_now then v_current_week := v_week; end if;
    end loop;
  end if;

  select count(*)::integer,
         coalesce(bool_and(lower(coalesce(g.status, '')) = 'final'), false),
         coalesce(bool_or(coalesce(g.kickoff_at_utc, g.game_time) <= v_now), false)
    into v_week_game_count, v_week_all_final, v_week_started
  from public.pool_week_games(p_pool_id, v_current_week) g;

  if v_pool.test_mode then
    select coalesce(max(coalesce(g.kickoff_at_utc, g.game_time)) < v_now, false)
      into v_week_all_final
    from public.pool_week_games(p_pool_id, v_current_week) g;
  end if;

  select count(*)::integer * public.picks_allowed(p_pool_id, v_current_week)
    into v_expected_week_picks
  from public.pool_members pm
  left join public.pool_member_stats stats
    on stats.pool_id = pm.pool_id and stats.entry_id = pm.id
  where pm.pool_id = p_pool_id
    and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('alive', 'active')
    and (stats.eliminated_week is null or stats.eliminated_week >= v_current_week);

  select count(*)::integer,
         count(*) filter (where pick.result is null)::integer
    into v_recorded_week_picks, v_ungraded_week_picks
  from public.pool_picks pick
  where pick.pool_id = p_pool_id and pick.week = v_current_week;

  v_pending := v_week_all_final
    and (v_recorded_week_picks < v_expected_week_picks or v_ungraded_week_picks > 0);
  v_complete := public.pool_competition_is_complete(p_pool_id);

  if v_pool.archived then
    v_phase := 'archived'; v_label := 'Archived';
    v_description := 'Read-only history. Joining, entries, picks, and settings are closed.';
  elsif v_pool.activation_status = 'cancelled' then
    v_phase := 'cancelled'; v_label := 'Closed';
    v_description := 'The pool was closed and is not accepting activity.';
  elsif v_pool.activation_status = 'draft' then
    v_phase := 'draft'; v_label := 'Draft';
    v_description := 'Members may join before kickoff, but competitive picks require an active pool.';
    v_join := not public.pool_has_started(p_pool_id); v_settings := not public.pool_has_started(p_pool_id);
    v_archive := not public.pool_has_started(p_pool_id);
  elsif public.pool_has_declared_winner(p_pool_id) then
    v_phase := 'completed_winner'; v_label := 'Winner decided';
    v_description := 'One surviving entry remains. Competitive picks are closed.';
    v_archive := true;
  elsif v_total_entries > 0 and v_alive_entries = 0 then
    v_phase := 'review_required'; v_label := 'Needs review';
    v_description := 'No entries are marked alive. Simultaneous elimination should have granted survival grace.';
  elsif v_complete then
    v_phase := 'completed_season'; v_label := 'Season complete';
    v_description := case when v_alive_entries > 1
      then 'The configured season ended with multiple surviving entries; no tiebreak rule is configured.'
      else 'The configured season and result processing are complete.' end;
    v_archive := true;
  elsif not public.pool_has_started(p_pool_id) then
    v_phase := 'open'; v_label := 'Open';
    v_description := 'Members may join, rules may change, and early picks may be saved before the first kickoff.';
    v_join := true; v_pick := true; v_settings := true; v_archive := true;
  elsif v_total_entries = 0 then
    v_phase := 'review_required'; v_label := 'Needs review';
    v_description := 'The pool started without any entries.';
  elsif v_pending then
    v_phase := 'waiting_results'; v_label := 'Waiting for processing';
    v_description := 'The week is final, but missing picks or game results still need processing.';
    v_pick := true;
  elsif v_week_started and not v_week_all_final then
    v_phase := 'live_week'; v_label := 'Live week';
    v_description := 'At least one game has started. Only picks that have not reached their lock remain editable.';
    v_pick := true;
  else
    v_phase := 'between_weeks'; v_label := 'Between weeks';
    v_description := 'The previous week is processed and the next playable games have not started.';
    v_pick := true;
  end if;

  return query select v_pool.id, v_phase, v_label, v_description, v_start_at,
    v_current_week, v_final_week, v_total_entries, v_alive_entries,
    v_join, v_join, v_pick, v_settings, v_archive, v_pending;
end;
$function$;

create or replace function public.admin_archive_pool(p_pool_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.pools p where p.id = p_pool_id) then raise exception 'Pool not found.'; end if;

  if coalesce(p_archived, false)
    and public.pool_has_started(p_pool_id)
    and not public.pool_competition_is_complete(p_pool_id) then
    raise exception 'An in-progress pool cannot be archived. Wait until a winner is decided or the configured season is complete.';
  end if;

  update public.pools
     set archived = coalesce(p_archived, false),
         archived_at = case when coalesce(p_archived, false) then now() else null end
   where id = p_pool_id;
end;
$function$;

revoke execute on function public.pool_start_at(uuid) from public, anon, authenticated;
revoke execute on function public.pool_has_started(uuid) from public, anon, authenticated;
revoke execute on function public.pool_competition_is_complete(uuid) from public, anon, authenticated;
revoke execute on function public.pool_lifecycle_status(uuid) from public, anon;
revoke execute on function public.admin_archive_pool(uuid, boolean) from public, anon;
grant execute on function public.pool_start_at(uuid) to service_role;
grant execute on function public.pool_has_started(uuid) to service_role;
grant execute on function public.pool_competition_is_complete(uuid) to service_role;
grant execute on function public.pool_lifecycle_status(uuid) to authenticated, service_role;
grant execute on function public.admin_archive_pool(uuid, boolean) to authenticated, service_role;

commit;
