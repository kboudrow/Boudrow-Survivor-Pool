import { createClient } from '@supabase/supabase-js'

const poolId = process.env.TEST_POOL_ID?.trim()
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!poolId || !url || !anonKey || !serviceKey) throw new Error('Missing test pool or Supabase environment variables.')
if (process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') throw new Error('Set ALLOW_TEST_POOL_MUTATIONS=true to run this test-pool simulation.')

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const emails = ['survivesunday1@gmail.com', 'taylor@swift.com', 'serena@williams.com', 'lebron@james.com']
const winnerEmail = emails[0]

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}

async function authenticate(email) {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  assert(verified.data.user?.email === email, `Authenticated as the wrong user for ${email}.`)
  return client
}

const clients = Object.fromEntries(await Promise.all(emails.map(async (email) => [email, await authenticate(email)])))
const superadmin = clients[winnerEmail]
const poolResult = await superadmin
  .from('pools')
  .select('id,name,start_week,include_playoffs,double_pick_weeks,strikes_allowed,test_mode')
  .eq('id', poolId)
  .single()
if (poolResult.error) throw poolResult.error
const pool = poolResult.data
assert(pool.test_mode === true, 'Refusing to simulate a pool outside test mode.')
assert(pool.include_playoffs === false, 'This harness currently targets a full 18-week regular season.')
assert(pool.start_week === 1, `Expected a Week 1 start, found Week ${pool.start_week}.`)

let entries = await rpc(superadmin, 'superadmin_pool_entries', { p_pool_id: poolId })
assert(entries.length === emails.length, `Expected ${emails.length} entries, found ${entries.length}.`)
assert(emails.every((email) => entries.some((entry) => entry.email === email)), 'Unexpected test-pool members.')

await rpc(superadmin, 'superadmin_reset_test_pool', { p_pool_id: poolId })
entries = await rpc(superadmin, 'superadmin_pool_entries', { p_pool_id: poolId })
const entryByEmail = Object.fromEntries(entries.map((entry) => [entry.email, entry]))
const usedTeams = Object.fromEntries(emails.map((email) => [email, new Set()]))
const weeklySummary = []

for (let week = 1; week <= 18; week += 1) {
  await rpc(superadmin, 'superadmin_set_test_pool_week', { p_pool_id: poolId, p_week: week })
  await rpc(superadmin, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: week, p_stage: 'before_week' })
  const games = await rpc(superadmin, 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: week })
  assert(games.length >= 13, `Week ${week} has only ${games.length} games.`)

  const slots = pool.double_pick_weeks?.includes(week) ? 2 : 1
  const decisions = new Map()
  const picks = []

  for (const email of emails) {
    const shouldWin = week < 18 || email === winnerEmail
    for (let slot = 1; slot <= slots; slot += 1) {
      let selected = null
      const rotatedGames = [...games.slice((week + slot + emails.indexOf(email)) % games.length), ...games.slice(0, (week + slot + emails.indexOf(email)) % games.length)]
      for (const game of rotatedGames) {
        for (const side of ['away', 'home']) {
          const team = side === 'away' ? game.away_team : game.home_team
          if (usedTeams[email].has(team)) continue
          const winnerSide = shouldWin ? side : side === 'away' ? 'home' : 'away'
          const existingDecision = decisions.get(game.game_id)
          if (existingDecision && existingDecision !== winnerSide) continue
          selected = { game, side, team, winnerSide }
          break
        }
        if (selected) break
      }
      assert(selected, `Could not allocate an unused ${shouldWin ? 'winning' : 'losing'} team to ${email} in Week ${week}, slot ${slot}.`)
      decisions.set(selected.game.game_id, selected.winnerSide)
      usedTeams[email].add(selected.team)
      picks.push({ email, slot, team: selected.team, game: selected.game })
      await rpc(clients[email], 'save_entry_draft_pick', {
        p_entry_id: entryByEmail[email].entry_id,
        p_pool_id: poolId,
        p_slot: slot,
        p_team_abbr: selected.team,
        p_week: week,
      })
    }
  }

  await rpc(superadmin, 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: week, p_stage: 'week_done' })
  for (const game of games) {
    const outcome = decisions.get(game.game_id)
    if (!outcome) continue
    await rpc(superadmin, 'superadmin_set_test_game_outcome', {
      p_pool_id: poolId,
      p_week: week,
      p_away_team: game.away_team,
      p_home_team: game.home_team,
      p_outcome: outcome,
    })
  }

  const scoreMessage = await rpc(superadmin, 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: week })
  const overview = await rpc(superadmin, 'admin_pool_entry_week_overview', { p_pool_id: poolId, p_week: week })
  const uniqueEntries = [...new Map(overview.map((row) => [row.entry_id, row])).values()]
  const alive = uniqueEntries.filter((row) => !row.eliminated)
  const integrity = await rpc(superadmin, 'admin_pool_scoring_integrity', { p_pool_id: poolId })
  const issues = integrity.filter((row) => row.status === 'fail' || row.issue_count > 0)
  assert(issues.length === 0, `Week ${week} integrity failure: ${JSON.stringify(issues)}`)
  assert(week < 18 ? alive.length === emails.length : alive.length === 1, `Week ${week} has ${alive.length} surviving entries.`)
  if (week === 18) assert(alive[0].display_name === 'Kevin Boudrow', `Unexpected season winner: ${alive[0].display_name}`)

  weeklySummary.push({
    week,
    slots,
    picks: picks.length,
    alive: alive.length,
    integrity: 'pass',
    message: scoreMessage,
  })
  console.log(`Week ${week}: ${picks.length} picks, ${alive.length} alive, integrity pass`)
}

const winnerStatus = await rpc(superadmin, 'pool_winner_status', { p_pool_id: poolId })
assert(winnerStatus.length === 1 && winnerStatus[0].is_decided, 'The official winner status did not declare a winner.')
assert(winnerStatus[0].winner_user_id === entryByEmail[winnerEmail].profile_id, 'The official winner does not match the expected winner.')
assert(winnerStatus[0].decided_week === 18, `Expected the winner in Week 18, found Week ${winnerStatus[0].decided_week}.`)

console.log(JSON.stringify({
  pool: pool.name,
  weeksScored: weeklySummary.length,
  totalPicks: weeklySummary.reduce((sum, week) => sum + week.picks, 0),
  winner: 'Kevin Boudrow',
  decidedWeek: winnerStatus[0].decided_week,
  uniqueTeamsUsedByWinner: usedTeams[winnerEmail].size,
  integrityEveryWeek: weeklySummary.every((week) => week.integrity === 'pass'),
  finalMessage: weeklySummary.at(-1).message,
}, null, 2))
