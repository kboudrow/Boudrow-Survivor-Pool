begin;

-- Public browsing should show public pools. Private pools remain searchable by
-- name, but only after someone types a term.
drop function if exists public.search_pools(text);

create or replace function public.search_pools(p_term text)
returns table (
  id uuid,
  name text,
  is_public boolean,
  allow_discovery boolean,
  start_week integer,
  include_playoffs boolean,
  strikes_allowed text,
  tie_rule text,
  deadline_mode text,
  deadline_fixed text,
  notes text,
  created_by uuid,
  created_at timestamptz,
  activation_status text,
  max_members integer,
  member_count integer
)
language sql
security definer
set search_path to 'public'
as $function$
  with input as (
    select btrim(coalesce(p_term, '')) as term
  )
  select
    p.id,
    p.name,
    p.is_public,
    p.allow_discovery,
    p.start_week,
    p.include_playoffs,
    p.strikes_allowed::text,
    p.tie_rule::text,
    p.deadline_mode::text,
    p.deadline_fixed,
    case when coalesce(p.is_public, false) then p.notes else null end as notes,
    case when auth.uid() is not null then p.created_by else null end as created_by,
    p.created_at,
    coalesce(p.activation_status, 'active')::text as activation_status,
    p.max_members,
    (
      select count(distinct pm.profile_id)::integer
      from public.pool_members pm
      where pm.pool_id = p.id
    ) as member_count
  from public.pools p
  cross join input i
  where
    coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
    and (
      (i.term = '' and coalesce(p.is_public, false))
      or (
        i.term <> ''
        and p.name ilike ('%' || i.term || '%')
        and (
          coalesce(p.is_public, false)
          or length(i.term) >= 2
        )
      )
    )
  order by p.created_at desc
  limit 50;
$function$;

grant execute on function public.search_pools(text) to anon, authenticated, service_role;

-- Co-admins can manage pool settings, but only the pool creator or platform
-- superadmin can remove another admin from that pool.
create or replace function public.admin_remove_pool_member(
  p_pool_id uuid,
  p_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_user_entry_count integer := 0;
  v_removed integer := 0;
  v_start_at timestamptz;
  v_target_role text;
begin
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

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_start_at
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = v_pool.start_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'Members cannot be removed after the pool has started.';
  end if;

  select count(*), max(pm.role::text)
  into v_user_entry_count, v_target_role
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  if v_user_entry_count = 0 then
    raise exception 'Member not found in this pool.';
  end if;

  if p_profile_id = v_pool.created_by then
    raise exception 'The pool creator cannot be removed from their own pool.';
  end if;

  if v_target_role = 'admin'
    and auth.uid() is distinct from v_pool.created_by
    and not public.is_super_admin() then
    raise exception 'Only the pool creator can remove another admin.';
  end if;

  delete from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$function$;

drop policy if exists pool_images_authenticated_insert on storage.objects;
drop policy if exists pool_images_scoped_insert on storage.objects;

create policy pool_images_scoped_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pool-images'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

commit;
