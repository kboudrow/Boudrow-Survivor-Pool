import {
  effectiveTeamLockMs,
  isPickLocked,
  requiredPickSlots,
  resultUsesStrike,
  teamAlreadyUsed,
  type PickResult,
  type TieRule,
} from '../../lib/survivorRules.ts'

export type SimPoolConfig = {
  startWeek: number
  endWeek: number
  strikesAllowed: number
  tieRule: TieRule
  deadlineMode: 'fixed' | 'rolling'
  doublePickWeeks: number[]
}

export type SimEntry = {
  id: string
  ownerId: string
  eliminatedWeek: number | null
  strikesUsed: number
  graceCredits: number
  picks: SimPick[]
}

export type SimPick = {
  week: number
  slot: number
  teamAbbr: string | null
  kickoffMs: number
  result: PickResult
}

export type WeekSummary = {
  week: number
  activeEntries: number
  eliminatedEntries: number
  winnerEntryId: string | null
  completed: boolean
}

export class SeasonSimulator {
  readonly config: SimPoolConfig
  readonly entries: SimEntry[]
  readonly summaries: WeekSummary[] = []

  constructor(config: SimPoolConfig, entries: Array<{ id: string; ownerId: string }>) {
    this.config = config
    this.entries = entries.map((entry) => ({ ...entry, eliminatedWeek: null, strikesUsed: 0, graceCredits: 0, picks: [] }))
  }

  submitPick(input: {
    entryId: string
    week: number
    slot: number
    teamAbbr: string
    kickoffMs: number
    submittedAtMs: number
    fixedDeadlineMs?: number | null
  }) {
    const entry = this.entry(input.entryId)
    if (input.week < this.config.startWeek || input.week > this.config.endWeek) throw new Error('week outside pool season')
    if (entry.eliminatedWeek !== null) throw new Error('eliminated entry')
    const slots = requiredPickSlots(this.config.doublePickWeeks, input.week)
    if (input.slot < 1 || input.slot > slots) throw new Error('invalid pick slot')
    const lock = effectiveTeamLockMs({
      kickoffMs: input.kickoffMs,
      deadlineMode: this.config.deadlineMode,
      fixedDeadlineMs: input.fixedDeadlineMs,
    })
    if (isPickLocked(lock, input.submittedAtMs)) throw new Error('pick locked')
    if (teamAlreadyUsed(
      entry.picks.filter((pick) => pick.teamAbbr).map((pick) => ({ week: pick.week, slot: pick.slot, teamAbbr: pick.teamAbbr! })),
      input.teamAbbr,
      { week: input.week, slot: input.slot },
    )) throw new Error('team already used')

    const existing = entry.picks.find((pick) => pick.week === input.week && pick.slot === input.slot)
    if (existing) {
      existing.teamAbbr = input.teamAbbr
      existing.kickoffMs = input.kickoffMs
      existing.result = null
    } else {
      entry.picks.push({ week: input.week, slot: input.slot, teamAbbr: input.teamAbbr, kickoffMs: input.kickoffMs, result: null })
    }
  }

  closeWeek(week: number, outcomes: ReadonlyMap<string, Exclude<PickResult, null>>) {
    const aliveAtStart = this.entries.filter((entry) => entry.eliminatedWeek === null)
    const slots = requiredPickSlots(this.config.doublePickWeeks, week)
    for (const entry of aliveAtStart) {
      for (let slot = 1; slot <= slots; slot += 1) {
        let pick = entry.picks.find((candidate) => candidate.week === week && candidate.slot === slot)
        if (!pick) {
          pick = { week, slot, teamAbbr: null, kickoffMs: 0, result: 'loss' }
          entry.picks.push(pick)
        } else {
          pick.result = outcomes.get(pick.teamAbbr!) ?? 'loss'
        }
      }
    }

    this.rebuildStatusThrough(week)
    const preliminarilyEliminated = aliveAtStart.filter((entry) => entry.eliminatedWeek === week)
    if (aliveAtStart.length > 1 && preliminarilyEliminated.length === aliveAtStart.length) {
      for (const entry of aliveAtStart) {
        const needed = Math.max(0, entry.strikesUsed - this.config.strikesAllowed - entry.graceCredits)
        entry.graceCredits += needed
      }
      this.rebuildStatusThrough(week)
    }

    const alive = this.entries.filter((entry) => entry.eliminatedWeek === null)
    const winnerEntryId = this.entries.length > 1 && alive.length === 1 ? alive[0].id : null
    const completed = winnerEntryId !== null || week >= this.config.endWeek
    const summary = {
      week,
      activeEntries: alive.length,
      eliminatedEntries: this.entries.length - alive.length,
      winnerEntryId,
      completed,
    }
    this.summaries.push(summary)
    this.assertInvariants(week)
    return summary
  }

  eligibleTeams(entryId: string, week: number, allTeams: readonly string[]) {
    const entry = this.entry(entryId)
    const postseason = week > 18
    const used = new Set(entry.picks.filter((pick) => pick.teamAbbr && (pick.week > 18) === postseason).map((pick) => pick.teamAbbr))
    return allTeams.filter((team) => !used.has(team))
  }

  mulligansRemaining(entryId: string) {
    const entry = this.entry(entryId)
    return Math.max(0, this.config.strikesAllowed + entry.graceCredits - entry.strikesUsed)
  }

  requiredPicksNextWeek(entryId: string, nextWeek: number) {
    const entry = this.entry(entryId)
    if (entry.eliminatedWeek !== null || this.summaries.at(-1)?.completed || nextWeek > this.config.endWeek) return 0
    return requiredPickSlots(this.config.doublePickWeeks, nextWeek)
  }

  private rebuildStatusThrough(week: number) {
    for (const entry of this.entries) {
      let strikes = 0
      let eliminatedWeek: number | null = null
      for (const pick of [...entry.picks].sort((a, b) => a.week - b.week || a.slot - b.slot)) {
        if (pick.week > week) continue
        if (resultUsesStrike(pick.result, this.config.tieRule)) strikes += 1
        if (eliminatedWeek === null && strikes > this.config.strikesAllowed + entry.graceCredits) eliminatedWeek = pick.week
      }
      entry.strikesUsed = strikes
      entry.eliminatedWeek = eliminatedWeek
    }
  }

  private assertInvariants(week: number) {
    for (const entry of this.entries) {
      const picks = entry.picks.filter((pick) => pick.week <= week)
      const realTeams = picks.filter((pick) => pick.teamAbbr)
      const uniqueByPhase = new Set(realTeams.map((pick) => `${pick.week > 18 ? 'post' : 'regular'}:${pick.teamAbbr}`))
      if (uniqueByPhase.size !== realTeams.length) throw new Error(`duplicate used team for ${entry.id}`)
      if (entry.strikesUsed < 0 || entry.graceCredits < 0) throw new Error(`negative strike accounting for ${entry.id}`)
      if (entry.eliminatedWeek !== null && entry.eliminatedWeek < this.config.startWeek) throw new Error(`pre-start elimination for ${entry.id}`)
      for (let checkedWeek = this.config.startWeek; checkedWeek <= week; checkedWeek += 1) {
        if (entry.eliminatedWeek !== null && checkedWeek > entry.eliminatedWeek) {
          if (picks.some((pick) => pick.week === checkedWeek)) throw new Error(`post-elimination pick for ${entry.id}`)
          continue
        }
        const weekPicks = picks.filter((pick) => pick.week === checkedWeek)
        if (weekPicks.length && weekPicks.length !== requiredPickSlots(this.config.doublePickWeeks, checkedWeek)) {
          throw new Error(`wrong finalized pick count for ${entry.id} Week ${checkedWeek}`)
        }
      }
    }
  }

  private entry(id: string) {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new Error(`unknown entry ${id}`)
    return entry
  }
}
