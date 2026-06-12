-- Repair stale 2026 data that was accidentally treated as completed.
-- Future games should never grade picks or eliminate entries before kickoff.

delete from public.nfl_games
where season = 2026
  and coalesce(kickoff_at_utc, game_time) < make_timestamptz(2026, 1, 1, 0, 0, 0, 'UTC');

update public.nfl_games
set
  status = 'scheduled',
  winner = null,
  home_score = null,
  away_score = null
where season = 2026
  and coalesce(kickoff_at_utc, game_time) > now()
  and (
    status is distinct from 'scheduled'
    or winner is not null
    or home_score is not null
    or away_score is not null
  );

delete from public.pool_member_stats s
using public.pools p
where p.id = s.pool_id
  and coalesce(p.season, 2026) = 2026;

with future_picks as (
  select distinct
    pp.pool_id,
    pp.user_id,
    pp.entry_id,
    pp.week,
    pp.slot,
    pp.team_abbr
  from public.pool_picks pp
  join public.pools p on p.id = pp.pool_id
  join public.nfl_games g
    on g.season = coalesce(p.season, 2026)
   and g.week = pp.week
   and pp.team_abbr in (g.home_team, g.away_team)
  where coalesce(p.season, 2026) = 2026
    and coalesce(g.kickoff_at_utc, g.game_time) > now()
),
restored as (
  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  select pool_id, user_id, entry_id, week, slot, team_abbr, now()
  from future_picks
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        updated_at = now()
  returning pool_id, entry_id, week, slot
)
delete from public.pool_picks pp
using restored r
where pp.pool_id = r.pool_id
  and pp.entry_id = r.entry_id
  and pp.week = r.week
  and pp.slot = r.slot;
