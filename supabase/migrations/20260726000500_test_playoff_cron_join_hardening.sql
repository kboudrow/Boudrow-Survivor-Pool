begin;

-- Test-mode playoff support stays pool-scoped so simulated postseason games
-- never pollute the audited global NFL schedule.
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

create table if not exists public.test_pool_playoff_games (
  pool_id uuid not null references public.pools(id) on delete cascade,
  week integer not null check (week between 19 and 22),
  slot integer not null check (slot >= 1),
  away_team text not null,
  home_team text not null,
  kickoff_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'final')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pool_id, week, slot),
  check (upper(btrim(away_team)) <> upper(btrim(home_team)))
);

create index if not exists idx_test_pool_playoff_games_pool_week
on public.test_pool_playoff_games (pool_id, week, kickoff_at);

alter table public.test_pool_playoff_games enable row level security;

drop policy if exists test_pool_playoff_games_superadmin_all on public.test_pool_playoff_games;
create policy test_pool_playoff_games_superadmin_all
on public.test_pool_playoff_games
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

create or replace function public.pool_max_pick_week(p_pool_id uuid)
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  select case when coalesce(p.include_playoffs, false) then 22 else 18 end
  from public.pools p
  where p.id = p_pool_id
$function$;

create or replace function public.superadmin_ensure_test_pool_playoff_games(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_inserted integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  select
    p.id,
    coalesce(p.season, extract(year from now())::integer) as season,
    coalesce(p.include_playoffs, false) as include_playoffs
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if v_pool.id is null then
    raise exception 'Pool not found.';
  end if;

  if not v_pool.include_playoffs then
    return 0;
  end if;

  with playoff_games(week, slot, away_team, home_team, month_num, day_num, hour_num, minute_num) as (
    values
      (19, 1, 'LAC', 'BAL', 1, 9, 16, 30),
      (19, 2, 'PIT', 'BUF', 1, 10, 13, 0),
      (19, 3, 'DEN', 'KC', 1, 10, 16, 30),
      (19, 4, 'GB', 'PHI', 1, 10, 20, 15),
      (19, 5, 'WAS', 'TB', 1, 11, 16, 30),
      (19, 6, 'MIN', 'LAR', 1, 11, 20, 15),
      (20, 1, 'BAL', 'KC', 1, 16, 16, 30),
      (20, 2, 'BUF', 'LAC', 1, 16, 20, 15),
      (20, 3, 'TB', 'PHI', 1, 17, 15, 0),
      (20, 4, 'LAR', 'SF', 1, 17, 18, 30),
      (21, 1, 'KC', 'BUF', 1, 24, 15, 0),
      (21, 2, 'PHI', 'SF', 1, 24, 18, 30),
      (22, 1, 'BUF', 'SF', 2, 14, 18, 30)
  ),
  inserted as (
    insert into public.test_pool_playoff_games (
      pool_id,
      week,
      slot,
      away_team,
      home_team,
      kickoff_at,
      status,
      updated_at
    )
    select
      p_pool_id,
      pg.week,
      pg.slot,
      pg.away_team,
      pg.home_team,
      make_timestamptz(v_pool.season + 1, pg.month_num, pg.day_num, pg.hour_num, pg.minute_num, 0, 'America/New_York'),
      'scheduled',
      now()
    from playoff_games pg
    on conflict (pool_id, week, slot) do update
      set away_team = excluded.away_team,
          home_team = excluded.home_team,
          kickoff_at = excluded.kickoff_at,
          updated_at = now()
    returning 1
  )
  select count(*)::integer into v_inserted
  from inserted;

  return coalesce(v_inserted, 0);
end;
$function$;

create or replace function public.pool_week_games(
  p_pool_id uuid,
  p_week integer
)
returns table (
  id text,
  season integer,
  week integer,
  game_time timestamptz,
  kickoff_at_utc timestamptz,
  home_team text,
  away_team text,
  status text,
  winner text,
  home_score integer,
  away_score integer,
  is_test_game boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_season integer;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  v_season := coalesce(v_pool.season, extract(year from now())::integer);

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.include_playoffs, false)
    and p_week between 19 and 22 then
    return query
    select
      ('test-' || g.pool_id::text || '-' || g.week::text || '-' || g.slot::text)::text as id,
      v_season as season,
      g.week,
      g.kickoff_at as game_time,
      g.kickoff_at as kickoff_at_utc,
      upper(btrim(g.home_team))::text as home_team,
      upper(btrim(g.away_team))::text as away_team,
      g.status::text as status,
      null::text as winner,
      null::integer as home_score,
      null::integer as away_score,
      true as is_test_game
    from public.test_pool_playoff_games g
    where g.pool_id = p_pool_id
      and g.week = p_week
    order by g.kickoff_at, g.slot;

    return;
  end if;

  return query
  select
    g.id::text,
    g.season,
    g.week,
    coalesce(g.kickoff_at_utc, g.game_time)::timestamptz as game_time,
    coalesce(g.kickoff_at_utc, g.game_time)::timestamptz as kickoff_at_utc,
    upper(btrim(g.home_team))::text as home_team,
    upper(btrim(g.away_team))::text as away_team,
    g.status::text,
    upper(btrim(g.winner))::text as winner,
    g.home_score,
    g.away_score,
    false as is_test_game
  from public.nfl_games g
  where g.season = v_season
    and g.week = p_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(v_season, 1, 1, 0, 0, 0, 'UTC')
  order by coalesce(g.kickoff_at_utc, g.game_time), g.away_team, g.home_team;
end;
$function$;

create or replace function public.picks_allowed(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer := 1;
  v_double_weeks integer[] := '{}'::integer[];
  v_max_week integer := 18;
begin
  select
    coalesce(p.start_week, 1),
    coalesce(p.double_pick_weeks, '{}'::integer[]),
    public.pool_max_pick_week(p_pool_id)
  into v_start_week, v_double_weeks, v_max_week
  from public.pools p
  where p.id = p_pool_id;

  if not found or p_week < v_start_week or p_week < 1 or p_week > coalesce(v_max_week, 18) then
    return 0;
  end if;

  if p_week = any(v_double_weeks) then
    return 2;
  end if;

  return 1;
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
    from public.pool_week_games(p_pool_id, p_week) g
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

  if not coalesce(v_pool.test_mode, false) and now() >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_entry.profile_id, p_entry_id, p_week, v_slot, v_team_abbr, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        updated_at = now();
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

  if not coalesce(v_pool.test_mode, false) and v_lock_at is not null and now() >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;
end;
$function$;

create or replace function public.finalize_locked_picks(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int;
  v_pool public.pools%rowtype;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found or coalesce(v_pool.test_mode, false) then
    return 0;
  end if;

  with pool_settings as (
    select
      p.id,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode
    from public.pools p
    where p.id = p_pool_id
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
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at,
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
    where lock_at <= now()
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
  v_pool public.pools%rowtype;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found
    or coalesce(v_pool.test_mode, false)
    or coalesce(v_pool.archived, false)
    or coalesce(v_pool.activation_status, 'active') <> 'active' then
    return 0;
  end if;

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
      pm.id as entry_id,
      p_week as week,
      slots.slot,
      ('NO_PICK_' || slots.slot)::text as team_abbr
    from public.pool_members pm
    cross join slots
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and coalesce(s.eliminated, false) = false
      and not exists (
        select 1
        from public.pool_picks pp
        where pp.pool_id = pm.pool_id
          and pp.entry_id = pm.id
          and pp.week = p_week
          and pp.slot = slots.slot
      )
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, week_deadline, 'loss', now(), now()
    from missing
    on conflict (pool_id, entry_id, week, slot) do nothing
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
  v_pool public.pools%rowtype;
  v_max_week integer := 18;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found
    or coalesce(v_pool.test_mode, false)
    or coalesce(v_pool.archived, false)
    or coalesce(v_pool.activation_status, 'active') <> 'active' then
    return 0;
  end if;

  v_max_week := coalesce(public.pool_max_pick_week(p_pool_id), 18);

  for week_number in 1..v_max_week loop
    total_inserted := total_inserted + public.finalize_locked_picks(p_pool_id, week_number);
    total_inserted := total_inserted + public.finalize_no_pick_losses(p_pool_id, week_number);
  end loop;

  return total_inserted;
end;
$function$;

create or replace function public.adjudicate_results(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_graded int := 0;
begin
  with eligible_picks as (
    select
      pp.pool_id,
      pp.user_id,
      pp.entry_id,
      pp.week,
      pp.team_abbr,
      coalesce(nullif(po.tie_rule, ''), 'loss') as tie_rule
    from public.pool_picks pp
    join public.pools po on po.id = pp.pool_id
    where coalesce(po.season, p_season) = p_season
      and pp.week = p_week
      and coalesce(po.test_mode, false) = false
      and coalesce(po.archived, false) = false
      and coalesce(po.activation_status, 'active') = 'active'
  ),
  final_games as (
    select
      g.week,
      g.home_team,
      g.away_team,
      g.winner
    from public.nfl_games g
    where g.season = p_season
      and g.week = p_week
      and g.status = 'final'
      and coalesce(g.kickoff_at_utc, g.game_time) <= now()
      and (
        g.winner is null
        or g.winner in (g.home_team, g.away_team)
      )
  ),
  graded as (
    select
      ep.pool_id,
      ep.user_id,
      ep.entry_id,
      ep.week,
      ep.team_abbr,
      case
        when fg.winner is null then ep.tie_rule
        when ep.team_abbr = fg.winner then 'win'
        else 'loss'
      end as result
    from eligible_picks ep
    join final_games fg
      on fg.week = ep.week
     and ep.team_abbr in (fg.home_team, fg.away_team)
  ),
  updated as (
    update public.pool_picks pp
       set result = g.result,
           adjudicated_at = now()
      from graded g
     where pp.pool_id = g.pool_id
       and pp.entry_id = g.entry_id
       and pp.week = g.week
       and pp.team_abbr = g.team_abbr
       and pp.result is distinct from g.result
    returning 1
  )
  select count(*) into v_graded from updated;

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
    where coalesce(po.season, p_season) = p_season
      and coalesce(po.test_mode, false) = false
      and coalesce(po.archived, false) = false
      and coalesce(po.activation_status, 'active') = 'active'
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
      where coalesce(po.season, p_season) = p_season
        and pp.result is not null
        and coalesce(po.test_mode, false) = false
        and coalesce(po.archived, false) = false
        and coalesce(po.activation_status, 'active') = 'active'
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

  return coalesce(v_graded, 0);
end;
$function$;

create or replace function public.pool_standings_snapshot(
  p_pool_id uuid,
  p_week integer
)
returns table (
  games jsonb,
  stats jsonb,
  visible_picks jsonb,
  history_picks jsonb,
  completion jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view standings.';
  end if;

  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  select public.admin_can_manage(p_pool_id) into v_can_manage;

  if not v_can_manage and not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  perform public.restore_unlocked_picks_for_pool(p_pool_id);

  return query
  with game_rows as (
    select *
    from public.pool_week_games(p_pool_id, p_week)
  ),
  stat_rows as (
    select
      s.pool_id,
      s.user_id,
      s.entry_id,
      s.wins,
      s.losses,
      s.pushes,
      s.strikes_used,
      s.eliminated,
      s.eliminated_week
    from public.pool_member_stats s
    where s.pool_id = p_pool_id
  ),
  visible_rows as (
    select *
    from public.pool_visible_picks(p_pool_id, p_week, false)
  ),
  history_rows as (
    select *
    from public.pool_visible_picks(p_pool_id, p_week, true)
  ),
  completion_row as (
    select *
    from public.pool_week_pick_completion(p_pool_id, p_week)
    limit 1
  )
  select
    (
      select coalesce(
        jsonb_agg(to_jsonb(gr) order by coalesce(gr.kickoff_at_utc, gr.game_time), gr.away_team, gr.home_team),
        '[]'::jsonb
      )
      from game_rows gr
    ) as games,
    (
      select coalesce(
        jsonb_agg(to_jsonb(sr) order by sr.entry_id),
        '[]'::jsonb
      )
      from stat_rows sr
    ) as stats,
    (
      select coalesce(
        jsonb_agg(to_jsonb(vr) order by vr.entry_id, vr.week, vr.slot),
        '[]'::jsonb
      )
      from visible_rows vr
    ) as visible_picks,
    (
      select coalesce(
        jsonb_agg(to_jsonb(hr) order by hr.entry_id, hr.week, hr.slot),
        '[]'::jsonb
      )
      from history_rows hr
    ) as history_picks,
    (
      select to_jsonb(cr)
      from completion_row cr
    ) as completion;
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
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
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

  update public.pools
     set test_current_week = p_week
   where id = p_pool_id;

  return 'Test week set to Week ' || p_week || '.';
end;
$function$;

create or replace function public.superadmin_test_pool_week_options(
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
  total_pick_count integer,
  fake_outcome text,
  needs_outcome boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
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

  return query
  with pick_counts as (
    select picked_teams.team_abbr, count(*)::integer as pick_count
    from (
      select d.team_abbr
      from public.pool_pick_drafts d
      where d.pool_id = p_pool_id
        and d.week = p_week
        and d.team_abbr not like 'NO_PICK%'
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
    g.id as game_id,
    g.season,
    g.week,
    g.away_team,
    g.home_team,
    coalesce(g.kickoff_at_utc, g.game_time) as game_time,
    coalesce(away_counts.pick_count, 0)::integer as away_pick_count,
    coalesce(home_counts.pick_count, 0)::integer as home_pick_count,
    (coalesce(away_counts.pick_count, 0) + coalesce(home_counts.pick_count, 0))::integer as total_pick_count,
    outcome.fake_outcome,
    ((coalesce(away_counts.pick_count, 0) + coalesce(home_counts.pick_count, 0)) > 0 and outcome.fake_outcome is null)::boolean as needs_outcome
  from public.pool_week_games(p_pool_id, p_week) g
  left join pick_counts away_counts on away_counts.team_abbr = g.away_team
  left join pick_counts home_counts on home_counts.team_abbr = g.home_team
  left join lateral (
    select public.test_pool_game_outcome(p_pool_id, p_week, g.home_team, g.away_team) as fake_outcome
  ) outcome on true
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
  v_match_count integer;
  v_start_week integer;
  v_max_week integer;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1), public.pool_max_pick_week(p_pool_id)
    into v_start_week, v_max_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > coalesce(v_max_week, 18) then
    raise exception 'Week must be between this pool''s start week (%) and Week %.', v_start_week, coalesce(v_max_week, 18);
  end if;

  if v_away = '' or v_home = '' or v_away = v_home then
    raise exception 'Invalid matchup.';
  end if;

  if p_week > 18 then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  end if;

  select count(*)::integer
    into v_match_count
  from public.pool_week_games(p_pool_id, p_week) g
  where g.away_team = v_away
    and g.home_team = v_home;

  if coalesce(v_match_count, 0) <> 1 then
    raise exception 'Schedule integrity problem: expected one % @ % game in Week %, found %.', v_away, v_home, p_week, coalesce(v_match_count, 0);
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

create or replace function public.superadmin_randomize_test_week_outcomes(
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
  v_randomized integer := 0;
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

  with games_to_fill as (
    select
      g.week,
      g.away_team::text as away_team,
      g.home_team::text as home_team,
      case when random() < 0.5 then 'away' else 'home' end as outcome
    from public.pool_week_games(p_pool_id, p_week) g
    where (
      select count(*)
      from public.test_pool_team_results tr
      where tr.pool_id = p_pool_id
        and tr.week = p_week
        and tr.team_abbr in (g.away_team, g.home_team)
    ) < 2
  ),
  cleared_partial_rows as (
    delete from public.test_pool_team_results tr
    using games_to_fill gtf
    where tr.pool_id = p_pool_id
      and tr.week = p_week
      and tr.team_abbr in (gtf.away_team, gtf.home_team)
    returning 1
  ),
  inserted as (
    insert into public.test_pool_team_results (pool_id, week, team_abbr, result, created_by, updated_at)
    select
      p_pool_id,
      p_week,
      team_result.team_abbr,
      team_result.result,
      auth.uid(),
      now()
    from games_to_fill gtf
    cross join lateral (
      values
        (
          gtf.away_team,
          case when gtf.outcome = 'away' then 'win' else 'loss' end
        ),
        (
          gtf.home_team,
          case when gtf.outcome = 'home' then 'win' else 'loss' end
        )
    ) as team_result(team_abbr, result)
    on conflict (pool_id, week, team_abbr) do update
    set result = excluded.result,
        created_by = excluded.created_by,
        updated_at = now()
    returning 1
  )
  select (count(*) / 2)::integer
    into v_randomized
  from inserted;

  return 'Randomized outcomes for ' || coalesce(v_randomized, 0) || ' game(s) in Week ' || p_week || '.';
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

  update public.pools
     set test_current_week = case
       when coalesce(test_current_week, start_week, v_start_week) > p_week then p_week
       else coalesce(test_current_week, start_week, v_start_week)
     end
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

  update public.pools
     set test_current_week = v_start_week
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
    select pool_id, user_id, entry_id, week, slot, team_abbr, now(), 'loss', now(), now()
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

  update public.pools
     set test_current_week = least(coalesce(v_max_week, 18), greatest(coalesce(test_current_week, p_week), p_week + 1))
   where id = p_pool_id;

  return 'Week ' || p_week || ' scored. ' || v_scored || ' official pick(s) scored, ' || v_no_picks || ' no-pick(s) recorded.';
end;
$function$;

create or replace function public.superadmin_randomize_test_week_picks(
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
  v_required integer;
  v_inserted integer := 0;
  v_slot integer;
  v_entry record;
  v_used text[];
  v_team text;
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

  v_required := public.picks_allowed(p_pool_id, p_week);

  for v_entry in
    select pm.profile_id as user_id, pm.id as entry_id
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and coalesce(s.eliminated, false) = false
    order by pm.entry_number, pm.id
  loop
    select coalesce(array_agg(used.team_abbr), '{}'::text[])
      into v_used
    from (
      select upper(team_abbr) as team_abbr
      from public.pool_picks
      where pool_id = p_pool_id
        and entry_id = v_entry.entry_id
        and team_abbr not like 'NO_PICK%'
      union
      select upper(team_abbr) as team_abbr
      from public.pool_pick_drafts
      where pool_id = p_pool_id
        and entry_id = v_entry.entry_id
        and team_abbr not like 'NO_PICK%'
    ) used;

    for v_slot in 1..v_required loop
      if exists (
        select 1
        from public.pool_picks pp
        where pp.pool_id = p_pool_id
          and pp.entry_id = v_entry.entry_id
          and pp.week = p_week
          and pp.slot = v_slot
      ) or exists (
        select 1
        from public.pool_pick_drafts d
        where d.pool_id = p_pool_id
          and d.entry_id = v_entry.entry_id
          and d.week = p_week
          and d.slot = v_slot
      ) then
        continue;
      end if;

      select candidate.team_abbr
        into v_team
      from (
        select g.away_team::text as team_abbr
        from public.pool_week_games(p_pool_id, p_week) g
        union
        select g.home_team::text as team_abbr
        from public.pool_week_games(p_pool_id, p_week) g
      ) candidate
      where not (candidate.team_abbr = any(coalesce(v_used, '{}'::text[])))
      order by random()
      limit 1;

      if v_team is null then
        raise exception 'No available teams left to randomize Week % for entry %.', p_week, v_entry.entry_id;
      end if;

      insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
      values (p_pool_id, v_entry.user_id, v_entry.entry_id, p_week, v_slot, v_team, now())
      on conflict (pool_id, entry_id, week, slot) do update
      set team_abbr = excluded.team_abbr,
          user_id = excluded.user_id,
          updated_at = now();

      v_used := array_append(coalesce(v_used, '{}'::text[]), v_team);
      v_inserted := v_inserted + 1;
    end loop;
  end loop;

  return 'Randomized ' || v_inserted || ' missing pick(s) for Week ' || p_week || '.';
end;
$function$;

revoke execute on function public.pool_max_pick_week(uuid) from public, anon;
grant execute on function public.pool_max_pick_week(uuid) to authenticated, service_role;
revoke execute on function public.pool_week_games(uuid, integer) from public;
grant execute on function public.pool_week_games(uuid, integer) to anon, authenticated, service_role;
revoke execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;
revoke execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated, service_role;
revoke execute on function public.finalize_locked_picks(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks(uuid, integer) to service_role;
revoke execute on function public.finalize_no_pick_losses(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_no_pick_losses(uuid, integer) to service_role;
revoke execute on function public.finalize_locked_picks_for_pool(uuid) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks_for_pool(uuid) to service_role;
revoke execute on function public.adjudicate_results(integer, integer) from public, anon, authenticated;
grant execute on function public.adjudicate_results(integer, integer) to service_role;
revoke execute on function public.superadmin_ensure_test_pool_playoff_games(uuid) from public, anon;
grant execute on function public.superadmin_ensure_test_pool_playoff_games(uuid) to authenticated, service_role;
grant execute on function public.superadmin_set_pool_test_mode(uuid, boolean) to authenticated;
grant execute on function public.superadmin_set_test_pool_week(uuid, integer) to authenticated;
grant execute on function public.superadmin_test_pool_week_options(uuid, integer) to authenticated;
grant execute on function public.superadmin_set_test_game_outcome(uuid, integer, text, text, text) to authenticated;
grant execute on function public.superadmin_randomize_test_week_outcomes(uuid, integer) to authenticated;
grant execute on function public.superadmin_clear_test_week_results(uuid, integer) to authenticated;
grant execute on function public.superadmin_reset_test_pool(uuid) to authenticated;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated;
grant execute on function public.superadmin_randomize_test_week_picks(uuid, integer) to authenticated;
grant execute on function public.pool_standings_snapshot(uuid, integer) to authenticated, service_role;

commit;
