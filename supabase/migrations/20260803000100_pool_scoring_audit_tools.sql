begin;

create or replace function public.admin_pool_entry_audit(
  p_pool_id uuid
)
returns table (
  entry_id uuid,
  user_id uuid,
  entry_number integer,
  display_name text,
  week integer,
  slot integer,
  pick_state text,
  draft_team_abbr text,
  draft_updated_at timestamptz,
  final_team_abbr text,
  locked_at timestamptz,
  result text,
  strikes_after_week integer,
  strikes_left_after_week integer,
  status_after_week text,
  eliminated_week integer,
  issue text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
  v_strikes_allowed integer;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    coalesce(p.start_week, 1),
    coalesce(public.pool_max_pick_week(p_pool_id), 18),
    greatest(0, coalesce(nullif(p.strikes_allowed, '')::integer, 0))
  into v_start_week, v_max_week, v_strikes_allowed
  from public.pools p
  where p.id = p_pool_id;

  if v_start_week is null then
    raise exception 'Pool not found.';
  end if;

  return query
  with entries as (
    select
      pm.id as entry_id,
      pm.profile_id as user_id,
      coalesce(pm.entry_number, 1)::integer as entry_number,
      coalesce(
        nullif(pr.username, ''),
        nullif(pr.display_name, ''),
        nullif(trim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')), ''),
        'Player ' || left(pm.profile_id::text, 8)
      )::text as display_name
    from public.pool_members pm
    left join public.profiles pr
      on pr.id = pm.profile_id
    where pm.pool_id = p_pool_id
  ),
  weeks as (
    select generate_series(v_start_week, v_max_week)::integer as week
  ),
  slots as (
    select
      weeks.week,
      generate_series(1, greatest(1, public.picks_allowed(p_pool_id, weeks.week)))::integer as slot
    from weeks
  ),
  weekly_strikes as (
    select
      e.entry_id,
      w.week,
      count(pp.*) filter (where pp.result = 'loss')::integer as week_strikes
    from entries e
    cross join weeks w
    left join public.pool_picks pp
      on pp.pool_id = p_pool_id
     and pp.entry_id = e.entry_id
     and pp.week = w.week
     and pp.result is not null
    group by e.entry_id, w.week
  ),
  progress as (
    select
      ws.entry_id,
      ws.week,
      coalesce(
        sum(ws.week_strikes) over (
          partition by ws.entry_id
          order by ws.week
          rows between unbounded preceding and current row
        ),
        0
      )::integer as strikes_after_week
    from weekly_strikes ws
  ),
  first_elimination as (
    select
      p.entry_id,
      min(p.week)::integer as eliminated_week
    from progress p
    where p.strikes_after_week > v_strikes_allowed
    group by p.entry_id
  )
  select
    e.entry_id,
    e.user_id,
    e.entry_number,
    e.display_name,
    s.week,
    s.slot,
    case
      when fp.entry_id is not null then 'final'
      when d.entry_id is not null then 'draft'
      else 'empty'
    end::text as pick_state,
    d.team_abbr::text as draft_team_abbr,
    d.updated_at as draft_updated_at,
    fp.team_abbr::text as final_team_abbr,
    fp.locked_at,
    fp.result::text as result,
    coalesce(p.strikes_after_week, 0)::integer as strikes_after_week,
    greatest(0, v_strikes_allowed - coalesce(p.strikes_after_week, 0))::integer as strikes_left_after_week,
    case
      when fe.eliminated_week is not null and s.week >= fe.eliminated_week then 'out'
      else 'alive'
    end::text as status_after_week,
    fe.eliminated_week,
    case
      when fe.eliminated_week is not null
        and s.week > fe.eliminated_week
        and (fp.entry_id is not null or d.entry_id is not null)
        then 'Future pick after elimination'
      when fp.team_abbr is not null
        and fp.team_abbr not like 'NO_PICK%'
        and not exists (
          select 1
          from public.pool_week_games(p_pool_id, s.week) g
          where fp.team_abbr in (g.home_team, g.away_team)
        )
        then 'Final pick team is not scheduled this week'
      when d.team_abbr is not null
        and d.team_abbr not like 'NO_PICK%'
        and not exists (
          select 1
          from public.pool_week_games(p_pool_id, s.week) g
          where d.team_abbr in (g.home_team, g.away_team)
        )
        then 'Draft pick team is not scheduled this week'
      else null
    end::text as issue
  from entries e
  cross join slots s
  left join public.pool_pick_drafts d
    on d.pool_id = p_pool_id
   and d.entry_id = e.entry_id
   and d.week = s.week
   and d.slot = s.slot
  left join public.pool_picks fp
    on fp.pool_id = p_pool_id
   and fp.entry_id = e.entry_id
   and fp.week = s.week
   and fp.slot = s.slot
  left join progress p
    on p.entry_id = e.entry_id
   and p.week = s.week
  left join first_elimination fe
    on fe.entry_id = e.entry_id
  order by lower(e.display_name), e.entry_number, s.week, s.slot;
end;
$function$;

create or replace function public.admin_pool_scoring_integrity(
  p_pool_id uuid
)
returns table (
  check_name text,
  status text,
  issue_count integer,
  detail text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_max_week integer;
  v_season integer;
  v_is_test boolean;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    coalesce(p.start_week, 1),
    coalesce(public.pool_max_pick_week(p_pool_id), 18),
    coalesce(p.season, extract(year from now())::integer),
    coalesce(p.test_mode, false)
  into v_start_week, v_max_week, v_season, v_is_test
  from public.pools p
  where p.id = p_pool_id;

  if v_start_week is null then
    raise exception 'Pool not found.';
  end if;

  return query
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
      min(progress.week)::integer as eliminated_week
    from pick_progress progress
    where progress.running_strikes > progress.strikes_allowed
    group by progress.pool_id, progress.entry_id
  ),
  computed_stats as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      count(pp.*) filter (where pp.result = 'win')::integer as wins,
      count(pp.*) filter (where pp.result = 'loss')::integer as losses,
      count(pp.*) filter (where pp.result = 'push')::integer as pushes,
      count(pp.*) filter (where pp.result = 'loss')::integer as strikes_used,
      (fe.eliminated_week is not null)::boolean as eliminated,
      fe.eliminated_week
    from public.pool_members pm
    left join first_elimination fe
      on fe.pool_id = pm.pool_id
     and fe.entry_id = pm.id
    left join public.pool_picks pp
      on pp.pool_id = pm.pool_id
     and pp.entry_id = pm.id
     and pp.result is not null
     and (fe.eliminated_week is null or pp.week <= fe.eliminated_week)
    where pm.pool_id = p_pool_id
    group by pm.pool_id, pm.profile_id, pm.id, fe.eliminated_week
  ),
  future_after_elimination as (
    select count(*)::integer as issue_count
    from (
      select pp.pool_id, pp.entry_id, pp.week
      from public.pool_picks pp
      join computed_stats cs
        on cs.pool_id = pp.pool_id
       and cs.entry_id = pp.entry_id
      where pp.pool_id = p_pool_id
        and cs.eliminated
        and cs.eliminated_week is not null
        and pp.week > cs.eliminated_week
      union all
      select d.pool_id, d.entry_id, d.week
      from public.pool_pick_drafts d
      join computed_stats cs
        on cs.pool_id = d.pool_id
       and cs.entry_id = d.entry_id
      where d.pool_id = p_pool_id
        and cs.eliminated
        and cs.eliminated_week is not null
        and d.week > cs.eliminated_week
    ) issues
  ),
  stats_snapshot_drift as (
    select count(*)::integer as issue_count
    from computed_stats cs
    left join public.pool_member_stats s
      on s.pool_id = cs.pool_id
     and s.entry_id = cs.entry_id
    where s.entry_id is null
      or s.user_id is distinct from cs.user_id
      or coalesce(s.wins, 0) is distinct from cs.wins
      or coalesce(s.losses, 0) is distinct from cs.losses
      or coalesce(s.pushes, 0) is distinct from cs.pushes
      or coalesce(s.strikes_used, 0) is distinct from cs.strikes_used
      or coalesce(s.eliminated, false) is distinct from cs.eliminated
      or s.eliminated_week is distinct from cs.eliminated_week
  ),
  member_status_drift as (
    select count(*)::integer as issue_count
    from computed_stats cs
    join public.pool_members pm
      on pm.pool_id = cs.pool_id
     and pm.id = cs.entry_id
    where (lower(coalesce(pm.status::text, 'alive')) = 'eliminated') is distinct from cs.eliminated
      or pm.eliminated_week is distinct from cs.eliminated_week
  ),
  invalid_pick_teams as (
    select count(*)::integer as issue_count
    from (
      select pp.entry_id, pp.week, pp.team_abbr
      from public.pool_picks pp
      where pp.pool_id = p_pool_id
        and pp.team_abbr not like 'NO_PICK%'
      union all
      select d.entry_id, d.week, d.team_abbr
      from public.pool_pick_drafts d
      where d.pool_id = p_pool_id
        and d.team_abbr not like 'NO_PICK%'
    ) picks
    where not exists (
      select 1
      from public.pool_week_games(p_pool_id, picks.week) g
      where picks.team_abbr in (g.home_team, g.away_team)
    )
  ),
  repeated_team_use as (
    select count(*)::integer as issue_count
    from (
      select used.entry_id, upper(used.team_abbr) as team_abbr
      from (
        select pp.entry_id, pp.team_abbr
        from public.pool_picks pp
        where pp.pool_id = p_pool_id
          and pp.team_abbr not like 'NO_PICK%'
        union all
        select d.entry_id, d.team_abbr
        from public.pool_pick_drafts d
        where d.pool_id = p_pool_id
          and d.team_abbr not like 'NO_PICK%'
      ) used
      group by used.entry_id, upper(used.team_abbr)
      having count(*) > 1
    ) repeats
  ),
  result_before_final as (
    select count(*)::integer as issue_count
    from public.pool_picks pp
    join public.pools po
      on po.id = pp.pool_id
    left join lateral (
      select g.status
      from public.pool_week_games(p_pool_id, pp.week) g
      where pp.team_abbr in (g.home_team, g.away_team)
      limit 1
    ) g on true
    where pp.pool_id = p_pool_id
      and pp.week between 1 and 18
      and pp.result is not null
      and pp.team_abbr not like 'NO_PICK%'
      and coalesce(po.test_mode, false) = false
      and coalesce(g.status, 'scheduled') <> 'final'
  ),
  orphaned_picks as (
    select count(*)::integer as issue_count
    from (
      select pp.entry_id
      from public.pool_picks pp
      left join public.pool_members pm
        on pm.pool_id = pp.pool_id
       and pm.id = pp.entry_id
      where pp.pool_id = p_pool_id
        and pm.id is null
      union all
      select d.entry_id
      from public.pool_pick_drafts d
      left join public.pool_members pm
        on pm.pool_id = d.pool_id
       and pm.id = d.entry_id
      where d.pool_id = p_pool_id
        and pm.id is null
    ) orphans
  ),
  week_game_counts as (
    select
      w.week,
      count(g.*)::integer as game_count
    from generate_series(v_start_week, least(18, v_max_week)) w(week)
    left join public.nfl_games g
      on g.season = v_season
     and g.week = w.week
    group by w.week
  ),
  bad_week_game_counts as (
    select count(*)::integer as issue_count
    from week_game_counts w
    where w.game_count < 13 or w.game_count > 16
  )
  select
    'future_picks_after_elimination'::text,
    case when issue_count = 0 then 'pass' else 'fail' end::text,
    issue_count,
    case when issue_count = 0 then 'No entry has draft or final picks after its elimination week.'
      else issue_count || ' future pick row(s) exist after elimination.'
    end::text
  from future_after_elimination

  union all

  select
    'stats_snapshot_sync'::text,
    case when issue_count = 0 then 'pass' else 'warning' end::text,
    issue_count,
    case when issue_count = 0 then 'Stored stats match the pick ledger.'
      else issue_count || ' entry stat snapshot(s) differ from the pick ledger.'
    end::text
  from stats_snapshot_drift

  union all

  select
    'member_status_sync'::text,
    case when issue_count = 0 then 'pass' else 'warning' end::text,
    issue_count,
    case when issue_count = 0 then 'Member alive/out status matches computed scoring.'
      else issue_count || ' member status row(s) differ from computed scoring.'
    end::text
  from member_status_drift

  union all

  select
    'pick_team_scheduled'::text,
    case when issue_count = 0 then 'pass' else 'fail' end::text,
    issue_count,
    case when issue_count = 0 then 'Every draft/final pick belongs to that week''s schedule.'
      else issue_count || ' pick row(s) reference a team that is not scheduled that week.'
    end::text
  from invalid_pick_teams

  union all

  select
    'no_repeat_teams'::text,
    case when issue_count = 0 then 'pass' else 'fail' end::text,
    issue_count,
    case when issue_count = 0 then 'No entry has reused a team.'
      else issue_count || ' repeated team use issue(s) found.'
    end::text
  from repeated_team_use

  union all

  select
    'real_results_only_after_final'::text,
    case when issue_count = 0 then 'pass' else 'fail' end::text,
    issue_count,
    case
      when v_is_test then 'Skipped for test pools because fake outcomes intentionally score scheduled games.'
      when issue_count = 0 then 'No real pool picks have results before the game is final.'
      else issue_count || ' real pool pick result(s) are attached before the game is final.'
    end::text
  from result_before_final

  union all

  select
    'pick_rows_have_entries'::text,
    case when issue_count = 0 then 'pass' else 'fail' end::text,
    issue_count,
    case when issue_count = 0 then 'Every pick row belongs to a current pool entry.'
      else issue_count || ' pick row(s) belong to missing entries.'
    end::text
  from orphaned_picks

  union all

  select
    'regular_season_schedule_counts'::text,
    case when issue_count = 0 then 'pass' else 'fail' end::text,
    issue_count,
    case when issue_count = 0 then 'Regular-season weeks in this pool have 13-16 NFL games.'
      else issue_count || ' regular-season week(s) have an impossible game count.'
    end::text
  from bad_week_game_counts;
end;
$function$;

create or replace function public.admin_repair_pool_scoring_state(
  p_pool_id uuid
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  v_rows := public.rebuild_pool_member_stats(p_pool_id);

  return 'Scoring rebuilt for ' || v_rows || ' entr' || case when v_rows = 1 then 'y' else 'ies' end || '. Future picks after elimination were cleared.';
end;
$function$;

grant execute on function public.admin_pool_entry_audit(uuid) to authenticated, service_role;
grant execute on function public.admin_pool_scoring_integrity(uuid) to authenticated, service_role;
grant execute on function public.admin_repair_pool_scoring_state(uuid) to authenticated, service_role;

commit;
