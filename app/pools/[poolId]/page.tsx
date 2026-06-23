'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import NextImage from 'next/image'
import { InviteModal } from '@/components/InviteModal'
import { authCallbackUrl } from '@/lib/authRedirect'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type Pool = {
  id: string
  name: string
  is_public: boolean
  start_week: number
  include_playoffs: boolean
  strikes_allowed: number
  tie_rule: 'win' | 'loss'
  deadline_mode: 'fixed' | 'rolling'
  deadline_fixed: string | null
  notes: string | null
  created_by: string
  season?: number | null
  plan?: 'free' | 'pro'
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
  member_count?: number | null
}

function isMissingAuthSession(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const err = error as { name?: string; message?: string }
  return err.name === 'AuthSessionMissingError' || err.message === 'Auth session missing!' || err.message === 'Auth session missing'
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
  const [password, setPassword] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [poolStartAt, setPoolStartAt] = useState<string | null>(null)

  const isActive = pool?.activation_status === 'active'
  const isFull = !!(pool?.max_members && memberCount >= pool.max_members)
  const poolStartMs = poolStartAt ? Date.parse(poolStartAt) : null
  const poolStartKnown = poolStartMs !== null && Number.isFinite(poolStartMs)
  const leagueHasStarted = poolStartKnown && Date.now() >= poolStartMs
  const canInvite = !!pool && isActive && poolStartKnown && !leagueHasStarted
  const authReturnTo = `/pools/${poolId}`
  const signInHref = `/?auth=signin&returnTo=${encodeURIComponent(authReturnTo)}`
  const signUpHref = `/?auth=signup&returnTo=${encodeURIComponent(authReturnTo)}`

  useEffect(() => {
    let alive = true
    const init = async () => {
      try {
        if (!poolId) return
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

        const { data: firstStartGame } = await supabase
          .from('nfl_games')
          .select('game_time,kickoff_at_utc')
          .eq('season', poolRow.season ?? new Date().getFullYear())
          .eq('week', poolRow.start_week)
          .order('kickoff_at_utc', { ascending: true, nullsFirst: false })
          .order('game_time', { ascending: true })
          .limit(1)
          .maybeSingle<{ game_time: string; kickoff_at_utc: string | null }>()
        let fallbackStartAt: string | null = null
        if (!firstStartGame?.kickoff_at_utc && !firstStartGame?.game_time) {
          const { data: startWeek } = await supabase
            .from('season_weeks')
            .select('week_sunday_date')
            .eq('season', poolRow.season ?? new Date().getFullYear())
            .eq('week', poolRow.start_week)
            .maybeSingle<{ week_sunday_date: string }>()
          fallbackStartAt = startWeek?.week_sunday_date ? `${startWeek.week_sunday_date}T00:00:00` : null
        }
        if (alive) setPoolStartAt(firstStartGame?.kickoff_at_utc || firstStartGame?.game_time || fallbackStartAt)

        // owner?
        setIsOwner(!!user?.id && user.id === poolRow.created_by)

        setMemberCount(poolRow.member_count ?? 0)

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
        redirectTo: authCallbackUrl(`/pools/${poolId}`),
        queryParams: { prompt: 'select_account' },
      }
    })
    if (error) setError(error.message)
  }

  const joinPool = async () => {
    if (!pool) return
    if (!userId) {
      router.push(signInHref)
      return
    }
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
    if (pool.deadline_fixed === '20:15') return 'Before Monday Night Football'
    return 'Sunday 1 PM ET'
  }, [pool])

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
            <NextImage src="/survive-sunday-logo.png" alt="Survive Sunday" width={44} height={44} className="object-contain" />
            <h1 className="text-2xl font-bold">Pool</h1>
          </div>
          <div className="flex items-center gap-2">
            {canInvite && (
              <button onClick={() => setInviteOpen(true)} className="px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 text-sm">
                Invite
              </button>
            )}
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

        {loading && <p>Loading...</p>}
        {!loading && error && <p className="text-red-600">{error}</p>}

        {!loading && !error && pool && (
          <>
            <div className="mb-4">
              <h2 className="text-xl font-semibold">{pool.name}</h2>
              <p className="text-sm text-gray-600">
                {pool.is_public ? 'Public' : 'Private'} · Starts week {pool.start_week} · Strikes {pool.strikes_allowed} · Tie = {pool.tie_rule === 'win' ? 'Win' : 'Loss'}
              </p>
              <p className="text-sm text-gray-600">
                Pick Deadline: {pool.deadline_mode === 'rolling' ? 'Rolling: each game locks at kickoff' : (fixedDeadlineLabel || 'Sunday 1 PM ET')}
              </p>
              {pool.notes && <p className="text-sm text-gray-600 mt-1">{pool.notes}</p>}
            </div>

            <div className="grid sm:grid-cols-3 gap-3 mb-6">
              <div className="border rounded-lg p-3">
                <div className="text-xs uppercase text-gray-500">Members</div>
                <div className="text-lg font-semibold">{pool.max_members ? `${memberCount}/${pool.max_members}` : memberCount}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs uppercase text-gray-500">Visibility</div>
                <div className="text-lg font-semibold">{pool.is_public ? 'Public' : 'Private'}</div>
              </div>
              <div className="border rounded-lg p-3">
                <div className="text-xs uppercase text-gray-500">Status</div>
                <div className="text-lg font-semibold">{isActive ? 'Active' : 'Draft'}</div>
              </div>
            </div>

            {!isActive && !alreadyMember && !isOwner && (
              <div className="mb-4 p-3 border border-amber-200 rounded-md bg-amber-50 text-sm text-amber-800">
                This pool is not accepting members yet.
              </div>
            )}

            {isFull && !alreadyMember && !isOwner && (
              <div className="mb-4 p-3 border border-amber-200 rounded-md bg-amber-50 text-sm text-amber-800">
                This pool is full.
              </div>
            )}

            {!authed && (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-medium text-slate-900">Sign in or create an account to join this pool.</p>
                <p className="mt-1 text-sm text-slate-600">After that, we will bring you right back here so you can finish joining.</p>
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
                <span className="text-sm text-emerald-700">You&apos;re already a member of this pool.</span>
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
      {pool && (
        <InviteModal
          open={inviteOpen}
          poolId={pool.id}
          poolName={pool.name}
          isPrivate={!pool.is_public}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </main>
  )
}

