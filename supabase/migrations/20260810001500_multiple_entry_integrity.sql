begin;

-- The entry row is the authoritative identity for gameplay. Keep the legacy
-- user_id columns consistent with it even for service-role and future RPC writes.
create unique index if not exists pool_members_pool_id_id_profile_id_key
  on public.pool_members (pool_id, id, profile_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_pick_drafts'::regclass
      and conname = 'pool_pick_drafts_entry_owner_fkey'
  ) then
    alter table public.pool_pick_drafts
      add constraint pool_pick_drafts_entry_owner_fkey
      foreign key (pool_id, entry_id, user_id)
      references public.pool_members (pool_id, id, profile_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_picks'::regclass
      and conname = 'pool_picks_entry_owner_fkey'
  ) then
    alter table public.pool_picks
      add constraint pool_picks_entry_owner_fkey
      foreign key (pool_id, entry_id, user_id)
      references public.pool_members (pool_id, id, profile_id)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_member_stats'::regclass
      and conname = 'pool_member_stats_entry_owner_fkey'
  ) then
    alter table public.pool_member_stats
      add constraint pool_member_stats_entry_owner_fkey
      foreign key (pool_id, entry_id, user_id)
      references public.pool_members (pool_id, id, profile_id)
      on delete cascade;
  end if;
end $$;

-- Reads of private picks follow entry ownership, not the redundant user_id.
drop policy if exists pool_pick_drafts_select_own_or_admin on public.pool_pick_drafts;
create policy pool_pick_drafts_select_own_or_admin
on public.pool_pick_drafts
for select
to authenticated
using (
  exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = pool_pick_drafts.pool_id
      and pm.id = pool_pick_drafts.entry_id
      and pm.profile_id = auth.uid()
  )
  or public.admin_can_manage(pool_id)
);

drop policy if exists pool_picks_select_own_or_admin on public.pool_picks;
create policy pool_picks_select_own_or_admin
on public.pool_picks
for select
to authenticated
using (
  exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = pool_picks.pool_id
      and pm.id = pool_picks.entry_id
      and pm.profile_id = auth.uid()
  )
  or public.admin_can_manage(pool_id)
);

create or replace function public.count_pool_entries(p_pool_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::integer
  from public.pool_members pm
  where pm.pool_id = p_pool_id;
$function$;

grant execute on function public.count_pool_entries(uuid) to anon, authenticated, service_role;

drop function if exists public.get_pool_invite(uuid);
create function public.get_pool_invite(p_pool_id uuid)
returns table (
  id uuid,
  name text,
  season integer,
  is_public boolean,
  start_week integer,
  include_playoffs boolean,
  strikes_allowed integer,
  tie_rule text,
  deadline_mode text,
  deadline_fixed text,
  notes text,
  created_by uuid,
  activation_status text,
  max_members integer,
  member_count integer,
  entry_count integer,
  test_mode boolean,
  test_current_week integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    p.id,
    p.name,
    coalesce(p.season, extract(year from now())::integer),
    p.is_public,
    p.start_week,
    p.include_playoffs,
    p.strikes_allowed::integer,
    p.tie_rule::text,
    p.deadline_mode::text,
    p.deadline_fixed,
    p.notes,
    p.created_by,
    p.activation_status::text,
    p.max_members,
    count(distinct pm.profile_id)::integer,
    count(pm.id)::integer,
    coalesce(p.test_mode, false),
    p.test_current_week
  from public.pools p
  left join public.pool_members pm on pm.pool_id = p.id
  where p.id = p_pool_id
    and coalesce(p.archived, false) = false
  group by p.id
  limit 1;
$function$;

grant execute on function public.get_pool_invite(uuid) to anon, authenticated, service_role;

drop function if exists public.search_pools(text);
create function public.search_pools(p_term text)
returns table (
  id uuid,
  name text,
  is_public boolean,
  allow_discovery boolean,
  start_week integer,
  include_playoffs boolean,
  strikes_allowed text,
  tie_rule text,
  deadline_mode text,
  deadline_fixed text,
  notes text,
  created_at timestamptz,
  activation_status text,
  max_members integer,
  member_count integer,
  entry_count integer,
  owned_by_me boolean,
  already_joined boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with input as (
    select btrim(coalesce(p_term, '')) as term
  ),
  candidate_pools as (
    select
      p.*,
      coalesce(
        (
          select min(coalesce(g.kickoff_at_utc, g.game_time))
          from public.nfl_games g
          where g.season = coalesce(p.season, extract(year from now())::integer)
            and g.week = coalesce(p.start_week, 1)
            and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(p.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
        ),
        (
          select sw.week_sunday_date::timestamp at time zone 'America/New_York'
          from public.season_weeks sw
          where sw.season = coalesce(p.season, extract(year from now())::integer)
            and sw.week = coalesce(p.start_week, 1)
        )
      ) as starts_at
    from public.pools p
  )
  select
    p.id,
    p.name,
    p.is_public,
    p.allow_discovery,
    p.start_week,
    p.include_playoffs,
    p.strikes_allowed::text,
    p.tie_rule::text,
    p.deadline_mode::text,
    p.deadline_fixed,
    case when coalesce(p.is_public, false) then p.notes else null end,
    p.created_at,
    coalesce(p.activation_status, 'active')::text,
    p.max_members,
    (select count(distinct pm.profile_id)::integer from public.pool_members pm where pm.pool_id = p.id),
    (select count(*)::integer from public.pool_members pm where pm.pool_id = p.id),
    (auth.uid() is not null and p.created_by = auth.uid()),
    (
      auth.uid() is not null
      and exists (
        select 1 from public.pool_members mine
        where mine.pool_id = p.id and mine.profile_id = auth.uid()
      )
    )
  from candidate_pools p
  cross join input i
  where coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
    and (p.starts_at is null or now() < p.starts_at)
    and not (
      coalesce(p.test_mode, false)
      and coalesce(p.test_current_week, p.start_week, 1) >= coalesce(p.start_week, 1)
    )
    and (
      (i.term = '' and coalesce(p.is_public, false))
      or (
        i.term <> ''
        and p.name ilike ('%' || i.term || '%')
        and (coalesce(p.is_public, false) or length(i.term) >= 2)
      )
    )
  order by p.created_at desc
  limit 50;
$function$;

revoke all on function public.search_pools(text) from public;
grant execute on function public.search_pools(text) to anon, authenticated, service_role;

create or replace function public.remove_pool_entry(p_pool_id uuid, p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry public.pool_members%rowtype;
  v_entry_count integer;
  v_start_at timestamptz;
begin
  perform public.assert_user_email_confirmed('remove an entry');
  perform public.assert_action_rate_limit('remove_pool_entry', 600, 10, p_pool_id::text);

  select * into v_pool from public.pools where id = p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;

  select * into v_entry
  from public.pool_members
  where pool_id = p_pool_id and id = p_entry_id;
  if not found then raise exception 'Entry not found.'; end if;
  if v_entry.profile_id <> auth.uid() then raise exception 'This entry does not belong to you.'; end if;

  select count(*) into v_entry_count
  from public.pool_members
  where pool_id = p_pool_id and profile_id = auth.uid();
  if v_entry_count <= 1 then raise exception 'Use Leave pool to remove your only entry.'; end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Entries cannot be removed after the pool has started.';
  end if;

  select coalesce(
    (select min(coalesce(g.kickoff_at_utc, g.game_time)) from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')),
    (select sw.week_sunday_date::timestamp at time zone 'America/New_York' from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1))
  ) into v_start_at;
  if v_start_at is not null and now() >= v_start_at then
    raise exception 'Entries cannot be removed after the pool has started.';
  end if;

  delete from public.pool_members where id = p_entry_id and pool_id = p_pool_id;
  perform public.log_security_event('pool_entry_removed', 'info', 'User removed one pool entry.', jsonb_build_object('entry_id', p_entry_id), p_pool_id);
end;
$function$;

revoke execute on function public.remove_pool_entry(uuid, uuid) from public, anon;
grant execute on function public.remove_pool_entry(uuid, uuid) to authenticated, service_role;

create or replace function public.admin_remove_pool_entry(p_pool_id uuid, p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry public.pool_members%rowtype;
  v_start_at timestamptz;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;

  select * into v_pool from public.pools where id = p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;

  select * into v_entry from public.pool_members where pool_id = p_pool_id and id = p_entry_id;
  if not found then raise exception 'Entry not found.'; end if;
  if v_entry.profile_id = v_pool.created_by then raise exception 'The pool creator''s entries cannot be removed.'; end if;
  if v_entry.role::text = 'admin' and auth.uid() is distinct from v_pool.created_by and not public.is_super_admin() then
    raise exception 'Only the pool creator can remove another admin''s entry.';
  end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Entries cannot be removed after the pool has started.';
  end if;

  select coalesce(
    (select min(coalesce(g.kickoff_at_utc, g.game_time)) from public.nfl_games g
      where g.season = coalesce(v_pool.season, extract(year from now())::integer)
        and g.week = coalesce(v_pool.start_week, 1)
        and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')),
    (select sw.week_sunday_date::timestamp at time zone 'America/New_York' from public.season_weeks sw
      where sw.season = coalesce(v_pool.season, extract(year from now())::integer)
        and sw.week = coalesce(v_pool.start_week, 1))
  ) into v_start_at;
  if v_start_at is not null and now() >= v_start_at then
    raise exception 'Entries cannot be removed after the pool has started.';
  end if;

  delete from public.pool_members where id = p_entry_id and pool_id = p_pool_id;
  perform public.log_security_event('pool_entry_removed_by_admin', 'warning', 'Commissioner removed one pool entry.', jsonb_build_object('entry_id', p_entry_id, 'profile_id', v_entry.profile_id), p_pool_id);
end;
$function$;

revoke execute on function public.admin_remove_pool_entry(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_pool_entry(uuid, uuid) to authenticated, service_role;

commit;
