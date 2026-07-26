begin;

create or replace function public.pool_reinvite_overview(p_pool_id uuid)
returns table (
  source_pool_id uuid,
  source_pool_name text,
  profile_id uuid,
  display_name text,
  username text,
  avatar_url text,
  previous_entry_count integer,
  previous_role text,
  current_entry_count integer,
  joined_new_pool boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_source public.pools%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view previous members.';
  end if;

  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if v_pool.cloned_from_pool_id is null then
    return;
  end if;

  select *
  into v_source
  from public.pools
  where id = v_pool.cloned_from_pool_id;

  if not found then
    return;
  end if;

  return query
  with previous_members as (
    select
      pm.profile_id,
      count(*)::integer as previous_entry_count,
      bool_or(pm.role = 'admin'::public.member_role) as was_admin
    from public.pool_members pm
    where pm.pool_id = v_source.id
    group by pm.profile_id
  ),
  current_members as (
    select
      pm.profile_id,
      count(*)::integer as current_entry_count
    from public.pool_members pm
    where pm.pool_id = p_pool_id
    group by pm.profile_id
  )
  select
    v_source.id as source_pool_id,
    v_source.name as source_pool_name,
    previous_members.profile_id,
    coalesce(
      nullif(btrim(pr.username), ''),
      nullif(btrim(pr.display_name), ''),
      nullif(btrim(pr."User_name"), ''),
      'Player ' || left(previous_members.profile_id::text, 8)
    ) as display_name,
    coalesce(
      nullif(btrim(pr.username), ''),
      nullif(btrim(pr.display_name), ''),
      nullif(btrim(pr."User_name"), ''),
      'Player ' || left(previous_members.profile_id::text, 8)
    ) as username,
    pr.avatar_url,
    previous_members.previous_entry_count,
    case when previous_members.was_admin then 'admin' else 'member' end as previous_role,
    coalesce(current_members.current_entry_count, 0)::integer as current_entry_count,
    current_members.profile_id is not null as joined_new_pool
  from previous_members
  left join current_members on current_members.profile_id = previous_members.profile_id
  left join public.profiles pr on pr.id = previous_members.profile_id
  order by
    joined_new_pool asc,
    previous_members.was_admin desc,
    lower(coalesce(nullif(btrim(pr.username), ''), nullif(btrim(pr.display_name), ''), nullif(btrim(pr."User_name"), ''), previous_members.profile_id::text));
end;
$function$;

revoke execute on function public.pool_reinvite_overview(uuid) from public, anon;
grant execute on function public.pool_reinvite_overview(uuid) to authenticated, service_role;

commit;
