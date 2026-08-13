import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey) throw new Error('Missing Supabase environment variables.')
if (process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') throw new Error('Set ALLOW_TEST_POOL_MUTATIONS=true.')

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const emails = ['survivesunday1@gmail.com', 'taylor@swift.com']
let poolId = null

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpc(client, name, args = {}) {
  const response = await client.rpc(name, args)
  if (response.error) throw new Error(`${name}: ${response.error.message}`)
  return response.data
}

async function authenticate(email) {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  return { client, userId: verified.data.user.id }
}

try {
  const [owner, player] = await Promise.all(emails.map(authenticate))
  const created = await service.from('pools').insert({
    name: `Automated Week Rollover Audit ${Date.now()}`,
    created_by: owner.userId,
    season: 2026,
    start_week: 1,
    include_playoffs: false,
    strikes_allowed: '0',
    tie_rule: 'loss',
    ties: 'loss',
    deadline_mode: 'rolling',
    deadline_fixed: '13:00',
    double_pick_weeks: [],
    is_public: true,
    visibility: 'public',
    allow_discovery: false,
    max_members: 10,
    allow_multiple_entries: false,
    max_entries_per_user: 1,
    activation_status: 'active',
    payment_status: 'not_required',
    test_mode: false,
  }).select('id').single()
  if (created.error) throw created.error
  poolId = created.data.id

  const entriesResult = await service.from('pool_members').insert([
    { pool_id: poolId, profile_id: owner.userId, role: 'admin', status: 'alive', entry_number: 1 },
    { pool_id: poolId, profile_id: player.userId, role: 'member', status: 'alive', entry_number: 1 },
  ]).select('id,profile_id')
  if (entriesResult.error) throw entriesResult.error
  const ownerEntry = entriesResult.data.find((entry) => entry.profile_id === owner.userId)
  const playerEntry = entriesResult.data.find((entry) => entry.profile_id === player.userId)
  assert(ownerEntry && playerEntry, 'Test entries were not created.')

  await rpc(owner.client, 'superadmin_set_pool_test_mode', { p_pool_id: poolId, p_enabled: true })
  await rpc(owner.client, 'superadmin_set_test_pool_week', { p_pool_id: poolId, p_week: 1 })
  const games = await rpc(owner.client, 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: 1 })
  assert(games.length >= 2, 'Week 1 schedule is unavailable.')

  const futureAttempt = await player.client.rpc('save_entry_draft_pick', {
    p_pool_id: poolId,
    p_entry_id: playerEntry.id,
    p_week: 2,
    p_slot: 1,
    p_team_abbr: games[0].home_team,
  })
  assert(futureAttempt.error && /not available|currently open/i.test(futureAttempt.error.message), 'Future-week direct request was accepted.')

  const picks = await service.from('pool_picks').insert([
    { pool_id: poolId, user_id: owner.userId, entry_id: ownerEntry.id, week: 1, slot: 1, team_abbr: games[0].home_team, locked_at: new Date().toISOString(), result: 'loss', adjudicated_at: new Date().toISOString() },
    { pool_id: poolId, user_id: player.userId, entry_id: playerEntry.id, week: 1, slot: 1, team_abbr: games[1].home_team, locked_at: new Date().toISOString(), result: null, adjudicated_at: null },
  ])
  if (picks.error) throw picks.error
  await rpc(service, 'rebuild_pool_member_stats', { p_pool_id: poolId })

  assert(await rpc(service, 'pool_week_grading_complete', { p_pool_id: poolId, p_week: 1 }) === false, 'Sunday/partial ledger was marked complete.')
  assert(await rpc(service, 'pool_has_declared_winner', { p_pool_id: poolId }) === false, 'Winner was declared while Monday pick remained pending.')
  let graces = await service.from('pool_entry_survival_graces').select('entry_id').eq('pool_id', poolId)
  if (graces.error) throw graces.error
  assert(graces.data.length === 0, 'Partial grading created survival grace.')

  const mondayLoss = await service.from('pool_picks').update({ result: 'loss', adjudicated_at: new Date().toISOString() })
    .eq('pool_id', poolId).eq('entry_id', playerEntry.id).eq('week', 1).eq('slot', 1)
  if (mondayLoss.error) throw mondayLoss.error
  await rpc(service, 'rebuild_pool_member_stats', { p_pool_id: poolId })
  assert(await rpc(service, 'pool_week_grading_complete', { p_pool_id: poolId, p_week: 1 }) === true, 'Completed Monday ledger stayed pending.')
  assert(await rpc(service, 'pool_has_declared_winner', { p_pool_id: poolId }) === false, 'Same-week wipeout incorrectly produced a winner.')
  graces = await service.from('pool_entry_survival_graces').select('entry_id,week,strike_credits').eq('pool_id', poolId)
  if (graces.error) throw graces.error
  assert(graces.data.length === 2, 'Completed same-week wipeout did not preserve both entries.')

  const mondayCorrection = await service.from('pool_picks').update({ result: 'win', adjudicated_at: new Date().toISOString() })
    .eq('pool_id', poolId).eq('entry_id', playerEntry.id).eq('week', 1).eq('slot', 1)
  if (mondayCorrection.error) throw mondayCorrection.error
  await rpc(service, 'rebuild_pool_member_stats', { p_pool_id: poolId })
  assert(await rpc(service, 'pool_has_declared_winner', { p_pool_id: poolId }) === true, 'Corrected complete result did not produce the sole survivor.')
  graces = await service.from('pool_entry_survival_graces').select('entry_id').eq('pool_id', poolId)
  if (graces.error) throw graces.error
  assert(graces.data.length === 0, 'Result correction left stale survival grace.')

  const before = await service.from('pool_member_stats').select('entry_id,wins,losses,strikes_used,eliminated,eliminated_week').eq('pool_id', poolId).order('entry_id')
  await rpc(service, 'rebuild_pool_member_stats', { p_pool_id: poolId })
  const after = await service.from('pool_member_stats').select('entry_id,wins,losses,strikes_used,eliminated,eliminated_week').eq('pool_id', poolId).order('entry_id')
  if (before.error || after.error) throw before.error || after.error
  assert(JSON.stringify(before.data) === JSON.stringify(after.data), 'Duplicate result processing changed standings.')

  console.log(JSON.stringify({ status: 'passed', poolId, scenarios: 8 }, null, 2))
} finally {
  if (poolId) {
    const archived = await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', poolId)
    if (archived.error) console.error(`Could not archive rollover test pool: ${archived.error.message}`)
  }
}
