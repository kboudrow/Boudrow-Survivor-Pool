import Image from 'next/image'
import Link from 'next/link'
import { AuthNav } from '@/components/AuthNav'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-red-900/50 bg-[#090b0f]/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white/5 ring-1 ring-red-700/70">
            <Image src="/survive-sunday-logo.png" alt="Survive Sunday" width={48} height={48} priority className="h-11 w-11 object-contain" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-extrabold tracking-normal text-white">Survive Sunday</span>
            <span className="hidden text-xs font-medium text-slate-300 sm:block">Pick one. Win. Survive.</span>
          </span>
        </Link>

        <nav className="flex max-w-full items-center gap-1 overflow-x-auto">
          <AuthNav />
        </nav>
      </div>
    </header>
  )
}
