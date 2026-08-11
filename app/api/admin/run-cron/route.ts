import { NextRequest, NextResponse } from 'next/server'
import { cleanEnvValue } from '@/lib/env'
import { getErrorMessage } from '@/lib/errorMessage'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'
const JOB_ROUTES = new Set(['/api/cron/lock-picks', '/api/cron/sync-scores'])

export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const { data: userData, error: userError } = await admin.auth.getUser(token)
  if (userError || userData.user?.email?.toLowerCase() !== SUPERADMIN_EMAIL) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 403 })
  }

  let route: string
  try {
    const body = await request.json() as { route?: unknown }
    route = typeof body.route === 'string' ? body.route : ''
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  }
  if (!JOB_ROUTES.has(route)) return NextResponse.json({ ok: false, error: 'Unknown job' }, { status: 400 })

  const cronSecret = cleanEnvValue(process.env.CRON_SECRET)
  if (!cronSecret) return NextResponse.json({ ok: false, error: 'Cron secret is not configured' }, { status: 503 })

  try {
    const response = await fetch(new URL(route, request.nextUrl.origin), {
      method: 'GET',
      headers: { authorization: `Bearer ${cronSecret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(55_000),
    })
    const result = await response.json().catch(() => ({ ok: false, error: 'Unexpected job response' }))
    return NextResponse.json(result, { status: response.status })
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(error, 'The production job could not be started.') },
      { status: 503 },
    )
  }
}
