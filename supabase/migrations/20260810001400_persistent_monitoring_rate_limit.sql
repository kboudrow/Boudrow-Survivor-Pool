create table if not exists public.monitoring_rate_limit_buckets(
  fingerprint text not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check(request_count>0),
  updated_at timestamptz not null default now(),
  primary key(fingerprint,bucket_start)
);

alter table public.monitoring_rate_limit_buckets enable row level security;
revoke all on table public.monitoring_rate_limit_buckets from public,anon,authenticated;
grant select,insert,update,delete on table public.monitoring_rate_limit_buckets to service_role;

create or replace function public.consume_monitoring_rate_limit(
  p_fingerprint text,p_limit integer default 30,p_window_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fingerprint text:=lower(btrim(coalesce(p_fingerprint,'')));
  v_limit integer:=least(greatest(coalesce(p_limit,30),1),300);
  v_window integer:=least(greatest(coalesce(p_window_seconds,60),10),3600);
  v_bucket timestamptz;
  v_count integer;
begin
  if v_fingerprint!~'^[a-f0-9]{64}$' then raise exception 'Invalid monitoring fingerprint.'; end if;
  v_bucket:=date_bin(make_interval(secs=>v_window),clock_timestamp(),timestamptz '2020-01-01 00:00:00+00');
  insert into public.monitoring_rate_limit_buckets(fingerprint,bucket_start,request_count,updated_at)
  values(v_fingerprint,v_bucket,1,now())
  on conflict(fingerprint,bucket_start) do update
    set request_count=public.monitoring_rate_limit_buckets.request_count+1,updated_at=now()
  returning request_count into v_count;
  if random()<0.02 then delete from public.monitoring_rate_limit_buckets where bucket_start<now()-interval '2 days'; end if;
  return v_count<=v_limit;
end;
$function$;

revoke execute on function public.consume_monitoring_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_monitoring_rate_limit(text,integer,integer) to service_role;
