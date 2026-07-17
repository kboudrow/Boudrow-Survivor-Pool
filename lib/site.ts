import { cleanEnvValue } from '@/lib/env'

export const SITE_URL = (cleanEnvValue(process.env.NEXT_PUBLIC_SITE_URL) || 'https://www.survivesunday.com').replace(/\/$/, '')

export function absoluteUrl(path = '/') {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${SITE_URL}${cleanPath}`
}
