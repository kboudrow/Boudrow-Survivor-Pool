begin;

-- Test pools use their simulated clock to decide whether Week 1 has started.
-- The reset flow intentionally places that clock one minute before kickoff, so
-- test_current_week = start_week alone must not close the roster.
create or replace function public.join_pool(
  p_pool_id uuid,
  p_password text default null,
  p_token text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry_count integer;
  v_is_owner boolean;
  v_password_hash text;
  v_next_entry integer;
begin
  perform public.assert_user_email_confirmed('join a pool');
  perform public.assert_action_rate_limit('join_pool', 600, 20, p_pool_id::text);

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  v_is_owner := v_pool.created_by = auth.uid();

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  if coalesce(v_pool.activation_status, 'draft') = 'cancelled' then
    raise exception 'This pool is not accepting members.';
  end if;

  -- A retry by an existing member remains idempotent even after kickoff.
  if exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    return;
  end if;

  if public.pool_has_started(p_pool_id) then
    raise exception 'This pool has already started.';
  end if;

  select count(*)
  into v_entry_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id;

  if not v_is_owner and v_entry_count >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  if not coalesce(v_pool.is_public, false) and not v_is_owner then
    perform public.assert_action_rate_limit('private_pool_password', 600, 8, p_pool_id::text);
    v_password_hash := coalesce(v_pool.join_password_hash, v_pool.password_hash, v_pool.private_password_hash);
    if v_password_hash is null
      or p_password is null
      or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
      perform public.log_security_event(
        'private_pool_password_failed',
        'warning',
        'Incorrect pool password.',
        '{}'::jsonb,
        p_pool_id
      );
      raise exception 'Incorrect pool password.';
    end if;
  end if;

  select coalesce(max(pm.entry_number), 0) + 1
  into v_next_entry
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = auth.uid();

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (
    p_pool_id,
    auth.uid(),
    case when v_is_owner then 'admin'::public.member_role else 'member'::public.member_role end,
    'alive',
    v_next_entry
  );

  perform public.log_security_event(
    'pool_joined',
    'info',
    'User joined pool.',
    jsonb_build_object('entry_number', v_next_entry),
    p_pool_id
  );
end;
$function$;

revoke all on function public.join_pool(uuid, text, text) from public, anon;
grant execute on function public.join_pool(uuid, text, text) to authenticated, service_role;

commit;
