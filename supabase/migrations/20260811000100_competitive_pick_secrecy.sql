begin;

-- A participant's selection is competition-sensitive until that selection's
-- authoritative deadline. Commissioners remain able to see whether a slot was
-- filled and when it was saved, but they do not receive another entry's team.
create or replace function public.pick_deadline_has_passed(
  p_pool_id uuid,
  p_deadline_at timestamptz,
  p_week integer default null
)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select case
    when p_deadline_at is not null then p_deadline_at <= public.pool_effective_now(p_pool_id)
    when p_week is null then false
    else coalesce((
      select bool_and(
        case
          when pool.deadline_mode = 'fixed' then
            least(
              coalesce(game.kickoff_at_utc, game.game_time),
              public.pool_week_deadline_at(p_pool_id, p_week)
            )
          else coalesce(game.kickoff_at_utc, game.game_time)
        end <= public.pool_effective_now(p_pool_id)
      )
      from public.pool_week_games(p_pool_id, p_week) game
      join public.pools pool on pool.id = p_pool_id
    ), false)
  end;
$function$;

revoke all on function public.pick_deadline_has_passed(uuid,timestamptz,integer) from public,anon;
grant execute on function public.pick_deadline_has_passed(uuid,timestamptz,integer) to authenticated,service_role;

-- Direct table reads enforce the same boundary as pool_visible_picks. Drafts
-- are always private to the entry owner. Final picks are readable by other pool
-- participants only after their individual lock time.
drop policy if exists pool_pick_drafts_select_own_or_admin on public.pool_pick_drafts;
create policy pool_pick_drafts_select_own
on public.pool_pick_drafts
for select
to authenticated
using (
  exists (
    select 1 from public.pool_members pm
    where pm.pool_id = pool_pick_drafts.pool_id
      and pm.id = pool_pick_drafts.entry_id
      and pm.profile_id = (select auth.uid())
  )
);

drop policy if exists pool_picks_select_own_or_admin on public.pool_picks;
create policy pool_picks_select_after_reveal
on public.pool_picks
for select
to authenticated
using (
  exists (
    select 1 from public.pool_members own_entry
    where own_entry.pool_id = pool_picks.pool_id
      and own_entry.id = pool_picks.entry_id
      and own_entry.profile_id = (select auth.uid())
  )
  or (
    (public.is_pool_member(pool_id) or public.admin_can_manage(pool_id))
    and public.pick_deadline_has_passed(pool_id, locked_at, week)
  )
);

-- Raw pick history used to expose every draft change to a commissioner. Keep
-- the evidence, but withhold other entries' rows until the recorded deadline.
drop policy if exists pick_save_events_select_own_or_admin on public.pick_save_events;
drop policy if exists pick_save_events_select_own_or_owner on public.pick_save_events;
create policy pick_save_events_select_own_or_revealed_admin
on public.pick_save_events
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (
    public.admin_can_manage(pool_id)
    and public.pick_deadline_has_passed(
      pool_id,
      coalesce(applicable_deadline_at, locked_at),
      week
    )
  )
);

-- Legacy commissioner draft-action rows may contain an old participant team.
-- Final-pick corrections are already locked; draft actions wait until the full
-- week is no longer competitively sensitive.
drop policy if exists admin_actions_read on public.admin_actions;
create policy admin_actions_read_after_reveal
on public.admin_actions
for select
to authenticated
using (
  public.admin_can_manage(pool_id)
  and (
    action not in ('draft_upsert','draft_clear','draft_cleared')
    or public.pick_deadline_has_passed(pool_id, null, week)
  )
);

-- Preserve the commissioner overview's operational fields while redacting
-- team values for another entry until the pick itself is revealed.
alter function public.admin_pool_entry_week_overview(uuid,integer)
  rename to admin_pool_entry_week_overview_unredacted_internal;

create function public.admin_pool_entry_week_overview(p_pool_id uuid,p_week integer)
returns table(
  entry_id uuid,user_id uuid,entry_number integer,entry_name text,display_name text,
  role text,joined_at timestamptz,slot integer,draft_team_abbr text,
  draft_updated_at timestamptz,final_team_abbr text,locked_at timestamptz,
  result text,wins integer,losses integer,pushes integer,strikes_used integer,
  eliminated boolean,eliminated_week integer
)
language sql
stable
security definer
set search_path = 'public'
as $function$
  select row.entry_id,row.user_id,row.entry_number,row.entry_name,row.display_name,
    row.role,row.joined_at,row.slot,
    case when row.user_id = auth.uid() then row.draft_team_abbr else null end,
    row.draft_updated_at,
    case when row.user_id = auth.uid()
      or public.pick_deadline_has_passed(p_pool_id,row.locked_at,p_week)
      then row.final_team_abbr else null end,
    row.locked_at,
    case when row.user_id = auth.uid()
      or public.pick_deadline_has_passed(p_pool_id,row.locked_at,p_week)
      then row.result else null end,
    row.wins,row.losses,row.pushes,row.strikes_used,row.eliminated,row.eliminated_week
  from public.admin_pool_entry_week_overview_unredacted_internal(p_pool_id,p_week) row;
$function$;

revoke all on function public.admin_pool_entry_week_overview_unredacted_internal(uuid,integer) from public,anon,authenticated;
revoke all on function public.admin_pool_entry_week_overview(uuid,integer) from public,anon;
grant execute on function public.admin_pool_entry_week_overview_unredacted_internal(uuid,integer) to service_role;
grant execute on function public.admin_pool_entry_week_overview(uuid,integer) to authenticated,service_role;

-- Apply the same redaction to the season-long entry audit.
alter function public.admin_pool_entry_audit(uuid)
  rename to admin_pool_entry_audit_unredacted_internal;

create function public.admin_pool_entry_audit(p_pool_id uuid)
returns table(
  entry_id uuid,user_id uuid,entry_number integer,display_name text,week integer,
  slot integer,pick_state text,draft_team_abbr text,draft_updated_at timestamptz,
  final_team_abbr text,locked_at timestamptz,result text,strikes_after_week integer,
  strikes_left_after_week integer,status_after_week text,eliminated_week integer,issue text
)
language sql
stable
security definer
set search_path = 'public'
as $function$
  select row.entry_id,row.user_id,row.entry_number,row.display_name,row.week,row.slot,
    row.pick_state,
    case when row.user_id = auth.uid() then row.draft_team_abbr else null end,
    row.draft_updated_at,
    case when row.user_id = auth.uid()
      or public.pick_deadline_has_passed(p_pool_id,row.locked_at,row.week)
      then row.final_team_abbr else null end,
    row.locked_at,
    case when row.user_id = auth.uid()
      or public.pick_deadline_has_passed(p_pool_id,row.locked_at,row.week)
      then row.result else null end,
    row.strikes_after_week,row.strikes_left_after_week,row.status_after_week,
    row.eliminated_week,row.issue
  from public.admin_pool_entry_audit_unredacted_internal(p_pool_id) row;
$function$;

revoke all on function public.admin_pool_entry_audit_unredacted_internal(uuid) from public,anon,authenticated;
revoke all on function public.admin_pool_entry_audit(uuid) from public,anon;
grant execute on function public.admin_pool_entry_audit_unredacted_internal(uuid) to service_role;
grant execute on function public.admin_pool_entry_audit(uuid) to authenticated,service_role;

-- The dispute ledger remains intact. Commissioners can see that a submission
-- happened, but its summary/details are redacted until that pick's deadline.
alter function public.commissioner_dispute_history(uuid,uuid,integer)
  rename to commissioner_dispute_history_unredacted_internal;

create function public.commissioner_dispute_history(
  p_pool_id uuid,p_entry_id uuid default null,p_limit integer default 100
)
returns table(
  event_id uuid,event_at timestamptz,event_type text,entry_id uuid,entry_label text,
  actor_name text,subject_name text,week integer,slot integer,summary text,
  server_effective_at timestamptz,applicable_deadline_at timestamptz,details jsonb
)
language sql
stable
security definer
set search_path = 'public'
as $function$
  select row.event_id,row.event_at,row.event_type,row.entry_id,row.entry_label,
    row.actor_name,row.subject_name,row.week,row.slot,
    case when sensitive.is_sensitive and not reveal.can_reveal
      then 'Pick activity recorded; team hidden until its deadline.'
      else row.summary end,
    row.server_effective_at,row.applicable_deadline_at,
    case when sensitive.is_sensitive and not reveal.can_reveal
      then jsonb_build_object('hidden_until_lock',true)
      else row.details end
  from public.commissioner_dispute_history_unredacted_internal(p_pool_id,p_entry_id,p_limit) row
  cross join lateral (
    select row.event_type in (
      'draft_saved','draft_cleared','pick_save_rejected','pick_clear_rejected',
      'pick_locked','pick_changed','commissioner_draft_upsert',
      'commissioner_draft_clear','commissioner_draft_cleared'
    ) as is_sensitive
  ) sensitive
  cross join lateral (
    select
      exists (
        select 1 from public.pool_members own_entry
        where own_entry.pool_id = p_pool_id
          and own_entry.id = row.entry_id
          and own_entry.profile_id = auth.uid()
      )
      or public.pick_deadline_has_passed(
        p_pool_id,row.applicable_deadline_at,row.week
      ) as can_reveal
  ) reveal;
$function$;

revoke all on function public.commissioner_dispute_history_unredacted_internal(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.commissioner_dispute_history(uuid,uuid,integer) from public,anon;
grant execute on function public.commissioner_dispute_history_unredacted_internal(uuid,uuid,integer) to service_role;
grant execute on function public.commissioner_dispute_history(uuid,uuid,integer) to authenticated,service_role;

commit;
