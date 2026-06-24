begin;

create table if not exists public.blog_comments (
  id uuid primary key default gen_random_uuid(),
  post_slug text not null,
  profile_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint blog_comments_body_length check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists idx_blog_comments_post_created
  on public.blog_comments (post_slug, created_at desc)
  where deleted_at is null;

create table if not exists public.blog_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.blog_comments(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (comment_id, profile_id)
);

create index if not exists idx_blog_comment_reactions_comment
  on public.blog_comment_reactions (comment_id);

drop trigger if exists trg_blog_comments_touch_updated_at on public.blog_comments;
create trigger trg_blog_comments_touch_updated_at
before update on public.blog_comments
for each row execute function public.touch_updated_at();

drop trigger if exists trg_blog_comment_reactions_touch_updated_at on public.blog_comment_reactions;
create trigger trg_blog_comment_reactions_touch_updated_at
before update on public.blog_comment_reactions
for each row execute function public.touch_updated_at();

alter table public.blog_comments enable row level security;
alter table public.blog_comment_reactions enable row level security;

drop policy if exists blog_comments_public_read on public.blog_comments;
create policy blog_comments_public_read
on public.blog_comments
for select
to anon, authenticated
using (deleted_at is null);

drop policy if exists blog_comments_authenticated_insert on public.blog_comments;
create policy blog_comments_authenticated_insert
on public.blog_comments
for insert
to authenticated
with check (
  profile_id = auth.uid()
  and deleted_at is null
  and char_length(btrim(body)) between 1 and 2000
);

drop policy if exists blog_comments_author_update on public.blog_comments;
create policy blog_comments_author_update
on public.blog_comments
for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists blog_comments_author_delete on public.blog_comments;
create policy blog_comments_author_delete
on public.blog_comments
for delete
to authenticated
using (profile_id = auth.uid());

drop policy if exists blog_comment_reactions_public_read on public.blog_comment_reactions;
create policy blog_comment_reactions_public_read
on public.blog_comment_reactions
for select
to anon, authenticated
using (true);

drop policy if exists blog_comment_reactions_authenticated_insert on public.blog_comment_reactions;
create policy blog_comment_reactions_authenticated_insert
on public.blog_comment_reactions
for insert
to authenticated
with check (profile_id = auth.uid());

drop policy if exists blog_comment_reactions_author_update on public.blog_comment_reactions;
create policy blog_comment_reactions_author_update
on public.blog_comment_reactions
for update
to authenticated
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

drop policy if exists blog_comment_reactions_author_delete on public.blog_comment_reactions;
create policy blog_comment_reactions_author_delete
on public.blog_comment_reactions
for delete
to authenticated
using (profile_id = auth.uid());

create or replace function public.blog_comments_for_post(p_post_slug text)
returns table (
  id uuid,
  post_slug text,
  profile_id uuid,
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

grant execute on function public.blog_comments_for_post(text) to anon, authenticated;

commit;
