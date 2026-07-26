begin;

create or replace function public.clone_pool_for_new_season(
  p_old_pool_id uuid,
  p_new_season integer
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_old public.pools%rowtype;
  v_existing_pool_id uuid;
  v_new_pool_id uuid;
  v_new_name text;
  v_password_hash text;
begin
  if v_user_id is null then
    raise exception 'Please sign in before creating next season.';
  end if;

  perform public.assert_user_email_confirmed('create next season');
  perform public.assert_action_rate_limit('clone_pool_for_new_season', 3600, 10, p_old_pool_id::text, jsonb_build_object('season', p_new_season));

  if p_new_season is null or p_new_season < 2026 or p_new_season > 2035 then
    raise exception 'Choose a season between 2026 and 2035.';
  end if;

  select *
  into v_old
  from public.pools
  where id = p_old_pool_id
  for share;

  if not found then
    raise exception 'Archived pool not found.';
  end if;

  if v_old.created_by <> v_user_id then
    raise exception 'Only the pool owner can create next season from this archive.';
  end if;

  if not coalesce(v_old.archived, false) then
    raise exception 'Archive this pool before creating next season.';
  end if;

  select p.id
  into v_existing_pool_id
  from public.pools p
  where p.created_by = v_user_id
    and p.cloned_from_pool_id = p_old_pool_id
    and p.season = p_new_season
    and coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
  order by p.created_at desc nulls last
  limit 1;

  if v_existing_pool_id is not null then
    return v_existing_pool_id;
  end if;

  v_password_hash := coalesce(v_old.join_password_hash, v_old.password_hash, v_old.private_password_hash);

  if not coalesce(v_old.is_public, false) and v_password_hash is null then
    raise exception 'This private pool does not have a saved password. Create a new private pool instead.';
  end if;

  v_new_name := btrim(regexp_replace(v_old.name, '\s+[0-9]{4}$', '')) || ' ' || p_new_season::text;
  v_new_name := left(v_new_name, 90);

  insert into public.pools (
    name,
    is_public,
    visibility,
    allow_discovery,
    start_week,
    include_playoffs,
    strikes_allowed,
    tie_rule,
    ties,
    deadline,
    deadline_mode,
    deadline_fixed,
    notes,
    image_url,
    created_by,
    season,
    double_pick_weeks,
    plan,
    pick_privacy,
    activation_status,
    payment_status,
    max_members,
    allow_multiple_entries,
    max_entries_per_user,
    join_password_hash,
    password_hash,
    private_password_hash,
    cloned_from_pool_id,
    archived,
    archived_at,
    test_mode,
    test_current_week,
    winner_user_id,
    sponsored_until,
    stripe_checkout_session_id,
    stripe_payment_intent_id
  )
  values (
    v_new_name,
    coalesce(v_old.is_public, true),
    coalesce(v_old.visibility, case when coalesce(v_old.is_public, true) then 'public'::public.pool_visibility else 'private'::public.pool_visibility end),
    coalesce(v_old.allow_discovery, true),
    coalesce(v_old.start_week, 1),
    coalesce(v_old.include_playoffs, false),
    coalesce(v_old.strikes_allowed, '0'),
    lower(coalesce(v_old.tie_rule, 'loss')),
    coalesce(v_old.ties, lower(coalesce(v_old.tie_rule, 'loss'))::public.ties_rule),
    coalesce(v_old.deadline, '1pm_et'::public.pick_deadline),
    coalesce(v_old.deadline_mode, 'fixed'),
    v_old.deadline_fixed,
    v_old.notes,
    v_old.image_url,
    v_user_id,
    p_new_season,
    coalesce(
      (
        select array_agg(distinct week order by week)
        from unnest(coalesce(v_old.double_pick_weeks, '{}'::integer[])) as selected(week)
        where selected.week between coalesce(v_old.start_week, 1) and 18
      ),
      '{}'::integer[]
    ),
    'free',
    coalesce(v_old.pick_privacy, 'hidden'),
    'active',
    'not_required',
    coalesce(v_old.max_members, 25),
    coalesce(v_old.allow_multiple_entries, false),
    case
      when coalesce(v_old.allow_multiple_entries, false) then least(greatest(coalesce(v_old.max_entries_per_user, 1), 1), 10)
      else 1
    end,
    case when coalesce(v_old.is_public, true) then null else v_password_hash end,
    case when coalesce(v_old.is_public, true) then null else v_password_hash end,
    case when coalesce(v_old.is_public, true) then null else v_password_hash end,
    p_old_pool_id,
    false,
    null,
    false,
    null,
    null,
    null,
    null,
    null
  )
  returning id into v_new_pool_id;

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (v_new_pool_id, v_user_id, 'admin'::public.member_role, 'alive', 1)
  on conflict (pool_id, profile_id, entry_number) do nothing;

  perform public.log_security_event(
    'pool_created_from_archive',
    'info',
    'Next season pool created from archive.',
    jsonb_build_object('source_pool_id', p_old_pool_id, 'season', p_new_season),
    v_new_pool_id
  );

  return v_new_pool_id;
end;
$function$;

revoke execute on function public.clone_pool_for_new_season(uuid, integer) from public, anon;
grant execute on function public.clone_pool_for_new_season(uuid, integer) to authenticated, service_role;

commit;
