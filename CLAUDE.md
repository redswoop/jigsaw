# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

Single-file web app (`index.html`) with Vite for dev and a Node/Bun server for the API.

```bash
bun install                    # first time only
bun run dev                    # Vite (HMR) on :5173 + API server on :3002
```
Then open http://localhost:5173. Vite proxies `/api` to the API server. Puzzle state persists via localStorage.

**Production:** `bun run start` (or `node server.js`) serves everything on one port.

**Env vars:**
- `PORT` — API port (default `3002`)
- `BUGS_DIR` — bug report JSON directory (default `./.bugs`)
- `DATA_DIR` — SQLite leaderboard DB directory (default `~/.jigsaw/data`). **Must be outside Dropbox** — SQLite WAL locks race Dropbox sync and throw `SQLITE_IOERR_VNODE`.
- `ADMIN_TOKEN` — required header `x-admin-token` value for remote admin access. Localhost requests bypass this.

**Debug in browser console:**
```js
dump()   // prints grid ASCII, overlaps, group info, integrity checks
```

## Architecture

Multi-screen Vue 3 app (CDN, Composition API) split across several files:

```
index.html          — Vue template: all screen layouts
css/style.css       — All styles
js/app.js           — Vue app shell: screen routing, pack loading, identity, leaderboards
js/game.js          — Puzzle engine (createGameEngine(): tiles, groups, grid, moves, drag, scoring)
js/sounds.js        — Web Audio sound effects
js/scoring.js       — Shared scoring formula (imported by client AND server)
js/identity.js      — Player code + localStorage + claim/create/validate API calls
js/leaderboard.js   — Leaderboard fetch helpers
js/fakename.js      — Deterministic Docker-style name from a player code (e.g. "Jolly Fox")
server.js           — HTTP server (http module), routes, static serving, range/ETag
server/db.js        — bun:sqlite: players, scores, leaderboard queries, claim+merge tx
server/scoring.js   — (not present — server imports js/scoring.js directly)
server/packs.js     — Loads images/<pack>/pack.json at boot, caches difficulty/label
server/admin.js     — Admin auth: ADMIN_TOKEN header OR localhost
```

Uses `<script type="module">` for ES imports. No build step — works with both Vite dev and static serving. The server imports `./js/scoring.js` so the client and server score puzzles identically.

### Screen Flow

`currentScreen` ref drives navigation: **home** (pack gallery) → **picker** (image grid) → **setup** (difficulty) → **puzzle** (gameplay). Extra screens: **leaderboard** (puzzle / global / my scores), **settings** (identity + claim), **admin** (player management). Saved games in localStorage skip straight to puzzle on load. URL params (`?puzzle=N&cols=C&pack=name`) also skip to puzzle. `?admin=1` opens the admin screen directly.

### Data Model

Four parallel structures track puzzle state:
- **`tiles[]`** — array of `{id, trueRow, trueCol, groupId}`. Index = tile ID. `trueRow/trueCol` is where it belongs in the solved image.
- **`groups{}`** — keyed by group ID. `{id, tileIds: Set}`. Tiles merge into groups when true neighbors land adjacent. Groups move as a unit.
- **`grid[][]`** — 2D array `[row][col] → tileId`. The spatial truth of what's where.
- **`tilePos Map`** — inverse of grid: `tileId → {row, col}`. Must stay in sync with grid.

Group IDs use a monotonic counter (`nextGroupId++`) to avoid collisions when groups are broken and re-created.

### Move System

Moves flow through: `computeMovePlan()` → `assignDisplacedTiles()` → `tryMove()` → `checkMerges()`.

- **computeMovePlan**: computes target cells for dragged group, identifies all displaced tiles (expanding to full groups), calculates freed cells, attempts placement. Tries preserving displaced groups first; if `breakGroups` is on, falls back to scattering them as singles.
- **assignDisplacedTiles**: nearest-available-cell assignment by Manhattan distance. Groups placed first (need contiguous cells), then singles.
- **tryMove**: executes the plan atomically — breaks groups if needed, writes grid+tilePos, runs integrity check.
- **checkMerges**: scans all adjacent pairs for true-neighbor matches, merges groups in a loop until stable.

### Rendering

Tiles are absolutely-positioned divs with `background-image` + `background-position` to show their slice of the source image. CSS transitions on `left`/`top` animate swaps. The board uses `transform: scale()` to fit the viewport, and pointer coordinates are divided by scale factor during drag.

### State Persistence

`saveState()` writes `{rows, cols, grid, img, moveCount, moveLog}` to localStorage after every move. On load, `restoreState()` rebuilds tiles from the saved grid and runs `checkMerges()` to reconstruct groups — so code changes to merge/group logic take effect on reload. If a saved game exists, `app.js` navigates directly to the puzzle screen on startup.

### Bug Reporting

The "Report Bug" button in the sidebar captures a full snapshot (grid, tiles, groups, move log, geometry, integrity check, device info) and POSTs it to `/api/bugs`. Bug reports are stored as JSON files in `.bugs/` (or `BUGS_DIR` env var in Docker).

**CLI to inspect bug reports:**
```bash
./jigsaw-bugs                  # list all reports
./jigsaw-bugs <id>             # full JSON dump
./jigsaw-bugs <id> grid        # ASCII grid + groups
./jigsaw-bugs <id> moves       # move-by-move log
./jigsaw-bugs <id> delete      # remove a report
JIGSAW_URL=http://host:1997 ./jigsaw-bugs   # point at remote server
```

### Leaderboard & Scoring

Login-free — first time a player finishes a puzzle the server mints a 6-letter code (A–Z minus I, O), stored in `localStorage.jigsaw_identity`. A display name is optional; if unset, the UI shows a deterministic Docker-style fake name (`Jolly Fox`) from `js/fakename.js` so raw codes aren't visible on leaderboards. The real code only appears in Settings and the victory save-hint.

**Scoring formula** (`js/scoring.js`, source of truth for both sides):
```
tiles        = rows * cols
parMoves     = tiles * 1.8
parTimeSec   = tiles * 4.5
sizeMult     = sqrt(tiles / 4)
packMult     = pack.json difficulty (1.0 → 2.5)
moveRatio    = clamp(parMoves / moves, 0.3, 1.5)
timeRatio    = clamp(parTimeSec / secs, 0.3, 1.5)
score        = round(1000 * moveRatio * timeRatio * sizeMult * packMult * handicapMult)
```
Raw inputs (moves, durationMs, rows, cols, pack, image, handicaps) are always stored; `POST /api/admin/recompute` rewrites every score from raw inputs after tuning. The server recomputes scores server-side on `POST /api/scores` — never trusts a client-supplied score.

**Pack difficulty** lives per-pack in `images/<pack>/pack.json`:
```json
{ "difficulty": 1.8, "label": "hard" }
```
Missing file → `{1.0, "normal"}`. Loaded once at server boot and cached in memory (`server/packs.js`). Change and restart — or edit and hit `/api/admin/recompute` — to re-apply.

**SQLite DB**: `bun:sqlite` at `$DATA_DIR/jigsaw.db` (default `~/.jigsaw/data/jigsaw.db`). Two tables: `players(code, display_name, name_locked, created_at, last_seen_at)` and `scores(id, player_code, pack, image, rows, cols, moves, duration_ms, handicaps, score, client_started_at, created_at)`. Indexes on `(pack, image, rows, cols, score DESC)`, `(player_code, created_at DESC)`, `(score DESC)`. Claim-and-merge is a single transaction — old player's scores get reassigned then old player row deleted.

**Claim flow**: device A gets code `ABCDEF`; user enters it on device B (which has been playing as `XYZABC`). Server reassigns device B's scores to `ABCDEF` and deletes `XYZABC`. Client localStorage is updated to the claimed code. If the stored code is ever orphaned (e.g. DB reset), `validateIdentity()` at boot drops it, and a stale-code score submit transparently re-mints a fresh code and retries.

**Public endpoints:**
- `POST /api/players` — mint a new code
- `POST /api/players/claim {code, mergeFrom?}` — claim a code, optionally merging
- `PATCH /api/players/:code {displayName}` — set name (rejected if locked)
- `GET /api/players/:code/scores?limit=` — recent scores for one player
- `POST /api/scores {code, pack, image, rows, cols, moves, durationMs, clientStartedAt, handicaps}` — submit a completion; returns `{score, puzzleRank, globalRank, personalBest}`
- `GET /api/leaderboard/puzzle?pack=&image=&rows=&cols=&limit=`
- `GET /api/leaderboard/global?limit=`
- `GET /api/puzzle-summary?pack=&image=&code=` — all variants of a puzzle (top score + plays) + caller's per-variant bests. Drives the setup screen's per-difficulty stats.

**Admin endpoints** (`x-admin-token` header matching `$ADMIN_TOKEN`, OR requesting from 127.0.0.1/::1):
- `GET /api/admin/players?search=`
- `PATCH /api/admin/players/:code {displayName?, nameLocked?}`
- `DELETE /api/admin/players/:code` (cascades scores)
- `DELETE /api/admin/scores/:id`
- `POST /api/admin/recompute` — recompute all stored scores from raw inputs

**Admin UI**: `/?admin=1`. Localhost bypasses the token; remote needs the token pasted in the top field (stored in sessionStorage for the tab).

**CLI to admin scores** (mirrors `jigsaw-bugs`):
```bash
./jigsaw-scores                       # list players with totals
./jigsaw-scores player <code>         # show one player's recent scores
./jigsaw-scores rename <code> [name]  # empty name clears
./jigsaw-scores lock <code>           # lock / unlock display name
./jigsaw-scores delete-player <code>
./jigsaw-scores delete-score <id>
./jigsaw-scores recompute             # after tuning pack.json or formula
JIGSAW_URL=http://host:1997 ADMIN_TOKEN=secret ./jigsaw-scores players
```

## Images

Puzzle images live in `images/<pack>/` subdirectories (e.g. `images/pokemon/`). The server auto-discovers packs via `GET /api/packs`. The home screen shows all packs as cards; users pick a pack, then an image, then difficulty. To add a new pack, create a folder under `images/` with `.png`/`.jpg`/`.webp` files (and optional matching `.mp4` for victory videos). Source originals for the Pokemon pack are in `~/src/decklistgen/cache/` (the `*_fullart.png` files).
