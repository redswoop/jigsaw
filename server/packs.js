import fs from 'fs';
import path from 'path';

let cache = {};

export function loadPackMetadata(imagesDir) {
  cache = {};
  try {
    const entries = fs.readdirSync(imagesDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(imagesDir, e.name, 'pack.json');
      if (fs.existsSync(file)) {
        try {
          const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
          cache[e.name] = normalize(meta);
        } catch (err) {
          console.warn(`[packs] bad pack.json in ${e.name}: ${err.message}`);
          cache[e.name] = defaults();
        }
      } else {
        cache[e.name] = defaults();
      }
    }
  } catch (err) {
    console.warn(`[packs] failed to scan ${imagesDir}: ${err.message}`);
  }
}

function defaults() {
  return { difficulty: 1.0, label: 'normal' };
}

function normalize(m) {
  const d = Number(m.difficulty);
  return {
    difficulty: Number.isFinite(d) && d > 0 ? d : 1.0,
    label: typeof m.label === 'string' ? m.label : 'normal',
  };
}

export function getPackMetadata(packName) {
  return cache[packName] || defaults();
}

export function getAllPackMetadata() {
  return { ...cache };
}
