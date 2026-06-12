'use client'

import React, { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

const ALL_WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)
const DEFAULT_SEASON = 2026
const MEMBER_LIMIT_OPTIONS = [10, 25, 50, 100, 250, 500]

/** Turn DB/SDK errors into plain-English UI messages */
function formatCreatePoolError(e: unknown): string {
  const errorInfo =
    e && typeof e === 'object'
      ? e as { message?: unknown; error_description?: unknown; details?: unknown; hint?: unknown; code?: unknown }
      : null

  const msg: string =
    (typeof errorInfo?.message === 'string' ? errorInfo.message : '') ||
    (typeof errorInfo?.error_description === 'string' ? errorInfo.error_description : '') ||
    (typeof e === 'string' ? e : '') ||
    'Something went wrong.'

  const details = typeof errorInfo?.details === 'string' ? errorInfo.details : undefined
  const hint = typeof errorInfo?.hint === 'string' ? errorInfo.hint : undefined
  const code = typeof errorInfo?.code === 'string' ? errorInfo.code : undefined

  const full = [msg, details, hint].filter(Boolean).join(' — ')
  const lower = full.toLowerCase()

  if (lower.includes('already exists') || code === '23505') {
    return 'That pool name is already taken. Try a different name.'
  }
  if (lower.includes('auth session') || lower.includes('jwt') || lower.includes('not authenticated')) {
    return 'Please sign in again before creating a pool.'
  }
  if (lower.includes('restricted term')) {
    // Trigger throws: Pool name contains a restricted term: "xyz"
    return full
  }
  if (lower.includes('too short')) {
    return 'Pool name is too short. Please use at least 3 characters.'
  }

  return full || msg
}

function isNameRelatedError(message: string | null) {
  if (!message) return false
  const m = message.toLowerCase()
  return (
    m.includes('pool name') ||
    m.includes('name is already taken') ||
    m.includes('restricted term') ||
    m.includes('too short')
  )
}

export default function CreatePoolPage() {
  const router = useRouter()

  /** Scroll/focus helpers */
  const topRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  // Pool fields
  const [poolName, setPoolName] = useState('')
  const [startWeek, setStartWeek] = useState('Week 1')
  const [pickDeadline, setPickDeadline] = useState('Sunday 1 PM ET')
  const [mulligans, setMulligans] = useState(0)
  const [tiebreaker, setTiebreaker] = useState<'Win' | 'Loss'>('Loss')
  const [seasonLength, setSeasonLength] = useState('Regular Season')
  const [notes, setNotes] = useState('')

  // visibility
  const [isPublic, setIsPublic] = useState(true)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [maxMembers, setMaxMembers] = useState('25')
  const [customMaxMembers, setCustomMaxMembers] = useState('')

  // double pick weeks
  const [doubleWeeks, setDoubleWeeks] = useState<number[]>([])

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derived
  const start_week = useMemo(
    () => Number(String(startWeek).replace(/\D+/g, '')) || 1,
    [startWeek]
  )
  const max_members = maxMembers === 'custom' ? Number(customMaxMembers) : Number(maxMembers)

  const toggleWeek = (w: number) => {
    if (w < start_week) return
    setDoubleWeeks((prev) =>
      prev.includes(w) ? prev.filter((x) => x !== w) : [...prev, w].sort((a, b) => a - b)
    )
  }

  const scrollToTopAndFocusIfNeeded = (message: string) => {
    // If it looks like a name problem, focus + select the name field for fast fixing
    if (isNameRelatedError(message)) {
      nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => {
        nameInputRef.current?.focus()
        nameInputRef.current?.select()
      }, 150)
      return
    }

    // Bring the user back to the general message
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const handleCreate = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser()
      if (userErr || !user) throw new Error('Please sign in again before creating a pool.')

      const trimmedName = poolName.trim()
      if (!trimmedName) throw new Error('Please enter a pool name.')
      if (trimmedName.length < 3) throw new Error('Pool name is too short. Please use at least 3 characters.')

      if (!isPublic) {
        if (!password.trim()) throw new Error('Please enter a password for private pools.')
        if (password !== password2) throw new Error('Passwords do not match.')
      }
      if (!Number.isFinite(max_members) || max_members < 2 || max_members > 500) {
        throw new Error('Member limit must be between 2 and 500.')
      }

      const include_playoffs = seasonLength === 'Regular Season & Playoffs'
      const strikes_allowed = String(mulligans) // DB column currently text in your schema
      const tie_rule = tiebreaker.toLowerCase() as 'win' | 'loss'
      const validDoubleWeeks = doubleWeeks.filter((week) => week >= start_week)

      let deadline_mode: 'fixed' | 'rolling' = 'fixed'
      let deadline_fixed: string | null = '13:00'
      if (pickDeadline === 'Before Monday Night Football') deadline_fixed = '20:15'
      if (pickDeadline === 'Rolling: each game locks at kickoff') deadline_mode = 'rolling'

      // 1) create pool
      const { data: pool, error: insErr } = await supabase
        .from('pools')
        .insert({
          name: trimmedName,
          is_public: isPublic,
          allow_discovery: isPublic ? true : false,
          start_week,
          include_playoffs,
          strikes_allowed,
          tie_rule,
          deadline_mode,
          deadline_fixed,
          notes: notes?.trim() ? notes.trim() : null,
          created_by: user.id,
          season: DEFAULT_SEASON,
          double_pick_weeks: validDoubleWeeks,
          plan: 'free',
          pick_privacy: 'hidden',
          activation_status: 'draft',
          payment_status: 'unpaid',
          max_members,
        })
        .select('*')
        .single()

      if (insErr) throw insErr
      if (!pool) throw new Error('Failed to create pool.')

      // 2) if private, set password via RPC (hash in DB)
      if (!isPublic) {
        const { error: pwdErr } = await supabase.rpc('set_pool_password', {
          p_pool_id: pool.id,
          p_plain: password,
        })
        if (pwdErr) throw pwdErr
      }

      // 3) join creator through the same secure path used by every player
      const { error: joinErr } = await supabase.rpc('join_pool', {
        p_pool_id: pool.id,
        p_password: isPublic ? null : password,
      })

      if (joinErr) throw joinErr

      router.push(`/pools/${pool.id}/admin`)
    } catch (e: unknown) {
      const msg = formatCreatePoolError(e)
      setError(msg)
      scrollToTopAndFocusIfNeeded(msg)
    } finally {
      setLoading(false)
    }
  }

  const nameError = isNameRelatedError(error)
  const generalError = error && !nameError ? error : null

  return (
    <div ref={topRef} className="wrap">
      <div className="intro">
        <p>Commissioner setup</p>
        <h1>Create a New Pool</h1>
        <span>Set the rules now. Once the pool starts, the important settings lock for fairness.</span>
      </div>

      {generalError && (
        <div className="noticeBox" role="alert" aria-live="polite">
          <div className="noticeTitle">One thing needs attention</div>
          <div>{generalError}</div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); handleCreate() }}>
        <div className="field">
          <label htmlFor="poolName">Pool Name</label>
          <input
            ref={nameInputRef}
            id="poolName"
            value={poolName}
            onChange={(e) => setPoolName(e.target.value)}
            placeholder="Enter pool name"
            required
            aria-invalid={nameError ? 'true' : 'false'}
            className={nameError ? 'inputError' : ''}
          />
          <p className="hint">
            Names must be <b>unique</b> and can’t contain restricted terms (e.g., “survivor”, “pool”, “abc”, “123”).
          </p>
          {nameError && (
            <p className="fieldError" role="alert" aria-live="polite">{error}</p>
          )}
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="startWeek">Start Week</label>
            <select
              id="startWeek"
              value={startWeek}
              onChange={(e) => {
                const next = Number(e.target.value.replace(/\D+/g, '')) || 1
                setStartWeek(e.target.value)
                setDoubleWeeks((weeks) => weeks.filter((week) => week >= next))
              }}
            >
              {Array.from({ length: 18 }, (_, i) => `Week ${i + 1}`).map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pickDeadline">Pick Deadline</label>
            <select id="pickDeadline" value={pickDeadline} onChange={(e) => setPickDeadline(e.target.value)}>
              <option>Sunday 1 PM ET</option>
              <option>Before Monday Night Football</option>
              <option>Rolling: each game locks at kickoff</option>
            </select>
            <p className="hint">Early games always lock at kickoff. Sunday 1 PM is the standard survivor deadline.</p>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="mulligans">Mulligans</label>
            <select id="mulligans" value={mulligans} onChange={(e) => setMulligans(Number(e.target.value))}>
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="tiebreaker">Tie Counts As</label>
            <select id="tiebreaker" value={tiebreaker} onChange={(e) => setTiebreaker(e.target.value as 'Win' | 'Loss')}>
              <option value="Win">Win</option>
              <option value="Loss">Loss</option>
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="seasonLength">Season Length</label>
            <select id="seasonLength" value={seasonLength} onChange={(e) => setSeasonLength(e.target.value)}>
              <option value="Regular Season">Regular Season</option>
              <option value="Regular Season & Playoffs">Regular Season & Playoffs</option>
            </select>
          </div>

          <div className="field">
            <label>Visibility</label>
            <div className="toggleRow">
              <span className={`pill ${isPublic ? 'active' : ''}`}>Public</span>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                className={`toggle ${isPublic ? 'on' : 'off'}`}
                onClick={() => setIsPublic((v) => !v)}
              >
                <span className="knob" />
              </button>
              <span className={`pill ${!isPublic ? 'active' : ''}`}>Private</span>
            </div>
            <p className="hint">
              Public pools may appear in browse/search. Private pools require a password to join.
            </p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="maxMembers">Member Limit</label>
          <select id="maxMembers" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)}>
            {MEMBER_LIMIT_OPTIONS.map((limit) => (
              <option key={limit} value={String(limit)}>{limit} members</option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {maxMembers === 'custom' && (
            <input
              value={customMaxMembers}
              onChange={(e) => setCustomMaxMembers(e.target.value)}
              inputMode="numeric"
              placeholder="Enter 2 to 500"
            />
          )}
          <p className="hint">This protects public pools from unexpected signups. You can adjust it before activation.</p>
        </div>

        {!isPublic && (
          <div className="grid2">
            <div className="field">
              <label htmlFor="poolPwd">Password (case-sensitive)</label>
              <input
                id="poolPwd"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="poolPwd2">Confirm Password</label>
              <input
                id="poolPwd2"
                type="password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
              />
            </div>
          </div>
        )}

        <div className="field">
          <label>Double-Pick Weeks</label>
          <div className="weekGrid">
            {ALL_WEEKS.map((w) => (
              <button
                type="button"
                key={w}
                disabled={w < start_week}
                className={`week ${doubleWeeks.includes(w) ? 'on' : ''}`}
                onClick={() => toggleWeek(w)}
                title={w < start_week ? 'This pool starts later, so this week is not available.' : undefined}
              >
                {w}
              </button>
            ))}
          </div>
          <p className="hint">Selected weeks require two picks.</p>
        </div>

        <div className="field">
          <label htmlFor="notes">Additional Notes / Rules</label>
          <textarea
            id="notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional rules or notes"
          />
        </div>

        <button className="primary" type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Draft Pool'}
        </button>
      </form>

      <style jsx>{`
        .wrap { max-width: 820px; margin: 0 auto; padding: 18px 16px 32px; }
        .intro {
          margin-bottom: 18px;
          border: 1px solid #1f2937;
          border-radius: 14px;
          background: linear-gradient(135deg, #090b0f, #161a22 62%, #3b0b0f);
          color: #fff;
          padding: 20px;
        }
        .intro p {
          margin: 0 0 6px;
          color: #d2ad5b;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }
        h1 { margin: 0; font-size: 30px; line-height: 1.1; }
        .intro span {
          display: block;
          margin-top: 8px;
          color: #d1d5db;
          font-size: 14px;
          line-height: 1.6;
        }

        form { display: flex; flex-direction: column; gap: 16px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        label { font-weight: 600; }

        input, select, textarea {
          padding: 10px;
          font-size: 14px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          outline: none;
        }

        .hint { margin-top: 6px; font-size: 12px; color: #666; }

        .noticeBox {
          border: 1px solid #fed7aa;
          background: #fff7ed;
          color: #7c2d12;
          padding: 12px;
          border-radius: 10px;
          margin-bottom: 14px;
        }
        .noticeTitle { font-weight: 700; margin-bottom: 4px; }

        .fieldError {
          margin-top: 2px;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 600;
        }

        .inputError {
          border-color: #ef4444 !important;
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
        }

        .toggleRow { display: inline-flex; align-items: center; gap: 10px; margin-top: 4px; }
        .pill { font-size: 12px; padding: 4px 8px; border-radius: 999px; border: 1px solid #ddd; color: #666; }
        .pill.active { background:#111318; color:#fff; border-color:#111318; }
        .toggle { width: 50px; height: 28px; border-radius:999px; border:1px solid #ddd; background:#eee; display:inline-flex; align-items:center; padding:2px; position:relative; }
        .toggle.on { background:#16a34a22; border-color:#16a34a; }
        .toggle.off { background:#e5e7eb; border-color:#ddd; }
        .knob { width:24px; height:24px; border-radius:999px; background:#fff; display:block; transform:translateX(0); transition:transform .2s; box-shadow:0 1px 2px rgba(0,0,0,.1); }
        .toggle.on .knob { transform: translateX(22px); }

        .primary {
          padding:10px 14px;
          font-size:15px;
          border-radius:8px;
          border:none;
          background:#c5161d;
          color:#fff;
          cursor:pointer;
        }
        .primary[disabled]{opacity:.6; cursor:not-allowed;}

        .weekGrid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 8px; }
        .week { padding: 8px 0; border:1px solid #ddd; border-radius:8px; background:#fff; font-weight:600; }
        .week.on { background:#c5161d; color:#fff; border-color:#c5161d; }

        @media (max-width: 720px){
          .grid2 { grid-template-columns: 1fr; gap: 12px; }
          .wrap { padding: 14px 12px 28px; }
          .intro { padding: 18px; border-radius: 12px; }
          h1 { font-size: 28px; }
          form { gap: 14px; }
          input, select, textarea { min-height: 44px; font-size: 16px; }
          .weekGrid{ grid-template-columns: repeat(6, 1fr); }
          .primary { min-height: 46px; width: 100%; }
        }
      `}</style>
    </div>
  )
}
