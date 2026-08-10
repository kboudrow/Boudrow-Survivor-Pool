import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('standings snapshot carries the authoritative per-entry survival grace ledger', async () => {
  const migration = await read('supabase/migrations/20260810001900_standings_grace_consistency.sql')
  const page = await read('app/pools/page.tsx')
  assert.match(migration, /survival_graces/)
  assert.match(migration, /g\.pool_id = s\.pool_id and g\.entry_id = s\.entry_id/)
  assert.match(page, /survivalCreditsThroughWeek\(stats\.survival_graces, standingsWeek\)/)
  assert.match(page, /strikesAllowed \+ survivalCredits/)
})

test('any result-ledger change invalidates pool-wide current and future survival grace', async () => {
  const migration = await read('supabase/migrations/20260810001900_standings_grace_consistency.sql')
  assert.match(migration, /after insert or update of result or delete on public\.pool_picks/i)
  assert.match(migration, /old\.result is not distinct from new\.result/)
  assert.match(migration, /g\.pool_id = v_pool_id and g\.week >= v_week/)
  assert.doesNotMatch(migration, /g\.entry_id = v_entry_id/)
})
