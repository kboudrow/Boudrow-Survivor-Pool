import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { blogPosts, getBlogPost } from '@/lib/blogPosts'

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) return {}

  return {
    title: `${post.title} | Survivor Pool`,
    description: post.description,
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) notFound()

  return (
    <main className="min-h-[70vh] bg-white px-4 py-10">
      <article className="mx-auto max-w-3xl">
        <Link href="/blog" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
          Back to blog
        </Link>

        <header className="mt-5 border-b border-slate-200 pb-6">
          <div className="text-sm font-medium text-slate-500">
            {post.publishedAt} / {post.readTime}
          </div>
          <h1 className="mt-3 text-4xl font-extrabold tracking-normal text-slate-950">{post.title}</h1>
          <p className="mt-4 text-lg text-slate-600">{post.description}</p>
        </header>

        <div className="mt-8 space-y-8">
          {post.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-2xl font-bold text-slate-950">{section.heading}</h2>
              <div className="mt-3 space-y-4 text-slate-700">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-lg border border-blue-100 bg-blue-50 p-5">
          <h2 className="text-lg font-bold text-slate-950">Ready to run a cleaner pool?</h2>
          <p className="mt-2 text-sm text-slate-700">Create a survivor pool, invite your group, and keep picks, locks, and standings organized.</p>
          <Link href="/pools/new" className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
            Create a Pool
          </Link>
        </div>
      </article>
    </main>
  )
}
