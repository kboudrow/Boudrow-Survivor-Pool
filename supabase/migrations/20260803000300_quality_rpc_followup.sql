begin;

drop function if exists public.superadmin_pool_overview();
create function public.superadmin_pool_overview()
returns table (
  pool_id uuid,
  name text,
  created_by uuid,
  owner_email text,
  is_public boolean,
  archived boolean,
  activation_status text,
  payment_status text,
  season integer,
  start_week integer,
  max_members integer,
  allow_multiple_entries boolean,
  max_entries_per_user integer,
  entries_count integer,
  unique_members_count integer,
  draft_picks_count integer,
  final_picks_count integer,
  stats_rows_count integer,
  created_at timestamptz,
  test_mode boolean,
  test_current_week integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    p.id as pool_id,
    p.name::text,
    p.created_by,
    pp.email::text as owner_email,
    p.is_public,
    coalesce(p.archived, false) as archived,
    coalesce(p.activation_status, 'active')::text as activation_status,
    coalesce(p.payment_status, 'not_required')::text as payment_status,
    coalesce(p.season, extract(year from now())::integer) as season,
    p.start_week,
    p.max_members,
    coalesce(p.allow_multiple_entries, false) as allow_multiple_entries,
    coalesce(p.max_entries_per_user, 1) as max_entries_per_user,
    coalesce(pm.entries_count, 0)::integer as entries_count,
    coalesce(pm.unique_members_count, 0)::integer as unique_members_count,
    coalesce(d.draft_picks_count, 0)::integer as draft_picks_count,
    coalesce(fp.final_picks_count, 0)::integer as final_picks_count,
    coalesce(s.stats_rows_count, 0)::integer as stats_rows_count,
    p.created_at,
    coalesce(p.test_mode, false) as test_mode,
    p.test_current_week
  from public.pools p
  left join public.profiles_private pp
    on pp.id = p.created_by
  left join (
    select
      pm_counts.pool_id,
      count(*) as entries_count,
      count(distinct pm_counts.profile_id) as unique_members_count
    from public.pool_members pm_counts
    group by pm_counts.pool_id
  ) pm
    on pm.pool_id = p.id
  left join (
    select d_counts.pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts d_counts
    group by d_counts.pool_id
  ) d
    on d.pool_id = p.id
  left join (
    select fp_counts.pool_id, count(*) as final_picks_count
    from public.pool_picks fp_counts
    group by fp_counts.pool_id
  ) fp
    on fp.pool_id = p.id
  left join (
    select s_counts.pool_id, count(*) as stats_rows_count
    from public.pool_member_stats s_counts
    group by s_counts.pool_id
  ) s
    on s.pool_id = p.id
  order by p.created_at desc nulls last;
end;
$function$;

create or replace function public.superadmin_schedule_integrity_audit(p_season integer default null)
returns table (
  season integer,
  week integer,
  game_count integer,
  duplicate_event_count integer,
  future_result_count integer,
  final_missing_winner_count integer,
  invalid_winner_count integer,
  duplicate_team_count integer,
  future_pick_result_count integer,
  team_appearance_count integer,
  issue_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with games as (
    select
      g.season,
      g.week,
      g.id,
      g.espn_event_id,
      g.home_team,
      g.away_team,
      g.status,
      g.winner,
      g.home_score,
      g.away_score,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at
    from public.nfl_games g
    where p_season is null or g.season = p_season
  ),
  week_counts as (
    select
      games.season,
      games.week,
      count(*)::integer as game_count,
      count(distinct coalesce(nullif(games.espn_event_id, ''), games.id::text))::integer as distinct_event_count,
      count(*) filter (
        where games.kickoff_at > now()
          and (
            coalesce(games.status, 'scheduled') <> 'scheduled'
            or games.winner is not null
            or games.home_score is not null
            or games.away_score is not null
          )
      )::integer as future_result_count,
      count(*) filter (
        where games.status = 'final'
          and games.winner is null
          and not (games.home_score is not null and games.away_score is not null and games.home_score = games.away_score)
      )::integer as final_missing_winner_count,
      count(*) filter (
        where games.status = 'final'
          and games.winner is not null
          and games.winner not in (games.home_team, games.away_team)
      )::integer as invalid_winner_count
    from games
    group by games.season, games.week
  ),
  team_counts as (
    select
      t.season,
      t.week,
      count(*)::integer as team_appearance_count
    from (
      select games.season, games.week, games.home_team as team from games
      union all
      select games.season, games.week, games.away_team as team from games
    ) t
    where nullif(t.team, '') is not null
    group by t.season, t.week
  ),
  duplicate_teams as (
    select
      t.season,
      t.week,
      (count(*) - count(distinct t.team))::integer as duplicate_team_count
    from (
      select games.season, games.week, games.home_team as team from games
      union all
      select games.season, games.week, games.away_team as team from games
    ) t
    where nullif(t.team, '') is not null
    group by t.season, t.week
  ),
  future_pick_results as (
    select
      games.season,
      games.week,
      count(distinct (pp.pool_id, pp.entry_id, pp.week, pp.slot))::integer as future_pick_result_count
    from public.pool_picks pp
    join public.pools po
      on po.id = pp.pool_id
    join games
      on games.week = pp.week
     and pp.team_abbr in (games.home_team, games.away_team)
     and (po.season is null or po.season = games.season)
    where pp.result is not null
      and games.kickoff_at > now()
    group by games.season, games.week
  )
  select
    wc.season,
    wc.week,
    wc.game_count,
    greatest(wc.game_count - wc.distinct_event_count, 0)::integer as duplicate_event_count,
    wc.future_result_count,
    wc.final_missing_winner_count,
    wc.invalid_winner_count,
    coalesce(dt.duplicate_team_count, 0)::integer as duplicate_team_count,
    coalesce(fpr.future_pick_result_count, 0)::integer as future_pick_result_count,
    coalesce(tc.team_appearance_count, 0)::integer as team_appearance_count,
    (
      case when wc.game_count > 16 then 1 else 0 end
      + case when wc.game_count < 12 then 1 else 0 end
      + case when greatest(wc.game_count - wc.distinct_event_count, 0) > 0 then 1 else 0 end
      + case when wc.future_result_count > 0 then 1 else 0 end
      + case when wc.final_missing_winner_count > 0 then 1 else 0 end
      + case when wc.invalid_winner_count > 0 then 1 else 0 end
      + case when coalesce(dt.duplicate_team_count, 0) > 0 then 1 else 0 end
      + case when coalesce(fpr.future_pick_result_count, 0) > 0 then 1 else 0 end
      + case when coalesce(tc.team_appearance_count, 0) <> wc.game_count * 2 then 1 else 0 end
    )::integer as issue_count
  from week_counts wc
  left join team_counts tc
    on tc.season = wc.season
   and tc.week = wc.week
  left join duplicate_teams dt
    on dt.season = wc.season
   and dt.week = wc.week
  left join future_pick_results fpr
    on fpr.season = wc.season
   and fpr.week = wc.week
  order by wc.season desc, wc.week;
end;
$function$;

revoke execute on function public.superadmin_pool_overview() from public, anon;
revoke execute on function public.superadmin_schedule_integrity_audit(integer) from public, anon;
grant execute on function public.superadmin_pool_overview() to authenticated, service_role;
grant execute on function public.superadmin_schedule_integrity_audit(integer) to authenticated, service_role;

commit;
