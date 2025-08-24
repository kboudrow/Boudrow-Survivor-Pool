// lib/api.ts

export async function createPool(data: { name: string }) {
  const res = await fetch('/api/pools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create pool');
  return res.json();
}

export async function getPoolById(poolId: string) {
  const res = await fetch(`/api/pools/${poolId}`);
  if (!res.ok) throw new Error('Failed to fetch pool');
  return res.json();
}

export async function submitPick(poolId: string, pick: { week: number; team: string }) {
  const res = await fetch(`/api/pools/${poolId}/picks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(pick),
  });
  if (!res.ok) throw new Error('Failed to submit pick');
  return res.json();
}

export async function inviteMember(poolId: string, email: string) {
  const res = await fetch(`/api/pools/${poolId}/invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error('Failed to send invite');
  return res.json();
}
