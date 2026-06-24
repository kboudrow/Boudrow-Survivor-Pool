'use client'

import type { ChangeEvent } from 'react'
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
  display_name: string | null
  avatar_url: string | null
  first_name: string | null
  last_name: string | null
  favorite_team: string | null
}

const FAVORITE_TEAMS = [
  ['ARI', 'Arizona Cardinals'],
  ['ATL', 'Atlanta Falcons'],
  ['BAL', 'Baltimore Ravens'],
  ['BUF', 'Buffalo Bills'],
  ['CAR', 'Carolina Panthers'],
  ['CHI', 'Chicago Bears'],
  ['CIN', 'Cincinnati Bengals'],
  ['CLE', 'Cleveland Browns'],
  ['DAL', 'Dallas Cowboys'],
  ['DEN', 'Denver Broncos'],
  ['DET', 'Detroit Lions'],
  ['GB', 'Green Bay Packers'],
  ['HOU', 'Houston Texans'],
  ['IND', 'Indianapolis Colts'],
  ['JAX', 'Jacksonville Jaguars'],
  ['KC', 'Kansas City Chiefs'],
  ['LAC', 'Los Angeles Chargers'],
  ['LAR', 'Los Angeles Rams'],
  ['LV', 'Las Vegas Raiders'],
  ['MIA', 'Miami Dolphins'],
  ['MIN', 'Minnesota Vikings'],
  ['NE', 'New England Patriots'],
  ['NO', 'New Orleans Saints'],
  ['NYG', 'New York Giants'],
  ['NYJ', 'New York Jets'],
  ['PHI', 'Philadelphia Eagles'],
  ['PIT', 'Pittsburgh Steelers'],
  ['SEA', 'Seattle Seahawks'],
  ['SF', 'San Francisco 49ers'],
  ['TB', 'Tampa Bay Buccaneers'],
  ['TEN', 'Tennessee Titans'],
  ['WAS', 'Washington Commanders'],
]

function isWon(status?: string | null) {
  return (status || '').trim().toLowerCase() === 'won'
}

function isEliminated(status?: string | null) {
  return (status || '').trim().toLowerCase().startsWith('eliminated')
}

function n0(v: number | null | undefined) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function isMissingFavoriteTeamColumn(error: unknown) {
  return getErrorMessage(error, '').toLowerCase().includes('favorite_team')
}

function isDuplicateUsernameError(error: unknown) {
  const message = getErrorMessage(error, '').toLowerCase()
  return message.includes('profiles_username_lower_unique') || message.includes('profiles_username_normalized_unique') || message.includes('duplicate key') || message.includes('unique constraint')
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ')
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
  return '-'
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

function StatusBadge({ complete }: { complete: boolean }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${complete ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
      {complete ? 'Profile complete' : 'Profile incomplete'}
    </span>
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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [favoriteTeam, setFavoriteTeam] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [editingAvatar, setEditingAvatar] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarMsg, setAvatarMsg] = useState<string | null>(null)
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
  const profileComplete = username.trim().length >= 3
  const profileTitle = username.trim() || [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || currentEmail || 'Profile'

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
        const profileWithFavorite = await supabase
          .from('profiles')
          .select('username, display_name, avatar_url, first_name, last_name, favorite_team')
          .eq('id', user.id)
          .maybeSingle()
        let prof = profileWithFavorite.data as ProfileUsernameRow | null
        let profErr = profileWithFavorite.error
        if (profErr && isMissingFavoriteTeamColumn(profErr)) {
          const fallback = await supabase
            .from('profiles')
            .select('username, display_name, avatar_url, first_name, last_name')
            .eq('id', user.id)
            .maybeSingle()
          prof = fallback.data ? { ...fallback.data, favorite_team: null } as ProfileUsernameRow : null
          profErr = fallback.error
        }
        if (profErr) throw profErr
        if (!alive) return
        const profileRow = prof
        setUsername(profileRow?.username || profileRow?.display_name || '')
        setFirstName(profileRow?.first_name || '')
        setLastName(profileRow?.last_name || '')
        setFavoriteTeam(profileRow?.favorite_team || '')
        setAvatarUrl(profileRow?.avatar_url || null)

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
      const cleaned = normalizeUsername(username)
      if (!cleaned) throw new Error('Username cannot be empty.')
      if (cleaned.length < 3) throw new Error('Username must be at least 3 characters.')
      if (cleaned.length > 30) throw new Error('Username must be 30 characters or fewer.')
      if (!/^[A-Za-z0-9_. -]+$/.test(cleaned)) throw new Error('Username can only use letters, numbers, spaces, periods, underscores, and hyphens.')

      let { error } = await supabase
        .from('profiles')
        .update({
          username: cleaned,
          display_name: cleaned,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          favorite_team: favoriteTeam || null,
        })
        .eq('id', userId)
      if (error && isMissingFavoriteTeamColumn(error)) {
        const fallback = await supabase
          .from('profiles')
          .update({
            username: cleaned,
            display_name: cleaned,
            first_name: firstName.trim() || null,
            last_name: lastName.trim() || null,
          })
          .eq('id', userId)
        error = fallback.error
      }
      if (error) {
        if (isDuplicateUsernameError(error)) throw new Error('That username is already taken. Try another one.')
        throw error
      }

      setUsername(cleaned)
      setFirstName(firstName.trim())
      setLastName(lastName.trim())
      setUsernameMsg('Profile saved.')
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to save username.'))
    } finally {
      setSavingUsername(false)
    }
  }

  const handleAvatarFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    setAvatarFile(file)
    setAvatarMsg(null)
  }

  const saveAvatar = async () => {
    if (!userId) return
    if (!avatarFile) {
      setAvatarMsg('Choose a photo first.')
      return
    }

    setAvatarUploading(true)
    setAvatarMsg(null)
    setErr(null)
    try {
      if (!avatarFile.type.startsWith('image/')) throw new Error('Choose an image file.')
      if (avatarFile.size > 5 * 1024 * 1024) throw new Error('Profile picture must be 5 MB or smaller.')

      const ext = avatarFile.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const path = `${userId}/${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, avatarFile, {
        cacheControl: '3600',
        upsert: true,
      })
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      const publicUrl = data.publicUrl
      const { error: profileError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId)
      if (profileError) throw profileError

      setAvatarUrl(publicUrl)
      setAvatarFile(null)
      setEditingAvatar(false)
      setAvatarMsg('Profile picture saved.')
    } catch (e: unknown) {
      setErr(getErrorMessage(e, 'Failed to upload profile picture.'))
    } finally {
      setAvatarUploading(false)
    }
  }

  const saveEmail = async () => {
    setSavingEmail(true)
    setEmailMsg(null)
    setErr(null)
    try {
      const cleaned = newEmail.trim()
      if (!cleaned) throw new Error('Please enter an email address.')
      if (cleaned === currentEmail) throw new Error("That's already your current email.")

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
      if (!newPassword || !newPassword2) throw new Error('Enter and re-enter your new password.')
      if (newPassword !== newPassword2) throw new Error('Passwords do not match. Please try again.')
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
            <button onClick={signOut} className="px-3 py-2 rounded-md bg-gray-700 text-white hover:bg-gray-800">
              Sign out
            </button>
          </div>
        </div>

        {loading && <p>Loading...</p>}
        {!loading && err && <div className="mb-3 text-red-600">{err}</div>}

        {!loading && (
          <div className="grid gap-4">
            <section className={`rounded-lg border p-4 ${profileComplete ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="relative">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white bg-white text-lg font-bold text-slate-700 shadow-sm">
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span>{(username.trim() || currentEmail || '?').slice(0, 1).toUpperCase()}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingAvatar((value) => !value)}
                      className="absolute -bottom-1 -right-1 rounded-full border border-slate-200 bg-white px-1.5 py-1 text-xs shadow-sm hover:bg-slate-50"
                      aria-label="Edit profile photo"
                      title="Edit profile photo"
                    >
                      Edit
                    </button>
                  </div>
                  <div>
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold">{profileTitle}</h2>
                      <StatusBadge complete={profileComplete} />
                    </div>
                    {editingAvatar && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={handleAvatarFile}
                          disabled={avatarUploading}
                          className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={saveAvatar}
                          disabled={avatarUploading || !avatarFile}
                          className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {avatarUploading ? 'Saving...' : 'Save photo'}
                        </button>
                        {avatarMsg && <div className="text-sm text-emerald-700">{avatarMsg}</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-md bg-white px-3 py-2 text-sm shadow-sm">
                  <span className="text-gray-500">Username:</span> <span className="font-semibold">{username.trim() || 'Not set'}</span>
                </div>
              </div>
            </section>

            {/* Stats */}
            <section className="border rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <h2 className="text-lg font-semibold">Stats</h2>
                </div>
                <button
                  onClick={loadHistory}
                  className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                  disabled={historyLoading}
                >
                  {historyLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>

              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <StatTile label="Pools played" value={String(stats.poolsPlayed)} />
                <StatTile label="Pools won" value={String(stats.poolsWon)} />
                <StatTile label="Pools eliminated" value={String(stats.poolsEliminated)} />
                <StatTile label="Best finish" value={stats.bestFinish} />
                <StatTile label="Career record" value={stats.recordLabel} />
                <StatTile label="Total strikes" value={String(stats.totalStrikes)} />
                <StatTile label="Last season played" value={stats.lastSeasonPlayed !== null ? String(stats.lastSeasonPlayed) : '-'} />
              </div>
            </section>

            {/* Profile details */}
            <section className="border rounded-lg p-4 bg-white">
              <h2 className="text-lg font-semibold mb-2">Profile Details</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Username</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="e.g. SundayCrew"
                  />
                  <p className="mt-1 text-xs text-slate-500">Unique. Spaces, letters, numbers, periods, underscores, and hyphens only.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">First name</label>
                  <input
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Last name</label>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="Last name"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">Favorite team</label>
                  <select
                    value={favoriteTeam}
                    onChange={(e) => setFavoriteTeam(e.target.value)}
                    className="w-full border rounded-md px-3 py-2"
                  >
                    <option value="">Choose a team</option>
                    {FAVORITE_TEAMS.map(([abbr, name]) => (
                      <option key={abbr} value={abbr}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {usernameMsg && <div className="text-sm text-emerald-700 mt-2">{usernameMsg}</div>}
                </div>
                <div className="flex items-end">
                  <button
                    onClick={saveUsername}
                    disabled={savingUsername}
                    className="w-full px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingUsername ? 'Saving...' : 'Save profile'}
                  </button>
                </div>
              </div>
            </section>

            {/* Account security */}
            <section className="border rounded-lg p-4 bg-white">
              <h2 className="text-lg font-semibold mb-2">Account & Security</h2>
              <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <span className="text-gray-500">Email:</span> <span className="font-medium">{currentEmail || '-'}</span>
              </div>

              <div className="mb-5 grid sm:grid-cols-3 gap-3">
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
                    {savingEmail ? 'Saving...' : 'Update email'}
                  </button>
                </div>
              </div>

              <h3 className="mb-2 text-sm font-semibold">Change password</h3>
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
                <li className={pwChecks.len ? 'text-green-700' : ''}>At least 8 characters</li>
                <li className={pwChecks.upper ? 'text-green-700' : ''}>One uppercase letter</li>
                <li className={pwChecks.lower ? 'text-green-700' : ''}>One lowercase letter</li>
                <li className={pwChecks.num ? 'text-green-700' : ''}>One number</li>
                <li className={pwChecks.special ? 'text-green-700' : ''}>One special character</li>
                <li className={pwChecks.match ? 'text-green-700' : ''}>Passwords match</li>
              </ul>

              {pwMsg && <div className="text-sm text-emerald-700 mt-2">{pwMsg}</div>}

              <div className="mt-3">
                <button
                  onClick={savePassword}
                  disabled={savingPw}
                  className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {savingPw ? 'Updating...' : 'Update password'}
                </button>
              </div>

              <div className="mt-5 border-t pt-4">
                <button
                  onClick={sendResetEmail}
                  disabled={resetSending}
                  className="text-sm underline text-blue-700 disabled:opacity-50"
                >
                  {resetSending ? 'Sending reset email...' : 'Send me a password reset email'}
                </button>
                {resetMsg && <div className="text-sm text-emerald-700 mt-2">{resetMsg}</div>}
              </div>
            </section>

            {/* History */}
            <section className="border rounded-lg p-4 bg-white">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <h2 className="text-lg font-semibold">History</h2>
                  <p className="text-xs text-gray-500">Your completed and archived pool results live here.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href="/archives" className="px-3 py-2 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm">
                    View archives
                  </Link>
                  <button
                    onClick={loadHistory}
                    className="px-3 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                    disabled={historyLoading}
                  >
                    {historyLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
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
                          </td>
                          <td className="p-2 border">{r.season ?? '-'}</td>
                          <td className="p-2 border">{r.status ?? '-'}</td>
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

            </section>
          </div>
        )}
      </div>
    </main>
  )
}
