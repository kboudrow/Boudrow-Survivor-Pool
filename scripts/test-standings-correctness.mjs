import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey || process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') {
  throw new Error('Missing test environment or mutation opt-in.')
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const emails = ['survivesunday1@gmail.com', 'taylor@swift.com']
const clients = {}
const ids = {}
let poolId = null
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const rpc = async (client, name, args = {}) => {
  const response = await client.rpc(name, args)
  if (response.error) throw new Error(`${name}: ${response.error.message}`)
  return response.data
}

for (const email of emails) {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  clients[email] = client
  ids[email] = verified.data.user.id
}

const independentlyCalculate = async () => {
  const [{ data: picks, error: pickError }, { data: stats, error: statError }, { data: graces, error: graceError }] = await Promise.all([
    service.from('pool_picks').select('entry_id,week,slot,result,team_abbr').eq('pool_id', poolId).not('result', 'is', null),
    service.from('pool_member_stats').select('entry_id,wins,losses,pushes,strikes_used,eliminated,eliminated_week').eq('pool_id', poolId),
    service.from('pool_entry_survival_graces').select('entry_id,week,strike_credits').eq('pool_id', poolId),
  ])
  if (pickError || statError || graceError) throw pickError || statError || graceError
  const expected = new Map()
  for (const stat of stats) {
    const entryPicks = picks.filter((pick) => pick.entry_id === stat.entry_id).sort((a, b) => a.week - b.week || a.slot - b.slot)
    const allowance = graces.filter((grace) => grace.entry_id === stat.entry_id).reduce((sum, grace) => sum + grace.strike_credits, 0)
    let running = 0
    let eliminatedWeek = null
    for (const pick of entryPicks) {
      if (pick.result === 'loss') running += 1
      if (eliminatedWeek === null && running > allowance) eliminatedWeek = pick.week
    }
    const counted = entryPicks.filter((pick) => eliminatedWeek === null || pick.week <= eliminatedWeek)
    expected.set(stat.entry_id, {
      wins: counted.filter((pick) => pick.result === 'win').length,
      losses: counted.filter((pick) => pick.result === 'loss').length,
      pushes: counted.filter((pick) => pick.result === 'push').length,
      strikes_used: counted.filter((pick) => pick.result === 'loss').length,
      eliminated: eliminatedWeek !== null,
      eliminated_week: eliminatedWeek,
    })
  }
  for (const stat of stats) assert(JSON.stringify(expected.get(stat.entry_id)) === JSON.stringify({
    wins: stat.wins, losses: stat.losses, pushes: stat.pushes, strikes_used: stat.strikes_used,
    eliminated: stat.eliminated, eliminated_week: stat.eliminated_week,
  }), `Stored standings differ from independent calculation for ${stat.entry_id}.`)
  return { picks, stats, graces }
}

try {
  const pool = await service.from('pools').insert({
    name: `Standings Correctness Audit ${Date.now()}`, created_by: ids[emails[0]], is_public: true,
    visibility: 'public', allow_discovery: false, start_week: 3, include_playoffs: false,
    strikes_allowed: '0', tie_rule: 'loss', ties: 'loss', deadline_mode: 'rolling', deadline_fixed: '13:00',
    season: 2026, double_pick_weeks: [3], max_members: 20, allow_multiple_entries: true,
    max_entries_per_user: 2, activation_status: 'active', payment_status: 'not_required', test_mode: false,
  }).select('id').single()
  if (pool.error) throw pool.error
  poolId = pool.data.id

  const members = await service.from('pool_members').insert([
    { pool_id: poolId, profile_id: ids[emails[0]], role: 'admin', status: 'alive', entry_number: 1 },
    { pool_id: poolId, profile_id: ids[emails[0]], role: 'admin', status: 'alive', entry_number: 2 },
    { pool_id: poolId, profile_id: ids[emails[1]], role: 'member', status: 'alive', entry_number: 1 },
  ]).select('id,profile_id,entry_number')
  if (members.error) throw members.error
  await rpc(clients[emails[0]], 'superadmin_set_pool_test_mode', { p_pool_id: poolId, p_enabled: true })
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 3, p_stage: 'before_week' })
  const games = await rpc(clients[emails[0]], 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: 3 })
  const [entryA, entryB, entryC] = members.data
  const selections = [
    [entryA, clients[emails[0]], 1, games[0]], [entryA, clients[emails[0]], 2, games[1]],
    [entryB, clients[emails[0]], 1, games[2]],
    [entryC, clients[emails[1]], 1, games[3]], [entryC, clients[emails[1]], 2, games[4]],
  ]
  for (const [entry, client, slot, game] of selections) {
    await rpc(client, 'save_entry_draft_pick', { p_pool_id: poolId, p_entry_id: entry.id, p_week: 3, p_slot: slot, p_team_abbr: game.home_team })
  }
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 3, p_stage: 'week_done' })
  for (let i = 0; i < 5; i += 1) {
    await rpc(clients[emails[0]], 'superadmin_set_test_game_outcome', {
      p_pool_id: poolId, p_week: 3, p_away_team: games[i].away_team, p_home_team: games[i].home_team,
      p_outcome: i === 4 ? 'tie' : 'away',
    })
  }
  await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 3 })
  const wipeout = await independentlyCalculate()
  assert(wipeout.stats.every((row) => !row.eliminated && row.losses === 2), 'Double-pick wipeout did not preserve every entry with two recorded losses.')
  assert(wipeout.graces.length === 3 && wipeout.graces.every((row) => row.strike_credits === 2), 'Wipeout credits were not exactly two per entry.')
  const snapshot = await rpc(clients[emails[0]], 'pool_standings_snapshot', { p_pool_id: poolId, p_week: 3 })
  assert(snapshot[0].stats.every((row) => row.survival_graces?.[0]?.strike_credits === 2), 'Standings snapshot omitted survival credits.')

  for (const game of [games[0], games[1]]) {
    await rpc(clients[emails[0]], 'superadmin_set_test_game_outcome', {
      p_pool_id: poolId, p_week: 3, p_away_team: game.away_team, p_home_team: game.home_team, p_outcome: 'home',
    })
    await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 3 })
  }
  const corrected = await independentlyCalculate()
  const correctedA = corrected.stats.find((row) => row.entry_id === entryA.id)
  assert(corrected.graces.length === 0, 'Pool-wide wipeout credits survived after a corrected winner existed.')
  assert(correctedA.wins === 2 && !correctedA.eliminated, 'Corrected double-pick winner was not alive with two wins.')
  assert(corrected.stats.filter((row) => row.entry_id !== entryA.id).every((row) => row.eliminated && row.eliminated_week === 3), 'Losing entries were not eliminated in Week 3 after correction.')

  const beforeRepeat = JSON.stringify(corrected)
  await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 3 })
  const repeated = await independentlyCalculate()
  assert(JSON.stringify(repeated) === beforeRepeat, 'Repeated scoring changed standings, picks, or survival credits.')

  console.log(JSON.stringify({ poolId, expected: {
    initial: 'all three entries alive; 2 losses and 2 wipeout credits each',
    corrected: 'Entry 1 has 2 wins and survives; Entry 2 and Taylor are eliminated in Week 3; no wipeout credits remain',
    repeated: 'identical picks, stats, and credits',
  }, actual: { initial: wipeout.stats, corrected: corrected.stats, graceRowsAfterCorrection: corrected.graces.length }, status: 'passed' }, null, 2))
} finally {
  if (poolId) await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', poolId)
}
