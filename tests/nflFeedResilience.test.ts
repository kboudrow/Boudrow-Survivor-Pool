import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  fetchProviderWeek,
  parseProviderGame,
  providerStatus,
  validateProviderWeek,
  type EspnEvent,
  type ExistingNflGame,
} from '../lib/nflFeed.ts'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function event(overrides: Partial<EspnEvent> = {}): EspnEvent {
  return {
    id: '401',
    date: '2026-09-13T17:00:00Z',
    status: { type: { state: 'pre', description: 'Scheduled' } },
    competitions: [{
      id: '401',
      startDate: '2026-09-13T17:00:00Z',
      competitors: [
        { homeAway: 'home', score: null, team: { abbreviation: 'BUF' } },
        { homeAway: 'away', score: null, team: { abbreviation: 'NYJ' } },
      ],
    }],
    ...overrides,
  }
}

function postseasonEvents(count: number): EspnEvent[] {
  const teams = ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND']
  return Array.from({ length: count }, (_, index) => event({
    id: `post-${index}`,
    competitions: [{
      id: `post-${index}`,
      startDate: `2027-01-${String(16 + Math.floor(index / 2)).padStart(2, '0')}T${index % 2 ? '21' : '18'}:00:00Z`,
      competitors: [
        { homeAway: 'home', team: { abbreviation: teams[index * 2] } },
        { homeAway: 'away', team: { abbreviation: teams[index * 2 + 1] } },
      ],
    }],
  }))
}

const existing: ExistingNflGame[] = [{
  season: 2026,
  week: 1,
  game_time: '2026-09-13T17:00:00Z',
  kickoff_at_utc: '2026-09-13T17:00:00Z',
  home_team: 'BUF',
  away_team: 'NYJ',
  espn_event_id: '401',
  status: 'scheduled',
  kickoff_confirmed: true,
}]

test('postponed, canceled, and suspended games never become final outcomes', () => {
  assert.equal(providerStatus(event({ status: { type: { description: 'Postponed' } } })), 'postponed')
  assert.equal(providerStatus(event({ status: { type: { description: 'Canceled' } } })), 'canceled')
  assert.equal(providerStatus(event({ status: { type: { description: 'Suspended' } } })), 'in_progress')
})

test('a final without complete valid scores is rejected instead of becoming a tie', () => {
  const badFinal = event({ status: { type: { completed: true, description: 'Final' } } })
  assert.throws(() => parseProviderGame(badFinal, 2026, 1), /final without valid scores/i)
})

test('a conflicting provider winner is rejected', () => {
  const badWinner = event({
    status: { type: { completed: true, description: 'Final' } },
    competitions: [{
      startDate: '2026-09-13T17:00:00Z',
      competitors: [
        { homeAway: 'home', score: '10', winner: true, team: { abbreviation: 'BUF' } },
        { homeAway: 'away', score: '20', winner: false, team: { abbreviation: 'NYJ' } },
      ],
    }],
  })
  assert.throws(() => parseProviderGame(badWinner, 2026, 1), /winner conflicts/i)
})

test('unknown teams, malformed games, duplicates, and partial weeks reject the whole batch', () => {
  const unknown = event({ competitions: [{ startDate: '2026-09-13T17:00:00Z', competitors: [
    { homeAway: 'home', team: { abbreviation: 'XXX' } },
    { homeAway: 'away', team: { abbreviation: 'NYJ' } },
  ] }] })
  assert.throws(() => validateProviderWeek([unknown], 2026, 1, existing), /unknown NFL team/i)
  assert.throws(() => validateProviderWeek([], 2026, 1, existing), /empty week/i)
  assert.throws(() => validateProviderWeek([event(), event()], 2026, 1, existing), /duplicate matchups/i)

  const otherGame = event({ id: '402', competitions: [{ id: '402', startDate: '2026-09-13T20:00:00Z', competitors: [
    { homeAway: 'home', team: { abbreviation: 'KC' } },
    { homeAway: 'away', team: { abbreviation: 'LV' } },
  ] }] })
  assert.throws(() => validateProviderWeek([otherGame], 2026, 1, existing), /omitted known games/i)
})

test('kickoff changes are accepted when the matchup remains intact', () => {
  const changed = event({ date: '2026-09-14T00:20:00Z', competitions: [{
    id: '401', startDate: '2026-09-14T00:20:00Z', competitors: [
      { homeAway: 'home', team: { abbreviation: 'BUF' } },
      { homeAway: 'away', team: { abbreviation: 'NYJ' } },
    ],
  }] })
  assert.equal(validateProviderWeek([changed], 2026, 1, existing)[0].game_time, '2026-09-14T00:20:00.000Z')
})

test('postseason rounds reject partial first ingestion before any schedule exists', () => {
  assert.equal(validateProviderWeek(postseasonEvents(6), 2026, 19, []).length, 6)
  assert.throws(() => validateProviderWeek(postseasonEvents(5), 2026, 19, []), /expected 6/i)
  assert.equal(validateProviderWeek(postseasonEvents(4), 2026, 20, []).length, 4)
  assert.equal(validateProviderWeek(postseasonEvents(2), 2026, 21, []).length, 2)
  assert.equal(validateProviderWeek(postseasonEvents(1), 2026, 22, []).length, 1)
})

test('timeouts, rate limits, server errors, and invalid JSON retry without inventing data', async () => {
  let attempts = 0
  const fetchImpl = (async () => {
    attempts += 1
    if (attempts === 1) return new Response('', { status: 429, statusText: 'Rate Limited' })
    if (attempts === 2) return new Response('{', { status: 200 })
    return Response.json({ events: [event()] })
  }) as typeof fetch
  const events = await fetchProviderWeek(2026, 1, { timeoutMs: 100, attempts: 3, fetchImpl })
  assert.equal(events.length, 1)
  assert.equal(attempts, 3)
})

test('non-retryable HTTP errors preserve state and stop immediately', async () => {
  let attempts = 0
  const fetchImpl = (async () => {
    attempts += 1
    return new Response('', { status: 404, statusText: 'Not Found' })
  }) as typeof fetch
  await assert.rejects(fetchProviderWeek(2026, 1, { timeoutMs: 100, attempts: 3, fetchImpl }), /404/)
  assert.equal(attempts, 1)
})

test('database quarantines finals, prevents unlocks, and reverses corrected grades', async () => {
  const migration = await read('supabase/migrations/20260810003200_untrusted_nfl_feed_resilience.sql')
  assert.match(migration, /interval '2 minutes'/i)
  assert.match(migration, /new\.kickoff_at_utc := least\(v_old_lock/i)
  assert.match(migration, /new\.status := case[\s\S]*'in_progress'/i)
  assert.match(migration, /set result = null,[\s\S]*adjudicated_at = null/i)
  assert.match(migration, /perform public\.rebuild_pool_member_stats/i)
  assert.match(migration, /create or replace function public\.prune_picks_after_elimination[\s\S]*return 0/i)
  assert.match(migration, /v_status in \('postponed', 'canceled'\)/i)
})

test('score sync validates a complete week before its atomic upsert and logs rejection', async () => {
  const route = await read('app/api/cron/sync-scores/route.ts')
  assert.match(route, /validateProviderWeek\(events, season, week, knownGames\)/)
  assert.match(route, /\.upsert\(games, \{ onConflict: 'season,week,home_team,away_team' \}\)/)
  assert.match(route, /score_provider_week_rejected/)
})
