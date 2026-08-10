begin;

drop function if exists public.search_pools(text);

create function public.search_pools(p_term text)
returns table (
  id uuid,
  name text,
  is_public boolean,
  allow_discovery boolean,
  start_week integer,
  include_playoffs boolean,
  strikes_allowed text,
  tie_rule text,
  deadline_mode text,
  deadline_fixed text,
  notes text,
  created_at timestamptz,
  activation_status text,
  max_members integer,
  member_count integer,
  owned_by_me boolean,
  already_joined boolean
)
language sql
security definer
set search_path to 'public'
as $function$
  with input as (
    select btrim(coalesce(p_term, '')) as term
  ),
  candidate_pools as (
    select
      p.*,
      coalesce(
        (
          select min(coalesce(g.kickoff_at_utc, g.game_time))
          from public.nfl_games g
          where g.season = coalesce(p.season, extract(year from now())::integer)
            and g.week = coalesce(p.start_week, 1)
            and coalesce(g.kickoff_at_utc, g.game_time) >= make_timestamptz(coalesce(p.season, extract(year from now())::integer), 1, 1, 0, 0, 0, 'UTC')
        ),
        (
          select sw.week_sunday_date::timestamp at time zone 'America/New_York'
          from public.season_weeks sw
          where sw.season = coalesce(p.season, extract(year from now())::integer)
            and sw.week = coalesce(p.start_week, 1)
        )
      ) as starts_at
    from public.pools p
  )
  select
    p.id,
    p.name,
    p.is_public,
    p.allow_discovery,
    p.start_week,
    p.include_playoffs,
    p.strikes_allowed::text,
    p.tie_rule::text,
    p.deadline_mode::text,
    p.deadline_fixed,
    case when coalesce(p.is_public, false) then p.notes else null end as notes,
    p.created_at,
    coalesce(p.activation_status, 'active')::text as activation_status,
    p.max_members,
    (
      select count(distinct pm.profile_id)::integer
      from public.pool_members pm
      where pm.pool_id = p.id
    ) as member_count,
    (auth.uid() is not null and p.created_by = auth.uid()) as owned_by_me,
    (
      auth.uid() is not null
      and exists (
        select 1
        from public.pool_members mine
        where mine.pool_id = p.id
          and mine.profile_id = auth.uid()
      )
    ) as already_joined
  from candidate_pools p
  cross join input i
  where
    coalesce(p.archived, false) = false
    and coalesce(p.activation_status, 'active') <> 'cancelled'
    and (p.starts_at is null or now() < p.starts_at)
    and not (
      coalesce(p.test_mode, false)
      and coalesce(p.test_current_week, p.start_week, 1) >= coalesce(p.start_week, 1)
    )
    and (
      (i.term = '' and coalesce(p.is_public, false))
      or (
        i.term <> ''
        and p.name ilike ('%' || i.term || '%')
        and (coalesce(p.is_public, false) or length(i.term) >= 2)
      )
    )
  order by p.created_at desc
  limit 50;
$function$;

revoke all on function public.search_pools(text) from public;
grant execute on function public.search_pools(text) to anon, authenticated, service_role;

commit;
