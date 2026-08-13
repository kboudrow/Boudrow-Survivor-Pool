import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!url || !anonKey || !serviceKey) throw new Error('Missing Supabase environment variables.')
if (process.env.ALLOW_TEST_POOL_MUTATIONS !== 'true') {
  throw new Error('Set ALLOW_TEST_POOL_MUTATIONS=true. This script creates only labeled test pools and archives them when finished.')
}

const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const emails = ['survivesunday1@gmail.com', 'taylor@swift.com', 'serena@williams.com', 'lebron@james.com']
const clients = {}
const userIds = {}
const createdPoolIds = []
const report = []
let assertionCount = 0
let negativeAttemptCount = 0

function assert(condition, message) {
  assertionCount += 1
  if (!condition) throw new Error(message)
}

async function rpc(client, name, args = {}) {
  const response = await client.rpc(name, args)
  if (response.error) throw new Error(`${name}: ${response.error.message}`)
  return response.data
}

async function reject(label, action, pattern) {
  negativeAttemptCount += 1
  let message = ''
  try { await action() } catch (error) { message = error instanceof Error ? error.message : String(error) }
  assert(message && pattern.test(message), `${label} was not rejected as expected: ${message || 'no error'}`)
}

async function authenticate(email) {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error) throw link.error
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const verified = await client.auth.verifyOtp({ token_hash: link.data.properties.hashed_token, type: 'magiclink' })
  if (verified.error) throw verified.error
  assert(verified.data.user?.email === email, `Authenticated as the wrong user for ${email}.`)
  userIds[email] = verified.data.user.id
  return client
}

const configs = [
  {
    key: 'A', startWeek: 1, endWeek: 18, strikes: 0, tieRule: 'loss', deadlineMode: 'fixed', doubleWeeks: [],
    entrySpecs: emails.map((email) => ({ email, entryNumber: 1 })), expectedEndWeek: 3, expectedAlive: 1,
  },
  {
    key: 'B', startWeek: 1, endWeek: 18, strikes: 1, tieRule: 'loss', deadlineMode: 'fixed', doubleWeeks: [2, 4],
    entrySpecs: [
      { email: emails[0], entryNumber: 1 }, { email: emails[0], entryNumber: 2 },
      { email: emails[1], entryNumber: 1 }, { email: emails[1], entryNumber: 2 },
      { email: emails[2], entryNumber: 1 }, { email: emails[3], entryNumber: 1 },
    ], expectedEndWeek: 5, expectedAlive: 1,
  },
  {
    key: 'C', startWeek: 5, endWeek: 18, strikes: 0, tieRule: 'win', deadlineMode: 'fixed', doubleWeeks: [],
    entrySpecs: emails.map((email) => ({ email, entryNumber: 1 })), expectedEndWeek: 18, expectedAlive: 2,
  },
  {
    key: 'D', startWeek: 1, endWeek: 18, strikes: 1, tieRule: 'loss', deadlineMode: 'rolling', doubleWeeks: [3, 5],
    entrySpecs: [
      { email: emails[0], entryNumber: 1 }, { email: emails[0], entryNumber: 2 },
      { email: emails[1], entryNumber: 1 }, { email: emails[1], entryNumber: 2 },
      { email: emails[2], entryNumber: 1 }, { email: emails[3], entryNumber: 1 },
    ], expectedEndWeek: 5, expectedAlive: 1,
  },
]

function plannedResult(poolKey, week, entryIndex, slot) {
  const plan = {
    A: { '1:3:1': 'miss', '2:2:1': 'loss', '3:1:1': 'loss' },
    B: {
      '1:4:1': 'loss', '1:5:1': 'miss',
      '2:4:1': 'loss', '2:5:1': 'miss', '2:3:1': 'push',
      '3:3:1': 'loss', '3:2:1': 'push',
      '4:2:1': 'loss', '4:1:1': 'loss',
      '5:1:1': 'loss',
    },
    C: { '5:2:1': 'push', '5:3:1': 'miss', '18:2:1': 'loss' },
    D: {
      '1:4:1': 'loss', '1:5:1': 'miss',
      '2:4:1': 'push', '2:5:1': 'loss', '2:3:1': 'loss',
      '3:3:1': 'loss', '3:2:1': 'loss',
      '4:2:1': 'loss', '4:1:1': 'loss',
      '5:1:1': 'loss',
    },
  }
  return plan[poolKey]?.[`${week}:${entryIndex}:${slot}`] || 'win'
}

async function createPool(config) {
  const inserted = await service.from('pools').insert({
    name: `Automated Full Season ${config.key} ${Date.now()}`,
    created_by: userIds[emails[0]], is_public: true, visibility: 'public', allow_discovery: false,
    start_week: config.startWeek, include_playoffs: false, strikes_allowed: String(config.strikes),
    tie_rule: config.tieRule, ties: config.tieRule, deadline_mode: config.deadlineMode, deadline_fixed: '13:00',
    notes: 'Automated multi-pool full-season simulation. Safe to archive.', season: 2026,
    double_pick_weeks: config.doubleWeeks, max_members: 50,
    allow_multiple_entries: config.entrySpecs.some((spec, index, all) => all.findIndex((other) => other.email === spec.email) !== index),
    max_entries_per_user: Math.max(...emails.map((email) => config.entrySpecs.filter((spec) => spec.email === email).length)),
    activation_status: 'active', payment_status: 'not_required', test_mode: false,
  }).select('id').single()
  if (inserted.error) throw inserted.error
  const poolId = inserted.data.id
  createdPoolIds.push(poolId)

  const members = await service.from('pool_members').insert(config.entrySpecs.map((spec) => ({
    pool_id: poolId, profile_id: userIds[spec.email], role: spec.email === emails[0] ? 'admin' : 'member',
    status: 'alive', entry_number: spec.entryNumber,
  }))).select('id,profile_id,entry_number')
  if (members.error) throw members.error

  await rpc(clients[emails[0]], 'superadmin_set_pool_test_mode', { p_pool_id: poolId, p_enabled: true })
  const entries = config.entrySpecs.map((spec, index) => {
    const row = members.data.find((member) => member.profile_id === userIds[spec.email] && member.entry_number === spec.entryNumber)
    assert(row, `Pool ${config.key} is missing entry ${index + 1}.`)
    return { ...spec, id: row.id, index, usedTeams: new Set(), eliminatedWeek: null }
  })
  return { poolId, entries }
}

function allocatePick({ games, entry, week, slot, result, decisions }) {
  const ordered = entry.index % 2 === 0 ? games : [...games].reverse()
  for (const game of ordered) {
    for (const side of ['home', 'away']) {
      const team = side === 'home' ? game.home_team : game.away_team
      if (entry.usedTeams.has(team)) continue
      const desired = result === 'push' ? 'tie' : result === 'win' ? side : side === 'home' ? 'away' : 'home'
      const existing = decisions.get(game.game_id)
      if (existing && existing !== desired) continue
      decisions.set(game.game_id, desired)
      return { game, team, result, week, slot }
    }
  }
  throw new Error(`Could not allocate an unused ${result} pick for Pool ${entry.poolKey || '?'} entry ${entry.index + 1}, Week ${week}.`)
}

async function savePick(poolId, entry, week, slot, team) {
  return rpc(clients[entry.email], 'save_entry_draft_pick', {
    p_pool_id: poolId, p_entry_id: entry.id, p_week: week, p_slot: slot, p_team_abbr: team,
  })
}

async function independentlyVerify(config, poolId, entries, week, aliveAtStart) {
  const [{ data: picks, error: pickError }, { data: stats, error: statError }, { data: members, error: memberError }, { data: graces, error: graceError }] = await Promise.all([
    service.from('pool_picks').select('entry_id,week,slot,team_abbr,result').eq('pool_id', poolId).lte('week', week),
    service.from('pool_member_stats').select('entry_id,wins,losses,pushes,strikes_used,eliminated,eliminated_week').eq('pool_id', poolId),
    service.from('pool_members').select('id,status,eliminated_week').eq('pool_id', poolId),
    service.from('pool_entry_survival_graces').select('entry_id,week,strike_credits').eq('pool_id', poolId),
  ])
  if (pickError || statError || memberError || graceError) throw pickError || statError || memberError || graceError

  const required = config.doubleWeeks.includes(week) ? 2 : 1
  for (const entry of entries) {
    const entryPicks = picks.filter((pick) => pick.entry_id === entry.id).sort((a, b) => a.week - b.week || a.slot - b.slot)
    const weekPicks = entryPicks.filter((pick) => pick.week === week)
    assert(weekPicks.length === (aliveAtStart.has(entry.id) ? required : 0), `Pool ${config.key} Week ${week}: wrong finalized pick count for entry ${entry.index + 1}.`)

    let losses = 0
    let expectedEliminatedWeek = null
    for (const pick of entryPicks) {
      if (pick.result === 'loss') losses += 1
      const credits = graces.filter((grace) => grace.entry_id === entry.id && grace.week <= pick.week).reduce((sum, grace) => sum + grace.strike_credits, 0)
      if (expectedEliminatedWeek === null && losses > config.strikes + credits) expectedEliminatedWeek = pick.week
    }
    const counted = entryPicks.filter((pick) => expectedEliminatedWeek === null || pick.week <= expectedEliminatedWeek)
    const stat = stats.find((candidate) => candidate.entry_id === entry.id)
    const member = members.find((candidate) => candidate.id === entry.id)
    assert(stat && member, `Pool ${config.key}: missing standings row for entry ${entry.index + 1}.`)
    const expected = {
      wins: counted.filter((pick) => pick.result === 'win').length,
      losses: counted.filter((pick) => pick.result === 'loss').length,
      pushes: counted.filter((pick) => pick.result === 'push').length,
      strikes_used: counted.filter((pick) => pick.result === 'loss').length,
      eliminated: expectedEliminatedWeek !== null,
      eliminated_week: expectedEliminatedWeek,
    }
    assert(JSON.stringify(expected) === JSON.stringify({
      wins: stat.wins, losses: stat.losses, pushes: stat.pushes, strikes_used: stat.strikes_used,
      eliminated: stat.eliminated, eliminated_week: stat.eliminated_week,
    }), `Pool ${config.key} Week ${week}: independently calculated standings differ for entry ${entry.index + 1}.`)
    assert((String(member.status).toLowerCase() === 'eliminated') === expected.eliminated, `Pool ${config.key} Week ${week}: member status disagrees with standings.`)
    assert(member.eliminated_week === expected.eliminated_week, `Pool ${config.key} Week ${week}: elimination week disagrees.`)

    const realTeams = entryPicks.filter((pick) => !pick.team_abbr.startsWith('NO_PICK_')).map((pick) => pick.team_abbr)
    assert(new Set(realTeams).size === realTeams.length, `Pool ${config.key} Week ${week}: entry reused a team.`)
    assert(JSON.stringify([...entry.usedTeams].sort()) === JSON.stringify([...new Set(realTeams)].sort()), `Pool ${config.key} Week ${week}: used-team history differs from submitted history.`)
    const credits = graces.filter((grace) => grace.entry_id === entry.id && grace.week <= week).reduce((sum, grace) => sum + grace.strike_credits, 0)
    assert(Math.max(0, config.strikes + credits - stat.strikes_used) >= 0, `Pool ${config.key} Week ${week}: negative mulligans remaining.`)
    entry.eliminatedWeek = expectedEliminatedWeek
  }

  const snapshot = await rpc(clients[emails[0]], 'pool_standings_snapshot', { p_pool_id: poolId, p_week: week })
  const snapshotStats = snapshot[0]?.stats || []
  assert(snapshotStats.length === stats.length, `Pool ${config.key} Week ${week}: standings display omitted entries.`)
  for (const stat of stats) {
    const shown = snapshotStats.find((candidate) => candidate.entry_id === stat.entry_id)
    assert(shown && shown.wins === stat.wins && shown.losses === stat.losses && shown.eliminated === stat.eliminated,
      `Pool ${config.key} Week ${week}: displayed standings disagree with stored standings.`)
  }

  const integrity = await rpc(clients[emails[0]], 'admin_pool_scoring_integrity', { p_pool_id: poolId })
  assert(integrity.every((row) => row.status !== 'fail' && row.issue_count === 0), `Pool ${config.key} Week ${week}: integrity RPC failed: ${JSON.stringify(integrity)}`)
  return { picks, stats, graces, alive: stats.filter((stat) => !stat.eliminated) }
}

function stableScoringState(verified) {
  return JSON.stringify({
    stats: [...verified.stats].sort((a, b) => a.entry_id.localeCompare(b.entry_id)),
    graces: [...verified.graces].sort((a, b) => a.entry_id.localeCompare(b.entry_id) || a.week - b.week),
  })
}

async function simulatePool(config) {
  const { poolId, entries } = await createPool(config)
  let totalPicks = 0
  let scoredWeeks = 0
  let lateChecks = 0
  let reuseChecks = 0
  let duplicateChecks = 0

  if (config.startWeek > 1) {
    await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: config.startWeek, p_stage: 'before_week' })
    const games = await rpc(clients[emails[0]], 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: config.startWeek })
    await reject(`Pool ${config.key} pre-start week`, () => savePick(poolId, entries[0], config.startWeek - 1, 1, games[0].home_team), /outside|start|playable|not available|currently open/i)
  }

  for (let week = config.startWeek; week <= config.endWeek; week += 1) {
    const winnerBefore = await rpc(clients[emails[0]], 'pool_winner_status', { p_pool_id: poolId })
    if (winnerBefore[0]?.is_decided) break
    await rpc(clients[emails[0]], 'superadmin_set_test_pool_week', { p_pool_id: poolId, p_week: week })
    await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: week, p_stage: 'before_week' })
    const games = await rpc(clients[emails[0]], 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: week })
    assert(games.length >= 13, `Pool ${config.key} Week ${week}: schedule has only ${games.length} games.`)
    const aliveAtStart = new Set(entries.filter((entry) => entry.eliminatedWeek === null).map((entry) => entry.id))
    const required = config.doubleWeeks.includes(week) ? 2 : 1
    const decisions = new Map()
    const selected = []

    if (week > config.startWeek) {
      const candidateEntry = entries.find((entry) => aliveAtStart.has(entry.id))
      const currentTeams = new Set(games.flatMap((game) => [game.home_team, game.away_team]))
      const reused = [...candidateEntry.usedTeams].find((team) => currentTeams.has(team))
      if (reused) {
        await reject(`Pool ${config.key} Week ${week} team reuse`, () => savePick(poolId, candidateEntry, week, 1, reused), /already|different team|used/i)
        reuseChecks += 1
      }
    }

    for (const entry of entries.filter((candidate) => aliveAtStart.has(candidate.id))) {
      for (let slot = 1; slot <= required; slot += 1) {
        const result = plannedResult(config.key, week, entry.index, slot)
        if (result === 'miss') continue
        const pick = allocatePick({ games, entry, week, slot, result, decisions })
        await savePick(poolId, entry, week, slot, pick.team)
        if (required === 2 && slot === 1 && duplicateChecks === 0) {
          await reject(`Pool ${config.key} same-team double pick`, () => savePick(poolId, entry, week, 2, pick.team), /already|different team|used/i)
          duplicateChecks += 1
        }
        entry.usedTeams.add(pick.team)
        selected.push({ ...pick, entry })
      }
    }

    const early = selected.find((pick) => pick.game.game_id === games[0].game_id) || selected[0]
    const late = [...selected].reverse().find((pick) => new Date(pick.game.game_time) > new Date(games[0].game_time))
    if (early && late) {
      await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: week, p_stage: 'first_kickoff' })
      await reject(`Pool ${config.key} Week ${week} early lock`, () => savePick(poolId, early.entry, week, early.slot, early.team), /locked|deadline|no longer/i)
      await savePick(poolId, late.entry, week, late.slot, late.team)
      lateChecks += 2
      if (config.deadlineMode === 'fixed') {
        await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: week, p_stage: 'sunday_1pm' })
        await reject(`Pool ${config.key} Week ${week} fixed lock`, () => savePick(poolId, late.entry, week, late.slot, late.team), /locked|deadline|no longer/i)
        lateChecks += 1
      }
    }

    await rpc(clients[emails[0]], 'superadmin_set_test_pool_clock', { p_pool_id: poolId, p_week: week, p_stage: 'week_done' })
    for (const game of games) {
      const value = decisions.get(game.game_id)
      if (!value) continue
      await rpc(clients[emails[0]], 'superadmin_set_test_game_outcome', {
        p_pool_id: poolId, p_week: week, p_away_team: game.away_team, p_home_team: game.home_team, p_outcome: value,
      })
    }
    await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: week })
    const verified = await independentlyVerify(config, poolId, entries, week, aliveAtStart)
    const beforeRepeat = stableScoringState(verified)
    await rpc(clients[emails[0]], 'superadmin_score_test_pool_week', { p_pool_id: poolId, p_week: week })
    const repeated = await independentlyVerify(config, poolId, entries, week, aliveAtStart)
    assert(stableScoringState(repeated) === beforeRepeat, `Pool ${config.key} Week ${week}: repeat scoring was not idempotent.`)

    totalPicks += verified.picks.filter((pick) => pick.week === week).length
    scoredWeeks += 1
    const winner = await rpc(clients[emails[0]], 'pool_winner_status', { p_pool_id: poolId })
    const shouldFinish = winner[0]?.is_decided || week === config.endWeek
    if (!shouldFinish && week < config.endWeek) {
      const nextRequired = config.doubleWeeks.includes(week + 1) ? 2 : 1
      const databaseRequired = await rpc(clients[emails[0]], 'picks_allowed', { p_pool_id: poolId, p_week: week + 1 })
      assert(databaseRequired === nextRequired, `Pool ${config.key} Week ${week}: database requires ${databaseRequired} next-week picks instead of ${nextRequired}.`)
      const nextGames = await rpc(clients[emails[0]], 'superadmin_test_pool_week_options', { p_pool_id: poolId, p_week: week + 1 })
      const nextTeams = [...new Set(nextGames.flatMap((game) => [game.home_team, game.away_team]))]
      for (const entry of entries.filter((candidate) => candidate.eliminatedWeek === null)) {
        assert(nextRequired > 0, `Pool ${config.key} Week ${week}: surviving entry has no required next-week picks.`)
        const eligible = nextTeams.filter((team) => !entry.usedTeams.has(team))
        assert(eligible.length >= nextRequired, `Pool ${config.key} Week ${week}: entry ${entry.index + 1} lacks enough eligible teams for next week.`)
      }
    }
    console.log(`Pool ${config.key} Week ${week}: ${verified.alive.length} alive, ${verified.picks.filter((pick) => pick.week === week).length} picks, standings verified`)
    if (winner[0]?.is_decided) break
  }

  const finalEntries = await rpc(clients[emails[0]], 'superadmin_pool_entries', { p_pool_id: poolId })
  const alive = finalEntries.filter((entry) => !entry.eliminated)
  const winner = await rpc(clients[emails[0]], 'pool_winner_status', { p_pool_id: poolId })
  const lifecycle = await rpc(clients[emails[0]], 'pool_lifecycle_status', { p_pool_id: poolId })
  assert(scoredWeeks === config.expectedEndWeek - config.startWeek + 1, `Pool ${config.key}: expected ${config.expectedEndWeek - config.startWeek + 1} scored weeks, found ${scoredWeeks}.`)
  assert(alive.length === config.expectedAlive, `Pool ${config.key}: expected ${config.expectedAlive} final survivors, found ${alive.length}.`)
  if (config.expectedAlive === 1) {
    assert(winner[0]?.is_decided, `Pool ${config.key}: one survivor was not declared the winner.`)
    assert(lifecycle[0]?.phase === 'completed_winner', `Pool ${config.key}: winner lifecycle is ${lifecycle[0]?.phase}.`)
  } else {
    assert(!winner[0]?.is_decided, `Pool ${config.key}: multiple final survivors incorrectly produced a winner.`)
    assert(['completed_season', 'review_required'].includes(lifecycle[0]?.phase), `Pool ${config.key}: season-end lifecycle is ${lifecycle[0]?.phase}.`)
  }

  const result = { pool: config.key, poolId, scoredWeeks, entries: entries.length, totalPicks, finalAlive: alive.length, lateChecks, reuseChecks, duplicateChecks, lifecycle: lifecycle[0]?.phase }
  report.push(result)
  return result
}

try {
  for (const email of emails) clients[email] = await authenticate(email)
  for (const config of configs) await simulatePool(config)
  console.log(JSON.stringify({
    status: 'passed', pools: report, assertions: assertionCount, negativeAttempts: negativeAttemptCount,
    totalWeeks: report.reduce((sum, pool) => sum + pool.scoredWeeks, 0),
    totalEntries: report.reduce((sum, pool) => sum + pool.entries, 0),
    totalPicks: report.reduce((sum, pool) => sum + pool.totalPicks, 0),
  }, null, 2))
} finally {
  if (createdPoolIds.length) {
    const archived = await service.from('pools').update({ archived: true, archived_at: new Date().toISOString() }).in('id', createdPoolIds)
    if (archived.error) console.error(`Could not archive simulation pools: ${archived.error.message}`)
  }
}
