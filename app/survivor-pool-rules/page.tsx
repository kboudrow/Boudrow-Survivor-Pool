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
    title: 'The basic format',
    body: 'An entry is one independent chance to play. It picks an NFL team to win each week. A win keeps the entry alive; a loss uses a mulligan if one is available or eliminates the entry if none remain.',
  },
  {
    title: 'No-repeat teams',
    body: 'Each entry can use an NFL team only once during the regular season. That makes long-term planning part of the game: using a heavy favorite now removes it from that entry’s later choices. Team history resets for the playoffs.',
  },
  {
    title: 'Pick deadlines',
    body: 'A saved pick remains editable until it locks. With rolling locks, each team locks at its game’s kickoff. With the fixed deadline, all remaining choices lock Sunday at 1:00 PM Eastern.',
  },
  {
    title: 'Thursday and early games',
    body: 'Thursday, Saturday, international, and other early games always lock at kickoff—even when the pool uses the Sunday deadline. No one can choose or change to a team after its game begins.',
  },
  {
    title: 'NFL ties and mulligans',
    body: 'The commissioner chooses whether an official NFL tie counts as a win or a loss. A mulligan is one allowed loss: the entry stays alive but has one fewer mulligan remaining.',
  },
  {
    title: 'Multiple entries',
    body: 'A commissioner can let one person own several entries. Each entry is a separate chance with its own picks, used-team history, mulligans, standings row, and elimination status.',
  },
  {
    title: 'Double-pick weeks',
    body: 'A double-pick week requires every alive entry to submit two different teams. Each pick is graded separately, and every losing or missing pick uses a mulligan or moves the entry closer to elimination.',
  },
  {
    title: 'Missed picks',
    body: 'If an entry has no pick when its deadline passes, the missing pick counts as a loss. It uses a mulligan when one remains; otherwise the entry is eliminated.',
  },
]

export default function SurvivorPoolRulesPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-wide text-[#c5161d]">Commissioner resource</p>
        <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-normal text-slate-950">NFL survivor pool rules that prevent arguments later</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
          New to survivor pools? The goal is simple: pick a winning NFL team each week and keep your entry alive. These are the rules Survive Sunday enforces.
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
              'Mulligans allowed',
              'Double-pick weeks',
              'Multiple-entry limit',
              'Missed picks count as losses',
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
