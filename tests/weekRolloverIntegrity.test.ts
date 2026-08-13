import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the database blocks past weeks while allowing scheduled future-week picks', async () => {
  const migration = await read('supabase/migrations/20260813000100_week_rollover_integrity.sql')
  const pickAhead = await read('supabase/migrations/20260813000300_restore_pick_ahead.sql')
  const dashboard = await read('app/pools/page.tsx')

  assert.match(migration, /create or replace function public\.pool_open_pick_week/)
  assert.match(migration, /public\.pool_effective_now\(p_pool_id\)/)
  assert.match(migration, /time '06:00'\) at time zone 'America\/New_York'/)
  assert.match(pickAhead, /if p_week < v_current_week then[\s\S]*no longer available for picks/i)
  assert.match(pickAhead, /create or replace function public\.clear_entry_draft_pick[\s\S]*if p_week < v_current_week/i)
  assert.match(pickAhead, /save_entry_draft_pick_unserialized/)

  assert.match(dashboard, /supabase\.rpc\('pool_open_pick_week'/)
  assert.match(dashboard, /selectedPickWeek >= openPickWeek/)
  assert.doesNotMatch(dashboard, /disabled=\{unavailable\}/)
  assert.match(dashboard, /scheduled future weeks are available/)
  assert.match(dashboard, /setInterval\(refreshLockedPicks, 30_000\)/)
  assert.match(dashboard, /selectedWeek === previousOpenWeek \? nextOpenWeek : selectedWeek/)
})

test('partial late-game grading cannot decide a winner or grant wipeout grace', async () => {
  const migration = await read('supabase/migrations/20260813000100_week_rollover_integrity.sql')

  assert.match(migration, /create or replace function public\.pool_week_grading_complete/)
  assert.match(migration, /stats\.eliminated_week is null or stats\.eliminated_week >= p_week/)
  assert.match(migration, /pick\.slot between 1 and public\.picks_allowed/)
  assert.match(migration, /pick\.result is not null/)
  assert.match(migration, /completed\.pick_count = expected\.pick_count/)

  assert.match(migration, /create trigger aaa_guard_survival_grace_grading_complete/)
  assert.match(migration, /if not public\.pool_week_grading_complete\(new\.pool_id, new\.week\)[\s\S]*return null/)
  assert.match(migration, /create or replace function public\.pool_has_declared_winner[\s\S]*pool_week_grading_complete\(p_pool_id, decided_week\)/)
  assert.match(migration, /create or replace function public\.pool_winner_decided_week[\s\S]*pool_week_grading_complete\(p_pool_id, decided_week\)/)
  assert.match(migration, /create or replace function public\.pool_winner_status[\s\S]*pool_week_grading_complete\(p_pool_id, totals\.decided_week\)/)
})

test('normal and double-pick rollover completion uses each week’s configured slot count', async () => {
  const migration = await read('supabase/migrations/20260813000100_week_rollover_integrity.sql')

  assert.match(migration, /count\(\*\)::integer \* public\.picks_allowed\(p_pool_id, p_week\)/)
  assert.doesNotMatch(migration, /picks_allowed\(p_pool_id, p_week\)\s*=\s*1/)
  assert.match(migration, /does[\s\S]*not wait for unrelated NFL games/i)
})

test('rollover fixes retain transaction serialization and correction-safe derived state', async () => {
  const migration = await read('supabase/migrations/20260813000100_week_rollover_integrity.sql')
  const concurrency = await read('supabase/migrations/20260810002900_concurrent_pool_workflow_serialization.sql')
  const provider = await read('supabase/migrations/20260810003200_untrusted_nfl_feed_resilience.sql')

  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_pool_id::text \|\| ':' \|\| p_entry_id::text/)
  assert.match(concurrency, /acquire_pool_workflow_lock/)
  assert.match(concurrency, /adjudicate_results_concurrency_internal/)
  assert.match(provider, /set result = null,[\s\S]*adjudicated_at = null/)
  assert.match(provider, /perform public\.rebuild_pool_member_stats\(v_pool_id\)/)
})
