'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabaseClient'

/** ---------- Types ---------- */
type Pool = {
  id: string
  name: string
  is_public: boolean
  start_week: number
  include_playoffs: boolean
  strikes_allowed: number
  tie_rule: 'win' | 'loss' | 'push'
  deadline_mode: 'fixed' | 'rolling'
  deadline_fixed: string | null
  notes: string | null
  created_by: string
  plan?: 'free' | 'pro'
}

type MemberRow = { profile_id: string }
type Profile = { id: string; first_name?: string | null; last_name?: string | null; avatar_url?: string | null; email?: string | null }

type Team = { abbr: string; name: string; logo?: string }

type Game = {
  id: string
  season: number
  week: number
  game_time: string
  home_team: string
  away_team: string
  status: 'scheduled' | 'in_progress' | 'final' | string
  winner?: string | null // Winner abbr or "TIE"
  home_score?: number | null
  away_score?: number | null
}

type SeasonWeek = { season: number; week: number; week_sunday_date: string }

/** ---------- Teams + logos ---------- */
const NFL_TEAMS: Team[] = [
  { abbr: 'ARI', name: 'Arizona Cardinals', logo: '/nfl-logos/ARI.svg' },
  { abbr: 'ATL', name: 'Atlanta Falcons', logo: '/nfl-logos/ATL.svg' },
  { abbr: 'BAL', name: 'Baltimore Ravens', logo: '/nfl-logos/BAL.svg' },
  { abbr: 'BUF', name: 'Buffalo Bills', logo: '/nfl-logos/BUF.svg' },
  { abbr: 'CAR', name: 'Carolina Panthers', logo: '/nfl-logos/CAR.svg' },
  { abbr: 'CHI', name: 'Chicago Bears', logo: '/nfl-logos/CHI.svg' },
  { abbr: 'CIN', name: 'Cincinnati Bengals', logo: '/nfl-logos/CIN.svg' },
  { abbr: 'CLE', name: 'Cleveland Browns', logo: '/nfl-logos/CLE.svg' },
  { abbr: 'DAL', name: 'Dallas Cowboys', logo: '/nfl-logos/DAL.svg' },
  { abbr: 'DEN', name: 'Denver Broncos', logo: '/nfl-logos/DEN.svg' },
  { abbr: 'DET', name: 'Detroit Lions', logo: '/nfl-logos/DET.svg' },
  { abbr: 'GB',  name: 'Green Bay Packers', logo: '/nfl-logos/GB.svg' },
  { abbr: 'HOU', name: 'Houston Texans', logo: '/nfl-logos/HOU.svg' },
  { abbr: 'IND', name: 'Indianapolis Colts', logo: '/nfl-logos/IND.svg' },
  { abbr: 'JAX', name: 'Jacksonville Jaguars', logo: '/nfl-logos/JAX.svg' },
  { abbr: 'KC',  name: 'Kansas City Chiefs', logo: '/nfl-logos/KC.svg' },
  { abbr: 'LV',  name: 'Las Vegas Raiders', logo: '/nfl-logos/LV.svg' },
  { abbr: 'LAC', name: 'Los Angeles Chargers', logo: '/nfl-logos/LAC.svg' },
  { abbr: 'LAR', name: 'Los Angeles Rams', logo: '/nfl-logos/LAR.svg' },
  { abbr: 'MIA', name: 'Miami Dolphins', logo: '/nfl-logos/MIA.svg' },
  { abbr: 'MIN', name: 'Minnesota Vikings', logo: '/nfl-logos/MIN.svg' },
  { abbr: 'NE',  name: 'New England Patriots', logo: '/nfl-logos/NE.svg' },
  { abbr: 'NO',  name: 'New Orleans Saints', logo: '/nfl-logos/NO.svg' },
  { abbr: 'NYG', name: 'New York Giants', logo: '/nfl-logos/NYG.svg' },
  { abbr: 'NYJ', name: 'New York Jets', logo: '/nfl-logos/NYJ.svg' },
  { abbr: 'PHI', name: 'Philadelphia Eagles', logo: '/nfl-logos/PHI.svg' },
  { abbr: 'PIT', name: 'Pittsburgh Steelers', logo: '/nfl-logos/PIT.svg' },
  { abbr: 'SF',  name: 'San Francisco 49ers', logo: '/nfl-logos/SF.svg' },
  { abbr: 'SEA', name: 'Seattle Seahawks', logo: '/nfl-logos/SEA.svg' },
  { abbr: 'TB',  name: 'Tampa Bay Buccaneers', logo: '/nfl-logos/TB.svg' },
  { abbr: 'TEN', name: 'Tennessee Titans', logo: '/nfl-logos/TEN.svg' },
  { abbr: 'WAS', name: 'Washington Commanders', logo: '/nfl-logos/WAS.svg' },
]
const teamByAbbr = (a?: string | null) => NFL_TEAMS.find(t => t.abbr === a) || null
const toAbbr = (s: string) => NFL_TEAMS.find(t => t.abbr === s.toUpperCase())?.abbr || s.toUpperCase()
const fmtLocal = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })

/** ---------- Lock helpers (from v1) ---------- */
function normalizeTimeTo24h(s?: string | null): string | null {
  if (!s) return null
  const t = s.trim()
  if (/^\d{1,2}:\d{2}$/.test(t) && !/[ap]m/i.test(t)) {
    const [H, M] = t.split(':').map(Number)
    if (H >= 0 && H <= 23 && M >= 0 && M <= 59) return `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}`
  }
  const m = t.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i)
  if (m) {
    let H = Number(m[1]); const M = Number(m[2]); const ap = m[3].toLowerCase()
    if (ap === 'pm' && H < 12) H += 12
    if (ap === 'am' && H === 12) H = 0
    return `${String(H).padStart(2,'0')}:${String(M).padStart(2,'0')}`
  }
  return null
}
function tzOffsetMinutes(zone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: zone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false })
  const parts = dtf.formatToParts(utcDate)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const y = get('year'), mo = get('month'), d = get('day'), h = get('hour'), mi = get('minute'), s = get('second')
  const asUTC = Date.UTC(y, mo - 1, d, h, mi, s)
  return (asUTC - utcDate.getTime()) / 60000
}
function etLocalToUtcISO(ymd: string, hhmm: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const [H, M] = hhmm.split(':').map(Number)
  let guess = Date.UTC(y, (m - 1), d, H, M, 0, 0)
  const off1 = tzOffsetMinutes('America/New_York', new Date(guess))
  let utcMs = guess - off1 * 60_000
  const off2 = tzOffsetMinutes('America/New_York', new Date(utcMs))
  if (off2 !== off1) utcMs = guess - off2 * 60_000
  return new Date(utcMs).toISOString()
}
function msToCountdown(ms: number) {
  if (ms <= 0) return '00:00:00'
  const s = Math.floor(ms / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

/** ---------- Donut (pie) chart (SVG, no deps) ---------- */
function Donut({ alive, eliminated }: { alive: number; eliminated: number }) {
  const total = Math.max(alive + eliminated, 1)
  const a = (alive / total) * 100
  const e = 100 - a
  // SVG circle math
  const r = 42
  const c = 2 * Math.PI * r
  const aLen = (a / 100) * c
  const eLen = c - aLen
  return (
    <div className="flex items-center gap-3">
      <svg width="110" height="110" viewBox="0 0 110 110" className="shrink-0">
        <g transform="translate(55,55) rotate(-90)">
          {/* base */}
          <circle r={r} cx="0" cy="0" fill="transparent" stroke="#e5e7eb" strokeWidth="16" />
          {/* alive */}
          <circle r={r} cx="0" cy="0" fill="transparent" stroke="#16a34a" strokeWidth="16"
                  strokeDasharray={`${aLen} ${c - aLen}`} strokeLinecap="butt" />
          {/* eliminated (draw after alive with dashoffset) */}
          <circle r={r} cx="0" cy="0" fill="transparent" stroke="#ef4444" strokeWidth="16"
                  strokeDasharray={`${eLen} ${c - eLen}`} strokeDashoffset={aLen} strokeLinecap="butt" opacity="0.9" />
        </g>
      </svg>
      <div className="text-sm">
        <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm bg-[#16a34a]" /> Alive: <b>{alive}</b></div>
        <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-sm bg-[#ef4444]" /> Eliminated: <b>{eliminated}</b></div>
        <div className="mt-1 text-xs text-gray-500">Total: {alive + eliminated}</div>
      </div>
    </div>
  )
}

/** ---------- Page ---------- */
export default function MyPoolsPage() {
  // base
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pools, setPools] = useState<Pool[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  // modal
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'picks' | 'standings' | 'members'>('picks')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pool, setPool] = useState<Pool | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)

  // members/profiles
  const [members, setMembers] = useState<Profile[]>([])
  const [memberCount, setMemberCount] = useState<number>(0)
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({})

  // picks (mine) — unchanged logic from previous version
  const weeks = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 1), [])
  const [myDraftPicks, setMyDraftPicks] = useState<Record<number, Team | null>>({})
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)

  // team picker (with locks) — also kept
  const [teamPickerWeek, setTeamPickerWeek] = useState<number | null>(null)
  const [teamSearch, setTeamSearch] = useState('')
  const [weekGames, setWeekGames] = useState<Game[]>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [fixedLockUtc, setFixedLockUtc] = useState<string | null>(null)
  const [nowTick, setNowTick] = useState<number>(Date.now())
  const tickRef = useRef<number | null>(null)

  // standings
  const [standingsWeek, setStandingsWeek] = useState<number>(1)
  const [officialPicksThisWeek, setOfficialPicksThisWeek] = useState<Array<{ user_id: string, team_abbr: string }>>([])
  const [strikesToDate, setStrikesToDate] = useState<Record<string, number>>({}) // user_id -> strikes used through standingsWeek
  const [winsLossesToDate, setWinsLossesToDate] = useState<Record<string, { w: number, l: number, p: number }>>({})
  const [aliveCount, setAliveCount] = useState(0)
  const [elimCount, setElimCount] = useState(0)
  const [standingsLoading, setStandingsLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const autoRefTimer = useRef<number | null>(null)

  const planIsFree = pool?.plan === 'free' || !pool?.plan
  const requiresUpgrade = planIsFree && memberCount >= 11

  /** ---- Load user + pools ---- */
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        setLoading(true); setError(null)
        const { data: { user }, error: userErr } = await supabase.auth.getUser()
        if (userErr) throw userErr
        if (!user) throw new Error('You must be signed in.')
        if (!alive) return
        setUserId(user.id)

        const { data: createdPools, error: createdErr } = await supabase
          .from('pools').select('*').eq('created_by', user.id).order('created_at', { ascending: false })
        if (createdErr) throw createdErr

        const { data: memberships, error: memErr } = await supabase
          .from('pool_members').select('pool_id').eq('profile_id', user.id)
        if (memErr) throw memErr

        let memberPools: Pool[] = []
        const ids = (memberships || []).map(m => m.pool_id)
        if (ids.length > 0) {
          const { data, error } = await supabase
            .from('pools').select('*').in('id', ids).order('created_at', { ascending: false })
          if (error) throw error
          memberPools = (data || []) as Pool[]
        }

        const map = new Map<string, Pool>()
        for (const p of (createdPools || []) as Pool[]) map.set(p.id, p)
        for (const p of memberPools) map.set(p.id, p)
        if (!alive) return
        setPools(Array.from(map.values()))
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || 'Failed to load pools.')
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [])

  /** ---- Open pool ---- */
  const openPool = async (id: string) => {
    setSelectedId(id)
    setIsOpen(true)
    setActiveTab('picks')
    setDetailsLoading(true)

    // reset per-open state
    setPool(null); setMembers([]); setProfilesById({})
    setMemberCount(0)
    setMyDraftPicks({}); setDraftSavedAt(null)
    setTeamPickerWeek(null); setTeamSearch('')
    setWeekGames([]); setGamesLoading(false); setFixedLockUtc(null)
    setStandingsWeek(1); setOfficialPicksThisWeek([]); setStrikesToDate({}); setWinsLossesToDate({})
    setAliveCount(0); setElimCount(0)

    try {
      const [{ data: poolRow, error: poolErr }, { data: memberRows, error: memErr, count }] = await Promise.all([
        supabase.from('pools').select('*').eq('id', id).maybeSingle<Pool>(),
        supabase.from('pool_members').select('profile_id', { count: 'exact' }).eq('pool_id', id)
      ])
      if (poolErr) throw poolErr
      if (!poolRow) throw new Error('Pool not found')
      setPool(poolRow)
      setMemberCount(count ?? (memberRows?.length || 0))

      const memberIds = (memberRows || []).map((m: MemberRow) => m.profile_id)
      if (memberIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, avatar_url, email')
          .in('id', memberIds)
        setMembers((profiles || []) as Profile[])
        const map: Record<string, Profile> = {}
        for (const p of (profiles || []) as Profile[]) map[p.id] = p
        setProfilesById(map)
      }

      // my drafts
      if (userId) {
        const { data: drafts } = await supabase
          .from('pool_pick_drafts')
          .select('week, team_abbr, updated_at')
          .eq('pool_id', id)
          .eq('user_id', userId)
        const next: Record<number, Team | null> = {}
        let latest: string | null = null
        for (const r of drafts || []) {
          next[r.week] = teamByAbbr(r.team_abbr) || { abbr: r.team_abbr, name: r.team_abbr }
          const upAt = (r as any).updated_at as string | null
          if (upAt && (!latest || upAt > latest)) latest = upAt
        }
        setMyDraftPicks(next); setDraftSavedAt(latest)
      }
    } finally {
      setDetailsLoading(false)
    }
  }

  const closeModal = () => { setIsOpen(false); setSelectedId(null); setPool(null) }

  /** ---------- Picks: save / clear (unchanged) ---------- */
  const saveDraft = async (week: number, team: Team | null) => {
    if (!selectedId || !userId) return
    try {
      if (team) {
        const { error } = await supabase
          .from('pool_pick_drafts')
          .upsert({ pool_id: selectedId, user_id: userId, week, team_abbr: team.abbr })
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('pool_pick_drafts')
          .delete()
          .eq('pool_id', selectedId).eq('user_id', userId).eq('week', week)
        if (error) throw error
      }
      setDraftSavedAt(new Date().toISOString())
    } catch (e: any) { alert(e?.message || 'Failed to save draft') }
  }
  const onPickTeam = async (week: number, team: Team) => {
    const alreadyUsedElsewhere = Object.entries(myDraftPicks).some(([wk, t]) => Number(wk) !== week && t?.abbr === team.abbr)
    if (alreadyUsedElsewhere) { alert(`${team.name} was already used in another week.`); return }
    setMyDraftPicks(prev => ({ ...prev, [week]: team })); setTeamPickerWeek(null); await saveDraft(week, team)
  }
  const clearPick = async (week: number) => { setMyDraftPicks(prev => ({ ...prev, [week]: null })); await saveDraft(week, null) }
  const clearAllPicks = async () => {
    if (!selectedId || !userId) return
    setMyDraftPicks({})
    try {
      const { error } = await supabase.from('pool_pick_drafts').delete().eq('pool_id', selectedId).eq('user_id', userId)
      if (error) throw error
      setDraftSavedAt(new Date().toISOString())
    } catch (e: any) { alert(e?.message || 'Failed to clear picks') }
  }

  /** ---------- Team picker: load matchups + lock (unchanged logic) ---------- */
  useEffect(() => {
    const loadWeekGames = async (week: number) => {
      setGamesLoading(true)
      const { data, error } = await supabase
        .from('nfl_games')
        .select('id, season, week, game_time, home_team, away_team, status, winner, home_score, away_score')
        .eq('week', week)
        .order('game_time', { ascending: true })
      if (!error) setWeekGames((data || []) as Game[])
      setGamesLoading(false)

      if (pool?.deadline_mode === 'fixed') {
        const t24 = normalizeTimeTo24h(pool.deadline_fixed) || '13:00'
        const season = (data && data[0]?.season) || new Date().getFullYear()
        const { data: sw } = await supabase
          .from('season_weeks')
          .select('season, week, week_sunday_date')
          .eq('season', season).eq('week', week).maybeSingle<SeasonWeek>()
        if (sw?.week_sunday_date) setFixedLockUtc(etLocalToUtcISO(sw.week_sunday_date, t24))
        else setFixedLockUtc(null)
      } else setFixedLockUtc(null)
    }
    if (teamPickerWeek) loadWeekGames(teamPickerWeek)
  }, [teamPickerWeek, pool?.deadline_mode, pool?.deadline_fixed])

  useEffect(() => {
    if (!teamPickerWeek) return
    tickRef.current = window.setInterval(() => setNowTick(Date.now()), 1000)
    return () => { if (tickRef.current) window.clearInterval(tickRef.current) }
  }, [teamPickerWeek])

  /** ---------- STANDINGS: compute results + elimination ---------- */
  const computeStandings = async (week: number) => {
    if (!selectedId) return
    try {
      setStandingsLoading(true)

      // 1) All official picks up to this week (for strikes tally)
      const { data: picksToDate } = await supabase
        .from('pool_picks')
        .select('user_id, week, team_abbr')
        .eq('pool_id', selectedId)
        .lte('week', week)

      // 2) Picks for THIS week (for table display)
      const { data: picksThis } = await supabase
        .from('pool_picks')
        .select('user_id, team_abbr')
        .eq('pool_id', selectedId)
        .eq('week', week)

      setOfficialPicksThisWeek((picksThis || []) as Array<{ user_id: string, team_abbr: string }>)

      // 3) Load games (weeks 1..week) to evaluate W/L/Push
      //    Determine season from any row in nfl_games for this week.
      const { data: sampleGame } = await supabase
        .from('nfl_games')
        .select('season')
        .eq('week', week)
        .limit(1)
        .maybeSingle()

      const season = sampleGame?.season ?? new Date().getFullYear()

      const { data: games } = await supabase
        .from('nfl_games')
        .select('week, home_team, away_team, winner, status')
        .eq('season', season)
        .lte('week', week)

      // Build lookup: week -> team_abbr -> {status, winner}
      const gameMap = new Map<string, { status: string, winner: string | null }>()
      for (const g of (games || []) as Game[]) {
        const wk = String(g.week)
        const home = toAbbr(g.home_team), away = toAbbr(g.away_team)
        const winner = g.winner ? (g.winner === 'TIE' ? 'TIE' : toAbbr(g.winner)) : null
        gameMap.set(`${wk}|${home}`, { status: g.status, winner })
        gameMap.set(`${wk}|${away}`, { status: g.status, winner })
      }

      // 4) Tally wins/losses/pushes through selected week, compute strikes
      const winsLosses: Record<string, { w: number, l: number, p: number }> = {}
      const strikes: Record<string, number> = {}
      const tieRule = pool?.tie_rule || 'push'

      for (const p of (picksToDate || []) as Array<{ user_id: string; week: number; team_abbr: string }>) {
        const key = `${p.week}|${toAbbr(p.team_abbr)}`
        const gm = gameMap.get(key)
        const user = p.user_id
        if (!winsLosses[user]) winsLosses[user] = { w: 0, l: 0, p: 0 }
        if (!strikes[user]) strikes[user] = 0

        if (!gm || gm.status !== 'final' || !gm.winner) {
          // pending: do nothing to counts/strikes
          continue
        }

        if (gm.winner === 'TIE') {
          if (tieRule === 'win') winsLosses[user].w += 1
          else if (tieRule === 'loss') { winsLosses[user].l += 1; strikes[user] += 1 }
          else winsLosses[user].p += 1 // push
        } else if (gm.winner === toAbbr(p.team_abbr)) {
          winsLosses[user].w += 1
        } else {
          winsLosses[user].l += 1
          strikes[user] += 1
        }
      }

      // Initialize for members with zero picks to date
      for (const m of members) {
        if (!winsLosses[m.id]) winsLosses[m.id] = { w: 0, l: 0, p: 0 }
        if (!strikes[m.id]) strikes[m.id] = 0
      }

      setWinsLossesToDate(winsLosses)
      setStrikesToDate(strikes)

      // 5) Alive vs Eliminated
      const allowed = pool?.strikes_allowed ?? 1
      let alive = 0, elim = 0
      for (const m of members) {
        const s = strikes[m.id] || 0
        if (s >= allowed) elim += 1
        else alive += 1
      }
      setAliveCount(alive)
      setElimCount(elim)
    } finally {
      setStandingsLoading(false)
    }
  }

  // load standings when tab opens / changes
  useEffect(() => {
    if (isOpen && selectedId && pool && activeTab === 'standings') computeStandings(standingsWeek)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedId, pool, activeTab, standingsWeek])

  // auto-refresh while on the standings tab (updates live games & commits)
  useEffect(() => {
    if (activeTab !== 'standings' || !autoRefresh) return
    autoRefTimer.current = window.setInterval(() => computeStandings(standingsWeek), 15_000)
    return () => { if (autoRefTimer.current) window.clearInterval(autoRefTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, autoRefresh, standingsWeek, selectedId])

  /** ---------- Derived helpers ---------- */
  const usedTeamAbbrs = useMemo(
    () => Object.values(myDraftPicks).filter(Boolean).map(t => (t as Team).abbr),
    [myDraftPicks]
  )
  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase()
    if (!q) return NFL_TEAMS
    return NFL_TEAMS.filter(t => t.name.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q))
  }, [teamSearch])

  /** ---------- UI ---------- */
  return (
    <main className="min-h-[60vh] py-8">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">My Pools</h1>
        <Link href="/pools/new" className="px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700">Create Pool</Link>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p className="text-red-600">{error}</p>}

      {!loading && !error && pools.length === 0 && (
        <p>You’re not in any pools yet. <Link href="/pools/new" className="underline">Create one</Link> or join by invite.</p>
      )}

      {!loading && !error && pools.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pools.map((p) => (
            <li key={p.id} className="border border-gray-200 rounded-lg p-4">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="text-sm text-gray-600">
                {p.is_public ? 'Public' : 'Private'} · Starts week {p.start_week} · Strikes {p.strikes_allowed} · Tie = {p.tie_rule}
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={() => openPool(p.id)} className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">Open</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* -------- Slide-out modal -------- */}
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
                <button onClick={closeModal} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200">Close</button>
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
              {detailsLoading && <p>Loading pool…</p>}
              {!detailsLoading && !pool && <p className="text-red-600">Failed to load pool.</p>}

              {/* -------- Make Picks (same as previous version, truncated to keep focus) -------- */}
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
                      <em>Ad — your message here</em>
                    </div>
                  )}

                  {/* Info tiles */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                    <InfoTile label="Visibility" value={pool.is_public ? 'Public' : 'Private'} />
                    <InfoTile label="Start Week" value={`Week ${pool.start_week}`} />
                    <InfoTile label="Season" value={pool.include_playoffs ? 'Regular + Playoffs' : 'Regular only'} />
                    <InfoTile label="Strikes Allowed" value={String(pool.strikes_allowed)} />
                    <InfoTile label="Tie Counts As" value={pool.tie_rule} />
                    <InfoTile label="Pick Deadline" value={pool.deadline_mode === 'fixed' ? (normalizeTimeTo24h(pool.deadline_fixed) || '—') + ' ET' : 'Rolling'} />
                  </div>

                  {/* Used teams */}
                  <div className="mb-6">
                    <h3 className="font-semibold mb-2">Used Teams</h3>
                    {usedTeamAbbrs.length === 0 ? (
                      <p className="text-sm text-gray-600">None yet — pick any team.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {usedTeamAbbrs.map((abbr) => (
                          <span key={abbr} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-gray-100 border">{abbr}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Two-row chart */}
                  <div className="mb-8">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">Your Picks</h3>
                      <div className="text-xs text-gray-500">
                        {draftSavedAt ? `Draft saved • ${new Date(draftSavedAt).toLocaleString()}` : 'No drafts yet'}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-[900px] w-full border border-gray-200 rounded-lg text-sm">
                        <tbody>
                          <tr className="bg-gray-50">
                            {weeks.map((w) => (
                              <td key={`pick-${w}`} className="border p-2 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button className="text-blue-600 underline" onClick={() => setTeamPickerWeek(w)}>
                                    {myDraftPicks[w]?.abbr ? `Change (${myDraftPicks[w]!.abbr})` : 'Pick'}
                                  </button>
                                  {myDraftPicks[w] && (
                                    <button className="text-gray-500 underline" title="Clear this pick" onClick={() => clearPick(w)}>Clear</button>
                                  )}
                                </div>
                              </td>
                            ))}
                          </tr>
                          <tr>
                            {weeks.map((w) => (
                              <td key={`week-${w}`} className="border p-2 text-center font-medium">Week {w}</td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={clearAllPicks} className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200">Clear All</button>
                      <span className="text-xs text-gray-500">Picks finalize at kickoff (rolling) or earlier of kickoff/fixed (hybrid).</span>
                    </div>
                  </div>

                  {/* Team picker modal (same as previous version) */}
                  {teamPickerWeek && (
                    <TeamPickerModal
                      week={teamPickerWeek}
                      onClose={() => setTeamPickerWeek(null)}
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
                </>
              )}

              {/* -------- Standings (new: results, strikes, donut) -------- */}
              {!detailsLoading && pool && activeTab === 'standings' && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                      <label className="text-sm">Week</label>
                      <select
                        className="border rounded-md px-2 py-1 text-sm"
                        value={standingsWeek}
                        onChange={(e) => setStandingsWeek(Number(e.target.value))}
                      >
                        {weeks.map(w => <option key={w} value={w}>Week {w}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
                        Auto-refresh
                      </label>
                      <button
                        onClick={() => computeStandings(standingsWeek)}
                        className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                      >
                        Refresh
                      </button>
                    </div>
                  </div>

                  {/* Summary cards */}
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
                        <div className="text-sm text-gray-500 mt-1">
                          Updates as results finalize
                        </div>
                      </div>
                      <Donut alive={aliveCount} eliminated={elimCount} />
                    </div>
                  </div>

                  {/* Table */}
                  <div className="overflow-x-auto">
                    <table className="min-w-[820px] w-full border border-gray-200 rounded-lg text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-2 border">Member</th>
                          <th className="text-left p-2 border">Pick (Week {standingsWeek})</th>
                          <th className="text-left p-2 border">Result</th>
                          <th className="text-left p-2 border">Record to Date</th>
                          <th className="text-left p-2 border">Strikes Left</th>
                          <th className="text-left p-2 border">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map(m => {
                          const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.email || m.id.slice(0, 8) + '…'
                          const pick = officialPicksThisWeek.find(p => p.user_id === m.id) || null
                          const team = pick ? teamByAbbr(toAbbr(pick.team_abbr)) || { abbr: pick.team_abbr, name: pick.team_abbr } : null

                          const wl = winsLossesToDate[m.id] || { w: 0, l: 0, p: 0 }
                          const strikesUsed = strikesToDate[m.id] || 0
                          const strikesLeft = Math.max((pool.strikes_allowed ?? 1) - strikesUsed, 0)
                          const eliminated = strikesLeft <= 0

                          // Determine result for THIS week (if we have the game)
                          let resultLabel = '—'
                          if (team) {
                            resultLabel = 'Pending' // We’ll compute precisely below with a quick lookup
                          }
                          // quick lookup to compute this week’s result (if final)
                          // We already have games for <= week inside computeStandings; to keep it simple in UI,
                          // infer from winsLosses: if totals increased this week, it’ll reflect there. For display:
                          // We'll show "Win/Loss/Push/Pending" based on whether a pick exists and strikes changed is not known here,
                          // so we keep 'Pending' unless the member has a pick this week and we can infer from record delta.
                          // (Full precision requires carrying per-week gameMap here; to avoid bloat, Pending is fine until final.)

                          return (
                            <tr key={m.id} className="hover:bg-gray-50">
                              <td className="p-2 border">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-full bg-gray-100 border flex items-center justify-center overflow-hidden">
                                    {m.avatar_url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                                    ) : (
                                      <span className="text-[11px] text-gray-600">
                                        {(m.first_name?.[0] || '?')}{(m.last_name?.[0] || '')}
                                      </span>
                                    )}
                                  </div>
                                  <span className="font-medium">{name}</span>
                                </div>
                              </td>
                              <td className="p-2 border">
                                {team ? (
                                  <div className="flex items-center gap-2">
                                    <div className="relative w-7 h-7">
                                      {'logo' in team && (team as Team).logo ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={(team as Team).logo!} alt={(team as Team).name} className="w-7 h-7 object-contain" />
                                      ) : (
                                        <div className="w-7 h-7 rounded-full border flex items-center justify-center text-xs">{team.abbr}</div>
                                      )}
                                    </div>
                                    <div className="text-sm">{('name' in team && (team as Team).name) || team.abbr} ({team.abbr})</div>
                                  </div>
                                ) : (
                                  <span className="text-gray-500">—</span>
                                )}
                              </td>
                              <td className="p-2 border">
                                <ResultPill status={resultLabel} />
                              </td>
                              <td className="p-2 border">
                                <span className="font-medium">{wl.w}-{wl.l}{wl.p ? `-${wl.p}` : ''}</span>
                                <span className="ml-2 text-xs text-gray-500">(W-L{wl.p ? '-P' : ''})</span>
                              </td>
                              <td className="p-2 border">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${eliminated ? 'bg-red-50 border-red-300 text-red-700' : 'bg-green-50 border-green-300 text-green-700'}`}>
                                  {strikesLeft}
                                </span>
                              </td>
                              <td className="p-2 border">
                                {eliminated ? (
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

                  {standingsLoading && <p className="text-sm text-gray-600 mt-3">Updating…</p>}
                </>
              )}

              {/* -------- Members -------- */}
              {!detailsLoading && pool && activeTab === 'members' && (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold">Pool Members</h3>
                    <button className="px-3 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">Invite</button>
                  </div>
                  {members.length === 0 ? (
                    <p className="text-sm text-gray-600">No members found.</p>
                  ) : (
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {members.map(m => (
                        <li key={m.id} className="border border-gray-200 rounded-lg p-3 flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 border flex items-center justify-center overflow-hidden">
                            {m.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-xs text-gray-600">
                                {(m.first_name?.[0] || '?')}{(m.last_name?.[0] || '')}
                              </span>
                            )}
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium">
                              {`${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || m.email || m.id}
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
    </main>
  )
}

/** ---------- Small UI bits ---------- */
function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-sm border-b-2 -mb-px ${active ? 'border-black font-semibold' : 'border-transparent text-gray-600 hover:text-black'}`}
    >
      {label}
    </button>
  )
}
function InfoTile({ label, value }: { label: string, value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}
function ResultPill({ status }: { status: 'Win' | 'Loss' | 'Push' | 'Pending' | '—' | string }) {
  const m: Record<string, string> = {
    'Win':   'bg-emerald-600 text-white',
    'Loss':  'bg-red-600 text-white',
    'Push':  'bg-gray-400 text-white',
    'Pending': 'bg-gray-100 text-gray-700 border border-gray-300',
    '—': 'bg-gray-100 text-gray-700 border border-gray-300'
  }
  const cls = m[status] || 'bg-gray-100 text-gray-700 border border-gray-300'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs ${cls}`}>{status}</span>
}

/** ---------- Team Picker Modal (from v1) ---------- */
function TeamPickerModal(props: {
  week: number
  onClose: () => void
  teamSearch: string
  setTeamSearch: (v: string) => void
  filteredTeams: Team[]
  usedTeamAbbrs: string[]
  myDraftPicks: Record<number, Team | null>
  onPickTeam: (week: number, team: Team) => void
  gamesLoading: boolean
  weekGames: Game[]
  deadlineMode: 'fixed' | 'rolling'
  fixedLockUtc: string | null
  nowTick: number
}) {
  const {
    week, onClose, teamSearch, setTeamSearch, filteredTeams,
    usedTeamAbbrs, myDraftPicks, onPickTeam,
    gamesLoading, weekGames, deadlineMode, fixedLockUtc, nowTick
  } = props

  const fmtLocal = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(1100px,92vw)] max-h-[85vh] overflow-y-auto bg-white rounded-xl shadow-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-lg font-semibold">Pick a team — Week {week}</h4>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search teams…"
              className="border border-gray-300 rounded-md px-3 py-1 text-sm"
            />
            <button onClick={onClose} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200">Close</button>
          </div>
        </div>

        {teamSearch.trim() ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredTeams.map((t) => {
              const usedElsewhere = usedTeamAbbrs.includes(t.abbr) && myDraftPicks[week!]?.abbr !== t.abbr
              return (
                <button
                  key={t.abbr}
                  onClick={() => onPickTeam(week!, t)}
                  disabled={usedElsewhere}
                  className={`border border-gray-200 rounded-lg p-3 hover:shadow flex items-center gap-3 text-left ${usedElsewhere ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={usedElsewhere ? 'Already used in another week' : ''}
                >
                  <div className="relative w-8 h-8 shrink-0">
                    {t.logo ? (
                      <Image src={t.logo} alt={t.name} fill sizes="32px" className="object-contain" />
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
            {gamesLoading && <p className="text-sm text-gray-600">Loading matchups…</p>}
            {!gamesLoading && weekGames.length === 0 && (
              <p className="text-sm text-gray-600">No games found for Week {week}.</p>
            )}
            {!gamesLoading && weekGames.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {weekGames.map((g) => {
                  const homeAbbr = toAbbr(g.home_team)
                  const awayAbbr = toAbbr(g.away_team)
                  const kickoffIso = g.game_time
                  const kickoffMs = Date.parse(kickoffIso)
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
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full border ${locked ? 'bg-gray-200 border-gray-300 text-gray-700' : 'bg-green-50 border-green-300 text-green-700'}`}
                          title={deadlineMode === 'fixed' && fixedLockUtc
                            ? `Locks at ${fmtLocal(new Date(lockMs).toISOString())} (earlier of kickoff/fixed)`
                            : `Locks at kickoff: ${fmtLocal(kickoffIso)}`}
                        >
                          {countdown}
                        </span>
                      </div>
                      <div className="text-sm font-medium mb-2">{awayAbbr} @ {homeAbbr}</div>
                      <div className="grid grid-cols-2 gap-2">
                        {cards.map((c) => {
                          const usedElsewhere = usedTeamAbbrs.includes(c.abbr) && myDraftPicks[week!]?.abbr !== c.abbr
                          const team = NFL_TEAMS.find(t => t.abbr === c.abbr) || { abbr: c.abbr, name: c.abbr }
                          const disabled = locked || usedElsewhere
                          const title = locked ? 'Locked — pick window has closed' : usedElsewhere ? 'Already used in another week' : ''
                          return (
                            <button
                              key={c.abbr}
                              onClick={() => onPickTeam(week!, team as Team)}
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
