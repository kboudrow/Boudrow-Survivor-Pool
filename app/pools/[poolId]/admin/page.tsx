'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getErrorMessage } from '@/lib/errorMessage'
import { supabase } from '@/lib/supabaseClient'

type Pool = {
  id: string
  name: string
  created_by: string
  double_pick_weeks: number[] | null
  archived: boolean
}

export default function PoolAdminPage() {
  const router = useRouter()
  const { poolId } = useParams<{ poolId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [pool, setPool] = useState<Pool | null>(null)

  const [doubleWeeksText, setDoubleWeeksText] = useState('') // e.g. "5,8,12"
  const [archiving, setArchiving] = useState(false)
  const [savingDouble, setSavingDouble] = useState(false)

  useEffect(() => {
    let alive = true
    const init = async () => {
      try {
        if (!poolId) return
        setLoading(true)
        setError(null)

        const [{ data: { user } }, { data: p, error: pErr }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from('pools').select('id,name,created_by,double_pick_weeks,archived').eq('id', poolId).maybeSingle<Pool>()
        ])
        if (pErr) throw pErr
        if (!p) throw new Error('Pool not found')

        setPool(p)
        setIsOwner(!!user?.id && user.id === p.created_by)
        setDoubleWeeksText((p.double_pick_weeks || []).join(','))
      } catch (e: unknown) {
        if (!alive) return
        setError(getErrorMessage(e, 'Failed to load admin data.'))
      } finally {
        if (alive) setLoading(false)
      }
    }
    init()
    return () => { alive = false }
  }, [poolId])

  // Optional hard guard: bounce non-owners back to pool
  useEffect(() => {
    if (!loading && !error && pool && !isOwner) {
      router.replace(`/pools/${poolId}`)
    }
  }, [loading, error, pool, isOwner, poolId, router])

  const saveDoubleWeeks = async () => {
    if (!pool) return
    setSavingDouble(true); setError(null)
    try {
      const weeks = doubleWeeksText
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n >= 1 && n <= 18)

      const { error } = await supabase.rpc('admin_set_double_weeks', {
        p_pool_id: pool.id,
        p_weeks: weeks
      })
      if (error) throw error
      alert('Double-pick weeks saved.')
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to save double-pick weeks.'))
    } finally {
      setSavingDouble(false)
    }
  }

  const toggleArchive = async () => {
    if (!pool) return
    setArchiving(true); setError(null)
    try {
      const { error } = await supabase.rpc('admin_archive_pool', {
        p_pool_id: pool.id,
        p_archived: !pool.archived
      })
      if (error) throw error
      setPool({ ...pool, archived: !pool.archived })
    } catch (e: unknown) {
      setError(getErrorMessage(e, 'Failed to update archive state.'))
    } finally {
      setArchiving(false)
    }
  }

  return (
    <main className="min-h-[70vh] py-10 px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Admin Panel</h1>
          <Link href={`/pools/${poolId}`} className="px-3 py-1.5 rounded-md bg-gray-100 hover:bg-gray-200 text-sm">
            Back to Pool
          </Link>
        </div>

        {loading && <p>Loading…</p>}
        {!loading && error && <p className="text-red-600">{error}</p>}

        {!loading && !error && pool && isOwner && (
          <div className="space-y-6">
            <section className="border rounded-lg p-4">
              <h2 className="font-semibold mb-2">Pool Settings</h2>
              <div className="mb-3 text-sm text-gray-700">
                <div><span className="font-medium">Name:</span> {pool.name}</div>
                <div><span className="font-medium">Archived:</span> {pool.archived ? 'Yes' : 'No'}</div>
              </div>

              <label className="block text-sm font-medium mb-1">
                Double-pick weeks (comma-separated, 1–18)
              </label>
              <input
                value={doubleWeeksText}
                onChange={(e) => setDoubleWeeksText(e.target.value)}
                className="w-full border rounded-md px-3 py-2 mb-3"
                placeholder="e.g. 5,8,12"
              />
              <button
                onClick={saveDoubleWeeks}
                disabled={savingDouble}
                className="px-4 py-2 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingDouble ? 'Saving…' : 'Save double-pick weeks'}
              </button>

              <hr className="my-4" />

              <button
                onClick={toggleArchive}
                disabled={archiving}
                className="px-4 py-2 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {archiving ? 'Updating…' : (pool.archived ? 'Unarchive Pool' : 'Archive Pool')}
              </button>
            </section>

            {/* You can add Members and Edit Picks sections here as you wire up admin_remove_member / edit-pick RPCs */}
          </div>
        )}
      </div>
    </main>
  )
}

