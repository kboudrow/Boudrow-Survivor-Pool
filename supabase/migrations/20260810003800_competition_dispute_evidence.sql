begin;

-- One small append-only ledger makes the existing pick/admin/removal evidence
-- and new setting/lifecycle evidence easy to investigate together. It stores
-- competition facts and chosen display labels only; never emails, passwords,
-- IP addresses, user agents, or payment data.
create table if not exists public.pool_dispute_events (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null,
  event_type text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  server_effective_at timestamptz,
  actor_user_id uuid,
  subject_user_id uuid,
  entry_id uuid,
  week integer check(week is null or week between 1 and 22),
  slot integer check(slot is null or slot between 1 and 2),
  summary text not null,
  applicable_deadline_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  source_table text,
  source_event_id uuid
);
create index if not exists idx_pool_dispute_events_pool_time
on public.pool_dispute_events(pool_id,occurred_at desc);
create index if not exists idx_pool_dispute_events_pool_entry_time
on public.pool_dispute_events(pool_id,entry_id,occurred_at desc)
where entry_id is not null;
create unique index if not exists pool_dispute_events_source_unique
on public.pool_dispute_events(source_table,source_event_id)
where source_table is not null and source_event_id is not null;
alter table public.pool_dispute_events enable row level security;
revoke all on public.pool_dispute_events from public,anon,authenticated;
grant select,insert on public.pool_dispute_events to service_role;

-- Keep the exact server-side deadline evidence with every pick event. This
-- survives later draft deletion, locked-pick correction, and result reruns.
alter table public.pick_save_events add column if not exists locked_at timestamptz;
alter table public.pick_save_events add column if not exists submitted_at timestamptz;
alter table public.pick_save_events add column if not exists applicable_deadline_at timestamptz;
alter table public.pick_save_events add column if not exists server_effective_at timestamptz;
alter table public.pick_save_events add column if not exists rules_snapshot jsonb;
alter table public.pick_save_events add column if not exists submission_evidence_source text;
revoke insert,update,delete on public.pick_save_events from anon,authenticated;

create or replace function public.log_pick_save_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
declare
  v_action text; v_pool_id uuid; v_user_id uuid; v_entry_id uuid;
  v_week integer; v_slot integer; v_old_team text; v_new_team text;
  v_result text; v_old_result text; v_new_result text;
  v_locked_at timestamptz; v_submitted_at timestamptz; v_deadline timestamptz;
  v_effective_at timestamptz; v_rules jsonb; v_evidence_source text;
  v_team text; v_pool public.pools%rowtype;
begin
  if tg_table_name='pool_pick_drafts' then
    if tg_op='INSERT' then v_action:='draft_saved';
    elsif tg_op='UPDATE' and old.team_abbr is distinct from new.team_abbr then v_action:='draft_saved';
    elsif tg_op='DELETE' then v_action:='draft_cleared'; else return new; end if;
  else
    if tg_op='INSERT' then v_action:='pick_locked';
    elsif tg_op='UPDATE' and (old.team_abbr is distinct from new.team_abbr or old.result is distinct from new.result) then v_action:='pick_changed';
    elsif tg_op='DELETE' then v_action:='pick_deleted'; else return new; end if;
  end if;

  if tg_op='DELETE' then
    v_pool_id:=old.pool_id; v_user_id:=old.user_id; v_entry_id:=old.entry_id;
    v_week:=old.week; v_slot:=old.slot; v_old_team:=old.team_abbr; v_team:=old.team_abbr;
    if tg_table_name='pool_picks' then
      v_old_result:=old.result; v_locked_at:=old.locked_at; v_submitted_at:=old.submitted_at;
      v_deadline:=old.applicable_deadline_at; v_rules:=old.rules_snapshot;
      v_evidence_source:=old.submission_evidence_source;
    end if;
  elsif tg_op='INSERT' then
    v_pool_id:=new.pool_id; v_user_id:=new.user_id; v_entry_id:=new.entry_id;
    v_week:=new.week; v_slot:=new.slot; v_new_team:=new.team_abbr; v_team:=new.team_abbr;
    if tg_table_name='pool_picks' then
      v_new_result:=new.result; v_locked_at:=new.locked_at; v_submitted_at:=new.submitted_at;
      v_deadline:=new.applicable_deadline_at; v_rules:=new.rules_snapshot;
      v_evidence_source:=new.submission_evidence_source;
    end if;
  else
    v_pool_id:=new.pool_id; v_user_id:=new.user_id; v_entry_id:=new.entry_id;
    v_week:=new.week; v_slot:=new.slot; v_old_team:=old.team_abbr; v_new_team:=new.team_abbr; v_team:=new.team_abbr;
    if tg_table_name='pool_picks' then
      v_old_result:=old.result; v_new_result:=new.result; v_locked_at:=new.locked_at;
      v_submitted_at:=new.submitted_at; v_deadline:=new.applicable_deadline_at;
      v_rules:=new.rules_snapshot; v_evidence_source:=new.submission_evidence_source;
    end if;
  end if;
  v_result:=coalesce(v_new_result,v_old_result);
  v_effective_at:=public.pool_effective_now(v_pool_id);

  if tg_table_name='pool_pick_drafts' then
    select * into v_pool from public.pools p where p.id=v_pool_id;
    select case when coalesce(v_pool.deadline_mode,'fixed')='fixed'
        then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(v_pool_id,v_week))
        else coalesce(g.kickoff_at_utc,g.game_time) end
      into v_deadline from public.pool_week_games(v_pool_id,v_week) g
      where upper(v_team) in (upper(g.home_team),upper(g.away_team))
      order by coalesce(g.kickoff_at_utc,g.game_time) limit 1;
    v_submitted_at:=case when tg_op='DELETE' then old.updated_at else new.updated_at end;
    v_evidence_source:='draft_updated_at';
    v_rules:=jsonb_build_object(
      'season',v_pool.season,'start_week',v_pool.start_week,'include_playoffs',v_pool.include_playoffs,
      'mulligans',v_pool.mulligans,'tie_rule',v_pool.tie_rule,'deadline_mode',v_pool.deadline_mode,
      'deadline_fixed',v_pool.deadline_fixed,'double_pick_weeks',v_pool.double_pick_weeks,
      'required_picks',public.picks_allowed(v_pool_id,v_week));
  end if;

  insert into public.pick_save_events(
    pool_id,user_id,actor_user_id,entry_id,source_table,action,week,slot,
    old_team_abbr,new_team_abbr,result,old_result,new_result,locked_at,submitted_at,
    applicable_deadline_at,server_effective_at,rules_snapshot,submission_evidence_source
  ) values(
    v_pool_id,v_user_id,auth.uid(),v_entry_id,tg_table_name,v_action,v_week,coalesce(v_slot,1),
    v_old_team,v_new_team,v_result,v_old_result,v_new_result,v_locked_at,v_submitted_at,
    v_deadline,v_effective_at,v_rules,v_evidence_source);
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

-- A commissioner correction must not replace the original participant's
-- submission timestamp, deadline, or rule snapshot. The correction itself is
-- separately timestamped and reasoned in admin_actions.
create or replace function public.capture_locked_pick_history()
returns trigger language plpgsql security definer set search_path='public' as $function$
declare v_draft_saved_at timestamptz; v_deadline timestamptz; v_rules jsonb;
begin
  if tg_op='INSERT' then
    select d.updated_at into v_draft_saved_at from public.pool_pick_drafts d
      where d.pool_id=new.pool_id and d.entry_id=new.entry_id and d.week=new.week and d.slot=new.slot;
    select case when p.deadline_mode='fixed'
        then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(p.id,new.week))
        else coalesce(g.kickoff_at_utc,g.game_time) end,
      jsonb_build_object('season',p.season,'start_week',p.start_week,'include_playoffs',p.include_playoffs,
        'mulligans',p.mulligans,'tie_rule',p.tie_rule,'deadline_mode',p.deadline_mode,
        'deadline_fixed',p.deadline_fixed,'double_pick_weeks',p.double_pick_weeks,
        'required_picks',public.picks_allowed(p.id,new.week))
      into v_deadline,v_rules
    from public.pools p left join lateral(
      select game.* from public.pool_week_games(p.id,new.week) game
      where upper(new.team_abbr) in (upper(game.home_team),upper(game.away_team)) limit 1
    ) g on true where p.id=new.pool_id;
    new.submitted_at:=coalesce(new.submitted_at,v_draft_saved_at);
    new.submission_evidence_source:=coalesce(new.submission_evidence_source,
      case when v_draft_saved_at is not null then 'draft_updated_at' else 'not_available' end);
    new.applicable_deadline_at:=v_deadline; new.rules_snapshot:=v_rules;
  else
    new.submitted_at:=old.submitted_at;
    new.submission_evidence_source:=old.submission_evidence_source;
    new.applicable_deadline_at:=old.applicable_deadline_at;
    new.rules_snapshot:=old.rules_snapshot;
  end if;
  return new;
end;
$function$;

create or replace function public.mirror_pick_dispute_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
begin
  insert into public.pool_dispute_events(pool_id,event_type,occurred_at,server_effective_at,
    actor_user_id,subject_user_id,entry_id,week,slot,summary,applicable_deadline_at,details,source_table,source_event_id)
  values(new.pool_id,new.action,new.created_at,new.server_effective_at,new.actor_user_id,new.user_id,
    new.entry_id,new.week,new.slot,
    case new.action
      when 'draft_saved' then 'Participant saved '||coalesce(new.new_team_abbr,'a pick')||'.'
      when 'draft_cleared' then 'Participant cleared '||coalesce(new.old_team_abbr,'a saved pick')||'.'
      when 'pick_locked' then 'Saved pick locked as '||coalesce(new.new_team_abbr,'unknown')||'.'
      when 'pick_changed' then 'Official pick or result changed from '||coalesce(new.old_team_abbr,new.old_result,'-')||' to '||coalesce(new.new_team_abbr,new.new_result,'-')||'.'
      else 'Official pick record was removed.' end,
    new.applicable_deadline_at,
    jsonb_strip_nulls(jsonb_build_object('old_team',new.old_team_abbr,'new_team',new.new_team_abbr,
      'old_result',new.old_result,'new_result',new.new_result,'locked_at',new.locked_at,
      'submitted_at',new.submitted_at,'rules',new.rules_snapshot,
      'submission_evidence_source',new.submission_evidence_source)),
    'pick_save_events',new.id)
  on conflict(source_table,source_event_id) where source_table is not null and source_event_id is not null do nothing;
  return new;
end;
$function$;
drop trigger if exists trg_mirror_pick_dispute_event on public.pick_save_events;
create trigger trg_mirror_pick_dispute_event after insert on public.pick_save_events
for each row execute function public.mirror_pick_dispute_event();

create or replace function public.mirror_admin_dispute_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
begin
  insert into public.pool_dispute_events(pool_id,event_type,occurred_at,actor_user_id,subject_user_id,
    entry_id,week,slot,summary,details,source_table,source_event_id)
  values(new.pool_id,'commissioner_'||new.action,new.created_at,new.admin_id,new.target_user_id,new.entry_id,new.week,new.slot,
    'Commissioner changed the official pick from '||coalesce(new.old_team_abbr,'-')||' to '||coalesce(new.new_team_abbr,'-')||'.',
    jsonb_strip_nulls(jsonb_build_object('old_team',new.old_team_abbr,'new_team',new.new_team_abbr,'reason',new.reason)),
    'admin_actions',new.id)
  on conflict(source_table,source_event_id) where source_table is not null and source_event_id is not null do nothing;
  return new;
end;
$function$;
drop trigger if exists trg_mirror_admin_dispute_event on public.admin_actions;
create trigger trg_mirror_admin_dispute_event after insert on public.admin_actions
for each row execute function public.mirror_admin_dispute_event();

create or replace function public.mirror_removal_dispute_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
begin
  insert into public.pool_dispute_events(pool_id,event_type,occurred_at,actor_user_id,subject_user_id,
    entry_id,summary,details,source_table,source_event_id)
  values(new.pool_id,new.removal_type,new.created_at,new.actor_user_id,new.subject_user_id,new.entry_id,
    case when new.removal_type='member_left' then 'Participant left the pool.'
      when new.removal_type='member_removed' then 'Commissioner removed the participant and all entries.'
      else 'An entry was removed from the pool.' end,
    jsonb_build_object('entries_removed',new.entries_removed,'drafts_removed',new.drafts_removed,
      'locked_picks_removed',new.locked_picks_removed),
    'pool_roster_removal_events',new.id)
  on conflict(source_table,source_event_id) where source_table is not null and source_event_id is not null do nothing;
  return new;
end;
$function$;
drop trigger if exists trg_mirror_removal_dispute_event on public.pool_roster_removal_events;
create trigger trg_mirror_removal_dispute_event after insert on public.pool_roster_removal_events
for each row execute function public.mirror_removal_dispute_event();

-- Record every relevant commissioner setting transition after this migration.
-- Password hashes are compared only to emit password_changed=true; they are
-- never copied into the ledger.
create or replace function public.log_pool_setting_dispute_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
declare v_old jsonb; v_new jsonb; v_changed text[]; v_event text;
begin
  v_new:=jsonb_build_object('name',new.name,'season',new.season,'start_week',new.start_week,
    'include_playoffs',new.include_playoffs,'mulligans',new.mulligans,'tie_rule',new.tie_rule,
    'deadline_mode',new.deadline_mode,'deadline_fixed',new.deadline_fixed,
    'double_pick_weeks',new.double_pick_weeks,'max_members',new.max_members,
    'allow_multiple_entries',new.allow_multiple_entries,'max_entries_per_user',new.max_entries_per_user,
    'is_public',new.is_public,'allow_discovery',new.allow_discovery,'notes',new.notes,
    'pick_privacy',new.pick_privacy,'activation_status',new.activation_status,'archived',new.archived,
    'image_url',new.image_url,
    'password_changed',case when tg_op='INSERT' then not new.is_public
      else row(new.join_password_hash,new.password_hash,new.private_password_hash)
        is distinct from row(old.join_password_hash,old.password_hash,old.private_password_hash) end);
  if tg_op='INSERT' then
    v_event:='pool_created'; v_old:='{}'::jsonb;
    select array_agg(k order by k) into v_changed from jsonb_object_keys(v_new) as k;
  else
    v_event:='pool_settings_changed';
    v_old:=jsonb_build_object('name',old.name,'season',old.season,'start_week',old.start_week,
      'include_playoffs',old.include_playoffs,'mulligans',old.mulligans,'tie_rule',old.tie_rule,
      'deadline_mode',old.deadline_mode,'deadline_fixed',old.deadline_fixed,
      'double_pick_weeks',old.double_pick_weeks,'max_members',old.max_members,
      'allow_multiple_entries',old.allow_multiple_entries,'max_entries_per_user',old.max_entries_per_user,
      'is_public',old.is_public,'allow_discovery',old.allow_discovery,'notes',old.notes,
      'pick_privacy',old.pick_privacy,'activation_status',old.activation_status,'archived',old.archived,
      'image_url',old.image_url,'password_changed',false);
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n left join jsonb_each(v_old) o on o.key=n.key
    where n.value is distinct from o.value;
    if coalesce(array_length(v_changed,1),0)=0 then return new; end if;
  end if;
  insert into public.pool_dispute_events(pool_id,event_type,actor_user_id,summary,details)
  values(new.id,v_event,auth.uid(),case when v_event='pool_created' then 'Pool created with its initial rules.'
    else 'Pool settings changed: '||array_to_string(v_changed,', ')||'.' end,
    jsonb_build_object('changed_fields',v_changed,'before',v_old,'after',v_new));
  return new;
end;
$function$;
drop trigger if exists trg_log_pool_setting_dispute_event on public.pools;
create trigger trg_log_pool_setting_dispute_event after insert or update on public.pools
for each row execute function public.log_pool_setting_dispute_event();

insert into public.pool_dispute_events(pool_id,event_type,summary,details)
select p.id,'pool_settings_baseline','Current pool rules recorded when dispute history was enabled.',
  jsonb_build_object('after',jsonb_build_object('name',p.name,'season',p.season,'start_week',p.start_week,
    'include_playoffs',p.include_playoffs,'mulligans',p.mulligans,'tie_rule',p.tie_rule,
    'deadline_mode',p.deadline_mode,'deadline_fixed',p.deadline_fixed,'double_pick_weeks',p.double_pick_weeks,
    'max_members',p.max_members,'allow_multiple_entries',p.allow_multiple_entries,
    'max_entries_per_user',p.max_entries_per_user,'is_public',p.is_public,
    'allow_discovery',p.allow_discovery,'notes',p.notes,'pick_privacy',p.pick_privacy,
    'activation_status',p.activation_status,'archived',p.archived,'image_url',p.image_url))
from public.pools p
where not exists(select 1 from public.pool_dispute_events e
  where e.pool_id=p.id and e.event_type='pool_settings_baseline');

-- Entry ownership, identity, role, and status are now durable even if the live
-- membership row is later removed.
create or replace function public.log_pool_entry_dispute_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
declare v_event text; v_row public.pool_members%rowtype; v_before jsonb; v_after jsonb;
begin
  v_row:=case when tg_op='DELETE' then old else new end;
  if tg_op='INSERT' then v_event:='entry_created';
  elsif tg_op='DELETE' then v_event:='entry_deleted';
  elsif old.profile_id is distinct from new.profile_id then v_event:='entry_owner_changed';
  elsif row(old.status,old.eliminated_week,old.lives_remaining) is distinct from row(new.status,new.eliminated_week,new.lives_remaining) then v_event:='entry_status_changed';
  elsif row(old.entry_number,old.entry_name) is distinct from row(new.entry_number,new.entry_name) then v_event:='entry_identity_changed';
  elsif old.role is distinct from new.role then v_event:='entry_role_changed'; else return new; end if;
  if tg_op<>'INSERT' then v_before:=jsonb_build_object('entry_number',old.entry_number,'entry_name',old.entry_name,
    'role',old.role,'status',old.status,'eliminated_week',old.eliminated_week,'lives_remaining',old.lives_remaining); end if;
  if tg_op<>'DELETE' then v_after:=jsonb_build_object('entry_number',new.entry_number,'entry_name',new.entry_name,
    'role',new.role,'status',new.status,'eliminated_week',new.eliminated_week,'lives_remaining',new.lives_remaining); end if;
  insert into public.pool_dispute_events(pool_id,event_type,actor_user_id,subject_user_id,entry_id,summary,details)
  values(v_row.pool_id,v_event,auth.uid(),v_row.profile_id,v_row.id,
    case v_event when 'entry_created' then 'Entry joined the pool.' when 'entry_deleted' then 'Entry record was removed.'
      when 'entry_status_changed' then 'Entry status changed.' when 'entry_owner_changed' then 'Entry ownership changed.'
      when 'entry_role_changed' then 'Entry role changed.' else 'Entry name or number changed.' end,
    jsonb_strip_nulls(jsonb_build_object('before',v_before,'after',v_after,
      'entry_number',v_row.entry_number,'entry_name',v_row.entry_name)));
  return case when tg_op='DELETE' then old else new end;
end;
$function$;
drop trigger if exists trg_log_pool_entry_dispute_event on public.pool_members;
create trigger trg_log_pool_entry_dispute_event after insert or update or delete on public.pool_members
for each row execute function public.log_pool_entry_dispute_event();

-- Mulligan consumption and elimination are deterministic, but this material
-- transition record makes rerun/idempotency disputes much easier to inspect.
create or replace function public.log_pool_entry_state_dispute_event()
returns trigger language plpgsql security definer set search_path='public' as $function$
declare v_before jsonb; v_after jsonb;
begin
  v_after:=jsonb_build_object('wins',new.wins,'losses',new.losses,'pushes',new.pushes,
    'mulligans_used',new.strikes_used,'eliminated',new.eliminated,'eliminated_week',new.eliminated_week);
  if tg_op='UPDATE' then
    v_before:=jsonb_build_object('wins',old.wins,'losses',old.losses,'pushes',old.pushes,
      'mulligans_used',old.strikes_used,'eliminated',old.eliminated,'eliminated_week',old.eliminated_week);
    if v_before=v_after then return new; end if;
  end if;
  insert into public.pool_dispute_events(pool_id,event_type,actor_user_id,subject_user_id,entry_id,summary,details)
  values(new.pool_id,case when tg_op='INSERT' then 'entry_standing_initialized' else 'entry_standing_changed' end,
    auth.uid(),new.user_id,new.entry_id,
    case when tg_op='INSERT' then 'Entry standing initialized.'
      when coalesce((v_before->>'eliminated')::boolean,false)=false and new.eliminated then 'Entry was eliminated.'
      when coalesce((v_before->>'mulligans_used')::integer,0)<>new.strikes_used then 'Mulligan usage changed.'
      else 'Entry standing changed after result processing.' end,
    jsonb_strip_nulls(jsonb_build_object('before',v_before,'after',v_after)));
  return new;
end;
$function$;
drop trigger if exists trg_log_pool_entry_state_dispute_event on public.pool_member_stats;
create trigger trg_log_pool_entry_state_dispute_event after insert or update on public.pool_member_stats
for each row execute function public.log_pool_entry_state_dispute_event();

-- The normal pick UI uses these receipt wrappers. A rejected request is caught
-- in an inner subtransaction, then a trustworthy server-time/deadline receipt
-- is committed instead of disappearing with the exception.
create or replace function public.save_entry_draft_pick_with_receipt(
  p_pool_id uuid,p_entry_id uuid,p_week integer,p_slot integer,p_team_abbr text)
returns table(success boolean,error_message text,saved_at timestamptz,applicable_deadline_at timestamptz)
language plpgsql security definer set search_path='public' as $function$
declare v_error text; v_saved timestamptz; v_deadline timestamptz; v_effective timestamptz;
begin
  v_effective:=public.pool_effective_now(p_pool_id);
  begin
    perform public.save_entry_draft_pick(p_pool_id,p_entry_id,p_week,p_slot,p_team_abbr);
  exception when others then
    get stacked diagnostics v_error=message_text;
    select case when p.deadline_mode='fixed' then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(p_pool_id,p_week))
      else coalesce(g.kickoff_at_utc,g.game_time) end into v_deadline
    from public.pools p left join lateral(select game.* from public.pool_week_games(p_pool_id,p_week) game
      where upper(btrim(p_team_abbr)) in (upper(game.home_team),upper(game.away_team)) limit 1) g on true where p.id=p_pool_id;
    if exists(select 1 from public.pool_members pm where pm.pool_id=p_pool_id and pm.id=p_entry_id and pm.profile_id=auth.uid()) then
      insert into public.pool_dispute_events(pool_id,event_type,server_effective_at,actor_user_id,subject_user_id,
        entry_id,week,slot,summary,applicable_deadline_at,details)
      values(p_pool_id,'pick_save_rejected',v_effective,auth.uid(),auth.uid(),p_entry_id,p_week,p_slot,
        'Server rejected a pick save: '||v_error,v_deadline,
        jsonb_build_object('requested_team',upper(btrim(p_team_abbr)),'reason',v_error));
    end if;
    return query select false,v_error,null::timestamptz,v_deadline; return;
  end;
  select d.updated_at into v_saved from public.pool_pick_drafts d
    where d.pool_id=p_pool_id and d.entry_id=p_entry_id and d.week=p_week and d.slot=p_slot;
  select e.applicable_deadline_at into v_deadline from public.pick_save_events e
    where e.pool_id=p_pool_id and e.entry_id=p_entry_id and e.week=p_week and e.slot=p_slot
      and e.action='draft_saved' order by e.created_at desc limit 1;
  return query select true,null::text,v_saved,v_deadline;
end;
$function$;

create or replace function public.clear_entry_draft_pick_with_receipt(
  p_pool_id uuid,p_entry_id uuid,p_week integer,p_slot integer)
returns table(success boolean,error_message text,saved_at timestamptz,applicable_deadline_at timestamptz)
language plpgsql security definer set search_path='public' as $function$
declare v_error text; v_team text; v_deadline timestamptz; v_effective timestamptz;
begin
  v_effective:=public.pool_effective_now(p_pool_id);
  select d.team_abbr into v_team from public.pool_pick_drafts d
    where d.pool_id=p_pool_id and d.entry_id=p_entry_id and d.week=p_week and d.slot=p_slot;
  begin
    perform public.clear_entry_draft_pick(p_pool_id,p_entry_id,p_week,p_slot);
  exception when others then
    get stacked diagnostics v_error=message_text;
    select case when p.deadline_mode='fixed' then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(p_pool_id,p_week))
      else coalesce(g.kickoff_at_utc,g.game_time) end into v_deadline
    from public.pools p left join lateral(select game.* from public.pool_week_games(p_pool_id,p_week) game
      where upper(v_team) in (upper(game.home_team),upper(game.away_team)) limit 1) g on true where p.id=p_pool_id;
    if exists(select 1 from public.pool_members pm where pm.pool_id=p_pool_id and pm.id=p_entry_id and pm.profile_id=auth.uid()) then
      insert into public.pool_dispute_events(pool_id,event_type,server_effective_at,actor_user_id,subject_user_id,
        entry_id,week,slot,summary,applicable_deadline_at,details)
      values(p_pool_id,'pick_clear_rejected',v_effective,auth.uid(),auth.uid(),p_entry_id,p_week,p_slot,
        'Server rejected a pick clear: '||v_error,v_deadline,jsonb_build_object('saved_team',v_team,'reason',v_error));
    end if;
    return query select false,v_error,null::timestamptz,v_deadline; return;
  end;
  return query select true,null::text,clock_timestamp(),v_deadline;
end;
$function$;

-- Bring existing durable evidence into the unified timeline. Old rows retain
-- null where the legacy system did not have trustworthy timing evidence.
insert into public.pool_dispute_events(pool_id,event_type,occurred_at,server_effective_at,actor_user_id,
  subject_user_id,entry_id,week,slot,summary,applicable_deadline_at,details,source_table,source_event_id)
select e.pool_id,e.action,e.created_at,e.server_effective_at,e.actor_user_id,e.user_id,e.entry_id,e.week,e.slot,
  'Historical '||replace(e.action,'_',' ')||' event.',e.applicable_deadline_at,
  jsonb_strip_nulls(jsonb_build_object('old_team',e.old_team_abbr,'new_team',e.new_team_abbr,
    'old_result',e.old_result,'new_result',e.new_result,'locked_at',e.locked_at,
    'submitted_at',e.submitted_at,'rules',e.rules_snapshot)),'pick_save_events',e.id
from public.pick_save_events e on conflict(source_table,source_event_id) where source_table is not null and source_event_id is not null do nothing;

insert into public.pool_dispute_events(pool_id,event_type,occurred_at,actor_user_id,subject_user_id,
  entry_id,week,slot,summary,details,source_table,source_event_id)
select a.pool_id,'commissioner_'||a.action,a.created_at,a.admin_id,a.target_user_id,a.entry_id,a.week,a.slot,
  'Historical commissioner correction from '||coalesce(a.old_team_abbr,'-')||' to '||coalesce(a.new_team_abbr,'-')||'.',
  jsonb_strip_nulls(jsonb_build_object('old_team',a.old_team_abbr,'new_team',a.new_team_abbr,'reason',a.reason)),
  'admin_actions',a.id from public.admin_actions a
on conflict(source_table,source_event_id) where source_table is not null and source_event_id is not null do nothing;

insert into public.pool_dispute_events(pool_id,event_type,occurred_at,actor_user_id,subject_user_id,
  entry_id,summary,details,source_table,source_event_id)
select r.pool_id,r.removal_type,r.created_at,r.actor_user_id,r.subject_user_id,r.entry_id,
  'Historical roster removal event.',jsonb_build_object('entries_removed',r.entries_removed,
    'drafts_removed',r.drafts_removed,'locked_picks_removed',r.locked_picks_removed),
  'pool_roster_removal_events',r.id from public.pool_roster_removal_events r
on conflict(source_table,source_event_id) where source_table is not null and source_event_id is not null do nothing;

create or replace function public.commissioner_dispute_history(
  p_pool_id uuid,p_entry_id uuid default null,p_limit integer default 100)
returns table(event_id uuid,event_at timestamptz,event_type text,entry_id uuid,entry_label text,
  actor_name text,subject_name text,week integer,slot integer,summary text,
  server_effective_at timestamptz,applicable_deadline_at timestamptz,details jsonb)
language plpgsql stable security definer set search_path='public' as $function$
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  return query
  select e.id,e.occurred_at,e.event_type,e.entry_id,
    case when e.entry_id is null then null else
      coalesce(nullif(pm.entry_name,''),'Entry '||coalesce(pm.entry_number,(e.details->>'entry_number')::integer,1)::text,'Former entry') end::text,
    coalesce(nullif(ap.username,''),nullif(ap.display_name,''),case when e.actor_user_id is null then 'System' else 'Commissioner or participant' end)::text,
    coalesce(nullif(sp.username,''),nullif(sp.display_name,''),case when e.subject_user_id is null then null else 'Participant' end)::text,
    e.week,e.slot,e.summary,e.server_effective_at,e.applicable_deadline_at,e.details
  from public.pool_dispute_events e
  left join public.pool_members pm on pm.pool_id=e.pool_id and pm.id=e.entry_id
  left join public.profiles ap on ap.id=e.actor_user_id
  left join public.profiles sp on sp.id=e.subject_user_id
  where e.pool_id=p_pool_id and (p_entry_id is null or e.entry_id=p_entry_id)
  order by e.occurred_at desc,e.id desc limit least(greatest(coalesce(p_limit,100),1),500);
end;
$function$;

revoke all on function public.save_entry_draft_pick_with_receipt(uuid,uuid,integer,integer,text) from public,anon;
revoke all on function public.clear_entry_draft_pick_with_receipt(uuid,uuid,integer,integer) from public,anon;
revoke all on function public.commissioner_dispute_history(uuid,uuid,integer) from public,anon;
grant execute on function public.save_entry_draft_pick_with_receipt(uuid,uuid,integer,integer,text) to authenticated,service_role;
grant execute on function public.clear_entry_draft_pick_with_receipt(uuid,uuid,integer,integer) to authenticated,service_role;
grant execute on function public.commissioner_dispute_history(uuid,uuid,integer) to authenticated,service_role;

revoke all on function public.mirror_pick_dispute_event() from public,anon,authenticated;
revoke all on function public.mirror_admin_dispute_event() from public,anon,authenticated;
revoke all on function public.mirror_removal_dispute_event() from public,anon,authenticated;
revoke all on function public.log_pool_setting_dispute_event() from public,anon,authenticated;
revoke all on function public.log_pool_entry_dispute_event() from public,anon,authenticated;
revoke all on function public.log_pool_entry_state_dispute_event() from public,anon,authenticated;
grant execute on function public.mirror_pick_dispute_event() to service_role;
grant execute on function public.mirror_admin_dispute_event() to service_role;
grant execute on function public.mirror_removal_dispute_event() to service_role;
grant execute on function public.log_pool_setting_dispute_event() to service_role;
grant execute on function public.log_pool_entry_dispute_event() to service_role;
grant execute on function public.log_pool_entry_state_dispute_event() to service_role;

commit;
