// Docker-style friendly names derived deterministically from a player code.
// Used as a public-facing fallback when a player hasn't set a display name —
// so their raw 6-letter claim code isn't visible on leaderboards.

const ADJECTIVES = [
  'happy', 'sleepy', 'brave', 'clever', 'jolly', 'grumpy', 'lively', 'nimble',
  'wise', 'bold', 'quirky', 'mellow', 'fuzzy', 'hasty', 'eager', 'honest',
  'jumpy', 'keen', 'lucky', 'proud', 'silly', 'snappy', 'sunny', 'witty',
  'zany', 'cosmic', 'dapper', 'feisty', 'gentle', 'plucky', 'radiant', 'spry',
];

const NOUNS = [
  'fox', 'bear', 'otter', 'hawk', 'badger', 'lynx', 'stoat', 'heron',
  'raven', 'newt', 'toad', 'mole', 'wolf', 'hare', 'seal', 'crow',
  'swan', 'finch', 'marten', 'shrew', 'moose', 'owl', 'koi', 'ibis',
  'robin', 'wren', 'elk', 'bison', 'beaver', 'quail', 'skunk', 'vole',
];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

export function fakeName(code) {
  if (!code || code.length < 6) return '?';
  const a = ADJECTIVES[hash(code.slice(0, 3)) % ADJECTIVES.length];
  const n = NOUNS[hash(code.slice(3, 6)) % NOUNS.length];
  return `${titleCase(a)} ${titleCase(n)}`;
}

export function publicNameFor(player) {
  if (!player) return '';
  if (player.display_name) return player.display_name;    // server row
  if (player.displayName) return player.displayName;      // client-side shape
  return fakeName(player.code || player.player_code || player.playerCode);
}
