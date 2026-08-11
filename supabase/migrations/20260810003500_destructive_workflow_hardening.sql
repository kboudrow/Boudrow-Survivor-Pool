begin;

create table if not exists public.pool_roster_removal_events (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null,
  actor_user_id uuid,
  subject_user_id uuid,
  entry_id uuid,
  removal_type text not null check(removal_type in ('member_left','member_removed','entry_removed','entry_removed_by_admin')),
  entries_removed integer not null check(entries_removed>=0),
  drafts_removed integer not null check(drafts_removed>=0),
  locked_picks_removed integer not null check(locked_picks_removed>=0),
  created_at timestamptz not null default now()
);
create index if not exists idx_pool_roster_removal_events_pool_created
on public.pool_roster_removal_events(pool_id,created_at desc);
alter table public.pool_roster_removal_events enable row level security;
revoke all on public.pool_roster_removal_events from public,anon,authenticated;
grant select,insert on public.pool_roster_removal_events to service_role;

-- Browser roles use the checked RPCs. No direct DELETE grant should be able to
-- bypass their ownership, lifecycle, count, or confirmation assumptions.
revoke delete on public.pools,public.pool_members,public.pool_picks,public.pool_pick_drafts,
  public.pool_member_stats,public.pool_entry_survival_graces,public.pool_entry_week_history
from authenticated;

create or replace function public.protect_pool_creator_entry_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_creator uuid;
begin
  select p.created_by into v_creator from public.pools p where p.id=old.pool_id;
  -- During an intentional parent pool cascade the pool row is already gone.
  if v_creator is not null and old.profile_id=v_creator then
    raise exception 'The pool creator cannot leave or remove their own entry. Archive the pool instead.';
  end if;
  return old;
end;
$function$;
drop trigger if exists aaz_protect_pool_creator_entry_delete on public.pool_members;
create trigger aaz_protect_pool_creator_entry_delete before delete on public.pool_members
for each row execute function public.protect_pool_creator_entry_delete();

create or replace function public.protect_pool_physical_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  raise exception 'Pools are retained as competition records. Archive the pool instead of deleting it.';
end;
$function$;
drop trigger if exists aaz_protect_pool_physical_delete on public.pools;
create trigger aaz_protect_pool_physical_delete before delete on public.pools
for each row execute function public.protect_pool_physical_delete();

create or replace function public.leave_pool(p_pool_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pool public.pools%rowtype;
  v_entries integer; v_drafts integer; v_picks integer;
begin
  if auth.uid() is null then raise exception 'Please sign in to leave this pool.'; end if;
  select * into v_pool from public.pools where id=p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;
  if v_pool.created_by=auth.uid() then raise exception 'Pool creators cannot leave their own pool. Archive it instead.'; end if;
  if public.pool_has_started(p_pool_id) then raise exception 'You cannot leave this pool after it has started.'; end if;
  if not exists(select 1 from public.pool_members pm where pm.pool_id=p_pool_id and pm.profile_id=auth.uid()) then
    raise exception 'You are not a member of this pool.';
  end if;

  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  select count(*) into v_entries from public.pool_members pm where pm.pool_id=p_pool_id and pm.profile_id=auth.uid();
  select count(*) into v_drafts from public.pool_pick_drafts d where d.pool_id=p_pool_id and d.user_id=auth.uid();
  select count(*) into v_picks from public.pool_picks pp where pp.pool_id=p_pool_id and pp.user_id=auth.uid();
  insert into public.pool_roster_removal_events(pool_id,actor_user_id,subject_user_id,removal_type,entries_removed,drafts_removed,locked_picks_removed)
  values(p_pool_id,auth.uid(),auth.uid(),'member_left',v_entries,v_drafts,v_picks);
  delete from public.pool_members pm where pm.pool_id=p_pool_id and pm.profile_id=auth.uid();
end;
$function$;

create or replace function public.remove_pool_entry(p_pool_id uuid,p_entry_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pool public.pools%rowtype; v_entry public.pool_members%rowtype;
  v_entry_count integer; v_drafts integer; v_picks integer;
begin
  perform public.assert_user_email_confirmed('remove an entry');
  perform public.assert_action_rate_limit('remove_pool_entry',600,10,p_pool_id::text);
  select * into v_pool from public.pools where id=p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;
  select * into v_entry from public.pool_members where pool_id=p_pool_id and id=p_entry_id for update;
  if not found then raise exception 'Entry not found.'; end if;
  if v_entry.profile_id<>auth.uid() then raise exception 'This entry does not belong to you.'; end if;
  select count(*) into v_entry_count from public.pool_members where pool_id=p_pool_id and profile_id=auth.uid();
  if v_entry_count<=1 then raise exception 'Your only entry represents your membership. Use Leave pool instead.'; end if;
  if public.pool_has_started(p_pool_id) then raise exception 'Entries cannot be removed after the pool has started.'; end if;

  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_pool_entry_pick_lock(p_pool_id,p_entry_id);
  select count(*) into v_drafts from public.pool_pick_drafts d where d.pool_id=p_pool_id and d.entry_id=p_entry_id;
  select count(*) into v_picks from public.pool_picks pp where pp.pool_id=p_pool_id and pp.entry_id=p_entry_id;
  insert into public.pool_roster_removal_events(pool_id,actor_user_id,subject_user_id,entry_id,removal_type,entries_removed,drafts_removed,locked_picks_removed)
  values(p_pool_id,auth.uid(),auth.uid(),p_entry_id,'entry_removed',1,v_drafts,v_picks);
  delete from public.pool_members where pool_id=p_pool_id and id=p_entry_id;
end;
$function$;

create or replace function public.admin_remove_pool_entry(p_pool_id uuid,p_entry_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pool public.pools%rowtype; v_entry public.pool_members%rowtype;
  v_drafts integer; v_picks integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  select * into v_pool from public.pools where id=p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;
  select * into v_entry from public.pool_members where pool_id=p_pool_id and id=p_entry_id for update;
  if not found then raise exception 'Entry not found.'; end if;
  if v_entry.profile_id=v_pool.created_by then raise exception 'The pool creator''s entries cannot be removed.'; end if;
  if v_entry.role::text='admin' and auth.uid() is distinct from v_pool.created_by and not public.is_super_admin() then
    raise exception 'Only the pool creator can remove another admin''s entry.';
  end if;
  if public.pool_has_started(p_pool_id) then raise exception 'Entries cannot be removed after the pool has started.'; end if;

  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_pool_entry_pick_lock(p_pool_id,p_entry_id);
  select count(*) into v_drafts from public.pool_pick_drafts d where d.pool_id=p_pool_id and d.entry_id=p_entry_id;
  select count(*) into v_picks from public.pool_picks pp where pp.pool_id=p_pool_id and pp.entry_id=p_entry_id;
  insert into public.pool_roster_removal_events(pool_id,actor_user_id,subject_user_id,entry_id,removal_type,entries_removed,drafts_removed,locked_picks_removed)
  values(p_pool_id,auth.uid(),v_entry.profile_id,p_entry_id,'entry_removed_by_admin',1,v_drafts,v_picks);
  delete from public.pool_members where pool_id=p_pool_id and id=p_entry_id;
end;
$function$;

create or replace function public.admin_remove_pool_member(p_pool_id uuid,p_profile_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pool public.pools%rowtype; v_entries integer; v_drafts integer; v_picks integer; v_role text;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  select * into v_pool from public.pools where id=p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;
  select count(*),max(pm.role::text) into v_entries,v_role from public.pool_members pm where pm.pool_id=p_pool_id and pm.profile_id=p_profile_id;
  if v_entries=0 then raise exception 'Member not found in this pool.'; end if;
  if p_profile_id=v_pool.created_by then raise exception 'The pool creator cannot be removed from their own pool.'; end if;
  if v_role='admin' and auth.uid() is distinct from v_pool.created_by and not public.is_super_admin() then
    raise exception 'Only the pool creator can remove another admin.';
  end if;
  if public.pool_has_started(p_pool_id) then raise exception 'Members cannot be removed after the pool has started.'; end if;

  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  select count(*) into v_drafts from public.pool_pick_drafts d where d.pool_id=p_pool_id and d.user_id=p_profile_id;
  select count(*) into v_picks from public.pool_picks pp where pp.pool_id=p_pool_id and pp.user_id=p_profile_id;
  insert into public.pool_roster_removal_events(pool_id,actor_user_id,subject_user_id,removal_type,entries_removed,drafts_removed,locked_picks_removed)
  values(p_pool_id,auth.uid(),p_profile_id,'member_removed',v_entries,v_drafts,v_picks);
  delete from public.pool_members pm where pm.pool_id=p_pool_id and pm.profile_id=p_profile_id;
  return v_entries;
end;
$function$;

create or replace function public.admin_archive_pool(p_pool_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_pool public.pools%rowtype;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  select * into v_pool from public.pools p where p.id=p_pool_id for update;
  if not found then raise exception 'Pool not found.'; end if;
  perform public.acquire_pool_workflow_lock(p_pool_id);
  perform public.acquire_all_pool_entry_pick_locks(p_pool_id);
  if coalesce(p_archived,false) and public.pool_has_started(p_pool_id) and not public.pool_competition_is_complete(p_pool_id) then
    raise exception 'An in-progress pool cannot be archived. Wait until a winner is decided or the configured season is complete.';
  end if;
  update public.pools set archived=coalesce(p_archived,false),
    archived_at=case when coalesce(p_archived,false) then now() else null end where id=p_pool_id;
end;
$function$;

revoke all on function public.protect_pool_creator_entry_delete() from public,anon,authenticated;
revoke all on function public.protect_pool_physical_delete() from public,anon,authenticated;
grant execute on function public.protect_pool_creator_entry_delete() to service_role;
grant execute on function public.protect_pool_physical_delete() to service_role;
revoke all on function public.leave_pool(uuid) from public,anon;
revoke all on function public.remove_pool_entry(uuid,uuid) from public,anon;
revoke all on function public.admin_remove_pool_entry(uuid,uuid) from public,anon;
revoke all on function public.admin_remove_pool_member(uuid,uuid) from public,anon;
revoke all on function public.admin_archive_pool(uuid,boolean) from public,anon;
grant execute on function public.leave_pool(uuid) to authenticated,service_role;
grant execute on function public.remove_pool_entry(uuid,uuid) to authenticated,service_role;
grant execute on function public.admin_remove_pool_entry(uuid,uuid) to authenticated,service_role;
grant execute on function public.admin_remove_pool_member(uuid,uuid) to authenticated,service_role;
grant execute on function public.admin_archive_pool(uuid,boolean) to authenticated,service_role;

commit;
