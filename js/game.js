// Puzzle engine — tiles, groups, grid, moves, merges, drag, undo
import { playThump, playClick, enableSound } from './sounds.js';

const { reactive, ref, computed, nextTick } = Vue;

export function createGameEngine() {
  const naturalW = ref(0);
  const naturalH = ref(0);
  const sliderCols = ref(8);
  const COLS = ref(8);
  const ROWS = ref(10);
  const imgW = computed(() => naturalW.value);
  const imgH = computed(() => naturalH.value);
  const tileW = computed(() => imgW.value / COLS.value);
  const tileH = computed(() => imgH.value / ROWS.value);
  const won = ref(false);
  const imgSrc = ref('');
  const breakGroupsOption = ref(true);
  const scale = ref(1);

  const boardStyle = computed(() => {
    const s = scale.value;
    const w = imgW.value;
    const h = imgH.value;
    return {
      width: w + 'px',
      height: h + 'px',
      transform: `scale(${s})`,
      // Negative margins shrink the layout box to match the visual (scaled) size,
      // preventing flex centering from clipping oversized content.
      marginRight: -(w * (1 - s)) + 'px',
      marginBottom: -(h * (1 - s)) + 'px',
    };
  });

  // Core state
  let nextGroupId = 0;
  const tiles = reactive([]);
  const groups = reactive({});
  const grid = reactive([]);
  const tilePos = reactive(new Map());

  // Move tracking
  const moveCount = ref(0);
  const moveLog = [];
  const undoStack = reactive([]);
  const gameStartedAt = ref(new Date().toISOString());
  const bugStatus = ref('');

  // Drag state
  let dragGroupId = null;
  let dragAnchorId = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragOriginPositions = null;
  let dragGroupOffsets = null;
  const dropHighlights = reactive([]);
  const dropValid = ref(false);
  const draggingTileIds = reactive(new Set());

  function computeScale() {
    if (!naturalW.value || !naturalH.value) return;
    const wrap = document.getElementById('board-wrap');
    if (!wrap) return;
    const style = getComputedStyle(wrap);
    const padTop = parseFloat(style.paddingTop) || 0;
    const padBottom = parseFloat(style.paddingBottom) || 0;
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const wrapRect = wrap.getBoundingClientRect();
    const caption = wrap.querySelector('.board-caption');
    const captionH = caption ? caption.offsetHeight : 0;
    const availW = wrapRect.width - padLeft - padRight;
    const availH = wrapRect.height - padTop - padBottom - captionH;
    const sx = availW / naturalW.value;
    const sy = availH / naturalH.value;
    scale.value = Math.min(sx, sy, 1);
  }

  function computeGridSize(cols) {
    if (cols == null) cols = sliderCols.value;
    const aspect = naturalH.value / naturalW.value;
    const rows = Math.round(cols * aspect);
    return { cols, rows: Math.max(rows, 2) };
  }

  function initGame() {
    const R = ROWS.value;
    const C = COLS.value;

    for (const key of Object.keys(groups)) {
      delete groups[key];
    }
    nextGroupId = 0;

    tiles.length = 0;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const id = r * C + c;
        const gid = nextGroupId++;
        tiles.push(reactive({
          id,
          trueRow: r,
          trueCol: c,
          groupId: gid,
        }));
        groups[gid] = reactive({ id: gid, tileIds: new Set([id]) });
      }
    }

    const ids = tiles.map(t => t.id);
    let attempts = 0;
    do {
      shuffle(ids);
      attempts++;
    } while (hasAdjacentTrueNeighbors(ids) && attempts < 1000);

    grid.length = 0;
    tilePos.clear();
    for (let r = 0; r < R; r++) {
      grid.push([]);
      for (let c = 0; c < C; c++) {
        const tid = ids[r * C + c];
        grid[r].push(tid);
        tilePos.set(tid, { row: r, col: c });
      }
    }
  }

  // Start a new game with a specific image and column count
  function startGame(imagePath, cols) {
    if (!imagePath) return Promise.resolve();
    localStorage.removeItem('jigsaw_state');
    imgSrc.value = imagePath;
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        naturalW.value = img.naturalWidth;
        naturalH.value = img.naturalHeight;
        sliderCols.value = cols;
        const size = computeGridSize(cols);
        COLS.value = size.cols;
        ROWS.value = size.rows;
        won.value = false;
        moveCount.value = 0;
        moveLog.length = 0;
        undoStack.length = 0;
        gameStartedAt.value = new Date().toISOString();
        initGame();
        saveState();
        nextTick(computeScale);
        resolve();
      };
      img.src = imagePath;
    });
  }

  // --- Undo ---

  function snapshotGrid() {
    const R = ROWS.value, C = COLS.value;
    const flat = [];
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++)
        flat.push(grid[r][c]);
    return flat;
  }

  function undo() {
    if (!undoStack.length) return;
    const snap = undoStack.pop();
    const R = ROWS.value, C = COLS.value;

    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const tid = snap[r * C + c];
        grid[r][c] = tid;
        tilePos.set(tid, { row: r, col: c });
      }

    for (const key of Object.keys(groups)) delete groups[key];
    nextGroupId = 0;
    for (const tile of tiles) {
      const gid = nextGroupId++;
      groups[gid] = reactive({ id: gid, tileIds: new Set([tile.id]) });
      tile.groupId = gid;
    }
    checkMerges();

    moveCount.value--;
    moveLog.pop();
    won.value = false;
    saveState();
  }

  const canUndo = computed(() => undoStack.length > 0);

  // --- State persistence ---

  function saveState() {
    const R = ROWS.value, C = COLS.value;
    const flatGrid = [];
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        flatGrid.push(grid[r][c]);
      }
    }
    const state = {
      rows: R, cols: C, grid: flatGrid, img: imgSrc.value,
      moveCount: moveCount.value, moveLog: moveLog.slice(),
      undoStack: undoStack.slice(),
      gameStartedAt: gameStartedAt.value,
    };
    try { localStorage.setItem('jigsaw_state', JSON.stringify(state)); } catch(e) {}
  }

  function restoreState() {
    try {
      const raw = localStorage.getItem('jigsaw_state');
      if (!raw) return false;
      const state = JSON.parse(raw);
      if (!state || !state.grid || !state.rows || !state.cols) return false;

      const R = state.rows;
      const C = state.cols;
      const total = R * C;
      if (state.grid.length !== total) return false;

      const seen = new Set(state.grid);
      if (seen.size !== total) return false;
      for (let i = 0; i < total; i++) {
        if (!seen.has(i)) return false;
      }

      COLS.value = C;
      ROWS.value = R;
      sliderCols.value = C;
      if (state.img) imgSrc.value = state.img;

      for (const key of Object.keys(groups)) {
        delete groups[key];
      }
      nextGroupId = 0;

      tiles.length = 0;
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          const id = r * C + c;
          const gid = nextGroupId++;
          tiles.push(reactive({
            id,
            trueRow: r,
            trueCol: c,
            groupId: gid,
          }));
          groups[gid] = reactive({ id: gid, tileIds: new Set([id]) });
        }
      }

      grid.length = 0;
      tilePos.clear();
      for (let r = 0; r < R; r++) {
        grid.push([]);
        for (let c = 0; c < C; c++) {
          const tid = state.grid[r * C + c];
          grid[r].push(tid);
          tilePos.set(tid, { row: r, col: c });
        }
      }

      moveCount.value = state.moveCount || 0;
      moveLog.length = 0;
      if (state.moveLog) moveLog.push(...state.moveLog);
      undoStack.length = 0;
      if (state.undoStack) undoStack.push(...state.undoStack);
      gameStartedAt.value = state.gameStartedAt || new Date().toISOString();

      checkMerges();
      won.value = false;
      checkWin();

      return true;
    } catch(e) {
      console.warn('Failed to restore state:', e);
      return false;
    }
  }

  // Load image dimensions (for restoring or computing grid sizes without starting a game)
  function loadImageDimensions(imagePath) {
    if (!imagePath) return Promise.resolve();
    return new Promise((resolve) => {
      imgSrc.value = imagePath;
      const img = new Image();
      img.onload = () => {
        naturalW.value = img.naturalWidth;
        naturalH.value = img.naturalHeight;
        resolve();
      };
      img.src = imagePath;
    });
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function hasAdjacentTrueNeighbors(ids) {
    const R = ROWS.value, C = COLS.value;
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const t = tiles[ids[r * C + c]];
        if (c + 1 < C) {
          const t2 = tiles[ids[r * C + c + 1]];
          if (t.trueRow === t2.trueRow && t.trueCol + 1 === t2.trueCol) return true;
        }
        if (r + 1 < R) {
          const t2 = tiles[ids[(r + 1) * C + c]];
          if (t.trueCol === t2.trueCol && t.trueRow + 1 === t2.trueRow) return true;
        }
      }
    }
    return false;
  }

  // --- Tile rendering ---

  function tileStyle(tile) {
    const pos = tilePos.get(tile.id);
    if (!pos || !tileW.value) return {};
    const style = {
      width: tileW.value + 'px',
      height: tileH.value + 'px',
      backgroundImage: `url(${imgSrc.value})`,
      backgroundPosition: `-${tile.trueCol * tileW.value}px -${tile.trueRow * tileH.value}px`,
      '--img-w': imgW.value + 'px',
      '--img-h': imgH.value + 'px',
    };
    if (draggingTileIds.has(tile.id) && tile._dragX != null) {
      style.left = tile._dragX + 'px';
      style.top = tile._dragY + 'px';
    } else {
      style.left = pos.col * tileW.value + 'px';
      style.top = pos.row * tileH.value + 'px';
    }
    return style;
  }

  function tileClasses(tile) {
    const pos = tilePos.get(tile.id);
    if (!pos) return {};
    const R = ROWS.value, C = COLS.value;
    const g = groups[tile.groupId];
    const classes = {
      dragging: draggingTileIds.has(tile.id),
    };
    if (g) {
      const dirs = [
        ['no-border-top', -1, 0],
        ['no-border-bottom', 1, 0],
        ['no-border-left', 0, -1],
        ['no-border-right', 0, 1],
      ];
      for (const [cls, dr, dc] of dirs) {
        const nr = pos.row + dr;
        const nc = pos.col + dc;
        if (nr >= 0 && nr < R && nc >= 0 && nc < C) {
          const neighborId = grid[nr][nc];
          if (tiles[neighborId].groupId === tile.groupId) {
            classes[cls] = true;
          }
        }
      }
    }
    return classes;
  }

  // --- Drag & Drop ---

  function onPointerDown(e) {
    if (won.value) return;
    const R = ROWS.value, C = COLS.value;
    const boardRect = e.currentTarget.getBoundingClientRect();
    const s = scale.value;
    const x = (e.clientX - boardRect.left) / s;
    const y = (e.clientY - boardRect.top) / s;
    const col = Math.floor(x / tileW.value);
    const row = Math.floor(y / tileH.value);
    if (row < 0 || row >= R || col < 0 || col >= C) return;

    const tid = grid[row][col];
    const tile = tiles[tid];
    const g = groups[tile.groupId];

    dragGroupId = tile.groupId;
    dragAnchorId = tid;
    dragOffsetX = x - col * tileW.value;
    dragOffsetY = y - row * tileH.value;

    const anchorPos = tilePos.get(tid);
    dragOriginPositions = new Map();
    dragGroupOffsets = new Map();
    for (const gTid of g.tileIds) {
      const p = tilePos.get(gTid);
      dragOriginPositions.set(gTid, { row: p.row, col: p.col });
      dragGroupOffsets.set(gTid, { dr: p.row - anchorPos.row, dc: p.col - anchorPos.col });
      draggingTileIds.add(gTid);
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    enableSound();
    playThump();
  }

  function onPointerMove(e) {
    if (dragGroupId == null) return;
    const boardRect = e.currentTarget.getBoundingClientRect();
    const s = scale.value;
    const x = (e.clientX - boardRect.left) / s;
    const y = (e.clientY - boardRect.top) / s;

    const anchorX = x - dragOffsetX;
    const anchorY = y - dragOffsetY;
    const g = groups[dragGroupId];
    for (const gTid of g.tileIds) {
      const off = dragGroupOffsets.get(gTid);
      const t = tiles[gTid];
      t._dragX = anchorX + off.dc * tileW.value;
      t._dragY = anchorY + off.dr * tileH.value;
    }

    const anchorTargetCol = Math.round(anchorX / tileW.value);
    const anchorTargetRow = Math.round(anchorY / tileH.value);
    updateDropHighlight(anchorTargetRow, anchorTargetCol);
  }

  function onPointerUp(e) {
    if (dragGroupId == null) return;
    const boardRect = e.currentTarget.getBoundingClientRect();
    const s = scale.value;
    const x = (e.clientX - boardRect.left) / s;
    const y = (e.clientY - boardRect.top) / s;

    const anchorX = x - dragOffsetX;
    const anchorY = y - dragOffsetY;
    const anchorTargetCol = Math.round(anchorX / tileW.value);
    const anchorTargetRow = Math.round(anchorY / tileH.value);

    for (const gTid of draggingTileIds) {
      delete tiles[gTid]._dragX;
      delete tiles[gTid]._dragY;
    }
    draggingTileIds.clear();
    dropHighlights.length = 0;

    const g = groups[dragGroupId];
    const anchorOrigin = dragOriginPositions.get(dragAnchorId);

    if (anchorTargetRow === anchorOrigin.row && anchorTargetCol === anchorOrigin.col) {
      resetDrag();
      return;
    }

    const beforeSnap = snapshotGrid();
    const result = tryMove(dragGroupId, anchorTargetRow, anchorTargetCol);
    if (result) {
      undoStack.push(beforeSnap);
      moveCount.value++;
      const anchorOriginPos = dragOriginPositions.get(dragAnchorId);
      moveLog.push({
        n: moveCount.value,
        t: Date.now(),
        groupId: dragGroupId,
        groupSize: g.tileIds.size,
        from: { row: anchorOriginPos.row, col: anchorOriginPos.col },
        to: { row: anchorTargetRow, col: anchorTargetCol },
      });
      checkMerges();
      checkWin();
      saveState();
    }

    resetDrag();
  }

  function resetDrag() {
    dragGroupId = null;
    dragAnchorId = null;
    dragOriginPositions = null;
    dragGroupOffsets = null;
  }

  function updateDropHighlight(targetRow, targetCol) {
    dropHighlights.length = 0;
    if (dragGroupId == null) return;

    const g = groups[dragGroupId];
    const plan = computeMovePlan(dragGroupId, targetRow, targetCol);
    dropValid.value = !!plan;

    for (const gTid of g.tileIds) {
      const off = dragGroupOffsets.get(gTid);
      const r = targetRow + off.dr;
      const c = targetCol + off.dc;
      dropHighlights.push({ row: r, col: c });
    }
  }

  // --- Move Logic ---

  function computeMovePlan(groupId, anchorTargetRow, anchorTargetCol) {
    const R = ROWS.value, C = COLS.value;
    const g = groups[groupId];

    const sourceCells = new Map();
    for (const gTid of g.tileIds) {
      const p = dragOriginPositions.get(gTid);
      sourceCells.set(gTid, { row: p.row, col: p.col });
    }

    const targetCells = new Map();
    for (const gTid of g.tileIds) {
      const off = dragGroupOffsets.get(gTid);
      const r = anchorTargetRow + off.dr;
      const c = anchorTargetCol + off.dc;
      if (r < 0 || r >= R || c < 0 || c >= C) return null;
      targetCells.set(gTid, { row: r, col: c });
    }

    const displacedTileSet = new Set();
    for (const [_, pos] of targetCells) {
      const occupant = grid[pos.row][pos.col];
      if (!g.tileIds.has(occupant)) {
        displacedTileSet.add(occupant);
      }
    }

    const displacedGroupIds = new Set();
    for (const tid of displacedTileSet) {
      displacedGroupIds.add(tiles[tid].groupId);
    }
    for (const dgId of displacedGroupIds) {
      const dg = groups[dgId];
      if (!dg) continue;
      for (const dgTid of dg.tileIds) {
        displacedTileSet.add(dgTid);
      }
    }

    const freedCellSet = new Set();
    for (const [_, pos] of sourceCells) {
      freedCellSet.add(`${pos.row},${pos.col}`);
    }
    for (const tid of displacedTileSet) {
      const p = tilePos.get(tid);
      freedCellSet.add(`${p.row},${p.col}`);
    }
    for (const [_, pos] of targetCells) {
      freedCellSet.delete(`${pos.row},${pos.col}`);
    }

    const vacatedCells = [...freedCellSet].map(key => {
      const [r, c] = key.split(',').map(Number);
      return { row: r, col: c };
    });

    if (displacedTileSet.size !== vacatedCells.length) return null;

    const assignments = assignDisplacedTiles(displacedTileSet, displacedGroupIds, vacatedCells, freedCellSet, false);
    if (assignments) {
      return { targetCells, assignments, brokenGroupIds: new Set() };
    }

    if (breakGroupsOption.value) {
      const scattered = assignDisplacedTiles(displacedTileSet, displacedGroupIds, vacatedCells, freedCellSet, true);
      if (scattered) {
        return { targetCells, assignments: scattered, brokenGroupIds: new Set(displacedGroupIds) };
      }
    }

    return null;
  }

  function assignDisplacedTiles(displacedTileSet, displacedGroupIds, vacatedCells, freedCellSet, forceBreak) {
    const R = ROWS.value, C = COLS.value;
    const assignments = new Map();
    const usedVacated = new Set();

    if (!forceBreak) {
      for (const dgId of displacedGroupIds) {
        const dg = groups[dgId];
        const allGroupTiles = [...dg.tileIds];
        const firstPos = tilePos.get(allGroupTiles[0]);
        const shape = allGroupTiles.map(tid => {
          const p = tilePos.get(tid);
          return { tid, dr: p.row - firstPos.row, dc: p.col - firstPos.col };
        });

        let bestPlacement = null;
        let bestDist = Infinity;
        for (const vc of vacatedCells) {
          if (usedVacated.has(`${vc.row},${vc.col}`)) continue;
          const placement = [];
          let valid = true;
          for (const s of shape) {
            const r = vc.row + s.dr;
            const c = vc.col + s.dc;
            const key = `${r},${c}`;
            if (r < 0 || r >= R || c < 0 || c >= C) { valid = false; break; }
            if (!freedCellSet.has(key) || usedVacated.has(key)) { valid = false; break; }
            placement.push({ tid: s.tid, row: r, col: c });
          }
          if (!valid) continue;
          const dist = Math.abs(vc.row - firstPos.row) + Math.abs(vc.col - firstPos.col);
          if (dist < bestDist) {
            bestDist = dist;
            bestPlacement = placement;
          }
        }
        if (!bestPlacement) return null;
        for (const p of bestPlacement) {
          assignments.set(p.tid, { row: p.row, col: p.col });
          usedVacated.add(`${p.row},${p.col}`);
        }
      }
    }

    for (const tid of displacedTileSet) {
      if (assignments.has(tid)) continue;
      const curPos = tilePos.get(tid);
      let bestCell = null;
      let bestDist = Infinity;
      for (const vc of vacatedCells) {
        const key = `${vc.row},${vc.col}`;
        if (usedVacated.has(key)) continue;
        const dist = Math.abs(vc.row - curPos.row) + Math.abs(vc.col - curPos.col);
        if (dist < bestDist) {
          bestDist = dist;
          bestCell = vc;
        }
      }
      if (!bestCell) return null;
      assignments.set(tid, { row: bestCell.row, col: bestCell.col });
      usedVacated.add(`${bestCell.row},${bestCell.col}`);
    }

    return assignments;
  }

  function tryMove(groupId, anchorTargetRow, anchorTargetCol) {
    const plan = computeMovePlan(groupId, anchorTargetRow, anchorTargetCol);
    if (!plan) return false;

    const { targetCells, assignments, brokenGroupIds } = plan;

    for (const dgId of brokenGroupIds) {
      const dg = groups[dgId];
      if (!dg) continue;
      for (const tid of dg.tileIds) {
        const newGid = nextGroupId++;
        groups[newGid] = reactive({ id: newGid, tileIds: new Set([tid]) });
        tiles[tid].groupId = newGid;
      }
      delete groups[dgId];
    }

    for (const [tid, pos] of targetCells) {
      grid[pos.row][pos.col] = tid;
      tilePos.set(tid, { row: pos.row, col: pos.col });
    }
    for (const [tid, pos] of assignments) {
      grid[pos.row][pos.col] = tid;
      tilePos.set(tid, { row: pos.row, col: pos.col });
    }

    const errors = checkIntegrity();
    if (errors.length) {
      console.error('INTEGRITY FAILURE after move:', errors);
    }

    return true;
  }

  function checkIntegrity() {
    const R = ROWS.value, C = COLS.value;
    const errors = [];
    const seen = new Set();
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const tid = grid[r][c];
        if (tid == null || tid < 0 || tid >= tiles.length) {
          errors.push(`grid[${r}][${c}] = ${tid} (invalid)`);
          continue;
        }
        if (seen.has(tid)) {
          errors.push(`tile ${tid} appears in grid more than once (at ${r},${c})`);
        }
        seen.add(tid);
        const pos = tilePos.get(tid);
        if (pos.row !== r || pos.col !== c) {
          errors.push(`tile ${tid}: grid says (${r},${c}) but tilePos says (${pos.row},${pos.col})`);
        }
      }
    }
    if (seen.size !== R * C) {
      errors.push(`only ${seen.size} unique tiles in grid, expected ${R * C}`);
    }
    return errors;
  }

  // --- Merge Logic ---

  function checkMerges() {
    const R = ROWS.value, C = COLS.value;
    let merged = true;
    while (merged) {
      merged = false;
      for (const tile of tiles) {
        if (!groups[tile.groupId]) continue;
        const pos = tilePos.get(tile.id);
        const neighbors = [[0, 1], [1, 0]];
        for (const [dr, dc] of neighbors) {
          const nr = pos.row + dr;
          const nc = pos.col + dc;
          if (nr < 0 || nr >= R || nc < 0 || nc >= C) continue;
          const neighborId = grid[nr][nc];
          const neighbor = tiles[neighborId];
          if (!groups[neighbor.groupId]) continue;
          if (tile.groupId === neighbor.groupId) continue;
          if (tile.trueRow + dr === neighbor.trueRow && tile.trueCol + dc === neighbor.trueCol) {
            mergeGroups(tile.groupId, neighbor.groupId);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }
  }

  function mergeGroups(gIdA, gIdB) {
    const gA = groups[gIdA];
    const gB = groups[gIdB];
    for (const tid of gB.tileIds) {
      gA.tileIds.add(tid);
      tiles[tid].groupId = gIdA;
    }
    delete groups[gIdB];
    playThump();
  }

  function checkWin() {
    const allCorrect = tiles.every(t => {
      const pos = tilePos.get(t.id);
      return pos.row === t.trueRow && pos.col === t.trueCol;
    });
    if (allCorrect && tiles.length > 0) {
      won.value = true;
    }
  }

  // --- Bug Reporting ---

  async function reportBug() {
    if (bugStatus.value === 'sending') return;
    bugStatus.value = 'sending';
    try {
      const R = ROWS.value, C = COLS.value;

      const flatGrid = [];
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < C; c++) {
          flatGrid.push(grid[r][c]);
        }
      }

      const groupSnapshot = {};
      for (const [gId, g] of Object.entries(groups)) {
        groupSnapshot[gId] = [...g.tileIds];
      }

      const tileSnapshot = tiles.map(t => ({
        id: t.id,
        trueRow: t.trueRow,
        trueCol: t.trueCol,
        groupId: t.groupId,
        pos: tilePos.get(t.id),
      }));

      const integrity = checkIntegrity();

      let ascii = '';
      for (let r = 0; r < R; r++) {
        ascii += grid[r].map(tid => String(tid).padStart(3)).join(' ') + '\n';
      }

      const report = {
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        game: {
          image: imgSrc.value,
          rows: R,
          cols: C,
          totalTiles: R * C,
          naturalW: naturalW.value,
          naturalH: naturalH.value,
          tileW: tileW.value,
          tileH: tileH.value,
          scale: scale.value,
          won: won.value,
          breakGroups: breakGroupsOption.value,
        },
        moves: {
          count: moveCount.value,
          log: moveLog.slice(),
          gameStartedAt: gameStartedAt.value,
        },
        state: {
          grid: flatGrid,
          ascii: ascii,
          tiles: tileSnapshot,
          groups: groupSnapshot,
          groupCount: Object.keys(groups).length,
          nextGroupId: nextGroupId,
        },
        integrity: integrity.length ? integrity : 'ok',
      };

      const res = await fetch('/api/bugs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });

      if (res.ok) {
        const data = await res.json();
        bugStatus.value = `sent #${data.id}`;
        setTimeout(() => { if (bugStatus.value.startsWith('sent')) bugStatus.value = ''; }, 5000);
      } else {
        bugStatus.value = `error ${res.status}`;
      }
    } catch (e) {
      console.error('Bug report failed:', e);
      bugStatus.value = 'failed (server down?)';
    }
  }

  // --- Debug ---
  window.dump = function() {
    const R = ROWS.value, C = COLS.value;
    const cellMap = {};
    for (const t of tiles) {
      const pos = tilePos.get(t.id);
      const key = `${pos.row},${pos.col}`;
      if (!cellMap[key]) cellMap[key] = [];
      cellMap[key].push(t.id);
    }
    const overlaps = Object.entries(cellMap).filter(([_, ids]) => ids.length > 1);
    let ascii = '\n';
    for (let r = 0; r < R; r++) {
      ascii += grid[r].map(tid => String(tid).padStart(3)).join(' ') + '\n';
    }
    const groupSummary = Object.entries(groups)
      .filter(([_, g]) => g.tileIds.size > 1)
      .map(([gId, g]) => ({ gId, size: g.tileIds.size, tiles: [...g.tileIds] }));
    console.log('Overlaps:', overlaps.length ? overlaps : 'none');
    console.log('Groups:', groupSummary.length ? groupSummary : 'none');
    console.log(ascii);
    return { overlaps, groupSummary, ascii };
  };

  return {
    // State
    tiles, groups, grid, tilePos,
    naturalW, naturalH, COLS, ROWS, sliderCols, imgSrc,
    imgW, imgH, tileW, tileH,
    won, scale, boardStyle,
    breakGroupsOption, moveCount, canUndo,
    dropHighlights, dropValid, draggingTileIds,
    bugStatus, gameStartedAt, moveLog,

    // Methods
    startGame, initGame, undo, computeScale, computeGridSize,
    loadImageDimensions,
    tileStyle, tileClasses,
    onPointerDown, onPointerMove, onPointerUp,
    saveState, restoreState, reportBug,
    checkIntegrity,
  };
}
