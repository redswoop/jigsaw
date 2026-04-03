import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT ?? '3002', 10);
const BUGS_DIR = process.env.BUGS_DIR || path.join(__dirname, '.bugs');
const STATIC_DIR = __dirname;

// Ensure bugs directory exists
fs.mkdirSync(BUGS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // --- API routes ---

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

  // Don't serve the bugs directory, server.js, or CLI script as static
  if (fullPath.startsWith(BUGS_DIR) || path.basename(fullPath) === 'server.js' || path.basename(fullPath) === 'jigsaw-bugs') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) throw new Error('not a file');
    const ext = path.extname(fullPath);
    const mime = MIME[ext] || 'application/octet-stream';
    const data = fs.readFileSync(fullPath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Jigsaw API server listening on :${PORT}`);
  console.log(`Bug reports stored in ${BUGS_DIR}`);
});
