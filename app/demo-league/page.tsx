import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Demo Pool | Survive Sunday',
  description: 'Explore a public sample survivor pool with standings, weekly pick distribution, used teams, and commissioner-style rules.',
  alternates: {
    canonical: '/demo-league',
  },
}

const teams = [
  { code: 'BAL', name: 'Baltimore Ravens', picks: 4, result: 'pending', color: 'bg-slate-400' },
  { code: 'BUF', name: 'Buffalo Bills', picks: 3, result: 'win', color: 'bg-emerald-600' },
  { code: 'KC', name: 'Kansas City Chiefs', picks: 2, result: 'pending', color: 'bg-slate-400' },
  { code: 'DET', name: 'Detroit Lions', picks: 2, result: 'loss', color: 'bg-red-600' },
  { code: 'SF', name: 'San Francisco 49ers', picks: 1, result: 'pending', color: 'bg-slate-400' },
]

const standings = [
  { member: 'Alex R.', pick: 'Buffalo Bills', record: '1-0', strikes: 0, status: 'Alive' },
  { member: 'Dana M.', pick: 'Baltimore Ravens', record: '0-0', strikes: 0, status: 'Alive' },
  { member: 'Chris L.', pick: 'Detroit Lions', record: '0-1', strikes: 1, status: 'Alive' },
  { member: 'Sam P.', pick: 'Kansas City Chiefs', record: '0-0', strikes: 0, status: 'Alive' },
]

export default function DemoPoolPage() {
  const totalPicks = teams.reduce((sum, team) => sum + team.picks, 0)

  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <section className="grid gap-6 rounded-xl border border-red-950 bg-[#090b0f] p-5 text-white shadow-sm md:grid-cols-[auto_1fr] md:items-center sm:p-8">
          <Image src="/survive-sunday-logo.png" alt="Survive Sunday" width={110} height={110} className="h-24 w-24 object-contain" />
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[#d2ad5b]">Public demo</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-normal sm:text-5xl">Sample survivor pool dashboard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
              This read-only example shows how a pool can present rules, weekly picks, standings, and team distribution without making visitors create an account first.
            </p>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <Stat label="Entries" value="12" detail="10 unique members" />
          <Stat label="Strikes allowed" value="1" detail="Tie counts as loss" />
          <Stat label="Pick deadline" value="Sunday" detail="1:00 PM ET" />
          <Stat label="Double-pick weeks" value="2" detail="Weeks 8 and 14" />
        </section>

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">Week 1 pick distribution</h2>
            <p className="mt-1 text-sm text-slate-600">Percentages unlock after the pool deadline so players cannot copy each other early.</p>
            <div className="mt-5 space-y-4">
              {teams.map((team) => {
                const pct = Math.round((team.picks / totalPicks) * 100)
                return (
                  <div key={team.code}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-900">{team.name}</span>
                      <span className="text-slate-600">{team.picks} picks / {pct}%</span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full ${team.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">Sample standings</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-4">Member</th>
                    <th className="py-2 pr-4">Pick</th>
                    <th className="py-2 pr-4">Record</th>
                    <th className="py-2 pr-4">Strikes</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {standings.map((row) => (
                    <tr key={row.member}>
                      <td className="py-3 pr-4 font-semibold text-slate-950">{row.member}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.pick}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.record}</td>
                      <td className="py-3 pr-4 text-slate-700">{row.strikes}</td>
                      <td className="py-3">
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold text-slate-950">Why this matters</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            A commissioner should not have to prove who picked what, when a game locked, or whether a team was already used. Survive Sunday keeps that record in one place so the pool can focus on the fun part.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/how-it-works" className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 font-semibold text-slate-800 hover:bg-white">How it works</Link>
            <Link href="/blog" className="rounded-md bg-[#c5161d] px-4 py-2 font-semibold text-white hover:bg-[#a91218]">Read guides</Link>
          </div>
        </section>
      </div>
    </main>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-slate-950">{value}</div>
      <div className="mt-1 text-sm text-slate-600">{detail}</div>
    </div>
  )
}



