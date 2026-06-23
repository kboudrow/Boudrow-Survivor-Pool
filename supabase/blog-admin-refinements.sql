begin;

insert into storage.buckets (id, name, public)
values ('blog-images', 'blog-images', true)
on conflict (id) do update set public = excluded.public;

update public.blog_posts
set category = case
  when category in ('Commissioner Guides', 'Rules & Settings', 'Survivor Strategy', 'Templates', 'Product Updates') then 'Survivor Pools'
  when category = 'NFL Guide' then 'NFL'
  else category
end
where category in ('Commissioner Guides', 'Rules & Settings', 'Survivor Strategy', 'Templates', 'Product Updates', 'NFL Guide');

drop policy if exists blog_images_public_read on storage.objects;
drop policy if exists blog_images_staff_insert on storage.objects;
drop policy if exists blog_images_staff_update on storage.objects;
drop policy if exists blog_images_staff_delete on storage.objects;

create policy blog_images_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'blog-images');

create policy blog_images_staff_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'blog-images'
  and public.current_blog_role() in ('admin', 'editor', 'contributor')
);

create policy blog_images_staff_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'blog-images'
  and public.current_blog_role() in ('admin', 'editor', 'contributor')
)
with check (
  bucket_id = 'blog-images'
  and public.current_blog_role() in ('admin', 'editor', 'contributor')
);

create policy blog_images_staff_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'blog-images'
  and public.current_blog_role() = 'admin'
);

create or replace function public.grant_blog_permission(p_email text, p_role text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile_id uuid;
begin
  if lower(coalesce(auth.jwt() ->> 'email', '')) <> 'survivesunday1@gmail.com' then
    raise exception 'Only the Survive Sunday superadmin can manage blog access.';
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
  values (v_profile_id, 'contributor')
  on conflict (profile_id) do update
    set role = 'contributor',
        updated_at = now();

  return format('Added %s as a blog contributor.', p_email);
end;
$function$;

commit;
