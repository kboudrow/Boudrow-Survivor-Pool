import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('legacy user-scoped commissioner pick functions are removed', async () => {
  const migration = await read('supabase/migrations/20260810002200_legacy_database_policy_cleanup.sql')
  assert.match(migration, /drop function if exists public\.admin_upsert_user_draft/i)
  assert.match(migration, /drop function if exists public\.admin_override_final_pick/i)
  assert.match(migration, /drop function if exists public\.admin_pool_week_overview/i)
  assert.doesNotMatch(await read('app/pools/[poolId]/admin/page.tsx'), /admin_(?:upsert_user_draft|override_final_pick|pool_week_overview)/)
})

test('security-definer grants and avatar listing are hardened without removing explicit role grants', async () => {
  const migration = await read('supabase/migrations/20260810002200_legacy_database_policy_cleanup.sql')
  assert.match(migration, /where n\.nspname = 'public'[\s\S]*and p\.prosecdef/i)
  assert.match(migration, /revoke execute on function %s from public/i)
  assert.match(migration, /drop policy if exists avatars_public_read on storage\.objects/i)
  assert.doesNotMatch(migration, /revoke execute on function %s from anon/i)
  assert.doesNotMatch(migration, /revoke execute on function %s from authenticated/i)
})

test('RLS auth lookups are optimized while policy authorization expressions are preserved', async () => {
  const migration = await read('supabase/migrations/20260810002200_legacy_database_policy_cleanup.sql')
  assert.match(migration, /select schemaname, tablename, policyname, qual, with_check[\s\S]*from pg_policies/i)
  assert.match(migration, /replace\(v_using, 'auth\.uid\(\)', '\(select auth\.uid\(\)\)'\)/i)
  assert.match(migration, /alter policy %I on %I\.%I using \(%s\)/i)
  assert.match(migration, /alter policy %I on %I\.%I with check \(%s\)/i)
})

test('public blog data uses the Next data cache and avoids a redundant slug query', async () => {
  const blogDb = await read('lib/blogDb.ts')
  assert.match(blogDb, /unstable_cache/)
  assert.match(blogDb, /public-blog-posts-v2/)
  assert.match(blogDb, /public-blog-categories-v2/)
  assert.match(blogDb, /public-blog-post-v2/)
  assert.doesNotMatch(blogDb, /getDatabaseBlogSlugs/)
  assert.doesNotMatch(blogDb, /publicPostsCache/)
})

test('anonymous privileged functions are reduced to an explicit public-read allowlist', async () => {
  const migration = await read('supabase/migrations/20260810002300_database_advisor_followup.sql')
  assert.match(migration, /has_function_privilege\('anon', p\.oid, 'execute'\)/i)
  assert.match(migration, /revoke execute on function %s from anon/i)
  assert.match(migration, /'get_pool_invite'/)
  assert.match(migration, /'search_pools'/)
  assert.match(migration, /'username_available'/)
})

test('overlapping policies are consolidated without weakening pool or profile privacy', async () => {
  const migration = await read('supabase/migrations/20260810002300_database_advisor_followup.sql')
  assert.match(migration, /create policy pools_select_authenticated[\s\S]*public\.is_pool_member\(id\)[\s\S]*public\.admin_can_manage\(id\)/i)
  assert.match(migration, /drop policy if exists profiles_read_all/i)
  assert.match(migration, /create policy profiles_select_self_or_shared_pool[\s\S]*pm_other\.profile_id = profiles\.id/i)
  assert.match(migration, /create policy picks_insert_entry_owner/i)
  assert.match(migration, /create policy picks_update_entry_owner/i)
  assert.match(migration, /create policy picks_delete_entry_owner/i)
})

test('duplicate secondary indexes are removed while primary indexes are preserved', async () => {
  const migration = await read('supabase/migrations/20260810002300_database_advisor_followup.sql')
  assert.match(migration, /drop index if exists public\.idx_pool_member_stats_entry/i)
  assert.match(migration, /drop index if exists public\.idx_pool_pick_drafts_entry_week/i)
  assert.match(migration, /drop index if exists public\.idx_pool_picks_entry_week/i)
  assert.doesNotMatch(migration, /drop index[^;]*_pkey/i)
})
