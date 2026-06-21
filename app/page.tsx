'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import NextImage from 'next/image'
import { useRouter } from 'next/navigation'

type Mode = 'idle' | 'signin' | 'signup'
type SupabaseClientModule = typeof import('@/lib/supabaseClient')
type EnsureProfileModule = typeof import('@/lib/ensureProfile')

async function getSupabase() {
  const { supabase }: SupabaseClientModule = await import('@/lib/supabaseClient')
  return supabase
}

export default function Home() {
  const router = useRouter()

  const [mode, setMode] = useState<Mode>('idle')
  const [isAuthed, setIsAuthed] = useState(false)
  const [, setStatus] = useState('Not signed in')
  const [returnTo, setReturnTo] = useState<string | null>(null)
  const ensuredUserIdRef = useRef<string | null>(null)
  const returnToRef = useRef<string | null>(null)

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

  const safeReturnTo = (value: string | null) => {
    if (!value || !value.startsWith('/') || value.startsWith('//')) return null
    return value
  }

  const runEnsureProfileOnce = async (userId: string | null) => {
    if (!userId) {
      ensuredUserIdRef.current = null
      return
    }
    if (ensuredUserIdRef.current === userId) return
    ensuredUserIdRef.current = userId
    setStatus('Signed in, ensuring profile...')
    const { ensureProfile }: EnsureProfileModule = await import('@/lib/ensureProfile')
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
    const nextReturnTo = safeReturnTo(params.get('returnTo'))
    setReturnTo(nextReturnTo)
    returnToRef.current = nextReturnTo
    if (params.get('auth') === 'signin') {
      openSignIn()
      window.history.replaceState(null, '', window.location.pathname)
    } else if (params.get('auth') === 'signup') {
      openSignUp()
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
    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${returnToRef.current || returnTo || ''}` : undefined
    const supabase = await getSupabase()
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
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return setAuthError(error.message)
    if (data.user) {
      await runEnsureProfileOnce(data.user.id)
      router.push(returnToRef.current || '/pools')
    }
  }

  const signUpWithEmail = async () => {
    setAuthError(null)
    if (!firstName || !lastName) return setAuthError('Please enter your first and last name.')
    if (!email) return setAuthError('Please enter your email.')
    if (!password) return setAuthError('Please enter a password.')
    if (!password2) return setAuthError('Please re-enter your password.')
    if (!allPwOk) return setAuthError('Please meet all password requirements.')

    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } },
    })
    if (error) return setAuthError(error.message)

    // If no session returned (email confirm disabled / etc.), sign in immediately
    if (!data?.session) {
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) return setAuthError(signInErr.message)
      if (signInData.user) {
        await runEnsureProfileOnce(signInData.user.id)
        router.push(returnToRef.current || '/pools')
      }
    } else {
      await runEnsureProfileOnce(data.session.user.id)
      router.push(returnToRef.current || '/pools')
    }
  }

  useEffect(() => {
    let unsub: null | (() => void) = null
    const init = async () => {
      const supabase = await getSupabase()
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error) {
        setIsAuthed(false)
        setStatus(`Auth error: ${error.message}`)
      } else if (user) {
        setIsAuthed(true)
        setStatus('Signed in')
        await runEnsureProfileOnce(user.id)
        if (returnToRef.current) router.push(returnToRef.current)
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
        if (nowAuthed) {
          setMode('idle')
          if (returnToRef.current) router.push(returnToRef.current)
        }
      })
      unsub = () => sub.subscription.unsubscribe()
    }
    init()
    return () => { if (unsub) unsub() }
  }, [router])

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
              Run the pool. Keep the fun.
            </h1>

            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
              Everything you need to run an NFL survivor pool without chasing group texts, fixing spreadsheets, or arguing about late picks.
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
                <button type="button" onClick={openSignIn} className="underline text-white hover:text-[#d2ad5b]">
                  Sign in
                </button>{' '}
                or{' '}
                <button type="button" onClick={openSignUp} className="underline text-white hover:text-[#d2ad5b]">
                  create a profile
                </button>{' '}
                to create or join a pool.
              </p>
            )}
          </div>
        </section>

        {/* FEATURES */}
        <section className="bg-white px-4 py-10 sm:px-6">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Feature title="Automatic locks" desc="Rolling kickoff locks or a fixed weekly deadline, your choice." />
            <Feature title="Public or private pools" desc="Run public pools or keep things private with password protection." />
            <Feature title="No repeat teams" desc="Once you pick a team, it is gone. Enforced automatically." />
            <Feature title="Strikes and elimination" desc="One strike or multiple lives. Your rules." />
            <Feature title="Standings that make sense" desc="See who is alive, who is out, and who is about to get eliminated." />
            <Feature title="Run it back" desc="Archive finished pools and restart with the same settings, empty roster." />
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="bg-slate-50 px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-5xl grid sm:grid-cols-3 gap-6 text-center">
            <How step="1" title="Create or join" text="Start a pool for your group, or join one with an invite link." />
            <How step="2" title="Pick weekly" text="Choose one team each week. Used teams are tracked automatically." />
            <How step="3" title="Survive" text="Stay alive longer than everyone else." />
          </div>
        </section>

        <section className="bg-white px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-5xl rounded-xl border border-slate-200 bg-slate-50 p-6 shadow-sm">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">For commissioners</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-950">Why commissioners use Survive Sunday</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  The best survivor pool is the one everyone trusts. Survive Sunday keeps the boring admin work out of the way so the league can stay fun.
                </p>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {[
                  'No spreadsheets',
                  'No text chains',
                  'Automatic lock enforcement',
                  'Automatic standings',
                  'Season history',
                  'Run it back every year',
                ].map((item) => (
                  <li key={item} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-white px-4 pb-12 sm:px-6">
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            <PublicLink
              title="Try the public demo"
              text="See a sample league with picks, standings, distribution, and commissioner-style context."
              href="/demo-league"
            />
            <PublicLink
              title="Read commissioner guides"
              text="Rules, deadlines, double-pick weeks, private pools, and strategy notes for running a cleaner league."
              href="/blog"
            />
            <PublicLink
              title="Why we built it"
              text="Learn what Survive Sunday handles, what it does not do, and how support works."
              href="/about"
            />
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
                    <li className={pw.len ? 'text-green-700' : ''}>At least 8 characters</li>
                    <li className={pw.upper ? 'text-green-700' : ''}>One uppercase letter</li>
                    <li className={pw.lower ? 'text-green-700' : ''}>One lowercase letter</li>
                    <li className={pw.num ? 'text-green-700' : ''}>One number</li>
                    <li className={pw.special ? 'text-green-700' : ''}>One special character</li>
                    <li className={pw.match ? 'text-green-700' : ''}>Passwords match</li>
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
              <li><Link href="/demo-league" className="underline">Demo league</Link></li>
              <li><Link href="/about" className="underline">About</Link></li>
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

function PublicLink({ title, text, href }: { title: string; text: string; href: string }) {
  return (
    <Link href={href} className="rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm transition hover:border-[#c5161d]/40 hover:bg-white">
      <div className="font-semibold text-slate-950">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
      <span className="mt-4 inline-flex text-sm font-semibold text-[#c5161d]">Learn more</span>
    </Link>
  )
}
