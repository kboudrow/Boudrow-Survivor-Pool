import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How It Works | Survive Sunday',
  description: 'Learn how to create, join, pick, lock, and survive in an NFL survivor pool.',
}

const steps = [
  {
    title: 'Create or join a pool',
    text: 'A pool is the group competition. The commissioner chooses its start week, mulligans, tie rule, deadline style, and access. Public pools can be found in search; private pools need an invite link and password. Valid joiners are added immediately—there is no approval queue.',
  },
  {
    title: 'Make weekly picks',
    text: 'Each entry—one independent chance to play—chooses an NFL team to win that week. A win keeps the entry alive. The same team cannot normally be used again, so every choice affects later weeks. A double-pick week requires two different teams instead of one.',
  },
  {
    title: 'Picks lock automatically',
    text: 'A saved pick can be changed until it locks. With a Sunday 1 PM ET deadline, all remaining choices lock then; any earlier game still locks at kickoff. With rolling locks, each team stays available until its own game starts. A locked pick is official.',
  },
  {
    title: 'Standings update from results',
    text: 'A loss uses one mulligan if the pool allows any; otherwise it eliminates the entry. Standings show which entries are alive or eliminated, mulligans remaining, weekly results, and the teams each entry has already used.',
  },
]

export default function HowItWorksPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#c5161d]">How it works</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Run an NFL survivor pool without spreadsheets</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Pick one NFL winner each week and stay alive as long as your entry can. Survive Sunday keeps that flow simple without chasing texts or maintaining a spreadsheet.
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
