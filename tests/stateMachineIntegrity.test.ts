import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('pool, entry, standings, and grace lifecycles have database constraints', async () => {
  const migration = await read('supabase/migrations/20260810002400_survivor_state_machine_integrity.sql')
  const weekBounds = await read('supabase/migrations/20260810002500_survivor_lifecycle_week_bounds.sql')
  assert.match(migration, /pools_legacy_rules_sync_check/)
  assert.match(migration, /pools_archive_state_check/)
  assert.match(migration, /pools_activation_metadata_check/)
  assert.match(migration, /pool_members_elimination_state_check/)
  assert.match(migration, /pool_member_stats_nonnegative_check/)
  assert.match(migration, /pool_member_stats_elimination_state_check/)
  assert.match(migration, /foreign key \(pool_id, entry_id\)[\s\S]*references public\.pool_members\(pool_id, id\)/i)
  assert.match(weekBounds, /strikes_used = losses/)
  assert.match(weekBounds, /guard_entry_elimination_week/)
  assert.match(weekBounds, /guard_survival_grace_week/)
})

test('entry capacity is serialized and enforced below the UI layer', async () => {
  const migration = await read('supabase/migrations/20260810002400_survivor_state_machine_integrity.sql')
  assert.match(migration, /from public\.pools where id = new\.pool_id for update/i)
  assert.match(migration, /v_pool_count >= v_pool\.max_members/)
  assert.match(migration, /v_owner_count >= v_pool\.max_entries_per_user/)
  assert.match(migration, /entry identity and ownership cannot be changed/i)
  assert.match(migration, /entry limit cannot be lower than an existing user/i)
})

test('final picks enforce entry ownership, playable slots, adjudication, and phase-scoped team reuse', async () => {
  const migration = await read('supabase/migrations/20260810002400_survivor_state_machine_integrity.sql')
  assert.match(migration, /guard_pool_final_pick_integrity/)
  assert.match(migration, /Final pick entry ownership is invalid/)
  assert.match(migration, /public\.picks_allowed\(new\.pool_id, new\.week\)/)
  assert.match(migration, /A graded pick must include its adjudication time/)
  assert.match(migration, /public\.pool_pick_phase\(pick\.week\) = public\.pool_pick_phase\(new\.week\)/)
  assert.match(migration, /public\.pool_pick_phase\(pick\.week\) = public\.pool_pick_phase\(p_week\)/)
})

test('adversarial SQL fixtures attempt the high-risk invalid states', async () => {
  const sql = await read('supabase/tests/survivor_state_machine_integrity.sql')
  assert.match(sql, /invalid start week was accepted/)
  assert.match(sql, /duplicate double-pick weeks were accepted/)
  assert.match(sql, /pool capacity was exceeded/)
  assert.match(sql, /pick with contradictory ownership was accepted/)
  assert.match(sql, /regular-season team reuse was accepted/)
  assert.match(sql, /Reuse across the regular-season\/postseason boundary is the one intended exception/)
  assert.match(sql, /negative standings totals were accepted/)
  assert.match(sql, /cross-pool survival grace was accepted/)
  assert.match(sql, /elimination before pool start was accepted/)
  assert.match(sql, /survival grace before pool start was accepted/)
})

test('retired gameplay tables cannot accept a competing client-written ledger', async () => {
  const migration = await read('supabase/migrations/20260810002400_survivor_state_machine_integrity.sql')
  assert.match(migration, /drop policy if exists entries_insert_self_and_member/)
  assert.match(migration, /drop policy if exists picks_insert_entry_owner/)
  assert.match(migration, /revoke insert, update, delete on public\.entries, public\.picks from anon, authenticated/)
})
