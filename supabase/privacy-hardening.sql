-- Tighten pool discovery/join behavior for public production access.

begin;

drop policy if exists pool_member_self_join on public.pool_members;
drop policy if exists pool_members_insert_not_archived on public.pool_members;
drop policy if exists pool_members_insert_self on public.pool_members;
drop policy if exists pool_members_insert_creator_self on public.pool_members;

create policy pool_members_insert_creator_self
on public.pool_members
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and exists (
    select 1
    from public.pools p
    where p.id = pool_members.pool_id
      and p.created_by = auth.uid()
      and coalesce(p.archived, false) = false
  )
);

create or replace function public.set_pool_password(p_pool_id uuid, p_plain text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if not exists (
    select 1
    from public.pools p
    where p.id = p_pool_id
      and p.created_by = auth.uid()
      and coalesce(p.archived, false) = false
  ) then
    raise exception 'not authorized';
  end if;

  v_hash := extensions.crypt(p_plain, extensions.gen_salt('bf', 8));

  update public.pools
  set
    join_password_hash = v_hash,
    password_hash = v_hash,
    private_password_hash = v_hash
  where id = p_pool_id;
end;
$function$;

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
  max_members integer
)
language sql
security definer
set search_path to 'public'
as $function$
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
    p.notes,
    p.created_by,
    p.created_at,
    coalesce(p.activation_status, 'draft')::text as activation_status,
    p.max_members
  from public.pools p
  where
    coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'draft') <> 'cancelled'
    and (
      p_term is null
      or btrim(p_term) = ''
      or p.name ilike ('%' || btrim(p_term) || '%')
    )
  order by p.created_at desc
  limit 50;
$function$;

update public.pools
set join_password_hash = coalesce(join_password_hash, password_hash, private_password_hash)
where is_public = false
  and join_password_hash is null
  and coalesce(password_hash, private_password_hash) is not null;

commit;
