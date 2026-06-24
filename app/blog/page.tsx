import Link from 'next/link'
import type { Metadata } from 'next'
import { getPublicBlogCategories, getPublicBlogPosts, type PublicBlogPost } from '@/lib/blogDb'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'NFL Blog | Survive Sunday',
  description: 'NFL survivor pool strategy, commissioner guides, rules explainers, templates, and general football notes.',
  alternates: {
    canonical: '/blog',
  },
}

type BlogPageProps = {
  searchParams?: Promise<{
    category?: string
    q?: string
  }>
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
  const params = (await searchParams) || {}
  const selectedCategory = params.category || 'All'
  const query = (params.q || '').trim()
  const [allPosts, allCategories] = await Promise.all([getPublicBlogPosts(), getPublicBlogCategories()])
  const featured = allPosts.find((post) => post.pinned) || allPosts[0]
  const visibleCategories = allCategories.filter((category) => allPosts.some((post) => post.category === category))
  const filteredPosts = allPosts.filter((post) => {
    const categoryMatch = selectedCategory === 'All' || post.category === selectedCategory
    const queryMatch =
      !query ||
      `${post.title} ${post.description} ${post.category} ${post.sections.map((section) => section.heading).join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase())
    return categoryMatch && queryMatch
  })
  const latestPosts = featured ? filteredPosts.filter((post) => post.slug !== featured.slug) : filteredPosts

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-xl border border-red-950 bg-[#090b0f] p-5 text-white shadow-sm sm:p-8">
          <p className="text-sm font-bold uppercase tracking-wide text-[#d2ad5b]">Survive Sunday Journal</p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.4fr)] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-3xl font-extrabold tracking-normal sm:text-5xl">
                NFL notes, survivor strategy, and commissioner help.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
                Guides for running better pools, understanding league settings, following NFL wrinkles, and keeping Sunday fun instead of administrative.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-white/5 p-3 text-center">
              <Stat value={String(allPosts.length)} label="Articles" />
              <Stat value={String(visibleCategories.length)} label="Topics" />
              <Stat value="2026" label="Season" />
            </div>
          </div>
        </section>

        <section className="mt-6">
          <article className="rounded-xl border border-[#d2ad5b]/60 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#c5161d] px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">Featured</span>
              {featured && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{featured.category}</span>}
              {featured && <span className="text-xs font-medium text-slate-500">Updated {featured.publishedAt}</span>}
            </div>
            {featured ? (
              <>
                {featured.heroImageUrl && (
                  <div className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={featured.heroImageUrl} alt="" className="max-h-[420px] w-full object-contain" />
                  </div>
                )}
                <h2 className="text-3xl font-extrabold tracking-normal text-slate-950">
                  <Link href={`/blog/${featured.slug}`} className="hover:text-[#c5161d]">
                    {featured.title}
                  </Link>
                </h2>
                <p className="mt-3 max-w-2xl leading-7 text-slate-600">{featured.description}</p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">{featured.commentCount ?? 0} comments</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">👍 {featured.upCount ?? 0}</span>
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-red-700">👎 {featured.downCount ?? 0}</span>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600">No published articles yet.</p>
            )}
          </article>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <CategoryLink label="All" active={selectedCategory === 'All'} query={query} />
              {visibleCategories.map((category) => (
                <CategoryLink key={category} label={category} active={selectedCategory === category} query={query} />
              ))}
            </div>
            <form action="/blog" className="flex min-w-0 gap-2 sm:min-w-[320px]">
              {selectedCategory !== 'All' && <input type="hidden" name="category" value={selectedCategory} />}
              <input
                name="q"
                defaultValue={query}
                placeholder="Search"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-[#c5161d] focus:outline-none focus:ring-2 focus:ring-red-100"
              />
              <button className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Search</button>
            </form>
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Latest</p>
              <h2 className="text-2xl font-extrabold tracking-normal text-slate-950">
                {selectedCategory === 'All' ? 'Latest articles' : selectedCategory}
              </h2>
            </div>
            {(selectedCategory !== 'All' || query) && (
              <Link href="/blog" className="text-sm font-semibold text-[#c5161d] hover:text-[#a91218]">
                Clear filters
              </Link>
            )}
          </div>

          {filteredPosts.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              No articles match that search yet.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(featured && filteredPosts.some((post) => post.slug === featured.slug) ? latestPosts : filteredPosts).map((post) => (
                <BlogCard key={post.slug} post={post} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 rounded-xl border border-[#d2ad5b]/50 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Running a pool this season?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Create your league before Week 1 and keep picks, locks, standings, and rule disputes in one place.
              </p>
            </div>
            <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 text-center text-sm font-semibold text-white hover:bg-[#a91218]">
              Create League
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl font-extrabold text-white">{value}</div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">{label}</div>
    </div>
  )
}

function CategoryLink({ label, active, query }: { label: string; active: boolean; query: string }) {
  const params = new URLSearchParams()
  if (label !== 'All') params.set('category', label)
  if (query) params.set('q', query)
  const href = params.toString() ? `/blog?${params.toString()}` : '/blog'
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        active ? 'border-[#c5161d] bg-[#c5161d] text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-white'
      }`}
    >
      {label}
    </Link>
  )
}

function BlogCard({ post }: { post: PublicBlogPost }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#c5161d]/40">
      {post.heroImageUrl && (
        <div className="mb-4 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.heroImageUrl} alt="" className="h-40 w-full object-contain" />
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{post.category}</span>
        <span>Updated {post.publishedAt}</span>
      </div>
      <h3 className="text-xl font-bold text-slate-950">
        <Link href={`/blog/${post.slug}`} className="hover:text-[#c5161d]">
          {post.title}
        </Link>
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{post.description}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
        <span className="rounded-full bg-slate-100 px-2 py-1">{post.commentCount ?? 0} comments</span>
        <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">👍 {post.upCount ?? 0}</span>
        <span className="rounded-full bg-red-50 px-2 py-1 text-red-700">👎 {post.downCount ?? 0}</span>
      </div>
      <Link href={`/blog/${post.slug}`} className="mt-4 inline-flex text-sm font-semibold text-[#c5161d] hover:text-[#a91218]">
        Read article
      </Link>
    </article>
  )
}
