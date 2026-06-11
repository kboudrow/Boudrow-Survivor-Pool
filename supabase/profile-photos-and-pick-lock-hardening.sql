-- Profile photos plus safer pick locking.
-- This migration is safe to re-run.

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists avatars_own_insert on storage.objects;
drop policy if exists avatars_own_update on storage.objects;
drop policy if exists avatars_own_delete on storage.objects;

create policy avatars_public_read
on storage.objects
for select
using (bucket_id = 'avatars');

create policy avatars_own_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_own_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_own_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.restore_unlocked_picks_for_pool(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  restored_count int := 0;
  can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select public.admin_can_manage(p_pool_id) into can_manage;

  if not can_manage and not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    raise exception 'You are not a member of this pool.';
  end if;

  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  final_locks as (
    select
      pp.pool_id,
      pp.user_id,
      pp.week,
      pp.slot,
      upper(pp.team_abbr) as team_abbr,
      case
        when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
          least(
            coalesce(g.kickoff_at_utc, g.game_time),
            ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
          )
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_picks pp
    join pool_settings ps on ps.id = pp.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = pp.week
     and upper(pp.team_abbr) in (upper(g.home_team), upper(g.away_team))
    left join public.season_weeks sw
      on sw.season = ps.season
     and sw.week = pp.week
    where pp.pool_id = p_pool_id
      and (can_manage or pp.user_id = auth.uid())
  ),
  unlocked as (
    select *
    from final_locks
    where lock_at > now()
  ),
  restored as (
    insert into public.pool_pick_drafts (pool_id, user_id, week, slot, team_abbr, updated_at)
    select pool_id, user_id, week, slot, team_abbr, now()
    from unlocked
    on conflict (pool_id, user_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        updated_at = excluded.updated_at
    returning 1
  ),
  deleted as (
    delete from public.pool_picks pp
    using unlocked u
    where pp.pool_id = u.pool_id
      and pp.user_id = u.user_id
      and pp.week = u.week
      and pp.slot = u.slot
    returning 1
  )
  select count(*) into restored_count from restored;

  return coalesce(restored_count, 0);
end;
$function$;

create or replace function public.finalize_locked_picks(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int;
begin
  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  draft_locks as (
    select
      d.pool_id,
      d.user_id,
      d.week,
      d.slot,
      upper(d.team_abbr) as team_abbr,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at,
      case
        when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
          least(
            coalesce(g.kickoff_at_utc, g.game_time),
            ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
          )
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = d.week
     and upper(d.team_abbr) in (upper(g.home_team), upper(g.away_team))
    left join public.season_weeks sw
      on sw.season = ps.season
     and sw.week = d.week
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= now()
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, week, slot, team_abbr, lock_at, now()
    from to_commit
    on conflict (pool_id, user_id, week, slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.user_id = tc.user_id
      and d.week = tc.week
      and d.slot = tc.slot
    returning 1
  )
  select count(*) into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_picks_week(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return public.finalize_locked_picks(p_pool_id, p_week);
end;
$function$;

create or replace function public.pool_member_roster(p_pool_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  role text,
  status text,
  joined_at timestamptz
)
language sql
security definer
set search_path = 'public'
as $function$
  select
    pm.profile_id,
    coalesce(pr.display_name, pr.username, pr."User_name")::text as display_name,
    pr.username::text as username,
    pr.first_name::text as first_name,
    pr.last_name::text as last_name,
    pr.avatar_url::text as avatar_url,
    pm.role::text as role,
    pm.status::text as status,
    pm.joined_at
  from public.pool_members pm
  left join public.profiles pr on pr.id = pm.profile_id
  where pm.pool_id = p_pool_id
    and (
      exists (
        select 1
        from public.pool_members viewer
        where viewer.pool_id = p_pool_id
          and viewer.profile_id = auth.uid()
      )
      or exists (
        select 1
        from public.pools p
        where p.id = p_pool_id
          and p.created_by = auth.uid()
      )
    )
  order by pm.joined_at asc;
$function$;

-- One-time repair for any future picks that were prematurely made final.
with pool_settings as (
  select
    p.id,
    coalesce(p.season, extract(year from now())::int) as season,
    coalesce(p.deadline_mode, 'fixed') as deadline_mode,
    coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
  from public.pools p
),
final_locks as (
  select
    pp.pool_id,
    pp.user_id,
    pp.week,
    pp.slot,
    upper(pp.team_abbr) as team_abbr,
    case
      when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
        least(
          coalesce(g.kickoff_at_utc, g.game_time),
          ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
        )
      else coalesce(g.kickoff_at_utc, g.game_time)
    end as lock_at
  from public.pool_picks pp
  join pool_settings ps on ps.id = pp.pool_id
  join public.nfl_games g
    on g.season = ps.season
   and g.week = pp.week
   and upper(pp.team_abbr) in (upper(g.home_team), upper(g.away_team))
  left join public.season_weeks sw
    on sw.season = ps.season
   and sw.week = pp.week
),
unlocked as (
  select *
  from final_locks
  where lock_at > now()
),
restored as (
  insert into public.pool_pick_drafts (pool_id, user_id, week, slot, team_abbr, updated_at)
  select pool_id, user_id, week, slot, team_abbr, now()
  from unlocked
  on conflict (pool_id, user_id, week, slot) do update
  set team_abbr = excluded.team_abbr,
      updated_at = excluded.updated_at
  returning pool_id, user_id, week, slot
)
delete from public.pool_picks pp
using restored r
where pp.pool_id = r.pool_id
  and pp.user_id = r.user_id
  and pp.week = r.week
  and pp.slot = r.slot;
