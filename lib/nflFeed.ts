export type NflFeedStatus = 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'canceled'

export type SyncedNflGame = {
  season: number
  week: number
  game_time: string
  kickoff_at_utc: string
  home_team: string
  away_team: string
  status: NflFeedStatus
  winner: string | null
  home_score: number | null
  away_score: number | null
  espn_event_id: string
  kickoff_confirmed: boolean
}

export type ExistingNflGame = {
  season: number
  week: number
  game_time: string
  kickoff_at_utc: string | null
  home_team: string
  away_team: string
  espn_event_id: string
  status: string
  kickoff_confirmed: boolean
}

type EspnCompetitor = {
  homeAway?: string
  score?: number | string | null
  winner?: boolean
  team?: { abbreviation?: string | null } | null
}

export type EspnEvent = {
  id?: number | string | null
  date?: string | null
  status?: {
    type?: {
      completed?: boolean
      state?: string | null
      name?: string | null
      description?: string | null
      detail?: string | null
      shortDetail?: string | null
    } | null
  } | null
  competitions?: Array<{
    id?: number | string | null
    date?: string | null
    startDate?: string | null
    competitors?: EspnCompetitor[] | null
  }> | null
}

const ESPN_TO_APP_TEAM: Record<string, string> = {
  ARI: 'ARI', ATL: 'ATL', BAL: 'BAL', BUF: 'BUF', CAR: 'CAR', CHI: 'CHI', CIN: 'CIN', CLE: 'CLE',
  DAL: 'DAL', DEN: 'DEN', DET: 'DET', GB: 'GB', HOU: 'HOU', IND: 'IND', JAX: 'JAX', KC: 'KC',
  LV: 'LV', LAC: 'LAC', LAR: 'LAR', MIA: 'MIA', MIN: 'MIN', NE: 'NE', NO: 'NO', NYG: 'NYG',
  NYJ: 'NYJ', PHI: 'PHI', PIT: 'PIT', SEA: 'SEA', SF: 'SF', TB: 'TB', TEN: 'TEN', WAS: 'WAS',
  WSH: 'WAS',
}

function appTeam(value: unknown) {
  const abbreviation = String(value || '').trim().toUpperCase()
  const mapped = ESPN_TO_APP_TEAM[abbreviation]
  if (!mapped) throw new Error(`Provider returned an unknown NFL team abbreviation: ${abbreviation || '(empty)'}`)
  return mapped
}

function scoreNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

export function providerStatus(event: EspnEvent): NflFeedStatus {
  const type = event.status?.type
  const label = `${type?.state || ''} ${type?.name || ''} ${type?.description || ''} ${type?.detail || ''} ${type?.shortDetail || ''}`.toLowerCase()

  if (label.includes('cancel')) return 'canceled'
  if (label.includes('postpon') || label.includes('delay')) return 'postponed'
  // A suspended game has begun, so it must remain locked, but it is not gradeable.
  if (label.includes('suspend')) return 'in_progress'
  if (type?.completed || type?.state?.toLowerCase() === 'post' || label.includes('final')) return 'final'
  if (type?.state?.toLowerCase() === 'in' || label.includes('progress') || label.includes('quarter') || label.includes('halftime')) return 'in_progress'
  return 'scheduled'
}

function kickoffIsConfirmed(event: EspnEvent) {
  const type = event.status?.type
  const label = `${type?.detail || ''} ${type?.shortDetail || ''}`.toLowerCase()
  return !label.includes('tbd') && !label.includes('to be determined')
}

export function parseProviderGame(event: EspnEvent, season: number, week: number): SyncedNflGame {
  const competition = event.competitions?.[0]
  const competitors = competition?.competitors
  if (!competition || !Array.isArray(competitors)) throw new Error('Provider game is missing its competition or teams.')

  const home = competitors.find((team) => team?.homeAway === 'home')
  const away = competitors.find((team) => team?.homeAway === 'away')
  if (!home || !away) throw new Error('Provider game is missing a home or away team.')

  const homeTeam = appTeam(home.team?.abbreviation)
  const awayTeam = appTeam(away.team?.abbreviation)
  const rawGameTime = competition.startDate || competition.date || event.date
  const kickoffMs = Date.parse(String(rawGameTime || ''))
  if (!Number.isFinite(kickoffMs)) throw new Error(`Provider returned an invalid kickoff for ${awayTeam} @ ${homeTeam}.`)
  const gameTime = new Date(kickoffMs).toISOString()
  const status = providerStatus(event)
  const homeScore = scoreNumber(home.score)
  const awayScore = scoreNumber(away.score)

  if (status === 'final' && (homeScore === null || awayScore === null)) {
    throw new Error(`Provider marked ${awayTeam} @ ${homeTeam} final without valid scores.`)
  }

  const scoreWinner = status === 'final' && homeScore !== awayScore
    ? (Number(homeScore) > Number(awayScore) ? homeTeam : awayTeam)
    : null
  const flaggedWinner = home.winner ? homeTeam : away.winner ? awayTeam : null
  if (home.winner && away.winner) throw new Error(`Provider marked both teams as winners for ${awayTeam} @ ${homeTeam}.`)
  if (status === 'final' && flaggedWinner && flaggedWinner !== scoreWinner) {
    throw new Error(`Provider winner conflicts with the score for ${awayTeam} @ ${homeTeam}.`)
  }

  return {
    season,
    week,
    game_time: gameTime,
    kickoff_at_utc: gameTime,
    home_team: homeTeam,
    away_team: awayTeam,
    status,
    winner: scoreWinner,
    home_score: homeScore,
    away_score: awayScore,
    espn_event_id: String(event.id || competition.id || `${season}-${week}-${awayTeam}-${homeTeam}`),
    kickoff_confirmed: kickoffIsConfirmed(event),
  }
}

const matchupKey = (game: Pick<SyncedNflGame, 'home_team' | 'away_team'>) => `${game.away_team}@${game.home_team}`

export function validateProviderWeek(events: EspnEvent[], season: number, week: number, existing: ExistingNflGame[]) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('Provider returned an empty week; last known schedule was preserved.')
  const games = events.map((event) => parseProviderGame(event, season, week))
  const matchups = games.map(matchupKey)
  const eventIds = games.map((game) => game.espn_event_id)
  if (new Set(matchups).size !== matchups.length) throw new Error('Provider returned duplicate matchups; the entire week was rejected.')
  if (new Set(eventIds).size !== eventIds.length) throw new Error('Provider returned duplicate game ids; the entire week was rejected.')

  const existingWeek = existing.filter((game) => game.week === week)
  if (existingWeek.length > 0) {
    const incoming = new Set(matchups)
    const missing = existingWeek.map(matchupKey).filter((key) => !incoming.has(key))
    if (missing.length > 0) {
      throw new Error(`Provider response omitted known games (${missing.join(', ')}); the entire week was rejected.`)
    }
  }
  return games
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
class NonRetryableProviderError extends Error {}

export async function fetchProviderWeek(
  season: number,
  week: number,
  options: { timeoutMs: number; attempts?: number; fetchImpl?: typeof fetch } = { timeoutMs: 12_000 },
): Promise<EspnEvent[]> {
  const playoffWeekMap: Record<number, number> = { 19: 1, 20: 2, 21: 3, 22: 5 }
  const espnWeek = week <= 18 ? week : playoffWeekMap[week]
  if (!espnWeek) throw new Error(`Unsupported NFL week ${week}.`)

  const url = new URL('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard')
  url.searchParams.set('dates', String(season))
  url.searchParams.set('seasontype', week <= 18 ? '2' : '3')
  url.searchParams.set('week', String(espnWeek))
  const attempts = Math.max(1, options.attempts ?? 3)
  const fetchImpl = options.fetchImpl ?? fetch
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { next: { revalidate: 0 }, signal: AbortSignal.timeout(options.timeoutMs) })
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500
        const error = new Error(`Provider request failed: ${response.status} ${response.statusText}`)
        if (!retryable) throw new NonRetryableProviderError(error.message)
        if (attempt === attempts) throw error
        lastError = error
      } else {
        let body: unknown
        try {
          body = await response.json()
        } catch {
          throw new Error('Provider returned invalid JSON.')
        }
        const events = (body as { events?: unknown } | null)?.events
        if (!Array.isArray(events)) throw new Error('Provider response is missing its events list.')
        return events as EspnEvent[]
      }
    } catch (error) {
      if (error instanceof NonRetryableProviderError) throw error
      lastError = error
      if (attempt === attempts) break
    }
    await wait(200 * attempt)
  }
  throw lastError instanceof Error ? lastError : new Error('Provider request failed.')
}
