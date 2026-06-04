'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import NextImage from 'next/image'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'
import { ensureProfile } from '@/lib/ensureProfile'

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

export default function PoolDetailPage() {
  const router = useRouter()
  const { poolId } = useParams<{ poolId: string }>() // Next 15: useParams in client pages

  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const [pool, setPool] = useState<Pool | null>(null)
  const [memberCount, setMemberCount] = useState<number>(0)
  const [alreadyMember, setAlreadyMember] = useState<boolean>(false)
  const [isOwner, setIsOwner] = useState<boolean>(false)

  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  const planIsFree = pool?.plan === 'free' || !pool?.plan
  const requiresUpgrade = planIsFree && memberCount >= 11

  useEffect(() => {
    let alive = true
    const init = async () => {
      try {
        if (!poolId) return
        setLoading(true)
        setError(null)

        // auth
        const { data: { user }, error: userErr } = await supabase.auth.getUser()
        if (userErr) throw userErr
        setAuthed(!!user)
        setUserId(user?.id ?? null)

        // pool (ensure created_by is selected)
        const { data: p, error: pErr } = await supabase
          .from('pools')
          .select('*')
          .eq('id', poolId)
          .maybeSingle<Pool>()
        if (pErr) throw pErr
        if (!p) throw new Error('Pool not found.')
        if (!alive) return
        setPool(p)

        // owner?
        setIsOwner(!!user?.id && user.id === p.created_by)

        // member count via RPC (RLS safe)
        try {
          const { data: cnt, error: cntErr } = await supabase.rpc('count_pool_members', { p_pool_id: poolId })
          if (!cntErr) setMemberCount((cnt as number) ?? 0)
        } catch { /* noop */ }

        // membership check
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
          ? `${window.location.origin}/pools/${poolId}`
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
    setJoining(true)
    setError(null)
    try {
      await ensureProfile()
      const { error } = await supabase
        .from('pool_members')
        .insert({ pool_id: pool.id, profile_id: userId })
        .single()
      if (error) {
        const msg = error.message.toLowerCase()
        if (msg.includes('row-level security')) {
          setError('Join failed due to RLS. Ensure pool_members has WITH CHECK (auth.uid() = profile_id).')
        } else {
          setError(error.message)
        }
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
    return `${pool.deadline_fixed.toUpperCase()} ET`
  }, [pool])

  const onCopyInvite = async () => {
    if (!pool) return
    const url = `${window.location.origin}/join/${pool.id}` // invite URL (works with /join/[poolId] page)
    await navigator.clipboard.writeText(url)
    alert('Invite link copied!')
  }

  const onExportCsv = async () => {
    if (!pool) return
    const { data, error } = await supabase
      .from('pool_members')
      .select('profile_id')
      .eq('pool_id', pool.id)

    if (error) return alert(`Export failed: ${error.message}`)
    const rows = [['profile_id'], ...(data || []).map(r => [r.profile_id])]
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pool.name.replace(/\s+/g, '_')}_members.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[70vh] py-10 px-6">
      <div className="mx-auto w-full max-w-2xl border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <NextImage src="/football.png" alt="Football" width={40} height={40} />
            <h1 className="text-2xl font-bold">Pool</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onCopyInvite} className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
              Copy Invite
            </button>
            <button onClick={onExportCsv} className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
              Export CSV
            </button>
            {isOwner && (
              <Link
                href={`/pools/${poolId}/admin`}
                className="px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 text-sm"
              >
                Admin Panel
              </Link>
            )}
          </div>
        </div>

        {loading && <p>Loading…</p>}
        {!loading && error && <p className="text-red-600">{error}</p>}

        {!loading && !error && pool && (
          <>
            <div className="mb-4">
              <h2 className="text-xl font-semibold">{pool.name}</h2>
              <p className="text-sm text-gray-600">
                {pool.is_public ? 'Public' : 'Private'} · Starts week {pool.start_week} · Strikes {pool.strikes_allowed} · Tie = {pool.tie_rule}
              </p>
              <p className="text-sm text-gray-600">
                Pick Deadline: {pool.deadline_mode === 'rolling' ? 'Rolling (locks at kickoff)' : (fixedDeadlineLabel || 'Fixed')}
              </p>
              {pool.notes && <p className="text-sm text-gray-600 mt-1">{pool.notes}</p>}
            </div>

            <div className="grid sm:grid-cols-3 gap-3 mb-6">
              <div className="border rounded-lg p-3">
                <div className="text-xs uppercase text-gray-500">Members</div>
                <div className="text-lg font-semibold">{memberCount}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs uppercase text-gray-500">Visibility</div>
                <div className="text-lg font-semibold">{pool.is_public ? 'Public' : 'Private'}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs uppercase text-gray-500">Plan</div>
                <div className="text-lg font-semibold">{planIsFree ? 'Free' : 'Pro'}</div>
              </div>
            </div>

            {requiresUpgrade && !alreadyMember && (
              <div className="mb-4 p-3 border rounded-md bg-yellow-50 text-sm">
                This pool is on the free plan with {memberCount} members. Upgrade to Pro to add more members.
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
                <button
                  onClick={joinPool}
                  disabled={joining || (requiresUpgrade && planIsFree)}
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
    </main>
  )
}

