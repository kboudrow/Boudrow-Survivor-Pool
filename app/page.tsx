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
        <section className="relative overflow-hidden border-b border-red-950 bg-[#090b0f] px-6 pb-14 pt-12 text-center text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#4b0d12_0%,#12151c_42%,#090b0f_78%)] opacity-95" />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,rgba(9,11,15,0),rgba(9,11,15,1))]" />
          <div className="relative mx-auto max-w-5xl">
            <div className="mb-5 flex justify-center sm:mb-6">
              <div className="w-[min(230px,74vw)] sm:w-[min(300px,70vw)]">
                <NextImage src="/survive-sunday-logo.png" alt="Survive Sunday" width={320} height={320} priority className="h-auto w-full object-contain drop-shadow-2xl" />
              </div>
            </div>

            <h1 className="mx-auto max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
              Run the pool. Keep the fun. Skip the spreadsheet.
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
              Survive Sunday gives commissioners a clean place to set the rules, collect picks, lock games on time, and show everyone where they stand.
            </p>

            {/* HERO CTA: Create/Join + (only when authed) My Pools */}
            <div className="mt-7 flex flex-wrap gap-3 justify-center">
              <button
                type="button"
                onClick={() => requireAuthThen('/pools/new')}
                className="rounded-md bg-[#c5161d] px-5 py-3 font-semibold text-white shadow-sm ring-1 ring-red-300/20 transition hover:bg-[#a91218]"
              >
                Create a Pool
              </button>

              <button
                type="button"
                onClick={() => requireAuthThen('/join/search')}
                className="rounded-md border border-[#d2ad5b]/70 bg-white/10 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-white/15"
              >
                Join a Pool
              </button>

              {isAuthed && (
                <Link href="/pools" className="rounded-md bg-[#d2ad5b] px-5 py-3 font-semibold text-[#090b0f] shadow-sm transition hover:bg-[#e4c575]">
                  My Pools
                </Link>
              )}
            </div>

            {!isAuthed && (
              <p className="mt-3 text-sm text-slate-300">
                You&apos;ll need to{' '}
                <button type="button" onClick={openSignIn} className="underline text-white hover:text-[#d2ad5b]">
                  sign in
                </button>{' '}
                (or{' '}
                <button type="button" onClick={openSignUp} className="underline text-white hover:text-[#d2ad5b]">
                  create an account
                </button>
                ) to create or join a pool.
              </p>
            )}
          </div>
        </section>

        {/* FEATURES */}
        <section className="bg-white px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Feature title="Picks stay organized" desc="Players make picks in one place. No text chains, lost screenshots, or last-minute confusion." />
            <Feature title="Deadlines are handled" desc="Use a Sunday 1 PM deadline, wait until Monday night, or let each game lock at kickoff." />
            <Feature title="Rules are enforced" desc="No repeat teams, custom start weeks, double-pick weeks, strikes, and eliminations are tracked for you." />
            <Feature title="Public or private" desc="Open a pool for discovery, or keep it private with a password and invite link." />
            <Feature title="Standings are clear" desc="Everyone can see who is alive, who is out, and which picks are official." />
            <Feature title="Built for commissioners" desc="Admin tools help you manage members, review picks, finalize locks, and run it back next season." />
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
        <section className="bg-slate-50 px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-3 gap-6 text-center">
            <How step="1" title="Set the rules" text="Choose your start week, deadline, strikes, privacy, and any double-pick weeks." />
            <How step="2" title="Invite your group" text="Share the pool link, let players join, and keep the roster in one place." />
            <How step="3" title="Pick and survive" text="Players choose teams each week. Survive Sunday keeps the board honest." />
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
            <p>Pool management for friends, families, and offices. No payouts, no sportsbook angle, just rules, picks, and bragging rights.</p>
          </div>
          <div>
            <div className="font-semibold mb-2">Product</div>
            <ul className="space-y-1">
              <li><Link href="/how-it-works" className="underline">How it works</Link></li>
              <li><Link href="/faq" className="underline">FAQ</Link></li>
              <li><Link href="/blog" className="underline">Blog</Link></li>
              <li><Link href="/contact" className="underline">Contact</Link></li>
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
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="font-semibold text-[#111318]">{title}</div>
      <div className="text-sm text-gray-600">{desc}</div>
    </div>
  )
}

function How({ step, title, text }: { step: string; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-bold uppercase text-[#c5161d]">Step {step}</div>
      <div className="text-lg font-semibold">{title}</div>
      <p className="text-sm text-gray-600 mt-1">{text}</p>
    </div>
  )
}
