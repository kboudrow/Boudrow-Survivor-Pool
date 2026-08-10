-- Remove superseded user-scoped commissioner functions, close implicit
-- SECURITY DEFINER execution grants, and preserve RLS semantics while making
-- auth lookups evaluate once per statement instead of once per row.

drop function if exists public.admin_clear_user_week_drafts(uuid, uuid, integer, text);
drop function if exists public.admin_clear_user_week_draft_slot(uuid, uuid, integer, integer, text);
drop function if exists public.admin_upsert_user_draft(uuid, uuid, integer, text, integer, text);
drop function if exists public.admin_override_final_pick(uuid, uuid, integer, text, text);
drop function if exists public.admin_override_final_pick(uuid, uuid, integer, text, text, integer);
drop function if exists public.admin_pool_week_overview(uuid, integer);

-- PostgreSQL grants EXECUTE to PUBLIC by default for newly created functions.
-- Keep every existing explicit anon/authenticated/service_role grant, but
-- remove that broad implicit grant from all SECURITY DEFINER functions.
do $cleanup_public_function_grants$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', v_function);
  end loop;
end;
$cleanup_public_function_grants$;

alter function public.pool_pick_phase(integer) set search_path = public, pg_temp;

-- Supabase exposes extensions through this schema by convention. No app query
-- uses pg_trgm names directly, and extension object OIDs remain stable.
do $move_pg_trgm$
begin
  if exists (select 1 from pg_extension where extname = 'pg_trgm')
     and exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'alter extension pg_trgm set schema extensions';
  end if;
end;
$move_pg_trgm$;

-- Public buckets do not require an object SELECT policy to serve a known public
-- URL. Removing this policy prevents anonymous users from listing every avatar.
drop policy if exists avatars_public_read on storage.objects;

-- Rewrite only the auth.uid() call shape in existing policies. Policy names,
-- roles, commands, and all other authorization conditions remain unchanged.
do $optimize_auth_uid_policies$
declare
  v_policy record;
  v_using text;
  v_check text;
begin
  for v_policy in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (
        coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.uid()%'
      )
  loop
    v_using := v_policy.qual;
    v_check := v_policy.with_check;

    if v_using is not null then
      v_using := replace(v_using, '( SELECT auth.uid() AS uid)', '__AUTH_UID_ONCE__');
      v_using := replace(v_using, '( SELECT auth.uid())', '__AUTH_UID_ONCE__');
      v_using := replace(v_using, 'auth.uid()', '(select auth.uid())');
      v_using := replace(v_using, '__AUTH_UID_ONCE__', '(select auth.uid())');
      execute format(
        'alter policy %I on %I.%I using (%s)',
        v_policy.policyname,
        v_policy.schemaname,
        v_policy.tablename,
        v_using
      );
    end if;

    if v_check is not null then
      v_check := replace(v_check, '( SELECT auth.uid() AS uid)', '__AUTH_UID_ONCE__');
      v_check := replace(v_check, '( SELECT auth.uid())', '__AUTH_UID_ONCE__');
      v_check := replace(v_check, 'auth.uid()', '(select auth.uid())');
      v_check := replace(v_check, '__AUTH_UID_ONCE__', '(select auth.uid())');
      execute format(
        'alter policy %I on %I.%I with check (%s)',
        v_policy.policyname,
        v_policy.schemaname,
        v_policy.tablename,
        v_check
      );
    end if;
  end loop;
end;
$optimize_auth_uid_policies$;
