create or replace function public.guard_pool_settings_security()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  new.name:=btrim(coalesce(new.name,''));
  if char_length(new.name)<3 or char_length(new.name)>100 or new.name~'[[:cntrl:]]' then
    raise exception 'Pool name must be between 3 and 100 characters and cannot contain control characters.';
  end if;
  if coalesce(new.season,0)<2020 or coalesce(new.season,0)>2100 then raise exception 'Season is invalid.'; end if;
  if coalesce(new.strikes_allowed,'') not in('0','1','2') then raise exception 'Strikes allowed must be 0, 1, or 2.'; end if;
  if coalesce(new.deadline_mode,'fixed') not in('fixed','rolling') then raise exception 'Deadline mode must be fixed or rolling.'; end if;
  if coalesce(new.deadline_mode,'fixed')='fixed' and coalesce(new.deadline_fixed,'') !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Fixed deadline must be a valid 24-hour time.';
  end if;
  if char_length(coalesce(new.notes,''))>2000 then
    raise exception 'Pool notes cannot exceed 2,000 characters.';
  end if;
  if cardinality(coalesce(new.double_pick_weeks,'{}'::integer[]))>22 then raise exception 'Too many double-pick weeks.'; end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_pool_settings_security on public.pools;
create trigger trg_guard_pool_settings_security
before insert or update on public.pools
for each row execute function public.guard_pool_settings_security();

revoke execute on function public.guard_pool_settings_security() from public,anon,authenticated;
grant execute on function public.guard_pool_settings_security() to service_role;

alter function public.create_pool_with_owner(text,boolean,text,integer,boolean,text,text,text,text,text,text,integer,integer[],integer,boolean,integer)
  rename to create_pool_with_owner_validated_internal;

create function public.create_pool_with_owner(
  p_name text,p_is_public boolean default true,p_password text default null,p_start_week integer default 1,
  p_include_playoffs boolean default false,p_strikes_allowed text default '0',p_tie_rule text default 'loss',
  p_deadline_mode text default 'fixed',p_deadline_fixed text default '13:00',p_notes text default null,
  p_image_url text default null,p_season integer default 2026,p_double_pick_weeks integer[] default '{}',
  p_max_members integer default 25,p_allow_multiple_entries boolean default false,p_max_entries_per_user integer default 1
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if char_length(btrim(coalesce(p_name,'')))>100 or btrim(coalesce(p_name,''))~'[[:cntrl:]]' then
    raise exception 'Pool name must be between 3 and 100 characters and cannot contain control characters.';
  end if;
  if char_length(coalesce(p_notes,''))>2000 then raise exception 'Pool notes cannot exceed 2,000 characters.'; end if;
  if coalesce(p_strikes_allowed,'') not in('0','1','2') then raise exception 'Strikes allowed must be 0, 1, or 2.'; end if;
  if coalesce(p_season,0)<2020 or coalesce(p_season,0)>2100 then raise exception 'Season is invalid.'; end if;
  if coalesce(p_deadline_mode,'fixed')='fixed' and coalesce(p_deadline_fixed,'')!~'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Fixed deadline must be a valid 24-hour time.';
  end if;
  if cardinality(coalesce(p_double_pick_weeks,'{}'::integer[]))>22 then raise exception 'Too many double-pick weeks.'; end if;
  if not coalesce(p_is_public,true) and octet_length(coalesce(p_password,''))>72 then
    raise exception 'Pool password cannot exceed 72 bytes.';
  end if;
  return public.create_pool_with_owner_validated_internal(p_name,p_is_public,p_password,p_start_week,p_include_playoffs,
    p_strikes_allowed,p_tie_rule,p_deadline_mode,p_deadline_fixed,p_notes,p_image_url,p_season,p_double_pick_weeks,
    p_max_members,p_allow_multiple_entries,p_max_entries_per_user);
end;
$function$;

revoke execute on function public.create_pool_with_owner_validated_internal(text,boolean,text,integer,boolean,text,text,text,text,text,text,integer,integer[],integer,boolean,integer) from public,anon,authenticated;
revoke execute on function public.create_pool_with_owner(text,boolean,text,integer,boolean,text,text,text,text,text,text,integer,integer[],integer,boolean,integer) from public,anon;
grant execute on function public.create_pool_with_owner(text,boolean,text,integer,boolean,text,text,text,text,text,text,integer,integer[],integer,boolean,integer) to authenticated,service_role;

alter function public.join_pool(uuid,text,text) rename to join_pool_validated_internal;
create function public.join_pool(p_pool_id uuid,p_password text default null,p_token text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if octet_length(coalesce(p_password,''))>72 then raise exception 'Pool password cannot exceed 72 bytes.'; end if;
  if char_length(coalesce(p_token,''))>500 then raise exception 'Invite token is invalid.'; end if;
  perform public.join_pool_validated_internal(p_pool_id,p_password,p_token);
end;$function$;
revoke execute on function public.join_pool_validated_internal(uuid,text,text) from public,anon,authenticated;
revoke execute on function public.join_pool(uuid,text,text) from public,anon;
grant execute on function public.join_pool(uuid,text,text) to authenticated,service_role;

alter function public.admin_update_pool_visibility(uuid,boolean,text) rename to admin_update_pool_visibility_validated_internal;
create function public.admin_update_pool_visibility(p_pool_id uuid,p_is_public boolean,p_password text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if not coalesce(p_is_public,false) and octet_length(coalesce(p_password,''))>72 then
    raise exception 'Pool password cannot exceed 72 bytes.';
  end if;
  perform public.admin_update_pool_visibility_validated_internal(p_pool_id,p_is_public,p_password);
end;$function$;
revoke execute on function public.admin_update_pool_visibility_validated_internal(uuid,boolean,text) from public,anon,authenticated;
revoke execute on function public.admin_update_pool_visibility(uuid,boolean,text) from public,anon;
grant execute on function public.admin_update_pool_visibility(uuid,boolean,text) to authenticated,service_role;

create or replace function public.assert_action_rate_limit(
  p_action text,p_window_seconds integer,p_max_attempts integer,p_subject text default null,p_metadata jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user_id uuid:=auth.uid();v_action text:=left(coalesce(nullif(btrim(p_action),''),'unknown'),80);
  v_window_seconds integer:=least(greatest(coalesce(p_window_seconds,60),10),86400);
  v_max_attempts integer:=least(greatest(coalesce(p_max_attempts,10),1),1000);v_count integer;
begin
  if v_user_id is null then raise exception 'Please sign in to continue.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text||':'||v_action||':'||coalesce(p_subject,''),0));
  delete from public.security_rate_limit_events where created_at<now()-interval '2 days';
  select count(*) into v_count from public.security_rate_limit_events e
  where e.user_id=v_user_id and e.action=v_action and coalesce(e.subject,'')=coalesce(p_subject,'')
    and e.created_at>=now()-make_interval(secs=>v_window_seconds);
  if v_count>=v_max_attempts then
    perform public.log_security_event('rate_limit_blocked','warning','Rate limit blocked an action.',
      jsonb_build_object('action',v_action,'subject',p_subject,'window_seconds',v_window_seconds,'max_attempts',v_max_attempts)||coalesce(p_metadata,'{}'::jsonb),null);
    raise exception 'Too many attempts. Please wait a few minutes and try again.';
  end if;
  insert into public.security_rate_limit_events(user_id,action,subject,metadata)
  values(v_user_id,v_action,nullif(p_subject,''),coalesce(p_metadata,'{}'::jsonb));
end;$function$;

revoke execute on function public.assert_action_rate_limit(text,integer,integer,text,jsonb) from public,anon,authenticated;
