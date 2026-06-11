'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

/** ---------------- Types ---------------- */
type Pool = {
  id: string
  name: string
  season?: number | null
  is_public: boolean
  start_week: number
  include_playoffs: boolean
  strikes_allowed: number
  tie_rule: 'win' | 'loss' | 'push'
  deadline_mode: 'fixed' | 'rolling'
  deadline_fixed: string | null
  notes: string | null
  created_by: string
  double_pick_weeks?: number[] | null
  plan?: 'free' | 'pro'
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
}

type Profile = {
  id: string
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
  home_team: string
  away_team: string
  status: 'scheduled' | 'in_progress' | 'final' | string
  winner?: string | null
  home_score?: number | null
  away_score?: number | null
}

type SeasonWeek = { season: number; week: number; week_sunday_date: string }

type PickRow = { user_id: string; week: number; slot: number; team_abbr: string; result: 'win' | 'loss' | 'push' | null }
type DraftPickRow = { week: number; slot: number; team_abbr: string; updated_at: string | null }
type FinalPickRow = { week: number; slot: number; team_abbr: string; locked_at: string; result: 'win' | 'loss' | 'push' | null }
type PickNotice = { team: Team; week: number; slot: number; action: 'saved' | 'cleared' }

type MemberStats = {
  pool_id: string
  user_id: string
  wins: number
  losses: number
  pushes: number
  strikes_used: number
  eliminated: boolean
}

type PoolMemberRosterRow = {
  profile_id: string
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
const teamByAbbr = (abbr?: string | null) => NFL_TEAMS.find((t) => t.abbr === abbr) || null
const toAbbr = (input: string): string => {
  if (!input) return input
  const up = input.toUpperCase().trim()
  const byAbbr = NFL_TEAMS.find((t) => t.abbr === up)
  if (byAbbr) return byAbbr.abbr
  const byName = NFL_TEAMS.find((t) => t.name.toUpperCase() === up)
  return byName ? byName.abbr : up
}
const pickKey = (week: number, slot = 1) => `${week}:${slot}`

/** ---------------- Time + Lock Helpers ---------------- */
const fmtLocal = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const displayNameForMember = (m: Profile) =>
  m.display_name ||
  m.username ||
  `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() ||
  m.email ||
  `${m.id.slice(0, 8)}...`

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
function currentPickWeek(rows: SeasonWeek[], now = new Date()): number {
  if (rows.length === 0) return 1
  const sorted = [...rows].sort((a, b) => a.week - b.week)
  let current = sorted[0]?.week ?? 1

  for (const row of sorted) {
    const opensAt = Date.parse(etLocalToUtcISO(addDaysYmd(row.week_sunday_date, -5), '06:00'))
    if (now.getTime() >= opensAt) current = row.week
  }

  return Math.min(Math.max(current, 1), 18)
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
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** ---------------- Donut (Alive vs Eliminated) ---------------- */
function Donut({ alive, eliminated }: { alive: number; eliminated: number }) {
  const total = Math.max(alive + eliminated, 1)
  const a = (alive / total) * 100
  const r = 42,
    c = 2 * Math.PI * r
  const aLen = (a / 100) * c
  const eLen = c - aLen
  return (
    <div className="flex items-center gap-3">
      <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
        <g transform="translate(55,55) rotate(-90)">
          <circle r={r} cx="0" cy="0" fill="transparent" stroke="#e5e7eb" strokeWidth="16" />
          <circle r={r} cx="0" cy="0" fill="transparent" stroke="#16a34a" strokeWidth="16" strokeDasharray={`${aLen} ${c - aLen}`} />
          <circle
            r={r}
            cx="0"
            cy="0"
            fill="transparent"
            stroke="#ef4444"
            strokeWidth="16"
            strokeDasharray={`${eLen} ${c - eLen}`}
            strokeDashoffset={aLen}
            opacity="0.9"
          />
        </g>
      </svg>
      <div className="text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm bg-[#16a34a]" /> Alive: <b>{alive}</b>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-sm bg-[#ef4444]" /> Eliminated: <b>{eliminated}</b>
        </div>
        <div className="mt-1 text-xs text-gray-500">Total: {alive + eliminated}</div>
      </div>
    </div>
  )
}

/** ---------------- UI atoms ---------------- */
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px ${
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
  const label = up === 'WIN' ? 'Win' : up === 'LOSS' ? 'Loss' : up === 'PUSH' ? 'Push' : status || 'Pending'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>
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

  return (
    <div className="fixed bottom-5 right-5 z-[70] w-[min(360px,calc(100vw-2rem))] rounded-lg border border-emerald-200 bg-white p-4 shadow-xl">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
          <TeamLogo team={notice.team} size={34} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-950">{isCleared ? 'Pick cleared' : 'Pick saved'}</div>
          <div className="mt-0.5 text-sm text-slate-700">
            Week {notice.week}
            {notice.slot > 1 ? `, Pick ${notice.slot}` : ''}: {isCleared ? 'No team selected' : `${notice.team.name} (${notice.team.abbr})`}
          </div>
          <div className="mt-1 text-xs text-slate-500">Draft picks are editable until they become official locked picks.</div>
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
  nowTick: number
}) {
  const { week, slot, onClose, teamSearch, setTeamSearch, filteredTeams, usedTeamAbbrs, myDraftPicks, onPickTeam, gamesLoading, weekGames, deadlineMode, fixedLockUtc, nowTick } =
    props
  const selectedKey = pickKey(week, slot)

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1100px,92vw)] max-h-[85vh] overflow-y-auto bg-white rounded-xl shadow-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-lg font-semibold">
            Pick a team - Week {week}, Pick {slot}
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

        {teamSearch.trim() ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredTeams.map((t) => {
              const usedElsewhere = usedTeamAbbrs.includes(t.abbr) && myDraftPicks[selectedKey]?.abbr !== t.abbr
              return (
                <button
                  key={t.abbr}
                  onClick={() => onPickTeam(week, slot, t)}
                  disabled={usedElsewhere}
                  className={`border border-gray-200 rounded-lg p-3 hover:shadow flex items-center gap-3 text-left ${usedElsewhere ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={usedElsewhere ? 'Already used in another week' : ''}
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
                  </div>
                </button>
              )
            })}
          </div>
        ) : (
          <>
            {gamesLoading && <p className="text-sm text-gray-600">Loading matchups...</p>}
            {!gamesLoading && weekGames.length === 0 && <p className="text-sm text-gray-600">No games found for Week {week}.</p>}
            {!gamesLoading && weekGames.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {weekGames.map((g) => {
                  const homeAbbr = toAbbr(g.home_team)
                  const awayAbbr = toAbbr(g.away_team)
                  const kickoffIso = g.kickoff_at_utc || g.game_time
                  const kickoffMs = Date.parse(kickoffIso)

                  // hybrid lock = earlier of kickoff OR global fixed lock (if in fixed mode)
                  const fixedMs = deadlineMode === 'fixed' && fixedLockUtc ? Date.parse(fixedLockUtc) : Infinity
                  const lockMs = Math.min(kickoffMs, fixedMs)
                  const locked = Date.now() >= lockMs
                  const countdown = locked ? 'Locked' : `Locks in ${msToCountdown(lockMs - nowTick)}`

                  const cards = [
                    { abbr: awayAbbr, side: 'Away' as const },
                    { abbr: homeAbbr, side: 'Home' as const },
                  ]

                  return (
                    <div key={g.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-xs text-gray-500">{fmtLocal(kickoffIso)}</div>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full border ${locked ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-green-50 border-green-300 text-green-700'}`}>
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
                          const disabled = locked || usedElsewhere
                          const title = locked ? 'Locked - pick window has closed' : usedElsewhere ? 'Already used in another week' : ''
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
  const [userId, setUserId] = useState<string | null>(null)

  // modal + selection
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'picks' | 'standings' | 'members'>('standings')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pool, setPool] = useState<Pool | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const openedPoolParamRef = useRef<string | null>(null)

  // members
  const [members, setMembers] = useState<Profile[]>([])
  const [memberCount, setMemberCount] = useState<number>(0)

  // picks (mine)
  const weeks = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 1), [])
  const [selectedPickWeek, setSelectedPickWeek] = useState(1)
  const [seasonWeeks, setSeasonWeeks] = useState<SeasonWeek[]>([])
  const [myDraftPicks, setMyDraftPicks] = useState<Record<string, Team | null>>({})
  const [myFinalPicks, setMyFinalPicks] = useState<Record<string, FinalPickRow>>({})
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [savingPickKeys, setSavingPickKeys] = useState<Record<string, boolean>>({})
  const [pickNotice, setPickNotice] = useState<PickNotice | null>(null)
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
  const [statsByUser, setStatsByUser] = useState<Record<string, MemberStats>>({})
  const [aliveCount, setAliveCount] = useState(0)
  const [elimCount, setElimCount] = useState(0)
  const picksAllowedForWeek = (week: number) => (pool?.double_pick_weeks?.includes(week) ? 2 : 1)

  const showPickNotice = (notice: PickNotice) => {
    if (pickNoticeTimerRef.current) window.clearTimeout(pickNoticeTimerRef.current)
    setPickNotice(notice)
    pickNoticeTimerRef.current = window.setTimeout(() => setPickNotice(null), 3600)
  }

  const finalizeLockedPicks = async (poolId: string) => {
    const { error } = await supabase.rpc('finalize_locked_picks_for_pool', { p_pool_id: poolId })
    if (error) throw error
  }

  const adjudicateCompletedWeeks = async (season?: number | null) => {
    const { error } = await supabase.rpc('adjudicate_completed_weeks', { p_season: season ?? new Date().getFullYear() })
    if (error) throw error
  }

  const loadMyPicks = async (poolId: string) => {
    if (!userId) return

    const [{ data: finalPicks, error: finalErr }, { data: drafts, error: draftErr }] = await Promise.all([
      supabase.from('pool_picks').select('week, slot, team_abbr, locked_at, result').eq('pool_id', poolId).eq('user_id', userId),
      supabase.from('pool_pick_drafts').select('week, slot, team_abbr, updated_at').eq('pool_id', poolId).eq('user_id', userId),
    ])
    if (finalErr) throw finalErr
    if (draftErr) throw draftErr

    const locked: Record<string, FinalPickRow> = {}
    for (const pick of (finalPicks || []) as FinalPickRow[]) {
      locked[pickKey(pick.week, pick.slot)] = pick
    }
    setMyFinalPicks(locked)

    const next: Record<string, Team | null> = {}
    let latest: string | null = null
    for (const r of (drafts || []) as DraftPickRow[]) {
      next[pickKey(r.week, r.slot)] = teamByAbbr(r.team_abbr) || { abbr: r.team_abbr, name: r.team_abbr }
      const upAt = r.updated_at
      if (upAt && (!latest || upAt > latest)) latest = upAt
    }
    setMyDraftPicks(next)
    setDraftSavedAt(latest)
  }
  const [standingsLoading, setStandingsLoading] = useState(false)

  // monetization flags
  const isDraftPool = pool?.activation_status !== 'active'
  const requiresUpgrade = false
  const planIsFree = false

  /** ---------- Load user + pools ---------- */
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        setLoading(true)
        setError(null)
        const { data: userResp, error: userErr } = await supabase.auth.getUser()
        if (userErr) throw userErr
        const user = userResp.user
        if (!user) throw new Error('You must be signed in.')
        if (!alive) return
        setUserId(user.id)

        //  CHANGE #1: only non-archived pools you created
        const { data: createdPools, error: createdErr } = await supabase
          .from('pools')
          .select('*')
          .eq('created_by', user.id)
          .eq('archived', false)
          .order('created_at', { ascending: false })
        if (createdErr) throw createdErr

        const { data: memberships, error: memErr } = await supabase.from('pool_members').select('pool_id').eq('profile_id', user.id)
        if (memErr) throw memErr

        let memberPools: Pool[] = []
        const ids = (memberships || []).map((m) => m.pool_id)
        if (ids.length > 0) {
          //  CHANGE #2: only non-archived pools you are a member of
          const { data, error } = await supabase
            .from('pools')
            .select('*')
            .in('id', ids)
            .eq('archived', false)
            .order('created_at', { ascending: false })
          if (error) throw error
          memberPools = (data || []) as Pool[]
        }

        const map = new Map<string, Pool>()
        for (const p of (createdPools || []) as Pool[]) map.set(p.id, p)
        for (const p of memberPools) map.set(p.id, p)

        if (!alive) return
        setPools(Array.from(map.values()))
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load pools.'))
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
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

  /** ---------- Selected week games + fixed lock ---------- */
  useEffect(() => {
    const loadWeekGames = async (week: number) => {
      setGamesLoading(true)
      const { data, error } = await supabase
        .from('nfl_games')
        .select('id, season, week, game_time, kickoff_at_utc, home_team, away_team, status, winner, home_score, away_score')
        .eq('season', pool?.season ?? new Date().getFullYear())
        .eq('week', week)
        .order('kickoff_at_utc', { ascending: true, nullsFirst: false })
        .order('game_time', { ascending: true })

      if (!error) setWeekGames((data || []) as Game[])
      setGamesLoading(false)

      if (pool?.deadline_mode === 'fixed') {
        const t24 = normalizeTimeTo24h(pool.deadline_fixed) || '13:00'
        const season = pool?.season ?? data?.[0]?.season ?? new Date().getFullYear()
        const { data: sw } = await supabase
          .from('season_weeks')
          .select('season, week, week_sunday_date')
          .eq('season', season)
          .eq('week', week)
          .maybeSingle<SeasonWeek>()

        if (sw?.week_sunday_date) setFixedLockUtc(etLocalToUtcISO(sw.week_sunday_date, t24))
        else setFixedLockUtc(null)
      } else {
        setFixedLockUtc(null)
      }
    }

    const targetWeek = teamPickerTarget?.week ?? (activeTab === 'picks' ? selectedPickWeek : null)
    if (pool && targetWeek) loadWeekGames(targetWeek)
  }, [teamPickerTarget, activeTab, selectedPickWeek, pool, pool?.deadline_mode, pool?.deadline_fixed, pool?.season])

  /** ---------- Standings loader ---------- */
  const loadStandings = async (week: number, poolId?: string, poolSeason?: number | null) => {
    const pid = poolId ?? selectedId
    if (!pid) return
    setStandingsLoading(true)
    try {
      await finalizeLockedPicks(pid)
      await adjudicateCompletedWeeks(poolSeason ?? pool?.season)
      await loadMyPicks(pid)
    } catch (e: unknown) {
      console.warn('Failed to refresh finalized picks or standings results', e)
    }

    const { data: stats } = await supabase
      .from('pool_member_stats')
      .select('pool_id, user_id, wins, losses, pushes, strikes_used, eliminated')
      .eq('pool_id', pid)

    const map: Record<string, MemberStats> = {}
    for (const s of (stats || []) as MemberStats[]) map[s.user_id] = s
    setStatsByUser(map)

    const { data: picks } = await supabase.from('pool_picks').select('user_id, week, slot, team_abbr, result').eq('pool_id', pid).eq('week', week)
    setPicksThisWeek((picks || []) as PickRow[])

    let alive = 0,
      elim = 0
    for (const m of members) {
      const s = map[m.id]
      if (!s) {
        alive += 1
        continue
      }
      if (s.eliminated) elim += 1
      else alive += 1
    }
    setAliveCount(alive)
    setElimCount(elim)

    setStandingsLoading(false)
  }

  useEffect(() => {
    if (isOpen && selectedId && activeTab === 'standings') loadStandings(standingsWeek)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedId, activeTab, standingsWeek, members.length])

  /** ---------- Draft save / clear ---------- */
  const saveDraft = async (week: number, slot: number, team: Team | null) => {
    if (!selectedId || !userId) return false
    const key = pickKey(week, slot)
    if (myFinalPicks[key]) {
      alert(`Week ${week}, Pick ${slot} is locked and can no longer be changed.`)
      return false
    }
    setSavingPickKeys((prev) => ({ ...prev, [key]: true }))
    try {
      if (team) {
        const { error } = await supabase.from('pool_pick_drafts').upsert({ pool_id: selectedId, user_id: userId, week, slot, team_abbr: team.abbr })
        if (error) throw error
      } else {
        const { error } = await supabase.from('pool_pick_drafts').delete().eq('pool_id', selectedId).eq('user_id', userId).eq('week', week).eq('slot', slot)
        if (error) throw error
      }
      setDraftSavedAt(new Date().toISOString())
      return true
    } catch (e: unknown) {
      alert(getErrorMessage(e, 'Failed to save draft'))
      return false
    } finally {
      setSavingPickKeys((prev) => ({ ...prev, [key]: false }))
    }
  }

  const onPickTeam = async (week: number, slot: number, team: Team) => {
    const key = pickKey(week, slot)
    if (myFinalPicks[key]) {
      alert(`Week ${week}, Pick ${slot} is locked and can no longer be changed.`)
      return
    }
    if (teamPickerTarget?.week === week) {
      const game = weekGames.find((g) => toAbbr(g.home_team) === team.abbr || toAbbr(g.away_team) === team.abbr)
      if (game) {
        const kickoffMs = Date.parse(game.kickoff_at_utc || game.game_time)
        const fixedMs = pool?.deadline_mode === 'fixed' && fixedLockUtc ? Date.parse(fixedLockUtc) : Infinity
        const lockMs = Math.min(kickoffMs, fixedMs)
        if (Date.now() >= lockMs) {
          alert(`${team.name} is locked for Week ${week}.`)
          return
        }
      }
    }
    const alreadyUsedElsewhere =
      Object.entries(myDraftPicks).some(([k, t]) => k !== key && t?.abbr === team.abbr) ||
      Object.entries(myFinalPicks).some(([k, pick]) => k !== key && pick.team_abbr === team.abbr)
    if (alreadyUsedElsewhere) {
      alert(`${team.name} was already used in another week.`)
      return
    }
    const previousPick = myDraftPicks[key] ?? null
    setMyDraftPicks((prev) => ({ ...prev, [key]: team }))
    setTeamPickerTarget(null)
    const saved = await saveDraft(week, slot, team)
    if (saved) {
      showPickNotice({ team, week, slot, action: 'saved' })
    } else {
      setMyDraftPicks((prev) => ({ ...prev, [key]: previousPick }))
    }
  }

  const clearPick = async (week: number, slot: number) => {
    const key = pickKey(week, slot)
    if (myFinalPicks[key]) {
      alert(`Week ${week}, Pick ${slot} is locked and can no longer be changed.`)
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
    if (!selectedId || !userId) return
    setMyDraftPicks((prev) => {
      const next = { ...prev }
      weeks.forEach((week) => {
        for (let slot = 1; slot <= picksAllowedForWeek(week); slot += 1) {
          const key = pickKey(week, slot)
          if (!myFinalPicks[key]) next[key] = null
        }
      })
      return next
    })
    try {
      const { error } = await supabase.from('pool_pick_drafts').delete().eq('pool_id', selectedId).eq('user_id', userId)
      if (error) throw error
      setDraftSavedAt(new Date().toISOString())
    } catch (e: unknown) {
      alert(getErrorMessage(e, 'Failed to clear picks'))
    }
  }

  /** ---------- Copy / Export ---------- */
  const copyInviteLink = async () => {
    if (!pool) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const link = `${origin}/join/${pool.id}`
    try {
      await navigator.clipboard.writeText(link)
      alert('Invite link copied!')
    } catch {
      alert(link)
    }
  }

  const exportCsv = () => {
    if (!pool) return
    const rows = [['Week', 'Pick', 'Team', 'Abbr', 'Status']]
    weeks.forEach((w) => {
      for (let slot = 1; slot <= picksAllowedForWeek(w); slot += 1) {
        const key = pickKey(w, slot)
        const finalPick = myFinalPicks[key]
        const draftPick = myDraftPicks[key]
        const finalTeam = finalPick ? teamByAbbr(finalPick.team_abbr) || { abbr: finalPick.team_abbr, name: finalPick.team_abbr } : null
        const team = finalTeam || draftPick
        rows.push([String(w), String(slot), team?.name ?? '', team?.abbr ?? '', finalPick ? 'Official locked' : draftPick ? 'Editable draft' : ''])
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
  const pickStatusSummary = (() => {
    let official = 0
    let draft = 0
    let empty = 0

    weeks.forEach((week) => {
      for (let slot = 1; slot <= picksAllowedForWeek(week); slot += 1) {
        const key = pickKey(week, slot)
        if (myFinalPicks[key]) official += 1
        else if (myDraftPicks[key]) draft += 1
        else empty += 1
      }
    })

    return { official, draft, empty }
  })()
  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase()
    if (!q) return NFL_TEAMS
    return NFL_TEAMS.filter((t) => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q))
  }, [teamSearch])

  /** ---------- OWNER CHECK (for Admin Panel button) ---------- */
  const amOwner = useMemo(() => !!pool && !!userId && pool.created_by === userId, [pool, userId])

  /** ---------- Open / close modal ---------- */
  const openPool = async (id: string) => {
    setSelectedId(id)
    setIsOpen(true)
    setActiveTab('picks')
    setDetailsLoading(true)
    setDetailError(null)

    // reset per-open state
    setPool(null)
    setMembers([])
    setMemberCount(0)
    setMyDraftPicks({})
    setMyFinalPicks({})
    setDraftSavedAt(null)
    setTeamPickerTarget(null)
    setTeamSearch('')
    setWeekGames([])
    setSeasonWeeks([])
    setSelectedPickWeek(1)
    setGamesLoading(false)
    setFixedLockUtc(null)
    setStandingsWeek(1)
    setPicksThisWeek([])
    setStatsByUser({})
    setAliveCount(0)
    setElimCount(0)

    try {
      const { data: poolRow, error: poolErr } = await supabase.from('pools').select('*').eq('id', id).maybeSingle<Pool>()
      if (poolErr) throw poolErr
      if (!poolRow) throw new Error('Pool not found')

      setPool(poolRow)
      const { data: weekRows } = await supabase
        .from('season_weeks')
        .select('season, week, week_sunday_date')
        .eq('season', poolRow.season ?? new Date().getFullYear())
        .order('week', { ascending: true })

      const nextSeasonWeeks = ((weekRows || []) as SeasonWeek[]).filter((row) => row.week >= 1 && row.week <= 18)
      setSeasonWeeks(nextSeasonWeeks)
      setSelectedPickWeek(currentPickWeek(nextSeasonWeeks))

      const { data: rosterRows, error: rosterErr } = await supabase.rpc('pool_member_roster', { p_pool_id: id })
      if (rosterErr) throw rosterErr

      const roster = ((rosterRows || []) as PoolMemberRosterRow[]).map((m) => ({
        id: m.profile_id,
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

      await finalizeLockedPicks(id)

      await loadMyPicks(id)

      await loadStandings(1, id, poolRow.season)
    } catch (e: unknown) {
      setDetailError(getErrorMessage(e, 'Failed to load pool details.'))
    } finally {
      setDetailsLoading(false)
    }
  }

  const closeModal = () => {
    setIsOpen(false)
    setSelectedId(null)
    setPool(null)
    setDetailError(null)
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
    <main className="min-h-[60vh] py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">My Pools</h1>

        {/*  NEW: Archived button + Create Pool button */}
        <div className="flex items-center gap-2">
          <Link href="/profile" className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
            History
          </Link>
          <Link href="/pools/new" className="px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700">
            Create Pool
          </Link>
        </div>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && pools.length === 0 && (
        <p>
          You&apos;re not in any pools yet.{' '}
          <Link href="/pools/new" className="underline">
            Create one
          </Link>{' '}
          or join by invite.
        </p>
      )}

      {!loading && !error && pools.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pools.map((p) => (
            <li key={p.id} className="border border-gray-200 rounded-lg p-4">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="text-sm text-gray-600">
                {p.is_public ? 'Public' : 'Private'} - Starts week {p.start_week} - Strikes {p.strikes_allowed} - Tie = {p.tie_rule}
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => openPool(p.id)} className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">
                  Open
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---------- Slide-out Modal ---------- */}
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="absolute right-0 top-0 h-full w-full max-w-5xl bg-white shadow-xl overflow-y-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">{pool?.name || 'Pool'}</h2>
                {pool && (
                  <p className="text-xs text-gray-600">
                    {pool.deadline_mode === 'fixed'
                      ? `Hybrid lock: earliest of kickoff or ${(normalizeTimeTo24h(pool.deadline_fixed) || '13:00')} ET on Sunday`
                      : 'Rolling lock: each matchup commits at kickoff'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={copyInviteLink} className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
                  Copy Invite Link
                </button>
                <button onClick={exportCsv} className="px-3 py-1 rounded-md bg-gray-800 text-white hover:bg-black">
                  Export CSV
                </button>
                {amOwner && pool && (
                  <Link href={`/pools/${pool.id}/admin`} className="px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700">
                    Admin Panel
                  </Link>
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
                <Tab label={`Pool Members (${memberCount})`} active={activeTab === 'members'} onClick={() => setActiveTab('members')} />
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
                  {requiresUpgrade && (
                    <div className="mb-4 p-3 border rounded-md bg-yellow-50 text-sm">
                      This pool has <b>{memberCount}</b> members. Upgrade to <b>Pro</b> to remove ads and unlock premium features.
                      <button className="ml-3 px-3 py-1 rounded-md bg-yellow-600 text-white hover:bg-yellow-700">Upgrade to Pro</button>
                    </div>
                  )}
                  {planIsFree && (
                    <div className="mb-4 p-4 border rounded-md text-center text-sm text-gray-600">
                      <em>Ad - your message here</em>
                    </div>
                  )}

                  {isDraftPool && (
                    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      This pool is still a draft. Only the creator can activate it from the admin panel before members can join.
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                    <InfoTile label="Visibility" value={pool.is_public ? 'Public' : 'Private'} />
                    <InfoTile label="Status" value={pool.activation_status === 'active' ? 'Active' : 'Draft'} />
                    <InfoTile label="Member Limit" value={pool.max_members ? `${memberCount}/${pool.max_members}` : String(memberCount)} />
                    <InfoTile label="Start Week" value={`Week ${pool.start_week}`} />
                    <InfoTile label="Season" value={pool.include_playoffs ? 'Regular + Playoffs' : 'Regular only'} />
                    <InfoTile label="Strikes Allowed" value={String(pool.strikes_allowed)} />
                    <InfoTile label="Tie Counts As" value={pool.tie_rule} />
                    <InfoTile
                      label="Pick Deadline"
                      value={pool.deadline_mode === 'fixed' ? (normalizeTimeTo24h(pool.deadline_fixed) || '-') + ' ET' : 'Rolling'}
                    />
                  </div>

                  <div className="mb-6">
                    <h3 className="font-semibold mb-2">Used Teams</h3>
                    {usedTeamAbbrs.length === 0 ? (
                      <p className="text-sm text-gray-600">None yet - pick any team.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {usedTeamAbbrs.map((abbr) => (
                          <span key={abbr} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 border">
                            {abbr}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="font-semibold">Your Picks</h3>
                        <p className="text-xs text-gray-500">Drafts are editable. Official locked picks count in standings.</p>
                      </div>
                      <div className="text-xs text-gray-500">{draftSavedAt ? `Last saved ${fmtDateTime(draftSavedAt)}` : 'No drafts yet'}</div>
                    </div>

                    <div className="mb-4 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-emerald-700">Editable drafts</div>
                        <div className="text-lg font-semibold text-emerald-950">{pickStatusSummary.draft}</div>
                      </div>
                      <div className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-slate-600">Official locked</div>
                        <div className="text-lg font-semibold text-slate-950">{pickStatusSummary.official}</div>
                      </div>
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                        <div className="text-xs uppercase tracking-wide text-amber-700">Still empty</div>
                        <div className="text-lg font-semibold text-amber-950">{pickStatusSummary.empty}</div>
                      </div>
                    </div>

                    <div className="mb-4 overflow-x-auto">
                      <div className="flex min-w-max gap-2 pb-1">
                        {weeks.map((w) => {
                          const selected = selectedPickWeek === w
                          const required = picksAllowedForWeek(w)
                          const hasDraft = Array.from({ length: required }, (_, i) => myDraftPicks[pickKey(w, i + 1)]).some(Boolean)
                          const hasFinal = Array.from({ length: required }, (_, i) => myFinalPicks[pickKey(w, i + 1)]).some(Boolean)
                          return (
                            <button
                              key={`week-button-${w}`}
                              type="button"
                              onClick={() => {
                                setSelectedPickWeek(w)
                                setTeamPickerTarget(null)
                                setTeamSearch('')
                              }}
                              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                                selected
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : hasFinal
                                    ? 'border-slate-300 bg-slate-100 text-slate-700'
                                    : hasDraft
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                              }`}
                            >
                              W{w}
                              {required > 1 && <span className="ml-1 text-[10px]">x2</span>}
                            </button>
                          )
                        })}
                        {pool.include_playoffs && (
                          <button
                            type="button"
                            disabled
                            title="Playoff picks will be enabled after playoff schedule support is added."
                            className="rounded-md border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-400"
                          >
                            Playoffs
                          </button>
                        )}
                      </div>
                    </div>

                    <section className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-lg font-semibold">Week {selectedPickWeek}</h4>
                            {picksAllowedForWeek(selectedPickWeek) > 1 && (
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                Double-pick week
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-gray-600">
                            Make {picksAllowedForWeek(selectedPickWeek)} {picksAllowedForWeek(selectedPickWeek) === 1 ? 'pick' : 'picks'} for this week.
                          </p>
                        </div>
                        <div className="text-xs text-gray-500">
                          {seasonWeeks.find((row) => row.week === selectedPickWeek)?.week_sunday_date
                            ? `Week opens Tuesday at 6:00 AM ET before ${seasonWeeks.find((row) => row.week === selectedPickWeek)?.week_sunday_date}`
                            : 'Week timing unavailable'}
                        </div>
                      </div>

                      <div className={`grid gap-3 ${picksAllowedForWeek(selectedPickWeek) > 1 ? 'md:grid-cols-2' : ''}`}>
                        {Array.from({ length: picksAllowedForWeek(selectedPickWeek) }, (_, i) => i + 1).map((slot) => {
                          const key = pickKey(selectedPickWeek, slot)
                          const finalPick = myFinalPicks[key]
                          const draftPick = myDraftPicks[key]
                          const finalTeam = finalPick ? teamByAbbr(finalPick.team_abbr) || { abbr: finalPick.team_abbr, name: finalPick.team_abbr } : null
                          const savingPick = !!savingPickKeys[key]

                          if (finalPick && finalTeam) {
                            return (
                              <div key={key} className="rounded-md border border-slate-300 bg-slate-50 p-3">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium text-slate-600">{picksAllowedForWeek(selectedPickWeek) > 1 ? `Pick ${slot}` : 'Pick'}</span>
                                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">Official locked</span>
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
                            <div key={key} className="rounded-md border border-blue-100 bg-white p-3 shadow-sm">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-xs font-medium text-slate-600">{picksAllowedForWeek(selectedPickWeek) > 1 ? `Pick ${slot}` : 'Pick'}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                    draftPick ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                                  }`}
                                >
                                  {savingPick ? 'Saving' : draftPick ? 'Editable draft' : 'No pick'}
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
                              ) : (
                                <div className="flex min-h-14 items-center text-sm text-slate-500">Choose a team for Week {selectedPickWeek}.</div>
                              )}

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                  onClick={() => setTeamPickerTarget({ week: selectedPickWeek, slot })}
                                  disabled={savingPick}
                                >
                                  {draftPick ? 'Change draft' : 'Choose team'}
                                </button>
                                {draftPick && (
                                  <button
                                    type="button"
                                    className="rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-50"
                                    title="Clear this draft pick"
                                    onClick={() => clearPick(selectedPickWeek, slot)}
                                    disabled={savingPick}
                                  >
                                    Clear draft
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>

                      <div className="mt-5">
                        <h5 className="mb-2 text-sm font-semibold">Week {selectedPickWeek} Games</h5>
                        {gamesLoading && <p className="text-sm text-gray-600">Loading games...</p>}
                        {!gamesLoading && weekGames.length === 0 && <p className="text-sm text-gray-600">No games found for this week.</p>}
                        {!gamesLoading && weekGames.length > 0 && (
                          <div className="grid gap-2 md:grid-cols-2">
                            {weekGames.map((game) => (
                              <div key={game.id} className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                <div className="text-xs text-gray-500">{fmtDateTime(game.kickoff_at_utc || game.game_time)}</div>
                                <div className="mt-1 font-medium">
                                  {toAbbr(game.away_team)} @ {toAbbr(game.home_team)}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={clearAllPicks} className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
                        Clear All Drafts
                      </button>
                      <span className="text-xs text-gray-500">
                        Picks finalize automatically at kickoff (rolling) or at the earlier of kickoff / fixed time (hybrid).
                      </span>
                    </div>
                  </div>

                  {teamPickerTarget && (
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
                      nowTick={nowTick}
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
                      <label className="text-sm">Week</label>
                      <select className="border rounded-md px-2 py-1 text-sm" value={standingsWeek} onChange={(e) => setStandingsWeek(Number(e.target.value))}>
                        {weeks.map((w) => (
                          <option key={w} value={w}>
                            Week {w}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button onClick={() => loadStandings(standingsWeek)} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
                      Refresh
                    </button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3 mb-6">
                    <div className="border rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-500">Members</div>
                      <div className="text-2xl font-bold">{memberCount}</div>
                      <div className="text-xs text-gray-500 mt-1">Total pool participants</div>
                    </div>
                    <div className="border rounded-lg p-4">
                      <div className="text-xs uppercase text-gray-500">Strikes Allowed</div>
                      <div className="text-2xl font-bold">{pool.strikes_allowed}</div>
                      <div className="text-xs text-gray-500 mt-1">Tie counts as: {pool.tie_rule}</div>
                    </div>
                    <div className="border rounded-lg p-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs uppercase text-gray-500">Alive vs Eliminated</div>
                        <div className="text-xs text-gray-500 mt-1">Based on adjudicated results</div>
                      </div>
                      <Donut alive={aliveCount} eliminated={elimCount} />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-[820px] w-full border border-gray-200 rounded-lg text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-2 border">Member</th>
                          <th className="text-left p-2 border">Pick (Week {standingsWeek})</th>
                          <th className="text-left p-2 border">Result</th>
                          <th className="text-left p-2 border">Record to Date</th>
                          <th className="text-left p-2 border">Strikes Used</th>
                          <th className="text-left p-2 border">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((m) => {
                          const name = displayNameForMember(m)
                          const s =
                            statsByUser[m.id] ||
                            ({
                              wins: 0,
                              losses: 0,
                              pushes: 0,
                              strikes_used: 0,
                              eliminated: false,
                            } as MemberStats)

                          const memberPicks = picksThisWeek.filter((p) => p.user_id === m.id).sort((a, b) => a.slot - b.slot)

                          return (
                            <tr key={m.id} className="hover:bg-gray-50">
                              <td className="p-2 border">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-gray-100 border flex items-center justify-center overflow-hidden">
                                    {m.avatar_url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <span className="text-[11px] text-gray-600">{(name[0] || '?').toUpperCase()}</span>
                                    )}
                                  </div>
                                  <span className="font-medium">{name}</span>
                                </div>
                              </td>
                              <td className="p-2 border">
                                {memberPicks.length > 0 ? (
                                  <div className="space-y-2">
                                    {memberPicks.map((pick) => {
                                      const team = teamByAbbr(toAbbr(pick.team_abbr)) || { abbr: pick.team_abbr, name: pick.team_abbr }
                                      return (
                                        <div key={`${pick.user_id}-${pick.week}-${pick.slot}`} className="flex items-center gap-2">
                                          <div className="relative w-7 h-7">
                                            {'logo' in team && (team as Team).logo ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img src={(team as Team).logo!} alt={(team as Team).name} className="w-7 h-7 object-contain" />
                                            ) : (
                                              <div className="w-7 h-7 rounded-full border flex items-center justify-center text-xs">{team.abbr}</div>
                                            )}
                                          </div>
                                          <div className="text-sm">
                                            {picksAllowedForWeek(standingsWeek) > 1 && <span className="mr-1 text-xs text-gray-500">P{pick.slot}</span>}
                                            {('name' in team && (team as Team).name) || team.abbr} ({team.abbr})
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                ) : (
                                  <span className="text-gray-500">-</span>
                                )}
                              </td>
                              <td className="p-2 border">
                                {memberPicks.length > 0 ? (
                                  <div className="space-y-1">
                                    {memberPicks.map((pick) => (
                                      <div key={`${pick.user_id}-${pick.week}-${pick.slot}-result`}>
                                        <ResultPill status={pick.result || 'Pending'} />
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <ResultPill status="-" />
                                )}
                              </td>
                              <td className="p-2 border">
                                <span className="font-medium">
                                  {s.wins}-{s.losses}
                                  {s.pushes ? `-${s.pushes}` : ''}
                                </span>
                                <span className="ml-2 text-xs text-gray-500">(W-L{s.pushes ? '-P' : ''})</span>
                              </td>
                              <td className="p-2 border">{s.strikes_used}</td>
                              <td className="p-2 border">
                                {s.eliminated ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-red-600 text-white">Eliminated</span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-emerald-600 text-white">Alive</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {standingsLoading && <p className="text-sm text-gray-600 mt-3">Updating...</p>}
                </>
              )}

              {/* ----------- Members ----------- */}
              {!detailsLoading && pool && activeTab === 'members' && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Pool Members</h3>
                    <button onClick={copyInviteLink} className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
                      Invite
                    </button>
                  </div>
                  {members.length === 0 ? (
                    <p className="text-sm text-gray-600">No members found.</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {members.map((m) => (
                        <li key={m.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 border flex items-center justify-center overflow-hidden">
                            {m.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs text-gray-600">{(displayNameForMember(m)[0] || '?').toUpperCase()}</span>
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium">{displayNameForMember(m)}</div>
                            {m.role && <div className="text-xs text-gray-500 capitalize">{m.role}</div>}
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
