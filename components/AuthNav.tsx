'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type SupabaseClientModule = typeof import('@/lib/supabaseClient')

function getInitials(email: string | null) {
  if (!email) return 'SP'
  const name = email.split('@')[0] || email
  return name.slice(0, 2).toUpperCase()
}

export function AuthNav() {
  const [loaded, setLoaded] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const isAuthed = !!email
  const initials = useMemo(() => getInitials(email), [email])

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
      setLoaded(true)

      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        setEmail(session?.user?.email ?? null)
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
    window.location.href = '/'
  }

  if (!loaded || !isAuthed) {
    return (
      <div className="flex shrink-0 items-center gap-1">
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
      <Link href="/blog" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        Blog
      </Link>
      <Link href="/pools" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        My Pools
      </Link>
      <Link href="/join/search" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        Join Pool
      </Link>
      <Link href="/pools/new" className="rounded-md px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 hover:text-white">
        Create Pool
      </Link>
      <Link
        href="/profile"
        aria-label="Profile"
        title="Profile"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c5161d] text-xs font-bold text-white shadow-sm transition hover:bg-[#a91218]"
      >
        {initials}
      </Link>
      <button onClick={signOut} className="rounded-md px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
        Sign out
      </button>
    </div>
  )
}
