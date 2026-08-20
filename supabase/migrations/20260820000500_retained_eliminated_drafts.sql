begin;

-- Future drafts are retained as dispute/correction evidence. They are hidden
-- from eliminated players and excluded from scoring, so only a locked pick
-- after elimination is an integrity failure.
alter function public.admin_pool_scoring_integrity(uuid)
  rename to admin_pool_scoring_integrity_pre_retained_drafts;

create function public.admin_pool_scoring_integrity(p_pool_id uuid)
returns table(check_name text,status text,issue_count integer,detail text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  row_result record;
  locked_count integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;

  for row_result in
    select * from public.admin_pool_scoring_integrity_pre_retained_drafts(p_pool_id)
  loop
    if row_result.check_name = 'future_picks_after_elimination' then
      select count(*)::integer into locked_count
      from public.pool_picks pick
      join public.pool_member_stats stats
        on stats.pool_id = pick.pool_id and stats.entry_id = pick.entry_id
      where pick.pool_id = p_pool_id
        and stats.eliminated
        and pick.week > stats.eliminated_week;

      return query select
        row_result.check_name,
        case when locked_count = 0 then 'pass' else 'fail' end,
        locked_count,
        case when locked_count = 0
          then 'Future saved drafts for eliminated entries are retained as inactive evidence; no locked picks exist after elimination.'
          else locked_count || ' locked pick row(s) exist after elimination.'
        end;
    else
      return query select row_result.check_name,row_result.status,row_result.issue_count,row_result.detail;
    end if;
  end loop;
end;
$function$;

create or replace function public.admin_repair_pool_scoring_state(p_pool_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer := 0;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  v_rows := public.rebuild_pool_member_stats(p_pool_id);
  return 'Scoring rebuilt for ' || v_rows || ' entr' || case when v_rows = 1 then 'y' else 'ies' end || '. Retained future drafts remain inactive.';
end;
$function$;

revoke execute on function public.admin_pool_scoring_integrity_pre_retained_drafts(uuid) from public,anon,authenticated;
revoke execute on function public.admin_pool_scoring_integrity(uuid) from public,anon;
revoke execute on function public.admin_repair_pool_scoring_state(uuid) from public,anon;
grant execute on function public.admin_pool_scoring_integrity(uuid) to authenticated,service_role;
grant execute on function public.admin_repair_pool_scoring_state(uuid) to authenticated,service_role;

commit;
