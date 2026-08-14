import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('ordinary Test Admin actions are sequential and week jumps require an explicit override', async () => {
  const [migration, admin] = await Promise.all([
    read('supabase/migrations/20260814000200_survivor_maintenance_hardening.sql'),
    read('app/pools/[poolId]/admin/page.tsx'),
  ])

  assert.match(migration, /superadmin_assert_current_test_week/i)
  assert.match(migration, /Week % is not the current test week/i)
  assert.match(migration, /superadmin_override_test_pool_week[\s\S]*p_reason text/i)
  assert.match(migration, /length\(v_reason\) < 10/i)
  assert.match(migration, /insert into public\.admin_actions[\s\S]*'test_week_override'/i)
  assert.match(migration, /superadmin_score_test_pool_week[\s\S]*superadmin_assert_current_test_week/i)
  assert.match(migration, /superadmin_set_test_pool_clock[\s\S]*superadmin_assert_current_test_week/i)
  assert.match(admin, /Advanced week override/i)
  assert.match(admin, /superadmin_override_test_pool_week/i)
  assert.match(admin, /without scoring any skipped weeks/i)
})

test('post-elimination future drafts stay in evidence but are hidden from the player', async () => {
  const [migration, player] = await Promise.all([
    read('supabase/migrations/20260814000200_survivor_maintenance_hardening.sql'),
    read('app/pools/page.tsx'),
  ])

  assert.doesNotMatch(migration, /delete from public\.pool_pick_drafts[\s\S]*eliminated/i)
  assert.match(migration, /pool_pick_drafts_select_own_active_history/i)
  assert.match(migration, /pool_pick_drafts\.week <= stats\.eliminated_week/i)
  assert.match(player, /visiblePickCutoffWeek[\s\S]*setMyDraftPicks/i)
  assert.match(player, /Number\.parseInt\(key\.split\(':'\)\[0\]/i)
})

test('one canonical function owns wipeout qualification for scoring and the safety trigger', async () => {
  const migration = await read('supabase/migrations/20260814000200_survivor_maintenance_hardening.sql')

  assert.match(migration, /create or replace function public\.pool_wipeout_survival_credits/i)
  assert.match(migration, /qualified\.alive_count >= 2/i)
  assert.match(migration, /qualified\.everyone_eliminated/i)
  assert.match(migration, /pool_week_grading_complete\(p_pool_id, p_week\)/i)
  assert.match(migration, /guard_survival_grace_grading_complete[\s\S]*pool_wipeout_survival_credits\(new\.pool_id, new\.week\)/i)
  assert.match(migration, /rebuild_pool_member_stats_concurrency_internal[\s\S]*pool_wipeout_survival_credits\(p_pool_id, v_latest_week\)/i)
  assert.match(migration, /drop function if exists public\.pool_alive_entries_entering_week/i)
})

test('reset test pools remain inviteable until the simulated first kickoff', async () => {
  const [migration, dashboard, invitePage] = await Promise.all([
    read('supabase/migrations/20260814000300_test_pool_reset_invites.sql'),
    read('app/pools/page.tsx'),
    read('app/pools/[poolId]/page.tsx'),
  ])

  assert.match(migration, /pool_has_started[\s\S]*pool_effective_now\(p\.id\) >= public\.pool_start_at\(p\.id\)/i)
  assert.doesNotMatch(migration, /test_current_week[\s\S]*>=\s*coalesce\(p\.start_week/i)
  assert.match(migration, /superadmin_reset_test_pool[\s\S]*delete from public\.pool_entry_week_history/i)
  assert.match(migration, /get_pool_invite[\s\S]*join_allowed boolean/i)
  assert.match(migration, /search_pools[\s\S]*not public\.pool_has_started\(p\.id\)/i)
  assert.match(dashboard, /selectedLifecycleStatus[\s\S]*selectedLifecycleStatus\.join_allowed/i)
  assert.match(invitePage, /pool\.join_allowed === false/i)
})
