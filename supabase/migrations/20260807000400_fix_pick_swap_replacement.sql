begin;

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

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_entry.profile_id, p_entry_id, p_week, v_slot, v_team_abbr, now());
end;
$function$;

revoke execute on function public.guard_pool_pick_draft_security() from public, anon, authenticated;
grant execute on function public.guard_pool_pick_draft_security() to service_role;
revoke execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;

commit;
