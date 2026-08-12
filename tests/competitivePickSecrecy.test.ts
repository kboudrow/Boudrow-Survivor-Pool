import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const migration = read('supabase/migrations/20260811000100_competitive_pick_secrecy.sql')

test('each pick is revealed at its own authoritative deadline', () => {
  const visiblePicks = read('supabase/migrations/20260808000300_pool_winner_decision_flow.sql')

  assert.match(visiblePicks, /pp\.user_id\s*=\s*auth\.uid\(\)[\s\S]*pp\.locked_at\s*<=\s*v_effective_now/i)
  assert.match(migration, /when pool\.deadline_mode = 'fixed'[\s\S]*least\([\s\S]*kickoff_at_utc[\s\S]*pool_week_deadline_at/i)
  assert.match(migration, /else coalesce\(game\.kickoff_at_utc, game\.game_time\)/i)
})

test('direct draft and final-pick reads cannot bypass secrecy', () => {
  assert.match(migration, /create policy pool_pick_drafts_select_own[\s\S]*pm\.profile_id = \(select auth\.uid\(\)\)/i)
  assert.doesNotMatch(
    migration.match(/create policy pool_pick_drafts_select_own[\s\S]*?;\n/)?.[0] || '',
    /admin_can_manage/i,
  )
  assert.match(migration, /create policy pool_picks_select_after_reveal[\s\S]*pick_deadline_has_passed\(pool_id, locked_at, week\)/i)
  assert.match(migration, /public\.is_pool_member\(pool_id\) or public\.admin_can_manage\(pool_id\)/i)
})

test('commissioner tools retain operational status but redact secret teams', () => {
  assert.match(migration, /admin_pool_entry_week_overview_unredacted_internal/i)
  assert.match(migration, /case when row\.user_id = auth\.uid\(\) then row\.draft_team_abbr else null end/i)
  assert.match(migration, /admin_pool_entry_audit_unredacted_internal/i)
  assert.match(migration, /Pick activity recorded; team hidden until its deadline\./i)
  assert.match(migration, /jsonb_build_object\('hidden_until_lock',true\)/i)
  assert.match(migration, /revoke all on function public\.commissioner_dispute_history_unredacted_internal[\s\S]*authenticated/i)
})

test('raw pick history waits for reveal and the commissioner UI explains redaction', () => {
  const adminPage = read('app/pools/[poolId]/admin/page.tsx')

  assert.match(migration, /pick_save_events_select_own_or_revealed_admin/i)
  assert.match(migration, /coalesce\(applicable_deadline_at, locked_at\)/i)
  assert.match(adminPage, /another entry&apos;s saved team stays hidden from commissioners until that pick locks/i)
  assert.match(adminPage, /Saved pick hidden until lock/i)
  assert.match(adminPage, /leaving this field unchanged will not clear the participant’s pick/i)
})

test('standings expose only aggregate completion metadata before reveal', () => {
  const completion = read('supabase/migrations/20260722000200_pool_week_pick_completion.sql')
  const standingsPage = read('app/pools/page.tsx')

  assert.match(completion, /returns table \([\s\S]*made_slots integer[\s\S]*complete_entries integer/i)
  assert.doesNotMatch(completion.match(/returns table \([\s\S]*?\)/i)?.[0] || '', /team_abbr|entry_id/i)
  assert.match(standingsPage, /Teams stay hidden until each pick locks\./i)
  assert.match(standingsPage, /Only visible picks are counted here\./i)
})
