import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const migrationPath = 'supabase/migrations/20260810003800_competition_dispute_evidence.sql'

test('competition dispute evidence is append-only and contains no direct PII fields', async () => {
  const sql = await read(migrationPath)
  const table = sql.match(/create table if not exists public\.pool_dispute_events \([\s\S]*?\n\);/i)?.[0] || ''
  assert.match(table, /occurred_at timestamptz not null default clock_timestamp\(\)/i)
  assert.match(table, /server_effective_at timestamptz/i)
  assert.match(table, /applicable_deadline_at timestamptz/i)
  assert.doesNotMatch(table, /email|ip_address|user_agent|password|payment/i)
  assert.match(sql, /revoke all on public\.pool_dispute_events from public,anon,authenticated/i)
})

test('pick history keeps server time deadline submission and original rules', async () => {
  const sql = await read(migrationPath)
  for (const column of ['locked_at','submitted_at','applicable_deadline_at','server_effective_at','rules_snapshot']) {
    assert.match(sql, new RegExp(`pick_save_events add column if not exists ${column}`,'i'))
  }
  const capture = sql.match(/create or replace function public\.capture_locked_pick_history[\s\S]*?\$function\$;/i)?.[0] || ''
  assert.match(capture, /if tg_op='INSERT'/i)
  assert.match(capture, /new\.submitted_at:=old\.submitted_at/i)
  assert.match(capture, /new\.applicable_deadline_at:=old\.applicable_deadline_at/i)
  assert.match(capture, /new\.rules_snapshot:=old\.rules_snapshot/i)
})

test('commissioner setting transitions are logged without password hashes', async () => {
  const sql = await read(migrationPath)
  const settings = sql.match(/create or replace function public\.log_pool_setting_dispute_event[\s\S]*?\$function\$;/i)?.[0] || ''
  for (const setting of ['start_week','mulligans','tie_rule','deadline_mode','double_pick_weeks','max_members','is_public','notes']) {
    assert.match(settings, new RegExp(`'${setting}'`))
  }
  assert.match(settings, /'password_changed'/i)
  assert.doesNotMatch(settings, /jsonb_build_object\([\s\S]*?'join_password_hash'/i)
})

test('entry status mulligan elimination ownership and removals receive durable evidence', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /create trigger trg_log_pool_entry_dispute_event/i)
  assert.match(sql, /entry_owner_changed/i)
  assert.match(sql, /entry_status_changed/i)
  assert.match(sql, /create trigger trg_log_pool_entry_state_dispute_event/i)
  assert.match(sql, /Mulligan usage changed/i)
  assert.match(sql, /Entry was eliminated/i)
  assert.match(sql, /create trigger trg_mirror_removal_dispute_event/i)
})

test('normal pick writes return server receipts and retain rejected deadline evidence', async () => {
  const [sql,page] = await Promise.all([read(migrationPath),read('app/pools/page.tsx')])
  assert.match(sql, /save_entry_draft_pick_with_receipt/i)
  assert.match(sql, /pick_save_rejected/i)
  assert.match(sql, /get stacked diagnostics v_error=message_text/i)
  assert.match(page, /rpc\('save_entry_draft_pick_with_receipt'/i)
  assert.match(page, /rpc\('clear_entry_draft_pick_with_receipt'/i)
  assert.match(page, /if \(!receipt\?\.success\) throw new Error/i)
})

test('commissioners receive one readable dispute timeline without raw emails', async () => {
  const [sql,admin] = await Promise.all([read(migrationPath),read('app/pools/[poolId]/admin/page.tsx')])
  assert.match(sql, /create or replace function public\.commissioner_dispute_history/i)
  assert.match(sql, /if not public\.admin_can_manage\(p_pool_id\)/i)
  assert.match(admin, /Dispute History/i)
  assert.match(admin, /Competition timeline/i)
  assert.match(admin, /Applicable deadline/i)
  assert.match(admin, /commissioner_dispute_history/i)
  assert.doesNotMatch(admin, /event\.details\?\.email/i)
})
