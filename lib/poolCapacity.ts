export const UNLIMITED_POOL_CAPACITY = 2_147_483_647

export function isUnlimitedPoolCapacity(value?: number | null) {
  return value === null || value === undefined || value >= UNLIMITED_POOL_CAPACITY
}

export function poolCapacityLabel(value?: number | null) {
  return isUnlimitedPoolCapacity(value) ? 'Unlimited' : String(value)
}

export function poolEntryCountLabel(entryCount: number, capacity?: number | null) {
  return isUnlimitedPoolCapacity(capacity) ? `${entryCount} / Unlimited` : `${entryCount}/${capacity}`
}
