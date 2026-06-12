-- Keep pool rules consistent between create, admin, picks, and standings.

update public.pools
set tie_rule = 'loss'
where tie_rule::text = 'push';

alter table public.pools
  drop constraint if exists pools_tie_rule_win_loss_check;

alter table public.pools
  add constraint pools_tie_rule_win_loss_check
  check (tie_rule is null or tie_rule::text in ('win', 'loss'));

update public.pools
set double_pick_weeks = coalesce(
  (
    select array_agg(week order by week)
    from unnest(coalesce(double_pick_weeks, '{}'::integer[])) as w(week)
    where week >= coalesce(start_week, 1)
      and week between 1 and 18
  ),
  '{}'::integer[]
);

create or replace function public.picks_allowed(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer := 1;
  v_double_weeks integer[] := '{}'::integer[];
begin
  select coalesce(p.start_week, 1), coalesce(p.double_pick_weeks, '{}'::integer[])
  into v_start_week, v_double_weeks
  from public.pools p
  where p.id = p_pool_id;

  if not found or p_week < v_start_week or p_week < 1 or p_week > 18 then
    return 0;
  end if;

  if p_week = any(v_double_weeks) then
    return 2;
  end if;

  return 1;
end;
$function$;

create or replace function public.enforce_weekly_draft_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  allowed int;
  current_count int;
  is_out boolean := false;
begin
  select public.picks_allowed(new.pool_id, new.week) into allowed;

  if allowed < 1 then
    raise exception 'This pool does not allow picks for week %.', new.week;
  end if;

  select coalesce(s.eliminated, false)
  into is_out
  from public.pool_member_stats s
  where s.pool_id = new.pool_id
    and s.user_id = new.user_id;

  if coalesce(is_out, false) then
    raise exception 'Eliminated players cannot make new picks.';
  end if;

  if new.slot < 1 or new.slot > allowed then
    raise exception 'Slot % is not available for week %. This pool allows % pick(s).', new.slot, new.week, allowed;
  end if;

  if exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = new.pool_id
      and d.user_id = new.user_id
      and d.week = new.week
      and d.team_abbr = upper(new.team_abbr)
      and (tg_op <> 'UPDATE' or d.slot <> old.slot)
  ) then
    raise exception 'Team % is already selected for week %.', upper(new.team_abbr), new.week;
  end if;

  select count(*) into current_count
  from public.pool_pick_drafts d
  where d.pool_id = new.pool_id
    and d.user_id = new.user_id
    and d.week = new.week;

  if tg_op = 'UPDATE'
     and (new.pool_id, new.user_id, new.week, new.slot) = (old.pool_id, old.user_id, old.week, old.slot)
  then
    current_count := current_count - 1;
  end if;

  if current_count >= allowed then
    raise exception 'You have reached the maximum of % pick(s) for week % in this pool.', allowed, new.week;
  end if;

  new.team_abbr := upper(new.team_abbr);
  return new;
end;
$function$;

create or replace function public.pool_week_deadline_at(p_pool_id uuid, p_week integer)
returns timestamptz
language sql
security definer
set search_path to 'public'
as $function$
  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  week_games as (
    select max(coalesce(g.kickoff_at_utc, g.game_time)) as last_kickoff
    from public.nfl_games g
    join pool_settings ps on ps.season = g.season
    where g.week = p_week
  )
  select
    case
      when ps.deadline_mode = 'fixed' and ps.deadline_fixed <> '20:15' and sw.week_sunday_date is not null then
        ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
      else wg.last_kickoff
    end
  from pool_settings ps
  left join public.season_weeks sw on sw.season = ps.season and sw.week = p_week
  cross join week_games wg
$function$;

create or replace function public.finalize_locked_picks(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int;
begin
  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.week,
      d.slot,
      d.team_abbr,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= now()
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, week, slot, team_abbr, lock_at, now()
    from to_commit
    on conflict (pool_id, user_id, week, slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.user_id = tc.user_id
      and d.week = tc.week
      and d.slot = tc.slot
    returning 1
  )
  select count(*) into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_no_pick_losses(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int := 0;
  week_deadline timestamptz;
begin
  select public.pool_week_deadline_at(p_pool_id, p_week) into week_deadline;

  if week_deadline is null or now() < week_deadline or public.picks_allowed(p_pool_id, p_week) < 1 then
    return 0;
  end if;

  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  ),
  missing as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      p_week as week,
      slots.slot,
      ('NO_PICK_' || slots.slot)::text as team_abbr
    from public.pool_members pm
    cross join slots
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.user_id = pm.profile_id
    where pm.pool_id = p_pool_id
      and coalesce(s.eliminated, false) = false
      and not exists (
        select 1
        from public.pool_picks pp
        where pp.pool_id = pm.pool_id
          and pp.user_id = pm.profile_id
          and pp.week = p_week
          and pp.slot = slots.slot
      )
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
    select pool_id, user_id, week, slot, team_abbr, week_deadline, 'loss', now(), now()
    from missing
    on conflict (pool_id, user_id, week, slot) do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_locked_picks_for_pool(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  week_number int;
  total_inserted int := 0;
begin
  for week_number in 1..18 loop
    total_inserted := total_inserted + public.finalize_locked_picks(p_pool_id, week_number);
    total_inserted := total_inserted + public.finalize_no_pick_losses(p_pool_id, week_number);
  end loop;

  return total_inserted;
end;
$function$;

create or replace function public.admin_set_double_weeks(
  p_pool_id uuid,
  p_weeks integer[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_first_start timestamptz;
  v_weeks integer[];
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    p.id,
    coalesce(p.season, extract(year from now())::integer) as season,
    coalesce(p.start_week, 1) as start_week
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if v_pool.id is null then
    raise exception 'pool not found';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_first_start
  from public.nfl_games g
  where g.season = v_pool.season
    and g.week = v_pool.start_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(v_pool.season, 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  select coalesce(array_agg(distinct week order by week), '{}'::integer[])
  into v_weeks
  from unnest(coalesce(p_weeks, '{}'::integer[])) as w(week)
  where week between v_pool.start_week and 18;

  update public.pools
  set double_pick_weeks = v_weeks
  where id = p_pool_id;
end;
$function$;

create or replace function public.admin_archive_pool(
  p_pool_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_first_start timestamptz;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    p.id,
    coalesce(p.season, extract(year from now())::integer) as season,
    coalesce(p.start_week, 1) as start_week,
    coalesce(p.payment_status::text, 'unpaid') as payment_status,
    coalesce(p.activation_status::text, 'draft') as activation_status
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if v_pool.id is null then
    raise exception 'pool not found';
  end if;

  if p_archived and (v_pool.payment_status = 'paid' or v_pool.activation_status = 'active') then
    raise exception 'Paid or active pools cannot be archived.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_first_start
  from public.nfl_games g
  where g.season = v_pool.season
    and g.week = v_pool.start_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(v_pool.season, 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  update public.pools
  set archived = p_archived,
      archived_at = case when p_archived then now() else null end
  where id = p_pool_id;
end;
$function$;
