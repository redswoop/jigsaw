// Player identity — localStorage-backed, server-issued 6-letter codes.

const KEY = 'jigsaw_identity';

export function loadIdentity() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && /^[A-Z]{6}$/.test(obj.code || '')) return obj;
  } catch {}
  return null;
}

export function saveIdentity(obj) {
  localStorage.setItem(KEY, JSON.stringify({ code: obj.code, displayName: obj.displayName ?? null }));
}

export function clearIdentity() {
  localStorage.removeItem(KEY);
}

export async function createPlayer() {
  const res = await fetch('/api/players', { method: 'POST' });
  if (!res.ok) throw new Error('create player failed');
  const player = await res.json();
  saveIdentity(player);
  return player;
}

export async function claimPlayer(code, mergeFrom) {
  const res = await fetch('/api/players/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, mergeFrom: mergeFrom || undefined }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `claim failed (${res.status})`);
  }
  const player = await res.json();
  saveIdentity(player);
  return player;
}

export async function setDisplayName(code, displayName) {
  const res = await fetch(`/api/players/${code}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `update failed (${res.status})`);
  }
  const player = await res.json();
  saveIdentity(player);
  return player;
}

export async function ensurePlayer() {
  const existing = loadIdentity();
  if (existing) return existing;
  return createPlayer();
}

// Ping the server to check our stored code still exists. If not, drop it locally
// so UI doesn't spam 404s. Returns the (possibly cleared) identity.
export async function validateIdentity() {
  const existing = loadIdentity();
  if (!existing) return null;
  try {
    const res = await fetch(`/api/players/${existing.code}/scores?limit=1`);
    if (res.status === 404) { clearIdentity(); return null; }
    if (!res.ok) return existing; // network / server hiccup — don't clobber
    return existing;
  } catch {
    return existing;
  }
}
