'use client'

import { useState } from 'react'

type PreviewTab = 'picks' | 'standings' | 'members'

type PreviewResult = 'win' | 'loss' | 'pending'

type PreviewPick = {
  team: string
  result: PreviewResult
}

const entries: Array<{
  name: string
  alive: boolean
  eliminatedWeek?: number
  mulligansLeft: number
  losses: number
  picks: PreviewPick[]
}> = [
  { name: 'Sunday Crew', alive: true, mulligansLeft: 1, losses: 0, picks: [{ team: 'BUF', result: 'win' }, { team: 'DAL', result: 'win' }, { team: 'BAL', result: 'pending' }] },
  { name: 'Fourth & Long', alive: true, mulligansLeft: 1, losses: 0, picks: [{ team: 'KC', result: 'win' }, { team: 'SF', result: 'win' }, { team: 'BUF', result: 'pending' }] },
  { name: 'Upset Special', alive: true, mulligansLeft: 0, losses: 1, picks: [{ team: 'DET', result: 'loss' }, { team: 'PHI', result: 'win' }, { team: 'KC', result: 'pending' }] },
  { name: 'Office Rookie', alive: false, eliminatedWeek: 2, mulligansLeft: 0, losses: 2, picks: [{ team: 'MIA', result: 'loss' }, { team: 'DET', result: 'loss' }] },
]

const teamNames: Record<string, string> = {
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  DAL: 'Dallas Cowboys',
  DET: 'Detroit Lions',
  KC: 'Kansas City Chiefs',
  MIA: 'Miami Dolphins',
  PHI: 'Philadelphia Eagles',
  SF: 'San Francisco 49ers',
}

const matchups = [
  { away: 'BAL', home: 'BUF', time: 'Sun 1:00 PM' },
  { away: 'KC', home: 'PHI', time: 'Sun 4:25 PM' },
  { away: 'SF', home: 'SEA', time: 'Sun 8:20 PM' },
]

export function HomeProductPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('standings')

  return (
    <section className="bg-slate-50 px-4 py-10 sm:px-6 sm:py-14" aria-labelledby="product-preview-title">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#c5161d]">Interactive preview · Sample data</p>
          <h2 id="product-preview-title" className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
            Everyone sees the same truth.
          </h2>
          <p className="mt-3 leading-7 text-slate-600">
            Each entry is one independent chance to survive. Picks lock on time, and a team already used by that entry stays unavailable.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[#c5161d]">Office Survivor</div>
              <div className="text-xl font-bold text-slate-950">Week 3</div>
            </div>
            <div className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">3 of 4 still alive</div>
          </div>

          <div className="overflow-x-auto border-b border-slate-200 px-3" role="tablist" aria-label="Pool preview">
            {([
              ['picks', 'Make Picks'],
              ['standings', 'Standings'],
              ['members', 'Pool Members'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`preview-${id}`}
                id={`preview-tab-${id}`}
                onClick={() => setActiveTab(id)}
                className={`min-h-12 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c5161d] ${
                  activeTab === id ? 'border-[#c5161d] text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-4 sm:p-6">
            {activeTab === 'standings' && <StandingsPreview />}
            {activeTab === 'picks' && <PicksPreview />}
            {activeTab === 'members' && <MembersPreview />}
          </div>
        </div>
      </div>
    </section>
  )
}

function StandingsPreview() {
  return (
    <div id="preview-standings" role="tabpanel" aria-labelledby="preview-tab-standings" tabIndex={0}>
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-slate-950">Entry Progression</h3>
          <p className="mt-1 text-sm text-slate-600">Follow every entry from week to week.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Week 3 picks made</div>
            <div className="mt-1 text-lg font-bold text-slate-950">3/3</div>
            <div className="mt-0.5 text-xs text-slate-500">Teams stay hidden until each pick locks.</div>
          </div>
          <PreviewSurvivalChart alive={3} total={4} week={3} />
        </div>
      </div>

      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Sample standings through Week 3">
        <table className="isolate w-full border-separate border-spacing-0 text-sm" style={{ minWidth: 760 }}>
          <caption className="sr-only">Sample pool entry progression through Week 3</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-30 w-[210px] min-w-[210px] border-b border-r border-slate-200 bg-white p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-[6px_0_10px_-10px_rgba(15,23,42,0.75)]">Entry</th>
              <th scope="col" className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Progress</th>
              <th scope="col" className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Mulligans remaining</th>
              {[1, 2, 3].map((week) => (
                <th key={week} scope="col" className="border-b border-slate-200 p-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span className="block">W{week}</span>
                  <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-400">{week === 1 ? '4/4' : '3/4'} alive</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.name} className={entry.alive ? 'align-top' : 'align-top bg-slate-50 text-slate-500'}>
                <th scope="row" className={`sticky left-0 z-20 w-[210px] min-w-[210px] border-b border-r border-slate-100 p-2 text-left font-normal shadow-[6px_0_10px_-10px_rgba(15,23,42,0.75)] ${entry.alive ? 'bg-white' : 'bg-slate-50'}`}>
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-400 bg-slate-50 text-xs font-semibold text-slate-600">{entry.name.split(' ').map((word) => word[0]).join('').slice(0, 2)}</div>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-950">{entry.name}</div>
                      <div className="text-xs text-slate-500">Entry 1</div>
                    </div>
                  </div>
                </th>
                <td className="border-b border-slate-100 p-2">
                  {entry.alive ? (
                    <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">Alive</span>
                  ) : (
                    <span className="inline-flex rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">Eliminated W{entry.eliminatedWeek}</span>
                  )}
                </td>
                <td className="border-b border-slate-100 p-2">
                  {entry.alive ? (
                    <div>
                      <span className="font-semibold text-slate-950">{entry.mulligansLeft}</span>
                      <span className="ml-1 text-xs text-slate-500">left</span>
                      <div className="text-xs text-slate-500">{entry.losses} {entry.losses === 1 ? 'loss' : 'losses'}</div>
                    </div>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
                {[0, 1, 2].map((pickIndex) => (
                  <td key={`${entry.name}-${pickIndex}`} className="border-b border-slate-100 p-2">
                    {entry.eliminatedWeek && pickIndex + 1 > entry.eliminatedWeek ? (
                      <div className="h-8 rounded-md bg-slate-50" aria-label="Entry was already eliminated" />
                    ) : entry.picks[pickIndex] ? (
                      <PreviewWeekPick pick={entry.picks[pickIndex]} />
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
    </div>
  )
}

function PreviewSurvivalChart({ alive, total, week }: { alive: number; total: number; week: number }) {
  const eliminated = total - alive
  const alivePct = Math.round((alive / total) * 100)
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const aliveLength = (alive / total) * circumference

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0" aria-label={`${alive} of ${total} entries alive`}>
        <g transform="translate(36,36) rotate(-90)">
          <circle r={radius} fill="transparent" stroke="#e2e8f0" strokeWidth="10" />
          <circle r={radius} fill="transparent" stroke="#059669" strokeWidth="10" strokeDasharray={`${aliveLength} ${circumference - aliveLength}`} />
          <circle r={radius} fill="transparent" stroke="#dc2626" strokeWidth="10" strokeDasharray={`${circumference - aliveLength} ${aliveLength}`} strokeDashoffset={-aliveLength} />
        </g>
        <text x="36" y="34" textAnchor="middle" className="fill-slate-950 text-[13px] font-bold">{alive}/{total}</text>
        <text x="36" y="46" textAnchor="middle" className="fill-slate-500 text-[8px] font-semibold">alive</text>
      </svg>
      <div className="min-w-[108px] text-xs">
        <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Through Week {week}</div>
        <div className="flex items-center justify-between gap-2 text-slate-700"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />Alive</span><span className="font-semibold text-slate-950">{alive} ({alivePct}%)</span></div>
        <div className="mt-1 flex items-center justify-between gap-2 text-slate-700"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-red-600" />Eliminated</span><span className="font-semibold text-slate-950">{eliminated} ({100 - alivePct}%)</span></div>
      </div>
    </div>
  )
}

function PreviewWeekPick({ pick }: { pick: PreviewPick }) {
  const resultClass = pick.result === 'win'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : pick.result === 'loss'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-slate-200 bg-white text-slate-700'
  const resultLabel = pick.result === 'win' ? 'W' : pick.result === 'loss' ? 'L' : ''
  const teamName = teamNames[pick.team] || pick.team

  return (
    <div className={`inline-flex min-w-[86px] items-center justify-between gap-1 rounded-md border px-1.5 py-1 text-xs font-semibold ${resultClass}`} title={teamName}>
      <span className="inline-flex min-w-0 items-center gap-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`https://a.espncdn.com/i/teamlogos/nfl/500/scoreboard/${pick.team.toLowerCase()}.png`} alt="" className="h-4 w-4 object-contain" />
        <span>{pick.team}</span>
      </span>
      {resultLabel && <span>{resultLabel}</span>}
    </div>
  )
}

function PicksPreview() {
  return (
    <div id="preview-picks" role="tabpanel" aria-labelledby="preview-tab-picks" tabIndex={0}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div><div className="font-bold text-slate-950">Choose one team to win</div><div className="text-sm text-slate-500">The choice saves immediately, stays editable until lock, and remains private until then.</div></div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">Locks at kickoff</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {matchups.map((game, index) => (
          <button key={game.away} type="button" className={`rounded-xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c5161d] ${index === 0 ? 'border-[#c5161d] bg-red-50 ring-1 ring-[#c5161d]' : 'border-slate-200 hover:border-slate-400'}`}>
            <div className="text-xs font-semibold text-slate-500">{game.time}</div>
            <div className="mt-3 flex items-center justify-between text-lg font-bold"><span>{game.away}</span><span className="text-xs font-normal text-slate-400">at</span><span>{game.home}</span></div>
            <div className="mt-3 text-xs font-semibold text-[#c5161d]">{index === 0 ? 'BAL selected' : 'Select a team'}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function MembersPreview() {
  return (
    <div id="preview-members" role="tabpanel" aria-labelledby="preview-tab-members" tabIndex={0} className="grid gap-3 sm:grid-cols-2">
      {entries.map((entry, index) => (
        <div key={entry.name} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">{entry.name.split(' ').map((word) => word[0]).join('')}</div>
          <div className="min-w-0"><div className="truncate font-semibold text-slate-950">{entry.name}</div><div className="text-xs text-slate-500">{index === 0 ? 'Commissioner · ' : ''}Entry 1</div></div>
        </div>
      ))}
    </div>
  )
}
