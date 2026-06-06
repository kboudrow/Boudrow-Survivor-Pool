-- Tighten admin-editable pool settings.

create or replace function public.admin_update_pool_member_limit(
  p_pool_id uuid,
  p_max_members integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_first_start timestamptz;
  v_member_count integer;
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
    and g.week = v_pool.start_week;

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  if p_max_members is null or p_max_members < 2 or p_max_members > 500 then
    raise exception 'Member limit must be between 2 and 500.';
  end if;

  select count(*)
  into v_member_count
  from public.pool_members
  where pool_id = p_pool_id;

  if p_max_members < v_member_count then
    raise exception 'Member limit cannot be lower than the current member count (%).', v_member_count;
  end if;

  update public.pools
  set max_members = p_max_members
  where id = p_pool_id;
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
    and g.week = v_pool.start_week;

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  select coalesce(array_agg(distinct week order by week), '{}'::integer[])
  into v_weeks
  from unnest(coalesce(p_weeks, '{}'::integer[])) as w(week)
  where week between 1 and 18;

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
    and g.week = v_pool.start_week;

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  update public.pools
  set archived = p_archived,
      archived_at = case when p_archived then now() else null end
  where id = p_pool_id;
end;
$function$;
