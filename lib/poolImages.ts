export const DEFAULT_POOL_IMAGES = [
  '/football.png',
  '/league-images/goalpost.svg',
  '/league-images/helmet.svg',
  '/league-images/whistle.svg',
  '/league-images/field.svg',
]

export function defaultPoolImage(seed: string | null | undefined) {
  const text = seed || 'survive-sunday'
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0
  return DEFAULT_POOL_IMAGES[hash % DEFAULT_POOL_IMAGES.length]
}

export function poolImageUrl(pool: { id?: string | null; name?: string | null; image_url?: string | null }) {
  const custom = pool.image_url?.trim()
  if (custom) return custom
  return defaultPoolImage(pool.id || pool.name)
}
