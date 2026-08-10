begin;

-- A browser can lose the HTTP response after PostgreSQL commits. Persist the
-- result in the same transaction as the write so a retry with the same key
-- returns the original pool/entry instead of creating another one.
create table if not exists public.user_operation_results (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_type text not null check (operation_type in ('create_pool', 'add_pool_entry')),
  operation_id uuid not null,
  result_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_type, operation_id)
);

alter table public.user_operation_results enable row level security;
revoke all on table public.user_operation_results from public, anon, authenticated;

create or replace function public.my_operation_result(
  p_operation_type text,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
stable
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result uuid;
begin
  if v_user_id is null then raise exception 'Please sign in to continue.'; end if;
  if p_operation_type not in ('create_pool', 'add_pool_entry') then
    raise exception 'Unknown operation type.';
  end if;
  if p_operation_id is null then raise exception 'Operation ID is required.'; end if;

  select r.result_id into v_result
  from public.user_operation_results r
  where r.user_id = v_user_id
    and r.operation_type = p_operation_type
    and r.operation_id = p_operation_id;
  return v_result;
end;
$function$;

create or replace function public.create_pool_with_owner_idempotent(
  p_operation_id uuid,
  p_name text,
  p_is_public boolean default true,
  p_password text default null,
  p_start_week integer default 1,
  p_include_playoffs boolean default false,
  p_strikes_allowed text default '0',
  p_tie_rule text default 'loss',
  p_deadline_mode text default 'fixed',
  p_deadline_fixed text default '13:00',
  p_notes text default null,
  p_image_url text default null,
  p_season integer default 2026,
  p_double_pick_weeks integer[] default '{}',
  p_max_members integer default null,
  p_allow_multiple_entries boolean default false,
  p_max_entries_per_user integer default 1
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result uuid;
begin
  if v_user_id is null then raise exception 'Please sign in to continue.'; end if;
  if p_operation_id is null then raise exception 'Operation ID is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':create_pool:' || p_operation_id::text, 0
  ));

  select r.result_id into v_result
  from public.user_operation_results r
  where r.user_id = v_user_id
    and r.operation_type = 'create_pool'
    and r.operation_id = p_operation_id;
  if v_result is not null then return v_result; end if;

  v_result := public.create_pool_with_owner(
    p_name, p_is_public, p_password, p_start_week, p_include_playoffs,
    p_strikes_allowed, p_tie_rule, p_deadline_mode, p_deadline_fixed,
    p_notes, p_image_url, p_season, p_double_pick_weeks, p_max_members,
    p_allow_multiple_entries, p_max_entries_per_user
  );
  if v_result is null then raise exception 'Pool creation returned no pool.'; end if;

  insert into public.user_operation_results(user_id, operation_type, operation_id, result_id)
  values (v_user_id, 'create_pool', p_operation_id, v_result);
  return v_result;
end;
$function$;

create or replace function public.add_pool_entry_idempotent(
  p_pool_id uuid,
  p_operation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result uuid;
begin
  if v_user_id is null then raise exception 'Please sign in to continue.'; end if;
  if p_operation_id is null then raise exception 'Operation ID is required.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_user_id::text || ':add_pool_entry:' || p_operation_id::text, 0
  ));

  select r.result_id into v_result
  from public.user_operation_results r
  where r.user_id = v_user_id
    and r.operation_type = 'add_pool_entry'
    and r.operation_id = p_operation_id;
  if v_result is not null then return v_result; end if;

  v_result := public.add_pool_entry(p_pool_id);
  if v_result is null then raise exception 'Entry creation returned no entry.'; end if;

  insert into public.user_operation_results(user_id, operation_type, operation_id, result_id)
  values (v_user_id, 'add_pool_entry', p_operation_id, v_result);
  return v_result;
end;
$function$;

revoke all on function public.my_operation_result(text, uuid) from public, anon;
revoke all on function public.create_pool_with_owner_idempotent(uuid,text,boolean,text,integer,boolean,text,text,text,text,text,text,integer,integer[],integer,boolean,integer) from public, anon;
revoke all on function public.add_pool_entry_idempotent(uuid, uuid) from public, anon;
grant execute on function public.my_operation_result(text, uuid) to authenticated, service_role;
grant execute on function public.create_pool_with_owner_idempotent(uuid,text,boolean,text,integer,boolean,text,text,text,text,text,text,integer,integer[],integer,boolean,integer) to authenticated, service_role;
grant execute on function public.add_pool_entry_idempotent(uuid, uuid) to authenticated, service_role;

commit;
