begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pool-images',
  'pool-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pool_images_authenticated_insert on storage.objects;
drop policy if exists pool_images_owner_update on storage.objects;
drop policy if exists pool_images_scoped_insert on storage.objects;
drop policy if exists pool_images_scoped_update on storage.objects;
drop policy if exists pool_images_scoped_delete on storage.objects;

create policy pool_images_scoped_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'pool-images'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

create policy pool_images_scoped_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'pool-images'
  and (
    owner = auth.uid()
    or split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
)
with check (
  bucket_id = 'pool-images'
  and (
    split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

create policy pool_images_scoped_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'pool-images'
  and (
    owner = auth.uid()
    or split_part(name, '/', 1) = auth.uid()::text
    or (
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.admin_can_manage(split_part(name, '/', 1)::uuid)
    )
  )
);

commit;
