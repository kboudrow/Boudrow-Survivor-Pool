-- Guard the NFL schedule table against stale rows and impossible weekly schedules.
-- This is especially important for the 2026 audited schedule: old ESPN pulls
-- must not be able to insert 2025 final games under season 2026.

create or replace function public.enforce_nfl_games_integrity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_kickoff timestamptz;
  v_conflict record;
begin
  new.home_team := upper(trim(new.home_team));
  new.away_team := upper(trim(new.away_team));
  v_kickoff := coalesce(new.kickoff_at_utc, new.game_time);

  if new.season is null or new.week is null then
    raise exception 'NFL schedule rows must include season and week.';
  end if;

  if new.week < 1 or new.week > 22 then
    raise exception 'NFL schedule week % is outside the supported range.', new.week;
  end if;

  if new.home_team = '' or new.away_team = '' or new.home_team = new.away_team then
    raise exception 'Invalid NFL matchup: % vs %.', new.away_team, new.home_team;
  end if;

  if new.season = 2026 and (v_kickoff < '2026-08-01'::timestamptz or v_kickoff >= '2027-03-01'::timestamptz) then
    raise exception 'Rejected stale 2026 schedule row for % @ % at %.', new.away_team, new.home_team, v_kickoff;
  end if;

  select g.id, g.away_team, g.home_team
    into v_conflict
  from public.nfl_games g
  where g.season = new.season
    and g.week = new.week
    and g.id is distinct from new.id
    and (
      new.away_team in (g.away_team, g.home_team)
      or new.home_team in (g.away_team, g.home_team)
    )
  limit 1;

  if v_conflict.id is not null then
    raise exception 'Rejected duplicate team schedule row in season %, week %. Existing: % @ %. New: % @ %.',
      new.season,
      new.week,
      v_conflict.away_team,
      v_conflict.home_team,
      new.away_team,
      new.home_team;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enforce_nfl_games_integrity on public.nfl_games;
create trigger trg_enforce_nfl_games_integrity
before insert or update on public.nfl_games
for each row
execute function public.enforce_nfl_games_integrity();
