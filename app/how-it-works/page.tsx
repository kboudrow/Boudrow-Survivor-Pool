import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How It Works | Survive Sunday',
  description: 'Learn how to create, join, pick, lock, and survive in an NFL survivor pool.',
}

const steps = [
  {
    title: 'Create or join a pool',
    text: 'Commissioners create a pool, choose the start week, strike limit, tie rule, deadline style, visibility, member limit, and whether multiple entries are allowed. Players can find public pools in search or join private pools with an invite link and password.',
  },
  {
    title: 'Make weekly picks',
    text: 'Each active entry picks a team for the week. Used teams are tracked automatically, so an entry cannot reuse the same team later in the season. If the commissioner adds double-pick weeks, active entries submit two picks for those weeks.',
  },
  {
    title: 'Picks lock automatically',
    text: 'Pools can use rolling kickoff locks or a fixed weekly deadline. Early games lock when they start, and locked picks become official final picks so nobody has to argue about late changes.',
  },
  {
    title: 'Standings update from results',
    text: 'Wins, losses, pushes, strikes, eliminations, used teams, and entry status are tracked in one place. Commissioners can see what happened each week, while players can follow who is still alive.',
  },
]

export default function HowItWorksPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#c5161d]">How it works</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Run an NFL survivor pool without spreadsheets</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Survive Sunday keeps the core flow simple: create a league, invite players, make picks, lock them, and track standings without chasing texts or maintaining a spreadsheet.
        </p>

        <div className="mt-8 grid gap-4">
          {steps.map((step, index) => (
            <section key={step.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-bold text-[#c5161d]">Step {index + 1}</div>
              <h2 className="mt-1 text-xl font-bold text-slate-950">{step.title}</h2>
              <p className="mt-2 text-slate-600">{step.text}</p>
            </section>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">
            Create a Pool
          </Link>
          <Link href="/join/search" className="rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">
            Join a Pool
          </Link>
          <Link href="/survivor-pool-rules" className="rounded-md border border-slate-200 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-50">
            Read Rules Guide
          </Link>
        </div>
      </div>
    </main>
  )
}
