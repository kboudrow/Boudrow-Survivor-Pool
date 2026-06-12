import Link from 'next/link'
import type { Metadata } from 'next'
import { AdSlot } from '@/components/AdSlot'
import { blogPosts } from '@/lib/blogPosts'

export const metadata: Metadata = {
  title: 'NFL Survivor Pool Blog | Survive Sunday',
  description: 'Survivor pool strategy, commissioner tips, rules explainers, and NFL pool guides.',
  alternates: {
    canonical: '/blog',
  },
}

export default function BlogPage() {
  const posts = [...blogPosts].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Survive Sunday Blog</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Strategy, rules, and commissioner help</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Practical articles for players trying to survive longer and commissioners trying to run cleaner NFL survivor pools.
          </p>
        </div>

        <AdSlot
          slot={process.env.NEXT_PUBLIC_AD_SLOT_BLOG_TOP}
          label="Blog top advertisement"
          className="mb-8"
          minHeight="110px"
        />

        <div className="grid gap-4 md:grid-cols-3">
          {posts.map((post) => (
            <article key={post.slug} className={`rounded-lg border bg-white p-5 shadow-sm ${post.pinned ? 'border-blue-200 ring-1 ring-blue-100 md:col-span-3' : 'border-slate-200'}`}>
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                {post.pinned ? 'Pinned / ' : ''}{post.category} / {post.publishedAt} / {post.readTime}
              </div>
              <h2 className="text-xl font-bold text-slate-950">
                <Link href={`/blog/${post.slug}`} className="hover:text-blue-700">
                  {post.title}
                </Link>
              </h2>
              <p className="mt-2 text-sm text-slate-600">{post.description}</p>
              <Link href={`/blog/${post.slug}`} className="mt-4 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-900">
                Read article
              </Link>
            </article>
          ))}
        </div>

        <AdSlot
          slot={process.env.NEXT_PUBLIC_AD_SLOT_BLOG_BOTTOM}
          label="Blog bottom advertisement"
          className="mt-8"
          minHeight="120px"
        />
      </div>
    </main>
  )
}
