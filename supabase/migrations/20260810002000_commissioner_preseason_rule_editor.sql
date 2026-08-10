begin;

-- Commissioners may correct core rules while a pool is still in setup. The
-- database clock and the first kickoff remain authoritative; the UI is not the
-- security boundary.
create or replace function public.admin_update_pool_core_rules(
  p_pool_id uuid,
  p_start_week integer,
  p_include_playoffs boolean,
  p_strikes_allowed integer,
  p_tie_rule text,
  p_deadline_mode text,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_current_start timestamptz;
  v_next_start timestamptz;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select * into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then raise exception 'Pool not found.'; end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Pool rules cannot be changed after the pool has started.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time)) into v_current_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = coalesce(v_pool.start_week, 1);

  if v_current_start is not null and now() >= v_current_start then
    raise exception 'Pool rules cannot be changed after the pool has started.';
  end if;

  if p_start_week is null or p_start_week < 1 or p_start_week > 18 then
    raise exception 'Start week must be between Week 1 and Week 18.';
  end if;
  if p_strikes_allowed is null or p_strikes_allowed < 0 or p_strikes_allowed > 2 then
    raise exception 'Mulligans must be 0, 1, or 2.';
  end if;
  if lower(coalesce(p_tie_rule, '')) not in ('win', 'loss') then
    raise exception 'Tie rule must be win or loss.';
  end if;
  if lower(coalesce(p_deadline_mode, '')) not in ('fixed', 'rolling') then
    raise exception 'Pick deadline must be Sunday 1 PM ET or rolling kickoff.';
  end if;
  if char_length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Additional rules cannot exceed 2,000 characters.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time)) into v_next_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = p_start_week;

  if v_next_start is null then
    raise exception 'The NFL schedule for Week % is not available yet.', p_start_week;
  end if;
  if now() >= v_next_start then
    raise exception 'Week % has already started. Choose a future start week.', p_start_week;
  end if;

  if p_start_week > coalesce(v_pool.start_week, 1) and (
    exists (select 1 from public.pool_pick_drafts d where d.pool_id = p_pool_id and d.week < p_start_week)
    or exists (select 1 from public.pool_picks p where p.pool_id = p_pool_id and p.week < p_start_week)
  ) then
    raise exception 'This pool already has picks before Week %. Clear those picks before moving the start week later.', p_start_week;
  end if;

  update public.pools
  set start_week = p_start_week,
      include_playoffs = coalesce(p_include_playoffs, false),
      strikes_allowed = p_strikes_allowed::text,
      tie_rule = lower(p_tie_rule),
      ties = lower(p_tie_rule)::public.ties_rule,
      deadline_mode = lower(p_deadline_mode),
      deadline_fixed = '13:00',
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      double_pick_weeks = coalesce((
        select array_agg(w order by w)
        from unnest(coalesce(v_pool.double_pick_weeks, '{}'::integer[])) w
        where w between p_start_week and 18
      ), '{}'::integer[])
  where id = p_pool_id;
end;
$function$;

revoke execute on function public.admin_update_pool_core_rules(uuid,integer,boolean,integer,text,text,text) from public,anon;
grant execute on function public.admin_update_pool_core_rules(uuid,integer,boolean,integer,text,text,text) to authenticated,service_role;

commit;
