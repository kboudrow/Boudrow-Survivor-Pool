import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How It Works | Survive Sunday',
  description: 'Learn how to create, join, pick, lock, and survive in an NFL survivor pool.',
}

const steps = [
  {
    title: 'Create or join a pool',
    text: 'Commissioners create a pool, choose rules, activate it, and invite players. Players can join public pools by search or private pools by invite.',
  },
  {
    title: 'Make weekly picks',
    text: 'Each player picks a team for the week. Once a team is used, it cannot be used again in the same pool.',
  },
  {
    title: 'Picks lock automatically',
    text: 'Pools can use rolling kickoff locks or a fixed weekly deadline. Locked picks become official final picks.',
  },
  {
    title: 'Standings update from results',
    text: 'Wins, losses, pushes, strikes, and eliminations are tracked so everyone can see where the pool stands.',
  },
]

export default function HowItWorksPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#c5161d]">How it works</p>
        <h1 className="mt-2 text-4xl font-extrabold tracking-normal text-slate-950">Run an NFL survivor pool without spreadsheets</h1>
        <p className="mt-3 max-w-2xl text-slate-600">
          Survive Sunday keeps the core flow simple: create a league, invite players, make picks, lock them, and track standings.
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
        </div>
      </div>
    </main>
  )
}
