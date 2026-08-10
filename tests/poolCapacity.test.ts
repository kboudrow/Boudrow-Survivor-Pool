import assert from 'node:assert/strict'
import test from 'node:test'

import {
  UNLIMITED_POOL_CAPACITY,
  isUnlimitedPoolCapacity,
  poolCapacityLabel,
  poolEntryCountLabel,
} from '../lib/poolCapacity.ts'

test('the database sentinel and absent limits display as Unlimited', () => {
  assert.equal(isUnlimitedPoolCapacity(UNLIMITED_POOL_CAPACITY), true)
  assert.equal(isUnlimitedPoolCapacity(null), true)
  assert.equal(poolCapacityLabel(UNLIMITED_POOL_CAPACITY), 'Unlimited')
  assert.equal(poolEntryCountLabel(37, UNLIMITED_POOL_CAPACITY), '37 / Unlimited')
})

test('finite total-entry caps keep their numeric display', () => {
  assert.equal(isUnlimitedPoolCapacity(25), false)
  assert.equal(poolCapacityLabel(25), '25')
  assert.equal(poolEntryCountLabel(12, 25), '12/25')
})
