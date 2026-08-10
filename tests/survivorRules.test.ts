import assert from 'node:assert/strict'
import test from 'node:test'

import {
  effectiveTeamLockMs,
  entryProgress,
  isPickLocked,
  poolHasWinner,
  requiredPickSlots,
  teamAlreadyUsed,
} from '../lib/survivorRules.ts'

test('a team cannot be reused outside the pick slot being edited', () => {
  const picks = [{ week: 1, slot: 1, teamAbbr: 'BUF' }, { week: 3, slot: 2, teamAbbr: 'KC' }]
  assert.equal(teamAlreadyUsed(picks, 'BUF', { week: 2, slot: 1 }), true)
  assert.equal(teamAlreadyUsed(picks, 'BUF', { week: 1, slot: 1 }), false)
  assert.equal(teamAlreadyUsed(picks, 'PHI', { week: 2, slot: 1 }), false)
})

test('double-pick weeks require exactly two slots', () => {
  assert.equal(requiredPickSlots([3, 7], 3), 2)
  assert.equal(requiredPickSlots([3, 7], 4), 1)
})

test('entry elimination occurs only after strikes allowed are exceeded', () => {
  assert.deepEqual(entryProgress(['loss'], 1, 'loss'), { strikesUsed: 1, strikesLeft: 0, alive: true })
  assert.deepEqual(entryProgress(['loss', 'loss'], 1, 'loss'), { strikesUsed: 2, strikesLeft: 0, alive: false })
})

test('push behavior follows the pool tie rule', () => {
  assert.equal(entryProgress(['push'], 0, 'win').alive, true)
  assert.equal(entryProgress(['push'], 0, 'loss').alive, false)
})

test('rolling deadlines lock at kickoff', () => {
  assert.equal(effectiveTeamLockMs({ kickoffMs: 2_000, deadlineMode: 'rolling' }), 2_000)
  assert.equal(isPickLocked(2_000, 1_999), false)
  assert.equal(isPickLocked(2_000, 2_000), true)
})

test('fixed deadlines never keep an early game open after kickoff', () => {
  assert.equal(effectiveTeamLockMs({ kickoffMs: 2_000, deadlineMode: 'fixed', fixedDeadlineMs: 3_000 }), 2_000)
  assert.equal(effectiveTeamLockMs({ kickoffMs: 3_000, deadlineMode: 'fixed', fixedDeadlineMs: 2_000 }), 2_000)
})

test('winner requires a real multi-player pool and one surviving player', () => {
  assert.equal(poolHasWinner(4, 1, 2), true)
  assert.equal(poolHasWinner(1, 1, 1), false)
  assert.equal(poolHasWinner(4, 0, 0), false)
})
