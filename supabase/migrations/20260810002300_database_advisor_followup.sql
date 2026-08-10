-- Remove unnecessary anonymous execution, consolidate overlapping permissive
-- policies, and drop exact duplicate indexes reported by Supabase Advisor.

do $restrict_anonymous_security_definers$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
      and p.proname not in (
        'blog_comments_for_post',
        'blog_engagement_for_posts',
        'count_pool_entries',
        'count_pool_members',
        'get_pool_invite',
        'pool_week_games',
        'search_pools',
        'username_available'
      )
  loop
    execute format('revoke execute on function %s from anon', v_function);
  end loop;
end;
$restrict_anonymous_security_definers$;

-- Published posts remain public. Signed-in staff also retain access to drafts
-- they are permitted to manage, now through one SELECT policy per role.
drop policy if exists blog_posts_public_read_published on public.blog_posts;
drop policy if exists blog_posts_staff_read on public.blog_posts;

create policy blog_posts_public_read_published
on public.blog_posts
for select
to anon
using (status = 'published');

create policy blog_posts_authenticated_read
on public.blog_posts
for select
to authenticated
using (
  status = 'published'
  or current_blog_role() in ('admin', 'editor')
  or author_id = (select auth.uid())
);

-- Public pools remain discoverable anonymously. Signed-in users get one
-- combined path covering public pools and pools they belong to or manage.
drop policy if exists pools_select_public on public.pools;
drop policy if exists pools_select_member_or_admin on public.pools;

create policy pools_select_public
on public.pools
for select
to anon
using (
  coalesce(is_public, false)
  and not coalesce(archived, false)
  and coalesce(activation_status, 'active') <> 'cancelled'
);

create policy pools_select_authenticated
on public.pools
for select
to authenticated
using (
  (
    coalesce(is_public, false)
    and not coalesce(archived, false)
    and coalesce(activation_status, 'active') <> 'cancelled'
  )
  or created_by = (select auth.uid())
  or public.is_pool_member(id)
  or public.admin_can_manage(id)
);

-- The previous profiles_read_all policy let any signed-in account enumerate
-- every profile. Keep self access and same-pool visibility only.
drop policy if exists "profiles self read" on public.profiles;
drop policy if exists profiles_read_all on public.profiles;
drop policy if exists profiles_select_if_shared_pool on public.profiles;

create policy profiles_select_self_or_shared_pool
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.pool_members pm_me
    join public.pool_members pm_other on pm_other.pool_id = pm_me.pool_id
    where pm_me.profile_id = (select auth.uid())
      and pm_other.profile_id = profiles.id
  )
);

-- Split the legacy picks ALL policy so SELECT is governed only by the
-- same-pool visibility policy. Write behavior remains unchanged.
drop policy if exists picks_cud_entry_owner on public.picks;

create policy picks_insert_entry_owner
on public.picks
for insert
to authenticated
with check (
  exists (
    select 1 from public.entries e
    where e.id = picks.entry_id
      and e.profile_id = (select auth.uid())
  )
);

create policy picks_update_entry_owner
on public.picks
for update
to authenticated
using (
  exists (
    select 1 from public.entries e
    where e.id = picks.entry_id
      and e.profile_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.entries e
    where e.id = picks.entry_id
      and e.profile_id = (select auth.uid())
  )
);

create policy picks_delete_entry_owner
on public.picks
for delete
to authenticated
using (
  exists (
    select 1 from public.entries e
    where e.id = picks.entry_id
      and e.profile_id = (select auth.uid())
  )
);

-- Preserve primary/unique indexes and remove only byte-for-byte equivalent
-- secondary indexes.
drop index if exists public.picks_entry_week_idx;
drop index if exists public.idx_pool_member_stats_entry;
drop index if exists public.idx_pool_member_stats_pool_entry;
drop index if exists public.idx_pool_pick_drafts_entry_week;
drop index if exists public.idx_pool_pick_drafts_pool_entry_week_slot;
drop index if exists public.idx_pool_picks_entry_week;
drop index if exists public.idx_pool_picks_pool_entry_week_slot;
drop index if exists public.idx_pools_created_by_archived_created_at;
drop index if exists public.idx_season_weeks_season_week;
