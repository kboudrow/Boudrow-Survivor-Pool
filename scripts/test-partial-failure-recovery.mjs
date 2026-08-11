import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey || process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') {
  throw new Error('Missing Supabase environment or ALLOW_TEST_POOL_MUTATIONS=true.')
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const createdPoolIds = []
const checks = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const rpc = async (client, name, args = {}) => {
  const response = await client.rpc(name, args)
  if (response.error) throw new Error(`${name}: ${response.error.message}`)
  return response.data
}
const expectReject = async (work, pattern) => {
  try { await work() } catch (error) {
    assert(pattern.test(error.message), `Expected ${pattern}; received ${error.message}`)
    return
  }
  throw new Error(`Expected rejection matching ${pattern}.`)
}
async function authenticate(email) {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  return { client, id: verified.data.user.id }
}

const owner = await authenticate('survivesunday1@gmail.com')
const player = await authenticate('taylor@swift.com')
const createArgs = (name, operationId, season = 2026) => ({
  p_operation_id: operationId,
  p_name: name,
  p_is_public: true,
  p_password: null,
  p_start_week: 1,
  p_include_playoffs: false,
  p_strikes_allowed: '0',
  p_tie_rule: 'loss',
  p_deadline_mode: 'rolling',
  p_deadline_fixed: '13:00',
  p_notes: 'Partial failure recovery test',
  p_image_url: null,
  p_season: season,
  p_double_pick_weeks: [],
  p_max_members: 20,
  p_allow_multiple_entries: true,
  p_max_entries_per_user: 3,
})

try {
  const name = `Partial Failure ${Date.now()}`
  const createOperation = crypto.randomUUID()
  const firstPoolId = await rpc(owner.client, 'create_pool_with_owner_idempotent', createArgs(name, createOperation))
  createdPoolIds.push(firstPoolId)
  // Treat the first response as lost, then replay it concurrently from retries/tabs.
  const createRetries = await Promise.all(Array.from({ length: 12 }, () =>
    rpc(owner.client, 'create_pool_with_owner_idempotent', createArgs(name, createOperation))))
  assert(createRetries.every((id) => id === firstPoolId), 'A create retry returned a different pool.')
  const matchingPools = await service.from('pools').select('id').eq('name', name)
  assert(!matchingPools.error && matchingPools.data.length === 1, 'Create retries produced duplicate pools.')
  const recoveredPoolId = await rpc(owner.client, 'my_operation_result', { p_operation_type: 'create_pool', p_operation_id: createOperation })
  assert(recoveredPoolId === firstPoolId, 'Refresh recovery could not find the committed pool.')
  checks.push('lost create response + 12 retries returned one pool')

  const failedOperation = crypto.randomUUID()
  await expectReject(
    () => rpc(owner.client, 'create_pool_with_owner_idempotent', createArgs(`Rejected ${Date.now()}`, failedOperation, 999999)),
    /season is invalid/i,
  )
  const absentReceipt = await rpc(owner.client, 'my_operation_result', { p_operation_type: 'create_pool', p_operation_id: failedOperation })
  assert(absentReceipt === null, 'A failed transaction left a false success receipt.')
  const recoveredAfterFailure = await rpc(owner.client, 'create_pool_with_owner_idempotent', createArgs(`Recovered ${Date.now()}`, failedOperation))
  createdPoolIds.push(recoveredAfterFailure)
  checks.push('failure before write rolled back cleanly and remained retryable')

  await rpc(player.client, 'join_pool', { p_pool_id: firstPoolId, p_password: null, p_token: null })
  // Lost response: repeat the existing idempotent join request.
  await rpc(player.client, 'join_pool', { p_pool_id: firstPoolId, p_password: null, p_token: null })
  let memberships = await service.from('pool_members').select('id').eq('pool_id', firstPoolId).eq('profile_id', player.id)
  assert(!memberships.error && memberships.data.length === 1, 'Join retry produced duplicate initial entries.')
  checks.push('lost join response + retry retained one membership entry')

  const entryOperation = crypto.randomUUID()
  const firstEntryId = await rpc(player.client, 'add_pool_entry_idempotent', { p_pool_id: firstPoolId, p_operation_id: entryOperation })
  const entryRetries = await Promise.all(Array.from({ length: 12 }, () =>
    rpc(player.client, 'add_pool_entry_idempotent', { p_pool_id: firstPoolId, p_operation_id: entryOperation })))
  assert(entryRetries.every((id) => id === firstEntryId), 'An entry retry returned a different entry.')
  memberships = await service.from('pool_members').select('id').eq('pool_id', firstPoolId).eq('profile_id', player.id)
  assert(!memberships.error && memberships.data.length === 2, 'Entry retries created more than one additional entry.')
  const recoveredEntryId = await rpc(player.client, 'my_operation_result', { p_operation_type: 'add_pool_entry', p_operation_id: entryOperation })
  assert(recoveredEntryId === firstEntryId, 'Refresh recovery could not find the committed entry.')
  checks.push('lost add-entry response + 12 retries returned one entry')

  await rpc(owner.client, 'admin_update_pool_visibility', { p_pool_id: firstPoolId, p_is_public: false, p_password: 'partial-failure-test' })
  await rpc(owner.client, 'admin_update_pool_visibility', { p_pool_id: firstPoolId, p_is_public: false, p_password: 'partial-failure-test' })
  const visibility = await service.from('pools').select('is_public,visibility').eq('id', firstPoolId).single()
  assert(!visibility.error && visibility.data.is_public === false && visibility.data.visibility === 'private', 'Repeated setting save produced stale state.')
  checks.push('duplicate setting save remained idempotent and authoritative')

  await rpc(owner.client, 'admin_remove_pool_member', { p_pool_id: firstPoolId, p_profile_id: player.id })
  await expectReject(
    () => rpc(owner.client, 'admin_remove_pool_member', { p_pool_id: firstPoolId, p_profile_id: player.id }),
    /member not found/i,
  )
  memberships = await service.from('pool_members').select('id').eq('pool_id', firstPoolId).eq('profile_id', player.id)
  assert(!memberships.error && memberships.data.length === 0, 'Ambiguous member removal did not leave an authoritative absent state.')
  checks.push('lost removal response was recoverable by authoritative absence check')

  console.log(JSON.stringify({ checks: checks.length, passed: checks, pools: createdPoolIds }, null, 2))
} finally {
  if (createdPoolIds.length) {
    await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).in('id', createdPoolIds)
  }
}

