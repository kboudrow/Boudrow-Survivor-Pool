begin;

-- Provider finals are quarantined until the exact same score is observed again
-- after a short settling period. This prevents a transient or malformed final
-- from immediately changing eliminations, mulligans, or standings.
alter table public.nfl_games
  add column if not exists provider_result_signature text,
  add column if not exists provider_result_first_seen_at timestamptz,
  add column if not exists result_confirmed_at timestamptz,
  add column if not exists provider_last_seen_at timestamptz;

create or replace function public.validate_and_stabilize_nfl_game()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_known_teams constant text[] := array[
    'ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB',
    'HOU','IND','JAX','KC','LV','LAC','LAR','MIA','MIN','NE','NO','NYG',
    'NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS'
  ];
  v_signature text;
  v_expected_winner text;
  v_old_lock timestamptz;
  v_prior_signature text;
  v_prior_first_seen_at timestamptz;
  v_prior_confirmed_at timestamptz;
  v_prior_status text;
  v_has_prior boolean := false;
begin
  new.provider_last_seen_at := clock_timestamp();

  if not (new.home_team = any(v_known_teams)) or not (new.away_team = any(v_known_teams)) then
    raise exception 'Rejected NFL game with unknown team: % @ %.', new.away_team, new.home_team;
  end if;

  if new.status not in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled') then
    raise exception 'Rejected unknown NFL game status: %.', new.status;
  end if;

  if tg_op = 'UPDATE' then
    v_old_lock := coalesce(old.kickoff_at_utc, old.game_time);
    v_prior_signature := old.provider_result_signature;
    v_prior_first_seen_at := old.provider_result_first_seen_at;
    v_prior_confirmed_at := old.result_confirmed_at;
    v_prior_status := old.status;
    v_has_prior := true;
  else
    -- INSERT triggers run before ON CONFLICT resolves an upsert. Read the
    -- matchup that the statement will update so repeated observations retain
    -- their quarantine clock.
    select
      coalesce(g.kickoff_at_utc, g.game_time),
      g.provider_result_signature,
      g.provider_result_first_seen_at,
      g.result_confirmed_at,
      g.status
    into
      v_old_lock,
      v_prior_signature,
      v_prior_first_seen_at,
      v_prior_confirmed_at,
      v_prior_status
    from public.nfl_games g
    where g.season = new.season
      and g.week = new.week
      and g.home_team = new.home_team
      and g.away_team = new.away_team
    limit 1;
    v_has_prior := found;
  end if;

  if v_has_prior then
    -- A correction may lock a game sooner, but a provider correction can never
    -- reopen a team after the previously authoritative lock already passed.
    if v_old_lock <= clock_timestamp() or v_prior_status in ('in_progress', 'final') then
      new.kickoff_at_utc := least(v_old_lock, coalesce(new.kickoff_at_utc, new.game_time));
    end if;
  end if;

  if new.status = 'final' then
    if new.home_score is null or new.away_score is null
       or new.home_score < 0 or new.away_score < 0
       or new.home_score <> trunc(new.home_score) or new.away_score <> trunc(new.away_score) then
      raise exception 'Rejected final NFL game without valid whole-number scores: % @ %.', new.away_team, new.home_team;
    end if;

    v_expected_winner := case
      when new.home_score > new.away_score then new.home_team
      when new.away_score > new.home_score then new.away_team
      else null
    end;
    if new.winner is distinct from v_expected_winner then
      raise exception 'Rejected final NFL game whose winner conflicts with its score: % @ %.', new.away_team, new.home_team;
    end if;

    v_signature := concat_ws(':', new.home_team, new.home_score, new.away_team, new.away_score, coalesce(new.winner, 'TIE'));
    new.provider_result_signature := v_signature;

    if v_has_prior
       and v_prior_signature = v_signature
       and v_prior_first_seen_at is not null then
      new.provider_result_first_seen_at := v_prior_first_seen_at;
      if v_prior_confirmed_at is not null then
        new.result_confirmed_at := v_prior_confirmed_at;
      elsif clock_timestamp() - v_prior_first_seen_at >= interval '2 minutes' then
        new.result_confirmed_at := clock_timestamp();
      else
        new.result_confirmed_at := null;
      end if;
    else
      new.provider_result_first_seen_at := clock_timestamp();
      new.result_confirmed_at := null;
    end if;

    if new.result_confirmed_at is null then
      -- Keep the score candidate for the next comparison, but do not expose it
      -- to adjudication as a final result yet.
      new.status := case when coalesce(new.kickoff_at_utc, new.game_time) <= clock_timestamp() then 'in_progress' else 'scheduled' end;
      new.winner := null;
    end if;
  elsif new.provider_result_signature is not null and new.provider_result_first_seen_at is not null then
    -- This is the quarantined final produced by the BEFORE INSERT phase of an
    -- INSERT ... ON CONFLICT UPDATE. Keep its candidate metadata intact.
    new.winner := null;
    new.result_confirmed_at := null;
  else
    new.winner := null;
    new.provider_result_signature := null;
    new.provider_result_first_seen_at := null;
    new.result_confirmed_at := null;
  end if;

  return new;
end;
$function$;

drop trigger if exists zzz_validate_and_stabilize_nfl_game on public.nfl_games;
create trigger zzz_validate_and_stabilize_nfl_game
before insert or update on public.nfl_games
for each row execute function public.validate_and_stabilize_nfl_game();

-- A corrected/retracted final clears its old grades in the same transaction.
-- Rebuilding from picks restores mulligans, eliminations, and standings.
create or replace function public.reconcile_retracted_nfl_result()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid;
begin
  if old.result_confirmed_at is not null
     and (new.result_confirmed_at is null
          or new.provider_result_signature is distinct from old.provider_result_signature) then
    update public.pool_picks pp
       set result = null,
           adjudicated_at = null
      from public.pools p
     where p.id = pp.pool_id
       and coalesce(p.season, old.season) = old.season
       and pp.week = old.week
       and pp.team_abbr in (old.home_team, old.away_team)
       and pp.result is not null;

    for v_pool_id in
      select p.id
      from public.pools p
      where coalesce(p.season, old.season) = old.season
        and coalesce(p.test_mode, false) = false
        and coalesce(p.archived, false) = false
      order by p.id
    loop
      perform public.rebuild_pool_member_stats(v_pool_id);
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists zzz_reconcile_retracted_nfl_result on public.nfl_games;
create trigger zzz_reconcile_retracted_nfl_result
after update on public.nfl_games
for each row execute function public.reconcile_retracted_nfl_result();

-- Elimination and winner status close all future write paths. Retaining prior
-- drafts/finals as an audit ledger makes a later official NFL correction fully
-- reversible instead of silently destroying a user's already-saved choices.
create or replace function public.prune_picks_after_elimination(p_pool_id uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_pool_id is not null and auth.uid() is not null and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;
  return 0;
end;
$function$;

create or replace function public.prune_pool_picks_after_winner(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return 0;
end;
$function$;

-- Do not allow new choices while the NFL has explicitly postponed or canceled
-- the selected game. Existing saved choices remain intact pending a ruling.
create or replace function public.guard_unavailable_provider_game_draft()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select g.status into v_status
  from public.pools p
  join public.nfl_games g
    on g.season = coalesce(p.season, extract(year from now())::integer)
   and g.week = new.week
   and upper(new.team_abbr) in (g.home_team, g.away_team)
  where p.id = new.pool_id
    and coalesce(p.test_mode, false) = false
  limit 1;

  if v_status in ('postponed', 'canceled') then
    raise exception 'This NFL game is % and is temporarily unavailable for new picks.', v_status;
  end if;
  return new;
end;
$function$;

drop trigger if exists aab_guard_unavailable_provider_game_draft on public.pool_pick_drafts;
create trigger aab_guard_unavailable_provider_game_draft
before insert or update on public.pool_pick_drafts
for each row execute function public.guard_unavailable_provider_game_draft();

revoke all on function public.validate_and_stabilize_nfl_game() from public, anon, authenticated;
revoke all on function public.reconcile_retracted_nfl_result() from public, anon, authenticated;
revoke all on function public.guard_unavailable_provider_game_draft() from public, anon, authenticated;
grant execute on function public.validate_and_stabilize_nfl_game() to service_role;
grant execute on function public.reconcile_retracted_nfl_result() to service_role;
grant execute on function public.guard_unavailable_provider_game_draft() to service_role;

commit;
