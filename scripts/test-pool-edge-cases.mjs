import { createClient } from '@supabase/supabase-js'

const poolId = process.env.TEST_POOL_ID?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!poolId || !url || !anonKey || !serviceKey) throw new Error('Missing test environment variables.')
if (process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') throw new Error('Set ALLOW_TEST_POOL_MUTATIONS=true.')

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const emails = ['survivesunday1@gmail.com', 'taylor@swift.com', 'serena@williams.com', 'lebron@james.com']
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const rpc = async (client, name, args) => {
  const result = await client.rpc(name, args)
  if (result.error) throw new Error(`${name}: ${result.error.message}`)
  return result.data
}
const authenticate = async (email) => {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  return client
}

const clients = Object.fromEntries(await Promise.all(emails.map(async (email) => [email, await authenticate(email)])))
const admin = clients[emails[0]]
const pool = await admin.from('pools').select('test_mode,tie_rule,double_pick_weeks').eq('id', poolId).single()
if (pool.error) throw pool.error
assert(pool.data.test_mode && pool.data.tie_rule === 'loss' && pool.data.double_pick_weeks.includes(1), 'Unexpected Troll rules.')

await rpc(admin, 'superadmin_reset_test_pool', { p_pool_id: poolId })
await rpc(admin, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'before_week' })
const entries = await rpc(admin, 'superadmin_pool_entries', { p_pool_id: poolId })
const entry = Object.fromEntries(entries.map((row) => [row.email, row]))
const games = await rpc(admin, 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: 1 })

const plans = [
  { email: emails[0], game: games[0], slot: 1, team: games[0].home_team, outcome: 'home' },
  { email: emails[0], game: games[1], slot: 2, team: games[1].home_team, outcome: 'home' },
  { email: emails[1], game: games[2], slot: 1, team: games[2].home_team, outcome: 'home' },
  { email: emails[2], game: games[3], slot: 1, team: games[3].home_team, outcome: 'tie' },
  { email: emails[2], game: games[4], slot: 2, team: games[4].home_team, outcome: 'tie' },
  { email: emails[3], game: games[5], slot: 1, team: games[5].home_team, outcome: 'home' },
  { email: emails[3], game: games[6], slot: 2, team: games[6].home_team, outcome: 'home' },
]

for (const plan of plans) {
  await rpc(clients[plan.email], 'save_entry_draft_pick', {
    p_entry_id: entry[plan.email].entry_id, p_pool_id: poolId, p_slot: plan.slot, p_team_abbr: plan.team, p_week: 1,
  })
}
await rpc(admin, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'week_done' })
for (const plan of plans) {
  await rpc(admin, 'superadmin_set_test_game_outcome', {
    p_pool_id: poolId, p_week: 1, p_away_team: plan.game.away_team, p_home_team: plan.game.home_team, p_outcome: plan.outcome,
  })
}
await rpc(admin, 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 1 })
let scored = await rpc(admin, 'superadmin_pool_entries', { p_pool_id: poolId })
assert(scored.filter((row) => !row.eliminated).length === 2, 'Missing-pick and tie-loss scoring did not leave two survivors.')
assert(scored.find((row) => row.email === emails[1]).eliminated, 'Missing second pick did not eliminate Taylor.')
assert(scored.find((row) => row.email === emails[2]).eliminated, 'Tie-as-loss did not eliminate Serena.')

await rpc(admin, 'superadmin_clear_test_week_results', { p_pool_id: poolId, p_week: 1 })
const unscored = await rpc(admin, 'superadmin_pool_entries', { p_pool_id: poolId })
assert(unscored.every((row) => !row.eliminated), 'Unscore did not restore all entries to alive.')

for (const plan of plans) {
  await rpc(admin, 'superadmin_set_test_game_outcome', {
    p_pool_id: poolId, p_week: 1, p_away_team: plan.game.away_team, p_home_team: plan.game.home_team, p_outcome: plan.outcome,
  })
}
await rpc(admin, 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 1 })
const lebronPick = plans.find((plan) => plan.email === emails[3] && plan.slot === 1)
await rpc(admin, 'admin_override_entry_final_pick', {
  p_pool_id: poolId,
  p_entry_id: entry[emails[3]].entry_id,
  p_week: 1,
  p_slot: 1,
  p_team_abbr: lebronPick.game.away_team,
  p_reason: 'Automated test: verify commissioner correction rebuilds scoring',
})
scored = await rpc(admin, 'superadmin_pool_entries', { p_pool_id: poolId })
assert(scored.filter((row) => !row.eliminated).length === 1, 'Commissioner correction did not rebuild survivor status.')
const winner = await rpc(admin, 'pool_winner_status', { p_pool_id: poolId })
assert(winner[0].is_decided && winner[0].winner_name === 'Kevin Boudrow', 'Correction did not declare Kevin the winner.')
const integrity = await rpc(admin, 'admin_pool_scoring_integrity', { p_pool_id: poolId })
assert(integrity.every((row) => row.issue_count === 0), `Integrity failed: ${JSON.stringify(integrity)}`)

console.log(JSON.stringify({ missingDoublePick: 'pass', tieAsLoss: 'pass', unscoreRestore: 'pass', rescore: 'pass', commissionerCorrection: 'pass', winnerRecalculation: 'pass', integrity: 'pass' }, null, 2))
