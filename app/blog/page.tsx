import Link from 'next/link'
import type { Metadata } from 'next'
import { blogPosts } from '@/lib/blogPosts'

export const metadata: Metadata = {
  title: 'NFL Survivor Pool Blog | Survivor Pool',
  description: 'Survivor pool strategy, commissioner tips, rules explainers, and NFL pool guides.',
}

export default function BlogPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Survivor Pool Blog</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Strategy, rules, and commissioner help</h1>
          <p className="mt-3 max-w-2xl text-slate-600">
            Practical articles for players trying to survive longer and commissioners trying to run cleaner NFL survivor pools.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {blogPosts.map((post) => (
            <article key={post.slug} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-500">
                {post.publishedAt} / {post.readTime}
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
      </div>
    </main>
  )
}
