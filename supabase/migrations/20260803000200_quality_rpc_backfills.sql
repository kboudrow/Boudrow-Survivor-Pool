begin;

create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select nullif(regexp_replace(btrim(coalesce(p_username, '')), '\s+', ' ', 'g'), '');
$function$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'profiles_username_normalized_unique'
  ) and not exists (
    select 1
    from (
      select lower(public.normalize_username(username)) as normalized_username
      from public.profiles
      where public.normalize_username(username) is not null
      group by lower(public.normalize_username(username))
      having count(*) > 1
    ) duplicates
  ) then
    execute 'create unique index profiles_username_normalized_unique on public.profiles (lower(public.normalize_username(username))) where public.normalize_username(username) is not null';
  end if;
end $$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.normalize_username(p_username) is not null
    and not exists (
      select 1
      from public.profiles p
      where lower(public.normalize_username(p.username)) = lower(public.normalize_username(p_username))
    );
$function$;

create or replace function public.is_blog_superadmin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'survivesunday1@gmail.com'
  );
$function$;

create or replace function public.current_blog_role()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role text := '';
begin
  if auth.uid() is null then
    return '';
  end if;

  if public.is_blog_superadmin() then
    return 'admin';
  end if;

  select bp.role
    into v_role
  from public.blog_permissions bp
  where bp.profile_id = auth.uid()
    and bp.role in ('contributor', 'editor', 'admin')
  order by case bp.role when 'admin' then 1 when 'editor' then 2 else 3 end
  limit 1;

  return coalesce(v_role, '');
end;
$function$;

create or replace function public.can_manage_blog()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.current_blog_role() in ('admin', 'editor', 'contributor');
$function$;

create or replace function public.grant_blog_permission(
  p_email text,
  p_role text default 'contributor'
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, 'contributor')));
  v_user_id uuid;
  v_label text;
begin
  if not public.is_blog_superadmin() then
    raise exception 'Only the Survive Sunday superadmin can add blog contributors.';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;

  if v_role not in ('contributor', 'editor', 'admin') then
    v_role := 'contributor';
  end if;

  select u.id
    into v_user_id
  from auth.users u
  where lower(coalesce(u.email, '')) = v_email
  limit 1;

  if v_user_id is null then
    raise exception 'That user needs to create an account before you can add blog access.';
  end if;

  v_label := 'Player ' || left(v_user_id::text, 8);

  insert into public.profiles (id, "User_name", username, display_name, created_at, updated_at)
  values (v_user_id, v_label, v_label, v_label, now(), now())
  on conflict (id) do nothing;

  insert into public.blog_permissions (profile_id, role, created_at, updated_at)
  values (v_user_id, v_role, now(), now())
  on conflict (profile_id) do update
    set role = excluded.role,
        updated_at = now();

  return 'Blog access saved for ' || v_email || '.';
end;
$function$;

create or replace function public.blog_permission_overview()
returns table (
  profile_id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    bp.profile_id,
    u.email::text,
    coalesce(nullif(pr.username, ''), nullif(pr.display_name, ''), 'Player ' || left(bp.profile_id::text, 8))::text as display_name,
    bp.role::text,
    bp.created_at
  from public.blog_permissions bp
  left join auth.users u
    on u.id = bp.profile_id
  left join public.profiles pr
    on pr.id = bp.profile_id
  where public.is_blog_superadmin()
  order by bp.created_at desc;
$function$;

drop function if exists public.blog_comments_for_post(text);
create function public.blog_comments_for_post(p_post_slug text)
returns table (
  id uuid,
  post_slug text,
  profile_id uuid,
  parent_comment_id uuid,
  author_name text,
  avatar_url text,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  up_count bigint,
  down_count bigint,
  viewer_reaction text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with visible_comments as (
    select bc.*
    from public.blog_comments bc
    where lower(bc.post_slug) = lower(btrim(coalesce(p_post_slug, '')))
      and bc.deleted_at is null
  ),
  reaction_counts as (
    select
      bcr.comment_id,
      count(*) filter (where bcr.reaction = 'up')::integer as up_count,
      count(*) filter (where bcr.reaction = 'down')::integer as down_count
    from public.blog_comment_reactions bcr
    join visible_comments vc
      on vc.id = bcr.comment_id
    group by bcr.comment_id
  ),
  viewer_reactions as (
    select bcr.comment_id, bcr.reaction::text
    from public.blog_comment_reactions bcr
    where bcr.profile_id = auth.uid()
  )
  select
    vc.id,
    vc.post_slug,
    vc.profile_id,
    vc.parent_comment_id,
    coalesce(nullif(pr.username, ''), nullif(pr.display_name, ''), 'Player ' || left(vc.profile_id::text, 8))::text as author_name,
    pr.avatar_url::text,
    vc.body,
    vc.created_at,
    vc.updated_at,
    coalesce(rc.up_count, 0) as up_count,
    coalesce(rc.down_count, 0) as down_count,
    vr.reaction as viewer_reaction
  from visible_comments vc
  left join public.profiles pr
    on pr.id = vc.profile_id
  left join reaction_counts rc
    on rc.comment_id = vc.id
  left join viewer_reactions vr
    on vr.comment_id = vc.id
  order by
    coalesce(rc.up_count, 0) + coalesce(rc.down_count, 0) desc,
    coalesce(rc.up_count, 0) desc,
    vc.created_at asc;
$function$;

create or replace function public.blog_engagement_for_posts(p_post_slugs text[])
returns table (
  post_slug text,
  comment_count bigint,
  up_count bigint,
  down_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with slugs as (
    select distinct lower(btrim(slug)) as post_slug
    from unnest(coalesce(p_post_slugs, '{}'::text[])) as slug
    where nullif(btrim(slug), '') is not null
  )
  select
    s.post_slug,
    (
      select count(*)
      from public.blog_comments bc
      where lower(bc.post_slug) = s.post_slug
        and bc.deleted_at is null
    ) as comment_count,
    (
      select count(*)
      from public.blog_comment_reactions bcr
      join public.blog_comments bc
        on bc.id = bcr.comment_id
      where lower(bc.post_slug) = s.post_slug
        and bc.deleted_at is null
        and bcr.reaction = 'up'
    ) as up_count,
    (
      select count(*)
      from public.blog_comment_reactions bcr
      join public.blog_comments bc
        on bc.id = bcr.comment_id
      where lower(bc.post_slug) = s.post_slug
        and bc.deleted_at is null
        and bcr.reaction = 'down'
    ) as down_count
  from slugs s
  order by s.post_slug;
$function$;

create or replace function public.blog_comment_moderation_queue()
returns table (
  id uuid,
  post_slug text,
  profile_id uuid,
  parent_comment_id uuid,
  author_name text,
  avatar_url text,
  body text,
  created_at timestamptz,
  up_count bigint,
  down_count bigint,
  report_count bigint,
  latest_report_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with reaction_counts as (
    select
      bcr.comment_id,
      count(*) filter (where bcr.reaction = 'up')::integer as up_count,
      count(*) filter (where bcr.reaction = 'down')::integer as down_count
    from public.blog_comment_reactions bcr
    group by bcr.comment_id
  ),
  report_counts as (
    select
      bcr.comment_id,
      count(*)::integer as report_count,
      max(bcr.created_at) as latest_report_at
    from public.blog_comment_reports bcr
    group by bcr.comment_id
  )
  select
    bc.id,
    bc.post_slug,
    bc.profile_id,
    bc.parent_comment_id,
    coalesce(nullif(pr.username, ''), nullif(pr.display_name, ''), 'Player ' || left(bc.profile_id::text, 8))::text as author_name,
    pr.avatar_url::text,
    bc.body,
    bc.created_at,
    coalesce(rc.up_count, 0) as up_count,
    coalesce(rc.down_count, 0) as down_count,
    coalesce(rep.report_count, 0) as report_count,
    rep.latest_report_at
  from public.blog_comments bc
  left join public.profiles pr
    on pr.id = bc.profile_id
  left join reaction_counts rc
    on rc.comment_id = bc.id
  left join report_counts rep
    on rep.comment_id = bc.id
  where bc.deleted_at is null
    and public.is_blog_superadmin()
  order by coalesce(rep.report_count, 0) desc, rep.latest_report_at desc nulls last, bc.created_at desc
  limit 250;
$function$;

create or replace function public.blog_delete_comment(p_comment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_blog_superadmin() then
    raise exception 'Only the Survive Sunday superadmin can delete comments.';
  end if;

  update public.blog_comments
  set deleted_at = now(),
      updated_at = now()
  where id = p_comment_id
    and deleted_at is null;

  if not found then
    return 'Comment was already deleted or was not found.';
  end if;

  return 'Comment deleted.';
end;
$function$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and lower(coalesce(u.email, '')) = 'survivesunday1@gmail.com'
  );
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

create or replace function public.count_pool_members(p_pool_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(distinct pm.profile_id)::integer
  from public.pool_members pm
  where pm.pool_id = p_pool_id;
$function$;

drop function if exists public.pool_member_summaries(uuid[]);
create function public.pool_member_summaries(p_pool_ids uuid[])
returns table (
  pool_id uuid,
  total_members integer,
  alive_members integer,
  total_entries integer,
  alive_entries integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with requested as (
    select distinct unnest(coalesce(p_pool_ids, array[]::uuid[])) as pool_id
  ),
  allowed as (
    select r.pool_id
    from requested r
    where public.admin_can_manage(r.pool_id)
       or exists (
         select 1
         from public.pool_members mine
         where mine.pool_id = r.pool_id
           and mine.profile_id = auth.uid()
       )
  ),
  member_rows as (
    select
      pm.pool_id,
      pm.id as entry_id,
      pm.profile_id,
      lower(coalesce(nullif(pm.status::text, ''), 'alive')) as member_status
    from public.pool_members pm
    join allowed a
      on a.pool_id = pm.pool_id
  ),
  entry_status as (
    select
      mr.pool_id,
      mr.entry_id,
      mr.profile_id,
      case
        when s.entry_id is not null then coalesce(s.eliminated, false)
        else mr.member_status not in ('active', 'alive')
      end as eliminated
    from member_rows mr
    left join public.pool_member_stats s
      on s.pool_id = mr.pool_id
     and s.entry_id = mr.entry_id
  ),
  member_status as (
    select
      pool_id,
      profile_id,
      bool_or(not eliminated) as has_alive_entry
    from entry_status
    group by pool_id, profile_id
  )
  select
    a.pool_id,
    coalesce(count(distinct ms.profile_id), 0)::integer as total_members,
    coalesce(count(distinct ms.profile_id) filter (where ms.has_alive_entry), 0)::integer as alive_members,
    coalesce(count(distinct es.entry_id), 0)::integer as total_entries,
    coalesce(count(distinct es.entry_id) filter (where not es.eliminated), 0)::integer as alive_entries
  from allowed a
  left join member_status ms
    on ms.pool_id = a.pool_id
  left join entry_status es
    on es.pool_id = a.pool_id
  group by a.pool_id;
$function$;

drop function if exists public.pool_entry_roster(uuid);
create function public.pool_entry_roster(p_pool_id uuid)
returns table (
  entry_id uuid,
  profile_id uuid,
  entry_number integer,
  entry_name text,
  display_name text,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view this pool.';
  end if;

  if not public.admin_can_manage(p_pool_id)
    and not exists (
      select 1
      from public.pool_members pm
      where pm.pool_id = p_pool_id
        and pm.profile_id = auth.uid()
    ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pm.id as entry_id,
    pm.profile_id,
    coalesce(pm.entry_number, 1)::integer as entry_number,
    pm.entry_name::text as entry_name,
    coalesce(
      nullif(pr.username::text, ''),
      nullif(pr.display_name::text, ''),
      'Player ' || left(pm.profile_id::text, 8)
    )::text as display_name,
    pr.username::text,
    pr.first_name::text,
    pr.last_name::text,
    pr.avatar_url::text,
    pm.role::text,
    pm.status::text,
    pm.joined_at
  from public.pool_members pm
  left join public.profiles pr
    on pr.id = pm.profile_id
  where pm.pool_id = p_pool_id
  order by lower(
    coalesce(nullif(pr.username::text, ''), nullif(pr.display_name::text, ''), 'Player ' || left(pm.profile_id::text, 8))
  ), coalesce(pm.entry_number, 1), pm.id;
end;
$function$;

drop function if exists public.admin_pool_entry_week_overview(uuid, integer);
create function public.admin_pool_entry_week_overview(p_pool_id uuid, p_week integer)
returns table (
  entry_id uuid,
  user_id uuid,
  entry_number integer,
  entry_name text,
  display_name text,
  role text,
  joined_at timestamptz,
  slot integer,
  draft_team_abbr text,
  draft_updated_at timestamptz,
  final_team_abbr text,
  locked_at timestamptz,
  result text,
  wins integer,
  losses integer,
  pushes integer,
  strikes_used integer,
  eliminated boolean,
  eliminated_week integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  with slots as (
    select generate_series(1, greatest(1, public.picks_allowed(p_pool_id, p_week)))::integer as slot
  )
  select
    pm.id as entry_id,
    pm.profile_id as user_id,
    coalesce(pm.entry_number, 1)::integer as entry_number,
    pm.entry_name::text as entry_name,
    coalesce(
      nullif(pr.username::text, ''),
      nullif(pr.display_name::text, ''),
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Player ' || left(pm.profile_id::text, 8)
    )::text as display_name,
    pm.role::text as role,
    pm.joined_at,
    slots.slot,
    d.team_abbr::text as draft_team_abbr,
    d.updated_at as draft_updated_at,
    fp.team_abbr::text as final_team_abbr,
    fp.locked_at,
    fp.result::text,
    coalesce(s.wins, 0)::integer as wins,
    coalesce(s.losses, 0)::integer as losses,
    coalesce(s.pushes, 0)::integer as pushes,
    coalesce(s.strikes_used, 0)::integer as strikes_used,
    coalesce(s.eliminated, lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive'))::boolean as eliminated,
    s.eliminated_week
  from public.pool_members pm
  cross join slots
  left join public.profiles pr
    on pr.id = pm.profile_id
  left join public.pool_pick_drafts d
    on d.pool_id = pm.pool_id
   and d.entry_id = pm.id
   and d.week = p_week
   and d.slot = slots.slot
  left join public.pool_picks fp
    on fp.pool_id = pm.pool_id
   and fp.entry_id = pm.id
   and fp.week = p_week
   and fp.slot = slots.slot
  left join public.pool_member_stats s
    on s.pool_id = pm.pool_id
   and s.entry_id = pm.id
  where pm.pool_id = p_pool_id
  order by lower(
    coalesce(nullif(pr.username::text, ''), nullif(pr.display_name::text, ''), 'Player ' || left(pm.profile_id::text, 8))
  ), coalesce(pm.entry_number, 1), slots.slot;
end;
$function$;

create or replace function public.admin_update_pool_member_limit(
  p_pool_id uuid,
  p_max_members integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_first_start timestamptz;
  v_entry_count integer;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
    into v_first_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = coalesce(v_pool.start_week, 1)
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  if p_max_members is null or p_max_members < 2 or p_max_members > 500 then
    raise exception 'Member limit must be between 2 and 500.';
  end if;

  select count(*)::integer
    into v_entry_count
  from public.pool_members
  where pool_id = p_pool_id;

  if p_max_members < v_entry_count then
    raise exception 'Member limit cannot be lower than the current entry count (%).', v_entry_count;
  end if;

  update public.pools
  set max_members = p_max_members
  where id = p_pool_id;
end;
$function$;

create or replace function public.admin_set_double_weeks(
  p_pool_id uuid,
  p_weeks integer[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_first_start timestamptz;
  v_weeks integer[];
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
    into v_first_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = coalesce(v_pool.start_week, 1)
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  select coalesce(array_agg(distinct selected.week order by selected.week), '{}'::integer[])
    into v_weeks
  from unnest(coalesce(p_weeks, '{}'::integer[])) as selected(week)
  where selected.week between coalesce(v_pool.start_week, 1) and 18;

  update public.pools
  set double_pick_weeks = v_weeks
  where id = p_pool_id;
end;
$function$;

create or replace function public.admin_update_pool_entry_settings(
  p_pool_id uuid,
  p_allow_multiple_entries boolean,
  p_max_entries_per_user integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_first_start timestamptz;
  v_current_max_entries integer := 0;
  v_next_max integer := case when coalesce(p_allow_multiple_entries, false) then coalesce(p_max_entries_per_user, 1) else 1 end;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
    into v_first_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = coalesce(v_pool.start_week, 1)
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  if v_next_max < 1 or v_next_max > 10 then
    raise exception 'Entries per user must be between 1 and 10.';
  end if;

  select coalesce(max(entry_count), 0)::integer
    into v_current_max_entries
  from (
    select count(*) as entry_count
    from public.pool_members pm
    where pm.pool_id = p_pool_id
    group by pm.profile_id
  ) counts;

  if not coalesce(p_allow_multiple_entries, false) and v_current_max_entries > 1 then
    raise exception 'This pool already has members with multiple entries.';
  end if;

  if coalesce(p_allow_multiple_entries, false) and v_next_max < v_current_max_entries then
    raise exception 'Entry limit cannot be lower than the current highest entry count (%).', v_current_max_entries;
  end if;

  update public.pools
  set
    allow_multiple_entries = coalesce(p_allow_multiple_entries, false),
    max_entries_per_user = v_next_max
  where id = p_pool_id;
end;
$function$;

create or replace function public.admin_update_pool_visibility(
  p_pool_id uuid,
  p_is_public boolean,
  p_password text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_first_start timestamptz;
  v_hash text;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
    into v_first_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = coalesce(v_pool.start_week, 1)
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  if not coalesce(p_is_public, false) then
    if nullif(btrim(coalesce(p_password, '')), '') is null then
      raise exception 'Enter a pool password before switching this pool to private.';
    end if;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 8));
  end if;

  update public.pools
  set
    is_public = coalesce(p_is_public, false),
    visibility = case when coalesce(p_is_public, false) then 'public'::public.pool_visibility else 'private'::public.pool_visibility end,
    join_password_hash = case when v_hash is null then join_password_hash else v_hash end,
    password_hash = case when v_hash is null then password_hash else v_hash end,
    private_password_hash = case when v_hash is null then private_password_hash else v_hash end
  where id = p_pool_id;
end;
$function$;

create or replace function public.admin_archive_pool(
  p_pool_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_start_at timestamptz;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if p_archived then
    select min(coalesce(g.kickoff_at_utc, g.game_time))
      into v_start_at
    from public.nfl_games g
    where g.season = coalesce(v_pool.season, extract(year from now())::integer)
      and g.week = coalesce(v_pool.start_week, 1)
      and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

    if v_start_at is not null and now() >= v_start_at then
      raise exception 'Pools cannot be archived after the pool has started.';
    end if;
  end if;

  update public.pools
  set archived = coalesce(p_archived, false),
      archived_at = case when coalesce(p_archived, false) then now() else null end
  where id = p_pool_id;
end;
$function$;

create or replace function public.admin_clear_entry_week_draft_slot(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer default 1,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = coalesce(p_slot, 1);
end;
$function$;

create or replace function public.admin_upsert_entry_draft(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_slot integer default 1,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_team text := upper(btrim(coalesce(p_team_abbr, '')));
  v_slot integer := coalesce(p_slot, 1);
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  if v_team = '' then
    raise exception 'Choose a team before saving this pick.';
  end if;

  select pm.profile_id
    into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  if exists (
    select 1
    from public.pool_picks p
    where p.pool_id = p_pool_id
      and p.entry_id = p_entry_id
      and p.week = p_week
      and p.slot = v_slot
  ) then
    raise exception 'This pick is already final. Override the final pick instead.';
  end if;

  if not exists (
    select 1
    from public.pool_week_games(p_pool_id, p_week) g
    where v_team in (upper(g.home_team), upper(g.away_team))
  ) then
    raise exception 'That team is not scheduled for Week %.', p_week;
  end if;

  if exists (
    select 1
    from public.pool_picks p
    where p.pool_id = p_pool_id
      and p.entry_id = p_entry_id
      and upper(btrim(p.team_abbr)) = v_team
      and p.team_abbr not like 'NO_PICK%'
  ) or exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.entry_id = p_entry_id
      and upper(btrim(d.team_abbr)) = v_team
      and d.team_abbr not like 'NO_PICK%'
      and not (d.week = p_week and d.slot = v_slot)
  ) then
    raise exception 'This entry has already used %.', v_team;
  end if;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, v_slot, v_team, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        updated_at = now();
end;
$function$;

create or replace function public.admin_override_entry_final_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_reason text default null,
  p_slot integer default 1
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_team text := upper(btrim(coalesce(p_team_abbr, '')));
  v_slot integer := coalesce(p_slot, 1);
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  if v_team = '' then
    raise exception 'Choose a team before saving this pick.';
  end if;

  select pm.profile_id
    into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  if not exists (
    select 1
    from public.pool_week_games(p_pool_id, p_week) g
    where v_team in (upper(g.home_team), upper(g.away_team))
  ) then
    raise exception 'That team is not scheduled for Week %.', p_week;
  end if;

  if exists (
    select 1
    from public.pool_picks p
    where p.pool_id = p_pool_id
      and p.entry_id = p_entry_id
      and upper(btrim(p.team_abbr)) = v_team
      and p.team_abbr not like 'NO_PICK%'
      and not (p.week = p_week and p.slot = v_slot)
  ) or exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.entry_id = p_entry_id
      and upper(btrim(d.team_abbr)) = v_team
      and d.team_abbr not like 'NO_PICK%'
      and not (d.week = p_week and d.slot = v_slot)
  ) then
    raise exception 'This entry has already used %.', v_team;
  end if;

  insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, v_slot, v_team, now(), null, null, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        locked_at = now(),
        result = null,
        adjudicated_at = null;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;

  perform public.rebuild_pool_member_stats(p_pool_id);
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
  test_current_week integer
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
    coalesce(p.activation_status, 'active')::text as activation_status,
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
    p.test_current_week
  from public.pools p
  left join public.profiles_private pp
    on pp.id = p.created_by
  left join (
    select
      pm_counts.pool_id,
      count(*) as entries_count,
      count(distinct pm_counts.profile_id) as unique_members_count
    from public.pool_members pm_counts
    group by pm_counts.pool_id
  ) pm
    on pm.pool_id = p.id
  left join (
    select d_counts.pool_id, count(*) as draft_picks_count
    from public.pool_pick_drafts d_counts
    group by d_counts.pool_id
  ) d
    on d.pool_id = p.id
  left join (
    select fp_counts.pool_id, count(*) as final_picks_count
    from public.pool_picks fp_counts
    group by fp_counts.pool_id
  ) fp
    on fp.pool_id = p.id
  left join (
    select s_counts.pool_id, count(*) as stats_rows_count
    from public.pool_member_stats s_counts
    group by s_counts.pool_id
  ) s
    on s.pool_id = p.id
  order by p.created_at desc nulls last;
end;
$function$;

drop function if exists public.superadmin_pool_entries(uuid);
create function public.superadmin_pool_entries(p_pool_id uuid)
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
    pm.id as entry_id,
    pm.profile_id,
    pp.email::text,
    coalesce(
      nullif(pr.username::text, ''),
      nullif(pr.display_name::text, ''),
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Player ' || left(pm.profile_id::text, 8)
    )::text as display_name,
    coalesce(pm.entry_number, 1)::integer as entry_number,
    pm.role::text as role,
    pm.status::text as status,
    pm.joined_at,
    coalesce(d.draft_picks_count, 0)::integer as draft_picks_count,
    coalesce(fp.final_picks_count, 0)::integer as final_picks_count,
    coalesce(s.wins, 0)::integer as wins,
    coalesce(s.losses, 0)::integer as losses,
    coalesce(s.pushes, 0)::integer as pushes,
    coalesce(s.strikes_used, 0)::integer as strikes_used,
    coalesce(s.eliminated, lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive'))::boolean as eliminated,
    s.eliminated_week
  from public.pool_members pm
  left join public.profiles pr
    on pr.id = pm.profile_id
  left join public.profiles_private pp
    on pp.id = pm.profile_id
  left join (
    select d_counts.pool_id, d_counts.entry_id, count(*) as draft_picks_count
    from public.pool_pick_drafts d_counts
    group by d_counts.pool_id, d_counts.entry_id
  ) d
    on d.pool_id = pm.pool_id
   and d.entry_id = pm.id
  left join (
    select fp_counts.pool_id, fp_counts.entry_id, count(*) as final_picks_count
    from public.pool_picks fp_counts
    group by fp_counts.pool_id, fp_counts.entry_id
  ) fp
    on fp.pool_id = pm.pool_id
   and fp.entry_id = pm.id
  left join public.pool_member_stats s
    on s.pool_id = pm.pool_id
   and s.entry_id = pm.id
  where pm.pool_id = p_pool_id
  order by lower(
    coalesce(nullif(pr.username::text, ''), nullif(pr.display_name::text, ''), 'Player ' || left(pm.profile_id::text, 8))
  ), coalesce(pm.entry_number, 1);
end;
$function$;

drop function if exists public.superadmin_repair_pool_future_results(uuid);
create function public.superadmin_repair_pool_future_results(p_pool_id uuid)
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
    raise exception 'Pool not found.';
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

  perform public.rebuild_pool_member_stats(p_pool_id);

  return format(
    'Repaired %s. Cleared stat rows: %s. Restored future draft picks: %s. Removed future final picks: %s.',
    v_pool.name,
    deleted_stats,
    restored_picks,
    deleted_finals
  );
end;
$function$;

drop function if exists public.superadmin_schedule_integrity_audit(integer);
create function public.superadmin_schedule_integrity_audit(p_season integer default null)
returns table (
  season integer,
  week integer,
  game_count integer,
  duplicate_event_count integer,
  future_result_count integer,
  final_missing_winner_count integer,
  invalid_winner_count integer,
  duplicate_team_count integer,
  future_pick_result_count integer,
  team_appearance_count integer,
  issue_count integer
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
  with games as (
    select
      g.season,
      g.week,
      g.id,
      g.espn_event_id,
      g.home_team,
      g.away_team,
      g.status,
      g.winner,
      g.home_score,
      g.away_score,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at
    from public.nfl_games g
    where p_season is null or g.season = p_season
  ),
  week_counts as (
    select
      games.season,
      games.week,
      count(*)::integer as game_count,
      count(distinct coalesce(nullif(games.espn_event_id, ''), games.id::text))::integer as distinct_event_count,
      count(*) filter (
        where games.kickoff_at > now()
          and (
            coalesce(games.status, 'scheduled') <> 'scheduled'
            or games.winner is not null
            or games.home_score is not null
            or games.away_score is not null
          )
      )::integer as future_result_count,
      count(*) filter (
        where games.status = 'final'
          and games.winner is null
          and not (games.home_score is not null and games.away_score is not null and games.home_score = games.away_score)
      )::integer as final_missing_winner_count,
      count(*) filter (
        where games.status = 'final'
          and games.winner is not null
          and games.winner not in (games.home_team, games.away_team)
      )::integer as invalid_winner_count
    from games
    group by games.season, games.week
  ),
  team_counts as (
    select
      t.season,
      t.week,
      count(*)::integer as team_appearance_count
    from (
      select games.season, games.week, games.home_team as team from games
      union all
      select games.season, games.week, games.away_team as team from games
    ) t
    where nullif(t.team, '') is not null
    group by t.season, t.week
  ),
  duplicate_teams as (
    select
      t.season,
      t.week,
      (count(*) - count(distinct t.team))::integer as duplicate_team_count
    from (
      select games.season, games.week, games.home_team as team from games
      union all
      select games.season, games.week, games.away_team as team from games
    ) t
    where nullif(t.team, '') is not null
    group by t.season, t.week
  ),
  future_pick_results as (
    select
      games.season,
      games.week,
      count(distinct (pp.pool_id, pp.entry_id, pp.week, pp.slot))::integer as future_pick_result_count
    from public.pool_picks pp
    join public.pools po
      on po.id = pp.pool_id
    join games
      on games.week = pp.week
     and pp.team_abbr in (games.home_team, games.away_team)
     and (po.season is null or po.season = games.season)
    where pp.result is not null
      and games.kickoff_at > now()
    group by games.season, games.week
  )
  select
    wc.season,
    wc.week,
    wc.game_count,
    greatest(wc.game_count - wc.distinct_event_count, 0)::integer as duplicate_event_count,
    wc.future_result_count,
    wc.final_missing_winner_count,
    wc.invalid_winner_count,
    coalesce(dt.duplicate_team_count, 0)::integer as duplicate_team_count,
    coalesce(fpr.future_pick_result_count, 0)::integer as future_pick_result_count,
    coalesce(tc.team_appearance_count, 0)::integer as team_appearance_count,
    (
      case when wc.game_count > 16 then 1 else 0 end
      + case when wc.game_count < 12 then 1 else 0 end
      + case when greatest(wc.game_count - wc.distinct_event_count, 0) > 0 then 1 else 0 end
      + case when wc.future_result_count > 0 then 1 else 0 end
      + case when wc.final_missing_winner_count > 0 then 1 else 0 end
      + case when wc.invalid_winner_count > 0 then 1 else 0 end
      + case when coalesce(dt.duplicate_team_count, 0) > 0 then 1 else 0 end
      + case when coalesce(fpr.future_pick_result_count, 0) > 0 then 1 else 0 end
      + case when coalesce(tc.team_appearance_count, 0) <> wc.game_count * 2 then 1 else 0 end
    )::integer as issue_count
  from week_counts wc
  left join team_counts tc
    on tc.season = wc.season
   and tc.week = wc.week
  left join duplicate_teams dt
    on dt.season = wc.season
   and dt.week = wc.week
  left join future_pick_results fpr
    on fpr.season = wc.season
   and fpr.week = wc.week
  order by wc.season desc, wc.week;
end;
$function$;

drop function if exists public.get_my_pool_history();
create function public.get_my_pool_history()
returns table (
  pool_id uuid,
  pool_name text,
  season integer,
  status text,
  eliminated_week integer,
  strikes_used integer,
  wins integer,
  losses integer,
  pushes integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with my_entries as (
    select
      pm.pool_id,
      pm.id as entry_id,
      lower(coalesce(nullif(pm.status::text, ''), 'alive')) as member_status
    from public.pool_members pm
    where pm.profile_id = auth.uid()
  ),
  rolled as (
    select
      me.pool_id,
      count(*)::integer as entry_count,
      sum(coalesce(s.wins, 0))::integer as wins,
      sum(coalesce(s.losses, 0))::integer as losses,
      sum(coalesce(s.pushes, 0))::integer as pushes,
      sum(coalesce(s.strikes_used, 0))::integer as strikes_used,
      max(s.eliminated_week)::integer as eliminated_week,
      bool_or(
        case
          when s.entry_id is not null then coalesce(s.eliminated, false)
          else me.member_status not in ('active', 'alive')
        end
      ) as any_eliminated,
      bool_or(
        case
          when s.entry_id is not null then not coalesce(s.eliminated, false)
          else me.member_status in ('active', 'alive')
        end
      ) as any_alive
    from my_entries me
    left join public.pool_member_stats s
      on s.pool_id = me.pool_id
     and s.entry_id = me.entry_id
    group by me.pool_id
  )
  select
    p.id as pool_id,
    p.name::text as pool_name,
    coalesce(p.season, extract(year from now())::integer)::integer as season,
    case
      when p.winner_user_id = auth.uid() then 'Won'
      when rolled.any_alive and not coalesce(p.archived, false) then 'In progress'
      when rolled.any_eliminated and rolled.eliminated_week is not null then 'Eliminated Week ' || rolled.eliminated_week::text
      when coalesce(p.archived, false) then 'Archived'
      else 'In progress'
    end::text as status,
    rolled.eliminated_week,
    coalesce(rolled.strikes_used, 0)::integer as strikes_used,
    coalesce(rolled.wins, 0)::integer as wins,
    coalesce(rolled.losses, 0)::integer as losses,
    coalesce(rolled.pushes, 0)::integer as pushes
  from rolled
  join public.pools p
    on p.id = rolled.pool_id
  order by coalesce(p.season, extract(year from now())::integer) desc, p.created_at desc nulls last, p.name;
$function$;

create or replace function public.adjudicate_completed_weeks(p_season integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_week integer;
  v_total integer := 0;
  v_scored integer := 0;
begin
  if p_season is null then
    raise exception 'Season is required.';
  end if;

  for v_week in
    select distinct g.week
    from public.nfl_games g
    where g.season = p_season
      and g.status = 'final'
      and coalesce(g.kickoff_at_utc, g.game_time) <= now()
    order by g.week
  loop
    v_scored := public.adjudicate_results(p_season, v_week);
    v_total := v_total + coalesce(v_scored, 0);
  end loop;

  return v_total;
end;
$function$;

revoke execute on function public.normalize_username(text) from public;
revoke execute on function public.username_available(text) from public;
revoke execute on function public.is_blog_superadmin() from public;
revoke execute on function public.current_blog_role() from public;
revoke execute on function public.can_manage_blog() from public;
revoke execute on function public.grant_blog_permission(text, text) from public, anon;
revoke execute on function public.blog_permission_overview() from public, anon;
revoke execute on function public.blog_comments_for_post(text) from public;
revoke execute on function public.blog_engagement_for_posts(text[]) from public;
revoke execute on function public.blog_comment_moderation_queue() from public, anon;
revoke execute on function public.blog_delete_comment(uuid) from public, anon;
revoke execute on function public.is_super_admin() from public;
revoke execute on function public.admin_can_manage(uuid) from public;
revoke execute on function public.count_pool_members(uuid) from public;
revoke execute on function public.pool_member_summaries(uuid[]) from public, anon;
revoke execute on function public.pool_entry_roster(uuid) from public, anon;
revoke execute on function public.admin_pool_entry_week_overview(uuid, integer) from public, anon;
revoke execute on function public.admin_update_pool_member_limit(uuid, integer) from public, anon;
revoke execute on function public.admin_set_double_weeks(uuid, integer[]) from public, anon;
revoke execute on function public.admin_update_pool_entry_settings(uuid, boolean, integer) from public, anon;
revoke execute on function public.admin_update_pool_visibility(uuid, boolean, text) from public, anon;
revoke execute on function public.admin_archive_pool(uuid, boolean) from public, anon;
revoke execute on function public.admin_clear_entry_week_draft_slot(uuid, uuid, integer, integer, text) from public, anon;
revoke execute on function public.admin_upsert_entry_draft(uuid, uuid, integer, text, integer, text) from public, anon;
revoke execute on function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer) from public, anon;
revoke execute on function public.superadmin_pool_overview() from public, anon;
revoke execute on function public.superadmin_pool_entries(uuid) from public, anon;
revoke execute on function public.superadmin_repair_pool_future_results(uuid) from public, anon;
revoke execute on function public.superadmin_schedule_integrity_audit(integer) from public, anon;
revoke execute on function public.get_my_pool_history() from public, anon;
revoke execute on function public.adjudicate_completed_weeks(integer) from public, anon, authenticated;

grant execute on function public.normalize_username(text) to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.is_blog_superadmin() to anon, authenticated;
grant execute on function public.current_blog_role() to anon, authenticated;
grant execute on function public.can_manage_blog() to authenticated;
grant execute on function public.grant_blog_permission(text, text) to authenticated, service_role;
grant execute on function public.blog_permission_overview() to authenticated, service_role;
grant execute on function public.blog_comments_for_post(text) to anon, authenticated, service_role;
grant execute on function public.blog_engagement_for_posts(text[]) to anon, authenticated, service_role;
grant execute on function public.blog_comment_moderation_queue() to authenticated, service_role;
grant execute on function public.blog_delete_comment(uuid) to authenticated, service_role;
grant execute on function public.is_super_admin() to anon, authenticated, service_role;
grant execute on function public.admin_can_manage(uuid) to anon, authenticated, service_role;
grant execute on function public.count_pool_members(uuid) to anon, authenticated, service_role;
grant execute on function public.pool_member_summaries(uuid[]) to authenticated, service_role;
grant execute on function public.pool_entry_roster(uuid) to authenticated, service_role;
grant execute on function public.admin_pool_entry_week_overview(uuid, integer) to authenticated, service_role;
grant execute on function public.admin_update_pool_member_limit(uuid, integer) to authenticated, service_role;
grant execute on function public.admin_set_double_weeks(uuid, integer[]) to authenticated, service_role;
grant execute on function public.admin_update_pool_entry_settings(uuid, boolean, integer) to authenticated, service_role;
grant execute on function public.admin_update_pool_visibility(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.admin_archive_pool(uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_clear_entry_week_draft_slot(uuid, uuid, integer, integer, text) to authenticated, service_role;
grant execute on function public.admin_upsert_entry_draft(uuid, uuid, integer, text, integer, text) to authenticated, service_role;
grant execute on function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer) to authenticated, service_role;
grant execute on function public.superadmin_pool_overview() to authenticated, service_role;
grant execute on function public.superadmin_pool_entries(uuid) to authenticated, service_role;
grant execute on function public.superadmin_repair_pool_future_results(uuid) to authenticated, service_role;
grant execute on function public.superadmin_schedule_integrity_audit(integer) to authenticated, service_role;
grant execute on function public.get_my_pool_history() to authenticated, service_role;
grant execute on function public.adjudicate_completed_weeks(integer) to service_role;

commit;
