-- Atomic pool creation helper. Keeps client code out of direct table inserts so
-- creator setup cannot fail halfway because of RLS edge cases.

create or replace function public.create_pool_with_owner(
  p_name text,
  p_is_public boolean default true,
  p_password text default null,
  p_start_week integer default 1,
  p_include_playoffs boolean default false,
  p_strikes_allowed text default '0',
  p_tie_rule text default 'loss',
  p_deadline_mode text default 'fixed',
  p_deadline_fixed text default '13:00',
  p_notes text default null,
  p_image_url text default null,
  p_season integer default 2026,
  p_double_pick_weeks integer[] default '{}',
  p_max_members integer default 25,
  p_allow_multiple_entries boolean default false,
  p_max_entries_per_user integer default 1
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_pool_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_hash text := null;
  v_max_entries integer := case when coalesce(p_allow_multiple_entries, false) then coalesce(p_max_entries_per_user, 1) else 1 end;
  v_double_weeks integer[];
  v_user_label text;
begin
  if v_user_id is null then
    raise exception 'Please sign in before creating a pool.';
  end if;

  if v_name is null or length(v_name) < 3 then
    raise exception 'Pool name is too short. Please use at least 3 characters.';
  end if;

  if coalesce(p_start_week, 1) < 1 or coalesce(p_start_week, 1) > 12 then
    raise exception 'Start week must be between Week 1 and Week 12.';
  end if;

  if coalesce(p_max_members, 25) < 2 or coalesce(p_max_members, 25) > 500 then
    raise exception 'Member limit must be between 2 and 500.';
  end if;

  if v_max_entries < 1 or v_max_entries > 10 then
    raise exception 'Entries per user must be between 1 and 10.';
  end if;

  if lower(coalesce(p_tie_rule, 'loss')) not in ('win', 'loss') then
    raise exception 'Tie rule must be win or loss.';
  end if;

  if coalesce(p_deadline_mode, 'fixed') not in ('fixed', 'rolling') then
    raise exception 'Deadline mode must be fixed or rolling.';
  end if;

  if not coalesce(p_is_public, true) then
    if nullif(btrim(coalesce(p_password, '')), '') is null then
      raise exception 'Please enter a password for private pools.';
    end if;
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf', 8));
  end if;

  select coalesce(array_agg(distinct week order by week), '{}'::integer[])
  into v_double_weeks
  from unnest(coalesce(p_double_pick_weeks, '{}'::integer[])) as selected(week)
  where selected.week between coalesce(p_start_week, 1) and 18;

  v_user_label := 'Player ' || left(v_user_id::text, 8);

  insert into public.profiles (id, "User_name", display_name, username, created_at, updated_at)
  values (v_user_id, v_user_label, v_user_label, v_user_label, now(), now())
  on conflict (id) do nothing;

  insert into public.pools (
    name,
    is_public,
    visibility,
    allow_discovery,
    start_week,
    include_playoffs,
    strikes_allowed,
    tie_rule,
    ties,
    deadline_mode,
    deadline_fixed,
    notes,
    image_url,
    created_by,
    season,
    double_pick_weeks,
    plan,
    pick_privacy,
    activation_status,
    payment_status,
    max_members,
    allow_multiple_entries,
    max_entries_per_user,
    join_password_hash,
    password_hash,
    private_password_hash
  )
  values (
    v_name,
    coalesce(p_is_public, true),
    case when coalesce(p_is_public, true) then 'public'::public.pool_visibility else 'private'::public.pool_visibility end,
    true,
    coalesce(p_start_week, 1),
    coalesce(p_include_playoffs, false),
    coalesce(p_strikes_allowed, '0'),
    lower(coalesce(p_tie_rule, 'loss')),
    lower(coalesce(p_tie_rule, 'loss'))::public.ties_rule,
    coalesce(p_deadline_mode, 'fixed'),
    p_deadline_fixed,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_image_url,
    v_user_id,
    coalesce(p_season, 2026),
    v_double_weeks,
    'free',
    'hidden',
    'active',
    'not_required',
    coalesce(p_max_members, 25),
    coalesce(p_allow_multiple_entries, false),
    v_max_entries,
    v_hash,
    v_hash,
    v_hash
  )
  returning id into v_pool_id;

  insert into public.pool_members (pool_id, profile_id, role, status, entry_number)
  values (v_pool_id, v_user_id, 'admin'::public.member_role, 'alive', 1)
  on conflict (pool_id, profile_id, entry_number) do nothing;

  return v_pool_id;
end;
$function$;

revoke execute on function public.create_pool_with_owner(
  text,
  boolean,
  text,
  integer,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer[],
  integer,
  boolean,
  integer
) from public, anon;

grant execute on function public.create_pool_with_owner(
  text,
  boolean,
  text,
  integer,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer[],
  integer,
  boolean,
  integer
) to authenticated;
