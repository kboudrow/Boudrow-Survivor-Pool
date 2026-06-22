'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { blogCategories, type BlogPost } from '@/lib/blogPosts'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type BlogRole = '' | 'contributor' | 'editor' | 'admin'

type BlogPostRow = {
  id: string
  slug: string
  title: string
  description: string
  category: string
  status: 'draft' | 'published' | 'archived'
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

type FormState = {
  id: string | null
  title: string
  slug: string
  description: string
  category: string
  status: 'draft' | 'published' | 'archived'
  authorName: string
  readTime: string
  pinned: boolean
  heroImageUrl: string
  sections: BlogPost['sections']
}

const emptyForm: FormState = {
  id: null,
  title: '',
  slug: '',
  description: '',
  category: 'NFL Guide',
  status: 'draft',
  authorName: 'Survive Sunday',
  readTime: '4 min read',
  pinned: false,
  heroImageUrl: '',
  sections: [{ heading: 'Main idea', body: [''] }],
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function cleanSections(sections: BlogPost['sections']) {
  return sections
    .map((section) => ({
      heading: section.heading.trim(),
      body: section.body.map((paragraph) => paragraph.trim()).filter(Boolean),
    }))
    .filter((section) => section.heading && section.body.length > 0)
}

function estimateReadTime(sections: BlogPost['sections']) {
  const words = sections.flatMap((section) => [section.heading, ...section.body]).join(' ').trim().split(/\s+/).filter(Boolean).length
  return `${Math.max(1, Math.ceil(words / 220))} min read`
}

function formFromPost(post: BlogPostRow): FormState {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    description: post.description,
    category: post.category,
    status: post.status,
    authorName: post.author_name || 'Survive Sunday',
    readTime: post.read_time || '4 min read',
    pinned: Boolean(post.pinned),
    heroImageUrl: post.hero_image_url || '',
    sections: Array.isArray(post.sections) && post.sections.length ? post.sections : [{ heading: 'Main idea', body: [''] }],
  }
}

export default function BlogAdminPage() {
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<BlogRole>('')
  const [userId, setUserId] = useState<string | null>(null)
  const [posts, setPosts] = useState<BlogPostRow[]>([])
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [grantEmail, setGrantEmail] = useState('')
  const [grantRole, setGrantRole] = useState<BlogRole>('contributor')

  const canPublish = role === 'admin' || role === 'editor'
  const canManageAccess = role === 'admin'
  const canEditSelected = useMemo(() => {
    if (!form.id) return true
    const selected = posts.find((post) => post.id === form.id)
    if (!selected) return false
    return canPublish || selected.author_id === userId
  }, [canPublish, form.id, posts, userId])

  const filteredPosts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return posts
    return posts.filter((post) => [post.title, post.slug, post.description, post.category, post.status, post.author_name].some((value) => value?.toLowerCase().includes(q)))
  }, [posts, query])

  const loadPosts = async () => {
    const { data, error: postsErr } = await supabase
      .from('blog_posts')
      .select('id, slug, title, description, category, status, author_id, author_name, read_time, pinned, hero_image_url, sections, published_at, created_at, updated_at')
      .order('updated_at', { ascending: false })
    if (postsErr) throw postsErr
    setPosts((data || []) as BlogPostRow[])
  }

  const loadPermissions = async () => {
    if (!canManageAccess) return
    const { data, error: permErr } = await supabase.rpc('blog_permission_overview')
    if (permErr) throw permErr
    setPermissions((data || []) as PermissionRow[])
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
        setRole((roleData || '') as BlogRole)
        if (!roleData) return
        await loadPosts()
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
    setSelectedId(null)
    setForm({ ...emptyForm, authorName: 'Survive Sunday', sections: [{ heading: 'Main idea', body: [''] }] })
    setNotice(null)
    setError(null)
  }

  const selectPost = (post: BlogPostRow) => {
    setSelectedId(post.id)
    setForm(formFromPost(post))
    setNotice(null)
    setError(null)
  }

  const updateSection = (index: number, next: Partial<BlogPost['sections'][number]>) => {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, idx) => (idx === index ? { ...section, ...next } : section)),
    }))
  }

  const updateParagraph = (sectionIndex: number, paragraphIndex: number, value: string) => {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, idx) => (
        idx === sectionIndex
          ? { ...section, body: section.body.map((paragraph, pIdx) => (pIdx === paragraphIndex ? value : paragraph)) }
          : section
      )),
    }))
  }

  const savePost = async (nextStatus?: FormState['status']) => {
    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const sections = cleanSections(form.sections)
      if (!form.title.trim()) throw new Error('Add a title before saving.')
      if (!form.description.trim()) throw new Error('Add a description before saving.')
      if (sections.length === 0) throw new Error('Add at least one complete section before saving.')
      const status = nextStatus || form.status
      const safeStatus = canPublish ? status : 'draft'
      const slug = slugify(form.slug || form.title)
      if (!slug) throw new Error('Add a valid slug before saving.')

      const payload = {
        title: form.title.trim(),
        slug,
        description: form.description.trim(),
        category: form.category,
        status: safeStatus,
        author_id: userId,
        author_name: form.authorName.trim() || 'Survive Sunday',
        read_time: form.readTime.trim() || estimateReadTime(sections),
        pinned: canPublish ? form.pinned : false,
        hero_image_url: form.heroImageUrl.trim() || null,
        sections,
        published_at: safeStatus === 'published' ? new Date().toISOString() : null,
      }

      if (form.id) {
        const { error: updateErr } = await supabase.from('blog_posts').update(payload).eq('id', form.id)
        if (updateErr) throw updateErr
        setNotice(safeStatus === 'published' ? 'Post published.' : 'Post saved.')
      } else {
        const { data, error: insertErr } = await supabase.from('blog_posts').insert(payload).select('id').single()
        if (insertErr) throw insertErr
        setSelectedId(data.id)
        setForm((current) => ({ ...current, id: data.id, slug, status: safeStatus, sections }))
        setNotice(safeStatus === 'published' ? 'Post created and published.' : 'Draft created.')
      }

      await loadPosts()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save post.'))
    } finally {
      setSaving(false)
    }
  }

  const deletePost = async () => {
    if (!form.id) return
    const confirmed = window.confirm(`Delete "${form.title}"? This cannot be undone.`)
    if (!confirmed) return
    setSaving(true)
    setError(null)
    try {
      const { error: deleteErr } = await supabase.from('blog_posts').delete().eq('id', form.id)
      if (deleteErr) throw deleteErr
      setNotice('Post deleted.')
      startNewPost()
      await loadPosts()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to delete post.'))
    } finally {
      setSaving(false)
    }
  }

  const grantAccess = async () => {
    setError(null)
    setNotice(null)
    try {
      const { data, error: grantErr } = await supabase.rpc('grant_blog_permission', {
        p_email: grantEmail,
        p_role: grantRole,
      })
      if (grantErr) throw grantErr
      setNotice(String(data || 'Blog access updated.'))
      setGrantEmail('')
      await loadPermissions()
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to grant blog access.'))
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
          <p className="mt-2 text-sm">Ask a blog admin to add you as a contributor or editor.</p>
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
            <p className="mt-1 text-sm text-slate-600">Role: <span className="font-semibold capitalize">{role}</span></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/blog" className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
              View Blog
            </Link>
            <button onClick={startNewPost} className="rounded-md bg-[#c5161d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
              New Post
            </button>
          </div>
        </div>

        {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {notice && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <aside className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search posts"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="max-h-[760px] overflow-y-auto">
              {filteredPosts.map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => selectPost(post)}
                  className={`block w-full border-b border-slate-100 p-3 text-left hover:bg-slate-50 ${selectedId === post.id ? 'bg-slate-100' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-950">{post.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{post.category} / {post.read_time}</div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      post.status === 'published' ? 'bg-emerald-100 text-emerald-700' : post.status === 'archived' ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'
                    }`}>
                      {post.status}
                    </span>
                  </div>
                </button>
              ))}
              {filteredPosts.length === 0 && <p className="p-4 text-sm text-slate-500">No posts yet.</p>}
            </div>

            {canManageAccess && (
              <div className="border-t border-slate-200 p-3">
                <h2 className="font-semibold text-slate-950">Blog access</h2>
                <div className="mt-3 grid gap-2">
                  <input
                    value={grantEmail}
                    onChange={(event) => setGrantEmail(event.target.value)}
                    placeholder="friend@example.com"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <div className="flex gap-2">
                    <select value={grantRole} onChange={(event) => setGrantRole(event.target.value as BlogRole)} className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm">
                      <option value="contributor">Contributor</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button onClick={grantAccess} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
                      Add
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  {permissions.map((permission) => (
                    <div key={permission.profile_id} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                      <div className="font-semibold text-slate-950">{permission.display_name || permission.email || permission.profile_id}</div>
                      <div className="text-slate-500">{permission.email || permission.profile_id} / {permission.role}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Title</span>
                <input
                  value={form.title}
                  onChange={(event) => {
                    const title = event.target.value
                    setForm((current) => ({ ...current, title, slug: current.slug || slugify(title) }))
                  }}
                  disabled={!canEditSelected}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Slug</span>
                <input
                  value={form.slug}
                  onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
                  disabled={!canEditSelected}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  disabled={!canEditSelected}
                  className="mt-1 min-h-20 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Category</span>
                <select
                  value={form.category}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                  disabled={!canEditSelected}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  {blogCategories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Status</span>
                <select
                  value={form.status}
                  onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as FormState['status'] }))}
                  disabled={!canPublish}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
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
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">Read time</span>
                <input
                  value={form.readTime}
                  onChange={(event) => setForm((current) => ({ ...current, readTime: event.target.value }))}
                  disabled={!canEditSelected}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-sm font-semibold text-slate-700">Hero image URL</span>
                <input
                  value={form.heroImageUrl}
                  onChange={(event) => setForm((current) => ({ ...current, heroImageUrl: event.target.value }))}
                  disabled={!canEditSelected}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </label>
              {canPublish && (
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.pinned}
                    onChange={(event) => setForm((current) => ({ ...current, pinned: event.target.checked }))}
                  />
                  Pin as featured
                </label>
              )}
            </div>

            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Article sections</h2>
              <button
                type="button"
                onClick={() => setForm((current) => ({ ...current, sections: [...current.sections, { heading: 'New section', body: [''] }] }))}
                disabled={!canEditSelected}
                className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200"
              >
                Add section
              </button>
            </div>

            <div className="grid gap-4">
              {form.sections.map((section, sectionIndex) => (
                <div key={sectionIndex} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-3 flex gap-2">
                    <input
                      value={section.heading}
                      onChange={(event) => updateSection(sectionIndex, { heading: event.target.value })}
                      disabled={!canEditSelected}
                      className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 font-semibold"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, sections: current.sections.filter((_, idx) => idx !== sectionIndex) }))}
                      disabled={!canEditSelected || form.sections.length === 1}
                      className="rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-2">
                    {section.body.map((paragraph, paragraphIndex) => (
                      <textarea
                        key={paragraphIndex}
                        value={paragraph}
                        onChange={(event) => updateParagraph(sectionIndex, paragraphIndex, event.target.value)}
                        disabled={!canEditSelected}
                        className="min-h-24 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm leading-6"
                        placeholder="Paragraph text"
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => updateSection(sectionIndex, { body: [...section.body, ''] })}
                    disabled={!canEditSelected}
                    className="mt-2 rounded-md bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Add paragraph
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => savePost('draft')}
                  disabled={saving || !canEditSelected}
                  className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                {canPublish && (
                  <button
                    onClick={() => savePost('published')}
                    disabled={saving || !canEditSelected}
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Publish
                  </button>
                )}
                {form.id && (
                  <Link href={`/blog/${form.slug}`} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                    Preview Public URL
                  </Link>
                )}
              </div>
              {form.id && canPublish && (
                <button onClick={deletePost} disabled={saving} className="rounded-md bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
                  Delete
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
