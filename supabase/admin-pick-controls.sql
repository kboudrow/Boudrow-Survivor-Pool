-- Safer admin pick/member controls.

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

  if exists (
    select 1
    from public.pool_picks p
    where p.pool_id = p_pool_id
      and p.user_id = p_target_user
      and p.week = p_week
      and p.slot = target_slot
  ) then
    raise exception 'This pick is already final. Use Override final to change the official pick.';
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

create or replace function public.admin_remove_member(
  p_pool_id uuid,
  p_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_first_start timestamptz;
  target_role text;
  caller_is_owner boolean;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    p.id,
    p.created_by,
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
    raise exception 'Members cannot be removed after the league has started.';
  end if;

  if p_profile_id = v_pool.created_by then
    raise exception 'cannot remove owner';
  end if;

  select pm.role::text
  into target_role
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  select (auth.uid() = v_pool.created_by) into caller_is_owner;

  if target_role = 'admin' and not caller_is_owner then
    raise exception 'only owner can remove admins';
  end if;

  delete from public.pool_members
  where pool_id = p_pool_id
    and profile_id = p_profile_id;
end;
$function$;
