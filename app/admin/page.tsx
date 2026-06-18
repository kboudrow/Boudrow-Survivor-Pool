'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'

type PoolOverview = {
  pool_id: string
  name: string
  created_by: string
  owner_email: string | null
  is_public: boolean
  archived: boolean
  activation_status: string
  payment_status: string
  season: number
  start_week: number
  max_members: number | null
  allow_multiple_entries: boolean
  max_entries_per_user: number
  entries_count: number
  unique_members_count: number
  draft_picks_count: number
  final_picks_count: number
  stats_rows_count: number
  created_at: string | null
}

type PoolEntry = {
  entry_id: string
  profile_id: string
  email: string | null
  display_name: string
  entry_number: number
  role: string
  status: string
  joined_at: string | null
  draft_picks_count: number
  final_picks_count: number
  wins: number
  losses: number
  pushes: number
  strikes_used: number
  eliminated: boolean
  eliminated_week: number | null
}

type ScheduleAuditRow = {
  season: number
  week: number
  game_count: number
  duplicate_event_count: number
  future_result_count: number
  final_missing_winner_count: number
  invalid_winner_count: number
  duplicate_team_count: number
  future_pick_result_count: number
  team_appearance_count: number
  issue_count: number
}

function fmt(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function statusClass(status: string) {
  const lower = status.toLowerCase()
  if (lower === 'active' || lower === 'paid') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (lower === 'draft' || lower === 'unpaid') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-slate-200 bg-slate-50 text-slate-700'
}

export default function SuperAdminPage() {
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pools, setPools] = useState<PoolOverview[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null)
  const [entries, setEntries] = useState<PoolEntry[]>([])
  const [entriesLoading, setEntriesLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [scheduleAudit, setScheduleAudit] = useState<ScheduleAuditRow[]>([])
  const [auditSeason, setAuditSeason] = useState('2026')

  const selectedPool = pools.find((pool) => pool.pool_id === selectedPoolId) || null

  const filteredPools = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pools.filter((pool) => {
      const matchesStatus = statusFilter === 'all' || pool.activation_status === statusFilter || (statusFilter === 'archived' && pool.archived)
      if (!matchesStatus) return false
      if (!q) return true
      return [pool.name, pool.owner_email || '', pool.pool_id, pool.created_by]
        .some((value) => value.toLowerCase().includes(q))
    })
  }, [pools, query, statusFilter])

  const totals = useMemo(() => {
    return pools.reduce(
      (acc, pool) => {
        acc.pools += 1
        acc.entries += pool.entries_count
        acc.members += pool.unique_members_count
        if (pool.activation_status === 'active') acc.active += 1
        if (pool.archived) acc.archived += 1
        return acc
      },
      { pools: 0, entries: 0, members: 0, active: 0, archived: 0 },
    )
  }, [pools])
  const auditIssues = useMemo(() => scheduleAudit.filter((row) => row.issue_count > 0), [scheduleAudit])

  const loadPools = async () => {
    setError(null)
    const { data, error: overviewErr } = await supabase.rpc('superadmin_pool_overview')
    if (overviewErr) throw overviewErr
    const nextPools = (data || []) as PoolOverview[]
    setPools(nextPools)
    setSelectedPoolId((current) => current || nextPools[0]?.pool_id || null)
  }

  const loadScheduleAudit = async (seasonText = auditSeason) => {
    const season = parseInt(seasonText, 10)
    const { data, error: auditErr } = await supabase.rpc('superadmin_schedule_integrity_audit', {
      p_season: Number.isFinite(season) ? season : null,
    })
    if (auditErr) throw auditErr
    setScheduleAudit((data || []) as ScheduleAuditRow[])
  }

  const loadEntries = async (poolId: string) => {
    setEntriesLoading(true)
    setError(null)
    try {
      const { data, error: entriesErr } = await supabase.rpc('superadmin_pool_entries', { p_pool_id: poolId })
      if (entriesErr) throw entriesErr
      setEntries((data || []) as PoolEntry[])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load pool entries.'))
    } finally {
      setEntriesLoading(false)
    }
  }

  useEffect(() => {
    let alive = true

    const init = async () => {
      try {
        setLoading(true)
        setError(null)
        const {
          data: { user },
          error: userErr,
        } = await supabase.auth.getUser()
        if (userErr) throw userErr
        const userEmail = user?.email?.toLowerCase() || null
        if (!alive) return
        setEmail(userEmail)
        const canAccess = userEmail === SUPERADMIN_EMAIL
        setAuthorized(canAccess)
        if (!canAccess) return
        await Promise.all([loadPools(), loadScheduleAudit()])
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load superadmin dashboard.'))
      } finally {
        if (alive) setLoading(false)
      }
    }

    init()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (authorized && selectedPoolId) loadEntries(selectedPoolId)
  }, [authorized, selectedPoolId])

  const repairSelectedLeague = async () => {
    if (!selectedPool) return
    const confirmed = window.confirm(`Repair future results for "${selectedPool.name}"? This clears this league's stat rows and moves future final picks back to editable drafts. It does not change other leagues.`)
    if (!confirmed) return
    setRunningAction('repair-selected')
    setError(null)
    setNotice(null)
    try {
      const { data, error: repairErr } = await supabase.rpc('superadmin_repair_pool_future_results', { p_pool_id: selectedPool.pool_id })
      if (repairErr) throw repairErr
      setNotice(String(data || 'League repair complete.'))
      await loadPools()
      if (selectedPoolId) await loadEntries(selectedPoolId)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'League repair failed.'))
    } finally {
      setRunningAction(null)
    }
  }

  const removeEntry = async (entry: PoolEntry) => {
    if (!selectedPool) return
    const label = entry.display_name
    const entryCount = entries.filter((candidate) => candidate.profile_id === entry.profile_id).length
    const confirmed = window.confirm(
      `Remove ${label} from ${selectedPool.name}?\n\nProfile ID: ${entry.profile_id.slice(0, 8)}\nEntries removed: ${entryCount}\n\nThis removes that member's entries and all of their picks.`,
    )
    if (!confirmed) return
    setRunningAction(entry.profile_id)
    setError(null)
    setNotice(null)
    try {
      const { error: removeErr } = await supabase.rpc('admin_remove_pool_member', {
        p_pool_id: selectedPool.pool_id,
        p_profile_id: entry.profile_id,
      })
      if (removeErr) throw removeErr
      setNotice(`${label} removed.`)
      await loadPools()
      await loadEntries(selectedPool.pool_id)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to remove entry.'))
    } finally {
      setRunningAction(null)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <p>Loading admin...</p>
      </main>
    )
  }

  if (!authorized) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
          <h1 className="text-xl font-bold">Not authorized</h1>
          <p className="mt-2 text-sm">
            This page is restricted to {SUPERADMIN_EMAIL}. {email ? `You are signed in as ${email}.` : 'Please sign in with the superadmin account.'}
          </p>
          <Link href="/?auth=signin&returnTo=%2Fadmin" className="mt-4 inline-flex rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white">
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Platform Admin</p>
            <h1 className="text-3xl font-bold text-slate-950">Superadmin</h1>
            <p className="mt-1 text-sm text-slate-600">Signed in as {email}. League and pool support tools live here.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => loadPools().catch((e) => setError(getErrorMessage(e, 'Refresh failed.')))} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
              Refresh
            </button>
          </div>
        </div>

        {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Leagues / Pools" value={totals.pools} />
          <Stat label="Active" value={totals.active} />
          <Stat label="Archived" value={totals.archived} />
          <Stat label="Unique Members" value={totals.members} />
          <Stat label="Entries" value={totals.entries} />
        </section>

        <details className="mb-5 rounded-lg border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-slate-950">Data health tools</summary>
          <div className="mt-3 mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-slate-950">Schedule & Result Integrity</h2>
              <p className="text-sm text-slate-600">Flags duplicate games, impossible future results, missing winners, and unusual weekly game counts.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={auditSeason}
                onChange={(event) => setAuditSeason(event.target.value)}
                className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm"
                inputMode="numeric"
              />
              <button
                onClick={() => loadScheduleAudit().catch((e) => setError(getErrorMessage(e, 'Schedule audit failed.')))}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
              >
                Run audit
              </button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Info label="Weeks Audited" value={String(scheduleAudit.length)} />
            <Info label="Weeks With Issues" value={String(auditIssues.length)} />
            <Info label="Future Game Results" value={String(scheduleAudit.reduce((sum, row) => sum + row.future_result_count, 0))} />
            <Info label="Future Pick Results" value={String(scheduleAudit.reduce((sum, row) => sum + row.future_pick_result_count, 0))} />
            <Info label="Duplicate IDs" value={String(scheduleAudit.reduce((sum, row) => sum + row.duplicate_event_count, 0))} />
          </div>
          {auditIssues.length === 0 ? (
            <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              No schedule or result integrity issues found for {auditSeason || 'all seasons'}.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border p-2 text-left">Season</th>
                    <th className="border p-2 text-left">Week</th>
                    <th className="border p-2 text-left">Games</th>
                    <th className="border p-2 text-left">Duplicate IDs</th>
                    <th className="border p-2 text-left">Future Game Results</th>
                    <th className="border p-2 text-left">Future Pick Results</th>
                    <th className="border p-2 text-left">Final Missing Winner</th>
                    <th className="border p-2 text-left">Invalid Winner</th>
                    <th className="border p-2 text-left">Duplicate Teams</th>
                    <th className="border p-2 text-left">Team Appearances</th>
                  </tr>
                </thead>
                <tbody>
                  {auditIssues.map((row) => (
                    <tr key={`${row.season}:${row.week}`} className="hover:bg-slate-50">
                      <td className="border p-2">{row.season}</td>
                      <td className="border p-2">Week {row.week}</td>
                      <td className={`border p-2 ${row.game_count > 16 || row.game_count < 12 ? 'font-semibold text-red-700' : ''}`}>{row.game_count}</td>
                      <td className="border p-2">{row.duplicate_event_count}</td>
                      <td className="border p-2">{row.future_result_count}</td>
                      <td className="border p-2">{row.future_pick_result_count}</td>
                      <td className="border p-2">{row.final_missing_winner_count}</td>
                      <td className="border p-2">{row.invalid_winner_count}</td>
                      <td className="border p-2">{row.duplicate_team_count}</td>
                      <td className="border p-2">{row.team_appearance_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>

        <div className="grid gap-5 lg:grid-cols-[minmax(360px,460px)_1fr]">
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-3">
              <div className="flex flex-wrap gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search leagues, pools, owner, id"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
                  <option value="all">All</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
            </div>
            <div className="max-h-[680px] overflow-y-auto">
              {filteredPools.map((pool) => (
                <button
                  key={pool.pool_id}
                  type="button"
                  onClick={() => setSelectedPoolId(pool.pool_id)}
                  className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${selectedPoolId === pool.pool_id ? 'bg-slate-100' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-950">{pool.name}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{pool.owner_email || pool.created_by}</div>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass(pool.activation_status)}`}>
                      {pool.activation_status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                    <span>{pool.entries_count}/{pool.max_members || '-'} entries</span>
                    <span>Week {pool.start_week}</span>
                    <span>{pool.is_public ? 'Public' : 'Private'}</span>
                    {pool.archived && <span>Archived</span>}
                  </div>
                </button>
              ))}
              {filteredPools.length === 0 && <p className="p-4 text-sm text-slate-500">No leagues match that filter.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            {!selectedPool ? (
              <p className="text-sm text-slate-600">Select a pool to inspect it.</p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold">{selectedPool.name}</h2>
                    <p className="mt-1 text-sm text-slate-600">Owner: {selectedPool.owner_email || selectedPool.created_by}</p>
                    <p className="mt-1 text-xs text-slate-500">Pool ID: {selectedPool.pool_id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/pools?pool=${selectedPool.pool_id}`} className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200">
                      Open Pool
                    </Link>
                    <Link href={`/pools/${selectedPool.pool_id}/admin`} className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700">
                      League Admin
                    </Link>
                    <button
                      onClick={repairSelectedLeague}
                      disabled={runningAction === 'repair-selected'}
                      className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      {runningAction === 'repair-selected' ? 'Repairing...' : 'Repair This League'}
                    </button>
                  </div>
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Info label="Status" value={`${selectedPool.activation_status} / ${selectedPool.payment_status}`} />
                  <Info label="Visibility" value={selectedPool.is_public ? 'Public' : 'Private'} />
                  <Info label="Entries" value={`${selectedPool.entries_count}/${selectedPool.max_members || '-'}`} />
                  <Info label="Multi Entry" value={selectedPool.allow_multiple_entries ? `Up to ${selectedPool.max_entries_per_user}` : 'Single entry'} />
                  <Info label="Draft Picks" value={String(selectedPool.draft_picks_count)} />
                  <Info label="Final Picks" value={String(selectedPool.final_picks_count)} />
                  <Info label="Stats Rows" value={String(selectedPool.stats_rows_count)} />
                  <Info label="Created" value={fmt(selectedPool.created_at)} />
                </div>

                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold">Entries</h3>
                  {entriesLoading && <span className="text-xs text-slate-500">Loading...</span>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="border p-2 text-left">Member</th>
                        <th className="border p-2 text-left">Entry</th>
                        <th className="border p-2 text-left">Role</th>
                        <th className="border p-2 text-left">Picks</th>
                        <th className="border p-2 text-left">Record</th>
                        <th className="border p-2 text-left">Status</th>
                        <th className="border p-2 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => (
                        <tr key={entry.entry_id} className="hover:bg-slate-50">
                          <td className="border p-2">
                            <div className="font-medium">{entry.display_name}</div>
                            <div className="text-xs text-slate-500">{entry.email || entry.profile_id}</div>
                          </td>
                          <td className="border p-2">{entry.entry_number}</td>
                          <td className="border p-2 capitalize">{entry.role}</td>
                          <td className="border p-2">{entry.draft_picks_count} draft / {entry.final_picks_count} final</td>
                          <td className="border p-2">{entry.wins}-{entry.losses}{entry.pushes ? `-${entry.pushes}` : ''}</td>
                          <td className="border p-2">
                            {entry.eliminated ? (
                              <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">Eliminated{entry.eliminated_week ? ` W${entry.eliminated_week}` : ''}</span>
                            ) : (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">{entry.status || 'Alive'}</span>
                            )}
                          </td>
                          <td className="border p-2">
                            <button
                              onClick={() => removeEntry(entry)}
                              disabled={!!runningAction}
                              className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {entries.length === 0 && !entriesLoading && <p className="mt-3 text-sm text-slate-500">No entries found.</p>}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}
