// app/privacy/page.tsx
import Link from 'next/link'

export const metadata = {
  title: 'Privacy Policy | Survivor Pool',
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-xl font-semibold mt-10 mb-3 scroll-mt-24">
      {children}
    </h2>
  )
}

export default function PrivacyPage() {
  const lastUpdated = 'Last updated: __________'

  return (
    <main className="min-h-[70vh] px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Privacy Policy</h1>
            <p className="text-sm text-gray-500 mt-2">{lastUpdated}</p>
          </div>
          <Link href="/" className="text-sm underline text-gray-700">
            Back to home
          </Link>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 text-sm text-gray-700">
          <div className="font-semibold mb-2">In plain English</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>We use your info to run the product (account, pools, picks, and standings).</li>
            <li>We don’t show your email to other users.</li>
            <li>We don’t sell your personal information.</li>
            <li>In the future, we may add analytics—this policy includes a section for that.</li>
          </ul>
        </div>

        <nav className="mt-8 border rounded-lg p-4">
          <div className="font-semibold mb-2">Contents</div>
          <ul className="text-sm text-gray-700 space-y-1">
            <li><a className="underline" href="#info-we-collect">1. Information We Collect</a></li>
            <li><a className="underline" href="#how-we-use">2. How We Use Information</a></li>
            <li><a className="underline" href="#sharing">3. How We Share Information</a></li>
            <li><a className="underline" href="#public-private">4. What’s Visible to Others</a></li>
            <li><a className="underline" href="#cookies">5. Cookies & Similar Technologies</a></li>
            <li><a className="underline" href="#analytics">6. Analytics (If Enabled in the Future)</a></li>
            <li><a className="underline" href="#retention">7. Data Retention</a></li>
            <li><a className="underline" href="#your-rights">8. Your Choices & Rights</a></li>
            <li><a className="underline" href="#security">9. Security</a></li>
            <li><a className="underline" href="#children">10. Children’s Privacy</a></li>
            <li><a className="underline" href="#changes">11. Changes to this Policy</a></li>
            <li><a className="underline" href="#contact">12. Contact</a></li>
          </ul>
        </nav>

        <SectionTitle id="info-we-collect">1. Information We Collect</SectionTitle>
        <p className="text-gray-700 leading-7">
          We collect information to provide and improve the Service.
        </p>
        <ul className="list-disc pl-5 text-gray-700 leading-7 space-y-1 mt-2">
          <li><span className="font-medium">Account information:</span> your email address and authentication identifiers.</li>
          <li><span className="font-medium">Profile information:</span> a display name/username you choose.</li>
          <li><span className="font-medium">Pool data:</span> pools you create or join, membership, settings, and results.</li>
          <li><span className="font-medium">Pick activity:</span> picks and status needed to operate standings and history.</li>
          <li><span className="font-medium">Technical data:</span> device/browser information and basic logs for security and reliability.</li>
        </ul>

        <SectionTitle id="how-we-use">2. How We Use Information</SectionTitle>
        <ul className="list-disc pl-5 text-gray-700 leading-7 space-y-1">
          <li>Provide core functionality (accounts, pool creation, picks, locks, standings, and history).</li>
          <li>Maintain safety and prevent abuse (security monitoring, rate limiting, fraud prevention).</li>
          <li>Support and troubleshooting (responding to issues and improving reliability).</li>
        </ul>

        <SectionTitle id="sharing">3. How We Share Information</SectionTitle>
        <p className="text-gray-700 leading-7">
          We do not sell your personal information. We may share information:
        </p>
        <ul className="list-disc pl-5 text-gray-700 leading-7 space-y-1 mt-2">
          <li><span className="font-medium">With service providers</span> that help us run the Service (hosting, databases, email delivery for auth).</li>
          <li><span className="font-medium">For legal reasons</span> if required to comply with applicable law or valid legal process.</li>
          <li><span className="font-medium">To protect rights and safety</span> where appropriate (e.g., preventing abuse or attacks).</li>
        </ul>

        <SectionTitle id="public-private">4. What’s Visible to Others</SectionTitle>
        <p className="text-gray-700 leading-7">
          Pool functionality requires some information to be visible to other pool participants.
        </p>
        <ul className="list-disc pl-5 text-gray-700 leading-7 space-y-1 mt-2">
          <li>Your <span className="font-medium">display name/username</span> may appear in standings and pool member lists.</li>
          <li>Your <span className="font-medium">pool participation</span> and <span className="font-medium">status</span> (e.g., alive/eliminated) may be visible within pools you join.</li>
          <li>Your <span className="font-medium">email address is not shown</span> to other users.</li>
        </ul>

        <SectionTitle id="cookies">5. Cookies & Similar Technologies</SectionTitle>
        <p className="text-gray-700 leading-7">
          We use cookies or similar technologies to keep you signed in and to enable core site functionality. These are
          generally required for the Service to work.
        </p>

        <SectionTitle id="analytics">6. Analytics (If Enabled in the Future)</SectionTitle>
        <p className="text-gray-700 leading-7">
          We currently do not use third-party analytics tools. If we enable analytics in the future, we may collect usage
          information (such as page views, feature usage, and performance metrics) to improve the Service. When enabled,
          we will update this policy and (where required) provide choices regarding analytics cookies.
        </p>

        <SectionTitle id="retention">7. Data Retention</SectionTitle>
        <p className="text-gray-700 leading-7">
          We retain information for as long as needed to operate the Service, comply with legal obligations, resolve
          disputes, and enforce our agreements. Pool history may be retained to provide season-to-season records and “run
          it back” functionality.
        </p>

        <SectionTitle id="your-rights">8. Your Choices & Rights</SectionTitle>
        <p className="text-gray-700 leading-7">
          Depending on your jurisdiction, you may have rights to access, correct, or delete your personal information.
          You can typically update your display name and account settings in your profile. If you want to request account
          deletion or data export, contact: <span className="font-medium">[add contact email]</span>.
        </p>

        <SectionTitle id="security">9. Security</SectionTitle>
        <p className="text-gray-700 leading-7">
          We take reasonable measures to protect your information. No system is 100% secure, so we cannot guarantee
          absolute security.
        </p>

        <SectionTitle id="children">10. Children’s Privacy</SectionTitle>
        <p className="text-gray-700 leading-7">
          The Service is not intended for children. If you believe a child has provided personal information, contact:
          <span className="font-medium"> [add contact email]</span>.
        </p>

        <SectionTitle id="changes">11. Changes to this Policy</SectionTitle>
        <p className="text-gray-700 leading-7">
          We may update this Privacy Policy from time to time. We will revise the “Last updated” date and may provide
          additional notice for material changes.
        </p>

        <SectionTitle id="contact">12. Contact</SectionTitle>
        <p className="text-gray-700 leading-7">
          Questions about this policy can be sent to: <span className="font-medium">[add contact email]</span>
        </p>

        <div className="mt-10 text-xs text-gray-500">
          This document is a general template and not legal advice.
        </div>
      </div>
    </main>
  )
}
