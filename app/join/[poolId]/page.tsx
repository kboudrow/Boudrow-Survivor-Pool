'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import NextImage from 'next/image'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

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
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
}

export default function JoinPoolPage({ params }: { params: { poolId: string } }) {
  const router = useRouter()
  const poolId = params.poolId

  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const [pool, setPool] = useState<Pool | null>(null)
  const [memberCount, setMemberCount] = useState<number>(0)
  const [alreadyMember, setAlreadyMember] = useState<boolean>(false)

  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [password, setPassword] = useState('')

  const isActive = pool?.activation_status === 'active'
  const isFull = !!(pool?.max_members && memberCount >= pool.max_members)

  const isOwner = useMemo(() => {
    return !!(userId && pool?.created_by && userId === pool.created_by)
  }, [userId, pool])

  // Load auth + pool
  useEffect(() => {
    let alive = true

    const init = async () => {
      try {
        setLoading(true)
        setError(null)

        // auth
        const { data: { user }, error: userErr } = await supabase.auth.getUser()
        if (userErr) throw userErr
        setAuthed(!!user)
        setUserId(user?.id ?? null)

        // pool (IMPORTANT: include created_by)
        const { data: p, error: pErr } = await supabase
          .from('pools')
          .select('*')
          .eq('id', poolId)
          .maybeSingle<Pool>()
        if (pErr) throw pErr
        if (!p) throw new Error('Pool not found.')
        if (!alive) return
        setPool(p)

        // member count via RPC
        const { data: cnt, error: cErr } = await supabase.rpc('count_pool_members', { p_pool_id: poolId })
        if (cErr) throw cErr
        setMemberCount((cnt as number) ?? 0)

        // membership check (best-effort: direct select is usually OK with RLS you set)
        if (user?.id) {
          const { data: mem } = await supabase
            .from('pool_members')
            .select('profile_id')
            .eq('pool_id', poolId)
            .eq('profile_id', user.id)

          setAlreadyMember((mem || []).length > 0)
        } else {
          setAlreadyMember(false)
        }
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load pool.'))
      } finally {
        if (alive) setLoading(false)
      }
    }

    init()
    return () => { alive = false }
  }, [poolId])

  const signInWithGoogle = async () => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: typeof window !== 'undefined'
          ? `${window.location.origin}/join/${poolId}`
          : undefined
      }
    })
    if (error) setError(error.message)
  }

  const joinPool = async () => {
    if (!pool) return
    if (!userId) {
      setError('Please sign in first.')
      return
    }
    // (Optional) confirmation
    const ok = window.confirm(`Join "${pool.name}"?`)
    if (!ok) return

    setJoining(true)
    setError(null)
    try {
      const { error } = await supabase.rpc('join_pool', {
        p_pool_id: pool.id,
        p_password: pool.is_public ? null : password || null,
      })

      if (error) {
        setError(error.message)
        return
      }

      router.push(`/pools?pool=${pool.id}`)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to join.'))
    } finally {
      setJoining(false)
    }
  }

  const fixedDeadlineLabel = useMemo(() => {
    if (!pool) return null
    if (pool.deadline_mode !== 'fixed') return null
    if (!pool.deadline_fixed) return 'Sun 1:00 PM ET (default)'
    const t = pool.deadline_fixed.trim().toUpperCase()
    return `${t} ET`
  }, [pool])

  return (
    <main className="min-h-[70vh] py-10 px-6">
      <div className="mx-auto w-full max-w-2xl border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <NextImage src="/football.png" alt="Football" width={40} height={40} />
            <h1 className="text-2xl font-bold">Join Pool</h1>
          </div>

          {/* Owner shortcut to Admin Panel for convenience */}
          {isOwner && (
            <Link
              href={`/pools/${poolId}/admin`}
              className="px-3 py-2 rounded-md bg-black text-white hover:bg-gray-900"
              title="Admin tools"
            >
              Admin Panel
            </Link>
          )}
        </div>

        {loading && <p>Loading…</p>}
        {!loading && error && <p className="text-red-600">{error}</p>}

        {!loading && !error && pool && (
          <>
            <div className="mb-4">
              <h2 className="text-xl font-semibold">{pool.name}</h2>
              <p className="text-sm text-gray-600">
                {pool.is_public ? 'Public' : 'Private'} · Starts week {pool.start_week} ·
                {' '}Strikes {pool.strikes_allowed} · Tie = {pool.tie_rule}
              </p>
              <p className="text-sm text-gray-600">
                Pick Deadline: {pool.deadline_mode === 'rolling' ? 'Rolling (locks at kickoff)' : (fixedDeadlineLabel || 'Fixed')}
              </p>
              {pool.notes && <p className="text-sm text-gray-600 mt-1">{pool.notes}</p>}
            </div>

            <div className="grid sm:grid-cols-3 gap-3 mb-6">
              <Info label="Members" value={pool.max_members ? `${memberCount}/${pool.max_members}` : String(memberCount)} />
              <Info label="Visibility" value={pool.is_public ? 'Public' : 'Private'} />
              <Info label="Status" value={isActive ? 'Active' : 'Draft'} />
            </div>

            {!isActive && !isOwner && !alreadyMember && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This pool is not accepting members yet.
              </div>
            )}

            {isFull && !isOwner && !alreadyMember && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This pool is full.
              </div>
            )}

            {!authed && (
              <div className="mt-4">
                <p className="text-sm text-gray-700 mb-3">You need to sign in to join.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={signInWithGoogle}
                    className="px-4 py-2 rounded-md bg-[#4285F4] text-white hover:bg-blue-600"
                  >
                    Continue with Google
                  </button>
                  <Link href="/" className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
                    Use email on Home
                  </Link>
                </div>
              </div>
            )}

            {authed && alreadyMember && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-emerald-700">You’re already a member of this pool.</span>
                <Link href={`/pools?pool=${pool.id}`} className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm">
                  Open Pool
                </Link>
              </div>
            )}

            {authed && !alreadyMember && (
              <div className="mt-4 flex flex-wrap gap-2">
                {!pool.is_public && (
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border px-3 py-2"
                    placeholder="Enter pool password"
                    type="password"
                  />
                )}
                <button
                  onClick={joinPool}
                  disabled={joining || (!isActive && !isOwner) || (isFull && !isOwner) || (!pool.is_public && !password.trim())}
                  className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {joining ? 'Joining…' : 'Join Pool'}
                </button>
                <Link href="/pools" className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
                  Cancel
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl text-xs text-gray-500 mt-4">
        <p>
          If you see an “RLS” error while joining, ensure there’s an insert policy on{' '}
          <code className="mx-1 px-1 py-0.5 bg-gray-100 rounded">pool_members</code> like:
        </p>
        <pre className="mt-2 p-3 bg-gray-50 rounded border overflow-auto">{`create policy pool_member_self_join
on public.pool_members
for insert
to authenticated
with check (auth.uid() = profile_id);`}</pre>
      </div>
    </main>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}
