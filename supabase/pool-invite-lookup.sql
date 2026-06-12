-- Safe pool summary lookup for invite links.
--
-- Invite pages need to render a sign-in/create-account prompt before a visitor
-- has a session. Direct table reads can be blocked by RLS, especially for
-- private pools, so expose only the fields needed to display the join screen.

drop function if exists public.get_pool_invite(uuid);

create or replace function public.get_pool_invite(p_pool_id uuid)
returns table (
  id uuid,
  name text,
  is_public boolean,
  start_week integer,
  include_playoffs boolean,
  strikes_allowed integer,
  tie_rule text,
  deadline_mode text,
  deadline_fixed text,
  notes text,
  created_by uuid,
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
    p.start_week,
    p.include_playoffs,
    p.strikes_allowed::integer,
    p.tie_rule::text,
    p.deadline_mode::text,
    p.deadline_fixed,
    p.notes,
    p.created_by,
    p.activation_status::text,
    p.max_members,
    (
      select count(*)::integer
      from public.pool_members pm
      where pm.pool_id = p.id
    ) as member_count
  from public.pools p
  where p.id = p_pool_id
    and coalesce(p.archived, false) = false
  limit 1;
$function$;
