const target = process.env.LOAD_TEST_TARGET || 'https://survivesunday.com'
const concurrency = Number(process.env.LOAD_TEST_CONCURRENCY || 25)
const rounds = Number(process.env.LOAD_TEST_ROUNDS || 4)
const authHeader = process.env.LOAD_TEST_AUTH_HEADER || ''
const paths = (process.env.LOAD_TEST_PATHS || '/,/join/search,/blog,/faq')
  .split(',')
  .map((path) => path.trim())
  .filter(Boolean)

const headers = authHeader ? { authorization: authHeader } : {}

function percentile(values, pct) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))]
}

async function hit(path) {
  const url = new URL(path, target).toString()
  const started = performance.now()
  try {
    const response = await fetch(url, { headers, redirect: 'follow' })
    const body = await response.arrayBuffer()
    return {
      path,
      status: response.status,
      ok: response.ok,
      ms: performance.now() - started,
      bytes: body.byteLength,
    }
  } catch (error) {
    return {
      path,
      status: 0,
      ok: false,
      ms: performance.now() - started,
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function worker(id, results) {
  for (let round = 0; round < rounds; round += 1) {
    const path = paths[(id + round) % paths.length]
    results.push(await hit(path))
  }
}

const results = []
const started = performance.now()
await Promise.all(Array.from({ length: concurrency }, (_, id) => worker(id, results)))
const totalMs = performance.now() - started

const durations = results.map((result) => result.ms)
const failures = results.filter((result) => !result.ok)
const byPath = new Map()
for (const result of results) {
  const current = byPath.get(result.path) || { count: 0, failures: 0, ms: [] }
  current.count += 1
  if (!result.ok) current.failures += 1
  current.ms.push(result.ms)
  byPath.set(result.path, current)
}

console.log(`Target: ${target}`)
console.log(`Requests: ${results.length} (${concurrency} concurrent x ${rounds} rounds)`)
console.log(`Total time: ${Math.round(totalMs)}ms`)
console.log(`Failures: ${failures.length}`)
console.log(`Latency p50/p95/max: ${Math.round(percentile(durations, 50))}ms / ${Math.round(percentile(durations, 95))}ms / ${Math.round(Math.max(...durations))}ms`)

for (const [path, stats] of byPath.entries()) {
  console.log(
    `${path}: count=${stats.count} failures=${stats.failures} p95=${Math.round(percentile(stats.ms, 95))}ms`
  )
}

if (failures.length) {
  console.log('Sample failures:')
  for (const failure of failures.slice(0, 5)) {
    console.log(`- ${failure.path} status=${failure.status} ${failure.error || ''}`.trim())
  }
  process.exitCode = 1
}
