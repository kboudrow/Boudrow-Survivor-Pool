create or replace function public.superadmin_pool_overview()
returns table (
  pool_id uuid,
  name text,
  created_by uuid,
  owner_email text,
  is_public boolean,
  archived boolean,
  activation_status text,
  lifecycle_phase text,
  lifecycle_label text,
  payment_status text,
  season integer,
  start_week integer,
  max_members integer,
  allow_multiple_entries boolean,
  max_entries_per_user integer,
  entries_count integer,
  unique_members_count integer,
  draft_picks_count integer,
  final_picks_count integer,
  stats_rows_count integer,
  created_at timestamptz,
  test_mode boolean,
  test_current_week integer,
  test_now_at timestamptz
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
    p.id as pool_id,
    p.name::text,
    p.created_by,
    pp.email::text as owner_email,
    p.is_public,
    coalesce(p.archived, false) as archived,
    coalesce(p.activation_status, 'draft')::text as activation_status,
    lifecycle.phase::text as lifecycle_phase,
    lifecycle.label::text as lifecycle_label,
    coalesce(p.payment_status, 'not_required')::text as payment_status,
    coalesce(p.season, extract(year from now())::integer) as season,
    p.start_week,
    p.max_members,
    coalesce(p.allow_multiple_entries, false) as allow_multiple_entries,
    coalesce(p.max_entries_per_user, 1) as max_entries_per_user,
    coalesce(pm.entries_count, 0)::integer as entries_count,
    coalesce(pm.unique_members_count, 0)::integer as unique_members_count,
    coalesce(d.draft_picks_count, 0)::integer as draft_picks_count,
    coalesce(fp.final_picks_count, 0)::integer as final_picks_count,
    coalesce(s.stats_rows_count, 0)::integer as stats_rows_count,
    p.created_at,
    coalesce(p.test_mode, false) as test_mode,
    p.test_current_week,
    p.test_now_at
  from public.pools p
  cross join lateral public.pool_lifecycle_status(p.id) lifecycle
  left join public.profiles_private pp on pp.id = p.created_by
  left join (
    select members.pool_id, count(*) as entries_count, count(distinct members.profile_id) as unique_members_count
    from public.pool_members members
    group by members.pool_id
  ) pm on pm.pool_id = p.id
  left join (
    select drafts.pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts drafts
    group by drafts.pool_id
  ) d on d.pool_id = p.id
  left join (
    select picks.pool_id, count(*) as final_picks_count
    from public.pool_picks picks
    group by picks.pool_id
  ) fp on fp.pool_id = p.id
  left join (
    select stats.pool_id, count(*) as stats_rows_count
    from public.pool_member_stats stats
    group by stats.pool_id
  ) s on s.pool_id = p.id
  order by p.created_at desc nulls last, p.name;
end;
$function$;

revoke execute on function public.superadmin_pool_overview() from public, anon;
grant execute on function public.superadmin_pool_overview() to authenticated, service_role;
