'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type SupabaseClientModule = typeof import('@/lib/supabaseClient')

function getInitials(email: string | null) {
  if (!email) return 'SP'
  const name = email.split('@')[0] || email
  return name.slice(0, 2).toUpperCase()
}

export function AuthNav() {
  const router = useRouter()
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
    router.push('/')
  }

  if (!loaded || !isAuthed) {
    return (
      <Link href="/" className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700">
        Sign in
      </Link>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Link href="/pools" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
        My Pools
      </Link>
      <Link href="/join/search" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
        Join Pool
      </Link>
      <Link href="/pools/new" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950">
        Create Pool
      </Link>
      <Link
        href="/profile"
        aria-label="Profile"
        title="Profile"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700"
      >
        {initials}
      </Link>
      <button onClick={signOut} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">
        Sign out
      </button>
    </div>
  )
}
