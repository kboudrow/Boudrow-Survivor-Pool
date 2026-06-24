begin;

create or replace function public.superadmin_security_audit()
returns table (
  check_name text,
  status text,
  detail text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with public_tables_without_rls as (
    select t.tablename
    from pg_tables t
    where t.schemaname = 'public'
      and not t.rowsecurity
  ),
  rls_tables_without_policies as (
    select t.tablename
    from pg_tables t
    left join pg_policies p
      on p.schemaname = t.schemaname
     and p.tablename = t.tablename
    where t.schemaname = 'public'
      and t.rowsecurity
    group by t.tablename
    having count(p.policyname) = 0
  )
  select
    'public_tables_rls'::text,
    case when count(*) = 0 then 'pass' else 'fail' end,
    case when count(*) = 0 then 'All public tables have RLS enabled.'
      else string_agg(tablename, ', ' order by tablename)
    end
  from public_tables_without_rls
  where public.is_super_admin()

  union all

  select
    'rls_tables_have_policies'::text,
    case when count(*) = 0 then 'pass' else 'fail' end,
    case when count(*) = 0 then 'Every RLS-enabled public table has at least one policy.'
      else string_agg(tablename, ', ' order by tablename)
    end
  from rls_tables_without_policies
  where public.is_super_admin();
$function$;

create or replace function public.superadmin_foundation_integrity_audit(p_season integer default 2026)
returns table (
  check_name text,
  status text,
  detail text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with week_counts as (
    select week, count(*) as game_count
    from public.nfl_games
    where season = p_season
    group by week
  ),
  invalid_weeks as (
    select week, game_count
    from week_counts
    where week between 1 and 18
      and (game_count < 13 or game_count > 16)
  ),
  future_results as (
    select count(*) as issue_count
    from public.pool_picks pp
    join public.pools po on po.id = pp.pool_id
    join public.nfl_games g
      on g.season = coalesce(po.season, p_season)
     and g.week = pp.week
     and (upper(trim(g.home_team)) = upper(trim(pp.team_abbr))
       or upper(trim(g.away_team)) = upper(trim(pp.team_abbr)))
    where coalesce(po.season, p_season) = p_season
      and pp.result is not null
      and coalesce(g.status, 'scheduled') <> 'final'
  ),
  stale_final_games as (
    select count(*) as issue_count
    from public.nfl_games
    where season = p_season
      and status = 'final'
      and winner is null
  )
  select
    'regular_season_game_counts'::text,
    case when count(*) = 0 then 'pass' else 'fail' end,
    case when count(*) = 0 then 'Weeks 1-18 have valid NFL regular-season game counts.'
      else string_agg('Week ' || week || ': ' || game_count || ' games', '; ' order by week)
    end
  from invalid_weeks
  where public.is_super_admin()

  union all

  select
    'future_pick_results'::text,
    case when issue_count = 0 then 'pass' else 'fail' end,
    case when issue_count = 0 then 'No picks have results attached to unfinished games.'
      else issue_count || ' picks have results attached to unfinished games.'
    end
  from future_results
  where public.is_super_admin()

  union all

  select
    'final_games_have_winners'::text,
    case when issue_count = 0 then 'pass' else 'fail' end,
    case when issue_count = 0 then 'Every final game has a winner or tie winner marker available.'
      else issue_count || ' final games are missing winner data.'
    end
  from stale_final_games
  where public.is_super_admin();
$function$;

grant execute on function public.superadmin_security_audit() to authenticated;
grant execute on function public.superadmin_foundation_integrity_audit(integer) to authenticated;

commit;
