import type { MetadataRoute } from 'next'
import { getPublicBlogPosts } from '@/lib/blogDb'

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.survivesunday.com').replace(/\/$/, '')

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ['', '/about', '/how-it-works', '/faq', '/survivor-pool-rules', '/survivor-pool-constitution', '/blog', '/contact', '/privacy', '/terms', '/cookies'].map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: new Date('2026-06-11'),
  }))

  const posts = await getPublicBlogPosts()
  const blogRoutes = posts.map((post) => ({
    url: `${siteUrl}/blog/${post.slug}`,
    lastModified: new Date(post.updatedAt),
  }))

  return [...staticRoutes, ...blogRoutes]
}
