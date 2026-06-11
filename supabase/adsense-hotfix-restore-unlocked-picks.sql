-- Hotfix: use the existing one-argument admin_can_manage helper.

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
