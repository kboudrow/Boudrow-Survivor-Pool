import { createClient } from '@supabase/supabase-js'
import { fetchProviderWeek, validateProviderWeek } from '../lib/nflFeed.ts'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
const season = Number(process.env.PRODUCTION_AUDIT_SEASON || new Date().getUTCFullYear())

if (!url || !serviceKey) throw new Error('Missing Supabase production audit environment.')
if (!Number.isInteger(season) || season < 2020 || season > 2100) throw new Error('Invalid production audit season.')

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const fail = (message) => { throw new Error(message) }
const matchup = (game) => `${game.away_team}@${game.home_team}`

const { data: existingRows, error: gamesError } = await supabase
  .from('nfl_games')
  .select('season,week,game_time,kickoff_at_utc,home_team,away_team,espn_event_id,status,kickoff_confirmed')
  .eq('season', season)
if (gamesError) fail(gamesError.message)

const existing = existingRows || []
const mismatches = []
const providerWeeks = []
for (let week = 1; week <= 18; week += 1) {
  const events = await fetchProviderWeek(season, week, { timeoutMs: 12_000, attempts: 3 })
  const games = validateProviderWeek(events, season, week, existing)
  providerWeeks.push({ week, games: games.length, unconfirmed: games.filter((game) => !game.kickoff_confirmed).length })
  const byMatchup = new Map(existing.filter((game) => game.week === week).map((game) => [matchup(game), game]))
  for (const game of games) {
    const stored = byMatchup.get(matchup(game))
    if (!stored) {
      mismatches.push({ week, matchup: matchup(game), issue: 'missing_from_database' })
      continue
    }
    const storedKickoff = new Date(stored.kickoff_at_utc || stored.game_time).toISOString()
    if (storedKickoff !== game.kickoff_at_utc) {
      mismatches.push({ week, matchup: matchup(game), issue: 'kickoff_changed', stored: storedKickoff, provider: game.kickoff_at_utc })
    }
    if (stored.espn_event_id !== game.espn_event_id) {
      mismatches.push({ week, matchup: matchup(game), issue: 'provider_id_changed' })
    }
    if (Boolean(stored.kickoff_confirmed) !== game.kickoff_confirmed) {
      mismatches.push({ week, matchup: matchup(game), issue: 'confirmation_changed', stored: stored.kickoff_confirmed, provider: game.kickoff_confirmed })
    }
    byMatchup.delete(matchup(game))
  }
  for (const key of byMatchup.keys()) mismatches.push({ week, matchup: key, issue: 'missing_from_provider' })
}

const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
const [{ data: cronRows, error: cronError }, { count: activePools, error: poolError }] = await Promise.all([
  supabase
    .from('app_event_logs')
    .select('event_type,severity,created_at,message')
    .eq('source', 'cron')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100),
  supabase
    .from('pools')
    .select('*', { count: 'exact', head: true })
    .eq('archived', false)
    .eq('activation_status', 'active'),
])
if (cronError) fail(cronError.message)
if (poolError) fail(poolError.message)

const cron = cronRows || []
const lastScoreSync = cron.find((row) => row.event_type.startsWith('cron_score_sync_completed')) || null
const lastPickLock = cron.find((row) => row.event_type.startsWith('cron_lock_picks_completed')) || null
const recentCronErrors = cron.filter((row) => row.severity === 'error')
const scheduleMismatches = mismatches.filter((row) => row.issue !== 'provider_id_changed')
const providerIdDrift = mismatches.filter((row) => row.issue === 'provider_id_changed')

const report = {
  auditedAt: new Date().toISOString(),
  season,
  databaseGames: existing.length,
  providerGames: providerWeeks.reduce((sum, row) => sum + row.games, 0),
  providerUnconfirmedKickoffs: providerWeeks.reduce((sum, row) => sum + row.unconfirmed, 0),
  scheduleMismatches,
  providerIdDriftCount: providerIdDrift.length,
  activePools,
  cron: {
    lastScoreSyncAt: lastScoreSync?.created_at || null,
    lastPickLockAt: lastPickLock?.created_at || null,
    recentErrors: recentCronErrors.map((row) => ({ eventType: row.event_type, at: row.created_at, message: row.message })),
  },
  ok: scheduleMismatches.length === 0 && recentCronErrors.length === 0 && Boolean(lastScoreSync) && Boolean(lastPickLock),
}

console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 1
