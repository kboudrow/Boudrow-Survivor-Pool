'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type SupabaseClientModule = typeof import('@/lib/supabaseClient')

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'

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

export function AuthNav() {
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<ProfileBadge | null>(null)
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

  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | null = null

    const load = async () => {
      const { supabase }: SupabaseClientModule = await import('@/lib/supabaseClient')
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!alive) return
      setEmail(user?.email ?? null)
      await loadProfile(supabase, user?.id ?? null)
      setLoaded(true)

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setEmail(session?.user?.email ?? null)
        loadProfile(supabase, session?.user?.id ?? null).catch(() => setProfile(null))
        setLoaded(true)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    }

    load()
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [])

  const signOut = async () => {
    const { supabase }: SupabaseClientModule = await import('@/lib/supabaseClient')
    await supabase.auth.signOut()
    setEmail(null)
    setProfile(null)
    try {
      window.localStorage.setItem('surviveSunday:auth-event', 'signed-out')
      window.localStorage.removeItem('surviveSunday:auth-event')
    } catch {}
    window.location.href = '/'
  }

  if (!loaded || !isAuthed) {
    return (
      <div className="flex shrink-0 items-center gap-1">
        <Link href="/demo-league" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
          Demo
        </Link>
        <Link href="/about" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
          About
        </Link>
        <Link href="/blog" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
          Blog
        </Link>
        <Link
          href="/?auth=signin"
          onClick={(event) => {
            if (typeof window !== 'undefined' && window.location.pathname === '/') {
              event.preventDefault()
              window.location.href = '/?auth=signin'
            }
          }}
          className="rounded-md bg-[#c5161d] px-3.5 py-2 text-sm font-extrabold uppercase tracking-wide text-white shadow-sm transition hover:bg-[#a91218]"
        >
          Sign In
        </Link>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Link href="/demo-league" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        Demo
      </Link>
      <Link href="/blog" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        Blog
      </Link>
      <Link href="/pools" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        My Pools
      </Link>
      <Link href="/join/search" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        Join Pool
      </Link>
      {isSuperAdmin && (
        <Link href="/admin" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
          Admin
        </Link>
      )}
      <Link href="/pools/new" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
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
        className="rounded-md border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white"
      >
        Sign out
      </button>
    </div>
  )
}
