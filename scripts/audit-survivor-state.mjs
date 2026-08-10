import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Supabase service credentials are required.')

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

async function all(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < 1_000) return rows
  }
}

const [
  pools,
  profiles,
  entries,
  drafts,
  picks,
  stats,
  graces,
  games,
  legacyEntries,
  legacyPicks,
] = await Promise.all([
  all('pools', 'id,created_by,start_week,season,include_playoffs,mulligans,strikes_allowed,ties,tie_rule,deadline,deadline_mode,deadline_fixed,double_pick_weeks,is_public,visibility,archived,archived_at,activation_status,activated_at,activated_by,allow_multiple_entries,max_entries_per_user,max_members,winner_user_id,test_mode,test_current_week'),
  all('profiles', 'id'),
  all('pool_members', 'id,pool_id,profile_id,role,status,eliminated_week,lives_remaining,entry_number,joined_at'),
  all('pool_pick_drafts', 'pool_id,user_id,entry_id,week,slot,team_abbr,updated_at'),
  all('pool_picks', 'pool_id,user_id,entry_id,week,slot,team_abbr,locked_at,result,adjudicated_at'),
  all('pool_member_stats', 'pool_id,user_id,entry_id,wins,losses,pushes,strikes_used,eliminated,eliminated_week'),
  all('pool_entry_survival_graces', 'pool_id,entry_id,week,strike_credits'),
  all('nfl_games', 'id,season,week,game_time,kickoff_at_utc,kickoff_confirmed,home_team,away_team,status,winner,home_score,away_score'),
  all('entries', 'id,pool_id,profile_id,eliminated,strikes'),
  all('picks', 'id,entry_id,week,team,game_id,locked,result'),
])

const issues = new Map()
const breakdown = {
  later_picks: { test: 0, real: 0 },
  stale_standings: { test: 0, real: 0 },
}
const add = (name, condition) => {
  if (condition) issues.set(name, (issues.get(name) ?? 0) + 1)
}
const poolById = new Map(pools.map((row) => [row.id, row]))
const profileIds = new Set(profiles.map((row) => row.id))
const entryById = new Map(entries.map((row) => [row.id, row]))
const statsByEntry = new Map(stats.map((row) => [row.entry_id, row]))
const entriesByPoolUser = new Map()

for (const pool of pools) {
  const strikes = Number(pool.strikes_allowed)
  const maxWeek = pool.include_playoffs ? 22 : 18
  add('pool has invalid owner', !profileIds.has(pool.created_by))
  add('pool start week is outside regular season', pool.start_week < 1 || pool.start_week > 18)
  add('pool season is invalid', !Number.isInteger(pool.season) || pool.season < 2020 || pool.season > 2100)
  add('pool strike allowance is invalid', ![0, 1, 2].includes(strikes))
  add('legacy mulligan value contradicts strike allowance', pool.mulligans !== strikes)
  add('legacy tie value contradicts tie rule', pool.ties !== pool.tie_rule)
  add('legacy visibility contradicts public setting', pool.visibility !== (pool.is_public ? 'public' : 'private'))
  add('legacy deadline contradicts deadline mode', pool.deadline !== (pool.deadline_mode === 'rolling' ? 'kickoff' : '1pm_et'))
  add('archived pool is missing archived timestamp', pool.archived && !pool.archived_at)
  add('unarchived pool has archived timestamp', !pool.archived && Boolean(pool.archived_at))
  add('active pool is missing activation metadata', pool.activation_status === 'active' && (!pool.activated_at || !pool.activated_by))
  add('pool winner does not reference a profile', Boolean(pool.winner_user_id) && !profileIds.has(pool.winner_user_id))
  add('single-entry pool allows a per-user limit above one', !pool.allow_multiple_entries && pool.max_entries_per_user !== 1)
  const doubleWeeks = pool.double_pick_weeks ?? []
  add('pool has duplicate double-pick weeks', new Set(doubleWeeks).size !== doubleWeeks.length)
  for (const week of doubleWeeks) add('pool has invalid double-pick week', !Number.isInteger(week) || week < pool.start_week || week > maxWeek)
}

for (const entry of entries) {
  const pool = poolById.get(entry.pool_id)
  add('entry has invalid pool', !pool)
  add('entry has invalid owner', !profileIds.has(entry.profile_id))
  add('entry number is below one', !Number.isInteger(entry.entry_number) || entry.entry_number < 1)
  add('entry has invalid lifecycle status', !['alive', 'active', 'eliminated'].includes(String(entry.status).toLowerCase()))
  add('active entry has an elimination week', ['alive', 'active'].includes(String(entry.status).toLowerCase()) && entry.eliminated_week !== null)
  add('eliminated entry lacks an elimination week', String(entry.status).toLowerCase() === 'eliminated' && entry.eliminated_week === null)
  add('entry has negative lives remaining', entry.lives_remaining !== null && entry.lives_remaining < 0)
  if (pool && entry.eliminated_week !== null) {
    add('entry eliminated outside pool season', entry.eliminated_week < pool.start_week || entry.eliminated_week > (pool.include_playoffs ? 22 : 18))
  }
  const key = `${entry.pool_id}:${entry.profile_id}`
  const owned = entriesByPoolUser.get(key) ?? []
  owned.push(entry)
  entriesByPoolUser.set(key, owned)
}

for (const [key, owned] of entriesByPoolUser) {
  const pool = poolById.get(key.split(':')[0])
  if (!pool) continue
  add('user exceeds configured entry maximum', owned.length > pool.max_entries_per_user)
  add('user has multiple entries in a single-entry pool', !pool.allow_multiple_entries && owned.length > 1)
}

for (const pool of pools) {
  const poolEntries = entries.filter((entry) => entry.pool_id === pool.id)
  add('pool exceeds total entry capacity', poolEntries.length > pool.max_members)
  add('pool creator lacks an admin entry', !poolEntries.some((entry) => entry.profile_id === pool.created_by && entry.role === 'admin'))
}

const allGameplayPicks = [
  ...drafts.map((row) => ({ ...row, kind: 'draft' })),
  ...picks.map((row) => ({ ...row, kind: 'final' })),
]
const pickSlots = new Set()
const usedTeams = new Map()
for (const pick of allGameplayPicks) {
  const pool = poolById.get(pick.pool_id)
  const entry = entryById.get(pick.entry_id)
  const slotKey = `${pick.pool_id}:${pick.entry_id}:${pick.week}:${pick.slot}`
  if (pickSlots.has(slotKey)) add('draft and final pick occupy the same slot', true)
  pickSlots.add(slotKey)
  add('pick has invalid pool', !pool)
  add('pick has invalid entry', !entry)
  add('pick owner contradicts entry owner', Boolean(entry) && (entry.pool_id !== pick.pool_id || entry.profile_id !== pick.user_id))
  if (!pool || !entry) continue
  const maxWeek = pool.include_playoffs ? 22 : 18
  const allowed = (pool.double_pick_weeks ?? []).includes(pick.week) ? 2 : 1
  add('pick is outside pool season', pick.week < pool.start_week || pick.week > maxWeek)
  add('pick uses an invalid weekly slot', pick.slot < 1 || pick.slot > allowed)
  const team = String(pick.team_abbr).trim().toUpperCase()
  add('pick team is not normalized', pick.team_abbr !== team)
  if (!team.startsWith('NO_PICK')) {
    const phase = pick.week <= 18 ? 'regular season' : 'postseason'
    const usedKey = `${pick.entry_id}:${phase}:${team}`
    if (usedTeams.has(usedKey)) add('entry reused a team in the same phase', true)
    usedTeams.set(usedKey, pick)
    if (!pool.test_mode) {
      add('pick team is not scheduled in its week', !games.some((game) => game.season === pool.season && game.week === pick.week && [game.home_team, game.away_team].map((value) => value.toUpperCase()).includes(team)))
    }
  }
  const entryStats = statsByEntry.get(entry.id)
  if (entryStats?.eliminated && pick.week > entryStats.eliminated_week) {
    add('eliminated entry has a later pick', true)
    breakdown.later_picks[pool.test_mode ? 'test' : 'real'] += 1
  }
}

for (const row of stats) {
  const entry = entryById.get(row.entry_id)
  add('standings row has invalid entry', !entry)
  add('standings owner contradicts entry owner', Boolean(entry) && (entry.pool_id !== row.pool_id || entry.profile_id !== row.user_id))
  for (const field of ['wins', 'losses', 'pushes', 'strikes_used']) add(`standings ${field} is negative`, row[field] < 0)
  add('standings elimination flag contradicts week', row.eliminated !== (row.eliminated_week !== null))
  if (entry) {
    add('entry and standings elimination status disagree', (String(entry.status).toLowerCase() === 'eliminated') !== row.eliminated || entry.eliminated_week !== row.eliminated_week)
    const counted = picks.filter((pick) => pick.pool_id === row.pool_id && pick.entry_id === row.entry_id && (row.eliminated_week === null || pick.week <= row.eliminated_week))
    add('standings wins disagree with pick ledger', row.wins !== counted.filter((pick) => pick.result === 'win').length)
    const stale = row.wins !== counted.filter((pick) => pick.result === 'win').length
      || row.losses !== counted.filter((pick) => pick.result === 'loss').length
      || row.pushes !== counted.filter((pick) => pick.result === 'push').length
      || row.strikes_used !== counted.filter((pick) => pick.result === 'loss').length
    if (stale) breakdown.stale_standings[poolById.get(row.pool_id)?.test_mode ? 'test' : 'real'] += 1
    add('standings losses disagree with pick ledger', row.losses !== counted.filter((pick) => pick.result === 'loss').length)
    add('standings pushes disagree with pick ledger', row.pushes !== counted.filter((pick) => pick.result === 'push').length)
    add('standings strikes disagree with pick ledger', row.strikes_used !== counted.filter((pick) => pick.result === 'loss').length)
  }
}

for (const grace of graces) {
  const entry = entryById.get(grace.entry_id)
  const pool = poolById.get(grace.pool_id)
  add('survival grace has invalid entry', !entry)
  add('survival grace has invalid pool', !pool)
  add('survival grace belongs to a different pool than its entry', Boolean(entry) && entry.pool_id !== grace.pool_id)
  add('survival grace credits are invalid', !Number.isInteger(grace.strike_credits) || grace.strike_credits < 1)
  add('survival grace is outside pool season', Boolean(pool) && (grace.week < pool.start_week || grace.week > (pool.include_playoffs ? 22 : 18)))
}

for (const game of games) {
  const home = game.home_team.trim().toUpperCase()
  const away = game.away_team.trim().toUpperCase()
  add('NFL game has the same home and away team', home === away)
  add('NFL game team is not normalized', home !== game.home_team || away !== game.away_team)
  add('NFL game has a negative score', (game.home_score ?? 0) < 0 || (game.away_score ?? 0) < 0)
  add('final NFL game is missing scores', game.status === 'final' && (game.home_score === null || game.away_score === null))
  add('final NFL game has an invalid winner', game.status === 'final' && ![home, away, 'TIE'].includes(String(game.winner).toUpperCase()))
}

console.log(JSON.stringify({
  row_counts: {
    pools: pools.length,
    entries: entries.length,
    drafts: drafts.length,
    final_picks: picks.length,
    standings: stats.length,
    survival_graces: graces.length,
    nfl_games: games.length,
    legacy_entries: legacyEntries.length,
    legacy_picks: legacyPicks.length,
  },
  issues: Object.fromEntries([...issues].sort(([a], [b]) => a.localeCompare(b))),
  breakdown,
  issue_total: [...issues.values()].reduce((sum, count) => sum + count, 0),
}, null, 2))
