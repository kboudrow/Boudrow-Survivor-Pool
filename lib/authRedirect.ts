export function safeReturnTo(value?: string | null, fallback = '/') {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function authCallbackUrl(returnTo?: string | null) {
  if (typeof window === 'undefined') return undefined
  const safe = safeReturnTo(returnTo, '/')
  return `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(safe)}`
}
