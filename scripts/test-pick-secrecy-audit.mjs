import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey || process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') {
  throw new Error('Missing Supabase environment or ALLOW_TEST_POOL_MUTATIONS=true.')
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const signedOut = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
const createdPoolIds = []
const checks = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const rpc = async (client, name, args = {}) => {
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
  return { client, id: verified.data.user.id, email }
}

const listed = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (listed.error) throw listed.error
const profiles = await service.from('profiles').select('id')
if (profiles.error) throw profiles.error
const profileIds = new Set(profiles.data.map((profile) => profile.id))
const availableEmails = listed.data.users
  .filter((user) => profileIds.has(user.id))
  .map((user) => user.email?.toLowerCase())
  .filter((email) => email && email !== 'survivesunday1@gmail.com')
assert(availableEmails.length >= 3, 'At least three non-superadmin test accounts are required.')

const commissioner = await authenticate('survivesunday1@gmail.com')
const multiEntryPlayer = await authenticate(availableEmails[0])
const otherMember = await authenticate(availableEmails[1])
const outsider = await authenticate(availableEmails[2])

async function createAuditPool(deadlineMode) {
  const inserted = await service.from('pools').insert({
    name: `Pick Secrecy ${deadlineMode} ${Date.now()}`,
    created_by: commissioner.id,
    is_public: true,
    visibility: 'public',
    allow_discovery: false,
    start_week: 1,
    include_playoffs: false,
    strikes_allowed: '1',
    tie_rule: 'loss',
    ties: 'loss',
    deadline_mode: deadlineMode,
    deadline_fixed: '13:00',
    season: 2026,
    double_pick_weeks: [1],
    max_members: 20,
    allow_multiple_entries: true,
    max_entries_per_user: 2,
    activation_status: 'active',
    payment_status: 'not_required',
    test_mode: false,
  }).select('id').single()
  if (inserted.error) throw inserted.error
  const poolId = inserted.data.id
  createdPoolIds.push(poolId)

  const ownerEntry = await service.from('pool_members').insert({
    pool_id: poolId, profile_id: commissioner.id, role: 'admin', status: 'alive', entry_number: 1,
  }).select('id').single()
  if (ownerEntry.error) throw ownerEntry.error

  await rpc(multiEntryPlayer.client, 'join_pool', { p_pool_id: poolId, p_password: null, p_token: null })
  const secondEntryId = await rpc(multiEntryPlayer.client, 'add_pool_entry', { p_pool_id: poolId })
  await rpc(otherMember.client, 'join_pool', { p_pool_id: poolId, p_password: null, p_token: null })
  await rpc(commissioner.client, 'superadmin_set_pool_test_mode', { p_pool_id: poolId, p_enabled: true })
  await rpc(commissioner.client, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'before_week' })

  const roster = await rpc(commissioner.client, 'superadmin_pool_entries', { p_pool_id: poolId })
  const playerEntries = roster.filter((entry) => entry.profile_id === multiEntryPlayer.id).sort((a, b) => a.entry_number - b.entry_number)
  const memberEntry = roster.find((entry) => entry.profile_id === otherMember.id)
  assert(playerEntries.length === 2 && playerEntries.some((entry) => entry.entry_id === secondEntryId), 'Multiple entries were not created.')
  assert(memberEntry, 'Second member entry was not created.')

  const games = await rpc(commissioner.client, 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: 1 })
  assert(games.length >= 4, 'Test week schedule is incomplete.')
  const earlyTeam = games[0].home_team
  const lateTeam = games.at(-1).home_team
  const alternativeLateTeam = games.at(-2).away_team

  await Promise.all([
    rpc(multiEntryPlayer.client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: playerEntries[0].entry_id, p_week: 1, p_slot: 1, p_team_abbr: earlyTeam }),
    rpc(multiEntryPlayer.client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: playerEntries[0].entry_id, p_week: 1, p_slot: 2, p_team_abbr: lateTeam }),
    rpc(multiEntryPlayer.client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: playerEntries[1].entry_id, p_week: 1, p_slot: 1, p_team_abbr: earlyTeam }),
    rpc(multiEntryPlayer.client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: playerEntries[1].entry_id, p_week: 1, p_slot: 2, p_team_abbr: alternativeLateTeam }),
    rpc(otherMember.client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: memberEntry.entry_id, p_week: 1, p_slot: 1, p_team_abbr: games[1].home_team }),
    rpc(otherMember.client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: memberEntry.entry_id, p_week: 1, p_slot: 2, p_team_abbr: games.at(-1).away_team }),
  ])

  const playerDrafts = await multiEntryPlayer.client.from('pool_pick_drafts').select('entry_id,team_abbr').eq('pool_id', poolId)
  assert(!playerDrafts.error && playerDrafts.data.length === 4, 'A multi-entry owner could not read all of their own drafts.')
  const commissionerDrafts = await commissioner.client.from('pool_pick_drafts').select('entry_id,team_abbr').eq('pool_id', poolId)
  assert(!commissionerDrafts.error && commissionerDrafts.data.length === 0, 'Commissioner directly read another entry draft.')
  const outsiderDrafts = await outsider.client.from('pool_pick_drafts').select('entry_id,team_abbr').eq('pool_id', poolId)
  assert(!outsiderDrafts.error && outsiderDrafts.data.length === 0, 'Non-member directly read a draft.')
  const signedOutDrafts = await signedOut.from('pool_pick_drafts').select('entry_id,team_abbr').eq('pool_id', poolId)
  assert(signedOutDrafts.error || signedOutDrafts.data.length === 0, 'Signed-out visitor directly read a draft.')
  const signedOutFinals = await signedOut.from('pool_picks').select('entry_id,team_abbr').eq('pool_id', poolId)
  assert(signedOutFinals.error || signedOutFinals.data.length === 0, 'Signed-out visitor directly read a final pick.')

  const overview = await rpc(commissioner.client, 'admin_pool_entry_week_overview', { p_pool_id: poolId, p_week: 1 })
  const playerOverview = overview.filter((row) => row.user_id === multiEntryPlayer.id)
  assert(playerOverview.length === 4 && playerOverview.every((row) => row.draft_updated_at && row.draft_team_abbr === null), 'Commissioner overview did not redact draft teams.')
  const commissionerEvents = await commissioner.client.from('pick_save_events').select('user_id,new_team_abbr').eq('pool_id', poolId)
  assert(!commissionerEvents.error && commissionerEvents.data.length === 0, 'Raw draft history leaked to commissioner before lock.')
  const disputes = await rpc(commissioner.client, 'commissioner_dispute_history', { p_pool_id: poolId, p_entry_id: playerEntries[0].entry_id, p_limit: 100 })
  const sensitiveBeforeLock = disputes.filter((row) => row.event_type === 'draft_saved')
  assert(sensitiveBeforeLock.length >= 2 && sensitiveBeforeLock.every((row) => row.details?.hidden_until_lock === true && !JSON.stringify(row).includes(earlyTeam)), 'Dispute history leaked a team before lock.')

  const outsiderSnapshot = await outsider.client.rpc('pool_standings_snapshot', { p_pool_id: poolId, p_week: 1 })
  assert(outsiderSnapshot.error, 'Non-member opened private standings.')
  const signedOutSnapshot = await signedOut.rpc('pool_standings_snapshot', { p_pool_id: poolId, p_week: 1 })
  assert(signedOutSnapshot.error, 'Signed-out visitor opened standings pick data.')
  const beforeSnapshot = await rpc(otherMember.client, 'pool_standings_snapshot', { p_pool_id: poolId, p_week: 1 })
  assert(beforeSnapshot[0].visible_picks.length === 0, 'Another member saw a pick before lock.')

  await rpc(commissioner.client, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'first_kickoff' })
  await rpc(commissioner.client, 'superadmin_finalize_test_week_drafts', { p_pool_id: poolId, p_week: 1 })
  const afterFirstKickoff = await rpc(otherMember.client, 'pool_visible_picks', { p_pool_id: poolId, p_week: 1, p_through_week: false })
  assert(afterFirstKickoff.some((pick) => pick.team_abbr === earlyTeam), `${deadlineMode}: early locked pick did not reveal.`)
  assert(!afterFirstKickoff.some((pick) => pick.team_abbr === lateTeam || pick.team_abbr === alternativeLateTeam), `${deadlineMode}: later pick leaked after first kickoff.`)

  const finalStage = deadlineMode === 'fixed' ? 'sunday_1pm' : 'week_done'
  await rpc(commissioner.client, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: finalStage })
  await rpc(commissioner.client, 'superadmin_finalize_test_week_drafts', { p_pool_id: poolId, p_week: 1 })
  const finalVisible = await rpc(otherMember.client, 'pool_visible_picks', { p_pool_id: poolId, p_week: 1, p_through_week: false })
  assert(finalVisible.some((pick) => pick.team_abbr === lateTeam), `${deadlineMode}: pick did not reveal after its deadline.`)

  checks.push(`${deadlineMode}: drafts private, early pick revealed alone, later picks stayed hidden until deadline`)
}

try {
  await createAuditPool('rolling')
  await createAuditPool('fixed')
  console.log(JSON.stringify({ pools: createdPoolIds.length, checks }, null, 2))
} finally {
  if (createdPoolIds.length) {
    await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).in('id', createdPoolIds)
  }
}
