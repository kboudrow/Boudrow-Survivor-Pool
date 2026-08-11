import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const migrationPath = 'supabase/migrations/20260810003300_historical_competition_integrity.sql'

test('locked picks retain entry-scoped submission, deadline, result, and rule evidence', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /pick_save_events add column if not exists entry_id uuid/i)
  assert.match(migration, /pool_picks add column if not exists submitted_at timestamptz/i)
  assert.match(migration, /pool_picks add column if not exists applicable_deadline_at timestamptz/i)
  assert.match(migration, /pool_picks add column if not exists rules_snapshot jsonb/i)
  assert.match(migration, /case when p\.deadline_mode='fixed'[\s\S]*least/i)
  assert.match(migration, /new\.submitted_at := coalesce\(new\.submitted_at,v_draft_saved_at\)/i)
})

test('ambiguous old multi-entry submission times are not invented', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /having count\(distinct pick\.entry_id\)\s*=\s*1/i)
  assert.match(migration, /where pick\.submitted_at is null[\s\S]*evidence\.saved_at is not null/i)
  assert.match(migration, /'not_available'/i)
})

test('weekly history stores logical standings without profile PII', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /create table if not exists public\.pool_entry_week_history/i)
  for (const fact of ['mulligans_applied', 'mulligans_remaining', 'survival_credits', 'eliminated_week', 'used_teams', 'picks_snapshot', 'rules_snapshot']) {
    assert.match(migration, new RegExp(fact))
  }
  assert.doesNotMatch(migration, /pool_entry_week_history[\s\S]{0,600}(email|avatar_url|first_name|last_name)/i)
  assert.match(migration, /revision=public\.pool_entry_week_history\.revision\+1/i)
  assert.match(migration, /is distinct from row\(excluded\.wins/i)
})

test('started pools and entry identities cannot cascade out of history', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /before delete on public\.pool_members/i)
  assert.match(migration, /before delete on public\.pools/i)
  assert.match(migration, /Started pool competition history cannot be deleted/i)
  assert.match(migration, /Entry identity cannot change after the pool starts/i)
})

test('profile deletion no longer deletes the pick evidence ledger', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /alter column user_id drop not null/i)
  assert.match(migration, /references public\.profiles\(id\) on delete set null/i)
  assert.match(migration, /actor_user_id/i)
})

test('result reruns refresh weekly history only when logical facts change', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /rebuild_pool_member_stats_concurrency_internal/i)
  assert.match(migration, /perform public\.refresh_pool_week_history\(p_pool_id\)/i)
  assert.match(migration, /on conflict\(pool_id,entry_id,week\) do update/i)
  assert.match(migration, /where row\(public\.pool_entry_week_history\.wins/i)
})

test('historical standings pages read the selected week ledger', async () => {
  const migration = await read(migrationPath)
  assert.match(migration, /create or replace function public\.pool_standings_snapshot/i)
  assert.match(migration, /from public\.pool_entry_week_history h/i)
  assert.match(migration, /h\.week=p_week/i)
  assert.match(migration, /and g\.week<=p_week/i)
})

test('commissioner corrections persist a required reason against the exact entry', async () => {
  const migration = await read('supabase/migrations/20260810003400_historical_correction_audit.sql')
  assert.match(migration, /admin_actions add column if not exists entry_id uuid/i)
  assert.match(migration, /Enter a reason for changing this locked pick/i)
  assert.match(migration, /'final_pick_override'/i)
  assert.match(migration, /p_pool_id,auth\.uid\(\),v_user_id,p_entry_id/i)
  assert.match(migration, /week between 1 and 22/i)
})

test('missed-pick sentinels are not reported as previously used NFL teams', async () => {
  const migration = await read('supabase/migrations/20260810003400_historical_correction_audit.sql')
  assert.match(migration, /team not like 'NO_PICK%'/i)
  assert.match(migration, /sanitize_pool_week_used_teams/i)
})
