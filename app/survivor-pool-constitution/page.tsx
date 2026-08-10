import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Survivor Pool Constitution Template | Survive Sunday',
  description: 'A copy-and-paste survivor pool constitution template for commissioners covering eligibility, deadlines, missed picks, ties, double-pick weeks, and winners.',
  alternates: {
    canonical: '/survivor-pool-constitution',
  },
}

const clauses = [
  ['1. Pool Format', 'Each entry is one independent chance to play and must choose one eligible NFL team for every required pick. A win keeps the entry alive. A loss uses a mulligan if one remains or eliminates the entry if none remain.'],
  ['2. Joining', 'Public pools can be joined without a password. Private pools require the invite link and password. Valid joiners are added immediately; there is no approval queue. Commissioners may remove mistaken entries before the pool starts.'],
  ['3. Multiple Entries', 'When multiple entries are allowed, each entry has its own picks, used teams, mulligans, standings row, and alive or eliminated status.'],
  ['4. Pick Deadlines', 'A saved pick may be changed until it locks. Under rolling locks, a team locks at its game’s kickoff. Under the fixed deadline, all remaining teams lock Sunday at 1:00 PM Eastern; earlier games still lock at kickoff.'],
  ['5. No Repeat Teams', 'An entry may not select the same NFL team more than once during the regular season. If playoffs are included, used-team history resets when the playoffs begin.'],
  ['6. Missed Picks', 'A missing pick at the deadline counts as a loss. It uses a mulligan when one remains; otherwise the entry is eliminated.'],
  ['7. NFL Ties', 'Before the pool starts, the commissioner chooses whether an official NFL tie counts as a win or a loss. That rule applies to every entry.'],
  ['8. Double-Pick Weeks', 'Every alive entry must submit two different teams during a double-pick week. Each pick is saved, locked, and graded separately.'],
  ['9. Eliminations', 'An entry is eliminated when its total losses exceed its allowed mulligans. Eliminated entries may view the pool and standings but cannot submit future picks.'],
  ['10. Winner and Wipeout Rule', 'The winner is the last remaining alive entry. If every remaining entry would be eliminated in the same week, those entries stay alive for the next week; their losing teams still count as used.'],
  ['11. Commissioner Corrections', 'Competitive rules lock after the first kickoff. A commissioner may correct a disputed pick with a recorded reason; the correction is logged and the affected standings are recalculated.'],
]

export default function SurvivorPoolConstitutionPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-wide text-[#c5161d]">Template</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Survivor pool constitution template</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
          Commissioners can adapt this language before the season starts. The goal is not legal formality; it is making the pool rules clear enough that Sunday arguments do not become the main event.
        </p>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            {clauses.map(([title, body]) => (
              <section key={title}>
                <h2 className="text-lg font-bold text-slate-950">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
              </section>
            ))}
          </div>
        </div>

        <section className="mt-8 rounded-lg border border-[#d2ad5b]/40 bg-white p-5 text-sm leading-6 text-slate-700">
          <h2 className="text-xl font-bold text-slate-950">Before you send it</h2>
          <p className="mt-2">
            Fill in your pool name, start week, deadline type, mulligans allowed, NFL tie rule, double-pick weeks, multiple-entry limit, and any prize or bragging-rights language your group uses.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/survivor-pool-rules" className="rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">Read Rules Guide</Link>
          <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">Create a Pool</Link>
        </div>
      </div>
    </main>
  )
}
