import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8').toLowerCase()

test('applied migrations are checksum-protected and the legacy baseline stays immutable', () => {
  const checker = read('scripts/check-migration-integrity.mjs')
  const guide = read('supabase/migrations.md')
  const manifest = JSON.parse(readFileSync('supabase/applied-migration-checksums.json', 'utf8'))

  assert.equal(Object.keys(manifest).length, 72)
  assert.match(checker, /applied migration was modified/)
  assert.match(guide, /do \*\*not\*\* replace or edit/)
  assert.match(guide, /cannot currently build a brand-new database/)
})

test('browser roles cannot mutate tables or inherit future database objects', () => {
  const migration = read(
    'supabase/migrations/20260810003900_browser_role_least_privilege.sql',
  )
  const config = read('supabase/config.toml')

  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger, maintain/)
  assert.match(migration, /on all tables in schema public from anon, authenticated/)
  assert.match(migration, /revoke all on tables from anon, authenticated/)
  assert.match(migration, /revoke execute on functions from anon, authenticated/)
  assert.match(migration, /p\.prorettype = 'pg_catalog\.trigger'::regtype/)
  assert.match(config, /auto_expose_new_tables = false/)
})

test('foreign-key support indexes are additive and duplicate cleanup is explicit', () => {
  const migration = read(
    'supabase/migrations/20260810004000_foreign_key_supporting_indexes.sql',
  )

  assert.equal((migration.match(/create index if not exists/g) ?? []).length, 22)
  assert.match(migration, /idx_pool_pick_drafts_user_id/)
  assert.match(migration, /idx_pool_picks_user_id/)
  assert.match(migration, /idx_pools_winner_user_id/)
  assert.match(migration, /drop index if exists public\.nfl_games_season_week_idx/)
})

test('the configured NFL seed is idempotent and preserves provider results', () => {
  const seed = read('supabase/nfl-schedule-2026.sql')
  const generator = read('scripts/write-nfl-schedule-sql.mjs')

  assert.doesNotMatch(seed, /delete from public\.nfl_games/)
  assert.match(seed, /on conflict \(season, week, home_team, away_team\) do update/)
  assert.match(seed, /when public\.nfl_games\.status in \('in_progress', 'final'\)/)
  assert.match(seed, /set kickoff_confirmed = false/)
  assert.doesNotMatch(generator, /delete from public\.nfl_games/)
  assert.match(generator, /when public\.nfl_games\.status in \('in_progress', 'final'\)/)
})
