begin;

create or replace function public.sync_profiles_public_from_profiles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles_public (id, username, first_name, last_name, avatar_url, created_at)
  values (
    new.id,
    nullif(btrim(coalesce(new.username, new.display_name, new."User_name")), ''),
    new.first_name,
    new.last_name,
    new.avatar_url,
    coalesce(new.created_at, now())
  )
  on conflict (id) do update
  set username = nullif(btrim(coalesce(excluded.username, public.profiles_public.username)), ''),
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      avatar_url = excluded.avatar_url;

  return new;
end;
$function$;

drop trigger if exists profiles_public_sync_after_write on public.profiles;
create trigger profiles_public_sync_after_write
after insert or update of username, display_name, "User_name", first_name, last_name, avatar_url
on public.profiles
for each row
execute function public.sync_profiles_public_from_profiles();

insert into public.profiles_public (id, username, first_name, last_name, avatar_url, created_at)
select
  p.id,
  nullif(btrim(coalesce(p.username, p.display_name, p."User_name")), ''),
  p.first_name,
  p.last_name,
  p.avatar_url,
  coalesce(p.created_at, now())
from public.profiles p
on conflict (id) do update
set username = nullif(btrim(coalesce(excluded.username, public.profiles_public.username)), ''),
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    avatar_url = excluded.avatar_url;

create or replace function public.pool_member_summaries(p_pool_ids uuid[])
returns table (
  pool_id uuid,
  total_members integer,
  alive_members integer,
  total_entries integer,
  alive_entries integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with requested as (
    select distinct unnest(coalesce(p_pool_ids, array[]::uuid[])) as pool_id
  ),
  allowed as (
    select r.pool_id
    from requested r
    where public.admin_can_manage(r.pool_id)
       or exists (
         select 1
         from public.pool_members mine
         where mine.pool_id = r.pool_id
           and mine.profile_id = auth.uid()
       )
  ),
  member_rows as (
    select pm.pool_id, pm.id as entry_id, pm.profile_id
    from public.pool_members pm
    join allowed a on a.pool_id = pm.pool_id
  ),
  entry_status as (
    select
      mr.pool_id,
      mr.entry_id,
      mr.profile_id,
      coalesce(s.eliminated, false) as eliminated
    from member_rows mr
    left join public.pool_member_stats s
      on s.pool_id = mr.pool_id
     and s.entry_id = mr.entry_id
  ),
  member_status as (
    select
      pool_id,
      profile_id,
      bool_or(not eliminated) as has_alive_entry
    from entry_status
    group by pool_id, profile_id
  )
  select
    a.pool_id,
    coalesce(count(distinct ms.profile_id), 0)::integer as total_members,
    coalesce(count(distinct ms.profile_id) filter (where ms.has_alive_entry), 0)::integer as alive_members,
    coalesce(count(distinct es.entry_id), 0)::integer as total_entries,
    coalesce(count(distinct es.entry_id) filter (where not es.eliminated), 0)::integer as alive_entries
  from allowed a
  left join member_status ms on ms.pool_id = a.pool_id
  left join entry_status es on es.pool_id = a.pool_id
  group by a.pool_id;
$function$;

create or replace function public.pool_week_pick_completion(p_pool_id uuid, p_week integer)
returns table (
  total_entries integer,
  complete_entries integer,
  partial_entries integer,
  missing_entries integer,
  required_picks integer,
  made_slots integer,
  needed_slots integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with allowed as (
    select p_pool_id as pool_id
    where public.admin_can_manage(p_pool_id)
       or exists (
         select 1
         from public.pool_members mine
         where mine.pool_id = p_pool_id
           and mine.profile_id = auth.uid()
       )
  ),
  required as (
    select public.picks_allowed(p_pool_id, p_week) as required_picks
  ),
  entries as (
    select pm.id as entry_id
    from public.pool_members pm
    join allowed a on a.pool_id = pm.pool_id
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where coalesce(s.eliminated, false) = false
  ),
  made as (
    select entry_id, slot
    from public.pool_pick_drafts
    where pool_id = p_pool_id
      and week = p_week
      and not team_abbr like 'NO_PICK%'
    union
    select entry_id, slot
    from public.pool_picks
    where pool_id = p_pool_id
      and week = p_week
      and not team_abbr like 'NO_PICK%'
  ),
  entry_counts as (
    select
      e.entry_id,
      count(distinct m.slot)::integer as made_count
    from entries e
    left join made m on m.entry_id = e.entry_id
    group by e.entry_id
  )
  select
    count(*)::integer as total_entries,
    count(*) filter (where ec.made_count >= r.required_picks)::integer as complete_entries,
    count(*) filter (where ec.made_count > 0 and ec.made_count < r.required_picks)::integer as partial_entries,
    count(*) filter (where ec.made_count = 0)::integer as missing_entries,
    r.required_picks::integer,
    coalesce(sum(least(ec.made_count, r.required_picks)), 0)::integer as made_slots,
    (count(*) * r.required_picks)::integer as needed_slots
  from entry_counts ec
  cross join required r
  group by r.required_picks;
$function$;

grant execute on function public.pool_member_summaries(uuid[]) to authenticated;
grant execute on function public.pool_week_pick_completion(uuid, integer) to authenticated;

commit;
