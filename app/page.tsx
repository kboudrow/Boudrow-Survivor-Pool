'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NextImage from 'next/image'
import { useRouter } from 'next/navigation'
import { AdSlot } from '@/components/AdSlot'
import { supabase } from '@/lib/supabaseClient'
import { ensureProfile } from '@/lib/ensureProfile'

type Mode = 'idle' | 'signin' | 'signup'

export default function Home() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('idle')
  const [isAuthed, setIsAuthed] = useState(false)
  const [, setStatus] = useState('Not signed in')
  const ensuredUserIdRef = useRef<string | null>(null)

  // auth form state
  const [authError, setAuthError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password2, setPassword2] = useState('')

  // focus/scroll refs
  const signInPanelRef = useRef<HTMLDivElement | null>(null)
  const signUpPanelRef = useRef<HTMLDivElement | null>(null)
  const signInEmailRef = useRef<HTMLInputElement | null>(null)
  const signUpFirstRef = useRef<HTMLInputElement | null>(null)

  // password checks
  const pw = {
    len: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    num: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
    match: !!password && !!password2 && password === password2,
  }
  const allPwOk = pw.len && pw.upper && pw.lower && pw.num && pw.special && pw.match

  const runEnsureProfileOnce = async (userId: string | null) => {
    if (!userId) {
      ensuredUserIdRef.current = null
      return
    }
    if (ensuredUserIdRef.current === userId) return
    ensuredUserIdRef.current = userId
    setStatus('Signed in, ensuring profile...')
    const res = await ensureProfile()
    setStatus(res.ok ? 'Profile ready' : `Profile error: ${res.error}`)
    setMode('idle')
  }

  const openSignIn = () => {
    setAuthError(null)
    setMode('signin')
    requestAnimationFrame(() => {
      signInPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      signInEmailRef.current?.focus()
    })
  }

  const openSignUp = () => {
    setAuthError(null)
    setMode('signup')
    requestAnimationFrame(() => {
      signUpPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      signUpFirstRef.current?.focus()
    })
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('auth') === 'signin') {
      openSignIn()
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  // Gate helper: keep hero CTAs visible, but require auth on click
  const requireAuthThen = (nextPath: string) => {
    if (isAuthed) {
      router.push(nextPath)
      return
    }
    setAuthError(null)
    openSignIn()
  }

  // auth handlers
  const signInWithGoogle = async () => {
    setAuthError(null)
    const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (error) setAuthError(error.message)
  }

  const signInWithEmail = async () => {
    setAuthError(null)
    if (!email || !password) return setAuthError('Please enter email and password.')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return setAuthError(error.message)
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
      options: { data: { first_name: firstName, last_name: lastName } },
    })
    if (error) return setAuthError(error.message)

    // If no session returned (email confirm disabled / etc.), sign in immediately
    if (!data?.session) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) return setAuthError(signInErr.message)
    }
  }

  useEffect(() => {
    let unsub: null | (() => void) = null
    const init = async () => {
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

      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        const uid = s?.user?.id ?? null
        const nowAuthed = !!uid
        setIsAuthed(nowAuthed)
        setStatus(nowAuthed ? 'Signed in' : 'Not signed in')
        runEnsureProfileOnce(uid)

        // If they were trying to do something (CTAs), collapse auth panel on success
        if (nowAuthed) setMode('idle')
      })
      unsub = () => sub.subscription.unsubscribe()
    }
    init()
    return () => { if (unsub) unsub() }
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <section className="relative overflow-hidden border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eff6ff_45%,#fff7ed_100%)] px-6 pb-14 pt-14 text-center">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6 flex justify-center">
              <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-orange-200">
                <NextImage src="/football.png" alt="Football" width={64} height={64} priority />
              </div>
            </div>

            <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-slate-950">
              Survive Sunday with your pool intact.
            </h1>

            <p className="mt-4 text-slate-600 max-w-2xl mx-auto">
              Create NFL survivor pools, invite your people, and let Survive Sunday handle picks, locks, standings, and eliminations.
            </p>

            {/* HERO CTA: Create/Join + (only when authed) My Pools */}
            <div className="mt-7 flex flex-wrap gap-3 justify-center">
              <button
                type="button"
                onClick={() => requireAuthThen('/pools/new')}
                className="rounded-md bg-blue-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Create a Pool
              </button>

              <button
                type="button"
                onClick={() => requireAuthThen('/join/search')}
                className="rounded-md border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                Join a Pool
              </button>

              {isAuthed && (
                <Link href="/pools" className="rounded-md bg-orange-500 px-5 py-3 font-semibold text-white shadow-sm hover:bg-orange-600">
                  My Pools
                </Link>
              )}
            </div>

            {!isAuthed && (
              <p className="mt-3 text-sm text-gray-500">
                You&apos;ll need to{' '}
                <button type="button" onClick={openSignIn} className="underline text-gray-700 hover:text-black">
                  sign in
                </button>{' '}
                (or{' '}
                <button type="button" onClick={openSignUp} className="underline text-gray-700 hover:text-black">
                  create an account
                </button>
                ) to create or join a pool.
              </p>
            )}
          </div>
        </section>

        {/* FEATURES */}
        <section className="px-6 py-10 bg-white">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Feature title="Automatic locks" desc="Rolling kickoff locks or a fixed weekly deadline - your choice." />
            <Feature title="Public or private pools" desc="Run open pools, or protect access with a password." />
            <Feature title="No repeat teams" desc="Once you pick a team, it's gone. Enforced automatically." />
            <Feature title="Strikes & elimination" desc="Set how many misses are allowed before you're out." />
            <Feature title="Standings that make sense" desc="Alive vs eliminated, weekly results, and current status in one view." />
            <Feature title="Run it back next season" desc="Archive finished pools and restart with the same settings - empty roster." />
          </div>
        </section>

        <section className="bg-white px-6 pb-10">
          <div className="mx-auto max-w-5xl">
            <AdSlot
              slot={process.env.NEXT_PUBLIC_AD_SLOT_SITE_INLINE}
              label="Homepage advertisement"
              minHeight="100px"
            />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="px-6 py-12 bg-slate-50">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-3 gap-6 text-center">
            <How step="1" title="Create or Join" text="Start a pool or find one by name." />
            <How step="2" title="Pick weekly" text="Choose one team. No repeats. (Double-pick weeks optional.)" />
            <How step="3" title="Survive" text="Lose and take a strike. Run out and you're eliminated." />
          </div>
        </section>

        {/* Auth panels */}
        {mode !== 'idle' && (
          <section className="px-6 pb-14">
            <div className="mx-auto w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              {mode === 'signin' ? (
                <div ref={signInPanelRef}>
                  <h2 className="text-xl font-semibold mb-3">Sign in</h2>

                  <label className="text-sm block mb-2">
                    Email
                    <input
                      ref={signInEmailRef}
                      className="mt-1 w-full border rounded px-3 py-2"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') signInWithEmail() }}
                    />
                  </label>

                  <label className="text-sm block mb-2">
                    Password
                    <input
                      className="mt-1 w-full border rounded px-3 py-2"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') signInWithEmail() }}
                    />
                  </label>

                  <div className="flex items-center justify-between mb-2">
                    <Link href="/forgot" className="text-sm underline text-gray-700">
                      Forgot password?
                    </Link>
                    <button
                      type="button"
                      onClick={() => { setMode('signup'); setAuthError(null) }}
                      className="text-sm underline text-gray-700"
                    >
                      Need an account?
                    </button>
                  </div>

                  {authError && <p className="text-red-600 mb-2">{authError}</p>}

                  <div className="flex gap-2">
                    <button type="button" onClick={signInWithEmail} className="px-4 py-2 rounded bg-black text-white">
                      Sign In
                    </button>
                    <button type="button" onClick={signInWithGoogle} className="px-4 py-2 rounded bg-[#4285F4] text-white">
                      Google
                    </button>
                    <button type="button" onClick={() => setMode('idle')} className="px-4 py-2 rounded bg-gray-200">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div ref={signUpPanelRef}>
                  <h2 className="text-xl font-semibold mb-3">Create your account</h2>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-sm">
                      First name
                      <input
                        ref={signUpFirstRef}
                        className="mt-1 w-full border rounded px-3 py-2"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      Last name
                      <input
                        className="mt-1 w-full border rounded px-3 py-2"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </label>
                  </div>

                  <label className="text-sm block mt-2">
                    Email
                    <input
                      className="mt-1 w-full border rounded px-3 py-2"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>

                  <label className="text-sm block mt-2">
                    Password
                    <input
                      className="mt-1 w-full border rounded px-3 py-2"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>

                  <label className="text-sm block mt-2">
                    Re-enter password
                    <input
                      className="mt-1 w-full border rounded px-3 py-2"
                      type="password"
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                    />
                  </label>

                  <ul className="text-xs text-gray-600 mt-2 list-disc pl-5">
                    <li className={pw.len ? 'text-green-700' : ''}>At least 8 chars</li>
                    <li className={pw.upper ? 'text-green-700' : ''}>Uppercase</li>
                    <li className={pw.lower ? 'text-green-700' : ''}>Lowercase</li>
                    <li className={pw.num ? 'text-green-700' : ''}>Number</li>
                    <li className={pw.special ? 'text-green-700' : ''}>Special</li>
                    <li className={pw.match ? 'text-green-700' : ''}>Match</li>
                  </ul>

                  {authError && <p className="text-red-600 mt-2">{authError}</p>}

                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={!allPwOk}
                      onClick={signUpWithEmail}
                      className="px-4 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
                    >
                      Create Account
                    </button>
                    <button type="button" onClick={() => setMode('idle')} className="px-4 py-2 rounded bg-gray-200">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* FOOTER */}
      <footer className="mt-auto border-t px-6 py-8 text-sm text-gray-600 bg-white">
        <div className="mx-auto max-w-5xl grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="font-semibold mb-2">Survive Sunday</div>
            <p>Pool management for friends, families, and offices. Not betting - just rules, picks, and bragging rights.</p>
          </div>
          <div>
            <div className="font-semibold mb-2">Product</div>
            <ul className="space-y-1">
              <li><Link href="/how-it-works" className="underline">How it works</Link></li>
              <li><Link href="/faq" className="underline">FAQ</Link></li>
              <li><Link href="/blog" className="underline">Blog</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Legal</div>
            <ul className="space-y-1">
              <li><Link href="/terms" className="underline">Terms</Link></li>
              <li><Link href="/privacy" className="underline">Privacy</Link></li>
              <li><Link href="/cookies" className="underline">Cookies</Link></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold mb-2">Disclaimer</div>
            <p className="text-xs">
              Not affiliated with or endorsed by the NFL or its clubs. Team names/logos are used for identification only.
            </p>
          </div>
        </div>
        <div className="mt-6 text-xs text-gray-500">&copy; {new Date().getFullYear()} Survive Sunday. All rights reserved.</div>
      </footer>
    </div>
  )
}

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border rounded-lg p-4 bg-white">
      <div className="font-semibold">{title}</div>
      <div className="text-sm text-gray-600">{desc}</div>
    </div>
  )
}

function How({ step, title, text }: { step: string; title: string; text: string }) {
  return (
    <div className="border rounded-lg p-5">
      <div className="text-xs uppercase text-gray-500">Step {step}</div>
      <div className="text-lg font-semibold">{title}</div>
      <p className="text-sm text-gray-600 mt-1">{text}</p>
    </div>
  )
}
