// app/terms/page.tsx
import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service | Survivor Pool',
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="text-xl font-semibold mt-10 mb-3 scroll-mt-24">
      {children}
    </h2>
  )
}

export default function TermsPage() {
  const lastUpdated = 'Last updated: __________'

  return (
    <main className="min-h-[70vh] px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between gap-3 mb-8">
          <div>
            <h1 className="text-3xl font-bold">Terms of Service</h1>
            <p className="text-sm text-gray-500 mt-2">{lastUpdated}</p>
          </div>
          <Link href="/" className="text-sm underline text-gray-700">
            Back to home
          </Link>
        </div>

        <div className="border rounded-lg p-4 bg-gray-50 text-sm text-gray-700">
          <div className="font-semibold mb-2">Quick summary (not legal advice)</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>This site helps groups run survivor pools. It’s not betting software and isn’t affiliated with the NFL.</li>
            <li>You’re responsible for your account and anything you submit.</li>
            <li>We may update the service and these terms over time.</li>
            <li>If you misuse the service, we can restrict or terminate access.</li>
          </ul>
        </div>

        <nav className="mt-8 border rounded-lg p-4">
          <div className="font-semibold mb-2">Contents</div>
          <ul className="text-sm text-gray-700 space-y-1">
            <li><a className="underline" href="#acceptance">1. Acceptance of these Terms</a></li>
            <li><a className="underline" href="#eligibility">2. Eligibility & Your Account</a></li>
            <li><a className="underline" href="#service">3. The Service</a></li>
            <li><a className="underline" href="#conduct">4. Acceptable Use</a></li>
            <li><a className="underline" href="#content">5. Your Content</a></li>
            <li><a className="underline" href="#privacy">6. Privacy</a></li>
            <li><a className="underline" href="#changes">7. Changes to the Service or Terms</a></li>
            <li><a className="underline" href="#termination">8. Termination</a></li>
            <li><a className="underline" href="#disclaimers">9. Disclaimers</a></li>
            <li><a className="underline" href="#liability">10. Limitation of Liability</a></li>
            <li><a className="underline" href="#law">11. Governing Law</a></li>
            <li><a className="underline" href="#contact">12. Contact</a></li>
          </ul>
        </nav>

        <SectionTitle id="acceptance">1. Acceptance of these Terms</SectionTitle>
        <p className="text-gray-700 leading-7">
          By accessing or using Survivor Pool (the “Service”), you agree to these Terms of Service (the “Terms”).
          If you do not agree, do not use the Service.
        </p>

        <SectionTitle id="eligibility">2. Eligibility & Your Account</SectionTitle>
        <p className="text-gray-700 leading-7">
          You must be able to form a legally binding contract in your jurisdiction to use the Service.
          You are responsible for maintaining the confidentiality of your login credentials and for all activity that
          occurs under your account. You agree to provide accurate information and keep it up to date.
        </p>

        <SectionTitle id="service">3. The Service</SectionTitle>
        <p className="text-gray-700 leading-7">
          The Service provides tools to create and manage NFL-style survivor pools (including pool configuration,
          pick submission, lock timing, standings, and results). The Service is not a sportsbook, not a payment processor,
          and not intended for wagering. Any prizes, buy-ins, or payments are arranged entirely by pool participants and
          are outside the Service.
        </p>
        <p className="text-gray-700 leading-7 mt-3">
          Survivor Pool is not affiliated with or endorsed by the NFL or its clubs. Team names and logos may be used for
          identification only and remain the property of their respective owners.
        </p>

        <SectionTitle id="conduct">4. Acceptable Use</SectionTitle>
        <p className="text-gray-700 leading-7">
          You agree not to misuse the Service. This includes, but is not limited to:
        </p>
        <ul className="list-disc pl-5 text-gray-700 leading-7 space-y-1 mt-2">
          <li>Attempting to access another user’s account or private data.</li>
          <li>Reverse engineering, scraping, or automated access that degrades the Service.</li>
          <li>Uploading malicious code or attempting to interfere with security.</li>
          <li>Harassment, impersonation, or abusive conduct toward others.</li>
          <li>Using the Service in violation of applicable laws.</li>
        </ul>

        <SectionTitle id="content">5. Your Content</SectionTitle>
        <p className="text-gray-700 leading-7">
          You may provide content such as pool names, notes, and picks (“User Content”). You retain ownership of your User
          Content. You grant us a limited license to host, store, reproduce, and display your User Content solely to
          operate and improve the Service.
        </p>
        <p className="text-gray-700 leading-7 mt-3">
          You represent that you have the rights to submit your User Content and that it does not violate any laws or
          third-party rights.
        </p>

        <SectionTitle id="privacy">6. Privacy</SectionTitle>
        <p className="text-gray-700 leading-7">
          Our Privacy Policy explains how we collect and use information. By using the Service, you agree to our{' '}
          <Link className="underline" href="/privacy">Privacy Policy</Link>.
        </p>

        <SectionTitle id="changes">7. Changes to the Service or Terms</SectionTitle>
        <p className="text-gray-700 leading-7">
          We may modify the Service, add or remove features, or update these Terms. If we make material changes, we may
          provide notice within the Service or by other reasonable means. Continued use of the Service after changes
          become effective means you accept the updated Terms.
        </p>

        <SectionTitle id="termination">8. Termination</SectionTitle>
        <p className="text-gray-700 leading-7">
          You may stop using the Service at any time. We may suspend or terminate access if we reasonably believe you have
          violated these Terms, created risk for other users, or attempted to compromise the Service.
        </p>

        <SectionTitle id="disclaimers">9. Disclaimers</SectionTitle>
        <p className="text-gray-700 leading-7">
          The Service is provided “as is” and “as available.” We do not guarantee the Service will be uninterrupted,
          secure, or error-free. Results and schedules may be subject to data sources, timing, and processing delays.
        </p>

        <SectionTitle id="liability">10. Limitation of Liability</SectionTitle>
        <p className="text-gray-700 leading-7">
          To the maximum extent permitted by law, we will not be liable for any indirect, incidental, special,
          consequential, or punitive damages, or any loss of profits or data, arising out of or related to your use of the
          Service.
        </p>

        <SectionTitle id="law">11. Governing Law</SectionTitle>
        <p className="text-gray-700 leading-7">
          These Terms are governed by the laws applicable in the jurisdiction where the Service operator is established,
          without regard to conflict of law principles. Where required, disputes will be handled in the appropriate courts
          of that jurisdiction.
        </p>

        <SectionTitle id="contact">12. Contact</SectionTitle>
        <p className="text-gray-700 leading-7">
          Questions about these Terms can be directed to: <span className="font-medium">[add contact email]</span>
        </p>

        <div className="mt-10 text-xs text-gray-500">
          This document is a general template and not legal advice.
        </div>
      </div>
    </main>
  )
}
