import type { Breadcrumb, ErrorEvent } from '@sentry/nextjs'

const sensitiveHeaderNames = new Set(['authorization', 'cookie', 'set-cookie', 'x-supabase-api-key'])

function stripQueryString(value: string | undefined) {
  if (!value) return value
  const queryIndex = value.indexOf('?')
  return queryIndex === -1 ? value : value.slice(0, queryIndex)
}

export function sanitizeSentryEvent(event: ErrorEvent) {
  event.user = undefined

  if (event.request) {
    event.request.url = stripQueryString(event.request.url)
    event.request.query_string = undefined
    event.request.cookies = undefined
    event.request.data = undefined

    if (event.request.headers) {
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([name]) => !sensitiveHeaderNames.has(name.toLowerCase())),
      )
    }
  }

  return event
}

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb) {
  if (breadcrumb.data?.url && typeof breadcrumb.data.url === 'string') {
    breadcrumb.data.url = stripQueryString(breadcrumb.data.url)
  }

  if (breadcrumb.category === 'ui.input') return null
  return breadcrumb
}
