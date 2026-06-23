begin;

alter function public.trg_backfill_eliminated_week() set search_path to 'public';
alter function public.touch_profile_private_updated_at() set search_path to 'public';
alter function public.enforce_pool_name_rules() set search_path to 'public';
alter function public.clone_pool_for_new_season(uuid, integer) set search_path to 'public';
alter function public.count_pool_members(uuid) set search_path to 'public';

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'add_pool_entry',
        'adjudicate_completed_weeks',
        'adjudicate_results',
        'admin_archive_pool',
        'admin_can_manage',
        'admin_clear_entry_week_draft_slot',
        'admin_clear_user_week_draft_slot',
        'admin_clear_user_week_drafts',
        'admin_override_entry_final_pick',
        'admin_override_final_pick',
        'admin_pool_entry_week_overview',
        'admin_pool_week_overview',
        'admin_remove_member',
        'admin_remove_pool_entry',
        'admin_remove_pool_member',
        'admin_set_double_weeks',
        'admin_update_pool_entry_settings',
        'admin_update_pool_image',
        'admin_update_pool_member_limit',
        'admin_update_pool_visibility',
        'admin_upsert_entry_draft',
        'admin_upsert_user_draft',
        'blog_permission_overview',
        'can_manage_blog',
        'clear_entry_draft_pick',
        'current_blog_role',
        'finalize_locked_picks',
        'finalize_locked_picks_for_pool',
        'finalize_no_pick_losses',
        'finalize_picks_week',
        'grant_blog_permission',
        'is_blog_superadmin',
        'is_super_admin',
        'join_pool',
        'leave_pool',
        'pool_entry_roster',
        'pool_member_roster',
        'pool_visible_picks',
        'restore_unlocked_picks_for_pool',
        'save_entry_draft_pick',
        'set_pool_password',
        'superadmin_pool_entries',
        'superadmin_pool_overview',
        'superadmin_repair_pool_future_results',
        'superadmin_schedule_integrity_audit'
      ])
  loop
    execute format('revoke execute on function %s from public', fn);
    execute format('revoke execute on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

grant execute on function public.search_pools(text) to anon, authenticated, service_role;

drop policy if exists blog_permissions_superadmin_write on public.blog_permissions;
drop policy if exists blog_permissions_select_self_or_superadmin on public.blog_permissions;

create policy blog_permissions_select_self_or_superadmin
on public.blog_permissions
for select
to authenticated
using (profile_id = (select auth.uid()) or public.is_blog_superadmin());

create policy blog_permissions_superadmin_insert
on public.blog_permissions
for insert
to authenticated
with check (public.is_blog_superadmin());

create policy blog_permissions_superadmin_update
on public.blog_permissions
for update
to authenticated
using (public.is_blog_superadmin())
with check (public.is_blog_superadmin());

create policy blog_permissions_superadmin_delete
on public.blog_permissions
for delete
to authenticated
using (public.is_blog_superadmin());

drop policy if exists blog_posts_public_read_published on public.blog_posts;
drop policy if exists blog_posts_staff_read on public.blog_posts;
drop policy if exists blog_posts_staff_insert on public.blog_posts;
drop policy if exists blog_posts_staff_update on public.blog_posts;
drop policy if exists blog_posts_superadmin_delete on public.blog_posts;

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
  or public.is_blog_superadmin()
  or author_id = (select auth.uid())
);

create policy blog_posts_staff_insert
on public.blog_posts
for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and (
    public.is_blog_superadmin()
    or (
      public.current_blog_role() in ('admin', 'editor', 'contributor')
      and status = 'draft'
    )
  )
);

create policy blog_posts_staff_update
on public.blog_posts
for update
to authenticated
using (
  public.is_blog_superadmin()
  or (author_id = (select auth.uid()) and status = 'draft')
)
with check (
  public.is_blog_superadmin()
  or (author_id = (select auth.uid()) and status = 'draft')
);

create policy blog_posts_superadmin_delete
on public.blog_posts
for delete
to authenticated
using (public.is_blog_superadmin());

drop policy if exists invites_admin_only_cud on public.invites;
drop policy if exists invites_admin_only_select on public.invites;

create policy invites_admin_only_select
on public.invites
for select
to authenticated
using (
  exists (
    select 1
    from public.pools p
    where p.id = invites.pool_id
      and public.admin_can_manage(p.id)
  )
);

create policy invites_admin_only_insert
on public.invites
for insert
to authenticated
with check (
  exists (
    select 1
    from public.pools p
    where p.id = invites.pool_id
      and public.admin_can_manage(p.id)
  )
);

create policy invites_admin_only_update
on public.invites
for update
to authenticated
using (
  exists (
    select 1
    from public.pools p
    where p.id = invites.pool_id
      and public.admin_can_manage(p.id)
  )
)
with check (
  exists (
    select 1
    from public.pools p
    where p.id = invites.pool_id
      and public.admin_can_manage(p.id)
  )
);

create policy invites_admin_only_delete
on public.invites
for delete
to authenticated
using (
  exists (
    select 1
    from public.pools p
    where p.id = invites.pool_id
      and public.admin_can_manage(p.id)
  )
);

drop policy if exists nfl_games_select_all_auth on public.nfl_games;
drop policy if exists "pools insert by auth" on public.pools;
drop policy if exists user_can_read_own_pools on public.pools;
drop policy if exists "pools owner update" on public.pools;

drop policy if exists "owner can insert private profile" on public.profile_private;
drop policy if exists "owner can read private profile" on public.profile_private;
drop policy if exists "owner can update private profile" on public.profile_private;

drop policy if exists profiles_private_write_none on public.profiles_private;
create policy profiles_private_insert_none
on public.profiles_private
for insert
to authenticated
with check (false);

create policy profiles_private_update_none
on public.profiles_private
for update
to authenticated
using (false)
with check (false);

create policy profiles_private_delete_none
on public.profiles_private
for delete
to authenticated
using (false);

drop policy if exists pick_save_events_select_own_or_owner on public.pick_save_events;
create policy pick_save_events_select_own_or_admin
on public.pick_save_events
for select
to authenticated
using (
  user_id = (select auth.uid())
  or public.admin_can_manage(pool_id)
);

commit;
