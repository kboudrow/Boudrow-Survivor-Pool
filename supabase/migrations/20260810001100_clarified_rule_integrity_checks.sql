alter function public.admin_pool_scoring_integrity(uuid)
  rename to admin_pool_scoring_integrity_pre_clarified_rules;

create function public.admin_pool_scoring_integrity(p_pool_id uuid)
returns table(check_name text,status text,issue_count integer,detail text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  row_result record;
  corrected_count integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;

  for row_result in select * from public.admin_pool_scoring_integrity_pre_clarified_rules(p_pool_id)
  loop
    corrected_count:=null;

    if row_result.check_name='no_repeat_teams' then
      select count(*)::integer into corrected_count from (
        select used.entry_id,public.pool_pick_phase(used.week),upper(used.team_abbr)
        from (
          select pp.entry_id,pp.week,pp.team_abbr from public.pool_picks pp
          where pp.pool_id=p_pool_id and pp.team_abbr not like 'NO_PICK%'
          union all
          select d.entry_id,d.week,d.team_abbr from public.pool_pick_drafts d
          where d.pool_id=p_pool_id and d.team_abbr not like 'NO_PICK%'
        ) used
        group by used.entry_id,public.pool_pick_phase(used.week),upper(used.team_abbr)
        having count(*)>1
      ) repeats;
      return query select row_result.check_name,
        case when corrected_count=0 then 'pass' else 'fail' end,
        corrected_count,
        case when corrected_count=0 then 'No entry has reused a team within the regular season or within the postseason.'
          else corrected_count||' same-phase repeated team use issue(s) found.' end;

    elsif row_result.check_name='future_picks_after_elimination' then
      select count(*)::integer into corrected_count from (
        select pp.entry_id from public.pool_picks pp join public.pool_member_stats s
          on s.pool_id=pp.pool_id and s.entry_id=pp.entry_id
        where pp.pool_id=p_pool_id and s.eliminated and pp.week>s.eliminated_week
        union all
        select d.entry_id from public.pool_pick_drafts d join public.pool_member_stats s
          on s.pool_id=d.pool_id and s.entry_id=d.entry_id
        where d.pool_id=p_pool_id and s.eliminated and d.week>s.eliminated_week
      ) future_rows;
      return query select row_result.check_name,
        case when corrected_count=0 then 'pass' else 'fail' end,corrected_count,
        case when corrected_count=0 then 'No entry has draft or final picks after its elimination week.'
          else corrected_count||' future pick row(s) exist after elimination.' end;

    elsif row_result.check_name='stats_snapshot_sync' then
      select count(*)::integer into corrected_count
      from public.pool_member_stats s
      join public.pool_members pm on pm.pool_id=s.pool_id and pm.id=s.entry_id
      left join lateral (
        select count(*) filter(where pp.result='win')::integer wins,
          count(*) filter(where pp.result='loss')::integer losses,
          count(*) filter(where pp.result='push')::integer pushes
        from public.pool_picks pp
        where pp.pool_id=s.pool_id and pp.entry_id=s.entry_id and pp.result is not null
          and (s.eliminated_week is null or pp.week<=s.eliminated_week)
      ) ledger on true
      where s.pool_id=p_pool_id and (
        s.user_id is distinct from pm.profile_id or coalesce(s.wins,0)<>coalesce(ledger.wins,0)
        or coalesce(s.losses,0)<>coalesce(ledger.losses,0) or coalesce(s.pushes,0)<>coalesce(ledger.pushes,0)
        or coalesce(s.strikes_used,0)<>coalesce(ledger.losses,0)
      );
      return query select row_result.check_name,
        case when corrected_count=0 then 'pass' else 'warning' end,corrected_count,
        case when corrected_count=0 then 'Stored stats match the pick ledger, including survival-grace weeks.'
          else corrected_count||' entry stat snapshot(s) differ from the pick ledger.' end;

    elsif row_result.check_name='member_status_sync' then
      select count(*)::integer into corrected_count
      from public.pool_members pm join public.pool_member_stats s on s.pool_id=pm.pool_id and s.entry_id=pm.id
      where pm.pool_id=p_pool_id and (
        (lower(coalesce(pm.status::text,'alive'))='eliminated') is distinct from s.eliminated
        or pm.eliminated_week is distinct from s.eliminated_week
      );
      return query select row_result.check_name,
        case when corrected_count=0 then 'pass' else 'warning' end,corrected_count,
        case when corrected_count=0 then 'Member status matches grace-aware scoring.'
          else corrected_count||' member status row(s) differ from grace-aware scoring.' end;

    elsif row_result.check_name='real_results_only_after_final' then
      select count(*)::integer into corrected_count
      from public.pool_picks pp join public.pools po on po.id=pp.pool_id
      left join lateral(
        select g.status from public.pool_week_games(p_pool_id,pp.week) g
        where pp.team_abbr in(g.home_team,g.away_team) limit 1
      ) game on true
      where pp.pool_id=p_pool_id and pp.week between 1 and public.pool_max_pick_week(p_pool_id)
        and pp.result is not null and pp.team_abbr not like 'NO_PICK%'
        and not coalesce(po.test_mode,false) and coalesce(game.status,'scheduled')<>'final';
      return query select row_result.check_name,
        case when corrected_count=0 then 'pass' else 'fail' end,corrected_count,
        case when corrected_count=0 then 'No real pool picks have results before the game is final.'
          else corrected_count||' real pool pick result(s) are attached before the game is final.' end;

    else
      return query select row_result.check_name,row_result.status,row_result.issue_count,row_result.detail;
    end if;
  end loop;
end;
$function$;

revoke execute on function public.admin_pool_scoring_integrity_pre_clarified_rules(uuid) from public,anon,authenticated;
revoke execute on function public.admin_pool_scoring_integrity(uuid) from public,anon;
grant execute on function public.admin_pool_scoring_integrity(uuid) to authenticated,service_role;
