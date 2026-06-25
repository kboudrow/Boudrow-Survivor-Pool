begin;

create or replace function public.sync_profiles_public_from_profiles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles_public (id, username, first_name, last_name, avatar_url, created_at)
  values (
    new.id,
    nullif(btrim(new.username), ''),
    new.first_name,
    new.last_name,
    new.avatar_url,
    coalesce(new.created_at, now())
  )
  on conflict (id) do update
  set username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      avatar_url = excluded.avatar_url;

  return new;
end;
$function$;

insert into public.profiles_public (id, username, first_name, last_name, avatar_url, created_at)
select
  p.id,
  nullif(btrim(p.username), ''),
  p.first_name,
  p.last_name,
  p.avatar_url,
  coalesce(p.created_at, now())
from public.profiles p
on conflict (id) do update
set username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    avatar_url = excluded.avatar_url;

create or replace function public.blog_delete_own_comment(p_comment_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Please sign in to delete comments.';
  end if;

  update public.blog_comments
  set deleted_at = now(),
      updated_at = now()
  where id = p_comment_id
    and profile_id = auth.uid()
    and deleted_at is null;

  if not found then
    return 'Comment was already deleted or was not found.';
  end if;

  return 'Comment deleted.';
end;
$function$;

grant execute on function public.blog_delete_own_comment(uuid) to authenticated;

commit;
