import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { cleanEnvValue } from '@/lib/env'
import { getErrorMessage } from '@/lib/errorMessage'
import type { Json } from '@/supabase/database.types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_TIME_BUDGET_MS = Number(process.env.CRON_TIME_BUDGET_MS || 50_000)

function isAuthorized(request: NextRequest) {
  const secret = cleanEnvValue(process.env.CRON_SECRET)
  const auth = request.headers.get('authorization')

  if (!secret) return false
  return auth === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const supabaseAdmin = getSupabaseAdmin()
  const hasTimeBudget = () => Date.now() - startedAt < CRON_TIME_BUDGET_MS
  const logCronEvent = async (
    eventType: string,
    severity: 'info' | 'warning' | 'error',
    message: string,
    metadata: Record<string, unknown> = {},
    poolId?: string,
  ) => {
    try {
      await supabaseAdmin.from('app_event_logs').insert({
        event_type: eventType,
        severity,
        source: 'cron',
        route: '/api/cron/lock-picks',
        pool_id: poolId || null,
        message,
        metadata: metadata as Json,
      })
    } catch (e: unknown) {
      console.error('Cron monitoring insert failed:', getErrorMessage(e, 'Unknown monitoring failure.'))
    }
  }

  await logCronEvent('cron_lock_picks_started', 'info', 'Pick lock cron started.')

  const { data: pools, error: poolsError } = await supabaseAdmin
    .from('pools')
    .select('id, season')
    .eq('archived', false)
    .eq('activation_status', 'active')
    .or('test_mode.is.null,test_mode.eq.false')

  if (poolsError) {
    await logCronEvent('cron_pool_load_failed', 'error', poolsError.message)
    return NextResponse.json({ error: poolsError.message }, { status: 500 })
  }

  let finalized = 0
  let poolsChecked = 0
  const seasons = new Set<number>()
  const errors: string[] = []

  for (const pool of pools || []) {
    if (!hasTimeBudget()) {
      const message = 'Pick lock cron stopped before the platform timeout. The next scheduled run will continue.'
      errors.push(message)
      await logCronEvent('cron_lock_picks_time_budget_exhausted', 'warning', message, {
        duration_ms: Date.now() - startedAt,
        pools_checked_so_far: poolsChecked,
      })
      break
    }
    poolsChecked += 1
    const { data, error } = await supabaseAdmin.rpc('finalize_locked_picks_for_pool', { p_pool_id: pool.id })
    if (error) {
      errors.push(`${pool.id}: ${error.message}`)
      await logCronEvent('cron_finalize_pool_failed', 'error', error.message, { season: pool.season }, pool.id)
      continue
    }
    finalized += typeof data === 'number' ? data : 0
    seasons.add(pool.season || new Date().getFullYear())
  }

  let adjudicated = 0
  for (const season of seasons) {
    if (!hasTimeBudget()) {
      const message = 'Pick lock cron skipped remaining adjudication before the platform timeout. The next scheduled run will continue.'
      errors.push(message)
      await logCronEvent('cron_lock_picks_adjudication_deferred', 'warning', message, {
        duration_ms: Date.now() - startedAt,
        seasons_checked_so_far: adjudicated,
      })
      break
    }
    const { data, error } = await supabaseAdmin.rpc('adjudicate_completed_weeks', { p_season: season })
    if (error) {
      errors.push(`season ${season}: ${error.message}`)
      await logCronEvent('cron_adjudicate_season_failed', 'error', error.message, { season })
      continue
    }
    adjudicated += typeof data === 'number' ? data : 0
  }

  await logCronEvent(
    errors.length ? 'cron_lock_picks_completed_with_errors' : 'cron_lock_picks_completed',
    errors.length ? 'warning' : 'info',
    errors.length ? 'Pick lock cron completed with errors.' : 'Pick lock cron completed.',
    {
      duration_ms: Date.now() - startedAt,
      pools_checked: poolsChecked,
      pools_total: pools?.length || 0,
      seasons: Array.from(seasons).sort(),
      picks_finalized: finalized,
      results_adjudicated: adjudicated,
      errors,
    },
  )

  return NextResponse.json({
    ok: errors.length === 0,
    poolsChecked,
    poolsTotal: pools?.length || 0,
    picksFinalized: finalized,
    resultsAdjudicated: adjudicated,
    errors,
  }, errors.length ? {
    status: 503,
    headers: { 'Retry-After': '30' },
  } : undefined)
}
