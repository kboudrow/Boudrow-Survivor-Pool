'use client'

import type { ChangeEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { InviteModal } from '@/components/InviteModal'
import { getErrorMessage } from '@/lib/errorMessage'
import { poolImageUrl } from '@/lib/poolImages'
import { supabase } from '@/lib/supabaseClient'

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
  const searchParams = useSearchParams()
  const { poolId } = useParams<{ poolId: string }>()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [pool, setPool] = useState<Pool | null>(null)
  const [poolStartAt, setPoolStartAt] = useState<string | null>(null)
  const [rows, setRows] = useState<AdminRow[]>([])

  const [selectedWeek, setSelectedWeek] = useState(1)
  const [doubleWeeksText, setDoubleWeeksText] = useState('')
  const [maxMembersText, setMaxMembersText] = useState('')
  const [maxMembersPreset, setMaxMembersPreset] = useState('25')
  const [allowMultipleEntriesDraft, setAllowMultipleEntriesDraft] = useState(false)
  const [maxEntriesPerUserDraft, setMaxEntriesPerUserDraft] = useState('1')
  const [archiving, setArchiving] = useState(false)
  const [activating, setActivating] = useState(false)
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
  const [confirmingCheckout, setConfirmingCheckout] = useState(false)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [draftTeams, setDraftTeams] = useState<Record<string, string>>({})
  const [finalTeams, setFinalTeams] = useState<Record<string, string>>({})
  const [inviteOpen, setInviteOpen] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')

  const entryRows = useMemo(() => {
    const uniqueRows = Array.from(new Map(rows.map((row) => [row.entry_id, row])).values())
    return uniqueRows.sort((a, b) => entryLabel(a).localeCompare(entryLabel(b)) || (a.entry_number ?? 1) - (b.entry_number ?? 1))
  }, [rows])
  const memberCount = entryRows.length
  const stats = useMemo(() => {
    const alive = entryRows.filter((row) => !row.eliminated).length
    return { alive, eliminated: entryRows.length - alive }
  }, [entryRows])
  const isPoolActive = pool?.activation_status === 'active'
  const isPaidPool = pool?.payment_status === 'paid' || pool?.activation_status === 'active'
  const poolStartMs = poolStartAt ? Date.parse(poolStartAt) : null
  const poolStartKnown = poolStartMs !== null && Number.isFinite(poolStartMs)
  const leagueHasStarted = poolStartKnown && Date.now() >= poolStartMs
  const settingsLocked = leagueHasStarted
  const canInvite = !!pool && isPoolActive && poolStartKnown && !leagueHasStarted
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
  const visibleEntryRows = useMemo(() => {
    const q = memberSearch.trim().toLowerCase()
    if (!q) return entryRows
    return entryRows.filter((row) => {
      return [entryLabel(row), row.user_id, row.role, row.entry_id].some((value) => value.toLowerCase().includes(q))
    })
  }, [entryRows, memberSearch])

  const loadOverview = async (week = selectedWeek) => {
    if (!poolId) return
    setRefreshing(true)
    setError(null)
    try {
      const [{ data: p, error: pErr }, { data: overview, error: overviewErr }] = await Promise.all([
        supabase.from('pools').select('id,name,created_by,is_public,visibility,double_pick_weeks,archived,season,start_week,activation_status,max_members,allow_multiple_entries,max_entries_per_user,payment_status,image_url').eq('id', poolId).maybeSingle<Pool>(),
        supabase.rpc('admin_pool_entry_week_overview', { p_pool_id: poolId, p_week: week }),
      ])
      if (pErr) throw pErr
      if (overviewErr) throw overviewErr
      if (!p) throw new Error('Pool not found')

      const {
        data: { user },
      } = await supabase.auth.getUser()
      const { data: canManage } = await supabase.rpc('admin_can_manage', { p_pool_id: poolId })

      setPool(p)
      setIsOwner(!!user?.id && !!canManage)
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
    if (!pool || !isOwner || pool.activation_status === 'active') return
    const activated = searchParams.get('activated')
    const sessionId = searchParams.get('session_id')
    if (activated !== 'success' || !sessionId || confirmingCheckout) return

    const confirmCheckout = async () => {
      setConfirmingCheckout(true)
      setError(null)
      setNotice(null)
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) throw sessionError
        if (!session?.access_token) throw new Error('Please sign in again to confirm payment.')

        const response = await fetch('/api/stripe/confirm-checkout-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ poolId: pool.id, sessionId }),
        })

        const payload = (await response.json()) as { activated?: boolean; error?: string }
        if (!response.ok || !payload.activated) {
          throw new Error(payload.error || 'Payment confirmation failed.')
        }

        setNotice('Payment confirmed. Pool is active.')
        await loadOverview(selectedWeek)
        router.replace(`/pools/${pool.id}/admin`)
      } catch (e: unknown) {
        setError(getErrorMessage(e, 'Payment confirmation failed.'))
      } finally {
        setConfirmingCheckout(false)
      }
    }

    confirmCheckout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, isOwner, searchParams, confirmingCheckout, router])

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
      setError('League settings cannot be changed after the league has started.')
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
      setError('League settings cannot be changed after the league has started.')
      return
    }
    const nextLimit = parseInt(maxMembersText.trim(), 10)
    if (!Number.isFinite(nextLimit) || nextLimit < 2 || nextLimit > 500) {
      setError('Member limit must be between 2 and 500.')
      return
    }
    if (nextLimit < memberCount) {
      setError(`Member limit cannot be lower than the current member count (${memberCount}).`)
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
      setNotice('Member limit saved.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save member limit.'))
    } finally {
      setSavingLimit(false)
    }
  }

  const saveEntrySettings = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('League settings cannot be changed after the league has started.')
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
      setError('League settings cannot be changed after the league has started.')
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
    if (!file.type.startsWith('image/')) throw new Error('Choose an image file for the league image.')
    if (file.size > 5 * 1024 * 1024) throw new Error('League image must be 5 MB or smaller.')

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
      setNotice('League image saved.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save league image.'))
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
      setNotice('League image reset to a default.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save league image.'))
    } finally {
      setSavingImage(false)
    }
  }

  const toggleArchive = async () => {
    if (!pool) return
    if (settingsLocked) {
      setError('League settings cannot be changed after the league has started.')
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

  const startActivationCheckout = async () => {
    if (!pool) return
    setActivating(true)
    setError(null)
    setNotice(null)

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) throw sessionError
      if (!session?.access_token) throw new Error('Please sign in again before activating this pool.')

      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ poolId: pool.id }),
      })

      const payload = (await response.json()) as { url?: string; error?: string }
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'Failed to start checkout.')
      }

      window.location.href = payload.url
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to start checkout.'))
      setActivating(false)
    }
  }

  const finalizeLocked = () => {
    const confirmed = window.confirm('Finalize only picks whose deadlines have passed? Future picks will stay editable.')
    if (!confirmed) return
    runAction('Finalize due picks', async () => {
      if (!pool) return
      const { data, error } = await supabase.rpc('finalize_locked_picks_for_pool', { p_pool_id: pool.id })
      if (error) throw error
      return `Finalized ${data ?? 0} pick(s).`
    })
  }

  const adjudicate = () => {
    const confirmed = window.confirm('Adjudicate completed games for this season and update player results?')
    if (!confirmed) return
    runAction('Adjudicate results', async () => {
      if (!pool) return
      const { data, error } = await supabase.rpc('adjudicate_completed_weeks', { p_season: pool.season ?? new Date().getFullYear() })
      if (error) throw error
      return `Adjudicated ${data ?? 0} pick result(s).`
    })
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

  const removeMember = (row: AdminRow) =>
    runAction('Remove entry', async () => {
      if (!pool) return
      if (settingsLocked) {
        throw new Error('Entries cannot be removed after the league has started.')
      }
      const label = entryLabel(row)
      const shortEntryId = row.entry_id.slice(0, 8)
      const confirmed = window.confirm(
        `Remove ${label} from ${pool.name}?\n\nEntry ID: ${shortEntryId}\n\nThis removes that entry and all of its picks. It cannot be undone from this screen.`,
      )
      if (!confirmed) return 'Remove entry canceled.'

      const { error } = await supabase.rpc('admin_remove_pool_entry', {
        p_pool_id: pool.id,
        p_entry_id: row.entry_id,
      })
      if (error) throw error
      return `${label} removed.`
    })

  return (
    <main className="min-h-[70vh] bg-gray-50 py-8 px-4">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-gray-600">{pool ? `${pool.name} - ${pool.season ?? 'Season not set'} - League admin` : 'League controls'}</p>
              {isPoolActive && (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  Active Pool
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
            <button onClick={() => loadOverview(selectedWeek)} disabled={refreshing} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
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
                <div className="text-2xl font-bold">{pool.max_members ? `${memberCount}/${pool.max_members}` : memberCount}</div>
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
                <div className="text-xs uppercase text-gray-500">Activation</div>
                <div className={`text-sm font-semibold ${isPoolActive ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isPoolActive ? 'Active and joinable' : 'Draft, payment required'}
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

            {!isPoolActive && (
              <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-blue-950">Pool Activation</h2>
                    <p className="text-sm text-blue-800">Players cannot join until the creator completes the $50 activation payment.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-blue-300 bg-white px-3 py-1 text-sm font-medium text-blue-800">Draft</span>
                    <button
                      onClick={startActivationCheckout}
                      disabled={activating || confirmingCheckout}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {confirmingCheckout ? 'Confirming payment...' : activating ? 'Opening Stripe...' : 'Activate for $50'}
                    </button>
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold">League Settings</h2>
                  <p className="text-sm text-gray-600">Edit league setup before the first game in the start week kicks off.</p>
                </div>
              </div>
              {settingsLocked && (
                <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  League settings are locked because this pool has reached its configured start week. Admins can still manage player picks and results.
                </p>
              )}
              {!settingsLocked && poolStartAt && (
                <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Settings can still be changed. They lock when this pool starts: {fmt(poolStartAt)}.
                </p>
              )}

              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(220px,320px)_minmax(240px,320px)_minmax(260px,360px)_1fr]">
                <div className="rounded-md border border-gray-200 bg-gray-50 p-3 lg:col-span-2 xl:col-span-4">
                  <label className="mb-1 block text-sm font-medium">League image</label>
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
                      <p className="mt-1 text-xs text-gray-600">Upload a logo or league image up to 5 MB.</p>
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
                  <label className="mb-1 block text-sm font-medium">Member limit</label>
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
                        <option key={limit} value={String(limit)}>{limit} members</option>
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
                  <p className="mt-2 text-xs text-gray-600">Current members: {memberCount}. Limit must be 2-500 and cannot be below the current member count.</p>
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
              <div className="mb-3">
                <h2 className="font-semibold">Scoring Tools</h2>
                <p className="text-sm text-gray-600">Use these after deadlines or final scores. They do not change league rules.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <button onClick={finalizeLocked} disabled={!!runningAction} className="rounded-md bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50">
                  Lock due picks
                </button>
                <button onClick={adjudicate} disabled={!!runningAction} className="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
                  Score final games
                </button>
                <button
                  onClick={toggleArchive}
                  disabled={archiving || settingsLocked || isPaidPool}
                  title={isPaidPool ? 'Paid or active leagues cannot be archived.' : settingsLocked ? 'League settings are locked after the league starts.' : undefined}
                  className="rounded-md bg-amber-600 px-3 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {archiving ? 'Updating...' : pool.archived ? 'Unarchive league' : 'Archive league'}
                </button>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Members & Picks</h2>
                  <p className="text-sm text-gray-600">Choose a week, then submit, edit, or remove an entry before the league starts.</p>
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
                    <h3 className="text-sm font-semibold text-slate-950">Entry Management</h3>
                    <p className="text-xs text-slate-600">Remove a full entry before the league starts. Pick edits stay in the weekly table below.</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs text-slate-600">
                    {visibleEntryRows.length} {visibleEntryRows.length === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-white text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Entry</th>
                        <th className="px-3 py-2 text-left">Role</th>
                        <th className="px-3 py-2 text-left">Joined</th>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {visibleEntryRows.map((row) => (
                        <tr key={row.entry_id}>
                          <td className="px-3 py-2">
                            <div className="font-medium text-slate-950">{entryLabel(row)}</div>
                            <div className="text-xs text-slate-500">Entry {row.entry_number ?? 1} - {row.entry_id.slice(0, 8)}</div>
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
                              onClick={() => removeMember(row)}
                              disabled={!!runningAction || settingsLocked}
                              title={settingsLocked ? 'Entries cannot be removed after the league starts.' : undefined}
                              className="rounded-md bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                            >
                              Remove entry
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {entryRows.length > 0 && visibleEntryRows.length === 0 && <p className="px-3 py-3 text-sm text-slate-600">No entries match that search.</p>}
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
