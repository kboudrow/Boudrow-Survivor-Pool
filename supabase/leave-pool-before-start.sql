-- Let members leave a pool before its configured start time.
-- In the multi-entry model, leaving removes all entries owned by the user.

create or replace function public.leave_pool(p_pool_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_first_start timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to leave this pool.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if v_pool.created_by = auth.uid() then
    raise exception 'Pool creators cannot leave their own pool. Archive it from the admin panel instead.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_first_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = v_pool.start_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'You cannot leave this pool after it has started.';
  end if;

  delete from public.pool_members
  where pool_id = p_pool_id
    and profile_id = auth.uid();
end;
$function$;
