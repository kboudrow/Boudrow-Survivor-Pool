'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'

type SupabaseClientModule = typeof import('@/lib/supabaseClient')

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'
const AUTH_EVENT_KEY = 'surviveSunday:auth-event'

type ProfileBadge = {
  display_name: string | null
  first_name: string | null
  last_name: string | null
  username: string | null
  avatar_url: string | null
}

function getInitials(email: string | null, profile: ProfileBadge | null) {
  const first = profile?.first_name?.trim()
  const last = profile?.last_name?.trim()
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase()
  if (first) return first.slice(0, 2).toUpperCase()

  const display = profile?.display_name?.trim() || profile?.username?.trim()
  if (display) {
    const words = display.split(/\s+/).filter(Boolean)
    if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase()
    return display.slice(0, 2).toUpperCase()
  }

  if (!email) return 'SS'
  const name = email.split('@')[0] || email
  return name.slice(0, 2).toUpperCase()
}

function privatePathRequiresAuth(pathname: string) {
  return pathname.startsWith('/pools') || pathname.startsWith('/profile') || pathname.startsWith('/admin') || pathname.startsWith('/archives')
}

function signedOutRedirectHref() {
  const path = `${window.location.pathname}${window.location.search}`
  return `/?auth=signin&returnTo=${encodeURIComponent(path)}`
}

export function AuthNav() {
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileBadge | null>(null)
  const [hasBlogAccess, setHasBlogAccess] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const isAuthed = !!email
  const isSuperAdmin = email?.toLowerCase() === SUPERADMIN_EMAIL
  const initials = useMemo(() => getInitials(email, profile), [email, profile])

  const loadProfile = async (supabase: SupabaseClientModule['supabase'], userId: string | null) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('display_name, first_name, last_name, username, avatar_url')
      .eq('id', userId)
      .maybeSingle<ProfileBadge>()
    setProfile(data ?? null)
  }

  const loadBlogAccess = async (supabase: SupabaseClientModule['supabase'], userId: string | null) => {
    if (!userId) {
      setHasBlogAccess(false)
      return
    }
    const { data } = await supabase.rpc('current_blog_role')
    setHasBlogAccess(Boolean(data))
  }

  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | null = null

    const load = async () => {
      const { supabase }: SupabaseClientModule = await import('@/lib/supabaseClient')
      const handleSignedOut = () => {
        setEmail(null)
        setProfile(null)
        setHasBlogAccess(false)
        setLoaded(true)
        if (privatePathRequiresAuth(window.location.pathname)) {
          window.location.assign(signedOutRedirectHref())
        }
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (!alive) return
      if (userError) {
        handleSignedOut()
        return
      }
      setEmail(user?.email ?? null)
      setLoaded(true)
      void Promise.all([
        loadProfile(supabase, user?.id ?? null),
        loadBlogAccess(supabase, user?.id ?? null),
      ]).catch(() => {
        if (!alive) return
        setProfile(null)
        setHasBlogAccess(false)
      })

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session?.user) {
          handleSignedOut()
          return
        }
        setEmail(session?.user?.email ?? null)
        loadProfile(supabase, session?.user?.id ?? null).catch(() => setProfile(null))
        loadBlogAccess(supabase, session?.user?.id ?? null).catch(() => setHasBlogAccess(false))
        setLoaded(true)
      })
      unsubscribe = () => data.subscription.unsubscribe()

      const onStorage = (event: StorageEvent) => {
        if (event.key === AUTH_EVENT_KEY && event.newValue === 'signed-out') {
          handleSignedOut()
        }
      }
      window.addEventListener('storage', onStorage)
      unsubscribe = () => {
        data.subscription.unsubscribe()
        window.removeEventListener('storage', onStorage)
      }
    }

    load()
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  const signOut = async () => {
    const { supabase }: SupabaseClientModule = await import('@/lib/supabaseClient')
    await supabase.auth.signOut()
    setEmail(null)
    setProfile(null)
    setHasBlogAccess(false)
    try {
      window.localStorage.setItem(AUTH_EVENT_KEY, 'signed-out')
      window.localStorage.removeItem(AUTH_EVENT_KEY)
    } catch {}
    window.location.href = '/'
  }

  if (!loaded) {
    return (
      <div className="flex shrink-0 items-center gap-2" aria-label="Checking account" aria-busy="true">
        <span className="hidden h-4 w-14 animate-pulse rounded bg-white/15 sm:block" />
        <span className="h-9 w-9 animate-pulse rounded-full bg-white/15" />
      </div>
    )
  }

  if (!isAuthed) {
    return (
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <Link href="/about" className="rounded-md px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3">
          About
        </Link>
        <Link
          href="/?auth=signin"
          onClick={(event) => {
            if (typeof window !== 'undefined' && window.location.pathname === '/') {
              event.preventDefault()
              window.location.href = '/?auth=signin'
            }
          }}
          className="rounded-md bg-[#c5161d] px-3 py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-sm transition hover:bg-[#a91218] sm:px-3.5"
        >
          Sign In
        </Link>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="hidden items-center gap-0.5 lg:flex">
      <Link href="/pools" className="rounded-md px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3">
        My Pools
      </Link>
      <Link href="/join/search" className="rounded-md px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3">
        Join Pool
      </Link>
      {hasBlogAccess && (
        <Link href="/admin/blog" className="rounded-md px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3">
          Blog Admin
        </Link>
      )}
      {isSuperAdmin && (
        <Link href="/admin" className="rounded-md px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3">
          Admin
        </Link>
      )}
      <Link href="/pools/new" className="rounded-md px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3">
        Create Pool
      </Link>
      <Link
        href="/profile"
        aria-label="Profile settings"
        title="Profile settings"
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#c5161d] text-xs font-bold text-white shadow-sm ring-1 ring-white/20 transition hover:bg-[#a91218]"
      >
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
        ) : (
          initials
        )}
      </Link>
      <button
        type="button"
        onClick={signOut}
        className="rounded-md border border-white/15 px-2 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white sm:px-3"
      >
        Sign out
      </button>
      </div>

      <Link href="/pools" className="rounded-md px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 lg:hidden">
        My Pools
      </Link>
      <button
        type="button"
        aria-expanded={menuOpen}
        aria-controls="account-navigation-menu"
        aria-haspopup="dialog"
        aria-label={menuOpen ? 'Close account menu' : 'Open account menu'}
        onClick={() => setMenuOpen((open) => !open)}
        className="flex h-10 w-10 items-center justify-center rounded-md border border-white/15 text-xl text-white hover:bg-white/10 lg:hidden"
      >
        ☰
      </button>
      {menuOpen && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-[70] bg-black/35 lg:hidden"
          />
          <div
            id="account-navigation-menu"
            role="dialog"
            aria-label="Account menu"
            className="fixed inset-x-3 top-[4.75rem] z-[80] rounded-xl border border-slate-700 bg-[#111318] p-2 shadow-2xl lg:hidden"
          >
            <div className="grid grid-cols-2 gap-1">
              <MobileNavLink href="/join/search" label="Join Pool" onClick={() => setMenuOpen(false)} />
              <MobileNavLink href="/pools/new" label="Create Pool" onClick={() => setMenuOpen(false)} />
              <MobileNavLink href="/profile" label="Profile" onClick={() => setMenuOpen(false)} />
              {hasBlogAccess && <MobileNavLink href="/admin/blog" label="Blog Admin" onClick={() => setMenuOpen(false)} />}
              {isSuperAdmin && <MobileNavLink href="/admin" label="Admin" onClick={() => setMenuOpen(false)} />}
            </div>
            <button type="button" onClick={signOut} className="mt-2 w-full rounded-md border border-white/15 px-3 py-2 text-left text-sm font-semibold text-slate-200 hover:bg-white/10">Sign out</button>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}

function MobileNavLink({ href, label, onClick }: { href: string; label: string; onClick: () => void }) {
  return <Link href={href} onClick={onClick} className="rounded-md px-3 py-3 text-sm font-semibold text-slate-100 hover:bg-white/10">{label}</Link>
}
