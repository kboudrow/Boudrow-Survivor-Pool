import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Demo Pool | Survive Sunday',
  description: 'Preview a read-only survivor pool with standings, weekly pick distribution, and pool member views.',
  alternates: {
    canonical: '/demo-league',
  },
}

type Result = 'win' | 'loss' | 'push' | 'pending'

type Team = {
  abbr: string
  name: string
  logo: string
}

type EntryRow = {
  name: string
  entry: number
  alive: boolean
  strikesUsed: number
  strikesLeft: number
  eliminatedWeek?: number
  picks: Record<number, { team: Team; result: Result }>
}

const espnLogo = (abbr: string) => `https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${abbr.toLowerCase()}.png`

const teams: Record<string, Team> = {
  BAL: { abbr: 'BAL', name: 'Baltimore Ravens', logo: espnLogo('BAL') },
  BUF: { abbr: 'BUF', name: 'Buffalo Bills', logo: espnLogo('BUF') },
  DAL: { abbr: 'DAL', name: 'Dallas Cowboys', logo: espnLogo('DAL') },
  DET: { abbr: 'DET', name: 'Detroit Lions', logo: espnLogo('DET') },
  KC: { abbr: 'KC', name: 'Kansas City Chiefs', logo: espnLogo('KC') },
  MIA: { abbr: 'MIA', name: 'Miami Dolphins', logo: espnLogo('MIA') },
  PHI: { abbr: 'PHI', name: 'Philadelphia Eagles', logo: espnLogo('PHI') },
  SF: { abbr: 'SF', name: 'San Francisco 49ers', logo: espnLogo('SF') },
}

const entries: EntryRow[] = [
  {
    name: 'Alex Rivera',
    entry: 1,
    alive: true,
    strikesUsed: 0,
    strikesLeft: 1,
    picks: {
      1: { team: teams.BUF, result: 'win' },
      2: { team: teams.DAL, result: 'win' },
      3: { team: teams.BAL, result: 'pending' },
    },
  },
  {
    name: 'Dana Miller',
    entry: 1,
    alive: true,
    strikesUsed: 0,
    strikesLeft: 1,
    picks: {
      1: { team: teams.KC, result: 'win' },
      2: { team: teams.SF, result: 'win' },
      3: { team: teams.BUF, result: 'pending' },
    },
  },
  {
    name: 'Chris Lee',
    entry: 1,
    alive: true,
    strikesUsed: 1,
    strikesLeft: 0,
    picks: {
      1: { team: teams.DET, result: 'loss' },
      2: { team: teams.PHI, result: 'win' },
      3: { team: teams.KC, result: 'pending' },
    },
  },
  {
    name: 'Sam Patel',
    entry: 1,
    alive: false,
    strikesUsed: 2,
    strikesLeft: 0,
    eliminatedWeek: 2,
    picks: {
      1: { team: teams.MIA, result: 'loss' },
      2: { team: teams.DET, result: 'loss' },
    },
  },
]

const week = 3
const activeEntries = entries.filter((entry) => entry.alive).length
const totalEntries = entries.length
const weekThreePicks = entries.flatMap((entry) => (entry.picks[week] ? [entry.picks[week]] : []))
const pickCounts = weekThreePicks.reduce<Record<string, number>>((acc, pick) => {
  acc[pick.team.abbr] = (acc[pick.team.abbr] || 0) + 1
  return acc
}, {})
const totalVisiblePicks = Math.max(weekThreePicks.length, 1)
const distribution = Object.entries(pickCounts)
  .map(([abbr, count]) => ({ team: teams[abbr], count, percentage: Math.round((count / totalVisiblePicks) * 100) }))
  .sort((a, b) => b.count - a.count || a.team.abbr.localeCompare(b.team.abbr))

export default function DemoPoolPage() {
  return (
    <main className="min-h-[70vh] bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/survive-sunday-logo.png" alt="Survive Sunday" width={54} height={54} className="h-12 w-12 object-contain" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Read-only demo</p>
              <h1 className="text-2xl font-bold text-slate-950">Office Survivor Demo</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/pools/new" className="rounded-md bg-[#c5161d] px-3 py-2 text-sm font-semibold text-white hover:bg-[#a91218]">
              Create Pool
            </Link>
            <Link href="/how-it-works" className="rounded-md bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-200">
              How It Works
            </Link>
          </div>
        </div>

        <div className="px-4 pt-3">
          <div className="flex items-center gap-2 border-b border-slate-200">
            <Tab label="Make Picks" />
            <Tab label="Standings" active />
            <Tab label="Pool Members (4)" />
          </div>
        </div>

        <div className="p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-700">Show through</label>
              <select className="rounded-md border border-slate-300 px-2 py-1 text-sm" defaultValue="3" aria-label="Demo week">
                <option value="1">Week 1</option>
                <option value="2">Week 2</option>
                <option value="3">Week 3</option>
              </select>
            </div>
            <span className="rounded-md bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">Demo data</span>
          </div>

          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-950">Entry Progression</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {activeEntries}/{totalEntries} entries still alive through Week {week}. Alive entries are listed first.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week {week} Picks Made</div>
                  <div className="mt-1 text-lg font-bold text-slate-950">3/3</div>
                  <div className="mt-0.5 text-xs text-slate-500">Teams stay hidden until each pick locks.</div>
                </div>
                <SurvivalChart alive={activeEntries} total={totalEntries} week={week} />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-slate-200 bg-white p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Entry</th>
                    <th className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</th>
                    <th className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Mulligans</th>
                    {[1, 2, 3].map((w) => (
                      <th key={w} className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <span className="block">W{w}</span>
                        <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">
                          {w === 1 ? '4/4' : w === 2 ? '3/4' : '3/4'} alive
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={`${entry.name}-${entry.entry}`} className={entry.alive ? 'align-top' : 'align-top bg-slate-50 text-slate-500'}>
                      <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit p-2">
                        <div className="flex min-w-[190px] items-center gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border bg-slate-100 text-xs font-semibold text-slate-600">
                            {entry.name.split(' ').map((piece) => piece[0]).join('').slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-950">{entry.name}</div>
                            <div className="text-xs text-slate-500">Entry {entry.entry}</div>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-slate-100 p-2">
                        {entry.alive ? (
                          <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">Alive</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Out W{entry.eliminatedWeek}</span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 p-2">
                        {entry.alive ? (
                          <div>
                            <span className="font-semibold text-slate-950">{entry.strikesLeft}</span>
                            <span className="ml-1 text-xs text-slate-500">left</span>
                            <div className="text-xs text-slate-500">{entry.strikesUsed} used</div>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      {[1, 2, 3].map((w) => (
                        <td key={`${entry.name}-${w}`} className="border-b border-slate-100 p-2">
                          {entry.eliminatedWeek && w > entry.eliminatedWeek ? (
                            <div className="h-10 rounded-md bg-slate-50" />
                          ) : entry.picks[w] ? (
                            <WeekPickCell pick={entry.picks[w]} />
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-slate-500">Week {week} Pick Distribution</div>
                <div className="mt-1 text-sm text-slate-600">Only visible picks are counted here.</div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-1 text-xs font-semibold text-white">
                <TeamLogo team={teams.BAL} size={16} />
                BAL x 1
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {distribution.map(({ team, count, percentage }) => (
                <div key={team.abbr} className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                      <TeamLogo team={team} size={22} />
                      <span className="truncate">{team.name}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-slate-700">
                      {percentage}% / {count}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-slate-300" style={{ width: `${Math.max(percentage, 3)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <details className="rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-900">Teams Still Available</summary>
            <div className="mt-2 text-sm text-slate-600">How many alive entries can still use each team based on visible locked pick history.</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {[teams.PHI, teams.DET, teams.MIA, teams.BAL].map((team, index) => {
                const available = [3, 2, 2, 1][index]
                const percentage = Math.round((available / activeEntries) * 100)
                return (
                  <div key={team.abbr} className="rounded-md border border-slate-200 bg-white p-2">
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="inline-flex min-w-0 items-center gap-2 font-medium">
                        <TeamLogo team={team} size={22} />
                        <span className="truncate">{team.name}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-slate-700">{available}/{activeEntries}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-slate-500" style={{ width: `${percentage}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        </div>
      </div>
    </main>
  )
}

function Tab({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span className={`border-b-2 px-3 py-2 text-sm ${active ? 'border-black font-semibold text-black' : 'border-transparent text-slate-600'}`}>
      {label}
    </span>
  )
}

function SurvivalChart({ alive, total, week }: { alive: number; total: number; week: number }) {
  const eliminated = Math.max(total - alive, 0)
  const alivePct = total ? Math.round((alive / total) * 100) : 0
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const aliveLength = total ? (alive / total) * circumference : 0

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <svg width="94" height="94" viewBox="0 0 94 94" className="shrink-0" aria-label={`${alive} of ${total} entries alive`}>
        <g transform="translate(47,47) rotate(-90)">
          <circle r={radius} cx="0" cy="0" fill="transparent" stroke="#e2e8f0" strokeWidth="14" />
          <circle
            r={radius}
            cx="0"
            cy="0"
            fill="transparent"
            stroke="#059669"
            strokeWidth="14"
            strokeDasharray={`${aliveLength} ${circumference - aliveLength}`}
          />
          {eliminated > 0 && (
            <circle
              r={radius}
              cx="0"
              cy="0"
              fill="transparent"
              stroke="#dc2626"
              strokeWidth="14"
              strokeDasharray={`${circumference - aliveLength} ${aliveLength}`}
              strokeDashoffset={-aliveLength}
            />
          )}
        </g>
        <text x="47" y="44" textAnchor="middle" className="fill-slate-950 text-[16px] font-bold">
          {alive}/{total}
        </text>
        <text x="47" y="59" textAnchor="middle" className="fill-slate-500 text-[10px] font-semibold">
          alive
        </text>
      </svg>
      <div className="min-w-[120px] text-sm">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Through Week {week}</div>
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-slate-700">
            <span className="h-3 w-3 rounded-sm bg-emerald-600" />
            Alive
          </span>
          <span className="font-semibold text-slate-950">{alive} ({alivePct}%)</span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-slate-700">
            <span className="h-3 w-3 rounded-sm bg-red-600" />
            Out
          </span>
          <span className="font-semibold text-slate-950">{eliminated} ({100 - alivePct}%)</span>
        </div>
      </div>
    </div>
  )
}

function WeekPickCell({ pick }: { pick: { team: Team; result: Result } }) {
  const resultClass =
    pick.result === 'win'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : pick.result === 'loss'
        ? 'border-red-200 bg-red-50 text-red-800'
        : pick.result === 'push'
          ? 'border-slate-300 bg-slate-100 text-slate-700'
          : 'border-slate-200 bg-white text-slate-700'
  const resultLabel = pick.result === 'win' ? 'W' : pick.result === 'loss' ? 'L' : pick.result === 'push' ? 'P' : ''

  return (
    <div className={`inline-flex min-w-[86px] items-center justify-between gap-1 rounded-md border px-1.5 py-1 text-xs font-semibold ${resultClass}`}>
      <span className="inline-flex min-w-0 items-center gap-1">
        <TeamLogo team={pick.team} size={16} />
        <span>{pick.team.abbr}</span>
      </span>
      {resultLabel && <span>{resultLabel}</span>}
    </div>
  )
}

function TeamLogo({ team, size = 28 }: { team: Team; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={team.logo} alt="" className="object-contain" style={{ width: size, height: size }} />
  )
}
