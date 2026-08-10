create table if not exists public.pool_entry_survival_graces (
  pool_id uuid not null references public.pools(id) on delete cascade,
  entry_id uuid not null references public.pool_members(id) on delete cascade,
  week integer not null check (week between 1 and 22),
  strike_credits integer not null check (strike_credits > 0),
  created_at timestamptz not null default now(),
  primary key (pool_id, entry_id, week)
);

alter table public.pool_entry_survival_graces enable row level security;
revoke all on table public.pool_entry_survival_graces from public, anon, authenticated;
grant select, insert, update, delete on table public.pool_entry_survival_graces to service_role;

create or replace function public.clear_survival_grace_with_result()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'DELETE' or (old.result is not null and new.result is null) then
    delete from public.pool_entry_survival_graces g
    where g.pool_id=old.pool_id and g.entry_id=old.entry_id and g.week>=old.week;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_clear_survival_grace_with_result on public.pool_picks;
create trigger trg_clear_survival_grace_with_result
after update of result or delete on public.pool_picks
for each row execute function public.clear_survival_grace_with_result();

revoke execute on function public.clear_survival_grace_with_result() from public,anon,authenticated;
grant execute on function public.clear_survival_grace_with_result() to service_role;

create or replace function public.pool_pick_phase(p_week integer)
returns text
language sql
immutable
parallel safe
as $function$
  select case when coalesce(p_week, 0) > 18 then 'postseason' else 'regular' end
$function$;

revoke execute on function public.pool_pick_phase(integer) from public, anon;
grant execute on function public.pool_pick_phase(integer) to authenticated, service_role;

create or replace function public.pool_has_declared_winner(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with entry_status as (
    select
      pm.id as entry_id,
      coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive') as eliminated
    from public.pool_members pm
    left join public.pool_member_stats s on s.pool_id = pm.pool_id and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  )
  select coalesce(count(*) > 1 and count(*) filter (where not eliminated) = 1, false)
  from entry_status
$function$;

create or replace function public.pool_winner_status(p_pool_id uuid)
returns table (
  is_decided boolean,
  winner_user_id uuid,
  winner_name text,
  winner_avatar_url text,
  alive_members integer,
  alive_entries integer,
  total_members integer,
  total_entries integer,
  decided_week integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Please sign in to view this pool.'; end if;
  if not public.admin_can_manage(p_pool_id) and not exists (
    select 1 from public.pool_members mine where mine.pool_id = p_pool_id and mine.profile_id = auth.uid()
  ) then raise exception 'not authorized'; end if;

  return query
  with entry_status as (
    select
      pm.id as entry_id,
      pm.profile_id,
      pm.entry_number,
      coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive') as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s on s.pool_id = pm.pool_id and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ),
  totals as (
    select
      count(distinct profile_id)::integer as total_members,
      count(*)::integer as total_entries,
      count(distinct profile_id) filter (where not eliminated)::integer as alive_members,
      count(*) filter (where not eliminated)::integer as alive_entries,
      max(eliminated_week) filter (where eliminated_week is not null)::integer as decided_week
    from entry_status
  ),
  winner as (
    select status.profile_id, status.entry_number
    from entry_status status
    where not status.eliminated
    order by status.entry_number, status.entry_id
    limit 1
  )
  select
    (t.total_entries > 1 and t.alive_entries = 1)::boolean,
    case when t.total_entries > 1 and t.alive_entries = 1 then w.profile_id else null end,
    case when t.total_entries > 1 and t.alive_entries = 1 then
      (coalesce(
        nullif(profile.username::text, ''),
        nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        'Player ' || left(w.profile_id::text, 8)
      ) || case when w.entry_number > 1 then ' (Entry ' || w.entry_number || ')' else '' end)::text
    else null end,
    case when t.total_entries > 1 and t.alive_entries = 1 then profile.avatar_url::text else null end,
    coalesce(t.alive_members, 0), coalesce(t.alive_entries, 0),
    coalesce(t.total_members, 0), coalesce(t.total_entries, 0),
    case when t.total_entries > 1 and t.alive_entries = 1 then t.decided_week else null end
  from totals t
  left join winner w on true
  left join public.profiles_public profile on profile.id = w.profile_id;
end;
$function$;

create or replace function public.rebuild_pool_member_stats(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
begin
  if p_pool_id is null or not exists (select 1 from public.pools p where p.id = p_pool_id) then
    raise exception 'Pool not found.';
  end if;
  if auth.uid() is not null and not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;

  -- When a scoring week would eliminate every remaining entry, grant exactly
  -- enough persistent strike credit to carry those entries into the next week.
  with settings as (
    select greatest(0, coalesce(nullif(p.strikes_allowed, '')::integer, 0)) as base
    from public.pools p where p.id = p_pool_id
  ),
  grace_totals as (
    select g.entry_id, coalesce(sum(g.strike_credits), 0)::integer as credits
    from public.pool_entry_survival_graces g where g.pool_id = p_pool_id group by g.entry_id
  ),
  progress as (
    select pp.entry_id, pp.week, pp.slot,
      count(*) filter (where pp.result = 'loss') over (
        partition by pp.entry_id order by pp.week, pp.slot rows between unbounded preceding and current row
      )::integer as running_strikes,
      settings.base + coalesce(grace_totals.credits, 0) as allowance
    from public.pool_picks pp
    cross join settings
    left join grace_totals on grace_totals.entry_id = pp.entry_id
    where pp.pool_id = p_pool_id and pp.result is not null
  ),
  first_out as (
    select entry_id, min(week)::integer as eliminated_week
    from progress where running_strikes > allowance group by entry_id
  ),
  state as (
    select pm.id as entry_id, first_out.eliminated_week
    from public.pool_members pm left join first_out on first_out.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ),
  latest as (
    select max(pp.week)::integer as week from public.pool_picks pp
    where pp.pool_id = p_pool_id and pp.result is not null
  ),
  wipeout as (
    select latest.week
    from latest
    where latest.week is not null
      and not exists (select 1 from state where eliminated_week is null)
      and exists (select 1 from state where eliminated_week = latest.week)
  ),
  needed as (
    select
      p_pool_id as pool_id,
      state.entry_id,
      wipeout.week,
      greatest(1, max(progress.running_strikes) - max(progress.allowance))::integer as strike_credits
    from state
    join wipeout on wipeout.week = state.eliminated_week
    join progress on progress.entry_id = state.entry_id and progress.week <= wipeout.week
    group by state.entry_id, wipeout.week
  )
  insert into public.pool_entry_survival_graces(pool_id, entry_id, week, strike_credits)
  select pool_id, entry_id, week, strike_credits from needed
  on conflict (pool_id, entry_id, week) do nothing;

  delete from public.pool_member_stats s where s.pool_id = p_pool_id;

  with pool_settings as (
    select p.id as pool_id,
      greatest(0, coalesce(nullif(p.strikes_allowed, '')::integer, 0)) as base_strikes
    from public.pools p where p.id = p_pool_id
  ),
  grace_totals as (
    select g.entry_id, coalesce(sum(g.strike_credits), 0)::integer as credits
    from public.pool_entry_survival_graces g where g.pool_id = p_pool_id group by g.entry_id
  ),
  pick_progress as (
    select pp.pool_id, pp.entry_id, pp.week, pp.slot,
      ps.base_strikes + coalesce(gt.credits, 0) as strikes_allowed,
      count(*) filter (where pp.result = 'loss') over (
        partition by pp.pool_id, pp.entry_id order by pp.week, pp.slot rows between unbounded preceding and current row
      ) as running_strikes
    from public.pool_picks pp
    join pool_settings ps on ps.pool_id = pp.pool_id
    left join grace_totals gt on gt.entry_id = pp.entry_id
    where pp.pool_id = p_pool_id and pp.result is not null
  ),
  first_elimination as (
    select progress.pool_id, progress.entry_id, min(progress.week)::integer as eliminated_week
    from pick_progress progress where progress.running_strikes > progress.strikes_allowed
    group by progress.pool_id, progress.entry_id
  ),
  entry_results as (
    select pm.pool_id, pm.profile_id as user_id, pm.id as entry_id,
      ps.base_strikes + coalesce(gt.credits, 0) as strikes_allowed,
      fe.eliminated_week,
      count(pp.*) filter (where pp.result = 'win')::integer as wins,
      count(pp.*) filter (where pp.result = 'loss')::integer as losses,
      count(pp.*) filter (where pp.result = 'push')::integer as pushes,
      count(pp.*) filter (where pp.result = 'loss')::integer as strikes_used
    from public.pool_members pm
    join pool_settings ps on ps.pool_id = pm.pool_id
    left join grace_totals gt on gt.entry_id = pm.id
    left join first_elimination fe on fe.pool_id = pm.pool_id and fe.entry_id = pm.id
    left join public.pool_picks pp on pp.pool_id = pm.pool_id and pp.entry_id = pm.id
      and pp.result is not null and (fe.eliminated_week is null or pp.week <= fe.eliminated_week)
    where pm.pool_id = p_pool_id
    group by pm.pool_id, pm.profile_id, pm.id, ps.base_strikes, gt.credits, fe.eliminated_week
  ),
  inserted as (
    insert into public.pool_member_stats(pool_id,user_id,entry_id,wins,losses,pushes,strikes_used,eliminated,eliminated_week,updated_at)
    select er.pool_id,er.user_id,er.entry_id,er.wins,er.losses,er.pushes,er.strikes_used,
      er.eliminated_week is not null,er.eliminated_week,now()
    from entry_results er
    on conflict (pool_id,entry_id) do update set
      user_id=excluded.user_id,wins=excluded.wins,losses=excluded.losses,pushes=excluded.pushes,
      strikes_used=excluded.strikes_used,eliminated=excluded.eliminated,
      eliminated_week=excluded.eliminated_week,updated_at=excluded.updated_at
    returning 1
  ) select count(*)::integer into v_rows from inserted;

  perform public.prune_picks_after_elimination(p_pool_id);

  update public.pool_members pm
  set status = case when coalesce(s.eliminated,false) then 'eliminated' else 'alive' end,
      eliminated_week = s.eliminated_week,
      lives_remaining = greatest(0, allowance.allowed - s.strikes_used)
  from public.pool_member_stats s
  join (
    select p.id as pool_id, pm2.id as entry_id,
      greatest(0,coalesce(nullif(p.strikes_allowed,'')::integer,0)) + coalesce(sum(g.strike_credits),0)::integer as allowed
    from public.pools p
    join public.pool_members pm2 on pm2.pool_id=p.id
    left join public.pool_entry_survival_graces g on g.pool_id=p.id and g.entry_id=pm2.id
    where p.id=p_pool_id group by p.id,pm2.id,p.strikes_allowed
  ) allowance on allowance.pool_id=s.pool_id and allowance.entry_id=s.entry_id
  where pm.pool_id=s.pool_id and pm.id=s.entry_id;

  return coalesce(v_rows,0);
end;
$function$;

create or replace function public.save_entry_draft_pick_unserialized(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer,
  p_team_abbr text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry public.pool_members%rowtype;
  v_slot integer := coalesce(p_slot, 1);
  v_team_abbr text := upper(btrim(p_team_abbr));
  v_lock_at timestamptz;
  v_now timestamptz;
  v_test_current_week integer;
  v_eliminated boolean := false;
  v_max_week integer := 18;
begin
  if auth.uid() is null then raise exception 'Please sign in to make a pick.'; end if;
  perform public.assert_user_email_confirmed('make a pick');
  perform public.assert_action_rate_limit('save_draft_pick', 600, 120, p_pool_id::text || ':' || p_entry_id::text);
  if v_team_abbr is null or v_team_abbr = '' then raise exception 'Choose a team before saving this pick.'; end if;

  select * into v_pool from public.pools where id = p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if coalesce(v_pool.archived, false) or coalesce(v_pool.activation_status, 'active') <> 'active' then
    raise exception 'This pool is not accepting picks.';
  end if;
  if public.pool_has_declared_winner(p_pool_id) then
    raise exception 'This pool already has a winner. No more picks are needed.';
  end if;

  v_now := public.pool_effective_now(p_pool_id);
  v_max_week := coalesce(public.pool_max_pick_week(p_pool_id), 18);
  if p_week < coalesce(v_pool.start_week, 1) then raise exception 'This pool starts in Week %.', v_pool.start_week; end if;
  if p_week > v_max_week then raise exception 'This pool does not allow picks after Week %.', v_max_week; end if;
  if v_slot < 1 or v_slot > public.picks_allowed(p_pool_id, p_week) then
    raise exception 'Slot % is not available for week %. This pool allows % pick(s).', v_slot, p_week, public.picks_allowed(p_pool_id,p_week);
  end if;

  v_test_current_week := coalesce(v_pool.test_current_week, v_pool.start_week, 1);
  if coalesce(v_pool.test_mode, false) and p_week < v_test_current_week then
    raise exception 'Week % is already locked in this test pool.', p_week;
  end if;

  select * into v_entry from public.pool_members pm where pm.pool_id=p_pool_id and pm.id=p_entry_id;
  if v_entry.id is null then raise exception 'Entry not found.'; end if;
  if v_entry.profile_id <> auth.uid() then raise exception 'This entry does not belong to you.'; end if;
  if lower(coalesce(v_entry.status::text,'alive')) not in ('alive','active') then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;
  select coalesce(s.eliminated,false) into v_eliminated
  from public.pool_member_stats s where s.pool_id=p_pool_id and s.entry_id=p_entry_id;
  if coalesce(v_eliminated,false) then raise exception 'Eliminated entries cannot make new picks.'; end if;

  if exists(select 1 from public.pool_picks pp where pp.pool_id=p_pool_id and pp.entry_id=p_entry_id and pp.week=p_week and pp.slot=v_slot) then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  if exists (
    select 1 from public.pool_picks pp
    where pp.pool_id=p_pool_id and pp.entry_id=p_entry_id
      and upper(btrim(pp.team_abbr))=v_team_abbr and pp.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(pp.week)=public.pool_pick_phase(p_week)
  ) or exists (
    select 1 from public.pool_pick_drafts d
    where d.pool_id=p_pool_id and d.entry_id=p_entry_id
      and upper(btrim(d.team_abbr))=v_team_abbr and d.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(d.week)=public.pool_pick_phase(p_week)
      and not (d.week=p_week and d.slot=v_slot)
  ) then raise exception 'This entry has already used % in the %.', v_team_abbr, public.pool_pick_phase(p_week); end if;

  select case when coalesce(v_pool.deadline_mode,'fixed')='fixed'
      then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(p_pool_id,p_week))
      else coalesce(g.kickoff_at_utc,g.game_time) end
  into v_lock_at
  from public.pool_week_games(p_pool_id,p_week) g
  where v_team_abbr in (upper(g.home_team),upper(g.away_team))
  order by coalesce(g.kickoff_at_utc,g.game_time) limit 1;
  if v_lock_at is null then raise exception 'That team is not scheduled for Week %.', p_week; end if;
  if v_now >= v_lock_at then raise exception 'This pick is locked and can no longer be changed.'; end if;

  delete from public.pool_pick_drafts d
  where d.pool_id=p_pool_id and d.entry_id=p_entry_id and d.week=p_week and d.slot=v_slot;
  insert into public.pool_pick_drafts(pool_id,user_id,entry_id,week,slot,team_abbr,updated_at)
  values(p_pool_id,v_entry.profile_id,p_entry_id,p_week,v_slot,v_team_abbr,now());
end;
$function$;

create or replace function public.guard_pool_pick_draft_security()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_entry public.pool_members%rowtype;
  v_pool public.pools%rowtype;
  v_eliminated boolean := false;
  v_team text := upper(btrim(new.team_abbr));
  v_lock_at timestamptz;
begin
  if v_team is null or v_team='' then raise exception 'Choose a team before saving this pick.'; end if;
  new.team_abbr:=v_team;
  select * into v_pool from public.pools p where p.id=new.pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if coalesce(v_pool.archived,false) or coalesce(v_pool.activation_status,'active')<>'active' then raise exception 'This pool is not accepting picks.'; end if;
  if public.pool_has_declared_winner(new.pool_id) then raise exception 'This pool already has a winner. No more picks are needed.'; end if;
  if new.week < coalesce(v_pool.start_week,1) then raise exception 'This pool starts in Week %.',v_pool.start_week; end if;
  if new.slot<1 or new.slot>public.picks_allowed(new.pool_id,new.week) then
    raise exception 'Week % allows % pick(s); Pick % is invalid.',new.week,public.picks_allowed(new.pool_id,new.week),new.slot;
  end if;
  select * into v_entry from public.pool_members pm where pm.pool_id=new.pool_id and pm.id=new.entry_id;
  if v_entry.id is null or v_entry.profile_id is distinct from new.user_id then raise exception 'Entry does not belong to this user.'; end if;
  if lower(coalesce(v_entry.status::text,'alive')) not in ('alive','active') then raise exception 'Eliminated entries cannot make new picks.'; end if;
  select coalesce(s.eliminated,false) into v_eliminated from public.pool_member_stats s where s.pool_id=new.pool_id and s.entry_id=new.entry_id;
  if coalesce(v_eliminated,false) then raise exception 'Eliminated entries cannot make new picks.'; end if;
  if exists(select 1 from public.pool_picks p where p.pool_id=new.pool_id and p.entry_id=new.entry_id and p.week=new.week and p.slot=new.slot) then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;
  if v_team not like 'NO_PICK%' and exists(
    select 1 from public.pool_picks p where p.pool_id=new.pool_id and p.entry_id=new.entry_id
      and upper(btrim(p.team_abbr))=v_team and p.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(p.week)=public.pool_pick_phase(new.week)
  ) then raise exception 'This entry has already used % in the %.',v_team,public.pool_pick_phase(new.week); end if;
  if v_team not like 'NO_PICK%' and exists(
    select 1 from public.pool_pick_drafts d where d.pool_id=new.pool_id and d.entry_id=new.entry_id
      and upper(btrim(d.team_abbr))=v_team and d.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(d.week)=public.pool_pick_phase(new.week)
      and not (tg_op='UPDATE' and d.pool_id=old.pool_id and d.entry_id=old.entry_id and d.week=old.week and d.slot=old.slot)
  ) then raise exception 'This entry has already used % in the %.',v_team,public.pool_pick_phase(new.week); end if;
  select case when coalesce(v_pool.deadline_mode,'fixed')='fixed'
      then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(new.pool_id,new.week))
      else coalesce(g.kickoff_at_utc,g.game_time) end into v_lock_at
  from public.pool_week_games(new.pool_id,new.week) g
  where v_team in (upper(g.home_team),upper(g.away_team)) order by coalesce(g.kickoff_at_utc,g.game_time) limit 1;
  if v_lock_at is null then raise exception 'That team is not scheduled for Week %.',new.week; end if;
  if public.pool_effective_now(new.pool_id)>=v_lock_at then raise exception 'This pick is locked and can no longer be changed.'; end if;
  return new;
end;
$function$;

create or replace function public.pool_winner_decided_week(p_pool_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  with entry_status as (
    select pm.id,
      coalesce(s.eliminated,false)
        or lower(coalesce(nullif(pm.status::text,''),'alive')) not in ('active','alive') as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s on s.pool_id=pm.pool_id and s.entry_id=pm.id
    where pm.pool_id=p_pool_id
  )
  select case when count(*)>1 and count(*) filter(where not eliminated)=1
    then max(eliminated_week) filter(where eliminated_week is not null) else null end
  from entry_status
$function$;

create or replace function public.admin_override_entry_final_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_reason text default null,
  p_slot integer default 1
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
  v_team text:=upper(btrim(coalesce(p_team_abbr,'')));
  v_slot integer:=coalesce(p_slot,1);
  v_test_mode boolean;
  v_season integer;
  v_required_picks integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  if v_team='' then raise exception 'Choose a team before saving this pick.'; end if;
  select pm.profile_id into v_user_id from public.pool_members pm where pm.pool_id=p_pool_id and pm.id=p_entry_id;
  if v_user_id is null then raise exception 'Entry not found.'; end if;
  select coalesce(p.test_mode,false),coalesce(p.season,extract(year from now())::integer),public.picks_allowed(p.id,p_week)
  into v_test_mode,v_season,v_required_picks from public.pools p where p.id=p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  if coalesce(v_required_picks,0)=0 then raise exception 'Week % is outside this pool''s playable season.',p_week; end if;
  if v_slot<1 or v_slot>v_required_picks then
    raise exception 'Slot % is not valid for Week %; this pool requires % pick(s).',v_slot,p_week,v_required_picks;
  end if;
  if not exists(select 1 from public.pool_week_games(p_pool_id,p_week) g where v_team in (upper(g.home_team),upper(g.away_team))) then
    raise exception 'That team is not scheduled for Week %.',p_week;
  end if;
  if exists(
    select 1 from public.pool_picks p where p.pool_id=p_pool_id and p.entry_id=p_entry_id
      and upper(btrim(p.team_abbr))=v_team and p.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(p.week)=public.pool_pick_phase(p_week)
      and not(p.week=p_week and p.slot=v_slot)
  ) or exists(
    select 1 from public.pool_pick_drafts d where d.pool_id=p_pool_id and d.entry_id=p_entry_id
      and upper(btrim(d.team_abbr))=v_team and d.team_abbr not like 'NO_PICK%'
      and public.pool_pick_phase(d.week)=public.pool_pick_phase(p_week)
      and not(d.week=p_week and d.slot=v_slot)
  ) then raise exception 'This entry has already used % in the %.',v_team,public.pool_pick_phase(p_week); end if;
  insert into public.pool_picks(pool_id,user_id,entry_id,week,slot,team_abbr,locked_at,result,adjudicated_at,created_at)
  values(p_pool_id,v_user_id,p_entry_id,p_week,v_slot,v_team,now(),null,null,now())
  on conflict(pool_id,entry_id,week,slot) do update set team_abbr=excluded.team_abbr,user_id=excluded.user_id,
    locked_at=now(),result=null,adjudicated_at=null;
  delete from public.pool_pick_drafts d where d.pool_id=p_pool_id and d.entry_id=p_entry_id and d.week=p_week and d.slot=v_slot;
  if v_test_mode then
    update public.pool_picks pick set
      result=case when result_row.result='push' then coalesce(nullif(pool.tie_rule,''),'loss') else result_row.result end,
      adjudicated_at=now()
    from public.pools pool
    join public.test_pool_team_results result_row on result_row.pool_id=pool.id and result_row.week=p_week and result_row.team_abbr=v_team
    where pool.id=p_pool_id and pick.pool_id=p_pool_id and pick.entry_id=p_entry_id and pick.week=p_week and pick.slot=v_slot;
    perform public.superadmin_rebuild_test_pool_stats(p_pool_id);
  else
    perform public.adjudicate_results(v_season,p_week);
    perform public.rebuild_pool_member_stats(p_pool_id);
  end if;
end;
$function$;

revoke execute on function public.pool_has_declared_winner(uuid) from public, anon, authenticated;
grant execute on function public.pool_has_declared_winner(uuid) to service_role;
revoke execute on function public.pool_winner_status(uuid) from public, anon;
grant execute on function public.pool_winner_status(uuid) to authenticated, service_role;
revoke execute on function public.rebuild_pool_member_stats(uuid) from public, anon;
grant execute on function public.rebuild_pool_member_stats(uuid) to authenticated, service_role;
