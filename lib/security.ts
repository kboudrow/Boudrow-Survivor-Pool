const COMMON_PROVIDER_DOMAINS: Record<string, string[]> = {
  gmail: ['gmail.com', 'googlemail.com'],
  yahoo: ['yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk', 'yahoo.ca', 'yahoo.com.au'],
  outlook: ['outlook.com'],
  hotmail: ['hotmail.com'],
  live: ['live.com'],
  icloud: ['icloud.com', 'me.com', 'mac.com'],
  aol: ['aol.com'],
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const MAX_PUBLIC_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024
export const ALLOWED_PUBLIC_IMAGE_MIME_TYPES = Object.keys(IMAGE_EXTENSION_BY_MIME)

type UploadFileLike = {
  type: string
  size: number
}

export function normalizeEmailAddress(value: string) {
  return value.trim().toLowerCase()
}

export function validateEmailAddress(value: string): string | null {
  const email = normalizeEmailAddress(value)
  if (!email) return 'Please enter an email address.'
  if (email.length > 254) return 'Email address is too long.'
  if (/\s/.test(email)) return 'Email cannot contain spaces.'

  const parts = email.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 'Enter a valid email address, like name@example.com.'

  const [local, rawDomain] = parts
  const domain = rawDomain.toLowerCase()
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return 'Enter a valid email address before continuing.'
  if (!/^[^\s@]+$/.test(local)) return 'Enter a valid email address before continuing.'
  if (!domain.includes('.')) return 'Email domain must include a dot, like example.com.'

  const labels = domain.split('.')
  if (labels.some((label) => !label || label.startsWith('-') || label.endsWith('-') || !/^[a-z0-9-]+$/.test(label))) {
    return 'Enter a valid email domain.'
  }

  const tld = labels.at(-1) || ''
  if (!/^[a-z]{2,24}$/.test(tld)) return 'Enter a valid email domain ending, like .com.'

  const providerRoot = labels[0]
  const allowedProviderDomains = COMMON_PROVIDER_DOMAINS[providerRoot]
  if (allowedProviderDomains && !allowedProviderDomains.includes(domain)) {
    return `Use a full ${providerRoot} email domain, like ${allowedProviderDomains[0]}.`
  }

  return null
}

export function validatePublicImageUpload(file: UploadFileLike, label = 'Image'): string | null {
  if (!ALLOWED_PUBLIC_IMAGE_MIME_TYPES.includes(file.type)) {
    return `${label} must be a PNG, JPG, WebP, or GIF file.`
  }
  if (file.size > MAX_PUBLIC_IMAGE_UPLOAD_BYTES) {
    return `${label} must be 5 MB or smaller.`
  }
  return null
}

export function publicImageExtension(file: UploadFileLike) {
  return IMAGE_EXTENSION_BY_MIME[file.type] || 'jpg'
}

export function makeStorageObjectPath(ownerId: string, file: UploadFileLike) {
  const cleanOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '')
  const randomId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return `${cleanOwner}/${randomId}.${publicImageExtension(file)}`
}

export function sanitizeLogMetadata(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[truncated]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeLogMetadata(item, depth + 1))
  if (typeof value !== 'object') return String(value).slice(0, 200)

  const clean: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value).slice(0, 30)) {
    clean[key.slice(0, 80)] = sanitizeLogMetadata(nestedValue, depth + 1)
  }
  return clean
}
