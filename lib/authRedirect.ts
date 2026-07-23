export function safeReturnTo(value?: string | null, fallback = '/') {
  if (!value) return fallback

  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 500) return fallback
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  if (/[\u0000-\u001F\u007F\\]/.test(trimmed)) return fallback

  try {
    const decoded = decodeURIComponent(trimmed)
    if (decoded.startsWith('//') || /[\u0000-\u001F\u007F\\]/.test(decoded)) return fallback
  } catch {
    return fallback
  }

  return trimmed
}

export function authCallbackUrl(returnTo?: string | null) {
  if (typeof window === 'undefined') return undefined
  const safe = safeReturnTo(returnTo, '/')
  return `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(safe)}`
}
