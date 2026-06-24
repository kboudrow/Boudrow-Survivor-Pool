import Link from 'next/link'

export const metadata = {
  title: 'Terms of Service | Survive Sunday',
  description: 'Terms for using Survive Sunday to create, join, and manage NFL survivor pools.',
}

const lastUpdated = 'Last updated: June 6, 2026'

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-24 text-xl font-semibold text-slate-950">
      {children}
    </h2>
  )
}

export default function TermsPage() {
  return (
    <main className="min-h-[70vh] bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-slate-950">Terms of Service</h1>
            <p className="mt-2 text-sm text-slate-500">{lastUpdated}</p>
          </div>
          <Link href="/" className="text-sm underline text-slate-700">
            Back to home
          </Link>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="mb-2 font-semibold">Plain-English summary</div>
          <ul className="list-disc space-y-1 pl-5">
            <li>Survive Sunday helps groups manage picks, locks, standings, and pool history.</li>
            <li>The service is not a sportsbook, fantasy sports operator, gambling platform, escrow service, or prize administrator.</li>
            <li>These terms are a practical template and should be reviewed by an attorney before serious public launch.</li>
          </ul>
        </div>

        <nav className="mt-8 rounded-lg border border-slate-200 p-4">
          <div className="mb-2 font-semibold">Contents</div>
          <ul className="space-y-1 text-sm text-slate-700">
            <li><a className="underline" href="#acceptance">1. Acceptance</a></li>
            <li><a className="underline" href="#eligibility">2. Eligibility and accounts</a></li>
            <li><a className="underline" href="#service">3. The service</a></li>
            <li><a className="underline" href="#no-gambling">4. No gambling, wagers, or payouts</a></li>
            <li><a className="underline" href="#conduct">5. Acceptable use</a></li>
            <li><a className="underline" href="#content">6. User content and pool data</a></li>
            <li><a className="underline" href="#third-parties">7. Third-party services</a></li>
            <li><a className="underline" href="#ip">8. Intellectual property</a></li>
            <li><a className="underline" href="#privacy">9. Privacy</a></li>
            <li><a className="underline" href="#availability">10. Availability and changes</a></li>
            <li><a className="underline" href="#termination">11. Suspension or termination</a></li>
            <li><a className="underline" href="#disclaimers">12. Disclaimers</a></li>
            <li><a className="underline" href="#liability">13. Limitation of liability</a></li>
            <li><a className="underline" href="#law">14. Governing law</a></li>
            <li><a className="underline" href="#contact">15. Contact</a></li>
          </ul>
        </nav>

        <SectionTitle id="acceptance">1. Acceptance</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          By accessing or using Survive Sunday, including any related pages, tools, pool dashboards, or account features
          (the &quot;Service&quot;), you agree to these Terms of Service (the &quot;Terms&quot;). If you do not agree, do not use the Service.
        </p>

        <SectionTitle id="eligibility">2. Eligibility and accounts</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          You must be able to form a legally binding contract in your jurisdiction to use the Service. You are responsible for your
          account credentials and for activity under your account. You agree to provide accurate information and keep your account
          information current.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          The Service is not intended for children under 13. If you are using the Service on behalf of an organization, office, or
          group, you represent that you have authority to do so.
        </p>

        <SectionTitle id="service">3. The service</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Survive Sunday provides tools for creating, joining, and managing NFL-style survivor pools. Features may include pool
          settings, public or private pool discovery, invite links, pick submission, pick locks, double-pick weeks, standings, admin
          controls, profile settings, archived history, and &quot;run it back&quot; cloning for future seasons.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          Pool creators and admins are responsible for configuring their pools and communicating rules to their participants. Pool
          settings may lock after the configured start week to protect fairness.
        </p>

        <SectionTitle id="no-gambling">4. No gambling, wagers, or payouts</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          The Service is for pool administration, scoring, picks, standings, and entertainment. It does not accept wagers, hold
          player funds, manage prize pools, calculate payouts, transfer money between participants, or administer contests with
          monetary or material prizes.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          You may not use the Service to operate illegal gambling, betting, fantasy sports contests with paid prizes, sweepstakes,
          lotteries, raffles, or other regulated contests. If your group separately chooses to collect money or award prizes outside
          the Service, that activity is solely your responsibility and must comply with applicable laws and third-party payment rules.
        </p>

        <SectionTitle id="conduct">5. Acceptable use</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">You agree not to misuse the Service, including by:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 leading-7 text-slate-700">
          <li>Trying to access another person&apos;s account, pool, private data, or admin controls without permission.</li>
          <li>Using bots, scraping, credential stuffing, or automated access that degrades or abuses the Service.</li>
          <li>Uploading malicious code or attempting to interfere with security, availability, or data integrity.</li>
          <li>Harassing, impersonating, doxxing, or abusing other users.</li>
          <li>Creating pool names, notes, or other content that is unlawful, hateful, abusive, deceptive, or infringing.</li>
          <li>Using the Service in violation of applicable laws or third-party platform terms.</li>
        </ul>

        <SectionTitle id="content">6. User content and pool data</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          You may submit pool names, notes, settings, profile names, picks, comments, or similar information (&quot;User Content&quot;). You
          retain ownership of your User Content, but grant us a limited license to host, store, reproduce, display, and process it
          as needed to operate, secure, improve, and support the Service.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          Pool picks, standings, membership, and history may be visible to pool participants, pool creators, and admins as needed for
          the Service to function. You are responsible for the content and pool rules you create.
        </p>

        <SectionTitle id="third-parties">7. Third-party services</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          The Service may rely on third-party providers such as Supabase for authentication and database services, Vercel for hosting,
          Google for OAuth sign-in or advertising services, and other infrastructure or security providers. Your
          use of those features may also be subject to the third parties&apos; terms and policies.
        </p>

        <SectionTitle id="ip">8. Intellectual property</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Survive Sunday and its software, design, branding, and content are owned by us or our licensors. You may not copy, modify,
          distribute, sell, or reverse engineer the Service except as allowed by law or with our permission.
        </p>
        <p className="mt-3 leading-7 text-slate-700">
          Survive Sunday is not affiliated with, sponsored by, or endorsed by the National Football League, NFL, or any NFL club. Team
          names, abbreviations, logos, and related marks are used for identification and remain the property of their respective owners.
        </p>

        <SectionTitle id="privacy">9. Privacy</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Our <Link className="underline" href="/privacy">Privacy Policy</Link> explains how we collect, use, and share information.
          Our <Link className="underline" href="/cookies">Cookie Policy</Link> explains how cookies and similar technologies may be used.
        </p>

        <SectionTitle id="availability">10. Availability and changes</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          We may update, suspend, remove, or change features at any time. We do not guarantee that the Service will always be
          available, uninterrupted, secure, or error-free. Schedules, game data, scores, deadlines, and standings may be delayed,
          inaccurate, or affected by third-party data, manual updates, or technical issues.
        </p>

        <SectionTitle id="termination">11. Suspension or termination</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          You may stop using the Service at any time. We may suspend, restrict, or terminate access if we reasonably believe you have
          violated these Terms, created risk for users or the Service, or used the Service for prohibited activity.
        </p>

        <SectionTitle id="disclaimers">12. Disclaimers</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          The Service is provided &quot;as is&quot; and &quot;as available.&quot; To the maximum extent permitted by law, we disclaim all warranties,
          express or implied, including warranties of merchantability, fitness for a particular purpose, title, and non-infringement.
        </p>

        <SectionTitle id="liability">13. Limitation of liability</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          To the maximum extent permitted by law, we will not be liable for indirect, incidental, special, consequential, exemplary,
          or punitive damages, or for lost profits, lost data, lost goodwill, pool disputes, prize disputes, or claims related to
          separate arrangements among participants.
        </p>

        <SectionTitle id="law">14. Governing law</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          These Terms are governed by the laws applicable in the jurisdiction where the Service operator is established, without
          regard to conflict-of-law rules. Some jurisdictions may give you rights that cannot be waived by these Terms.
        </p>

        <SectionTitle id="contact">15. Contact</SectionTitle>
        <p className="mt-3 leading-7 text-slate-700">
          Questions about these Terms can be sent to: <span className="font-medium">survivesunday1@gmail.com</span>
        </p>

        <div className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          This document is a general template and not legal advice. Have an attorney review it before relying on it for a public launch.
        </div>
      </div>
    </main>
  )
}

