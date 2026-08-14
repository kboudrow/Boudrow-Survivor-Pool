'use client'

import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { InviteModal } from '@/components/InviteModal'
import { ConfirmDialogModal, type ConfirmDialog } from '@/components/ConfirmDialogModal'
import { getErrorMessage } from '@/lib/errorMessage'
import { isUnlimitedPoolCapacity, poolEntryCountLabel } from '@/lib/poolCapacity'
import { poolImageUrl } from '@/lib/poolImages'
import { makeStorageObjectPath, validatePublicImageUpload } from '@/lib/security'
import { REGULAR_SEASON_LAST_WEEK, configurableDoublePickWeeks, maxWeekForPool, weekLongLabel, weekShortLabel } from '@/lib/seasonModel'
import { supabase } from '@/lib/supabaseClient'

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'

type Pool = {
  id: string
  name: string
  created_by: string
  cloned_from_pool_id?: string | null
  is_public: boolean
  visibility?: 'public' | 'private' | string | null
  double_pick_weeks: number[] | null
  archived: boolean
  season: number | null
  start_week: number
  include_playoffs?: boolean | null
  strikes_allowed?: number | string | null
  tie_rule?: 'win' | 'loss' | string | null
  deadline_mode?: 'fixed' | 'rolling' | string | null
  deadline_fixed?: string | null
  notes?: string | null
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
  allow_multiple_entries?: boolean | null
  max_entries_per_user?: number | null
  payment_status?: 'unpaid' | 'paid' | 'not_required' | 'waived' | 'refunded' | string | null
  image_url?: string | null
  test_mode?: boolean | null
  test_current_week?: number | null
  test_now_at?: string | null
}

type AdminRow = {
  entry_id: string
  user_id: string
  entry_number: number | null
  entry_name: string | null
  display_name: string
  role: string
  joined_at: string | null
  slot: number
  draft_team_abbr: string | null
  draft_updated_at: string | null
  final_team_abbr: string | null
  locked_at: string | null
  result: string | null
  wins: number
  losses: number
  pushes: number
  strikes_used: number
  eliminated: boolean
  eliminated_week: number | null
}

type AdminActionRow = {
  id: string
  pool_id: string
  admin_id: string
  target_user_id: string | null
  week: number | null
  slot: number | null
  action: string
  old_team_abbr: string | null
  new_team_abbr: string | null
  reason: string | null
  created_at: string
}

type PickSaveEventRow = {
  id: string
  pool_id: string
  user_id: string
  actor_user_id: string | null
  source_table: string | null
  action: string | null
  week: number | null
  slot: number | null
  old_team_abbr: string | null
  new_team_abbr: string | null
  result: string | null
  created_at: string
}

type DisputeEventRow = {
  event_id: string
  event_at: string
  event_type: string
  entry_id: string | null
  entry_label: string | null
  actor_name: string | null
  subject_name: string | null
  week: number | null
  slot: number | null
  summary: string
  server_effective_at: string | null
  applicable_deadline_at: string | null
  details: Record<string, unknown> | null
}

type TestGameOption = {
  game_id: string
  season: number
  week: number
  away_team: string
  home_team: string
  game_time: string | null
  away_pick_count: number
  home_pick_count: number
  total_pick_count: number
  fake_outcome: string | null
  needs_outcome: boolean
}

type ReinviteRow = {
  source_pool_id: string
  source_pool_name: string
  profile_id: string
  display_name: string
  username: string
  avatar_url: string | null
  previous_entry_count: number
  previous_role: string
  current_entry_count: number
  joined_new_pool: boolean
}

type EntryAuditRow = {
  entry_id: string
  user_id: string
  entry_number: number
  display_name: string
  week: number
  slot: number
  pick_state: 'draft' | 'final' | 'empty' | string
  draft_team_abbr: string | null
  draft_updated_at: string | null
  final_team_abbr: string | null
  locked_at: string | null
  result: string | null
  strikes_after_week: number
  strikes_left_after_week: number
  status_after_week: 'alive' | 'out' | string
  eliminated_week: number | null
  issue: string | null
}

type IntegrityCheckRow = {
  check_name: string
  status: 'pass' | 'warning' | 'fail' | string
  issue_count: number
  detail: string
}

type PoolLifecycleStatus = {
  pool_id: string
  phase: string
  label: string
  description: string
  starts_at: string | null
  current_week: number
  final_week: number
  total_entries: number
  alive_entries: number
  join_allowed: boolean
  entry_creation_allowed: boolean
  pick_submission_allowed: boolean
  settings_editable: boolean
  archive_allowed: boolean
  result_processing_pending: boolean
}

const REGULAR_SEASON_WEEKS = Array.from({ length: REGULAR_SEASON_LAST_WEEK }, (_, i) => i + 1)
const TEST_CLOCK_STAGES = [
  {
    value: 'before_week',
    label: 'Before week starts',
    description: 'No league picks have reached a lock time yet.',
  },
  {
    value: 'first_kickoff',
    label: 'After first kickoff',
    description: 'The first kicked-off matchup is locked and visible.',
  },
  {
    value: 'sunday_1pm',
    label: 'After Sunday 1 PM',
    description: 'Standard-deadline picks are locked and visible.',
  },
  {
    value: 'sunday_late',
    label: 'After Sunday late games',
    description: 'Late-afternoon kickoff picks are locked and visible.',
  },
  {
    value: 'sunday_night',
    label: 'After Sunday night',
    description: 'Sunday night picks are locked and visible.',
  },
  {
    value: 'week_done',
    label: 'After final game',
    description: 'The week is ready to score and advance.',
  },
] as const
const MEMBER_LIMIT_OPTIONS = [10, 25, 50, 100, 250, 500]
const ENTRY_LIMIT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1)
const TEAMS = [
  'ARI',
  'ATL',
  'BAL',
  'BUF',
  'CAR',
  'CHI',
  'CIN',
  'CLE',
  'DAL',
  'DEN',
  'DET',
  'GB',
  'HOU',
  'IND',
  'JAX',
  'KC',
  'LV',
  'LAC',
  'LAR',
  'MIA',
  'MIN',
  'NE',
  'NO',
  'NYG',
  'NYJ',
  'PHI',
  'PIT',
  'SEA',
  'SF',
  'TB',
  'TEN',
  'WAS',
]

function fmt(value?: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}
const rowKey = (row: AdminRow) => `${row.entry_id}:${row.slot}`
const hasFinalPick = (row: AdminRow) => !!row.final_team_abbr || !!row.locked_at
const entryLabel = (row: AdminRow) => row.entry_name?.trim()
  ? `${row.display_name} — ${row.entry_name.trim()}`
  : (row.entry_number && row.entry_number > 1 ? `${row.display_name} (${row.entry_number})` : row.display_name)
const memberLabel = (row: AdminRow) => row.display_name || row.user_id.slice(0, 8)
const shortId = (value?: string | null) => (value ? value.slice(0, 8) : '-')
const fmtShort = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '-'
const maxTestWeekForPool = maxWeekForPool
const weekLabel = weekLongLabel
const shortWeekLabel = weekShortLabel
const avatarInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || 'P'
const integrityStatusClass = (status: string) => {
  if (status === 'fail') return 'border-red-200 bg-red-50 text-red-700'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-emerald-200 bg-emerald-50 text-emerald-700'
}
const integrityDotClass = (status: string) => {
  if (status === 'fail') return 'bg-red-500'
  if (status === 'warning') return 'bg-amber-500'
  return 'bg-emerald-500'
}
const auditResultClass = (result?: string | null) => {
  if (result === 'win') return 'bg-emerald-100 text-emerald-700'
  if (result === 'loss') return 'bg-red-100 text-red-700'
  if (result === 'push') return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-600'
}
const checkNameLabel = (name: string) =>
  name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

function poolStage(pool: Pool, settingsLocked: boolean, status?: PoolLifecycleStatus | null) {
  if (status) {
    const className =
      status.phase === 'archived' || status.phase === 'cancelled'
        ? 'border-slate-300 bg-slate-100 text-slate-700'
        : status.phase.startsWith('completed_')
          ? 'border-amber-300 bg-amber-50 text-amber-800'
          : status.phase === 'review_required' || status.phase === 'waiting_results'
            ? 'border-amber-300 bg-amber-50 text-amber-700'
            : status.phase === 'open' || status.phase === 'draft'
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700'
    return { label: status.label, className, description: status.description }
  }
  if (pool.archived) {
    return {
      label: 'Archived',
      className: 'border-slate-300 bg-slate-100 text-slate-700',
      description: 'Hidden from normal pool lists.',
    }
  }
  if (pool.activation_status === 'cancelled') {
    return {
      label: 'Closed',
      className: 'border-amber-300 bg-amber-50 text-amber-700',
      description: 'Not accepting new members.',
    }
  }
  if (settingsLocked) {
    return {
      label: 'In season',
      className: 'border-emerald-300 bg-emerald-50 text-emerald-700',
      description: 'Rules are locked. Picks and standings are active.',
    }
  }
  return {
    label: 'Setup',
    className: 'border-blue-300 bg-blue-50 text-blue-700',
    description: 'Invite members and adjust rules before the pool starts.',
  }
}

function TestActionButton({
  title,
  description,
  onClick,
  disabled,
  tone,
}: {
  title: string
  description: string
  onClick: () => void
  disabled?: boolean
  tone: 'indigo' | 'emerald' | 'slate' | 'red'
}) {
  const classes = {
    indigo: 'bg-indigo-600 text-white hover:bg-indigo-700',
    emerald: 'bg-emerald-600 text-white hover:bg-emerald-700',
    slate: 'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50',
    red: 'bg-red-600 text-white hover:bg-red-700',
  }[tone]
  const descriptionClass = tone === 'slate' ? 'text-slate-500' : 'text-white/80'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-2 text-left text-sm font-semibold disabled:opacity-50 ${classes}`}
    >
      <span className="block">{title}</span>
      <span className={`mt-1 block text-xs font-medium leading-4 ${descriptionClass}`}>{description}</span>
    </button>
  )
}

export default function PoolAdminPage() {
  const router = useRouter()
  const { poolId } = useParams<{ poolId: string }>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [pool, setPool] = useState<Pool | null>(null)
  const [poolStartAt, setPoolStartAt] = useState<string | null>(null)
  const [lifecycleStatus, setLifecycleStatus] = useState<PoolLifecycleStatus | null>(null)
  const [rows, setRows] = useState<AdminRow[]>([])
  const [adminActions, setAdminActions] = useState<AdminActionRow[]>([])
  const [pickEvents, setPickEvents] = useState<PickSaveEventRow[]>([])
  const [disputeEvents, setDisputeEvents] = useState<DisputeEventRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [entryAuditRows, setEntryAuditRows] = useState<EntryAuditRow[]>([])
  const [entryAuditLoading, setEntryAuditLoading] = useState(false)
  const [selectedAuditEntryId, setSelectedAuditEntryId] = useState<string | null>(null)
  const [integrityRows, setIntegrityRows] = useState<IntegrityCheckRow[]>([])
  const [integrityLoading, setIntegrityLoading] = useState(false)

  const [selectedWeek, setSelectedWeek] = useState(1)
  const [doubleWeeksText, setDoubleWeeksText] = useState('')
  const [maxMembersText, setMaxMembersText] = useState('')
  const [maxMembersPreset, setMaxMembersPreset] = useState('25')
  const [allowMultipleEntriesDraft, setAllowMultipleEntriesDraft] = useState(false)
  const [maxEntriesPerUserDraft, setMaxEntriesPerUserDraft] = useState('1')
  const [startWeekDraft, setStartWeekDraft] = useState('1')
  const [includePlayoffsDraft, setIncludePlayoffsDraft] = useState(false)
  const [mulligansDraft, setMulligansDraft] = useState('0')
  const [tieRuleDraft, setTieRuleDraft] = useState<'win' | 'loss'>('loss')
  const [deadlineModeDraft, setDeadlineModeDraft] = useState<'fixed' | 'rolling'>('fixed')
  const [notesDraft, setNotesDraft] = useState('')
  const [savingCoreRules, setSavingCoreRules] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [savingDouble, setSavingDouble] = useState(false)
  const [savingLimit, setSavingLimit] = useState(false)
  const [savingEntries, setSavingEntries] = useState(false)
  const [savingVisibility, setSavingVisibility] = useState(false)
  const [isPublicDraft, setIsPublicDraft] = useState(true)
  const [visibilityPassword, setVisibilityPassword] = useState('')
  const [savingImage, setSavingImage] = useState(false)
  const [imageUrlDraft, setImageUrlDraft] = useState('')
  const [imageFileDraft, setImageFileDraft] = useState<File | null>(null)
  const [imagePreviewDraft, setImagePreviewDraft] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageNotice, setImageNotice] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [draftTeams, setDraftTeams] = useState<Record<string, string>>({})
  const [finalTeams, setFinalTeams] = useState<Record<string, string>>({})
  const [pickCorrectionReason, setPickCorrectionReason] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [testWeek, setTestWeek] = useState('1')
  const [advancedTestWeekOverride, setAdvancedTestWeekOverride] = useState(false)
  const [testClockStage, setTestClockStage] = useState<(typeof TEST_CLOCK_STAGES)[number]['value']>('before_week')
  const [testGames, setTestGames] = useState<TestGameOption[]>([])
  const [testToolsLoading, setTestToolsLoading] = useState(false)
  const [reinviteRows, setReinviteRows] = useState<ReinviteRow[]>([])
  const [reinviteLoading, setReinviteLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)

  const entryRows = useMemo(() => {
    const uniqueRows = Array.from(new Map(rows.map((row) => [row.entry_id, row])).values())
    return uniqueRows.sort((a, b) => entryLabel(a).localeCompare(entryLabel(b)) || (a.entry_number ?? 1) - (b.entry_number ?? 1))
  }, [rows])
  const memberRows = useMemo(() => {
    const grouped = new Map<string, { row: AdminRow; entries: AdminRow[] }>()
    for (const row of entryRows) {
      const current = grouped.get(row.user_id)
      if (current) {
        current.entries.push(row)
      } else {
        grouped.set(row.user_id, { row, entries: [row] })
      }
    }
    return Array.from(grouped.values()).sort((a, b) => memberLabel(a.row).localeCompare(memberLabel(b.row)))
  }, [entryRows])
  const entryCount = entryRows.length
  const uniqueMemberCount = memberRows.length
  const stats = useMemo(() => {
    const alive = entryRows.filter((row) => !row.eliminated).length
    return { alive, eliminated: entryRows.length - alive }
  }, [entryRows])
  const isPoolJoinable = pool?.activation_status !== 'cancelled'
  const testStartWeek = pool?.start_week || 1
  const testMaxWeek = maxTestWeekForPool(pool)
  const doublePickWeekOptions = useMemo(() => configurableDoublePickWeeks(pool), [pool])
  const testWeekOptions = useMemo(
    () => Array.from({ length: Math.max(0, testMaxWeek - testStartWeek + 1) }, (_, index) => testStartWeek + index),
    [testMaxWeek, testStartWeek],
  )
  const testGamesWithPicks = useMemo(
    () => testGames.filter((game) => (game.total_pick_count ?? game.away_pick_count + game.home_pick_count) > 0),
    [testGames],
  )
  const testGamesWithOutcomes = useMemo(() => testGames.filter((game) => !!game.fake_outcome), [testGames])
  const testGamesNeedingOutcome = useMemo(
    () =>
      testGames.filter((game) => {
        const totalPicks = game.total_pick_count ?? game.away_pick_count + game.home_pick_count
        return totalPicks > 0 && !game.fake_outcome
      }),
    [testGames],
  )
  const parsedTestWeek = Number.parseInt(testWeek, 10) || testStartWeek
  const testPicksRequired = entryCount * (pool?.double_pick_weeks?.includes(parsedTestWeek) ? 2 : 1)
  const testPicksSubmitted = rows.filter((row) => !!row.draft_updated_at || !!row.final_team_abbr || !!row.locked_at).length
  const testPickSlotsMissing = Math.max(0, testPicksRequired - testPicksSubmitted)
  const poolStartMs = poolStartAt ? Date.parse(poolStartAt) : null
  const poolStartKnown = poolStartMs !== null && Number.isFinite(poolStartMs)
  const leagueHasStarted = !!pool && (
    (!!pool.test_mode && (pool.test_current_week || pool.start_week || 1) >= (pool.start_week || 1))
    || (poolStartKnown && Date.now() >= poolStartMs)
  )
  const settingsLocked = lifecycleStatus ? !lifecycleStatus.settings_editable : leagueHasStarted
  const canInvite = lifecycleStatus
    ? lifecycleStatus.join_allowed
    : !!pool && isPoolJoinable && poolStartKnown && !leagueHasStarted
  const canReinvite = !!pool && isPoolJoinable && !settingsLocked
  const canArchive = lifecycleStatus ? lifecycleStatus.archive_allowed : !settingsLocked
  const lifecycle = pool ? poolStage(pool, settingsLocked, lifecycleStatus) : null
  const visibilityChanged = !!pool && isPublicDraft !== pool.is_public
  const coreRulesChanged = !!pool && (
    startWeekDraft !== String(pool.start_week)
    || includePlayoffsDraft !== !!pool.include_playoffs
    || mulligansDraft !== String(pool.strikes_allowed ?? 0)
    || tieRuleDraft !== (pool.tie_rule === 'win' ? 'win' : 'loss')
    || deadlineModeDraft !== (pool.deadline_mode === 'rolling' ? 'rolling' : 'fixed')
    || notesDraft !== (pool.notes || '')
  )
  const selectedDoubleWeeks = useMemo(() => {
    return new Set(
      doubleWeeksText
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= (pool?.include_playoffs ? 21 : 18)),
      )
  }, [doubleWeeksText, pool?.include_playoffs])
  const doubleWeekCount = selectedDoubleWeeks.size
  const savedDoubleWeeksText = (pool?.double_pick_weeks || []).filter((week) => week >= (pool?.start_week || 1)).sort((a, b) => a - b).join(',')
  const selectedDoubleWeeksText = Array.from(selectedDoubleWeeks).sort((a, b) => a - b).join(',')
  const doubleWeeksChanged = !!pool && selectedDoubleWeeksText !== savedDoubleWeeksText
  const savedCapacityText = pool && isUnlimitedPoolCapacity(pool.max_members) ? 'unlimited' : String(pool?.max_members ?? '')
  const capacityDraftText = maxMembersPreset === 'unlimited' ? 'unlimited' : maxMembersText.trim()
  const capacityChanged = !!pool && capacityDraftText !== savedCapacityText
  const entrySettingsChanged = !!pool && (
    allowMultipleEntriesDraft !== !!pool.allow_multiple_entries
    || String(allowMultipleEntriesDraft ? maxEntriesPerUserDraft : '1') !== String(pool.max_entries_per_user ?? 1)
  )
  const visibleRows = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      return [entryLabel(row), row.user_id, row.role, row.draft_team_abbr || '', row.final_team_abbr || ''].some((value) =>
        value.toLowerCase().includes(q),
      )
    })
  }, [memberSearch, rows])
  const visibleMemberRows = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return memberRows
    return memberRows.filter(({ row, entries }) => {
      return [memberLabel(row), row.user_id, row.role, ...entries.map((entry) => entry.entry_id)].some((value) => value.toLowerCase().includes(q))
    })
  }, [memberRows, memberSearch])
  const reinviteStats = useMemo(() => {
    const joined = reinviteRows.filter((row) => row.joined_new_pool).length
    return {
      joined,
      missing: Math.max(0, reinviteRows.length - joined),
      sourceName: reinviteRows[0]?.source_pool_name || null,
    }
  }, [reinviteRows])
  const auditEntries = useMemo(() => {
    const map = new Map<string, EntryAuditRow>()
    for (const row of entryAuditRows) {
      if (!map.has(row.entry_id)) map.set(row.entry_id, row)
    }
    return Array.from(map.values()).sort((a, b) => a.display_name.localeCompare(b.display_name) || a.entry_number - b.entry_number)
  }, [entryAuditRows])
  const selectedAuditEntry = useMemo(
    () => auditEntries.find((entry) => entry.entry_id === selectedAuditEntryId) || auditEntries[0] || null,
    [auditEntries, selectedAuditEntryId],
  )
  const selectedEntryAuditRows = useMemo(
    () => (selectedAuditEntry ? entryAuditRows.filter((row) => row.entry_id === selectedAuditEntry.entry_id) : []),
    [entryAuditRows, selectedAuditEntry],
  )
  const selectedAuditSummary = useMemo(() => {
    if (!selectedEntryAuditRows.length) return null
    const latest = [...selectedEntryAuditRows].sort((a, b) => b.week - a.week || b.slot - a.slot)[0]
    const issues = selectedEntryAuditRows.filter((row) => !!row.issue).length
    return {
      latest,
      issues,
      finalPicks: selectedEntryAuditRows.filter((row) => row.pick_state === 'final').length,
      drafts: selectedEntryAuditRows.filter((row) => row.pick_state === 'draft').length,
    }
  }, [selectedEntryAuditRows])
  const integrityIssueCount = useMemo(() => integrityRows.reduce((sum, row) => sum + (row.issue_count || 0), 0), [integrityRows])
  const integrityFailCount = useMemo(() => integrityRows.filter((row) => row.status === 'fail').length, [integrityRows])
  const inviteUrl = useMemo(() => {
    if (!pool?.id) return ''
    if (typeof window === 'undefined') return `/join/${pool.id}`
    return `${window.location.origin}/join/${pool.id}`
  }, [pool?.id])
  const reinviteMessage = useMemo(() => {
    if (!pool || !inviteUrl) return ''
    const source = reinviteStats.sourceName ? ` from ${reinviteStats.sourceName}` : ''
    const privateNote = pool.is_public ? '' : ' This pool is private, so I will send the password separately.'
    return `I created ${pool.name}${source} for the new season. Join here: ${inviteUrl}.${privateNote}`
  }, [inviteUrl, pool, reinviteStats.sourceName])

  const requestConfirm = (options: Omit<ConfirmDialog, 'resolve'>) =>
    new Promise<boolean>((resolve) => {
      setConfirmDialog({ ...options, resolve })
    })

  const loadAuditTrail = async () => {
    if (!poolId) return
    setAuditLoading(true)
    try {
      const [{ data: actions, error: actionsErr }, { data: events, error: eventsErr }, { data: disputes, error: disputesErr }] = await Promise.all([
        supabase
          .from('admin_actions')
          .select('id,pool_id,admin_id,target_user_id,week,slot,action,old_team_abbr,new_team_abbr,reason,created_at')
          .eq('pool_id', poolId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('pick_save_events')
          .select('id,pool_id,user_id,actor_user_id,source_table,action,week,slot,old_team_abbr,new_team_abbr,result,created_at')
          .eq('pool_id', poolId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase.rpc('commissioner_dispute_history', {
          p_pool_id: poolId,
          p_entry_id: null,
          p_limit: 100,
        }),
      ])
      if (actionsErr) throw actionsErr
      if (eventsErr) throw eventsErr
      if (disputesErr) throw disputesErr
      setAdminActions((actions || []) as AdminActionRow[])
      setPickEvents((events || []) as PickSaveEventRow[])
      setDisputeEvents((disputes || []) as DisputeEventRow[])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load audit trail.'))
    } finally {
      setAuditLoading(false)
    }
  }

  const loadEntryAudit = async (poolIdValue = poolId) => {
    if (!poolIdValue) return
    setEntryAuditLoading(true)
    try {
      const { data, error: auditErr } = await supabase.rpc('admin_pool_entry_audit', {
        p_pool_id: poolIdValue,
      })
      if (auditErr) throw auditErr
      const nextRows = (data || []) as EntryAuditRow[]
      setEntryAuditRows(nextRows)
      setSelectedAuditEntryId((current) => (current && nextRows.some((row) => row.entry_id === current) ? current : nextRows[0]?.entry_id ?? null))
    } catch (e: unknown) {
      setEntryAuditRows([])
      setError(getErrorMessage(e, 'Failed to load entry audit.'))
    } finally {
      setEntryAuditLoading(false)
    }
  }

  const loadIntegrityChecks = async (poolIdValue = poolId) => {
    if (!poolIdValue) return
    setIntegrityLoading(true)
    try {
      const { data, error: integrityErr } = await supabase.rpc('admin_pool_scoring_integrity', {
        p_pool_id: poolIdValue,
      })
      if (integrityErr) throw integrityErr
      setIntegrityRows((data || []) as IntegrityCheckRow[])
    } catch (e: unknown) {
      setIntegrityRows([])
      setError(getErrorMessage(e, 'Failed to run scoring checks.'))
    } finally {
      setIntegrityLoading(false)
    }
  }

  const loadTestOptions = async (poolIdValue: string, weekText = testWeek) => {
    const week = parseInt(weekText, 10)
    if (!Number.isFinite(week)) return
    setTestToolsLoading(true)
    setError(null)
    try {
      const { data, error: optionsErr } = await supabase.rpc('superadmin_test_pool_week_options', {
        p_pool_id: poolIdValue,
        p_week: week,
      })
      if (optionsErr) throw optionsErr
      setTestGames((data || []) as TestGameOption[])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load test week matchups.'))
    } finally {
      setTestToolsLoading(false)
    }
  }

  const loadReinviteOverview = async (poolIdValue: string) => {
    setReinviteLoading(true)
    try {
      const { data, error: reinviteErr } = await supabase.rpc('pool_reinvite_overview', {
        p_pool_id: poolIdValue,
      })
      if (reinviteErr) throw reinviteErr
      setReinviteRows((data || []) as ReinviteRow[])
    } catch (e: unknown) {
      setReinviteRows([])
      setError(getErrorMessage(e, 'Failed to load previous season members.'))
    } finally {
      setReinviteLoading(false)
    }
  }

  const loadOverview = async (week = selectedWeek) => {
    if (!poolId) return
    setRefreshing(true)
    setError(null)
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) {
        router.replace(`/?auth=signin&returnTo=${encodeURIComponent(`/pools/${poolId}/admin`)}`)
        return
      }
      const { data: canManage, error: manageError } = await supabase.rpc('admin_can_manage', { p_pool_id: poolId })
      if (manageError) throw manageError
      if (!canManage) {
        router.replace(`/pools/${poolId}`)
        return
      }

      const [{ data: p, error: pErr }, { data: overview, error: overviewErr }, { data: lifecycleRows, error: lifecycleErr }] = await Promise.all([
        supabase.from('pools').select('id,name,created_by,cloned_from_pool_id,is_public,visibility,double_pick_weeks,archived,season,start_week,include_playoffs,strikes_allowed,tie_rule,deadline_mode,deadline_fixed,notes,activation_status,max_members,allow_multiple_entries,max_entries_per_user,payment_status,image_url,test_mode,test_current_week,test_now_at').eq('id', poolId).maybeSingle<Pool>(),
        supabase.rpc('admin_pool_entry_week_overview', { p_pool_id: poolId, p_week: week }),
        supabase.rpc('pool_lifecycle_status', { p_pool_id: poolId }),
      ])
      if (pErr) throw pErr
      if (overviewErr) throw overviewErr
      if (lifecycleErr) throw lifecycleErr
      if (!p) throw new Error('Pool not found')

      const nextIsSuperAdmin = user?.email?.toLowerCase() === SUPERADMIN_EMAIL
      const nextLifecycle = (((lifecycleRows || []) as PoolLifecycleStatus[])[0] || null)

      setPool(p)
      setLifecycleStatus(nextLifecycle)
      setPoolStartAt(nextLifecycle?.starts_at || null)
      setIsOwner(true)
      setIsSuperAdmin(nextIsSuperAdmin)
      setDoubleWeeksText((p.double_pick_weeks || []).filter((week) => week >= p.start_week).join(','))
      const limitText = isUnlimitedPoolCapacity(p.max_members) ? 'unlimited' : String(p.max_members)
      setMaxMembersText(limitText)
      setMaxMembersPreset(limitText === 'unlimited' || MEMBER_LIMIT_OPTIONS.includes(Number(limitText)) ? limitText : 'custom')
      setAllowMultipleEntriesDraft(!!p.allow_multiple_entries)
      setMaxEntriesPerUserDraft(String(p.max_entries_per_user ?? 1))
      setStartWeekDraft(String(p.start_week || 1))
      setIncludePlayoffsDraft(!!p.include_playoffs)
      setMulligansDraft(String(p.strikes_allowed ?? 0))
      setTieRuleDraft(p.tie_rule === 'win' ? 'win' : 'loss')
      setDeadlineModeDraft(p.deadline_mode === 'rolling' ? 'rolling' : 'fixed')
      setNotesDraft(p.notes || '')
      setIsPublicDraft(!!p.is_public)
      setVisibilityPassword('')
      setImageUrlDraft(p.image_url || '')
      setImageFileDraft(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setImageError(null)
      setImageNotice(null)
      setRows((overview || []) as AdminRow[])
      const nextTestWeek = String(p.test_current_week || p.start_week || 1)
      setTestWeek(nextTestWeek)
      setAdvancedTestWeekOverride(false)
      if (nextIsSuperAdmin && p.test_mode) {
        await loadTestOptions(p.id, nextTestWeek)
      } else {
        setTestGames([])
      }
      if (p.cloned_from_pool_id) {
        await loadReinviteOverview(p.id)
      } else {
        setReinviteRows([])
      }

      const nextDrafts: Record<string, string> = {}
      const nextFinals: Record<string, string> = {}
      for (const row of (overview || []) as AdminRow[]) {
        nextDrafts[rowKey(row)] = row.draft_team_abbr || ''
        nextFinals[rowKey(row)] = row.final_team_abbr || ''
      }
      setDraftTeams(nextDrafts)
      setFinalTeams(nextFinals)
      await Promise.all([loadAuditTrail(), loadEntryAudit(p.id), loadIntegrityChecks(p.id)])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load admin data.'))
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    let alive = true
    const init = async () => {
      if (!poolId || !alive) return
      setLoading(true)
      await loadOverview(selectedWeek)
    }
    init()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolId])

  useEffect(() => {
    if (!loading && !error && pool && !isOwner) {
      router.replace(`/pools/${poolId}`)
    }
  }, [loading, error, pool, isOwner, poolId, router])

  const runAction = async (label: string, action: () => Promise<string | void>) => {
    setRunningAction(label)
    setError(null)
    setNotice(null)
    try {
      const message = await action()
      setNotice(message || `${label} complete.`)
      await loadOverview(selectedWeek)
    } catch (e: unknown) {
      await loadOverview(selectedWeek)
      setError(`${getErrorMessage(e, `${label} failed.`)} The current database state has been refreshed; check the page before retrying.`)
    } finally {
      setRunningAction(null)
    }
  }

  const confirmPoolSettings = async (matches: (row: Pool) => boolean) => {
    if (!poolId) return false
    const { data, error: verifyError } = await supabase.from('pools')
      .select('id,name,created_by,is_public,visibility,double_pick_weeks,archived,season,start_week,include_playoffs,strikes_allowed,tie_rule,deadline_mode,deadline_fixed,notes,activation_status,max_members,allow_multiple_entries,max_entries_per_user,payment_status,image_url,test_mode,test_current_week,test_now_at')
      .eq('id', poolId).maybeSingle<Pool>()
    return !verifyError && !!data && matches(data)
  }

  const saveCoreRules = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('Competitive rules are locked because the pool has started. This protects existing picks and standings.')
      return
    }
    const nextStartWeek = Number.parseInt(startWeekDraft, 10)
    const nextMulligans = Number.parseInt(mulligansDraft, 10)
    if (!Number.isFinite(nextStartWeek) || nextStartWeek < 1 || nextStartWeek > 18) {
      setError('Start week must be between Week 1 and Week 18.')
      return
    }
    if (!Number.isFinite(nextMulligans) || nextMulligans < 0 || nextMulligans > 2) {
      setError('Mulligans must be 0, 1, or 2.')
      return
    }
    if (notesDraft.length > 2000) {
      setError('Additional rules cannot be longer than 2,000 characters.')
      return
    }

    setSavingCoreRules(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_core_rules', {
        p_pool_id: pool.id,
        p_start_week: nextStartWeek,
        p_include_playoffs: includePlayoffsDraft,
        p_strikes_allowed: nextMulligans,
        p_tie_rule: tieRuleDraft,
        p_deadline_mode: deadlineModeDraft,
        p_notes: notesDraft.trim() || null,
      })
      if (error) throw error
      setSelectedWeek((week) => Math.max(week, nextStartWeek))
      setNotice('Core pool rules saved. The updated rules now apply to every entry.')
      await loadOverview(Math.max(selectedWeek, nextStartWeek))
    } catch (e: unknown) {
      const confirmed = await confirmPoolSettings((row) =>
        row.start_week === nextStartWeek
        && !!row.include_playoffs === includePlayoffsDraft
        && Number(row.strikes_allowed) === nextMulligans
        && row.tie_rule === tieRuleDraft
        && row.deadline_mode === deadlineModeDraft
        && (row.notes || '') === notesDraft.trim())
      await loadOverview(Math.max(selectedWeek, nextStartWeek))
      if (confirmed) setNotice('Core pool rules saved and confirmed after the delayed response.')
      else setError(`${getErrorMessage(e, 'Failed to save core pool rules.')} Current database settings were refreshed; review them before retrying.`)
    } finally {
      setSavingCoreRules(false)
    }
  }

  const saveDoubleWeeks = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('Pool settings cannot be changed after the pool has started.')
      return
    }
    setSavingDouble(true)
    setError(null)
    setNotice(null)
    try {
      const weeks = doubleWeeksText
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= (pool?.start_week ?? 1) && n <= (pool.include_playoffs ? 21 : 18))

      const { error } = await supabase.rpc('admin_set_double_weeks', {
        p_pool_id: pool.id,
        p_weeks: weeks,
      })
      if (error) throw error
      setNotice('Double-pick weeks saved.')
      setPool({ ...pool, double_pick_weeks: weeks })
    } catch (e: unknown) {
      const expected = [...new Set(doubleWeeksText.split(',').map((value) => Number.parseInt(value.trim(), 10)).filter((week) => Number.isFinite(week) && week >= (pool.start_week ?? 1) && week <= (pool.include_playoffs ? 21 : 18)))].sort((a, b) => a - b)
      const confirmed = await confirmPoolSettings((row) => JSON.stringify([...(row.double_pick_weeks || [])].sort((a, b) => a - b)) === JSON.stringify(expected))
      await loadOverview(selectedWeek)
      if (confirmed) setNotice('Double-pick weeks saved and confirmed after the delayed response.')
      else setError(`${getErrorMessage(e, 'Failed to save double-pick weeks.')} Current database settings were refreshed; review them before retrying.`)
    } finally {
      setSavingDouble(false)
    }
  }

  const toggleDoubleWeek = (week: number) => {
    if (settingsLocked || (pool && week < pool.start_week)) return
    const weeks = new Set(selectedDoubleWeeks)
    if (weeks.has(week)) {
      weeks.delete(week)
    } else {
      weeks.add(week)
    }
    setDoubleWeeksText(Array.from(weeks).sort((a, b) => a - b).join(','))
  }

  const saveMemberLimit = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('Pool settings cannot be changed after the pool has started.')
      return
    }
    const nextLimit = maxMembersPreset === 'unlimited' ? null : parseInt(maxMembersText.trim(), 10)
    if (nextLimit !== null && (!Number.isFinite(nextLimit) || nextLimit < 2 || nextLimit > 500)) {
      setError('Pool capacity must be Unlimited or between 2 and 500 entries.')
      return
    }
    if (nextLimit !== null && nextLimit < entryCount) {
      setError(`Pool capacity cannot be lower than the current entry count (${entryCount}).`)
      return
    }

    setSavingLimit(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_member_limit', {
        p_pool_id: pool.id,
        p_max_members: nextLimit ?? undefined,
      })
      if (error) throw error
      setPool({ ...pool, max_members: nextLimit })
      setNotice('Pool capacity saved.')
    } catch (e: unknown) {
      const confirmed = await confirmPoolSettings((row) => nextLimit === null ? isUnlimitedPoolCapacity(row.max_members) : row.max_members === nextLimit)
      await loadOverview(selectedWeek)
      if (confirmed) setNotice('Pool capacity saved and confirmed after the delayed response.')
      else setError(`${getErrorMessage(e, 'Failed to save pool capacity.')} Current database settings were refreshed; review them before retrying.`)
    } finally {
      setSavingLimit(false)
    }
  }

  const saveEntrySettings = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('Pool settings cannot be changed after the pool has started.')
      return
    }
    const nextEntries = allowMultipleEntriesDraft ? parseInt(maxEntriesPerUserDraft, 10) : 1
    if (!Number.isFinite(nextEntries) || nextEntries < 1 || nextEntries > 10) {
      setError('Entries per user must be between 1 and 10.')
      return
    }

    setSavingEntries(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_entry_settings', {
        p_pool_id: pool.id,
        p_allow_multiple_entries: allowMultipleEntriesDraft,
        p_max_entries_per_user: nextEntries,
      })
      if (error) throw error
      setPool({ ...pool, allow_multiple_entries: allowMultipleEntriesDraft, max_entries_per_user: nextEntries })
      setNotice('Entry settings saved.')
    } catch (e: unknown) {
      const confirmed = await confirmPoolSettings((row) => !!row.allow_multiple_entries === allowMultipleEntriesDraft && row.max_entries_per_user === nextEntries)
      await loadOverview(selectedWeek)
      if (confirmed) setNotice('Entry settings saved and confirmed after the delayed response.')
      else setError(`${getErrorMessage(e, 'Failed to save entry settings.')} Current database settings were refreshed; review them before retrying.`)
    } finally {
      setSavingEntries(false)
    }
  }

  const saveVisibility = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('Pool settings cannot be changed after the pool has started.')
      return
    }
    if (!isPublicDraft && !visibilityPassword.trim()) {
      setError('Enter a pool password before switching this pool to private.')
      return
    }

    setSavingVisibility(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_visibility', {
        p_pool_id: pool.id,
        p_is_public: isPublicDraft,
        p_password: isPublicDraft ? null : visibilityPassword,
      })
      if (error) throw error

      setPool({ ...pool, is_public: isPublicDraft, visibility: isPublicDraft ? 'public' : 'private' })
      setVisibilityPassword('')
      setNotice(isPublicDraft ? 'Pool is now public.' : 'Pool is now private.')
    } catch (e: unknown) {
      const confirmed = await confirmPoolSettings((row) => row.is_public === isPublicDraft)
      await loadOverview(selectedWeek)
      if (confirmed) {
        setVisibilityPassword('')
        setNotice(`Pool visibility saved as ${isPublicDraft ? 'public' : 'private'} and confirmed after the delayed response.`)
      } else {
        setError(`${getErrorMessage(e, 'Failed to save pool visibility.')} Current database settings were refreshed; review them before retrying.`)
      }
    } finally {
      setSavingVisibility(false)
    }
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    const validationError = file ? validatePublicImageUpload(file, 'Pool image') : null
    setError(null)
    setNotice(null)
    if (validationError) {
      setImageError(validationError)
      setImageNotice(null)
      setImageFileDraft(null)
      event.currentTarget.value = ''
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      return
    }
    setImageError(null)
    setImageNotice(null)
    setImageFileDraft(file)
    setImagePreviewDraft((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  const uploadLeagueImage = async (file: File, ownerId: string) => {
    const validationError = validatePublicImageUpload(file, 'Pool image')
    if (validationError) throw new Error(validationError)

    const path = makeStorageObjectPath(ownerId, file)
    const { error: uploadError } = await supabase.storage.from('pool-images').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (uploadError) {
      console.error('Pool image upload failed', uploadError)
      throw new Error('Pool image upload failed')
    }

    const { data } = supabase.storage.from('pool-images').getPublicUrl(path)
    return data.publicUrl
  }

  const imageSaveErrorMessage = (error: unknown) => {
    const message = getErrorMessage(error, 'Pool image could not be saved. Try a different image or add it again in a minute.')
    if (message === 'You do not have permission to do that.') {
      return 'Pool image could not be saved. Make sure you are signed in as a pool admin and try again.'
    }
    if (message === 'Pool image upload failed') {
      return 'Pool image upload failed. Try a different image or add it again in a minute.'
    }
    return message
  }

  const saveImage = async () => {
    if (!pool) return
    if (!imageFileDraft) {
      setImageError('Choose an image file before saving.')
      setImageNotice(null)
      setError(null)
      return
    }
    setSavingImage(true)
    setError(null)
    setNotice(null)
    setImageError(null)
    setImageNotice(null)
    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()
      if (userError || !user) throw new Error('Please sign in again to save this pool image.')

      const nextImage = await uploadLeagueImage(imageFileDraft, user.id)
      const { error } = await supabase.rpc('admin_update_pool_image', {
        p_pool_id: pool.id,
        p_image_url: nextImage,
      })
      if (error) throw error
      setPool({ ...pool, image_url: nextImage || null })
      setImageUrlDraft(nextImage)
      setImageFileDraft(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setImageNotice('Pool image saved.')
    } catch (e: unknown) {
      setImageError(imageSaveErrorMessage(e))
    } finally {
      setSavingImage(false)
    }
  }

  const resetImage = async () => {
    if (!pool) return
    setSavingImage(true)
    setError(null)
    setNotice(null)
    setImageError(null)
    setImageNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_image', {
        p_pool_id: pool.id,
        p_image_url: '',
      })
      if (error) throw error
      setPool({ ...pool, image_url: null })
      setImageUrlDraft('')
      setImageFileDraft(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setImageNotice('Pool image reset to a default.')
    } catch (e: unknown) {
      setImageError(imageSaveErrorMessage(e))
    } finally {
      setSavingImage(false)
    }
  }

  const toggleArchive = async () => {
    if (!pool) return
    if (!pool.archived && !canArchive) {
      setError('An in-progress pool cannot be archived. Wait until a winner is decided or the configured season is complete.')
      return
    }
    setArchiving(true)
    setError(null)
    setNotice(null)
    try {
      if (!pool.archived) {
        const confirmed = await requestConfirm({
          title: 'Archive this pool?',
          message: `Archive ${pool.name}? It will disappear from the active dashboard and stop accepting normal activity. Its members, entries, picks, and history are kept, and you can unarchive it before the season starts.`,
          confirmLabel: 'Archive pool',
        })
        if (!confirmed) return
      }
      const { error } = await supabase.rpc('admin_archive_pool', {
        p_pool_id: pool.id,
        p_archived: !pool.archived,
      })
      if (error) throw error
      setPool({ ...pool, archived: !pool.archived })
      setNotice(pool.archived ? 'Pool unarchived.' : 'Pool archived.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update archive state.'))
    } finally {
      setArchiving(false)
    }
  }

  const saveDraft = (row: AdminRow) =>
    runAction('Save pick', async () => {
      if (!pool) return
      if (hasFinalPick(row)) {
        const team = (draftTeams[rowKey(row)] || finalTeams[rowKey(row)] || '').trim().toUpperCase()
        if (!team) throw new Error('Choose a team before saving this pick.')
        const correctionReason = pickCorrectionReason.trim()
        if (!correctionReason) throw new Error('Enter a reason before changing a locked pick. The reason is saved in the activity log for the dispute record.')
        const confirmed = await requestConfirm({
          title: 'Update locked pick?',
          message: `Change ${entryLabel(row)}'s Pick ${row.slot} for ${weekLabel(selectedWeek)} to ${team}? This clears the old result and re-scores from the new pick.\n\nReason recorded: ${correctionReason}`,
          confirmLabel: 'Update pick',
        })
        if (!confirmed) return 'Pick update canceled.'
        const { error } = await supabase.rpc('admin_override_entry_final_pick', {
          p_pool_id: pool.id,
          p_entry_id: row.entry_id,
          p_week: selectedWeek,
          p_team_abbr: team,
          p_slot: row.slot,
          p_reason: correctionReason,
        })
        if (error) {
          const verified = await supabase.from('pool_picks').select('team_abbr').eq('pool_id', pool.id)
            .eq('entry_id', row.entry_id).eq('week', selectedWeek).eq('slot', row.slot).maybeSingle<{ team_abbr: string }>()
          if (verified.error || verified.data?.team_abbr !== team) throw error
        }
        setPickCorrectionReason('')
        return `Pick saved as ${team} and confirmed in the database.`
      }
      const key = rowKey(row)
      const team = (draftTeams[key] || finalTeams[key] || '').trim().toUpperCase()
      if (!team) {
        if (row.draft_updated_at && !row.draft_team_abbr) {
          throw new Error('This entry has a saved pick, but its team is hidden until lock. Choose a replacement team to change it; leaving this field unchanged will not clear the participant’s pick.')
        }
        const { error } = await supabase.rpc('admin_clear_entry_week_draft_slot', {
          p_pool_id: pool.id,
          p_entry_id: row.entry_id,
          p_week: selectedWeek,
          p_slot: row.slot,
          p_reason: pickCorrectionReason.trim() || 'Commissioner cleared an unlocked draft',
        })
        if (error) {
          const [draft, final] = await Promise.all([
            supabase.from('pool_pick_drafts').select('entry_id').eq('pool_id', pool.id).eq('entry_id', row.entry_id).eq('week', selectedWeek).eq('slot', row.slot).maybeSingle(),
            supabase.from('pool_picks').select('entry_id').eq('pool_id', pool.id).eq('entry_id', row.entry_id).eq('week', selectedWeek).eq('slot', row.slot).maybeSingle(),
          ])
          if (draft.error || final.error || draft.data || final.data) throw error
        }
        return 'Pick cleared and confirmed in the database.'
      }

      const { error } = await supabase.rpc('admin_upsert_entry_draft', {
        p_pool_id: pool.id,
        p_entry_id: row.entry_id,
        p_week: selectedWeek,
        p_team_abbr: team,
        p_slot: row.slot,
        p_reason: pickCorrectionReason.trim() || 'Commissioner updated an unlocked draft',
      })
      if (error) {
        const [draft, final] = await Promise.all([
          supabase.from('pool_pick_drafts').select('team_abbr').eq('pool_id', pool.id).eq('entry_id', row.entry_id).eq('week', selectedWeek).eq('slot', row.slot).maybeSingle<{ team_abbr: string }>(),
          supabase.from('pool_picks').select('team_abbr').eq('pool_id', pool.id).eq('entry_id', row.entry_id).eq('week', selectedWeek).eq('slot', row.slot).maybeSingle<{ team_abbr: string }>(),
        ])
        if (draft.error || final.error || (draft.data?.team_abbr !== team && final.data?.team_abbr !== team)) throw error
      }
      setPickCorrectionReason('')
      return `Pick saved as ${team} and confirmed in the database.`
    })

  const removeMember = (row: AdminRow, entryCount = 1) =>
    runAction('Remove member', async () => {
      if (!pool) return
      if (settingsLocked) {
        throw new Error('Members cannot be removed after the pool has started.')
      }
      const label = memberLabel(row)
      const confirmed = await requestConfirm({
        title: 'Remove member?',
        message: `Permanently remove ${label} from ${pool.name}?\n\nEntries removed: ${entryCount}\n\nThis is only allowed before the pool starts. It deletes every entry and saved pick for this member. The pool invite link remains active, so the member could rejoin while registration is open.`,
        tone: 'danger',
        confirmLabel: 'Remove member',
      })
      if (!confirmed) return 'Remove member canceled.'

      const { error } = await supabase.rpc('admin_remove_pool_member', {
        p_pool_id: pool.id,
        p_profile_id: row.user_id,
      })
      if (error) {
        const verified = await supabase.from('pool_members').select('id').eq('pool_id', pool.id).eq('profile_id', row.user_id).limit(1)
        if (verified.error || (verified.data || []).length > 0) throw error
      }
      return `${label} removed and confirmed in the database.`
    })

  const removeEntry = (row: AdminRow) =>
    runAction('Remove entry', async () => {
      if (!pool) return
      if (settingsLocked) throw new Error('Entries cannot be removed after the pool has started.')
      const label = entryLabel(row)
      const confirmed = await requestConfirm({
        title: 'Remove entry?',
        message: `Permanently remove ${label} from ${pool.name}? This is only allowed before the pool starts. It deletes Entry #${row.entry_number || 1} and its saved picks. The member's other entries stay in the pool.`,
        tone: 'danger',
        confirmLabel: 'Remove entry',
      })
      if (!confirmed) return 'Remove entry canceled.'

      const { error } = await supabase.rpc('admin_remove_pool_entry', {
        p_pool_id: pool.id,
        p_entry_id: row.entry_id,
      })
      if (error) {
        const verified = await supabase.from('pool_members').select('id').eq('pool_id', pool.id).eq('id', row.entry_id).maybeSingle()
        if (verified.error || verified.data) throw error
      }
      return `${label} removed and confirmed in the database.`
    })

  const copyText = async (text: string, successMessage: string) => {
    if (!text) return
    setError(null)
    setNotice(null)
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        throw new Error('Clipboard is not available.')
      }
      await navigator.clipboard.writeText(text)
      setNotice(successMessage)
    } catch {
      setError('Could not copy automatically. Select and copy the invite link manually.')
    }
  }

  const copyReinviteLink = () => copyText(inviteUrl, 'Invite link copied.')
  const copyReinviteMessage = () => copyText(reinviteMessage, 'Invite message copied.')

  const shareReinviteMessage = async () => {
    if (!pool || !reinviteMessage) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Join ${pool.name}`,
          text: reinviteMessage,
          url: inviteUrl,
        })
        setNotice('Invite ready to share.')
        return
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return
      }
    }
    await copyReinviteMessage()
  }

  const toggleTestMode = async () => {
    if (!pool || !isSuperAdmin) return
    const enabling = !pool.test_mode
    const confirmed = await requestConfirm({
      title: enabling ? 'Enable test mode?' : 'Disable test mode?',
      message: enabling
        ? `Enable test mode for "${pool.name}"?\n\nOnly the superadmin account will see these controls. Members and pool admins will not see test-mode labels.`
        : `Disable test mode for "${pool.name}"?\n\nExisting fake season data will stay stored, but the simulator controls will be hidden until test mode is enabled again.`,
      confirmLabel: enabling ? 'Enable test mode' : 'Disable test mode',
    })
    if (!confirmed) return
    setRunningAction('test-mode')
    setError(null)
    setNotice(null)
    try {
      const { data, error: toggleErr } = await supabase.rpc('superadmin_set_pool_test_mode', {
        p_pool_id: pool.id,
        p_enabled: enabling,
      })
      if (toggleErr) throw toggleErr
      setNotice(String(data || 'Test mode updated.'))
      await loadOverview(selectedWeek)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update test mode.'))
    } finally {
      setRunningAction(null)
    }
  }

  const saveTestClock = async () => {
    if (!pool || !isSuperAdmin) return
    const week = parseInt(testWeek, 10)
    const stage = testClockStage
    setRunningAction('test-clock')
    setError(null)
    setNotice(null)
    try {
      const { data, error: clockErr } = await supabase.rpc('superadmin_set_test_pool_clock', {
        p_pool_id: pool.id,
        p_week: week,
        p_stage: stage,
      })
      if (clockErr) throw clockErr
      setNotice(String(data || 'Test clock updated.'))
      setSelectedWeek(week)
      await loadOverview(week)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to set test clock.'))
    } finally {
      setRunningAction(null)
    }
  }

  const saveTestOutcome = async (game: TestGameOption, outcome: string) => {
    if (!pool || !isSuperAdmin) return
    const week = parseInt(testWeek, 10)
    setRunningAction(`test-result-${game.game_id}`)
    setError(null)
    setNotice(null)
    try {
      const { error: resultErr } = await supabase.rpc('superadmin_set_test_game_outcome', {
        p_pool_id: pool.id,
        p_week: week,
        p_away_team: game.away_team,
        p_home_team: game.home_team,
        p_outcome: outcome,
      })
      if (resultErr) throw resultErr
      await loadTestOptions(pool.id, testWeek)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save fake result.'))
    } finally {
      setRunningAction(null)
    }
  }

  const runTestAction = async (action: 'randomize-outcomes' | 'score' | 'clear' | 'reset') => {
    if (!pool || !isSuperAdmin) return
    const week = parseInt(testWeek, 10)
    const currentTestWeek = pool.test_current_week || pool.start_week || 1
    if (action === 'score' && week !== currentTestWeek) {
      setError(`This pool is currently on ${weekLabel(currentTestWeek)}. Use the Advanced week override before scoring another week.`)
      return
    }
    const maxTestWeek = maxTestWeekForPool(pool)
    const nextWeek = Math.min(maxTestWeek, week + 1)
    const selectedLabel = weekLabel(week)
    const nextLabel = weekLabel(nextWeek)
    const copy: Record<typeof action, string> = {
      'randomize-outcomes': `Randomize empty game winners for ${selectedLabel} in ${pool.name}? Existing choices stay as-is.`,
      score: `Score ${selectedLabel} and advance ${pool.name} to ${nextLabel}?\n\nThis grades submitted picks, counts missed picks as losses, updates standings, clears impossible future picks after elimination, and advances only this test pool.`,
      clear: `Unscore ${selectedLabel} for ${pool.name}?\n\nPicks stay in place. This week's fake outcomes, no-pick losses, and scoring are removed, then standings are rebuilt.`,
      reset: `Reset the full test run for ${pool.name}?\n\nMembers and settings stay. Every entry is restored to alive, and the winner, test picks, fake outcomes, and test standings are cleared.`,
    }
    if (action === 'score' && testGamesNeedingOutcome.length > 0) {
      setError(
        `Set fake outcomes for picked matchups first: ${testGamesNeedingOutcome
          .map((game) => `${game.away_team} @ ${game.home_team}`)
          .slice(0, 4)
          .join(', ')}.`,
      )
      return
    }
    const confirmed = await requestConfirm({
      title:
        action === 'score'
          ? 'Score and advance?'
          : action === 'clear'
            ? 'Unscore this week?'
            : action === 'reset'
              ? 'Reset simulation?'
              : 'Randomize empty winners?',
      message: copy[action],
      tone: action === 'reset' ? 'danger' : 'warning',
      confirmLabel:
        action === 'score'
          ? 'Score & advance'
          : action === 'clear'
            ? 'Unscore week'
            : action === 'reset'
              ? 'Reset test run'
              : 'Randomize winners',
    })
    if (!confirmed) return
    setRunningAction(`test-${action}`)
    setError(null)
    setNotice(null)
    try {
      let response: { data: unknown; error: unknown }
      if (action === 'randomize-outcomes') {
        response = await supabase.rpc('superadmin_randomize_test_week_outcomes', { p_pool_id: pool.id, p_week: week })
      } else if (action === 'score') {
        response = await supabase.rpc('superadmin_score_test_pool_week', { p_pool_id: pool.id, p_week: week })
      } else if (action === 'clear') {
        response = await supabase.rpc('superadmin_clear_test_week_results', { p_pool_id: pool.id, p_week: week })
      } else {
        response = await supabase.rpc('superadmin_reset_test_pool', { p_pool_id: pool.id })
      }
      if (response.error) throw response.error
      setNotice(String(response.data || 'Test action complete.'))
      const reloadWeek =
        action === 'reset'
          ? pool.start_week
          : action === 'score'
            ? nextWeek
            : week
      setSelectedWeek(reloadWeek)
      await loadOverview(reloadWeek)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Test action failed.'))
    } finally {
      setRunningAction(null)
    }
  }

  const runTestShortcut = async (action: 'start-week' | 'finish-week') => {
    if (!pool || !isSuperAdmin) return
    const week = Number.parseInt(testWeek, 10)
    if (!Number.isFinite(week)) return
    const currentTestWeek = pool.test_current_week || pool.start_week || 1
    if (week !== currentTestWeek) {
      setError(`This pool is currently on ${weekLabel(currentTestWeek)}. Use the Advanced week override before changing another week.`)
      return
    }

    if (action === 'finish-week') {
      const confirmed = await requestConfirm({
        title: `Finish ${weekLabel(week)}?`,
        message: `Move the clock past the final game, randomly fill any missing outcomes for games with picks, then score and advance ${pool.name}.\n\nMissed pick slots count as losses.`,
        confirmLabel: 'Finish & score',
        tone: 'warning',
      })
      if (!confirmed) return
    }

    setRunningAction(`test-${action}`)
    setError(null)
    setNotice(null)
    try {
      if (action === 'start-week') {
        const { error: weekErr } = await supabase.rpc('superadmin_set_test_pool_week', { p_pool_id: pool.id, p_week: week })
        if (weekErr) throw weekErr
        const { data, error: clockErr } = await supabase.rpc('superadmin_set_test_pool_clock', {
          p_pool_id: pool.id,
          p_week: week,
          p_stage: 'before_week',
        })
        if (clockErr) throw clockErr
        setTestClockStage('before_week')
        setNotice(String(data || `${weekLabel(week)} is ready for picks.`))
        setSelectedWeek(week)
        await loadOverview(week)
        return
      }

      const { error: clockErr } = await supabase.rpc('superadmin_set_test_pool_clock', {
        p_pool_id: pool.id,
        p_week: week,
        p_stage: 'week_done',
      })
      if (clockErr) throw clockErr
      const { error: outcomeErr } = await supabase.rpc('superadmin_randomize_test_week_outcomes', { p_pool_id: pool.id, p_week: week })
      if (outcomeErr) throw outcomeErr
      const { data, error: scoreErr } = await supabase.rpc('superadmin_score_test_pool_week', { p_pool_id: pool.id, p_week: week })
      if (scoreErr) throw scoreErr
      const reloadWeek = Math.min(maxTestWeekForPool(pool), week + 1)
      setTestClockStage('before_week')
      setSelectedWeek(reloadWeek)
      setNotice(String(data || `${weekLabel(week)} scored.`))
      await loadOverview(reloadWeek)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Test shortcut failed.'))
    } finally {
      setRunningAction(null)
    }
  }

  const overrideTestWeek = async () => {
    if (!pool || !isSuperAdmin || !advancedTestWeekOverride) return
    const week = Number.parseInt(testWeek, 10)
    const currentTestWeek = pool.test_current_week || pool.start_week || 1
    if (!Number.isFinite(week) || week === currentTestWeek) return
    const confirmed = await requestConfirm({
      title: `Jump from ${weekLabel(currentTestWeek)} to ${weekLabel(week)}?`,
      message: `Advanced override changes the simulated week without scoring any skipped weeks. Existing picks, results, and standings remain in place. Use this only to repair or intentionally construct a test scenario.`,
      confirmLabel: 'Override test week',
      tone: 'danger',
    })
    if (!confirmed) return
    setRunningAction('test-week-override')
    setError(null)
    setNotice(null)
    try {
      const reason = `Manual Test Admin override from Week ${currentTestWeek} to Week ${week}.`
      const { data, error: overrideErr } = await supabase.rpc('superadmin_override_test_pool_week', {
        p_pool_id: pool.id,
        p_week: week,
        p_reason: reason,
      })
      if (overrideErr) throw overrideErr
      setNotice(String(data || `${weekLabel(week)} is now the current test week.`))
      setSelectedWeek(week)
      await loadOverview(week)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Advanced week override failed.'))
    } finally {
      setRunningAction(null)
    }
  }

  const repairScoringState = async () => {
    if (!pool) return
    const confirmed = await requestConfirm({
      title: 'Repair scoring state?',
      message: `Rebuild scoring for ${pool.name} from the pick ledger?\n\nThis recalculates wins, counted losses, mulligans remaining, alive/eliminated status, and clears picks after an entry has been eliminated. It only affects this pool.`,
      confirmLabel: 'Repair scoring',
      tone: 'warning',
    })
    if (!confirmed) return
    await runAction('Repair scoring state', async () => {
      const { data, error: repairErr } = await supabase.rpc('admin_repair_pool_scoring_state', {
        p_pool_id: pool.id,
      })
      if (repairErr) throw repairErr
      return String(data || 'Scoring state repaired.')
    })
  }

  if (loading) {
    return (
      <main className="min-h-[70vh] bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-md rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">
          Verifying commissioner access…
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-[70vh] bg-gray-50 py-8 px-4">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Pool Admin</h1>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-gray-600">{pool ? `${pool.name} - ${pool.season ?? 'Season not set'}` : 'Pool controls'}</p>
              {lifecycle && (
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${lifecycle.className}`}>
                  {lifecycle.label}
                </span>
              )}
              {isPoolJoinable && (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  Free Pool
                </span>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {canInvite && (
              <button onClick={() => setInviteOpen(true)} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700">
                Invite
              </button>
            )}
            <Link href={`/pools?pool=${poolId}`} className="rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200">
              Back to Pool
            </Link>
            <button
              onClick={async () => {
                await loadOverview(selectedWeek)
                setNotice('Admin data refreshed.')
              }}
              disabled={refreshing}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {loading && <p>Loading...</p>}
        {!loading && error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!loading && notice && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

        {!loading && pool && isOwner && (
          <div className="space-y-5">
            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Entries</div>
                <div className="text-2xl font-bold">{poolEntryCountLabel(entryCount, pool.max_members)}</div>
                <div className="text-xs text-gray-500">{uniqueMemberCount} unique members</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Alive</div>
                <div className="text-2xl font-bold text-emerald-700">{stats.alive}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Eliminated</div>
                <div className="text-2xl font-bold text-red-700">{stats.eliminated}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Pool Stage</div>
                <div className="text-2xl font-bold">{lifecycle?.label || '-'}</div>
                {lifecycle && <div className="text-xs text-gray-500">{lifecycle.description}</div>}
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Access</div>
                <div className={`text-sm font-semibold ${isPoolJoinable ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isPoolJoinable ? 'Joining is immediate' : 'Not accepting members'}
                </div>
                {isPoolJoinable && <div className="text-xs text-gray-500">No approval queue</div>}
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Visibility</div>
                <div className="text-sm font-semibold">{pool.is_public ? 'Public search' : 'Private password'}</div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Settings lock</div>
                <div className={`text-sm font-semibold ${settingsLocked ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {settingsLocked ? 'Locked' : `Open until ${fmtShort(poolStartAt)}`}
                </div>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Double-pick weeks</div>
                <div className="text-sm font-semibold">{doubleWeekCount ? `${doubleWeekCount} selected` : 'None'}</div>
              </div>
            </section>

            {!settingsLocked && (
              <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-950">Preseason commissioner checklist</h2>
                    <p className="mt-1 text-sm text-slate-600">There is no Activate button. This pool starts automatically at {poolStartAt ? fmt(poolStartAt) : `the first kickoff of Week ${pool.start_week}`}.</p>
                  </div>
                  {canInvite && <button type="button" onClick={() => setInviteOpen(true)} className="rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800">Invite players</button>}
                </div>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                  <a href="#commissioner-settings" className="rounded-md border border-blue-200 bg-white p-3 font-medium text-blue-800 hover:bg-blue-50">1. Review every rule</a>
                  <a href="#commissioner-members" className="rounded-md border border-blue-200 bg-white p-3 font-medium text-blue-800 hover:bg-blue-50">2. Confirm {entryCount} {entryCount === 1 ? 'entry' : 'entries'} from {uniqueMemberCount} {uniqueMemberCount === 1 ? 'person' : 'people'}</a>
                  <Link href={`/pools?pool=${pool.id}`} className="rounded-md border border-blue-200 bg-white p-3 font-medium text-blue-800 hover:bg-blue-50">3. Preview picks and standings</Link>
                </div>
                <p className="mt-3 text-xs text-slate-600">Public players join immediately from search or an invite. Private players join immediately after entering the password. Remove mistakes before kickoff; member and entry removal lock when the pool starts.</p>
              </section>
            )}

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Scoring Confidence</h2>
                  <p className="text-sm text-gray-600">Checks for impossible scoring states in this pool before they become standings problems.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => loadIntegrityChecks(pool.id)}
                    disabled={integrityLoading}
                    className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                  >
                    {integrityLoading ? 'Checking...' : 'Run checks'}
                  </button>
                  <button
                    type="button"
                    onClick={repairScoringState}
                    disabled={!!runningAction}
                    className="rounded-md bg-slate-950 px-3 py-1.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                  >
                    Repair this pool
                  </button>
                </div>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className={`rounded-lg border p-3 ${integrityIssueCount === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Issues Found</div>
                  <div className="mt-1 text-2xl font-bold text-slate-950">{integrityLoading ? '-' : integrityIssueCount}</div>
                </div>
                <div className={`rounded-lg border p-3 ${integrityFailCount === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Failed Checks</div>
                  <div className="mt-1 text-2xl font-bold text-slate-950">{integrityLoading ? '-' : integrityFailCount}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Last Refresh</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">{refreshing || integrityLoading ? 'Refreshing...' : 'Current page load'}</div>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {integrityRows.map((row) => (
                  <div key={row.check_name} className={`rounded-md border p-3 ${integrityStatusClass(row.status)}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${integrityDotClass(row.status)}`} />
                          <span className="text-sm font-semibold text-slate-950">{checkNameLabel(row.check_name)}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-700">{row.detail}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold uppercase text-slate-700">{row.status}</span>
                    </div>
                  </div>
                ))}
                {!integrityLoading && integrityRows.length === 0 && (
                  <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No checks have been loaded yet.</p>
                )}
              </div>
            </section>

            {pool.cloned_from_pool_id && (
              <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Next Season</p>
                    <h2 className="text-lg font-semibold text-slate-950">Bring back last season&apos;s group</h2>
                    <p className="mt-1 max-w-3xl text-sm text-slate-700">
                      This pool was created from {reinviteStats.sourceName || 'an archived pool'}. Members are not added automatically, so send them this invite when you want them back for the new season.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={copyReinviteLink}
                      disabled={!canReinvite || !inviteUrl}
                      className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      onClick={copyReinviteMessage}
                      disabled={!canReinvite || !reinviteMessage}
                      className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      Copy message
                    </button>
                    <button
                      type="button"
                      onClick={shareReinviteMessage}
                      disabled={!canReinvite || !reinviteMessage}
                      className="rounded-md bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-black disabled:opacity-50"
                    >
                      Share
                    </button>
                  </div>
                </div>

                {!canReinvite && (
                  <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    Invites are closed because this pool has started or is not accepting members.
                  </p>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <ReinviteStat label="Last season members" value={reinviteLoading ? 'Loading...' : String(reinviteRows.length)} />
                  <ReinviteStat label="Joined this season" value={reinviteLoading ? '-' : String(reinviteStats.joined)} />
                  <ReinviteStat label="Still missing" value={reinviteLoading ? '-' : String(reinviteStats.missing)} />
                </div>

                <div className="mt-4 rounded-md border border-emerald-200 bg-white p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Invite link</div>
                  <div className="mt-1 break-all text-sm font-medium text-slate-900">{inviteUrl || 'Invite link unavailable.'}</div>
                  {!pool.is_public && <p className="mt-2 text-xs font-medium text-amber-700">This pool is private. Send the password separately.</p>}
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-950">Previous members</h3>
                    <button
                      type="button"
                      onClick={() => loadReinviteOverview(pool.id)}
                      disabled={reinviteLoading}
                      className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                    >
                      {reinviteLoading ? 'Refreshing...' : 'Refresh list'}
                    </button>
                  </div>
                  {reinviteRows.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {reinviteRows.map((row) => (
                        <ReinviteMember key={row.profile_id} row={row} />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-emerald-200 bg-white p-3 text-sm text-slate-600">
                      {reinviteLoading ? 'Loading previous members...' : 'No previous members found for this archived pool.'}
                    </p>
                  )}
                </div>
              </section>
            )}

            {isSuperAdmin && (
              <section className={`rounded-lg border p-4 ${pool.test_mode ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Superadmin Only</p>
                    <h2 className="text-lg font-semibold text-slate-950">Test Season Controls</h2>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">
                      Simulate this pool week by week using the real schedule. These controls only affect this pool and only the superadmin account can see them.
                    </p>
                  </div>
                  <button
                    onClick={toggleTestMode}
                    disabled={runningAction === 'test-mode'}
                    className={`rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50 ${
                      pool.test_mode ? 'bg-violet-700 text-white hover:bg-violet-800' : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    {runningAction === 'test-mode' ? 'Saving...' : pool.test_mode ? 'Test Mode On' : 'Enable Test Mode'}
                  </button>
                </div>

                {pool.test_mode ? (
                  <>
                    <div className="mb-4 rounded-md border border-violet-300 bg-violet-900 p-4 text-white">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-violet-200">Simulation status</p>
                          <h3 className="mt-1 text-lg font-semibold">
                            {weekLabel(pool.test_current_week || pool.start_week)} · {pool.double_pick_weeks?.includes(pool.test_current_week || pool.start_week) ? '2 picks required' : '1 pick required'}
                          </h3>
                          <p className="mt-1 text-sm text-violet-100">Test clock: {fmt(pool.test_now_at)}</p>
                        </div>
                        <Link
                          href={`/pools?pool=${pool.id}`}
                          className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-violet-800 hover:bg-violet-50"
                        >
                          Open player view
                        </Link>
                      </div>
                    </div>

                    <div className="mb-4 grid gap-2 rounded-md border border-violet-200 bg-white p-3 text-sm text-slate-700 md:grid-cols-3">
                      <div><span className="font-semibold text-slate-950">1. Start week.</span> This opens picks at the beginning of the selected week.</div>
                      <div><span className="font-semibold text-slate-950">2. Test locks.</span> Use the clock buttons below whenever you need them.</div>
                      <div><span className="font-semibold text-slate-950">3. Finish & score.</span> Missing winners can be filled automatically.</div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(240px,320px)_1fr]">
                      <div className="rounded-md border border-violet-200 bg-white p-3">
                        <label className="text-sm font-semibold text-slate-800">
                          Current test week
                          <select
                            value={testWeek}
                            onChange={(event) => setTestWeek(event.target.value)}
                            disabled={!advancedTestWeekOverride}
                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            {testWeekOptions.map((week) => (
                              <option key={week} value={week}>{weekLabel(week)}</option>
                            ))}
                          </select>
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            onClick={() => {
                              const currentTestWeek = pool.test_current_week || pool.start_week || 1
                              if (parsedTestWeek === currentTestWeek) void runTestShortcut('start-week')
                              else void overrideTestWeek()
                            }}
                            disabled={!!runningAction}
                            className={`rounded-md px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
                              parsedTestWeek === (pool.test_current_week || pool.start_week || 1)
                                ? 'bg-slate-900 hover:bg-slate-800'
                                : 'bg-amber-700 hover:bg-amber-800'
                            }`}
                          >
                            {runningAction === 'test-start-week'
                              ? 'Resetting...'
                              : runningAction === 'test-week-override'
                                ? 'Overriding...'
                                : parsedTestWeek === (pool.test_current_week || pool.start_week || 1)
                                  ? 'Reset Week Clock'
                                  : 'Override Test Week'}
                          </button>
                          <button
                            onClick={() => loadTestOptions(pool.id, testWeek)}
                            disabled={testToolsLoading}
                            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {testToolsLoading ? 'Loading...' : 'Refresh'}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">Normal testing advances one week at a time. Resetting moves the current week back before its first kickoff.</p>
                        <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                          <input
                            type="checkbox"
                            checked={advancedTestWeekOverride}
                            onChange={(event) => {
                              const enabled = event.target.checked
                              setAdvancedTestWeekOverride(enabled)
                              if (!enabled) setTestWeek(String(pool.test_current_week || pool.start_week || 1))
                            }}
                            className="mt-0.5"
                          />
                          <span><strong>Advanced week override.</strong> Allows a deliberate jump without scoring skipped weeks. Existing competition history is not erased.</span>
                        </label>
                      </div>

                      <div className="rounded-md border border-violet-200 bg-white p-3">
                        <label className="text-sm font-semibold text-slate-800">
                          Simulated time
                          <select
                            value={testClockStage}
                            onChange={(event) => setTestClockStage(event.target.value as (typeof TEST_CLOCK_STAGES)[number]['value'])}
                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            {TEST_CLOCK_STAGES.map((stage) => (
                              <option key={stage.value} value={stage.value}>
                                {stage.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="mt-2 text-xs text-slate-600">
                          {TEST_CLOCK_STAGES.find((stage) => stage.value === testClockStage)?.description}
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                          {TEST_CLOCK_STAGES.map((stage) => (
                            <button
                              key={stage.value}
                              type="button"
                              onClick={() => setTestClockStage(stage.value)}
                              aria-pressed={testClockStage === stage.value}
                              className={`rounded-md px-2 py-1.5 text-xs font-semibold ${
                                testClockStage === stage.value
                                  ? 'bg-violet-700 text-white'
                                  : 'bg-violet-50 text-violet-800 hover:bg-violet-100'
                              }`}
                            >
                              {stage.label.replace('After ', '').replace('Before week starts', 'Before week')}
                            </button>
                          ))}
                        </div>
                        {pool.test_now_at && (
                          <p className="mt-2 rounded-md bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800">
                            Current clock: {fmt(pool.test_now_at)}
                          </p>
                        )}
                        <button
                          onClick={saveTestClock}
                          disabled={runningAction === 'test-clock'}
                          className="mt-3 w-full rounded-md bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                        >
                          {runningAction === 'test-clock' ? 'Setting clock...' : 'Set Test Clock'}
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 lg:col-span-2">
                        <InfoTile label="Pick slots filled" value={`${testPicksSubmitted}/${testPicksRequired}`} />
                        <InfoTile label="Games this week" value={String(testGames.length)} />
                        <InfoTile label="Games with picks" value={String(testGamesWithPicks.length)} />
                        <InfoTile label="Winners set" value={`${testGamesWithOutcomes.length}/${testGames.length || 0}`} />
                        <InfoTile label="Need winner" value={String(testGamesNeedingOutcome.length)} />
                      </div>
                    </div>

                    {testGamesNeedingOutcome.length > 0 && (
                      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Before you score and advance, set winners for: {testGamesNeedingOutcome.map((game) => `${game.away_team} @ ${game.home_team}`).slice(0, 6).join(', ')}.
                      </p>
                    )}

                    {testPickSlotsMissing > 0 && (
                      <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                        {testPickSlotsMissing} pick {testPickSlotsMissing === 1 ? 'slot is' : 'slots are'} still empty. You can still score, but every empty slot counts as a loss.
                      </p>
                    )}

                    <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-emerald-950">Done testing picks for {weekLabel(parsedTestWeek)}?</h3>
                          <p className="mt-1 text-sm text-emerald-800">One click moves past the final game, fills missing picked-game winners randomly, scores, and advances.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => runTestShortcut('finish-week')}
                          disabled={!!runningAction}
                          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                        >
                          {runningAction === 'test-finish-week' ? 'Finishing...' : 'Finish Week & Score'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <TestActionButton
                        title="Randomize Empty Winners"
                        description="Choose winners only for games that are still blank."
                        onClick={() => runTestAction('randomize-outcomes')}
                        disabled={!!runningAction}
                        tone="indigo"
                      />
                      <TestActionButton
                        title="Score & Advance"
                        description="Grade picks, count missed picks, and move forward."
                        onClick={() => runTestAction('score')}
                        disabled={!!runningAction || testGamesNeedingOutcome.length > 0}
                        tone="emerald"
                      />
                      <TestActionButton
                        title="Unscore Selected Week"
                        description="Remove this week's fake results and scoring only."
                        onClick={() => runTestAction('clear')}
                        disabled={!!runningAction}
                        tone="slate"
                      />
                      <TestActionButton
                        title="Reset Test Run"
                        description="Clear the full fake season for this pool."
                        onClick={() => runTestAction('reset')}
                        disabled={!!runningAction}
                        tone="red"
                      />
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-lg border border-violet-200 bg-white">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-violet-50 text-slate-700">
                          <tr>
                            <th className="border-b border-violet-100 p-2 text-left">Matchup</th>
                            <th className="border-b border-violet-100 p-2 text-left">Kickoff</th>
                            <th className="border-b border-violet-100 p-2 text-left">Pick split</th>
                            <th className="border-b border-violet-100 p-2 text-left">Winner</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testGames.map((game) => (
                            <tr key={game.game_id} className="hover:bg-slate-50">
                              <td className="border-b border-slate-100 p-2">
                                <div className="font-semibold">{game.away_team} @ {game.home_team}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                  <span>{weekLabel(game.week)}</span>
                                  {(game.total_pick_count ?? game.away_pick_count + game.home_pick_count) > 0 && (
                                    <span className={`rounded-full px-2 py-0.5 font-semibold ${game.needs_outcome ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                      {game.needs_outcome ? 'Needs winner' : 'Ready'}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="border-b border-slate-100 p-2">{fmt(game.game_time)}</td>
                              <td className="border-b border-slate-100 p-2">
                                <div>{game.away_team}: {game.away_pick_count} / {game.home_team}: {game.home_pick_count}</div>
                                <div className="text-xs text-slate-500">Total picks: {game.total_pick_count ?? game.away_pick_count + game.home_pick_count}</div>
                              </td>
                              <td className="border-b border-slate-100 p-2">
                                <select
                                  value={game.fake_outcome || ''}
                                  onChange={(event) => saveTestOutcome(game, event.target.value)}
                                  disabled={!!runningAction}
                                  className="w-full min-w-36 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                                >
                                  <option value="">Winner not set</option>
                                  <option value="away">{game.away_team} wins</option>
                                  <option value="home">{game.home_team} wins</option>
                                  <option value="tie">Tie</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                          {testGames.length === 0 && (
                            <tr>
                              <td colSpan={4} className="p-4 text-sm text-slate-500">
                                No matchups found for this week yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                    Enable test season controls when you want this pool to behave like future weeks without waiting for the real NFL calendar.
                  </p>
                )}
              </section>
            )}

            <section id="commissioner-settings" className="scroll-mt-4 rounded-lg border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Setup & Rules</h2>
                  <p className="text-sm text-gray-600">Review and save competitive rules, access, entries, appearance, and double-pick weeks before the automatic start.</p>
                </div>
                <button
                  onClick={toggleArchive}
                  disabled={archiving || (!pool.archived && !canArchive)}
                  title={!pool.archived && !canArchive ? 'In-progress pools cannot be archived.' : undefined}
                  className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {archiving ? 'Updating...' : pool.archived ? 'Unarchive Pool' : settingsLocked ? 'Archive Completed Pool' : 'Archive Before Start'}
                </button>
              </div>
              {settingsLocked && (
                <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Competitive settings are locked because the first kickoff has passed. Start week, deadlines, mulligans, tie scoring, season length, entry limits, visibility, password, additional rules, and double-pick weeks cannot change, so historical picks and standings cannot be silently regraded. You can still change the pool image, review members, check scoring, and make logged commissioner pick corrections with a reason.
                </p>
              )}
              {!settingsLocked && poolStartAt && (
                <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Setup is still open. The pool starts automatically and competitive settings lock at {fmt(poolStartAt)}. Changes apply to every existing entry. Saved picks stay in place when compatible; limits cannot be reduced below current entries, and moving the start later is blocked if it would discard a picked week.
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(220px,320px)_minmax(240px,320px)_minmax(260px,360px)_1fr]">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 lg:col-span-2 xl:col-span-4">
                  <label className="mb-1 block text-sm font-medium">Pool image</label>
                  <div className="grid gap-3 md:grid-cols-[120px_1fr_auto] md:items-center">
                    <div className="h-20 overflow-hidden rounded-md border border-slate-200 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagePreviewDraft || poolImageUrl({ id: pool.id, name: pool.name, image_url: imageUrlDraft })} alt="" className="h-full w-full object-cover" />
                    </div>
                    <div>
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/pjpeg,image/webp,image/gif"
                        onChange={handleImageChange}
                        disabled={savingImage}
                        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
                      />
                      <p className="mt-1 text-xs text-gray-600">Upload a logo or pool image up to 5 MB.</p>
                      {imageFileDraft && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                          <span className="font-medium text-slate-800">{imageFileDraft.name}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setImageFileDraft(null)
                              if (imageInputRef.current) imageInputRef.current.value = ''
                              setImageError(null)
                              setImageNotice(null)
                              setImagePreviewDraft((prev) => {
                                if (prev) URL.revokeObjectURL(prev)
                                return null
                              })
                            }}
                            disabled={savingImage}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Remove selected image
                          </button>
                        </div>
                      )}
                      {imageError && (
                        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{imageError}</p>
                      )}
                      {imageNotice && (
                        <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{imageNotice}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 md:flex-col">
                      <button onClick={saveImage} disabled={savingImage || !imageFileDraft} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                        {savingImage ? 'Saving...' : 'Save image'}
                      </button>
                      <button onClick={resetImage} disabled={savingImage} className="rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-800 hover:bg-gray-200 disabled:opacity-50">
                        Use default
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-blue-200 bg-blue-50 p-4 lg:col-span-2 xl:col-span-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-950">Core survivor rules</h3>
                      <p className="mt-1 text-sm text-slate-600">These rules affect scoring for every entry. You can correct them before the first kickoff; after that they lock and existing competition is protected.</p>
                    </div>
                    <button
                      type="button"
                      onClick={saveCoreRules}
                      disabled={savingCoreRules || settingsLocked || !coreRulesChanged}
                      className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                    >
                      {savingCoreRules ? 'Saving rules...' : coreRulesChanged ? 'Save rule changes' : 'Rules saved'}
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <label className="text-sm font-medium text-slate-800">
                      Start week
                      <select value={startWeekDraft} onChange={(e) => setStartWeekDraft(e.target.value)} disabled={settingsLocked} className="mt-1 w-full rounded-md border bg-white px-3 py-2 disabled:bg-slate-100">
                        {REGULAR_SEASON_WEEKS.map((week) => <option key={week} value={week}>Week {week}</option>)}
                      </select>
                      <span className="mt-1 block text-xs font-normal text-slate-600">Earlier weeks do not count. Moving it later is blocked if picks already exist in a week that would be skipped.</span>
                    </label>
                    <label className="text-sm font-medium text-slate-800">
                      Mulligans (losses allowed)
                      <select value={mulligansDraft} onChange={(e) => setMulligansDraft(e.target.value)} disabled={settingsLocked} className="mt-1 w-full rounded-md border bg-white px-3 py-2 disabled:bg-slate-100">
                        <option value="0">0 — first loss eliminates</option>
                        <option value="1">1 — second loss eliminates</option>
                        <option value="2">2 — third loss eliminates</option>
                      </select>
                      <span className="mt-1 block text-xs font-normal text-slate-600">Tracked independently for each entry.</span>
                    </label>
                    <label className="text-sm font-medium text-slate-800">
                      NFL tie counts as
                      <select value={tieRuleDraft} onChange={(e) => setTieRuleDraft(e.target.value as 'win' | 'loss')} disabled={settingsLocked} className="mt-1 w-full rounded-md border bg-white px-3 py-2 disabled:bg-slate-100">
                        <option value="loss">Loss</option>
                        <option value="win">Win</option>
                      </select>
                      <span className="mt-1 block text-xs font-normal text-slate-600">This grades an NFL tie; it is not a winner tiebreaker.</span>
                    </label>
                    <label className="text-sm font-medium text-slate-800">
                      Pick deadline
                      <select value={deadlineModeDraft} onChange={(e) => setDeadlineModeDraft(e.target.value as 'fixed' | 'rolling')} disabled={settingsLocked} className="mt-1 w-full rounded-md border bg-white px-3 py-2 disabled:bg-slate-100">
                        <option value="fixed">Sunday 1 PM ET</option>
                        <option value="rolling">Rolling — each game locks at kickoff</option>
                      </select>
                      <span className="mt-1 block text-xs font-normal text-slate-600">Earlier games always lock at kickoff. The server clock is authoritative.</span>
                    </label>
                    <label className="text-sm font-medium text-slate-800">
                      Season length
                      <select value={includePlayoffsDraft ? 'playoffs' : 'regular'} onChange={(e) => setIncludePlayoffsDraft(e.target.value === 'playoffs')} disabled={settingsLocked} className="mt-1 w-full rounded-md border bg-white px-3 py-2 disabled:bg-slate-100">
                        <option value="regular">Regular season</option>
                        <option value="playoffs">Regular season and playoffs</option>
                      </select>
                      <span className="mt-1 block text-xs font-normal text-slate-600">Playoff team history is separate from regular-season team history.</span>
                    </label>
                    <label className="text-sm font-medium text-slate-800 md:col-span-2 xl:col-span-1">
                      Additional rules
                      <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} maxLength={2000} rows={4} disabled={settingsLocked} className="mt-1 w-full rounded-md border bg-white px-3 py-2 disabled:bg-slate-100" placeholder="Prize split, dispute process, commissioner contact..." />
                      <span className="mt-1 block text-xs font-normal text-slate-600">Shown to players; does not change automated scoring. {notesDraft.length}/2,000</span>
                    </label>
                  </div>
                  {coreRulesChanged && !settingsLocked && <p className="mt-3 text-sm font-medium text-amber-700">You have unsaved rule changes.</p>}
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 lg:col-span-2 xl:col-span-4">
                  <label className="mb-1 block text-sm font-medium">Pool capacity</label>
                  <div className="flex gap-2">
                    <select
                      value={maxMembersPreset}
                      onChange={(e) => {
                        setMaxMembersPreset(e.target.value)
                        if (e.target.value !== 'custom') setMaxMembersText(e.target.value)
                      }}
                      disabled={settingsLocked}
                      className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      <option value="unlimited">Unlimited</option>
                      {MEMBER_LIMIT_OPTIONS.map((limit) => (
                        <option key={limit} value={String(limit)}>{limit} entries</option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                    {maxMembersPreset === 'custom' && (
                      <input
                        value={maxMembersText}
                        onChange={(e) => setMaxMembersText(e.target.value)}
                        disabled={settingsLocked}
                        inputMode="numeric"
                        className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="Enter 2 to 500"
                      />
                    )}
                    <button onClick={saveMemberLimit} disabled={savingLimit || settingsLocked || !capacityChanged} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {savingLimit ? 'Saving...' : capacityChanged ? 'Save capacity' : 'Saved'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    Current entries: {entryCount}. Unique members: {uniqueMemberCount}. Choose Unlimited or a cap from 2-500 that is not below current entries.
                  </p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <label className="mb-1 block text-sm font-medium">Entries per user</label>
                  <select
                    value={allowMultipleEntriesDraft ? 'multiple' : 'single'}
                    onChange={(e) => setAllowMultipleEntriesDraft(e.target.value === 'multiple')}
                    disabled={settingsLocked}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="single">Single entry</option>
                    <option value="multiple">Multiple entries</option>
                  </select>
                  {allowMultipleEntriesDraft && (
                    <select
                      value={maxEntriesPerUserDraft}
                      onChange={(e) => setMaxEntriesPerUserDraft(e.target.value)}
                      disabled={settingsLocked}
                      className="mt-2 w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                    >
                      {ENTRY_LIMIT_OPTIONS.map((limit) => (
                        <option key={limit} value={String(limit)}>
                          Up to {limit} {limit === 1 ? 'entry' : 'entries'} per user
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={saveEntrySettings} disabled={savingEntries || settingsLocked || !entrySettingsChanged} className="mt-2 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                    {savingEntries ? 'Saving...' : entrySettingsChanged ? 'Save entries' : 'Entries saved'}
                  </button>
                  <p className="mt-2 text-xs text-gray-600">Members can add separate entries up to this limit, and each entry has its own picks and standings row.</p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <label className="mb-1 block text-sm font-medium">Pool visibility</label>
                  <select
                    value={isPublicDraft ? 'public' : 'private'}
                    onChange={(e) => setIsPublicDraft(e.target.value === 'public')}
                    disabled={settingsLocked}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                  {!isPublicDraft && (
                    <>
                      <input
                        value={visibilityPassword}
                        onChange={(e) => setVisibilityPassword(e.target.value)}
                        disabled={settingsLocked}
                        className="mt-2 w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder={pool.is_public ? 'Set private pool password' : 'Enter new private password'}
                        type="password"
                      />
                      <p className="mt-1 text-xs text-gray-600">
                        {pool.is_public ? 'A password is required when switching from public to private.' : 'Enter a password only if you want to replace the current private password.'}
                      </p>
                    </>
                  )}
                  <button
                    onClick={saveVisibility}
                    disabled={savingVisibility || settingsLocked || (!visibilityChanged && (isPublicDraft || !visibilityPassword.trim()))}
                    className="mt-2 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                  >
                    {savingVisibility ? 'Saving...' : 'Save visibility'}
                  </button>
                  <p className="mt-2 text-xs text-gray-600">Public pools can be found in search. Private pools require a password for new members; changing to private does not remove anyone who already joined.</p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="block text-sm font-medium">Double-pick weeks</label>
                      <p className="text-xs text-gray-600">Click weeks or type a comma-separated list like 3,6,10. Players must make two picks in these weeks.</p>
                    </div>
                    <button onClick={saveDoubleWeeks} disabled={savingDouble || settingsLocked || !doubleWeeksChanged} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {savingDouble ? 'Saving...' : doubleWeeksChanged ? 'Save weeks' : 'Weeks saved'}
                    </button>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {doublePickWeekOptions.map((week) => {
                      const selected = selectedDoubleWeeks.has(week)
                      return (
                        <button
                          key={week}
                          type="button"
                          onClick={() => toggleDoubleWeek(week)}
                          disabled={settingsLocked || week < pool.start_week}
                          title={week < pool.start_week ? `Pool starts in Week ${pool.start_week}.` : undefined}
                          className={`h-10 w-12 rounded-md border text-sm font-semibold disabled:opacity-50 ${
                            selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                          }`}
                          aria-pressed={selected}
                        >
                          {week}
                        </button>
                      )
                    })}
                  </div>
                  <input
                    value={doubleWeeksText}
                    onChange={(e) => setDoubleWeeksText(e.target.value)}
                    disabled={settingsLocked}
                    className="w-full rounded-md border px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                    placeholder="e.g. 5,8,12"
                  />
                  {pool.include_playoffs && (
                    <p className="mt-2 text-xs text-amber-700">Playoff rounds are Wild Card 19, Divisional 20, Conference Championship 21, and Super Bowl 22. Super Bowl cannot be a double-pick round because its two teams play each other, forcing one losing pick.</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Entry Audit</h2>
                  <p className="text-sm text-gray-600">Week-by-week saved or locked pick, result, counted losses, mulligans remaining, and alive or eliminated status for one entry.</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm font-medium text-slate-700">
                    Entry
                    <select
                      value={selectedAuditEntry?.entry_id || ''}
                      onChange={(event) => setSelectedAuditEntryId(event.target.value || null)}
                      className="mt-1 block min-w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      {auditEntries.map((entry) => (
                        <option key={entry.entry_id} value={entry.entry_id}>
                          {entry.display_name}{entry.entry_number > 1 ? ` (${entry.entry_number})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => loadEntryAudit(pool.id)}
                    disabled={entryAuditLoading}
                    className="rounded-md bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-200 disabled:opacity-50"
                  >
                    {entryAuditLoading ? 'Loading...' : 'Refresh audit'}
                  </button>
                </div>
              </div>

              {selectedAuditSummary && (
                <div className="mb-4 grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Current Audit Status</div>
                    <div className="mt-1 text-lg font-bold capitalize text-slate-950">{selectedAuditSummary.latest.status_after_week}</div>
                    {selectedAuditSummary.latest.eliminated_week && <div className="text-xs text-slate-500">Eliminated in {weekLabel(selectedAuditSummary.latest.eliminated_week)}</div>}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Counted Losses After Latest Week</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{selectedAuditSummary.latest.strikes_after_week}</div>
                    <div className="text-xs text-slate-500">{selectedAuditSummary.latest.strikes_left_after_week} mulligans remaining</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Official Picks</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{selectedAuditSummary.finalPicks}</div>
                    <div className="text-xs text-slate-500">{selectedAuditSummary.drafts} saved draft slot(s)</div>
                  </div>
                  <div className={`rounded-lg border p-3 ${selectedAuditSummary.issues ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <div className="text-xs uppercase tracking-wide text-slate-500">Audit Notes</div>
                    <div className="mt-1 text-lg font-bold text-slate-950">{selectedAuditSummary.issues}</div>
                    <div className="text-xs text-slate-500">{selectedAuditSummary.issues ? 'Needs review' : 'No notes'}</div>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Week</th>
                      <th className="px-3 py-2 text-left">Pick</th>
                      <th className="px-3 py-2 text-left">State</th>
                      <th className="px-3 py-2 text-left">Result</th>
                      <th className="px-3 py-2 text-left">Losses / Mulligans Left</th>
                      <th className="px-3 py-2 text-left">Status After</th>
                      <th className="px-3 py-2 text-left">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {selectedEntryAuditRows.map((row) => {
                      const pick = row.final_team_abbr || row.draft_team_abbr || (row.pick_state === 'draft' ? 'Hidden until lock' : '-')
                      return (
                        <tr key={`${row.entry_id}:${row.week}:${row.slot}`} className={row.issue ? 'bg-amber-50/60' : undefined}>
                          <td className="px-3 py-2 font-medium text-slate-950">
                            {weekLabel(row.week)}
                            {row.slot > 1 && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">Pick {row.slot}</span>}
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-semibold text-slate-950">{pick}</span>
                            {row.locked_at && <div className="text-xs text-slate-500">Locked {fmtShort(row.locked_at)}</div>}
                            {!row.locked_at && row.draft_updated_at && <div className="text-xs text-slate-500">Saved {fmtShort(row.draft_updated_at)}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-700">{row.pick_state}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${auditResultClass(row.result)}`}>{row.result || 'pending'}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {row.strikes_after_week}
                            <div className="text-xs text-slate-500">{row.strikes_left_after_week} mulligans left</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${row.status_after_week === 'out' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {row.status_after_week === 'out' ? 'Eliminated' : 'Alive'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{row.issue || '-'}</td>
                        </tr>
                      )
                    })}
                    {!entryAuditLoading && selectedEntryAuditRows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-4 text-sm text-slate-500">
                          No audit rows found for this pool.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Dispute History</h2>
                  <p className="text-sm text-gray-600">Server-timestamped pick saves and rejections, deadlines, rule changes, mulligan and elimination changes, commissioner corrections, and roster removals.</p>
                </div>
                <button
                  onClick={loadAuditTrail}
                  disabled={auditLoading}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                  {auditLoading ? 'Loading...' : 'Refresh activity'}
                </button>
              </div>

              <div className="mb-4 rounded-md border border-slate-200 bg-slate-50">
                <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">Competition timeline</div>
                <div className="max-h-[32rem] divide-y divide-slate-200 overflow-y-auto bg-white">
                  {disputeEvents.map((event) => {
                    const reason = typeof event.details?.reason === 'string' ? event.details.reason : null
                    return (
                      <div key={event.event_id} className="p-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-950">{event.summary}</div>
                            <div className="mt-0.5 text-xs text-slate-600">
                              {event.entry_label ? `${event.entry_label} · ` : ''}
                              {event.week ? `${weekLabel(event.week)}${event.slot ? `, Pick ${event.slot}` : ''} · ` : ''}
                              {event.actor_name || 'System'}
                              {event.subject_name && event.subject_name !== event.actor_name ? ` for ${event.subject_name}` : ''}
                            </div>
                          </div>
                          <span className="text-xs text-slate-500">{fmt(event.event_at)}</span>
                        </div>
                        {(event.server_effective_at || event.applicable_deadline_at) && (
                          <div className="mt-2 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
                            {event.server_effective_at && <span>Server time: {fmt(event.server_effective_at)}</span>}
                            {event.server_effective_at && event.applicable_deadline_at && <span> · </span>}
                            {event.applicable_deadline_at && <span>Applicable deadline: {fmt(event.applicable_deadline_at)}</span>}
                          </div>
                        )}
                        {reason && <div className="mt-1 text-xs text-slate-600">Reason: {reason}</div>}
                      </div>
                    )
                  })}
                  {disputeEvents.length === 0 && <p className="p-3 text-sm text-slate-500">No competition events have been recorded for this pool.</p>}
                </div>
              </div>

              <details className="rounded-md border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-900">Technical pick and commissioner logs</summary>
              <div className="grid gap-4 border-t border-slate-200 p-3 lg:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">Admin actions</div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 bg-white">
                    {adminActions.map((action) => (
                      <div key={action.id} className="p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold capitalize text-slate-950">{action.action.replaceAll('_', ' ')}</span>
                          <span className="text-xs text-slate-500">{fmtShort(action.created_at)}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Admin {shortId(action.admin_id)} - Target {shortId(action.target_user_id)}
                          {action.week ? ` - W${action.week}` : ''}
                          {action.slot ? ` - Pick ${action.slot}` : ''}
                        </div>
                        {(action.old_team_abbr || action.new_team_abbr) && (
                          <div className="mt-1 text-xs text-slate-600">
                            {action.old_team_abbr || '-'} {'->'} {action.new_team_abbr || '-'}
                          </div>
                        )}
                        {action.reason && <div className="mt-1 text-xs text-slate-500">{action.reason}</div>}
                      </div>
                    ))}
                    {adminActions.length === 0 && <p className="p-3 text-sm text-slate-500">No admin actions recorded yet.</p>}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-slate-50">
                  <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900">Pick save events</div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-200 bg-white">
                    {pickEvents.map((event) => (
                      <div key={event.id} className="p-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold capitalize text-slate-950">{(event.action || 'saved').replaceAll('_', ' ')}</span>
                          <span className="text-xs text-slate-500">{fmtShort(event.created_at)}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          User {shortId(event.user_id)} - Actor {shortId(event.actor_user_id || event.user_id)}
                          {event.week ? ` - W${event.week}` : ''}
                          {event.slot ? ` - Pick ${event.slot}` : ''}
                          {event.source_table ? ` - ${event.source_table}` : ''}
                        </div>
                        {(event.old_team_abbr || event.new_team_abbr) && (
                          <div className="mt-1 text-xs text-slate-600">
                            {event.old_team_abbr || '-'} {'->'} {event.new_team_abbr || '-'}
                          </div>
                        )}
                        {event.result && <div className="mt-1 text-xs text-slate-500">Result: {event.result}</div>}
                      </div>
                    ))}
                    {pickEvents.length === 0 && <p className="p-3 text-sm text-slate-500">No pick events recorded yet.</p>}
                  </div>
                </div>
              </div>
              </details>
            </section>

            <section id="commissioner-members" className="scroll-mt-4 rounded-lg border bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Member Help & Pick Corrections</h2>
                  <p className="text-sm text-gray-600">Choose one week, then help with an unlocked pick or correct a locked pick after resolving a dispute. To keep the pool fair, another entry&apos;s saved team stays hidden from commissioners until that pick locks. A missed pick grades as a loss and uses a mulligan when one is available.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search entries"
                    className="rounded-md border px-3 py-1.5 text-sm"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    Week
                    <select
                      value={selectedWeek}
                      onChange={(e) => {
                        const week = Number(e.target.value)
                        setSelectedWeek(week)
                        loadOverview(week)
                      }}
                      className="rounded-md border px-2 py-1"
                    >
                      {testWeekOptions.map((week) => (
                        <option key={week} value={week}>
                          {weekLabel(week)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <label htmlFor="pickCorrectionReason" className="text-sm font-semibold text-amber-950">Reason for commissioner pick change</label>
                <input
                  id="pickCorrectionReason"
                  value={pickCorrectionReason}
                  onChange={(e) => setPickCorrectionReason(e.target.value)}
                  maxLength={500}
                  placeholder="Example: Player sent timestamped pick before deadline"
                  className="mt-2 w-full rounded-md border border-amber-300 bg-white px-3 py-2 text-sm"
                />
                <p className="mt-1 text-xs text-amber-800">Required for locked picks and saved in the activity log. Changing a graded pick clears its result and re-scores standings.</p>
              </div>

              <div className="mb-5 rounded-md border border-slate-200 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">Member Removal</h3>
                    <p className="text-xs text-slate-600">Remove one entry or an entire member before the pool starts. Pick edits stay in the weekly table below.</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
                    {visibleMemberRows.length} {visibleMemberRows.length === 1 ? 'member' : 'members'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-white text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Member</th>
                        <th className="px-3 py-2 text-left">Entries</th>
                        <th className="px-3 py-2 text-left">Role</th>
                        <th className="px-3 py-2 text-left">Joined</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {visibleMemberRows.map(({ row, entries }) => (
                        <tr key={row.user_id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-950">{memberLabel(row)}</div>
                            <div className="text-xs text-slate-500">Profile {row.user_id.slice(0, 8)}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {entries.length}
                            <div className="mt-1 flex flex-wrap gap-1">
                              {entries.map((entry) => (
                                <button
                                  key={entry.entry_id}
                                  type="button"
                                  onClick={() => removeEntry(entry)}
                                  disabled={!!runningAction || settingsLocked || entry.user_id === pool.created_by}
                                  title={entry.user_id === pool.created_by ? 'The pool creator’s entries cannot be removed here.' : `Remove Entry #${entry.entry_number ?? 1}`}
                                  className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                  #{entry.entry_number ?? 1} remove
                                </button>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 capitalize text-slate-700">{row.role}</td>
                          <td className="px-3 py-2 text-slate-700">{fmt(row.joined_at)}</td>
                          <td className="px-3 py-2">
                            {row.eliminated ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Eliminated{row.eliminated_week ? ` W${row.eliminated_week}` : ''}</span>
                            ) : (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Alive</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => removeMember(row, entries.length)}
                              disabled={!!runningAction || settingsLocked}
                              title={settingsLocked ? 'Members cannot be removed after the pool starts.' : undefined}
                              className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                            >
                              Remove member
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {memberRows.length > 0 && visibleMemberRows.length === 0 && <p className="px-3 py-3 text-sm text-slate-600">No members match that search.</p>}
              </div>

              <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
                {testWeekOptions.map((week) => (
                  <button
                    key={week}
                    type="button"
                    onClick={() => {
                      setSelectedWeek(week)
                      loadOverview(week)
                    }}
                    className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold ${
                      selectedWeek === week ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {shortWeekLabel(week)}
                    {pool.double_pick_weeks?.includes(week) && <span className="ml-1 text-[10px]">x2</span>}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border p-2 text-left">Member</th>
                      <th className="border p-2 text-left">Pick slot</th>
                      <th className="border p-2 text-left">Pick</th>
                      <th className="border p-2 text-left">Result</th>
                      <th className="border p-2 text-left">Record</th>
                      <th className="border p-2 text-left">Status</th>
                      <th className="border p-2 text-left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={rowKey(row)} className="align-top hover:bg-gray-50">
                        <td className="border p-2">
                          <div className="font-medium">{entryLabel(row)}</div>
                          <div className="text-xs text-gray-500">{row.role} - joined {fmt(row.joined_at)}</div>
                        </td>
                        <td className="border p-2">Pick {row.slot}</td>
                        <td className="border p-2">
                          <select
                            value={draftTeams[rowKey(row)] || finalTeams[rowKey(row)] || ''}
                            onChange={(e) => setDraftTeams((prev) => ({ ...prev, [rowKey(row)]: e.target.value }))}
                            className="w-full rounded-md border px-2 py-1"
                          >
                            <option value="">{row.draft_updated_at && !row.draft_team_abbr && !row.final_team_abbr ? 'Saved pick hidden until lock' : 'No pick'}</option>
                            {TEAMS.map((team) => (
                              <option key={team} value={team}>
                                {team}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-xs text-gray-500">
                            {row.locked_at
                              ? `Official pick locked ${fmt(row.locked_at)}`
                              : row.draft_updated_at
                                ? `${row.draft_team_abbr ? 'Saved' : 'Saved team hidden until lock'} ${fmt(row.draft_updated_at)}`
                                : 'No pick submitted yet'}
                          </div>
                          {row.result && <div className="mt-1 text-xs font-medium text-amber-700">Result already set. Saving a new pick will clear that result.</div>}
                        </td>
                        <td className="border p-2">{row.result || 'Pending'}</td>
                        <td className="border p-2">
                          {row.wins}-{row.losses}
                          {row.pushes ? `-${row.pushes}` : ''}
                          <div className="text-xs text-gray-500">{row.strikes_used} counted {row.strikes_used === 1 ? 'loss' : 'losses'}</div>
                        </td>
                        <td className="border p-2">
                          {row.eliminated ? (
                            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">Eliminated{row.eliminated_week ? ` W${row.eliminated_week}` : ''}</span>
                          ) : (
                            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">Alive</span>
                          )}
                        </td>
                        <td className="border p-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => saveDraft(row)}
                              disabled={!!runningAction}
                              className="rounded-md bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              Save pick
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && <p className="mt-3 text-sm text-gray-600">No entries found.</p>}
              {rows.length > 0 && visibleRows.length === 0 && <p className="mt-3 text-sm text-gray-600">No entries match that search.</p>}
            </section>
          </div>
        )}
      </div>
      {pool && (
        <InviteModal
          open={inviteOpen}
          poolId={pool.id}
          poolName={pool.name}
          isPrivate={!pool.is_public}
          onClose={() => setInviteOpen(false)}
        />
      )}
      <ConfirmDialogModal dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </main>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-violet-100 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-950">{value}</div>
    </div>
  )
}

function ReinviteStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-slate-950">{value}</div>
    </div>
  )
}

function ReinviteMember({ row }: { row: ReinviteRow }) {
  const entryLabelText = row.previous_entry_count === 1 ? 'entry' : 'entries'
  const currentEntryLabel = row.current_entry_count === 1 ? 'entry' : 'entries'

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-white p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-950 text-sm font-bold text-white">
          {row.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            avatarInitials(row.display_name)
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-950">{row.display_name}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
            <span>{row.previous_entry_count} last season {entryLabelText}</span>
            {row.current_entry_count > 0 && <span>{row.current_entry_count} this season {currentEntryLabel}</span>}
            {row.previous_role === 'admin' && <span>Previous admin</span>}
          </div>
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
          row.joined_new_pool ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
        }`}
      >
        {row.joined_new_pool ? 'Joined' : 'Not joined yet'}
      </span>
    </div>
  )
}
