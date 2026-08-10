import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('rapid entry and week changes cannot paint stale pick data', async () => {
  const poolPage = await read('app/pools/page.tsx')
  assert.match(poolPage, /const requestId = \+\+myPicksRequestRef\.current/)
  assert.match(poolPage, /if \(requestId !== myPicksRequestRef\.current\) return/)
  assert.match(poolPage, /let cancelled = false/)
  assert.match(poolPage, /setWeekGames\(\[\]\)[\s\S]*pool_week_games_load_failed/)
})

test('pool creation ignores duplicate submissions while the first is pending', async () => {
  const createPage = await read('app/pools/new/page.tsx')
  assert.match(createPage, /if \(creatingPoolRef\.current\) return/)
  assert.match(createPage, /creatingPoolRef\.current = true/)
  assert.match(createPage, /finally \{[\s\S]*creatingPoolRef\.current = false/)
})

test('production failures give players a safe recovery path', async () => {
  const [errorPage, notFoundPage, loadingPage] = await Promise.all([
    read('app/error.tsx'),
    read('app/not-found.tsx'),
    read('app/loading.tsx'),
  ])
  assert.match(errorPage, /confirm the saved team appears before trying again/i)
  assert.match(errorPage, /route_render_failed/)
  assert.match(notFoundPage, /pool you cannot access/i)
  assert.match(loadingPage, /aria-live="polite"/)
})
