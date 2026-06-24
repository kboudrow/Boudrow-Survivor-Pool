begin;

-- 2026 beta: leagues are free and immediately joinable.
alter table public.pools
  alter column activation_status set default 'active',
  alter column payment_status set default 'not_required';

update public.pools
set
  activation_status = case when activation_status = 'cancelled' then activation_status else 'active' end,
  payment_status = case when payment_status = 'refunded' then payment_status else 'not_required' end
where coalesce(archived, false) = false;

create or replace function public.count_pool_members(p_pool_id uuid)
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  select count(distinct pm.profile_id)::integer
  from public.pool_members pm
  where pm.pool_id = p_pool_id;
$function$;

grant execute on function public.count_pool_members(uuid) to anon, authenticated, service_role;

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
    coalesce(p.activation_status, 'active')::text as activation_status,
    p.max_members,
    (
      select count(distinct pm.profile_id)::integer
      from public.pool_members pm
      where pm.pool_id = p.id
    ) as member_count
  from public.pools p
  where
    coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
    and (
      p_term is null
      or btrim(p_term) = ''
      or p.name ilike ('%' || btrim(p_term) || '%')
    )
  order by p.created_at desc
  limit 50;
$function$;

grant execute on function public.search_pools(text) to anon, authenticated, service_role;

commit;
