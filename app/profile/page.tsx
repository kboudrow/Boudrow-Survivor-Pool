'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'
import { ensureProfile } from '@/lib/ensureProfile'

type HistoryRow = {
  pool_id: string
  pool_name: string
  season: number | null
  status: string | null
  eliminated_week: number | null
  strikes_used: number | null
  wins: number | null
  losses: number | null
  pushes: number | null
}

type ProfileUsernameRow = {
  username: string | null
}

function isWon(status?: string | null) {
  return (status || '').trim().toLowerCase() === 'won'
}

function isEliminated(status?: string | null) {
  return (status || '').trim().toLowerCase().startsWith('eliminated')
}

function n0(v: number | null | undefined) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function computeBestFinish(rows: HistoryRow[]) {
  if (rows.some((r) => isWon(r.status))) return 'Won'

  let maxElimWeek = 0
  for (const r of rows) {
    const w = r.eliminated_week
    if (typeof w === 'number' && Number.isFinite(w) && w > maxElimWeek) maxElimWeek = w
  }
  if (maxElimWeek > 0) return 'Eliminated Week ' + String(maxElimWeek)

  if (rows.length > 0) return 'In progress'
  return '—'
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

export default function ProfilePage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [currentEmail, setCurrentEmail] = useState('')

  // username
  const [username, setUsername] = useState('')
  const [savingUsername, setSavingUsername] = useState(false)
  const [usernameMsg, setUsernameMsg] = useState<string | null>(null)

  // email
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)
  const [emailMsg, setEmailMsg] = useState<string | null>(null)

  // password
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<string | null>(null)

  // reset email
  const [resetSending, setResetSending] = useState(false)
  const [resetMsg, setResetMsg] = useState<string | null>(null)

  // history
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const pwChecks = useMemo(() => {
    const pw = newPassword
    return {
      len: pw.length >= 8,
      upper: /[A-Z]/.test(pw),
      lower: /[a-z]/.test(pw),
      num: /[0-9]/.test(pw),
      special: /[^A-Za-z0-9]/.test(pw),
      match: !!newPassword && !!newPassword2 && newPassword === newPassword2,
    }
  }, [newPassword, newPassword2])

  const allPwOk = pwChecks.len && pwChecks.upper && pwChecks.lower && pwChecks.num && pwChecks.special && pwChecks.match

  const loadHistory = async () => {
    setHistoryLoading(true)
    setErr(null)
    try {
      const { data, error } = await supabase.rpc('get_my_pool_history')
      if (error) throw error
      setHistory(((data as unknown) as HistoryRow[]) || [])
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to load history.'))
    } finally {
      setHistoryLoading(false)
    }
  }

  const stats = useMemo(() => {
    const poolsPlayed = history.length
    const poolsWon = history.filter((r) => isWon(r.status)).length
    const poolsEliminated = history.filter((r) => isEliminated(r.status) || (typeof r.eliminated_week === 'number' && r.eliminated_week > 0)).length

    const totalWins = history.reduce((a, r) => a + n0(r.wins), 0)
    const totalLosses = history.reduce((a, r) => a + n0(r.losses), 0)
    const totalPushes = history.reduce((a, r) => a + n0(r.pushes), 0)
    const totalStrikes = history.reduce((a, r) => a + n0(r.strikes_used), 0)

    let lastSeasonPlayed: number | null = null
    for (const r of history) {
      const s = r.season
      if (typeof s === 'number' && Number.isFinite(s)) {
        if (lastSeasonPlayed === null || s > lastSeasonPlayed) lastSeasonPlayed = s
      }
    }

    const recordLabel = totalPushes > 0 ? `${totalWins}-${totalLosses}-${totalPushes}` : `${totalWins}-${totalLosses}`

    return {
      poolsPlayed,
      poolsWon,
      poolsEliminated,
      bestFinish: computeBestFinish(history),
      recordLabel,
      totalStrikes,
      lastSeasonPlayed,
    }
  }, [history])

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        setLoading(true)
        setErr(null)

        const { data: userResp, error: userErr } = await supabase.auth.getUser()
        if (userErr) throw userErr
        const user = userResp.user

        if (!user) {
          router.push('/')
          return
        }

        // best-effort profile row creation
        const ensured = await ensureProfile()
        if (!ensured.ok) console.warn('ensureProfile failed:', ensured.error)

        if (!alive) return
        setUserId(user.id)
        setCurrentEmail(user.email || '')
        setNewEmail(user.email || '')

        // load username
        const { data: prof, error: profErr } = await supabase.from('profiles').select('username').eq('id', user.id).maybeSingle()
        if (profErr) throw profErr
        if (!alive) return
        setUsername((prof as ProfileUsernameRow | null)?.username || '')

        await loadHistory()
      } catch (e: unknown) {
        if (!alive) return
        setErr(getErrorMessage(e, 'Failed to load profile.'))
      } finally {
        if (alive) setLoading(false)
      }
    }

    load()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveUsername = async () => {
    if (!userId) return
    setSavingUsername(true)
    setUsernameMsg(null)
    setErr(null)
    try {
      const cleaned = username.trim()
      if (!cleaned) throw new Error('Username cannot be empty.')
      if (cleaned.length < 3) throw new Error('Username must be at least 3 characters.')
      if (cleaned.length > 30) throw new Error('Username must be 30 characters or fewer.')

      const { error } = await supabase.from('profiles').update({ username: cleaned }).eq('id', userId)
      if (error) throw error

      setUsername(cleaned)
      setUsernameMsg('Saved.')
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to save username.'))
    } finally {
      setSavingUsername(false)
    }
  }

  const saveEmail = async () => {
    setSavingEmail(true)
    setEmailMsg(null)
    setErr(null)
    try {
      const cleaned = newEmail.trim()
      if (!cleaned) throw new Error('Please enter an email address.')
      if (cleaned === currentEmail) throw new Error('That’s already your current email.')

      const { error } = await supabase.auth.updateUser({ email: cleaned })
      if (error) throw error

      setEmailMsg('Email update requested. Check your inbox to confirm.')
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to request email change.'))
    } finally {
      setSavingEmail(false)
    }
  }

  const savePassword = async () => {
    setSavingPw(true)
    setPwMsg(null)
    setErr(null)
    try {
      if (!allPwOk) throw new Error('Please meet all password requirements.')

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      setNewPassword('')
      setNewPassword2('')
      setPwMsg('Password updated.')
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to update password.'))
    } finally {
      setSavingPw(false)
    }
  }

  const sendResetEmail = async () => {
    setResetSending(true)
    setResetMsg(null)
    setErr(null)
    try {
      if (!currentEmail) throw new Error('No email found on your account.')
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const redirectTo = `${origin}/reset`

      const { error } = await supabase.auth.resetPasswordForEmail(currentEmail, { redirectTo })
      if (error) throw error

      setResetMsg('Password reset email sent. Check your inbox.')
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to send reset email.'))
    } finally {
      setResetSending(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <main className="min-h-[70vh] py-8 px-4">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Profile</h1>
          <div className="flex items-center gap-2">
            <Link href="/pools" className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200">
              My Pools
            </Link>
            <Link href="/archives" className="px-3 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100">
              History
            </Link>
            <button onClick={signOut} className="px-3 py-2 rounded-md bg-gray-700 text-white hover:bg-gray-800">
              Sign out
            </button>
          </div>
        </div>

        {loading && <p>Loading…</p>}
        {!loading && err && <div className="mb-3 text-red-600">{err}</div>}

        {!loading && (
          <div className="grid gap-4">
            {/* Stats */}
            <section className="border rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Your Stats</h2>
                  <p className="text-xs text-gray-500">Based on your pool history. No one can see your email.</p>
                </div>
                <button
                  onClick={loadHistory}
                  className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                  disabled={historyLoading}
                >
                  {historyLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Pools played" value={String(stats.poolsPlayed)} />
                <StatTile label="Pools won" value={String(stats.poolsWon)} />
                <StatTile label="Pools eliminated" value={String(stats.poolsEliminated)} />
                <StatTile label="Best finish" value={stats.bestFinish} />
                <StatTile label="Career record" value={stats.recordLabel} />
                <StatTile label="Total strikes" value={String(stats.totalStrikes)} />
                <StatTile label="Last season played" value={stats.lastSeasonPlayed !== null ? String(stats.lastSeasonPlayed) : '—'} />
              </div>
            </section>

            {/* Account */}
            <section className="border rounded-lg p-4 bg-white">
              <h2 className="text-lg font-semibold mb-2">Account</h2>
              <div className="text-sm text-gray-700">
                <div>
                  <span className="text-gray-500">Current email:</span> <span className="font-medium">{currentEmail || '—'}</span>
                </div>
              </div>

              <div className="mt-4 grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">Change email</label>
                  <input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="you@example.com"
                    type="email"
                  />
                  {emailMsg && <div className="text-sm text-emerald-700 mt-2">{emailMsg}</div>}
                </div>
                <div className="flex items-end">
                  <button
                    onClick={saveEmail}
                    disabled={savingEmail}
                    className="w-full px-4 py-2 rounded-md bg-black text-white hover:bg-gray-900 disabled:opacity-50"
                  >
                    {savingEmail ? 'Saving…' : 'Update email'}
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <button
                  onClick={sendResetEmail}
                  disabled={resetSending}
                  className="text-sm underline text-blue-700 disabled:opacity-50"
                >
                  {resetSending ? 'Sending reset email…' : 'Send me a password reset email'}
                </button>
                {resetMsg && <div className="text-sm text-emerald-700 mt-2">{resetMsg}</div>}
              </div>
            </section>

            {/* Username */}
            <section className="border rounded-lg p-4 bg-white">
              <h2 className="text-lg font-semibold mb-2">Username</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">Display name</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="e.g. Kev, Boudrow, etc."
                  />
                  <p className="text-xs text-gray-500 mt-2">This is what others see in standings. (No emails are shown.)</p>
                  {usernameMsg && <div className="text-sm text-emerald-700 mt-2">{usernameMsg}</div>}
                </div>
                <div className="flex items-end">
                  <button
                    onClick={saveUsername}
                    disabled={savingUsername}
                    className="w-full px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingUsername ? 'Saving…' : 'Save username'}
                  </button>
                </div>
              </div>
            </section>

            {/* Password */}
            <section className="border rounded-lg p-4 bg-white">
              <h2 className="text-lg font-semibold mb-2">Password</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-sm font-medium mb-1">New password</div>
                  <input
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    type="password"
                  />
                </label>

                <label className="block">
                  <div className="text-sm font-medium mb-1">Re-enter new password</div>
                  <input
                    value={newPassword2}
                    onChange={(e) => setNewPassword2(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    type="password"
                  />
                </label>
              </div>

              <ul className="text-xs text-gray-600 mt-3 list-disc pl-5">
                <li className={pwChecks.len ? 'text-green-700' : ''}>At least 8 chars</li>
                <li className={pwChecks.upper ? 'text-green-700' : ''}>Uppercase</li>
                <li className={pwChecks.lower ? 'text-green-700' : ''}>Lowercase</li>
                <li className={pwChecks.num ? 'text-green-700' : ''}>Number</li>
                <li className={pwChecks.special ? 'text-green-700' : ''}>Special</li>
                <li className={pwChecks.match ? 'text-green-700' : ''}>Match</li>
              </ul>

              {pwMsg && <div className="text-sm text-emerald-700 mt-2">{pwMsg}</div>}

              <div className="mt-3">
                <button
                  onClick={savePassword}
                  disabled={savingPw || !allPwOk}
                  className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {savingPw ? 'Updating…' : 'Update password'}
                </button>
              </div>
            </section>

            {/* History */}
            <section className="border rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold">History</h2>
                <button
                  onClick={loadHistory}
                  className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                  disabled={historyLoading}
                >
                  {historyLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {history.length === 0 ? (
                <div className="text-sm text-gray-600">No history yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[780px] w-full border border-gray-200 rounded-lg text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left p-2 border">Pool</th>
                        <th className="text-left p-2 border">Season</th>
                        <th className="text-left p-2 border">Result</th>
                        <th className="text-left p-2 border">Record</th>
                        <th className="text-left p-2 border">Strikes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((r) => (
                        <tr key={r.pool_id} className="hover:bg-gray-50">
                          <td className="p-2 border">
                            <Link href={`/pools/${r.pool_id}`} className="font-medium underline">
                              {r.pool_name}
                            </Link>
                            <div className="text-xs text-gray-500">{r.pool_id.slice(0, 8)}…</div>
                          </td>
                          <td className="p-2 border">{r.season ?? '—'}</td>
                          <td className="p-2 border">{r.status ?? '—'}</td>
                          <td className="p-2 border">
                            {n0(r.wins)}-{n0(r.losses)}
                            {n0(r.pushes) ? `-${n0(r.pushes)}` : ''}
                          </td>
                          <td className="p-2 border">{n0(r.strikes_used)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-xs text-gray-500 mt-2">This page only shows <b>your</b> account data and <b>your</b> pool history.</p>
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
