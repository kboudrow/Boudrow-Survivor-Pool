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
  const [migration, retainedDraftsMigration, testFinalizerMigration, player, admin] = await Promise.all([
    read('supabase/migrations/20260814000200_survivor_maintenance_hardening.sql'),
    read('supabase/migrations/20260820000500_retained_eliminated_drafts.sql'),
    read('supabase/migrations/20260820000600_skip_eliminated_test_drafts.sql'),
    read('app/pools/page.tsx'),
    read('app/pools/[poolId]/admin/page.tsx'),
  ])

  assert.doesNotMatch(migration, /delete from public\.pool_pick_drafts[\s\S]*eliminated/i)
  assert.match(migration, /pool_pick_drafts_select_own_active_history/i)
  assert.match(migration, /pool_pick_drafts\.week <= stats\.eliminated_week/i)
  assert.match(player, /visiblePickCutoffWeek[\s\S]*setMyDraftPicks/i)
  assert.match(player, /Number\.parseInt\(key\.split\(':'\)\[0\]/i)
  assert.match(player, /filter\(\(entry\) => entry\.status !== 'eliminated'\)/i)
  assert.match(player, /if \(membership\.status === 'eliminated'\) continue/i)
  assert.match(player, /eliminated: hasMembership && entryIds\.length === 0/i)
  assert.match(player, /Eliminated — no picks required/i)
  assert.match(retainedDraftsMigration, /Future saved drafts for eliminated entries are retained as inactive evidence/i)
  assert.match(retainedDraftsMigration, /from public\.pool_picks pick[\s\S]*pick\.week > stats\.eliminated_week/i)
  assert.doesNotMatch(retainedDraftsMigration, /from public\.pool_pick_drafts[\s\S]*locked_count/i)
  assert.match(testFinalizerMigration, /superadmin_finalize_test_locked_picks[\s\S]*coalesce\(stats\.eliminated,false\) = false/i)
  assert.match(testFinalizerMigration, /superadmin_finalize_test_week_drafts[\s\S]*coalesce\(stats\.eliminated,false\)=false/i)
  assert.match(admin, /Future drafts for eliminated entries remain retained but inactive/i)
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
  const [migration, joinMigration, dashboard, invitePage, legacyInvitePage] = await Promise.all([
    read('supabase/migrations/20260814000300_test_pool_reset_invites.sql'),
    read('supabase/migrations/20260815000100_test_pool_preseason_join_consistency.sql'),
    read('app/pools/page.tsx'),
    read('app/pools/[poolId]/page.tsx'),
    read('app/join/[poolId]/page.tsx'),
  ])

  assert.match(migration, /pool_has_started[\s\S]*pool_effective_now\(p\.id\) >= public\.pool_start_at\(p\.id\)/i)
  assert.doesNotMatch(migration, /test_current_week[\s\S]*>=\s*coalesce\(p\.start_week/i)
  assert.match(migration, /superadmin_reset_test_pool[\s\S]*delete from public\.pool_entry_week_history/i)
  assert.match(migration, /get_pool_invite[\s\S]*join_allowed boolean/i)
  assert.match(migration, /search_pools[\s\S]*not public\.pool_has_started\(p\.id\)/i)
  assert.match(dashboard, /selectedLifecycleStatus[\s\S]*selectedLifecycleStatus\.join_allowed/i)
  assert.match(invitePage, /pool\.join_allowed === false/i)
  assert.match(legacyInvitePage, /pool\.join_allowed === false/i)
  assert.match(joinMigration, /if public\.pool_has_started\(p_pool_id\) then/i)
  assert.doesNotMatch(joinMigration, /test_current_week[\s\S]*>=\s*coalesce\(v_pool\.start_week/i)
})
