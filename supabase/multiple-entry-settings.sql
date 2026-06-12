-- Pool-level settings for multiple entries.
--
-- This adds the commissioner-facing setting. A follow-up migration should move
-- picks, standings, and admin views from user-level identity to entry-level
-- identity before enabling multiple active entries in gameplay.

alter table public.pools
  add column if not exists allow_multiple_entries boolean not null default false,
  add column if not exists max_entries_per_user integer not null default 1;

alter table public.pools
  drop constraint if exists pools_max_entries_per_user_check,
  add constraint pools_max_entries_per_user_check
    check (max_entries_per_user between 1 and 10);

update public.pools
set
  allow_multiple_entries = coalesce(allow_multiple_entries, false),
  max_entries_per_user = greatest(1, least(coalesce(max_entries_per_user, 1), 10));

create or replace function public.admin_update_pool_entry_settings(
  p_pool_id uuid,
  p_allow_multiple_entries boolean,
  p_max_entries_per_user integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool record;
  v_first_start timestamptz;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select
    p.id,
    coalesce(p.season, extract(year from now())::integer) as season,
    coalesce(p.start_week, 1) as start_week
  into v_pool
  from public.pools p
  where p.id = p_pool_id;

  if v_pool.id is null then
    raise exception 'pool not found';
  end if;

  select min(coalesce(g.kickoff_at_utc, g.game_time))
  into v_first_start
  from public.nfl_games g
  where g.season = v_pool.season
    and g.week = v_pool.start_week
    and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(v_pool.season, 1, 1, 0, 0, 0, 'UTC');

  if v_first_start is not null and now() >= v_first_start then
    raise exception 'League settings cannot be changed after the league has started.';
  end if;

  if p_max_entries_per_user is null or p_max_entries_per_user < 1 or p_max_entries_per_user > 10 then
    raise exception 'Entries per user must be between 1 and 10.';
  end if;

  update public.pools
  set
    allow_multiple_entries = coalesce(p_allow_multiple_entries, false),
    max_entries_per_user = case when coalesce(p_allow_multiple_entries, false) then p_max_entries_per_user else 1 end
  where id = p_pool_id;
end;
$function$;
