'use client'

import { useEffect, useRef, useState } from 'react'
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

export default function JoinSearchPage() {
  const router = useRouter()

  const [authed, setAuthed] = useState(false)

  // search
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Pool[]>([])
  const [error, setError] = useState<string | null>(null)

  // recent pools shown underneath search bar
  const [recentLoading, setRecentLoading] = useState(false)
  const [recent, setRecent] = useState<Pool[]>([])

  // Details modal
  const [selected, setSelected] = useState<Pool | null>(null)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [password, setPassword] = useState('')
  const [joining, setJoining] = useState(false)

  // Confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmMsg, setConfirmMsg] = useState('')
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null)

  // auth state
  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setAuthed(!!user)
    })()
  }, [])

  // load recent discoverable pools (NOT archived) — exclude pools I'm already in
  useEffect(() => {
    let alive = true

    const loadRecent = async () => {
      try {
        setRecentLoading(true)
        setError(null)

        // Try to get current user; if not logged in, we show general "newest pools"
        const { data: { user } } = await supabase.auth.getUser()

        let excludePoolIds: string[] = []

        if (user) {
          // Get all pools the user is already a member of
          const { data: memRows, error: memErr } = await supabase
            .from('pool_members')
            .select('pool_id')
            .eq('profile_id', user.id)

          if (!memErr) {
            excludePoolIds = (memRows || []).map((r) => r.pool_id)
          }

          // Also exclude pools the user created (optional, but usually what you want on a "join" page)
          const { data: createdRows, error: createdErr } = await supabase
            .from('pools')
            .select('id')
            .eq('created_by', user.id)

          if (!createdErr) {
            excludePoolIds = excludePoolIds.concat((createdRows || []).map((r) => r.id))
          }

          // De-dupe
          excludePoolIds = Array.from(new Set(excludePoolIds))
        }

        // Base query: newest, discoverable, not archived
        let q = supabase
          .from('pools')
          .select(
            'id, name, is_public, allow_discovery, start_week, include_playoffs, strikes_allowed, tie_rule, deadline_mode, deadline_fixed, notes, created_by, created_at'
          )
          .eq('archived', false)
          .eq('allow_discovery', true)
          .order('created_at', { ascending: false })
          .limit(30)

        // Exclude pools user is already in/created (only if we have ids)
        if (excludePoolIds.length > 0) {
          q = q.not('id', 'in', `(${excludePoolIds.join(',')})`)
        }

        const { data, error } = await q
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

  // debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const runSearch = (term: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const q = term.trim()
      setSearching(true)
      setError(null)

      try {
        if (!q) {
          setResults([])
        } else {
          // Use RPC to search, which should already filter archived=false
          const { data, error } = await supabase.rpc('search_pools', {
            p_query: q,
            p_limit: 50
          })

          if (error) throw error
          setResults((data || []) as Pool[])
        }
      } catch (e: unknown) {
        setError(getErrorMessage(e, 'Search failed.'))
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  useEffect(() => {
    runSearch(query)
  }, [query])

  const openPoolModal = async (p: Pool) => {
    setSelected(p)
    setShowPwd(false)
    setPassword('')
    setMemberCount(null)
    setError(null)

    try {
      const { data: cnt, error } = await supabase.rpc('count_pool_members', { p_pool_id: p.id })
      if (error) throw error
      setMemberCount((cnt as number) ?? 0)
    } catch {
      setMemberCount(null)
    }
  }

  const closePoolModal = () => {
    setSelected(null)
    setShowPwd(false)
    setPassword('')
    setError(null)
  }

  const requireAuth = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) return true
    router.push('/')
    return false
  }

  // Confirmation helpers
  const askConfirm = (message: string, action: () => Promise<void>) => {
    setConfirmMsg(message)
    setPendingAction(() => action)
    setConfirmOpen(true)
  }
  const doConfirm = async () => {
    if (!pendingAction) return
    setConfirmOpen(false)
    const act = pendingAction
    setPendingAction(null)
    await act()
  }

  const joinPublic = async () => {
    if (!selected) return
    if (!(await requireAuth())) return

    setJoining(true)
    setError(null)

    try {
      const { error } = await supabase.rpc('join_pool', { p_pool_id: selected.id })
      if (error) throw error
      router.push(`/pools/${selected.id}`)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Join failed.'))
    } finally {
      setJoining(false)
    }
  }

  const joinPrivate = async () => {
    if (!selected) return
    if (!(await requireAuth())) return

    setJoining(true)
    setError(null)

    try {
      const { error } = await supabase.rpc('join_pool', {
        p_pool_id: selected.id,
        p_password: password || null,
      })
      if (error) throw error
      router.push(`/pools/${selected.id}`)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Join failed.'))
    } finally {
      setJoining(false)
    }
  }

  const listToShow = query.trim() ? results : recent
  const showEmptySearch = (!searching && results.length === 0 && query.trim())
  const showEmptyRecent = (!recentLoading && !query.trim() && recent.length === 0)

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
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by pool name… (public + discoverable private pools)"
          className="w-full border rounded-md px-3 py-2 mb-3"
        />

        {query.trim() ? (
          searching ? <p className="text-sm text-gray-600">Searching…</p> : <p className="text-sm text-gray-600">Search results</p>
        ) : (
          recentLoading ? <p className="text-sm text-gray-600">Loading pools…</p> : <p className="text-sm text-gray-600">Newest pools you can join</p>
        )}

        <ul className="divide-y rounded-md border">
          {listToShow.map((p) => (
            <li
              key={p.id}
              className="p-3 hover:bg-gray-50 cursor-pointer"
              onClick={() => openPoolModal(p)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-gray-600">
                    {p.is_public ? 'Public' : 'Private'} · Starts week {p.start_week} · Strikes {p.strikes_allowed ?? '—'} · Tie = {p.tie_rule ?? '—'}
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    p.is_public
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-gray-100 border-gray-300 text-gray-700'
                  }`}
                >
                  {p.is_public ? 'Open' : 'Locked'}
                </span>
              </div>
            </li>
          ))}

          {showEmptySearch && (
            <li className="p-3 text-sm text-gray-600">No pools match “{query}”.</li>
          )}

          {showEmptyRecent && (
            <li className="p-3 text-sm text-gray-600">No pools are available to join right now.</li>
          )}
        </ul>

        {!authed && (
          <p className="text-xs text-gray-500 mt-3">
            Tip: you can browse pools without signing in, but you’ll need to sign in to join.
          </p>
        )}
      </div>

      {/* Details modal */}
      {selected && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => closePoolModal()} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(720px,92vw)] bg-white rounded-xl shadow-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold">{selected.name}</h3>
              <button onClick={closePoolModal} className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200">
                Close
              </button>
            </div>

            <div className="grid sm:grid-cols-3 gap-3 mb-3">
              <Info label="Visibility" value={selected.is_public ? 'Public' : 'Private'} />
              <Info label="Members" value={memberCount !== null ? String(memberCount) : '—'} />
              <Info label="Strikes Allowed" value={String(selected.strikes_allowed ?? '—')} />
              <Info label="Tie Counts As" value={selected.tie_rule ?? '—'} />
              <Info label="Start Week" value={`Week ${selected.start_week}`} />
              <Info label="Deadline" value={selected.deadline_mode === 'rolling' ? 'Rolling (kickoff)' : (selected.deadline_fixed || 'Sun 1:00 PM ET')} />
            </div>

            {selected.notes && <p className="text-sm text-gray-700 mb-3">{selected.notes}</p>}

            {selected.is_public ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => askConfirm(`Are you sure you want to join “${selected.name}”?`, joinPublic)}
                  disabled={joining}
                  className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {joining ? 'Joining…' : 'Join Pool'}
                </button>
              </div>
            ) : (
              <>
                {!showPwd ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowPwd(true)}
                      className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      Join (Enter Password)
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 border rounded-md p-3 bg-gray-50">
                    <label className="block">
                      <div className="text-sm font-medium mb-1">Password (case-sensitive)</div>
                      <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && password.trim()) {
                            askConfirm(`Are you sure you want to join “${selected?.name}”?`, joinPrivate)
                          }
                        }}
                        className="w-full border rounded-md px-3 py-2"
                        placeholder="Enter password"
                        type="password"
                      />
                    </label>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => askConfirm(`Are you sure you want to join “${selected?.name}”?`, joinPrivate)}
                        disabled={joining || !password.trim()}
                        className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {joining ? 'Joining…' : 'Submit & Join'}
                      </button>
                      <button
                        onClick={() => { setShowPwd(false); setPassword('') }}
                        className="px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/50" onClick={() => setConfirmOpen(false)} />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(520px,92vw)] bg-white rounded-xl shadow-xl p-5">
            <h4 className="text-lg font-semibold mb-2">Confirm Join</h4>
            <p className="text-sm text-gray-700 mb-4">{confirmMsg}</p>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => setConfirmOpen(false)} className="px-3 py-2 rounded-md bg-gray-200 hover:bg-gray-300">
                Cancel
              </button>
              <button onClick={doConfirm} className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700">
                Yes, Join
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}
