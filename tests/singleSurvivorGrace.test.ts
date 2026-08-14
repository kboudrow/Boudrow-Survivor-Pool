import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { SeasonSimulator } from './helpers/seasonSimulator.ts'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('a lone entry is eliminated after exceeding its mulligans', () => {
  const simulator = new SeasonSimulator({
    startWeek: 1,
    endWeek: 18,
    strikesAllowed: 2,
    tieRule: 'loss',
    deadlineMode: 'rolling',
    doublePickWeeks: [],
  }, [{ id: 'only-entry', ownerId: 'owner' }])

  for (let week = 1; week <= 3; week += 1) {
    const kickoffMs = Date.UTC(2026, 8, 10 + week * 7, 17)
    simulator.submitPick({
      entryId: 'only-entry', week, slot: 1, teamAbbr: `T${week}`,
      kickoffMs, submittedAtMs: kickoffMs - 1,
    })
    simulator.closeWeek(week, new Map([[`T${week}`, 'loss']]))
  }

  assert.equal(simulator.entries[0].graceCredits, 0)
  assert.equal(simulator.entries[0].eliminatedWeek, 3)
  assert.equal(simulator.requiredPicksNextWeek('only-entry', 4), 0)
})

test('the database grants wipeout protection only when at least two entries began the week alive', async () => {
  const migration = await read('supabase/migrations/20260814000100_single_survivor_elimination.sql')
  assert.match(migration, /pool_alive_entries_entering_week/i)
  assert.match(migration, /pick\.week < p_week/i)
  assert.match(migration, /grace\.week < p_week/i)
  assert.match(migration, /pool_alive_entries_entering_week\(new\.pool_id, new\.week\) < 2/i)
  assert.match(migration, /delete from public\.pool_entry_survival_graces/i)
  assert.match(migration, /perform public\.rebuild_pool_member_stats\(v_pool_id\)/i)
})
