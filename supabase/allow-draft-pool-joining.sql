begin;

-- Payment/activation should not block people from joining the roster. It only
-- controls the commissioner launch flow. Private leagues still require their password.
create or replace function public.join_pool(p_pool_id uuid, p_password text default null, p_token text default null)
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
  if auth.uid() is null then
    raise exception 'Please sign in to join this pool.';
  end if;

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

  if exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    return;
  end if;

  select count(*)
  into v_entry_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id;

  if not v_is_owner and v_entry_count >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  if not coalesce(v_pool.is_public, false) and not v_is_owner then
    v_password_hash := coalesce(v_pool.join_password_hash, v_pool.password_hash, v_pool.private_password_hash);
    if v_password_hash is null
      or p_password is null
      or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
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
end;
$function$;

grant execute on function public.join_pool(uuid, text, text) to authenticated;

commit;
