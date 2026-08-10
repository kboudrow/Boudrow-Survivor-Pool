import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('deadline finalization uses the exact same per-entry lock key as pick writes', async () => {
  const [pickLocks, workflowLocks] = await Promise.all([
    read('supabase/migrations/20260810000800_serialize_pick_rpcs.sql'),
    read('supabase/migrations/20260810002900_concurrent_pool_workflow_serialization.sql'),
  ])
  const lockExpression = /hashtextextended\(p_pool_id::text \|\| ':' \|\| p_entry_id::text, 0\)/
  assert.match(pickLocks, lockExpression)
  assert.match(workflowLocks, lockExpression)
  assert.match(workflowLocks, /finalize_locked_picks[\s\S]*acquire_all_pool_entry_pick_locks/)
  assert.match(workflowLocks, /finalize_no_pick_losses[\s\S]*acquire_all_pool_entry_pick_locks/)
})

test('scoring, rebuilding, corrections, and duplicate jobs share a pool transaction lock', async () => {
  const migration = await read('supabase/migrations/20260810002900_concurrent_pool_workflow_serialization.sql')
  assert.match(migration, /hashtextextended\('pool-workflow:' \|\| p_pool_id::text, 0\)/)
  assert.match(migration, /create or replace function public\.rebuild_pool_member_stats[\s\S]*acquire_pool_workflow_lock/)
  assert.match(migration, /create or replace function public\.adjudicate_results[\s\S]*order by p\.id[\s\S]*acquire_pool_workflow_lock/)
  assert.match(migration, /create or replace function public\.admin_override_entry_final_pick[\s\S]*order by p\.id/)
  assert.match(migration, /create or replace function public\.superadmin_score_test_pool_week[\s\S]*acquire_all_pool_entry_pick_locks/)
})

test('entry locks are acquired in deterministic order to avoid deadlocks', async () => {
  const migration = await read('supabase/migrations/20260810002900_concurrent_pool_workflow_serialization.sql')
  assert.match(migration, /from public\.pool_members pm[\s\S]*where pm\.pool_id = p_pool_id[\s\S]*order by pm\.id/)
  assert.match(migration, /from public\.pools p[\s\S]*order by p\.id/)
})

test('internal unlocked implementations are not callable by browser roles', async () => {
  const migration = await read('supabase/migrations/20260810002900_concurrent_pool_workflow_serialization.sql')
  for (const routine of [
    'finalize_locked_picks_concurrency_internal',
    'finalize_no_pick_losses_concurrency_internal',
    'finalize_locked_picks_for_pool_concurrency_internal',
    'rebuild_pool_member_stats_concurrency_internal',
    'adjudicate_results_concurrency_internal',
    'admin_override_entry_final_pick_concurrency_internal',
    'superadmin_score_test_pool_week_concurrency_internal',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${routine}`))
  }
})

test('pick UI verifies ambiguous failed responses and reloads database truth', async () => {
  const poolPage = await read('app/pools/page.tsx')
  assert.match(poolPage, /mobile connection can disappear after PostgreSQL commits/i)
  assert.match(poolPage, /const persistedTeam = finalPick\?\.team_abbr \|\| draftPick\?\.team_abbr \|\| null/)
  assert.match(poolPage, /if \(intendedStatePersisted\)[\s\S]*return true/)
  assert.match(poolPage, /pick_save_verification_failed/)
  assert.match(poolPage, /else \{[\s\S]*await loadMyPicks\(selectedId, pool\?\.start_week \?\? 1, selectedEntryId\)/)
})

test('schedule imports, test outcomes, and pre-start rule edits join the write boundary', async () => {
  const migration = await read('supabase/migrations/20260810003000_serialize_schedule_and_rule_changes.sql')
  assert.match(migration, /before insert or update or delete on public\.nfl_games/)
  assert.match(migration, /serialize_nfl_game_write_with_pool_workflows[\s\S]*order by p\.id/)
  assert.match(migration, /before insert or update or delete on public\.test_pool_team_results/)
  assert.match(migration, /serialize_test_pool_outcome_write[\s\S]*acquire_all_pool_entry_pick_locks/)
  assert.match(migration, /serialize_competitive_pool_settings_write[\s\S]*new\.deadline_mode[\s\S]*new\.double_pick_weeks/)
  assert.match(migration, /before update on public\.pools/)
})
