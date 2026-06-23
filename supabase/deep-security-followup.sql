-- Follow-up hardening after the full advisor pass.
--
-- Keep only the intentionally public invite/search/count helpers callable by
-- signed-out visitors. Everything below either needs an authenticated user, a
-- service-role job, or is an internal trigger/helper that should not be called
-- directly from the browser.

revoke execute on function public.auto_archive_completed_pools() from public, anon, authenticated;
grant execute on function public.auto_archive_completed_pools() to service_role;

revoke execute on function public.backfill_eliminated_week() from public, anon, authenticated;
grant execute on function public.backfill_eliminated_week() to service_role;

revoke execute on function public.clone_pool_for_new_season(uuid, integer) from public, anon;
grant execute on function public.clone_pool_for_new_season(uuid, integer) to authenticated, service_role;

revoke execute on function public.enforce_weekly_draft_limit() from public, anon, authenticated;
grant execute on function public.enforce_weekly_draft_limit() to service_role;

revoke execute on function public.finalize_week_picks(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_week_picks(uuid, integer) to service_role;

revoke execute on function public.get_my_account() from public, anon;
grant execute on function public.get_my_account() to authenticated, service_role;

revoke execute on function public.get_my_pool_history() from public, anon;
grant execute on function public.get_my_pool_history() to authenticated, service_role;

revoke execute on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated, service_role;

revoke execute on function public.handle_auth_user_profile_sync() from public, anon, authenticated;
grant execute on function public.handle_auth_user_profile_sync() to service_role;

revoke execute on function public.is_pool_member(uuid) from public, anon;
grant execute on function public.is_pool_member(uuid) to authenticated, service_role;

revoke execute on function public.list_pool_members(uuid) from public, anon;
grant execute on function public.list_pool_members(uuid) to authenticated, service_role;

revoke execute on function public.log_pick_save_event() from public, anon, authenticated;
grant execute on function public.log_pick_save_event() to service_role;

revoke execute on function public.picks_allowed(uuid, integer) from public, anon;
grant execute on function public.picks_allowed(uuid, integer) to authenticated, service_role;

revoke execute on function public.pool_week_deadline_at(uuid, integer) from public, anon;
grant execute on function public.pool_week_deadline_at(uuid, integer) to authenticated, service_role;

revoke execute on function public.update_my_profile(text, text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, text) to authenticated, service_role;

-- These helpers intentionally remain callable by anon:
-- public.get_pool_invite(uuid): lets invite pages render before sign-in.
-- public.search_pools(text): powers league search before sign-in.
-- public.count_pool_members(uuid): shows member counts in search/join flows.
