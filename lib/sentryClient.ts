import { sanitizeSentryBreadcrumb, sanitizeSentryEvent } from '@/lib/sentryPrivacy'

let clientPromise: Promise<typeof import('@sentry/nextjs')> | null = null

async function getSentryClient() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return null

  if (!clientPromise) {
    clientPromise = import('@sentry/nextjs').then((Sentry) => {
      if (!Sentry.isInitialized()) {
        Sentry.init({
          dsn,
          enabled: true,
          environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
          sendDefaultPii: false,
          tracesSampleRate: 0,
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
          maxBreadcrumbs: 30,
          beforeSend: sanitizeSentryEvent,
          beforeBreadcrumb: sanitizeSentryBreadcrumb,
        })
      }
      return Sentry
    })
  }

  return clientPromise
}

export async function captureClientException(error: unknown) {
  const Sentry = await getSentryClient()
  Sentry?.captureException(error)
}
