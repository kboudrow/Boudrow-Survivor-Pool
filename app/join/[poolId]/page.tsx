'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import NextImage from 'next/image'
import { authCallbackUrl } from '@/lib/authRedirect'
import { getErrorMessage } from '@/lib/errorMessage'
import { logAppEvent } from '@/lib/monitoring'
import { supabase } from '@/lib/supabaseClient'

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
  plan?: 'free' | 'pro'
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
  member_count?: number | null
  test_mode?: boolean | null
  test_current_week?: number | null
}

function isMissingAuthSession(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: string; message?: string }
  return err.name === 'AuthSessionMissingError' || err.message === 'Auth session missing!' || err.message === 'Auth session missing'
}

export default function JoinPoolPage() {
  const router = useRouter()
  const { poolId } = useParams<{ poolId: string }>()

  const [loading, setLoading] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const [pool, setPool] = useState<Pool | null>(null)
  const [memberCount, setMemberCount] = useState<number>(0)
  const [alreadyMember, setAlreadyMember] = useState<boolean>(false)

  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmJoinOpen, setConfirmJoinOpen] = useState(false)
  const [poolStartAt, setPoolStartAt] = useState<string | null>(null)

  const isJoinable = pool?.activation_status !== 'cancelled'
  const isFull = !!(pool?.max_members && memberCount >= pool.max_members)
  const poolStartMs = poolStartAt ? Date.parse(poolStartAt) : null
  const poolStartKnown = poolStartMs !== null && Number.isFinite(poolStartMs)
  const poolStarted = !!pool && (
    (!!pool.test_mode && (pool.test_current_week || pool.start_week || 1) >= (pool.start_week || 1))
    || (poolStartKnown && Date.now() >= poolStartMs)
  )
  const authReturnTo = `/join/${poolId}`
  const signInHref = `/?auth=signin&returnTo=${encodeURIComponent(authReturnTo)}`
  const signUpHref = `/?auth=signup&returnTo=${encodeURIComponent(authReturnTo)}`

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

        const { data: { user }, error: userErr } = await supabase.auth.getUser()
        if (userErr && !isMissingAuthSession(userErr)) throw userErr
        setAuthed(!!user)
        setUserId(user?.id ?? null)

        const { data: inviteRows, error: inviteErr } = await supabase.rpc('get_pool_invite', { p_pool_id: poolId })
        if (inviteErr) throw inviteErr
        const poolRow = ((inviteRows || []) as Pool[])[0] ?? null
        if (!poolRow) throw new Error('Pool not found.')
        if (!alive) return
        setPool(poolRow)

        setMemberCount(poolRow.member_count ?? 0)

        const season = poolRow.season ?? new Date().getFullYear()
        const [{ data: firstStartGame }, { data: startWeek }] = await Promise.all([
          supabase
            .from('nfl_games')
            .select('game_time,kickoff_at_utc')
            .eq('season', season)
            .eq('week', poolRow.start_week)
            .order('kickoff_at_utc', { ascending: true, nullsFirst: false })
            .order('game_time', { ascending: true })
            .limit(1)
            .maybeSingle<{ game_time: string; kickoff_at_utc: string | null }>(),
          supabase
            .from('season_weeks')
            .select('week_sunday_date')
            .eq('season', season)
            .eq('week', poolRow.start_week)
            .maybeSingle<{ week_sunday_date: string }>(),
        ])
        if (alive) {
          setPoolStartAt(firstStartGame?.kickoff_at_utc || firstStartGame?.game_time || (startWeek?.week_sunday_date ? `${startWeek.week_sunday_date}T00:00:00` : null))
        }

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
        void logAppEvent({ eventType: 'invite_pool_load_failed', error: e, poolId })
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
        redirectTo: authCallbackUrl(`/join/${poolId}`),
        queryParams: { prompt: 'select_account' },
      }
    })
    if (error) {
      void logAppEvent({ eventType: 'invite_google_signin_failed', error, poolId })
      setError(getErrorMessage(error, 'Could not start Google sign-in.'))
    }
  }

  const joinPool = async () => {
    if (!pool) return
    if (!userId) {
      setError('Please sign in first.')
      return
    }
    if (poolStarted) {
      setError('This pool has already started, so it is closed to new members.')
      return
    }
    setConfirmJoinOpen(true)
  }

  const completeJoinPool = async () => {
    if (!pool || !userId) return
    if (poolStarted) {
      setError('This pool has already started, so it is closed to new members.')
      return
    }
    setConfirmJoinOpen(false)

    setJoining(true)
    setError(null)
    try {
      const { error } = await supabase.rpc('join_pool', {
        p_pool_id: pool.id,
        p_password: pool.is_public ? null : password || null,
      })

      if (error) {
        void logAppEvent({ eventType: 'invite_join_failed', error, poolId: pool.id, metadata: { is_public: pool.is_public } })
        setError(getErrorMessage(error, 'Could not join this pool.'))
        return
      }

      router.push(`/pools?pool=${pool.id}`)
    } catch (e: unknown) {
      void logAppEvent({ eventType: 'invite_join_exception', error: e, poolId: pool.id, metadata: { is_public: pool.is_public } })
      setError(getErrorMessage(e, 'Failed to join.'))
    } finally {
      setJoining(false)
    }
  }

  const fixedDeadlineLabel = useMemo(() => {
    if (!pool) return null
    if (pool.deadline_mode !== 'fixed') return null
    if (pool.deadline_fixed === '20:15') return 'Before Monday Night Football'
    return 'Sunday 1 PM ET'
  }, [pool])

  return (
    <main className="min-h-[70vh] py-10 px-6">
      <div className="mx-auto w-full max-w-2xl border border-gray-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <NextImage src="/survive-sunday-logo.png" alt="Survive Sunday" width={44} height={44} className="object-contain" />
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

        {loading && <p>Loading...</p>}
        {!loading && error && <p className="text-red-600">{error}</p>}

        {!loading && !error && pool && (
          <>
            <div className="mb-4">
              <h2 className="text-xl font-semibold">{pool.name}</h2>
              <p className="text-sm text-gray-600">
                {pool.is_public ? 'Public' : 'Private'} - Starts week {pool.start_week} -
                {' '}Strikes {pool.strikes_allowed} - Tie = {pool.tie_rule === 'win' ? 'Win' : 'Loss'}
              </p>
              <p className="text-sm text-gray-600">
                Pick deadline: {pool.deadline_mode === 'rolling' ? 'Rolling, each game locks at kickoff' : (fixedDeadlineLabel || 'Sunday 1 PM ET')}
              </p>
              {pool.notes && <p className="text-sm text-gray-600 mt-1">{pool.notes}</p>}
            </div>

            <div className="grid sm:grid-cols-3 gap-3 mb-6">
              <Info label="Members" value={pool.max_members ? `${memberCount}/${pool.max_members}` : String(memberCount)} />
              <Info label="Visibility" value={pool.is_public ? 'Public' : 'Private'} />
              <Info label="Status" value={poolStarted ? 'Started' : isJoinable ? 'Open' : 'Closed'} />
            </div>

            {poolStarted && !alreadyMember && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This pool has already started, so it is closed to new members.
              </div>
            )}

            {!isJoinable && !isOwner && !alreadyMember && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This pool is not accepting members yet.
              </div>
            )}

            {isFull && !isOwner && !alreadyMember && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                This pool is full.
              </div>
            )}

            {!authed && !poolStarted && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-900">Sign in or create an account to join {pool.name}.</p>
                <p className="mt-1 text-sm text-slate-600">You will come right back to this invite page after signing in.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={signInWithGoogle}
                    className="mt-3 px-4 py-2 rounded-md bg-[#4285F4] text-white hover:bg-blue-600"
                  >
                    Continue with Google
                  </button>
                  <Link href={signInHref} className="mt-3 px-4 py-2 rounded-md bg-[#c5161d] text-white hover:bg-[#a91218]">
                    Sign in with email
                  </Link>
                  <Link href={signUpHref} className="mt-3 px-4 py-2 rounded-md border border-slate-300 bg-white text-slate-800 hover:bg-slate-100">
                    Create account
                  </Link>
                </div>
              </div>
            )}

            {authed && alreadyMember && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-sm text-emerald-700">You&apos;re already in this pool.</span>
                <Link href={`/pools?pool=${pool.id}`} className="px-3 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 text-sm">
                  Open Pool
                </Link>
              </div>
            )}

            {authed && !alreadyMember && !poolStarted && (
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
                  disabled={joining || (!isJoinable && !isOwner) || (isFull && !isOwner) || (!pool.is_public && !password.trim())}
                  className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {joining ? 'Joining...' : 'Join Pool'}
                </button>
                <Link href="/pools" className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
                  Cancel
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {confirmJoinOpen && pool && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0 bg-slate-950/50" aria-label="Cancel join" onClick={() => setConfirmJoinOpen(false)} />
          <div className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">Join this pool?</div>
            <p className="text-sm leading-6 text-slate-700">Join &quot;{pool.name}&quot;? Your picks and standings will show in My Pools after you join.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmJoinOpen(false)} className="rounded-md bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200">
                Cancel
              </button>
              <button type="button" onClick={completeJoinPool} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">
                Join pool
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
    <div className="border rounded-lg p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  )
}

