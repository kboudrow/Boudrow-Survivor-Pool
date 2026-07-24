const target = process.env.LOAD_TEST_TARGET
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 25)
const rounds = Number(process.env.LOAD_TEST_ROUNDS || 4)
const warmup = Number(process.env.LOAD_TEST_WARMUP || 1)
const p95BudgetMs = Number(process.env.LOAD_TEST_P95_BUDGET_MS || 2500)
const failOnStatus = process.env.LOAD_TEST_FAIL_ON_STATUS !== 'false'
const authHeader = process.env.LOAD_TEST_AUTH_HEADER || ''
const jsonOutput = process.env.LOAD_TEST_JSON === 'true'
const paths = (process.env.LOAD_TEST_PATHS || '/,/join/search,/blog,/faq,/survivor-pool-rules,/demo-league')
  .split(',')
  .map((path) => path.trim())
  .filter(Boolean)

const headers = {
  'user-agent': 'survive-sunday-load-test/1.0',
  ...(authHeader ? { authorization: authHeader } : {}),
}

if (!target) {
  console.error('Set LOAD_TEST_TARGET before running load tests. Example: LOAD_TEST_TARGET=http://localhost:3000 npm run load:test')
  process.exit(1)
}

if (!Number.isFinite(concurrency) || concurrency < 1) {
  console.error('LOAD_TEST_CONCURRENCY must be a positive number.')
  process.exit(1)
}

if (!Number.isFinite(rounds) || rounds < 1) {
  console.error('LOAD_TEST_ROUNDS must be a positive number.')
  process.exit(1)
}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((pct / 100) * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]
}

function mean(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

async function hit(path, phase) {
  const url = new URL(path, target).toString()
  const started = performance.now()
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      cache: 'no-store',
    })
    const body = await response.arrayBuffer()
    return {
      phase,
      path,
      status: response.status,
      ok: response.ok,
      ms: performance.now() - started,
      bytes: body.byteLength,
    }
  } catch (error) {
    return {
      phase,
      path,
      status: 0,
      ok: false,
      ms: performance.now() - started,
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runPhase(phase, phaseConcurrency, phaseRounds) {
  const results = []
  const started = performance.now()
  await Promise.all(Array.from({ length: phaseConcurrency }, async (_, id) => {
    for (let round = 0; round < phaseRounds; round += 1) {
      const path = paths[(id + round) % paths.length]
      results.push(await hit(path, phase))
    }
  }))
  return { phase, totalMs: performance.now() - started, results }
}

function summarize(results) {
  const durations = results.map((result) => result.ms)
  const failures = results.filter((result) => !result.ok)
  const statusCounts = new Map()
  const byPath = new Map()

  for (const result of results) {
    statusCounts.set(result.status, (statusCounts.get(result.status) || 0) + 1)
    const current = byPath.get(result.path) || { count: 0, failures: 0, bytes: 0, ms: [] }
    current.count += 1
    if (!result.ok) current.failures += 1
    current.bytes += result.bytes
    current.ms.push(result.ms)
    byPath.set(result.path, current)
  }

  const pathSummaries = Array.from(byPath.entries()).map(([path, stats]) => ({
    path,
    count: stats.count,
    failures: stats.failures,
    avgMs: Math.round(mean(stats.ms)),
    p50Ms: Math.round(percentile(stats.ms, 50)),
    p95Ms: Math.round(percentile(stats.ms, 95)),
    maxMs: Math.round(Math.max(...stats.ms)),
    avgBytes: Math.round(stats.bytes / Math.max(1, stats.count)),
  }))

  return {
    requests: results.length,
    failures: failures.length,
    statusCounts: Object.fromEntries(Array.from(statusCounts.entries()).sort(([a], [b]) => Number(a) - Number(b))),
    p50Ms: Math.round(percentile(durations, 50)),
    p95Ms: Math.round(percentile(durations, 95)),
    maxMs: Math.round(Math.max(...durations)),
    avgMs: Math.round(mean(durations)),
    paths: pathSummaries.sort((a, b) => b.p95Ms - a.p95Ms),
    sampleFailures: failures.slice(0, 8).map((failure) => ({
      path: failure.path,
      status: failure.status,
      error: failure.error || null,
      ms: Math.round(failure.ms),
    })),
  }
}

const started = performance.now()
const warmupResult = warmup > 0 ? await runPhase('warmup', Math.min(concurrency, Math.max(1, paths.length)), warmup) : { phase: 'warmup', totalMs: 0, results: [] }
const mainResult = await runPhase('main', concurrency, rounds)
const totalMs = performance.now() - started
const summary = summarize(mainResult.results)
const slowPaths = summary.paths.filter((path) => path.p95Ms > p95BudgetMs)
const hasStatusFailures = failOnStatus && summary.failures > 0
const hasLatencyFailures = slowPaths.length > 0

const report = {
  target,
  paths,
  concurrency,
  rounds,
  warmup,
  p95BudgetMs,
  totalMs: Math.round(totalMs),
  warmupMs: Math.round(warmupResult.totalMs),
  mainMs: Math.round(mainResult.totalMs),
  ...summary,
  slowPaths,
  ok: !hasStatusFailures && !hasLatencyFailures,
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Target: ${target}`)
  console.log(`Paths: ${paths.join(', ')}`)
  console.log(`Requests: ${summary.requests} (${concurrency} concurrent x ${rounds} rounds)`)
  console.log(`Warmup: ${warmupResult.results.length} requests in ${Math.round(warmupResult.totalMs)}ms`)
  console.log(`Main time: ${Math.round(mainResult.totalMs)}ms`)
  console.log(`Failures: ${summary.failures}`)
  console.log(`Status counts: ${JSON.stringify(report.statusCounts)}`)
  console.log(`Latency avg/p50/p95/max: ${summary.avgMs}ms / ${summary.p50Ms}ms / ${summary.p95Ms}ms / ${summary.maxMs}ms`)
  console.log('')
  console.log('Per path:')
  for (const path of summary.paths) {
    console.log(
      `${path.path}: count=${path.count} failures=${path.failures} avg=${path.avgMs}ms p50=${path.p50Ms}ms p95=${path.p95Ms}ms max=${path.maxMs}ms avgBytes=${path.avgBytes}`,
    )
  }

  if (summary.sampleFailures.length) {
    console.log('')
    console.log('Sample failures:')
    for (const failure of summary.sampleFailures) {
      console.log(`- ${failure.path} status=${failure.status} ms=${failure.ms} ${failure.error || ''}`.trim())
    }
  }

  if (slowPaths.length) {
    console.log('')
    console.log(`Slow paths over p95 budget (${p95BudgetMs}ms):`)
    for (const path of slowPaths) {
      console.log(`- ${path.path} p95=${path.p95Ms}ms`)
    }
  }
}

if (!report.ok) process.exitCode = 1
