begin;

-- Private leagues still require their password to join, but every non-archived
-- league should be findable by name whether or not it has been paid for.
update public.pools
set allow_discovery = true
where coalesce(archived, false) = false;

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

grant execute on function public.search_pools(text) to anon, authenticated;

commit;
