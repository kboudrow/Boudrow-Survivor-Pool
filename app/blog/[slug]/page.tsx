import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getPublicBlogPost, getRelatedPublicBlogPosts } from '@/lib/blogDb'

export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const post = await getPublicBlogPost(slug)
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
  const post = await getPublicBlogPost(slug)
  if (!post) notFound()

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.survivesunday.com').replace(/\/$/, '')
  const relatedPosts = await getRelatedPublicBlogPosts(post)
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.updatedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: `${siteUrl}/blog/${post.slug}`,
    author: {
      '@type': 'Organization',
      name: 'Survive Sunday',
      url: siteUrl,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Survive Sunday',
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/survive-sunday-logo.png`,
      },
    },
  }

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <div className="mx-auto max-w-6xl">
        <Link href="/blog" className="text-sm font-semibold text-[#c5161d] hover:text-[#a91218]">
          Back to blog
        </Link>

        <header className="mt-5 rounded-xl border border-red-950 bg-[#090b0f] p-5 text-white shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#c5161d] px-2.5 py-1 uppercase tracking-wide text-white">{post.category}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">Updated {post.publishedAt}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">{post.readTime}</span>
          </div>
          <h1 className="mt-4 max-w-4xl text-3xl font-extrabold tracking-normal sm:text-5xl">{post.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200">{post.description}</p>
          <div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            Written by {post.authorName || 'Survive Sunday'} for football fans, survivor-pool players, and commissioners who want clearer rules and fewer Sunday headaches.
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_300px] lg:items-start">
          <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">In this article</h2>
            <nav className="mt-3 grid gap-2">
              {post.sections.map((section) => (
                <Link key={section.heading} href={`#${headingId(section.heading)}`} className="text-sm font-medium leading-5 text-slate-700 hover:text-[#c5161d]">
                  {section.heading}
                </Link>
              ))}
            </nav>
          </aside>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <div className="space-y-10">
              {post.sections.map((section, index) => (
                <section key={section.heading} id={headingId(section.heading)} className="scroll-mt-28">
                  <h2 className="text-2xl font-extrabold tracking-normal text-slate-950">{section.heading}</h2>
                  <div className="mt-4 space-y-4 text-base leading-7 text-slate-700">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>

                  {index === 0 && (
                    <Callout
                      title="Quick read"
                      text="If you are sending rules to a group, write the deadline, tie rule, missed-pick rule, and entry limit before anyone makes a pick."
                    />
                  )}

                  {post.category === 'Templates' && section.body[0] && (
                    <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Copy-ready rule language</div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{section.body[0]}</p>
                    </div>
                  )}
                </section>
              ))}
            </div>
          </article>

          <aside className="grid gap-4">
            <div className="rounded-lg border border-[#d2ad5b]/50 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Commissioner note</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The best leagues feel fair because the rules are boringly clear. Decide once, write it down, and let the system enforce it.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Related reading</h2>
              <div className="mt-3 grid gap-3">
                {relatedPosts.map((related) => (
                  <Link key={related.slug} href={`/blog/${related.slug}`} className="rounded-md border border-slate-200 bg-slate-50 p-3 hover:bg-white">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#c5161d]">{related.category}</div>
                    <div className="mt-1 text-sm font-bold leading-5 text-slate-950">{related.title}</div>
                  </Link>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <section className="mt-8 rounded-xl border border-[#d2ad5b]/50 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Ready to run a cleaner league?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Create a survivor pool, invite your group, and keep picks, locks, standings, and rule disputes organized.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
                Create League
              </Link>
              <Link href="/demo-league" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
                View Demo
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function headingId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function Callout({ title, text }: { title: string; text: string }) {
  return (
    <div className="mt-5 rounded-lg border border-[#d2ad5b]/50 bg-[#fffaf0] p-4">
      <div className="text-sm font-bold text-slate-950">{title}</div>
      <p className="mt-1 text-sm leading-6 text-slate-700">{text}</p>
    </div>
  )
}
