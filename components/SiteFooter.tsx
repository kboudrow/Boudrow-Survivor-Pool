import Link from 'next/link'

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-white px-6 py-8 text-sm text-gray-600">
      <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="mb-2 font-semibold">Survive Sunday</div>
          <p>Pool management for friends, families, and offices. No payouts, no sportsbook angle, just rules, picks, and bragging rights.</p>
        </div>
        <div>
          <div className="mb-2 font-semibold">Product</div>
          <ul className="space-y-1">
            <li><Link href="/how-it-works" className="underline">How it works</Link></li>
            <li><Link href="/demo-league" className="underline">Demo league</Link></li>
            <li><Link href="/about" className="underline">About</Link></li>
            <li><Link href="/faq" className="underline">FAQ</Link></li>
            <li><Link href="/blog" className="underline">Blog</Link></li>
            <li><Link href="/contact" className="underline">Contact</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-2 font-semibold">Resources</div>
          <ul className="space-y-1">
            <li><Link href="/survivor-pool-rules" className="underline">Survivor pool rules</Link></li>
            <li><Link href="/survivor-pool-constitution" className="underline">Pool constitution</Link></li>
          </ul>
        </div>
        <div>
          <div className="mb-2 font-semibold">Legal</div>
          <ul className="mb-3 space-y-1">
            <li><Link href="/terms" className="underline">Terms</Link></li>
            <li><Link href="/privacy" className="underline">Privacy</Link></li>
            <li><Link href="/cookies" className="underline">Cookies</Link></li>
          </ul>
          <p className="text-xs">Not affiliated with or endorsed by the NFL or its clubs. Team names/logos are used for identification only.</p>
        </div>
      </div>
      <div className="mx-auto mt-6 max-w-5xl text-xs text-gray-500">&copy; {new Date().getFullYear()} Survive Sunday. All rights reserved.</div>
    </footer>
  )
}
