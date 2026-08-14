import * as Sentry from '@sentry/nextjs'

export function captureClientException(error: unknown) {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.captureException(error)
}
