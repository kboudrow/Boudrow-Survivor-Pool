import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact | Survive Sunday',
  description: 'Contact Survive Sunday for support, account questions, pool setup help, payments, privacy, and advertising questions.',
  alternates: {
    canonical: '/contact',
  },
}

export default function ContactPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-red-950 bg-[#090b0f] px-5 py-8 text-white sm:px-8">
          <p className="text-sm font-bold uppercase tracking-wide text-[#d2ad5b]">Contact</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-normal sm:text-4xl">Need help with Survive Sunday?</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
            Send questions about pool setup, accounts, payments, privacy, or site feedback. We are building this to make survivor pools easier to run, so real-world notes are welcome.
          </p>
        </div>

        <div className="grid gap-0 md:grid-cols-[1fr_0.85fr]">
          <div className="p-5 sm:p-8">
            <h2 className="text-xl font-bold text-slate-950">Email support</h2>
            <p className="mt-2 text-slate-600">
              The best way to reach us is by email:
            </p>
            <a href="mailto:survivesunday1@gmail.com" className="mt-4 inline-flex rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">
              survivesunday1@gmail.com
            </a>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Info title="Pool help" text="Questions about creating pools, invites, deadlines, picks, or admin tools." />
              <Info title="Account help" text="Sign-in, profile, privacy, or data questions." />
              <Info title="Payment help" text="Pool activation, Stripe checkout, duplicate payments, or billing issues." />
              <Info title="Site feedback" text="Bug reports, confusing screens, or ideas that would make the app easier." />
            </div>
          </div>

          <aside className="border-t border-slate-200 bg-slate-50 p-5 sm:p-8 md:border-l md:border-t-0">
            <h2 className="text-lg font-bold text-slate-950">Before you write</h2>
            <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
              <li>Include the pool name if the question is about a specific league.</li>
              <li>Use the email address tied to your account when possible.</li>
              <li>Do not send passwords, payment card numbers, or private access codes.</li>
            </ul>
            <div className="mt-6 rounded-lg border border-[#d2ad5b]/40 bg-white p-4 text-sm text-slate-700">
              Survive Sunday is a pool-management tool, not a sportsbook or payout service.
            </div>
            <Link href="/faq" className="mt-5 inline-flex text-sm font-semibold text-[#c5161d] hover:text-[#a91218]">
              Read the FAQ
            </Link>
          </aside>
        </div>
      </section>
    </main>
  )
}

function Info({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{text}</p>
    </div>
  )
}
