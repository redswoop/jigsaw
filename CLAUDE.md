# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

This is a zero-build single-file web app. No package.json, no bundler, no dependencies to install.

**Run locally:**
```bash
npx live-server --port=8080    # auto-reloads on file changes
```
Then open http://localhost:8080. The live-server enables HMR-like behavior: puzzle state persists across reloads via localStorage (grid positions saved, groups recomputed from adjacency on restore).

**Debug in browser console:**
```js
dump()   // prints grid ASCII, overlaps, group info, integrity checks
```

## Architecture

Everything lives in `index.html` (~900 lines): HTML template, CSS, and JS in one file. Vue 3 is loaded via CDN (`unpkg.com/vue@3`). No components — it's a single `setup()` function using the Composition API.

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

`saveState()` writes `{rows, cols, grid, img}` to localStorage after every move. On load, `restoreState()` rebuilds tiles from the saved grid and runs `checkMerges()` to reconstruct groups — so code changes to merge/group logic take effect on reload.

## Images

Puzzle images are `card1.png`, `card2.png`, `card3.png` in the project root (fullart Pokemon cards). A random one is picked on "New Game". Source originals are in `~/src/decklistgen/cache/` (the `*_fullart.png` files).
