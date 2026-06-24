begin;

create table if not exists public.blog_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.blog_comments(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (comment_id, profile_id)
);

create index if not exists idx_blog_comment_reports_comment
  on public.blog_comment_reports (comment_id, created_at desc);

alter table public.blog_comment_reports enable row level security;

drop policy if exists blog_comment_reports_insert_authenticated on public.blog_comment_reports;
create policy blog_comment_reports_insert_authenticated
on public.blog_comment_reports
for insert
to authenticated
with check (profile_id = auth.uid());

drop policy if exists blog_comment_reports_select_self_or_superadmin on public.blog_comment_reports;
create policy blog_comment_reports_select_self_or_superadmin
on public.blog_comment_reports
for select
to authenticated
using (profile_id = auth.uid() or public.is_blog_superadmin());

drop policy if exists blog_comment_reports_superadmin_delete on public.blog_comment_reports;
create policy blog_comment_reports_superadmin_delete
on public.blog_comment_reports
for delete
to authenticated
using (public.is_blog_superadmin());

drop policy if exists blog_comments_author_update on public.blog_comments;
drop policy if exists blog_comments_author_delete on public.blog_comments;

drop policy if exists blog_comments_superadmin_update on public.blog_comments;
create policy blog_comments_superadmin_update
on public.blog_comments
for update
to authenticated
using (public.is_blog_superadmin())
with check (public.is_blog_superadmin());

drop policy if exists blog_comments_superadmin_delete on public.blog_comments;
create policy blog_comments_superadmin_delete
on public.blog_comments
for delete
to authenticated
using (public.is_blog_superadmin());

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
      count(*) filter (where bcr.reaction = 'up') as up_count,
      count(*) filter (where bcr.reaction = 'down') as down_count
    from public.blog_comment_reactions bcr
    group by bcr.comment_id
  ),
  report_counts as (
    select
      bcr.comment_id,
      count(*) as report_count,
      max(bcr.created_at) as latest_report_at
    from public.blog_comment_reports bcr
    group by bcr.comment_id
  )
  select
    bc.id,
    bc.post_slug,
    bc.profile_id,
    bc.parent_comment_id,
    coalesce(nullif(pp.username, ''), 'Player ' || left(bc.profile_id::text, 8)) as author_name,
    pp.avatar_url,
    bc.body,
    bc.created_at,
    coalesce(rc.up_count, 0) as up_count,
    coalesce(rc.down_count, 0) as down_count,
    coalesce(rep.report_count, 0) as report_count,
    rep.latest_report_at
  from public.blog_comments bc
  left join public.profiles_public pp on pp.id = bc.profile_id
  left join reaction_counts rc on rc.comment_id = bc.id
  left join report_counts rep on rep.comment_id = bc.id
  where public.is_blog_superadmin()
    and bc.deleted_at is null
  order by coalesce(rep.report_count, 0) desc, rep.latest_report_at desc nulls last, bc.created_at desc;
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

grant execute on function public.blog_comment_moderation_queue() to authenticated;
grant execute on function public.blog_delete_comment(uuid) to authenticated;

commit;
