export const PLAYOFFS_LAB_ENABLED = process.env.NEXT_PUBLIC_PLAYOFFS_LAB === '1'

export const REGULAR_SEASON_LAST_WEEK = 18
export const PLAYOFF_LAST_WEEK = 22

export const PLAYOFF_ROUNDS = [
  { week: 19, shortLabel: 'WC', label: 'Wild Card' },
  { week: 20, shortLabel: 'DIV', label: 'Divisional' },
  { week: 21, shortLabel: 'CONF', label: 'Conference Championship' },
  { week: 22, shortLabel: 'SB', label: 'Super Bowl' },
] as const

export function maxWeekForPool(pool?: { include_playoffs?: boolean | null } | null) {
  return PLAYOFFS_LAB_ENABLED && pool?.include_playoffs ? PLAYOFF_LAST_WEEK : REGULAR_SEASON_LAST_WEEK
}

export function seasonWeeksForPool(pool?: { include_playoffs?: boolean | null } | null) {
  return Array.from({ length: maxWeekForPool(pool) }, (_, index) => index + 1)
}

export function weekShortLabel(week: number) {
  const playoffRound = PLAYOFF_ROUNDS.find((round) => round.week === week)
  return playoffRound?.shortLabel || `W${week}`
}

export function weekLongLabel(week: number) {
  const playoffRound = PLAYOFF_ROUNDS.find((round) => round.week === week)
  return playoffRound?.label || `Week ${week}`
}
