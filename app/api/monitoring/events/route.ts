import { NextRequest, NextResponse } from 'next/server'
import { getErrorMessage } from '@/lib/errorMessage'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type { Json } from '@/supabase/database.types'

export const dynamic = 'force-dynamic'

const SEVERITIES = new Set(['info', 'warning', 'error'])
const SOURCES = new Set(['client', 'server', 'cron'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function cleanRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const eventType = cleanText(body.eventType || body.event_type, 100) || 'unknown_event'
  const severity = cleanText(body.severity, 20)
  const source = cleanText(body.source, 20)
  const poolId = cleanText(body.poolId || body.pool_id, 80)
  const metadata = cleanRecord(body.metadata)
  const route = cleanText(body.route, 300) || cleanText(request.headers.get('referer'), 300)

  try {
    const supabaseAdmin = getSupabaseAdmin()
    await supabaseAdmin.from('app_event_logs').insert({
      event_type: eventType,
      severity: severity && SEVERITIES.has(severity) ? severity : 'error',
      source: source && SOURCES.has(source) ? source : 'client',
      route,
      pool_id: poolId && UUID_RE.test(poolId) ? poolId : null,
      message: cleanText(body.message, 1000),
      metadata: {
        ...metadata,
        user_agent: cleanText(request.headers.get('user-agent'), 300),
      } as Json,
    })
  } catch (e: unknown) {
    console.error('Monitoring event insert failed:', getErrorMessage(e, 'Unknown monitoring failure.'))
  }

  return NextResponse.json({ ok: true })
}
