begin;

-- Wipeout protection exists to carry a group of surviving entries forward
-- when they all lose together. A lone entry is not a group and must be
-- eliminated normally after exceeding its configured mulligans.
create or replace function public.pool_alive_entries_entering_week(
  p_pool_id uuid,
  p_week integer
)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::integer
  from public.pool_members entry
  join public.pools pool on pool.id = entry.pool_id
  where entry.pool_id = p_pool_id
    and (
      select count(*)::integer
      from public.pool_picks pick
      where pick.pool_id = entry.pool_id
        and pick.entry_id = entry.id
        and pick.week < p_week
        and pick.result = 'loss'
    ) <= greatest(0, coalesce(nullif(pool.strikes_allowed, '')::integer, 0))
      + coalesce((
        select sum(grace.strike_credits)::integer
        from public.pool_entry_survival_graces grace
        where grace.pool_id = entry.pool_id
          and grace.entry_id = entry.id
          and grace.week < p_week
      ), 0)
$function$;

create or replace function public.guard_survival_grace_grading_complete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.pool_week_grading_complete(new.pool_id, new.week) then
    return null;
  end if;
  if public.pool_alive_entries_entering_week(new.pool_id, new.week) < 2 then
    return null;
  end if;
  return new;
end;
$function$;

-- Correct only credits that never qualified under the group-wipeout rule,
-- then rebuild those pools so status and future drafts follow automatically.
do $function$
declare
  v_pool_id uuid;
begin
  for v_pool_id in
    with removed as (
      delete from public.pool_entry_survival_graces grace
      where public.pool_alive_entries_entering_week(grace.pool_id, grace.week) < 2
      returning grace.pool_id
    )
    select distinct removed.pool_id from removed
  loop
    perform public.rebuild_pool_member_stats(v_pool_id);
  end loop;
end;
$function$;

revoke all on function public.pool_alive_entries_entering_week(uuid, integer) from public, anon, authenticated;
revoke all on function public.guard_survival_grace_grading_complete() from public, anon, authenticated;
grant execute on function public.pool_alive_entries_entering_week(uuid, integer) to service_role;
grant execute on function public.guard_survival_grace_grading_complete() to service_role;

commit;
