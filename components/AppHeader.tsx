import Image from 'next/image'
import Link from 'next/link'
import { AuthNav } from '@/components/AuthNav'

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 w-full overflow-x-clip border-b border-red-900/50 bg-[#090b0f]/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5 ring-1 ring-red-700/70 sm:h-12 sm:w-12">
            <Image src="/survive-sunday-logo.png" alt="Survive Sunday" width={48} height={48} priority className="h-10 w-10 object-contain sm:h-11 sm:w-11" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-base font-extrabold tracking-normal text-white sm:text-lg">Survive Sunday</span>
            <span className="hidden text-xs font-medium text-slate-300 sm:block">Pick one. Win. Survive.</span>
          </span>
        </Link>

        <nav className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto">
          <AuthNav />
        </nav>
      </div>
    </header>
  )
}
