begin;

create or replace function public.normalize_username(p_username text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select nullif(regexp_replace(btrim(coalesce(p_username, '')), '\s+', ' ', 'g'), '');
$function$;

update public.profiles
set username = public.normalize_username(username),
    display_name = public.normalize_username(username),
    updated_at = now()
where username is distinct from public.normalize_username(username);

with normalized as (
  select
    id,
    public.normalize_username(username) as normalized_username,
    row_number() over (
      partition by lower(public.normalize_username(username))
      order by created_at nulls last, id
    ) as duplicate_number
  from public.profiles
  where public.normalize_username(username) is not null
),
duplicates as (
  select id, normalized_username, duplicate_number
  from normalized
  where duplicate_number > 1
)
update public.profiles p
set username = left(d.normalized_username, 24) || ' ' || d.duplicate_number::text,
    display_name = left(d.normalized_username, 24) || ' ' || d.duplicate_number::text,
    updated_at = now()
from duplicates d
where p.id = d.id;

drop index if exists public.profiles_username_lower_unique;

create unique index if not exists profiles_username_normalized_unique
  on public.profiles (lower(public.normalize_username(username)))
  where public.normalize_username(username) is not null;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.normalize_username(p_username) is not null
    and not exists (
      select 1
      from public.profiles p
      where lower(public.normalize_username(p.username)) = lower(public.normalize_username(p_username))
    );
$function$;

grant execute on function public.normalize_username(text) to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

commit;
