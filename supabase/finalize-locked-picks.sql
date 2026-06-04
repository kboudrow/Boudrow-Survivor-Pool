-- Finalize only the draft picks whose selected team has locked.
-- Rolling pools lock at that team's kickoff.
-- Fixed pools lock at the earlier of that team's kickoff and the pool's fixed weekly deadline.

create or replace function public.finalize_locked_picks(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int;
begin
  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.week,
      d.team_abbr,
      g.game_time as kickoff_at,
      case
        when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
          least(
            g.game_time,
            ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
          )
        else g.game_time
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    left join public.season_weeks sw
      on sw.season = ps.season
     and sw.week = d.week
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= now()
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, week, team_abbr, locked_at, created_at)
    select pool_id, user_id, week, team_abbr, lock_at, now()
    from to_commit
    on conflict do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.user_id = tc.user_id
      and d.week = tc.week
    returning 1
  )
  select count(*) into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_locked_picks_for_pool(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  week_number int;
  total_inserted int := 0;
begin
  for week_number in 1..18 loop
    total_inserted := total_inserted + public.finalize_locked_picks(p_pool_id, week_number);
  end loop;

  return total_inserted;
end;
$function$;
