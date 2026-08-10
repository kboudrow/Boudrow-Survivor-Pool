import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="min-h-[60vh] px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-bold uppercase tracking-wide text-[#c5161d]">Page not found</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-950">We couldn&apos;t find that page.</h1>
        <p className="mt-3 text-slate-600">The link may be old, incomplete, or for a pool you cannot access.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/pools" className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">My Pools</Link>
          <Link href="/" className="rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">Home</Link>
        </div>
      </div>
    </main>
  )
}
