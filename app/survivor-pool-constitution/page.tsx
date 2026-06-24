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
  ['1. Pool Format', 'Each entry must select one eligible NFL team each required pick slot. If the selected team wins, the entry survives. If the selected team loses, ties, or does not play, the result follows the pool settings below.'],
  ['2. Eligibility', 'Only invited or approved members may participate. Commissioners may remove entries before the pool starts if a member joined by mistake or violates pool rules.'],
  ['3. Entry Rules', 'If multiple entries are allowed, each entry is independent. Used teams, picks, strikes, standings, and elimination status are tracked separately for every entry.'],
  ['4. Pick Deadlines', 'Picks must be submitted before the pool deadline or before the selected game locks. Games that have already started are not eligible picks.'],
  ['5. No Repeat Teams', 'An entry may not select the same NFL team more than once during the season unless the commissioner explicitly announces a different rule before the pool starts.'],
  ['6. Missed Picks', 'A missed pick after the deadline counts as a loss or strike unless the commissioner defines a different rule before the season.'],
  ['7. Tie Rules', 'The commissioner must state before the season whether a tied NFL game counts as a win, loss, or push for survivor purposes.'],
  ['8. Double-Pick Weeks', 'If double-pick weeks are used, every active entry must submit two valid picks for that week. Both picks must survive for the entry to avoid a strike unless the commissioner defines otherwise.'],
  ['9. Eliminations', 'An entry is eliminated after it reaches the strike limit set by the commissioner. Eliminated entries may continue to view pool standings but cannot submit future picks.'],
  ['10. Winner Determination', 'The winner is the last remaining active entry. If multiple entries remain after the final configured week, the commissioner should use the announced tiebreaker or split-title rule.'],
  ['11. Commissioner Authority', 'The commissioner may correct obvious administrative errors, but rule changes after the pool starts should be avoided unless every affected member agrees.'],
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
            Fill in your pool name, start week, deadline type, strike limit, tie rule, double-pick weeks, multiple-entry limit, and any prize or bragging-rights language your group uses.
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

