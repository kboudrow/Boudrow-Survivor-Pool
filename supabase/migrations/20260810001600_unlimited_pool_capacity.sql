begin;

-- Integer sentinel keeps existing join/add-entry enforcement fast and avoids
-- changing the meaning of NULL for older code paths.
alter table public.pools alter column max_members set default 2147483647;

create or replace function public.create_pool_with_owner(
  p_name text,p_is_public boolean default true,p_password text default null,p_start_week integer default 1,
  p_include_playoffs boolean default false,p_strikes_allowed text default '0',p_tie_rule text default 'loss',
  p_deadline_mode text default 'fixed',p_deadline_fixed text default '13:00',p_notes text default null,
  p_image_url text default null,p_season integer default 2026,p_double_pick_weeks integer[] default '{}',
  p_max_members integer default null,p_allow_multiple_entries boolean default false,p_max_entries_per_user integer default 1
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool_id uuid;
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
  if p_max_members is not null and (p_max_members < 2 or p_max_members > 500) then
    raise exception 'Pool capacity must be Unlimited or between 2 and 500 entries.';
  end if;

  v_pool_id := public.create_pool_with_owner_validated_internal(
    p_name,p_is_public,p_password,p_start_week,p_include_playoffs,p_strikes_allowed,p_tie_rule,
    p_deadline_mode,p_deadline_fixed,p_notes,p_image_url,p_season,p_double_pick_weeks,
    coalesce(p_max_members,25),p_allow_multiple_entries,p_max_entries_per_user
  );

  if p_max_members is null then
    update public.pools set max_members = 2147483647 where id = v_pool_id;
  end if;
  return v_pool_id;
end;
$function$;

do $$
begin
  if to_regprocedure('public.admin_update_pool_member_limit_finite_internal(uuid,integer)') is null then
    alter function public.admin_update_pool_member_limit(uuid,integer)
      rename to admin_update_pool_member_limit_finite_internal;
  end if;
end $$;

create function public.admin_update_pool_member_limit(
  p_pool_id uuid,
  p_max_members integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_max_members is not null and (p_max_members < 2 or p_max_members > 500) then
    raise exception 'Pool capacity must be Unlimited or between 2 and 500 entries.';
  end if;

  -- Reuse all authorization, start-time, and current-entry checks. The temporary
  -- finite value and final Unlimited sentinel commit atomically.
  perform public.admin_update_pool_member_limit_finite_internal(
    p_pool_id,
    coalesce(p_max_members, 500)
  );

  if p_max_members is null then
    update public.pools set max_members = 2147483647 where id = p_pool_id;
  end if;
end;
$function$;

revoke execute on function public.admin_update_pool_member_limit_finite_internal(uuid,integer) from public,anon,authenticated;
grant execute on function public.admin_update_pool_member_limit_finite_internal(uuid,integer) to service_role;
revoke execute on function public.admin_update_pool_member_limit(uuid,integer) from public,anon;
grant execute on function public.admin_update_pool_member_limit(uuid,integer) to authenticated,service_role;

commit;
