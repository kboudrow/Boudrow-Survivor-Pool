'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { safeReturnTo } from '@/lib/authRedirect'
import { getErrorMessage } from '@/lib/errorMessage'
import { normalizeEmailAddress, validateEmailAddress } from '@/lib/security'
import { supabase } from '@/lib/supabaseClient'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [returnTo, setReturnTo] = useState('/pools')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setReturnTo(safeReturnTo(params.get('returnTo'), '/pools'))
  }, [])

  const sendResetEmail = async () => {
    setStatus(null)
    setError(null)

    const trimmedEmail = normalizeEmailAddress(email)
    if (!trimmedEmail) {
      setError('Enter the email address for your account.')
      return
    }
    const emailError = validateEmailAddress(trimmedEmail)
    if (emailError) {
      setError(emailError)
      return
    }

    setSending(true)
    try {
      const origin = window.location.origin
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${origin}/reset?returnTo=${encodeURIComponent(returnTo)}`,
      })
      if (resetError) throw resetError
      setStatus('If an account uses that email, a password reset link is on its way. Check your inbox and spam folder.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to send password reset email.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Account help</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Enter your account email and we will send you a link to choose a new password.
        </p>

        <label className="mt-5 block text-sm font-semibold text-slate-700">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') sendResetEmail()
            }}
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base"
            placeholder="you@example.com"
          />
        </label>

        {error && <p role="alert" aria-live="assertive" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {status && <p role="status" aria-live="polite" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{status}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={sendResetEmail}
            disabled={sending}
            className="rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218] disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send Reset Email'}
          </button>
          <Link href={`/?auth=signin&returnTo=${encodeURIComponent(returnTo)}`} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            Back to Sign In
          </Link>
        </div>
      </section>
    </main>
  )
}
