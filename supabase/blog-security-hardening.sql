begin;

create or replace function public.is_blog_superadmin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = 'survivesunday1@gmail.com';
$function$;

create or replace function public.current_blog_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when public.is_blog_superadmin() then 'admin'
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
  where public.is_blog_superadmin()
  order by bp.created_at desc;
$function$;

drop policy if exists blog_permissions_select_self_or_admin on public.blog_permissions;
create policy blog_permissions_select_self_or_superadmin
on public.blog_permissions
for select
to authenticated
using (profile_id = auth.uid() or public.is_blog_superadmin());

drop policy if exists blog_permissions_admin_write on public.blog_permissions;
create policy blog_permissions_superadmin_write
on public.blog_permissions
for all
to authenticated
using (public.is_blog_superadmin())
with check (public.is_blog_superadmin());

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
  public.is_blog_superadmin()
  or author_id = auth.uid()
);

drop policy if exists blog_posts_staff_insert on public.blog_posts;
create policy blog_posts_staff_insert
on public.blog_posts
for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    public.is_blog_superadmin()
    or (
      public.current_blog_role() in ('admin', 'editor', 'contributor')
      and status = 'draft'
    )
  )
);

drop policy if exists blog_posts_staff_update on public.blog_posts;
create policy blog_posts_staff_update
on public.blog_posts
for update
to authenticated
using (
  public.is_blog_superadmin()
  or (author_id = auth.uid() and status = 'draft')
)
with check (
  public.is_blog_superadmin()
  or (author_id = auth.uid() and status = 'draft')
);

drop policy if exists blog_posts_editor_delete on public.blog_posts;
create policy blog_posts_superadmin_delete
on public.blog_posts
for delete
to authenticated
using (public.is_blog_superadmin());

drop policy if exists blog_images_staff_delete on storage.objects;
create policy blog_images_superadmin_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'blog-images'
  and public.is_blog_superadmin()
);

grant execute on function public.is_blog_superadmin() to anon, authenticated;
grant execute on function public.current_blog_role() to anon, authenticated;
grant execute on function public.blog_permission_overview() to authenticated;

commit;
