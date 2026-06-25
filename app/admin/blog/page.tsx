'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { blogCategories as seedBlogCategories, type BlogPost } from '@/lib/blogPosts'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type BlogRole = '' | 'contributor' | 'editor' | 'admin'
type Tab = 'posts' | 'new' | 'categories' | 'access' | 'comments'
type Status = 'draft' | 'published' | 'archived'

type BlogPostRow = {
  id: string
  slug: string
  title: string
  description: string
  category: string
  status: Status
  author_id: string | null
  author_name: string
  read_time: string
  pinned: boolean
  hero_image_url: string | null
  sections: BlogPost['sections']
  published_at: string | null
  created_at: string
  updated_at: string
}

type PermissionRow = {
  profile_id: string
  email: string | null
  display_name: string | null
  role: BlogRole
  created_at: string
}

type PostMetricRow = {
  post_slug: string
  comment_count: number
  up_count: number
  down_count: number
}

type CommentModerationRow = {
  id: string
  post_slug: string
  profile_id: string
  parent_comment_id: string | null
  author_name: string | null
  avatar_url: string | null
  body: string
  created_at: string
  up_count: number
  down_count: number
  report_count: number
  latest_report_at: string | null
}

type FormState = {
  id: string | null
  title: string
  slug: string
  description: string
  category: string
  status: Status
  authorName: string
  pinned: boolean
  heroImageUrl: string
  body: string
}

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'

const emptyForm: FormState = {
  id: null,
  title: '',
  slug: '',
  description: '',
  category: 'Survivor Pools',
  status: 'draft',
  authorName: 'Survive Sunday',
  pinned: false,
  heroImageUrl: '',
  body: '',
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function uniqueSlug(baseSlug: string, posts: BlogPostRow[], currentId: string | null) {
  const base = baseSlug || 'blog-post'
  const taken = new Set(posts.filter((post) => post.id !== currentId).map((post) => post.slug))
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

function duplicateSlugMessage(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const message = String((error as { message?: string }).message || '')
  const code = String((error as { code?: string }).code || '')
  return code === '23505' || message.includes('blog_posts_slug_key') || message.includes('duplicate key value')
}

function paragraphsFromBody(body: string) {
  return body
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function sectionsFromBody(body: string): BlogPost['sections'] {
  return [{ heading: 'Article', body: paragraphsFromBody(body) }]
}

function bodyFromSections(sections: BlogPost['sections']) {
  return (Array.isArray(sections) ? sections : [])
    .flatMap((section) => section.body || [])
    .filter(Boolean)
    .join('\n\n')
}

function estimateReadTime(body: string) {
  const words = body.trim().split(/\s+/).filter(Boolean).length
  return `${Math.max(1, Math.ceil(words / 220))} min read`
}

function prettyDate(value: string | null) {
  if (!value) return 'Not published'
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formFromPost(post: BlogPostRow): FormState {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    description: post.description,
    category: post.category || 'Survivor Pools',
    status: post.status,
    authorName: post.author_name || 'Survive Sunday',
    pinned: Boolean(post.pinned),
    heroImageUrl: post.hero_image_url || '',
    body: bodyFromSections(post.sections),
  }
}

export default function BlogAdminPage() {
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<BlogRole>('')
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [posts, setPosts] = useState<BlogPostRow[]>([])
  const [postMetrics, setPostMetrics] = useState<Record<string, PostMetricRow>>({})
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [comments, setComments] = useState<CommentModerationRow[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [activeTab, setActiveTab] = useState<Tab>('posts')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [categories, setCategories] = useState<string[]>([...seedBlogCategories])
  const [newCategory, setNewCategory] = useState('')
  const [savingCategory, setSavingCategory] = useState(false)

  const isSuperAdmin = userEmail?.toLowerCase() === SUPERADMIN_EMAIL
  const canPublish = isSuperAdmin
  const canManageAccess = isSuperAdmin
  const canEditSelected = useMemo(() => {
    if (!form.id) return true
    if (isSuperAdmin) return true
    const selected = posts.find((post) => post.id === form.id)
    return Boolean(selected && selected.author_id === userId && selected.status === 'draft')
  }, [form.id, isSuperAdmin, posts, userId])

  const filteredPosts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return posts
    return posts.filter((post) => [post.title, post.description, post.category, post.status, post.author_name].some((value) => value?.toLowerCase().includes(q)))
  }, [posts, query])

  const loadPosts = async () => {
    const { data, error: postsErr } = await supabase
      .from('blog_posts')
      .select('id, slug, title, description, category, status, author_id, author_name, read_time, pinned, hero_image_url, sections, published_at, created_at, updated_at')
      .order('updated_at', { ascending: false })
    if (postsErr) throw postsErr
    const nextPosts = (data || []) as BlogPostRow[]
    setPosts(nextPosts)
    const slugs = nextPosts.map((post) => post.slug)
    if (slugs.length === 0) {
      setPostMetrics({})
      return
    }
    const { data: metricsData, error: metricsErr } = await supabase.rpc('blog_engagement_for_posts', { p_post_slugs: slugs })
    if (metricsErr) throw metricsErr
    setPostMetrics(
      Object.fromEntries(((metricsData || []) as PostMetricRow[]).map((metric) => [metric.post_slug, metric])),
    )
  }

  const loadCategories = async () => {
    const { data, error: categoryErr } = await supabase
      .from('blog_categories')
      .select('name')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (categoryErr) throw categoryErr
    const nextCategories = (data || [])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    setCategories(Array.from(new Set([...nextCategories, ...seedBlogCategories])))
  }

  const loadPermissions = async () => {
    if (!canManageAccess) return
    const { data, error: permErr } = await supabase.rpc('blog_permission_overview')
    if (permErr) throw permErr
    setPermissions((data || []) as PermissionRow[])
  }

  const loadComments = async () => {
    if (!isSuperAdmin) return
    setCommentsLoading(true)
    try {
      const { data, error: commentsErr } = await supabase.rpc('blog_comment_moderation_queue')
      if (commentsErr) throw commentsErr
      setComments((data || []) as CommentModerationRow[])
    } finally {
      setCommentsLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    const init = async () => {
      try {
        setLoading(true)
        setError(null)
        const [{ data: userData, error: userErr }, { data: roleData, error: roleErr }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.rpc('current_blog_role'),
        ])
        if (userErr) throw userErr
        if (roleErr) throw roleErr
        if (!alive) return
        setUserId(userData.user?.id ?? null)
        setUserEmail(userData.user?.email ?? null)
        const nextIsSuperAdmin = userData.user?.email?.toLowerCase() === SUPERADMIN_EMAIL
        setRole((roleData || '') as BlogRole)
        if (roleData) {
          await Promise.all([
            loadPosts(),
            loadCategories(),
            nextIsSuperAdmin ? supabase.rpc('blog_comment_moderation_queue').then(({ data, error }) => {
              if (error) throw error
              setComments((data || []) as CommentModerationRow[])
            }) : Promise.resolve(),
          ])
        }
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load blog admin.'))
      } finally {
        if (alive) setLoading(false)
      }
    }

    init()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (canManageAccess) loadPermissions().catch((e) => setError(getErrorMessage(e, 'Failed to load blog access.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageAccess])

  const startNewPost = () => {
    setForm({ ...emptyForm })
    setActiveTab('new')
    setNotice(null)
    setError(null)
  }

  const selectPost = (post: BlogPostRow) => {
    setForm(formFromPost(post))
    setActiveTab('new')
    setNotice(null)
    setError(null)
  }

  const deleteComment = async (comment: CommentModerationRow) => {
    if (!isSuperAdmin || deletingCommentId) return
    const confirmed = window.confirm(`Delete this comment from ${comment.author_name || 'this reader'}?`)
    if (!confirmed) return
    setDeletingCommentId(comment.id)
    setError(null)
    setNotice(null)
    try {
      const { error: deleteErr } = await supabase.rpc('blog_delete_comment', { p_comment_id: comment.id })
      if (deleteErr) throw deleteErr
      setNotice('Comment deleted.')
      await Promise.all([loadComments(), loadPosts()])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to delete comment.'))
    } finally {
      setDeletingCommentId(null)
    }
  }

  const uploadHeroImage = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
      if (file.size > 5 * 1024 * 1024) throw new Error('Blog images must be 5 MB or smaller.')
      const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      const path = `${userId || 'blog'}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadError } = await supabase.storage.from('blog-images').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('blog-images').getPublicUrl(path)
      setForm((current) => ({ ...current, heroImageUrl: data.publicUrl }))
      setNotice('Hero image uploaded.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to upload hero image.'))
    } finally {
      setUploading(false)
    }
  }

  const savePost = async (nextStatus: Status = 'draft') => {
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      if (!form.title.trim()) throw new Error('Add a title before saving.')
      if (!form.description.trim()) throw new Error('Add a short summary before saving.')
      const bodyParagraphs = paragraphsFromBody(form.body)
      if (bodyParagraphs.length === 0) throw new Error('Write the blog post before saving.')
      const safeStatus = canPublish ? nextStatus : 'draft'
      const slug = uniqueSlug(slugify(form.slug || form.title), posts, form.id)
      if (!slug) throw new Error('Add a title that can be used for the post URL.')

      const payload = {
        title: form.title.trim(),
        slug,
        description: form.description.trim(),
        category: form.category,
        status: safeStatus,
        author_id: userId,
        author_name: form.authorName.trim() || 'Survive Sunday',
        read_time: estimateReadTime(form.body),
        pinned: canPublish ? form.pinned : false,
        hero_image_url: form.heroImageUrl.trim() || null,
        sections: sectionsFromBody(form.body),
        published_at: safeStatus === 'published' ? new Date().toISOString() : null,
      }

      if (form.id) {
        const { error: updateErr } = await supabase.from('blog_posts').update(payload).eq('id', form.id)
        if (updateErr) {
          if (duplicateSlugMessage(updateErr)) {
            const fallbackSlug = `${slug}-${Date.now().toString(36)}`
            const { error: retryErr } = await supabase.from('blog_posts').update({ ...payload, slug: fallbackSlug }).eq('id', form.id)
            if (retryErr) throw retryErr
            setForm((current) => ({ ...current, slug: fallbackSlug, status: safeStatus }))
          } else {
            throw updateErr
          }
        } else {
          setForm((current) => ({ ...current, slug, status: safeStatus }))
        }
        setNotice(safeStatus === 'published' ? 'Post published.' : safeStatus === 'archived' ? 'Post archived.' : 'Draft saved.')
      } else {
        const { data, error: insertErr } = await supabase.from('blog_posts').insert(payload).select('id').single()
        if (insertErr) {
          if (duplicateSlugMessage(insertErr)) {
            const fallbackSlug = `${slug}-${Date.now().toString(36)}`
            const { data: retryData, error: retryErr } = await supabase.from('blog_posts').insert({ ...payload, slug: fallbackSlug }).select('id').single()
            if (retryErr) throw retryErr
            setForm((current) => ({ ...current, id: retryData.id, slug: fallbackSlug, status: safeStatus }))
          } else {
            throw insertErr
          }
        } else {
          setForm((current) => ({ ...current, id: data.id, slug, status: safeStatus }))
        }
        setNotice(canPublish && safeStatus === 'published' ? 'Post created and published.' : 'Draft submitted.')
      }

      await loadPosts()
      setActiveTab('posts')
      setForm({ ...emptyForm })
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save post.'))
    } finally {
      setSaving(false)
    }
  }

  const deletePost = async () => {
    if (!form.id || !isSuperAdmin) return
    const confirmed = window.confirm(`Delete "${form.title}"? This cannot be undone.`)
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      const { error: deleteErr } = await supabase.from('blog_posts').delete().eq('id', form.id)
      if (deleteErr) throw deleteErr
      setNotice('Post deleted.')
      await loadPosts()
      setActiveTab('posts')
      setForm({ ...emptyForm })
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to delete post.'))
    } finally {
      setSaving(false)
    }
  }

  const grantAccess = async () => {
    if (!isSuperAdmin) return
    setError(null)
    setNotice(null)
    try {
      const { data, error: grantErr } = await supabase.rpc('grant_blog_permission', {
        p_email: grantEmail,
        p_role: 'contributor',
      })
      if (grantErr) throw grantErr
      setNotice(String(data || 'Contributor added.'))
      setGrantEmail('')
      await loadPermissions()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to add contributor.'))
    }
  }

  const addCategory = async () => {
    if (!isSuperAdmin) return
    const name = newCategory.trim()
    if (!name) return
    const alreadyExists = categories.some((category) => category.toLowerCase() === name.toLowerCase())
    if (alreadyExists) {
      setNewCategory('')
      setNotice(`${name} is already in your category list.`)
      return
    }
    setSavingCategory(true)
    setError(null)
    setNotice(null)
    try {
      const sortOrder = Math.max(100, categories.length * 10 + 10)
      const { error: insertErr } = await supabase
        .from('blog_categories')
        .upsert({ name, sort_order: sortOrder, created_by: userId }, { onConflict: 'name', ignoreDuplicates: true })
      if (insertErr) throw insertErr
      setNewCategory('')
      setNotice(`Added ${name} category.`)
      await loadCategories()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to add category.'))
    } finally {
      setSavingCategory(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8">
        <p>Loading blog admin...</p>
      </main>
    )
  }

  if (!role) {
    return (
      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
          <h1 className="text-xl font-bold">Blog access required</h1>
          <p className="mt-2 text-sm">Ask the Survive Sunday admin to add you as a contributor.</p>
          <Link href="/?auth=signin&returnTo=%2Fadmin%2Fblog" className="mt-4 inline-flex rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white">
            Sign in
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Blog Admin</p>
            <h1 className="text-3xl font-bold text-slate-950">Publishing Desk</h1>
            <p className="mt-1 text-sm text-slate-600">{isSuperAdmin ? 'Superadmin' : 'Contributor'} access</p>
          </div>
          <Link href="/blog" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
            View Blog
          </Link>
        </div>

        {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        <div className="mb-5 flex flex-wrap gap-2 border-b border-slate-200">
          <TabButton label="Posts" active={activeTab === 'posts'} onClick={() => setActiveTab('posts')} />
          <TabButton label={form.id ? 'Edit Post' : 'Write New Blog'} active={activeTab === 'new'} onClick={startNewPost} />
          {isSuperAdmin && <TabButton label="Comments" active={activeTab === 'comments'} onClick={() => { setActiveTab('comments'); loadComments().catch((e) => setError(getErrorMessage(e, 'Failed to load comments.'))) }} />}
          {isSuperAdmin && <TabButton label="Categories" active={activeTab === 'categories'} onClick={() => setActiveTab('categories')} />}
          {isSuperAdmin && <TabButton label="Access" active={activeTab === 'access'} onClick={() => setActiveTab('access')} />}
        </div>

        {activeTab === 'posts' && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search posts"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm md:max-w-md"
              />
              <button onClick={startNewPost} className="rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
                Write New Blog
              </button>
            </div>
            <div className="grid gap-3 md:hidden">
              {filteredPosts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => selectPost(post)}
                  className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-[#c5161d]/50 hover:bg-slate-50"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-2 text-base font-bold leading-5 text-slate-950">{post.title}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{post.category}</div>
                    </div>
                    <StatusPill status={post.status} />
                  </div>
                  <p className="line-clamp-2 text-sm leading-5 text-slate-600">{post.description}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{post.author_name || 'Survive Sunday'}</span>
                    <span>Updated {prettyDate(post.updated_at)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-slate-600 sm:flex-nowrap">
                    <span>{postMetrics[post.slug]?.comment_count || 0} comments</span>
                    <span>{postMetrics[post.slug]?.up_count || 0} 👍</span>
                    <span>{postMetrics[post.slug]?.down_count || 0} 👎</span>
                  </div>
                  <div className="mt-3 inline-flex rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800">
                    {post.status === 'published' ? 'Open / manage' : 'Open / edit'}
                  </div>
                </button>
              ))}
              {filteredPosts.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">No posts found.</div>
              )}
            </div>

            <div className="hidden overflow-hidden rounded-lg border border-slate-200 md:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Post</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Author</th>
                    <th className="px-3 py-2">Engagement</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPosts.map((post) => (
                    <tr
                      key={post.id}
                      onClick={() => selectPost(post)}
                      className="cursor-pointer border-t border-slate-100 transition hover:bg-slate-50"
                    >
                      <td className="px-3 py-3">
                        <button type="button" onClick={(event) => { event.stopPropagation(); selectPost(post) }} className="text-left font-semibold text-slate-950 hover:text-[#c5161d]">
                          {post.title}
                        </button>
                        <div className="line-clamp-1 text-xs text-slate-500">{post.description}</div>
                      </td>
                      <td className="px-3 py-3">{post.category}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={post.status} />
                      </td>
                      <td className="px-3 py-3">{post.author_name || 'Survive Sunday'}</td>
                      <td className="min-w-44 px-3 py-3 text-xs text-slate-600">
                        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                          <span><span className="font-semibold">{postMetrics[post.slug]?.comment_count || 0}</span> comments</span>
                          <span>/</span>
                          <span><span className="font-semibold">{postMetrics[post.slug]?.up_count || 0}</span> 👍</span>
                          <span>/</span>
                          <span><span className="font-semibold">{postMetrics[post.slug]?.down_count || 0}</span> 👎</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">{prettyDate(post.updated_at)}</td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => selectPost(post)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredPosts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-500">No posts found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'comments' && isSuperAdmin && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-950">Comment Moderation</h2>
                <p className="mt-1 text-sm text-slate-600">Only the superadmin can delete comments. Reports are reader flags, not automatic removals.</p>
              </div>
              <button
                onClick={() => loadComments().catch((e) => setError(getErrorMessage(e, 'Failed to load comments.')))}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                {commentsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <div className="grid gap-3">
              {comments.map((comment) => (
                <div key={comment.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-950">{comment.author_name || 'Reader'}</div>
                      <div className="text-xs text-slate-500">
                        /blog/{comment.post_slug} / {prettyDate(comment.created_at)}
                        {comment.parent_comment_id ? ' / reply' : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">{comment.report_count} reports</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{comment.up_count} 👍</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{comment.down_count} 👎</span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-800">{comment.body}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/blog/${comment.post_slug}`} className="text-sm font-semibold text-[#c5161d] hover:underline">
                      Open post
                    </Link>
                    <button
                      onClick={() => deleteComment(comment)}
                      disabled={deletingCommentId === comment.id}
                      className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {deletingCommentId === comment.id ? 'Deleting...' : 'Delete Comment'}
                    </button>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No comments to review yet.
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'new' && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-950">{form.id ? 'Edit Blog Post' : 'Write New Blog'}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Status: <span className="font-semibold capitalize">{form.status}</span>
                  {form.slug && <span> / URL: /blog/{form.slug}</span>}
                </p>
                {!isSuperAdmin && (
                  <p className="mt-1 text-xs text-slate-500">Drafts are submitted for review. Publishing and access changes stay with the site admin.</p>
                )}
                {form.id && !canEditSelected && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    This post is locked for your account. Contributors can edit their own drafts before review.
                  </p>
                )}
              </div>
              {form.id && form.status === 'published' && (
                <Link href={`/blog/${form.slug}`} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                  View Public Post
                </Link>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Title</span>
                  <input
                    value={form.title}
                    onChange={(event) => {
                      const title = event.target.value
                      setForm((current) => ({ ...current, title, slug: current.id ? current.slug : slugify(title) }))
                    }}
                    disabled={!canEditSelected}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Short summary</span>
                  <textarea
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    disabled={!canEditSelected}
                    className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Blog post</span>
                  <textarea
                    value={form.body}
                    onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
                    disabled={!canEditSelected}
                    placeholder="Write the full post here. Use a blank line between paragraphs."
                    className="mt-1 min-h-[480px] w-full rounded-md border border-slate-300 px-3 py-3 text-sm leading-6"
                  />
                </label>
              </div>

              <aside className="grid content-start gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Category</span>
                  <select
                    value={form.category}
                    onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                    disabled={!canEditSelected}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  >
                    {categories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Author name</span>
                  <input
                    value={form.authorName}
                    onChange={(event) => setForm((current) => ({ ...current, authorName: event.target.value }))}
                    disabled={!canEditSelected}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  />
                </label>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-semibold text-slate-700">Hero image</div>
                  <div className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-white">
                    {form.heroImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.heroImageUrl} alt="" className="h-36 w-full object-cover" />
                    ) : (
                      <div className="flex h-36 items-center justify-center text-sm text-slate-500">No image selected</div>
                    )}
                  </div>
                  <label className="mt-3 inline-flex cursor-pointer rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                    {uploading ? 'Uploading...' : 'Choose Image'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploading || !canEditSelected}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) uploadHeroImage(file)
                        event.currentTarget.value = ''
                      }}
                      className="sr-only"
                    />
                  </label>
                  {form.heroImageUrl && canEditSelected && (
                    <button
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, heroImageUrl: '' }))}
                      className="ml-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {isSuperAdmin && (
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.pinned}
                      onChange={(event) => setForm((current) => ({ ...current, pinned: event.target.checked }))}
                    />
                    Pin as featured
                  </label>
                )}
              </aside>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => savePost('draft')}
                  disabled={saving || !canEditSelected}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? 'Saving...' : isSuperAdmin ? 'Save Draft' : 'Submit Draft'}
                </button>
                {isSuperAdmin && (
                  <>
                    <button
                      onClick={() => savePost('published')}
                      disabled={saving || !canEditSelected}
                      className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Publish
                    </button>
                    {form.id && form.status !== 'archived' && (
                      <button
                        onClick={() => savePost('archived')}
                        disabled={saving || !canEditSelected}
                        className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
                      >
                        Archive
                      </button>
                    )}
                  </>
                )}
              </div>
              {form.id && isSuperAdmin && (
                <button onClick={deletePost} disabled={saving} className="rounded-md bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
                  Delete
                </button>
              )}
            </div>
          </section>
        )}

        {activeTab === 'categories' && isSuperAdmin && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">Blog Categories</h2>
              <p className="mt-1 text-sm text-slate-600">Add categories that contributors can use when writing posts.</p>
            </div>
            <div className="mb-5 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row">
              <input
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addCategory()
                }}
                placeholder="e.g. College Football"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                onClick={addCategory}
                disabled={savingCategory || !newCategory.trim()}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingCategory ? 'Adding...' : 'Add Category'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <span key={category} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
                  {category}
                </span>
              ))}
            </div>
          </section>
        )}

        {activeTab === 'access' && isSuperAdmin && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-xl font-bold text-slate-950">Blog Contributors</h2>
              <p className="mt-1 text-sm text-slate-600">Only the Survive Sunday superadmin can add contributors. Contributors can submit drafts, but publishing stays with you.</p>
            </div>
            <div className="mb-5 flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row">
              <input
                value={grantEmail}
                onChange={(event) => setGrantEmail(event.target.value)}
                placeholder="friend@example.com"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <button onClick={grantAccess} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Add Contributor
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {permissions.map((permission) => (
                <div key={permission.profile_id} className="rounded-md border border-slate-200 bg-white p-3 text-sm">
                  <div className="font-semibold text-slate-950">{permission.display_name || permission.email || permission.profile_id}</div>
                  <div className="mt-1 text-slate-500">{permission.email || permission.profile_id}</div>
                  <div className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-700">{permission.role}</div>
                </div>
              ))}
              {permissions.length === 0 && <p className="text-sm text-slate-500">No contributors added yet.</p>}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-sm font-semibold ${
        active ? 'border-[#c5161d] text-[#c5161d]' : 'border-transparent text-slate-600 hover:text-slate-950'
      }`}
    >
      {label}
    </button>
  )
}

function StatusPill({ status }: { status: Status }) {
  const classes =
    status === 'published'
      ? 'bg-emerald-100 text-emerald-700'
      : status === 'archived'
        ? 'bg-slate-200 text-slate-600'
        : 'bg-amber-100 text-amber-700'

  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${classes}`}>{status}</span>
}
