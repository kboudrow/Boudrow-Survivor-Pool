'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { ensureProfile } from '@/lib/ensureProfile'

export default function CheckPage() {
  const [status, setStatus] = useState<string>('Not signed in')
  const [error, setError] = useState<string | null>(null)

  // avoid double-running ensureProfile for the same user id
  const ensuredUserIdRef = useRef<string | null>(null)

  const runEnsureProfileOnce = async (uid: string | null) => {
    if (!uid) {
      ensuredUserIdRef.current = null
      return
    }
    if (ensuredUserIdRef.current === uid) return
    ensuredUserIdRef.current = uid

    setStatus('Signed in, ensuring profile…')
    const res = await ensureProfile()
    setStatus(res.ok ? 'Profile ready' : `Profile error: ${res.error}`)
  }

  const signInWithGoogle = async () => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
    if (error) setError(error.message)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setStatus('Not signed in')
    setError(null)
    ensuredUserIdRef.current = null
  }

  useEffect(() => {
    const init = async () => {
      const { data: { user }, error } = await supabase.auth.getUser()
      if (error) {
        setStatus('Not signed in')
        setError(error.message)
        return
      }
      if (!user) {
        setStatus('Not signed in')
        return
      }
      setStatus('Signed in')
      runEnsureProfileOnce(user.id)
    }

    init()
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const uid = session?.user?.id ?? null
      setStatus(uid ? 'Signed in' : 'Not signed in')
      runEnsureProfileOnce(uid)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [])

  return (
    <main style={{ padding: 20 }}>
      <h1>Survivor Pool</h1>
      <p style={{ margin: '12px 0' }}>{status}</p>
      {error && <p style={{ color: 'red', margin: '12px 0' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={signInWithGoogle}
          style={{ padding: '10px 20px', background: '#4285F4', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          Sign in with Google
        </button>
        <button
          onClick={signOut}
          style={{ padding: '10px 20px', background: '#555', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          Sign out
        </button>
      </div>
    </main>
  )
}
