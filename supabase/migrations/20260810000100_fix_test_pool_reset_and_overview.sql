create or replace function public.superadmin_reset_test_pool(
  p_pool_id uuid
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_clock timestamptz;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  select coalesce(p.start_week, 1)
    into v_start_week
  from public.pools p
  where p.id = p_pool_id;

  delete from public.pool_pick_drafts d where d.pool_id = p_pool_id;
  delete from public.pool_picks p where p.pool_id = p_pool_id;
  delete from public.pool_member_stats s where s.pool_id = p_pool_id;
  delete from public.test_pool_team_results r where r.pool_id = p_pool_id;

  update public.pool_members pm
     set status = 'alive',
         eliminated_week = null,
         lives_remaining = null
   where pm.pool_id = p_pool_id;

  perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  v_clock := public.pool_test_clock_at(p_pool_id, v_start_week, 'before_week');

  update public.pools p
     set test_current_week = v_start_week,
         test_now_at = v_clock,
         winner_user_id = null
   where p.id = p_pool_id;

  return 'Test pool reset to Week ' || v_start_week || '. Members and settings were kept; entry status, picks, fake outcomes, stats, and winner were reset.';
end;
$function$;

drop function if exists public.superadmin_pool_overview();
create function public.superadmin_pool_overview()
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
    p.id,
    p.name::text,
    p.created_by,
    private_profile.email::text,
    p.is_public,
    coalesce(p.archived, false),
    coalesce(p.activation_status, 'active')::text,
    coalesce(p.payment_status, 'not_required')::text,
    coalesce(p.season, extract(year from now())::integer),
    p.start_week,
    p.max_members,
    coalesce(p.allow_multiple_entries, false),
    coalesce(p.max_entries_per_user, 1),
    coalesce(member_totals.entries_count, 0)::integer,
    coalesce(member_totals.unique_members_count, 0)::integer,
    coalesce(draft_totals.draft_picks_count, 0)::integer,
    coalesce(final_totals.final_picks_count, 0)::integer,
    coalesce(stat_totals.stats_rows_count, 0)::integer,
    p.created_at,
    coalesce(p.test_mode, false),
    p.test_current_week,
    p.test_now_at
  from public.pools p
  left join public.profiles_private private_profile on private_profile.id = p.created_by
  left join (
    select members.pool_id as grouped_pool_id,
           count(*) as entries_count,
           count(distinct members.profile_id) as unique_members_count
    from public.pool_members members
    group by members.pool_id
  ) member_totals on member_totals.grouped_pool_id = p.id
  left join (
    select drafts.pool_id as grouped_pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts drafts
    group by drafts.pool_id
  ) draft_totals on draft_totals.grouped_pool_id = p.id
  left join (
    select picks.pool_id as grouped_pool_id, count(*) as final_picks_count
    from public.pool_picks picks
    group by picks.pool_id
  ) final_totals on final_totals.grouped_pool_id = p.id
  left join (
    select stats.pool_id as grouped_pool_id, count(*) as stats_rows_count
    from public.pool_member_stats stats
    group by stats.pool_id
  ) stat_totals on stat_totals.grouped_pool_id = p.id
  order by p.created_at desc nulls last, p.name;
end;
$function$;

revoke execute on function public.superadmin_reset_test_pool(uuid) from public, anon;
grant execute on function public.superadmin_reset_test_pool(uuid) to authenticated;
revoke execute on function public.superadmin_pool_overview() from public, anon;
grant execute on function public.superadmin_pool_overview() to authenticated, service_role;
