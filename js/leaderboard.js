// Leaderboard fetch helpers.

export async function submitScore(payload) {
  const res = await fetch('/api/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `submit failed (${res.status})`);
  }
  return res.json();
}

export async function fetchPuzzleLeaderboard({ pack, image, rows, cols, limit = 50 }) {
  const q = new URLSearchParams({ pack, image, rows, cols, limit }).toString();
  const res = await fetch(`/api/leaderboard/puzzle?${q}`);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  return res.json();
}

export async function fetchGlobalLeaderboard(limit = 50) {
  const res = await fetch(`/api/leaderboard/global?limit=${limit}`);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  return res.json();
}

export async function fetchPuzzleSummary({ pack, image, code }) {
  const params = new URLSearchParams({ pack, image });
  if (code) params.set('code', code);
  const res = await fetch(`/api/puzzle-summary?${params.toString()}`);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  return res.json();
}

export async function fetchPlayerScores(code, limit = 50) {
  const res = await fetch(`/api/players/${code}/scores?limit=${limit}`);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  return res.json();
}
