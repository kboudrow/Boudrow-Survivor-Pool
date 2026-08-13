begin;

-- The dashboard has always opened the next survivor week at 6:00 a.m. Eastern
-- on Wednesday. Make that boundary database-authoritative so direct RPC calls,
-- stale tabs, and manipulated device clocks cannot submit a later week early.
create or replace function public.pool_open_pick_week(p_pool_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_now timestamptz;
  v_max_week integer;
  v_open_week integer;
  v_week integer;
  v_opens_at timestamptz;
begin
  select * into v_pool from public.pools p where p.id = p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;

  if auth.uid() is not null
     and not public.admin_can_manage(p_pool_id)
     and not exists (
       select 1 from public.pool_members pm
       where pm.pool_id = p_pool_id and pm.profile_id = auth.uid()
     ) then
    raise exception 'not authorized';
  end if;

  v_max_week := coalesce(public.pool_max_pick_week(p_pool_id), 18);
  if coalesce(v_pool.test_mode, false) then
    return least(v_max_week, greatest(v_pool.start_week, coalesce(v_pool.test_current_week, v_pool.start_week)));
  end if;

  v_now := public.pool_effective_now(p_pool_id);
  v_open_week := v_pool.start_week;

  for v_week, v_opens_at in
    select sw.week,
      ((sw.week_sunday_date - 5)::date + time '06:00') at time zone 'America/New_York'
    from public.season_weeks sw
    where sw.season = v_pool.season
      and sw.week between v_pool.start_week and v_max_week
    order by sw.week
  loop
    if v_opens_at <= v_now then v_open_week := v_week; end if;
  end loop;

  return least(v_max_week, greatest(v_pool.start_week, v_open_week));
end;
$function$;

-- A survivor week is grading-complete when every pick slot belonging to an
-- entry that entered the week alive has a durable result. It deliberately does
-- not wait for unrelated NFL games, while a postponed/late game containing a
-- survivor pick keeps the week pending.
create or replace function public.pool_week_grading_complete(p_pool_id uuid, p_week integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with required_entries as (
    select pm.id
    from public.pool_members pm
    left join public.pool_member_stats stats
      on stats.pool_id = pm.pool_id and stats.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and (stats.eliminated_week is null or stats.eliminated_week >= p_week)
  ), expected as (
    select count(*)::integer * public.picks_allowed(p_pool_id, p_week) as pick_count
    from required_entries
  ), completed as (
    select count(*)::integer as pick_count
    from public.pool_picks pick
    join required_entries entry on entry.id = pick.entry_id
    where pick.pool_id = p_pool_id
      and pick.week = p_week
      and pick.slot between 1 and public.picks_allowed(p_pool_id, p_week)
      and pick.result is not null
  )
  select coalesce(expected.pick_count > 0 and completed.pick_count = expected.pick_count, false)
  from expected cross join completed
$function$;

-- Keep the same per-entry lock used by normal pick writes, then reject every
-- week except the one the authoritative database clock says is open.
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
  v_open_week integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0));
  v_open_week := public.pool_open_pick_week(p_pool_id);
  if p_week is distinct from v_open_week then
    raise exception 'Week % is not available for picks. Week % is currently open.', p_week, v_open_week;
  end if;
  perform public.save_entry_draft_pick_unserialized(p_pool_id, p_entry_id, p_week, p_slot, p_team_abbr);
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
  v_open_week integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0));
  v_open_week := public.pool_open_pick_week(p_pool_id);
  if p_week is distinct from v_open_week then
    raise exception 'Week % is not available for pick changes. Week % is currently open.', p_week, v_open_week;
  end if;
  perform public.clear_entry_draft_pick_unserialized(p_pool_id, p_entry_id, p_week, p_slot);
end;
$function$;

-- Do not persist the simultaneous-elimination survival credit until every
-- relevant slot is graded. The ordinary deterministic rebuild will create it
-- on the first safe rerun after a late result arrives.
create or replace function public.guard_survival_grace_grading_complete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.pool_week_grading_complete(new.pool_id, new.week) then
    return null;
  end if;
  return new;
end;
$function$;

drop trigger if exists aaa_guard_survival_grace_grading_complete on public.pool_entry_survival_graces;
create trigger aaa_guard_survival_grace_grading_complete
before insert or update on public.pool_entry_survival_graces
for each row execute function public.guard_survival_grace_grading_complete();

-- A lone currently-alive entry is only a winner after the deciding week's full
-- survivor ledger is graded. This prevents Sunday results from prematurely
-- closing a pool whose Monday pick can still produce a same-week wipeout.
create or replace function public.pool_has_declared_winner(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with entry_status as (
    select pm.id as entry_id,
      coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive') as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s on s.pool_id = pm.pool_id and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ), totals as (
    select count(*)::integer as total_entries,
      count(*) filter (where not eliminated)::integer as alive_entries,
      max(eliminated_week) filter (where eliminated_week is not null)::integer as decided_week
    from entry_status
  )
  select coalesce(total_entries > 1 and alive_entries = 1
    and decided_week is not null
    and public.pool_week_grading_complete(p_pool_id, decided_week), false)
  from totals
$function$;

create or replace function public.pool_winner_decided_week(p_pool_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  with entry_status as (
    select coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive') as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s on s.pool_id = pm.pool_id and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ), totals as (
    select count(*)::integer as total_entries,
      count(*) filter (where not eliminated)::integer as alive_entries,
      max(eliminated_week) filter (where eliminated_week is not null)::integer as decided_week
    from entry_status
  )
  select case when total_entries > 1 and alive_entries = 1
      and decided_week is not null
      and public.pool_week_grading_complete(p_pool_id, decided_week)
    then decided_week else null end
  from totals
$function$;

create or replace function public.pool_winner_status(p_pool_id uuid)
returns table (
  is_decided boolean,
  winner_user_id uuid,
  winner_name text,
  winner_avatar_url text,
  alive_members integer,
  alive_entries integer,
  total_members integer,
  total_entries integer,
  decided_week integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Please sign in to view this pool.'; end if;
  if not public.admin_can_manage(p_pool_id) and not exists (
    select 1 from public.pool_members mine where mine.pool_id = p_pool_id and mine.profile_id = auth.uid()
  ) then raise exception 'not authorized'; end if;

  return query
  with entry_status as (
    select pm.id as entry_id, pm.profile_id, pm.entry_number,
      coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive') as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s on s.pool_id = pm.pool_id and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ), totals as (
    select count(distinct profile_id)::integer as total_members,
      count(*)::integer as total_entries,
      count(distinct profile_id) filter (where not eliminated)::integer as alive_members,
      count(*) filter (where not eliminated)::integer as alive_entries,
      max(eliminated_week) filter (where eliminated_week is not null)::integer as decided_week
    from entry_status
  ), decision as (
    select totals.*,
      totals.total_entries > 1 and totals.alive_entries = 1
        and totals.decided_week is not null
        and public.pool_week_grading_complete(p_pool_id, totals.decided_week) as ready
    from totals
  ), winner as (
    select status.profile_id, status.entry_number
    from entry_status status where not status.eliminated
    order by status.entry_number, status.entry_id limit 1
  )
  select d.ready,
    case when d.ready then w.profile_id else null end,
    case when d.ready then (coalesce(nullif(profile.username::text, ''),
      nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
      'Player ' || left(w.profile_id::text, 8))
      || case when w.entry_number > 1 then ' (Entry ' || w.entry_number || ')' else '' end)::text else null end,
    case when d.ready then profile.avatar_url::text else null end,
    coalesce(d.alive_members, 0), coalesce(d.alive_entries, 0),
    coalesce(d.total_members, 0), coalesce(d.total_entries, 0),
    case when d.ready then d.decided_week else null end
  from decision d
  left join winner w on true
  left join public.profiles_public profile on profile.id = w.profile_id;
end;
$function$;

-- Remove any premature, still-incomplete grace created by an older scoring run.
-- Rebuild only affected pools; the guard above prevents recreation until safe.
do $function$
declare
  v_pool_id uuid;
begin
  for v_pool_id in
    with removed as (
      delete from public.pool_entry_survival_graces grace
      where not public.pool_week_grading_complete(grace.pool_id, grace.week)
      returning grace.pool_id
    )
    select distinct removed.pool_id from removed
  loop
    perform public.rebuild_pool_member_stats(v_pool_id);
  end loop;
end;
$function$;

revoke all on function public.pool_open_pick_week(uuid) from public, anon;
revoke all on function public.pool_week_grading_complete(uuid, integer) from public, anon, authenticated;
revoke all on function public.guard_survival_grace_grading_complete() from public, anon, authenticated;
grant execute on function public.pool_open_pick_week(uuid) to authenticated, service_role;
grant execute on function public.pool_week_grading_complete(uuid, integer) to service_role;
grant execute on function public.guard_survival_grace_grading_complete() to service_role;

revoke execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
revoke execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated, service_role;

commit;
