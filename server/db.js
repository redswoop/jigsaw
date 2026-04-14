import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';

let db = null;

export function initDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'jigsaw.db');
  db = new Database(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      code          TEXT PRIMARY KEY,
      display_name  TEXT,
      name_locked   INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scores (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      player_code       TEXT NOT NULL REFERENCES players(code) ON DELETE CASCADE,
      pack              TEXT NOT NULL,
      image             TEXT NOT NULL,
      rows              INTEGER NOT NULL,
      cols              INTEGER NOT NULL,
      moves             INTEGER NOT NULL,
      duration_ms       INTEGER NOT NULL,
      handicaps         TEXT NOT NULL DEFAULT '{}',
      score             INTEGER NOT NULL,
      client_started_at INTEGER,
      created_at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scores_puzzle ON scores(pack, image, rows, cols, score DESC);
    CREATE INDEX IF NOT EXISTS idx_scores_player ON scores(player_code, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scores_global ON scores(score DESC);
  `);

  return db;
}

export function getDb() {
  if (!db) throw new Error('db not initialized');
  return db;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, no O

export function mintCode() {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export function createPlayer() {
  const now = Date.now();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = mintCode();
    try {
      db.prepare(
        'INSERT INTO players (code, display_name, name_locked, created_at, last_seen_at) VALUES (?, NULL, 0, ?, ?)'
      ).run(code, now, now);
      return getPlayer(code);
    } catch (e) {
      if (String(e).includes('UNIQUE')) continue;
      throw e;
    }
  }
  throw new Error('could not mint unique code');
}

export function getPlayer(code) {
  const row = db.prepare('SELECT code, display_name, name_locked, created_at, last_seen_at FROM players WHERE code = ?').get(code);
  if (!row) return null;
  return {
    code: row.code,
    displayName: row.display_name,
    nameLocked: !!row.name_locked,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function touchPlayer(code) {
  db.prepare('UPDATE players SET last_seen_at = ? WHERE code = ?').run(Date.now(), code);
}

export function updatePlayerName(code, displayName) {
  const p = getPlayer(code);
  if (!p) return { ok: false, status: 404, error: 'not found' };
  if (p.nameLocked) return { ok: false, status: 409, error: 'name locked' };
  const name = validateName(displayName);
  if (name === null) return { ok: false, status: 400, error: 'invalid name' };
  db.prepare('UPDATE players SET display_name = ? WHERE code = ?').run(name, code);
  return { ok: true, player: getPlayer(code) };
}

export function validateName(name) {
  if (name == null) return null;
  const s = String(name).trim();
  if (s.length === 0) return '';
  if (s.length > 20) return null;
  // Printable ASCII + basic extended range; reject control chars
  if (/[\x00-\x1f\x7f]/.test(s)) return null;
  return s;
}

export function adminUpdatePlayer(code, { displayName, nameLocked }) {
  const p = getPlayer(code);
  if (!p) return { ok: false, status: 404, error: 'not found' };
  if (displayName !== undefined) {
    const name = displayName === null ? null : validateName(displayName);
    if (displayName !== null && name === null) return { ok: false, status: 400, error: 'invalid name' };
    db.prepare('UPDATE players SET display_name = ? WHERE code = ?').run(name, code);
  }
  if (nameLocked !== undefined) {
    db.prepare('UPDATE players SET name_locked = ? WHERE code = ?').run(nameLocked ? 1 : 0, code);
  }
  return { ok: true, player: getPlayer(code) };
}

export function deletePlayer(code) {
  const info = db.prepare('DELETE FROM players WHERE code = ?').run(code);
  return info.changes > 0;
}

export function claimAndMerge(targetCode, mergeFromCode) {
  const target = getPlayer(targetCode);
  if (!target) return { ok: false, status: 404, error: 'not found' };
  if (mergeFromCode && mergeFromCode !== targetCode) {
    const source = getPlayer(mergeFromCode);
    if (source) {
      const tx = db.transaction(() => {
        db.prepare('UPDATE scores SET player_code = ? WHERE player_code = ?').run(targetCode, mergeFromCode);
        db.prepare('DELETE FROM players WHERE code = ?').run(mergeFromCode);
      });
      tx();
    }
  }
  touchPlayer(targetCode);
  return { ok: true, player: getPlayer(targetCode) };
}

export function insertScore(row) {
  const info = db.prepare(
    `INSERT INTO scores (player_code, pack, image, rows, cols, moves, duration_ms, handicaps, score, client_started_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.playerCode, row.pack, row.image, row.rows, row.cols,
    row.moves, row.durationMs, JSON.stringify(row.handicaps || {}),
    row.score, row.clientStartedAt ?? null, Date.now()
  );
  return info.lastInsertRowid;
}

export function puzzleLeaderboard({ pack, image, rows, cols, limit = 50 }) {
  return db.prepare(`
    SELECT s.id, s.player_code, p.display_name, s.score, s.moves, s.duration_ms, s.created_at
    FROM scores s
    JOIN players p ON p.code = s.player_code
    WHERE s.pack = ? AND s.image = ? AND s.rows = ? AND s.cols = ?
    ORDER BY s.score DESC, s.duration_ms ASC
    LIMIT ?
  `).all(pack, image, rows, cols, limit);
}

export function globalLeaderboard({ limit = 50 }) {
  return db.prepare(`
    SELECT p.code AS player_code, p.display_name, SUM(s.score) AS total, COUNT(s.id) AS plays
    FROM scores s
    JOIN players p ON p.code = s.player_code
    GROUP BY p.code
    ORDER BY total DESC
    LIMIT ?
  `).all(limit);
}

export function playerScores(code, limit = 50) {
  return db.prepare(`
    SELECT id, pack, image, rows, cols, moves, duration_ms, score, handicaps, created_at
    FROM scores WHERE player_code = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(code, limit);
}

export function puzzleRank(pack, image, rows, cols, score) {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM scores
    WHERE pack = ? AND image = ? AND rows = ? AND cols = ? AND score > ?
  `).get(pack, image, rows, cols, score);
  return row.c + 1;
}

export function globalRank(playerCode) {
  const row = db.prepare(`
    WITH totals AS (
      SELECT player_code, SUM(score) AS total FROM scores GROUP BY player_code
    )
    SELECT COUNT(*) + 1 AS rank FROM totals
    WHERE total > (SELECT total FROM totals WHERE player_code = ?)
  `).get(playerCode);
  return row ? row.rank : null;
}

export function personalBest(playerCode, pack, image, rows, cols) {
  const row = db.prepare(`
    SELECT MAX(score) AS best FROM scores
    WHERE player_code = ? AND pack = ? AND image = ? AND rows = ? AND cols = ?
  `).get(playerCode, pack, image, rows, cols);
  return row ? row.best : null;
}

export function puzzleVariants(pack, image) {
  // Per (rows, cols): plays count + the top-scoring row (with that player's name).
  return db.prepare(`
    WITH ranked AS (
      SELECT s.rows, s.cols, s.score, s.player_code,
             p.display_name,
             ROW_NUMBER() OVER (PARTITION BY s.rows, s.cols ORDER BY s.score DESC, s.duration_ms ASC) AS rn,
             COUNT(*) OVER (PARTITION BY s.rows, s.cols) AS plays
      FROM scores s
      JOIN players p ON p.code = s.player_code
      WHERE s.pack = ? AND s.image = ?
    )
    SELECT rows, cols, plays, score, player_code, display_name
    FROM ranked WHERE rn = 1
    ORDER BY cols ASC, rows ASC
  `).all(pack, image);
}

export function playerBestsForPuzzle(playerCode, pack, image) {
  return db.prepare(`
    SELECT rows, cols,
           MAX(score) AS best_score,
           MIN(moves) AS best_moves,
           MIN(duration_ms) AS best_duration_ms,
           COUNT(*) AS plays
    FROM scores
    WHERE player_code = ? AND pack = ? AND image = ?
    GROUP BY rows, cols
  `).all(playerCode, pack, image);
}

export function deleteScoreById(id) {
  const info = db.prepare('DELETE FROM scores WHERE id = ?').run(id);
  return info.changes > 0;
}

export function adminListPlayers(search = '') {
  const q = search ? `%${search}%` : null;
  const sql = `
    SELECT p.code, p.display_name, p.name_locked, p.created_at, p.last_seen_at,
           COALESCE(SUM(s.score), 0) AS total, COUNT(s.id) AS plays
    FROM players p
    LEFT JOIN scores s ON s.player_code = p.code
    ${q ? 'WHERE p.code LIKE ? OR COALESCE(p.display_name, \'\') LIKE ?' : ''}
    GROUP BY p.code
    ORDER BY total DESC, p.created_at DESC
  `;
  return q ? db.prepare(sql).all(q, q) : db.prepare(sql).all();
}

export function allScoresForRecompute() {
  return db.prepare(`
    SELECT id, pack, rows, cols, moves, duration_ms, handicaps FROM scores
  `).all();
}

export function updateScoreValue(id, score) {
  db.prepare('UPDATE scores SET score = ? WHERE id = ?').run(score, id);
}
