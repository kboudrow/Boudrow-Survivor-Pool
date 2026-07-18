import { getErrorMessage } from '@/lib/errorMessage'

type Severity = 'info' | 'warning' | 'error'
type Source = 'client' | 'server' | 'cron'

type LogAppEventInput = {
  eventType: string
  severity?: Severity
  source?: Source
  route?: string
  poolId?: string | null
  message?: string
  error?: unknown
  metadata?: Record<string, unknown>
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

export function logAppEvent(input: LogAppEventInput) {
  if (typeof window === 'undefined') return Promise.resolve()

  const route = input.route || `${window.location.pathname}${window.location.search}`
  const message = input.message || (input.error ? getErrorMessage(input.error, 'Unexpected error') : undefined)
  const payload = {
    eventType: cleanText(input.eventType, 100) || 'unknown_event',
    severity: input.severity || 'error',
    source: input.source || 'client',
    route,
    poolId: input.poolId || null,
    message,
    metadata: input.metadata || {},
  }
  const body = JSON.stringify(payload)

  try {
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon('/api/monitoring/events', new Blob([body], { type: 'application/json' }))
      if (sent) return Promise.resolve()
    }
  } catch {
    // Fall back to fetch below.
  }

  return fetch('/api/monitoring/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined)
}

