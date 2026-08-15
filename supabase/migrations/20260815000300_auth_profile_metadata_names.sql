begin;

create or replace function public.ensure_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fallback text := 'Player ' || left(new.id::text, 8);
  v_candidate text := public.normalize_username(coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(concat_ws(' ', new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'last_name'), '')
  ));
begin
  if v_candidate is null
     or char_length(v_candidate) < 3
     or char_length(v_candidate) > 30
     or v_candidate !~ '^[A-Za-z0-9_. -]+$' then
    v_candidate := v_fallback;
  end if;

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
      v_candidate,
      v_candidate,
      v_candidate,
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
  exception
    when unique_violation then
      insert into public.profiles (id, "User_name", username, display_name, created_at, updated_at)
      values (new.id, v_fallback, v_fallback, v_fallback, coalesce(new.created_at, now()), now())
      on conflict (id) do nothing;
  end;

  return new;
exception
  when others then
    raise warning 'Could not create profile for auth user %: %', new.id, sqlerrm;
    return new;
end;
$function$;

revoke all on function public.ensure_auth_user_profile() from public, anon, authenticated;

-- Promote safe metadata usernames for shell profiles created by the earlier
-- reliability backfill. Conflicting or invalid names remain collision-safe.
do $backfill$
declare
  v_row record;
begin
  for v_row in
    select
      u.id,
      public.normalize_username(coalesce(
        nullif(u.raw_user_meta_data ->> 'username', ''),
        nullif(u.raw_user_meta_data ->> 'name', ''),
        nullif(u.raw_user_meta_data ->> 'full_name', ''),
        nullif(concat_ws(' ', u.raw_user_meta_data ->> 'first_name', u.raw_user_meta_data ->> 'last_name'), '')
      )) as preferred_username
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.username = 'Player ' || left(p.id::text, 8)
    order by u.created_at, u.id
  loop
    if v_row.preferred_username is null
       or char_length(v_row.preferred_username) not between 3 and 30
       or v_row.preferred_username !~ '^[A-Za-z0-9_. -]+$' then
      continue;
    end if;

    begin
      update public.profiles
      set "User_name" = v_row.preferred_username,
          username = v_row.preferred_username,
          display_name = v_row.preferred_username,
          updated_at = now()
      where id = v_row.id;
    exception
      when unique_violation then
        null;
    end;
  end loop;
end;
$backfill$;

commit;
