import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read=(path:string)=>readFile(new URL(`../${path}`,import.meta.url),'utf8')

test('browser pool reads cannot request password hashes or payment identifiers',async()=>{
  const [page,migration]=await Promise.all([
    read('app/pools/page.tsx'),
    read('supabase/migrations/20260810001300_hide_pool_secrets_from_clients.sql'),
  ])
  assert.doesNotMatch(page,/from\('pools'\)\.select\('\*'\)/)
  assert.match(migration,/revoke select on table public\.pools from anon,authenticated/i)
  assert.doesNotMatch(migration,/grant select\([\s\S]*join_password_hash/i)
  assert.doesNotMatch(migration,/grant select\([\s\S]*stripe_checkout_session_id/i)
})

test('direct pool creation validates scoring and deadline inputs',async()=>{
  const migration=await read('supabase/migrations/20260810001200_adversarial_input_and_rate_hardening.sql')
  assert.match(migration,/p_strikes_allowed,''\) not in\('0','1','2'\)/)
  assert.match(migration,/Fixed deadline must be a valid 24-hour time/)
  assert.match(migration,/Pool password cannot exceed 72 bytes/)
  assert.match(migration,/Pool notes cannot exceed 2,000 characters/)
  assert.match(migration,/Season is invalid/)
})

test('rate limiting serializes simultaneous requests before counting',async()=>{
  const migration=await read('supabase/migrations/20260810001200_adversarial_input_and_rate_hardening.sql')
  const limiter=migration.slice(migration.indexOf('create or replace function public.assert_action_rate_limit'))
  assert.match(limiter,/pg_advisory_xact_lock/)
  assert.ok(limiter.indexOf('pg_advisory_xact_lock')<limiter.indexOf('select count\(\*\) into v_count'))
})

test('cron endpoints require the configured bearer secret',async()=>{
  const [lockPicks,syncScores]=await Promise.all([
    read('app/api/cron/lock-picks/route.ts'),read('app/api/cron/sync-scores/route.ts'),
  ])
  for(const route of [lockPicks,syncScores]){
    assert.match(route,/auth === `Bearer \$\{secret\}`/)
    assert.match(route,/status: 401/)
  }
})
