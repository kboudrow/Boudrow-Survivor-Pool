import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Sentry stays disabled without a DSN and captures server, edge, and client failures', () => {
  const client = read('instrumentation-client.ts')
  const clientCapture = read('lib/sentryClient.ts')
  const server = read('sentry.server.config.ts')
  const edge = read('sentry.edge.config.ts')
  const instrumentation = read('instrumentation.ts')
  const routeError = read('app/error.tsx')
  const globalError = read('app/global-error.tsx')

  for (const config of [client, server, edge]) {
    assert.match(config, /enabled: Boolean\(dsn\)/)
    assert.match(config, /sendDefaultPii: false/)
    assert.match(config, /sanitizeSentryEvent/)
    assert.match(config, /beforeSendTransaction: sanitizeSentryTransaction/)
    assert.match(config, /tracesSampleRate: process\.env\.NODE_ENV === 'production' \? 0\.1 : 1/)
  }

  assert.match(clientCapture, /NEXT_PUBLIC_SENTRY_DSN/)
  assert.match(clientCapture, /Sentry\.captureException\(error\)/)
  assert.match(instrumentation, /Sentry\.captureRequestError/)
  assert.match(client, /Sentry\.captureRouterTransitionStart/)
  assert.match(routeError, /captureClientException\(error\)/)
  assert.match(globalError, /captureClientException\(error\)/)
})

test('Sentry strips competitive and personal request data and disables replay', () => {
  const privacy = read('lib/sentryPrivacy.ts')
  const client = read('instrumentation-client.ts')

  assert.match(privacy, /event\.user = undefined/)
  assert.match(privacy, /event\.request\.query_string = undefined/)
  assert.match(privacy, /event\.request\.cookies = undefined/)
  assert.match(privacy, /event\.request\.data = undefined/)
  assert.match(privacy, /authorization/)
  assert.match(privacy, /breadcrumb\.category === 'ui\.input'/)
  assert.match(privacy, /sanitizeSentryTransaction/)
  assert.match(privacy, /span\.description = stripQueryString/)
  assert.match(client, /replaysSessionSampleRate: 0/)
  assert.match(client, /replaysOnErrorSampleRate: 0/)
})
