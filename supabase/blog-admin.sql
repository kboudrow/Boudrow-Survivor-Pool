begin;

create table if not exists public.blog_permissions (
  profile_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('contributor', 'editor', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null,
  category text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null default 'Survive Sunday',
  read_time text not null default '4 min read',
  pinned boolean not null default false,
  hero_image_url text,
  sections jsonb not null default '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_posts_sections_array check (jsonb_typeof(sections) = 'array')
);

create index if not exists idx_blog_posts_status_updated
  on public.blog_posts (status, updated_at desc);

create index if not exists idx_blog_posts_category
  on public.blog_posts (category);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_blog_posts_touch_updated_at on public.blog_posts;
create trigger trg_blog_posts_touch_updated_at
before update on public.blog_posts
for each row execute function public.touch_updated_at();

drop trigger if exists trg_blog_permissions_touch_updated_at on public.blog_permissions;
create trigger trg_blog_permissions_touch_updated_at
before update on public.blog_permissions
for each row execute function public.touch_updated_at();

create or replace function public.current_blog_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when lower(coalesce(auth.jwt() ->> 'email', '')) = 'survivesunday1@gmail.com' then 'admin'
    else coalesce(
      (
        select bp.role
        from public.blog_permissions bp
        where bp.profile_id = auth.uid()
      ),
      ''
    )
  end;
$function$;

create or replace function public.can_manage_blog()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.current_blog_role() in ('admin', 'editor', 'contributor');
$function$;

create or replace function public.blog_permission_overview()
returns table (
  profile_id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    bp.profile_id,
    pp.email,
    coalesce(nullif(trim(concat_ws(' ', pub.first_name, pub.last_name)), ''), pub.username, pp.email, bp.profile_id::text) as display_name,
    bp.role,
    bp.created_at
  from public.blog_permissions bp
  left join public.profiles_private pp on pp.id = bp.profile_id
  left join public.profiles_public pub on pub.id = bp.profile_id
  where public.current_blog_role() = 'admin'
  order by bp.created_at desc;
$function$;

create or replace function public.grant_blog_permission(p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid;
  v_role text := lower(btrim(p_role));
begin
  if public.current_blog_role() <> 'admin' then
    raise exception 'Only blog admins can manage blog access.';
  end if;

  if v_role not in ('contributor', 'editor', 'admin') then
    raise exception 'Invalid blog role.';
  end if;

  select pp.id
  into v_profile_id
  from public.profiles_private pp
  where lower(pp.email) = lower(btrim(p_email))
  limit 1;

  if v_profile_id is null then
    raise exception 'No user found for that email. Ask them to create an account first.';
  end if;

  insert into public.blog_permissions (profile_id, role)
  values (v_profile_id, v_role)
  on conflict (profile_id) do update
    set role = excluded.role,
        updated_at = now();

  return format('Granted %s blog access to %s.', v_role, p_email);
end;
$function$;

alter table public.blog_permissions enable row level security;
alter table public.blog_posts enable row level security;

drop policy if exists blog_permissions_select_self_or_admin on public.blog_permissions;
create policy blog_permissions_select_self_or_admin
on public.blog_permissions
for select
to authenticated
using (profile_id = auth.uid() or public.current_blog_role() = 'admin');

drop policy if exists blog_permissions_admin_write on public.blog_permissions;
create policy blog_permissions_admin_write
on public.blog_permissions
for all
to authenticated
using (public.current_blog_role() = 'admin')
with check (public.current_blog_role() = 'admin');

drop policy if exists blog_posts_public_read_published on public.blog_posts;
create policy blog_posts_public_read_published
on public.blog_posts
for select
to anon, authenticated
using (status = 'published');

drop policy if exists blog_posts_staff_read on public.blog_posts;
create policy blog_posts_staff_read
on public.blog_posts
for select
to authenticated
using (
  public.current_blog_role() in ('admin', 'editor')
  or author_id = auth.uid()
);

drop policy if exists blog_posts_staff_insert on public.blog_posts;
create policy blog_posts_staff_insert
on public.blog_posts
for insert
to authenticated
with check (
  public.current_blog_role() in ('admin', 'editor', 'contributor')
  and author_id = auth.uid()
  and (
    public.current_blog_role() in ('admin', 'editor')
    or status = 'draft'
  )
);

drop policy if exists blog_posts_staff_update on public.blog_posts;
create policy blog_posts_staff_update
on public.blog_posts
for update
to authenticated
using (
  public.current_blog_role() in ('admin', 'editor')
  or (author_id = auth.uid() and status = 'draft')
)
with check (
  public.current_blog_role() in ('admin', 'editor')
  or (author_id = auth.uid() and status = 'draft')
);

drop policy if exists blog_posts_editor_delete on public.blog_posts;
create policy blog_posts_editor_delete
on public.blog_posts
for delete
to authenticated
using (public.current_blog_role() in ('admin', 'editor'));

grant execute on function public.current_blog_role() to anon, authenticated;
grant execute on function public.can_manage_blog() to authenticated;
grant execute on function public.blog_permission_overview() to authenticated;
grant execute on function public.grant_blog_permission(text, text) to authenticated;

commit;
