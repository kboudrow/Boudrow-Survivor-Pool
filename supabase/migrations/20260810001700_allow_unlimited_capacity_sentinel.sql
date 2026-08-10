begin;

alter table public.pools drop constraint if exists pools_max_members_check;
alter table public.pools
  add constraint pools_max_members_check
  check (max_members between 2 and 500 or max_members = 2147483647);

commit;
