begin;

alter table if exists public.season_weeks enable row level security;
drop policy if exists season_weeks_public_read on public.season_weeks;
create policy season_weeks_public_read
on public.season_weeks
for select
to anon, authenticated
using (true);

alter table if exists public.pool_name_blocks enable row level security;
drop policy if exists pool_name_blocks_superadmin_read on public.pool_name_blocks;
create policy pool_name_blocks_superadmin_read
on public.pool_name_blocks
for select
to authenticated
using (public.is_super_admin());

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists blog_images_public_read on storage.objects;
drop policy if exists pool_images_public_read on storage.objects;

alter view if exists public.v_my_pool_history set (security_invoker = true);
alter view if exists public.v_my_pools set (security_invoker = true);
alter view if exists public.team_week_kickoff set (security_invoker = true);

drop index if exists public.idx_games_season_week;
drop index if exists public.idx_picks_pool_week;

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
        'finalize_locked_picks',
        'grant_blog_permission',
        'is_super_admin',
        'superadmin_pool_entries',
        'superadmin_pool_overview',
        'superadmin_repair_pool_future_results',
        'superadmin_schedule_integrity_audit'
      ])
  loop
    execute format('revoke execute on function %s from anon', fn);
  end loop;
end $$;

grant execute on function public.search_pools(text) to anon, authenticated;
grant execute on function public.current_blog_role() to authenticated;
grant execute on function public.is_blog_superadmin() to authenticated;

commit;
