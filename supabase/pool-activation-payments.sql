-- Add paid activation foundations for pools.

begin;

alter table public.pools
  add column if not exists activation_status text not null default 'active',
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references auth.users(id),
  add column if not exists max_members integer not null default 25,
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text;

update public.pools
set
  activation_status = coalesce(nullif(activation_status, ''), 'active'),
  activated_at = coalesce(activated_at, created_at, now()),
  activated_by = coalesce(activated_by, created_by),
  max_members = coalesce(max_members, 25),
  payment_status = coalesce(nullif(payment_status, ''), 'not_required')
where activation_status is null
   or activated_at is null
   or activated_by is null
   or max_members is null
   or payment_status is null;

alter table public.pools
  alter column activation_status set default 'draft',
  alter column payment_status set default 'unpaid',
  alter column max_members set default 25;

alter table public.pools
  drop constraint if exists pools_activation_status_check,
  add constraint pools_activation_status_check
    check (activation_status in ('draft', 'active', 'cancelled')),
  drop constraint if exists pools_payment_status_check,
  add constraint pools_payment_status_check
    check (payment_status in ('unpaid', 'paid', 'not_required', 'waived', 'refunded')),
  drop constraint if exists pools_max_members_check,
  add constraint pools_max_members_check
    check (max_members between 2 and 500);

create or replace function public.join_pool(p_pool_id uuid, p_password text default null, p_token text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_member_count integer;
  v_is_owner boolean;
  v_password_hash text;
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

  if exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    return;
  end if;

  select count(*)
  into v_member_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id;

  if not v_is_owner and v_member_count >= coalesce(v_pool.max_members, 25) then
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

  insert into public.pool_members (pool_id, profile_id, role, status)
  values (
    p_pool_id,
    auth.uid(),
    case when v_is_owner then 'admin'::public.member_role else 'member'::public.member_role end,
    'alive'
  );
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

commit;
