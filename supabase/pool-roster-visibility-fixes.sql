-- Fix roster visibility, admin pool visibility changes, and stale Week 1 schedule rows.

begin;

delete from public.nfl_games
where season = 2026
  and week = 1
  and kickoff_at_utc is null
  and game_time < timestamptz '2026-01-01';

create or replace function public.pool_member_roster(p_pool_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view this pool.';
  end if;

  if not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pm.profile_id,
    coalesce(
      nullif(pr.display_name, ''),
      nullif(pr.username, ''),
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Player ' || left(pm.profile_id::text, 8)
    ) as display_name,
    pr.username,
    pr.first_name,
    pr.last_name,
    pr.avatar_url,
    pm.role::text as role,
    pm.status::text as status,
    pm.joined_at
  from public.pool_members pm
  left join public.profiles pr on pr.id = pm.profile_id
  where pm.pool_id = p_pool_id
  order by display_name;
end;
$function$;

create or replace function public.admin_update_pool_visibility(
  p_pool_id uuid,
  p_is_public boolean,
  p_password text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_first_start timestamptz;
  v_hash text;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    p.id,
    coalesce(p.season, extract(year from now())::integer) as season,
    coalesce(p.start_week, 1) as start_week
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if v_pool.id is null then
    raise exception 'pool not found';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_first_start
  from public.nfl_games g
  where g.season = v_pool.season
    and g.week = v_pool.start_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(v_pool.season, 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  if not coalesce(p_is_public, false) then
    if nullif(btrim(coalesce(p_password, '')), '') is null then
      raise exception 'Enter a pool password before switching this pool to private.';
    end if;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 8));
  end if;

  update public.pools
  set
    is_public = coalesce(p_is_public, false),
    visibility = case when coalesce(p_is_public, false) then 'public'::public.pool_visibility else 'private'::public.pool_visibility end,
    join_password_hash = case when v_hash is null then join_password_hash else v_hash end,
    password_hash = case when v_hash is null then password_hash else v_hash end,
    private_password_hash = case when v_hash is null then private_password_hash else v_hash end
  where id = p_pool_id;
end;
$function$;

commit;
