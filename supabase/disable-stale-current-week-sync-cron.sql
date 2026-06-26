-- Disable the old nightly current-week sync until it is rewritten to be
-- explicit about the target NFL season. It was pulling 2025 ESPN games and
-- writing them under season 2026 at 08:00 UTC.

do $$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'sync-current-week-nightly';

  if v_job_id is not null then
    perform cron.alter_job(v_job_id, active := false);
  end if;
end $$;
