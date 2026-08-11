begin;

alter table public.admin_actions add column if not exists entry_id uuid;
alter table public.admin_actions drop constraint if exists admin_actions_week_check;
alter table public.admin_actions add constraint admin_actions_week_check check(week between 1 and 22);

create index if not exists idx_admin_actions_pool_entry_week
on public.admin_actions(pool_id,entry_id,week,slot,created_at);

-- The UI requires a reason for changing a locked pick. Persist that reason,
-- the actor, exact entry, and before/after teams in the same transaction.
create or replace function public.admin_override_entry_final_pick(
  p_pool_id uuid,p_entry_id uuid,p_week integer,p_team_abbr text,
  p_reason text default null,p_slot integer default 1
)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_pool_id uuid;
  v_season integer;
  v_test_mode boolean;
  v_user_id uuid;
  v_old_team text;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  if v_reason is null then raise exception 'Enter a reason for changing this locked pick.'; end if;

  select coalesce(p.season,extract(year from now())::integer),coalesce(p.test_mode,false)
    into v_season,v_test_mode from public.pools p where p.id=p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;
  select pm.profile_id into v_user_id from public.pool_members pm where pm.pool_id=p_pool_id and pm.id=p_entry_id;
  if not found then raise exception 'Entry not found.'; end if;
  select pp.team_abbr into v_old_team from public.pool_picks pp
    where pp.pool_id=p_pool_id and pp.entry_id=p_entry_id and pp.week=p_week and pp.slot=coalesce(p_slot,1);

  if v_test_mode then
    perform public.acquire_pool_workflow_lock(p_pool_id);
  else
    for v_pool_id in
      select p.id from public.pools p where coalesce(p.season,v_season)=v_season
        and coalesce(p.test_mode,false)=false and coalesce(p.archived,false)=false
        and coalesce(p.activation_status,'active')='active' order by p.id
    loop perform public.acquire_pool_workflow_lock(v_pool_id); end loop;
  end if;
  perform public.acquire_pool_entry_pick_lock(p_pool_id,p_entry_id);
  perform public.admin_override_entry_final_pick_concurrency_internal(
    p_pool_id,p_entry_id,p_week,p_team_abbr,v_reason,p_slot
  );

  insert into public.admin_actions(
    pool_id,admin_id,target_user_id,entry_id,week,slot,action,old_team_abbr,new_team_abbr,reason
  ) values (
    p_pool_id,auth.uid(),v_user_id,p_entry_id,p_week,coalesce(p_slot,1),'final_pick_override',
    v_old_team,upper(btrim(p_team_abbr)),v_reason
  );
end;
$function$;

create or replace function public.sanitize_pool_week_used_teams(p_pool_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_rows integer;
begin
  update public.pool_entry_week_history h
  set used_teams=coalesce((select array_agg(team) from unnest(h.used_teams) team where team not like 'NO_PICK%'),'{}'::text[])
  where h.pool_id=p_pool_id and exists(select 1 from unnest(h.used_teams) team where team like 'NO_PICK%');
  get diagnostics v_rows=row_count;
  return v_rows;
end;
$function$;

create or replace function public.rebuild_pool_member_stats(p_pool_id uuid)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_rows integer;
begin
  if auth.uid() is not null and not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;
  perform public.acquire_pool_workflow_lock(p_pool_id);
  v_rows:=public.rebuild_pool_member_stats_concurrency_internal(p_pool_id);
  perform public.refresh_pool_week_history(p_pool_id);
  perform public.sanitize_pool_week_used_teams(p_pool_id);
  return v_rows;
end;
$function$;

do $function$ declare v_pool_id uuid; begin
  for v_pool_id in select distinct h.pool_id from public.pool_entry_week_history h loop
    perform public.sanitize_pool_week_used_teams(v_pool_id);
  end loop;
end $function$;

revoke all on function public.sanitize_pool_week_used_teams(uuid) from public,anon,authenticated;
grant execute on function public.sanitize_pool_week_used_teams(uuid) to service_role;
revoke all on function public.admin_override_entry_final_pick(uuid,uuid,integer,text,text,integer) from public,anon;
grant execute on function public.admin_override_entry_final_pick(uuid,uuid,integer,text,text,integer) to authenticated,service_role;

commit;
