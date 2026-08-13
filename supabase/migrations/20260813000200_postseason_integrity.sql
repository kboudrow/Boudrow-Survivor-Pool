begin;

alter table public.season_weeks
  drop constraint if exists season_weeks_week_check;

alter table public.season_weeks
  add constraint season_weeks_week_check check (week between 1 and 22);

-- These are official round dates, not fabricated matchups or kickoff times.
-- The score sync uses them only to discover each round after the NFL publishes
-- its actual games. All game rows still come from the validated provider feed.
insert into public.season_weeks (season, week, week_sunday_date)
values
  (2026, 19, '2027-01-17'),
  (2026, 20, '2027-01-24'),
  (2026, 21, '2027-01-31'),
  (2026, 22, '2027-02-14')
on conflict (season, week) do update
set week_sunday_date = excluded.week_sunday_date;

-- Requiring both Super Bowl teams necessarily creates one losing pick and can
-- become impossible when either finalist was used earlier in the postseason.
create or replace function public.guard_postseason_double_pick_configuration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if 22 = any(coalesce(new.double_pick_weeks, '{}'::integer[])) then
    raise exception 'The Super Bowl cannot be a double-pick round because its two teams play each other.';
  end if;
  return new;
end;
$function$;

drop trigger if exists pools_guard_postseason_double_pick on public.pools;
create trigger pools_guard_postseason_double_pick
before insert or update of double_pick_weeks, include_playoffs on public.pools
for each row execute function public.guard_postseason_double_pick_configuration();

revoke execute on function public.guard_postseason_double_pick_configuration() from public, anon, authenticated;
grant execute on function public.guard_postseason_double_pick_configuration() to service_role;

create or replace function public.admin_set_double_weeks(
  p_pool_id uuid,
  p_weeks integer[]
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_first_start timestamptz;
  v_weeks integer[];
  v_max_week integer;
begin
  if not public.admin_can_manage(p_pool_id) then raise exception 'not authorized'; end if;

  select * into v_pool from public.pools where id = p_pool_id;
  if not found then raise exception 'Pool not found.'; end if;

  if coalesce(v_pool.test_mode, false)
    and coalesce(v_pool.test_current_week, v_pool.start_week, 1) >= coalesce(v_pool.start_week, 1) then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time)) into v_first_start
  from public.nfl_games g
  where g.season = coalesce(v_pool.season, extract(year from now())::integer)
    and g.week = coalesce(v_pool.start_week, 1)
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(v_pool.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'Pool settings cannot be changed after the pool has started.';
  end if;

  v_max_week := case when coalesce(v_pool.include_playoffs, false) then 21 else 18 end;

  if cardinality(coalesce(p_weeks, '{}'::integer[]))
     <> (select count(distinct week) from unnest(coalesce(p_weeks, '{}'::integer[])) week) then
    raise exception 'Double-pick weeks cannot contain duplicates.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_weeks, '{}'::integer[])) week
    where week < coalesce(v_pool.start_week, 1) or week > v_max_week
  ) then
    raise exception 'Double-pick weeks must be between this pool''s start week and Week %.', v_max_week;
  end if;

  select coalesce(array_agg(selected.week order by selected.week), '{}'::integer[])
    into v_weeks
  from unnest(coalesce(p_weeks, '{}'::integer[])) as selected(week);

  update public.pools set double_pick_weeks = v_weeks where id = p_pool_id;
end;
$function$;

revoke execute on function public.admin_set_double_weeks(uuid, integer[]) from public, anon;
grant execute on function public.admin_set_double_weeks(uuid, integer[]) to authenticated, service_role;

-- Run It Back copies settings, but never entries, picks, results, mulligans, or
-- eliminations. Preserve valid postseason double-pick rounds in the new pool.
create or replace function public.clone_pool_for_new_season(
  p_old_pool_id uuid,
  p_new_season integer
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_old public.pools%rowtype;
  v_existing_pool_id uuid;
  v_new_pool_id uuid;
  v_new_name text;
  v_password_hash text;
begin
  if v_user_id is null then raise exception 'Please sign in before creating next season.'; end if;
  perform public.assert_user_email_confirmed('create next season');
  perform public.assert_action_rate_limit('clone_pool_for_new_season', 3600, 10, p_old_pool_id::text, jsonb_build_object('season', p_new_season));

  if p_new_season is null or p_new_season < 2026 or p_new_season > 2035 then
    raise exception 'Choose a season between 2026 and 2035.';
  end if;

  select * into v_old from public.pools where id = p_old_pool_id for share;
  if not found then raise exception 'Archived pool not found.'; end if;
  if v_old.created_by <> v_user_id then raise exception 'Only the pool owner can create next season from this archive.'; end if;
  if not coalesce(v_old.archived, false) then raise exception 'Archive this pool before creating next season.'; end if;

  select p.id into v_existing_pool_id
  from public.pools p
  where p.created_by = v_user_id and p.cloned_from_pool_id = p_old_pool_id
    and p.season = p_new_season and coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
  order by p.created_at desc nulls last limit 1;
  if v_existing_pool_id is not null then return v_existing_pool_id; end if;

  v_password_hash := coalesce(v_old.join_password_hash, v_old.password_hash, v_old.private_password_hash);
  if not coalesce(v_old.is_public, false) and v_password_hash is null then
    raise exception 'This private pool does not have a saved password. Create a new private pool instead.';
  end if;

  v_new_name := left(btrim(regexp_replace(v_old.name, '\s+[0-9]{4}$', '')) || ' ' || p_new_season::text, 90);

  insert into public.pools (
    name,is_public,visibility,allow_discovery,start_week,include_playoffs,strikes_allowed,tie_rule,ties,
    deadline,deadline_mode,deadline_fixed,notes,image_url,created_by,season,double_pick_weeks,plan,pick_privacy,
    activation_status,payment_status,max_members,allow_multiple_entries,max_entries_per_user,join_password_hash,
    password_hash,private_password_hash,cloned_from_pool_id,archived,archived_at,test_mode,test_current_week,
    winner_user_id,sponsored_until,stripe_checkout_session_id,stripe_payment_intent_id
  ) values (
    v_new_name,coalesce(v_old.is_public,true),
    coalesce(v_old.visibility,case when coalesce(v_old.is_public,true) then 'public'::public.pool_visibility else 'private'::public.pool_visibility end),
    coalesce(v_old.allow_discovery,true),coalesce(v_old.start_week,1),coalesce(v_old.include_playoffs,false),
    coalesce(v_old.strikes_allowed,'0'),lower(coalesce(v_old.tie_rule,'loss')),
    coalesce(v_old.ties,lower(coalesce(v_old.tie_rule,'loss'))::public.ties_rule),
    coalesce(v_old.deadline,'1pm_et'::public.pick_deadline),coalesce(v_old.deadline_mode,'fixed'),v_old.deadline_fixed,
    v_old.notes,v_old.image_url,v_user_id,p_new_season,
    coalesce((select array_agg(distinct week order by week)
      from unnest(coalesce(v_old.double_pick_weeks,'{}'::integer[])) selected(week)
      where selected.week between coalesce(v_old.start_week,1)
        and case when coalesce(v_old.include_playoffs,false) then 21 else 18 end),'{}'::integer[]),
    'free',coalesce(v_old.pick_privacy,'hidden'),'active','not_required',v_old.max_members,
    coalesce(v_old.allow_multiple_entries,false),
    case when coalesce(v_old.allow_multiple_entries,false) then least(greatest(coalesce(v_old.max_entries_per_user,1),1),10) else 1 end,
    case when coalesce(v_old.is_public,true) then null else v_password_hash end,
    case when coalesce(v_old.is_public,true) then null else v_password_hash end,
    case when coalesce(v_old.is_public,true) then null else v_password_hash end,
    p_old_pool_id,false,null,false,null,null,null,null,null
  ) returning id into v_new_pool_id;

  insert into public.pool_members (pool_id,profile_id,role,status,entry_number)
  values (v_new_pool_id,v_user_id,'admin'::public.member_role,'alive',1)
  on conflict (pool_id,profile_id,entry_number) do nothing;

  perform public.log_security_event('pool_created_from_archive','info','Next season pool created from archive.',
    jsonb_build_object('source_pool_id',p_old_pool_id,'season',p_new_season),v_new_pool_id);
  return v_new_pool_id;
end;
$function$;

revoke execute on function public.clone_pool_for_new_season(uuid, integer) from public, anon;
grant execute on function public.clone_pool_for_new_season(uuid, integer) to authenticated, service_role;

commit;
