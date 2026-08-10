create or replace function public.serialize_pool_pick_draft_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid := case when tg_op = 'DELETE' then old.pool_id else new.pool_id end;
  v_entry_id uuid := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
begin
  if v_pool_id is not null and v_entry_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_pool_id::text || ':' || v_entry_id::text, 0));
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists aaa_serialize_pool_pick_draft_write on public.pool_pick_drafts;
create trigger aaa_serialize_pool_pick_draft_write
before insert or update or delete on public.pool_pick_drafts
for each row execute function public.serialize_pool_pick_draft_write();

create or replace function public.guard_pool_pick_draft_security()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry public.pool_members%rowtype;
  v_pool public.pools%rowtype;
  v_eliminated boolean := false;
  v_team text := upper(btrim(new.team_abbr));
  v_lock_at timestamptz;
  v_old_pool_id uuid := null;
  v_old_entry_id uuid := null;
  v_old_week integer := null;
  v_old_slot integer := null;
begin
  if v_team is null or v_team = '' then raise exception 'Choose a team before saving this pick.'; end if;
  new.team_abbr := v_team;

  if tg_op = 'UPDATE' then
    v_old_pool_id := old.pool_id;
    v_old_entry_id := old.entry_id;
    v_old_week := old.week;
    v_old_slot := old.slot;
  end if;

  select * into v_pool from public.pools p where p.id = new.pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if coalesce(v_pool.archived, false) or coalesce(v_pool.activation_status, 'active') <> 'active' then
    raise exception 'This pool is not accepting picks.';
  end if;
  if public.pool_has_declared_winner(new.pool_id) then
    raise exception 'This pool already has a winner. No more picks are needed.';
  end if;
  if new.week < coalesce(v_pool.start_week, 1) then
    raise exception 'This pool starts in Week %.', coalesce(v_pool.start_week, 1);
  end if;
  if new.slot < 1 or new.slot > public.picks_allowed(new.pool_id, new.week) then
    raise exception 'Week % allows % pick(s); Pick % is invalid.', new.week, public.picks_allowed(new.pool_id, new.week), new.slot;
  end if;

  if new.entry_id is null then
    select pm.* into v_entry
    from public.pool_members pm
    where pm.pool_id = new.pool_id and pm.profile_id = new.user_id
    order by pm.entry_number limit 1;
    new.entry_id := v_entry.id;
  else
    select pm.* into v_entry
    from public.pool_members pm
    where pm.pool_id = new.pool_id and pm.id = new.entry_id;
  end if;

  if v_entry.id is null or v_entry.profile_id is distinct from new.user_id then
    raise exception 'Entry does not belong to this user.';
  end if;
  if lower(coalesce(v_entry.status::text, 'alive')) not in ('alive', 'active') then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;
  select coalesce(s.eliminated, false) into v_eliminated
  from public.pool_member_stats s where s.pool_id = new.pool_id and s.entry_id = new.entry_id;
  if coalesce(v_eliminated, false) then raise exception 'Eliminated entries cannot make new picks.'; end if;

  if exists (
    select 1 from public.pool_picks pick
    where pick.pool_id = new.pool_id and pick.entry_id = new.entry_id
      and pick.week = new.week and pick.slot = new.slot
  ) then raise exception 'This pick is locked and can no longer be changed.'; end if;

  if v_team not like 'NO_PICK%' and exists (
    select 1 from public.pool_picks pick
    where pick.pool_id = new.pool_id and pick.entry_id = new.entry_id
      and upper(btrim(pick.team_abbr)) = v_team and pick.team_abbr not like 'NO_PICK%'
  ) then raise exception 'This entry has already used %.', v_team; end if;

  if v_team not like 'NO_PICK%' and exists (
    select 1 from public.pool_pick_drafts draft
    where draft.pool_id = new.pool_id and draft.entry_id = new.entry_id
      and upper(btrim(draft.team_abbr)) = v_team and draft.team_abbr not like 'NO_PICK%'
      and (tg_op <> 'UPDATE' or not (
        draft.pool_id = v_old_pool_id and draft.entry_id = v_old_entry_id
        and draft.week = v_old_week and draft.slot = v_old_slot
      ))
  ) then raise exception 'This entry has already used %.', v_team; end if;

  select case
      when coalesce(v_pool.deadline_mode, 'fixed') = 'fixed' then
        least(coalesce(game.kickoff_at_utc, game.game_time), public.pool_week_deadline_at(new.pool_id, new.week))
      else coalesce(game.kickoff_at_utc, game.game_time)
    end
    into v_lock_at
  from public.pool_week_games(new.pool_id, new.week) game
  where v_team in (upper(game.home_team), upper(game.away_team))
  order by coalesce(game.kickoff_at_utc, game.game_time)
  limit 1;

  if v_lock_at is null then raise exception 'That team is not scheduled for Week %.', new.week; end if;
  if public.pool_effective_now(new.pool_id) >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  return new;
end;
$function$;

revoke execute on function public.serialize_pool_pick_draft_write() from public, anon, authenticated;
grant execute on function public.serialize_pool_pick_draft_write() to service_role;
revoke execute on function public.guard_pool_pick_draft_security() from public, anon, authenticated;
grant execute on function public.guard_pool_pick_draft_security() to service_role;
