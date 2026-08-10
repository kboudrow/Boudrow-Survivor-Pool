import { createClient } from '@supabase/supabase-js'

const poolId = process.env.TEST_POOL_ID?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const allowed = process.env.ALLOW_TEST_POOL_MUTATIONS === 'true'

if (!poolId || !url || !anonKey || !serviceKey) throw new Error('Missing test pool or Supabase environment variables.')
if (!allowed) throw new Error('Set ALLOW_TEST_POOL_MUTATIONS=true to run the destructive test-pool reset.')

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const expectedEmails = ['survivesunday1@gmail.com', 'taylor@swift.com', 'serena@williams.com', 'lebron@james.com']

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

async function userClient(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  assert(verified.data.user?.email === email, `Authenticated as the wrong user for ${email}`)
  return client
}

const superadmin = await userClient('survivesunday1@gmail.com')
const poolQuery = await superadmin.from('pools').select('id,name,test_mode').eq('id', poolId).single()
if (poolQuery.error) throw poolQuery.error
const pool = poolQuery.data
assert(pool, 'Pool not found.')
assert(pool.test_mode === true, 'Refusing to mutate a pool that is not in test mode.')

let entries = await rpc(superadmin, 'superadmin_pool_entries', { p_pool_id: poolId })
assert(entries.length === 4, `Expected exactly four entries, found ${entries.length}.`)
assert(expectedEmails.every((email) => entries.some((entry) => entry.email === email)), 'Unexpected test-pool membership.')

const clients = Object.fromEntries(await Promise.all(expectedEmails.map(async (email) => [email, email === 'survivesunday1@gmail.com' ? superadmin : await userClient(email)])))
const resetMessage = await rpc(clients['survivesunday1@gmail.com'], 'superadmin_reset_test_pool', { p_pool_id: poolId })
await rpc(clients['survivesunday1@gmail.com'], 'superadmin_set_test_pool_week', { p_pool_id: poolId, p_week: 1 })
await rpc(clients['survivesunday1@gmail.com'], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'before_week' })

entries = await rpc(superadmin, 'superadmin_pool_entries', { p_pool_id: poolId })
const options = await rpc(clients['survivesunday1@gmail.com'], 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: 1 })
assert(options.length >= 8, `Expected at least eight Week 1 games, found ${options.length}.`)

const assignments = expectedEmails.map((email, index) => {
  return {
    email,
    entryId: entries.find((entry) => entry.email === email).entry_id,
    picks: [1, 2].map((slot) => {
      const game = options[index * 2 + slot - 1]
      return { slot, game, team: index === 0 ? game.home_team : game.away_team }
    }),
  }
})

for (const assignment of assignments) {
  for (const pick of assignment.picks) {
    await rpc(clients[assignment.email], 'save_entry_draft_pick', {
      p_entry_id: assignment.entryId,
      p_pool_id: poolId,
      p_slot: pick.slot,
      p_team_abbr: pick.team,
      p_week: 1,
    })
  }
}

const taylor = assignments.find((item) => item.email === 'taylor@swift.com')
const changedPick = taylor.picks[0]
const changedTeam = changedPick.game.home_team
await rpc(clients[taylor.email], 'save_entry_draft_pick', {
  p_entry_id: taylor.entryId,
  p_pool_id: poolId,
  p_slot: 1,
  p_team_abbr: changedTeam,
  p_week: 1,
})
changedPick.team = changedTeam

let duplicateGuard = ''
try {
  await rpc(clients[taylor.email], 'save_entry_draft_pick', {
    p_entry_id: taylor.entryId,
    p_pool_id: poolId,
    p_slot: 1,
    p_team_abbr: changedTeam,
    p_week: 2,
  })
} catch (error) {
  duplicateGuard = error.message
}
assert(/already used|already selected|different team/i.test(duplicateGuard), `Team-reuse guard did not fire: ${duplicateGuard || 'no error'}`)

await rpc(clients['survivesunday1@gmail.com'], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: 1, p_stage: 'week_done' })
await rpc(clients['survivesunday1@gmail.com'], 'superadmin_finalize_test_week_drafts', { p_pool_id: poolId, p_week: 1 })

let lockedGuard = ''
try {
  await rpc(clients[taylor.email], 'save_entry_draft_pick', {
    p_entry_id: taylor.entryId,
    p_pool_id: poolId,
    p_slot: 1,
    p_team_abbr: changedPick.game.away_team,
    p_week: 1,
  })
} catch (error) {
  lockedGuard = error.message
}
assert(/locked|can no longer/i.test(lockedGuard), `Locked-pick guard did not fire: ${lockedGuard || 'no error'}`)

for (const assignment of assignments) {
  for (const pick of assignment.picks) {
    const chosenSide = pick.team === pick.game.home_team ? 'home' : 'away'
    const outcome = assignment.email === 'survivesunday1@gmail.com' ? chosenSide : chosenSide === 'home' ? 'away' : 'home'
    await rpc(clients['survivesunday1@gmail.com'], 'superadmin_set_test_game_outcome', {
      p_pool_id: poolId,
      p_week: 1,
      p_away_team: pick.game.away_team,
      p_home_team: pick.game.home_team,
      p_outcome: outcome,
    })
  }
}

const scoreMessage = await rpc(clients['survivesunday1@gmail.com'], 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: 1 })
const week = await rpc(clients['survivesunday1@gmail.com'], 'admin_pool_entry_week_overview', { p_pool_id: poolId, p_week: 1 })
const integrity = await rpc(clients['survivesunday1@gmail.com'], 'admin_pool_scoring_integrity', { p_pool_id: poolId })
const aliveRows = week.filter((row) => !row.eliminated)
const alive = [...new Map(aliveRows.map((row) => [row.entry_id, row])).values()]
const passedIntegrity = integrity.every((row) => row.status === 'pass' || row.issue_count === 0)

assert(alive.length === 1, `Expected exactly one survivor, found ${alive.length}.`)
assert(alive[0].display_name === 'Kevin Boudrow', `Unexpected survivor: ${alive[0].display_name}`)
assert(passedIntegrity, `Scoring integrity failed: ${JSON.stringify(integrity)}`)

console.log(JSON.stringify({
  pool: { id: poolId, name: pool.name, testMode: pool.test_mode },
  resetMessage,
  tested: {
    authenticatedUsers: expectedEmails.length,
    draftSave: true,
    preLockChange: true,
    duplicateTeamGuard: duplicateGuard,
    lockedPickGuard: lockedGuard,
    deterministicScoring: true,
  },
  scoreMessage,
  survivor: alive[0].display_name,
  week: week.map((row) => ({ name: row.display_name, slot: row.slot, pick: row.final_team_abbr, result: row.result, eliminated: row.eliminated })),
  integrity,
}, null, 2))
