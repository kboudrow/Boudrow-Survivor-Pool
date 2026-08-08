begin;

alter table public.pools
add column if not exists test_now_at timestamptz;

create or replace function public.pool_effective_now(p_pool_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    case
      when coalesce(p.test_mode, false) then coalesce(p.test_now_at, now())
      else now()
    end
  from public.pools p
  where p.id = p_pool_id
$function$;

create or replace function public.pool_test_clock_at(
  p_pool_id uuid,
  p_week integer,
  p_stage text
)
returns timestamptz
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_first timestamptz;
  v_last timestamptz;
  v_sunday_date date;
  v_sunday_1 timestamptz;
  v_sunday_late timestamptz;
  v_sunday_night timestamptz;
  v_stage text := lower(coalesce(nullif(trim(p_stage), ''), 'before_week'));
begin
  select
    min(coalesce(g.kickoff_at_utc, g.game_time)),
    max(coalesce(g.kickoff_at_utc, g.game_time))
    into v_first, v_last
  from public.pool_week_games(p_pool_id, p_week) g;

  if v_first is null then
    raise exception 'No games found for Week %.', p_week;
  end if;

  select sw.week_sunday_date
    into v_sunday_date
  from public.pools p
  join public.season_weeks sw
    on sw.season = coalesce(p.season, extract(year from now())::integer)
   and sw.week = p_week
  where p.id = p_pool_id;

  if v_sunday_date is not null then
    v_sunday_1 := ((v_sunday_date::text || ' 13:00')::timestamp at time zone 'America/New_York');

    select max(coalesce(g.kickoff_at_utc, g.game_time))
      into v_sunday_late
    from public.pool_week_games(p_pool_id, p_week) g
    where (coalesce(g.kickoff_at_utc, g.game_time) at time zone 'America/New_York')::date = v_sunday_date
      and (coalesce(g.kickoff_at_utc, g.game_time) at time zone 'America/New_York')::time >= time '15:30'
      and (coalesce(g.kickoff_at_utc, g.game_time) at time zone 'America/New_York')::time < time '20:00';

    select max(coalesce(g.kickoff_at_utc, g.game_time))
      into v_sunday_night
    from public.pool_week_games(p_pool_id, p_week) g
    where (coalesce(g.kickoff_at_utc, g.game_time) at time zone 'America/New_York')::date = v_sunday_date
      and (coalesce(g.kickoff_at_utc, g.game_time) at time zone 'America/New_York')::time >= time '20:00';
  end if;

  return case v_stage
    when 'before_week' then v_first - interval '1 minute'
    when 'before' then v_first - interval '1 minute'
    when 'first_kickoff' then v_first + interval '1 minute'
    when 'sunday_1pm' then coalesce(v_sunday_1 + interval '1 minute', v_first + interval '1 minute')
    when 'sunday_late' then coalesce(v_sunday_late + interval '1 minute', v_sunday_1 + interval '1 minute', v_first + interval '1 minute')
    when 'sunday_night' then coalesce(v_sunday_night + interval '1 minute', v_sunday_late + interval '1 minute', v_sunday_1 + interval '1 minute', v_first + interval '1 minute')
    when 'monday_night' then v_last + interval '1 minute'
    when 'week_done' then v_last + interval '1 minute'
    else v_first - interval '1 minute'
  end;
end;
$function$;

create or replace function public.superadmin_finalize_test_locked_picks(
  p_pool_id uuid,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer := 0;
  v_now timestamptz;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
  v_now := public.pool_effective_now(p_pool_id);

  with pool_settings as (
    select p.id, coalesce(p.deadline_mode, 'fixed') as deadline_mode
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.test_mode, false) = true
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.entry_id,
      d.week,
      d.slot,
      d.team_abbr,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.pool_week_games(p_pool_id, p_week) g
      on g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= v_now
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, lock_at, now()
    from to_commit
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.entry_id = tc.entry_id
      and d.week = tc.week
      and d.slot = tc.slot
    returning 1
  )
  select count(*)::integer into inserted from ins;

  return coalesce(inserted, 0);
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
  v_start_week integer;
  v_max_week integer;
  v_clock timestamptz;
  v_restored integer := 0;
  v_finalized integer := 0;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

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

  v_clock := public.pool_test_clock_at(p_pool_id, p_week, p_stage);

  update public.pools
     set test_current_week = p_week,
         test_now_at = v_clock
   where id = p_pool_id;

  with restore_rows as (
    select pp.*
    from public.pool_picks pp
    where pp.pool_id = p_pool_id
      and pp.week = p_week
      and pp.team_abbr not like 'NO_PICK%'
      and pp.result is null
      and pp.locked_at > v_clock
  ),
  restored as (
    insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, now()
    from restore_rows
    on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        updated_at = now()
    returning 1
  ),
  deleted as (
    delete from public.pool_picks pp
    using restore_rows rr
    where pp.pool_id = rr.pool_id
      and pp.entry_id = rr.entry_id
      and pp.week = rr.week
      and pp.slot = rr.slot
    returning 1
  )
  select count(*)::integer into v_restored from restored;

  v_finalized := public.superadmin_finalize_test_locked_picks(p_pool_id, p_week);

  return 'Test clock set to ' || to_char(v_clock at time zone 'America/New_York', 'Dy, Mon FMDD HH12:MI AM') ||
    ' ET. Finalized ' || coalesce(v_finalized, 0) || ' pick(s), restored ' || coalesce(v_restored, 0) || ' unlocked pick(s).';
end;
$function$;

create or replace function public.save_entry_draft_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer,
  p_team_abbr text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry public.pool_members%rowtype;
  v_slot integer := coalesce(p_slot, 1);
  v_team_abbr text := upper(btrim(p_team_abbr));
  v_lock_at timestamptz;
  v_now timestamptz;
  v_test_current_week integer;
  v_eliminated boolean := false;
  v_max_week integer := 18;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to make a pick.';
  end if;

  perform public.assert_user_email_confirmed('make a pick');
  perform public.assert_action_rate_limit('save_draft_pick', 600, 120, p_pool_id::text || ':' || p_entry_id::text);

  if v_team_abbr is null or v_team_abbr = '' then
    raise exception 'Choose a team before saving this pick.';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.archived, false) or coalesce(v_pool.activation_status, 'active') <> 'active' then
    raise exception 'This pool is not accepting picks.';
  end if;

  v_now := public.pool_effective_now(p_pool_id);
  v_max_week := coalesce(public.pool_max_pick_week(p_pool_id), 18);

  if p_week < coalesce(v_pool.start_week, 1) then
    raise exception 'This pool starts in Week %.', coalesce(v_pool.start_week, 1);
  end if;

  if p_week > v_max_week then
    raise exception 'This pool does not allow picks after Week %.', v_max_week;
  end if;

  v_test_current_week := coalesce(v_pool.test_current_week, v_pool.start_week, 1);
  if coalesce(v_pool.test_mode, false) and p_week < v_test_current_week then
    raise exception 'Week % is already locked in this test pool.', p_week;
  end if;

  select *
    into v_entry
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_entry.id is null then
    raise exception 'Entry not found.';
  end if;

  if v_entry.profile_id <> auth.uid() then
    raise exception 'This entry does not belong to you.';
  end if;

  if lower(coalesce(v_entry.status::text, 'alive')) not in ('alive', 'active') then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  select coalesce(s.eliminated, false)
    into v_eliminated
  from public.pool_member_stats s
  where s.pool_id = p_pool_id
    and s.entry_id = p_entry_id;

  if coalesce(v_eliminated, false) then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  if exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = p_pool_id
      and pp.entry_id = p_entry_id
      and pp.week = p_week
      and pp.slot = v_slot
  ) then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  if exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = p_pool_id
      and pp.entry_id = p_entry_id
      and upper(btrim(pp.team_abbr)) = v_team_abbr
      and pp.team_abbr not like 'NO_PICK%'
  ) or exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.entry_id = p_entry_id
      and upper(btrim(d.team_abbr)) = v_team_abbr
      and d.team_abbr not like 'NO_PICK%'
      and not (d.week = p_week and d.slot = v_slot)
  ) then
    raise exception 'This entry has already used %.', v_team_abbr;
  end if;

  select
    case
      when coalesce(v_pool.deadline_mode, 'fixed') = 'fixed' then
        least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(p_pool_id, p_week))
      else coalesce(g.kickoff_at_utc, g.game_time)
    end
    into v_lock_at
  from public.pool_week_games(p_pool_id, p_week) g
  where v_team_abbr in (upper(g.home_team), upper(g.away_team))
  order by coalesce(g.kickoff_at_utc, g.game_time)
  limit 1;

  if v_lock_at is null then
    raise exception 'That team is not scheduled for Week %.', p_week;
  end if;

  if v_now >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_entry.profile_id, p_entry_id, p_week, v_slot, v_team_abbr, now());
end;
$function$;

create or replace function public.clear_entry_draft_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_pool public.pools%rowtype;
  v_slot integer := coalesce(p_slot, 1);
  v_team_abbr text;
  v_lock_at timestamptz;
  v_now timestamptz;
  v_test_current_week integer;
  v_max_week integer := 18;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to clear a pick.';
  end if;

  perform public.assert_user_email_confirmed('clear a pick');
  perform public.assert_action_rate_limit('clear_draft_pick', 600, 120, p_pool_id::text || ':' || p_entry_id::text);

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.archived, false) or coalesce(v_pool.activation_status, 'active') <> 'active' then
    raise exception 'This pool is not accepting pick changes.';
  end if;

  v_now := public.pool_effective_now(p_pool_id);
  v_max_week := coalesce(public.pool_max_pick_week(p_pool_id), 18);
  if p_week > v_max_week then
    return;
  end if;

  v_test_current_week := coalesce(v_pool.test_current_week, v_pool.start_week, 1);
  if coalesce(v_pool.test_mode, false) and p_week < v_test_current_week then
    raise exception 'Week % is already locked in this test pool.', p_week;
  end if;

  select pm.profile_id
    into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  if v_user_id <> auth.uid() then
    raise exception 'This entry does not belong to you.';
  end if;

  select upper(d.team_abbr)
    into v_team_abbr
  from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;

  if v_team_abbr is null then
    return;
  end if;

  select
    case
      when coalesce(v_pool.deadline_mode, 'fixed') = 'fixed' then
        least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(p_pool_id, p_week))
      else coalesce(g.kickoff_at_utc, g.game_time)
    end
    into v_lock_at
  from public.pool_week_games(p_pool_id, p_week) g
  where v_team_abbr in (upper(g.home_team), upper(g.away_team))
  order by coalesce(g.kickoff_at_utc, g.game_time)
  limit 1;

  if v_lock_at is not null and v_now >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;
end;
$function$;

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
  v_effective_now timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view picks.';
  end if;

  select public.admin_can_manage(p_pool_id) into v_can_manage;
  v_effective_now := public.pool_effective_now(p_pool_id);

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
  join public.pools po
    on po.id = pp.pool_id
  left join public.pool_member_stats s
    on s.pool_id = pp.pool_id
   and s.entry_id = pp.entry_id
  where pp.pool_id = p_pool_id
    and (
      p_week is null
      or (p_through_week and pp.week <= p_week)
      or (not p_through_week and pp.week = p_week)
    )
    and (
      coalesce(s.eliminated, false) = false
      or s.eliminated_week is null
      or pp.week <= s.eliminated_week
    )
    and (
      pp.user_id = auth.uid()
      or pp.locked_at <= v_effective_now
      or (
        coalesce(po.test_mode, false)
        and pp.week < coalesce(po.test_current_week, po.start_week, pp.week)
      )
    )
  order by pp.week, pp.slot, pp.entry_id;
end;
$function$;

create or replace function public.superadmin_finalize_test_week_drafts(
  p_pool_id uuid,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer := 0;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  with pool_settings as (
    select p.id, coalesce(p.deadline_mode, 'fixed') as deadline_mode
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.test_mode, false) = true
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.entry_id,
      d.week,
      d.slot,
      d.team_abbr,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.pool_week_games(p_pool_id, p_week) g
      on g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, lock_at, now()
    from draft_locks
    on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        locked_at = excluded.locked_at
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using draft_locks dl
    where d.pool_id = dl.pool_id
      and d.entry_id = dl.entry_id
      and d.week = dl.week
      and d.slot = dl.slot
    returning 1
  )
  select count(*)::integer into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.superadmin_set_pool_test_mode(
  p_pool_id uuid,
  p_enabled boolean
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_clock timestamptz;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  select coalesce(start_week, 1)
    into v_start_week
  from public.pools
  where id = p_pool_id;

  if v_start_week is null then
    raise exception 'Pool not found.';
  end if;

  if coalesce(p_enabled, false) then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
    v_clock := public.pool_test_clock_at(p_pool_id, v_start_week, 'before_week');
  end if;

  update public.pools
     set test_mode = coalesce(p_enabled, false),
         test_current_week = case when coalesce(p_enabled, false) then coalesce(test_current_week, v_start_week) else null end,
         test_now_at = case when coalesce(p_enabled, false) then coalesce(test_now_at, v_clock) else null end
   where id = p_pool_id;

  if coalesce(p_enabled, false) then
    return 'Test mode enabled.';
  end if;

  return 'Test mode disabled.';
end;
$function$;

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
  v_max_week integer;
  v_clock timestamptz;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

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

  v_clock := public.pool_test_clock_at(p_pool_id, p_week, 'before_week');

  update public.pools
     set test_current_week = p_week,
         test_now_at = v_clock
   where id = p_pool_id;

  return 'Test week set to Week ' || p_week || '. Clock reset to before the first kickoff.';
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
  v_max_week integer;
  v_clock timestamptz;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1), public.pool_max_pick_week(p_pool_id)
    into v_start_week, v_max_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > coalesce(v_max_week, 18) then
    raise exception 'Week must be between this pool''s start week (%) and Week %.', v_start_week, coalesce(v_max_week, 18);
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

  v_clock := public.pool_test_clock_at(p_pool_id, p_week, 'before_week');

  update public.pools
     set test_current_week = case
       when coalesce(test_current_week, start_week, v_start_week) > p_week then p_week
       else coalesce(test_current_week, start_week, v_start_week)
     end,
     test_now_at = v_clock
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
  v_clock timestamptz;
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

  perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  v_clock := public.pool_test_clock_at(p_pool_id, v_start_week, 'before_week');

  update public.pools
     set test_current_week = v_start_week,
         test_now_at = v_clock
   where id = p_pool_id;

  return 'Test pool reset to Week ' || v_start_week || '. Members and settings were kept; picks, fake outcomes, and stats were cleared.';
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
  v_max_week integer;
  v_next_week integer;
  v_next_clock timestamptz;
  v_missing_outcomes integer := 0;
  v_missing_outcome_teams text;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

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

drop function if exists public.superadmin_pool_overview();
create function public.superadmin_pool_overview()
returns table (
  pool_id uuid,
  name text,
  created_by uuid,
  owner_email text,
  is_public boolean,
  archived boolean,
  activation_status text,
  payment_status text,
  season integer,
  start_week integer,
  max_members integer,
  allow_multiple_entries boolean,
  max_entries_per_user integer,
  entries_count integer,
  unique_members_count integer,
  draft_picks_count integer,
  final_picks_count integer,
  stats_rows_count integer,
  created_at timestamptz,
  test_mode boolean,
  test_current_week integer,
  test_now_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id as pool_id,
    p.name::text,
    p.created_by,
    pp.email::text as owner_email,
    p.is_public,
    coalesce(p.archived, false) as archived,
    coalesce(p.activation_status, 'active')::text as activation_status,
    coalesce(p.payment_status, 'not_required')::text as payment_status,
    coalesce(p.season, extract(year from now())::integer) as season,
    p.start_week,
    p.max_members,
    coalesce(p.allow_multiple_entries, false) as allow_multiple_entries,
    coalesce(p.max_entries_per_user, 1) as max_entries_per_user,
    coalesce(pm.entries_count, 0)::integer as entries_count,
    coalesce(pm.unique_members_count, 0)::integer as unique_members_count,
    coalesce(d.draft_picks_count, 0)::integer as draft_picks_count,
    coalesce(fp.final_picks_count, 0)::integer as final_picks_count,
    coalesce(s.stats_rows_count, 0)::integer as stats_rows_count,
    p.created_at,
    coalesce(p.test_mode, false) as test_mode,
    p.test_current_week,
    p.test_now_at
  from public.pools p
  left join public.profiles_private pp
    on pp.id = p.created_by
  left join (
    select pool_id, count(*) as entries_count, count(distinct profile_id) as unique_members_count
    from public.pool_members
    group by pool_id
  ) pm on pm.pool_id = p.id
  left join (
    select pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts
    group by pool_id
  ) d on d.pool_id = p.id
  left join (
    select pool_id, count(*) as final_picks_count
    from public.pool_picks
    group by pool_id
  ) fp on fp.pool_id = p.id
  left join (
    select pool_id, count(*) as stats_rows_count
    from public.pool_member_stats
    group by pool_id
  ) s on s.pool_id = p.id
  order by p.created_at desc nulls last, p.name;
end;
$function$;

revoke execute on function public.pool_effective_now(uuid) from public, anon;
grant execute on function public.pool_effective_now(uuid) to authenticated, service_role;
revoke execute on function public.pool_test_clock_at(uuid, integer, text) from public, anon;
grant execute on function public.pool_test_clock_at(uuid, integer, text) to authenticated, service_role;
revoke execute on function public.superadmin_finalize_test_locked_picks(uuid, integer) from public, anon;
grant execute on function public.superadmin_finalize_test_locked_picks(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_set_test_pool_clock(uuid, integer, text) from public, anon;
grant execute on function public.superadmin_set_test_pool_clock(uuid, integer, text) to authenticated, service_role;
revoke execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;
revoke execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated, service_role;
revoke execute on function public.pool_visible_picks(uuid, integer, boolean) from public, anon;
grant execute on function public.pool_visible_picks(uuid, integer, boolean) to authenticated, service_role;
revoke execute on function public.superadmin_finalize_test_week_drafts(uuid, integer) from public, anon;
grant execute on function public.superadmin_finalize_test_week_drafts(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_set_pool_test_mode(uuid, boolean) from public, anon;
grant execute on function public.superadmin_set_pool_test_mode(uuid, boolean) to authenticated, service_role;
revoke execute on function public.superadmin_set_test_pool_week(uuid, integer) from public, anon;
grant execute on function public.superadmin_set_test_pool_week(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_clear_test_week_results(uuid, integer) from public, anon;
grant execute on function public.superadmin_clear_test_week_results(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_reset_test_pool(uuid) from public, anon;
grant execute on function public.superadmin_reset_test_pool(uuid) to authenticated, service_role;
revoke execute on function public.superadmin_score_test_pool_week(uuid, integer) from public, anon;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_pool_overview() from public, anon;
grant execute on function public.superadmin_pool_overview() to authenticated, service_role;

commit;
