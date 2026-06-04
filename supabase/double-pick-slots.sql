-- Add slot-based picks so double-pick weeks can store two picks per user/week.

alter table public.pool_pick_drafts
  add column if not exists slot integer not null default 1;

alter table public.pool_picks
  add column if not exists slot integer not null default 1;

alter table public.admin_actions
  add column if not exists slot integer;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_pick_drafts'::regclass
      and conname = 'pool_pick_drafts_pkey'
  ) then
    alter table public.pool_pick_drafts drop constraint pool_pick_drafts_pkey;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_picks'::regclass
      and conname = 'pool_picks_pkey'
  ) then
    alter table public.pool_picks drop constraint pool_picks_pkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_pick_drafts'::regclass
      and conname = 'pool_pick_drafts_pkey'
  ) then
    alter table public.pool_pick_drafts
      add constraint pool_pick_drafts_pkey primary key (pool_id, user_id, week, slot);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_picks'::regclass
      and conname = 'pool_picks_pkey'
  ) then
    alter table public.pool_picks
      add constraint pool_picks_pkey primary key (pool_id, user_id, week, slot);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_pick_drafts'::regclass
      and conname = 'pool_pick_drafts_slot_check'
  ) then
    alter table public.pool_pick_drafts
      add constraint pool_pick_drafts_slot_check check (slot between 1 and 2);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_picks'::regclass
      and conname = 'pool_picks_slot_check'
  ) then
    alter table public.pool_picks
      add constraint pool_picks_slot_check check (slot between 1 and 2);
  end if;
end $$;

create unique index if not exists pool_pick_drafts_no_duplicate_team
  on public.pool_pick_drafts (pool_id, user_id, week, team_abbr);

create unique index if not exists pool_picks_no_duplicate_team
  on public.pool_picks (pool_id, user_id, week, team_abbr);

create or replace function public.enforce_weekly_draft_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  allowed int;
  current_count int;
begin
  select public.picks_allowed(new.pool_id, new.week) into allowed;

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
      g.game_time as kickoff_at,
      case
        when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
          least(
            g.game_time,
            ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
          )
        else g.game_time
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    left join public.season_weeks sw
      on sw.season = ps.season
     and sw.week = d.week
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

create or replace function public.finalize_picks_week(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int;
begin
  with to_commit as (
    select
      d.pool_id,
      d.user_id,
      d.week,
      d.slot,
      d.team_abbr,
      d.updated_at
    from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, week, slot, team_abbr, locked_at, created_at)
    select
      tc.pool_id,
      tc.user_id,
      tc.week,
      tc.slot,
      tc.team_abbr,
      now(),
      now()
    from to_commit tc
    order by tc.updated_at asc
    on conflict (pool_id, user_id, week, slot) do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  delete from public.pool_pick_drafts
  where pool_id = p_pool_id
    and week = p_week;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.admin_clear_user_week_drafts(
  p_pool_id uuid,
  p_target_user uuid,
  p_week integer,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.user_id = p_target_user
    and d.week = p_week;

  get diagnostics n = row_count;

  insert into public.admin_actions(pool_id, admin_id, target_user_id, week, action, reason)
  values (p_pool_id, auth.uid(), p_target_user, p_week, 'draft_clear', p_reason);

  return coalesce(n, 0);
end;
$function$;

create or replace function public.admin_clear_user_week_draft_slot(
  p_pool_id uuid,
  p_target_user uuid,
  p_week integer,
  p_slot integer,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.user_id = p_target_user
    and d.week = p_week
    and d.slot = p_slot;

  get diagnostics n = row_count;

  insert into public.admin_actions(pool_id, admin_id, target_user_id, week, slot, action, reason)
  values (p_pool_id, auth.uid(), p_target_user, p_week, p_slot, 'draft_clear', p_reason);

  return coalesce(n, 0);
end;
$function$;

create or replace function public.admin_upsert_user_draft(
  p_pool_id uuid,
  p_target_user uuid,
  p_week integer,
  p_team_abbr text,
  p_slot integer default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target_slot int := coalesce(nullif(p_slot, 0), 1);
  old_team text;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  if p_week < 1 or p_week > 18 then
    raise exception 'invalid week %', p_week;
  end if;

  if not exists (
    select 1
    from public.pool_members m
    where m.pool_id = p_pool_id
      and m.profile_id = p_target_user
  ) then
    raise exception 'target user is not a member of this pool';
  end if;

  select d.team_abbr
  into old_team
  from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.user_id = p_target_user
    and d.week = p_week
    and d.slot = target_slot;

  insert into public.pool_pick_drafts (pool_id, user_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, p_target_user, p_week, target_slot, upper(p_team_abbr), now())
  on conflict (pool_id, user_id, week, slot) do update
  set team_abbr = excluded.team_abbr,
      updated_at = excluded.updated_at;

  insert into public.admin_actions(pool_id, admin_id, target_user_id, week, slot, action, old_team_abbr, new_team_abbr, reason)
  values (p_pool_id, auth.uid(), p_target_user, p_week, target_slot, 'draft_upsert', old_team, upper(p_team_abbr), p_reason);
end;
$function$;

create or replace function public.admin_override_final_pick(
  p_pool_id uuid,
  p_target_user uuid,
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
  target_slot int := coalesce(nullif(p_slot, 0), 1);
  pool_season int;
  kickoff timestamptz;
  old_team text;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select coalesce(p.season, extract(year from now())::int)
  into pool_season
  from public.pools p
  where p.id = p_pool_id;

  if pool_season is null then
    raise exception 'pool not found';
  end if;

  if target_slot < 1 or target_slot > public.picks_allowed(p_pool_id, p_week) then
    raise exception 'slot % is not available for week %', target_slot, p_week;
  end if;

  if not exists (
    select 1
    from public.pool_members m
    where m.pool_id = p_pool_id
      and m.profile_id = p_target_user
  ) then
    raise exception 'target user is not a member of this pool';
  end if;

  select coalesce(g.kickoff_at_utc, g.game_time)
  into kickoff
  from public.nfl_games g
  where g.season = pool_season
    and g.week = p_week
    and upper(p_team_abbr) in (upper(g.home_team), upper(g.away_team))
  order by coalesce(g.kickoff_at_utc, g.game_time)
  limit 1;

  if kickoff is null then
    raise exception 'could not find matchup for % week %', upper(p_team_abbr), p_week;
  end if;

  if now() >= kickoff then
    raise exception 'cannot override after kickoff';
  end if;

  select p.team_abbr
  into old_team
  from public.pool_picks p
  where p.pool_id = p_pool_id
    and p.user_id = p_target_user
    and p.week = p_week
    and p.slot = target_slot;

  insert into public.pool_picks (pool_id, user_id, week, slot, team_abbr, locked_at, created_at)
  values (p_pool_id, p_target_user, p_week, target_slot, upper(p_team_abbr), now(), now())
  on conflict (pool_id, user_id, week, slot) do update
  set team_abbr = excluded.team_abbr,
      locked_at = excluded.locked_at,
      result = null,
      adjudicated_at = null;

  delete from public.pool_pick_drafts
  where pool_id = p_pool_id
    and user_id = p_target_user
    and week = p_week
    and slot = target_slot;

  insert into public.admin_actions(pool_id, admin_id, target_user_id, week, slot, action, old_team_abbr, new_team_abbr, reason)
  values (p_pool_id, auth.uid(), p_target_user, p_week, target_slot, 'pick_override', old_team, upper(p_team_abbr), p_reason);
end;
$function$;

drop function if exists public.admin_pool_week_overview(uuid, integer);

create function public.admin_pool_week_overview(p_pool_id uuid, p_week integer)
returns table (
  user_id uuid,
  display_name text,
  role text,
  joined_at timestamptz,
  slot integer,
  draft_team_abbr text,
  draft_updated_at timestamptz,
  final_team_abbr text,
  locked_at timestamptz,
  result text,
  wins int,
  losses int,
  pushes int,
  strikes_used int,
  eliminated boolean,
  eliminated_week int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  )
  select
    pm.profile_id as user_id,
    coalesce(
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      nullif(pr.display_name, ''),
      nullif(pr.username, ''),
      nullif(pr."User_name", ''),
      pm.profile_id::text
    ) as display_name,
    pm.role::text as role,
    pm.joined_at,
    slots.slot,
    d.team_abbr as draft_team_abbr,
    d.updated_at as draft_updated_at,
    fp.team_abbr as final_team_abbr,
    fp.locked_at,
    fp.result,
    coalesce(s.wins, 0) as wins,
    coalesce(s.losses, 0) as losses,
    coalesce(s.pushes, 0) as pushes,
    coalesce(s.strikes_used, 0) as strikes_used,
    coalesce(s.eliminated, false) as eliminated,
    s.eliminated_week
  from public.pool_members pm
  cross join slots
  left join public.profiles pr on pr.id = pm.profile_id
  left join public.pool_pick_drafts d
    on d.pool_id = pm.pool_id
   and d.user_id = pm.profile_id
   and d.week = p_week
   and d.slot = slots.slot
  left join public.pool_picks fp
    on fp.pool_id = pm.pool_id
   and fp.user_id = pm.profile_id
   and fp.week = p_week
   and fp.slot = slots.slot
  left join public.pool_member_stats s
    on s.pool_id = pm.pool_id
   and s.user_id = pm.profile_id
  where pm.pool_id = p_pool_id
  order by display_name, slots.slot;
end;
$function$;
