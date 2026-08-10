'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AdSlot } from '@/components/AdSlot'
import { AppDialogModal, type AppDialog } from '@/components/AppDialogModal'
import { InviteModal } from '@/components/InviteModal'
import { getErrorMessage } from '@/lib/errorMessage'
import { logAppEvent, trackConversion } from '@/lib/monitoring'
import { poolEntryCountLabel } from '@/lib/poolCapacity'
import { poolImageUrl } from '@/lib/poolImages'
import { supabase } from '@/lib/supabaseClient'
import { entryProgress, poolHasWinner, requiredPickSlots, survivalCreditsThroughWeek } from '@/lib/survivorRules'

/** ---------------- Types ---------------- */
type Pool = {
  id: string
  name: string
  season?: number | null
  is_public: boolean
  start_week: number
  include_playoffs: boolean
  strikes_allowed: number
  tie_rule: 'win' | 'loss'
  deadline_mode: 'fixed' | 'rolling'
  deadline_fixed: string | null
  notes: string | null
  created_by: string
  double_pick_weeks?: number[] | null
  plan?: 'free' | 'pro'
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
  allow_multiple_entries?: boolean | null
  max_entries_per_user?: number | null
  image_url?: string | null
  test_mode?: boolean | null
  test_current_week?: number | null
  test_now_at?: string | null
}

type Profile = {
  id: string
  profile_id?: string | null
  entry_id?: string | null
  entry_number?: number | null
  entry_name?: string | null
  first_name?: string | null
  last_name?: string | null
  display_name?: string | null
  username?: string | null
  avatar_url?: string | null
  email?: string | null
  role?: string | null
  status?: string | null
  joined_at?: string | null
}

type Team = { abbr: string; name: string; logo?: string }

type Game = {
  id: string
  season: number
  week: number
  game_time: string
  kickoff_at_utc?: string | null
  kickoff_confirmed?: boolean
  home_team: string
  away_team: string
  status: 'scheduled' | 'in_progress' | 'final' | string
  winner?: string | null
  home_score?: number | null
  away_score?: number | null
  is_test_game?: boolean | null
}

type SeasonWeek = { season: number; week: number; week_sunday_date: string }

type PickRow = { user_id: string; entry_id: string; week: number; slot: number; team_abbr: string; locked_at: string | null; result: 'win' | 'loss' | 'push' | null }
type DraftPickRow = { entry_id: string; week: number; slot: number; team_abbr: string; updated_at: string | null }
type FinalPickRow = { entry_id: string; week: number; slot: number; team_abbr: string; locked_at: string; result: 'win' | 'loss' | 'push' | null }
type PickNotice = { team?: Team; week?: number; slot?: number; action: 'saved' | 'cleared' | 'all-cleared'; count?: number }
type WeekPickCompletion = {
  pool_id: string
  week: number
  active_entries: number
  required_slots: number
  made_slots: number
  complete_entries: number
  partial_entries: number
  missing_slots: number
}
type PoolPickStatus = { week: number; made: number; needed: number; entries: number }
type PoolMemberSummary = { total: number; alive: number; totalEntries: number; aliveEntries: number }
type PoolWinnerStatus = {
  is_decided: boolean
  winner_user_id: string | null
  winner_name: string | null
  winner_avatar_url: string | null
  alive_members: number
  alive_entries: number
  total_members: number
  total_entries: number
  decided_week: number | null
}

type MemberStats = {
  pool_id: string
  user_id: string
  entry_id: string
  wins: number
  losses: number
  pushes: number
  strikes_used: number
  eliminated: boolean
  eliminated_week?: number | null
  survival_graces?: Array<{ week: number; strike_credits: number }>
}

type StandingsSnapshot = {
  games: Game[] | null
  stats: MemberStats[] | null
  visible_picks: PickRow[] | null
  history_picks: PickRow[] | null
  completion: WeekPickCompletion | null
}

type PoolMemberRosterRow = {
  entry_id: string
  profile_id: string
  entry_number: number | null
  entry_name: string | null
  display_name: string | null
  username: string | null
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
  role: string | null
  status: string | null
  joined_at: string | null
}

/** ---------------- Teams + Logos ---------------- */
const espnLogo = (abbr: string) => `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${abbr.toLowerCase()}.png`
const NFL_TEAMS: Team[] = [
  { abbr: 'ARI', name: 'Arizona Cardinals', logo: espnLogo('ARI') },
  { abbr: 'ATL', name: 'Atlanta Falcons', logo: espnLogo('ATL') },
  { abbr: 'BAL', name: 'Baltimore Ravens', logo: espnLogo('BAL') },
  { abbr: 'BUF', name: 'Buffalo Bills', logo: espnLogo('BUF') },
  { abbr: 'CAR', name: 'Carolina Panthers', logo: espnLogo('CAR') },
  { abbr: 'CHI', name: 'Chicago Bears', logo: espnLogo('CHI') },
  { abbr: 'CIN', name: 'Cincinnati Bengals', logo: espnLogo('CIN') },
  { abbr: 'CLE', name: 'Cleveland Browns', logo: espnLogo('CLE') },
  { abbr: 'DAL', name: 'Dallas Cowboys', logo: espnLogo('DAL') },
  { abbr: 'DEN', name: 'Denver Broncos', logo: espnLogo('DEN') },
  { abbr: 'DET', name: 'Detroit Lions', logo: espnLogo('DET') },
  { abbr: 'GB', name: 'Green Bay Packers', logo: espnLogo('GB') },
  { abbr: 'HOU', name: 'Houston Texans', logo: espnLogo('HOU') },
  { abbr: 'IND', name: 'Indianapolis Colts', logo: espnLogo('IND') },
  { abbr: 'JAX', name: 'Jacksonville Jaguars', logo: espnLogo('JAX') },
  { abbr: 'KC', name: 'Kansas City Chiefs', logo: espnLogo('KC') },
  { abbr: 'LV', name: 'Las Vegas Raiders', logo: espnLogo('LV') },
  { abbr: 'LAC', name: 'Los Angeles Chargers', logo: espnLogo('LAC') },
  { abbr: 'LAR', name: 'Los Angeles Rams', logo: espnLogo('LAR') },
  { abbr: 'MIA', name: 'Miami Dolphins', logo: espnLogo('MIA') },
  { abbr: 'MIN', name: 'Minnesota Vikings', logo: espnLogo('MIN') },
  { abbr: 'NE', name: 'New England Patriots', logo: espnLogo('NE') },
  { abbr: 'NO', name: 'New Orleans Saints', logo: espnLogo('NO') },
  { abbr: 'NYG', name: 'New York Giants', logo: espnLogo('NYG') },
  { abbr: 'NYJ', name: 'New York Jets', logo: espnLogo('NYJ') },
  { abbr: 'PHI', name: 'Philadelphia Eagles', logo: espnLogo('PHI') },
  { abbr: 'PIT', name: 'Pittsburgh Steelers', logo: espnLogo('PIT') },
  { abbr: 'SF', name: 'San Francisco 49ers', logo: espnLogo('SF') },
  { abbr: 'SEA', name: 'Seattle Seahawks', logo: espnLogo('SEA') },
  { abbr: 'TB', name: 'Tampa Bay Buccaneers', logo: espnLogo('TB') },
  { abbr: 'TEN', name: 'Tennessee Titans', logo: espnLogo('TEN') },
  { abbr: 'WAS', name: 'Washington Commanders', logo: espnLogo('WSH') },
]

const REGULAR_SEASON_MAX_WEEK = 18
const TEST_PLAYOFF_MAX_WEEK = 22
const SHORT_PLAYOFF_WEEK_LABELS: Record<number, string> = {
  19: 'WC',
  20: 'DIV',
  21: 'CONF',
  22: 'SB',
}
const FULL_PLAYOFF_WEEK_LABELS: Record<number, string> = {
  19: 'Wild Card',
  20: 'Divisional',
  21: 'Conference Championship',
  22: 'Super Bowl',
}

const POOL_CARD_SELECT = 'id,name,season,is_public,start_week,include_playoffs,strikes_allowed,tie_rule,image_url,max_members,allow_multiple_entries,max_entries_per_user,activation_status,double_pick_weeks,test_mode,test_current_week,test_now_at'
const POOL_DETAIL_SELECT = 'id,name,season,is_public,visibility,allow_discovery,start_week,include_playoffs,strikes_allowed,mulligans,tie_rule,ties,deadline,deadline_mode,deadline_fixed,notes,image_url,created_by,created_at,activation_status,activated_at,activated_by,archived,archived_at,max_members,allow_multiple_entries,max_entries_per_user,double_pick_weeks,plan,pick_privacy,payment_status,pinned_rank,sponsored_until,cloned_from_pool_id,test_mode,test_current_week,test_now_at,winner_user_id,name_normalized'
const teamByAbbr = (abbr?: string | null) => NFL_TEAMS.find((t) => t.abbr === abbr) || null
const isNoPick = (abbr?: string | null) => !!abbr?.startsWith('NO_PICK')
const toAbbr = (input: string): string => {
  if (!input) return input
  const up = input.toUpperCase().trim()
  const byAbbr = NFL_TEAMS.find((t) => t.abbr === up)
  if (byAbbr) return byAbbr.abbr
  const byName = NFL_TEAMS.find((t) => t.name.toUpperCase() === up)
  return byName ? byName.abbr : up
}
const pickKey = (week: number, slot = 1) => `${week}:${slot}`
const pickWeekFromKey = (key: string) => Number(key.split(':')[0])
function filterPickRecordThroughWeek<T>(picks: Record<string, T>, maxWeek: number): Record<string, T> {
  return Object.fromEntries(Object.entries(picks).filter(([key]) => pickWeekFromKey(key) <= maxWeek))
}
const maxWeekForPool = (pool?: Pick<Pool, 'include_playoffs' | 'test_mode'> | null) =>
  pool?.test_mode && pool.include_playoffs ? TEST_PLAYOFF_MAX_WEEK : REGULAR_SEASON_MAX_WEEK
const weekLabel = (week: number) => FULL_PLAYOFF_WEEK_LABELS[week] || `Week ${week}`
const shortWeekLabel = (week: number) => SHORT_PLAYOFF_WEEK_LABELS[week] || `W${week}`

const displayNameForMember = (m: Profile) =>
  m.username ||
  m.display_name ||
  `${(m.profile_id || m.id).slice(0, 8)}...`

const entryLabelForMember = (m: Profile) => {
  const name = displayNameForMember(m)
  if (m.entry_name?.trim()) return `${name} — ${m.entry_name.trim()}`
  return m.entry_number && m.entry_number > 1 ? `${name} (${m.entry_number})` : name
}

const selectedEntryStorageKey = (poolId: string) => `survive-sunday:selected-entry:${poolId}`

function normalizeTimeTo24h(s?: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  if (/^\d{1,2}:\d{2}$/.test(t) && !/[ap]m/i.test(t)) {
    const [H, M] = t.split(':').map(Number)
    if (H >= 0 && H <= 23 && M >= 0 && M <= 59) return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
  }
  const m = t.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i)
  if (m) {
    let H = Number(m[1])
    const M = Number(m[2])
    const ap = m[3].toLowerCase()
    if (ap === 'pm' && H < 12) H += 12
    if (ap === 'am' && H === 12) H = 0
    return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`
  }
  return null
}

function formatEtTime(s?: string | null) {
  const normalized = normalizeTimeTo24h(s) || '13:00'
  const [hour, minute] = normalized.split(':').map(Number)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix} ET`
}
function tzOffsetMinutes(zone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(utcDate)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const y = get('year'),
    mo = get('month'),
    d = get('day'),
    h = get('hour'),
    mi = get('minute'),
    s = get('second')
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s)
  return (asUTC - utcDate.getTime()) / 60000
}
function etLocalToUtcISO(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const [H, M] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, H, M, 0, 0)
  const off1 = tzOffsetMinutes('America/New_York', new Date(guess))
  let utcMs = guess - off1 * 60_000
  const off2 = tzOffsetMinutes('America/New_York', new Date(utcMs))
  if (off2 !== off1) utcMs = guess - off2 * 60_000
  return new Date(utcMs).toISOString()
}
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}
function currentPickWeek(rows: SeasonWeek[], now = new Date(), maxWeek = REGULAR_SEASON_MAX_WEEK): number {
  if (rows.length === 0) return 1
  const sorted = [...rows].sort((a, b) => a.week - b.week)
  let current = sorted[0]?.week ?? 1

  for (const row of sorted) {
    const opensAt = Date.parse(etLocalToUtcISO(addDaysYmd(row.week_sunday_date, -5), '06:00'))
    if (now.getTime() >= opensAt) current = row.week
  }

  return Math.min(Math.max(current, 1), maxWeek)
}
function currentWeekForPool(pool: Pick<Pool, 'start_week' | 'include_playoffs' | 'test_mode' | 'test_current_week'>, rows: SeasonWeek[]) {
  const maxWeek = maxWeekForPool(pool)
  if (pool.test_mode && pool.test_current_week) {
    return Math.min(maxWeek, Math.max(pool.start_week || 1, pool.test_current_week))
  }
  return Math.max(pool.start_week || 1, currentPickWeek(rows, new Date(), maxWeek))
}
function msToCountdown(ms: number) {
  if (ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function fmtDateTime(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function fmtEtDateTime(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('en-GB', {
    timeZone: 'America/New_York',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  })
}

/** ---------------- UI atoms ---------------- */
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`min-h-11 whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c5161d] ${
        active ? 'border-black font-semibold' : 'border-transparent text-gray-600 hover:text-black'
      }`}
    >
      {label}
    </button>
  )
}
function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}

const poolDecidedFromSummary = (summary?: PoolMemberSummary) => !!summary && poolHasWinner(summary.totalEntries, summary.aliveEntries)

function PoolStagePill({ pool, pickStatus, isDecided }: { pool: Pool; pickStatus?: PoolPickStatus; isDecided?: boolean }) {
  if (pool.activation_status === 'cancelled') {
    return <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Closed</span>
  }
  if (isDecided) {
    return <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">Winner</span>
  }
  if (pickStatus) {
    return <span className="shrink-0 rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{shortWeekLabel(pickStatus.week)}</span>
  }
  return <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Loading</span>
}

function PickStatusCard({ status, isDecided }: { status: PoolPickStatus; isDecided?: boolean }) {
  if (isDecided) {
    return (
      <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
        Pool complete: winner decided
      </div>
    )
  }

  const complete = status.needed > 0 && status.made >= status.needed
  const partial = status.made > 0 && !complete
  const label = complete
    ? `${status.made}/${status.needed} saved — no action needed`
    : partial
      ? `${status.made}/${status.needed} picks made - finish making picks`
      : status.needed > 1
        ? `Make ${status.needed} picks`
        : 'Make pick'

  return (
    <div
      className={`mt-3 rounded-md border px-3 py-2 text-sm font-semibold ${
        complete ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      {weekLabel(status.week)}: {label}
    </div>
  )
}

function WinnerAvatar({ name, avatarUrl, isCurrentUser }: { name: string; avatarUrl?: string | null; isCurrentUser?: boolean }) {
  return (
    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-slate-900 text-lg font-bold text-white shadow-md">
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <span>{(isCurrentUser ? 'Y' : name[0] || 'W').toUpperCase()}</span>
      )}
    </div>
  )
}

function PoolWinnerCelebration({
  poolName,
  winner,
  isCurrentUser,
  onStandings,
  compact = false,
}: {
  poolName: string
  winner: PoolWinnerStatus
  isCurrentUser: boolean
  onStandings?: () => void
  compact?: boolean
}) {
  const winnerName = winner.winner_name || 'The last player standing'
  const entryCopy =
    winner.alive_entries > 1
      ? `${winner.alive_entries} entries survived for ${isCurrentUser ? 'you' : winnerName}.`
      : 'One player survived the pool.'
  const decidedCopy = winner.decided_week ? `Decided after ${weekLabel(winner.decided_week)}.` : 'The pool is complete.'

  return (
    <section className={`relative overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm ${compact ? 'mb-5 p-4' : 'mb-6 p-6'}`}>
      <div className="absolute inset-x-0 top-0 grid grid-cols-6">
        <span className="h-1 bg-[#c5161d]" />
        <span className="h-1 bg-amber-400" />
        <span className="h-1 bg-emerald-500" />
        <span className="h-1 bg-slate-900" />
        <span className="h-1 bg-amber-400" />
        <span className="h-1 bg-[#c5161d]" />
      </div>
      <div className={`flex gap-4 ${compact ? 'items-center' : 'flex-col sm:flex-row sm:items-center'}`}>
        <WinnerAvatar name={winnerName} avatarUrl={winner.winner_avatar_url} isCurrentUser={isCurrentUser} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Pool Champion</p>
          <h3 className={`${compact ? 'text-xl' : 'text-3xl'} mt-1 font-black leading-tight text-slate-950`}>
            {isCurrentUser ? `You won ${poolName}` : `${winnerName} won ${poolName}`}
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {entryCopy} {decidedCopy} No more picks are needed.
          </p>
        </div>
        {onStandings && !compact && (
          <button
            type="button"
            onClick={onStandings}
            className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-black"
          >
            View final standings
          </button>
        )}
      </div>
    </section>
  )
}

function ResultPill({ status }: { status: 'win' | 'loss' | 'push' | 'Pending' | '-' | string }) {
  const up = (status || '').toString().toUpperCase()
  const map: Record<string, string> = {
    WIN: 'bg-emerald-600 text-white',
    LOSS: 'bg-red-600 text-white',
    PUSH: 'bg-gray-400 text-white',
    PENDING: 'bg-gray-100 text-gray-700 border border-gray-300',
    '-': 'bg-gray-100 text-gray-700 border border-gray-300',
  }
  const cls = map[up] || map.PENDING
  const label = up === 'WIN' ? 'Win' : up === 'LOSS' ? 'Loss' : up === 'PUSH' ? 'NFL tie' : status || 'Pending'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>
}

function compactResultLabel(result?: PickRow['result']) {
  if (result === 'win') return 'W'
  if (result === 'loss') return 'L'
  if (result === 'push') return 'T'
  return ''
}

function compactResultClass(result?: PickRow['result']) {
  if (result === 'win') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (result === 'loss') return 'border-red-200 bg-red-50 text-red-800'
  if (result === 'push') return 'border-slate-300 bg-slate-100 text-slate-700'
  return 'border-slate-200 bg-white text-slate-700'
}

function EntryAvatar({ member, name }: { member: Profile; name: string }) {
  return (
    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border bg-gray-100 flex items-center justify-center">
      {member.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={member.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs font-semibold text-gray-600">{(name[0] || '?').toUpperCase()}</span>
      )}
    </div>
  )
}

function SurvivalChart({ alive, total, week }: { alive: number; total: number; week: number }) {
  const safeTotal = Math.max(total, 0)
  const safeAlive = Math.min(Math.max(alive, 0), safeTotal)
  const eliminated = Math.max(safeTotal - safeAlive, 0)
  const alivePct = safeTotal > 0 ? Math.round((safeAlive / safeTotal) * 100) : 0
  const eliminatedPct = safeTotal > 0 ? 100 - alivePct : 0
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const aliveLength = safeTotal > 0 ? (safeAlive / safeTotal) * circumference : 0
  const eliminatedLength = safeTotal > 0 ? circumference - aliveLength : 0

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <svg width="94" height="94" viewBox="0 0 94 94" className="shrink-0" aria-label={`${safeAlive} of ${safeTotal} entries alive`}>
        <g transform="translate(47,47) rotate(-90)">
          <circle r={radius} cx="0" cy="0" fill="transparent" stroke="#e2e8f0" strokeWidth="14" />
          {safeTotal > 0 && (
            <>
              <circle
                r={radius}
                cx="0"
                cy="0"
                fill="transparent"
                stroke="#059669"
                strokeWidth="14"
                strokeLinecap="butt"
                strokeDasharray={`${aliveLength} ${circumference - aliveLength}`}
              />
              {eliminated > 0 && (
                <circle
                  r={radius}
                  cx="0"
                  cy="0"
                  fill="transparent"
                  stroke="#dc2626"
                  strokeWidth="14"
                  strokeLinecap="butt"
                  strokeDasharray={`${eliminatedLength} ${circumference - eliminatedLength}`}
                  strokeDashoffset={-aliveLength}
                />
              )}
            </>
          )}
        </g>
        <text x="47" y="44" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">
          {safeAlive}/{safeTotal}
        </text>
        <text x="47" y="59" textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">
          alive
        </text>
      </svg>
      <div className="min-w-[120px] text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Through {weekLabel(week)}</div>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-slate-700">
            <span className="h-3 w-3 rounded-sm bg-emerald-600" />
            Alive
          </span>
          <span className="font-semibold text-slate-950">{safeAlive} ({alivePct}%)</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-slate-700">
            <span className="h-3 w-3 rounded-sm bg-red-600" />
            Eliminated
          </span>
          <span className="font-semibold text-slate-950">{eliminated} ({eliminatedPct}%)</span>
        </div>
      </div>
    </div>
  )
}

function WeekPickCell({ picks, muted }: { picks: PickRow[]; muted?: boolean }) {
  if (muted) {
    return <div className="h-10 rounded-md bg-slate-50" aria-label="Entry was already eliminated" />
  }

  if (picks.length === 0) {
    return <span className="text-slate-300">-</span>
  }

  return (
    <div className="flex min-w-[86px] flex-col gap-1">
      {picks.map((pick) => {
        const noPick = isNoPick(pick.team_abbr)
        const abbr = noPick ? 'NP' : toAbbr(pick.team_abbr)
        const team = noPick ? null : teamByAbbr(abbr)
        return (
          <div
            key={`${pick.entry_id}-${pick.week}-${pick.slot}`}
            className={`inline-flex items-center justify-between gap-1 rounded-md border px-1.5 py-1 text-xs font-semibold ${compactResultClass(pick.result)}`}
            title={noPick ? 'No pick submitted' : team?.name || abbr}
          >
            <span className="inline-flex min-w-0 items-center gap-1">
              {team && <TeamLogo team={team} size={16} />}
              <span>{abbr}</span>
            </span>
            {compactResultLabel(pick.result) && <span>{compactResultLabel(pick.result)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function TeamLogo({ team, size = 28 }: { team: Team; size?: number }) {
  return team.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={team.logo} alt={team.name} className="object-contain" style={{ width: size, height: size }} />
  ) : (
    <span className="flex items-center justify-center rounded-full border text-xs font-semibold" style={{ width: size, height: size }}>
      {team.abbr}
    </span>
  )
}

function PickSavedToast({ notice, onClose }: { notice: PickNotice; onClose: () => void }) {
  const isCleared = notice.action === 'cleared'
  const isAllCleared = notice.action === 'all-cleared'

  return (
    <div className="fixed bottom-5 right-5 z-[70] w-[min(360px,calc(100vw-2rem))] rounded-lg border border-emerald-200 bg-white p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
          {notice.team ? <TeamLogo team={notice.team} size={34} /> : <span className="text-sm font-bold text-emerald-700">OK</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-950">{isAllCleared ? 'Picks cleared' : isCleared ? 'Pick cleared' : 'Pick saved'}</div>
          {isAllCleared ? (
            <div className="mt-0.5 text-sm text-slate-700">
              {notice.count || 0} editable {(notice.count || 0) === 1 ? 'pick was' : 'picks were'} cleared.
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-slate-700">
              {notice.week ? weekLabel(notice.week) : 'Picks'}
              {(notice.slot || 1) > 1 ? `, Pick ${notice.slot}` : ''}: {isCleared ? 'No team selected' : `${notice.team?.name} (${notice.team?.abbr})`}
            </div>
          )}
          <div className="mt-1 text-xs text-slate-500">{isAllCleared ? 'Locked picks were left alone.' : 'You can change this pick until its deadline.'}</div>
        </div>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close pick confirmation">
          x
        </button>
      </div>
    </div>
  )
}

/** ---------------- Team Picker Modal ---------------- */
function TeamPickerModal(props: {
  week: number
  slot: number
  onClose: () => void
  teamSearch: string
  setTeamSearch: (v: string) => void
  filteredTeams: Team[]
  usedTeamAbbrs: string[]
  myDraftPicks: Record<string, Team | null>
  onPickTeam: (week: number, slot: number, team: Team) => void
  gamesLoading: boolean
  weekGames: Game[]
  deadlineMode: 'fixed' | 'rolling'
  fixedLockUtc: string | null
  currentTimeMs: number
}) {
  const { week, slot, onClose, teamSearch, setTeamSearch, filteredTeams, usedTeamAbbrs, myDraftPicks, onPickTeam, gamesLoading, weekGames, deadlineMode, fixedLockUtc, currentTimeMs } =
    props
  const selectedKey = pickKey(week, slot)

  return (
    <div className="fixed inset-0 z-[60]">
      <button type="button" aria-label="Close team picker" className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="team-picker-title" className="absolute left-1/2 top-1/2 max-h-[85vh] w-[min(1100px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h4 id="team-picker-title" className="text-lg font-semibold">
            Choose a team to win — {weekLabel(week)}, Pick {slot}
          </h4>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search teams..."
              className="border border-gray-300 rounded-md px-3 py-1 text-sm"
            />
            <button onClick={onClose} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200">
              Close
            </button>
          </div>
        </div>

        <p className="mb-3 text-sm text-slate-600">Selecting a team saves it immediately. Dimmed teams are locked, have an unconfirmed kickoff, or were already used by this entry.</p>

        {teamSearch.trim() ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredTeams.map((t) => {
              const usedElsewhere = usedTeamAbbrs.includes(t.abbr) && myDraftPicks[selectedKey]?.abbr !== t.abbr
              const scheduledGame = weekGames.find((game) => toAbbr(game.home_team) === t.abbr || toAbbr(game.away_team) === t.abbr)
              const kickoffUnconfirmed = scheduledGame?.kickoff_confirmed === false
              const disabled = usedElsewhere || kickoffUnconfirmed
              return (
                <button
                  key={t.abbr}
                  onClick={() => onPickTeam(week, slot, t)}
                  disabled={disabled}
                  className={`border border-gray-200 rounded-lg p-3 hover:shadow flex items-center gap-3 text-left ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={kickoffUnconfirmed ? 'Unavailable until the NFL confirms kickoff' : usedElsewhere ? 'Already used in another week' : ''}
                >
                  <div className="relative w-8 h-8 shrink-0">
                    {t.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.logo} alt={t.name} className="h-8 w-8 object-contain" />
                    ) : (
                      <div className="w-8 h-8 rounded-full border flex items-center justify-center text-xs">{t.abbr}</div>
                    )}
                  </div>
                  <div>
                    <div className="font-medium leading-tight">{t.name}</div>
                    <div className="text-xs text-gray-500">{t.abbr}</div>
                    {usedElsewhere && <div className="text-[10px] uppercase text-red-600 mt-1">Used</div>}
                    {kickoffUnconfirmed && <div className="mt-1 text-[10px] uppercase text-amber-700">Kickoff TBD</div>}
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <>
            {gamesLoading && <p className="text-sm text-gray-600">Loading matchups...</p>}
            {!gamesLoading && weekGames.length === 0 && <p className="text-sm text-gray-600">No games found for {weekLabel(week)}.</p>}
            {!gamesLoading && weekGames.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {weekGames.map((g) => {
                  const homeAbbr = toAbbr(g.home_team)
                  const awayAbbr = toAbbr(g.away_team)
                  const kickoffIso = g.kickoff_at_utc || g.game_time
                  const kickoffMs = Date.parse(kickoffIso)
                  const kickoffConfirmed = g.kickoff_confirmed !== false

                  // hybrid lock = earlier of kickoff OR global fixed lock (if in fixed mode)
                  const fixedMs = deadlineMode === 'fixed' && fixedLockUtc ? Date.parse(fixedLockUtc) : Infinity
                  const lockMs = Math.min(kickoffMs, fixedMs)
                  const locked = currentTimeMs >= lockMs
                  const countdown = !kickoffConfirmed ? 'Unavailable: kickoff TBD' : locked ? 'Locked' : `Locks in ${msToCountdown(lockMs - currentTimeMs)}`

                  const cards = [
                    { abbr: awayAbbr, side: 'Away' as const },
                    { abbr: homeAbbr, side: 'Home' as const },
                  ]

                  return (
                    <div key={g.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs text-gray-500">{kickoffConfirmed ? fmtEtDateTime(kickoffIso) : 'Official kickoff time TBD'}</div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${!kickoffConfirmed ? 'bg-amber-50 border-amber-300 text-amber-800' : locked ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-green-50 border-green-300 text-green-700'}`}>
                          {countdown}
                        </span>
                      </div>
                      <div className="text-sm font-medium mb-2">
                        {awayAbbr} @ {homeAbbr}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {cards.map((c) => {
                          const usedElsewhere = usedTeamAbbrs.includes(c.abbr) && myDraftPicks[selectedKey]?.abbr !== c.abbr
                          const team = NFL_TEAMS.find((t) => t.abbr === c.abbr) || { abbr: c.abbr, name: c.abbr }
                          const disabled = !kickoffConfirmed || locked || usedElsewhere
                          const title = !kickoffConfirmed ? 'Unavailable until the NFL confirms kickoff' : locked ? 'Locked - pick window has closed' : usedElsewhere ? 'Already used in another week' : ''
                          return (
                            <button
                              key={c.abbr}
                              onClick={() => onPickTeam(week, slot, team as Team)}
                              disabled={disabled}
                              className={`border rounded-md p-2 flex items-center gap-2 hover:shadow ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                              title={title}
                            >
                              <div className="relative w-7 h-7 shrink-0">
                                {'logo' in team && (team as Team).logo ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={(team as Team).logo!} alt={(team as Team).name} className="object-contain w-7 h-7" />
                                ) : (
                                  <div className="w-7 h-7 rounded-full border flex items-center justify-center text-xs">{c.abbr}</div>
                                )}
                              </div>
                              <div className="text-left">
                                <div className="text-sm font-medium">{('name' in team && (team as Team).name) || c.abbr}</div>
                                <div className="text-[11px] text-gray-500">{c.side}</div>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** ---------------- Page ---------------- */
function MyPoolsContent() {
  const searchParams = useSearchParams()
  const requestedPoolId = searchParams.get('pool')

  // base state
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pools, setPools] = useState<Pool[]>([])
  const [poolPickStatuses, setPoolPickStatuses] = useState<Record<string, PoolPickStatus>>({})
  const [poolMemberSummaries, setPoolMemberSummaries] = useState<Record<string, PoolMemberSummary>>({})
  const [userId, setUserId] = useState<string | null>(null)

  // modal + selection
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'picks' | 'standings' | 'members'>('picks')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pool, setPool] = useState<Pool | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const openedPoolParamRef = useRef<string | null>(null)
  const backgroundRefreshRef = useRef<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [poolStartAt, setPoolStartAt] = useState<string | null>(null)
  const [canManagePool, setCanManagePool] = useState(false)

  // members
  const [members, setMembers] = useState<Profile[]>([])
  const [memberCount, setMemberCount] = useState<number>(0)
  const [membersLoadedFor, setMembersLoadedFor] = useState<string | null>(null)
  const [myEntries, setMyEntries] = useState<Profile[]>([])
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [addingEntry, setAddingEntry] = useState(false)
  const [leavingPool, setLeavingPool] = useState(false)

  // picks (mine)
  const maxPickWeek = maxWeekForPool(pool)
  const weeks = useMemo(() => Array.from({ length: maxPickWeek }, (_, i) => i + 1), [maxPickWeek])
  const [selectedPickWeek, setSelectedPickWeek] = useState(1)
  const [myDraftPicks, setMyDraftPicks] = useState<Record<string, Team | null>>({})
  const [myFinalPicks, setMyFinalPicks] = useState<Record<string, FinalPickRow>>({})
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [savingPickKeys, setSavingPickKeys] = useState<Record<string, boolean>>({})
  const [pickNotice, setPickNotice] = useState<PickNotice | null>(null)
  const [appDialog, setAppDialog] = useState<AppDialog | null>(null)
  const pickNoticeTimerRef = useRef<number | null>(null)

  // team picker (single source of truth - no duplicates)
  const [teamPickerTarget, setTeamPickerTarget] = useState<{ week: number; slot: number } | null>(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [weekGames, setWeekGames] = useState<Game[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [fixedLockUtc, setFixedLockUtc] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState<number>(Date.now())
  const tickRef = useRef<number | null>(null)

  // standings
  const [standingsWeek, setStandingsWeek] = useState<number>(1)
  const [picksThisWeek, setPicksThisWeek] = useState<PickRow[]>([])
  const [standingsHistoryPicks, setStandingsHistoryPicks] = useState<PickRow[]>([])
  const [standingsPicksVisible, setStandingsPicksVisible] = useState(false)
  const [standingsResultsVisible, setStandingsResultsVisible] = useState(false)
  const [standingsGamesForWeek, setStandingsGamesForWeek] = useState<Game[]>([])
  const [standingsPickCompletion, setStandingsPickCompletion] = useState<WeekPickCompletion | null>(null)
  const [statsByUser, setStatsByUser] = useState<Record<string, MemberStats>>({})
  const [poolWinner, setPoolWinner] = useState<PoolWinnerStatus | null>(null)
  const availableWeeks = useMemo(() => weeks.filter((week) => week >= (pool?.start_week ?? 1)), [weeks, pool?.start_week])
  const picksAllowedForWeek = useCallback((week: number) => {
    if (week < (pool?.start_week ?? 1)) return 0
    return requiredPickSlots(pool?.double_pick_weeks, week)
  }, [pool?.double_pick_weeks, pool?.start_week])
  const poolStartMs = poolStartAt ? Date.parse(poolStartAt) : null
  const poolStartKnown = poolStartMs !== null && Number.isFinite(poolStartMs)
  const isTestMode = !!pool?.test_mode
  const simulatedWeek = pool?.test_current_week || pool?.start_week || 1
  const testNowMs = pool?.test_mode && pool.test_now_at ? Date.parse(pool.test_now_at) : null
  const effectiveNowMs = testNowMs !== null && Number.isFinite(testNowMs) ? testNowMs : nowTick
  const leagueHasStarted = isTestMode ? simulatedWeek >= (pool?.start_week ?? 1) : poolStartKnown && Date.now() >= poolStartMs
  const canInvite = !!pool && !isTestMode && pool.activation_status !== 'cancelled' && poolStartKnown && !leagueHasStarted
  const selectedWeekLockedByTestMode = isTestMode && selectedPickWeek < simulatedWeek
  const myStats = selectedEntryId ? statsByUser[selectedEntryId] : undefined
  const selectedEntry = myEntries.find((entry) => entry.id === selectedEntryId) || null
  const myEliminatedWeek = myStats?.eliminated && myStats.eliminated_week ? myStats.eliminated_week : null
  const isEliminated = leagueHasStarted && !!myStats?.eliminated
  const poolDecided = !!poolWinner?.is_decided
  const currentUserWonPool = poolDecided && !!userId && poolWinner?.winner_user_id === userId
  const visiblePickCutoffWeek = [myEliminatedWeek, poolWinner?.decided_week ?? null]
    .filter((week): week is number => typeof week === 'number' && Number.isFinite(week))
    .reduce<number | null>((cutoff, week) => (cutoff === null ? week : Math.min(cutoff, week)), null)
  const uniqueMemberCount = useMemo(() => new Set(members.map((member) => member.profile_id || member.id)).size || memberCount, [members, memberCount])
  const canMakePicks = !!pool && !!selectedEntryId && !isEliminated && !poolDecided && selectedPickWeek >= pool.start_week && !selectedWeekLockedByTestMode
  const deadlineLabel =
    pool?.deadline_mode === 'rolling'
      ? 'Rolling: each game locks at kickoff'
      : `Sunday ${formatEtTime(pool?.deadline_fixed)}; earlier games lock at kickoff`
  const selectedWeekCloseLabel =
    isTestMode
      ? pool?.test_now_at
        ? `Test clock: ${fmtEtDateTime(pool.test_now_at)}.`
        : 'Test mode: this week advances when the superadmin scores it.'
      : pool?.deadline_mode === 'rolling'
      ? 'Each matchup closes at kickoff.'
      : fixedLockUtc
        ? `Most games close ${fmtEtDateTime(fixedLockUtc)}; any earlier game locks at its kickoff.`
        : 'Week close time unavailable.'
  const showPickNotice = (notice: PickNotice) => {
    if (pickNoticeTimerRef.current) window.clearTimeout(pickNoticeTimerRef.current)
    setPickNotice(notice)
    pickNoticeTimerRef.current = window.setTimeout(() => setPickNotice(null), 3600)
  }
  const showMessage = useCallback((title: string, message: string, tone: AppDialog['tone'] = 'info') => {
    setAppDialog({ title, message, tone, confirmLabel: 'Got it' })
  }, [])
  const confirmAction = useCallback((dialog: AppDialog) => {
    setAppDialog({ cancelLabel: 'Cancel', confirmLabel: 'Continue', tone: 'warning', ...dialog })
  }, [])

  const restoreUnlockedPicks = async (poolId: string) => {
    const { error } = await supabase.rpc('restore_unlocked_picks_for_pool', { p_pool_id: poolId })
    if (error) throw error
  }

  const loadPoolWinner = async (poolId: string) => {
    const { data, error } = await supabase.rpc('pool_winner_status', { p_pool_id: poolId })
    if (error) throw error
    const winner = (((data || []) as PoolWinnerStatus[])[0] || null) as PoolWinnerStatus | null
    setPoolWinner(winner)
    return winner
  }

  const loadMyPicks = async (poolId: string, startWeek = pool?.start_week ?? 1, entryId = selectedEntryId) => {
    if (!userId || !entryId) return

    const [{ data: finalPicks, error: finalErr }, { data: drafts, error: draftErr }] = await Promise.all([
      supabase.from('pool_picks').select('entry_id, week, slot, team_abbr, locked_at, result').eq('pool_id', poolId).eq('entry_id', entryId).gte('week', startWeek),
      supabase.from('pool_pick_drafts').select('entry_id, week, slot, team_abbr, updated_at').eq('pool_id', poolId).eq('entry_id', entryId).gte('week', startWeek),
    ])
    if (finalErr) throw finalErr
    if (draftErr) throw draftErr

    const visibleFinalPicks = ((finalPicks || []) as FinalPickRow[]).filter((pick) => !visiblePickCutoffWeek || pick.week <= visiblePickCutoffWeek)
    const visibleDrafts = ((drafts || []) as DraftPickRow[]).filter((pick) => !visiblePickCutoffWeek || pick.week <= visiblePickCutoffWeek)

    const locked: Record<string, FinalPickRow> = {}
    for (const pick of visibleFinalPicks) {
      locked[pickKey(pick.week, pick.slot)] = pick
    }
    setMyFinalPicks(locked)

    const next: Record<string, Team | null> = {}
    let latest: string | null = null
    for (const r of visibleDrafts) {
      next[pickKey(r.week, r.slot)] = teamByAbbr(r.team_abbr) || { abbr: r.team_abbr, name: r.team_abbr }
      const upAt = r.updated_at
      if (upAt && (!latest || upAt > latest)) latest = upAt
    }
    setMyDraftPicks(next)
    setDraftSavedAt(latest)
  }

  const refreshPoolPickStatus = async (poolToRefresh = pool, entriesOverride?: Profile[]) => {
    if (!userId || !poolToRefresh) return

    try {
      const entryIds = entriesOverride?.length
        ? entriesOverride.map((entry) => entry.id).filter(Boolean)
        : ((await supabase
            .from('pool_members')
            .select('id')
            .eq('pool_id', poolToRefresh.id)
            .eq('profile_id', userId)).data || []).map((entry) => entry.id)

      if (entryIds.length === 0) {
        setPoolPickStatuses((prev) => ({
          ...prev,
          [poolToRefresh.id]: { week: poolToRefresh.start_week, made: 0, needed: 0, entries: 0 },
        }))
        return
      }

      const season = poolToRefresh.season ?? new Date().getFullYear()
      const [{ data: seasonRows }, { data: draftRows }, { data: finalRows }] = await Promise.all([
        supabase.from('season_weeks').select('season, week, week_sunday_date').eq('season', season),
        supabase.from('pool_pick_drafts').select('pool_id,entry_id,week,slot').eq('pool_id', poolToRefresh.id).in('entry_id', entryIds),
        supabase.from('pool_picks').select('pool_id,entry_id,week,slot').eq('pool_id', poolToRefresh.id).in('entry_id', entryIds),
      ])

      const targetMaxWeek = maxWeekForPool(poolToRefresh)
      const targetWeek = currentWeekForPool(poolToRefresh, ((seasonRows || []) as SeasonWeek[]).filter((week) => week.week >= 1 && week.week <= targetMaxWeek))
      const required = poolToRefresh.double_pick_weeks?.includes(targetWeek) ? 2 : 1
      const needed = entryIds.length * required
      const pickedSlots = new Set<string>()
      for (const pick of [
        ...((draftRows || []) as Array<{ pool_id: string; entry_id: string; week: number; slot: number }>),
        ...((finalRows || []) as Array<{ pool_id: string; entry_id: string; week: number; slot: number }>),
      ]) {
        pickedSlots.add(`${pick.pool_id}:${pick.entry_id}:${pick.week}:${pick.slot}`)
      }

      let made = 0
      for (const entryId of entryIds) {
        for (let slot = 1; slot <= required; slot += 1) {
          if (pickedSlots.has(`${poolToRefresh.id}:${entryId}:${targetWeek}:${slot}`)) made += 1
        }
      }

      setPoolPickStatuses((prev) => ({
        ...prev,
        [poolToRefresh.id]: { week: targetWeek, made, needed, entries: entryIds.length },
      }))
    } catch (e) {
      void logAppEvent({ eventType: 'dashboard_pick_status_refresh_failed', error: e, poolId: poolToRefresh.id })
      console.warn('Pool pick status refresh failed', e)
    }
  }

  const loadMembers = async (poolId: string) => {
    const { data: rosterRows, error: rosterErr } = await supabase.rpc('pool_entry_roster', { p_pool_id: poolId })
    if (rosterErr) throw rosterErr

    const roster = ((rosterRows || []) as PoolMemberRosterRow[]).map((m) => ({
      id: m.entry_id,
      entry_id: m.entry_id,
      profile_id: m.profile_id,
      entry_number: m.entry_number,
      entry_name: m.entry_name,
      first_name: m.first_name,
      last_name: m.last_name,
      display_name: m.display_name,
      username: m.username,
      avatar_url: m.avatar_url,
      role: m.role,
      status: m.status,
      joined_at: m.joined_at,
    }))
    setMembers(roster)
    setMemberCount(roster.length)
    setMembersLoadedFor(poolId)
    const entries = roster.filter((m) => m.profile_id === userId)
    setMyEntries(entries)
    setSelectedEntryId((current) => (current && entries.some((entry) => entry.id === current) ? current : entries[0]?.id ?? null))
    return roster
  }
  const [standingsLoading, setStandingsLoading] = useState(false)

  /** ---------- Load user + pools ---------- */
  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | null = null
    const clearSignedOutState = () => {
      setUserId(null)
      setPools([])
      setPoolPickStatuses({})
      setPoolMemberSummaries({})
      setPool(null)
      setMembers([])
      setMembersLoadedFor(null)
      setPicksThisWeek([])
      setStatsByUser({})
      setPoolWinner(null)
      setMyDraftPicks({})
      setMyFinalPicks({})
      setError(null)
      setCanManagePool(false)
      setLoading(false)
      if (typeof window !== 'undefined' && window.location.pathname === '/pools') {
        window.location.href = '/?auth=signin'
      }
    }

    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const { data: userResp, error: userErr } = await supabase.auth.getUser()
        if (userErr && userErr.name !== 'AuthSessionMissingError') throw userErr
        const user = userResp.user
        if (!user) {
          if (!alive) return
          clearSignedOutState()
          return
        }
        if (!alive) return
        setUserId(user.id)

        //  CHANGE #1: only non-archived pools you created
        const { data: createdPools, error: createdErr } = await supabase
          .from('pools')
          .select(POOL_CARD_SELECT)
          .eq('created_by', user.id)
          .eq('archived', false)
          .order('created_at', { ascending: false })
        if (createdErr) throw createdErr

        const { data: memberships, error: memErr } = await supabase.from('pool_members').select('id,pool_id').eq('profile_id', user.id)
        if (memErr) throw memErr

        let memberPools: Pool[] = []
        const ids = (memberships || []).map((m) => m.pool_id)
        if (ids.length > 0) {
          //  CHANGE #2: only non-archived pools you are a member of
          const { data, error } = await supabase
            .from('pools')
            .select(POOL_CARD_SELECT)
            .in('id', ids)
            .eq('archived', false)
            .order('created_at', { ascending: false })
          if (error) throw error
          memberPools = (data || []) as Pool[]
        }

        const map = new Map<string, Pool>()
        for (const p of (createdPools || []) as Pool[]) map.set(p.id, p)
        for (const p of memberPools) map.set(p.id, p)

        const nextPools = Array.from(map.values())
        const poolIds = nextPools.map((pool) => pool.id)
        const seasons = Array.from(new Set(nextPools.map((pool) => pool.season ?? new Date().getFullYear())))
        const [{ data: seasonRows }, { data: draftRows }, { data: finalRows }, { data: allMemberRows }, { data: allStatsRows }, { data: summaryRows }] = await Promise.all([
          seasons.length
            ? supabase.from('season_weeks').select('season, week, week_sunday_date').in('season', seasons)
            : Promise.resolve({ data: [] }),
          memberships?.length
            ? supabase.from('pool_pick_drafts').select('pool_id,entry_id,week,slot').in('entry_id', memberships.map((m) => m.id))
            : Promise.resolve({ data: [] }),
          memberships?.length
            ? supabase.from('pool_picks').select('pool_id,entry_id,week,slot').in('entry_id', memberships.map((m) => m.id))
            : Promise.resolve({ data: [] }),
          poolIds.length
            ? supabase.from('pool_members').select('pool_id,profile_id,status').in('pool_id', poolIds)
            : Promise.resolve({ data: [] }),
          poolIds.length
            ? supabase.from('pool_member_stats').select('pool_id,user_id,entry_id,eliminated').in('pool_id', poolIds)
            : Promise.resolve({ data: [] }),
          poolIds.length
            ? supabase.rpc('pool_member_summaries', { p_pool_ids: poolIds })
            : Promise.resolve({ data: [] }),
        ])

        const weeksBySeason = new Map<number, SeasonWeek[]>()
        for (const row of ((seasonRows || []) as SeasonWeek[]).filter((week) => week.week >= 1 && week.week <= 18)) {
          const list = weeksBySeason.get(row.season) || []
          list.push(row)
          weeksBySeason.set(row.season, list)
        }
        const entriesByPool = new Map<string, string[]>()
        for (const membership of memberships || []) {
          const list = entriesByPool.get(membership.pool_id) || []
          list.push(membership.id)
          entriesByPool.set(membership.pool_id, list)
        }
        const pickedSlots = new Set<string>()
        for (const pick of [...((draftRows || []) as Array<{ pool_id: string; entry_id: string; week: number; slot: number }>), ...((finalRows || []) as Array<{ pool_id: string; entry_id: string; week: number; slot: number }>)]) {
          pickedSlots.add(`${pick.pool_id}:${pick.entry_id}:${pick.week}:${pick.slot}`)
        }
        const statuses: Record<string, PoolPickStatus> = {}
        const summaries: Record<string, PoolMemberSummary> = {}
        const membersByPool = new Map<string, Set<string>>()
        for (const member of (allMemberRows || []) as Array<{ pool_id: string; profile_id: string; status?: string | null }>) {
          const members = membersByPool.get(member.pool_id) || new Set<string>()
          members.add(member.profile_id)
          membersByPool.set(member.pool_id, members)
        }
        const statsByPoolProfile = new Map<string, { anyStats: boolean; anyAlive: boolean }>()
        for (const stat of (allStatsRows || []) as Array<{ pool_id: string; user_id: string; eliminated: boolean | null }>) {
          const key = `${stat.pool_id}:${stat.user_id}`
          const current = statsByPoolProfile.get(key) || { anyStats: false, anyAlive: false }
          current.anyStats = true
          if (!stat.eliminated) current.anyAlive = true
          statsByPoolProfile.set(key, current)
        }
        for (const pool of nextPools) {
          const members = membersByPool.get(pool.id) || new Set<string>()
          let aliveMembers = 0
          members.forEach((profileId) => {
            const stat = statsByPoolProfile.get(`${pool.id}:${profileId}`)
            if (!stat || stat.anyAlive) aliveMembers += 1
          })
          summaries[pool.id] = { total: members.size, alive: aliveMembers, totalEntries: 0, aliveEntries: 0 }
        }
        for (const summary of (summaryRows || []) as Array<{ pool_id: string; total_members: number; alive_members: number; total_entries: number; alive_entries: number }>) {
          summaries[summary.pool_id] = {
            total: summary.total_members,
            alive: summary.alive_members,
            totalEntries: summary.total_entries,
            aliveEntries: summary.alive_entries,
          }
        }
        for (const pool of nextPools) {
          const season = pool.season ?? new Date().getFullYear()
          const targetWeek = currentWeekForPool(pool, weeksBySeason.get(season) || [])
          const entryIds = entriesByPool.get(pool.id) || []
          const required = pool.double_pick_weeks?.includes(targetWeek) ? 2 : 1
          const needed = entryIds.length * required
          let made = 0
          for (const entryId of entryIds) {
            for (let slot = 1; slot <= required; slot += 1) {
              if (pickedSlots.has(`${pool.id}:${entryId}:${targetWeek}:${slot}`)) made += 1
            }
          }
          statuses[pool.id] = { week: targetWeek, made, needed, entries: entryIds.length }
        }

        if (!alive) return
        setPools(nextPools)
        setPoolPickStatuses(statuses)
        setPoolMemberSummaries(summaries)
      } catch (e: unknown) {
        if (!alive) return
        void logAppEvent({ eventType: 'my_pools_load_failed', error: e })
        setError(getErrorMessage(e, 'Failed to load pools.'))
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) clearSignedOutState()
    })
    unsubscribe = () => data.subscription.unsubscribe()

    const onStorage = (event: StorageEvent) => {
      if (event.key === 'surviveSunday:auth-event' && event.newValue === 'signed-out') {
        clearSignedOutState()
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      alive = false
      unsubscribe?.()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  /** ---------- Tick timer for countdowns ---------- */
  useEffect(() => {
    if (!teamPickerTarget) return
    tickRef.current = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [teamPickerTarget])

  useEffect(() => {
    return () => {
      if (pickNoticeTimerRef.current) window.clearTimeout(pickNoticeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!visiblePickCutoffWeek) return
    setMyDraftPicks((prev) => filterPickRecordThroughWeek(prev, visiblePickCutoffWeek))
    setMyFinalPicks((prev) => filterPickRecordThroughWeek(prev, visiblePickCutoffWeek))
  }, [visiblePickCutoffWeek])

  /** ---------- Selected week games + fixed lock ---------- */
  useEffect(() => {
    const loadWeekGames = async (week: number) => {
      if (!pool?.id) return
      setGamesLoading(true)
      const { data, error } = await supabase.rpc('pool_week_games', {
        p_pool_id: pool.id,
        p_week: week,
      })
      let games = (data || []) as Game[]

      if (!pool.test_mode && !error) {
        const season = pool.season ?? games[0]?.season ?? new Date().getFullYear()
        const { data: confirmations, error: confirmationError } = await supabase
          .from('nfl_games')
          .select('id, kickoff_confirmed')
          .eq('season', season)
          .eq('week', week)
        if (!confirmationError) {
          const confirmedById = new Map((confirmations || []).map((game) => [game.id, game.kickoff_confirmed]))
          games = games.map((game) => ({ ...game, kickoff_confirmed: confirmedById.get(game.id) ?? true }))
        }
      }

      if (!error) setWeekGames(games)
      setGamesLoading(false)

      if (pool?.deadline_mode === 'fixed') {
        const t24 = normalizeTimeTo24h(pool.deadline_fixed) || '13:00'
        const season = pool?.season ?? games[0]?.season ?? new Date().getFullYear()
        const { data: sw } = await supabase
          .from('season_weeks')
          .select('season, week, week_sunday_date')
          .eq('season', season)
          .eq('week', week)
          .maybeSingle<SeasonWeek>()

        if (sw?.week_sunday_date) {
          setFixedLockUtc(etLocalToUtcISO(sw.week_sunday_date, t24))
        } else {
          setFixedLockUtc(null)
        }
      } else {
        setFixedLockUtc(null)
      }
    }

    const targetWeek = teamPickerTarget?.week ?? (activeTab === 'picks' ? selectedPickWeek : null)
    if (pool && targetWeek) loadWeekGames(targetWeek)
  }, [teamPickerTarget, activeTab, selectedPickWeek, pool])

  /** ---------- Standings loader ---------- */
  const loadStandings = async (week: number, poolId?: string, poolStartWeek = pool?.start_week ?? 1) => {
    const pid = poolId ?? selectedId
    if (!pid) return
    setStandingsLoading(true)
    try {
      if (membersLoadedFor !== pid) {
        await loadMembers(pid)
      }

      const [snapshotResult, winnerResult] = await Promise.all([
        supabase.rpc('pool_standings_snapshot', { p_pool_id: pid, p_week: week }),
        supabase.rpc('pool_winner_status', { p_pool_id: pid }),
        loadMyPicks(pid, poolStartWeek),
      ])
      const { data: snapshotRows, error: snapshotErr } = snapshotResult
      if (snapshotErr) throw snapshotErr
      if (winnerResult.error) throw winnerResult.error

      const snapshot = ((snapshotRows || []) as unknown as StandingsSnapshot[])[0]
      const winner = (((winnerResult.data || []) as PoolWinnerStatus[])[0] || null) as PoolWinnerStatus | null
      const weekGames = (snapshot?.games || []) as Game[]
      const stats = (snapshot?.stats || []) as MemberStats[]
      const visibleRows = (snapshot?.visible_picks || []) as PickRow[]
      const historyRows = (snapshot?.history_picks || []) as PickRow[]
      const completion = snapshot?.completion || null
      const map: Record<string, MemberStats> = {}
      for (const s of stats) map[s.entry_id] = s
      setStandingsGamesForWeek(weekGames)
      setStatsByUser(map)
      setPicksThisWeek(visibleRows)
      setStandingsHistoryPicks(historyRows)
      setStandingsPickCompletion(completion)
      setPoolWinner(winner)
      setStandingsPicksVisible(visibleRows.length > 0)
      setStandingsResultsVisible(visibleRows.some((pick) => !!pick.result))

    } catch (e: unknown) {
      void logAppEvent({ eventType: 'pool_results_refresh_failed', error: e, poolId: pid })
      console.warn('Failed to refresh finalized picks or standings results', e)
    } finally {
      setStandingsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen && selectedId && activeTab === 'members' && membersLoadedFor !== selectedId) {
      loadMembers(selectedId).catch((e) => setDetailError(getErrorMessage(e, 'Failed to load members.')))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedId, activeTab, membersLoadedFor])

  useEffect(() => {
    if (isOpen && selectedId && activeTab === 'standings') loadStandings(standingsWeek)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedId, activeTab, standingsWeek, members.length])

  useEffect(() => {
    const refreshKey = `${selectedId}:${selectedEntryId}`
    if (!isOpen || detailsLoading || !selectedId || !pool || !userId || !selectedEntryId || backgroundRefreshRef.current === refreshKey) return
    backgroundRefreshRef.current = refreshKey

    const refreshLockedPicks = async () => {
      try {
        await restoreUnlockedPicks(selectedId)
        await loadMyPicks(selectedId, pool.start_week, selectedEntryId)

        const { data: myStat } = await supabase
          .from('pool_member_stats')
          .select('pool_id, user_id, entry_id, wins, losses, pushes, strikes_used, eliminated, eliminated_week')
          .eq('pool_id', selectedId)
          .eq('entry_id', selectedEntryId)
          .maybeSingle<MemberStats>()
        setStatsByUser((prev) => (myStat ? { ...prev, [myStat.entry_id]: myStat } : prev))
        await loadPoolWinner(selectedId)
      } catch (e) {
        void logAppEvent({ eventType: 'background_pick_refresh_failed', error: e, poolId: selectedId })
        console.warn('Background pick refresh failed', e)
      }
    }

    refreshLockedPicks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, detailsLoading, selectedId, pool, userId, selectedEntryId])

  /** ---------- Draft save / clear ---------- */
  const saveDraft = async (week: number, slot: number, team: Team | null) => {
    if (!selectedId || !userId || !selectedEntryId) return false
    if (pool && week < pool.start_week) {
      showMessage('Pool has not started', `This pool starts in Week ${pool.start_week}.`, 'warning')
      return false
    }
    if (pool?.test_mode && week < (pool.test_current_week || pool.start_week || 1)) {
      showMessage('Week locked', `Week ${week} is already locked in this test pool.`, 'warning')
      return false
    }
    if (isEliminated) {
      showMessage('Picks are closed for this entry', 'You are eliminated, so you can view matchups but cannot make more picks.', 'warning')
      return false
    }
    if (poolDecided) {
      showMessage('Pool complete', 'This pool already has a winner, so no more picks are needed.', 'info')
      return false
    }
    const key = pickKey(week, slot)
    if (myFinalPicks[key]) {
      showMessage('Pick locked', `Week ${week}, Pick ${slot} is locked and can no longer be changed.`, 'warning')
      return false
    }
    setSavingPickKeys((prev) => ({ ...prev, [key]: true }))
    try {
      if (team) {
        const { error } = await supabase.rpc('save_entry_draft_pick', {
          p_pool_id: selectedId,
          p_entry_id: selectedEntryId,
          p_week: week,
          p_slot: slot,
          p_team_abbr: team.abbr,
        })
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('clear_entry_draft_pick', {
          p_pool_id: selectedId,
          p_entry_id: selectedEntryId,
          p_week: week,
          p_slot: slot,
        })
        if (error) throw error
      }
      setDraftSavedAt(new Date().toISOString())
      await refreshPoolPickStatus()
      return true
    } catch (e: unknown) {
      const message = getErrorMessage(e, 'Failed to save pick')
      void logAppEvent({
        eventType: 'pick_save_failed',
        error: e,
        poolId: selectedId,
        metadata: { week, slot, team_abbr: team?.abbr || null, entry_id: selectedEntryId },
      })
      if (team && message.toLowerCase().includes('already selected for week')) {
        await loadMyPicks(selectedId, pool?.start_week ?? 1)
        setDraftSavedAt(new Date().toISOString())
        await refreshPoolPickStatus()
        return true
      }
      showMessage('Pick not saved', message, 'danger')
      return false
    } finally {
      setSavingPickKeys((prev) => ({ ...prev, [key]: false }))
    }
  }

  const commitPickTeam = async (week: number, slot: number, team: Team, previousPick: Team | null) => {
    const key = pickKey(week, slot)
    setMyDraftPicks((prev) => ({ ...prev, [key]: team }))
    setTeamPickerTarget(null)
    const saved = await saveDraft(week, slot, team)
    if (saved) {
      void trackConversion('conversion.pick_saved', { week, slot, entry_id: selectedEntryId }, selectedId)
      showPickNotice({ team, week, slot, action: 'saved' })
    } else {
      setMyDraftPicks((prev) => ({ ...prev, [key]: previousPick }))
    }
  }

  const onPickTeam = async (week: number, slot: number, team: Team) => {
    const key = pickKey(week, slot)
    if (pool?.test_mode && week < (pool.test_current_week || pool.start_week || 1)) {
      showMessage('Week locked', `Week ${week} is already locked in this test pool.`, 'warning')
      return
    }
    if (poolDecided) {
      showMessage('Pool complete', 'This pool already has a winner, so no more picks are needed.', 'info')
      return
    }
    if (myFinalPicks[key]) {
      showMessage('Pick locked', `Week ${week}, Pick ${slot} is locked and can no longer be changed.`, 'warning')
      return
    }
    if (teamPickerTarget?.week === week) {
      const game = weekGames.find((g) => toAbbr(g.home_team) === team.abbr || toAbbr(g.away_team) === team.abbr)
      if (game) {
        if (game.kickoff_confirmed === false) {
          showMessage('Kickoff time not confirmed', `${team.name} will become available after the NFL publishes its official Week ${week} kickoff time.`, 'warning')
          return
        }
        const kickoffMs = Date.parse(game.kickoff_at_utc || game.game_time)
        const fixedMs = pool?.deadline_mode === 'fixed' && fixedLockUtc ? Date.parse(fixedLockUtc) : Infinity
        const lockMs = Math.min(kickoffMs, fixedMs)
        if (effectiveNowMs >= lockMs) {
          showMessage('Team locked', `${team.name} is locked for Week ${week}.`, 'warning')
          return
        }
      }
    }
    const alreadyUsedElsewhere =
      Object.entries(myDraftPicks).some(([k, t]) =>
        k !== key && t?.abbr === team.abbr && (Number(k.split(':')[0]) <= 18) === (week <= 18)) ||
      Object.entries(myFinalPicks).some(([k, pick]) =>
        k !== key && pick.team_abbr === team.abbr && (Number(k.split(':')[0]) <= 18) === (week <= 18))
    if (alreadyUsedElsewhere) {
      showMessage('Team already used', `${team.name} was already used in another week.`, 'warning')
      return
    }
    const previousPick = myDraftPicks[key] ?? null
    if (previousPick && previousPick.abbr !== team.abbr) {
      setTeamPickerTarget(null)
      confirmAction({
        title: 'Change pick?',
        message: `Change your ${weekLabel(week)} pick from ${previousPick.name} (${previousPick.abbr}) to ${team.name} (${team.abbr})?`,
        tone: 'warning',
        confirmLabel: 'Yes, change pick',
        cancelLabel: 'No',
        onConfirm: () => commitPickTeam(week, slot, team, previousPick),
      })
      return
    }
    await commitPickTeam(week, slot, team, previousPick)
  }

  const clearPick = async (week: number, slot: number) => {
    const key = pickKey(week, slot)
    if (myFinalPicks[key]) {
      showMessage('Pick locked', `Week ${week}, Pick ${slot} is locked and can no longer be changed.`, 'warning')
      return
    }
    const previousPick = myDraftPicks[key] ?? null
    setMyDraftPicks((prev) => ({ ...prev, [key]: null }))
    const saved = await saveDraft(week, slot, null)
    if (saved) {
      showPickNotice({ team: previousPick || { abbr: 'NFL', name: 'Pick' }, week, slot, action: 'cleared' })
    } else {
      setMyDraftPicks((prev) => ({ ...prev, [key]: previousPick }))
    }
  }

  const clearAllPicks = async () => {
    if (!selectedId || !userId || !selectedEntryId) return
    if (isEliminated) {
      showMessage('Picks are closed for this entry', 'You are eliminated, so you can view matchups but cannot make more picks.', 'warning')
      return
    }
    if (poolDecided) {
      showMessage('Pool complete', 'This pool already has a winner, so no more picks are needed.', 'info')
      return
    }
    const editableDrafts = Object.entries(myDraftPicks)
      .map(([key, team]) => {
        const [weekRaw, slotRaw] = key.split(':').map(Number)
        return { key, week: weekRaw, slot: slotRaw || 1, team }
      })
      .filter(({ key, week, team }) => {
        if (!team || !Number.isFinite(week)) return false
        if (myFinalPicks[key]) return false
        if (pool?.test_mode && week < (pool.test_current_week || pool.start_week || 1)) return false
        return week >= (pool?.start_week ?? 1)
      })

    if (editableDrafts.length === 0) {
      showMessage('No editable picks to clear', 'Locked picks stay in place, and there are no saved, editable picks to clear.', 'info')
      return
    }

    confirmAction({
      title: 'Clear all editable picks?',
      message: `This will remove ${editableDrafts.length} editable ${editableDrafts.length === 1 ? 'pick' : 'picks'} for this entry. Locked picks will not be changed.`,
      tone: 'danger',
      confirmLabel: 'Clear picks',
      onConfirm: async () => {
        const previousDrafts = { ...myDraftPicks }
        setMyDraftPicks((prev) => {
          const next = { ...prev }
          editableDrafts.forEach(({ key }) => {
            next[key] = null
          })
          return next
        })
        try {
          const results = await Promise.all(
            editableDrafts.map(({ week, slot }) =>
              supabase.rpc('clear_entry_draft_pick', {
                p_pool_id: selectedId,
                p_entry_id: selectedEntryId,
                p_week: week,
                p_slot: slot,
              }),
            ),
          )
          const firstError = results.find((result) => result.error)?.error
          if (firstError) throw firstError
          setDraftSavedAt(new Date().toISOString())
          await refreshPoolPickStatus()
          showPickNotice({ action: 'all-cleared', count: editableDrafts.length })
        } catch (e: unknown) {
          setMyDraftPicks(previousDrafts)
          void logAppEvent({ eventType: 'pick_clear_failed', error: e, poolId: selectedId, metadata: { selected_week: selectedPickWeek, entry_id: selectedEntryId } })
          showMessage('Picks not cleared', getErrorMessage(e, 'Failed to clear picks'), 'danger')
        }
      },
    })
  }

  const selectEntry = async (entryId: string) => {
    if (!selectedId || !pool || entryId === selectedEntryId) return
    setSelectedEntryId(entryId)
    window.localStorage.setItem(selectedEntryStorageKey(selectedId), entryId)
    setMyDraftPicks({})
    setMyFinalPicks({})
    setDraftSavedAt(null)
    setTeamPickerTarget(null)
    setTeamSearch('')
    backgroundRefreshRef.current = null
    await loadMyPicks(selectedId, pool.start_week, entryId)

    const { data: myStat } = await supabase
      .from('pool_member_stats')
      .select('pool_id, user_id, entry_id, wins, losses, pushes, strikes_used, eliminated, eliminated_week')
      .eq('pool_id', selectedId)
      .eq('entry_id', entryId)
      .maybeSingle<MemberStats>()
    setStatsByUser((prev) => (myStat ? { ...prev, [myStat.entry_id]: myStat } : prev))
  }

  const addEntry = async () => {
    if (!selectedId || !pool) return
    const nextEntryNumber = Math.max(0, ...myEntries.map((entry) => entry.entry_number ?? 1)) + 1
    const entryLimit = pool.max_entries_per_user ?? 1
    confirmAction({
      title: 'Add another entry?',
      message: `Add Entry ${nextEntryNumber} to ${pool.name}? Each entry gets its own picks and can be eliminated separately. You can have up to ${entryLimit} ${entryLimit === 1 ? 'entry' : 'entries'} in this pool.`,
      confirmLabel: 'Add entry',
      onConfirm: async () => {
        setAddingEntry(true)
        try {
          const { data, error } = await supabase.rpc('add_pool_entry', { p_pool_id: selectedId })
          if (error) throw error
          const roster = await loadMembers(selectedId)
          const newEntryId = typeof data === 'string' ? data : roster.filter((m) => m.profile_id === userId).at(-1)?.id
          if (newEntryId) await selectEntry(newEntryId)
          setMemberCount(roster.length)
          await refreshPoolPickStatus(pool, roster.filter((member) => member.profile_id === userId))
        } catch (e: unknown) {
          void logAppEvent({ eventType: 'pool_add_entry_failed', error: e, poolId: pool.id })
          showMessage('Entry not added', getErrorMessage(e, 'Failed to add entry.'), 'danger')
        } finally {
          setAddingEntry(false)
        }
      },
    })
  }

  const removeSelectedEntry = async () => {
    if (!selectedId || !pool || !selectedEntryId || myEntries.length <= 1) return
    const selectedEntry = myEntries.find((entry) => entry.id === selectedEntryId)
    const label = selectedEntry ? entryLabelForMember(selectedEntry) : 'this entry'
    confirmAction({
      title: 'Remove this entry?',
      message: `Remove ${label} from ${pool.name}? This deletes only this entry and its picks. Your other entries stay in the pool.`,
      tone: 'danger',
      confirmLabel: 'Remove entry',
      onConfirm: async () => {
        setAddingEntry(true)
        try {
          const { error } = await supabase.rpc('remove_pool_entry', { p_pool_id: selectedId, p_entry_id: selectedEntryId })
          if (error) throw error
          const roster = await loadMembers(selectedId)
          const remaining = roster.filter((member) => member.profile_id === userId)
          const nextEntryId = remaining[0]?.id ?? null
          setSelectedEntryId(nextEntryId)
          if (nextEntryId) {
            window.localStorage.setItem(selectedEntryStorageKey(selectedId), nextEntryId)
            await loadMyPicks(selectedId, pool.start_week, nextEntryId)
            const { data: nextStat } = await supabase
              .from('pool_member_stats')
              .select('pool_id, user_id, entry_id, wins, losses, pushes, strikes_used, eliminated, eliminated_week')
              .eq('pool_id', selectedId)
              .eq('entry_id', nextEntryId)
              .maybeSingle<MemberStats>()
            setStatsByUser(nextStat ? { [nextStat.entry_id]: nextStat } : {})
          }
          await refreshPoolPickStatus(pool, remaining)
        } catch (e: unknown) {
          void logAppEvent({ eventType: 'pool_remove_entry_failed', error: e, poolId: pool.id, metadata: { entry_id: selectedEntryId } })
          showMessage('Entry not removed', getErrorMessage(e, 'Failed to remove entry.'), 'danger')
        } finally {
          setAddingEntry(false)
        }
      },
    })
  }

  const leavePool = async () => {
    if (!selectedId || !pool) return
    if (amOwner) {
      showMessage('Pool creator cannot leave', 'Pool creators cannot leave their own pool. You can archive it from the admin panel before it starts.', 'warning')
      return
    }
    if (leagueHasStarted) {
      showMessage('Pool has started', 'You cannot leave this pool after it has started.', 'warning')
      return
    }
    confirmAction({
      title: 'Leave this pool?',
      message: `Leave ${pool.name}? This removes all of your entries and picks from this pool.`,
      tone: 'danger',
      confirmLabel: 'Leave pool',
      onConfirm: async () => {
        setLeavingPool(true)
        try {
          const { error } = await supabase.rpc('leave_pool', { p_pool_id: pool.id })
          if (error) throw error
          setPools((prev) => prev.filter((p) => p.id !== pool.id))
          closeModal()
        } catch (e: unknown) {
          void logAppEvent({ eventType: 'pool_leave_failed', error: e, poolId: pool.id })
          showMessage('Could not leave pool', getErrorMessage(e, 'Failed to leave pool.'), 'danger')
        } finally {
          setLeavingPool(false)
        }
      },
    })
  }

  /** ---------- Export ---------- */
  const exportCsv = () => {
    if (!pool) return
    const rows = [['Week', 'Pick', 'Team', 'Abbr', 'Status']]
    availableWeeks.forEach((w) => {
      for (let slot = 1; slot <= picksAllowedForWeek(w); slot += 1) {
        const key = pickKey(w, slot)
        const finalPick = myFinalPicks[key]
        const draftPick = myDraftPicks[key]
        const finalTeam = finalPick ? teamByAbbr(finalPick.team_abbr) || { abbr: finalPick.team_abbr, name: finalPick.team_abbr } : null
        const team = finalTeam || draftPick
        rows.push([String(w), String(slot), team?.name ?? '', team?.abbr ?? '', finalPick ? 'Locked — official' : draftPick ? 'Saved — editable' : ''])
      }
    })
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pool.name.replace(/\s+/g, '_')}_picks.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /** ---------- Derived ---------- */
  const usedTeamAbbrs = useMemo(() => {
    const draftTeams = Object.values(myDraftPicks).filter(Boolean).map((t) => (t as Team).abbr)
    const finalTeams = Object.values(myFinalPicks).map((p) => p.team_abbr)
    return Array.from(new Set([...draftTeams, ...finalTeams]))
  }, [myDraftPicks, myFinalPicks])
  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase()
    if (!q) return NFL_TEAMS
    return NFL_TEAMS.filter((t) => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q))
  }, [teamSearch])
  const standingsStatsByEntry = useMemo(() => {
    if (!leagueHasStarted) return {} as Record<string, MemberStats>
    return statsByUser
  }, [leagueHasStarted, statsByUser])
  const strikesAllowed = Number(pool?.strikes_allowed ?? 0)
  const standingsTableWeeks = useMemo(
    () => availableWeeks.filter((week) => week <= standingsWeek && (!poolWinner?.decided_week || week <= poolWinner.decided_week)),
    [availableWeeks, poolWinner?.decided_week, standingsWeek],
  )
  const picksByEntryWeek = useMemo(() => {
    const map = new Map<string, PickRow[]>()
    for (const pick of standingsHistoryPicks) {
      const key = `${pick.entry_id}:${pick.week}`
      const rows = map.get(key) || []
      rows.push(pick)
      map.set(key, rows)
    }
    map.forEach((rows) => rows.sort((a, b) => a.slot - b.slot))
    return map
  }, [standingsHistoryPicks])
  const standingsRows = useMemo(() => {
    return members
      .map((member) => {
        const stats =
          standingsStatsByEntry[member.id] ||
          ({
            pool_id: pool?.id || '',
            user_id: member.profile_id || '',
            entry_id: member.id,
            wins: 0,
            losses: 0,
            pushes: 0,
            strikes_used: 0,
            eliminated: false,
            eliminated_week: null,
            survival_graces: [],
          } as MemberStats)
        const entryPicksThroughWeek = standingsHistoryPicks.filter((pick) => pick.entry_id === member.id && pick.week <= standingsWeek)
        const survivalCredits = survivalCreditsThroughWeek(stats.survival_graces, standingsWeek)
        const progress = entryProgress(entryPicksThroughWeek.map((pick) => pick.result), strikesAllowed + survivalCredits, pool?.tie_rule || 'loss')
        const strikesUsedThroughWeek = progress.strikesUsed
        const winsThroughWeek = entryPicksThroughWeek.filter((pick) => pick.result === 'win').length
        const lossesThroughWeek = entryPicksThroughWeek.filter((pick) => pick.result === 'loss').length
        const aliveThroughWeek = progress.alive
        const strikesLeft = progress.strikesLeft
        return {
          member,
          stats,
          name: entryLabelForMember(member),
          alive: aliveThroughWeek,
          strikesLeft,
          strikesUsed: strikesUsedThroughWeek,
          wins: winsThroughWeek,
          losses: lossesThroughWeek,
        }
      })
      .sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1
        if (a.strikesLeft !== b.strikesLeft) return b.strikesLeft - a.strikesLeft
        if (a.wins !== b.wins) return b.wins - a.wins
        if (a.losses !== b.losses) return a.losses - b.losses
        return a.name.localeCompare(b.name)
      })
  }, [members, pool?.id, pool?.tie_rule, standingsHistoryPicks, standingsStatsByEntry, standingsWeek, strikesAllowed])
  const activeEntryCount = useMemo(
    () => standingsRows.filter((row) => row.alive).length,
    [standingsRows],
  )
  const standingsEntryCount = standingsRows.length
  const survivalByWeek = useMemo(() => {
    const survival = new Map<number, number>()
    const strikesByEntry = new Map(members.map((member) => [member.id, 0]))

    for (const week of standingsTableWeeks) {
      const weekPicks = standingsHistoryPicks.filter((pick) => pick.week === week)
      for (const member of members) {
        const entryPicks = weekPicks.filter((pick) => pick.entry_id === member.id)
        const strikes = entryPicks.filter((pick) => pick.result === 'loss' || (pick.result === 'push' && pool?.tie_rule === 'loss')).length
        strikesByEntry.set(member.id, (strikesByEntry.get(member.id) || 0) + strikes)
      }
      const alive = members.filter((member) => {
        const strikes = strikesByEntry.get(member.id) || 0
        const credits = survivalCreditsThroughWeek(standingsStatsByEntry[member.id]?.survival_graces, week)
        return strikes <= strikesAllowed + credits
      }).length
      survival.set(week, alive)
    }

    return survival
  }, [members, pool?.tie_rule, standingsHistoryPicks, standingsStatsByEntry, standingsTableWeeks, strikesAllowed])
  const visiblePicksThisWeek = useMemo(
    () => picksThisWeek,
    [picksThisWeek],
  )
  const testResultByTeam = useMemo(() => {
    const resultMap = new Map<string, 'win' | 'loss' | 'push' | 'pending'>()
    if (!isTestMode || !standingsResultsVisible) return resultMap

    const grouped = new Map<string, PickRow[]>()
    for (const pick of visiblePicksThisWeek) {
      if (isNoPick(pick.team_abbr)) continue
      const abbr = toAbbr(pick.team_abbr)
      const rows = grouped.get(abbr) || []
      rows.push(pick)
      grouped.set(abbr, rows)
    }

    grouped.forEach((rows, abbr) => {
      const results = rows.map((pick) => pick.result).filter(Boolean)
      if (results.length !== rows.length || results.length === 0) {
        resultMap.set(abbr, 'pending')
        return
      }
      if (results.every((result) => result === 'win')) resultMap.set(abbr, 'win')
      else if (results.every((result) => result === 'loss')) resultMap.set(abbr, 'loss')
      else if (results.every((result) => result === 'push')) resultMap.set(abbr, 'push')
      else resultMap.set(abbr, 'pending')
    })

    return resultMap
  }, [isTestMode, standingsResultsVisible, visiblePicksThisWeek])
  const teamExposure = useMemo(() => {
    const counts = new Map<string, number>()
    for (const pick of visiblePicksThisWeek) {
      if (isNoPick(pick.team_abbr)) continue
      counts.set(pick.team_abbr, (counts.get(pick.team_abbr) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([abbr, count]) => ({ team: teamByAbbr(toAbbr(abbr)) || { abbr, name: abbr }, count }))
      .sort((a, b) => b.count - a.count || a.team.abbr.localeCompare(b.team.abbr))
  }, [visiblePicksThisWeek])
  const topExposedTeam = teamExposure[0] || null
  const teamPickChartRows = useMemo(() => {
    const counts = new Map<string, number>()
    for (const pick of visiblePicksThisWeek) {
      if (isNoPick(pick.team_abbr)) continue
      const abbr = toAbbr(pick.team_abbr)
      counts.set(abbr, (counts.get(abbr) || 0) + 1)
    }
    const denominator = Math.max(Array.from(counts.values()).reduce((total, count) => total + count, 0), 1)
    return NFL_TEAMS.map((team) => {
      const count = counts.get(team.abbr) || 0
      const percentage = Math.round((count / denominator) * 100)
      const game = standingsGamesForWeek.find((g) => [toAbbr(g.home_team), toAbbr(g.away_team)].includes(team.abbr))
      const isFinal = game?.status === 'final'
      const result = testResultByTeam.get(team.abbr) || (isFinal ? (toAbbr(game?.winner || '') === team.abbr ? 'win' : 'loss') : 'pending')
      return { team, count, percentage, result }
    })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count || a.team.abbr.localeCompare(b.team.abbr))
  }, [standingsGamesForWeek, testResultByTeam, visiblePicksThisWeek])
  const leagueAvailableTeams = useMemo(() => {
    const usedByEntry = new Map<string, Set<string>>()
    for (const pick of standingsHistoryPicks) {
      if (isNoPick(pick.team_abbr)) continue
      const entryUsed = usedByEntry.get(pick.entry_id) || new Set<string>()
      entryUsed.add(toAbbr(pick.team_abbr))
      usedByEntry.set(pick.entry_id, entryUsed)
    }
    const aliveRows = standingsRows.filter((row) => row.alive)
    const denominator = Math.max(aliveRows.length, 1)
    return NFL_TEAMS.map((team) => {
      const available = aliveRows.filter(({ member }) => !usedByEntry.get(member.id)?.has(team.abbr)).length
      const used = aliveRows.length - available
      return {
        team,
        available,
        used,
        percentage: Math.round((available / denominator) * 100),
      }
    }).sort((a, b) => b.available - a.available || a.team.abbr.localeCompare(b.team.abbr))
  }, [standingsHistoryPicks, standingsRows])
  const memberRowsForTab = useMemo(() => {
    const grouped = new Map<string, { member: Profile; entries: Profile[] }>()
    for (const member of members) {
      const key = member.profile_id || member.id
      const current = grouped.get(key)
      if (current) {
        current.entries.push(member)
      } else {
        grouped.set(key, { member, entries: [member] })
      }
    }

    return Array.from(grouped.values())
      .map(({ member, entries }) => {
        const sortedEntries = [...entries].sort((a, b) => (a.entry_number || 1) - (b.entry_number || 1))
        const adminEntry = sortedEntries.find((entry) => entry.role === 'admin')
        return {
          member: adminEntry || sortedEntries[0] || member,
          name: displayNameForMember(adminEntry || sortedEntries[0] || member),
          entryCount: sortedEntries.length,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [members])
  /** ---------- OWNER CHECK ---------- */
  const amOwner = useMemo(() => !!pool && !!userId && pool.created_by === userId, [pool, userId])

  /** ---------- Open / close modal ---------- */
  const openPool = async (id: string) => {
    if (!userId) return
    setSelectedId(id)
    setIsOpen(true)
    setActiveTab('picks')
    setDetailsLoading(true)
    setDetailError(null)

    // reset per-open state
    setPool(null)
    setMembers([])
    setMembersLoadedFor(null)
    setMemberCount(0)
    setMyEntries([])
    setSelectedEntryId(null)
    setMyDraftPicks({})
    setMyFinalPicks({})
    setDraftSavedAt(null)
    setTeamPickerTarget(null)
    setTeamSearch('')
    setWeekGames([])
    setPoolStartAt(null)
    setCanManagePool(false)
    setSelectedPickWeek(1)
    setGamesLoading(false)
    setFixedLockUtc(null)
    setStandingsWeek(1)
    setPicksThisWeek([])
    setStandingsHistoryPicks([])
    setStandingsPickCompletion(null)
    setStandingsPicksVisible(false)
    setStandingsResultsVisible(false)
    setStatsByUser({})
    setPoolWinner(null)
    backgroundRefreshRef.current = null

    try {
      const { data: poolRow, error: poolErr } = await supabase.from('pools').select(POOL_DETAIL_SELECT).eq('id', id).maybeSingle<Pool>()
      if (poolErr) throw poolErr
      if (!poolRow) throw new Error('Pool not found')

      setPool(poolRow)
      setStandingsWeek(poolRow.start_week)
      const roster = await loadMembers(id)
      const entries = roster.filter((m) => m.profile_id === userId)
      const storedEntryId = window.localStorage.getItem(selectedEntryStorageKey(id))
      const nextEntryId = entries.find((entry) => entry.id === storedEntryId)?.id ?? entries[0]?.id ?? null
      setSelectedEntryId(nextEntryId)
      if (nextEntryId) window.localStorage.setItem(selectedEntryStorageKey(id), nextEntryId)

      const season = poolRow.season ?? new Date().getFullYear()
      const [{ data: weekRows }, { data: firstStartGame }, { data: myStat }, { data: canManage }, winnerResult] = await Promise.all([
        supabase
          .from('season_weeks')
          .select('season, week, week_sunday_date')
          .eq('season', season)
          .order('week', { ascending: true }),
        supabase
          .from('nfl_games')
          .select('game_time,kickoff_at_utc')
          .eq('season', season)
          .eq('week', poolRow.start_week)
          .order('kickoff_at_utc', { ascending: true, nullsFirst: false })
          .order('game_time', { ascending: true })
          .limit(1)
          .maybeSingle<{ game_time: string; kickoff_at_utc: string | null }>(),
        nextEntryId
          ? supabase.from('pool_member_stats').select('pool_id, user_id, entry_id, wins, losses, pushes, strikes_used, eliminated, eliminated_week').eq('pool_id', id).eq('entry_id', nextEntryId).maybeSingle<MemberStats>()
          : Promise.resolve({ data: null }),
        supabase.rpc('admin_can_manage', { p_pool_id: id }),
        supabase.rpc('pool_winner_status', { p_pool_id: id }),
      ])
      setCanManagePool(!!canManage)
      if (winnerResult.error) throw winnerResult.error
      const winner = (((winnerResult.data || []) as PoolWinnerStatus[])[0] || null) as PoolWinnerStatus | null
      setPoolWinner(winner)

      const nextMaxWeek = maxWeekForPool(poolRow)
      const nextSeasonWeeks = ((weekRows || []) as SeasonWeek[]).filter((row) => row.week >= 1 && row.week <= nextMaxWeek)
      const currentWeek = currentWeekForPool(poolRow, nextSeasonWeeks)
      setSelectedPickWeek(currentWeek)
      setStandingsWeek(currentWeek)

      const startWeekFallback = nextSeasonWeeks.find((row) => row.week === poolRow.start_week)?.week_sunday_date
      setPoolStartAt(firstStartGame?.kickoff_at_utc || firstStartGame?.game_time || (startWeekFallback ? `${startWeekFallback}T00:00:00` : null))

      setMemberCount(roster.length)
      setStatsByUser(myStat ? { [myStat.entry_id]: myStat } : {})
      if (nextEntryId) await loadMyPicks(id, poolRow.start_week, nextEntryId)
    } catch (e: unknown) {
      void logAppEvent({ eventType: 'pool_details_load_failed', error: e, poolId: id })
      setDetailError(getErrorMessage(e, 'Failed to load pool details.'))
    } finally {
      setDetailsLoading(false)
    }
  }

  const closeModal = () => {
    setIsOpen(false)
    setSelectedId(null)
    setPool(null)
    setInviteOpen(false)
    setPoolStartAt(null)
    setCanManagePool(false)
    setPoolWinner(null)
    setDetailError(null)
    setLeavingPool(false)
  }

  useEffect(() => {
    if (loading || !requestedPoolId) return
    if (openedPoolParamRef.current === requestedPoolId) return
    if (!pools.some((p) => p.id === requestedPoolId)) return

    openedPoolParamRef.current = requestedPoolId
    openPool(requestedPoolId)
    // openPool is intentionally omitted so a query param opens once after pool data loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, requestedPoolId, pools])

  /** ---------------- UI ---------------- */
  return (
    <main className="min-h-[60vh] px-4 py-6 sm:px-8 lg:px-16 xl:px-24">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Dashboard</p>
          <h1 className="text-2xl font-bold text-slate-950">My Pools</h1>
        </div>

        {/*  NEW: Archived button + Create Pool button */}
        <div className="flex items-center gap-2">
          <Link href="/profile" className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium hover:bg-slate-200">
            History
          </Link>
          <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
            Create Pool
          </Link>
        </div>
      </div>

      {loading && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading your pools...</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      {!loading && !error && pools.length === 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Start here</p>
          <h2 className="mt-1 text-2xl font-bold text-slate-950">No pools yet</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Create a pool for your group, search public pools, or use an invite link from a commissioner. Once you join, your picks and standings will show here.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
              Create Pool
            </Link>
            <Link href="/join/search" className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              Find a Pool
            </Link>
          </div>
        </section>
      )}

      {!loading && !error && pools.length > 0 && (
        <>
          <details className="mb-5 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            <summary className="cursor-pointer font-semibold text-slate-950">How to read your dashboard</summary>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div><span className="font-semibold text-slate-950">Pick status:</span> red means you still owe picks for the current week, green means your required picks are in.</div>
              <div><span className="font-semibold text-slate-950">Multiple entries:</span> shows whether a pool lets one person play more than one entry.</div>
              <div><span className="font-semibold text-slate-950">Entries:</span> each entry is one independent chance to play, so the entry count can be higher than the number of people.</div>
            </div>
          </details>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pools.map((p) => {
              const memberSummary = poolMemberSummaries[p.id]
              const pickStatus = poolPickStatuses[p.id]
              const poolComplete = poolDecidedFromSummary(memberSummary)
              const entryAliveLabel =
                memberSummary && memberSummary.totalEntries > 0
                  ? `${memberSummary.aliveEntries}/${memberSummary.totalEntries} alive entries`
                  : String(poolPickStatuses[p.id]?.entries ?? 0)
              const multipleEntriesLabel = p.allow_multiple_entries ? `Up to ${p.max_entries_per_user ?? 1}` : 'No'

              return (
              <li key={p.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="h-28 bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={poolImageUrl(p)} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold leading-tight text-slate-950">{p.name}</h2>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <PoolStagePill pool={p} pickStatus={pickStatus} isDecided={poolComplete} />
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.is_public ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>
                        {p.is_public ? 'Public' : 'Private'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <InfoTile label="Starts" value={`Week ${p.start_week}`} />
                    <InfoTile label="Mulligans" value={String(p.strikes_allowed)} />
                    <InfoTile label="Multiple Entries?" value={multipleEntriesLabel} />
                    <InfoTile label="Entries" value={entryAliveLabel} />
                  </div>
                  {pickStatus && <PickStatusCard status={pickStatus} isDecided={poolComplete} />}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => openPool(p.id)} className="rounded-md bg-[#111318] px-3 py-2 text-sm font-semibold text-white hover:bg-black">
                    Open
                  </button>
                </div>
                </div>
              </li>
              )
            })}
          </ul>
          <AdSlot
            slot={process.env.NEXT_PUBLIC_AD_SLOT_SITE_INLINE}
            label="My Pools advertisement"
            className="mt-8"
            minHeight="100px"
          />
        </>
      )}

      {/* ---------- Slide-out Modal ---------- */}
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="absolute right-0 top-0 h-full w-full max-w-5xl overflow-y-auto bg-white shadow-xl">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">{pool?.name || 'Pool'}</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canInvite && (
                  <button onClick={() => setInviteOpen(true)} className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
                    Invite
                  </button>
                )}
                <button onClick={exportCsv} className="px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-black">
                  Export CSV
                </button>
                {canManagePool && pool && (
                  <Link href={`/pools/${pool.id}/admin`} className="px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700">
                    Admin Panel
                  </Link>
                )}
                {pool && !amOwner && !leagueHasStarted && (
                  <button
                    onClick={leavePool}
                    disabled={leavingPool}
                    className="px-3 py-1 rounded-md bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    {leavingPool ? 'Leaving...' : 'Leave Pool'}
                  </button>
                )}
                <button onClick={closeModal} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200">
                  Close
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-4 pt-3">
              <div className="flex items-center gap-2 border-b">
                <Tab label="Make Picks" active={activeTab === 'picks'} onClick={() => setActiveTab('picks')} />
                <Tab label="Standings" active={activeTab === 'standings'} onClick={() => setActiveTab('standings')} />
                <Tab label={`Pool Members (${uniqueMemberCount})`} active={activeTab === 'members'} onClick={() => setActiveTab('members')} />
              </div>
            </div>

            <div className="p-4">
              {detailsLoading && <p>Loading pool...</p>}
              {!detailsLoading && !pool && <p className="text-red-600">Failed to load pool.</p>}
              {!detailsLoading && pool && detailError && (
                <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{detailError}</p>
              )}

              {/* ----------- Make Picks ----------- */}
              {!detailsLoading && pool && activeTab === 'picks' && (
                <>
                  {poolDecided && poolWinner && (
                    <PoolWinnerCelebration
                      poolName={pool.name}
                      winner={poolWinner}
                      isCurrentUser={currentUserWonPool}
                      onStandings={() => setActiveTab('standings')}
                    />
                  )}

                  {!poolDecided && isEliminated && (
                    <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      You are eliminated in this pool. You can still view matchups and standings, but you cannot make more picks.
                    </div>
                  )}

                  {!poolDecided && (
                  <div className="mb-8">
                    <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">{weekLabel(selectedPickWeek)}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">{deadlineLabel}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">
                            {picksAllowedForWeek(selectedPickWeek)} {picksAllowedForWeek(selectedPickWeek) === 1 ? 'pick' : 'picks'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {myEntries.length > 1 && (
                            <label className="flex items-center gap-2 rounded-lg border border-[#c5161d] bg-[#c5161d] px-3 py-2 text-xs font-bold text-white shadow-md shadow-red-900/10">
                              Switch entry
                              <select
                                value={selectedEntryId ?? ''}
                                onChange={(event) => selectEntry(event.target.value)}
                                className="min-w-40 rounded-md border border-white/40 bg-white px-2 py-1.5 text-sm font-bold text-slate-950"
                              >
                                {myEntries.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entryLabelForMember(entry)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {pool.allow_multiple_entries && !leagueHasStarted && myEntries.length < (pool.max_entries_per_user ?? 1) && (
                            <button
                              type="button"
                              onClick={addEntry}
                              disabled={addingEntry}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {addingEntry ? 'Adding...' : 'Add another entry'}
                            </button>
                          )}
                          {!leagueHasStarted && myEntries.length > 1 && (
                            <button
                              type="button"
                              onClick={removeSelectedEntry}
                              disabled={addingEntry}
                              className="rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              Remove this entry
                            </button>
                          )}
                          {draftSavedAt && <div className="text-xs font-medium text-emerald-700">Saved {fmtDateTime(draftSavedAt)}</div>}
                        </div>
                      </div>
                      <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-slate-800">Teams this entry already used ({usedTeamAbbrs.length})</summary>
                        {usedTeamAbbrs.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-600">None yet—this entry can choose any unlocked team.</p>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {usedTeamAbbrs.map((abbr) => {
                              const team = teamByAbbr(abbr) || { abbr, name: abbr }
                              return (
                                <span key={abbr} className="inline-flex items-center gap-1.5 rounded-full border bg-white px-2 py-1 text-sm">
                                  <TeamLogo team={team} size={20} />
                                  {abbr}
                                </span>
                              )
                            })}
                          </div>
                        )}
                        <p className="mt-2 text-xs text-slate-500">A team used by this entry cannot be chosen again during the regular season. Other entries keep their own separate history.</p>
                      </details>
                    </div>

                    <div className="mb-4">
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(44px,1fr))] gap-1.5">
                        {availableWeeks.map((w) => {
                          const selected = selectedPickWeek === w
                          const required = picksAllowedForWeek(w)
                          const finalPicksForWeek = Array.from({ length: required }, (_, i) => myFinalPicks[pickKey(w, i + 1)]).filter(Boolean)
                          const hasDraft = Array.from({ length: required }, (_, i) => myDraftPicks[pickKey(w, i + 1)]).some(Boolean)
                          const hasFinal = finalPicksForWeek.length > 0
                          const hasLoss = finalPicksForWeek.some((pick) => pick?.result === 'loss')
                          const allWins = finalPicksForWeek.length === required && finalPicksForWeek.every((pick) => pick?.result === 'win')
                          return (
                            <button
                              key={`week-button-${w}`}
                              type="button"
                              onClick={() => {
                                setSelectedPickWeek(w)
                                setTeamPickerTarget(null)
                                setTeamSearch('')
                              }}
                              className={`min-h-9 rounded-md border px-1.5 py-1.5 text-xs font-semibold ${
                                selected
                                  ? 'border-slate-950 bg-slate-950 text-white'
                                  : hasLoss
                                    ? 'border-red-300 bg-red-50 text-red-700'
                                    : allWins
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : hasFinal
                                    ? 'border-slate-300 bg-slate-100 text-slate-700'
                                    : hasDraft
                                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              {shortWeekLabel(w)}
                              {required > 1 && <span className="ml-0.5 text-[9px]">x2</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    <section className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-lg font-semibold">{weekLabel(selectedPickWeek)}</h4>
                            {picksAllowedForWeek(selectedPickWeek) > 1 && (
                              <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                                Double-pick week
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            Your job: choose {picksAllowedForWeek(selectedPickWeek) === 1 ? 'one NFL team to win' : 'two different NFL teams to win'} for {selectedEntry ? entryLabelForMember(selectedEntry) : 'this entry'}. Your choice saves immediately and can be changed until it locks.
                          </p>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                          {selectedWeekCloseLabel}
                        </div>
                      </div>
                      {selectedWeekLockedByTestMode && (
                        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          {weekLabel(selectedPickWeek)} is already locked in this test pool.
                        </div>
                      )}

                      <div className={`grid gap-3 ${picksAllowedForWeek(selectedPickWeek) > 1 ? 'md:grid-cols-2' : ''}`}>
                        {Array.from({ length: picksAllowedForWeek(selectedPickWeek) }, (_, i) => i + 1).map((slot) => {
                          const key = pickKey(selectedPickWeek, slot)
                          const finalPick = myFinalPicks[key]
                          const draftPick = myDraftPicks[key]
                          const finalTeam = finalPick
                            ? isNoPick(finalPick.team_abbr)
                              ? { abbr: 'NO PICK', name: 'No pick submitted' }
                              : teamByAbbr(finalPick.team_abbr) || { abbr: finalPick.team_abbr, name: finalPick.team_abbr }
                            : null
                          const savingPick = !!savingPickKeys[key]

                          if (finalPick && finalTeam) {
                            return (
                              <div key={key} className="rounded-md border border-slate-300 bg-slate-50 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <ResultPill status={finalPick.result || 'Pending'} />
                                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">Locked — official</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <TeamLogo team={finalTeam} size={42} />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-950">{finalTeam.abbr}</div>
                                    <div className="truncate text-sm text-slate-600" title={finalTeam.name}>
                                      {finalTeam.name}
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">Locked {fmtDateTime(finalPick.locked_at)}</div>
                                  </div>
                                </div>
                              </div>
                            )
                          }

                          return (
                            <div key={key} className="rounded-md border border-red-100 bg-white p-3 shadow-sm">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                {picksAllowedForWeek(selectedPickWeek) > 1 ? <span className="text-xs font-medium text-slate-600">Pick {slot}</span> : <span />}
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    draftPick ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                  }`}
                                >
                                  {savingPick ? 'Saving...' : draftPick ? 'Saved — editable until lock' : 'Pick needed'}
                                </span>
                              </div>

                              {draftPick ? (
                                <div className="flex items-center gap-3">
                                  <TeamLogo team={draftPick} size={42} />
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-950">{draftPick.abbr}</div>
                                    <div className="truncate text-sm text-slate-600" title={draftPick.name}>
                                      {draftPick.name}
                                    </div>
                                  </div>
                                </div>
                              ) : null}

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="rounded bg-[#c5161d] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#a81218] disabled:opacity-50"
                                  onClick={() => setTeamPickerTarget({ week: selectedPickWeek, slot })}
                                  disabled={savingPick || !canMakePicks}
                                >
                                  {draftPick ? 'Change pick' : 'Choose team'}
                                </button>
                                {draftPick && (
                                  <button
                                    type="button"
                                    className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                                    title="Clear this pick"
                                    onClick={() => clearPick(selectedPickWeek, slot)}
                                    disabled={savingPick || !canMakePicks}
                                  >
                                    Clear pick
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-5">
                        <h5 className="mb-2 text-sm font-semibold">{weekLabel(selectedPickWeek)} Games</h5>
                        {gamesLoading && <p className="text-sm text-gray-600">Loading games...</p>}
                        {!gamesLoading && weekGames.length === 0 && <p className="text-sm text-gray-600">No games found for this week.</p>}
                        {!gamesLoading && weekGames.length > 0 && (
                          <div className="grid gap-2 md:grid-cols-2">
                            {weekGames.slice(0, 16).map((game) => {
                              const away = teamByAbbr(toAbbr(game.away_team)) || { abbr: toAbbr(game.away_team), name: toAbbr(game.away_team) }
                              const home = teamByAbbr(toAbbr(game.home_team)) || { abbr: toAbbr(game.home_team), name: toAbbr(game.home_team) }
                              return (
                                <div key={game.id} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                  <div className="text-xs text-gray-500">{fmtDateTime(game.kickoff_at_utc || game.game_time)}</div>
                                  <div className="mt-2 flex items-center gap-3 font-medium">
                                    <span className="inline-flex items-center gap-1.5">
                                      <TeamLogo team={away} size={26} />
                                      {away.abbr}
                                    </span>
                                    <span className="text-sm text-slate-400">@</span>
                                    <span className="inline-flex items-center gap-1.5">
                                      <TeamLogo team={home} size={26} />
                                      {home.abbr}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </section>

                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={clearAllPicks} disabled={!canMakePicks} className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 disabled:opacity-50">
                        Clear All Picks
                      </button>
                      <span className="text-xs text-gray-500">
                        Early games always lock at kickoff. Your pool deadline controls how long later games stay available.
                      </span>
                    </div>

                    <details className="mt-3 rounded-lg border border-gray-200 bg-white p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-slate-900">Pool rules and settings</summary>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <InfoTile label="Visibility" value={pool.is_public ? 'Public' : 'Private'} />
                        <InfoTile label="Status" value={pool.activation_status === 'cancelled' ? 'Closed' : 'Open'} />
                        <InfoTile label="Total Entries" value={poolEntryCountLabel(memberCount, pool.max_members)} />
                        <InfoTile label="Entries" value={pool.allow_multiple_entries ? `Up to ${pool.max_entries_per_user ?? 1} per user` : 'Single entry'} />
                        <InfoTile label="Start Week" value={`Week ${pool.start_week}`} />
                        <InfoTile label="Season" value={pool.include_playoffs ? 'Regular + Playoffs' : 'Regular only'} />
                        <InfoTile label="Mulligans Allowed" value={String(pool.strikes_allowed)} />
                        <InfoTile label="NFL Tie Counts As" value={pool.tie_rule === 'win' ? 'Win' : 'Loss'} />
                        <InfoTile label="Pick Deadline" value={deadlineLabel} />
                      </div>
                    </details>
                  </div>

                  )}

                  {!poolDecided && teamPickerTarget && (
                    <TeamPickerModal
                      week={teamPickerTarget.week}
                      slot={teamPickerTarget.slot}
                      onClose={() => setTeamPickerTarget(null)}
                      teamSearch={teamSearch}
                      setTeamSearch={setTeamSearch}
                      filteredTeams={filteredTeams}
                      usedTeamAbbrs={usedTeamAbbrs}
                      myDraftPicks={myDraftPicks}
                      onPickTeam={onPickTeam}
                      gamesLoading={gamesLoading}
                      weekGames={weekGames}
                      deadlineMode={pool.deadline_mode}
                      fixedLockUtc={fixedLockUtc}
                      currentTimeMs={effectiveNowMs}
                    />
                  )}
                  {pickNotice && <PickSavedToast notice={pickNotice} onClose={() => setPickNotice(null)} />}
                </>
              )}

              {/* ----------- Standings ----------- */}
              {!detailsLoading && pool && activeTab === 'standings' && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm">Show through</label>
                      <select className="border rounded-md px-2 py-1 text-sm" value={standingsWeek} onChange={(e) => setStandingsWeek(Number(e.target.value))}>
                        {availableWeeks.map((w) => (
                          <option key={w} value={w}>
                            {weekLabel(w)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => loadStandings(standingsWeek)} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
                      Refresh
                    </button>
                  </div>
                  <p className="mb-4 text-sm text-slate-600">
                    Choose a week to see the pool exactly as it stood then. Alive entries can keep picking; eliminated entries cannot. W means win, L means loss, and NP means no pick.
                  </p>

                  {poolDecided && poolWinner && (
                    <PoolWinnerCelebration
                      poolName={pool.name}
                      winner={poolWinner}
                      isCurrentUser={currentUserWonPool}
                      compact
                    />
                  )}

                  <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-slate-950">Entry Progression</h3>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{weekLabel(standingsWeek)} Picks Made</div>
                          <div className="mt-1 text-lg font-bold text-slate-950">
                            {standingsPickCompletion
                              ? `${standingsPickCompletion.made_slots}/${standingsPickCompletion.required_slots}`
                              : '-'}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            Teams stay hidden until each pick locks.
                          </div>
                        </div>
                        <SurvivalChart alive={activeEntryCount} total={standingsEntryCount} week={standingsWeek} />
                      </div>
                    </div>
                    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Standings through ${weekLabel(standingsWeek)}`}>
                      <table className="isolate w-full border-separate border-spacing-0 text-sm" style={{ minWidth: Math.max(760, 360 + standingsTableWeeks.length * 96) }}>
                        <caption className="sr-only">Pool entry progression through {weekLabel(standingsWeek)}</caption>
                        <thead>
                          <tr>
                            <th scope="col" className="sticky left-0 z-30 w-[180px] min-w-[180px] border-b border-r border-slate-200 bg-white p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.75)] sm:w-[240px] sm:min-w-[240px]">Entry</th>
                            <th className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</th>
                            <th className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Mulligans remaining</th>
                            {standingsTableWeeks.map((week) => (
                              <th key={week} className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                <span className="block">{shortWeekLabel(week)}</span>
                                <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">
                                  {survivalByWeek.get(week) ?? standingsEntryCount}/{standingsEntryCount} alive
                                </span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {standingsRows.map(({ member, stats, name, alive, strikesLeft, strikesUsed }) => {
                            const eliminatedWeek = !alive ? stats.eliminated_week || standingsWeek : stats.eliminated_week || null
                            return (
                              <tr key={member.id} className={alive ? 'align-top' : 'align-top bg-slate-50 text-slate-500'}>
                                <th scope="row" className={`sticky left-0 z-20 w-[180px] min-w-[180px] border-b border-r border-slate-100 p-2 text-left font-normal shadow-[6px_0_10px_-10px_rgba(15,23,42,0.75)] sm:w-[240px] sm:min-w-[240px] ${alive ? 'bg-white' : 'bg-slate-50'}`}>
                                  <div className="flex min-w-0 items-center gap-2">
                                    <EntryAvatar member={member} name={name} />
                                    <div className="min-w-0">
                                      <div className="truncate font-semibold text-slate-950">{name}</div>
                                      <div className="text-xs text-slate-500">Entry {member.entry_number || 1}</div>
                                    </div>
                                  </div>
                                </th>
                                <td className="border-b border-slate-100 p-2">
                                  {alive ? (
                                    <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">Alive</span>
                                  ) : (
                                    <span className="inline-flex rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                                      Eliminated{eliminatedWeek ? ` W${eliminatedWeek}` : ''}
                                    </span>
                                  )}
                                </td>
                                <td className="border-b border-slate-100 p-2">
                                  {alive ? (
                                    <div>
                                      <span className="font-semibold text-slate-950">{strikesLeft}</span>
                                      <span className="ml-1 text-xs text-slate-500">left</span>
                                      <div className="text-xs text-slate-500">{strikesUsed} {strikesUsed === 1 ? 'loss' : 'losses'}</div>
                                    </div>
                                  ) : (
                                    <span className="text-slate-400">-</span>
                                  )}
                                </td>
                                {standingsTableWeeks.map((week) => {
                                  const picks = picksByEntryWeek.get(`${member.id}:${week}`) || []
                                  const muted = !!eliminatedWeek && week > eliminatedWeek
                                  return (
                                    <td key={`${member.id}-${week}`} className="border-b border-slate-100 p-2">
                                      <WeekPickCell picks={picks} muted={muted} />
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase text-slate-500">{weekLabel(standingsWeek)} Pick Distribution</div>
                        <div className="mt-1 text-sm text-slate-600">Only visible picks are counted here.</div>
                      </div>
                      {topExposedTeam && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-xs font-semibold text-white">
                          <TeamLogo team={topExposedTeam.team} size={16} />
                          {topExposedTeam.team.abbr} x {topExposedTeam.count}
                        </span>
                      )}
                    </div>
                    {!standingsPicksVisible ? (
                      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                        No {weekLabel(standingsWeek)} picks are visible yet. Picks appear as each selected team reaches its lock time.
                      </div>
                    ) : teamPickChartRows.length === 0 ? (
                      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                        No team picks are visible for {weekLabel(standingsWeek)} yet.
                      </div>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        {teamPickChartRows.map(({ team, count, percentage, result }) => {
                          const barClass =
                            result === 'win'
                              ? 'bg-emerald-500'
                              : result === 'loss'
                                ? 'bg-red-500'
                                : 'bg-slate-300'
                          return (
                            <div key={team.abbr} className="rounded-md border border-slate-200 bg-white p-2">
                              <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                                  <TeamLogo team={team} size={22} />
                                  <span className="truncate">{team.name}</span>
                                </span>
                                <span className="shrink-0 text-xs font-semibold text-slate-700">
                                  {percentage}% / {count}
                                </span>
                              </div>
                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.max(percentage, 3)}%` }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </section>

                  <details className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-900">Teams Still Available</summary>
                    <div className="mt-2 text-sm text-slate-600">How many alive entries have not used each team yet, based on visible locked-pick history.</div>
                    <div className="mt-1 text-xs text-slate-500">{activeEntryCount} alive {activeEntryCount === 1 ? 'entry' : 'entries'} counted</div>
                    {activeEntryCount === 0 ? (
                      <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">No alive entries to analyze.</div>
                    ) : (
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {leagueAvailableTeams.map(({ team, available, percentage }) => (
                          <div key={team.abbr} className="rounded-md border border-slate-200 bg-white p-2">
                            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                              <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                                <TeamLogo team={team} size={22} />
                                <span className="truncate">{team.name}</span>
                              </span>
                              <span className="shrink-0 text-xs font-semibold text-slate-700">{available}/{activeEntryCount}</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-slate-500" style={{ width: `${Math.max(percentage, available > 0 ? 3 : 0)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </details>

                  {standingsLoading && <p className="text-sm text-gray-600 mt-3">Updating...</p>}
                </>
              )}

              {/* ----------- Members ----------- */}
              {!detailsLoading && pool && activeTab === 'members' && (
                <>
                  <div className="mb-3">
                    <h3 className="font-semibold">Pool Members</h3>
                  </div>
                  {canInvite && (
                    <section className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h4 className="font-semibold text-slate-950">Invite players</h4>
                          <p className="mt-1 text-sm text-slate-700">
                            Anyone in this pool can share the invite link until {weekLabel(pool.start_week)} starts.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setInviteOpen(true)}
                          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                        >
                          Invite players
                        </button>
                      </div>
                    </section>
                  )}
                  {members.length === 0 ? (
                    <p className="text-sm text-gray-600">No members found.</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {memberRowsForTab.map(({ member: m, entryCount }) => (
                        <li key={m.profile_id || m.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 border flex items-center justify-center overflow-hidden">
                            {m.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs text-gray-600">{(displayNameForMember(m)[0] || '?').toUpperCase()}</span>
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium">{displayNameForMember(m)}</div>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                                {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {pool && (
        <InviteModal
          open={inviteOpen}
          poolId={pool.id}
          poolName={pool.name}
          isPrivate={!pool.is_public}
          onClose={() => setInviteOpen(false)}
        />
      )}
      <AppDialogModal dialog={appDialog} onClose={() => setAppDialog(null)} />
    </main>
  )
}

export default function MyPoolsPage() {
  return (
    <Suspense fallback={<main className="min-h-[60vh] py-8">Loading pools...</main>}>
      <MyPoolsContent />
    </Suspense>
  )
}
