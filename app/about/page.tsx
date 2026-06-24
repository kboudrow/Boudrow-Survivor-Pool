import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About | Survive Sunday',
  description: 'Learn why Survive Sunday exists, what the survivor pool app handles, and how it keeps pools organized without spreadsheets.',
  alternates: {
    canonical: '/about',
  },
}

const values = [
  {
    title: 'Built for commissioners',
    text: 'The product is designed around the boring work commissioners usually carry: reminders, locked picks, used teams, standings, disputes, and year-to-year setup.',
  },
  {
    title: 'Clear for players',
    text: 'Players should know what they picked, when it locks, which teams are still available, and where they stand without asking in a group text.',
  },
  {
    title: 'Not a betting platform',
    text: 'Survive Sunday does not accept wagers, hold money, manage prize pools, calculate payouts, or operate as a sportsbook.',
  },
]

export default function AboutPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <section className="rounded-xl border border-red-950 bg-[#090b0f] p-6 text-white shadow-sm sm:p-8">
          <p className="text-sm font-bold uppercase tracking-wide text-[#d2ad5b]">About Survive Sunday</p>
          <h1 className="mt-2 max-w-3xl text-3xl font-extrabold tracking-normal sm:text-5xl">
            Survivor pools are fun. Running the spreadsheet is not.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
            Survive Sunday exists to make NFL survivor pools easier to run for friends, families, offices, and recurring pools. The goal is simple: fewer manual mistakes, fewer arguments, and a cleaner Sunday experience for everyone.
          </p>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {values.map((value) => (
            <article key={value.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">{value.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{value.text}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-2xl font-bold text-slate-950">What the app handles</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              'Public and private pool setup',
              'Invite links and password-protected pools',
              'Automatic pick locks and weekly deadlines',
              'No-repeat team enforcement',
              'Multiple entries per member when allowed',
              'Standings, strikes, eliminations, and history',
              'Commissioner controls for pool management',
              'Run-it-back setup for future seasons',
            ].map((item) => (
              <div key={item} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
                {item}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-[#d2ad5b]/50 bg-white p-5 text-sm leading-6 text-slate-700 shadow-sm sm:p-6">
          <h2 className="text-xl font-bold text-slate-950">Support and transparency</h2>
          <p className="mt-2">
            Survive Sunday is actively maintained. Questions, bug reports, and commissioner feedback can be sent to{' '}
            <a href="mailto:survivesunday1@gmail.com" className="font-semibold text-[#c5161d] hover:text-[#a91218]">survivesunday1@gmail.com</a>.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/blog" className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">Read the blog</Link>
            <Link href="/faq" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-800 hover:bg-white">Read FAQ</Link>
          </div>
        </section>
      </div>
    </main>
  )
}


