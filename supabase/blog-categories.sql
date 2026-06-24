begin;

create table if not exists public.blog_categories (
  name text primary key,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

insert into public.blog_categories (name, sort_order)
values
  ('Survivor Pools', 10),
  ('NFL', 20),
  ('NBA', 30),
  ('MLB', 40),
  ('NHL', 50),
  ('PGA', 60),
  ('Other Sports', 100)
on conflict (name) do update
  set sort_order = excluded.sort_order;

alter table public.blog_categories enable row level security;

drop policy if exists blog_categories_public_read on public.blog_categories;
create policy blog_categories_public_read
on public.blog_categories
for select
to anon, authenticated
using (true);

drop policy if exists blog_categories_superadmin_insert on public.blog_categories;
create policy blog_categories_superadmin_insert
on public.blog_categories
for insert
to authenticated
with check (public.is_blog_superadmin());

drop policy if exists blog_categories_superadmin_update on public.blog_categories;
create policy blog_categories_superadmin_update
on public.blog_categories
for update
to authenticated
using (public.is_blog_superadmin())
with check (public.is_blog_superadmin());

drop policy if exists blog_categories_superadmin_delete on public.blog_categories;
create policy blog_categories_superadmin_delete
on public.blog_categories
for delete
to authenticated
using (public.is_blog_superadmin());

commit;
