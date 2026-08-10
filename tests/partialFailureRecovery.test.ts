import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('pool and entry creation persist idempotency results in the write transaction', async () => {
  const migration = await read('supabase/migrations/20260810003100_idempotent_creation_operations.sql')
  assert.match(migration, /primary key \(user_id, operation_type, operation_id\)/)
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*:create_pool:/)
  assert.match(migration, /create_pool_with_owner[\s\S]*insert into public\.user_operation_results/)
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*:add_pool_entry:/)
  assert.match(migration, /add_pool_entry\(p_pool_id\)[\s\S]*insert into public\.user_operation_results/)
})

test('pool creation survives refresh and preserves non-secret form state', async () => {
  const page = await read('app/pools/new/page.tsx')
  assert.match(page, /CREATE_POOL_DRAFT_KEY/)
  assert.match(page, /CREATE_POOL_OPERATION_KEY/)
  assert.match(page, /my_operation_result/)
  assert.match(page, /create_pool_with_owner_idempotent/)
  assert.match(page, /same pool will not be created twice/i)
  assert.doesNotMatch(page, /SavedPoolDraft[\s\S]{0,700}password:/)
})

test('joining verifies membership after an ambiguous response on every join route', async () => {
  const [helper, invite, search, publicPool] = await Promise.all([
    read('lib/writeReconciliation.ts'),
    read('app/join/[poolId]/page.tsx'),
    read('app/join/search/page.tsx'),
    read('app/pools/[poolId]/page.tsx'),
  ])
  assert.match(helper, /pool_members[\s\S]*profile_id/)
  for (const page of [invite, search, publicPool]) {
    assert.match(page, /currentUserHasPoolMembership/)
    assert.match(page, /could not confirm membership/i)
  }
})

test('settings, removals, and commissioner picks reconcile database truth', async () => {
  const [dashboard, commissioner, superadmin] = await Promise.all([
    read('app/pools/page.tsx'),
    read('app/pools/[poolId]/admin/page.tsx'),
    read('app/admin/page.tsx'),
  ])
  assert.match(dashboard, /add_pool_entry_idempotent/)
  assert.match(dashboard, /server returned an unexpected response while adding the entry/i)
  assert.match(dashboard, /Entry removal not confirmed/)
  assert.match(commissioner, /confirmPoolSettings/)
  assert.match(commissioner, /confirmed after the delayed response/g)
  assert.match(commissioner, /pool_pick_drafts[\s\S]*pool_picks[\s\S]*confirmed in the database/)
  assert.match(commissioner, /current database state has been refreshed/i)
  assert.match(superadmin, /removed and confirmed in the database/i)
})
