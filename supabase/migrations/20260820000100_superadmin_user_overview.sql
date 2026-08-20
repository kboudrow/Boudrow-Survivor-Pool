create or replace function public.superadmin_user_overview()
returns table (
  profile_id uuid,
  email text,
  display_name text,
  signed_up_at timestamptz,
  last_sign_in_at timestamptz,
  pools_created integer,
  pools_joined integer,
  entries_count integer,
  latest_pool_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    u.id as profile_id,
    u.email::text,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), p.username, u.email)::text as display_name,
    coalesce(u.created_at, p.created_at) as signed_up_at,
    u.last_sign_in_at,
    coalesce(created.pools_created, 0)::integer,
    coalesce(joined.pools_joined, 0)::integer,
    coalesce(joined.entries_count, 0)::integer,
    created.latest_pool_created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join (
    select created_by, count(*) as pools_created, max(created_at) as latest_pool_created_at
    from public.pools
    group by created_by
  ) created on created.created_by = u.id
  left join (
    select profile_id, count(distinct pool_id) as pools_joined, count(*) as entries_count
    from public.pool_members
    group by profile_id
  ) joined on joined.profile_id = u.id
  order by coalesce(u.created_at, p.created_at) desc nulls last, u.email;
end;
$function$;

revoke execute on function public.superadmin_user_overview() from public, anon;
grant execute on function public.superadmin_user_overview() to authenticated, service_role;
