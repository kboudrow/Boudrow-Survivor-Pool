import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('unconfirmed NFL flex windows are unavailable in both database pick paths', async () => {
  const migration = await read('supabase/migrations/20260810001800_schedule_kickoff_integrity.sql')
  assert.match(migration, /kickoff_confirmed boolean not null default true/i)
  assert.match(migration, /before insert or update on public\.pool_pick_drafts/i)
  assert.match(migration, /before insert or update on public\.pool_picks/i)
  assert.match(migration, /and not g\.kickoff_confirmed/i)
  assert.match(migration, /NFL has not confirmed the kickoff time/i)
})

test('score sync updates a matchup instead of duplicating imported event ids', async () => {
  const route = await read('app/api/cron/sync-scores/route.ts')
  const migration = await read('supabase/migrations/20260810001800_schedule_kickoff_integrity.sql')
  assert.match(migration, /unique index[\s\S]*\(season, week, home_team, away_team\)/i)
  assert.match(route, /onConflict: 'season,week,home_team,away_team'/)
  assert.doesNotMatch(route, /onConflict: 'espn_event_id'/)
})

test('score sync keeps TBD weeks under observation and detects ESPN TBD labels', async () => {
  const route = await read('app/api/cron/sync-scores/route.ts')
  assert.match(route, /!label\.includes\('tbd'\)/)
  assert.match(route, /\|\| !game\.kickoff_confirmed/)
  assert.match(route, /35 \* 24 \* 60 \* 60 \* 1000/)
})

test('fixed weekly deadlines use Eastern civil time and the database clock', async () => {
  const migration = await read('supabase/migrations/20260808000200_rule_cron_test_clock_hardening.sql')
  assert.match(migration, /at time zone 'America\/New_York'/i)
  assert.match(migration, /else now\(\)/i)
})

test('Eastern fixed deadlines cross daylight saving time at the correct UTC instant', () => {
  // 1 PM Eastern is 17:00 UTC before the Nov. 1, 2026 fallback, 18:00 UTC after it.
  assert.equal(new Date('2026-09-13T17:00:00Z').toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), '13')
  assert.equal(new Date('2026-11-08T18:00:00Z').toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }), '13')
})
