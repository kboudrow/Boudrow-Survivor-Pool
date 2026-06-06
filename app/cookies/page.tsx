import Link from 'next/link'

export const metadata = {
  title: 'Cookie Policy | Survivor Pool',
  description: 'Cookie Policy for Survivor Pool authentication, payments, analytics, and advertising.',
}

const lastUpdated = 'Last updated: June 6, 2026'

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-xl font-semibold text-slate-950">
      {children}
    </h2>
  )
}

export default function CookiesPage() {
  return (
    <main className="min-h-[70vh] bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">Cookie Policy</h1>
            <p className="mt-2 text-sm text-slate-500">{lastUpdated}</p>
          </div>
          <Link href="/" className="text-sm underline text-slate-700">
            Back to home
          </Link>
        </div>

        <p className="leading-7 text-slate-700">
          This Cookie Policy explains how Survivor Pool may use cookies, local storage, pixels, tags, web beacons, and similar
          technologies. It should be read with our <Link className="underline" href="/privacy">Privacy Policy</Link>.
        </p>

        <SectionTitle id="what">1. What cookies are</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Cookies are small files or identifiers stored on your browser or device. Similar technologies can remember settings, keep
          you signed in, measure usage, detect fraud, or support advertising.
        </p>

        <SectionTitle id="types">2. Types of cookies we may use</SectionTitle>
        <ul className="mt-3 list-disc space-y-1 pl-5 leading-7 text-slate-700">
          <li><span className="font-medium">Strictly necessary cookies:</span> used for sign-in, sessions, security, routing, and core site functionality.</li>
          <li><span className="font-medium">Preference cookies:</span> used to remember choices such as UI settings or account preferences if enabled.</li>
          <li><span className="font-medium">Analytics cookies:</span> used to understand page views, feature usage, and performance if analytics tools are enabled.</li>
          <li><span className="font-medium">Advertising cookies:</span> used by ad networks such as Google AdSense or similar providers if ads are enabled.</li>
          <li><span className="font-medium">Payment and fraud-prevention technologies:</span> used by payment providers such as Stripe during checkout.</li>
        </ul>

        <SectionTitle id="third-parties">3. Third-party cookies</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Third-party providers may set or read cookies and similar technologies when you use features they support, such as Google
          sign-in, ads, payment checkout, hosting, analytics, security, or fraud prevention. Their use of these technologies is
          governed by their own policies.
        </p>

        <SectionTitle id="ads">4. Advertising cookies</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          If we enable ads, Google or other ad partners may use cookies, web beacons, IP addresses, and device identifiers to serve
          ads, limit ad frequency, measure ad performance, detect invalid traffic, and provide aggregated reports. Depending on your
          settings and applicable law, ads may be personalized or non-personalized.
        </p>

        <SectionTitle id="choices">5. Your choices</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          You can control cookies through your browser settings. Blocking necessary cookies may prevent sign-in, checkout, picks, or
          other core features from working. If advertising or analytics tools are enabled, you may also have choices through those
          providers&apos; privacy settings and consent tools.
        </p>

        <SectionTitle id="changes">6. Changes</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          We may update this Cookie Policy as our use of cookies, analytics, ads, or service providers changes.
        </p>

        <SectionTitle id="contact">7. Contact</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Questions about this Cookie Policy can be sent to: <span className="font-medium">[add contact email]</span>
        </p>

        <div className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          This document is a general template and not legal advice. Have an attorney review it before relying on it for a public launch.
        </div>
      </div>
    </main>
  )
}
