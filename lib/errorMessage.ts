const FRIENDLY_ERROR_MAP: Array<[RegExp, string]> = [
  [/auth session missing/i, 'Please sign in again to continue.'],
  [/jwt|token|session.*expired|invalid.*session/i, 'Your session expired. Please sign in again.'],
  [/duplicate key|23505|unique constraint/i, 'That value is already being used. Try something different.'],
  [/row-level security|violates row-level security|permission denied|not authorized|not allowed/i, 'You do not have permission to do that.'],
  [/network|failed to fetch/i, 'Connection trouble. Please check your connection and try again.'],
]

export function getErrorMessage(error: unknown, fallback: string) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : error &&
          typeof error === 'object' &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : ''

  if (!rawMessage) return fallback

  const friendly = FRIENDLY_ERROR_MAP.find(([pattern]) => pattern.test(rawMessage))
  if (friendly) return friendly[1]

  if (/^[A-Z0-9_]+$/.test(rawMessage) || rawMessage.length > 180) return fallback

  return rawMessage
}
