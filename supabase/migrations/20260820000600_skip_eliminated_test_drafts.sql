begin;

-- Test-mode clock and scoring finalizers must leave retained evidence drafts
-- untouched once their entry has been eliminated.
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
    select d.pool_id,d.user_id,d.entry_id,d.week,d.slot,d.team_abbr,
      case when ps.deadline_mode = 'fixed'
        then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(d.pool_id,d.week))
        else coalesce(g.kickoff_at_utc,g.game_time) end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.pool_members pm on pm.pool_id = d.pool_id and pm.id = d.entry_id
    left join public.pool_member_stats stats on stats.pool_id = d.pool_id and stats.entry_id = d.entry_id
    join public.pool_week_games(p_pool_id,p_week) g
      on g.week = d.week and d.team_abbr in (g.home_team,g.away_team)
    where d.pool_id = p_pool_id and d.week = p_week
      and lower(coalesce(nullif(pm.status::text,''),'alive')) in ('active','alive')
      and coalesce(stats.eliminated,false) = false
  ),
  to_commit as (select * from draft_locks where lock_at <= v_now),
  ins as (
    insert into public.pool_picks(pool_id,user_id,entry_id,week,slot,team_abbr,locked_at,created_at)
    select pool_id,user_id,entry_id,week,slot,team_abbr,lock_at,now() from to_commit
    on conflict (pool_id,entry_id,week,slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d using to_commit tc
    where d.pool_id=tc.pool_id and d.entry_id=tc.entry_id and d.week=tc.week and d.slot=tc.slot
    returning 1
  )
  select count(*)::integer into inserted from ins;
  return coalesce(inserted,0);
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
    select p.id,coalesce(p.deadline_mode,'fixed') as deadline_mode
    from public.pools p
    where p.id=p_pool_id and coalesce(p.test_mode,false)=true
      and coalesce(p.archived,false)=false
      and coalesce(p.activation_status,'active')='active'
  ),
  draft_locks as (
    select d.pool_id,d.user_id,d.entry_id,d.week,d.slot,d.team_abbr,
      case when ps.deadline_mode='fixed'
        then least(coalesce(g.kickoff_at_utc,g.game_time),public.pool_week_deadline_at(d.pool_id,d.week))
        else coalesce(g.kickoff_at_utc,g.game_time) end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id=d.pool_id
    join public.pool_members pm on pm.pool_id=d.pool_id and pm.id=d.entry_id
    left join public.pool_member_stats stats on stats.pool_id=d.pool_id and stats.entry_id=d.entry_id
    join public.pool_week_games(p_pool_id,p_week) g
      on g.week=d.week and d.team_abbr in (g.home_team,g.away_team)
    where d.pool_id=p_pool_id and d.week=p_week
      and lower(coalesce(nullif(pm.status::text,''),'alive')) in ('active','alive')
      and coalesce(stats.eliminated,false)=false
  ),
  ins as (
    insert into public.pool_picks(pool_id,user_id,entry_id,week,slot,team_abbr,locked_at,created_at)
    select pool_id,user_id,entry_id,week,slot,team_abbr,lock_at,now() from draft_locks
    on conflict (pool_id,entry_id,week,slot) do update set
      team_abbr=excluded.team_abbr,user_id=excluded.user_id,locked_at=excluded.locked_at
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d using draft_locks dl
    where d.pool_id=dl.pool_id and d.entry_id=dl.entry_id and d.week=dl.week and d.slot=dl.slot
    returning 1
  )
  select count(*)::integer into inserted from ins;
  return coalesce(inserted,0);
end;
$function$;

revoke execute on function public.superadmin_finalize_test_locked_picks(uuid,integer) from public,anon;
revoke execute on function public.superadmin_finalize_test_week_drafts(uuid,integer) from public,anon;
grant execute on function public.superadmin_finalize_test_locked_picks(uuid,integer) to authenticated,service_role;
grant execute on function public.superadmin_finalize_test_week_drafts(uuid,integer) to authenticated,service_role;

commit;
