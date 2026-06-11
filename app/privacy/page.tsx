import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | Survivor Pool',
  description: 'Privacy Policy for Survivor Pool accounts, picks, payments, ads, cookies, and pool history.',
}

const lastUpdated = 'Last updated: June 6, 2026'

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-xl font-semibold text-slate-950">
      {children}
    </h2>
  )
}

export default function PrivacyPage() {
  return (
    <main className="min-h-[70vh] bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">Privacy Policy</h1>
            <p className="mt-2 text-sm text-slate-500">{lastUpdated}</p>
          </div>
          <Link href="/" className="text-sm underline text-slate-700">
            Back to home
          </Link>
        </div>

        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
          <div className="mb-2 font-semibold">Plain-English summary</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>We use account, profile, pool, pick, payment, and technical data to run the app.</li>
            <li>Your email is not shown to other pool members.</li>
            <li>Your display name, pool membership, picks, status, and standings may be visible inside pools you join.</li>
            <li>We do not sell your personal information.</li>
            <li>Ads, analytics, or similar tools may use cookies or identifiers if enabled.</li>
          </ul>
        </div>

        <nav className="mt-8 rounded-lg border border-slate-200 p-4">
          <div className="mb-2 font-semibold">Contents</div>
          <ul className="space-y-1 text-sm text-slate-700">
            <li><a className="underline" href="#scope">1. Scope</a></li>
            <li><a className="underline" href="#info-we-collect">2. Information we collect</a></li>
            <li><a className="underline" href="#how-we-use">3. How we use information</a></li>
            <li><a className="underline" href="#visible">4. What other users can see</a></li>
            <li><a className="underline" href="#sharing">5. How we share information</a></li>
            <li><a className="underline" href="#payments">6. Payments</a></li>
            <li><a className="underline" href="#ads">7. Ads, analytics, and cookies</a></li>
            <li><a className="underline" href="#retention">8. Data retention</a></li>
            <li><a className="underline" href="#choices">9. Your choices and rights</a></li>
            <li><a className="underline" href="#security">10. Security</a></li>
            <li><a className="underline" href="#children">11. Children&apos;s privacy</a></li>
            <li><a className="underline" href="#changes">12. Changes</a></li>
            <li><a className="underline" href="#contact">13. Contact</a></li>
          </ul>
        </nav>

        <SectionTitle id="scope">1. Scope</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          This Privacy Policy explains how Survivor Pool collects, uses, discloses, and protects information when you use the Service.
          It applies to our website, app pages, account features, pool dashboards, payment activation flows, and related services.
        </p>

        <SectionTitle id="info-we-collect">2. Information we collect</SectionTitle>
        <ul className="mt-3 list-disc space-y-1 pl-5 leading-7 text-slate-700">
          <li><span className="font-medium">Account information:</span> email address, authentication identifiers, login provider, and account timestamps.</li>
          <li><span className="font-medium">Profile information:</span> display name, username, first name, last name, and profile settings you provide.</li>
          <li><span className="font-medium">Pool information:</span> pools you create or join, pool names, visibility, settings, member lists, admin roles, invite data, and archived history.</li>
          <li><span className="font-medium">Pick and standings data:</span> weekly picks, draft picks, final picks, pick locks, used teams, wins, losses, pushes, strikes, eliminations, and related admin actions.</li>
          <li><span className="font-medium">Payment information:</span> payment status, Stripe checkout session identifiers, payment intent identifiers, amount, currency, and related payment logs. We do not store full card numbers.</li>
          <li><span className="font-medium">Communications:</span> messages you send for support or account requests.</li>
          <li><span className="font-medium">Technical information:</span> IP address, device and browser information, logs, security events, page requests, and similar data used for reliability and security.</li>
        </ul>

        <SectionTitle id="how-we-use">3. How we use information</SectionTitle>
        <ul className="mt-3 list-disc space-y-1 pl-5 leading-7 text-slate-700">
          <li>Provide accounts, sign-in, pool creation, joining, picks, locks, standings, history, and admin features.</li>
          <li>Process pool activation payments and confirm paid/active status.</li>
          <li>Maintain security, prevent abuse, troubleshoot issues, and protect the Service.</li>
          <li>Respond to support, account, privacy, and payment questions.</li>
          <li>Improve usability, content, performance, and reliability.</li>
          <li>Comply with legal obligations and enforce our Terms.</li>
        </ul>

        <SectionTitle id="visible">4. What other users can see</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Pool functionality requires some information to be visible to other pool participants and admins.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-7 text-slate-700">
          <li>Your display name or username may appear in member lists, standings, and history.</li>
          <li>Your pool participation, alive/eliminated status, record, strikes, and picks may be visible within pools you join, depending on pool rules and timing.</li>
          <li>Pool creators and admins may see information needed to manage the pool, including member status and pick controls.</li>
          <li>Your email address is not intentionally shown to other pool members.</li>
        </ul>

        <SectionTitle id="sharing">5. How we share information</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">We do not sell personal information. We may share information:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-7 text-slate-700">
          <li><span className="font-medium">With service providers</span> that help operate the Service, such as Supabase, Vercel, Stripe, Google, email/auth providers, analytics, ads, security, and support tools.</li>
          <li><span className="font-medium">Within pools</span> as necessary to show members, standings, picks, and history.</li>
          <li><span className="font-medium">For legal, safety, or compliance reasons</span> if required by law, legal process, fraud prevention, security, or enforcement of our Terms.</li>
          <li><span className="font-medium">In a business transfer</span> such as a merger, acquisition, financing, or sale of assets, subject to appropriate safeguards.</li>
        </ul>

        <SectionTitle id="payments">6. Payments</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Payments are processed by Stripe or another third-party payment provider. We receive limited payment-related information,
          such as whether a checkout session was paid, transaction identifiers, amount, and currency. Your use of the payment flow is
          also subject to the payment provider&apos;s privacy policy and terms.
        </p>

        <SectionTitle id="ads">7. Ads, analytics, and cookies</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          We use cookies and similar technologies for authentication and core functionality. We may also use analytics or advertising
          services, including Google AdSense or similar ad networks. These services may use cookies, web beacons, IP addresses, device
          identifiers, and similar technologies to provide ads, measure performance, prevent fraud, limit ad frequency, and generate
          aggregated reports.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          See our <Link className="underline" href="/cookies">Cookie Policy</Link> for more information. You can also review Google&apos;s
          information about ad cookies and choices through Google&apos;s privacy and advertising settings.
        </p>

        <SectionTitle id="retention">8. Data retention</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          We retain information for as long as needed to operate the Service, maintain pool history, provide &quot;run it back&quot; features,
          comply with legal and tax obligations, resolve disputes, prevent abuse, and enforce agreements. Some archived pool and pick
          history may be retained so users can view past results.
        </p>

        <SectionTitle id="choices">9. Your choices and rights</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          You can update certain account and profile information from your profile page. Depending on your location, you may have rights
          to request access, correction, deletion, portability, restriction, or objection regarding personal information. You may also
          have rights to opt out of certain data sharing or targeted advertising where applicable.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          To make a privacy request, contact: <span className="font-medium">boudrowkevin@gmail.com</span>. We may need to verify your
          identity before completing certain requests.
        </p>

        <SectionTitle id="security">10. Security</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          We use reasonable administrative, technical, and organizational safeguards to protect information. No system is completely
          secure, and we cannot guarantee absolute security.
        </p>

        <SectionTitle id="children">11. Children&apos;s privacy</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          The Service is not intended for children under 13, and we do not knowingly collect personal information from children under
          13. If you believe a child has provided personal information, contact us so we can review and delete it where appropriate.
        </p>

        <SectionTitle id="changes">12. Changes</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          We may update this Privacy Policy from time to time. We will update the &quot;Last updated&quot; date and may provide additional
          notice for material changes.
        </p>

        <SectionTitle id="contact">13. Contact</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Questions about this Privacy Policy can be sent to: <span className="font-medium">boudrowkevin@gmail.com</span>
        </p>

        <div className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          This document is a general template and not legal advice. Have an attorney review it before relying on it for a public launch.
        </div>
      </div>
    </main>
  )
}
