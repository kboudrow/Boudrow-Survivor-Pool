begin;

create or replace function public.pool_has_declared_winner(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with entry_status as (
    select
      pm.pool_id,
      pm.id as entry_id,
      pm.profile_id,
      (
        coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive')
      ) as eliminated
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ),
  totals as (
    select
      count(distinct profile_id)::integer as total_members,
      count(*)::integer as total_entries,
      count(distinct profile_id) filter (where not eliminated)::integer as alive_members,
      count(*) filter (where not eliminated)::integer as alive_entries
    from entry_status
  )
  select coalesce(total_members > 1 and alive_members = 1 and alive_entries > 0, false)
  from totals;
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
  if auth.uid() is null then
    raise exception 'Please sign in to view this pool.';
  end if;

  if not public.admin_can_manage(p_pool_id) and not exists (
    select 1
    from public.pool_members mine
    where mine.pool_id = p_pool_id
      and mine.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  return query
  with entry_status as (
    select
      pm.pool_id,
      pm.id as entry_id,
      pm.profile_id,
      (
        coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive')
      ) as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
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
    select min(profile_id) as winner_user_id
    from entry_status
    where not eliminated
    having count(distinct profile_id) = 1
  )
  select
    (t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0)::boolean as is_decided,
    case when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then w.winner_user_id else null end as winner_user_id,
    case
      when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then
        coalesce(
          nullif(pp.username::text, ''),
          nullif(trim(concat_ws(' ', pp.first_name, pp.last_name)), ''),
          'Player ' || left(w.winner_user_id::text, 8)
        )::text
      else null
    end as winner_name,
    case when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then pp.avatar_url::text else null end as winner_avatar_url,
    coalesce(t.alive_members, 0)::integer as alive_members,
    coalesce(t.alive_entries, 0)::integer as alive_entries,
    coalesce(t.total_members, 0)::integer as total_members,
    coalesce(t.total_entries, 0)::integer as total_entries,
    case when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then t.decided_week else null end as decided_week
  from totals t
  left join winner w on true
  left join public.profiles_public pp
    on pp.id = w.winner_user_id;
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
    select
      pm.profile_id,
      (
        coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive')
      ) as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ),
  totals as (
    select
      count(distinct profile_id)::integer as total_members,
      count(distinct profile_id) filter (where not eliminated)::integer as alive_members,
      count(*) filter (where not eliminated)::integer as alive_entries,
      max(eliminated_week) filter (where eliminated_week is not null)::integer as decided_week
    from entry_status
  )
  select case
    when total_members > 1 and alive_members = 1 and alive_entries > 0 then decided_week
    else null
  end
  from totals;
$function$;

create or replace function public.prune_pool_picks_after_winner(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_decided_week integer;
  v_deleted_drafts integer := 0;
  v_deleted_unscored integer := 0;
begin
  v_decided_week := public.pool_winner_decided_week(p_pool_id);

  if v_decided_week is null then
    return 0;
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.week > v_decided_week;
  get diagnostics v_deleted_drafts = row_count;

  delete from public.pool_picks pp
  where pp.pool_id = p_pool_id
    and pp.week > v_decided_week
    and pp.result is null;
  get diagnostics v_deleted_unscored = row_count;

  return coalesce(v_deleted_drafts, 0) + coalesce(v_deleted_unscored, 0);
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
  v_eliminated boolean := false;
  v_team text := upper(btrim(new.team_abbr));
  v_old_pool_id uuid := null;
  v_old_entry_id uuid := null;
  v_old_week integer := null;
  v_old_slot integer := null;
begin
  if public.pool_has_declared_winner(new.pool_id) then
    raise exception 'This pool already has a winner. Picks are closed.';
  end if;

  if v_team is null or v_team = '' then
    raise exception 'Choose a team before saving this pick.';
  end if;

  new.team_abbr := v_team;

  if tg_op = 'UPDATE' then
    v_old_pool_id := old.pool_id;
    v_old_entry_id := old.entry_id;
    v_old_week := old.week;
    v_old_slot := old.slot;
  end if;

  if new.entry_id is null then
    select pm.*
      into v_entry
    from public.pool_members pm
    where pm.pool_id = new.pool_id
      and pm.profile_id = new.user_id
    order by pm.entry_number
    limit 1;

    new.entry_id := v_entry.id;
  else
    select pm.*
      into v_entry
    from public.pool_members pm
    where pm.pool_id = new.pool_id
      and pm.id = new.entry_id;
  end if;

  if v_entry.id is null or v_entry.profile_id is distinct from new.user_id then
    raise exception 'Entry does not belong to this user.';
  end if;

  if lower(coalesce(v_entry.status::text, 'alive')) not in ('alive', 'active') then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  select coalesce(s.eliminated, false)
    into v_eliminated
  from public.pool_member_stats s
  where s.pool_id = new.pool_id
    and s.entry_id = new.entry_id;

  if coalesce(v_eliminated, false) then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  if v_team not like 'NO_PICK%' and exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = new.pool_id
      and pp.entry_id = new.entry_id
      and upper(btrim(pp.team_abbr)) = v_team
      and pp.team_abbr not like 'NO_PICK%'
      and (
        tg_op <> 'UPDATE'
        or not (
          pp.pool_id = v_old_pool_id
          and pp.entry_id = v_old_entry_id
          and pp.week = v_old_week
          and pp.slot = v_old_slot
        )
      )
  ) then
    raise exception 'This entry has already used %.', v_team;
  end if;

  if v_team not like 'NO_PICK%' and exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = new.pool_id
      and d.entry_id = new.entry_id
      and upper(btrim(d.team_abbr)) = v_team
      and d.team_abbr not like 'NO_PICK%'
      and (
        tg_op <> 'UPDATE'
        or not (
          d.pool_id = v_old_pool_id
          and d.entry_id = v_old_entry_id
          and d.week = v_old_week
          and d.slot = v_old_slot
        )
      )
  ) then
    raise exception 'This entry has already used %.', v_team;
  end if;

  return new;
end;
$function$;

create or replace function public.pool_week_pick_completion(
  p_pool_id uuid,
  p_week integer
)
returns table (
  pool_id uuid,
  week integer,
  active_entries integer,
  required_slots integer,
  made_slots integer,
  complete_entries integer,
  partial_entries integer,
  missing_slots integer
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_required_per_entry integer := 1;
begin
  if not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  if public.pool_has_declared_winner(p_pool_id) then
    return query
    select p_pool_id, p_week, 0, 0, 0, 0, 0, 0;
    return;
  end if;

  select case
    when coalesce(p.double_pick_weeks, '{}'::integer[]) @> array[p_week] then 2
    else 1
  end
  into v_required_per_entry
  from public.pools p
  where p.id = p_pool_id;

  v_required_per_entry := coalesce(v_required_per_entry, 1);

  return query
  with active_entries as (
    select pm.id as entry_id
    from public.pool_members pm
    left join public.pool_member_stats stats
      on stats.pool_id = pm.pool_id
     and stats.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and (
        stats.entry_id is null
        or not coalesce(stats.eliminated, false)
        or stats.eliminated_week is null
        or stats.eliminated_week >= p_week
      )
  ),
  picked_slots as (
    select distinct d.entry_id, d.slot
    from public.pool_pick_drafts d
    join active_entries ae
      on ae.entry_id = d.entry_id
    where d.pool_id = p_pool_id
      and d.week = p_week
      and d.slot between 1 and v_required_per_entry
      and d.team_abbr is not null
      and d.team_abbr not like 'NO_PICK%'
    union
    select distinct pp.entry_id, pp.slot
    from public.pool_picks pp
    join active_entries ae
      on ae.entry_id = pp.entry_id
    where pp.pool_id = p_pool_id
      and pp.week = p_week
      and pp.slot between 1 and v_required_per_entry
      and pp.team_abbr is not null
      and pp.team_abbr not like 'NO_PICK%'
  ),
  per_entry as (
    select
      ae.entry_id,
      count(ps.slot)::integer as made_for_entry
    from active_entries ae
    left join picked_slots ps
      on ps.entry_id = ae.entry_id
    group by ae.entry_id
  ),
  totals as (
    select
      count(*)::integer as active_entries,
      coalesce(sum(pe.made_for_entry), 0)::integer as made_slots,
      count(*) filter (where pe.made_for_entry >= v_required_per_entry)::integer as complete_entries,
      count(*) filter (where pe.made_for_entry > 0 and pe.made_for_entry < v_required_per_entry)::integer as partial_entries
    from per_entry pe
  )
  select
    p_pool_id as pool_id,
    p_week as week,
    coalesce(t.active_entries, 0)::integer as active_entries,
    (coalesce(t.active_entries, 0) * v_required_per_entry)::integer as required_slots,
    least(coalesce(t.made_slots, 0), coalesce(t.active_entries, 0) * v_required_per_entry)::integer as made_slots,
    coalesce(t.complete_entries, 0)::integer as complete_entries,
    coalesce(t.partial_entries, 0)::integer as partial_entries,
    greatest((coalesce(t.active_entries, 0) * v_required_per_entry) - coalesce(t.made_slots, 0), 0)::integer as missing_slots
  from totals t;
end;
$function$;

create or replace function public.pool_visible_picks(
  p_pool_id uuid,
  p_week integer default null,
  p_through_week boolean default false
)
returns table (
  user_id uuid,
  entry_id uuid,
  week integer,
  slot integer,
  team_abbr text,
  locked_at timestamptz,
  result text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_can_manage boolean := false;
  v_effective_now timestamptz;
  v_decided_week integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view picks.';
  end if;

  select public.admin_can_manage(p_pool_id) into v_can_manage;
  v_effective_now := public.pool_effective_now(p_pool_id);
  v_decided_week := public.pool_winner_decided_week(p_pool_id);

  if not v_can_manage and not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pp.user_id,
    pp.entry_id,
    pp.week,
    pp.slot,
    pp.team_abbr::text,
    pp.locked_at,
    pp.result::text
  from public.pool_picks pp
  join public.pools po
    on po.id = pp.pool_id
  left join public.pool_member_stats s
    on s.pool_id = pp.pool_id
   and s.entry_id = pp.entry_id
  where pp.pool_id = p_pool_id
    and (v_decided_week is null or pp.week <= v_decided_week)
    and (
      p_week is null
      or (p_through_week and pp.week <= p_week)
      or (not p_through_week and pp.week = p_week)
    )
    and (
      coalesce(s.eliminated, false) = false
      or s.eliminated_week is null
      or pp.week <= s.eliminated_week
    )
    and (
      pp.user_id = auth.uid()
      or pp.locked_at <= v_effective_now
      or (
        coalesce(po.test_mode, false)
        and pp.week < coalesce(po.test_current_week, po.start_week, pp.week)
      )
    )
  order by pp.week, pp.slot, pp.entry_id;
end;
$function$;

create or replace function public.finalize_locked_picks(
  p_pool_id uuid,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer;
  v_pool public.pools%rowtype;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found
    or coalesce(v_pool.test_mode, false)
    or public.pool_has_declared_winner(p_pool_id) then
    return 0;
  end if;

  with pool_settings as (
    select
      p.id,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.entry_id,
      d.week,
      d.slot,
      d.team_abbr,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps
      on ps.id = d.pool_id
    join public.pool_members pm
      on pm.pool_id = d.pool_id
     and pm.id = d.entry_id
    left join public.pool_member_stats s
      on s.pool_id = d.pool_id
     and s.entry_id = d.entry_id
    join public.pool_week_games(p_pool_id, p_week) g
      on g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and coalesce(s.eliminated, false) = false
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= now()
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, lock_at, now()
    from to_commit
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.entry_id = tc.entry_id
      and d.week = tc.week
      and d.slot = tc.slot
    returning 1
  )
  select count(*)::integer
    into inserted
  from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_no_pick_losses(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer := 0;
  week_deadline timestamptz;
  v_pool public.pools%rowtype;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found
    or coalesce(v_pool.test_mode, false)
    or coalesce(v_pool.archived, false)
    or coalesce(v_pool.activation_status, 'active') <> 'active'
    or public.pool_has_declared_winner(p_pool_id) then
    return 0;
  end if;

  select public.pool_week_deadline_at(p_pool_id, p_week) into week_deadline;

  if week_deadline is null or now() < week_deadline or public.picks_allowed(p_pool_id, p_week) < 1 then
    return 0;
  end if;

  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  ),
  missing as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      p_week as week,
      slots.slot,
      ('NO_PICK_' || slots.slot)::text as team_abbr
    from public.pool_members pm
    cross join slots
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and coalesce(s.eliminated, false) = false
      and not exists (
        select 1
        from public.pool_picks pp
        where pp.pool_id = pm.pool_id
          and pp.entry_id = pm.id
          and pp.week = p_week
          and pp.slot = slots.slot
      )
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, week_deadline, 'loss', now(), now()
    from missing
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  )
  select count(*)::integer into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_locked_picks_for_pool(
  p_pool_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  week_number integer;
  total_inserted integer := 0;
  inserted_this_week integer := 0;
  v_pool public.pools%rowtype;
  v_max_week integer := 18;
begin
  select *
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if not found
    or coalesce(v_pool.test_mode, false)
    or coalesce(v_pool.archived, false)
    or coalesce(v_pool.activation_status, 'active') <> 'active'
    or public.pool_has_declared_winner(p_pool_id) then
    perform public.prune_pool_picks_after_winner(p_pool_id);
    return 0;
  end if;

  v_max_week := coalesce(public.pool_max_pick_week(p_pool_id), 18);

  for week_number in 1..v_max_week loop
    exit when public.pool_has_declared_winner(p_pool_id);

    inserted_this_week := public.finalize_locked_picks(p_pool_id, week_number);
    inserted_this_week := inserted_this_week + public.finalize_no_pick_losses(p_pool_id, week_number);
    total_inserted := total_inserted + inserted_this_week;

    if inserted_this_week > 0 then
      perform public.rebuild_pool_member_stats(p_pool_id);
      perform public.prune_pool_picks_after_winner(p_pool_id);
    end if;
  end loop;

  perform public.rebuild_pool_member_stats(p_pool_id);
  perform public.prune_pool_picks_after_winner(p_pool_id);

  return total_inserted;
end;
$function$;

create or replace function public.superadmin_finalize_test_locked_picks(
  p_pool_id uuid,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer := 0;
  v_now timestamptz;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if public.pool_has_declared_winner(p_pool_id) then
    perform public.prune_pool_picks_after_winner(p_pool_id);
    return 0;
  end if;

  v_now := public.pool_effective_now(p_pool_id);

  with pool_settings as (
    select p.id, coalesce(p.deadline_mode, 'fixed') as deadline_mode
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.test_mode, false) = true
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.entry_id,
      d.week,
      d.slot,
      d.team_abbr,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.pool_week_games(p_pool_id, p_week) g
      on g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= v_now
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, lock_at, now()
    from to_commit
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.entry_id = tc.entry_id
      and d.week = tc.week
      and d.slot = tc.slot
    returning 1
  )
  select count(*)::integer into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.superadmin_finalize_test_week_drafts(
  p_pool_id uuid,
  p_week integer
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted integer := 0;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if public.pool_has_declared_winner(p_pool_id) then
    perform public.prune_pool_picks_after_winner(p_pool_id);
    return 0;
  end if;

  with pool_settings as (
    select p.id, coalesce(p.deadline_mode, 'fixed') as deadline_mode
    from public.pools p
    where p.id = p_pool_id
      and coalesce(p.test_mode, false) = true
      and coalesce(p.archived, false) = false
      and coalesce(p.activation_status, 'active') = 'active'
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.entry_id,
      d.week,
      d.slot,
      d.team_abbr,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.pool_week_games(p_pool_id, p_week) g
      on g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, lock_at, now()
    from draft_locks
    on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        locked_at = excluded.locked_at
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using draft_locks dl
    where d.pool_id = dl.pool_id
      and d.entry_id = dl.entry_id
      and d.week = dl.week
      and d.slot = dl.slot
    returning 1
  )
  select count(*)::integer into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.superadmin_score_test_pool_week(
  p_pool_id uuid,
  p_week integer
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_changed integer := 0;
  v_scored integer := 0;
  v_no_picks integer := 0;
  v_start_week integer;
  v_max_week integer;
  v_next_week integer;
  v_next_clock timestamptz;
  v_missing_outcomes integer := 0;
  v_missing_outcome_teams text;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);

  if public.pool_has_declared_winner(p_pool_id) then
    perform public.prune_pool_picks_after_winner(p_pool_id);
    return 'This pool already has a winner. No more weeks need to be scored.';
  end if;

  select coalesce(p.start_week, 1), public.pool_max_pick_week(p_pool_id)
    into v_start_week, v_max_week
  from public.pools p
  where p.id = p_pool_id;

  if p_week < v_start_week or p_week > coalesce(v_max_week, 18) then
    raise exception 'Week must be between this pool''s start week (%) and Week %.', v_start_week, coalesce(v_max_week, 18);
  end if;

  if p_week > 18 then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  end if;

  perform public.superadmin_finalize_test_week_drafts(p_pool_id, p_week);

  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  ),
  active_entries as (
    select pm.pool_id, pm.profile_id as user_id, pm.id as entry_id
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and lower(coalesce(nullif(pm.status::text, ''), 'alive')) in ('active', 'alive')
      and coalesce(s.eliminated, false) = false
  ),
  missing as (
    select ae.pool_id, ae.user_id, ae.entry_id, p_week as week, slots.slot, ('NO_PICK_' || slots.slot)::text as team_abbr
    from active_entries ae
    cross join slots
    where not exists (
      select 1
      from public.pool_picks pp
      where pp.pool_id = ae.pool_id
        and pp.entry_id = ae.entry_id
        and pp.week = p_week
        and pp.slot = slots.slot
    )
  ),
  inserted_no_picks as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, public.pool_test_clock_at(p_pool_id, p_week, 'week_done'), 'loss', now(), now()
    from missing
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  )
  select count(*) into v_no_picks from inserted_no_picks;

  select
    count(*)::integer,
    string_agg(distinct pp.team_abbr, ', ' order by pp.team_abbr)
    into v_missing_outcomes, v_missing_outcome_teams
  from public.pool_picks pp
  left join public.test_pool_team_results tr
    on tr.pool_id = pp.pool_id
   and tr.week = pp.week
   and tr.team_abbr = pp.team_abbr
  where pp.pool_id = p_pool_id
    and pp.week = p_week
    and pp.team_abbr not like 'NO_PICK%'
    and tr.team_abbr is null;

  if coalesce(v_missing_outcomes, 0) > 0 then
    raise exception 'Set fake outcomes for picked teams before scoring Week %: %.', p_week, coalesce(v_missing_outcome_teams, 'unknown');
  end if;

  with graded as (
    select
      pp.pool_id,
      pp.entry_id,
      pp.week,
      pp.slot,
      case
        when tr.result = 'push' then coalesce(nullif(po.tie_rule, ''), 'loss')
        else tr.result
      end as result
    from public.pool_picks pp
    join public.pools po on po.id = pp.pool_id
    join public.test_pool_team_results tr
      on tr.pool_id = pp.pool_id
     and tr.week = pp.week
     and tr.team_abbr = pp.team_abbr
    where pp.pool_id = p_pool_id
      and pp.week = p_week
      and pp.team_abbr not like 'NO_PICK%'
  ),
  updated as (
    update public.pool_picks pp
       set result = g.result,
           adjudicated_at = now()
      from graded g
     where pp.pool_id = g.pool_id
       and pp.entry_id = g.entry_id
       and pp.week = g.week
       and pp.slot = g.slot
       and pp.result is distinct from g.result
    returning 1
  )
  select count(*) into v_changed from updated;

  select count(*)::integer
    into v_scored
  from public.pool_picks pp
  where pp.pool_id = p_pool_id
    and pp.week = p_week
    and pp.result is not null;

  perform public.superadmin_rebuild_test_pool_stats(p_pool_id);
  perform public.prune_pool_picks_after_winner(p_pool_id);

  if public.pool_has_declared_winner(p_pool_id) then
    return 'Week ' || p_week || ' scored. A winner has been decided, so the pool is complete.';
  end if;

  if p_week >= 18 and coalesce(v_max_week, 18) > 18 then
    perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  end if;

  v_next_week := least(coalesce(v_max_week, 18), greatest(coalesce(p_week, v_start_week), p_week + 1));
  v_next_clock := public.pool_test_clock_at(p_pool_id, v_next_week, 'before_week');

  update public.pools
     set test_current_week = v_next_week,
         test_now_at = v_next_clock
   where id = p_pool_id;

  return 'Week ' || p_week || ' scored. ' || v_scored || ' official pick(s) scored, ' || v_no_picks || ' no-pick(s) recorded.';
end;
$function$;

revoke execute on function public.pool_has_declared_winner(uuid) from public, anon;
revoke execute on function public.pool_has_declared_winner(uuid) from authenticated;
grant execute on function public.pool_has_declared_winner(uuid) to service_role;
revoke execute on function public.pool_winner_status(uuid) from public, anon;
grant execute on function public.pool_winner_status(uuid) to authenticated, service_role;
revoke execute on function public.pool_winner_decided_week(uuid) from public, anon;
revoke execute on function public.pool_winner_decided_week(uuid) from authenticated;
grant execute on function public.pool_winner_decided_week(uuid) to service_role;
revoke execute on function public.prune_pool_picks_after_winner(uuid) from public, anon;
revoke execute on function public.prune_pool_picks_after_winner(uuid) from authenticated;
grant execute on function public.prune_pool_picks_after_winner(uuid) to service_role;
revoke execute on function public.guard_pool_pick_draft_security() from public, anon, authenticated;
grant execute on function public.guard_pool_pick_draft_security() to service_role;
revoke execute on function public.pool_week_pick_completion(uuid, integer) from public, anon;
grant execute on function public.pool_week_pick_completion(uuid, integer) to authenticated, service_role;
revoke execute on function public.pool_visible_picks(uuid, integer, boolean) from public, anon;
grant execute on function public.pool_visible_picks(uuid, integer, boolean) to authenticated, service_role;
revoke execute on function public.finalize_locked_picks(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks(uuid, integer) to service_role;
revoke execute on function public.finalize_no_pick_losses(uuid, integer) from public, anon, authenticated;
grant execute on function public.finalize_no_pick_losses(uuid, integer) to service_role;
revoke execute on function public.finalize_locked_picks_for_pool(uuid) from public, anon, authenticated;
grant execute on function public.finalize_locked_picks_for_pool(uuid) to service_role;
revoke execute on function public.superadmin_finalize_test_locked_picks(uuid, integer) from public, anon;
grant execute on function public.superadmin_finalize_test_locked_picks(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_finalize_test_week_drafts(uuid, integer) from public, anon;
grant execute on function public.superadmin_finalize_test_week_drafts(uuid, integer) to authenticated, service_role;
revoke execute on function public.superadmin_score_test_pool_week(uuid, integer) from public, anon;
grant execute on function public.superadmin_score_test_pool_week(uuid, integer) to authenticated, service_role;

commit;
