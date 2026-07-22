begin;

drop function if exists public.update_my_profile(text, text, text, text);

create or replace function public.update_my_profile(
  p_username text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_avatar_url text default null,
  p_favorite_team text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_username text := public.normalize_username(p_username);
  v_fallback text;
begin
  if v_user_id is null then
    raise exception 'Please sign in to update your profile.';
  end if;

  if p_username is not null then
    if v_username is null then
      raise exception 'Username cannot be empty.';
    end if;

    if char_length(v_username) < 3 then
      raise exception 'Username must be at least 3 characters.';
    end if;

    if char_length(v_username) > 30 then
      raise exception 'Username must be 30 characters or fewer.';
    end if;

    if v_username !~ '^[A-Za-z0-9_. -]+$' then
      raise exception 'Username can only use letters, numbers, spaces, periods, underscores, and hyphens.';
    end if;
  end if;

  v_fallback := 'Player ' || left(v_user_id::text, 8);

  insert into public.profiles (
    id,
    "User_name",
    username,
    display_name,
    first_name,
    last_name,
    avatar_url,
    favorite_team,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    coalesce(v_username, v_fallback),
    coalesce(v_username, v_fallback),
    coalesce(v_username, v_fallback),
    case when p_first_name is null then null else nullif(btrim(p_first_name), '') end,
    case when p_last_name is null then null else nullif(btrim(p_last_name), '') end,
    case when p_avatar_url is null then null else nullif(btrim(p_avatar_url), '') end,
    case when p_favorite_team is null then null else nullif(upper(btrim(p_favorite_team)), '') end,
    now(),
    now()
  )
  on conflict (id) do update
  set "User_name" = coalesce(v_username, nullif(public.profiles."User_name", ''), nullif(public.profiles.display_name, ''), v_fallback),
      username = coalesce(v_username, public.profiles.username),
      display_name = coalesce(v_username, public.profiles.display_name),
      first_name = case
        when p_first_name is null then public.profiles.first_name
        else nullif(btrim(p_first_name), '')
      end,
      last_name = case
        when p_last_name is null then public.profiles.last_name
        else nullif(btrim(p_last_name), '')
      end,
      avatar_url = case
        when p_avatar_url is null then public.profiles.avatar_url
        else nullif(btrim(p_avatar_url), '')
      end,
      favorite_team = case
        when p_favorite_team is null then public.profiles.favorite_team
        else nullif(upper(btrim(p_favorite_team)), '')
      end,
      updated_at = now();
end;
$function$;

revoke execute on function public.update_my_profile(text, text, text, text, text) from public, anon;
grant execute on function public.update_my_profile(text, text, text, text, text) to authenticated, service_role;

commit;
