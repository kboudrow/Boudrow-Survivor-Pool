-- Fix final pick locking to match the current pool_pick_drafts/pool_picks schema.

create or replace function public.finalize_picks_week(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int;
begin
  with to_commit as (
    select
      d.pool_id,
      d.user_id,
      d.week,
      d.team_abbr,
      d.updated_at
    from public.pool_pick_drafts d
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, week, team_abbr, locked_at, created_at)
    select
      tc.pool_id,
      tc.user_id,
      tc.week,
      tc.team_abbr,
      now(),
      now()
    from to_commit tc
    order by tc.updated_at asc
    on conflict do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  delete from public.pool_pick_drafts
  where pool_id = p_pool_id
    and week = p_week;

  return coalesce(inserted, 0);
end;
$function$;

-- Keep the older function name working for any code, cron job, or manual call that still uses it.
create or replace function public.finalize_week_picks(p_pool uuid, p_week integer)
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  select public.finalize_picks_week(p_pool, p_week);
$function$;
