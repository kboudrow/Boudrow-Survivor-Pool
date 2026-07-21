'use client'

import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { InviteModal } from '@/components/InviteModal'
import { getErrorMessage } from '@/lib/errorMessage'
import { poolImageUrl } from '@/lib/poolImages'
import { supabase } from '@/lib/supabaseClient'

const SUPERADMIN_EMAIL = 'survivesunday1@gmail.com'

type Pool = {
  id: string
  name: string
  created_by: string
  is_public: boolean
  visibility?: 'public' | 'private' | string | null
  double_pick_weeks: number[] | null
  archived: boolean
  season: number | null
  start_week: number
  activation_status?: 'draft' | 'active' | 'cancelled' | string | null
  max_members?: number | null
  allow_multiple_entries?: boolean | null
  max_entries_per_user?: number | null
  payment_status?: 'unpaid' | 'paid' | 'not_required' | 'waived' | 'refunded' | string | null
  image_url?: string | null
  test_mode?: boolean | null
  test_current_week?: number | null
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

const ALL_WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)
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
const entryLabel = (row: AdminRow) => (row.entry_number && row.entry_number > 1 ? `${row.display_name} (${row.entry_number})` : row.display_name)
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
  const [rows, setRows] = useState<AdminRow[]>([])
  const [adminActions, setAdminActions] = useState<AdminActionRow[]>([])
  const [pickEvents, setPickEvents] = useState<PickSaveEventRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)

  const [selectedWeek, setSelectedWeek] = useState(1)
  const [doubleWeeksText, setDoubleWeeksText] = useState('')
  const [maxMembersText, setMaxMembersText] = useState('')
  const [maxMembersPreset, setMaxMembersPreset] = useState('25')
  const [allowMultipleEntriesDraft, setAllowMultipleEntriesDraft] = useState(false)
  const [maxEntriesPerUserDraft, setMaxEntriesPerUserDraft] = useState('1')
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
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [draftTeams, setDraftTeams] = useState<Record<string, string>>({})
  const [finalTeams, setFinalTeams] = useState<Record<string, string>>({})
  const [inviteOpen, setInviteOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [testWeek, setTestWeek] = useState('1')
  const [testGames, setTestGames] = useState<TestGameOption[]>([])
  const [testToolsLoading, setTestToolsLoading] = useState(false)

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
  const testWeekOptions = useMemo(
    () => Array.from({ length: Math.max(0, 19 - testStartWeek) }, (_, index) => testStartWeek + index),
    [testStartWeek],
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
  const poolStartMs = poolStartAt ? Date.parse(poolStartAt) : null
  const poolStartKnown = poolStartMs !== null && Number.isFinite(poolStartMs)
  const leagueHasStarted = poolStartKnown && Date.now() >= poolStartMs
  const settingsLocked = leagueHasStarted
  const canInvite = !!pool && isPoolJoinable && poolStartKnown && !leagueHasStarted
  const visibilityChanged = !!pool && isPublicDraft !== pool.is_public
  const selectedDoubleWeeks = useMemo(() => {
    return new Set(
      doubleWeeksText
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 18),
      )
  }, [doubleWeeksText])
  const doubleWeekCount = selectedDoubleWeeks.size
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

  const loadAuditTrail = async () => {
    if (!poolId) return
    setAuditLoading(true)
    try {
      const [{ data: actions, error: actionsErr }, { data: events, error: eventsErr }] = await Promise.all([
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
      ])
      if (actionsErr) throw actionsErr
      if (eventsErr) throw eventsErr
      setAdminActions((actions || []) as AdminActionRow[])
      setPickEvents((events || []) as PickSaveEventRow[])
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to load audit trail.'))
    } finally {
      setAuditLoading(false)
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

  const loadOverview = async (week = selectedWeek) => {
    if (!poolId) return
    setRefreshing(true)
    setError(null)
    try {
      const [{ data: p, error: pErr }, { data: overview, error: overviewErr }] = await Promise.all([
        supabase.from('pools').select('id,name,created_by,is_public,visibility,double_pick_weeks,archived,season,start_week,activation_status,max_members,allow_multiple_entries,max_entries_per_user,payment_status,image_url,test_mode,test_current_week').eq('id', poolId).maybeSingle<Pool>(),
        supabase.rpc('admin_pool_entry_week_overview', { p_pool_id: poolId, p_week: week }),
      ])
      if (pErr) throw pErr
      if (overviewErr) throw overviewErr
      if (!p) throw new Error('Pool not found')

      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: canManage } = await supabase.rpc('admin_can_manage', { p_pool_id: poolId })
      const nextIsSuperAdmin = user?.email?.toLowerCase() === SUPERADMIN_EMAIL

      setPool(p)
      setIsOwner(!!user?.id && !!canManage)
      setIsSuperAdmin(nextIsSuperAdmin)
      setDoubleWeeksText((p.double_pick_weeks || []).filter((week) => week >= p.start_week).join(','))
      const limitText = String(p.max_members ?? 25)
      setMaxMembersText(limitText)
      setMaxMembersPreset(MEMBER_LIMIT_OPTIONS.includes(Number(limitText)) ? limitText : 'custom')
      setAllowMultipleEntriesDraft(!!p.allow_multiple_entries)
      setMaxEntriesPerUserDraft(String(p.max_entries_per_user ?? 1))
      setIsPublicDraft(!!p.is_public)
      setVisibilityPassword('')
      setImageUrlDraft(p.image_url || '')
      setImageFileDraft(null)
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setRows((overview || []) as AdminRow[])
      const nextTestWeek = String(p.test_current_week || p.start_week || 1)
      setTestWeek(nextTestWeek)
      if (nextIsSuperAdmin && p.test_mode) {
        await loadTestOptions(p.id, nextTestWeek)
      } else {
        setTestGames([])
      }

      const { data: firstStartGame } = await supabase
        .from('nfl_games')
        .select('game_time,kickoff_at_utc')
        .eq('season', p.season ?? new Date().getFullYear())
        .eq('week', p.start_week)
        .order('kickoff_at_utc', { ascending: true, nullsFirst: false })
        .order('game_time', { ascending: true })
        .limit(1)
        .maybeSingle<{ game_time: string; kickoff_at_utc: string | null }>()
      let fallbackStartAt: string | null = null
      if (!firstStartGame?.kickoff_at_utc && !firstStartGame?.game_time) {
        const { data: startWeek } = await supabase
          .from('season_weeks')
          .select('week_sunday_date')
          .eq('season', p.season ?? new Date().getFullYear())
          .eq('week', p.start_week)
          .maybeSingle<{ week_sunday_date: string }>()
        fallbackStartAt = startWeek?.week_sunday_date ? `${startWeek.week_sunday_date}T00:00:00` : null
      }
      setPoolStartAt(firstStartGame?.kickoff_at_utc || firstStartGame?.game_time || fallbackStartAt)

      const nextDrafts: Record<string, string> = {}
      const nextFinals: Record<string, string> = {}
      for (const row of (overview || []) as AdminRow[]) {
        nextDrafts[rowKey(row)] = row.draft_team_abbr || ''
        nextFinals[rowKey(row)] = row.final_team_abbr || ''
      }
      setDraftTeams(nextDrafts)
      setFinalTeams(nextFinals)
      await loadAuditTrail()
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
      setError(getErrorMessage(e, `${label} failed.`))
    } finally {
      setRunningAction(null)
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
        .filter((n) => Number.isFinite(n) && n >= (pool?.start_week ?? 1) && n <= 18)

      const { error } = await supabase.rpc('admin_set_double_weeks', {
        p_pool_id: pool.id,
        p_weeks: weeks,
      })
      if (error) throw error
      setNotice('Double-pick weeks saved.')
      setPool({ ...pool, double_pick_weeks: weeks })
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save double-pick weeks.'))
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
    const nextLimit = parseInt(maxMembersText.trim(), 10)
    if (!Number.isFinite(nextLimit) || nextLimit < 2 || nextLimit > 500) {
      setError('Pool capacity must be between 2 and 500 entries.')
      return
    }
    if (nextLimit < entryCount) {
      setError(`Pool capacity cannot be lower than the current entry count (${entryCount}).`)
      return
    }

    setSavingLimit(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_member_limit', {
        p_pool_id: pool.id,
        p_max_members: nextLimit,
      })
      if (error) throw error
      setPool({ ...pool, max_members: nextLimit })
      setNotice('Pool capacity saved.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save pool capacity.'))
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
      setError(getErrorMessage(e, 'Failed to save entry settings.'))
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
      setError(getErrorMessage(e, 'Failed to save pool visibility.'))
    } finally {
      setSavingVisibility(false)
    }
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null
    setImageFileDraft(file)
    setImagePreviewDraft((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return file ? URL.createObjectURL(file) : null
    })
  }

  const uploadLeagueImage = async (file: File, poolIdValue: string) => {
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the pool image.')
    if (file.size > 5 * 1024 * 1024) throw new Error('Pool image must be 5 MB or smaller.')

    const ext = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${poolIdValue}/${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage.from('pool-images').upload(path, file, {
      cacheControl: '3600',
      upsert: true,
    })
    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('pool-images').getPublicUrl(path)
    return data.publicUrl
  }

  const saveImage = async () => {
    if (!pool) return
    if (!imageFileDraft) {
      setError('Choose an image file before saving.')
      return
    }
    setSavingImage(true)
    setError(null)
    setNotice(null)
    try {
      const nextImage = await uploadLeagueImage(imageFileDraft, pool.id)
      const { error } = await supabase.rpc('admin_update_pool_image', {
        p_pool_id: pool.id,
        p_image_url: nextImage,
      })
      if (error) throw error
      setPool({ ...pool, image_url: nextImage || null })
      setImageUrlDraft(nextImage)
      setImageFileDraft(null)
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setNotice('Pool image saved.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save pool image.'))
    } finally {
      setSavingImage(false)
    }
  }

  const resetImage = async () => {
    if (!pool) return
    setSavingImage(true)
    setError(null)
    setNotice(null)
    try {
      const { error } = await supabase.rpc('admin_update_pool_image', {
        p_pool_id: pool.id,
        p_image_url: '',
      })
      if (error) throw error
      setPool({ ...pool, image_url: null })
      setImageUrlDraft('')
      setImageFileDraft(null)
      setImagePreviewDraft((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setNotice('Pool image reset to a default.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save pool image.'))
    } finally {
      setSavingImage(false)
    }
  }

  const toggleArchive = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('Pool settings cannot be changed after the pool has started.')
      return
    }
    setArchiving(true)
    setError(null)
    setNotice(null)
    try {
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
        const confirmed = window.confirm(`Change ${entryLabel(row)}'s Pick ${row.slot} for Week ${selectedWeek} to ${team}?`)
        if (!confirmed) return 'Pick update canceled.'
        const { error } = await supabase.rpc('admin_override_entry_final_pick', {
          p_pool_id: pool.id,
          p_entry_id: row.entry_id,
          p_week: selectedWeek,
          p_team_abbr: team,
          p_slot: row.slot,
          p_reason: 'Updated from admin panel',
        })
        if (error) throw error
        return `Pick saved as ${team}.`
      }
      const key = rowKey(row)
      const team = (draftTeams[key] || finalTeams[key] || '').trim().toUpperCase()
      if (!team) {
        const { error } = await supabase.rpc('admin_clear_entry_week_draft_slot', {
          p_pool_id: pool.id,
          p_entry_id: row.entry_id,
          p_week: selectedWeek,
          p_slot: row.slot,
          p_reason: 'Cleared from admin panel',
        })
        if (error) throw error
        return 'Pick cleared.'
      }

      const { error } = await supabase.rpc('admin_upsert_entry_draft', {
        p_pool_id: pool.id,
        p_entry_id: row.entry_id,
        p_week: selectedWeek,
        p_team_abbr: team,
        p_slot: row.slot,
        p_reason: 'Updated from admin panel',
      })
      if (error) throw error
      return `Pick saved as ${team}.`
    })

  const removeMember = (row: AdminRow, entryCount = 1) =>
    runAction('Remove member', async () => {
      if (!pool) return
      if (settingsLocked) {
        throw new Error('Members cannot be removed after the pool has started.')
      }
      const label = memberLabel(row)
      const confirmed = window.confirm(
        `Remove ${label} from ${pool.name}?\n\nEntries removed: ${entryCount}\n\nThis removes the member, every entry, and all picks from this pool. It cannot be undone from this screen.`,
      )
      if (!confirmed) return 'Remove member canceled.'

      const { error } = await supabase.rpc('admin_remove_pool_member', {
        p_pool_id: pool.id,
        p_profile_id: row.user_id,
      })
      if (error) throw error
      return `${label} removed.`
    })

  const toggleTestMode = async () => {
    if (!pool || !isSuperAdmin) return
    const enabling = !pool.test_mode
    const confirmed = window.confirm(
      enabling
        ? `Enable test mode for "${pool.name}"?\n\nOnly the superadmin account will see these controls. Members and pool admins will not see test-mode labels.`
        : `Disable test mode for "${pool.name}"?\n\nExisting fake season data will stay stored, but the simulator controls will be hidden until test mode is enabled again.`,
    )
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

  const saveTestWeek = async () => {
    if (!pool || !isSuperAdmin) return
    const week = parseInt(testWeek, 10)
    setRunningAction('test-week')
    setError(null)
    setNotice(null)
    try {
      const { data, error: weekErr } = await supabase.rpc('superadmin_set_test_pool_week', {
        p_pool_id: pool.id,
        p_week: week,
      })
      if (weekErr) throw weekErr
      setNotice(String(data || 'Test week updated.'))
      setSelectedWeek(week)
      await loadOverview(week)
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to set simulated week.'))
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
    const nextWeek = Math.min(18, week + 1)
    const copy: Record<typeof action, string> = {
      'randomize-outcomes': `Randomize empty Week ${week} game outcomes for ${pool.name}? Existing fake outcomes stay as-is.`,
      score: `Score Week ${week} and move ${pool.name} to Week ${nextWeek}?\n\nThis finalizes picks, records missing picks as losses, grades picks from fake outcomes, updates standings, and advances the simulated week.`,
      clear: `Clear Week ${week} fake outcomes and scoring for ${pool.name}?\n\nPicks stay in place, but this week's results and stats will be rebuilt.`,
      reset: `Reset the entire fake season for ${pool.name}?\n\nMembers and pool settings stay. All picks, fake outcomes, and test stats will be cleared.`,
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
    if (!window.confirm(copy[action])) return
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

  return (
    <main className="min-h-[70vh] bg-gray-50 py-8 px-4">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-gray-600">{pool ? `${pool.name} - ${pool.season ?? 'Season not set'} - Pool admin` : 'Pool controls'}</p>
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
                <div className="text-2xl font-bold">{pool.max_members ? `${entryCount}/${pool.max_members}` : entryCount}</div>
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
                <div className="text-xs uppercase text-gray-500">Archived</div>
                <div className="text-2xl font-bold">{pool.archived ? 'Yes' : 'No'}</div>
              </div>
            </section>

            <section className="grid gap-3 md:grid-cols-4">
              <div className="rounded-lg border bg-white p-4">
                <div className="text-xs uppercase text-gray-500">Access</div>
                <div className={`text-sm font-semibold ${isPoolJoinable ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isPoolJoinable ? 'Free and joinable' : 'Not accepting members'}
                </div>
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

            {isSuperAdmin && (
              <section className={`rounded-lg border p-4 ${pool.test_mode ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Superadmin Only</p>
                    <h2 className="text-lg font-semibold text-slate-950">Test Console</h2>
                    <p className="mt-1 max-w-3xl text-sm text-slate-600">
                      Simulate this pool without changing the real NFL schedule. Members and pool admins do not see test-mode labels or these controls.
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
                    <div className="grid gap-3 lg:grid-cols-[minmax(240px,320px)_1fr]">
                      <div className="rounded-md border border-violet-200 bg-white p-3">
                        <label className="text-sm font-semibold text-slate-800">
                          Simulated week
                          <select
                            value={testWeek}
                            onChange={(event) => setTestWeek(event.target.value)}
                            className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                          >
                            {testWeekOptions.map((week) => (
                              <option key={week} value={week}>Week {week}</option>
                            ))}
                          </select>
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <button
                            onClick={saveTestWeek}
                            disabled={runningAction === 'test-week'}
                            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            {runningAction === 'test-week' ? 'Saving...' : 'Set Week'}
                          </button>
                          <button
                            onClick={() => loadTestOptions(pool.id, testWeek)}
                            disabled={testToolsLoading}
                            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            {testToolsLoading ? 'Loading...' : 'Refresh'}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">The pool page behaves as if this is the active pool week.</p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <InfoTile label="Matchups" value={String(testGames.length)} />
                        <InfoTile label="Picked matchups" value={String(testGamesWithPicks.length)} />
                        <InfoTile label="Outcomes set" value={`${testGamesWithOutcomes.length}/${testGames.length || 0}`} />
                        <InfoTile label="Need outcome" value={String(testGamesNeedingOutcome.length)} />
                      </div>
                    </div>

                    {testGamesNeedingOutcome.length > 0 && (
                      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        Before scoring, set outcomes for: {testGamesNeedingOutcome.map((game) => `${game.away_team} @ ${game.home_team}`).slice(0, 6).join(', ')}.
                      </p>
                    )}

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <button
                        onClick={() => runTestAction('randomize-outcomes')}
                        disabled={!!runningAction}
                        className="rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        Randomize Empty Outcomes
                      </button>
                      <button
                        onClick={() => runTestAction('score')}
                        disabled={!!runningAction || testGamesNeedingOutcome.length > 0}
                        className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Score Week & Advance
                      </button>
                      <button
                        onClick={() => runTestAction('clear')}
                        disabled={!!runningAction}
                        className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Clear Selected Week
                      </button>
                      <button
                        onClick={() => runTestAction('reset')}
                        disabled={!!runningAction}
                        className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reset Fake Season
                      </button>
                    </div>

                    <div className="mt-4 overflow-x-auto rounded-lg border border-violet-200 bg-white">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-violet-50 text-slate-700">
                          <tr>
                            <th className="border-b border-violet-100 p-2 text-left">Matchup</th>
                            <th className="border-b border-violet-100 p-2 text-left">Kickoff</th>
                            <th className="border-b border-violet-100 p-2 text-left">Pick split</th>
                            <th className="border-b border-violet-100 p-2 text-left">Outcome</th>
                          </tr>
                        </thead>
                        <tbody>
                          {testGames.map((game) => (
                            <tr key={game.game_id} className="hover:bg-slate-50">
                              <td className="border-b border-slate-100 p-2">
                                <div className="font-semibold">{game.away_team} @ {game.home_team}</div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                  <span>Week {game.week}</span>
                                  {(game.total_pick_count ?? game.away_pick_count + game.home_pick_count) > 0 && (
                                    <span className={`rounded-full px-2 py-0.5 font-semibold ${game.needs_outcome ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                      {game.needs_outcome ? 'Needs outcome' : 'Ready'}
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
                                  <option value="">Not set</option>
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
                    Enable test mode when you want this pool to run on a simulated week instead of the real calendar.
                  </p>
                )}
              </section>
            )}

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Pool Settings</h2>
                  <p className="text-sm text-gray-600">Edit pool setup before the first game in the start week kicks off.</p>
                </div>
                <button
                  onClick={toggleArchive}
                  disabled={archiving || settingsLocked}
                  title={settingsLocked ? 'Started pools cannot be archived from this panel.' : undefined}
                  className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {archiving ? 'Updating...' : pool.archived ? 'Unarchive Pool' : 'Archive Pool'}
                </button>
              </div>
              {settingsLocked && (
                <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Pool settings are locked because this pool has reached its configured start week. Admins can still review members and make commissioner pick corrections.
                </p>
              )}
              {!settingsLocked && poolStartAt && (
                <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Settings can still be changed. They lock when this pool starts: {fmt(poolStartAt)}.
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
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleImageChange}
                        disabled={savingImage}
                        className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white disabled:opacity-50"
                      />
                      <p className="mt-1 text-xs text-gray-600">Upload a logo or pool image up to 5 MB.</p>
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
                    <button onClick={saveMemberLimit} disabled={savingLimit || settingsLocked} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {savingLimit ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    Current entries: {entryCount}. Unique members: {uniqueMemberCount}. Capacity must be 2-500 and cannot be below current entries.
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
                  <button onClick={saveEntrySettings} disabled={savingEntries || settingsLocked} className="mt-2 w-full rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                    {savingEntries ? 'Saving...' : 'Save entries'}
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
                  <p className="mt-2 text-xs text-gray-600">Public pools can be found in search. Private pools require a password to join.</p>
                </div>

                <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className="block text-sm font-medium">Double-pick weeks</label>
                      <p className="text-xs text-gray-600">Click weeks or type a comma-separated list like 3,6,10. Players must make two picks in these weeks.</p>
                    </div>
                    <button onClick={saveDoubleWeeks} disabled={savingDouble || settingsLocked} className="rounded-md bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50">
                      {savingDouble ? 'Saving...' : 'Save weeks'}
                    </button>
                  </div>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {ALL_WEEKS.map((week) => {
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
                </div>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Admin Activity</h2>
                  <p className="text-sm text-gray-600">Recent member removals, admin pick edits, and saved-pick events for this pool.</p>
                </div>
                <button
                  onClick={loadAuditTrail}
                  disabled={auditLoading}
                  className="rounded-md bg-gray-100 px-3 py-1.5 text-sm hover:bg-gray-200 disabled:opacity-50"
                >
                  {auditLoading ? 'Loading...' : 'Refresh activity'}
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
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
            </section>

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Members, Entries & Picks</h2>
                  <p className="text-sm text-gray-600">Choose a week, submit or edit picks, or remove a member before the pool starts.</p>
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
                      {ALL_WEEKS.map((week) => (
                        <option key={week} value={week}>
                          {week}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="mb-5 rounded-md border border-slate-200 bg-slate-50">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">Member Removal</h3>
                    <p className="text-xs text-slate-600">Remove a member and all of their entries before the pool starts. Pick edits stay in the weekly table below.</p>
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
                            <div className="text-xs text-slate-500">
                              {entries.map((entry) => `#${entry.entry_number ?? 1}`).join(', ')}
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
                {ALL_WEEKS.map((week) => (
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
                    W{week}
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
                            <option value="">No pick</option>
                            {TEAMS.map((team) => (
                              <option key={team} value={team}>
                                {team}
                              </option>
                            ))}
                          </select>
                          <div className="mt-1 text-xs text-gray-500">
                            {row.locked_at ? `Official pick locked ${fmt(row.locked_at)}` : row.draft_updated_at ? `Saved ${fmt(row.draft_updated_at)}` : 'No pick submitted yet'}
                          </div>
                          {row.result && <div className="mt-1 text-xs font-medium text-amber-700">Result already set. Saving a new pick will clear that result.</div>}
                        </td>
                        <td className="border p-2">{row.result || 'Pending'}</td>
                        <td className="border p-2">
                          {row.wins}-{row.losses}
                          {row.pushes ? `-${row.pushes}` : ''}
                          <div className="text-xs text-gray-500">{row.strikes_used} strike(s)</div>
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

