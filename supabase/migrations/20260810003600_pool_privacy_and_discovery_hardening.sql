begin;

-- A signed-in outsider should discover public pools through the deliberately
-- shaped RPC, not by reading the full pools row (which also contains internal
-- operational identifiers and test/payment state).
drop policy if exists pools_select_authenticated on public.pools;
create policy pools_select_authenticated
on public.pools for select to authenticated
using (
  created_by=(select auth.uid())
  or public.is_pool_member(id)
  or public.admin_can_manage(id)
);

-- Anonymous direct reads of public pools retain only the fields reasonably
-- needed for public discovery. RPCs provide the supported public contract.
revoke select(created_by,activated_by,winner_user_id,cloned_from_pool_id,
  payment_status,pinned_rank,sponsored_until,test_mode,test_current_week,
  test_now_at,name_normalized) on public.pools from anon;

-- Private pools are invite-only. They no longer appear in browse or name
-- search, even when a caller knows part of the pool name. Public pools may opt
-- out of discovery with allow_discovery=false.
drop function if exists public.search_pools(text);
create function public.search_pools(p_term text)
returns table (
  id uuid,name text,is_public boolean,allow_discovery boolean,start_week integer,
  include_playoffs boolean,strikes_allowed text,tie_rule text,deadline_mode text,
  deadline_fixed text,notes text,created_at timestamptz,activation_status text,
  max_members integer,member_count integer,entry_count integer,
  owned_by_me boolean,already_joined boolean
)
language sql stable security definer set search_path='public' as $function$
  with input as (
    select left(btrim(coalesce(p_term,'')),100) as term
  ), candidate_pools as (
    select p.*,
      coalesce(
        (select min(coalesce(g.kickoff_at_utc,g.game_time))
           from public.nfl_games g
          where g.season=coalesce(p.season,extract(year from now())::integer)
            and g.week=coalesce(p.start_week,1)
            and coalesce(g.kickoff_at_utc,g.game_time)>=make_timestamptz(coalesce(p.season,extract(year from now())::integer),1,1,0,0,0,'UTC')),
        (select sw.week_sunday_date::timestamp at time zone 'America/New_York'
           from public.season_weeks sw
          where sw.season=coalesce(p.season,extract(year from now())::integer)
            and sw.week=coalesce(p.start_week,1))
      ) as starts_at
    from public.pools p
  )
  select p.id,p.name,true,p.allow_discovery,p.start_week,p.include_playoffs,
    p.strikes_allowed::text,p.tie_rule::text,p.deadline_mode::text,p.deadline_fixed,
    p.notes,p.created_at,coalesce(p.activation_status,'active')::text,p.max_members,
    (select count(distinct pm.profile_id)::integer from public.pool_members pm where pm.pool_id=p.id),
    (select count(*)::integer from public.pool_members pm where pm.pool_id=p.id),
    (auth.uid() is not null and p.created_by=auth.uid()),
    (auth.uid() is not null and exists(select 1 from public.pool_members mine where mine.pool_id=p.id and mine.profile_id=auth.uid()))
  from candidate_pools p cross join input i
  where coalesce(p.is_public,false)
    and coalesce(p.allow_discovery,true)
    and not coalesce(p.archived,false)
    and coalesce(p.activation_status,'active')<>'cancelled'
    and (p.starts_at is null or now()<p.starts_at)
    and not (coalesce(p.test_mode,false) and coalesce(p.test_current_week,p.start_week,1)>=coalesce(p.start_week,1))
    and (i.term='' or p.name ilike ('%'||i.term||'%'))
  order by p.created_at desc
  limit 50;
$function$;
revoke all on function public.search_pools(text) from public;
grant execute on function public.search_pools(text) to anon,authenticated,service_role;

-- Possession of a cryptographically random UUID invite URL grants only a
-- limited preview. A private invite still requires the separately shared pool
-- password before join_pool creates membership. Private previews omit notes,
-- roster counts, creator identity, and test state until membership exists.
drop function if exists public.get_pool_invite(uuid);
create function public.get_pool_invite(p_pool_id uuid)
returns table (
  id uuid,name text,season integer,is_public boolean,start_week integer,
  include_playoffs boolean,strikes_allowed integer,tie_rule text,
  deadline_mode text,deadline_fixed text,notes text,created_by uuid,
  activation_status text,max_members integer,member_count integer,
  entry_count integer,test_mode boolean,test_current_week integer
)
language sql stable security definer set search_path='public' as $function$
  with visible as (
    select p.*,
      (auth.uid() is not null and (p.created_by=auth.uid() or public.is_pool_member(p.id) or public.admin_can_manage(p.id))) as privileged
    from public.pools p
    where p.id=p_pool_id and not coalesce(p.archived,false)
      and coalesce(p.activation_status,'active')<>'cancelled'
  )
  select p.id,p.name,coalesce(p.season,extract(year from now())::integer),p.is_public,
    p.start_week,p.include_playoffs,p.strikes_allowed::integer,p.tie_rule::text,
    p.deadline_mode::text,p.deadline_fixed,
    case when p.is_public or p.privileged then p.notes else null end,
    case when p.privileged then p.created_by else null end,
    p.activation_status::text,p.max_members,
    case when p.is_public or p.privileged then (select count(distinct pm.profile_id)::integer from public.pool_members pm where pm.pool_id=p.id) else null end,
    case when p.is_public or p.privileged then (select count(*)::integer from public.pool_members pm where pm.pool_id=p.id) else null end,
    case when p.privileged then coalesce(p.test_mode,false) else false end,
    case when p.privileged then p.test_current_week else null end
  from visible p limit 1;
$function$;
revoke all on function public.get_pool_invite(uuid) from public;
grant execute on function public.get_pool_invite(uuid) to anon,authenticated,service_role;

create or replace function public.count_pool_members(p_pool_id uuid)
returns integer language sql stable security definer set search_path='public' as $function$
  select case when exists(
    select 1 from public.pools p where p.id=p_pool_id and
      (coalesce(p.is_public,false) or public.is_pool_member(p.id) or public.admin_can_manage(p.id))
  ) then (select count(distinct pm.profile_id)::integer from public.pool_members pm where pm.pool_id=p_pool_id)
  else null end;
$function$;

create or replace function public.count_pool_entries(p_pool_id uuid)
returns integer language sql stable security definer set search_path='public' as $function$
  select case when exists(
    select 1 from public.pools p where p.id=p_pool_id and
      (coalesce(p.is_public,false) or public.is_pool_member(p.id) or public.admin_can_manage(p.id))
  ) then (select count(*)::integer from public.pool_members pm where pm.pool_id=p_pool_id)
  else null end;
$function$;

-- The legacy public profile mirror permitted global anonymous enumeration of
-- names and UUIDs. The app does not use it; retain self access only for
-- compatibility. Full profiles are likewise self-only. Member-facing identity
-- comes through the scoped roster RPC below.
drop policy if exists profiles_public_select_all on public.profiles_public;
drop policy if exists profiles_public_update_own on public.profiles_public;
create policy profiles_public_select_self on public.profiles_public
for select to authenticated using(id=(select auth.uid()));
revoke all on public.profiles_public from anon;
revoke insert,update,delete on public.profiles_public from authenticated;
grant select on public.profiles_public to authenticated;

drop policy if exists profiles_select_self_or_shared_pool on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated using(id=(select auth.uid()));

-- Preserve the roster function's existing shape for client compatibility, but
-- never disclose profile first/last names. Chosen username/display name and
-- avatar remain visible only to fellow pool members and commissioners.
create or replace function public.pool_entry_roster(p_pool_id uuid)
returns table (
  entry_id uuid,profile_id uuid,entry_number integer,entry_name text,
  display_name text,username text,first_name text,last_name text,avatar_url text,
  role text,status text,joined_at timestamptz
)
language plpgsql stable security definer set search_path='public' as $function$
begin
  if auth.uid() is null then raise exception 'Please sign in to view this pool.'; end if;
  if not public.admin_can_manage(p_pool_id) and not public.is_pool_member(p_pool_id) then
    raise exception 'not authorized';
  end if;
  return query
  select pm.id,pm.profile_id,coalesce(pm.entry_number,1)::integer,pm.entry_name::text,
    coalesce(nullif(pr.username::text,''),nullif(pr.display_name::text,''),'Player')::text,
    pr.username::text,null::text,null::text,pr.avatar_url::text,
    pm.role::text,pm.status::text,pm.joined_at
  from public.pool_members pm left join public.profiles pr on pr.id=pm.profile_id
  where pm.pool_id=p_pool_id
  order by lower(coalesce(nullif(pr.username::text,''),nullif(pr.display_name::text,''),'Player')),
    coalesce(pm.entry_number,1),pm.id;
end;
$function$;
revoke all on function public.pool_entry_roster(uuid) from public,anon;
grant execute on function public.pool_entry_roster(uuid) to authenticated,service_role;

-- Invite records contain bearer-like codes and optional target emails. Browser
-- access remains commissioner-only through RLS; anonymous roles need no table
-- privilege at all.
revoke all on public.invites from anon;
revoke truncate,references,trigger on public.invites from authenticated;

commit;
