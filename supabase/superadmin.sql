-- Platform-level superadmin tools.
-- Access is restricted in the database to one authenticated email.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'survivesunday1@gmail.com';
$function$;

create or replace function public.admin_can_manage(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    public.is_super_admin()
    or exists (
      select 1
      from public.pools p
      where p.id = p_pool_id
        and p.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.pool_members pm
      where pm.pool_id = p_pool_id
        and pm.profile_id = auth.uid()
        and pm.role::text = 'admin'
    );
$function$;

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
    pr.email::text as owner_email,
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
  left join public.profiles pr on pr.id = p.created_by
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
    pr.email::text,
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

drop function if exists public.superadmin_repair_future_2026_results();

create or replace function public.superadmin_repair_pool_future_results(p_pool_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  deleted_stats integer := 0;
  restored_picks integer := 0;
  deleted_finals integer := 0;
  v_pool public.pools%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found then
    raise exception 'League not found.';
  end if;

  delete from public.pool_member_stats s
  where s.pool_id = p_pool_id;
  get diagnostics deleted_stats = row_count;

  with future_picks as (
    select distinct
      pp.pool_id,
      pp.user_id,
      pp.entry_id,
      pp.week,
      pp.slot,
      pp.team_abbr
    from public.pool_picks pp
    join public.nfl_games g
      on g.season = coalesce(v_pool.season, extract(year from now())::integer)
     and g.week = pp.week
     and pp.team_abbr in (g.home_team, g.away_team)
    where pp.pool_id = p_pool_id
      and coalesce(g.kickoff_at_utc, g.game_time) > now()
  ),
  restored as (
    insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
    select fp.pool_id, fp.user_id, fp.entry_id, fp.week, fp.slot, fp.team_abbr, now()
    from future_picks fp
    on conflict (pool_id, entry_id, week, slot) do update
      set team_abbr = excluded.team_abbr,
          user_id = excluded.user_id,
          updated_at = now()
    returning pool_id, entry_id, week, slot
  ),
  deleted as (
    delete from public.pool_picks pp
    using restored r
    where pp.pool_id = r.pool_id
      and pp.entry_id = r.entry_id
      and pp.week = r.week
      and pp.slot = r.slot
    returning 1
  )
  select
    (select count(*) from restored)::integer,
    (select count(*) from deleted)::integer
  into restored_picks, deleted_finals;

  return format(
    'Repaired %s. Cleared stat rows: %s. Restored future draft picks: %s. Removed future final picks: %s.',
    v_pool.name,
    deleted_stats,
    restored_picks,
    deleted_finals
  );
end;
$function$;
