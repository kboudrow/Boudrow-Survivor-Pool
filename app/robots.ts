import type { MetadataRoute } from 'next'

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.survivesunday.com').replace(/\/$/, '')

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/archives', '/check', '/forgot', '/join/', '/pools/', '/profile', '/reset'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
