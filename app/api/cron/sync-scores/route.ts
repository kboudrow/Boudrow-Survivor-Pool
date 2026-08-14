import { NextRequest, NextResponse } from 'next/server'
import { cleanEnvValue } from '@/lib/env'
import { getErrorMessage } from '@/lib/errorMessage'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type { Json } from '@/supabase/database.types'
import { fetchProviderWeek, validateProviderWeek, type ExistingNflGame } from '@/lib/nflFeed'
import { targetWeeksForScoreSync, type SeasonWeekWindow } from '@/lib/nflWeekSync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SCORE_SYNC_TIME_BUDGET_MS = Number(process.env.SCORE_SYNC_TIME_BUDGET_MS || 50_000)
const ESPN_FETCH_TIMEOUT_MS = Number(process.env.ESPN_FETCH_TIMEOUT_MS || 12_000)

type ActivePool = {
  id: string
  season: number | null
}

function isAuthorized(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const secrets = [
    cleanEnvValue(process.env.CRON_SECRET),
    cleanEnvValue(process.env.SUPABASE_CRON_SECRET),
  ].filter(Boolean)

  return secrets.some((secret) => auth === `Bearer ${secret}`)
}

function currentNflSeason(now = new Date()) {
  const year = now.getUTCFullYear()
  return now.getUTCMonth() < 2 ? year - 1 : year
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const supabaseAdmin = getSupabaseAdmin()
  const hasTimeBudget = () => Date.now() - startedAt < SCORE_SYNC_TIME_BUDGET_MS
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
    await logCronEvent('cron_score_sync_started', 'info', 'Score sync cron started.')

    const { data: pools, error: poolsError } = await supabaseAdmin
      .from('pools')
      .select('id, season')
      .eq('archived', false)
      .eq('activation_status', 'active')
      .or('test_mode.is.null,test_mode.eq.false')

    if (poolsError) throw poolsError

    const overrideSeason = Number(cleanEnvValue(process.env.NFL_SCORE_SYNC_SEASON) || '')
    const fallbackSeason = Number.isFinite(overrideSeason) && overrideSeason > 2000 ? overrideSeason : currentNflSeason()
    const seasons = Array.from(new Set(((pools || []) as ActivePool[]).map((pool) => pool.season || fallbackSeason).concat(fallbackSeason))).sort()
    const syncedBySeasonWeek: Record<string, number[]> = {}
    const syncErrors: string[] = []
    let gamesSynced = 0
    let finalGamesSynced = 0

    for (const season of seasons) {
      if (!hasTimeBudget()) {
        const message = 'Score sync stopped before the platform timeout. The next scheduled run will continue.'
        syncErrors.push(message)
        await logCronEvent('cron_score_sync_time_budget_exhausted', 'warning', message, {
          duration_ms: Date.now() - startedAt,
          seasons_checked: Object.keys(syncedBySeasonWeek),
        })
        break
      }
      const { data: existingGames, error: gamesError } = await supabaseAdmin
        .from('nfl_games')
        .select('season, week, game_time, kickoff_at_utc, home_team, away_team, espn_event_id, status, kickoff_confirmed')
        .eq('season', season)

      if (gamesError) {
        syncErrors.push(`${season}: ${gamesError.message}`)
        continue
      }

      const { data: seasonWeeks, error: seasonWeeksError } = await supabaseAdmin
        .from('season_weeks')
        .select('week, week_sunday_date')
        .eq('season', season)

      if (seasonWeeksError) {
        syncErrors.push(`${season}: ${seasonWeeksError.message}`)
        continue
      }

      const knownGames = (existingGames || []) as ExistingNflGame[]
      const targetWeeks = targetWeeksForScoreSync(knownGames, (seasonWeeks || []) as SeasonWeekWindow[])
      syncedBySeasonWeek[String(season)] = targetWeeks

      for (const week of targetWeeks) {
        if (!hasTimeBudget()) {
          const message = `Score sync deferred remaining weeks for ${season} before the platform timeout.`
          syncErrors.push(message)
          await logCronEvent('cron_score_sync_time_budget_exhausted', 'warning', message, {
            duration_ms: Date.now() - startedAt,
            season,
            weeks_checked: syncedBySeasonWeek[String(season)],
          })
          break
        }
        try {
          const events = await fetchProviderWeek(season, week, { timeoutMs: ESPN_FETCH_TIMEOUT_MS, attempts: 3 })
          const games = validateProviderWeek(events, season, week, knownGames)

          const { error: upsertError } = await supabaseAdmin
            .from('nfl_games')
            .upsert(games, { onConflict: 'season,week,home_team,away_team' })

          if (upsertError) throw upsertError
          gamesSynced += games.length
          finalGamesSynced += games.filter((game) => game.status === 'final').length
        } catch (e: unknown) {
          const message = getErrorMessage(e, 'Score provider week was rejected.')
          syncErrors.push(`${season} Week ${week}: ${message}`)
          await logCronEvent('score_provider_week_rejected', 'error', message, { season, week })
        }
      }
    }

    let finalized = 0
    let adjudicated = 0
    const activePools = (pools || []) as ActivePool[]
    let poolsChecked = 0
    for (const pool of activePools) {
      if (!hasTimeBudget()) {
        const message = 'Score sync deferred remaining pick finalization before the platform timeout. The next scheduled run will continue.'
        syncErrors.push(message)
        await logCronEvent('cron_score_sync_finalize_deferred', 'warning', message, {
          duration_ms: Date.now() - startedAt,
          pools_checked: poolsChecked,
          pools_total: activePools.length,
        })
        break
      }
      poolsChecked += 1
      const { data, error } = await supabaseAdmin.rpc('finalize_locked_picks_for_pool', { p_pool_id: pool.id })
      if (error) {
        syncErrors.push(`${pool.id}: ${error.message}`)
        await logCronEvent('cron_score_sync_finalize_failed', 'error', error.message, { season: pool.season }, pool.id)
        continue
      }
      finalized += typeof data === 'number' ? data : 0
    }

    for (const season of seasons) {
      if (!hasTimeBudget()) {
        const message = 'Score sync deferred remaining adjudication before the platform timeout. The next scheduled run will continue.'
        syncErrors.push(message)
        await logCronEvent('cron_score_sync_adjudication_deferred', 'warning', message, {
          duration_ms: Date.now() - startedAt,
          results_adjudicated: adjudicated,
        })
        break
      }
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
        pools_checked: poolsChecked,
        pools_total: activePools.length,
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
      poolsChecked,
      poolsTotal: activePools.length,
      picksFinalized: finalized,
      resultsAdjudicated: adjudicated,
      errors: syncErrors,
    }, syncErrors.length ? {
      status: 503,
      headers: { 'Retry-After': '30' },
    } : undefined)
  } catch (e: unknown) {
    const message = getErrorMessage(e, 'Score sync failed.')
    await logCronEvent('cron_score_sync_failed', 'error', message, { duration_ms: Date.now() - startedAt })
    return NextResponse.json({ ok: false, error: message }, {
      status: 503,
      headers: { 'Retry-After': '30' },
    })
  }
}
