-- Current-schema admin helpers for pool management.

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
    and d.week = p_week;

  insert into public.pool_pick_drafts (pool_id, user_id, week, team_abbr, updated_at)
  values (p_pool_id, p_target_user, p_week, upper(p_team_abbr), now())
  on conflict (pool_id, user_id, week) do update
  set team_abbr = excluded.team_abbr,
      updated_at = excluded.updated_at;

  insert into public.admin_actions(pool_id, admin_id, target_user_id, week, action, old_team_abbr, new_team_abbr, reason)
  values (p_pool_id, auth.uid(), p_target_user, p_week, 'draft_upsert', old_team, upper(p_team_abbr), p_reason);
end;
$function$;

create or replace function public.admin_override_final_pick(
  p_pool_id uuid,
  p_target_user uuid,
  p_week integer,
  p_team_abbr text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
    and p.week = p_week;

  insert into public.pool_picks (pool_id, user_id, week, team_abbr, locked_at, created_at)
  values (p_pool_id, p_target_user, p_week, upper(p_team_abbr), now(), now())
  on conflict (pool_id, user_id, week) do update
  set team_abbr = excluded.team_abbr,
      locked_at = excluded.locked_at,
      result = null,
      adjudicated_at = null;

  delete from public.pool_pick_drafts
  where pool_id = p_pool_id
    and user_id = p_target_user
    and week = p_week;

  insert into public.admin_actions(pool_id, admin_id, target_user_id, week, action, old_team_abbr, new_team_abbr, reason)
  values (p_pool_id, auth.uid(), p_target_user, p_week, 'pick_override', old_team, upper(p_team_abbr), p_reason);
end;
$function$;

create or replace function public.admin_pool_week_overview(p_pool_id uuid, p_week integer)
returns table (
  user_id uuid,
  display_name text,
  role text,
  joined_at timestamptz,
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
  left join public.profiles pr on pr.id = pm.profile_id
  left join public.pool_pick_drafts d
    on d.pool_id = pm.pool_id
   and d.user_id = pm.profile_id
   and d.week = p_week
  left join public.pool_picks fp
    on fp.pool_id = pm.pool_id
   and fp.user_id = pm.profile_id
   and fp.week = p_week
  left join public.pool_member_stats s
    on s.pool_id = pm.pool_id
   and s.user_id = pm.profile_id
  where pm.pool_id = p_pool_id
  order by display_name;
end;
$function$;
