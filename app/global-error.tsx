'use client'

import { useEffect } from 'react'
import { captureClientException } from '@/lib/sentryClient'

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    void captureClientException(error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <main className="min-h-screen bg-slate-50 px-4 py-16 text-slate-950">
          <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
            <p className="text-sm font-bold uppercase tracking-wide text-[#c5161d]">Something went wrong</p>
            <h1 className="mt-2 text-3xl font-extrabold">Survive Sunday couldn&apos;t load.</h1>
            <p className="mt-3 text-slate-600">Refresh the page. If you were making a pick, confirm it appears before submitting again.</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-6 rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white">
              Refresh page
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
