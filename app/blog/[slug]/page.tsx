import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { BlogShareAndComments } from '@/components/BlogShareAndComments'
import { getPublicBlogPost, getPublicBlogPosts, getRelatedPublicBlogPosts } from '@/lib/blogDb'
import { SITE_URL, absoluteUrl } from '@/lib/site'

export const revalidate = 300

type Props = {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  try {
    const posts = await getPublicBlogPosts()
    return posts.map((post) => ({ slug: post.slug }))
  } catch {
    return []
  }
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

  const relatedPosts = await getRelatedPublicBlogPosts(post)
  const visibleSections = post.sections.filter((section) => section.heading !== 'Article')
  const showContents = visibleSections.length > 1
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.updatedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: absoluteUrl(`/blog/${post.slug}`),
    author: {
      '@type': 'Organization',
      name: 'Survive Sunday',
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Survive Sunday',
      logo: {
        '@type': 'ImageObject',
        url: absoluteUrl('/survive-sunday-logo.png'),
      },
    },
  }

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
      <div className="mx-auto max-w-7xl">
        <Link href="/blog" className="text-sm font-semibold text-[#c5161d] hover:text-[#a91218]">
          Back to blog
        </Link>

        <header className="mt-5 rounded-xl border border-red-950 bg-[#090b0f] p-5 text-white shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#c5161d] px-2.5 py-1 uppercase tracking-wide text-white">{post.category}</span>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-200">Updated {post.publishedAt}</span>
          </div>
          <h1 className="mt-4 max-w-4xl text-3xl font-extrabold tracking-normal sm:text-5xl">{post.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200">{post.description}</p>
          {post.heroImageUrl && (
            <div className="mt-6 overflow-hidden rounded-lg border border-white/10 bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={post.heroImageUrl} alt="" className="max-h-[520px] w-full object-contain" />
            </div>
          )}
          <div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4 text-sm leading-6 text-slate-200">
            By: {post.authorName || 'Survive Sunday'}
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,920px)_260px] lg:items-start lg:justify-center">
          {showContents ? (
            <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">In this article</h2>
              <nav className="mt-3 grid gap-2">
                {visibleSections.map((section) => (
                  <Link key={section.heading} href={`#${headingId(section.heading)}`} className="text-sm font-medium leading-5 text-slate-700 hover:text-[#c5161d]">
                    {section.heading}
                  </Link>
                ))}
              </nav>
            </aside>
          ) : (
            <aside className="hidden lg:block" />
          )}

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-9">
            <div className="space-y-10">
              {post.sections.map((section) => (
                <section key={section.heading} id={headingId(section.heading)} className="scroll-mt-28">
                  {section.heading !== 'Article' && <h2 className="text-2xl font-extrabold tracking-normal text-slate-950">{section.heading}</h2>}
                  <div className={`${section.heading === 'Article' ? '' : 'mt-4'} space-y-5 text-[17px] leading-8 text-slate-700`}>
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>

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
                The best pools feel fair because the rules are boringly clear. Decide once, write it down, and let the system enforce it.
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

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">Useful tools</h2>
              <div className="mt-3 grid gap-2 text-sm font-semibold">
                <Link href="/survivor-pool-rules" className="rounded-md bg-slate-50 p-3 text-slate-800 hover:bg-white">Survivor pool rules</Link>
                <Link href="/survivor-pool-constitution" className="rounded-md bg-slate-50 p-3 text-slate-800 hover:bg-white">Pool constitution</Link>
                <Link href="/demo-league" className="rounded-md bg-slate-50 p-3 text-slate-800 hover:bg-white">Demo pool</Link>
              </div>
            </div>
          </aside>
        </div>

        <BlogShareAndComments
          postSlug={post.slug}
          title={post.title}
          description={post.description}
          shareUrl={absoluteUrl(`/blog/${post.slug}`)}
          commentsFirst
        />

        <section className="mt-8 rounded-xl border border-[#d2ad5b]/50 bg-white p-5 shadow-sm sm:p-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-950">Ready to run a cleaner pool?</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Create a survivor pool, invite your group, and keep picks, locks, standings, and rule disputes organized.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
                Create Pool
              </Link>
              <Link href="/blog" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-white">
                Read more articles
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

