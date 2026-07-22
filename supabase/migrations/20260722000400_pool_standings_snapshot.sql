begin;

create index if not exists idx_pool_members_pool_status_id
  on public.pool_members (pool_id, status, id);

create index if not exists idx_pool_pick_drafts_pool_week_entry_slot
  on public.pool_pick_drafts (pool_id, week, entry_id, slot);

create index if not exists idx_pool_picks_pool_week_entry_slot
  on public.pool_picks (pool_id, week, entry_id, slot);

create index if not exists idx_pool_member_stats_pool_entry_elim
  on public.pool_member_stats (pool_id, entry_id, eliminated, eliminated_week);

create index if not exists idx_nfl_games_season_week_status_kickoff
  on public.nfl_games (season, week, status, kickoff_at_utc, game_time);

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
  join public.pools po on po.id = pp.pool_id
  where pp.pool_id = p_pool_id
    and (
      p_week is null
      or (p_through_week and pp.week <= p_week)
      or (not p_through_week and pp.week = p_week)
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
    select
      g.id,
      g.season,
      g.week,
      g.game_time,
      g.kickoff_at_utc,
      g.home_team,
      g.away_team,
      g.status,
      g.winner,
      g.home_score,
      g.away_score
    from public.nfl_games g
    where g.season = coalesce(v_pool.season, extract(year from now())::integer)
      and g.week = p_week
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

revoke execute on function public.pool_standings_snapshot(uuid, integer) from public, anon;
revoke execute on function public.pool_visible_picks(uuid, integer, boolean) from public, anon;
grant execute on function public.pool_standings_snapshot(uuid, integer) to authenticated, service_role;
grant execute on function public.pool_visible_picks(uuid, integer, boolean) to authenticated, service_role;

commit;
