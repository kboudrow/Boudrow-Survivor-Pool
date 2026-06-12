import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { AdSlot } from '@/components/AdSlot'
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
    title: `${post.title} | Survive Sunday`,
    description: post.description,
    alternates: {
      canonical: `/blog/${post.slug}`,
    },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.updatedAt,
    },
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params
  const post = getBlogPost(slug)
  if (!post) notFound()
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://survivorpool.app').replace(/\/$/, '')
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.updatedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: `${siteUrl}/blog/${post.slug}`,
  }

  return (
    <main className="min-h-[70vh] bg-white px-4 py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <article className="mx-auto max-w-3xl">
        <Link href="/blog" className="text-sm font-semibold text-blue-700 hover:text-blue-900">
          Back to blog
        </Link>

        <header className="mt-5 border-b border-slate-200 pb-6">
          <div className="text-sm font-medium text-slate-500">
            {post.category} / {post.publishedAt} / {post.readTime}
          </div>
          <h1 className="mt-3 text-4xl font-extrabold tracking-normal text-slate-950">{post.title}</h1>
          <p className="mt-4 text-lg text-slate-600">{post.description}</p>
        </header>

        <AdSlot
          slot={process.env.NEXT_PUBLIC_AD_SLOT_ARTICLE_TOP}
          label="Article top advertisement"
          className="mt-8"
          minHeight="110px"
        />

        <div className="mt-8 space-y-8">
          {post.sections.map((section, index) => (
            <div key={section.heading} className="space-y-8">
              <section>
                <h2 className="text-2xl font-bold text-slate-950">{section.heading}</h2>
                <div className="mt-3 space-y-4 text-slate-700">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
              {index === 1 && (
                <AdSlot
                  slot={process.env.NEXT_PUBLIC_AD_SLOT_ARTICLE_INLINE}
                  label="Article in-content advertisement"
                  format="fluid"
                  layout="in-article"
                  className="my-2"
                  minHeight="250px"
                />
              )}
            </div>
          ))}
        </div>

        <AdSlot
          slot={process.env.NEXT_PUBLIC_AD_SLOT_ARTICLE_BOTTOM}
          label="Article bottom advertisement"
          className="mt-10"
          minHeight="120px"
        />

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
