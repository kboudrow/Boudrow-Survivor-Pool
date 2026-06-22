import Link from 'next/link'
import type { Metadata } from 'next'
import { blogPosts } from '@/lib/blogPosts'

export const metadata: Metadata = {
  title: 'NFL Survivor Pool Blog | Survive Sunday',
  description: 'Survivor pool strategy, commissioner tips, rules explainers, and NFL pool guides.',
  alternates: {
    canonical: '/blog',
  },
}

export default function BlogPage() {
  const posts = [...blogPosts].sort((a, b) => {
    const pinnedSort = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pinnedSort) return pinnedSort
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#c5161d]">Survive Sunday Blog</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Strategy, rules, and commissioner help</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Practical articles for players trying to survive longer and commissioners trying to run cleaner NFL survivor pools.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {posts.map((post) => (
            <article key={post.slug} className={`rounded-lg border bg-white p-5 shadow-sm ${post.pinned ? 'border-blue-200 ring-1 ring-blue-100 md:col-span-3' : 'border-slate-200'}`}>
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                {post.pinned ? 'Pinned / ' : ''}{post.category} / Updated {post.publishedAt} / {post.readTime}
              </div>
              <h2 className="text-xl font-bold text-slate-950">
                <Link href={`/blog/${post.slug}`} className="hover:text-[#c5161d]">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm text-slate-600">{post.description}</p>
              <Link href={`/blog/${post.slug}`} className="mt-4 inline-flex text-sm font-semibold text-[#c5161d] hover:text-[#a91218]">
                Read article
              </Link>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-700">
          These guides are written for survivor-pool commissioners and players. For a live example of how the product presents picks and standings, visit the{' '}
          <Link href="/demo-league" className="font-semibold text-[#c5161d] hover:text-[#a91218]">public demo league</Link>.
        </div>
      </div>
    </main>
  )
}
