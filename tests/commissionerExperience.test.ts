import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(path, 'utf8')

test('core commissioner rules are editable only before the authoritative pool start', async () => {
  const migration = await read('supabase/migrations/20260810002000_commissioner_preseason_rule_editor.sql')

  assert.match(migration, /admin_can_manage\(p_pool_id\)/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /now\(\) >= v_current_start/i)
  assert.match(migration, /now\(\) >= v_next_start/i)
  assert.match(migration, /Pool rules cannot be changed after the pool has started/i)
  assert.match(migration, /Week % has already started/i)
  assert.match(migration, /revoke execute[\s\S]*from public,anon/i)
})

test('moving a start week cannot silently strand existing picks', async () => {
  const migration = await read('supabase/migrations/20260810002000_commissioner_preseason_rule_editor.sql')

  assert.match(migration, /pool_pick_drafts[\s\S]*d\.week < p_start_week/i)
  assert.match(migration, /pool_picks[\s\S]*p\.week < p_start_week/i)
  assert.match(migration, /Clear those picks before moving the start week later/i)
})

test('commissioner rule inputs are validated again in the database', async () => {
  const migration = await read('supabase/migrations/20260810002000_commissioner_preseason_rule_editor.sql')

  assert.match(migration, /p_start_week < 1 or p_start_week > 18/i)
  assert.match(migration, /p_strikes_allowed < 0 or p_strikes_allowed > 2/i)
  assert.match(migration, /not in \('win', 'loss'\)/i)
  assert.match(migration, /not in \('fixed', 'rolling'\)/i)
  assert.match(migration, /2,000 characters/i)
})

test('commissioner UI explains activation, approvals, missed picks, and dispute corrections', async () => {
  const [adminPage, createPage, inviteModal] = await Promise.all([
    read('app/pools/[poolId]/admin/page.tsx'),
    read('app/pools/new/page.tsx'),
    read('components/InviteModal.tsx'),
  ])

  assert.match(adminPage, /There is no Activate button/i)
  assert.match(adminPage, /No approval queue/i)
  assert.match(adminPage, /A missed pick grades as a loss/i)
  assert.match(adminPage, /Reason for commissioner pick change/i)
  assert.match(adminPage, /Required for locked picks/i)
  assert.match(adminPage, /Rules saved/i)
  assert.match(createPage, /starts automatically at the first kickoff/i)
  assert.match(createPage, /Mulligans \(losses allowed\)/i)
  assert.match(inviteModal, /added immediately; there is no commissioner approval queue/i)
})

