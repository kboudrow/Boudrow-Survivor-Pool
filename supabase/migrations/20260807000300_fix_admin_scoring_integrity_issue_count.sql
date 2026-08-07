begin;

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
    case when fae.issue_count = 0 then 'pass' else 'fail' end::text,
    fae.issue_count,
    case when fae.issue_count = 0 then 'No entry has draft or final picks after its elimination week.'
      else fae.issue_count || ' future pick row(s) exist after elimination.'
    end::text
  from future_after_elimination fae

  union all

  select
    'stats_snapshot_sync'::text,
    case when ssd.issue_count = 0 then 'pass' else 'warning' end::text,
    ssd.issue_count,
    case when ssd.issue_count = 0 then 'Stored stats match the pick ledger.'
      else ssd.issue_count || ' entry stat snapshot(s) differ from the pick ledger.'
    end::text
  from stats_snapshot_drift ssd

  union all

  select
    'member_status_sync'::text,
    case when msd.issue_count = 0 then 'pass' else 'warning' end::text,
    msd.issue_count,
    case when msd.issue_count = 0 then 'Member alive/out status matches computed scoring.'
      else msd.issue_count || ' member status row(s) differ from computed scoring.'
    end::text
  from member_status_drift msd

  union all

  select
    'pick_team_scheduled'::text,
    case when ipt.issue_count = 0 then 'pass' else 'fail' end::text,
    ipt.issue_count,
    case when ipt.issue_count = 0 then 'Every draft/final pick belongs to that week''s schedule.'
      else ipt.issue_count || ' pick row(s) reference a team that is not scheduled that week.'
    end::text
  from invalid_pick_teams ipt

  union all

  select
    'no_repeat_teams'::text,
    case when rtu.issue_count = 0 then 'pass' else 'fail' end::text,
    rtu.issue_count,
    case when rtu.issue_count = 0 then 'No entry has reused a team.'
      else rtu.issue_count || ' repeated team use issue(s) found.'
    end::text
  from repeated_team_use rtu

  union all

  select
    'real_results_only_after_final'::text,
    case when rbf.issue_count = 0 then 'pass' else 'fail' end::text,
    rbf.issue_count,
    case
      when v_is_test then 'Skipped for test pools because fake outcomes intentionally score scheduled games.'
      when rbf.issue_count = 0 then 'No real pool picks have results before the game is final.'
      else rbf.issue_count || ' real pool pick result(s) are attached before the game is final.'
    end::text
  from result_before_final rbf

  union all

  select
    'pick_rows_have_entries'::text,
    case when op.issue_count = 0 then 'pass' else 'fail' end::text,
    op.issue_count,
    case when op.issue_count = 0 then 'Every pick row belongs to a current pool entry.'
      else op.issue_count || ' pick row(s) belong to missing entries.'
    end::text
  from orphaned_picks op

  union all

  select
    'regular_season_schedule_counts'::text,
    case when bwgc.issue_count = 0 then 'pass' else 'fail' end::text,
    bwgc.issue_count,
    case when bwgc.issue_count = 0 then 'Regular-season weeks in this pool have 13-16 NFL games.'
      else bwgc.issue_count || ' regular-season week(s) have an impossible game count.'
    end::text
  from bad_week_game_counts bwgc;
end;
$function$;

grant execute on function public.admin_pool_scoring_integrity(uuid) to authenticated, service_role;

commit;
