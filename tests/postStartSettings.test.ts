import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('the pools row rejects every competitive setting change after the canonical start boundary', async () => {
  const migration = await read('supabase/migrations/20260810002700_post_start_settings_immutability.sql')

  assert.match(migration, /public\.pool_has_started\(old\.id\)/)
  assert.match(migration, /is distinct from row\(/)
  assert.match(migration, /Competitive pool settings cannot be changed after the pool has started/)

  for (const column of [
    'season',
    'start_week',
    'include_playoffs',
    'strikes_allowed',
    'tie_rule',
    'deadline_mode',
    'deadline_fixed',
    'double_pick_weeks',
    'max_members',
    'allow_multiple_entries',
    'max_entries_per_user',
    'is_public',
    'allow_discovery',
    'join_password_hash',
    'pick_privacy',
    'notes',
    'activation_status',
    'test_mode',
  ]) {
    assert.match(migration, new RegExp(`new\\.${column}`), `missing post-start guard for ${column}`)
    assert.match(migration, new RegExp(`old\\.${column}`), `missing historical comparison for ${column}`)
  }
})

test('post-start guard preserves safe operational updates', async () => {
  const migration = await read('supabase/migrations/20260810002700_post_start_settings_immutability.sql')
  const comparison = migration.slice(migration.indexOf('and row('), migration.indexOf('then\n    raise exception'))

  for (const safeColumn of [
    'image_url',
    'archived',
    'archived_at',
    'test_current_week',
    'test_now_at',
    'winner_user_id',
    'payment_status',
  ]) {
    assert.doesNotMatch(comparison, new RegExp(`(?:new|old)\\.${safeColumn}`), `${safeColumn} must remain operationally writable`)
  }
})

test('the commissioner UI explains locked and safe behavior', async () => {
  const adminPage = await read('app/pools/[poolId]/admin/page.tsx')

  assert.match(adminPage, /historical picks and standings cannot be silently regraded/)
  assert.match(adminPage, /You can still change the pool image/)
  assert.match(adminPage, /changing to private does not remove anyone who already joined/)
  assert.match(adminPage, /limits cannot be reduced below current entries/)
})

test('supported commissioner rule RPCs already reject direct post-start requests', async () => {
  const core = await read('supabase/migrations/20260810002000_commissioner_preseason_rule_editor.sql')
  const settings = await read('supabase/migrations/20260803000200_quality_rpc_backfills.sql')

  assert.match(core, /Pool (?:settings|rules) (?:are locked|cannot be changed) after the (?:first kickoff|pool has started)/)
  for (const rpc of [
    'admin_update_pool_member_limit',
    'admin_set_double_weeks',
    'admin_update_pool_entry_settings',
    'admin_update_pool_visibility',
  ]) {
    const start = settings.indexOf(`create or replace function public.${rpc}`)
    assert.notEqual(start, -1, `missing ${rpc}`)
    const body = settings.slice(start, settings.indexOf('$function$;', start) + '$function$;'.length)
    assert.match(body, /Pool (?:settings|rules) (?:are locked|cannot be changed) after the (?:first kickoff|pool has started)/, `${rpc} lacks a server-side start lock`)
  }
})
