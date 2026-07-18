begin;

create table if not exists public.app_event_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  severity text not null default 'error' check (severity in ('info', 'warning', 'error')),
  source text not null default 'client' check (source in ('client', 'server', 'cron')),
  route text,
  pool_id uuid references public.pools(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  message text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_app_event_logs_created_at
on public.app_event_logs (created_at desc);

create index if not exists idx_app_event_logs_type_created
on public.app_event_logs (event_type, created_at desc);

create index if not exists idx_app_event_logs_pool_created
on public.app_event_logs (pool_id, created_at desc)
where pool_id is not null;

alter table public.app_event_logs enable row level security;

drop policy if exists app_event_logs_service_role_all on public.app_event_logs;
create policy app_event_logs_service_role_all
on public.app_event_logs
for all
to service_role
using (true)
with check (true);

create or replace function public.superadmin_app_event_logs(p_limit integer default 100)
returns table (
  id uuid,
  created_at timestamptz,
  event_type text,
  severity text,
  source text,
  route text,
  pool_id uuid,
  user_id uuid,
  message text,
  metadata jsonb
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'not authorized';
  end if;

  return query
  select
    l.id,
    l.created_at,
    l.event_type,
    l.severity,
    l.source,
    l.route,
    l.pool_id,
    l.user_id,
    l.message,
    l.metadata
  from public.app_event_logs l
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;

revoke execute on function public.superadmin_app_event_logs(integer) from public, anon;
grant execute on function public.superadmin_app_event_logs(integer) to authenticated, service_role;

commit;

