'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

type PoolRow = {
  id: string;
  name: string;
  is_public: boolean;
  start_week: number;
  include_playoffs: boolean;
  strikes_allowed: number;
  tie_rule: 'win' | 'loss' | 'push';
  deadline_mode: 'fixed' | 'rolling';
  deadline_fixed: string | null;
  notes: string | null;
  created_by: string;
};

export default function PoolDetailsPage() {
  const { poolId } = useParams() as { poolId: string };

  // Pool data
  const [pool, setPool] = useState<PoolRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth
  const [userId, setUserId] = useState<string | null>(null);

  // Form state for edits (keeps your UI shape)
  const [editing, setEditing] = useState(false);
  const [formState, setFormState] = useState<any>({});

  // Picks & standings (placeholder data to preserve UI)
  const [weeklyPicks, setWeeklyPicks] = useState<any[]>([]);
  const [standings, setStandings] = useState<any[]>([]);
  const [pickSelection, setPickSelection] = useState<string>('');

  // Invite state (placeholder to preserve UI)
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMsg, setInviteMsg] = useState('');

  // Load auth + pool
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      // Auth
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr) {
        setError(authErr.message);
        setLoading(false);
        return;
      }
      setUserId(user?.id ?? null);

      // Pool
      const { data, error } = await supabase
        .from('pools')
        .select('*')
        .eq('id', poolId)
        .maybeSingle<PoolRow>();

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      if (!data) {
        setError('Pool not found');
        setLoading(false);
        return;
      }

      setPool(data);

      // Build a view model the UI already expects
      const viewModel = {
        name: data.name,
        start_date: `Week ${data.start_week}`, // display only
        end_date: data.include_playoffs ? 'End of Playoffs' : 'End of Regular Season',
        pick_deadline_time: data.deadline_mode === 'fixed' ? (data.deadline_fixed ?? '') : '',
        mulligans: data.strikes_allowed,
        scoring_type: 'standard', // not persisted (no column yet)
        max_members: '',          // not persisted (no column yet)
        entry_fee: '',            // not persisted (no column yet)
        tiebreaker: data.tie_rule,
        notes: data.notes ?? '',
        is_public: data.is_public,
        created_by: data.created_by,
      };
      setFormState(viewModel);

      // Placeholder: keep UI sections functional without backend tables yet
      setWeeklyPicks([]);
      setStandings([]);

      setLoading(false);
    };

    load();
  }, [poolId]);

  const isAdmin = useMemo(
    () => !!pool && !!userId && pool.created_by === userId,
    [pool, userId]
  );

  if (loading) return <p>Loading pool...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!pool) return null;

  const handlePoolEdit = async () => {
    try {
      // Map UI fields -> DB columns we actually have
      const tie_rule = String(formState.tiebreaker || '').toLowerCase() as 'win' | 'loss' | 'push';
      const hasFixed = !!formState.pick_deadline_time;

      const patch: Partial<PoolRow> = {
        name: formState.name,
        is_public: !!formState.is_public,
        strikes_allowed: Number(formState.mulligans) || 0,
        tie_rule,
        deadline_mode: hasFixed ? 'fixed' : 'rolling',
        deadline_fixed: hasFixed ? String(formState.pick_deadline_time) : null,
        notes: formState.notes ?? null,
      };

      const { data, error } = await supabase
        .from('pools')
        .update(patch)
        .eq('id', pool.id)
        .select()
        .single<PoolRow>();

      if (error) throw error;

      setPool(data);
      // refresh view model to reflect saved values
      setFormState({
        ...formState,
        name: data.name,
        start_date: `Week ${data.start_week}`,
        end_date: data.include_playoffs ? 'End of Playoffs' : 'End of Regular Season',
        pick_deadline_time: data.deadline_mode === 'fixed' ? (data.deadline_fixed ?? '') : '',
        mulligans: data.strikes_allowed,
        tiebreaker: data.tie_rule,
        notes: data.notes ?? '',
        is_public: data.is_public,
      });

      setEditing(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update pool.');
    }
  };

  const handlePickSubmit = async () => {
    try {
      // Placeholder only — wire this to your picks table later
      if (!pickSelection) return;
      setWeeklyPicks((prev) => [
        ...prev,
        { user_id: userId || 'me', user_name: 'You', team: pickSelection },
      ]);
      setPickSelection('');
    } catch (err: any) {
      setError(err.message || 'Failed to submit pick.');
    }
  };

  const handleSendInvite = async () => {
    try {
      // Placeholder only — wire this to invites later
      if (!inviteEmail) return;
      setInviteMsg(`Invite sent to ${inviteEmail}`);
      setInviteEmail('');
    } catch (err: any) {
      setInviteMsg(err.message || 'Failed to send invite.');
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: 'auto', padding: '2rem' }}>
      <h1>{pool.name}</h1>
      <p>
        Start Date: {formState.start_date} | End Date: {formState.end_date} | Next Pick Deadline: {formState.pick_deadline_time || '(rolling)'}
      </p>
      <p>Scoring Type: {formState.scoring_type} | Mulligans: {formState.mulligans} | Max Members: {formState.max_members || '—'}</p>
      <p>Entry Fee: {formState.entry_fee !== '' ? `$${formState.entry_fee}` : '—'} | Public: {formState.is_public ? 'Yes' : 'No'}</p>
      {formState.tiebreaker && <p>Tiebreaker: {formState.tiebreaker}</p>}
      {formState.notes && <p>Notes: {formState.notes}</p>}

      {/* Admin Edit Form */}
      {isAdmin && (
        <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
          <h2>Admin Controls</h2>
          <button onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel Edit' : 'Edit Pool Settings'}
          </button>

          {editing && (
            <div style={{ marginTop: '1rem' }}>
              <input
                type="text"
                value={formState.name}
                onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                placeholder="Pool Name"
              />
              <input
                type="date"
                value={formState.start_date}
                onChange={(e) => setFormState({ ...formState, start_date: e.target.value })}
              />
              <input
                type="date"
                value={formState.end_date}
                onChange={(e) => setFormState({ ...formState, end_date: e.target.value })}
              />
              <input
                type="time"
                value={formState.pick_deadline_time}
                onChange={(e) => setFormState({ ...formState, pick_deadline_time: e.target.value })}
              />
              <input
                type="number"
                min={0}
                value={formState.mulligans}
                onChange={(e) => setFormState({ ...formState, mulligans: Number(e.target.value) })}
              />
              <select
                value={formState.scoring_type}
                onChange={(e) => setFormState({ ...formState, scoring_type: e.target.value })}
              >
                <option value="standard">Standard</option>
                <option value="custom">Custom</option>
              </select>
              <input
                type="number"
                min={1}
                value={formState.max_members}
                onChange={(e) => setFormState({ ...formState, max_members: Number(e.target.value) })}
              />
              <input
                type="number"
                min={0}
                value={formState.entry_fee}
                onChange={(e) => setFormState({ ...formState, entry_fee: Number(e.target.value) })}
              />
              <input
                type="text"
                value={formState.tiebreaker}
                onChange={(e) => setFormState({ ...formState, tiebreaker: e.target.value })}
              />
              <textarea
                value={formState.notes}
                onChange={(e) => setFormState({ ...formState, notes: e.target.value })}
              />
              <label>
                <input
                  type="checkbox"
                  checked={!!formState.is_public}
                  onChange={(e) => setFormState({ ...formState, is_public: e.target.checked })}
                />
                Public Pool
              </label>
              <button onClick={handlePoolEdit}>Save Changes</button>
            </div>
          )}
        </div>
      )}

      {/* Weekly Picks */}
      <div style={{ marginTop: '2rem' }}>
        <h2>Weekly Picks</h2>
        <select value={pickSelection} onChange={(e) => setPickSelection(e.target.value)}>
          <option value="">Select a team</option>
          {/* Replace with dynamic teams */}
          <option value="Team A">Team A</option>
          <option value="Team B">Team B</option>
          <option value="Team C">Team C</option>
        </select>
        <button onClick={handlePickSubmit} disabled={!pickSelection}>
          Submit Pick
        </button>

        <ul>
          {weeklyPicks.map((pick) => (
            <li key={`${pick.user_id}-${pick.team}`}>
              {pick.user_name}: {pick.team}
            </li>
          ))}
        </ul>
      </div>

      {/* Standings */}
      <div style={{ marginTop: '2rem' }}>
        <h2>Standings</h2>
        <ol>
          {standings.map((s) => (
            <li key={s.user_id}>
              {s.user_name} – {s.points} pts
            </li>
          ))}
        </ol>
      </div>

      {/* Invite Members */}
      {isAdmin && (
        <div style={{ marginTop: '2rem' }}>
          <h2>Invite Members</h2>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Enter email"
          />
          <button onClick={handleSendInvite}>Send Invite</button>
          {inviteMsg && <p>{inviteMsg}</p>}
        </div>
      )}
    </div>
  );
}
