import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { computeScore } from './js/scoring.js';
import * as db from './server/db.js';
import { loadPackMetadata, getPackMetadata, getAllPackMetadata } from './server/packs.js';
import { isAdmin } from './server/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const BUGS_DIR = process.env.BUGS_DIR || path.join(__dirname, '.bugs');
// DB location defaults outside Dropbox: SQLite WAL + Dropbox sync races cause
// SQLITE_IOERR_VNODE crashes. Override with DATA_DIR env if running in Docker / on the NAS.
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), '.jigsaw', 'data');
const STATIC_DIR = __dirname;
const IMAGES_DIR = path.join(__dirname, 'images');

// Ensure directories exist
fs.mkdirSync(BUGS_DIR, { recursive: true });
db.initDb(DATA_DIR);
loadPackMetadata(IMAGES_DIR);

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, { error: 'unauthorized' });
  return false;
}

function scoreFor(row) {
  const meta = getPackMetadata(row.pack);
  return computeScore({
    rows: row.rows,
    cols: row.cols,
    moves: row.moves,
    durationMs: row.duration_ms ?? row.durationMs,
    packMult: meta.difficulty,
    handicaps: typeof row.handicaps === 'string' ? JSON.parse(row.handicaps || '{}') : (row.handicaps || {}),
  });
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 2 * 1024 * 1024; // 2MB limit
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error(`[${req.method} ${req.url}]`, err);
    if (!res.headersSent) {
      try { sendJson(res, 500, { error: err.message || 'internal error' }); }
      catch { try { res.end(); } catch {} }
    } else {
      try { res.end(); } catch {}
    }
  });
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- API routes ---

  // GET /api/packs — list available image packs
  if (req.method === 'GET' && pathname === '/api/packs') {
    try {
      const entries = fs.readdirSync(IMAGES_DIR, { withFileTypes: true });
      const packs = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const packDir = path.join(IMAGES_DIR, entry.name);
        const files = fs.readdirSync(packDir);
        // Deduplicate: prefer .webp over .png/.jpg for same base name
        const imageFiles = files.filter(f => !f.startsWith('.') && /\.(png|jpe?g|webp)$/i.test(f));
        const byBase = new Map();
        for (const f of imageFiles) {
          const base = f.replace(/\.[^.]+$/, '');
          const existing = byBase.get(base);
          if (!existing || f.endsWith('.webp')) byBase.set(base, f);
        }
        const images = [...byBase.values()].sort((a, b) => {
          const na = parseInt(a.match(/\d+/)?.[0] || '0', 10);
          const nb = parseInt(b.match(/\d+/)?.[0] || '0', 10);
          return na - nb;
        });
        if (images.length === 0) continue;
        const videos = files.filter(f => /\.mp4$/i.test(f));
        // Read optional names.json for image display names
        let names = {};
        const namesFile = path.join(packDir, 'names.json');
        if (fs.existsSync(namesFile)) {
          try {
            const raw = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
            // Map filename keys to full image paths (match by base name for format flexibility)
            const namesByBase = new Map(Object.entries(raw).map(([k, v]) => [k.replace(/\.[^.]+$/, ''), v]));
            for (const img of images) {
              const base = img.replace(/\.[^.]+$/, '');
              if (namesByBase.has(base)) names[`images/${entry.name}/${img}`] = namesByBase.get(base);
            }
          } catch (e) {
            console.warn(`[packs] bad names.json in ${entry.name}:`, e.message);
          }
        }
        // Build thumbnails map: full path → thumb path (if thumbs/ subdir exists)
        // Thumbs may be WebP regardless of source format
        const thumbsDir = path.join(packDir, 'thumbs');
        const thumbFiles = fs.existsSync(thumbsDir) ? new Set(fs.readdirSync(thumbsDir)) : new Set();
        const thumbnails = {};
        for (const img of images) {
          const base = img.replace(/\.[^.]+$/, '');
          const webpThumb = base + '.webp';
          if (thumbFiles.has(webpThumb)) {
            thumbnails[`images/${entry.name}/${img}`] = `images/${entry.name}/thumbs/${webpThumb}`;
          } else if (thumbFiles.has(img)) {
            thumbnails[`images/${entry.name}/${img}`] = `images/${entry.name}/thumbs/${img}`;
          }
        }
        const meta = getPackMetadata(entry.name);
        packs.push({
          name: entry.name,
          label: entry.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          difficulty: meta.difficulty,
          difficultyLabel: meta.label,
          images: images.map(f => `images/${entry.name}/${f}`),
          thumbnails,
          names,
          videos: Object.fromEntries(
            images.map(img => {
              const base = img.replace(/\.[^.]+$/, '');
              const vid = videos.find(v => v.replace(/\.[^.]+$/, '') === base);
              return [`images/${entry.name}/${img}`, vid ? `images/${entry.name}/${vid}` : null];
            }).filter(([, v]) => v)
          ),
        });
      }
      packs.sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, 200, packs);
    } catch (e) {
      console.error('GET /api/packs error:', e);
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // POST /api/bugs — submit a bug report
  if (req.method === 'POST' && pathname === '/api/bugs') {
    try {
      const raw = await readBody(req);
      const report = JSON.parse(raw);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const id = `${ts}_${crypto.randomBytes(3).toString('hex')}`;
      report._id = id;
      report._receivedAt = new Date().toISOString();
      const file = path.join(BUGS_DIR, `${id}.json`);
      fs.writeFileSync(file, JSON.stringify(report, null, 2));
      console.log(`[bug] saved ${id}`);
      sendJson(res, 201, { id, ok: true });
    } catch (e) {
      console.error('[bug] save error:', e.message);
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // GET /api/bugs — list all bug reports
  if (req.method === 'GET' && pathname === '/api/bugs') {
    try {
      const files = fs.readdirSync(BUGS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      const bugs = files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), 'utf8'));
          return {
            id: data._id,
            timestamp: data.timestamp,
            image: data.game?.image,
            grid: `${data.game?.cols}x${data.game?.rows}`,
            moves: data.moves?.count,
            integrity: data.integrity,
            userAgent: data.userAgent?.substring(0, 80),
          };
        } catch { return { id: f, error: 'parse failed' }; }
      });
      sendJson(res, 200, bugs);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // GET /api/bugs/:id — get a specific bug report
  if (req.method === 'GET' && pathname.startsWith('/api/bugs/')) {
    const id = pathname.slice('/api/bugs/'.length);
    if (!id || id.includes('..') || id.includes('/')) {
      sendJson(res, 400, { error: 'invalid id' });
      return;
    }
    const file = path.join(BUGS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    try {
      const data = fs.readFileSync(file, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // DELETE /api/bugs/:id — delete a bug report
  if (req.method === 'DELETE' && pathname.startsWith('/api/bugs/')) {
    const id = pathname.slice('/api/bugs/'.length);
    if (!id || id.includes('..') || id.includes('/')) {
      sendJson(res, 400, { error: 'invalid id' });
      return;
    }
    const file = path.join(BUGS_DIR, `${id}.json`);
    if (!fs.existsSync(file)) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    fs.unlinkSync(file);
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- Leaderboard / identity routes ---

  // POST /api/players — mint a new code
  if (req.method === 'POST' && pathname === '/api/players') {
    try {
      const player = db.createPlayer();
      sendJson(res, 201, player);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
    return;
  }

  // POST /api/players/claim — claim code (optionally merging from old code)
  if (req.method === 'POST' && pathname === '/api/players/claim') {
    try {
      const raw = await readBody(req);
      const { code, mergeFrom } = JSON.parse(raw || '{}');
      if (!/^[A-Z]{6}$/.test(String(code || ''))) {
        sendJson(res, 400, { error: 'invalid code' });
        return;
      }
      const result = db.claimAndMerge(code, mergeFrom);
      if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
      sendJson(res, 200, result.player);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // PATCH /api/players/:code — set display name
  if (req.method === 'PATCH' && pathname.startsWith('/api/players/')) {
    const code = pathname.slice('/api/players/'.length);
    if (!/^[A-Z]{6}$/.test(code)) { sendJson(res, 400, { error: 'invalid code' }); return; }
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}');
      const result = db.updatePlayerName(code, body.displayName ?? '');
      if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
      sendJson(res, 200, result.player);
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // GET /api/players/:code/scores — recent scores for one player
  if (req.method === 'GET' && /^\/api\/players\/[A-Z]{6}\/scores$/.test(pathname)) {
    const code = pathname.split('/')[3];
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    const player = db.getPlayer(code);
    if (!player) { sendJson(res, 404, { error: 'not found' }); return; }
    sendJson(res, 200, { player, scores: db.playerScores(code, limit) });
    return;
  }

  // POST /api/scores — submit a completion
  if (req.method === 'POST' && pathname === '/api/scores') {
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const code = String(body.code || '');
      if (!/^[A-Z]{6}$/.test(code)) { sendJson(res, 400, { error: 'invalid code' }); return; }
      const player = db.getPlayer(code);
      if (!player) { sendJson(res, 404, { error: 'unknown code' }); return; }

      const rows = parseInt(body.rows, 10);
      const cols = parseInt(body.cols, 10);
      const moves = parseInt(body.moves, 10);
      const durationMs = parseInt(body.durationMs, 10);
      if (!(rows > 0) || !(cols > 0) || !(moves >= 0) || !(durationMs >= 0)) {
        sendJson(res, 400, { error: 'invalid fields' }); return;
      }
      const pack = String(body.pack || '').slice(0, 64);
      const image = String(body.image || '').slice(0, 512);
      if (!pack || !image) { sendJson(res, 400, { error: 'missing pack/image' }); return; }

      const meta = getPackMetadata(pack);
      const handicaps = body.handicaps && typeof body.handicaps === 'object' ? body.handicaps : {};
      const score = computeScore({ rows, cols, moves, durationMs, packMult: meta.difficulty, handicaps });

      const id = db.insertScore({
        playerCode: code, pack, image, rows, cols, moves, durationMs,
        handicaps, score,
        clientStartedAt: body.clientStartedAt ? parseInt(body.clientStartedAt, 10) : null,
      });
      db.touchPlayer(code);

      sendJson(res, 201, {
        id,
        score,
        puzzleRank: db.puzzleRank(pack, image, rows, cols, score),
        globalRank: db.globalRank(code),
        personalBest: db.personalBest(code, pack, image, rows, cols),
        packDifficulty: meta.difficulty,
        packDifficultyLabel: meta.label,
      });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  // GET /api/leaderboard/puzzle?pack=&image=&rows=&cols=
  if (req.method === 'GET' && pathname === '/api/leaderboard/puzzle') {
    const pack = url.searchParams.get('pack') || '';
    const image = url.searchParams.get('image') || '';
    const rows = parseInt(url.searchParams.get('rows') || '0', 10);
    const cols = parseInt(url.searchParams.get('cols') || '0', 10);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    if (!pack || !image || !rows || !cols) { sendJson(res, 400, { error: 'pack, image, rows, cols required' }); return; }
    sendJson(res, 200, db.puzzleLeaderboard({ pack, image, rows, cols, limit }));
    return;
  }

  // GET /api/leaderboard/global
  if (req.method === 'GET' && pathname === '/api/leaderboard/global') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
    sendJson(res, 200, db.globalLeaderboard({ limit }));
    return;
  }

  // GET /api/puzzle-summary — per-variant record + optionally the caller's bests
  if (req.method === 'GET' && pathname === '/api/puzzle-summary') {
    const pack = url.searchParams.get('pack');
    const image = url.searchParams.get('image');
    const code = url.searchParams.get('code');
    if (!pack || !image) { sendJson(res, 400, { error: 'pack, image required' }); return; }
    const variants = db.puzzleVariants(pack, image).map(r => ({
      rows: r.rows, cols: r.cols, plays: r.plays,
      top: { score: r.score, playerCode: r.player_code, displayName: r.display_name },
    }));
    const mine = (code && /^[A-Z]{6}$/.test(code) && db.getPlayer(code))
      ? db.playerBestsForPuzzle(code, pack, image).map(r => ({
          rows: r.rows, cols: r.cols,
          bestScore: r.best_score, bestMoves: r.best_moves,
          bestDurationMs: r.best_duration_ms, plays: r.plays,
        }))
      : [];
    sendJson(res, 200, { variants, mine });
    return;
  }

  // --- Admin routes ---

  if (pathname.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;

    if (req.method === 'GET' && pathname === '/api/admin/players') {
      const search = url.searchParams.get('search') || '';
      sendJson(res, 200, db.adminListPlayers(search));
      return;
    }

    let m;
    if (req.method === 'PATCH' && (m = pathname.match(/^\/api\/admin\/players\/([A-Z]{6})$/))) {
      try {
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}');
        const result = db.adminUpdatePlayer(m[1], body);
        if (!result.ok) { sendJson(res, result.status, { error: result.error }); return; }
        sendJson(res, 200, result.player);
      } catch (e) { sendJson(res, 400, { error: e.message }); }
      return;
    }
    if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/admin\/players\/([A-Z]{6})$/))) {
      const ok = db.deletePlayer(m[1]);
      sendJson(res, ok ? 200 : 404, { ok });
      return;
    }
    if (req.method === 'DELETE' && (m = pathname.match(/^\/api\/admin\/scores\/(\d+)$/))) {
      const ok = db.deleteScoreById(parseInt(m[1], 10));
      sendJson(res, ok ? 200 : 404, { ok });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/admin/recompute') {
      loadPackMetadata(IMAGES_DIR);
      const rows = db.allScoresForRecompute();
      let updated = 0;
      for (const r of rows) {
        const newScore = scoreFor(r);
        db.updateScoreValue(r.id, newScore);
        updated++;
      }
      sendJson(res, 200, { updated });
      return;
    }
    if (req.method === 'GET' && pathname === '/api/admin/packs') {
      sendJson(res, 200, getAllPackMetadata());
      return;
    }

    sendJson(res, 404, { error: 'admin route not found' });
    return;
  }

  // --- Static file serving ---

  let filePath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  filePath = path.normalize(filePath);
  if (filePath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const fullPath = path.join(STATIC_DIR, filePath);

  // Don't serve internal directories or scripts as static
  const SERVER_MODULES_DIR = path.join(__dirname, 'server');
  const base = path.basename(fullPath);
  if (
    fullPath.startsWith(BUGS_DIR) ||
    fullPath.startsWith(DATA_DIR) ||
    fullPath.startsWith(SERVER_MODULES_DIR) ||
    base === 'server.js' ||
    base === 'jigsaw-bugs' ||
    base === 'jigsaw-scores'
  ) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(fullPath);
    const mime = MIME[ext] || 'application/octet-stream';
    const fileSize = stat.size;
    const headers = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
    };
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      headers['Cache-Control'] = 'no-cache';
      headers['ETag'] = `"${fileSize}-${stat.mtimeMs}"`;
    } else {
      headers['Cache-Control'] = 'public, max-age=86400';
      headers['ETag'] = `"${fileSize}-${stat.mtimeMs}"`;
    }
    // ETag support: return 304 if client has current version
    const ifNoneMatch = req.headers['if-none-match'];
    if (headers['ETag'] && ifNoneMatch === headers['ETag']) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    // Range request support (required for iOS video playback)
    const range = req.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        fs.createReadStream(fullPath, { start, end }).pipe(res);
        return;
      }
    }
    headers['Content-Length'] = fileSize;
    res.writeHead(200, headers);
    fs.createReadStream(fullPath).pipe(res);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

server.listen(PORT, () => {
  console.log(`Jigsaw API server listening on :${PORT}`);
  console.log(`Bug reports stored in ${BUGS_DIR}`);
  console.log(`Leaderboard DB: ${path.join(DATA_DIR, 'jigsaw.db')}`);
});
