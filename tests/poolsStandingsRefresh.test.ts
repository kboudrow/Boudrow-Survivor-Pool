import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readPoolsPage = () => readFile(new URL('../app/pools/page.tsx', import.meta.url), 'utf8')
const readDecidingWeekVisibilityMigration = () => readFile(
  new URL('../supabase/migrations/20260820000800_reveal_deciding_week_picks.sql', import.meta.url),
  'utf8',
)

test('standings refresh automatically and stale responses cannot overwrite final results', async () => {
  const page = await readPoolsPage()

  assert.match(page, /const requestId = \+\+standingsRequestRef\.current/)
  assert.match(page, /if \(requestId !== standingsRequestRef\.current\) return/)
  assert.match(page, /window\.addEventListener\('focus', refreshStandings\)/)
  assert.match(page, /document\.addEventListener\('visibilitychange', refreshStandings\)/)
  assert.match(page, /isTestMode \? 10_000 : 30_000/)
})

test('standings progression honors explicit eliminations from the scoring snapshot', async () => {
  const page = await readPoolsPage()

  assert.match(page, /const aliveThroughWeek = progress\.alive && !explicitlyEliminatedByWeek/)
  assert.match(page, /return !explicitlyEliminatedByWeek && strikes <= strikesAllowed \+ credits/)
})

test('a declared winner reveals all finalized picks through the deciding week', async () => {
  const migration = await readDecidingWeekVisibilityMigration()

  assert.match(migration, /v_decided_week is not null and pp\.week <= v_decided_week/)
  assert.match(migration, /pp\.week <= s\.eliminated_week/)
})

test('completed pool cards identify eliminated viewers before labeling the winner', async () => {
  const page = await readPoolsPage()
  const stagePill = page.slice(page.indexOf('function PoolStagePill'), page.indexOf('function PickStatusCard'))
  const pickStatusCard = page.slice(page.indexOf('function PickStatusCard'), page.indexOf('function WinnerAvatar'))

  assert.ok(stagePill.indexOf('pickStatus?.eliminated') < stagePill.indexOf("lifecycle?.phase === 'completed_winner'"))
  assert.ok(pickStatusCard.indexOf('status.eliminated') < pickStatusCard.indexOf("lifecycle?.phase === 'completed_winner'"))
})
