'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type Pool = {
  id: string
  name: string
  created_by: string

  is_public: boolean
  allow_discovery: boolean

  start_week: number
  include_playoffs: boolean
  strikes_allowed: number | null
  tie_rule: 'win' | 'loss' | 'push' | null

  deadline_mode: 'fixed' | 'rolling' | null
  deadline_fixed: string | null
  notes: string | null

  archived: boolean
  archived_at: string | null

  season: number | null
  cloned_from_pool_id: string | null

  created_at?: string | null
}

function nextSeasonDefault() {
  // Simple +1 (good enough for now)
  return new Date().getFullYear() + 1
}

function safeDateMs(iso?: string | null) {
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

export default function ArchivesPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [pools, setPools] = useState<Pool[]>([])

  // Run-it-back modal
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
          .select(
            'id, name, created_by, is_public, allow_discovery, start_week, include_playoffs, strikes_allowed, tie_rule, deadline_mode, deadline_fixed, notes, archived, archived_at, season, cloned_from_pool_id, created_at'
          )
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
            .select(
              'id, name, created_by, is_public, allow_discovery, start_week, include_playoffs, strikes_allowed, tie_rule, deadline_mode, deadline_fixed, notes, archived, archived_at, season, cloned_from_pool_id, created_at'
            )
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
    setSeason(nextSeasonDefault())
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
      setModalErr('Only the pool owner can run this back.')
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

      router.push(`/pools/${newPoolId}`)
    } catch (e: unknown) {
      setModalErr(getErrorMessage(e, 'Failed to run it back.'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="min-h-[70vh] py-8 px-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Archived Pools</h1>
          <Link href="/pools" className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
            Back to My Pools
          </Link>
        </div>

        {loading && <p>Loading…</p>}
        {error && <p className="text-red-600">{error}</p>}

        {!loading && !error && pools.length === 0 && (
          <div className="border rounded-lg p-4 text-sm text-gray-700">No archived pools yet.</div>
        )}

        {!loading && !error && pools.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {pools.map((p) => {
              const canRunBack = !!userId && p.created_by === userId
              const archivedLabel = p.archived_at ? new Date(p.archived_at).toLocaleString() : '—'
              const seasonLabel = p.season ?? '—'
              const strikesLabel = p.strikes_allowed ?? '—'
              const tieLabel = p.tie_rule ?? '—'

              return (
                <li key={p.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">{p.name}</div>
                      <div className="text-xs text-gray-600 mt-1">
                        {p.is_public ? 'Public' : 'Private'} · Start Week {p.start_week} · Strikes {strikesLabel} · Tie {tieLabel}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Season: {seasonLabel} · Archived: {archivedLabel}
                      </div>
                      {p.cloned_from_pool_id && (
                        <div className="text-xs text-gray-500 mt-1">
                          Cloned from: {p.cloned_from_pool_id.slice(0, 8)}…
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <Link href={`/pools/${p.id}`} className="px-3 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm">
                        View
                      </Link>

                      {canRunBack && (
                        <button onClick={() => openRunBack(p)} className="px-3 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 text-sm">
                          Run it back
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Run it back modal */}
      {modalOpen && activePool && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closeModal} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(620px,92vw)] bg-white rounded-xl shadow-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold">Run it back</h2>
              <button onClick={closeModal} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200" disabled={running}>
                Close
              </button>
            </div>

            <p className="text-sm text-gray-700 mb-4">
              This creates a <b>new</b> pool for a new season with the same settings, but it will start <b>empty</b>.
              You’ll share a fresh invite link with last year’s group.
            </p>

            <div className="border rounded-lg p-3 mb-4 bg-gray-50">
              <div className="text-sm font-semibold">{activePool.name}</div>
              <div className="text-xs text-gray-600 mt-1">
                Start Week {activePool.start_week} · Strikes {activePool.strikes_allowed ?? '—'} · Tie {activePool.tie_rule ?? '—'} ·{' '}
                {activePool.include_playoffs ? 'Regular + Playoffs' : 'Regular only'}
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
                {running ? 'Creating…' : 'Create new season pool'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
