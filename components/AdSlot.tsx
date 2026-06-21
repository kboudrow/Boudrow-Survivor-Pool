'use client'

import { useEffect } from 'react'

type AdSlotProps = {
  slot?: string
  label?: string
  format?: 'auto' | 'fluid'
  layout?: 'in-article'
  className?: string
  minHeight?: string
}

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

const cleanAdValue = (value?: string) => (value || '').replace(/\uFEFF/g, '').trim()
const adsenseClient = cleanAdValue(process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT || process.env.NEXT_PUBLIC_ADSENSE_CLIENT || 'ca-pub-7635962482487315')
const showPreview = process.env.NODE_ENV !== 'production'

export function AdSlot({ slot, label = 'Advertisement', format = 'auto', layout, className = '', minHeight = '90px' }: AdSlotProps) {
  const allowAds = process.env.NEXT_PUBLIC_ENABLE_ADSENSE === 'true'
  const cleanSlot = cleanAdValue(slot)
  const enabled = Boolean(allowAds && adsenseClient && cleanSlot)
  const adAttributes = layout
    ? { 'data-ad-layout': layout }
    : {}

  useEffect(() => {
    if (!enabled) return
    try {
      window.adsbygoogle = window.adsbygoogle || []
      window.adsbygoogle.push({})
    } catch {
      // Ad blockers and preview environments can block AdSense. The page should keep working.
    }
  }, [enabled])

  if (!allowAds) return null

  if (!enabled) {
    if (!showPreview) return null
    return (
      <aside
        className={`flex items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-100/70 px-4 py-5 text-center text-xs font-medium uppercase tracking-wide text-slate-500 ${className}`}
        style={{ minHeight }}
        aria-label={label}
      >
        {label} slot
      </aside>
    )
  }

  return (
    <aside className={className} aria-label={label}>
      <div className="mb-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <ins
        className="adsbygoogle block"
        style={{ display: 'block', minHeight }}
        data-ad-client={adsenseClient}
        data-ad-slot={cleanSlot}
        data-ad-format={format}
        data-full-width-responsive="true"
        {...adAttributes}
      />
    </aside>
  )
}
