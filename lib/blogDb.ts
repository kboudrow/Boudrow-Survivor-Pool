import { createClient } from '@supabase/supabase-js'
import { cleanEnvValue } from '@/lib/env'
import { blogPosts, getBlogPost, getRelatedBlogPosts, sortBlogPosts, type BlogPost } from '@/lib/blogPosts'

type BlogPostRow = {
  id: string
  slug: string
  title: string
  description: string
  category: string
  status: string
  author_id: string | null
  author_name: string | null
  read_time: string | null
  pinned: boolean | null
  hero_image_url: string | null
  sections: unknown
  published_at: string | null
  created_at: string | null
  updated_at: string | null
}

export type PublicBlogPost = BlogPost & {
  id?: string
  source?: 'database' | 'seed'
  authorName?: string
  heroImageUrl?: string | null
  status?: string
  commentCount?: number
  upCount?: number
  downCount?: number
}

const supabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL)
const supabaseAnonKey = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const publicBlogClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null

async function withTimeout<T>(promise: PromiseLike<T>, ms = 4500): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Blog database request timed out.')), ms)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function isSections(value: unknown): BlogPost['sections'] {
  if (!Array.isArray(value)) return []
  return value
    .map((section) => {
      if (!section || typeof section !== 'object') return null
      const candidate = section as { heading?: unknown; body?: unknown }
      if (typeof candidate.heading !== 'string' || !Array.isArray(candidate.body)) return null
      return {
        heading: candidate.heading,
        body: candidate.body.filter((paragraph): paragraph is string => typeof paragraph === 'string'),
      }
    })
    .filter((section): section is BlogPost['sections'][number] => Boolean(section))
}

export function rowToBlogPost(row: BlogPostRow): PublicBlogPost {
  const updatedAt = row.updated_at || row.published_at || row.created_at || new Date().toISOString()
  const publishedAt = new Date(updatedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return {
    id: row.id,
    source: 'database',
    slug: row.slug,
    title: row.title,
    description: row.description,
    category: row.category,
    publishedAt,
    updatedAt,
    readTime: row.read_time || '4 min read',
    pinned: Boolean(row.pinned),
    sections: isSections(row.sections),
    authorName: row.author_name || 'Survive Sunday',
    heroImageUrl: row.hero_image_url,
    status: row.status,
  }
}

export async function getDatabaseBlogPosts(status = 'published') {
  if (!publicBlogClient) return []

  try {
    let query = publicBlogClient
      .from('blog_posts')
      .select('id, slug, title, description, category, status, author_id, author_name, read_time, pinned, hero_image_url, sections, published_at, created_at, updated_at')
      .order('pinned', { ascending: false })
      .order('updated_at', { ascending: false })

    if (status) query = query.eq('status', status)

    const { data, error } = await withTimeout(query)
    if (error) throw error
    return ((data || []) as BlogPostRow[]).map(rowToBlogPost)
  } catch {
    return []
  }
}

export async function getPublicBlogPosts() {
  const dbPosts = await getDatabaseBlogPosts('published')
  const merged = new Map<string, PublicBlogPost>()

  for (const post of dbPosts) merged.set(post.slug, post)
  for (const post of blogPosts) {
    if (!merged.has(post.slug)) merged.set(post.slug, { ...post, source: 'seed', authorName: 'Survive Sunday' })
  }

  const posts = sortBlogPosts(Array.from(merged.values()))
  const engagement = await getBlogEngagement(posts.map((post) => post.slug))
  return posts.map((post) => ({
    ...post,
    commentCount: engagement.get(post.slug)?.commentCount ?? 0,
    upCount: engagement.get(post.slug)?.upCount ?? 0,
    downCount: engagement.get(post.slug)?.downCount ?? 0,
  }))
}

export async function getPublicBlogCategories() {
  const fallback = Array.from(new Set(blogPosts.map((post) => post.category)))
  if (!publicBlogClient) return fallback

  try {
    const { data, error } = await withTimeout(publicBlogClient
      .from('blog_categories')
      .select('name')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }))

    if (error) throw error
    const dbCategories = (data || [])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    return Array.from(new Set([...dbCategories, ...fallback]))
  } catch {
    return fallback
  }
}

export async function getPublicBlogPost(slug: string) {
  if (publicBlogClient) {
    try {
      const { data, error } = await withTimeout(publicBlogClient
        .from('blog_posts')
        .select('id, slug, title, description, category, status, author_id, author_name, read_time, pinned, hero_image_url, sections, published_at, created_at, updated_at')
        .eq('slug', slug)
        .eq('status', 'published')
        .maybeSingle())

      if (error) throw error
      if (data) return rowToBlogPost(data as BlogPostRow)
    } catch {}
  }

  const seed = getBlogPost(slug)
  return seed ? ({ ...seed, source: 'seed', authorName: 'Survive Sunday' } satisfies PublicBlogPost) : null
}

export async function getRelatedPublicBlogPosts(post: PublicBlogPost, limit = 3) {
  const allPosts = await getPublicBlogPosts()
  const related = allPosts
    .filter((candidate) => candidate.slug !== post.slug)
    .sort((a, b) => {
      const aScore = a.category === post.category ? 1 : 0
      const bScore = b.category === post.category ? 1 : 0
      if (aScore !== bScore) return bScore - aScore
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })
    .slice(0, limit)

  return related.length ? related : getRelatedBlogPosts(post, limit)
}

async function getBlogEngagement(slugs: string[]) {
  const fallback = new Map<string, { commentCount: number; upCount: number; downCount: number }>()
  for (const slug of slugs) fallback.set(slug, { commentCount: 0, upCount: 0, downCount: 0 })
  if (!publicBlogClient || slugs.length === 0) return fallback

  try {
    const { data, error } = await withTimeout(publicBlogClient.rpc('blog_engagement_for_posts', { p_post_slugs: slugs }))
    if (error) throw error
    for (const row of data || []) {
      fallback.set(row.post_slug, {
        commentCount: Number(row.comment_count || 0),
        upCount: Number(row.up_count || 0),
        downCount: Number(row.down_count || 0),
      })
    }
  } catch {}

  return fallback
}
