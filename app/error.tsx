'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { logAppEvent } from '@/lib/monitoring'
import { captureClientException } from '@/lib/sentryClient'

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    void captureClientException(error)
    void logAppEvent({ eventType: 'route_render_failed', error, metadata: { digest: error.digest || null } })
  }, [error])

  return (
    <main className="min-h-[60vh] px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-wide text-[#c5161d]">Something went wrong</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-950">This page didn&apos;t load correctly.</h1>
        <p className="mt-3 text-slate-600">Try loading the page again. If you were submitting a pick, confirm the saved team appears before trying again.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">Try again</button>
          <Link href="/" className="rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">Go home</Link>
        </div>
      </div>
    </main>
  )
}
