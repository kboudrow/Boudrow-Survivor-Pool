-- Harden pick swaps and standings pick visibility.

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
  v_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to make a pick.';
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

  if exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = p_pool_id
      and pp.entry_id = p_entry_id
      and pp.week = p_week
      and pp.slot = coalesce(p_slot, 1)
  ) then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, coalesce(p_slot, 1), upper(p_team_abbr), now())
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
begin
  if auth.uid() is null then
    raise exception 'Please sign in to clear a pick.';
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

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = coalesce(p_slot, 1);
end;
$function$;

create or replace function public.pool_visible_picks(
  p_pool_id uuid,
  p_week integer default null,
  p_through_week boolean default false
)
returns table (
  user_id uuid,
  entry_id uuid,
  week integer,
  slot integer,
  team_abbr text,
  locked_at timestamptz,
  result text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view picks.';
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

  return query
  select
    pp.user_id,
    pp.entry_id,
    pp.week,
    pp.slot,
    pp.team_abbr::text,
    pp.locked_at,
    pp.result::text
  from public.pool_picks pp
  where pp.pool_id = p_pool_id
    and (
      p_week is null
      or (p_through_week and pp.week <= p_week)
      or (not p_through_week and pp.week = p_week)
    )
    and (
      v_can_manage
      or pp.user_id = auth.uid()
      or pp.locked_at <= now()
    )
  order by pp.week, pp.slot, pp.entry_id;
end;
$function$;
