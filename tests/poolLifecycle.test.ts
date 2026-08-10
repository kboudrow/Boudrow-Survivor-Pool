import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('one database lifecycle model owns phase names and capabilities', async () => {
  const migration = await read('supabase/migrations/20260810002600_canonical_pool_lifecycle.sql')

  for (const phase of [
    'archived',
    'cancelled',
    'draft',
    'open',
    'between_weeks',
    'live_week',
    'waiting_results',
    'completed_winner',
    'completed_season',
    'review_required',
  ]) {
    assert.match(migration, new RegExp(`'${phase}'`), `missing lifecycle phase ${phase}`)
  }

  assert.match(migration, /join_allowed boolean/)
  assert.match(migration, /entry_creation_allowed boolean/)
  assert.match(migration, /pick_submission_allowed boolean/)
  assert.match(migration, /settings_editable boolean/)
  assert.match(migration, /archive_allowed boolean/)
  assert.match(migration, /result_processing_pending boolean/)
})

test('start and current-week decisions use the database clock and the configured start week', async () => {
  const migration = await read('supabase/migrations/20260810002600_canonical_pool_lifecycle.sql')

  assert.match(migration, /create or replace function public\.pool_start_at/)
  assert.match(migration, /create or replace function public\.pool_has_started/)
  assert.match(migration, /public\.pool_effective_now\(p\.id\)/)
  assert.match(migration, /g\.week = p\.start_week/)
  assert.match(migration, /for v_week in v_pool\.start_week\.\.v_final_week/)
  assert.match(migration, /test_current_week/)
})

test('completion waits for the configured final week and complete result processing', async () => {
  const migration = await read('supabase/migrations/20260810002600_canonical_pool_lifecycle.sql')

  assert.match(migration, /public\.pool_max_pick_week/)
  assert.match(migration, /bool_and\(lower\(coalesce\(g\.status, ''\)\) = 'final'\)/)
  assert.match(migration, /v_recorded_picks >= v_expected_picks and v_ungraded_picks = 0/)
  assert.match(migration, /v_recorded_week_picks < v_expected_week_picks or v_ungraded_week_picks > 0/)
  assert.match(migration, /multiple surviving entries; no tiebreak rule is configured/)
})

test('winner, zero-entry, and impossible zero-survivor outcomes are distinct', async () => {
  const migration = await read('supabase/migrations/20260810002600_canonical_pool_lifecycle.sql')
  const clarifiedRules = await read('supabase/migrations/20260810000900_clarified_survivor_rules.sql')

  assert.match(migration, /public\.pool_has_declared_winner\(p_pool_id\)/)
  assert.match(migration, /v_total_entries > 0 and v_alive_entries = 0/)
  assert.match(migration, /v_total_entries = 0/)
  assert.match(migration, /Simultaneous elimination should have granted survival grace/)
  assert.match(clarifiedRules, /pool_entry_survival_graces/)
})

test('completed pools can be archived while in-progress pools remain protected', async () => {
  const migration = await read('supabase/migrations/20260810002600_canonical_pool_lifecycle.sql')
  const adminPage = await read('app/pools/[poolId]/admin/page.tsx')

  assert.match(migration, /public\.pool_has_started\(p_pool_id\)[\s\S]*not public\.pool_competition_is_complete\(p_pool_id\)/)
  assert.match(migration, /An in-progress pool cannot be archived/)
  assert.match(adminPage, /pool_lifecycle_status/)
  assert.match(adminPage, /lifecycleStatus\.archive_allowed/)
  assert.match(adminPage, /Archive Completed Pool/)
})

test('commissioner lifecycle display consumes the canonical database result', async () => {
  const adminPage = await read('app/pools/[poolId]/admin/page.tsx')
  const dashboard = await read('app/pools/page.tsx')

  assert.match(adminPage, /type PoolLifecycleStatus/)
  assert.match(adminPage, /status\.phase\.startsWith\('completed_'\)/)
  assert.match(adminPage, /lifecycleStatus \? !lifecycleStatus\.settings_editable : leagueHasStarted/)
  assert.match(adminPage, /lifecycleStatus\.join_allowed/)
  assert.doesNotMatch(adminPage, /setPoolStartAt\(firstStartGame/)
  assert.match(dashboard, /poolLifecycleStatuses/)
  assert.match(dashboard, /Season complete: \{lifecycle\.description\}/)
  assert.match(dashboard, /waiting for final result processing/)
})

test('test-season scoring leaves the clock after the configured final week', async () => {
  const migration = await read('supabase/migrations/20260810002800_test_pool_final_week_completion.sql')

  assert.match(migration, /p_week >= coalesce\(v_max_week, 18\)/)
  assert.match(migration, /pool_test_clock_at\(p_pool_id, p_week, 'week_done'\)/)
  assert.match(migration, /The configured season is complete/)
  assert.match(migration, /test_current_week = p_week/)
})
