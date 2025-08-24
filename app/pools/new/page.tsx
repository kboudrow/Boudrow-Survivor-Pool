'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

export default function CreatePoolPage() {
  const router = useRouter();

  // Pool fields (UI unchanged)
  const [poolName, setPoolName] = useState('');
  const [startWeek, setStartWeek] = useState('Week 1');
  const [pickDeadline, setPickDeadline] = useState('Before 1PM Games');
  const [mulligans, setMulligans] = useState(0);
  const [scoringType, setScoringType] = useState('standard'); // kept for UI; not persisted unless you add a column
  const [tiebreaker, setTiebreaker] = useState('Win');
  const [seasonLength, setSeasonLength] = useState('Regular Season');
  const [isPublic, setIsPublic] = useState(false);
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    setOk(null);

    try {
      // 1) Require auth (prevents silent failures)
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error('You must be signed in to create a pool.');

      // 2) Normalize UI fields to your DB schema
      const start_week = Number(String(startWeek).replace(/\D+/g, '')) || 1;
      const include_playoffs = seasonLength === 'Regular Season & Playoffs';
      const strikes_allowed = mulligans;
      const tie_rule = (tiebreaker || '').toLowerCase() as 'win' | 'loss';

      let deadline_mode: 'fixed' | 'rolling' = 'rolling';
      let deadline_fixed: string | null = null;
      if (pickDeadline === 'Before 1PM Games') {
        deadline_mode = 'fixed';
        deadline_fixed = '13:00'; // adjust if your backend expects UTC vs local
      } else if (pickDeadline === 'Before MNF') {
        deadline_mode = 'fixed';
        deadline_fixed = '20:15';
      }

      // 3) Insert into pools
      const { data, error } = await supabase
        .from('pools')
        .insert({
          name: poolName,
          is_public: isPublic,
          start_week,
          include_playoffs,
          strikes_allowed,
          tie_rule,
          deadline_mode,
          deadline_fixed,
          notes,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      setOk('Pool created! You are the admin.');
      router.push(`/pools/${data.id}`);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  // Keep original weekOptions (12) to avoid UI change
  const weekOptions = Array.from({ length: 12 }, (_, i) => `Week ${i + 1}`);

  return (
    <div className="wrap">
      <h1>Create a New Pool</h1>

      {error && <p className="error">{error}</p>}
      {ok && <p className="success">{ok}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <div className="field">
          <label htmlFor="poolName">Pool Name</label>
          <input
            id="poolName"
            type="text"
            value={poolName}
            onChange={(e) => setPoolName(e.target.value)}
            placeholder="Enter pool name"
            required
          />
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="startWeek">Start Week</label>
            <select
              id="startWeek"
              value={startWeek}
              onChange={(e) => setStartWeek(e.target.value)}
            >
              {weekOptions.map((week) => (
                <option key={week} value={week}>
                  {week}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="pickDeadline">Pick Deadline</label>
            <select
              id="pickDeadline"
              value={pickDeadline}
              onChange={(e) => setPickDeadline(e.target.value)}
            >
              <option value="Before 1PM Games">Before 1PM Games</option>
              <option value="Before MNF">Before MNF</option>
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="mulligans">Mulligans</label>
            <select
              id="mulligans"
              value={mulligans}
              onChange={(e) => setMulligans(Number(e.target.value))}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="seasonLength">Season Length</label>
            <select
              id="seasonLength"
              value={seasonLength}
              onChange={(e) => setSeasonLength(e.target.value)}
            >
              <option value="Regular Season">Regular Season</option>
              <option value="Regular Season & Playoffs">
                Regular Season & Playoffs
              </option>
            </select>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label htmlFor="scoring">Scoring Type</label>
            <select
              id="scoring"
              value={scoringType}
              onChange={(e) => setScoringType(e.target.value)}
            >
              <option value="standard">Standard</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="tiebreaker">Tie Counts As</label>
            <select
              id="tiebreaker"
              value={tiebreaker}
              onChange={(e) => setTiebreaker(e.target.value)}
            >
              <option value="Win">Win</option>
              <option value="Loss">Loss</option>
            </select>
          </div>
        </div>

        <div className="row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
            />
            Public Pool
          </label>
        </div>

        <div className="field">
          <label htmlFor="notes">Additional Notes / Rules</label>
          <textarea
            id="notes"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any additional rules or notes for the pool"
          />
        </div>

        <button className="primary" type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create Pool'}
        </button>
      </form>

      <style jsx>{`
        .wrap { max-width: 720px; margin: 0 auto; padding: 24px; }
        h1 { margin-bottom: 16px; }
        .error { color: #c00; margin-bottom: 12px; }
        .success { color: #080; margin-bottom: 12px; }
        form { display: flex; flex-direction: column; gap: 16px; }
        .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        label { font-weight: 600; }
        input[type='text'],
        select,
        textarea {
          padding: 10px;
          font-size: 14px;
          border: 1px solid #ddd;
          border-radius: 8px;
        }
        .row { display: flex; align-items: center; }
        .checkbox { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
        .primary {
          padding: 10px 14px;
          font-size: 15px;
          border-radius: 8px;
          border: none;
          background: #111;
          color: #fff;
          cursor: pointer;
        }
        .primary[disabled] { opacity: 0.6; cursor: not-allowed; }
        @media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
