begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pool-images',
  'pool-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
