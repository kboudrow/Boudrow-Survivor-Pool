-- Superadmin-only test mode for safely simulating future weeks.
-- This never mutates global NFL games or real pool results unless the selected
-- pool is explicitly marked as a test pool.

alter table public.pools
  add column if not exists test_mode boolean not null default false,
  add column if not exists test_current_week integer;

alter table public.pools
  drop constraint if exists pools_test_current_week_check;

alter table public.pools
  add constraint pools_test_current_week_check
  check (test_current_week is null or test_current_week between 1 and 18);

create table if not exists public.test_pool_team_results (
  pool_id uuid not null references public.pools(id) on delete cascade,
  week integer not null check (week between 1 and 18),
  team_abbr text not null,
  result text not null check (result in ('win', 'loss', 'push')),
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (pool_id, week, team_abbr)
);

alter table public.test_pool_team_results enable row level security;

drop policy if exists test_pool_team_results_superadmin_all on public.test_pool_team_results;
create policy test_pool_team_results_superadmin_all
on public.test_pool_team_results
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create or replace function public.test_pool_game_outcome(
  p_pool_id uuid,
  p_week integer,
  p_home_team text,
  p_away_team text
)
returns text
language sql
security definer
set search_path to 'public'
as $function$
  select case
    when home_result.result = 'win' and away_result.result = 'loss' then 'home'
    when away_result.result = 'win' and home_result.result = 'loss' then 'away'
    when home_result.result = 'push' and away_result.result = 'push' then 'tie'
    else null
  end
  from (select 1) seed
  left join public.test_pool_team_results home_result
    on home_result.pool_id = p_pool_id
   and home_result.week = p_week
   and home_result.team_abbr = p_home_team
  left join public.test_pool_team_results away_result
    on away_result.pool_id = p_pool_id
   and away_result.week = p_week
   and away_result.team_abbr = p_away_team
$function$;

create or replace function public.superadmin_assert_test_pool(p_pool_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.test_mode, false) = true
  ) then
    raise exception 'This pool is not in test mode.';
  end if;
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

  update public.pools
     set test_mode = coalesce(p_enabled, false),
         test_current_week = case when coalesce(p_enabled, false) then coalesce(test_current_week, v_start_week) else null end
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
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if p_week < 1 or p_week > 18 then
    raise exception 'Week must be between 1 and 18.';
  end if;

  update public.pools
     set test_current_week = p_week
   where id = p_pool_id;

  return 'Test week set to Week ' || p_week || '.';
end;
$function$;

drop function if exists public.superadmin_test_pool_week_options(uuid, integer);

create function public.superadmin_test_pool_week_options(
  p_pool_id uuid,
  p_week integer
)
returns table (
  game_id text,
  season integer,
  week integer,
  away_team text,
  home_team text,
  game_time timestamptz,
  away_pick_count integer,
  home_pick_count integer,
  fake_outcome text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_season integer;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.season, extract(year from now())::integer)
    into v_season
  from public.pools p
  where p.id = p_pool_id;

  return query
  with pick_counts as (
    select picked_teams.team_abbr, count(*)::integer as pick_count
    from (
      select d.team_abbr
      from public.pool_pick_drafts d
      where d.pool_id = p_pool_id
        and d.week = p_week
      union all
      select pp.team_abbr
      from public.pool_picks pp
      where pp.pool_id = p_pool_id
        and pp.week = p_week
        and pp.team_abbr not like 'NO_PICK%'
    ) picked_teams
    group by picked_teams.team_abbr
  )
  select
    g.id::text as game_id,
    g.season,
    g.week,
    g.away_team::text,
    g.home_team::text,
    coalesce(g.kickoff_at_utc, g.game_time) as game_time,
    coalesce(away_counts.pick_count, 0)::integer as away_pick_count,
    coalesce(home_counts.pick_count, 0)::integer as home_pick_count,
    public.test_pool_game_outcome(p_pool_id, p_week, g.home_team::text, g.away_team::text) as fake_outcome
  from public.nfl_games g
  left join pick_counts away_counts on away_counts.team_abbr = g.away_team
  left join pick_counts home_counts on home_counts.team_abbr = g.home_team
  where g.season = v_season
    and g.week = p_week
  order by coalesce(g.kickoff_at_utc, g.game_time), g.away_team, g.home_team;
end;
$function$;

create or replace function public.superadmin_set_test_game_outcome(
  p_pool_id uuid,
  p_week integer,
  p_away_team text,
  p_home_team text,
  p_outcome text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_away text := upper(trim(p_away_team));
  v_home text := upper(trim(p_home_team));
  v_outcome text := lower(coalesce(trim(p_outcome), ''));
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if p_week < 1 or p_week > 18 then
    raise exception 'Week must be between 1 and 18.';
  end if;

  if v_away = '' or v_home = '' or v_away = v_home then
    raise exception 'Invalid matchup.';
  end if;

  delete from public.test_pool_team_results
  where pool_id = p_pool_id
    and week = p_week
    and team_abbr in (v_away, v_home);

  if v_outcome = '' then
    return 'Test game outcome cleared.';
  end if;

  if v_outcome not in ('away', 'home', 'tie') then
    raise exception 'Outcome must be away, home, or tie.';
  end if;

  insert into public.test_pool_team_results (pool_id, week, team_abbr, result, created_by, updated_at)
  values
    (
      p_pool_id,
      p_week,
      v_away,
      case when v_outcome = 'away' then 'win' when v_outcome = 'home' then 'loss' else 'push' end,
      auth.uid(),
      now()
    ),
    (
      p_pool_id,
      p_week,
      v_home,
      case when v_outcome = 'home' then 'win' when v_outcome = 'away' then 'loss' else 'push' end,
      auth.uid(),
      now()
    )
  on conflict (pool_id, week, team_abbr) do update
  set result = excluded.result,
      created_by = excluded.created_by,
      updated_at = now();

  return 'Test game outcome saved.';
end;
$function$;

create or replace function public.superadmin_set_test_team_result(
  p_pool_id uuid,
  p_week integer,
  p_team_abbr text,
  p_result text
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if p_week < 1 or p_week > 18 then
    raise exception 'Week must be between 1 and 18.';
  end if;

  if p_result is null or p_result = '' then
    delete from public.test_pool_team_results
    where pool_id = p_pool_id
      and week = p_week
      and team_abbr = upper(trim(p_team_abbr));
    return 'Test result cleared.';
  end if;

  if lower(p_result) not in ('win', 'loss', 'push') then
    raise exception 'Result must be win, loss, or push.';
  end if;

  insert into public.test_pool_team_results (pool_id, week, team_abbr, result, created_by, updated_at)
  values (p_pool_id, p_week, upper(trim(p_team_abbr)), lower(p_result), auth.uid(), now())
  on conflict (pool_id, week, team_abbr) do update
  set result = excluded.result,
      created_by = excluded.created_by,
      updated_at = now();

  return 'Test result saved.';
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
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

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

  return 'Test results cleared for Week ' || p_week || '.';
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
  v_finalized integer := 0;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  with moved as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select d.pool_id, d.user_id, d.entry_id, d.week, d.slot, d.team_abbr, now(), now()
    from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.week = p_week
    on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        locked_at = excluded.locked_at,
        result = null,
        adjudicated_at = null
    returning 1
  ),
  removed as (
    delete from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.week = p_week
    returning 1
  )
  select count(*) into v_finalized from moved;

  return coalesce(v_finalized, 0);
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
  v_scored integer := 0;
  v_no_picks integer := 0;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
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
      and coalesce(pm.status, 'active') = 'active'
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
    select pool_id, user_id, entry_id, week, slot, team_abbr, now(), 'loss', now(), now()
    from missing
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  )
  select count(*) into v_no_picks from inserted_no_picks;

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
  select count(*) into v_scored from updated;

  with entry_results as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
      count(pp.*) filter (where pp.result = 'win')::int as wins,
      count(pp.*) filter (where pp.result = 'loss')::int as losses,
      count(pp.*) filter (where pp.result = 'push')::int as pushes,
      count(pp.*) filter (where pp.result = 'loss')::int as strikes_used
    from public.pool_members pm
    join public.pools po on po.id = pm.pool_id
    left join public.pool_picks pp
      on pp.pool_id = pm.pool_id
     and pp.entry_id = pm.id
     and pp.result is not null
    where pm.pool_id = p_pool_id
    group by pm.pool_id, pm.profile_id, pm.id, po.strikes_allowed
  ),
  first_elimination as (
    select pool_id, entry_id, min(week) as eliminated_week
    from (
      select
        pp.pool_id,
        pp.entry_id,
        pp.week,
        coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
        count(*) filter (where pp.result = 'loss') over (
          partition by pp.pool_id, pp.entry_id
          order by pp.week, pp.slot
          rows between unbounded preceding and current row
        ) as running_strikes
      from public.pool_picks pp
      join public.pools po on po.id = pp.pool_id
      where pp.pool_id = p_pool_id
        and pp.result is not null
    ) progress
    where running_strikes > strikes_allowed
    group by pool_id, entry_id
  )
  insert into public.pool_member_stats (
    pool_id,
    user_id,
    entry_id,
    wins,
    losses,
    pushes,
    strikes_used,
    eliminated,
    eliminated_week,
    updated_at
  )
  select
    er.pool_id,
    er.user_id,
    er.entry_id,
    er.wins,
    er.losses,
    er.pushes,
    er.strikes_used,
    er.strikes_used > er.strikes_allowed,
    fe.eliminated_week,
    now()
  from entry_results er
  left join first_elimination fe
    on fe.pool_id = er.pool_id
   and fe.entry_id = er.entry_id
  on conflict (pool_id, entry_id) do update
  set user_id = excluded.user_id,
      wins = excluded.wins,
      losses = excluded.losses,
      pushes = excluded.pushes,
      strikes_used = excluded.strikes_used,
      eliminated = excluded.eliminated,
      eliminated_week = excluded.eliminated_week,
      updated_at = excluded.updated_at;

  update public.pools
     set test_current_week = least(18, greatest(coalesce(test_current_week, p_week), p_week + 1))
   where id = p_pool_id;

  return 'Week ' || p_week || ' scored. ' || v_scored || ' picks graded, ' || v_no_picks || ' no-picks recorded.';
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
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(start_week, 1)
    into v_start_week
  from public.pools
  where id = p_pool_id;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  select pp.pool_id, pp.user_id, pp.entry_id, pp.week, pp.slot, pp.team_abbr, now()
  from public.pool_picks pp
  where pp.pool_id = p_pool_id
    and pp.team_abbr not like 'NO_PICK%'
  on conflict (pool_id, entry_id, week, slot) do update
  set team_abbr = excluded.team_abbr,
      updated_at = now();

  delete from public.pool_picks
  where pool_id = p_pool_id;

  delete from public.pool_member_stats
  where pool_id = p_pool_id;

  delete from public.test_pool_team_results
  where pool_id = p_pool_id;

  update public.pools
     set test_current_week = v_start_week
   where id = p_pool_id;

  return 'Test pool reset to Week ' || v_start_week || '.';
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
  test_current_week integer
)
language plpgsql
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
    coalesce(p.activation_status, 'draft')::text as activation_status,
    coalesce(p.payment_status, 'unpaid')::text as payment_status,
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
    p.test_current_week
  from public.pools p
  left join public.profiles_private pp on pp.id = p.created_by
  left join (
    select
      pm_counts.pool_id,
      count(*) as entries_count,
      count(distinct pm_counts.profile_id) as unique_members_count
    from public.pool_members pm_counts
    group by pm_counts.pool_id
  ) pm on pm.pool_id = p.id
  left join (
    select d_counts.pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts d_counts
    group by d_counts.pool_id
  ) d on d.pool_id = p.id
  left join (
    select fp_counts.pool_id, count(*) as final_picks_count
    from public.pool_picks fp_counts
    group by fp_counts.pool_id
  ) fp on fp.pool_id = p.id
  left join (
    select s_counts.pool_id, count(*) as stats_rows_count
    from public.pool_member_stats s_counts
    group by s_counts.pool_id
  ) s on s.pool_id = p.id
  order by p.created_at desc nulls last;
end;
$function$;

grant execute on function public.superadmin_assert_test_pool(uuid) to authenticated;
grant execute on function public.superadmin_set_pool_test_mode(uuid, boolean) to authenticated;
grant execute on function public.superadmin_set_test_pool_week(uuid, integer) to authenticated;
grant execute on function public.superadmin_test_pool_week_options(uuid, integer) to authenticated;
grant execute on function public.superadmin_set_test_team_result(uuid, integer, text, text) to authenticated;
grant execute on function public.superadmin_set_test_game_outcome(uuid, integer, text, text, text) to authenticated;
grant execute on function public.test_pool_game_outcome(uuid, integer, text, text) to authenticated;
grant execute on function public.superadmin_clear_test_week_results(uuid, integer) to authenticated;
grant execute on function public.superadmin_finalize_test_week_drafts(uuid, integer) to authenticated;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated;
grant execute on function public.superadmin_reset_test_pool(uuid) to authenticated;
