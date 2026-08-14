import * as Sentry from '@sentry/nextjs'
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent, sanitizeSentryTransaction } from '@/lib/sentryPrivacy'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  maxBreadcrumbs: 30,
  beforeSend: sanitizeSentryEvent,
  beforeSendTransaction: sanitizeSentryTransaction,
  beforeBreadcrumb: sanitizeSentryBreadcrumb,
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
