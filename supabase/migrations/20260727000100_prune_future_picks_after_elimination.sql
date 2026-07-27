begin;

create index if not exists idx_pool_picks_pool_entry_week_result
on public.pool_picks (pool_id, entry_id, week, result);

create index if not exists idx_pool_pick_drafts_pool_entry_week
on public.pool_pick_drafts (pool_id, entry_id, week);

create or replace function public.prune_picks_after_elimination(
  p_pool_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_deleted_drafts integer := 0;
  v_deleted_finals integer := 0;
begin
  if p_pool_id is not null
    and auth.uid() is not null
    and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  with eliminated_entries as (
    select
      s.pool_id,
      s.entry_id,
      s.eliminated_week
    from public.pool_member_stats s
    where coalesce(s.eliminated, false) = true
      and s.eliminated_week is not null
      and (p_pool_id is null or s.pool_id = p_pool_id)
  ),
  deleted as (
    delete from public.pool_pick_drafts d
    using eliminated_entries e
    where d.pool_id = e.pool_id
      and d.entry_id = e.entry_id
      and d.week > e.eliminated_week
    returning 1
  )
  select count(*)::integer
    into v_deleted_drafts
  from deleted;

  with eliminated_entries as (
    select
      s.pool_id,
      s.entry_id,
      s.eliminated_week
    from public.pool_member_stats s
    where coalesce(s.eliminated, false) = true
      and s.eliminated_week is not null
      and (p_pool_id is null or s.pool_id = p_pool_id)
  ),
  deleted as (
    delete from public.pool_picks pp
    using eliminated_entries e
    where pp.pool_id = e.pool_id
      and pp.entry_id = e.entry_id
      and pp.week > e.eliminated_week
    returning 1
  )
  select count(*)::integer
    into v_deleted_finals
  from deleted;

  return coalesce(v_deleted_drafts, 0) + coalesce(v_deleted_finals, 0);
end;
$function$;

create or replace function public.rebuild_pool_member_stats(
  p_pool_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
begin
  if p_pool_id is null then
    raise exception 'Pool not found.';
  end if;

  if not exists (select 1 from public.pools p where p.id = p_pool_id) then
    raise exception 'Pool not found.';
  end if;

  if auth.uid() is not null and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  delete from public.pool_member_stats s
  where s.pool_id = p_pool_id;

  with pool_settings as (
    select
      p.id as pool_id,
      greatest(0, coalesce(nullif(p.strikes_allowed, '')::integer, 0)) as strikes_allowed
    from public.pools p
    where p.id = p_pool_id
  ),
  pick_progress as (
    select
      pp.pool_id,
      pp.entry_id,
      pp.week,
      pp.slot,
      ps.strikes_allowed,
      count(*) filter (where pp.result = 'loss') over (
        partition by pp.pool_id, pp.entry_id
        order by pp.week, pp.slot
        rows between unbounded preceding and current row
      ) as running_strikes
    from public.pool_picks pp
    join pool_settings ps
      on ps.pool_id = pp.pool_id
    where pp.pool_id = p_pool_id
      and pp.result is not null
  ),
  first_elimination as (
    select
      progress.pool_id,
      progress.entry_id,
      min(progress.week) as eliminated_week
    from pick_progress progress
    where progress.running_strikes > progress.strikes_allowed
    group by progress.pool_id, progress.entry_id
  ),
  entry_results as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      ps.strikes_allowed,
      fe.eliminated_week,
      count(pp.*) filter (where pp.result = 'win')::integer as wins,
      count(pp.*) filter (where pp.result = 'loss')::integer as losses,
      count(pp.*) filter (where pp.result = 'push')::integer as pushes,
      count(pp.*) filter (where pp.result = 'loss')::integer as strikes_used
    from public.pool_members pm
    join pool_settings ps
      on ps.pool_id = pm.pool_id
    left join first_elimination fe
      on fe.pool_id = pm.pool_id
     and fe.entry_id = pm.id
    left join public.pool_picks pp
      on pp.pool_id = pm.pool_id
     and pp.entry_id = pm.id
     and pp.result is not null
     and (fe.eliminated_week is null or pp.week <= fe.eliminated_week)
    where pm.pool_id = p_pool_id
    group by pm.pool_id, pm.profile_id, pm.id, ps.strikes_allowed, fe.eliminated_week
  ),
  inserted as (
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
      er.eliminated_week is not null,
      er.eliminated_week,
      now()
    from entry_results er
    on conflict (pool_id, entry_id) do update
    set user_id = excluded.user_id,
        wins = excluded.wins,
        losses = excluded.losses,
        pushes = excluded.pushes,
        strikes_used = excluded.strikes_used,
        eliminated = excluded.eliminated,
        eliminated_week = excluded.eliminated_week,
        updated_at = excluded.updated_at
    returning 1
  )
  select count(*)::integer
    into v_rows
  from inserted;

  perform public.prune_picks_after_elimination(p_pool_id);

  update public.pool_members pm
     set status = case when coalesce(s.eliminated, false) then 'eliminated' else 'alive' end,
         eliminated_week = s.eliminated_week,
         lives_remaining = greatest(0, po.strikes_allowed_int - s.strikes_used)
    from public.pool_member_stats s
    join (
      select
        p.id,
        greatest(0, coalesce(nullif(p.strikes_allowed, '')::integer, 0)) as strikes_allowed_int
      from public.pools p
      where p.id = p_pool_id
    ) po
      on po.id = s.pool_id
   where pm.pool_id = s.pool_id
     and pm.id = s.entry_id
     and (
       pm.status is distinct from case when coalesce(s.eliminated, false) then 'eliminated' else 'alive' end
       or pm.eliminated_week is distinct from s.eliminated_week
       or pm.lives_remaining is distinct from greatest(0, po.strikes_allowed_int - s.strikes_used)
     );

  return coalesce(v_rows, 0);
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
  join public.pools po
    on po.id = pp.pool_id
  left join public.pool_member_stats s
    on s.pool_id = pp.pool_id
   and s.entry_id = pp.entry_id
  where pp.pool_id = p_pool_id
    and (
      p_week is null
      or (p_through_week and pp.week <= p_week)
      or (not p_through_week and pp.week = p_week)
    )
    and (
      coalesce(s.eliminated, false) = false
      or s.eliminated_week is null
      or pp.week <= s.eliminated_week
    )
    and (
      pp.user_id = auth.uid()
      or pp.locked_at <= now()
      or (
        coalesce(po.test_mode, false)
        and pp.week <= coalesce(po.test_current_week, po.start_week, pp.week)
      )
    )
  order by pp.week, pp.slot, pp.entry_id;
end;
$function$;

create or replace function public.finalize_locked_picks(
  p_pool_id uuid,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer;
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
    join pool_settings ps
      on ps.id = d.pool_id
    join public.pool_members pm
      on pm.pool_id = d.pool_id
     and pm.id = d.entry_id
    left join public.pool_member_stats s
      on s.pool_id = d.pool_id
     and s.entry_id = d.entry_id
    join public.pool_week_games(p_pool_id, p_week) g
      on g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and coalesce(s.eliminated, false) = false
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
  select count(*)::integer
    into inserted
  from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_locked_picks_for_pool(
  p_pool_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  week_number integer;
  total_inserted integer := 0;
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

  perform public.rebuild_pool_member_stats(p_pool_id);

  return total_inserted;
end;
$function$;

create or replace function public.adjudicate_results(
  p_season integer,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_graded integer := 0;
  v_pool_id uuid;
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
    join public.pools po
      on po.id = pp.pool_id
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
  select count(*)::integer
    into v_graded
  from updated;

  for v_pool_id in
    select p.id
    from public.pools p
    where coalesce(p.season, p_season) = p_season
      and coalesce(p.test_mode, false) = false
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
  loop
    perform public.rebuild_pool_member_stats(v_pool_id);
  end loop;

  return coalesce(v_graded, 0);
end;
$function$;

create or replace function public.superadmin_rebuild_test_pool_stats(
  p_pool_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
  v_rows := public.rebuild_pool_member_stats(p_pool_id);
  return;
end;
$function$;

do $$
declare
  v_pool_id uuid;
begin
  for v_pool_id in
    select distinct p.id
    from public.pools p
    where exists (
      select 1
      from public.pool_members pm
      where pm.pool_id = p.id
    )
  loop
    perform public.rebuild_pool_member_stats(v_pool_id);
  end loop;
end $$;

revoke execute on function public.prune_picks_after_elimination(uuid) from public, anon;
grant execute on function public.prune_picks_after_elimination(uuid) to authenticated, service_role;
revoke execute on function public.rebuild_pool_member_stats(uuid) from public, anon;
grant execute on function public.rebuild_pool_member_stats(uuid) to authenticated, service_role;
revoke execute on function public.pool_visible_picks(uuid, integer, boolean) from public, anon;
grant execute on function public.pool_visible_picks(uuid, integer, boolean) to authenticated, service_role;
revoke execute on function public.finalize_locked_picks(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks(uuid, integer) to service_role;
revoke execute on function public.finalize_locked_picks_for_pool(uuid) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks_for_pool(uuid) to service_role;
revoke execute on function public.adjudicate_results(integer, integer) from public, anon, authenticated;
grant execute on function public.adjudicate_results(integer, integer) to service_role;
grant execute on function public.superadmin_rebuild_test_pool_stats(uuid) to authenticated, service_role;

commit;
