-- Prevent admins from archiving a pool after its start week has kicked off.

create or replace function public.admin_archive_pool(
  p_pool_id uuid,
  p_archived boolean
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_start_at timestamptz;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select *
    into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'pool not found';
  end if;

  if p_archived then
    select min(coalesce(g.kickoff_at_utc, g.game_time))
      into v_start_at
    from public.nfl_games g
    where g.season = coalesce(v_pool.season, extract(year from now())::int)
      and g.week = v_pool.start_week;

    if v_start_at is not null and now() >= v_start_at then
      raise exception 'Pools cannot be archived after the league has started.';
    end if;
  end if;

  update public.pools
  set archived = p_archived,
      archived_at = case when p_archived then now() else null end
  where id = p_pool_id;
end;
$function$;
