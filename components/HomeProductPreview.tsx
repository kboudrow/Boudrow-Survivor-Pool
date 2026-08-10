'use client'

import { useState } from 'react'

type PreviewTab = 'picks' | 'standings' | 'members'

const entries = [
  { name: 'Sunday Crew', status: 'Alive', mulligans: '1 left', picks: ['BUF W', 'DAL W', 'BAL'] },
  { name: 'Fourth & Long', status: 'Alive', mulligans: '1 left', picks: ['KC W', 'SF W', 'BUF'] },
  { name: 'Upset Special', status: 'Alive', mulligans: '0 left', picks: ['DET L', 'PHI W', 'KC'] },
  { name: 'Office Rookie', status: 'Eliminated W2', mulligans: '—', picks: ['MIA L', 'DET L', '—'] },
]

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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Alive" value="3" tone="green" />
        <Metric label="Eliminated" value="1" tone="red" />
        <div className="col-span-2 sm:col-span-1"><Metric label="Week 3 picks" value="3 / 3" /></div>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <div key={entry.name} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1.4fr_.7fr_.7fr_1.4fr] sm:items-center">
            <div className="min-w-0 font-semibold text-slate-950">{entry.name}</div>
            <span className={`justify-self-end rounded-full px-2 py-0.5 text-xs font-bold sm:justify-self-start ${entry.status === 'Alive' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{entry.status}</span>
            <div className="text-xs text-slate-500 sm:text-sm">{entry.mulligans}</div>
            <div className="flex justify-end gap-1 text-xs font-semibold sm:justify-start">
              {entry.picks.map((pick, index) => <span key={`${entry.name}-${index}`} className="rounded bg-slate-100 px-2 py-1 text-slate-700">{pick}</span>)}
            </div>
          </div>
        ))}
      </div>
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-700' : 'text-slate-950'
  return <div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-2xl font-extrabold ${color}`}>{value}</div></div>
}
