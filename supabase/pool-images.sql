alter table public.pools
add column if not exists image_url text;

alter table public.profiles
add column if not exists favorite_team text;

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

drop policy if exists pool_images_public_read on storage.objects;
create policy pool_images_public_read
on storage.objects
for select
using (bucket_id = 'pool-images');

drop policy if exists pool_images_authenticated_insert on storage.objects;
create policy pool_images_authenticated_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'pool-images');

drop policy if exists pool_images_owner_update on storage.objects;
create policy pool_images_owner_update
on storage.objects
for update
to authenticated
using (bucket_id = 'pool-images' and owner = auth.uid())
with check (bucket_id = 'pool-images' and owner = auth.uid());

create or replace function public.admin_update_pool_image(
  p_pool_id uuid,
  p_image_url text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_can_manage(p_pool_id) then
    raise exception 'not authorized';
  end if;

  update public.pools
  set image_url = nullif(trim(p_image_url), '')
  where id = p_pool_id;
end;
$function$;
