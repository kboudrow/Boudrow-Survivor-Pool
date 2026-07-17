begin;

create or replace function public.blog_comments_for_post(p_post_slug text)
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
  with post_comments as (
    select *
    from public.blog_comments bc
    where bc.post_slug = p_post_slug
      and bc.deleted_at is null
  ),
  reaction_counts as (
    select
      bcr.comment_id,
      count(*) filter (where bcr.reaction = 'up') as up_count,
      count(*) filter (where bcr.reaction = 'down') as down_count
    from public.blog_comment_reactions bcr
    join post_comments pc on pc.id = bcr.comment_id
    group by bcr.comment_id
  ),
  viewer_reactions as (
    select bcr.comment_id, bcr.reaction
    from public.blog_comment_reactions bcr
    join post_comments pc on pc.id = bcr.comment_id
    where bcr.profile_id = auth.uid()
  )
  select
    pc.id,
    pc.post_slug,
    pc.profile_id,
    pc.parent_comment_id,
    coalesce(
      nullif(pp.username, ''),
      'Player ' || left(pc.profile_id::text, 8)
    ) as author_name,
    pp.avatar_url,
    pc.body,
    pc.created_at,
    pc.updated_at,
    coalesce(rc.up_count, 0) as up_count,
    coalesce(rc.down_count, 0) as down_count,
    vr.reaction as viewer_reaction
  from post_comments pc
  left join public.profiles_public pp on pp.id = pc.profile_id
  left join reaction_counts rc on rc.comment_id = pc.id
  left join viewer_reactions vr on vr.comment_id = pc.id
  order by
    (coalesce(rc.up_count, 0) + coalesce(rc.down_count, 0)) desc,
    coalesce(rc.up_count, 0) desc,
    pc.created_at desc;
$function$;

grant execute on function public.blog_comments_for_post(text) to anon, authenticated, service_role;

commit;
