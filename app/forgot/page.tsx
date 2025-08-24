'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

export default function ResetPage() {
  const [ready, setReady] = useState(false)
  const [exchangeError, setExchangeError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // password checks (same UI you had)
  const pwChecks = useMemo(() => {
    const len = password.length >= 8
    const upper = /[A-Z]/.test(password)
    const lower = /[a-z]/.test(password)
    const num = /[0-9]/.test(password)
    const special = /[^A-Za-z0-9]/.test(password)
    const match = password && password2 && password === password2
    return { len, upper, lower, num, special, match }
  }, [password, password2])

  const allPwOk = useMemo(
    () => pwChecks.len && pwChecks.upper && pwChecks.lower && pwChecks.num && pwChecks.special && pwChecks.match,
    [pwChecks]
  )

  // accept both PKCE (?code=) and hash recovery (#access_token=...)
  useEffect(() => {
    const doExchange = async () => {
      try {
        const href = window.location.href

        // PKCE code in query
        const url = new URL(href)
        const code = url.searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(href)
          if (error) setExchangeError(error.message)
          setReady(true)
          return
        }

        // Recovery tokens in hash
        const hash = window.location.hash.replace(/^#/, '')
        const params = new URLSearchParams(hash)
        const type = params.get('type')
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')

        if (type === 'recovery' && access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (error) setExchangeError(error.message)
          setReady(true)
          return
        }

        // neither present
        setExchangeError('This page must be opened from your password reset email link.')
        setReady(true)
      } catch (e: any) {
        setExchangeError(e?.message || 'Unexpected error handling reset link.')
        setReady(true)
      }
    }

    doExchange()
  }, [])

  const setNewPassword = async () => {
    setError(null)
    setStatus(null)

    if (!allPwOk) {
      setError('Please meet all password requirements.')
      return
    }

    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)

    if (error) {
      setError(error.message)
      return
    }
    setStatus('Password updated. You can now return to the home page.')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md border border-gray-200 rounded-lg p-4">
        <h1 className="text-2xl font-bold mb-2">Reset your password</h1>

        {!ready && <p>Loading…</p>}

        {ready && exchangeError && (
          <>
            <p className="text-red-600 mb-3">{exchangeError}</p>
            <ol className="list-decimal ml-5 text-sm mb-3">
              <li>Go to <a href="/forgot" className="underline">Forgot Password</a> and request a new link.</li>
              <li>Open the email on the <b>same device & browser</b> you used to request it.</li>
              <li>Click the link — it should bring you back here with a code or tokens.</li>
            </ol>
            <a href="/" className="px-4 py-2 rounded-md bg-gray-600 text-white inline-block">Home</a>
          </>
        )}

        {ready && !exchangeError && (
          <>
            <div className="flex flex-col gap-3 mb-3">
              <label className="text-sm">
                New password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="text-sm">
                Re-enter password
                <input
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="Re-enter password"
                />
              </label>
            </div>

            <ul className="text-xs text-gray-700 mb-3 list-disc pl-5">
              <li className={pwChecks.len ? 'text-green-700' : ''}>At least 8 characters</li>
              <li className={pwChecks.upper ? 'text-green-700' : ''}>Contains an uppercase letter</li>
              <li className={pwChecks.lower ? 'text-green-700' : ''}>Contains a lowercase letter</li>
              <li className={pwChecks.num ? 'text-green-700' : ''}>Contains a number</li>
              <li className={pwChecks.special ? 'text-green-700' : ''}>Contains a special character</li>
              <li className={pwChecks.match ? 'text-green-700' : ''}>Passwords match</li>
            </ul>

            {error && <div className="text-red-600 mb-3">{error}</div>}
            {status && <div className="text-green-700 mb-3">{status}</div>}

            <div className="flex gap-2">
              <button
                onClick={setNewPassword}
                disabled={!allPwOk || saving}
                className="px-4 py-2 rounded-md bg-green-600 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Set new password'}
              </button>
              <a href="/" className="px-4 py-2 rounded-md bg-gray-600 text-white text-center">
                Home
              </a>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
