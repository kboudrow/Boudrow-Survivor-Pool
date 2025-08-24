'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { supabase } from '../lib/supabaseClient'
import { ensureProfile } from '../lib/ensureProfile'

type Mode = 'idle' | 'signin' | 'signup'

export default function Home() {
  const [mode, setMode] = useState<Mode>('idle')
  const [isAuthed, setIsAuthed] = useState(false)
  const [status, setStatus] = useState('Not signed in')

  // shared auth state
  const [authError, setAuthError] = useState<string | null>(null)

  // sign-in fields
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // sign-up extra fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password2, setPassword2] = useState('')

  // track the last user we ran ensureProfile() for, so we don't double-run
  const ensuredUserIdRef = useRef<string | null>(null)

  // -------- Password rules (client-side checks) ----------
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

  const runEnsureProfileOnce = async (userId: string | null) => {
    if (!userId) {
      ensuredUserIdRef.current = null
      return
    }
    if (ensuredUserIdRef.current === userId) return
    ensuredUserIdRef.current = userId

    setStatus('Signed in, ensuring profile…')
    const res = await ensureProfile()
    setStatus(res.ok ? 'Profile ready' : `Profile error: ${res.error}`)
    setMode('idle')
  }

  // ---------- Auth flows ----------
  const signInWithGoogle = async () => {
    setAuthError(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if (error) setAuthError(error.message)
  }

  const signInWithEmail = async () => {
    setAuthError(null)
    if (!email || !password) return setAuthError('Please enter email and password.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return setAuthError(error.message)
    // onAuthStateChange will fire and call runEnsureProfileOnce
  }

  const signUpWithEmail = async () => {
    setAuthError(null)

    if (!firstName || !lastName) return setAuthError('Please enter your first and last name.')
    if (!email) return setAuthError('Please enter your email.')
    if (!password) return setAuthError('Please enter a password.')
    if (!password2) return setAuthError('Please re-enter your password.')
    if (!allPwOk) return setAuthError('Please meet all password requirements.')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } }
    })
    if (error) return setAuthError(error.message)

    // If email confirmation is enabled, data.session may be null here; user will sign in via the magic link.
    // If it's disabled, onAuthStateChange will fire below and ensureProfile will run once.
    if (!data?.session) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) return setAuthError(signInErr.message)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setIsAuthed(false)
    setStatus('Not signed in')
    setMode('idle')
    setEmail(''); setPassword(''); setPassword2('')
    setFirstName(''); setLastName('')
    setAuthError(null)
    ensuredUserIdRef.current = null
  }

  // Load auth state + subscribe to changes
  useEffect(() => {
    let unsub: (() => void) | null = null

    const init = async () => {
      // 1) get current user on mount
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error) {
        setIsAuthed(false)
        setStatus(`Auth error: ${error.message}`)
      } else if (user) {
        setIsAuthed(true)
        setStatus('Signed in')
        await runEnsureProfileOnce(user.id)
      } else {
        setIsAuthed(false)
        setStatus('Not signed in')
      }

      // 2) subscribe to changes; avoid calling ensureProfile more than once per user id
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        const uid = session?.user?.id ?? null
        const nowAuthed = !!uid
        setIsAuthed(nowAuthed)
        setStatus(nowAuthed ? 'Signed in' : 'Not signed in')
        // ensureProfile runs only when we see a new uid
        runEnsureProfileOnce(uid)
      })

      unsub = () => sub.subscription.unsubscribe()
    }

    init()
    return () => { if (unsub) unsub() }
  }, [])

  return (
    <div className="min-h-[calc(100vh-60px)] flex flex-col">
      {/* Page hero */}
      <main className="flex-1 flex flex-col items-center justify-start pt-10 px-6 text-center">
        <h1 className="text-5xl sm:text-6xl font-extrabold mb-6">Survivor Pool</h1>

        {/* Optional hero image under the title; header already has a small football */}
        <div className="mb-8">
          <Image src="/football.png" alt="Football" width={160} height={160} className="mx-auto" />
        </div>

        <p className="text-sm text-gray-600 mb-4">{status}</p>

        {/* If NOT signed in and no panel open, show big buttons to open panels */}
        {!isAuthed && mode === 'idle' && (
          <div className="flex gap-3 mb-10">
            <button onClick={() => setMode('signin')} className="px-4 py-2 rounded-md bg-black text-white">
              Sign in
            </button>
            <button onClick={() => setMode('signup')} className="px-4 py-2 rounded-md bg-blue-600 text-white">
              Sign up
            </button>
          </div>
        )}

        {/* If signed in, show navigation buttons */}
        {isAuthed && mode === 'idle' && (
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            <Link href="/pools/new" className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700">
              Create Pool
            </Link>
            <Link href="/pools" className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">
              My Pools
            </Link>
            <button onClick={signOut} className="px-4 py-2 rounded-md bg-gray-600 text-white">
              Sign out
            </button>
          </div>
        )}

        {/* ------------------ SIGN IN PANEL ------------------ */}
        {mode === 'signin' && (
          <div className="w-full max-w-md text-left border border-gray-200 rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-4">Sign in</h2>

            <div className="flex flex-col gap-3 mb-1">
              <label className="text-sm">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="you@example.com"
                />
              </label>
              <label className="text-sm">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="••••••••"
                />
              </label>
            </div>

            <div className="text-xs mt-1 mb-3">
              <a href="/forgot" className="underline">Forgot your password?</a>
            </div>

            {authError && <div className="text-red-600 mb-3">{authError}</div>}

            <div className="flex flex-col items-stretch gap-3">
              <button
                onClick={signInWithEmail}
                className="px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700"
              >
                Sign In
              </button>

              <div className="flex items-center my-2">
                <div className="flex-grow h-px bg-gray-300"></div>
                <span className="px-2 text-sm text-gray-500">OR</span>
                <div className="flex-grow h-px bg-gray-300"></div>
              </div>

              <button
                onClick={signInWithGoogle}
                className="px-4 py-2 rounded-md bg-[#4285F4] text-white hover:bg-blue-600"
              >
                Continue with Google
              </button>

              <button
                onClick={() => setMode('idle')}
                className="px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700"
              >
                Cancel
              </button>
            </div>

            <div className="text-xs mt-3">
              Don’t have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup') }} className="underline">Sign up</a>
            </div>
          </div>
        )}

        {/* ------------------ SIGN UP PANEL ------------------ */}
        {mode === 'signup' && (
          <div className="w-full max-w-md text-left border border-gray-200 rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-4">Create your account</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <label className="text-sm">
                First name
                <input
                  type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2" placeholder="First name"
                />
              </label>
              <label className="text-sm">
                Last name
                <input
                  type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2" placeholder="Last name"
                />
              </label>
            </div>

            <div className="flex flex-col gap-3 mb-3">
              <label className="text-sm">
                Email
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2" placeholder="you@example.com"
                />
              </label>
              <label className="text-sm">
                Password
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2" placeholder="At least 8 characters"
                />
              </label>
              <label className="text-sm">
                Re-enter password
                <input
                  type="password" value={password2} onChange={(e) => setPassword2(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2" placeholder="Re-enter password"
                />
              </label>
            </div>

            {/* Password checklist */}
            <ul className="text-xs text-gray-700 mb-3 list-disc pl-5">
              <li className={pwChecks.len ? 'text-green-700' : ''}>At least 8 characters</li>
              <li className={pwChecks.upper ? 'text-green-700' : ''}>Contains an uppercase letter</li>
              <li className={pwChecks.lower ? 'text-green-700' : ''}>Contains a lowercase letter</li>
              <li className={pwChecks.num ? 'text-green-700' : ''}>Contains a number</li>
              <li className={pwChecks.special ? 'text-green-700' : ''}>Contains a special character</li>
              <li className={pwChecks.match ? 'text-green-700' : ''}>Passwords match</li>
            </ul>

            {authError && <div className="text-red-600 mb-3">{authError}</div>}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={signUpWithEmail}
                disabled={!allPwOk || !firstName || !lastName}
                className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:opacity-50"
              >
                Create Account
              </button>
              <button onClick={signInWithGoogle} className="px-4 py-2 rounded-md bg-[#4285F4] text-white">Continue with Google</button>
              <button onClick={() => setMode('idle')} className="px-4 py-2 rounded-md bg-gray-600 text-white">Cancel</button>
            </div>

            <div className="text-xs mt-3">
              Already have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin') }} className="underline">Sign in</a>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
