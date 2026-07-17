import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { cleanEnvValue } from '@/lib/env'

export const dynamic = 'force-dynamic'

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

  const { data: pools, error: poolsError } = await supabaseAdmin
    .from('pools')
    .select('id, season')
    .eq('archived', false)
    .eq('activation_status', 'active')

  if (poolsError) {
    return NextResponse.json({ error: poolsError.message }, { status: 500 })
  }

  let finalized = 0
  const seasons = new Set<number>()
  const errors: string[] = []

  for (const pool of pools || []) {
    const { data, error } = await supabaseAdmin.rpc('finalize_locked_picks_for_pool', { p_pool_id: pool.id })
    if (error) {
      errors.push(`${pool.id}: ${error.message}`)
      continue
    }
    finalized += typeof data === 'number' ? data : 0
    seasons.add(pool.season || new Date().getFullYear())
  }

  let adjudicated = 0
  for (const season of seasons) {
    const { data, error } = await supabaseAdmin.rpc('adjudicate_completed_weeks', { p_season: season })
    if (error) {
      errors.push(`season ${season}: ${error.message}`)
      continue
    }
    adjudicated += typeof data === 'number' ? data : 0
  }

  return NextResponse.json({
    ok: errors.length === 0,
    poolsChecked: pools?.length || 0,
    picksFinalized: finalized,
    resultsAdjudicated: adjudicated,
    errors,
  })
}
