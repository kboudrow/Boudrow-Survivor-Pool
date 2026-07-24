import { NextRequest, NextResponse } from 'next/server'
import { cleanEnvValue } from '@/lib/env'
import { getErrorMessage } from '@/lib/errorMessage'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type { Json } from '@/supabase/database.types'

export const dynamic = 'force-dynamic'

type ActivePool = {
  id: string
  season: number | null
}

type ExistingGame = {
  season: number
  week: number
  game_time: string
  kickoff_at_utc: string | null
  status: string
}

type SyncedGame = {
  season: number
  week: number
  game_time: string
  kickoff_at_utc: string
  home_team: string
  away_team: string
  status: 'scheduled' | 'in_progress' | 'final'
  winner: string | null
  home_score: number | null
  away_score: number | null
  espn_event_id: string
}

type EspnCompetitor = {
  homeAway?: string
  score?: number | string | null
  winner?: boolean
  team?: {
    abbreviation?: string | null
  } | null
}

type EspnEvent = {
  id?: number | string | null
  date?: string | null
  status?: {
    type?: {
      completed?: boolean
      state?: string | null
      name?: string | null
      description?: string | null
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
  ARI: 'ARI',
  ATL: 'ATL',
  BAL: 'BAL',
  BUF: 'BUF',
  CAR: 'CAR',
  CHI: 'CHI',
  CIN: 'CIN',
  CLE: 'CLE',
  DAL: 'DAL',
  DEN: 'DEN',
  DET: 'DET',
  GB: 'GB',
  HOU: 'HOU',
  IND: 'IND',
  JAX: 'JAX',
  KC: 'KC',
  LV: 'LV',
  LAC: 'LAC',
  LAR: 'LAR',
  MIA: 'MIA',
  MIN: 'MIN',
  NE: 'NE',
  NO: 'NO',
  NYG: 'NYG',
  NYJ: 'NYJ',
  PHI: 'PHI',
  PIT: 'PIT',
  SEA: 'SEA',
  SF: 'SF',
  TB: 'TB',
  TEN: 'TEN',
  WAS: 'WAS',
  WSH: 'WAS',
}

function isAuthorized(request: NextRequest) {
  const secret = cleanEnvValue(process.env.CRON_SECRET)
  const auth = request.headers.get('authorization')

  if (!secret) return false
  return auth === `Bearer ${secret}`
}

function appTeam(value: unknown) {
  const abbreviation = String(value || '').trim().toUpperCase()
  const mapped = ESPN_TO_APP_TEAM[abbreviation]
  if (!mapped) throw new Error(`ESPN returned an unknown NFL team abbreviation: ${abbreviation || '(empty)'}`)
  return mapped
}

function scoreNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function espnStatus(event: EspnEvent): SyncedGame['status'] {
  const type = event?.status?.type
  const state = String(type?.state || '').toLowerCase()
  const name = String(type?.name || '').toLowerCase()
  const description = String(type?.description || '').toLowerCase()

  if (type?.completed || state === 'post' || name.includes('final') || description.includes('final')) return 'final'
  if (state === 'in' || name.includes('progress') || description.includes('quarter') || description.includes('halftime')) return 'in_progress'
  return 'scheduled'
}

function winnerFor(status: SyncedGame['status'], homeTeam: string, awayTeam: string, homeScore: number | null, awayScore: number | null, homeWinner: boolean, awayWinner: boolean) {
  if (status !== 'final') return null
  if (homeWinner) return homeTeam
  if (awayWinner) return awayTeam
  if (homeScore === null || awayScore === null || homeScore === awayScore) return null
  return homeScore > awayScore ? homeTeam : awayTeam
}

async function fetchEspnWeek(season: number, week: number): Promise<EspnEvent[]> {
  const url = new URL('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard')
  url.searchParams.set('dates', String(season))
  url.searchParams.set('seasontype', '2')
  url.searchParams.set('week', String(week))

  const response = await fetch(url, { next: { revalidate: 0 } })
  if (!response.ok) {
    throw new Error(`ESPN score sync failed for ${season} Week ${week}: ${response.status} ${response.statusText}`)
  }

  const body = await response.json()
  return Array.isArray(body?.events) ? body.events : []
}

function parseEspnGame(event: EspnEvent, season: number, week: number): SyncedGame | null {
  const competition = event?.competitions?.[0]
  const competitors = competition?.competitors
  if (!competition || !Array.isArray(competitors)) return null

  const home = competitors.find((team) => team?.homeAway === 'home')
  const away = competitors.find((team) => team?.homeAway === 'away')
  if (!home || !away) return null

  const homeTeam = appTeam(home?.team?.abbreviation)
  const awayTeam = appTeam(away?.team?.abbreviation)
  const gameTime = String(competition?.startDate || competition?.date || event?.date || '')
  if (!gameTime) return null

  const status = espnStatus(event)
  const homeScore = scoreNumber(home?.score)
  const awayScore = scoreNumber(away?.score)
  const winner = winnerFor(status, homeTeam, awayTeam, homeScore, awayScore, !!home?.winner, !!away?.winner)

  return {
    season,
    week,
    game_time: gameTime,
    kickoff_at_utc: gameTime,
    home_team: homeTeam,
    away_team: awayTeam,
    status,
    winner,
    home_score: homeScore,
    away_score: awayScore,
    espn_event_id: String(event?.id || competition?.id || `${season}-${week}-${awayTeam}-${homeTeam}`),
  }
}

function targetWeeksFromGames(games: ExistingGame[]) {
  const now = Date.now()
  const lookBehindMs = 10 * 24 * 60 * 60 * 1000
  const lookAheadMs = 4 * 24 * 60 * 60 * 1000
  const weeks = new Set<number>()

  for (const game of games) {
    const kickoffMs = Date.parse(game.kickoff_at_utc || game.game_time)
    if (!Number.isFinite(kickoffMs)) continue
    const status = String(game.status || '').toLowerCase()
    const inWindow = kickoffMs >= now - lookBehindMs && kickoffMs <= now + lookAheadMs
    if (inWindow || status === 'in_progress') weeks.add(game.week)
  }

  return Array.from(weeks).filter((week) => week >= 1 && week <= 18).sort((a, b) => a - b)
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const supabaseAdmin = getSupabaseAdmin()
  const logCronEvent = async (eventType: string, severity: 'info' | 'warning' | 'error', message: string, metadata: Record<string, unknown> = {}, poolId?: string) => {
    try {
      await supabaseAdmin.from('app_event_logs').insert({
        event_type: eventType,
        severity,
        source: 'cron',
        route: '/api/cron/sync-scores',
        pool_id: poolId || null,
        message,
        metadata: metadata as Json,
      })
    } catch (e: unknown) {
      console.error('Score sync monitoring insert failed:', getErrorMessage(e, 'Unknown monitoring failure.'))
    }
  }

  try {
    const { data: pools, error: poolsError } = await supabaseAdmin
      .from('pools')
      .select('id, season')
      .eq('archived', false)
      .eq('activation_status', 'active')

    if (poolsError) throw poolsError

    const overrideSeason = Number(cleanEnvValue(process.env.NFL_SCORE_SYNC_SEASON) || '')
    const fallbackSeason = Number.isFinite(overrideSeason) && overrideSeason > 2000 ? overrideSeason : new Date().getFullYear()
    const seasons = Array.from(new Set(((pools || []) as ActivePool[]).map((pool) => pool.season || fallbackSeason).concat(fallbackSeason))).sort()
    const syncedBySeasonWeek: Record<string, number[]> = {}
    const syncErrors: string[] = []
    let gamesSynced = 0
    let finalGamesSynced = 0

    for (const season of seasons) {
      const { data: existingGames, error: gamesError } = await supabaseAdmin
        .from('nfl_games')
        .select('season, week, game_time, kickoff_at_utc, status')
        .eq('season', season)

      if (gamesError) {
        syncErrors.push(`${season}: ${gamesError.message}`)
        continue
      }

      const targetWeeks = targetWeeksFromGames((existingGames || []) as ExistingGame[])
      syncedBySeasonWeek[String(season)] = targetWeeks

      for (const week of targetWeeks) {
        try {
          const events = await fetchEspnWeek(season, week)
          const games = events.map((event) => parseEspnGame(event, season, week)).filter(Boolean) as SyncedGame[]
          if (games.length === 0) continue

          const { error: upsertError } = await supabaseAdmin
            .from('nfl_games')
            .upsert(games, { onConflict: 'espn_event_id' })

          if (upsertError) throw upsertError
          gamesSynced += games.length
          finalGamesSynced += games.filter((game) => game.status === 'final').length
        } catch (e: unknown) {
          syncErrors.push(`${season} Week ${week}: ${getErrorMessage(e, 'Score sync failed.')}`)
        }
      }
    }

    let finalized = 0
    let adjudicated = 0
    const activePools = (pools || []) as ActivePool[]
    for (const pool of activePools) {
      const { data, error } = await supabaseAdmin.rpc('finalize_locked_picks_for_pool', { p_pool_id: pool.id })
      if (error) {
        syncErrors.push(`${pool.id}: ${error.message}`)
        await logCronEvent('cron_score_sync_finalize_failed', 'error', error.message, { season: pool.season }, pool.id)
        continue
      }
      finalized += typeof data === 'number' ? data : 0
    }

    for (const season of seasons) {
      const { data, error } = await supabaseAdmin.rpc('adjudicate_completed_weeks', { p_season: season })
      if (error) {
        syncErrors.push(`${season}: ${error.message}`)
        await logCronEvent('cron_score_sync_adjudicate_failed', 'error', error.message, { season })
        continue
      }
      adjudicated += typeof data === 'number' ? data : 0
    }

    await logCronEvent(
      syncErrors.length ? 'cron_score_sync_completed_with_errors' : 'cron_score_sync_completed',
      syncErrors.length ? 'warning' : 'info',
      syncErrors.length ? 'Score sync completed with errors.' : 'Score sync completed.',
      {
        seasons,
        target_weeks: syncedBySeasonWeek,
        duration_ms: Date.now() - startedAt,
        games_synced: gamesSynced,
        final_games_synced: finalGamesSynced,
        pools_checked: activePools.length,
        picks_finalized: finalized,
        results_adjudicated: adjudicated,
        errors: syncErrors,
      },
    )

    return NextResponse.json({
      ok: syncErrors.length === 0,
      seasons,
      targetWeeks: syncedBySeasonWeek,
      gamesSynced,
      finalGamesSynced,
      poolsChecked: activePools.length,
      picksFinalized: finalized,
      resultsAdjudicated: adjudicated,
      errors: syncErrors,
    })
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Score sync failed.')
    await logCronEvent('cron_score_sync_failed', 'error', message, { duration_ms: Date.now() - startedAt })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
