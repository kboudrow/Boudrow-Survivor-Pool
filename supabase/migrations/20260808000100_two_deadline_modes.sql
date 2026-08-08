begin;

update public.pools
set deadline_mode = 'rolling',
    deadline_fixed = '13:00'
where coalesce(deadline_mode, 'fixed') = 'fixed'
  and coalesce(nullif(deadline_fixed, ''), '13:00') = '20:15';

update public.pools
set deadline_fixed = '13:00'
where coalesce(deadline_mode, 'fixed') = 'rolling'
  and coalesce(nullif(deadline_fixed, ''), '13:00') = '20:15';

alter table public.pools
drop constraint if exists pools_deadline_two_modes;

alter table public.pools
add constraint pools_deadline_two_modes
check (
  coalesce(deadline_mode, 'fixed') = 'rolling'
  or coalesce(nullif(deadline_fixed, ''), '13:00') = '13:00'
);

create or replace function public.pool_week_deadline_at(p_pool_id uuid, p_week integer)
returns timestamptz
language sql
security definer
set search_path to 'public'
as $function$
  with pool_settings as (
    select
      p.id,
      coalesce(p.season, extract(year from now())::int) as season,
      coalesce(p.deadline_mode, 'fixed') as deadline_mode,
      coalesce(nullif(p.deadline_fixed, ''), '13:00') as deadline_fixed
    from public.pools p
    where p.id = p_pool_id
  ),
  week_games as (
    select max(coalesce(g.kickoff_at_utc, g.game_time)) as last_kickoff
    from public.pool_week_games(p_pool_id, p_week) g
  )
  select
    case
      when ps.deadline_mode = 'fixed' and sw.week_sunday_date is not null then
        ((sw.week_sunday_date::text || ' ' || ps.deadline_fixed)::timestamp at time zone 'America/New_York')
      else wg.last_kickoff
    end
  from pool_settings ps
  left join public.season_weeks sw
    on sw.season = ps.season
   and sw.week = p_week
  cross join week_games wg
$function$;

commit;
