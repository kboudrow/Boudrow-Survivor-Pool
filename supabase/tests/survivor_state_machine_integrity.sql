begin;

insert into auth.users(id, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', 'owner@example.test', now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'player@example.test', now(), now());

insert into public.profiles(id, "User_name", username)
values
  ('00000000-0000-0000-0000-000000000001', 'owner', 'owner'),
  ('00000000-0000-0000-0000-000000000002', 'player', 'player');

insert into public.nfl_games(id, season, week, game_time, kickoff_at_utc, home_team, away_team, status, espn_event_id)
values
  ('00000000-0000-0000-0000-000000000011', 2026, 1, '2026-09-13 17:00:00+00', '2026-09-13 17:00:00+00', 'KC', 'BUF', 'scheduled', 'integrity-1'),
  ('00000000-0000-0000-0000-000000000012', 2026, 2, '2026-09-20 17:00:00+00', '2026-09-20 17:00:00+00', 'NYJ', 'BUF', 'scheduled', 'integrity-2'),
  ('00000000-0000-0000-0000-000000000013', 2026, 19, '2027-01-16 21:30:00+00', '2027-01-16 21:30:00+00', 'MIA', 'BUF', 'scheduled', 'integrity-19');

insert into public.pools(
  id, name, created_by, season, start_week, include_playoffs, strikes_allowed, tie_rule,
  deadline_mode, deadline_fixed, is_public, activation_status, allow_multiple_entries,
  max_entries_per_user, max_members, double_pick_weeks
)
values (
  '00000000-0000-0000-0000-000000000100', 'Integrity Test Pool',
  '00000000-0000-0000-0000-000000000001', 2026, 1, true, '1', 'loss',
  'rolling', '13:00', true, 'active', true, 2, 3, array[2]
), (
  '00000000-0000-0000-0000-000000000200', 'Integrity Test Pool Two',
  '00000000-0000-0000-0000-000000000001', 2026, 3, false, '0', 'loss',
  'fixed', '13:00', false, 'active', false, 1, 2, '{}'::integer[]
);

insert into public.pool_members(id, pool_id, profile_id, role, status, entry_number)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', 'member', 'alive', 1),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000002', 'member', 'alive', 1),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000001', 'member', 'alive', 1);

do $test$
declare v_rejected boolean := false;
begin
  if (select role <> 'admin' from public.pool_members where id = '00000000-0000-0000-0000-000000000101') then
    raise exception 'owner entry was not promoted to admin';
  end if;
  begin
    update public.pools set start_week = 0 where id = '00000000-0000-0000-0000-000000000100';
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'invalid start week was accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.pools set double_pick_weeks = array[2, 2] where id = '00000000-0000-0000-0000-000000000100';
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'duplicate double-pick weeks were accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_members(pool_id, profile_id, status, entry_number)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000002', 'alive', 0);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'entry number zero was accepted'; end if;
end;
$test$;

insert into public.pool_members(id, pool_id, profile_id, status, entry_number)
values ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000002', 'alive', 2);

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.pools set max_entries_per_user = 1 where id = '00000000-0000-0000-0000-000000000100';
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'entry limit was lowered below existing ownership'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_members(pool_id, profile_id, status, entry_number)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', 'alive', 2);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'pool capacity was exceeded'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_pick_drafts(pool_id, user_id, entry_id, week, slot, team_abbr)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000101', 1, 1, 'BUF');
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'pick with contradictory ownership was accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_picks(pool_id, user_id, entry_id, week, slot, team_abbr, locked_at)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 1, 2, 'KC', now());
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'second slot in a normal week was accepted'; end if;
end;
$test$;

insert into public.pool_picks(pool_id, user_id, entry_id, week, slot, team_abbr, locked_at)
values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 1, 1, 'BUF', now());

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_picks(pool_id, user_id, entry_id, week, slot, team_abbr, locked_at)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 2, 1, 'BUF', now());
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'regular-season team reuse was accepted'; end if;
end;
$test$;

-- Reuse across the regular-season/postseason boundary is the one intended exception.
insert into public.pool_picks(pool_id, user_id, entry_id, week, slot, team_abbr, locked_at)
values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 19, 1, 'BUF', now());

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.pool_picks set result = 'win'
    where pool_id = '00000000-0000-0000-0000-000000000100'
      and entry_id = '00000000-0000-0000-0000-000000000101' and week = 1 and slot = 1;
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'graded pick without adjudication time was accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_member_stats(pool_id, user_id, entry_id, losses, strikes_used)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000102', -1, -1);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'negative standings totals were accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.pool_members set status = 'eliminated', eliminated_week = null
    where id = '00000000-0000-0000-0000-000000000102';
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'contradictory elimination state was accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_entry_survival_graces(pool_id, entry_id, week, strike_credits)
    values ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000201', 1, 1);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'cross-pool survival grace was accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    update public.pool_members set status = 'eliminated', eliminated_week = 1
    where id = '00000000-0000-0000-0000-000000000201';
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'elimination before pool start was accepted'; end if;
end;
$test$;

do $test$
declare v_rejected boolean := false;
begin
  begin
    insert into public.pool_entry_survival_graces(pool_id, entry_id, week, strike_credits)
    values ('00000000-0000-0000-0000-000000000200', '00000000-0000-0000-0000-000000000201', 1, 1);
  exception when others then v_rejected := true;
  end;
  if not v_rejected then raise exception 'survival grace before pool start was accepted'; end if;
end;
$test$;

rollback;
