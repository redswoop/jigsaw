# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

Single-file web app (`index.html`) with Vite for dev and a Node server for the bug report API.

```bash
bun install                    # first time only
bun run dev                    # Vite (HMR) on :5173 + API server on :3002
```
Then open http://localhost:5173. Vite proxies `/api` to the API server. Puzzle state persists via localStorage.

**Production:** `bun run start` (or `node server.js`) serves everything on one port.

**Debug in browser console:**
```js
dump()   // prints grid ASCII, overlaps, group info, integrity checks
```

## Architecture

Multi-screen Vue 3 app (CDN, Composition API) split across four files:

```
index.html       — Vue template: screen layouts (home, picker, setup, puzzle)
css/style.css    — All styles
js/app.js        — Vue app shell, screen routing, pack loading
js/game.js       — Puzzle engine (createGameEngine(): tiles, groups, grid, moves, drag)
js/sounds.js     — Web Audio sound effects
```

Uses `<script type="module">` for ES imports. No build step — works with both Vite dev and static serving.

### Screen Flow

`currentScreen` ref drives navigation: **home** (pack gallery) → **picker** (image grid) → **setup** (difficulty) → **puzzle** (gameplay). Saved games in localStorage skip straight to puzzle on load. URL params (`?puzzle=N&cols=C&pack=name`) also skip to puzzle.

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

## Images

Puzzle images live in `images/<pack>/` subdirectories (e.g. `images/pokemon/`). The server auto-discovers packs via `GET /api/packs`. The home screen shows all packs as cards; users pick a pack, then an image, then difficulty. To add a new pack, create a folder under `images/` with `.png`/`.jpg`/`.webp` files (and optional matching `.mp4` for victory videos). Source originals for the Pokemon pack are in `~/src/decklistgen/cache/` (the `*_fullart.png` files).
