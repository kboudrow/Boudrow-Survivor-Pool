begin;

-- Read-heavy beta and game-day paths. These are intentionally conservative
-- btree indexes on columns already used by dashboard, standings, picks, admin,
-- cron, and blog queries.
create index if not exists idx_pools_active_created
on public.pools (activation_status, archived, created_at desc);

create index if not exists idx_pools_creator_archived
on public.pools (created_by, archived, created_at desc);

create index if not exists idx_pool_members_profile_pool
on public.pool_members (profile_id, pool_id, id);

create index if not exists idx_pool_members_pool_profile_entry
on public.pool_members (pool_id, profile_id, entry_number);

create index if not exists idx_pool_pick_drafts_entry_week_slot
on public.pool_pick_drafts (entry_id, week, slot);

create index if not exists idx_pool_pick_drafts_pool_entry_week_slot
on public.pool_pick_drafts (pool_id, entry_id, week, slot);

create index if not exists idx_pool_picks_entry_week_slot
on public.pool_picks (entry_id, week, slot);

create index if not exists idx_pool_picks_pool_entry_week_slot
on public.pool_picks (pool_id, entry_id, week, slot);

create index if not exists idx_pool_picks_pool_week_result
on public.pool_picks (pool_id, week, result);

create index if not exists idx_pool_member_stats_pool_entry
on public.pool_member_stats (pool_id, entry_id);

create index if not exists idx_pool_member_stats_pool_eliminated
on public.pool_member_stats (pool_id, eliminated, eliminated_week);

create index if not exists idx_nfl_games_season_week_kickoff
on public.nfl_games (season, week, coalesce(kickoff_at_utc, game_time));

create index if not exists idx_nfl_games_week_home
on public.nfl_games (season, week, upper(home_team));

create index if not exists idx_nfl_games_week_away
on public.nfl_games (season, week, upper(away_team));

create index if not exists idx_blog_posts_public_feed
on public.blog_posts (status, pinned desc, updated_at desc);

create index if not exists idx_blog_comments_post_visible_created
on public.blog_comments (post_slug, deleted_at, created_at desc);

create index if not exists idx_blog_comment_reactions_comment_reaction
on public.blog_comment_reactions (comment_id, reaction);

create index if not exists idx_app_event_logs_source_type_created
on public.app_event_logs (source, event_type, created_at desc);

drop function if exists public.superadmin_cron_health();

create or replace function public.superadmin_cron_health()
returns table (
  job_name text,
  route text,
  expected_every_minutes integer,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  latest_severity text,
  latest_message text,
  latest_metadata jsonb,
  minutes_since_success integer,
  next_expected_at timestamptz,
  status text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  with jobs as (
    select *
    from (values
      (
        'Score sync'::text,
        '/api/cron/sync-scores'::text,
        10::integer,
        array['cron_score_sync_completed', 'cron_score_sync_completed_with_errors', 'cron_score_sync_failed', 'cron_score_sync_finalize_failed', 'cron_score_sync_adjudicate_failed']::text[],
        array['cron_score_sync_completed']::text[],
        array['cron_score_sync_failed', 'cron_score_sync_finalize_failed', 'cron_score_sync_adjudicate_failed']::text[]
      ),
      (
        'Pick locking'::text,
        '/api/cron/lock-picks'::text,
        5::integer,
        array['cron_lock_picks_completed', 'cron_lock_picks_completed_with_errors', 'cron_pool_load_failed', 'cron_finalize_pool_failed', 'cron_adjudicate_season_failed']::text[],
        array['cron_lock_picks_completed']::text[],
        array['cron_pool_load_failed', 'cron_finalize_pool_failed', 'cron_adjudicate_season_failed']::text[]
      )
    ) as j(job_name, route, expected_every_minutes, event_types, success_types, error_types)
  ),
  latest as (
    select distinct on (j.job_name)
      j.job_name,
      l.created_at,
      l.severity,
      l.message,
      l.metadata,
      l.event_type
    from jobs j
    left join public.app_event_logs l
      on l.source = 'cron'
      and l.event_type = any(j.event_types)
    order by j.job_name, l.created_at desc nulls last
  ),
  success as (
    select
      j.job_name,
      max(l.created_at) as created_at
    from jobs j
    left join public.app_event_logs l
      on l.source = 'cron'
      and l.event_type = any(j.success_types)
    group by j.job_name
  ),
  errors as (
    select
      j.job_name,
      max(l.created_at) as created_at
    from jobs j
    left join public.app_event_logs l
      on l.source = 'cron'
      and (
        l.event_type = any(j.error_types)
        or (
          l.event_type = any(j.event_types)
          and l.severity = 'error'
        )
      )
    group by j.job_name
  )
  select
    j.job_name,
    j.route,
    j.expected_every_minutes,
    latest.created_at as last_run_at,
    success.created_at as last_success_at,
    errors.created_at as last_error_at,
    coalesce(latest.severity, 'warning') as latest_severity,
    latest.message as latest_message,
    coalesce(latest.metadata, '{}'::jsonb) as latest_metadata,
    case
      when success.created_at is null then null
      else floor(extract(epoch from (now() - success.created_at)) / 60)::integer
    end as minutes_since_success,
    case
      when success.created_at is null then null
      else success.created_at + make_interval(mins => j.expected_every_minutes)
    end as next_expected_at,
    case
      when success.created_at is null then 'missing'
      when errors.created_at is not null and errors.created_at > success.created_at then 'error'
      when latest.severity = 'warning' then 'warning'
      when now() > success.created_at + make_interval(mins => j.expected_every_minutes * 3) then 'late'
      else 'healthy'
    end as status
  from jobs j
  left join latest on latest.job_name = j.job_name
  left join success on success.job_name = j.job_name
  left join errors on errors.job_name = j.job_name
  order by j.job_name;
end;
$function$;

revoke execute on function public.superadmin_cron_health() from public, anon;
grant execute on function public.superadmin_cron_health() to authenticated, service_role;

commit;
