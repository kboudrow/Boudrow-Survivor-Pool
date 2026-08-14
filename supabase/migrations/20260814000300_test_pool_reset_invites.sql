begin;

-- Test pools use the simulated clock, not the selected week number, to cross
-- the same authoritative first-kickoff boundary as production pools.
create or replace function public.pool_has_started(p_pool_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    public.pool_start_at(p.id) is not null
      and public.pool_effective_now(p.id) >= public.pool_start_at(p.id),
    false
  )
  from public.pools p
  where p.id = p_pool_id
$function$;

-- A test reset is a new simulated competition using the existing roster and
-- settings. Clear all derived competition state while retaining append-only
-- dispute evidence about the prior run.
create or replace function public.superadmin_reset_test_pool(p_pool_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start_week integer;
  v_clock timestamptz;
begin
  perform public.superadmin_assert_test_pool(p_pool_id);
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);

  select coalesce(p.start_week, 1)
    into v_start_week
  from public.pools p
  where p.id = p_pool_id;

  delete from public.pool_pick_drafts d where d.pool_id = p_pool_id;
  delete from public.pool_picks p where p.pool_id = p_pool_id;
  delete from public.pool_member_stats s where s.pool_id = p_pool_id;
  delete from public.pool_entry_survival_graces g where g.pool_id = p_pool_id;
  delete from public.pool_entry_week_history h where h.pool_id = p_pool_id;
  delete from public.test_pool_team_results r where r.pool_id = p_pool_id;

  update public.pool_members pm
     set status = 'alive',
         eliminated_week = null,
         lives_remaining = null
   where pm.pool_id = p_pool_id;

  perform public.superadmin_ensure_test_pool_playoff_games(p_pool_id);
  v_clock := public.pool_test_clock_at(p_pool_id, v_start_week, 'before_week');

  update public.pools p
     set test_current_week = v_start_week,
         test_now_at = v_clock,
         winner_user_id = null
   where p.id = p_pool_id;

  return 'Test pool reset to Week ' || v_start_week || '. Members and settings were kept; entry status, picks, fake outcomes, standings history, stats, and winner were reset.';
end;
$function$;

-- Public discovery should consume the same authoritative start boundary.
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
  )
  select p.id,p.name,true,p.allow_discovery,p.start_week,p.include_playoffs,
    p.strikes_allowed::text,p.tie_rule::text,p.deadline_mode::text,p.deadline_fixed,
    p.notes,p.created_at,coalesce(p.activation_status,'active')::text,p.max_members,
    (select count(distinct pm.profile_id)::integer from public.pool_members pm where pm.pool_id=p.id),
    (select count(*)::integer from public.pool_members pm where pm.pool_id=p.id),
    (auth.uid() is not null and p.created_by=auth.uid()),
    (auth.uid() is not null and exists(select 1 from public.pool_members mine where mine.pool_id=p.id and mine.profile_id=auth.uid()))
  from public.pools p cross join input i
  where coalesce(p.is_public,false)
    and coalesce(p.allow_discovery,true)
    and not coalesce(p.archived,false)
    and coalesce(p.activation_status,'active')<>'cancelled'
    and not public.pool_has_started(p.id)
    and (i.term='' or p.name ilike ('%'||i.term||'%'))
  order by p.created_at desc
  limit 50;
$function$;

-- Invite previews expose only the decision, not a private test clock.
drop function if exists public.get_pool_invite(uuid);
create function public.get_pool_invite(p_pool_id uuid)
returns table (
  id uuid,name text,season integer,is_public boolean,start_week integer,
  include_playoffs boolean,strikes_allowed integer,tie_rule text,
  deadline_mode text,deadline_fixed text,notes text,created_by uuid,
  activation_status text,max_members integer,member_count integer,
  entry_count integer,test_mode boolean,test_current_week integer,
  join_allowed boolean
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
    case when p.privileged then p.test_current_week else null end,
    not public.pool_has_started(p.id)
  from visible p limit 1;
$function$;

revoke all on function public.pool_has_started(uuid) from public,anon,authenticated;
grant execute on function public.pool_has_started(uuid) to service_role;
revoke all on function public.superadmin_reset_test_pool(uuid) from public,anon;
grant execute on function public.superadmin_reset_test_pool(uuid) to authenticated;
revoke all on function public.search_pools(text) from public;
grant execute on function public.search_pools(text) to anon,authenticated,service_role;
revoke all on function public.get_pool_invite(uuid) from public;
grant execute on function public.get_pool_invite(uuid) to anon,authenticated,service_role;

commit;
