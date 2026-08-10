import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey) throw new Error('Missing Supabase environment variables.')
if (process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') throw new Error('Set ALLOW_TEST_POOL_MUTATIONS=true.')

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const emails = ['survivesunday1@gmail.com', 'taylor@swift.com', 'serena@williams.com']
const clients = {}
const createdPoolIds = []
const results = {}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function authenticate(email) {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  assert(verified.data.user?.email === email, `Authenticated as the wrong user for ${email}`)
  return client
}

async function rpc(client, name, args = {}) {
  const response = await client.rpc(name, args)
  if (response.error) throw new Error(`${name}: ${response.error.message}`)
  return response.data
}

async function expectReject(label, action, pattern) {
  let message = ''
  try { await action() } catch (error) { message = error.message }
  assert(message && pattern.test(message), `${label} did not reject as expected: ${message || 'no error'}`)
  results[label] = message
}

async function createAuditPool({ name, startWeek, doubleWeeks, deadlineMode, tieRule = 'loss', strikes = '1' }) {
  const identities = Object.fromEntries(await Promise.all(emails.map(async (email) => {
    const user = await clients[email].auth.getUser()
    if (user.error || !user.data.user) throw user.error ?? new Error(`Missing identity for ${email}`)
    return [email, user.data.user.id]
  })))
  const inserted = await service.from('pools').insert({
    name, created_by: identities[emails[0]], is_public: true, visibility: 'public', allow_discovery: false,
    start_week: startWeek, include_playoffs: false, strikes_allowed: strikes, tie_rule: tieRule, ties: tieRule,
    deadline_mode: deadlineMode, deadline_fixed: '13:00', notes: 'Automated survivor-logic audit pool. Safe to archive.',
    season: 2026, double_pick_weeks: doubleWeeks, max_members: 20, allow_multiple_entries: true,
    max_entries_per_user: 2, activation_status: 'active', payment_status: 'not_required', test_mode: false,
  }).select('id').single()
  if (inserted.error) throw inserted.error
  const id = inserted.data.id
  createdPoolIds.push(id)
  const members = await service.from('pool_members').insert([
    { pool_id: id, profile_id: identities[emails[0]], role: 'admin', status: 'alive', entry_number: 1 },
    { pool_id: id, profile_id: identities[emails[0]], role: 'admin', status: 'alive', entry_number: 2 },
    { pool_id: id, profile_id: identities[emails[1]], role: 'member', status: 'alive', entry_number: 1 },
    { pool_id: id, profile_id: identities[emails[2]], role: 'member', status: 'alive', entry_number: 1 },
  ])
  if (members.error) throw members.error
  await rpc(clients[emails[0]], 'superadmin_set_pool_test_mode', { p_pool_id: id, p_enabled: true })
  return id
}

async function entriesByEmail(poolId) {
  const rows = await rpc(clients[emails[0]], 'superadmin_pool_entries', { p_pool_id: poolId })
  return Object.fromEntries(emails.map((email) => [email, rows.filter((row) => row.email === email)]))
}

async function options(poolId, week) {
  return rpc(clients[emails[0]], 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: week })
}

async function save(client, poolId, entryId, week, slot, team) {
  return rpc(client, 'save_entry_draft_pick', {
    p_pool_id: poolId, p_entry_id: entryId, p_week: week, p_slot: slot, p_team_abbr: team,
  })
}

async function outcome(poolId, week, game, value) {
  return rpc(clients[emails[0]], 'superadmin_set_test_game_outcome', {
    p_pool_id: poolId, p_week: week, p_away_team: game.away_team, p_home_team: game.home_team, p_outcome: value,
  })
}

try {
  for (const email of emails) clients[email] = await authenticate(email)

  const fixedId = await createAuditPool({
    name: `Logic Audit Fixed ${Date.now()}`, startWeek: 3, doubleWeeks: [3], deadlineMode: 'fixed', tieRule: 'loss', strikes: '1',
  })
  const fixedEntries = await entriesByEmail(fixedId)
  const owner1 = fixedEntries[emails[0]][0].entry_id
  const owner2 = fixedEntries[emails[0]][1].entry_id
  const taylor = fixedEntries[emails[1]][0].entry_id
  const serena = fixedEntries[emails[2]][0].entry_id

  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: fixedId, p_week: 3, p_stage: 'before_week' })
  const week3 = await options(fixedId, 3)
  const teams = week3.flatMap((game) => [game.home_team, game.away_team])

  await expectReject('pre-start week blocked', () => save(clients[emails[0]], fixedId, owner1, 2, 1, teams[0]), /outside|start|playable/i)
  await expectReject('extra double-week slot blocked', () => save(clients[emails[0]], fixedId, owner1, 3, 3, teams[0]), /slot|requires/i)
  await expectReject('wrong-entry ownership blocked', () => save(clients[emails[1]], fixedId, owner1, 3, 1, teams[0]), /entry|belong|authorized/i)

  await save(clients[emails[0]], fixedId, owner1, 3, 1, teams[0])
  await save(clients[emails[0]], fixedId, owner2, 3, 1, teams[0])
  results['independent entry histories'] = 'same team accepted for two entries owned by one user'
  await expectReject('same-entry double-week duplicate blocked', () => save(clients[emails[0]], fixedId, owner1, 3, 2, teams[0]), /already|different team/i)

  const concurrent = await Promise.allSettled([
    save(clients[emails[0]], fixedId, owner1, 3, 2, teams[2]),
    save(clients[emails[0]], fixedId, owner1, 3, 2, teams[2]),
  ])
  assert(concurrent.every((item) => item.status === 'fulfilled'), 'Idempotent duplicate requests should both complete.')
  const sameSlotRows = await service.from('pool_pick_drafts').select('team_abbr').eq('pool_id', fixedId).eq('entry_id', owner1).eq('week', 3).eq('slot', 2)
  assert(!sameSlotRows.error && sameSlotRows.data.length === 1, 'Concurrent identical requests created duplicate rows.')
  results['concurrent duplicate request'] = 'one authoritative draft row'

  const race = await Promise.allSettled([
    save(clients[emails[0]], fixedId, owner2, 3, 2, teams[4]),
    save(clients[emails[0]], fixedId, owner2, 3, 2, teams[4]),
  ])
  assert(race.every((item) => item.status === 'fulfilled'), 'Serialized same-slot requests failed unexpectedly.')

  await save(clients[emails[1]], fixedId, taylor, 3, 1, teams[6])
  await save(clients[emails[2]], fixedId, serena, 3, 1, teams[8])
  await save(clients[emails[2]], fixedId, serena, 3, 2, teams[10])
  await save(clients[emails[2]], fixedId, serena, 3, 2, teams[12])
  results['pre-deadline change'] = 'accepted and replaced the same entry/week/slot'

  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: fixedId, p_week: 3, p_stage: 'first_kickoff' })
  await expectReject('early-game post-kickoff change blocked', () => save(clients[emails[0]], fixedId, owner1, 3, 1, teams[1]), /locked|deadline|no longer/i)

  const lateGame = [...week3].reverse().find((game) => new Date(game.game_time) > new Date(week3[0].game_time))
  assert(lateGame, 'No later Week 3 game found.')
  await save(clients[emails[2]], fixedId, serena, 3, 2, lateGame.home_team)
  results['fixed deadline partial-week behavior'] = 'later game remained editable after first kickoff'
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: fixedId, p_week: 3, p_stage: 'sunday_1pm' })
  await expectReject('fixed deadline blocks remaining games', () => save(clients[emails[2]], fixedId, serena, 3, 2, lateGame.away_team), /locked|deadline|no longer/i)

  await expectReject('admin pre-start override blocked', () => rpc(clients[emails[0]], 'admin_override_entry_final_pick', {
    p_pool_id: fixedId, p_entry_id: owner1, p_week: 2, p_slot: 1, p_team_abbr: teams[0], p_reason: 'audit',
  }), /outside|playable/i)
  await expectReject('admin invalid slot override blocked', () => rpc(clients[emails[0]], 'admin_override_entry_final_pick', {
    p_pool_id: fixedId, p_entry_id: owner1, p_week: 3, p_slot: 3, p_team_abbr: teams[0], p_reason: 'audit',
  }), /slot|requires/i)

  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: fixedId, p_week: 3, p_stage: 'week_done' })
  const final3 = await service.from('pool_picks').select('entry_id,slot,team_abbr').eq('pool_id', fixedId).eq('week', 3)
  assert(!final3.error, final3.error?.message)
  for (const row of final3.data.filter((pick) => pick.team_abbr !== 'NO_PICK_1' && pick.team_abbr !== 'NO_PICK_2')) {
    const game = week3.find((item) => [item.home_team, item.away_team].includes(row.team_abbr))
    const selectedSide = row.team_abbr === game.home_team ? 'home' : 'away'
    let desired = 'home'
    if (row.entry_id === owner1 && row.slot === 1) desired = selectedSide
    else if (row.entry_id === owner1 && row.slot === 2) desired = selectedSide === 'home' ? 'away' : 'home'
    else if (row.entry_id === owner2 && row.slot === 1) desired = selectedSide
    else if (row.entry_id === owner2 && row.slot === 2) desired = 'tie'
    else if (row.entry_id === taylor) desired = selectedSide
    else if (row.entry_id === serena) desired = selectedSide
    await outcome(fixedId, 3, game, desired)
  }
  await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: fixedId, p_week: 3 })
  let scored = await rpc(clients[emails[0]], 'superadmin_pool_entries', { p_pool_id: fixedId })
  assert(scored.every((row) => !row.eliminated), 'A first loss/missed pick incorrectly eliminated an entry with one mulligan.')
  assert(scored.find((row) => row.entry_id === owner1).strikes_used === 1, 'Double-pick week did not score both owner1 picks.')
  assert(scored.find((row) => row.entry_id === owner2).strikes_used === 1, 'Tie-as-loss did not consume exactly one mulligan.')
  assert(scored.find((row) => row.entry_id === taylor).strikes_used === 1, 'Missing double-week slot did not consume one mulligan.')
  results['combined week 3 scoring'] = 'win/loss, tie-loss, missing slot, double picks, and mulligans correct'

  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: fixedId, p_week: 4, p_stage: 'before_week' })
  const week4 = await options(fixedId, 4)
  const owner1Used = new Set(final3.data.filter((row) => row.entry_id === owner1).map((row) => row.team_abbr))
  const unusedWeek4Team = week4.flatMap((game) => [game.home_team, game.away_team]).find((team) => !owner1Used.has(team))
  assert(unusedWeek4Team, 'No unused Week 4 team found for slot-boundary test.')
  await expectReject('normal-week slot 2 blocked', () => save(clients[emails[0]], fixedId, owner1, 4, 2, unusedWeek4Team), /slot|requires/i)
  await expectReject('used team in later week blocked', () => save(clients[emails[0]], fixedId, owner1, 4, 1, teams[0]), /already|different team/i)
  const usedByEntry = (entryId) => new Set(final3.data.filter((row) => row.entry_id === entryId).map((row) => row.team_abbr))
  const selectUnusedGame = (entryId, excludedGameIds = new Set()) => week4.find((game) =>
    !excludedGameIds.has(game.game_id) && !usedByEntry(entryId).has(game.home_team))
  const owner1Game = selectUnusedGame(owner1)
  const owner2Game = selectUnusedGame(owner2, new Set([owner1Game?.game_id]))
  const serenaGame = selectUnusedGame(serena, new Set([owner1Game?.game_id, owner2Game?.game_id]))
  assert(owner1Game && owner2Game && serenaGame, 'Could not find distinct unused Week 4 games.')
  await save(clients[emails[0]], fixedId, owner1, 4, 1, owner1Game.home_team)
  await save(clients[emails[0]], fixedId, owner2, 4, 1, owner2Game.home_team)
  await save(clients[emails[2]], fixedId, serena, 4, 1, serenaGame.home_team)
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: fixedId, p_week: 4, p_stage: 'week_done' })
  await outcome(fixedId, 4, owner1Game, 'away')
  await outcome(fixedId, 4, owner2Game, 'home')
  await outcome(fixedId, 4, serenaGame, 'home')
  await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: fixedId, p_week: 4 })
  scored = await rpc(clients[emails[0]], 'superadmin_pool_entries', { p_pool_id: fixedId })
  assert(scored.find((row) => row.entry_id === owner1).eliminated, 'Second loss did not eliminate owner1.')
  assert(scored.find((row) => row.entry_id === taylor).eliminated, 'Second missed pick did not eliminate Taylor.')
  assert(!scored.find((row) => row.entry_id === owner2).eliminated, 'Winning owner2 entry was eliminated.')
  assert(scored.find((row) => row.entry_id === owner1).strikes_used === 2, 'Entry received more or fewer losses than actual; mulligan accounting is wrong.')
  await expectReject('eliminated entry future pick blocked', () => save(clients[emails[0]], fixedId, owner1, 5, 1, week4[3].home_team), /eliminated|active/i)
  const integrity = await rpc(clients[emails[0]], 'admin_pool_scoring_integrity', { p_pool_id: fixedId })
  assert(integrity.every((row) => row.issue_count === 0), `Integrity audit failed: ${JSON.stringify(integrity)}`)

  const rollingId = await createAuditPool({
    name: `Logic Audit Rolling ${Date.now()}`, startWeek: 1, doubleWeeks: [], deadlineMode: 'rolling', tieRule: 'win', strikes: '0',
  })
  const rollingEntries = await entriesByEmail(rollingId)
  const rollingOwner = rollingEntries[emails[0]][0].entry_id
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: rollingId, p_week: 1, p_stage: 'before_week' })
  const week1 = await options(rollingId, 1)
  const first = week1[0]
  const later = week1.find((game) => new Date(game.game_time) > new Date(first.game_time))
  assert(later, 'No rolling-deadline later game found.')
  await save(clients[emails[0]], rollingId, rollingOwner, 1, 1, first.home_team)
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: rollingId, p_week: 1, p_stage: 'first_kickoff' })
  await expectReject('rolling early game locked', () => save(clients[emails[0]], rollingId, rollingOwner, 1, 1, first.away_team), /locked|deadline|no longer/i)
  await rpc(clients[emails[0]], 'admin_override_entry_final_pick', {
    p_pool_id: rollingId, p_entry_id: rollingOwner, p_week: 1, p_slot: 1, p_team_abbr: later.home_team, p_reason: 'Audit correction to a later unlocked game',
  })
  results['rolling later game availability'] = 'later game remained eligible after Thursday/first kickoff'
  await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: rollingId, p_week: 1, p_stage: 'week_done' })
  await outcome(rollingId, 1, later, 'tie')
  await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: rollingId, p_week: 1 })
  const rollingScored = await rpc(clients[emails[0]], 'superadmin_pool_entries', { p_pool_id: rollingId })
  assert(!rollingScored.find((row) => row.entry_id === rollingOwner).eliminated, 'Tie-as-win eliminated the selected entry.')
  results['tie as win'] = 'entry survived without consuming a mulligan'

  const history = await rpc(clients[emails[0]], 'get_my_pool_history')
  assert(history.some((row) => row.pool_id === fixedId), 'Profile history omitted the audited pool.')
  results['profile history'] = 'dynamic status returned without obsolete winner dependency'

  console.log(JSON.stringify({ pools: createdPoolIds, results }, null, 2))
} finally {
  if (createdPoolIds.length) {
    await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).in('id', createdPoolIds)
  }
}
