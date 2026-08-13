begin;

-- Players may plan ahead in every scheduled future week. The current-week
-- boundary only protects past weeks; the existing write implementation still
-- enforces entry ownership, elimination, pool limits, team reuse, confirmed
-- matchups, and the selected team's authoritative deadline.
create or replace function public.save_entry_draft_pick(
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
  v_current_week integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0));
  v_current_week := public.pool_open_pick_week(p_pool_id);
  if p_week < v_current_week then
    raise exception 'Week % is no longer available for picks. Week % is the current survivor week.', p_week, v_current_week;
  end if;
  perform public.save_entry_draft_pick_unserialized(p_pool_id, p_entry_id, p_week, p_slot, p_team_abbr);
end;
$function$;

create or replace function public.clear_entry_draft_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_week integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_pool_id::text || ':' || p_entry_id::text, 0));
  v_current_week := public.pool_open_pick_week(p_pool_id);
  if p_week < v_current_week then
    raise exception 'Week % is no longer available for pick changes. Week % is the current survivor week.', p_week, v_current_week;
  end if;
  perform public.clear_entry_draft_pick_unserialized(p_pool_id, p_entry_id, p_week, p_slot);
end;
$function$;

revoke all on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) from public, anon;
revoke all on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated, service_role;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated, service_role;

commit;
