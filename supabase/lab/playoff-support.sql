-- Playoff support lab SQL.
--
-- This file is intentionally outside supabase/migrations so it cannot be
-- pushed to production accidentally. Move this into migrations only after the
-- playoff schedule model and test-mode behavior are ready.

begin;

create or replace function public.pool_max_week(p_pool_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when coalesce(p.include_playoffs, false) then 22
    else 18
  end
  from public.pools p
  where p.id = p_pool_id
$function$;

alter table public.pools
  drop constraint if exists pools_test_current_week_check;

alter table public.pools
  add constraint pools_test_current_week_check
  check (test_current_week is null or test_current_week between 1 and 22);

alter table public.test_pool_team_results
  drop constraint if exists test_pool_team_results_week_check;

alter table public.test_pool_team_results
  add constraint test_pool_team_results_week_check
  check (week between 1 and 22);

create or replace function public.picks_allowed(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer := 1;
  v_max_week integer := 18;
  v_double_weeks integer[] := '{}'::integer[];
begin
  select
    coalesce(p.start_week, 1),
    public.pool_max_week(p.id),
    coalesce(p.double_pick_weeks, '{}'::integer[])
  into v_start_week, v_max_week, v_double_weeks
  from public.pools p
  where p.id = p_pool_id;

  if not found or p_week < v_start_week or p_week < 1 or p_week > v_max_week then
    return 0;
  end if;

  -- Keep double-pick settings regular-season only unless we design explicit
  -- playoff double-pick rules.
  if p_week <= 18 and p_week = any(v_double_weeks) then
    return 2;
  end if;

  return 1;
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
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1), public.pool_max_week(p.id)
    into v_start_week, v_max_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > v_max_week then
    raise exception 'Round must be between this pool''s start week (%) and max week %.', v_start_week, v_max_week;
  end if;

  update public.pools
     set test_current_week = p_week
   where id = p_pool_id;

  return 'Test pool moved to round ' || p_week || '.';
end;
$function$;

-- Still needed before this becomes a migration:
-- 1. Add audited playoff games into nfl_games as weeks 19-22 once matchups are known.
-- 2. Update superadmin_randomize_test_week_outcomes to use pool_max_week.
-- 3. Update superadmin_clear_test_week_results to use pool_max_week.
-- 4. Update superadmin_score_test_pool_week to advance through pool_max_week.
-- 5. Decide final winner behavior when multiple entries survive the Super Bowl.

rollback;
