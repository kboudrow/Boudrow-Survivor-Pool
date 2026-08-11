import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const migrationPath = 'supabase/migrations/20260810003500_destructive_workflow_hardening.sql'

test('all roster removals use canonical start checks and transaction locks', async () => {
  const sql = await read(migrationPath)
  for (const routine of ['leave_pool', 'remove_pool_entry', 'admin_remove_pool_entry', 'admin_remove_pool_member']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${routine}`))
  }
  assert.match(sql, /if public\.pool_has_started\(p_pool_id\)[\s\S]*cannot leave/i)
  assert.match(sql, /acquire_pool_workflow_lock/i)
  assert.match(sql, /acquire_all_pool_entry_pick_locks/i)
  assert.match(sql, /acquire_pool_entry_pick_lock/i)
})

test('only-entry deletion and creator removal are rejected below the UI', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /if v_entry_count<=1 then raise exception 'Your only entry represents your membership/i)
  assert.match(sql, /protect_pool_creator_entry_delete/i)
  assert.match(sql, /The pool creator cannot leave or remove their own entry/i)
  assert.match(sql, /before delete on public\.pool_members/i)
})

test('direct browser deletes are revoked for every competition ledger', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /revoke delete on public\.pools,public\.pool_members,public\.pool_picks,public\.pool_pick_drafts/i)
  assert.match(sql, /pool_entry_week_history[\s\S]*from authenticated/i)
})

test('removal receipts capture exact transactional consequences without profile details', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /create table if not exists public\.pool_roster_removal_events/i)
  for (const column of ['entries_removed', 'drafts_removed', 'locked_picks_removed']) assert.match(sql, new RegExp(column))
  assert.match(sql, /member_left/)
  assert.match(sql, /member_removed/)
  assert.match(sql, /entry_removed_by_admin/)
  const tableDefinition = sql.match(/create table if not exists public\.pool_roster_removal_events \([\s\S]*?\n\);/i)?.[0] || ''
  assert.doesNotMatch(tableDefinition, /email|avatar_url|first_name|last_name/i)
})

test('archive is non-destructive, serialized, and unavailable mid-competition', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /create or replace function public\.admin_archive_pool/i)
  assert.match(sql, /pool_competition_is_complete/i)
  assert.match(sql, /in-progress pool cannot be archived/i)
  assert.doesNotMatch(sql, /delete from public\.pools/i)
  assert.match(sql, /Pools are retained as competition records\. Archive the pool instead/i)
})

test('confirmation copy explains permanence, timing, scope, and invite behavior', async () => {
  const [memberPage, commissionerPage, superAdminPage] = await Promise.all([
    read('app/pools/page.tsx'),
    read('app/pools/[poolId]/admin/page.tsx'),
    read('app/admin/page.tsx'),
  ])
  assert.match(memberPage, /Permanently remove[\s\S]*only allowed before the pool starts[\s\S]*invite link stay active/i)
  assert.match(memberPage, /Leave[\s\S]*only allowed before the pool starts[\s\S]*join again/i)
  assert.match(commissionerPage, /Permanently remove[\s\S]*invite link remains active/i)
  assert.match(superAdminPage, /Permanently remove[\s\S]*invite link remains active/i)
})
