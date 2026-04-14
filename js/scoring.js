// Shared scoring formula — imported by client (live preview) and server (authoritative).
// Keep this file pure ESM with no Vue/Node dependencies so both runtimes can use it.

export const SCORE_CONSTANTS = {
  PAR_MOVES_PER_TILE: 1.8,
  PAR_SECONDS_PER_TILE: 4.5,
  RATIO_MIN: 0.3,
  RATIO_MAX: 1.5,
  BASE: 1000,
  HANDICAP_STEP: 0.25,
};

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function sizeMultiplier(rows, cols) {
  const tiles = rows * cols;
  return Math.sqrt(tiles / 4);
}

export function computeScore({ rows, cols, moves, durationMs, packMult = 1.0, handicaps = {} }) {
  const C = SCORE_CONSTANTS;
  const tiles = rows * cols;
  const parMoves = tiles * C.PAR_MOVES_PER_TILE;
  const parSec = tiles * C.PAR_SECONDS_PER_TILE;
  const secs = Math.max(1, (durationMs || 0) / 1000);
  const moveRatio = clamp(parMoves / Math.max(1, moves), C.RATIO_MIN, C.RATIO_MAX);
  const timeRatio = clamp(parSec / secs, C.RATIO_MIN, C.RATIO_MAX);
  const sizeMult = sizeMultiplier(rows, cols);
  const handicapMult = 1 + Object.values(handicaps).filter(Boolean).length * C.HANDICAP_STEP;
  const raw = C.BASE * moveRatio * timeRatio * sizeMult * packMult * handicapMult;
  return Math.round(raw);
}
