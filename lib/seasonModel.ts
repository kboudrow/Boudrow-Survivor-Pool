export const REGULAR_SEASON_LAST_WEEK = 18
export const PLAYOFF_LAST_WEEK = 22
export const LAST_DOUBLE_PICK_WEEK = 21

export const PLAYOFF_ROUNDS = [
  { week: 19, shortLabel: 'WC', label: 'Wild Card', expectedGames: 6 },
  { week: 20, shortLabel: 'DIV', label: 'Divisional', expectedGames: 4 },
  { week: 21, shortLabel: 'CONF', label: 'Conference Championship', expectedGames: 2 },
  { week: 22, shortLabel: 'SB', label: 'Super Bowl', expectedGames: 1 },
] as const

export function maxWeekForPool(pool?: { include_playoffs?: boolean | null } | null) {
  return pool?.include_playoffs ? PLAYOFF_LAST_WEEK : REGULAR_SEASON_LAST_WEEK
}

export function seasonWeeksForPool(pool?: { include_playoffs?: boolean | null } | null) {
  return Array.from({ length: maxWeekForPool(pool) }, (_, index) => index + 1)
}

export function configurableDoublePickWeeks(pool?: { include_playoffs?: boolean | null } | null) {
  const max = pool?.include_playoffs ? LAST_DOUBLE_PICK_WEEK : REGULAR_SEASON_LAST_WEEK
  return Array.from({ length: max }, (_, index) => index + 1)
}

export function weekShortLabel(week: number) {
  return PLAYOFF_ROUNDS.find((round) => round.week === week)?.shortLabel || `W${week}`
}

export function weekLongLabel(week: number) {
  return PLAYOFF_ROUNDS.find((round) => round.week === week)?.label || `Week ${week}`
}

export function expectedPostseasonGameCount(week: number) {
  return PLAYOFF_ROUNDS.find((round) => round.week === week)?.expectedGames ?? null
}
