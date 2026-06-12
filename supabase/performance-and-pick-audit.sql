-- Performance and launch-hardening helpers for Sunday traffic spikes.

-- Fast paths used by My Pools, pick saving, standings, and schedule lookups.
create index if not exists idx_pools_created_by_archived_created_at
  on public.pools (created_by, archived, created_at desc);

create index if not exists idx_pools_active_unarchived
  on public.pools (activation_status, archived)
  where archived = false;

create index if not exists idx_pool_members_profile_pool
  on public.pool_members (profile_id, pool_id);

create index if not exists idx_pool_members_pool_profile
  on public.pool_members (pool_id, profile_id);

create index if not exists idx_pool_pick_drafts_user_pool_week
  on public.pool_pick_drafts (pool_id, user_id, week, slot);

create index if not exists idx_pool_picks_user_pool_week
  on public.pool_picks (pool_id, user_id, week, slot);

create index if not exists idx_pool_picks_pool_week_user
  on public.pool_picks (pool_id, week, user_id);

create index if not exists idx_pool_member_stats_pool_user
  on public.pool_member_stats (pool_id, user_id);

create index if not exists idx_nfl_games_season_week_kickoff
  on public.nfl_games (season, week, kickoff_at_utc, game_time);

create index if not exists idx_season_weeks_season_week
  on public.season_weeks (season, week);

-- Pick save audit trail. This gives commissioners support evidence when someone
-- says "I saved that pick" and also helps us diagnose traffic-spike issues.
create table if not exists public.pick_save_events (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  source_table text not null check (source_table in ('pool_pick_drafts', 'pool_picks')),
  action text not null check (action in ('draft_saved', 'draft_cleared', 'pick_locked', 'pick_changed', 'pick_deleted')),
  week integer not null,
  slot integer not null default 1,
  old_team_abbr text,
  new_team_abbr text,
  result text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pick_save_events_pool_user_week
  on public.pick_save_events (pool_id, user_id, week, created_at desc);

create index if not exists idx_pick_save_events_created_at
  on public.pick_save_events (created_at desc);

alter table public.pick_save_events enable row level security;

drop policy if exists pick_save_events_select_own_or_owner on public.pick_save_events;
create policy pick_save_events_select_own_or_owner
on public.pick_save_events
for select
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.pools p
    where p.id = pick_save_events.pool_id
      and p.created_by = auth.uid()
  )
);

create or replace function public.log_pick_save_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  event_action text;
  event_pool_id uuid;
  event_user_id uuid;
  event_week integer;
  event_slot integer;
  event_old_team text;
  event_new_team text;
  event_result text;
begin
  if tg_table_name = 'pool_pick_drafts' then
    if tg_op = 'INSERT' then
      event_action := 'draft_saved';
    elsif tg_op = 'UPDATE' then
      if old.team_abbr is distinct from new.team_abbr then
        event_action := 'draft_saved';
      else
        return new;
      end if;
    elsif tg_op = 'DELETE' then
      event_action := 'draft_cleared';
    end if;
  elsif tg_table_name = 'pool_picks' then
    if tg_op = 'INSERT' then
      event_action := 'pick_locked';
    elsif tg_op = 'UPDATE' then
      if old.team_abbr is distinct from new.team_abbr or old.result is distinct from new.result then
        event_action := 'pick_changed';
      else
        return new;
      end if;
    elsif tg_op = 'DELETE' then
      event_action := 'pick_deleted';
    end if;
  end if;

  if tg_op = 'DELETE' then
    event_pool_id := old.pool_id;
    event_user_id := old.user_id;
    event_week := old.week;
    event_slot := old.slot;
    event_old_team := old.team_abbr;
    event_new_team := null;
    event_result := case when tg_table_name = 'pool_picks' then old.result else null end;
  elsif tg_op = 'INSERT' then
    event_pool_id := new.pool_id;
    event_user_id := new.user_id;
    event_week := new.week;
    event_slot := new.slot;
    event_old_team := null;
    event_new_team := new.team_abbr;
    event_result := case when tg_table_name = 'pool_picks' then new.result else null end;
  else
    event_pool_id := new.pool_id;
    event_user_id := new.user_id;
    event_week := new.week;
    event_slot := new.slot;
    event_old_team := old.team_abbr;
    event_new_team := new.team_abbr;
    event_result := case when tg_table_name = 'pool_picks' then new.result else null end;
  end if;

  insert into public.pick_save_events (
    pool_id,
    user_id,
    actor_user_id,
    source_table,
    action,
    week,
    slot,
    old_team_abbr,
    new_team_abbr,
    result
  )
  values (
    event_pool_id,
    event_user_id,
    auth.uid(),
    tg_table_name,
    event_action,
    event_week,
    coalesce(event_slot, 1),
    event_old_team,
    event_new_team,
    event_result
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_log_pool_pick_drafts on public.pool_pick_drafts;
create trigger trg_log_pool_pick_drafts
after insert or update or delete on public.pool_pick_drafts
for each row execute function public.log_pick_save_event();

drop trigger if exists trg_log_pool_picks on public.pool_picks;
create trigger trg_log_pool_picks
after insert or update or delete on public.pool_picks
for each row execute function public.log_pick_save_event();
