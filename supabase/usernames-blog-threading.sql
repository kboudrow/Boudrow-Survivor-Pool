begin;

alter table public.blog_comments
  add column if not exists parent_comment_id uuid references public.blog_comments(id) on delete cascade;

create index if not exists idx_blog_comments_parent
  on public.blog_comments (parent_comment_id, created_at)
  where deleted_at is null;

with normalized as (
  select
    id,
    lower(nullif(btrim(username), '')) as normalized_username,
    row_number() over (partition by lower(nullif(btrim(username), '')) order by created_at nulls last, id) as duplicate_number
  from public.profiles
  where nullif(btrim(username), '') is not null
),
duplicates as (
  select id, normalized_username, duplicate_number
  from normalized
  where duplicate_number > 1
)
update public.profiles p
set username = left(d.normalized_username, 24) || '-' || d.duplicate_number::text,
    display_name = left(d.normalized_username, 24) || '-' || d.duplicate_number::text,
    updated_at = now()
from duplicates d
where p.id = d.id;

update public.profiles
set username = nullif(btrim(username), ''),
    display_name = nullif(btrim(username), '')
where username is not null
  and username <> nullif(btrim(username), '');

create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username))
  where username is not null and btrim(username) <> '';

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
  with reaction_counts as (
    select
      bcr.comment_id,
      count(*) filter (where bcr.reaction = 'up') as up_count,
      count(*) filter (where bcr.reaction = 'down') as down_count
    from public.blog_comment_reactions bcr
    group by bcr.comment_id
  ),
  viewer_reactions as (
    select bcr.comment_id, bcr.reaction
    from public.blog_comment_reactions bcr
    where bcr.profile_id = auth.uid()
  )
  select
    bc.id,
    bc.post_slug,
    bc.profile_id,
    bc.parent_comment_id,
    coalesce(
      nullif(pp.username, ''),
      'Player ' || left(bc.profile_id::text, 8)
    ) as author_name,
    pp.avatar_url,
    bc.body,
    bc.created_at,
    bc.updated_at,
    coalesce(rc.up_count, 0) as up_count,
    coalesce(rc.down_count, 0) as down_count,
    vr.reaction as viewer_reaction
  from public.blog_comments bc
  left join public.profiles_public pp on pp.id = bc.profile_id
  left join reaction_counts rc on rc.comment_id = bc.id
  left join viewer_reactions vr on vr.comment_id = bc.id
  where bc.post_slug = p_post_slug
    and bc.deleted_at is null
  order by
    (coalesce(rc.up_count, 0) + coalesce(rc.down_count, 0)) desc,
    coalesce(rc.up_count, 0) desc,
    bc.created_at desc;
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
  with requested as (
    select unnest(coalesce(p_post_slugs, array[]::text[])) as post_slug
  ),
  comment_counts as (
    select
      bc.post_slug,
      count(*) as comment_count
    from public.blog_comments bc
    where bc.deleted_at is null
      and bc.post_slug = any(coalesce(p_post_slugs, array[]::text[]))
    group by bc.post_slug
  ),
  reaction_counts as (
    select
      bc.post_slug,
      count(*) filter (where bcr.reaction = 'up') as up_count,
      count(*) filter (where bcr.reaction = 'down') as down_count
    from public.blog_comments bc
    left join public.blog_comment_reactions bcr on bcr.comment_id = bc.id
    where bc.deleted_at is null
      and bc.post_slug = any(coalesce(p_post_slugs, array[]::text[]))
    group by bc.post_slug
  )
  select
    r.post_slug,
    coalesce(cc.comment_count, 0) as comment_count,
    coalesce(rc.up_count, 0) as up_count,
    coalesce(rc.down_count, 0) as down_count
  from requested r
  left join comment_counts cc on cc.post_slug = r.post_slug
  left join reaction_counts rc on rc.post_slug = r.post_slug;
$function$;

create or replace function public.pool_entry_roster(p_pool_id uuid)
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
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view this pool.';
  end if;

  if not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pm.id as entry_id,
    pm.profile_id,
    coalesce(pm.entry_number, 1) as entry_number,
    pm.entry_name::text as entry_name,
    coalesce(
      nullif(pr.username::text, ''),
      'Player ' || left(pm.profile_id::text, 8)
    )::text as display_name,
    pr.username::text,
    null::text as first_name,
    null::text as last_name,
    pr.avatar_url::text as avatar_url,
    pm.role::text as role,
    pm.status::text as status,
    pm.joined_at
  from public.pool_members pm
  left join public.profiles pr on pr.id = pm.profile_id
  where pm.pool_id = p_pool_id
  order by display_name, pm.entry_number;
end;
$function$;

create or replace function public.admin_pool_entry_week_overview(p_pool_id uuid, p_week integer)
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
  wins int,
  losses int,
  pushes int,
  strikes_used int,
  eliminated boolean,
  eliminated_week int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  )
  select
    pm.id as entry_id,
    pm.profile_id as user_id,
    coalesce(pm.entry_number, 1) as entry_number,
    pm.entry_name::text as entry_name,
    coalesce(
      nullif(pr.username, ''),
      'Player ' || left(pm.profile_id::text, 8)
    ) as display_name,
    pm.role::text as role,
    pm.joined_at,
    slots.slot,
    d.team_abbr as draft_team_abbr,
    d.updated_at as draft_updated_at,
    fp.team_abbr as final_team_abbr,
    fp.locked_at,
    fp.result,
    coalesce(s.wins, 0) as wins,
    coalesce(s.losses, 0) as losses,
    coalesce(s.pushes, 0) as pushes,
    coalesce(s.strikes_used, 0) as strikes_used,
    coalesce(s.eliminated, false) as eliminated,
    s.eliminated_week
  from public.pool_members pm
  cross join slots
  left join public.profiles pr on pr.id = pm.profile_id
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
  order by display_name, pm.entry_number, slots.slot;
end;
$function$;

grant execute on function public.blog_engagement_for_posts(text[]) to anon, authenticated;

commit;
