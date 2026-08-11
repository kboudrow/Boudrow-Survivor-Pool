import assert from 'node:assert/strict'
import test from 'node:test'
import { SeasonSimulator, type SimPoolConfig } from './helpers/seasonSimulator.ts'

const TEAMS = Array.from({ length: 32 }, (_, index) => `T${String(index + 1).padStart(2, '0')}`)
const kickoff = (week: number, slot = 0) => Date.UTC(2026, 8, 10 + week * 7, 17 + slot)

function makePool(config: Partial<SimPoolConfig>, entryOwners: string[]) {
  return new SeasonSimulator({
    startWeek: 1,
    endWeek: 18,
    strikesAllowed: 0,
    tieRule: 'loss',
    deadlineMode: 'rolling',
    doublePickWeeks: [],
    ...config,
  }, entryOwners.map((ownerId, index) => ({ id: `entry-${index + 1}`, ownerId })))
}

function playWeek(sim: SeasonSimulator, week: number, results: Record<string, Array<'win' | 'loss' | 'push' | 'miss'>>) {
  const outcomes = new Map<string, 'win' | 'loss' | 'push'>()
  let teamIndex = (week - sim.config.startWeek) * 2
  for (const entry of sim.entries.filter((candidate) => candidate.eliminatedWeek === null)) {
    const requested = results[entry.id] || Array.from({ length: sim.config.doublePickWeeks.includes(week) ? 2 : 1 }, () => 'win' as const)
    requested.forEach((result, index) => {
      if (result === 'miss') return
      let team = TEAMS[teamIndex % TEAMS.length]
      while (!sim.eligibleTeams(entry.id, week, [team]).length) {
        teamIndex += 1
        team = TEAMS[teamIndex % TEAMS.length]
      }
      sim.submitPick({ entryId: entry.id, week, slot: index + 1, teamAbbr: team, kickoffMs: kickoff(week, index), submittedAtMs: kickoff(week, index) - 1 })
      outcomes.set(team, result)
      teamIndex += 1
    })
  }
  return sim.closeWeek(week, outcomes)
}

test('Pools A-D exercise interacting rules across complete seasons', () => {
  const poolA = makePool({}, ['u1', 'u2', 'u3', 'u4'])
  playWeek(poolA, 1, { 'entry-4': ['miss'] })
  playWeek(poolA, 2, { 'entry-3': ['loss'] })
  const aFinal = playWeek(poolA, 3, { 'entry-2': ['loss'] })
  assert.deepEqual(aFinal, { week: 3, activeEntries: 1, eliminatedEntries: 3, winnerEntryId: 'entry-1', completed: true })

  const poolB = makePool({ strikesAllowed: 1, deadlineMode: 'fixed', doublePickWeeks: [2, 4] }, ['u1', 'u1', 'u2', 'u2', 'u3', 'u4'])
  playWeek(poolB, 1, { 'entry-5': ['loss'], 'entry-6': ['miss'] })
  playWeek(poolB, 2, { 'entry-5': ['loss', 'win'], 'entry-6': ['miss', 'win'], 'entry-4': ['push', 'win'] })
  playWeek(poolB, 3, { 'entry-4': ['loss'], 'entry-3': ['push'] })
  playWeek(poolB, 4, { 'entry-3': ['loss', 'win'], 'entry-2': ['loss', 'win'] })
  const bFinal = playWeek(poolB, 5, { 'entry-2': ['loss'] })
  assert.equal(bFinal.winnerEntryId, 'entry-1')
  assert.equal(poolB.entries[0].ownerId, poolB.entries[1].ownerId)
  assert.notDeepEqual(poolB.entries[0].picks.map((pick) => pick.teamAbbr), poolB.entries[1].picks.map((pick) => pick.teamAbbr))

  const poolC = makePool({ startWeek: 5, tieRule: 'win', deadlineMode: 'fixed' }, ['u1', 'u2', 'u3', 'u4'])
  playWeek(poolC, 5, { 'entry-3': ['push'], 'entry-4': ['miss'] })
  for (let week = 6; week < 18; week += 1) playWeek(poolC, week, {})
  const cFinal = playWeek(poolC, 18, { 'entry-3': ['loss'] })
  assert.equal(cFinal.completed, true)
  assert.equal(cFinal.winnerEntryId, null)
  assert.equal(cFinal.activeEntries, 2)

  const poolD = makePool({ strikesAllowed: 1, doublePickWeeks: [3, 5], deadlineMode: 'rolling' }, ['u1', 'u1', 'u2', 'u2', 'u3', 'u4'])
  playWeek(poolD, 1, { 'entry-5': ['loss'], 'entry-6': ['miss'] })
  playWeek(poolD, 2, { 'entry-5': ['push'], 'entry-6': ['loss'], 'entry-4': ['loss'] })
  playWeek(poolD, 3, { 'entry-4': ['loss', 'win'], 'entry-3': ['loss', 'win'] })
  playWeek(poolD, 4, { 'entry-3': ['loss'], 'entry-2': ['loss'] })
  const dFinal = playWeek(poolD, 5, { 'entry-2': ['loss', 'win'] })
  assert.equal(dFinal.winnerEntryId, 'entry-1')
})

test('deadline, reuse, double-pick, and independent-entry restrictions hold in sequence', () => {
  const sim = makePool({ strikesAllowed: 1, doublePickWeeks: [2], deadlineMode: 'rolling' }, ['same-owner', 'same-owner'])
  const firstKickoff = kickoff(1)
  sim.submitPick({ entryId: 'entry-1', week: 1, slot: 1, teamAbbr: 'T01', kickoffMs: firstKickoff, submittedAtMs: firstKickoff - 1 })
  sim.submitPick({ entryId: 'entry-2', week: 1, slot: 1, teamAbbr: 'T01', kickoffMs: firstKickoff, submittedAtMs: firstKickoff - 1 })
  assert.throws(() => sim.submitPick({ entryId: 'entry-1', week: 1, slot: 1, teamAbbr: 'T02', kickoffMs: firstKickoff, submittedAtMs: firstKickoff }), /locked/)
  sim.closeWeek(1, new Map([['T01', 'win']]))
  assert.throws(() => sim.submitPick({ entryId: 'entry-1', week: 2, slot: 1, teamAbbr: 'T01', kickoffMs: kickoff(2), submittedAtMs: kickoff(2) - 1 }), /already used/)
  sim.submitPick({ entryId: 'entry-1', week: 2, slot: 1, teamAbbr: 'T03', kickoffMs: kickoff(2), submittedAtMs: kickoff(2) - 1 })
  assert.throws(() => sim.submitPick({ entryId: 'entry-1', week: 2, slot: 2, teamAbbr: 'T03', kickoffMs: kickoff(2, 1), submittedAtMs: kickoff(2, 1) - 1 }), /already used/)
})

test('250 seeded randomized seasons preserve weekly survivor invariants', () => {
  let state = 0x5eed1234
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
  let completed = 0
  let weeks = 0
  let picks = 0

  for (let run = 0; run < 250; run += 1) {
    const startWeek = 1 + Math.floor(random() * 8)
    const doubles = Array.from({ length: 18 - startWeek + 1 }, (_, index) => startWeek + index).filter(() => random() < 0.12)
    const entryCount = 3 + Math.floor(random() * 8)
    const sim = makePool({
      startWeek,
      strikesAllowed: Math.floor(random() * 3),
      tieRule: random() < 0.5 ? 'win' : 'loss',
      deadlineMode: random() < 0.5 ? 'fixed' : 'rolling',
      doublePickWeeks: doubles,
    }, Array.from({ length: entryCount }, (_, index) => `owner-${Math.floor(index / 2)}`))

    for (let week = startWeek; week <= 18 && !sim.summaries.at(-1)?.completed; week += 1) {
      const results: Record<string, Array<'win' | 'loss' | 'push' | 'miss'>> = {}
      const slots = doubles.includes(week) ? 2 : 1
      for (const entry of sim.entries.filter((candidate) => candidate.eliminatedWeek === null)) {
        results[entry.id] = Array.from({ length: slots }, () => {
          const roll = random()
          return roll < 0.62 ? 'win' : roll < 0.82 ? 'loss' : roll < 0.93 ? 'push' : 'miss'
        })
      }
      const summary = playWeek(sim, week, results)
      weeks += 1
      picks += sim.entries.reduce((sum, entry) => sum + entry.picks.filter((pick) => pick.week === week).length, 0)
      assert.equal(summary.activeEntries + summary.eliminatedEntries, entryCount)
      for (const entry of sim.entries) {
        assert.ok(sim.mulligansRemaining(entry.id) >= 0)
        assert.equal(new Set(entry.picks.filter((pick) => pick.teamAbbr).map((pick) => pick.teamAbbr)).size, entry.picks.filter((pick) => pick.teamAbbr).length)
      }
      if (summary.completed) completed += 1
    }
  }

  assert.equal(completed, 250)
  assert.ok(weeks > 1_000)
  assert.ok(picks > 5_000)
})
