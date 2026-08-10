import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('public learning pages define the game and use the product rules', () => {
  const home = read('app/page.tsx')
  const howItWorks = read('app/how-it-works/page.tsx')
  const rules = read('app/survivor-pool-rules/page.tsx')
  const faq = read('app/faq/page.tsx')

  assert.match(home, /weekly pick.*choose one team to win/i)
  assert.match(howItWorks, /Each entry—one independent chance to play/i)
  assert.match(rules, /the missing pick counts as a loss/i)
  assert.match(rules, /Team history resets for the playoffs/i)
  assert.match(faq, /A mulligan is one allowed loss/i)
  assert.match(faq, /official NFL tie counts as a win or a loss/i)

  for (const page of [home, howItWorks, rules, faq]) {
    assert.doesNotMatch(page, /\bstrikes?\b/i)
  }
  for (const page of [howItWorks, rules, faq]) assert.doesNotMatch(page, /\bpush(?:es)?\b/i)
})

test('joining pages explain access and what an entry means', () => {
  const search = read('app/join/search/page.tsx')
  const invite = read('app/join/[poolId]/page.tsx')
  const detail = read('app/pools/[poolId]/page.tsx')

  assert.match(search, /Public pools need no password/i)
  assert.match(search, /there is no approval queue/i)
  assert.match(invite, /one independent chance to make weekly picks/i)
  assert.match(detail, /Joining creates your first entry/i)
  assert.match(detail, /valid join is added immediately/i)
})

test('weekly play and standings use clear, consistent status labels', () => {
  const pool = read('app/pools/page.tsx')

  assert.match(pool, /Your job: choose/i)
  assert.match(pool, /Saved — editable until lock/i)
  assert.match(pool, /Locked — official/i)
  assert.match(pool, /Mulligans remaining/i)
  assert.match(pool, /Alive entries can keep picking/i)
  assert.match(pool, /eliminated entries cannot/i)

  assert.doesNotMatch(pool, />\s*Out\s*</i)
  assert.doesNotMatch(pool, />\s*Strikes remaining\s*</i)
  assert.doesNotMatch(pool, /Pick made/i)
})
