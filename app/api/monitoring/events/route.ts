import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { getErrorMessage } from '@/lib/errorMessage'
import { cleanEnvValue } from '@/lib/env'
import { sanitizeLogMetadata } from '@/lib/security'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import type { Json } from '@/supabase/database.types'

export const dynamic = 'force-dynamic'

const SEVERITIES = new Set(['info', 'warning', 'error'])
const SOURCES = new Set(['client', 'server', 'cron'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BODY_BYTES = 8192
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_EVENTS = 30

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function cleanRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return sanitizeLogMetadata(value) as Record<string, unknown>
}

function cleanEventType(value: unknown) {
  const cleaned = cleanText(value, 100) || 'unknown_event'
  return cleaned.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100) || 'unknown_event'
}

function requestFingerprint(request: NextRequest) {
  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip')?.trim()
  const userAgent = request.headers.get('user-agent')?.slice(0, 120) || 'unknown-agent'
  const salt = cleanEnvValue(process.env.MONITORING_RATE_LIMIT_SALT) || cleanEnvValue(process.env.CRON_SECRET)
  if (!salt) throw new Error('Monitoring rate-limit salt is not configured.')
  return createHmac('sha256', salt).update(`${vercelForwardedFor || realIp || forwardedFor || 'unknown-ip'}:${userAgent}`).digest('hex')
}

async function isRateLimited(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin.rpc('consume_monitoring_rate_limit', {
    p_fingerprint: requestFingerprint(request),
    p_limit: RATE_LIMIT_MAX_EVENTS,
    p_window_seconds: RATE_LIMIT_WINDOW_MS / 1000,
  })
  if (error) throw error
  return data !== true
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>

  const contentLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 })
  }
  try {
    if (await isRateLimited(request)) return NextResponse.json({ ok: false }, { status: 429 })
  } catch (e: unknown) {
    console.error('Monitoring rate-limit check failed:', getErrorMessage(e, 'Unknown rate-limit failure.'))
    return NextResponse.json({ ok: false }, { status: 503 })
  }

  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 })
    }
    const parsed = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const eventType = cleanEventType(body.eventType || body.event_type)
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
