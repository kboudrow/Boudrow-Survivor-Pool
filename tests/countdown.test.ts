import assert from 'node:assert/strict'
import test from 'node:test'

import { formatLockCountdown } from '../lib/countdown.ts'

test('lock countdown uses labeled days, hours, and minutes without seconds', () => {
  assert.equal(formatLockCountdown(((2 * 24 + 3) * 60 + 4) * 60_000), '2 days · 3 hours · 4 minutes')
})

test('lock countdown uses singular labels', () => {
  assert.equal(formatLockCountdown((24 * 60 + 61) * 60_000), '1 day · 1 hour · 1 minute')
})

test('lock countdown omits unused leading units and rounds up partial minutes', () => {
  assert.equal(formatLockCountdown(61 * 60_000), '1 hour · 1 minute')
  assert.equal(formatLockCountdown(60_001), '2 minutes')
  assert.equal(formatLockCountdown(30_001), 'Less than 1 minute')
})

test('expired lock countdown reports locked', () => {
  assert.equal(formatLockCountdown(0), 'Locked')
  assert.equal(formatLockCountdown(-1), 'Locked')
})
