import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('entry ownership is enforced by composite database foreign keys', async () => {
  const migration = await read('supabase/migrations/20260810001500_multiple_entry_integrity.sql')
  for (const table of ['pool_pick_drafts', 'pool_picks', 'pool_member_stats']) {
    assert.match(migration, new RegExp(`alter table public\\.${table}[\\s\\S]*foreign key \\(pool_id, entry_id, user_id\\)`, 'i'))
  }
  assert.match(migration, /references public\.pool_members \(pool_id, id, profile_id\)/i)
})

test('private pick RLS derives ownership from the entry', async () => {
  const migration = await read('supabase/migrations/20260810001500_multiple_entry_integrity.sql')
  const draftPolicy = migration.slice(migration.indexOf('create policy pool_pick_drafts_select_own_or_admin'), migration.indexOf('drop policy if exists pool_picks_select_own_or_admin'))
  const pickPolicy = migration.slice(migration.indexOf('create policy pool_picks_select_own_or_admin'), migration.indexOf('create or replace function public.count_pool_entries'))
  for (const policy of [draftPolicy, pickPolicy]) {
    assert.match(policy, /pm\.id = .*\.entry_id/i)
    assert.match(policy, /pm\.profile_id = auth\.uid\(\)/i)
    assert.doesNotMatch(policy, /user_id = auth\.uid\(\)/i)
  }
})

test('join screens use entry count for entry-based capacity and display both counts', async () => {
  const [invite, search] = await Promise.all([
    read('app/join/[poolId]/page.tsx'),
    read('app/join/search/page.tsx'),
  ])
  assert.match(invite, /!isUnlimitedPoolCapacity\(pool\.max_members\)/)
  assert.match(search, /!isUnlimitedPoolCapacity\(selected\.max_members\)/)
  assert.match(invite, /label="Members"/)
  assert.match(invite, /label="Entries"/)
  assert.match(search, /count_pool_entries/)
})

test('entry removal is scoped to entry id and preserves other entries', async () => {
  const migration = await read('supabase/migrations/20260810001500_multiple_entry_integrity.sql')
  const selfRemoval = migration.slice(migration.indexOf('create or replace function public.remove_pool_entry'), migration.indexOf('create or replace function public.admin_remove_pool_entry'))
  const adminRemoval = migration.slice(migration.indexOf('create or replace function public.admin_remove_pool_entry'))
  assert.match(selfRemoval, /v_entry\.profile_id <> auth\.uid\(\)/)
  assert.match(selfRemoval, /if v_entry_count <= 1/)
  assert.match(selfRemoval, /delete from public\.pool_members where id = p_entry_id and pool_id = p_pool_id/)
  assert.match(adminRemoval, /delete from public\.pool_members where id = p_entry_id and pool_id = p_pool_id/)
  assert.doesNotMatch(adminRemoval, /delete from public\.pool_members[\s\S]*profile_id = v_entry\.profile_id/)
})

test('dashboard restores a valid selected entry and scopes labels by entry', async () => {
  const page = await read('app/pools/page.tsx')
  assert.match(page, /selectedEntryStorageKey/)
  assert.match(page, /entries\.find\(\(entry\) => entry\.id === storedEntryId\)/)
  assert.match(page, /entry_name\?\.trim\(\)/)
  assert.match(page, /rpc\('remove_pool_entry'/)
})
