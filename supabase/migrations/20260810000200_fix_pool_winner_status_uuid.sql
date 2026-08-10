create or replace function public.pool_winner_status(p_pool_id uuid)
returns table (
  is_decided boolean,
  winner_user_id uuid,
  winner_name text,
  winner_avatar_url text,
  alive_members integer,
  alive_entries integer,
  total_members integer,
  total_entries integer,
  decided_week integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view this pool.';
  end if;

  if not public.admin_can_manage(p_pool_id) and not exists (
    select 1
    from public.pool_members mine
    where mine.pool_id = p_pool_id
      and mine.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;

  return query
  with entry_status as (
    select
      pm.pool_id,
      pm.id as entry_id,
      pm.profile_id,
      (
        coalesce(s.eliminated, false)
        or lower(coalesce(nullif(pm.status::text, ''), 'alive')) not in ('active', 'alive')
      ) as eliminated,
      s.eliminated_week
    from public.pool_members pm
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
  ),
  totals as (
    select
      count(distinct status.profile_id)::integer as total_members,
      count(*)::integer as total_entries,
      count(distinct status.profile_id) filter (where not status.eliminated)::integer as alive_members,
      count(*) filter (where not status.eliminated)::integer as alive_entries,
      max(status.eliminated_week) filter (where status.eliminated_week is not null)::integer as decided_week
    from entry_status status
  ),
  winner as (
    select min(status.profile_id::text)::uuid as winner_user_id
    from entry_status status
    where not status.eliminated
    having count(distinct status.profile_id) = 1
  )
  select
    (t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0)::boolean,
    case when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then w.winner_user_id else null end,
    case
      when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then
        coalesce(
          nullif(profile.username::text, ''),
          nullif(trim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
          'Player ' || left(w.winner_user_id::text, 8)
        )::text
      else null
    end,
    case when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then profile.avatar_url::text else null end,
    coalesce(t.alive_members, 0)::integer,
    coalesce(t.alive_entries, 0)::integer,
    coalesce(t.total_members, 0)::integer,
    coalesce(t.total_entries, 0)::integer,
    case when t.total_members > 1 and t.alive_members = 1 and t.alive_entries > 0 then t.decided_week else null end
  from totals t
  left join winner w on true
  left join public.profiles_public profile on profile.id = w.winner_user_id;
end;
$function$;

revoke execute on function public.pool_winner_status(uuid) from public, anon;
grant execute on function public.pool_winner_status(uuid) to authenticated, service_role;
