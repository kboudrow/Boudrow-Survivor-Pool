'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import NextImage from 'next/image'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type Pool = {
  id: string
  name: string
  is_public: boolean
  allow_discovery: boolean
  start_week: number
  include_playoffs: boolean
  strikes_allowed: string | null
  tie_rule: string | null
  deadline_mode: string | null
  deadline_fixed: string | null
  notes: string | null
  created_by: string
  created_at?: string | null
}

function formatPoolMeta(pool: Pool) {
  return `${pool.is_public ? 'Public' : 'Private'} - Starts week ${pool.start_week} - Strikes ${pool.strikes_allowed ?? '-'} - Tie = ${pool.tie_rule ?? '-'}`
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}

export default function JoinSearchPage() {
  const router = useRouter()

  const [authed, setAuthed] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [joinedPoolIds, setJoinedPoolIds] = useState<Set<string>>(new Set())

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Pool[]>([])
  const [error, setError] = useState<string | null>(null)

  const [recentLoading, setRecentLoading] = useState(false)
  const [recent, setRecent] = useState<Pool[]>([])

  const [selected, setSelected] = useState<Pool | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [joining, setJoining] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmMsg, setConfirmMsg] = useState('')
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    let alive = true

    const loadAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!alive) return
      setAuthed(!!user)
      setUserId(user?.id ?? null)

      if (!user) {
        setJoinedPoolIds(new Set())
        return
      }

      const { data: memberships } = await supabase.from('pool_members').select('pool_id').eq('profile_id', user.id)
      if (!alive) return
      setJoinedPoolIds(new Set((memberships || []).map((row) => row.pool_id)))
    }

    loadAuth()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true

    const loadRecent = async () => {
      try {
        setRecentLoading(true)
        setError(null)

        const {
          data: { user },
        } = await supabase.auth.getUser()

        let excludePoolIds: string[] = []

        if (user) {
          const [{ data: memRows }, { data: createdRows }] = await Promise.all([
            supabase.from('pool_members').select('pool_id').eq('profile_id', user.id),
            supabase.from('pools').select('id').eq('created_by', user.id),
          ])

          excludePoolIds = Array.from(new Set([...(memRows || []).map((row) => row.pool_id), ...(createdRows || []).map((row) => row.id)]))
        }

        let request = supabase
          .from('pools')
          .select('id, name, is_public, allow_discovery, start_week, include_playoffs, strikes_allowed, tie_rule, deadline_mode, deadline_fixed, notes, created_by, created_at')
          .eq('archived', false)
          .eq('allow_discovery', true)
          .order('created_at', { ascending: false })
          .limit(30)

        if (excludePoolIds.length > 0) {
          request = request.not('id', 'in', `(${excludePoolIds.join(',')})`)
        }

        const { data, error } = await request
        if (error) throw error
        if (!alive) return

        setRecent((data || []) as Pool[])
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load pools.'))
      } finally {
        if (alive) setRecentLoading(false)
      }
    }

    loadRecent()
    return () => {
      alive = false
    }
  }, [])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runSearch = useCallback((term: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      const trimmed = term.trim()
      setSearching(true)
      setError(null)

      try {
        if (!trimmed) {
          setResults([])
          return
        }

        const { data, error } = await supabase.rpc('search_pools', {
          p_term: trimmed,
        })

        if (error) throw error
        setResults((data || []) as Pool[])
      } catch (e: unknown) {
        setError(getErrorMessage(e, 'Search failed.'))
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  useEffect(() => {
    runSearch(query)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, runSearch])

  const openPoolModal = async (pool: Pool) => {
    setSelected(pool)
    setShowPassword(false)
    setPassword('')
    setMemberCount(null)
    setError(null)

    try {
      const { data: count, error } = await supabase.rpc('count_pool_members', { p_pool_id: pool.id })
      if (error) throw error
      setMemberCount((count as number) ?? 0)
    } catch {
      setMemberCount(null)
    }
  }

  const closePoolModal = () => {
    setSelected(null)
    setShowPassword(false)
    setPassword('')
    setError(null)
  }

  const requireAuth = async (): Promise<boolean> => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) return true
    router.push('/')
    return false
  }

  const askConfirm = (message: string, action: () => Promise<void>) => {
    setConfirmMsg(message)
    setPendingAction(() => action)
    setConfirmOpen(true)
  }

  const doConfirm = async () => {
    if (!pendingAction) return
    setConfirmOpen(false)
    const action = pendingAction
    setPendingAction(null)
    await action()
  }

  const joinSelectedPool = async () => {
    if (!selected) return
    if (!(await requireAuth())) return

    setJoining(true)
    setError(null)

    try {
      const { error } = await supabase.rpc('join_pool', {
        p_pool_id: selected.id,
        p_password: selected.is_public ? null : password || null,
      })

      if (error) throw error
      setJoinedPoolIds((prev) => new Set(prev).add(selected.id))
      router.push(`/pools?pool=${selected.id}`)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Join failed.'))
    } finally {
      setJoining(false)
    }
  }

  const listToShow = query.trim() ? results : recent
  const showEmptySearch = !searching && results.length === 0 && query.trim()
  const showEmptyRecent = !recentLoading && !query.trim() && recent.length === 0
  const selectedAlreadyJoined = selected ? joinedPoolIds.has(selected.id) : false
  const selectedOwnedByMe = selected ? selected.created_by === userId : false

  return (
    <main className="min-h-[70vh] py-8 px-4">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center gap-3 mb-4">
          <NextImage src="/football.png" alt="Football" width={36} height={36} />
          <h1 className="text-2xl font-bold">Join a Pool</h1>
        </div>

        {error && <div className="mb-3 text-red-600">{error}</div>}

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search public and discoverable private pools"
          className="w-full border rounded-md px-3 py-2 mb-3"
        />

        {query.trim() ? (
          searching ? (
            <p className="text-sm text-gray-600">Searching...</p>
          ) : (
            <p className="text-sm text-gray-600">Search results</p>
          )
        ) : recentLoading ? (
          <p className="text-sm text-gray-600">Loading pools...</p>
        ) : (
          <p className="text-sm text-gray-600">Newest pools you can join</p>
        )}

        <ul className="divide-y rounded-md border">
          {listToShow.map((pool) => (
            <li key={pool.id} className="p-3 hover:bg-gray-50 cursor-pointer" onClick={() => openPoolModal(pool)}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium">{pool.name}</div>
                  <div className="text-xs text-gray-600">{formatPoolMeta(pool)}</div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {pool.created_by === userId && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">Your pool</span>
                  )}
                  {joinedPoolIds.has(pool.id) && (
                    <span className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs text-blue-700">Joined</span>
                  )}
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      pool.is_public ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-gray-100 border-gray-300 text-gray-700'
                    }`}
                  >
                    {pool.is_public ? 'Open' : 'Locked'}
                  </span>
                </div>
              </div>
            </li>
          ))}

          {showEmptySearch && <li className="p-3 text-sm text-gray-600">No pools match &quot;{query}&quot;.</li>}
          {showEmptyRecent && <li className="p-3 text-sm text-gray-600">No pools are available to join right now.</li>}
        </ul>

        {!authed && <p className="text-xs text-gray-500 mt-3">Tip: you can browse pools without signing in, but you will need to sign in to join.</p>}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={closePoolModal} />
          <div className="absolute left-1/2 top-1/2 w-[min(720px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-4 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{selected.name}</h3>
              <button onClick={closePoolModal} className="rounded-md bg-gray-100 px-3 py-1 hover:bg-gray-200">
                Close
              </button>
            </div>

            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <Info label="Visibility" value={selected.is_public ? 'Public' : 'Private'} />
              <Info label="Members" value={memberCount !== null ? String(memberCount) : '-'} />
              <Info label="Strikes Allowed" value={String(selected.strikes_allowed ?? '-')} />
              <Info label="Tie Counts As" value={selected.tie_rule ?? '-'} />
              <Info label="Start Week" value={`Week ${selected.start_week}`} />
              <Info label="Deadline" value={selected.deadline_mode === 'rolling' ? 'Rolling (kickoff)' : selected.deadline_fixed || 'Sun 1:00 PM ET'} />
            </div>

            {selected.notes && <p className="mb-3 text-sm text-gray-700">{selected.notes}</p>}

            {selectedAlreadyJoined || selectedOwnedByMe ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-emerald-700">{selectedOwnedByMe ? 'You created this pool.' : 'You are already a member of this pool.'}</span>
                <button onClick={() => router.push(`/pools?pool=${selected.id}`)} className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
                  Open Pool
                </button>
              </div>
            ) : selected.is_public ? (
              <button
                onClick={() => askConfirm(`Are you sure you want to join "${selected.name}"?`, joinSelectedPool)}
                disabled={joining}
                className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {joining ? 'Joining...' : 'Join Pool'}
              </button>
            ) : !showPassword ? (
              <button onClick={() => setShowPassword(true)} className="rounded-md bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700">
                Join (Enter Password)
              </button>
            ) : (
              <div className="mt-3 rounded-md border bg-gray-50 p-3">
                <label className="block">
                  <div className="mb-1 text-sm font-medium">Password (case-sensitive)</div>
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && password.trim()) {
                        askConfirm(`Are you sure you want to join "${selected.name}"?`, joinSelectedPool)
                      }
                    }}
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="Enter password"
                    type="password"
                  />
                </label>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => askConfirm(`Are you sure you want to join "${selected.name}"?`, joinSelectedPool)}
                    disabled={joining || !password.trim()}
                    className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {joining ? 'Joining...' : 'Submit & Join'}
                  </button>
                  <button
                    onClick={() => {
                      setShowPassword(false)
                      setPassword('')
                    }}
                    className="rounded-md bg-gray-200 px-3 py-2 hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-xl">
            <h4 className="mb-2 text-lg font-semibold">Confirm Join</h4>
            <p className="mb-4 text-sm text-gray-700">{confirmMsg}</p>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} className="rounded-md bg-gray-200 px-3 py-2 hover:bg-gray-300">
                Cancel
              </button>
              <button onClick={doConfirm} className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700">
                Yes, Join
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
