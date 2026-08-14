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

  for (const config of [server, edge]) {
    assert.match(config, /enabled: Boolean\(dsn\)/)
    assert.match(config, /sendDefaultPii: false/)
    assert.match(config, /sanitizeSentryEvent/)
  }

  assert.match(clientCapture, /if \(!dsn\) return null/)
  assert.match(clientCapture, /import\('@sentry\/nextjs'\)/)
  assert.match(clientCapture, /sendDefaultPii: false/)
  assert.match(instrumentation, /Sentry\.captureRequestError/)
  assert.match(client, /window\.addEventListener\('error'/)
  assert.match(client, /window\.addEventListener\('unhandledrejection'/)
  assert.match(routeError, /captureClientException\(error\)/)
  assert.match(globalError, /captureClientException\(error\)/)
})

test('Sentry strips competitive and personal request data and disables replay', () => {
  const privacy = read('lib/sentryPrivacy.ts')
  const client = read('lib/sentryClient.ts')

  assert.match(privacy, /event\.user = undefined/)
  assert.match(privacy, /event\.request\.query_string = undefined/)
  assert.match(privacy, /event\.request\.cookies = undefined/)
  assert.match(privacy, /event\.request\.data = undefined/)
  assert.match(privacy, /authorization/)
  assert.match(privacy, /breadcrumb\.category === 'ui\.input'/)
  assert.match(client, /replaysSessionSampleRate: 0/)
  assert.match(client, /replaysOnErrorSampleRate: 0/)
})
