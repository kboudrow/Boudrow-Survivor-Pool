export function formatLockCountdown(ms: number): string {
  if (ms <= 0) return 'Locked'
  if (ms < 60_000) return 'Less than 1 minute'

  const totalMinutes = Math.ceil(ms / 60_000)

  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []

  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  if (hours > 0 || days > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)

  return parts.join(' · ')
}
