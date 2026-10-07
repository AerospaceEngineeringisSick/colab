// IndexedDB storage for worlds and modified chunks (run-length encoded).
const DB_NAME = 'blockcraft';
const VERSION = 1;

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

// RLE: pairs of (value, run) in a Uint16Array
export function rle(a) {
  const out = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return Uint16Array.from(out);
}
export function unrle(r, len) {
  const a = new Uint16Array(len);
  let p = 0;
  for (let i = 0; i < r.length; i += 2) { a.fill(r[i], p, p + r[i + 1]); p += r[i + 1]; }
  return a;
}

export class Store {
  constructor() { this.db = null; this.mem = null; }

  async open() {
    if (this.db || this.mem) return;
    try {
      const r = indexedDB.open(DB_NAME, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) {
          const s = db.createObjectStore('chunks', { keyPath: 'k' });
          s.createIndex('world', 'w');
        }
      };
      this.db = await req(r);
    } catch (e) {
      // private browsing etc.: keep everything in memory for this session
      console.warn('IndexedDB unavailable, worlds will not persist', e);
      this.mem = { worlds: new Map(), chunks: new Map() };
    }
  }

  tx(store, mode = 'readonly') { return this.db.transaction(store, mode).objectStore(store); }

  async listWorlds() {
    await this.open();
    if (this.mem) return [...this.mem.worlds.values()];
    const all = await req(this.tx('worlds').getAll());
    return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }
  async getWorld(id) {
    await this.open();
    if (this.mem) return this.mem.worlds.get(id);
    return req(this.tx('worlds').get(id));
  }
  async saveWorld(meta) {
    await this.open();
    const copy = JSON.parse(JSON.stringify(meta));
    if (this.mem) { this.mem.worlds.set(meta.id, copy); return; }
    await req(this.tx('worlds', 'readwrite').put(copy));
  }
  async deleteWorld(id) {
    await this.open();
    if (this.mem) {
      this.mem.worlds.delete(id);
      for (const k of [...this.mem.chunks.keys()]) if (k.startsWith(id + ':')) this.mem.chunks.delete(k);
      return;
    }
    await req(this.tx('worlds', 'readwrite').delete(id));
    const store = this.tx('chunks', 'readwrite');
    const keys = await req(store.index('world').getAllKeys(id));
    const s2 = this.tx('chunks', 'readwrite');
    await Promise.all(keys.map((k) => req(s2.delete(k))));
  }

  async chunkKeys(worldId) {
    await this.open();
    const out = new Set();
    const toKey = (k) => {
      const [cx, cz] = k.slice(worldId.length + 1).split(',').map(Number);
      return (cx + 32768) * 65536 + (cz + 32768);
    };
    if (this.mem) { for (const k of this.mem.chunks.keys()) if (k.startsWith(worldId + ':')) out.add(toKey(k)); return out; }
    const keys = await req(this.tx('chunks').index('world').getAllKeys(worldId));
    for (const k of keys) out.add(toKey(k));
    return out;
  }

  async saveChunk(worldId, cx, cz, blocks, tiles) {
    await this.open();
    const rec = { k: `${worldId}:${cx},${cz}`, w: worldId, b: rle(blocks), t: tiles, n: blocks.length };
    if (this.mem) { this.mem.chunks.set(rec.k, rec); return; }
    await req(this.tx('chunks', 'readwrite').put(rec));
  }

  async loadChunk(worldId, cx, cz) {
    await this.open();
    const k = `${worldId}:${cx},${cz}`;
    const rec = this.mem ? this.mem.chunks.get(k) : await req(this.tx('chunks').get(k));
    if (!rec) return null;
    return { blocks: unrle(rec.b, rec.n), tiles: rec.t || [] };
  }

  // rough storage use for the world list
  async estimate() {
    try { const e = await navigator.storage.estimate(); return e.usage || 0; } catch (e) { return 0; }
  }
}

// ------------------------------------------------------------------ settings
export const DEFAULT_SETTINGS = {
  renderDistance: 8, fov: 70, sensitivity: 100, invertY: false, viewBobbing: true, fovEffects: true,
  gamma: 0.5, master: 100, music: 50, sfx: 100, clouds: true, fancyLeaves: true, particles: 2, guiScale: 0,
  showFps: false, touch: 'auto', playerName: 'Steve', keepInventory: false, pixelRatio: 0, mobGriefing: true,
};

export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('blockcraft.settings') || '{}'); } catch (e) { s = {}; }
  const out = { ...DEFAULT_SETTINGS, ...s };
  // phones: lighter defaults on first run
  if (!s.renderDistance && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) out.renderDistance = 5;
  return out;
}
export function saveSettings(s) {
  try { localStorage.setItem('blockcraft.settings', JSON.stringify(s)); } catch (e) { /* ignore */ }
}
