-- Use Supabase's database scheduler for deadline-sensitive production jobs.
-- The HTTP authorization secret is read at execution time from Supabase Vault;
-- it is never stored in this migration or in cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from vault.secrets
    where name = 'survive_sunday_app_url'
  ) then
    perform vault.create_secret(
      'https://www.survivesunday.com',
      'survive_sunday_app_url',
      'Production origin used by Supabase Cron.'
    );
  end if;
end;
$$;

create or replace function private.invoke_survive_sunday_cron(p_path text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_base_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  if p_path not in ('/api/cron/lock-picks', '/api/cron/sync-scores') then
    raise exception 'Unsupported Survive Sunday cron path.';
  end if;

  select decrypted_secret
  into v_base_url
  from vault.decrypted_secrets
  where name = 'survive_sunday_app_url'
  limit 1;

  select decrypted_secret
  into v_cron_secret
  from vault.decrypted_secrets
  where name = 'survive_sunday_cron_secret'
  limit 1;

  if v_base_url is null or v_base_url !~ '^https://[^/]+/?$' then
    raise warning 'Supabase Vault secret survive_sunday_app_url is missing or invalid; cron call skipped.';
    return null;
  end if;

  if v_cron_secret is null or length(v_cron_secret) < 16 then
    raise warning 'Supabase Vault secret survive_sunday_cron_secret is missing or invalid; cron call skipped.';
    return null;
  end if;

  select net.http_get(
    url := rtrim(v_base_url, '/') || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Accept', 'application/json',
      'User-Agent', 'Survive-Sunday-Supabase-Cron/1.0'
    ),
    timeout_milliseconds := 55000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.invoke_survive_sunday_cron(text) from public, anon, authenticated;

do $$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid
    from cron.job
    where jobname in ('survive-sunday-lock-picks', 'survive-sunday-sync-scores')
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  -- Offset this job from score sync so the two routes do not start together.
  perform cron.schedule(
    'survive-sunday-lock-picks',
    '2-59/5 * * * *',
    $job$select private.invoke_survive_sunday_cron('/api/cron/lock-picks');$job$
  );

  perform cron.schedule(
    'survive-sunday-sync-scores',
    '*/10 * * * *',
    $job$select private.invoke_survive_sunday_cron('/api/cron/sync-scores');$job$
  );
end;
$$;

comment on function private.invoke_survive_sunday_cron(text) is
  'Queues an authorized call to an allow-listed Survive Sunday maintenance route using secrets stored in Supabase Vault.';
