-- Enable entry-level gameplay for pools that allow multiple entries.
--
-- Model:
-- - public.pool_members is now the entry table.
-- - profile_id is the owning user.
-- - entry_number is the user's entry number inside the pool.
-- - pool_pick_drafts, pool_picks, and pool_member_stats keep user_id for
--   compatibility, and add entry_id for true entry-specific picks/standings.

alter table public.pool_members
  add column if not exists entry_number integer not null default 1,
  add column if not exists entry_name text;

update public.pool_members
set entry_number = 1
where entry_number is null;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'pool_members'
      and con.contype in ('u', 'p')
      and (
        select array_agg(att.attname::text order by ord)
        from unnest(con.conkey) with ordinality as cols(attnum, ord)
        join pg_attribute att on att.attrelid = con.conrelid and att.attnum = cols.attnum
      ) = array['pool_id', 'profile_id']
  loop
    execute format('alter table public.pool_members drop constraint %I', constraint_name);
  end loop;
end $$;

create unique index if not exists pool_members_pool_profile_entry_number_key
  on public.pool_members (pool_id, profile_id, entry_number);

create index if not exists idx_pool_members_pool_profile_entry
  on public.pool_members (pool_id, profile_id, id);

alter table public.pool_pick_drafts
  add column if not exists entry_id uuid references public.pool_members(id) on delete cascade;

alter table public.pool_picks
  add column if not exists entry_id uuid references public.pool_members(id) on delete cascade;

alter table public.pool_member_stats
  add column if not exists entry_id uuid references public.pool_members(id) on delete cascade;

update public.pool_pick_drafts d
set entry_id = pm.id
from public.pool_members pm
where d.entry_id is null
  and pm.pool_id = d.pool_id
  and pm.profile_id = d.user_id
  and pm.entry_number = 1;

update public.pool_picks p
set entry_id = pm.id
from public.pool_members pm
where p.entry_id is null
  and pm.pool_id = p.pool_id
  and pm.profile_id = p.user_id
  and pm.entry_number = 1;

update public.pool_member_stats s
set entry_id = pm.id
from public.pool_members pm
where s.entry_id is null
  and pm.pool_id = s.pool_id
  and pm.profile_id = s.user_id
  and pm.entry_number = 1;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('pool_pick_drafts', 'pool_picks', 'pool_member_stats')
      and con.contype in ('p', 'u')
      and con.conname in ('pool_pick_drafts_pkey', 'pool_picks_pkey', 'pool_member_stats_pkey')
  loop
    execute format('alter table public.%I drop constraint %I', split_part(constraint_name, '_pkey', 1), constraint_name);
  end loop;
end $$;

drop index if exists pool_pick_drafts_no_duplicate_team;
drop index if exists pool_picks_no_duplicate_team;

alter table public.pool_pick_drafts
  alter column entry_id set not null;

alter table public.pool_picks
  alter column entry_id set not null;

alter table public.pool_member_stats
  alter column entry_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_pick_drafts'::regclass
      and conname = 'pool_pick_drafts_pkey'
  ) then
    alter table public.pool_pick_drafts
      add constraint pool_pick_drafts_pkey primary key (pool_id, entry_id, week, slot);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_picks'::regclass
      and conname = 'pool_picks_pkey'
  ) then
    alter table public.pool_picks
      add constraint pool_picks_pkey primary key (pool_id, entry_id, week, slot);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pool_member_stats'::regclass
      and conname = 'pool_member_stats_pkey'
  ) then
    alter table public.pool_member_stats
      add constraint pool_member_stats_pkey primary key (pool_id, entry_id);
  end if;
end $$;

create unique index if not exists pool_pick_drafts_no_duplicate_team
  on public.pool_pick_drafts (pool_id, entry_id, week, team_abbr);

create unique index if not exists pool_picks_no_duplicate_team
  on public.pool_picks (pool_id, entry_id, week, team_abbr);

create index if not exists idx_pool_pick_drafts_entry_week
  on public.pool_pick_drafts (pool_id, entry_id, week, slot);

create index if not exists idx_pool_picks_entry_week
  on public.pool_picks (pool_id, entry_id, week, slot);

create index if not exists idx_pool_member_stats_entry
  on public.pool_member_stats (pool_id, entry_id);

create or replace function public.join_pool(p_pool_id uuid, p_password text default null, p_token text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry_count integer;
  v_is_owner boolean;
  v_password_hash text;
  v_next_entry integer;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to join this pool.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  v_is_owner := v_pool.created_by = auth.uid();

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  if not v_is_owner and coalesce(v_pool.activation_status, 'draft') <> 'active' then
    raise exception 'This pool is not accepting members yet.';
  end if;

  if exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    return;
  end if;

  select count(*)
  into v_entry_count
  from public.pool_members pm
  where pm.pool_id = p_pool_id;

  if not v_is_owner and v_entry_count >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  if not coalesce(v_pool.is_public, false) and not v_is_owner then
    v_password_hash := coalesce(v_pool.join_password_hash, v_pool.password_hash, v_pool.private_password_hash);
    if v_password_hash is null
      or p_password is null
      or extensions.crypt(p_password, v_password_hash) <> v_password_hash then
      raise exception 'Incorrect pool password.';
    end if;
  end if;

  select coalesce(max(pm.entry_number), 0) + 1
  into v_next_entry
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.profile_id = auth.uid();

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (
    p_pool_id,
    auth.uid(),
    case when v_is_owner then 'admin'::public.member_role else 'member'::public.member_role end,
    'alive',
    v_next_entry
  );
end;
$function$;

create or replace function public.add_pool_entry(p_pool_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_current_entries integer;
  v_pool_entries integer;
  v_next_entry integer;
  v_entry_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to add an entry.';
  end if;

  select *
  into v_pool
  from public.pools
  where id = p_pool_id
  for update;

  if not found then
    raise exception 'Pool not found.';
  end if;

  if coalesce(v_pool.archived, false) then
    raise exception 'This pool is archived.';
  end if;

  if not coalesce(v_pool.allow_multiple_entries, false) then
    raise exception 'This pool only allows one entry per user.';
  end if;

  select count(*), coalesce(max(entry_number), 0) + 1
  into v_current_entries, v_next_entry
  from public.pool_members
  where pool_id = p_pool_id
    and profile_id = auth.uid();

  if v_current_entries = 0 then
    raise exception 'Join this pool before adding another entry.';
  end if;

  if v_current_entries >= coalesce(v_pool.max_entries_per_user, 1) then
    raise exception 'You have reached the entry limit for this pool.';
  end if;

  select count(*)
  into v_pool_entries
  from public.pool_members
  where pool_id = p_pool_id;

  if v_pool_entries >= coalesce(v_pool.max_members, 25) then
    raise exception 'This pool is full.';
  end if;

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (p_pool_id, auth.uid(), 'member'::public.member_role, 'alive', v_next_entry)
  returning id into v_entry_id;

  return v_entry_id;
end;
$function$;

create or replace function public.enforce_weekly_draft_limit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  allowed int;
  current_count int;
  is_out boolean := false;
  owning_user uuid;
begin
  if new.entry_id is null then
    select pm.id
    into new.entry_id
    from public.pool_members pm
    where pm.pool_id = new.pool_id
      and pm.profile_id = new.user_id
    order by pm.entry_number
    limit 1;
  end if;

  select pm.profile_id
  into owning_user
  from public.pool_members pm
  where pm.id = new.entry_id
    and pm.pool_id = new.pool_id;

  if owning_user is null or owning_user <> new.user_id then
    raise exception 'Entry does not belong to this user.';
  end if;

  select public.picks_allowed(new.pool_id, new.week) into allowed;

  if allowed < 1 then
    raise exception 'This pool does not allow picks for week %.', new.week;
  end if;

  select coalesce(s.eliminated, false)
  into is_out
  from public.pool_member_stats s
  where s.pool_id = new.pool_id
    and s.entry_id = new.entry_id;

  if coalesce(is_out, false) then
    raise exception 'Eliminated entries cannot make new picks.';
  end if;

  if new.slot < 1 or new.slot > allowed then
    raise exception 'Slot % is not available for week %. This pool allows % pick(s).', new.slot, new.week, allowed;
  end if;

  if exists (
    select 1
    from public.pool_pick_drafts d
    where d.pool_id = new.pool_id
      and d.entry_id = new.entry_id
      and d.week = new.week
      and d.team_abbr = upper(new.team_abbr)
      and (tg_op <> 'UPDATE' or d.slot <> old.slot)
  ) then
    raise exception 'Team % is already selected for week %.', upper(new.team_abbr), new.week;
  end if;

  select count(*) into current_count
  from public.pool_pick_drafts d
  where d.pool_id = new.pool_id
    and d.entry_id = new.entry_id
    and d.week = new.week;

  if tg_op = 'UPDATE'
     and (new.pool_id, new.entry_id, new.week, new.slot) = (old.pool_id, old.entry_id, old.week, old.slot)
  then
    current_count := current_count - 1;
  end if;

  if current_count >= allowed then
    raise exception 'You have reached the maximum of % pick(s) for week % in this pool.', allowed, new.week;
  end if;

  new.team_abbr := upper(new.team_abbr);
  return new;
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
      d.entry_id,
      d.week,
      d.slot,
      d.team_abbr,
      coalesce(g.kickoff_at_utc, g.game_time) as kickoff_at,
      case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(d.pool_id, d.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end as lock_at
    from public.pool_pick_drafts d
    join pool_settings ps on ps.id = d.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = d.week
     and d.team_abbr in (g.home_team, g.away_team)
    where d.pool_id = p_pool_id
      and d.week = p_week
  ),
  to_commit as (
    select *
    from draft_locks
    where lock_at <= now()
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, lock_at, now()
    from to_commit
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  ),
  del as (
    delete from public.pool_pick_drafts d
    using to_commit tc
    where d.pool_id = tc.pool_id
      and d.entry_id = tc.entry_id
      and d.week = tc.week
      and d.slot = tc.slot
    returning 1
  )
  select count(*) into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.finalize_no_pick_losses(p_pool_id uuid, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  inserted int := 0;
  week_deadline timestamptz;
begin
  select public.pool_week_deadline_at(p_pool_id, p_week) into week_deadline;

  if week_deadline is null or now() < week_deadline or public.picks_allowed(p_pool_id, p_week) < 1 then
    return 0;
  end if;

  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  ),
  missing as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      p_week as week,
      slots.slot,
      ('NO_PICK_' || slots.slot)::text as team_abbr
    from public.pool_members pm
    cross join slots
    left join public.pool_member_stats s
      on s.pool_id = pm.pool_id
     and s.entry_id = pm.id
    where pm.pool_id = p_pool_id
      and coalesce(s.eliminated, false) = false
      and not exists (
        select 1
        from public.pool_picks pp
        where pp.pool_id = pm.pool_id
          and pp.entry_id = pm.id
          and pp.week = p_week
          and pp.slot = slots.slot
      )
  ),
  ins as (
    insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, week_deadline, 'loss', now(), now()
    from missing
    on conflict (pool_id, entry_id, week, slot) do nothing
    returning 1
  )
  select count(*) into inserted from ins;

  return coalesce(inserted, 0);
end;
$function$;

create or replace function public.adjudicate_results(p_season integer, p_week integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_graded int := 0;
begin
  with eligible_picks as (
    select
      pp.pool_id,
      pp.user_id,
      pp.entry_id,
      pp.week,
      pp.team_abbr,
      coalesce(nullif(po.tie_rule, ''), 'loss') as tie_rule
    from public.pool_picks pp
    join public.pools po on po.id = pp.pool_id
    where coalesce(po.season, p_season) = p_season
      and pp.week = p_week
  ),
  final_games as (
    select
      g.week,
      g.home_team,
      g.away_team,
      g.winner
    from public.nfl_games g
    where g.season = p_season
      and g.week = p_week
      and g.status = 'final'
      and coalesce(g.kickoff_at_utc, g.game_time) <= now()
      and (
        g.winner is null
        or g.winner in (g.home_team, g.away_team)
      )
  ),
  graded as (
    select
      ep.pool_id,
      ep.user_id,
      ep.entry_id,
      ep.week,
      ep.team_abbr,
      case
        when fg.winner is null then ep.tie_rule
        when ep.team_abbr = fg.winner then 'win'
        else 'loss'
      end as result
    from eligible_picks ep
    join final_games fg
      on fg.week = ep.week
     and ep.team_abbr in (fg.home_team, fg.away_team)
  ),
  updated as (
    update public.pool_picks pp
       set result = g.result,
           adjudicated_at = now()
      from graded g
     where pp.pool_id = g.pool_id
       and pp.entry_id = g.entry_id
       and pp.week = g.week
       and pp.team_abbr = g.team_abbr
       and pp.result is distinct from g.result
    returning 1
  )
  select count(*) into v_graded from updated;

  with entry_results as (
    select
      pm.pool_id,
      pm.profile_id as user_id,
      pm.id as entry_id,
      coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
      count(pp.*) filter (where pp.result = 'win')::int as wins,
      count(pp.*) filter (where pp.result = 'loss')::int as losses,
      count(pp.*) filter (where pp.result = 'push')::int as pushes,
      count(pp.*) filter (where pp.result = 'loss')::int as strikes_used
    from public.pool_members pm
    join public.pools po on po.id = pm.pool_id
    left join public.pool_picks pp
      on pp.pool_id = pm.pool_id
     and pp.entry_id = pm.id
     and pp.result is not null
    where coalesce(po.season, p_season) = p_season
    group by pm.pool_id, pm.profile_id, pm.id, po.strikes_allowed
  ),
  first_elimination as (
    select pool_id, entry_id, min(week) as eliminated_week
    from (
      select
        pp.pool_id,
        pp.entry_id,
        pp.week,
        coalesce(nullif(po.strikes_allowed, '')::int, 0) as strikes_allowed,
        count(*) filter (where pp.result = 'loss') over (
          partition by pp.pool_id, pp.entry_id
          order by pp.week
          rows between unbounded preceding and current row
        ) as running_strikes
      from public.pool_picks pp
      join public.pools po on po.id = pp.pool_id
      where coalesce(po.season, p_season) = p_season
        and pp.result is not null
    ) progress
    where running_strikes > strikes_allowed
    group by pool_id, entry_id
  )
  insert into public.pool_member_stats (
    pool_id,
    user_id,
    entry_id,
    wins,
    losses,
    pushes,
    strikes_used,
    eliminated,
    eliminated_week,
    updated_at
  )
  select
    er.pool_id,
    er.user_id,
    er.entry_id,
    er.wins,
    er.losses,
    er.pushes,
    er.strikes_used,
    er.strikes_used > er.strikes_allowed,
    fe.eliminated_week,
    now()
  from entry_results er
  left join first_elimination fe
    on fe.pool_id = er.pool_id
   and fe.entry_id = er.entry_id
  on conflict (pool_id, entry_id) do update
  set user_id = excluded.user_id,
      wins = excluded.wins,
      losses = excluded.losses,
      pushes = excluded.pushes,
      strikes_used = excluded.strikes_used,
      eliminated = excluded.eliminated,
      eliminated_week = excluded.eliminated_week,
      updated_at = excluded.updated_at;

  return coalesce(v_graded, 0);
end;
$function$;

create or replace function public.pool_entry_roster(p_pool_id uuid)
returns table (
  entry_id uuid,
  profile_id uuid,
  entry_number integer,
  entry_name text,
  display_name text,
  username text,
  first_name text,
  last_name text,
  avatar_url text,
  role text,
  status text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to view this pool.';
  end if;

  if not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) and not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  select
    pm.id as entry_id,
    pm.profile_id,
    coalesce(pm.entry_number, 1) as entry_number,
    pm.entry_name::text as entry_name,
    coalesce(
      nullif(pr.display_name::text, ''),
      nullif(pr.username::text, ''),
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      'Player ' || left(pm.profile_id::text, 8)
    )::text as display_name,
    pr.username::text,
    pr.first_name::text,
    pr.last_name::text,
    pr.avatar_url::text as avatar_url,
    pm.role::text as role,
    pm.status::text as status,
    pm.joined_at
  from public.pool_members pm
  left join public.profiles pr on pr.id = pm.profile_id
  where pm.pool_id = p_pool_id
  order by display_name, pm.entry_number;
end;
$function$;

create or replace function public.admin_pool_entry_week_overview(p_pool_id uuid, p_week integer)
returns table (
  entry_id uuid,
  user_id uuid,
  entry_number integer,
  entry_name text,
  display_name text,
  role text,
  joined_at timestamptz,
  slot integer,
  draft_team_abbr text,
  draft_updated_at timestamptz,
  final_team_abbr text,
  locked_at timestamptz,
  result text,
  wins int,
  losses int,
  pushes int,
  strikes_used int,
  eliminated boolean,
  eliminated_week int
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  return query
  with slots as (
    select generate_series(1, public.picks_allowed(p_pool_id, p_week)) as slot
  )
  select
    pm.id as entry_id,
    pm.profile_id as user_id,
    coalesce(pm.entry_number, 1) as entry_number,
    pm.entry_name::text as entry_name,
    coalesce(
      nullif(trim(concat_ws(' ', pr.first_name, pr.last_name)), ''),
      nullif(pr.display_name, ''),
      nullif(pr.username, ''),
      nullif(pr."User_name", ''),
      pm.profile_id::text
    ) as display_name,
    pm.role::text as role,
    pm.joined_at,
    slots.slot,
    d.team_abbr as draft_team_abbr,
    d.updated_at as draft_updated_at,
    fp.team_abbr as final_team_abbr,
    fp.locked_at,
    fp.result,
    coalesce(s.wins, 0) as wins,
    coalesce(s.losses, 0) as losses,
    coalesce(s.pushes, 0) as pushes,
    coalesce(s.strikes_used, 0) as strikes_used,
    coalesce(s.eliminated, false) as eliminated,
    s.eliminated_week
  from public.pool_members pm
  cross join slots
  left join public.profiles pr on pr.id = pm.profile_id
  left join public.pool_pick_drafts d
    on d.pool_id = pm.pool_id
   and d.entry_id = pm.id
   and d.week = p_week
   and d.slot = slots.slot
  left join public.pool_picks fp
    on fp.pool_id = pm.pool_id
   and fp.entry_id = pm.id
   and fp.week = p_week
   and fp.slot = slots.slot
  left join public.pool_member_stats s
    on s.pool_id = pm.pool_id
   and s.entry_id = pm.id
  where pm.pool_id = p_pool_id
  order by display_name, pm.entry_number, slots.slot;
end;
$function$;

create or replace function public.admin_clear_entry_week_draft_slot(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_slot integer default 1,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = coalesce(p_slot, 1);
end;
$function$;

create or replace function public.admin_upsert_entry_draft(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_slot integer default 1,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select pm.profile_id
  into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  if exists (
    select 1
    from public.pool_picks p
    where p.pool_id = p_pool_id
      and p.entry_id = p_entry_id
      and p.week = p_week
      and p.slot = coalesce(p_slot, 1)
  ) then
    raise exception 'This pick is already final. Override the final pick instead.';
  end if;

  insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, coalesce(p_slot, 1), upper(p_team_abbr), now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        updated_at = now();
end;
$function$;

create or replace function public.admin_override_entry_final_pick(
  p_pool_id uuid,
  p_entry_id uuid,
  p_week integer,
  p_team_abbr text,
  p_reason text default null,
  p_slot integer default 1
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select pm.profile_id
  into v_user_id
  from public.pool_members pm
  where pm.pool_id = p_pool_id
    and pm.id = p_entry_id;

  if v_user_id is null then
    raise exception 'Entry not found.';
  end if;

  insert into public.pool_picks (pool_id, user_id, entry_id, week, slot, team_abbr, locked_at, result, adjudicated_at, created_at)
  values (p_pool_id, v_user_id, p_entry_id, p_week, coalesce(p_slot, 1), upper(p_team_abbr), now(), null, null, now())
  on conflict (pool_id, entry_id, week, slot) do update
    set team_abbr = excluded.team_abbr,
        user_id = excluded.user_id,
        locked_at = now(),
        result = null,
        adjudicated_at = null;

  delete from public.pool_pick_drafts d
  where d.pool_id = p_pool_id
    and d.entry_id = p_entry_id
    and d.week = p_week
    and d.slot = coalesce(p_slot, 1);
end;
$function$;

create or replace function public.admin_remove_pool_entry(
  p_pool_id uuid,
  p_entry_id uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pool public.pools%rowtype;
  v_entry public.pool_members%rowtype;
  v_user_entry_count integer;
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  select * into v_pool from public.pools where id = p_pool_id;
  if not found then
    raise exception 'Pool not found.';
  end if;

  select * into v_entry from public.pool_members where pool_id = p_pool_id and id = p_entry_id;
  if not found then
    raise exception 'Entry not found.';
  end if;

  if coalesce(v_pool.activation_status, 'draft') = 'active' then
    raise exception 'Entries cannot be removed after the pool is active.';
  end if;

  select count(*)
  into v_user_entry_count
  from public.pool_members
  where pool_id = p_pool_id
    and profile_id = v_entry.profile_id;

  if v_entry.profile_id = v_pool.created_by and v_user_entry_count <= 1 then
    raise exception 'The pool creator must keep at least one entry.';
  end if;

  delete from public.pool_members
  where pool_id = p_pool_id
    and id = p_entry_id;
end;
$function$;

create or replace function public.restore_unlocked_picks_for_pool(p_pool_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  restored integer := 0;
  can_manage boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;

  select public.admin_can_manage(p_pool_id) into can_manage;

  if not can_manage and not exists (
    select 1
    from public.pool_members pm
    where pm.pool_id = p_pool_id
      and pm.profile_id = auth.uid()
  ) then
    raise exception 'not authorized';
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
  unlocked as (
    select
      pp.pool_id,
      pp.user_id,
      pp.entry_id,
      pp.week,
      pp.slot,
      pp.team_abbr
    from public.pool_picks pp
    join pool_settings ps on ps.id = pp.pool_id
    join public.nfl_games g
      on g.season = ps.season
     and g.week = pp.week
     and pp.team_abbr in (g.home_team, g.away_team)
    where pp.pool_id = p_pool_id
      and pp.result is null
      and now() < case
        when ps.deadline_mode = 'fixed' then
          least(coalesce(g.kickoff_at_utc, g.game_time), public.pool_week_deadline_at(pp.pool_id, pp.week))
        else coalesce(g.kickoff_at_utc, g.game_time)
      end
      and (can_manage or pp.user_id = auth.uid())
  ),
  restored_rows as (
    insert into public.pool_pick_drafts (pool_id, user_id, entry_id, week, slot, team_abbr, updated_at)
    select pool_id, user_id, entry_id, week, slot, team_abbr, now()
    from unlocked
    on conflict (pool_id, entry_id, week, slot) do update
      set team_abbr = excluded.team_abbr,
          updated_at = now()
    returning pool_id, entry_id, week, slot
  ),
  deleted as (
    delete from public.pool_picks pp
    using restored_rows r
    where pp.pool_id = r.pool_id
      and pp.entry_id = r.entry_id
      and pp.week = r.week
      and pp.slot = r.slot
    returning 1
  )
  select count(*) into restored from restored_rows;

  return coalesce(restored, 0);
end;
$function$;
