begin;

-- Every authenticated account needs a public profile before it can join pools.
-- Keep this trigger deliberately conservative: it creates a collision-safe shell
-- profile and lets the existing authenticated profile RPC apply user-chosen data.
create or replace function public.ensure_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fallback text := 'Player ' || left(new.id::text, 8);
begin
  insert into public.profiles (
    id,
    "User_name",
    username,
    display_name,
    first_name,
    last_name,
    avatar_url,
    created_at,
    updated_at
  )
  values (
    new.id,
    v_fallback,
    v_fallback,
    v_fallback,
    nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'last_name'), ''),
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'picture'), '')
    ),
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- Authentication must never be blocked by an optional display-profile write.
    raise warning 'Could not create profile for auth user %: %', new.id, sqlerrm;
    return new;
end;
$function$;

revoke all on function public.ensure_auth_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_ensure_profile on auth.users;
create trigger on_auth_user_created_ensure_profile
after insert on auth.users
for each row execute function public.ensure_auth_user_profile();

-- Safe, rerunnable backfill for accounts created before the trigger existed.
insert into public.profiles (
  id,
  "User_name",
  username,
  display_name,
  first_name,
  last_name,
  avatar_url,
  created_at,
  updated_at
)
select
  u.id,
  'Player ' || left(u.id::text, 8),
  'Player ' || left(u.id::text, 8),
  'Player ' || left(u.id::text, 8),
  nullif(btrim(u.raw_user_meta_data ->> 'first_name'), ''),
  nullif(btrim(u.raw_user_meta_data ->> 'last_name'), ''),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'picture'), '')
  ),
  coalesce(u.created_at, now()),
  now()
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

commit;
