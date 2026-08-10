import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey || process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') {
  throw new Error('Missing Supabase environment or ALLOW_TEST_POOL_MUTATIONS=true.')
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const poolIds = []
const checks = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const pass = (message) => checks.push(message)
const rpc = async (client, name, args = {}) => {
  const response = await client.rpc(name, args)
  if (response.error) throw new Error(`${name}: ${response.error.message}`)
  return response.data
}
const rejected = async (promise, pattern) => {
  try { await promise } catch (error) {
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
const playerSecondTab = await authenticate('taylor@swift.com')

async function save(client, poolId, entryId, slot, team) {
  return rpc(client, 'save_entry_draft_pick', {
    p_pool_id: poolId, p_entry_id: entryId, p_week: 1, p_slot: slot, p_team_abbr: team,
  })
}
async function clear(client, poolId, entryId, slot) {
  return rpc(client, 'clear_entry_draft_pick', {
    p_pool_id: poolId, p_entry_id: entryId, p_week: 1, p_slot: slot,
  })
}

try {
  const created = await service.from('pools').insert({
    name: `Concurrency Audit ${Date.now()}`,
    created_by: owner.id,
    is_public: true,
    visibility: 'public',
    allow_discovery: false,
    start_week: 1,
    include_playoffs: false,
    strikes_allowed: '1',
    tie_rule: 'loss',
    ties: 'loss',
    deadline_mode: 'rolling',
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
  if (created.error) throw created.error
  const poolId = created.data.id
  poolIds.push(poolId)

  const ownerEntryInsert = await service.from('pool_members').insert({
    pool_id: poolId, profile_id: owner.id, role: 'admin', status: 'alive', entry_number: 1,
  }).select('id').single()
  if (ownerEntryInsert.error) throw ownerEntryInsert.error
  const ownerEntry = ownerEntryInsert.data.id

  await rpc(owner.client, 'join_pool', { p_pool_id: poolId, p_password: null, p_token: null })
  await rpc(player.client, 'join_pool', { p_pool_id: poolId, p_password: null, p_token: null })
  const secondEntryId = await rpc(player.client, 'add_pool_entry', { p_pool_id: poolId })
  await rpc(owner.client, 'superadmin_set_pool_test_mode', { p_pool_id: poolId, p_enabled: true })
  await rpc(owner.client, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'before_week' })

  const roster = await rpc(owner.client, 'superadmin_pool_entries', { p_pool_id: poolId })
  const playerEntries = roster.filter((entry) => entry.email === 'taylor@swift.com').sort((a, b) => a.entry_number - b.entry_number)
  assert(playerEntries.length === 2 && playerEntries.some((entry) => entry.entry_id === secondEntryId), 'Two independent player entries were not created.')
  const [playerA, playerB] = playerEntries.map((entry) => entry.entry_id)
  const games = await rpc(owner.client, 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: 1 })
  assert(games.length >= 4, 'Week 1 test schedule is incomplete.')

  const repeated = await Promise.allSettled(Array.from({ length: 30 }, (_, index) =>
    save(index % 2 ? player.client : playerSecondTab.client, poolId, playerA, 1, games[0].home_team)))
  assert(repeated.every((result) => result.status === 'fulfilled'), 'An idempotent browser retry failed.')
  let rows = await service.from('pool_pick_drafts').select('team_abbr').eq('pool_id', poolId).eq('entry_id', playerA).eq('week', 1).eq('slot', 1)
  assert(!rows.error && rows.data.length === 1, 'Duplicate requests created duplicate draft rows.')
  pass('30 duplicate/retried requests produced one draft row')

  const rapidTeams = games.slice(0, 8).map((game, index) => index % 2 ? game.away_team : game.home_team)
  const rapid = await Promise.allSettled(rapidTeams.map((team, index) =>
    save(index % 2 ? player.client : playerSecondTab.client, poolId, playerA, 1, team)))
  assert(rapid.every((result) => result.status === 'fulfilled'), 'Rapid valid changes did not serialize.')
  rows = await service.from('pool_pick_drafts').select('team_abbr').eq('pool_id', poolId).eq('entry_id', playerA).eq('week', 1).eq('slot', 1)
  assert(!rows.error && rows.data.length === 1 && rapidTeams.includes(rows.data[0].team_abbr), 'Rapid changes did not leave exactly one requested value.')
  pass('rapid two-tab changes serialized to one valid value')

  await clear(player.client, poolId, playerA, 1)
  await clear(player.client, poolId, playerA, 2)
  const duplicateSlots = await Promise.allSettled([
    save(player.client, poolId, playerA, 1, games[0].home_team),
    save(playerSecondTab.client, poolId, playerA, 2, games[0].home_team),
  ])
  assert(duplicateSlots.filter((result) => result.status === 'fulfilled').length === 1, 'Same team won both double-pick slots concurrently.')
  rows = await service.from('pool_pick_drafts').select('slot,team_abbr').eq('pool_id', poolId).eq('entry_id', playerA).eq('week', 1).eq('team_abbr', games[0].home_team)
  assert(!rows.error && rows.data.length === 1, 'Duplicate team exists across double-pick slots.')
  pass('same team cannot race into both double-pick slots')

  for (const [client, entryId] of [[owner.client, ownerEntry], [player.client, playerA], [playerSecondTab.client, playerB]]) {
    await Promise.all([clear(client, poolId, entryId, 1), clear(client, poolId, entryId, 2)])
  }
  await Promise.all([
    save(owner.client, poolId, ownerEntry, 1, games[0].away_team),
    save(owner.client, poolId, ownerEntry, 2, games[1].away_team),
    save(player.client, poolId, playerA, 1, games[0].home_team),
    save(player.client, poolId, playerA, 2, games[1].away_team),
    save(playerSecondTab.client, poolId, playerB, 1, games[0].home_team),
    save(playerSecondTab.client, poolId, playerB, 2, games[1].home_team),
  ])
  rows = await service.from('pool_pick_drafts').select('entry_id,slot,team_abbr').eq('pool_id', poolId).eq('week', 1)
  assert(!rows.error && rows.data.length === 6, 'Concurrent writes across independent entries lost a pick.')
  assert(rows.data.filter((row) => row.team_abbr === games[0].home_team).length === 2, 'One user could not use the same team in two independent entries.')
  pass('multiple entries update independently under concurrent load')

  for (const game of games) {
    await rpc(owner.client, 'superadmin_set_test_game_outcome', {
      p_pool_id: poolId, p_week: 1, p_away_team: game.away_team, p_home_team: game.home_team, p_outcome: 'home',
    })
  }
  await rpc(owner.client, 'superadmin_rebuild_test_pool_stats', { p_pool_id: poolId })
  await rpc(owner.client, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'week_done' })

  const score = () => rpc(owner.client, 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 1 })
  const standingsReads = Array.from({ length: 30 }, () => service.from('pool_member_stats').select('entry_id,wins,losses,strikes_used,eliminated').eq('pool_id', poolId))
  const simultaneous = await Promise.allSettled([score(), score(), ...standingsReads])
  assert(simultaneous.every((result) => result.status === 'fulfilled'), 'Concurrent scoring/read request failed.')
  for (const result of simultaneous.slice(2)) {
    assert(result.value.data.length === 3, 'A standings reader observed a partially rebuilt pool.')
  }
  pass('two scoring jobs and 30 standings reads stayed atomic')

  const picks = await service.from('pool_picks').select('entry_id,week,slot,team_abbr,result').eq('pool_id', poolId).eq('week', 1)
  assert(!picks.error && picks.data.length === 6, 'Concurrent scoring duplicated or lost finalized picks.')
  const uniqueSlots = new Set(picks.data.map((pick) => `${pick.entry_id}:${pick.week}:${pick.slot}`))
  assert(uniqueSlots.size === 6, 'Final pick uniqueness was violated.')
  const stats = await service.from('pool_member_stats').select('entry_id,wins,losses,strikes_used,eliminated,eliminated_week').eq('pool_id', poolId)
  assert(!stats.error && stats.data.length === 3, 'Standings did not retain one row per entry.')
  const byEntry = new Map(stats.data.map((row) => [row.entry_id, row]))
  assert(byEntry.get(ownerEntry).losses === 2 && byEntry.get(ownerEntry).eliminated, 'Two losses did not eliminate the owner entry exactly once.')
  assert(byEntry.get(playerA).losses === 1 && !byEntry.get(playerA).eliminated, 'One mulligan was not consumed exactly once.')
  assert(byEntry.get(playerB).losses === 0 && !byEntry.get(playerB).eliminated, 'Winning entry status was corrupted.')
  pass('duplicate scoring did not duplicate mulligans, eliminations, or final picks')

  await rejected(save(player.client, poolId, playerA, 1, games[2].home_team), /locked|deadline|final/i)
  pass('authoritative database time rejected a post-deadline request')

  const correctionTeam = games[2].home_team
  const correctionAndScore = await Promise.allSettled([
    rpc(owner.client, 'admin_override_entry_final_pick', {
      p_pool_id: poolId, p_entry_id: ownerEntry, p_week: 1, p_team_abbr: correctionTeam,
      p_reason: 'Concurrency regression test', p_slot: 1,
    }),
    score(),
  ])
  assert(correctionAndScore.every((result) => result.status === 'fulfilled'), 'Correction and scoring deadlocked or failed.')
  const corrected = await service.from('pool_picks').select('team_abbr,result').eq('pool_id', poolId).eq('entry_id', ownerEntry).eq('week', 1).eq('slot', 1).single()
  assert(!corrected.error && corrected.data.team_abbr === correctionTeam && corrected.data.result === 'win', 'Correction/scoring order produced a stale result.')
  const correctedStats = await service.from('pool_member_stats').select('losses,strikes_used,eliminated').eq('pool_id', poolId).eq('entry_id', ownerEntry).single()
  assert(!correctedStats.error && correctedStats.data.losses === 1 && correctedStats.data.strikes_used === 1 && !correctedStats.data.eliminated, 'Correction did not rebuild one deterministic standings state.')
  pass('commissioner correction and scoring serialized without stale standings')

  console.log(JSON.stringify({ poolId, checks: checks.length, passed: checks }, null, 2))
} finally {
  if (poolIds.length) {
    await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).in('id', poolIds)
  }
}

