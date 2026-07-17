begin;

-- Keep fairness rules in the database, not just in client-side disabled states.
-- Draft picks cannot be saved or cleared once that selected team has locked.
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
  v_user_id uuid;
  v_pool public.pools%rowtype;
  v_slot integer := coalesce(p_slot, 1);
  v_team_abbr text := upper(trim(p_team_abbr));
  v_lock_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to make a pick.';
  end if;

  if v_team_abbr is null or v_team_abbr = '' then
    raise exception 'Choose a team before saving this pick.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if p_week < coalesce(v_pool.start_week, 1) then
    raise exception 'This pool starts in Week %.', coalesce(v_pool.start_week, 1);
  end if;

  select pm.profile_id
  into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  if v_user_id <> auth.uid() then
    raise exception 'This entry does not belong to you.';
  end if;

  if exists (
    select 1
    from public.pool_picks pp
    where pp.pool_id = p_pool_id
      and pp.entry_id = p_entry_id
      and pp.week = p_week
      and pp.slot = v_slot
  ) then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  select
    case
      when coalesce(v_pool.deadline_mode, 'fixed') = 'fixed' then
        least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(p_pool_id, p_week))
      else coalesce(g.kickoff_at_utc, g.game_time)
    end
  into v_lock_at
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = p_week
    and v_team_abbr in (upper(g.home_team), upper(g.away_team))
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
  order by coalesce(g.kickoff_at_utc, g.game_time)
  limit 1;

  if v_lock_at is null then
    raise exception 'That team is not scheduled for Week %.', p_week;
  end if;

  if now() >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, v_slot, v_team_abbr, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        updated_at = now();
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
  v_user_id uuid;
  v_pool public.pools%rowtype;
  v_slot integer := coalesce(p_slot, 1);
  v_team_abbr text;
  v_lock_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to clear a pick.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id;

  if not found then
    raise exception 'Pool not found.';
  end if;

  select pm.profile_id
  into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  if v_user_id <> auth.uid() then
    raise exception 'This entry does not belong to you.';
  end if;

  select upper(d.team_abbr)
  into v_team_abbr
  from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;

  if v_team_abbr is null then
    return;
  end if;

  select
    case
      when coalesce(v_pool.deadline_mode, 'fixed') = 'fixed' then
        least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(p_pool_id, p_week))
      else coalesce(g.kickoff_at_utc, g.game_time)
    end
  into v_lock_at
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = p_week
    and v_team_abbr in (upper(g.home_team), upper(g.away_team))
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
  order by coalesce(g.kickoff_at_utc, g.game_time)
  limit 1;

  if v_lock_at is not null and now() >= v_lock_at then
    raise exception 'This pick is locked and can no longer be changed.';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = v_slot;
end;
$function$;

-- New members and extra entries are blocked once the pool's configured start week begins.
create or replace function public.join_pool(p_pool_id uuid, p_password text default null, p_token text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry_count integer;
  v_is_owner boolean;
  v_password_hash text;
  v_next_entry integer;
  v_start_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to join this pool.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  v_is_owner := v_pool.created_by = auth.uid();

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  if coalesce(v_pool.activation_status, 'draft') = 'cancelled' then
    raise exception 'This pool is not accepting members.';
  end if;

  if exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    return;
  end if;

  select coalesce(
    (
      select min(coalesce(g.kickoff_at_utc, g.game_time))
      from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
    ),
    (
      select sw.week_sunday_date::timestamp at time zone 'America/New_York'
      from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1)
    )
  )
  into v_start_at;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'This pool has already started.';
  end if;

  select count(*)
  into v_entry_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id;

  if not v_is_owner and v_entry_count >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  if not coalesce(v_pool.is_public, false) and not v_is_owner then
    v_password_hash := coalesce(v_pool.join_password_hash, v_pool.password_hash, v_pool.private_password_hash);
    if v_password_hash is null
      or p_password is null
      or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
      raise exception 'Incorrect pool password.';
    end if;
  end if;

  select coalesce(max(pm.entry_number), 0) + 1
  into v_next_entry
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = auth.uid();

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (
    p_pool_id,
    auth.uid(),
    case when v_is_owner then 'admin'::public.member_role else 'member'::public.member_role end,
    'alive',
    v_next_entry
  );
end;
$function$;

create or replace function public.add_pool_entry(p_pool_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_current_entries integer;
  v_pool_entries integer;
  v_next_entry integer;
  v_entry_id uuid;
  v_start_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to add an entry.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  select coalesce(
    (
      select min(coalesce(g.kickoff_at_utc, g.game_time))
      from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
    ),
    (
      select sw.week_sunday_date::timestamp at time zone 'America/New_York'
      from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1)
    )
  )
  into v_start_at;

  if v_start_at is not null and now() >= v_start_at then
    raise exception 'This pool has already started.';
  end if;

  if not coalesce(v_pool.allow_multiple_entries, false) then
    raise exception 'This pool only allows one entry per user.';
  end if;

  select count(*), coalesce(max(entry_number), 0) + 1
  into v_current_entries, v_next_entry
  from public.pool_members
  where pool_id = p_pool_id
    and profile_id = auth.uid();

  if v_current_entries = 0 then
    raise exception 'Join this pool before adding another entry.';
  end if;

  if v_current_entries >= coalesce(v_pool.max_entries_per_user, 1) then
    raise exception 'You have reached the entry limit for this pool.';
  end if;

  select count(*)
  into v_pool_entries
  from public.pool_members
  where pool_id = p_pool_id;

  if v_pool_entries >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (p_pool_id, auth.uid(), 'member'::public.member_role, 'alive', v_next_entry)
  returning id into v_entry_id;

  return v_entry_id;
end;
$function$;

grant execute on function public.save_entry_draft_pick(uuid, uuid, integer, integer, text) to authenticated;
grant execute on function public.clear_entry_draft_pick(uuid, uuid, integer, integer) to authenticated;
grant execute on function public.join_pool(uuid, text, text) to authenticated;
grant execute on function public.add_pool_entry(uuid) to authenticated;

commit;
