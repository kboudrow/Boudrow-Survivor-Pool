begin;

-- Preserve entry-scoped evidence for future deadline disputes. Older audit
-- events did not identify the entry, which is ambiguous for multi-entry users.
alter table public.pick_save_events add column if not exists entry_id uuid;
alter table public.pick_save_events add column if not exists old_result text;
alter table public.pick_save_events add column if not exists new_result text;

alter table public.pick_save_events drop constraint if exists pick_save_events_user_id_fkey;
alter table public.pick_save_events alter column user_id drop not null;
alter table public.pick_save_events
  add constraint pick_save_events_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

with candidates as (
  select event.id,(array_agg(distinct pick.entry_id))[1] as entry_id
  from public.pick_save_events event
  join public.pool_picks pick on pick.pool_id=event.pool_id and pick.user_id=event.user_id
    and pick.week=event.week and pick.slot=event.slot
    and (event.new_team_abbr is null or pick.team_abbr=event.new_team_abbr)
  where event.entry_id is null
  group by event.id having count(distinct pick.entry_id)=1
)
update public.pick_save_events event set entry_id=candidates.entry_id
from candidates where candidates.id=event.id;

create index if not exists idx_pick_save_events_pool_entry_week
on public.pick_save_events(pool_id, entry_id, week, slot, created_at);

create or replace function public.log_pick_save_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_action text;
  v_pool_id uuid;
  v_user_id uuid;
  v_entry_id uuid;
  v_week integer;
  v_slot integer;
  v_old_team text;
  v_new_team text;
  v_result text;
  v_old_result text;
  v_new_result text;
begin
  if tg_table_name = 'pool_pick_drafts' then
    if tg_op = 'INSERT' then v_action := 'draft_saved';
    elsif tg_op = 'UPDATE' and old.team_abbr is distinct from new.team_abbr then v_action := 'draft_saved';
    elsif tg_op = 'DELETE' then v_action := 'draft_cleared';
    else return new;
    end if;
  else
    if tg_op = 'INSERT' then v_action := 'pick_locked';
    elsif tg_op = 'UPDATE' and (old.team_abbr is distinct from new.team_abbr or old.result is distinct from new.result) then v_action := 'pick_changed';
    elsif tg_op = 'DELETE' then v_action := 'pick_deleted';
    else return new;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_pool_id := old.pool_id; v_user_id := old.user_id; v_entry_id := old.entry_id;
    v_week := old.week; v_slot := old.slot; v_old_team := old.team_abbr;
    if tg_table_name = 'pool_picks' then v_old_result := old.result; end if;
  elsif tg_op = 'INSERT' then
    v_pool_id := new.pool_id; v_user_id := new.user_id; v_entry_id := new.entry_id;
    v_week := new.week; v_slot := new.slot; v_new_team := new.team_abbr;
    if tg_table_name = 'pool_picks' then v_new_result := new.result; end if;
  else
    v_pool_id := new.pool_id; v_user_id := new.user_id; v_entry_id := new.entry_id;
    v_week := new.week; v_slot := new.slot; v_old_team := old.team_abbr; v_new_team := new.team_abbr;
    if tg_table_name = 'pool_picks' then v_old_result := old.result; v_new_result := new.result; end if;
  end if;
  v_result := coalesce(v_new_result, v_old_result);

  insert into public.pick_save_events(
    pool_id,user_id,actor_user_id,entry_id,source_table,action,week,slot,
    old_team_abbr,new_team_abbr,result,old_result,new_result
  ) values (
    v_pool_id,v_user_id,auth.uid(),v_entry_id,tg_table_name,v_action,v_week,coalesce(v_slot,1),
    v_old_team,v_new_team,v_result,v_old_result,v_new_result
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

-- Store the evidence needed to answer when a locked pick was actually saved
-- and which authoritative deadline/rules applied to it.
alter table public.pool_picks add column if not exists submitted_at timestamptz;
alter table public.pool_picks add column if not exists applicable_deadline_at timestamptz;
alter table public.pool_picks add column if not exists rules_snapshot jsonb;
alter table public.pool_picks add column if not exists submission_evidence_source text;

create or replace function public.capture_locked_pick_history()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_draft_saved_at timestamptz;
  v_deadline timestamptz;
  v_rules jsonb;
begin
  if tg_op = 'INSERT' or old.team_abbr is distinct from new.team_abbr then
    select d.updated_at into v_draft_saved_at
    from public.pool_pick_drafts d
    where d.pool_id=new.pool_id and d.entry_id=new.entry_id and d.week=new.week and d.slot=new.slot;

    select
      case when p.deadline_mode='fixed'
        then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(p.id,new.week))
        else coalesce(g.kickoff_at_utc,g.game_time)
      end,
      jsonb_build_object(
        'season',p.season,'start_week',p.start_week,'include_playoffs',p.include_playoffs,
        'mulligans',p.mulligans,'tie_rule',p.tie_rule,'deadline_mode',p.deadline_mode,
        'deadline_fixed',p.deadline_fixed,'double_pick_weeks',p.double_pick_weeks,
        'required_picks',public.picks_allowed(p.id,new.week)
      )
    into v_deadline,v_rules
    from public.pools p
    left join lateral (
      select game.* from public.pool_week_games(p.id,new.week) game
      where upper(new.team_abbr) in (upper(game.home_team),upper(game.away_team))
      limit 1
    ) g on true
    where p.id=new.pool_id;

    new.submitted_at := coalesce(new.submitted_at,v_draft_saved_at);
    new.submission_evidence_source := coalesce(new.submission_evidence_source,
      case when v_draft_saved_at is not null then 'draft_updated_at' else 'not_available' end);
    new.applicable_deadline_at := v_deadline;
    new.rules_snapshot := v_rules;
  else
    if auth.uid() is null then
      new.submitted_at := coalesce(new.submitted_at,old.submitted_at);
      new.submission_evidence_source := coalesce(new.submission_evidence_source,old.submission_evidence_source);
      new.applicable_deadline_at := coalesce(new.applicable_deadline_at,old.applicable_deadline_at);
      new.rules_snapshot := coalesce(new.rules_snapshot,old.rules_snapshot);
    else
      new.submitted_at := old.submitted_at;
      new.submission_evidence_source := old.submission_evidence_source;
      new.applicable_deadline_at := old.applicable_deadline_at;
      new.rules_snapshot := old.rules_snapshot;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists aac_capture_locked_pick_history on public.pool_picks;
create trigger aac_capture_locked_pick_history
before insert or update on public.pool_picks
for each row execute function public.capture_locked_pick_history();

-- Backfill only evidence that can be attributed without guessing. Ambiguous
-- multi-entry history remains NULL rather than inventing a submission time.
with evidence as (
  select pick.pool_id,pick.entry_id,pick.week,pick.slot,min(event.created_at) as saved_at
  from public.pool_picks pick
  join public.pick_save_events event on event.pool_id=pick.pool_id and event.entry_id=pick.entry_id
    and event.week=pick.week and event.slot=pick.slot
    and event.action='draft_saved' and event.new_team_abbr=pick.team_abbr
  where pick.submitted_at is null
  group by pick.pool_id,pick.entry_id,pick.week,pick.slot
)
update public.pool_picks pick set submitted_at=evidence.saved_at,submission_evidence_source='pick_save_event'
from evidence where pick.pool_id=evidence.pool_id and pick.entry_id=evidence.entry_id
  and pick.week=evidence.week and pick.slot=evidence.slot and evidence.saved_at is not null;

with evidence as (
  select
    pick.pool_id,pick.entry_id,pick.week,pick.slot,
    case when p.deadline_mode='fixed'
      then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(p.id,pick.week))
      else coalesce(g.kickoff_at_utc,g.game_time)
    end as deadline_at,
    jsonb_build_object(
      'season',p.season,'start_week',p.start_week,'include_playoffs',p.include_playoffs,
      'mulligans',p.mulligans,'tie_rule',p.tie_rule,'deadline_mode',p.deadline_mode,
      'deadline_fixed',p.deadline_fixed,'double_pick_weeks',p.double_pick_weeks,
      'required_picks',public.picks_allowed(p.id,pick.week),
      'backfilled',true
    ) as rules
  from public.pool_picks pick join public.pools p on p.id=pick.pool_id
  left join lateral (
    select game.* from public.pool_week_games(p.id,pick.week) game
    where upper(pick.team_abbr) in (upper(game.home_team),upper(game.away_team)) limit 1
  ) g on true
  where pick.applicable_deadline_at is null or pick.rules_snapshot is null
)
update public.pool_picks pick set applicable_deadline_at=evidence.deadline_at,rules_snapshot=evidence.rules
from evidence where pick.pool_id=evidence.pool_id and pick.entry_id=evidence.entry_id
  and pick.week=evidence.week and pick.slot=evidence.slot;

-- Logical standings after each week. This contains competition facts and entry
-- labels, but deliberately excludes profile names, emails, and avatars.
create table if not exists public.pool_entry_week_history (
  pool_id uuid not null references public.pools(id) on delete cascade,
  entry_id uuid not null,
  week integer not null check (week between 1 and 22),
  entry_number integer not null,
  entry_name_snapshot text,
  wins integer not null,
  losses integer not null,
  pushes integer not null,
  strikes_used integer not null,
  mulligans_applied integer not null,
  mulligans_remaining integer not null,
  survival_credits integer not null,
  eliminated boolean not null,
  eliminated_week integer,
  used_teams text[] not null default '{}',
  picks_snapshot jsonb not null default '[]',
  rules_snapshot jsonb not null,
  is_complete boolean not null default false,
  revision integer not null default 1,
  recorded_at timestamptz not null default now(),
  revised_at timestamptz not null default now(),
  primary key(pool_id,entry_id,week)
);

alter table public.pool_entry_week_history enable row level security;
revoke all on public.pool_entry_week_history from public,anon,authenticated;
grant select,insert,update,delete on public.pool_entry_week_history to service_role;

create or replace function public.refresh_pool_week_history(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows integer := 0;
begin
  with settings as (
    select p.*,greatest(0,coalesce(nullif(p.strikes_allowed,'')::integer,0)) as base_mulligans
    from public.pools p where p.id=p_pool_id
  ), bounds as (
    select s.start_week,coalesce(max(pp.week) filter(where pp.result is not null),s.start_week-1) as last_week
    from settings s left join public.pool_picks pp on pp.pool_id=s.id group by s.start_week
  ), weeks as (
    select generate_series(b.start_week,b.last_week)::integer as week from bounds b where b.last_week>=b.start_week
  ), entry_weeks as (
    select pm.*,w.week,s.base_mulligans,s.season,s.start_week,s.include_playoffs,s.tie_rule,
      s.deadline_mode,s.deadline_fixed,s.double_pick_weeks
    from public.pool_members pm join settings s on s.id=pm.pool_id cross join weeks w
  ), calculated as (
    select ew.*,
      (select count(*) from public.pool_picks p where p.pool_id=ew.pool_id and p.entry_id=ew.id and p.week<=ew.week and p.result='win')::integer wins,
      (select count(*) from public.pool_picks p where p.pool_id=ew.pool_id and p.entry_id=ew.id and p.week<=ew.week and p.result='loss')::integer losses,
      (select count(*) from public.pool_picks p where p.pool_id=ew.pool_id and p.entry_id=ew.id and p.week<=ew.week and p.result='push')::integer pushes,
      coalesce((select sum(g.strike_credits) from public.pool_entry_survival_graces g where g.pool_id=ew.pool_id and g.entry_id=ew.id and g.week<=ew.week),0)::integer credits,
      (select array_agg(p.team_abbr order by p.week,p.slot) from public.pool_picks p where p.pool_id=ew.pool_id and p.entry_id=ew.id and p.week<=ew.week and p.result is not null) teams,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'week',p.week,'slot',p.slot,'team',p.team_abbr,'submitted_at',p.submitted_at,
        'deadline_at',p.applicable_deadline_at,'result',p.result,'adjudicated_at',p.adjudicated_at
      ) order by p.slot),'[]'::jsonb) from public.pool_picks p where p.pool_id=ew.pool_id and p.entry_id=ew.id and p.week=ew.week) picks,
      (select min(candidate_week) from generate_series(ew.start_week,ew.week) candidate_week
        where (select count(*) from public.pool_picks p where p.pool_id=ew.pool_id and p.entry_id=ew.id and p.week<=candidate_week and p.result='loss')
          > ew.base_mulligans + coalesce((select sum(g.strike_credits) from public.pool_entry_survival_graces g where g.pool_id=ew.pool_id and g.entry_id=ew.id and g.week<=candidate_week),0)
      )::integer first_out
    from entry_weeks ew
  ), upserted as (
    insert into public.pool_entry_week_history(
      pool_id,entry_id,week,entry_number,entry_name_snapshot,wins,losses,pushes,strikes_used,
      mulligans_applied,mulligans_remaining,survival_credits,eliminated,eliminated_week,
      used_teams,picks_snapshot,rules_snapshot,is_complete
    ) select
      c.pool_id,c.id,c.week,c.entry_number,c.entry_name,c.wins,c.losses,c.pushes,c.losses,
      least(c.base_mulligans,c.losses),greatest(0,c.base_mulligans-c.losses),c.credits,
      c.first_out is not null,c.first_out,coalesce(c.teams,'{}'),c.picks,
      jsonb_build_object(
        'season',c.season,'start_week',c.start_week,'include_playoffs',c.include_playoffs,
        'mulligans',c.base_mulligans,'tie_rule',c.tie_rule,'deadline_mode',c.deadline_mode,
        'deadline_fixed',c.deadline_fixed,'double_pick_weeks',c.double_pick_weeks,
        'required_picks',public.picks_allowed(c.pool_id,c.week)
      ),
      not exists(select 1 from public.pool_picks pending where pending.pool_id=c.pool_id and pending.week=c.week and pending.result is null)
    from calculated c
    on conflict(pool_id,entry_id,week) do update set
      wins=excluded.wins,losses=excluded.losses,pushes=excluded.pushes,strikes_used=excluded.strikes_used,
      mulligans_applied=excluded.mulligans_applied,mulligans_remaining=excluded.mulligans_remaining,
      survival_credits=excluded.survival_credits,eliminated=excluded.eliminated,eliminated_week=excluded.eliminated_week,
      used_teams=excluded.used_teams,picks_snapshot=excluded.picks_snapshot,rules_snapshot=excluded.rules_snapshot,
      is_complete=excluded.is_complete,revision=public.pool_entry_week_history.revision+1,revised_at=now()
    where row(public.pool_entry_week_history.wins,public.pool_entry_week_history.losses,public.pool_entry_week_history.pushes,
      public.pool_entry_week_history.strikes_used,public.pool_entry_week_history.mulligans_applied,
      public.pool_entry_week_history.mulligans_remaining,public.pool_entry_week_history.survival_credits,
      public.pool_entry_week_history.eliminated,public.pool_entry_week_history.eliminated_week,
      public.pool_entry_week_history.used_teams,public.pool_entry_week_history.picks_snapshot,
      public.pool_entry_week_history.rules_snapshot,public.pool_entry_week_history.is_complete)
      is distinct from row(excluded.wins,excluded.losses,excluded.pushes,excluded.strikes_used,
      excluded.mulligans_applied,excluded.mulligans_remaining,excluded.survival_credits,excluded.eliminated,
      excluded.eliminated_week,excluded.used_teams,excluded.picks_snapshot,excluded.rules_snapshot,excluded.is_complete)
    returning 1
  ) select count(*)::integer into v_rows from upserted;
  return coalesce(v_rows,0);
end;
$function$;

-- Rebuilds remain idempotent while also maintaining the per-week ledger.
create or replace function public.rebuild_pool_member_stats(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows integer;
begin
  if auth.uid() is not null and not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  perform public.acquire_pool_workflow_lock(p_pool_id);
  v_rows := public.rebuild_pool_member_stats_concurrency_internal(p_pool_id);
  perform public.refresh_pool_week_history(p_pool_id);
  return v_rows;
end;
$function$;

-- Historical week views use the week ledger instead of today's cumulative
-- status. Current/incomplete weeks fall back to the live derived stats.
create or replace function public.pool_standings_snapshot(p_pool_id uuid,p_week integer)
returns table(games jsonb,stats jsonb,visible_picks jsonb,history_picks jsonb,completion jsonb)
language plpgsql security definer set search_path to 'public' as $function$
declare v_pool public.pools%rowtype; v_can_manage boolean := false;
begin
  if auth.uid() is null then raise exception 'Please sign in to view standings.'; end if;
  select * into v_pool from public.pools p where p.id=p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  select public.admin_can_manage(p_pool_id) into v_can_manage;
  if not v_can_manage and not exists(select 1 from public.pool_members pm where pm.pool_id=p_pool_id and pm.profile_id=auth.uid()) then
    raise exception 'not authorized';
  end if;
  perform public.restore_unlocked_picks_for_pool(p_pool_id);

  return query
  with game_rows as (select * from public.pool_week_games(p_pool_id,p_week)),
  history_exists as (select exists(select 1 from public.pool_entry_week_history h where h.pool_id=p_pool_id and h.week=p_week) yes),
  stat_rows as (
    select h.pool_id,pm.profile_id as user_id,h.entry_id,h.wins,h.losses,h.pushes,h.strikes_used,h.eliminated,h.eliminated_week,
      coalesce((select jsonb_agg(jsonb_build_object('week',g.week,'strike_credits',g.strike_credits) order by g.week)
        from public.pool_entry_survival_graces g where g.pool_id=h.pool_id and g.entry_id=h.entry_id and g.week<=p_week),'[]'::jsonb) survival_graces
    from public.pool_entry_week_history h join public.pool_members pm on pm.pool_id=h.pool_id and pm.id=h.entry_id
    where h.pool_id=p_pool_id and h.week=p_week
    union all
    select s.pool_id,s.user_id,s.entry_id,s.wins,s.losses,s.pushes,s.strikes_used,s.eliminated,s.eliminated_week,
      coalesce((select jsonb_agg(jsonb_build_object('week',g.week,'strike_credits',g.strike_credits) order by g.week)
        from public.pool_entry_survival_graces g where g.pool_id=s.pool_id and g.entry_id=s.entry_id and g.week<=p_week),'[]'::jsonb)
    from public.pool_member_stats s cross join history_exists hx where s.pool_id=p_pool_id and not hx.yes
  ), visible_rows as (select * from public.pool_visible_picks(p_pool_id,p_week,false)),
  history_rows as (select * from public.pool_visible_picks(p_pool_id,p_week,true)),
  completion_row as (select * from public.pool_week_pick_completion(p_pool_id,p_week) limit 1)
  select
    (select coalesce(jsonb_agg(to_jsonb(gr) order by coalesce(gr.kickoff_at_utc,gr.game_time),gr.away_team,gr.home_team),'[]'::jsonb) from game_rows gr),
    (select coalesce(jsonb_agg(to_jsonb(sr) order by sr.entry_id),'[]'::jsonb) from stat_rows sr),
    (select coalesce(jsonb_agg(to_jsonb(vr) order by vr.entry_id,vr.week,vr.slot),'[]'::jsonb) from visible_rows vr),
    (select coalesce(jsonb_agg(to_jsonb(hr) order by hr.entry_id,hr.week,hr.slot),'[]'::jsonb) from history_rows hr),
    (select to_jsonb(cr) from completion_row cr);
end;
$function$;

-- Competition records cannot disappear through member/account cascades after
-- kickoff. The product does not currently offer account deletion; a future
-- deletion workflow must anonymize identity while explicitly retaining facts.
create or replace function public.protect_started_competition_history()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if public.pool_has_started(case when tg_table_name='pools' then old.id else old.pool_id end) then
    raise exception 'Started pool competition history cannot be deleted. Archive or anonymize it instead.';
  end if;
  return old;
end;
$function$;

drop trigger if exists zzz_protect_started_pool_member_history on public.pool_members;
create trigger zzz_protect_started_pool_member_history before delete on public.pool_members
for each row execute function public.protect_started_competition_history();
drop trigger if exists zzz_protect_started_pool_history on public.pools;
create trigger zzz_protect_started_pool_history before delete on public.pools
for each row execute function public.protect_started_competition_history();

create or replace function public.protect_started_entry_identity()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if public.pool_has_started(old.pool_id) and row(new.pool_id,new.profile_id,new.entry_number,new.entry_name)
    is distinct from row(old.pool_id,old.profile_id,old.entry_number,old.entry_name) then
    raise exception 'Entry identity cannot change after the pool starts.';
  end if;
  return new;
end;
$function$;
drop trigger if exists zzz_protect_started_entry_identity on public.pool_members;
create trigger zzz_protect_started_entry_identity before update on public.pool_members
for each row execute function public.protect_started_entry_identity();

-- Backfill logical week history for existing pools without changing picks.
do $function$
declare v_pool_id uuid;
begin
  for v_pool_id in select distinct pp.pool_id from public.pool_picks pp where pp.result is not null order by pp.pool_id loop
    perform public.refresh_pool_week_history(v_pool_id);
  end loop;
end;
$function$;

revoke all on function public.capture_locked_pick_history() from public,anon,authenticated;
revoke all on function public.refresh_pool_week_history(uuid) from public,anon,authenticated;
revoke all on function public.protect_started_competition_history() from public,anon,authenticated;
revoke all on function public.protect_started_entry_identity() from public,anon,authenticated;
revoke all on function public.pool_standings_snapshot(uuid,integer) from public,anon;
grant execute on function public.capture_locked_pick_history() to service_role;
grant execute on function public.refresh_pool_week_history(uuid) to service_role;
grant execute on function public.protect_started_competition_history() to service_role;
grant execute on function public.protect_started_entry_identity() to service_role;
grant execute on function public.pool_standings_snapshot(uuid,integer) to authenticated,service_role;

commit;
