'use client'

import { useMemo, useState } from 'react'

type InviteModalProps = {
  open: boolean
  poolId: string
  poolName: string
  isPrivate?: boolean
  onClose: () => void
}

export function InviteModal({ open, poolId, poolName, isPrivate = false, onClose }: InviteModalProps) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return `/join/${poolId}`
    return `${window.location.origin}/join/${poolId}`
  }, [poolId])

  if (!open) return null

  const subject = encodeURIComponent(`Join my survivor pool: ${poolName}`)
  const message = encodeURIComponent(`Join ${poolName} here: ${inviteUrl}`)

  const markCopied = () => {
    setCopied(true)
    setFeedback('Invite link copied.')
    window.setTimeout(() => setCopied(false), 2200)
  }

  const copyLink = async () => {
    setFeedback(null)
    try {
      await navigator.clipboard.writeText(inviteUrl)
      markCopied()
    } catch {
      setFeedback('Could not copy automatically. You can copy the link shown above.')
    }
  }

  const shareNative = async () => {
    setFeedback(null)
    if (!navigator.share) {
      await copyLink()
      return
    }
    try {
      await navigator.share({
        title: poolName,
        text: `Join my survivor pool: ${poolName}`,
        url: inviteUrl,
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setFeedback('Sharing was blocked. You can copy the link shown above.')
    }
  }

  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Invite players</h2>
            <p className="mt-1 text-sm text-slate-600">{poolName}</p>
          </div>
          <button onClick={onClose} className="rounded-md bg-slate-100 px-3 py-1.5 text-sm hover:bg-slate-200">
            Close
          </button>
        </div>

        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="break-all text-sm font-medium text-slate-800">{inviteUrl}</div>
          {isPrivate && (
            <p className="mt-2 text-xs text-amber-700">
              This pool is private. Send the pool password separately to people you want to join.
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button onClick={copyLink} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button onClick={shareNative} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">
            Share
          </button>
          <a href={`mailto:?subject=${subject}&body=${message}`} className="rounded-md bg-slate-100 px-4 py-2 text-center text-sm font-medium text-slate-800 hover:bg-slate-200">
            Email
          </a>
          <a href={`sms:?&body=${message}`} className="rounded-md bg-slate-100 px-4 py-2 text-center text-sm font-medium text-slate-800 hover:bg-slate-200">
            Text
          </a>
        </div>
        {feedback && <p className="mt-3 text-sm text-slate-600">{feedback}</p>}
      </div>
    </div>
  )
}
