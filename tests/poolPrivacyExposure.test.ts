import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const migrationPath = 'supabase/migrations/20260810003600_pool_privacy_and_discovery_hardening.sql'
const passwordMigrationPath = 'supabase/migrations/20260810003700_pool_password_storage_invariants.sql'

test('private pools cannot be enumerated through browse or name search', async () => {
  const sql = await read(migrationPath)
  const search = sql.match(/create function public\.search_pools[\s\S]*?\$function\$;/i)?.[0] || ''
  assert.match(search, /coalesce\(p\.is_public,false\)/i)
  assert.match(search, /coalesce\(p\.allow_discovery,true\)/i)
  assert.doesNotMatch(search, /length\(i\.term\).*is_public/i)
})

test('private invite previews omit identity counts notes and test state', async () => {
  const sql = await read(migrationPath)
  const invite = sql.match(/create function public\.get_pool_invite[\s\S]*?\$function\$;/i)?.[0] || ''
  assert.match(invite, /case when p\.is_public or p\.privileged then p\.notes else null end/i)
  assert.match(invite, /case when p\.privileged then p\.created_by else null end/i)
  assert.match(invite, /case when p\.is_public or p\.privileged then \(select count/i)
  assert.match(invite, /case when p\.privileged then coalesce\(p\.test_mode,false\) else false end/i)
})

test('signed-in outsiders cannot directly read complete public pool rows', async () => {
  const sql = await read(migrationPath)
  const policy = sql.match(/create policy pools_select_authenticated[\s\S]*?\);/i)?.[0] || ''
  assert.match(policy, /is_pool_member/i)
  assert.match(policy, /admin_can_manage/i)
  assert.doesNotMatch(policy, /is_public/i)
  assert.match(sql, /revoke select\(created_by,activated_by,winner_user_id/i)
})

test('global profile enumeration is removed and roster names are minimized', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /drop policy if exists profiles_public_select_all/i)
  assert.match(sql, /revoke all on public\.profiles_public from anon/i)
  assert.match(sql, /create policy profiles_select_self/i)
  const roster = sql.match(/create or replace function public\.pool_entry_roster[\s\S]*?\$function\$;/i)?.[0] || ''
  assert.match(roster, /not public\.is_pool_member\(p_pool_id\)/i)
  assert.match(roster, /pr\.username::text,null::text,null::text,pr\.avatar_url/i)
  assert.doesNotMatch(roster, /pr\.first_name|pr\.last_name/i)
})

test('join and pool routes emit noindex metadata and discovery copy is explicit', async () => {
  const [joinLayout,poolsLayout,searchPage,robots] = await Promise.all([
    read('app/join/layout.tsx'),read('app/pools/layout.tsx'),read('app/join/search/page.tsx'),read('app/robots.ts'),
  ])
  assert.match(joinLayout, /index: false[\s\S]*follow: false/i)
  assert.match(poolsLayout, /index: false[\s\S]*follow: false/i)
  assert.match(searchPage, /Only public pools appear in search/i)
  assert.match(robots, /'\/join\/'[\s\S]*'\/pools\/'/i)
})

test('invite codes and target emails are unavailable to anonymous database clients', async () => {
  const sql = await read(migrationPath)
  assert.match(sql, /revoke all on public\.invites from anon/i)
  assert.match(sql, /revoke truncate,references,trigger on public\.invites from authenticated/i)
})

test('public pools discard old secrets and open private pools require bcrypt hashes', async () => {
  const sql = await read(passwordMigrationPath)
  assert.match(sql, /update public\.pools[\s\S]*join_password_hash=null[\s\S]*where coalesce\(is_public,false\)/i)
  assert.match(sql, /pools_private_password_required_check[\s\S]*or archived[\s\S]*coalesce\(join_password_hash,password_hash,private_password_hash\) is not null/i)
  assert.match(sql, /pools_password_hash_format_check/i)
  assert.match(sql, /octet_length\(join_password_hash\)=60[\s\S]*left\(join_password_hash,2\)='\$2'/i)
  assert.match(sql, /create trigger aay_clear_public_pool_password_hashes/i)
})
