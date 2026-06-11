import type { MetadataRoute } from 'next'
import { blogPosts } from '@/lib/blogPosts'

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://survivorpool.app').replace(/\/$/, '')

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/how-it-works', '/faq', '/blog', '/privacy', '/terms', '/cookies'].map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: new Date('2026-06-11'),
  }))

  const blogRoutes = blogPosts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt),
  }))

  return [...staticRoutes, ...blogRoutes]
}
