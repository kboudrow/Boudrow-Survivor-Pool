begin;

-- A test pool can declare its winner while its simulated clock still precedes
-- the deciding week's nominal lock time. Once the winner is final, every
-- finalized pick through that week is public to pool members.
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
    select 1 from public.pool_members pm
    where pm.pool_id = p_pool_id and pm.profile_id = auth.uid()
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
  join public.pools po on po.id = pp.pool_id
  left join public.pool_member_stats s
    on s.pool_id = pp.pool_id and s.entry_id = pp.entry_id
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
      or (v_decided_week is not null and pp.week <= v_decided_week)
      or (
        coalesce(po.test_mode, false)
        and pp.week < coalesce(po.test_current_week, po.start_week, pp.week)
      )
    )
  order by pp.week, pp.slot, pp.entry_id;
end;
$function$;

revoke execute on function public.pool_visible_picks(uuid, integer, boolean) from public, anon;
grant execute on function public.pool_visible_picks(uuid, integer, boolean) to authenticated, service_role;

commit;
