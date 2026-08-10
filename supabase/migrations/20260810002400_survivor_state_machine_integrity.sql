begin;

-- Normalize legacy compatibility columns before enforcing that each pool has
-- one coherent set of rules and lifecycle metadata.
update public.pools
set strikes_allowed = coalesce(nullif(strikes_allowed, ''), '0'),
    tie_rule = coalesce(nullif(tie_rule, ''), 'loss'),
    deadline_mode = case when deadline_mode = 'rolling' then 'rolling' else 'fixed' end,
    deadline_fixed = coalesce(nullif(deadline_fixed, ''), '13:00'),
    mulligans = greatest(0, coalesce(nullif(strikes_allowed, '')::integer, 0)),
    ties = coalesce(nullif(tie_rule, ''), 'loss')::public.ties_rule,
    visibility = case when is_public then 'public'::public.pool_visibility else 'private'::public.pool_visibility end,
    deadline = case when coalesce(deadline_mode, 'fixed') = 'rolling'
      then 'kickoff'::public.pick_deadline else '1pm_et'::public.pick_deadline end,
    archived_at = case when archived then coalesce(archived_at, created_at, now()) else null end,
    activated_at = case when activation_status = 'active' then coalesce(activated_at, created_at, now()) else activated_at end,
    activated_by = case when activation_status = 'active' then coalesce(activated_by, created_by) else activated_by end,
    max_entries_per_user = case when allow_multiple_entries then max_entries_per_user else 1 end;

create or replace function public.guard_pool_settings_security()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_distinct_double_weeks integer;
  v_max_week integer;
  v_total_entries integer;
  v_largest_owner_count integer;
begin
  new.name := btrim(coalesce(new.name, ''));
  if char_length(new.name) < 3 or char_length(new.name) > 100 or new.name ~ '[[:cntrl:]]' then
    raise exception 'Pool name must be between 3 and 100 characters and cannot contain control characters.';
  end if;
  if coalesce(new.season, 0) < 2020 or coalesce(new.season, 0) > 2100 then
    raise exception 'Season is invalid.';
  end if;
  if new.start_week is null or new.start_week < 1 or new.start_week > 18 then
    raise exception 'Start week must be between Week 1 and Week 18.';
  end if;
  if coalesce(new.strikes_allowed, '') not in ('0', '1', '2') then
    raise exception 'Mulligans must be 0, 1, or 2.';
  end if;
  if coalesce(new.tie_rule, '') not in ('win', 'loss') then
    raise exception 'Tie rule must be win or loss.';
  end if;
  if coalesce(new.deadline_mode, 'fixed') not in ('fixed', 'rolling') then
    raise exception 'Deadline mode must be fixed or rolling.';
  end if;
  if coalesce(new.deadline_mode, 'fixed') = 'fixed'
    and coalesce(new.deadline_fixed, '') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Fixed deadline must be a valid 24-hour time.';
  end if;
  if char_length(coalesce(new.notes, '')) > 2000 then
    raise exception 'Pool notes cannot exceed 2,000 characters.';
  end if;

  new.double_pick_weeks := coalesce(new.double_pick_weeks, '{}'::integer[]);
  select count(distinct week)::integer into v_distinct_double_weeks
  from unnest(new.double_pick_weeks) week;
  if cardinality(new.double_pick_weeks) <> v_distinct_double_weeks then
    raise exception 'Double-pick weeks cannot contain duplicates.';
  end if;
  v_max_week := case when coalesce(new.include_playoffs, false) then 22 else 18 end;
  if exists (
    select 1 from unnest(new.double_pick_weeks) week
    where week < new.start_week or week > v_max_week
  ) then
    raise exception 'Double-pick weeks must be playable weeks for this pool.';
  end if;

  if not coalesce(new.allow_multiple_entries, false) then
    new.max_entries_per_user := 1;
  end if;
  if tg_op = 'UPDATE' then
    select count(*)::integer into v_total_entries
    from public.pool_members where pool_id = new.id;
    select coalesce(max(owner_count), 0)::integer into v_largest_owner_count
    from (
      select count(*)::integer as owner_count
      from public.pool_members where pool_id = new.id group by profile_id
    ) owners;
    if v_total_entries > new.max_members then
      raise exception 'The total entry limit cannot be lower than the pool''s existing entry count.';
    end if;
    if v_largest_owner_count > new.max_entries_per_user then
      raise exception 'The per-user entry limit cannot be lower than an existing user''s entry count.';
    end if;
  end if;

  -- Keep the pre-RPC compatibility columns deterministic.
  new.mulligans := new.strikes_allowed::integer;
  new.ties := new.tie_rule::public.ties_rule;
  new.visibility := case when new.is_public then 'public'::public.pool_visibility else 'private'::public.pool_visibility end;
  new.deadline := case when new.deadline_mode = 'rolling'
    then 'kickoff'::public.pick_deadline else '1pm_et'::public.pick_deadline end;

  if new.archived then
    new.archived_at := coalesce(new.archived_at, case when tg_op = 'UPDATE' then old.archived_at end, now());
  else
    new.archived_at := null;
  end if;
  if new.activation_status = 'active' then
    new.activated_at := coalesce(new.activated_at, case when tg_op = 'UPDATE' then old.activated_at end, new.created_at, now());
    new.activated_by := coalesce(new.activated_by, new.created_by);
  end if;

  return new;
end;
$function$;

alter table public.pools
  alter column season set not null,
  alter column strikes_allowed set not null,
  alter column tie_rule set not null,
  alter column deadline_mode set not null,
  alter column deadline_fixed set not null,
  drop constraint if exists pools_start_week_check,
  add constraint pools_start_week_check check (start_week between 1 and 18),
  drop constraint if exists pools_season_check,
  add constraint pools_season_check check (season between 2020 and 2100),
  drop constraint if exists pools_strikes_allowed_check,
  add constraint pools_strikes_allowed_check check (strikes_allowed in ('0', '1', '2')),
  drop constraint if exists pools_deadline_mode_check,
  add constraint pools_deadline_mode_check check (deadline_mode in ('fixed', 'rolling')),
  drop constraint if exists pools_legacy_rules_sync_check,
  add constraint pools_legacy_rules_sync_check check (
    mulligans = strikes_allowed::integer
    and ties::text = tie_rule
    and visibility::text = case when is_public then 'public' else 'private' end
    and deadline::text = case when deadline_mode = 'rolling' then 'kickoff' else '1pm_et' end
  ),
  drop constraint if exists pools_archive_state_check,
  add constraint pools_archive_state_check check (archived = (archived_at is not null)),
  drop constraint if exists pools_activation_metadata_check,
  add constraint pools_activation_metadata_check check (
    activation_status <> 'active' or (activated_at is not null and activated_by is not null)
  ),
  drop constraint if exists pools_multiple_entry_settings_check,
  add constraint pools_multiple_entry_settings_check check (allow_multiple_entries or max_entries_per_user = 1);

do $function$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pools'::regclass and conname = 'pools_winner_user_id_fkey'
  ) then
    alter table public.pools
      add constraint pools_winner_user_id_fkey
      foreign key (winner_user_id) references public.profiles(id) on delete set null;
  end if;
end;
$function$;

alter table public.pool_members
  drop constraint if exists pool_members_entry_number_check,
  add constraint pool_members_entry_number_check check (entry_number >= 1),
  drop constraint if exists pool_members_status_check,
  add constraint pool_members_status_check check (lower(status) in ('alive', 'active', 'eliminated')),
  drop constraint if exists pool_members_elimination_state_check,
  add constraint pool_members_elimination_state_check check (
    (lower(status) in ('alive', 'active') and eliminated_week is null)
    or (lower(status) = 'eliminated' and eliminated_week is not null and eliminated_week between 1 and 22)
  ),
  drop constraint if exists pool_members_lives_remaining_check,
  add constraint pool_members_lives_remaining_check check (lives_remaining is null or lives_remaining >= 0);

create or replace function public.guard_pool_entry_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_pool_count integer;
  v_owner_count integer;
  v_owner_admin_count integer;
begin
  if tg_op = 'UPDATE' and (new.id, new.pool_id, new.profile_id) is distinct from (old.id, old.pool_id, old.profile_id) then
    raise exception 'Entry identity and ownership cannot be changed.';
  end if;

  select * into v_pool from public.pools where id = new.pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;

  if tg_op = 'INSERT' then
    select count(*)::integer into v_pool_count from public.pool_members where pool_id = new.pool_id;
    if v_pool_count >= v_pool.max_members then raise exception 'This pool is full.'; end if;

    select count(*)::integer into v_owner_count
    from public.pool_members where pool_id = new.pool_id and profile_id = new.profile_id;
    if (not v_pool.allow_multiple_entries and v_owner_count >= 1)
      or v_owner_count >= v_pool.max_entries_per_user then
      raise exception 'This user has reached the entry limit for this pool.';
    end if;

    if new.profile_id = v_pool.created_by then
      select count(*)::integer into v_owner_admin_count
      from public.pool_members
      where pool_id = new.pool_id and profile_id = v_pool.created_by and role = 'admin';
      if v_owner_admin_count = 0 then new.role := 'admin'; end if;
    end if;
  elsif old.profile_id = v_pool.created_by and old.role = 'admin' and new.role <> 'admin' then
    select count(*)::integer into v_owner_admin_count
    from public.pool_members
    where pool_id = new.pool_id and profile_id = v_pool.created_by and role = 'admin' and id <> new.id;
    if v_owner_admin_count = 0 then
      raise exception 'The pool creator must retain an admin entry.';
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_pool_entry_capacity on public.pool_members;
create trigger trg_guard_pool_entry_capacity
before insert or update on public.pool_members
for each row execute function public.guard_pool_entry_capacity();

alter table public.pool_member_stats
  drop constraint if exists pool_member_stats_nonnegative_check,
  add constraint pool_member_stats_nonnegative_check check (
    wins >= 0 and losses >= 0 and pushes >= 0 and strikes_used >= 0
  ),
  drop constraint if exists pool_member_stats_elimination_state_check,
  add constraint pool_member_stats_elimination_state_check check (
    (not eliminated and eliminated_week is null)
    or (eliminated and eliminated_week is not null and eliminated_week between 1 and 22)
  );

create unique index if not exists pool_members_pool_id_id_key
  on public.pool_members(pool_id, id);

do $function$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_entry_survival_graces'::regclass
      and conname = 'pool_entry_survival_graces_entry_pool_fkey'
  ) then
    alter table public.pool_entry_survival_graces
      add constraint pool_entry_survival_graces_entry_pool_fkey
      foreign key (pool_id, entry_id)
      references public.pool_members(pool_id, id)
      on delete cascade;
  end if;
end;
$function$;

create or replace function public.guard_pool_final_pick_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry public.pool_members%rowtype;
  v_team text := upper(btrim(coalesce(new.team_abbr, '')));
  v_eliminated_week integer;
begin
  if v_team = '' then raise exception 'A final pick must name a team or missed-pick marker.'; end if;
  new.team_abbr := v_team;

  select * into v_pool from public.pools where id = new.pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if new.week < v_pool.start_week or new.week > public.pool_max_pick_week(new.pool_id) then
    raise exception 'Week % is outside this pool''s playable season.', new.week;
  end if;
  if new.slot < 1 or new.slot > public.picks_allowed(new.pool_id, new.week) then
    raise exception 'Slot % is not valid for Week %.', new.slot, new.week;
  end if;

  select * into v_entry from public.pool_members where pool_id = new.pool_id and id = new.entry_id;
  if not found or v_entry.profile_id is distinct from new.user_id then
    raise exception 'Final pick entry ownership is invalid.';
  end if;
  select eliminated_week into v_eliminated_week
  from public.pool_member_stats where pool_id = new.pool_id and entry_id = new.entry_id and eliminated;
  if v_eliminated_week is not null and new.week > v_eliminated_week then
    raise exception 'Eliminated entries cannot receive later picks.';
  end if;
  if (new.result is null) is distinct from (new.adjudicated_at is null) then
    raise exception 'A graded pick must include its adjudication time, and an ungraded pick cannot have one.';
  end if;

  if v_team not like 'NO_PICK%' then
    if not exists (
      select 1 from public.pool_week_games(new.pool_id, new.week) game
      where v_team in (upper(game.home_team), upper(game.away_team))
    ) then raise exception 'That team is not scheduled for Week %.', new.week; end if;

    if exists (
      select 1 from public.pool_picks pick
      where pick.pool_id = new.pool_id and pick.entry_id = new.entry_id
        and upper(btrim(pick.team_abbr)) = v_team and pick.team_abbr not like 'NO_PICK%'
        and public.pool_pick_phase(pick.week) = public.pool_pick_phase(new.week)
        and not (pick.pool_id = new.pool_id and pick.entry_id = new.entry_id
          and pick.week = new.week and pick.slot = new.slot)
    ) or exists (
      select 1 from public.pool_pick_drafts draft
      where draft.pool_id = new.pool_id and draft.entry_id = new.entry_id
        and upper(btrim(draft.team_abbr)) = v_team and draft.team_abbr not like 'NO_PICK%'
        and public.pool_pick_phase(draft.week) = public.pool_pick_phase(new.week)
        and not (draft.pool_id = new.pool_id and draft.entry_id = new.entry_id
          and draft.week = new.week and draft.slot = new.slot)
    ) then raise exception 'This entry has already used % in the %.', v_team, public.pool_pick_phase(new.week); end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_pool_final_pick_integrity on public.pool_picks;
create trigger trg_guard_pool_final_pick_integrity
before insert or update on public.pool_picks
for each row execute function public.guard_pool_final_pick_integrity();

create or replace function public.admin_override_entry_final_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_reason text default null,
  p_slot integer default 1
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_team text := upper(btrim(coalesce(p_team_abbr, '')));
  v_slot integer := coalesce(p_slot, 1);
  v_test_mode boolean;
  v_season integer;
  v_required_picks integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  if v_team = '' then raise exception 'Choose a team before saving this pick.'; end if;

  select pm.profile_id into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id and pm.id = p_entry_id;
  if v_user_id is null then raise exception 'Entry not found.'; end if;

  select coalesce(p.test_mode, false), coalesce(p.season, extract(year from now())::integer),
    public.picks_allowed(p.id, p_week)
  into v_test_mode, v_season, v_required_picks
  from public.pools p where p.id = p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if coalesce(v_required_picks, 0) = 0 then
    raise exception 'Week % is outside this pool''s playable season.', p_week;
  end if;
  if v_slot < 1 or v_slot > v_required_picks then
    raise exception 'Slot % is not valid for Week %; this pool requires % pick(s).', v_slot, p_week, v_required_picks;
  end if;

  if not exists (
    select 1 from public.pool_week_games(p_pool_id, p_week) game
    where v_team in (upper(game.home_team), upper(game.away_team))
  ) then raise exception 'That team is not scheduled for Week %.', p_week; end if;

  if exists (
    select 1 from public.pool_picks pick
    where pick.pool_id = p_pool_id and pick.entry_id = p_entry_id
      and upper(btrim(pick.team_abbr)) = v_team and pick.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(pick.week) = public.pool_pick_phase(p_week)
      and not (pick.week = p_week and pick.slot = v_slot)
  ) or exists (
    select 1 from public.pool_pick_drafts draft
    where draft.pool_id = p_pool_id and draft.entry_id = p_entry_id
      and upper(btrim(draft.team_abbr)) = v_team and draft.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(draft.week) = public.pool_pick_phase(p_week)
      and not (draft.week = p_week and draft.slot = v_slot)
  ) then raise exception 'This entry has already used % in the %.', v_team, public.pool_pick_phase(p_week); end if;

  insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, v_slot, v_team, now(), null, null, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr, user_id = excluded.user_id,
        locked_at = now(), result = null, adjudicated_at = null;

  delete from public.pool_pick_drafts draft
  where draft.pool_id = p_pool_id and draft.entry_id = p_entry_id
    and draft.week = p_week and draft.slot = v_slot;

  if v_test_mode then
    update public.pool_picks pick
       set result = case when result_row.result = 'push'
             then coalesce(nullif(pool.tie_rule, ''), 'loss') else result_row.result end,
           adjudicated_at = now()
      from public.pools pool
      join public.test_pool_team_results result_row
        on result_row.pool_id = pool.id and result_row.week = p_week and result_row.team_abbr = v_team
     where pool.id = p_pool_id and pick.pool_id = p_pool_id and pick.entry_id = p_entry_id
       and pick.week = p_week and pick.slot = v_slot;
    perform public.superadmin_rebuild_test_pool_stats(p_pool_id);
  else
    perform public.adjudicate_results(v_season, p_week);
    perform public.rebuild_pool_member_stats(p_pool_id);
  end if;
end;
$function$;

-- The original entries/picks tables were replaced by pool_members and the
-- entry-scoped pool pick tables. Keep them readable for historical safety, but
-- prevent authenticated clients from creating a second, contradictory ledger.
drop policy if exists entries_insert_self_and_member on public.entries;
drop policy if exists entries_update_owner on public.entries;
drop policy if exists entries_delete_owner on public.entries;
drop policy if exists picks_insert_entry_owner on public.picks;
drop policy if exists picks_update_entry_owner on public.picks;
drop policy if exists picks_delete_entry_owner on public.picks;
revoke insert, update, delete on public.entries, public.picks from anon, authenticated;

-- Repair test-only scoring snapshots and remove test picks that occur after an
-- entry's authoritative elimination week. Real pools were clean in the audit.
do $function$
declare
  v_pool_id uuid;
begin
  for v_pool_id in select id from public.pools where test_mode loop
    perform public.rebuild_pool_member_stats(v_pool_id);
  end loop;
end;
$function$;

revoke execute on function public.guard_pool_settings_security() from public, anon, authenticated;
revoke execute on function public.guard_pool_entry_capacity() from public, anon, authenticated;
revoke execute on function public.guard_pool_final_pick_integrity() from public, anon, authenticated;
grant execute on function public.guard_pool_settings_security() to service_role;
grant execute on function public.guard_pool_entry_capacity() to service_role;
grant execute on function public.guard_pool_final_pick_integrity() to service_role;

commit;
