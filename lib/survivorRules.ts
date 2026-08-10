export type PickResult = 'win' | 'loss' | 'push' | null
export type TieRule = 'win' | 'loss'

export function requiredPickSlots(doublePickWeeks: readonly number[] | null | undefined, week: number) {
  return doublePickWeeks?.includes(week) ? 2 : 1
}

export function resultUsesStrike(result: PickResult, tieRule: TieRule) {
  return result === 'loss' || (result === 'push' && tieRule === 'loss')
}

export function entryProgress(results: readonly PickResult[], strikesAllowed: number, tieRule: TieRule) {
  const strikesUsed = results.filter((result) => resultUsesStrike(result, tieRule)).length
  return {
    strikesUsed,
    strikesLeft: Math.max(0, strikesAllowed - strikesUsed),
    alive: strikesUsed <= strikesAllowed,
  }
}

export function teamAlreadyUsed(
  picks: ReadonlyArray<{ week: number; slot: number; teamAbbr: string }>,
  teamAbbr: string,
  target: { week: number; slot: number },
) {
  return picks.some((pick) => pick.teamAbbr === teamAbbr && (pick.week !== target.week || pick.slot !== target.slot))
}

export function effectiveTeamLockMs(options: {
  kickoffMs: number
  deadlineMode: 'fixed' | 'rolling'
  fixedDeadlineMs?: number | null
}) {
  if (options.deadlineMode === 'rolling' || options.fixedDeadlineMs == null) return options.kickoffMs
  return Math.min(options.kickoffMs, options.fixedDeadlineMs)
}

export function isPickLocked(lockMs: number, nowMs: number) {
  return nowMs >= lockMs
}

export function poolHasWinner(totalPlayers: number, alivePlayers: number, aliveEntries: number) {
  return totalPlayers > 1 && alivePlayers === 1 && aliveEntries > 0
}
