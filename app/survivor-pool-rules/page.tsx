import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'NFL Survivor Pool Rules Guide | Survive Sunday',
  description: 'A commissioner-friendly guide to NFL survivor pool rules, deadlines, tie settings, double-pick weeks, multiple entries, and forgotten picks.',
  alternates: {
    canonical: '/survivor-pool-rules',
  },
}

const sections = [
  {
    title: 'The basic survivor pool format',
    body: 'Each entry picks one NFL team for the week. If the team wins, that entry survives. If the team loses, ties, or misses a pick, the result depends on the rules the commissioner selected before the season.',
  },
  {
    title: 'No-repeat teams',
    body: 'Most survivor pools do not allow an entry to use the same team twice. That makes long-term planning part of the game: using a heavy favorite now may leave you with fewer options later.',
  },
  {
    title: 'Pick deadlines',
    body: 'Commissioners can use a fixed weekly deadline or rolling kickoff locks. With rolling locks, each game locks when it kicks off. With a fixed deadline, all available picks lock at the configured pool deadline.',
  },
  {
    title: 'Thursday and early games',
    body: 'Early games should lock before kickoff even if the main weekly deadline is later. This prevents someone from waiting to see part of a game before submitting or changing a pick.',
  },
  {
    title: 'Ties, strikes, and mulligans',
    body: 'Some pools count ties as wins, some as losses, and some as pushes. Strikes or mulligans let a player survive one or more bad weeks before being eliminated.',
  },
  {
    title: 'Multiple entries',
    body: 'A pool can allow members to enter more than once. Each entry should have its own picks, used teams, standings row, and elimination status so the competition stays clean.',
  },
  {
    title: 'Double-pick weeks',
    body: 'Double-pick weeks require every active entry to submit two teams. They add strategy and make larger pools more likely to finish on schedule.',
  },
  {
    title: 'Forgotten picks',
    body: 'The fairest approach is to define missed-pick rules before the season starts. Many pools treat a forgotten pick as a loss or strike once the deadline passes.',
  },
]

export default function SurvivorPoolRulesPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-wide text-[#c5161d]">Commissioner resource</p>
        <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-normal text-slate-950">NFL survivor pool rules that prevent arguments later</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
          A good survivor pool is mostly about clarity. Set the rules before Week 1, make the deadlines obvious, and make sure every player understands how picks, ties, strikes, and eliminations work.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-950">{section.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{section.body}</p>
            </section>
          ))}
        </div>

        <section className="mt-8 rounded-xl border border-[#d2ad5b]/40 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Recommended pre-season checklist</h2>
          <ul className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {[
              'Start week',
              'Pick deadline',
              'Tie rule',
              'Strike limit',
              'Double-pick weeks',
              'Multiple-entry limit',
              'Forgotten-pick rule',
              'Winner determination',
            ].map((item) => (
              <li key={item} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-semibold">{item}</li>
            ))}
          </ul>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">Create a Pool</Link>
          <Link href="/survivor-pool-constitution" className="rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">View Constitution Template</Link>
        </div>
      </div>
    </main>
  )
}
