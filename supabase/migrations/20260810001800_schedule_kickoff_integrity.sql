-- Kickoff accuracy is a pick-integrity boundary. Unknown NFL flex windows must
-- never be presented (or accepted) as real deadlines.

alter table public.nfl_games
  add column if not exists kickoff_confirmed boolean not null default true;

create unique index if not exists nfl_games_matchup_week_unique
  on public.nfl_games (season, week, home_team, away_team);

-- The NFL has not assigned exact kickoff windows to these 2026 games yet.
-- Keep the placeholder timestamp for week ordering only; all pick paths reject it.
with unconfirmed(week, away_team, home_team) as (
  values
    (16, 'TB', 'ATL'), (16, 'CIN', 'IND'), (16, 'WAS', 'MIN'), (16, 'CAR', 'PIT'),
    (17, 'WAS', 'JAX'), (17, 'KC', 'LAC'), (17, 'DEN', 'NE'), (17, 'LAR', 'TB'),
    (18, 'SF', 'ARI'), (18, 'PIT', 'BAL'), (18, 'NYJ', 'BUF'), (18, 'ATL', 'CAR'),
    (18, 'CLE', 'CIN'), (18, 'LAC', 'DEN'), (18, 'DET', 'GB'), (18, 'TEN', 'HOU'),
    (18, 'JAX', 'IND'), (18, 'LV', 'KC'), (18, 'SEA', 'LAR'), (18, 'CHI', 'MIN'),
    (18, 'MIA', 'NE'), (18, 'TB', 'NO'), (18, 'PHI', 'NYG'), (18, 'DAL', 'WAS')
)
update public.nfl_games g
set kickoff_confirmed = false
from unconfirmed u
where g.season = 2026
  and g.week = u.week
  and upper(g.away_team) = u.away_team
  and upper(g.home_team) = u.home_team;

create or replace function public.guard_confirmed_pick_kickoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_season integer;
  v_test_mode boolean;
  v_team text := upper(btrim(coalesce(new.team_abbr, '')));
begin
  if v_team = '' or v_team like 'NO_PICK%' then
    return new;
  end if;

  select coalesce(p.season, extract(year from current_date)::integer), coalesce(p.test_mode, false)
  into v_season, v_test_mode
  from public.pools p
  where p.id = new.pool_id;

  -- Test schedules intentionally use simulated kickoff windows.
  if v_test_mode then
    return new;
  end if;

  if exists (
    select 1
    from public.nfl_games g
    where g.season = v_season
      and g.week = new.week
      and v_team in (upper(g.home_team), upper(g.away_team))
      and not g.kickoff_confirmed
  ) then
    raise exception 'The NFL has not confirmed the kickoff time for % in Week %. This team will become available after the official time is published.', v_team, new.week;
  end if;

  return new;
end;
$function$;

drop trigger if exists aab_guard_confirmed_draft_kickoff on public.pool_pick_drafts;
create trigger aab_guard_confirmed_draft_kickoff
before insert or update on public.pool_pick_drafts
for each row execute function public.guard_confirmed_pick_kickoff();

drop trigger if exists aab_guard_confirmed_final_kickoff on public.pool_picks;
create trigger aab_guard_confirmed_final_kickoff
before insert or update on public.pool_picks
for each row execute function public.guard_confirmed_pick_kickoff();

revoke execute on function public.guard_confirmed_pick_kickoff() from public, anon, authenticated;
grant execute on function public.guard_confirmed_pick_kickoff() to service_role;
