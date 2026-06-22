begin;

-- Private leagues still require their password to join, but they should be
-- findable when commissioners want testers or invited players to search by name.
update public.pools
set allow_discovery = true
where coalesce(archived, false) = false
  and coalesce(activation_status, 'draft') = 'active'
  and is_public = false;

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
  created_at timestamptz
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
    p.created_at
  from public.pools p
  where
    coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'draft') = 'active'
    and p.allow_discovery = true
    and (
      p_term is null
      or btrim(p_term) = ''
      or p.name ilike ('%' || btrim(p_term) || '%')
    )
  order by p.created_at desc
  limit 50;
$function$;

commit;
