import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { SeasonSimulator } from './helpers/seasonSimulator.ts'
import { targetWeeksForScoreSync } from '../lib/nflWeekSync.ts'
import {
  configurableDoublePickWeeks,
  expectedPostseasonGameCount,
  maxWeekForPool,
  seasonWeeksForPool,
  weekLongLabel,
  weekShortLabel,
} from '../lib/seasonModel.ts'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the survivor postseason maps to Wild Card through Super Bowl as Weeks 19-22', () => {
  assert.equal(maxWeekForPool({ include_playoffs: false }), 18)
  assert.equal(maxWeekForPool({ include_playoffs: true }), 22)
  assert.deepEqual(seasonWeeksForPool({ include_playoffs: true }).slice(-4), [19, 20, 21, 22])
  assert.deepEqual([19, 20, 21, 22].map(weekLongLabel), ['Wild Card', 'Divisional', 'Conference Championship', 'Super Bowl'])
  assert.deepEqual([19, 20, 21, 22].map(weekShortLabel), ['WC', 'DIV', 'CONF', 'SB'])
  assert.deepEqual([19, 20, 21, 22].map(expectedPostseasonGameCount), [6, 4, 2, 1])
})

test('postseason score sync discovers a round even before matchup rows exist', () => {
  const weeks = targetWeeksForScoreSync([], [
    { week: 19, week_sunday_date: '2027-01-17' },
    { week: 20, week_sunday_date: '2027-01-24' },
  ], new Date('2027-01-01T17:00:00Z'))
  assert.deepEqual(weeks, [19, 20])
})

test('the Super Bowl is excluded from double-pick configuration', () => {
  assert.equal(configurableDoublePickWeeks({ include_playoffs: true }).at(-1), 21)
  assert.equal(configurableDoublePickWeeks({ include_playoffs: false }).at(-1), 18)
})

test('production UI enables postseason weeks without requiring test mode', async () => {
  const [poolPage, adminPage, newPage] = await Promise.all([
    read('app/pools/page.tsx'),
    read('app/pools/[poolId]/admin/page.tsx'),
    read('app/pools/new/page.tsx'),
  ])
  assert.doesNotMatch(poolPage, /test_mode\s*&&\s*pool\.include_playoffs/)
  assert.match(poolPage, /maxWeekForPool/)
  assert.match(adminPage, /configurableDoublePickWeeks/)
  assert.match(newPage, /configurableDoublePickWeeks/)
})

test('postseason database dates, Super Bowl guard, and Run It Back isolation are forward-migrated', async () => {
  const sql = await read('supabase/migrations/20260813000200_postseason_integrity.sql')
  assert.match(sql, /\(2026, 19, '2027-01-17'\)/)
  assert.match(sql, /\(2026, 22, '2027-02-14'\)/)
  assert.match(sql, /season_weeks_week_check check \(week between 1 and 22\)/i)
  assert.match(sql, /22 = any\(coalesce\(new\.double_pick_weeks/i)
  assert.match(sql, /case when coalesce\(v_old\.include_playoffs,false\) then 21 else 18 end/i)
  assert.match(sql, /insert into public\.pool_members/i)
  assert.doesNotMatch(sql, /insert into public\.pool_picks/i)
  assert.doesNotMatch(sql, /insert into public\.pool_member_stats/i)
})

test('postseason team reuse is reset only at the regular/postseason phase boundary', async () => {
  const sql = await read('supabase/migrations/20260810000900_clarified_survivor_rules.sql')
  assert.match(sql, /case when coalesce\(p_week, 0\) > 18 then 'postseason' else 'regular' end/i)
  assert.match(sql, /public\.pool_pick_phase\(pp\.week\)\s*=\s*public\.pool_pick_phase\(p_week\)/i)
})

test('actual playoff participants, including bye teams, come only from scheduled round games', async () => {
  const sql = await read('supabase/migrations/20260726000500_test_playoff_cron_join_hardening.sql')
  assert.match(sql, /create or replace function public\.pool_week_games/i)
  assert.match(sql, /where g\.season = v_season[\s\S]*and g\.week = p_week/i)
})

const kickoff = (week: number, hour = 18) => Date.UTC(2027, week === 22 ? 1 : 0, week === 22 ? 14 : 16 + (week - 19) * 7, hour)

function submit(sim: SeasonSimulator, entryId: string, week: number, teamAbbr: string, hour = 18) {
  const gameTime = kickoff(week, hour)
  sim.submitPick({ entryId, week, slot: 1, teamAbbr, kickoffMs: gameTime, submittedAtMs: gameTime - 1 })
}

test('a regular-season pool transitions through every playoff round and can finish with co-survivors', () => {
  const sim = new SeasonSimulator({
    startWeek: 18, endWeek: 22, strikesAllowed: 0, tieRule: 'loss', deadlineMode: 'rolling', doublePickWeeks: [],
  }, [
    { id: 'a', ownerId: 'owner-a' }, { id: 'b', ownerId: 'owner-b' }, { id: 'c', ownerId: 'owner-c' },
  ])

  for (const [entry, team] of [['a', 'BUF'], ['b', 'KC'], ['c', 'PHI']] as const) submit(sim, entry, 18, team)
  sim.closeWeek(18, new Map([['BUF', 'win'], ['KC', 'win'], ['PHI', 'win']]))

  // Regular-season use resets at the established postseason boundary.
  for (const [entry, team] of [['a', 'BUF'], ['b', 'KC'], ['c', 'PHI']] as const) submit(sim, entry, 19, team)
  sim.closeWeek(19, new Map([['BUF', 'win'], ['KC', 'win'], ['PHI', 'win']]))
  for (const [entry, team] of [['a', 'DEN'], ['b', 'BAL'], ['c', 'SF']] as const) submit(sim, entry, 20, team)
  sim.closeWeek(20, new Map([['DEN', 'win'], ['BAL', 'win'], ['SF', 'win']]))
  for (const [entry, team] of [['a', 'LAR'], ['b', 'DET'], ['c', 'GB']] as const) submit(sim, entry, 21, team)
  sim.closeWeek(21, new Map([['LAR', 'win'], ['DET', 'win'], ['GB', 'win']]))
  for (const entry of ['a', 'b', 'c']) submit(sim, entry, 22, entry === 'c' ? 'NE' : 'SEA')
  const final = sim.closeWeek(22, new Map([['SEA', 'win'], ['NE', 'loss']]))

  assert.deepEqual(final, { week: 22, activeEntries: 2, eliminatedEntries: 1, winnerEntryId: null, completed: true })
})

test('a postseason wipeout advances everyone with the losing teams still consumed', () => {
  const sim = new SeasonSimulator({
    startWeek: 19, endWeek: 22, strikesAllowed: 0, tieRule: 'loss', deadlineMode: 'fixed', doublePickWeeks: [],
  }, [{ id: 'a', ownerId: 'one' }, { id: 'b', ownerId: 'two' }])
  submit(sim, 'a', 19, 'BUF')
  submit(sim, 'b', 19, 'PHI')
  const summary = sim.closeWeek(19, new Map([['BUF', 'loss'], ['PHI', 'loss']]))
  assert.equal(summary.activeEntries, 2)
  assert.equal(sim.eligibleTeams('a', 20, ['BUF', 'KC']).includes('BUF'), false)
  assert.equal(sim.eligibleTeams('b', 20, ['PHI', 'SF']).includes('PHI'), false)
})

test('shrinking playoff fields can leave a survivor with no unused finalist', () => {
  const sim = new SeasonSimulator({
    startWeek: 18, endWeek: 22, strikesAllowed: 2, tieRule: 'loss', deadlineMode: 'rolling', doublePickWeeks: [],
  }, [{ id: 'a', ownerId: 'one' }, { id: 'b', ownerId: 'two' }])
  submit(sim, 'a', 18, 'BUF'); submit(sim, 'b', 18, 'KC')
  sim.closeWeek(18, new Map([['BUF', 'win'], ['KC', 'win']]))
  submit(sim, 'a', 19, 'BUF'); submit(sim, 'b', 19, 'KC')
  sim.closeWeek(19, new Map([['BUF', 'win'], ['KC', 'win']]))
  submit(sim, 'a', 20, 'KC'); submit(sim, 'b', 20, 'BUF')
  sim.closeWeek(20, new Map([['BUF', 'win'], ['KC', 'win']]))
  assert.deepEqual(sim.eligibleTeams('a', 22, ['BUF', 'KC']), [])
  assert.deepEqual(sim.eligibleTeams('b', 22, ['BUF', 'KC']), [])
})
