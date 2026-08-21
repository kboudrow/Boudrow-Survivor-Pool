import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readPoolsPage = () => readFile(new URL('../app/pools/page.tsx', import.meta.url), 'utf8')

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
