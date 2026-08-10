'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getErrorMessage } from '@/lib/errorMessage'
import { poolCapacityLabel } from '@/lib/poolCapacity'
import { supabase } from '@/lib/supabaseClient'

type Pool = {
  id: string
  name: string
  created_by: string

  is_public: boolean
  allow_discovery: boolean

  start_week: number
  include_playoffs: boolean
  strikes_allowed: string | null
  tie_rule: 'win' | 'loss' | 'push' | null
  double_pick_weeks: number[] | null
  max_members: number | null
  allow_multiple_entries: boolean | null
  max_entries_per_user: number | null

  deadline_mode: 'fixed' | 'rolling' | null
  deadline_fixed: string | null
  notes: string | null

  archived: boolean
  archived_at: string | null

  season: number | null
  cloned_from_pool_id: string | null

  created_at?: string | null
}

const ARCHIVE_POOL_SELECT =
  'id, name, created_by, is_public, allow_discovery, start_week, include_playoffs, strikes_allowed, tie_rule, double_pick_weeks, deadline_mode, deadline_fixed, notes, archived, archived_at, season, cloned_from_pool_id, created_at, max_members, allow_multiple_entries, max_entries_per_user'

const EMPTY_LABEL = '-'

function nextSeasonDefault() {
  return new Date().getFullYear() + 1
}

function nextSeasonForPool(pool: Pool) {
  return (pool.season || new Date().getFullYear()) + 1
}

function safeDateMs(iso?: string | null) {
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

function formatDateTime(iso?: string | null) {
  if (!iso) return EMPTY_LABEL
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return EMPTY_LABEL
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function titleCase(value?: string | null) {
  if (!value) return EMPTY_LABEL
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDeadline(pool: Pool) {
  if (pool.deadline_mode === 'rolling') return 'Rolling kickoff'
  return 'Sunday 1 PM ET'
}

function formatEntries(pool: Pool) {
  if (!pool.allow_multiple_entries) return 'No'
  return `Up to ${pool.max_entries_per_user || 1}`
}

function formatDoubleWeeks(pool: Pool) {
  const weeks = (pool.double_pick_weeks || []).filter((week) => Number.isFinite(week)).sort((a, b) => a - b)
  if (weeks.length === 0) return 'None'
  return weeks.map((week) => `W${week}`).join(', ')
}

export default function ArchivesPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [pools, setPools] = useState<Pool[]>([])

  // New season modal
  const [modalOpen, setModalOpen] = useState(false)
  const [activePool, setActivePool] = useState<Pool | null>(null)
  const [season, setSeason] = useState<number>(nextSeasonDefault())
  const [running, setRunning] = useState(false)
  const [modalErr, setModalErr] = useState<string | null>(null)

  const seasonOptions = useMemo(() => {
    const base = new Date().getFullYear()
    return [base - 1, base, base + 1, base + 2]
  }, [])

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser()
        if (userErr) throw userErr
        if (!user) throw new Error('You must be signed in.')

        if (!alive) return
        setUserId(user.id)

        // 1) Pools you created that are archived
        const { data: createdArchived, error: createdErr } = await supabase
          .from('pools')
          .select(ARCHIVE_POOL_SELECT)
          .eq('archived', true)
          .eq('created_by', user.id)

        if (createdErr) throw createdErr

        // 2) Pools you're a member of (archived)
        const { data: memRows, error: memErr } = await supabase
          .from('pool_members')
          .select('pool_id')
          .eq('profile_id', user.id)

        if (memErr) throw memErr

        let memberArchived: Pool[] = []
        const ids = (memRows || []).map((r) => r.pool_id)

        if (ids.length > 0) {
          const { data: memberPools, error: memberPoolsErr } = await supabase
            .from('pools')
            .select(ARCHIVE_POOL_SELECT)
            .eq('archived', true)
            .in('id', ids)

          if (memberPoolsErr) throw memberPoolsErr
          memberArchived = (memberPools || []) as Pool[]
        }

        // De-dupe + sort newest first
        const map = new Map<string, Pool>()
        for (const p of (createdArchived || []) as Pool[]) map.set(p.id, p)
        for (const p of memberArchived) map.set(p.id, p)

        const merged = Array.from(map.values()).sort((a, b) => {
          const aMs = safeDateMs(a.archived_at) || safeDateMs(a.created_at)
          const bMs = safeDateMs(b.archived_at) || safeDateMs(b.created_at)
          return bMs - aMs
        })

        if (!alive) return
        setPools(merged)
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load archived pools.'))
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => {
      alive = false
    }
  }, [])

  const openRunBack = (p: Pool) => {
    setActivePool(p)
    setSeason(nextSeasonForPool(p))
    setModalErr(null)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (running) return
    setModalOpen(false)
    setActivePool(null)
    setModalErr(null)
  }

  const runItBack = async () => {
    if (!activePool) return
    if (!userId || activePool.created_by !== userId) {
      setModalErr('Only the pool owner can create next season from this archive.')
      return
    }

    setRunning(true)
    setModalErr(null)

    try {
      const { data, error } = await supabase.rpc('clone_pool_for_new_season', {
        p_old_pool_id: activePool.id,
        p_new_season: season,
      })
      if (error) throw error

      const newPoolId = data as string
      if (!newPoolId) throw new Error('Clone succeeded but no pool id was returned.')

      router.push(`/pools/${newPoolId}/admin`)
    } catch (e: unknown) {
      setModalErr(getErrorMessage(e, 'Failed to create next season.'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Profile</p>
            <h1 className="text-3xl font-bold text-slate-950">History</h1>
            <p className="mt-1 text-sm text-slate-600">Archived pools stay here so your active dashboard stays clean.</p>
          </div>
          <Link href="/profile" className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50">
            Back to Profile
          </Link>
        </div>

        <div className="mb-5 rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
          Archiving removes a pool from the active dashboard without deleting its history. Creating next season copies the pool settings into a fresh pool and gives you an invite list for last season&apos;s members. Members, picks, standings, and results are not copied.
        </div>

        {loading && <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Loading...</p>}
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

        {!loading && !error && pools.length === 0 && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">No history yet.</div>}

        {!loading && !error && pools.length > 0 && (
          <ul className="grid gap-4 lg:grid-cols-2">
            {pools.map((p) => {
              const canRunBack = !!userId && p.created_by === userId
              const archivedLabel = formatDateTime(p.archived_at)
              const seasonLabel = p.season ?? EMPTY_LABEL
              const strikesLabel = p.strikes_allowed ?? EMPTY_LABEL
              const tieLabel = titleCase(p.tie_rule)

              return (
                <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-xl font-bold text-slate-950">{p.name}</h2>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">Archived</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.is_public ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-900 text-white'}`}>
                          {p.is_public ? 'Public' : 'Private'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Archived {archivedLabel}</p>
                      {p.cloned_from_pool_id && <p className="mt-1 text-xs text-slate-500">Created from a previous pool</p>}
                    </div>

                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Link href={`/pools/${p.id}`} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                        View
                      </Link>

                      {canRunBack && (
                        <button onClick={() => openRunBack(p)} className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                          Create next season
                        </button>
                      )}
                    </div>
                  </div>

                  <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-2">
                    <ArchiveFact label="Season" value={String(seasonLabel)} />
                    <ArchiveFact label="Start week" value={`Week ${p.start_week}`} />
                    <ArchiveFact label="Deadline" value={formatDeadline(p)} />
                    <ArchiveFact label="Mulligans allowed" value={String(strikesLabel)} />
                    <ArchiveFact label="Tie" value={tieLabel} />
                    <ArchiveFact label="Total entries" value={poolCapacityLabel(p.max_members)} />
                    <ArchiveFact label="Multiple entries" value={formatEntries(p)} />
                    <ArchiveFact label="Double-pick weeks" value={formatDoubleWeeks(p)} />
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Create next season modal */}
      {modalOpen && activePool && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(620px,92vw)] bg-white rounded-xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Create next season</h2>
              <button onClick={closeModal} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200" disabled={running}>
                Close
              </button>
            </div>

            <p className="text-sm text-gray-700 mb-4">
              This creates a <b>fresh</b> pool from <b>{activePool.name}</b>. It copies settings and gives you a re-invite list for last season&apos;s members. Members, picks, standings, and results are not copied.
            </p>

            <div className="border rounded-lg p-3 mb-4 bg-gray-50">
              <div className="text-sm font-semibold">{activePool.name}</div>
              <div className="text-xs text-gray-600 mt-1">
                Start Week {activePool.start_week} | Mulligans {activePool.strikes_allowed ?? EMPTY_LABEL} | NFL tie {titleCase(activePool.tie_rule)} |{' '}
                {activePool.include_playoffs ? 'Regular + Playoffs' : 'Regular only'}
              </div>
              <div className="mt-1 text-xs text-gray-600">
                {activePool.is_public ? 'Public search settings carry over.' : 'Private password settings carry over.'}
              </div>
            </div>

            <label className="block mb-2">
              <div className="text-sm font-medium mb-1">New season</div>
              <select value={season} onChange={(e) => setSeason(Number(e.target.value))} className="w-full border rounded-md px-3 py-2" disabled={running}>
                {seasonOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>

            {modalErr && <div className="text-sm text-red-600 mt-2">{modalErr}</div>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={closeModal} className="px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300" disabled={running}>
                Cancel
              </button>
              <button onClick={runItBack} className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50" disabled={running}>
                {running ? 'Creating...' : 'Create next season'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function ArchiveFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-slate-900">{value}</dd>
    </div>
  )
}
