-- Remove stale 2025 Week 1 games that were accidentally stored under season 2026.
-- Then move any future final picks back to editable drafts using the corrected schedule.

delete from public.nfl_games
where season = 2026
  and coalesce(kickoff_at_utc, game_time) < '2026-01-01'::timestamptz;

with pool_settings as (
  select
    p.id,
    coalesce(p.season, extract(year from now())::int) as season,
    coalesce(p.deadline_mode, 'fixed') as deadline_mode,
    coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
  from public.pools p
),
final_locks as (
  select
    pp.pool_id,
    pp.user_id,
    pp.week,
    pp.slot,
    upper(pp.team_abbr) as team_abbr,
    case
      when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
        least(
          coalesce(g.kickoff_at_utc, g.game_time),
          ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
        )
      else coalesce(g.kickoff_at_utc, g.game_time)
    end as lock_at
  from public.pool_picks pp
  join pool_settings ps on ps.id = pp.pool_id
  join public.nfl_games g
    on g.season = ps.season
   and g.week = pp.week
   and upper(pp.team_abbr) in (upper(g.home_team), upper(g.away_team))
  left join public.season_weeks sw
    on sw.season = ps.season
   and sw.week = pp.week
),
unlocked as (
  select *
  from final_locks
  where lock_at > now()
),
restored as (
  insert into public.pool_pick_drafts (pool_id, user_id, week, slot, team_abbr, updated_at)
  select pool_id, user_id, week, slot, team_abbr, now()
  from unlocked
  on conflict (pool_id, user_id, week, slot) do update
  set team_abbr = excluded.team_abbr,
      updated_at = excluded.updated_at
  returning pool_id, user_id, week, slot
)
delete from public.pool_picks pp
using restored r
where pp.pool_id = r.pool_id
  and pp.user_id = r.user_id
  and pp.week = r.week
  and pp.slot = r.slot;
