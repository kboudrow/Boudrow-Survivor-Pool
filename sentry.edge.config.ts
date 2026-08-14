import * as Sentry from '@sentry/nextjs'
import { sanitizeSentryBreadcrumb, sanitizeSentryEvent, sanitizeSentryTransaction } from '@/lib/sentryPrivacy'

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  sendDefaultPii: false,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
  maxBreadcrumbs: 30,
  beforeSend: sanitizeSentryEvent,
  beforeSendTransaction: sanitizeSentryTransaction,
  beforeBreadcrumb: sanitizeSentryBreadcrumb,
})
