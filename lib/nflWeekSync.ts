import type { ExistingNflGame } from './nflFeed.ts'

export type SeasonWeekWindow = {
  week: number
  week_sunday_date: string
}

export function targetWeeksForScoreSync(
  games: ExistingNflGame[],
  seasonWeeks: SeasonWeekWindow[],
  now = new Date(),
) {
  const nowMs = now.getTime()
  const lookBehindMs = 10 * 24 * 60 * 60 * 1000
  const lookAheadMs = 35 * 24 * 60 * 60 * 1000
  const weeks = new Set<number>()

  for (const game of games) {
    const kickoffMs = Date.parse(game.kickoff_at_utc || game.game_time)
    if (!Number.isFinite(kickoffMs)) continue
    const status = String(game.status || '').toLowerCase()
    const inWindow = kickoffMs >= nowMs - lookBehindMs && kickoffMs <= nowMs + lookAheadMs
    if (inWindow || status === 'in_progress' || status === 'postponed' || !game.kickoff_confirmed) weeks.add(game.week)
  }

  // A season-week row lets the sync discover a newly published schedule even
  // when no game rows exist yet (especially Wild Card through Super Bowl).
  for (const seasonWeek of seasonWeeks) {
    const roundDateMs = Date.parse(`${seasonWeek.week_sunday_date}T17:00:00Z`)
    if (Number.isFinite(roundDateMs) && roundDateMs >= nowMs - lookBehindMs && roundDateMs <= nowMs + lookAheadMs) {
      weeks.add(seasonWeek.week)
    }
  }

  return Array.from(weeks).filter((week) => week >= 1 && week <= 22).sort((a, b) => a - b)
}
