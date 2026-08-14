import { captureClientException } from '@/lib/sentryClient'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  window.addEventListener('error', (event) => {
    void captureClientException(event.error || new Error(event.message))
  })

  window.addEventListener('unhandledrejection', (event) => {
    void captureClientException(event.reason)
  })
}

// Client navigation tracing is intentionally disabled to keep the monitoring
// bundle off the critical path. Error capture loads Sentry only when needed.
export function onRouterTransitionStart() {}
