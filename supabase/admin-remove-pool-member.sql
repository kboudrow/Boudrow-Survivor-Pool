create or replace function public.admin_remove_pool_member(
  p_pool_id uuid,
  p_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_user_entry_count integer := 0;
  v_removed integer := 0;
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
    raise exception 'Pool not found.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_start_at
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = v_pool.start_week;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'Members cannot be removed after the league has started.';
  end if;

  select count(*)
  into v_user_entry_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  if v_user_entry_count = 0 then
    raise exception 'Member not found in this pool.';
  end if;

  if p_profile_id = v_pool.created_by then
    raise exception 'The pool creator cannot be removed from their own pool.';
  end if;

  delete from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = p_profile_id;

  get diagnostics v_removed = row_count;
  return v_removed;
end;
$function$;
