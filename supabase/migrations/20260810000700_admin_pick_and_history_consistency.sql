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
  v_team text := upper(btrim(coalesce(p_team_abbr, '')));
  v_slot integer := coalesce(p_slot, 1);
  v_test_mode boolean;
  v_season integer;
  v_required_picks integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  if v_team = '' then raise exception 'Choose a team before saving this pick.'; end if;

  select pm.profile_id into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id and pm.id = p_entry_id;
  if v_user_id is null then raise exception 'Entry not found.'; end if;

  select
    coalesce(p.test_mode, false),
    coalesce(p.season, extract(year from now())::integer),
    public.picks_allowed(p.id, p_week)
  into v_test_mode, v_season, v_required_picks
  from public.pools p
  where p.id = p_pool_id;

  if not found then raise exception 'Pool not found.'; end if;
  if coalesce(v_required_picks, 0) = 0 then
    raise exception 'Week % is outside this pool''s playable season.', p_week;
  end if;
  if v_slot < 1 or v_slot > v_required_picks then
    raise exception 'Slot % is not valid for Week %; this pool requires % pick(s).', v_slot, p_week, v_required_picks;
  end if;

  if not exists (
    select 1 from public.pool_week_games(p_pool_id, p_week) g
    where v_team in (upper(g.home_team), upper(g.away_team))
  ) then raise exception 'That team is not scheduled for Week %.', p_week; end if;

  if exists (
    select 1 from public.pool_picks p
    where p.pool_id = p_pool_id and p.entry_id = p_entry_id
      and upper(btrim(p.team_abbr)) = v_team and p.team_abbr not like 'NO_PICK%'
      and not (p.week = p_week and p.slot = v_slot)
  ) or exists (
    select 1 from public.pool_pick_drafts d
    where d.pool_id = p_pool_id and d.entry_id = p_entry_id
      and upper(btrim(d.team_abbr)) = v_team and d.team_abbr not like 'NO_PICK%'
      and not (d.week = p_week and d.slot = v_slot)
  ) then raise exception 'This entry has already used %.', v_team; end if;

  insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, v_slot, v_team, now(), null, null, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr, user_id = excluded.user_id,
        locked_at = now(), result = null, adjudicated_at = null;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id and d.entry_id = p_entry_id and d.week = p_week and d.slot = v_slot;

  if v_test_mode then
    update public.pool_picks pick
       set result = case
             when result_row.result = 'push' then coalesce(nullif(pool.tie_rule, ''), 'loss')
             else result_row.result
           end,
           adjudicated_at = now()
      from public.pools pool
      join public.test_pool_team_results result_row
        on result_row.pool_id = pool.id and result_row.week = p_week and result_row.team_abbr = v_team
     where pool.id = p_pool_id
       and pick.pool_id = p_pool_id and pick.entry_id = p_entry_id
       and pick.week = p_week and pick.slot = v_slot;
    perform public.superadmin_rebuild_test_pool_stats(p_pool_id);
  else
    perform public.adjudicate_results(v_season, p_week);
    perform public.rebuild_pool_member_stats(p_pool_id);
  end if;
end;
$function$;

revoke execute on function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer) from public, anon;
grant execute on function public.admin_override_entry_final_pick(uuid, uuid, integer, text, text, integer) to authenticated, service_role;

drop function if exists public.get_my_pool_history();
create function public.get_my_pool_history()
returns table (
  pool_id uuid,
  pool_name text,
  season integer,
  status text,
  eliminated_week integer,
  strikes_used integer,
  wins integer,
  losses integer,
  pushes integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with my_entries as (
    select pm.pool_id, pm.id as entry_id,
      lower(coalesce(nullif(pm.status::text, ''), 'alive')) as member_status
    from public.pool_members pm
    where pm.profile_id = auth.uid()
  ),
  rolled as (
    select
      me.pool_id,
      sum(coalesce(s.wins, 0))::integer as wins,
      sum(coalesce(s.losses, 0))::integer as losses,
      sum(coalesce(s.pushes, 0))::integer as pushes,
      sum(coalesce(s.strikes_used, 0))::integer as strikes_used,
      max(s.eliminated_week)::integer as eliminated_week,
      bool_or(case when s.entry_id is not null then coalesce(s.eliminated, false)
        else me.member_status not in ('active', 'alive') end) as any_eliminated,
      bool_or(case when s.entry_id is not null then not coalesce(s.eliminated, false)
        else me.member_status in ('active', 'alive') end) as any_alive
    from my_entries me
    left join public.pool_member_stats s on s.pool_id = me.pool_id and s.entry_id = me.entry_id
    group by me.pool_id
  )
  select
    p.id,
    p.name::text,
    coalesce(p.season, extract(year from now())::integer)::integer,
    case
      when winner.is_decided and winner.winner_user_id = auth.uid() then 'Won'
      when rolled.any_alive and not coalesce(p.archived, false) then 'In progress'
      when rolled.any_eliminated and rolled.eliminated_week is not null then 'Eliminated Week ' || rolled.eliminated_week::text
      when coalesce(p.archived, false) then 'Archived'
      else 'In progress'
    end::text,
    rolled.eliminated_week,
    coalesce(rolled.strikes_used, 0)::integer,
    coalesce(rolled.wins, 0)::integer,
    coalesce(rolled.losses, 0)::integer,
    coalesce(rolled.pushes, 0)::integer
  from rolled
  join public.pools p on p.id = rolled.pool_id
  left join lateral public.pool_winner_status(p.id) winner on true
  order by coalesce(p.season, extract(year from now())::integer) desc, p.created_at desc nulls last, p.name;
$function$;

revoke execute on function public.get_my_pool_history() from public, anon;
grant execute on function public.get_my_pool_history() to authenticated, service_role;
