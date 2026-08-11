begin;

-- The application performs competitive and account writes through validated
-- RPCs. Browser roles only need table SELECT privileges; RLS remains the row
-- visibility boundary. In particular, TRUNCATE is not protected by RLS.
revoke insert, update, delete, truncate, references, trigger, maintain
  on all tables in schema public from anon, authenticated;

-- Browser requests never allocate sequence values directly because all writes
-- run through SECURITY DEFINER RPCs or service-role server jobs.
revoke usage, select, update
  on all sequences in schema public from anon, authenticated;

-- Supabase's legacy defaults granted every future public object to browser
-- roles. Make future migrations opt in explicitly to the minimum access they
-- require instead of silently exposing new tables, sequences, or functions.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Trigger functions are implementation details and must never be callable as
-- RPC endpoints. Existing user-facing RPC grants are intentionally preserved.
do $revoke_trigger_function_execution$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'pg_catalog.trigger'::regtype
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      v_function
    );
  end loop;
end;
$revoke_trigger_function_execution$;

commit;
