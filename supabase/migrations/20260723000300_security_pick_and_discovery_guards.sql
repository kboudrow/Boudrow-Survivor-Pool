begin;

-- Browser clients should read these tables as policies allow, but mutations must
-- go through the RPCs that enforce membership, deadlines, and audit logging.
do $$
begin
  if to_regclass('public.pool_pick_drafts') is not null then
    revoke insert, update, delete on table public.pool_pick_drafts from anon, authenticated;
  end if;

  if to_regclass('public.pool_picks') is not null then
    revoke insert, update, delete on table public.pool_picks from anon, authenticated;
  end if;

  if to_regclass('public.pool_members') is not null then
    revoke insert, update, delete on table public.pool_members from anon, authenticated;
  end if;

  if to_regclass('public.pool_member_stats') is not null then
    revoke insert, update, delete on table public.pool_member_stats from anon, authenticated;
  end if;

  if to_regclass('public.pools') is not null then
    revoke insert, update, delete on table public.pools from anon, authenticated;
  end if;

  if to_regclass('public.admin_actions') is not null then
    revoke insert, update, delete on table public.admin_actions from anon, authenticated;
  end if;

  if to_regclass('public.pick_save_events') is not null then
    revoke insert, update, delete on table public.pick_save_events from anon, authenticated;
  end if;
end $$;

create or replace function public.guard_pool_pick_draft_security()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry public.pool_members%rowtype;
  v_eliminated boolean := false;
  v_team text := upper(btrim(new.team_abbr));
  v_old_pool_id uuid := null;
  v_old_entry_id uuid := null;
  v_old_week integer := null;
  v_old_slot integer := null;
begin
  if v_team is null or v_team = '' then
    raise exception 'Choose a team before saving this pick.';
  end if;

  new.team_abbr := v_team;

  if tg_op = 'UPDATE' then
    v_old_pool_id := old.pool_id;
    v_old_entry_id := old.entry_id;
    v_old_week := old.week;
    v_old_slot := old.slot;
  end if;

  if new.entry_id is null then
    select pm.*
    into v_entry
    from public.pool_members pm
    where pm.pool_id = new.pool_id
      and pm.profile_id = new.user_id
    order by pm.entry_number
    limit 1;

    new.entry_id := v_entry.id;
  else
    select pm.*
    into v_entry
    from public.pool_members pm
    where pm.pool_id = new.pool_id
      and pm.id = new.entry_id;
  end if;

  if v_entry.id is null or v_entry.profile_id is distinct from new.user_id then
    raise exception 'Entry does not belong to this user.';
  end if;

  if lower(coalesce(v_entry.status::text, 'alive')) not in ('alive', 'active') then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  select coalesce(s.eliminated, false)
  into v_eliminated
  from public.pool_member_stats s
  where s.pool_id = new.pool_id
    and s.entry_id = new.entry_id;

  if coalesce(v_eliminated, false) then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  if v_team not like 'NO_PICK%' and exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = new.pool_id
      and pp.entry_id = new.entry_id
      and upper(btrim(pp.team_abbr)) = v_team
      and pp.team_abbr not like 'NO_PICK%'
      and (
        tg_op <> 'UPDATE'
        or not (
          pp.pool_id = v_old_pool_id
          and pp.entry_id = v_old_entry_id
          and pp.week = v_old_week
          and pp.slot = v_old_slot
        )
      )
  ) then
    raise exception 'This entry has already used %.', v_team;
  end if;

  if v_team not like 'NO_PICK%' and exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = new.pool_id
      and d.entry_id = new.entry_id
      and upper(btrim(d.team_abbr)) = v_team
      and d.team_abbr not like 'NO_PICK%'
      and (
        tg_op <> 'UPDATE'
        or not (
          d.pool_id = v_old_pool_id
          and d.entry_id = v_old_entry_id
          and d.week = v_old_week
          and d.slot = v_old_slot
        )
      )
  ) then
    raise exception 'This entry has already used %.', v_team;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_pool_pick_draft_security on public.pool_pick_drafts;
create trigger trg_guard_pool_pick_draft_security
before insert or update on public.pool_pick_drafts
for each row execute function public.guard_pool_pick_draft_security();

revoke execute on function public.guard_pool_pick_draft_security() from public, anon, authenticated;
grant execute on function public.guard_pool_pick_draft_security() to service_role;

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

  if p_week < coalesce(v_pool.start_week, 1) then
    raise exception 'This pool starts in Week %.', coalesce(v_pool.start_week, 1);
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
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = p_week
    and v_team_abbr in (upper(g.home_team), upper(g.away_team))
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
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
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = p_week
    and v_team_abbr in (upper(g.home_team), upper(g.away_team))
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
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

create or replace function public.search_pools(p_term text)
returns table (
  id uuid,
  name text,
  is_public boolean,
  allow_discovery boolean,
  start_week integer,
  include_playoffs boolean,
  strikes_allowed text,
  tie_rule text,
  deadline_mode text,
  deadline_fixed text,
  notes text,
  created_by uuid,
  created_at timestamptz,
  activation_status text,
  max_members integer,
  member_count integer
)
language sql
security definer
set search_path to 'public'
as $function$
  with input as (
    select btrim(coalesce(p_term, '')) as term
  ),
  candidate_pools as (
    select
      p.*,
      coalesce(
        (
          select min(coalesce(g.kickoff_at_utc, g.game_time))
          from public.nfl_games g
          where g.season = coalesce(p.season, extract(year from now())::integer)
            and g.week = coalesce(p.start_week, 1)
            and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(p.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
        ),
        (
          select sw.week_sunday_date::timestamp at time zone 'America/New_York'
          from public.season_weeks sw
          where sw.season = coalesce(p.season, extract(year from now())::integer)
            and sw.week = coalesce(p.start_week, 1)
        )
      ) as starts_at
    from public.pools p
  )
  select
    p.id,
    p.name,
    p.is_public,
    p.allow_discovery,
    p.start_week,
    p.include_playoffs,
    p.strikes_allowed::text,
    p.tie_rule::text,
    p.deadline_mode::text,
    p.deadline_fixed,
    case when coalesce(p.is_public, false) then p.notes else null end as notes,
    case when auth.uid() is not null then p.created_by else null end as created_by,
    p.created_at,
    coalesce(p.activation_status, 'active')::text as activation_status,
    p.max_members,
    (
      select count(distinct pm.profile_id)::integer
      from public.pool_members pm
      where pm.pool_id = p.id
    ) as member_count
  from candidate_pools p
  cross join input i
  where
    coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
    and (
      p.starts_at is null
      or now() < p.starts_at
    )
    and not (
      coalesce(p.test_mode, false)
      and coalesce(p.test_current_week, p.start_week, 1) >= coalesce(p.start_week, 1)
    )
    and (
      (i.term = '' and coalesce(p.is_public, false))
      or (
        i.term <> ''
        and p.name ilike ('%' || i.term || '%')
        and (
          coalesce(p.is_public, false)
          or length(i.term) >= 2
        )
      )
    )
  order by p.created_at desc
  limit 50;
$function$;

create or replace function public.leave_pool(p_pool_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_start_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to leave this pool.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if v_pool.created_by = auth.uid() then
    raise exception 'Pool creators cannot leave their own pool. Archive it from the admin panel instead.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'You cannot leave this pool after it has started.';
  end if;

  select coalesce(
    (
      select min(coalesce(g.kickoff_at_utc, g.game_time))
      from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
    ),
    (
      select sw.week_sunday_date::timestamp at time zone 'America/New_York'
      from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1)
    )
  )
  into v_start_at;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'You cannot leave this pool after it has started.';
  end if;

  delete from public.pool_members
  where pool_id = p_pool_id
    and profile_id = auth.uid();
end;
$function$;

create or replace function public.admin_remove_pool_member(
  p_pool_id uuid,
  p_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_user_entry_count integer := 0;
  v_removed integer := 0;
  v_start_at timestamptz;
  v_target_role text;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Members cannot be removed after the pool has started.';
  end if;

  select coalesce(
    (
      select min(coalesce(g.kickoff_at_utc, g.game_time))
      from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
    ),
    (
      select sw.week_sunday_date::timestamp at time zone 'America/New_York'
      from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1)
    )
  )
  into v_start_at;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'Members cannot be removed after the pool has started.';
  end if;

  select count(*), max(pm.role::text)
  into v_user_entry_count, v_target_role
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  if v_user_entry_count = 0 then
    raise exception 'Member not found in this pool.';
  end if;

  if p_profile_id = v_pool.created_by then
    raise exception 'The pool creator cannot be removed from their own pool.';
  end if;

  if v_target_role = 'admin'
    and auth.uid() is distinct from v_pool.created_by
    and not public.is_super_admin() then
    raise exception 'Only the pool creator can remove another admin.';
  end if;

  delete from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$function$;

revoke execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;
revoke execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated, service_role;

grant execute on function public.search_pools(text) to anon, authenticated, service_role;
revoke execute on function public.leave_pool(uuid) from public, anon;
grant execute on function public.leave_pool(uuid) to authenticated, service_role;
revoke execute on function public.admin_remove_pool_member(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_pool_member(uuid, uuid) to authenticated, service_role;

commit;
