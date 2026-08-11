begin;

-- RPCs and the commissioner UI already reject competitive edits after the
-- configured start. Enforce the same invariant on the row itself so a future
-- RPC, service-role script, or other privileged write cannot silently regrade
-- historical competition under a different ruleset.
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
  if tg_op = 'UPDATE'
    and public.pool_has_started(old.id)
    and row(
      new.season,
      new.start_week,
      new.include_playoffs,
      new.strikes_allowed,
      new.mulligans,
      new.tie_rule,
      new.ties,
      new.deadline_mode,
      new.deadline_fixed,
      new.deadline,
      new.double_pick_weeks,
      new.max_members,
      new.allow_multiple_entries,
      new.max_entries_per_user,
      new.is_public,
      new.visibility,
      new.allow_discovery,
      new.join_password_hash,
      new.password_hash,
      new.private_password_hash,
      new.pick_privacy,
      new.notes,
      new.activation_status,
      new.test_mode
    ) is distinct from row(
      old.season,
      old.start_week,
      old.include_playoffs,
      old.strikes_allowed,
      old.mulligans,
      old.tie_rule,
      old.ties,
      old.deadline_mode,
      old.deadline_fixed,
      old.deadline,
      old.double_pick_weeks,
      old.max_members,
      old.allow_multiple_entries,
      old.max_entries_per_user,
      old.is_public,
      old.visibility,
      old.allow_discovery,
      old.join_password_hash,
      old.password_hash,
      old.private_password_hash,
      old.pick_privacy,
      old.notes,
      old.activation_status,
      old.test_mode
    ) then
    raise exception 'Competitive pool settings cannot be changed after the pool has started.';
  end if;

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

revoke execute on function public.guard_pool_settings_security() from public, anon, authenticated;
grant execute on function public.guard_pool_settings_security() to service_role;

commit;
