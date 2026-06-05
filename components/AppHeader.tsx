import Image from 'next/image'
import Link from 'next/link'

const navItems = [
  { href: '/pools', label: 'My Pools' },
  { href: '/join/search', label: 'Join Pool' },
  { href: '/pools/new', label: 'Create Pool' },
  { href: '/archives', label: 'Archives' },
  { href: '/profile', label: 'Profile' },
]

export function AppHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 shadow-sm backdrop-blur">
      <div className="mx-auto flex min-h-16 max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/pools" className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 ring-1 ring-orange-200">
            <Image src="/football.png" alt="Survivor Pool" width={30} height={30} priority />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-lg font-extrabold tracking-normal text-slate-950">Survivor Pool</span>
            <span className="hidden text-xs font-medium text-slate-500 sm:block">NFL picks, locks, and standings</span>
          </span>
        </Link>

        <nav className="flex max-w-full items-center gap-1 overflow-x-auto">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
