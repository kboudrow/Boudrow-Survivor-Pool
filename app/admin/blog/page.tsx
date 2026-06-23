'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { blogCategories, type BlogPost } from '@/lib/blogPosts'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type BlogRole = '' | 'contributor' | 'editor' | 'admin'
type Tab = 'posts' | 'new' | 'access'
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
    category: blogCategories.includes(post.category as (typeof blogCategories)[number]) ? post.category : 'Survivor Pools',
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
  const [permissions, setPermissions] = useState<PermissionRow[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [activeTab, setActiveTab] = useState<Tab>('posts')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [grantEmail, setGrantEmail] = useState('')

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
        setUserEmail(userData.user?.email ?? null)
        setRole((roleData || '') as BlogRole)
        if (roleData) await loadPosts()
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
      const slug = slugify(form.slug || form.title)
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
        if (updateErr) throw updateErr
        setNotice(safeStatus === 'published' ? 'Post published.' : safeStatus === 'archived' ? 'Post archived.' : 'Draft saved.')
      } else {
        const { data, error: insertErr } = await supabase.from('blog_posts').insert(payload).select('id').single()
        if (insertErr) throw insertErr
        setForm((current) => ({ ...current, id: data.id, slug, status: safeStatus }))
        setNotice(canPublish && safeStatus === 'published' ? 'Post created and published.' : 'Draft submitted.')
      }

      await loadPosts()
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
      startNewPost()
      await loadPosts()
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
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Post</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Author</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPosts.map((post) => (
                    <tr key={post.id} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-950">{post.title}</div>
                        <div className="line-clamp-1 text-xs text-slate-500">{post.description}</div>
                      </td>
                      <td className="px-3 py-3">{post.category}</td>
                      <td className="px-3 py-3">
                        <StatusPill status={post.status} />
                      </td>
                      <td className="px-3 py-3">{post.author_name || 'Survive Sunday'}</td>
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
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">No posts found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                    {blogCategories.map((category) => <option key={category}>{category}</option>)}
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
