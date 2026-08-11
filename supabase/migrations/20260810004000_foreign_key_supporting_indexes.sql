-- Supporting indexes keep parent-row updates/deletes from taking long scans or
-- broad locks as production history grows. All are additive and rerunnable.

create index if not exists idx_app_event_logs_user_id
  on public.app_event_logs(user_id);
create index if not exists idx_blog_categories_created_by
  on public.blog_categories(created_by);
create index if not exists idx_blog_comment_reactions_profile_id
  on public.blog_comment_reactions(profile_id);
create index if not exists idx_blog_comment_reports_profile_id
  on public.blog_comment_reports(profile_id);
create index if not exists idx_blog_comments_profile_id
  on public.blog_comments(profile_id);
create index if not exists idx_blog_posts_author_id
  on public.blog_posts(author_id);
create index if not exists idx_emails_log_pool_id
  on public.emails_log(pool_id);
create index if not exists idx_emails_log_profile_id
  on public.emails_log(profile_id);
create index if not exists idx_entries_profile_id
  on public.entries(profile_id);
create index if not exists idx_invites_created_by
  on public.invites(created_by);
create index if not exists idx_payments_log_profile_id
  on public.payments_log(profile_id);
create index if not exists idx_pick_save_events_actor_user_id
  on public.pick_save_events(actor_user_id);
create index if not exists idx_pick_save_events_user_id
  on public.pick_save_events(user_id);
create index if not exists idx_picks_game_id
  on public.picks(game_id);
create index if not exists idx_pool_entry_survival_graces_entry_id
  on public.pool_entry_survival_graces(entry_id);
create index if not exists idx_pool_member_stats_entry_id
  on public.pool_member_stats(entry_id);
create index if not exists idx_pool_member_stats_user_id
  on public.pool_member_stats(user_id);
create index if not exists idx_pool_pick_drafts_user_id
  on public.pool_pick_drafts(user_id);
create index if not exists idx_pool_picks_user_id
  on public.pool_picks(user_id);
create index if not exists idx_pools_activated_by
  on public.pools(activated_by);
create index if not exists idx_pools_winner_user_id
  on public.pools(winner_user_id);
create index if not exists idx_test_pool_team_results_created_by
  on public.test_pool_team_results(created_by);

-- Exact duplicate of idx_nfl_games_season_week in the current production
-- schema. Keep the descriptively named index and remove the redundant copy.
drop index if exists public.nfl_games_season_week_idx;
