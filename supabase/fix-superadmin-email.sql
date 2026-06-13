-- Fix superadmin overview/entries to read email from profiles_private.

create or replace function public.superadmin_pool_overview()
returns table (
  pool_id uuid,
  name text,
  created_by uuid,
  owner_email text,
  is_public boolean,
  archived boolean,
  activation_status text,
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
  created_at timestamptz
)
language plpgsql
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
    coalesce(p.payment_status, 'unpaid')::text as payment_status,
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
    p.created_at
  from public.pools p
  left join public.profiles_private pp on pp.id = p.created_by
  left join (
    select
      pm_counts.pool_id,
      count(*) as entries_count,
      count(distinct pm_counts.profile_id) as unique_members_count
    from public.pool_members pm_counts
    group by pm_counts.pool_id
  ) pm on pm.pool_id = p.id
  left join (
    select d_counts.pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts d_counts
    group by d_counts.pool_id
  ) d on d.pool_id = p.id
  left join (
    select fp_counts.pool_id, count(*) as final_picks_count
    from public.pool_picks fp_counts
    group by fp_counts.pool_id
  ) fp on fp.pool_id = p.id
  left join (
    select s_counts.pool_id, count(*) as stats_rows_count
    from public.pool_member_stats s_counts
    group by s_counts.pool_id
  ) s on s.pool_id = p.id
  order by p.created_at desc nulls last;
end;
$function$;

create or replace function public.superadmin_pool_entries(p_pool_id uuid)
returns table (
  entry_id uuid,
  profile_id uuid,
  email text,
  display_name text,
  entry_number integer,
  role text,
  status text,
  joined_at timestamptz,
  draft_picks_count integer,
  final_picks_count integer,
  wins integer,
  losses integer,
  pushes integer,
  strikes_used integer,
  eliminated boolean,
  eliminated_week integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    pm.id as entry_id,
    pm.profile_id,
    pp.email::text,
    coalesce(
      nullif(pr.display_name::text, ''),
      nullif(pr.username::text, ''),
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Player ' || left(pm.profile_id::text, 8)
    )::text as display_name,
    coalesce(pm.entry_number, 1) as entry_number,
    pm.role::text as role,
    pm.status::text as status,
    pm.joined_at,
    coalesce(d.draft_picks_count, 0)::integer as draft_picks_count,
    coalesce(fp.final_picks_count, 0)::integer as final_picks_count,
    coalesce(s.wins, 0) as wins,
    coalesce(s.losses, 0) as losses,
    coalesce(s.pushes, 0) as pushes,
    coalesce(s.strikes_used, 0) as strikes_used,
    coalesce(s.eliminated, false) as eliminated,
    s.eliminated_week
  from public.pool_members pm
  left join public.profiles pr on pr.id = pm.profile_id
  left join public.profiles_private pp on pp.id = pm.profile_id
  left join (
    select d_counts.pool_id, d_counts.entry_id, count(*) as draft_picks_count
    from public.pool_pick_drafts d_counts
    group by d_counts.pool_id, d_counts.entry_id
  ) d on d.pool_id = pm.pool_id and d.entry_id = pm.id
  left join (
    select fp_counts.pool_id, fp_counts.entry_id, count(*) as final_picks_count
    from public.pool_picks fp_counts
    group by fp_counts.pool_id, fp_counts.entry_id
  ) fp on fp.pool_id = pm.pool_id and fp.entry_id = pm.id
  left join public.pool_member_stats s
    on s.pool_id = pm.pool_id
   and s.entry_id = pm.id
  where pm.pool_id = p_pool_id
  order by display_name, pm.entry_number;
end;
$function$;
