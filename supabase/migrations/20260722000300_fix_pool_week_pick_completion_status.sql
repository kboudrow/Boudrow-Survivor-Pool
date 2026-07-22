begin;

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

commit;
