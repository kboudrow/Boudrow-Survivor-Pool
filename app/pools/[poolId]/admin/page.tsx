'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type Pool = {
  id: string
  name: string
  created_by: string
  is_public: boolean
  visibility?: 'public' | 'private' | string | null
  double_pick_weeks: number[] | null
  archived: boolean
  season: number | null
  start_week: number
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
  payment_status?: 'unpaid' | 'paid' | 'not_required' | 'waived' | 'refunded' | string | null
}

type AdminRow = {
  user_id: string
  display_name: string
  role: string
  joined_at: string | null
  slot: number
  draft_team_abbr: string | null
  draft_updated_at: string | null
  final_team_abbr: string | null
  locked_at: string | null
  result: string | null
  wins: number
  losses: number
  pushes: number
  strikes_used: number
  eliminated: boolean
  eliminated_week: number | null
}

const ALL_WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)
const TEAMS = [
  'ARI',
  'ATL',
  'BAL',
  'BUF',
  'CAR',
  'CHI',
  'CIN',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GB',
  'HOU',
  'IND',
  'JAX',
  'KC',
  'LV',
  'LAC',
  'LAR',
  'MIA',
  'MIN',
  'NE',
  'NO',
  'NYG',
  'NYJ',
  'PHI',
  'PIT',
  'SEA',
  'SF',
  'TB',
  'TEN',
  'WAS',
]

function fmt(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}
const rowKey = (row: AdminRow) => `${row.user_id}:${row.slot}`
const hasFinalPick = (row: AdminRow) => !!row.final_team_abbr || !!row.locked_at
const fmtShort = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '-'

export default function PoolAdminPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { poolId } = useParams<{ poolId: string }>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [pool, setPool] = useState<Pool | null>(null)
  const [poolStartAt, setPoolStartAt] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminRow[]>([])

  const [selectedWeek, setSelectedWeek] = useState(1)
  const [doubleWeeksText, setDoubleWeeksText] = useState('')
  const [maxMembersText, setMaxMembersText] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [activating, setActivating] = useState(false)
  const [savingDouble, setSavingDouble] = useState(false)
  const [savingLimit, setSavingLimit] = useState(false)
  const [savingVisibility, setSavingVisibility] = useState(false)
  const [isPublicDraft, setIsPublicDraft] = useState(true)
  const [visibilityPassword, setVisibilityPassword] = useState('')
  const [confirmingCheckout, setConfirmingCheckout] = useState(false)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [draftTeams, setDraftTeams] = useState<Record<string, string>>({})
  const [finalTeams, setFinalTeams] = useState<Record<string, string>>({})

  const memberCount = new Set(rows.map((row) => row.user_id)).size
  const stats = useMemo(() => {
    const uniqueMembers = Array.from(new Map(rows.map((row) => [row.user_id, row])).values())
    const alive = uniqueMembers.filter((row) => !row.eliminated).length
    return { alive, eliminated: uniqueMembers.length - alive }
  }, [rows])
  const isPoolActive = pool?.activation_status === 'active'
  const leagueHasStarted = !!poolStartAt && Date.now() >= Date.parse(poolStartAt)
  const settingsLocked = leagueHasStarted
  const visibilityChanged = !!pool && isPublicDraft !== pool.is_public
  const selectedDoubleWeeks = useMemo(() => {
    return new Set(
      doubleWeeksText
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 18),
      )
  }, [doubleWeeksText])
  const doubleWeekCount = selectedDoubleWeeks.size

  const loadOverview = async (week = selectedWeek) => {
    if (!poolId) return
    setRefreshing(true)
    setError(null)
    try {
      const [{ data: p, error: pErr }, { data: overview, error: overviewErr }] = await Promise.all([
        supabase.from('pools').select('id,name,created_by,is_public,visibility,double_pick_weeks,archived,season,start_week,activation_status,max_members,payment_status').eq('id', poolId).maybeSingle<Pool>(),
        supabase.rpc('admin_pool_week_overview', { p_pool_id: poolId, p_week: week }),
      ])
      if (pErr) throw pErr
      if (overviewErr) throw overviewErr
      if (!p) throw new Error('Pool not found')

      const {
        data: { user },
      } = await supabase.auth.getUser()

      setPool(p)
      setIsOwner(!!user?.id && user.id === p.created_by)
      setDoubleWeeksText((p.double_pick_weeks || []).join(','))
      setMaxMembersText(String(p.max_members ?? 25))
      setIsPublicDraft(!!p.is_public)
      setVisibilityPassword('')
      setRows((overview || []) as AdminRow[])

      const { data: firstStartGame } = await supabase
        .from('nfl_games')
        .select('game_time,kickoff_at_utc')
        .eq('season', p.season ?? new Date().getFullYear())
        .eq('week', p.start_week)
        .order('kickoff_at_utc', { ascending: true, nullsFirst: false })
        .order('game_time', { ascending: true })
        .limit(1)
        .maybeSingle<{ game_time: string; kickoff_at_utc: string | null }>()
      setPoolStartAt(firstStartGame?.kickoff_at_utc || firstStartGame?.game_time || null)

      const nextDrafts: Record<string, string> = {}
      const nextFinals: Record<string, string> = {}
      for (const row of (overview || []) as AdminRow[]) {
        nextDrafts[rowKey(row)] = row.draft_team_abbr || ''
        nextFinals[rowKey(row)] = row.final_team_abbr || ''
      }
      setDraftTeams(nextDrafts)
      setFinalTeams(nextFinals)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load admin data.'))
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    const init = async () => {
      if (!poolId || !alive) return
      setLoading(true)
      await loadOverview(selectedWeek)
    }
    init()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId])

  useEffect(() => {
    if (!pool || !isOwner || pool.activation_status === 'active') return
    const activated = searchParams.get('activated')
    const sessionId = searchParams.get('session_id')
    if (activated !== 'success' || !sessionId || confirmingCheckout) return

    const confirmCheckout = async () => {
      setConfirmingCheckout(true)
      setError(null)
      setNotice(null)
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) throw sessionError
        if (!session?.access_token) throw new Error('Please sign in again to confirm payment.')

        const response = await fetch('/api/stripe/confirm-checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ poolId: pool.id, sessionId }),
        })

        const payload = (await response.json()) as { activated?: boolean; error?: string }
        if (!response.ok || !payload.activated) {
          throw new Error(payload.error || 'Payment confirmation failed.')
        }

        setNotice('Payment confirmed. Pool is active.')
        await loadOverview(selectedWeek)
        router.replace(`/pools/${pool.id}/admin`)
      } catch (e: unknown) {
        setError(getErrorMessage(e, 'Payment confirmation failed.'))
      } finally {
        setConfirmingCheckout(false)
      }
    }

    confirmCheckout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, isOwner, searchParams, confirmingCheckout, router])

  useEffect(() => {
    if (!loading && !error && pool && !isOwner) {
      router.replace(`/pools/${poolId}`)
    }
  }, [loading, error, pool, isOwner, poolId, router])

  const runAction = async (label: string, action: () => Promise<string | void>) => {
    setRunningAction(label)
    setError(null)
    setNotice(null)
    try {
      const message = await action()
      setNotice(message || `${label} complete.`)
      await loadOverview(selectedWeek)
    } catch (e: unknown) {
      setError(getErrorMessage(e, `${label} failed.`))
    } finally {
      setRunningAction(null)
    }
  }

  const saveDoubleWeeks = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('League settings cannot be changed after the league has started.')
      return
    }
    setSavingDouble(true)
    setError(null)
    setNotice(null)
    try {
      const weeks = doubleWeeksText
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 18)

      const { error } = await supabase.rpc('admin_set_double_weeks', {
        p_pool_id: pool.id,
        p_weeks: weeks,
      })
      if (error) throw error
      setNotice('Double-pick weeks saved.')
      setPool({ ...pool, double_pick_weeks: weeks })
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save double-pick weeks.'))
    } finally {
      setSavingDouble(false)
    }
  }

  const toggleDoubleWeek = (week: number) => {
    if (settingsLocked) return
    const weeks = new Set(selectedDoubleWeeks)
    if (weeks.has(week)) {
      weeks.delete(week)
    } else {
      weeks.add(week)
    }
    setDoubleWeeksText(Array.from(weeks).sort((a, b) => a - b).join(','))
  }

  const saveMemberLimit = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('League settings cannot be changed after the league has started.')
      return
    }

    const nextLimit = parseInt(maxMembersText.trim(), 10)
    if (!Number.isFinite(nextLimit) || nextLimit < 2 || nextLimit > 500) {
      setError('Member limit must be between 2 and 500.')
      return
    }
    if (nextLimit < memberCount) {
      setError(`Member limit cannot be lower than the current member count (${memberCount}).`)
      return
    }

    setSavingLimit(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_member_limit', {
        p_pool_id: pool.id,
        p_max_members: nextLimit,
      })
      if (error) throw error
      setPool({ ...pool, max_members: nextLimit })
      setNotice('Member limit saved.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save member limit.'))
    } finally {
      setSavingLimit(false)
    }
  }

  const saveVisibility = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('League settings cannot be changed after the league has started.')
      return
    }
    if (!isPublicDraft && !visibilityPassword.trim()) {
      setError('Enter a pool password before switching this pool to private.')
      return
    }

    setSavingVisibility(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_visibility', {
        p_pool_id: pool.id,
        p_is_public: isPublicDraft,
        p_password: isPublicDraft ? null : visibilityPassword,
      })
      if (error) throw error

      setPool({ ...pool, is_public: isPublicDraft, visibility: isPublicDraft ? 'public' : 'private' })
      setVisibilityPassword('')
      setNotice(isPublicDraft ? 'Pool is now public.' : 'Pool is now private.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save pool visibility.'))
    } finally {
      setSavingVisibility(false)
    }
  }

  const toggleArchive = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('League settings cannot be changed after the league has started.')
      return
    }
    setArchiving(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_archive_pool', {
        p_pool_id: pool.id,
        p_archived: !pool.archived,
      })
      if (error) throw error
      setPool({ ...pool, archived: !pool.archived })
      setNotice(pool.archived ? 'Pool unarchived.' : 'Pool archived.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update archive state.'))
    } finally {
      setArchiving(false)
    }
  }

  const startActivationCheckout = async () => {
    if (!pool) return
    setActivating(true)
    setError(null)
    setNotice(null)

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) throw sessionError
      if (!session?.access_token) throw new Error('Please sign in again before activating this pool.')

      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ poolId: pool.id }),
      })

      const payload = (await response.json()) as { url?: string; error?: string }
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Failed to start checkout.')
      }

      window.location.href = payload.url
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to start checkout.'))
      setActivating(false)
    }
  }

  const finalizeLocked = () =>
    runAction('Finalize locked picks', async () => {
      if (!pool) return
      const { data, error } = await supabase.rpc('finalize_locked_picks_for_pool', { p_pool_id: pool.id })
      if (error) throw error
      return `Finalized ${data ?? 0} pick(s).`
    })

  const adjudicate = () =>
    runAction('Adjudicate results', async () => {
      if (!pool) return
      const { data, error } = await supabase.rpc('adjudicate_completed_weeks', { p_season: pool.season ?? new Date().getFullYear() })
      if (error) throw error
      return `Adjudicated ${data ?? 0} pick result(s).`
    })

  const saveDraft = (row: AdminRow) =>
    runAction('Save draft pick', async () => {
      if (!pool) return
      if (hasFinalPick(row)) {
        throw new Error('This pick is already final. Use Override final to change the official pick.')
      }
      const key = rowKey(row)
      const team = draftTeams[key]?.trim().toUpperCase()
      if (!team) {
        const { error } = await supabase.rpc('admin_clear_user_week_draft_slot', {
          p_pool_id: pool.id,
          p_target_user: row.user_id,
          p_week: selectedWeek,
          p_slot: row.slot,
          p_reason: 'Cleared from admin panel',
        })
        if (error) throw error
        return 'Draft pick cleared.'
      }

      const { error } = await supabase.rpc('admin_upsert_user_draft', {
        p_pool_id: pool.id,
        p_target_user: row.user_id,
        p_week: selectedWeek,
        p_team_abbr: team,
        p_slot: row.slot,
        p_reason: 'Updated from admin panel',
      })
      if (error) throw error
      return `Draft pick saved as ${team}.`
    })

  const saveFinal = (row: AdminRow) =>
    runAction('Override final pick', async () => {
      if (!pool) return
      const team = finalTeams[rowKey(row)]?.trim().toUpperCase()
      if (!team) throw new Error('Choose a team before overriding a final pick.')
      if (hasFinalPick(row)) {
        const confirmed = window.confirm(`Change ${row.display_name}'s official Pick ${row.slot} for week ${selectedWeek} to ${team}?`)
        if (!confirmed) return 'Final pick override canceled.'
      }

      const { error } = await supabase.rpc('admin_override_final_pick', {
        p_pool_id: pool.id,
        p_target_user: row.user_id,
        p_week: selectedWeek,
        p_team_abbr: team,
        p_slot: row.slot,
        p_reason: 'Updated from admin panel',
      })
      if (error) throw error
      return `Final pick overridden as ${team}.`
    })

  const removeMember = (row: AdminRow) =>
    runAction('Remove member', async () => {
      if (!pool) return
      if (settingsLocked) {
        throw new Error('Members cannot be removed after the league has started.')
      }
      const confirmed = window.confirm(`Remove ${row.display_name} from this pool? This cannot be undone from this screen.`)
      if (!confirmed) return 'Remove member canceled.'

      const { error } = await supabase.rpc('admin_remove_member', {
        p_pool_id: pool.id,
        p_profile_id: row.user_id,
      })
      if (error) throw error
      return `${row.display_name} removed.`
    })

  return (
    <main className="min-h-[70vh] bg-gray-50 py-8 px-4">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-gray-600">{pool ? `${pool.name} - ${pool.season ?? 'Season not set'}` : 'Pool controls'}</p>
              {isPoolActive && (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  Active Pool
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <Link href={`/pools?pool=${poolId}`} className="rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200">
              Back to Pool
            </Link>
            <button onClick={() => loadOverview(selectedWeek)} disabled={refreshing} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {loading && <p>Loading...</p>}
        {!loading && error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!loading && notice && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        {!loading && pool && isOwner && (
          <div className="space-y-5">
            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Members</div>
                <div className="text-2xl font-bold">{pool.max_members ? `${memberCount}/${pool.max_members}` : memberCount}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Alive</div>
                <div className="text-2xl font-bold text-emerald-700">{stats.alive}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Eliminated</div>
                <div className="text-2xl font-bold text-red-700">{stats.eliminated}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Archived</div>
                <div className="text-2xl font-bold">{pool.archived ? 'Yes' : 'No'}</div>
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Activation</div>
                <div className={`text-sm font-semibold ${isPoolActive ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isPoolActive ? 'Active and joinable' : 'Draft, payment required'}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Visibility</div>
                <div className="text-sm font-semibold">{pool.is_public ? 'Public search' : 'Private password'}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Settings lock</div>
                <div className={`text-sm font-semibold ${settingsLocked ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {settingsLocked ? 'Locked' : `Open until ${fmtShort(poolStartAt)}`}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Double-pick weeks</div>
                <div className="text-sm font-semibold">{doubleWeekCount ? `${doubleWeekCount} selected` : 'None'}</div>
              </div>
            </section>

            {!isPoolActive && (
              <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-blue-950">Pool Activation</h2>
                    <p className="text-sm text-blue-800">Players cannot join until the creator completes the $50 activation payment.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-blue-300 bg-white px-3 py-1 text-sm font-medium text-blue-800">Draft</span>
                    <button
                      onClick={startActivationCheckout}
                      disabled={activating || confirmingCheckout}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {confirmingCheckout ? 'Confirming payment...' : activating ? 'Opening Stripe...' : 'Activate for $50'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">League Settings</h2>
                  <p className="text-sm text-gray-600">These rules stay editable until the pool reaches its configured start week.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={finalizeLocked} disabled={!!runningAction} className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                    Finalize locked picks
                  </button>
                  <button onClick={adjudicate} disabled={!!runningAction} className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
                    Adjudicate results
                  </button>
                  <button
                    onClick={toggleArchive}
                    disabled={archiving || settingsLocked}
                    title={settingsLocked ? 'League settings are locked after the league starts.' : undefined}
                    className="rounded-md bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {archiving ? 'Updating...' : pool.archived ? 'Unarchive pool' : 'Archive pool'}
                  </button>
                </div>
              </div>
              {settingsLocked && (
                <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  League settings are locked because this pool has reached its configured start week. Admins can still manage player picks and results.
                </p>
              )}
              {!settingsLocked && poolStartAt && (
                <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Settings can still be changed. They lock when this pool starts: {fmt(poolStartAt)}.
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_minmax(260px,360px)_1fr]">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <label className="mb-1 block text-sm font-medium">Member limit</label>
                  <div className="flex gap-2">
                    <input
                      value={maxMembersText}
                      onChange={(e) => setMaxMembersText(e.target.value)}
                      disabled={settingsLocked}
                      inputMode="numeric"
                      className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                      placeholder="25"
                    />
                    <button onClick={saveMemberLimit} disabled={savingLimit || settingsLocked} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {savingLimit ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">Current members: {memberCount}. Limit must be 2-500 and cannot be below the current member count.</p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <label className="mb-1 block text-sm font-medium">Pool visibility</label>
                  <select
                    value={isPublicDraft ? 'public' : 'private'}
                    onChange={(e) => setIsPublicDraft(e.target.value === 'public')}
                    disabled={settingsLocked}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                  {!isPublicDraft && (
                    <>
                      <input
                        value={visibilityPassword}
                        onChange={(e) => setVisibilityPassword(e.target.value)}
                        disabled={settingsLocked}
                        className="mt-2 w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder={pool.is_public ? 'Set private pool password' : 'Enter new private password'}
                        type="password"
                      />
                      <p className="mt-1 text-xs text-gray-600">
                        {pool.is_public ? 'A password is required when switching from public to private.' : 'Enter a password only if you want to replace the current private password.'}
                      </p>
                    </>
                  )}
                  <button
                    onClick={saveVisibility}
                    disabled={savingVisibility || settingsLocked || (!visibilityChanged && (isPublicDraft || !visibilityPassword.trim()))}
                    className="mt-2 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {savingVisibility ? 'Saving...' : 'Save visibility'}
                  </button>
                  <p className="mt-2 text-xs text-gray-600">Public pools can be found in search. Private pools require a password to join.</p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="block text-sm font-medium">Double-pick weeks</label>
                      <p className="text-xs text-gray-600">Click weeks or type a comma-separated list like 3,6,10. Players must make two picks in these weeks.</p>
                    </div>
                    <button onClick={saveDoubleWeeks} disabled={savingDouble || settingsLocked} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {savingDouble ? 'Saving...' : 'Save weeks'}
                    </button>
                  </div>
                  <div className="mb-3 grid grid-cols-6 gap-2 sm:grid-cols-9 lg:grid-cols-[repeat(18,minmax(0,1fr))]">
                    {ALL_WEEKS.map((week) => {
                      const selected = selectedDoubleWeeks.has(week)
                      return (
                        <button
                          key={week}
                          type="button"
                          onClick={() => toggleDoubleWeek(week)}
                          disabled={settingsLocked}
                          className={`rounded-md border px-2 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                            selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                          }`}
                          aria-pressed={selected}
                        >
                          {week}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    value={doubleWeeksText}
                    onChange={(e) => setDoubleWeeksText(e.target.value)}
                    disabled={settingsLocked}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                    placeholder="e.g. 5,8,12"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Members & Picks</h2>
                  <p className="text-sm text-gray-600">Draft picks are pending. Final picks are official and count toward standings.</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  Week
                  <select
                    value={selectedWeek}
                    onChange={(e) => {
                      const week = Number(e.target.value)
                      setSelectedWeek(week)
                      loadOverview(week)
                    }}
                    className="rounded-md border px-2 py-1"
                  >
                    {ALL_WEEKS.map((week) => (
                      <option key={week} value={week}>
                        {week}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border p-2 text-left">Member</th>
                      <th className="border p-2 text-left">Slot</th>
                      <th className="border p-2 text-left">Pending draft</th>
                      <th className="border p-2 text-left">Official final pick</th>
                      <th className="border p-2 text-left">Result</th>
                      <th className="border p-2 text-left">Record</th>
                      <th className="border p-2 text-left">Status</th>
                      <th className="border p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={rowKey(row)} className="align-top hover:bg-gray-50">
                        <td className="border p-2">
                          <div className="font-medium">{row.display_name}</div>
                          <div className="text-xs text-gray-500">{row.role} - joined {fmt(row.joined_at)}</div>
                        </td>
                        <td className="border p-2">Pick {row.slot}</td>
                        <td className="border p-2">
                          {hasFinalPick(row) ? (
                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                              This pick is final. Draft changes are locked.
                            </div>
                          ) : (
                            <>
                          <select
                            value={draftTeams[rowKey(row)] || ''}
                            onChange={(e) => setDraftTeams((prev) => ({ ...prev, [rowKey(row)]: e.target.value }))}
                            className="w-full rounded-md border px-2 py-1"
                          >
                            <option value="">No draft</option>
                            {TEAMS.map((team) => (
                              <option key={team} value={team}>
                                {team}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-xs text-gray-500">Saved {fmt(row.draft_updated_at)}</div>
                            </>
                          )}
                        </td>
                        <td className="border p-2">
                          <select
                            value={finalTeams[rowKey(row)] || ''}
                            onChange={(e) => setFinalTeams((prev) => ({ ...prev, [rowKey(row)]: e.target.value }))}
                            className="w-full rounded-md border px-2 py-1"
                          >
                            <option value="">No final</option>
                            {TEAMS.map((team) => (
                              <option key={team} value={team}>
                                {team}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-xs text-gray-500">
                            {row.locked_at ? `Locked ${fmt(row.locked_at)}` : 'No official pick yet'}
                          </div>
                          {row.result && <div className="mt-1 text-xs font-medium text-amber-700">Result already set. Override will clear it.</div>}
                        </td>
                        <td className="border p-2">{row.result || 'Pending'}</td>
                        <td className="border p-2">
                          {row.wins}-{row.losses}
                          {row.pushes ? `-${row.pushes}` : ''}
                          <div className="text-xs text-gray-500">{row.strikes_used} strike(s)</div>
                        </td>
                        <td className="border p-2">
                          {row.eliminated ? (
                            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">Eliminated{row.eliminated_week ? ` W${row.eliminated_week}` : ''}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">Alive</span>
                          )}
                        </td>
                        <td className="border p-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => saveDraft(row)}
                              disabled={!!runningAction || hasFinalPick(row)}
                              title={hasFinalPick(row) ? 'This pick is already final. Use Override final.' : undefined}
                              className="rounded-md bg-gray-100 px-2 py-1 hover:bg-gray-200 disabled:opacity-50"
                            >
                              Save draft
                            </button>
                            <button onClick={() => saveFinal(row)} disabled={!!runningAction} className="rounded-md bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700 disabled:opacity-50">
                              Override final
                            </button>
                            <button
                              onClick={() => removeMember(row)}
                              disabled={!!runningAction || settingsLocked}
                              title={settingsLocked ? 'Members cannot be removed after the league starts.' : undefined}
                              className="rounded-md bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && <p className="mt-3 text-sm text-gray-600">No members found.</p>}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
