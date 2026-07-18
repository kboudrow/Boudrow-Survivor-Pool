'use client'

import { Suspense } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getErrorMessage } from '@/lib/errorMessage'
import { ensureProfile } from '@/lib/ensureProfile'
import { safeReturnTo } from '@/lib/authRedirect'
import { logAppEvent } from '@/lib/monitoring'
import { supabase } from '@/lib/supabaseClient'

function AuthCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    const finishSignIn = async () => {
      const returnTo = safeReturnTo(searchParams.get('returnTo'))
      try {
        const code = searchParams.get('code')
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        }

        const { data, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError
        if (!data.user) throw new Error('Sign-in did not complete. Please try again.')

        await ensureProfile()
        if (alive) router.replace(returnTo)
      } catch (e: unknown) {
        void logAppEvent({ eventType: 'auth_callback_failed', error: e, metadata: { return_to: returnTo } })
        if (alive) setError(getErrorMessage(e, 'Sign-in failed.'))
      }
    }

    finishSignIn()
    return () => {
      alive = false
    }
  }, [router, searchParams])

  return (
    <main className="min-h-[60vh] px-4 py-12">
      <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-950">Finishing sign in</h1>
        {error ? (
          <>
            <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
            <Link href="/?auth=signin" className="mt-4 inline-flex rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
              Try again
            </Link>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-600">One second while we bring you back to Survive Sunday.</p>
        )}
      </div>
    </main>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[60vh] px-4 py-12">
          <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h1 className="text-xl font-bold text-slate-950">Finishing sign in</h1>
            <p className="mt-2 text-sm text-slate-600">One second while we bring you back to Survive Sunday.</p>
          </div>
        </main>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  )
}
