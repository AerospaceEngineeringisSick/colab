// Main-thread world: chunk storage, streaming via workers, lighting updates and meshing.
import * as THREE from 'three';
import { CS, WH, idx, DIRS } from '../shared/constants.js';
import { BLOCKS, B, LIGHT_OPACITY, EMIT, OPAQUE } from '../shared/blocks.js';
import { Mesher, P, pidx } from '../shared/mesher.js';
import { BIOMES } from '../shared/biomes.js';

export const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
const SY = P * P, SZ = P;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.key = ckey(cx, cz);
    this.blocks = null; this.light = null; this.biomes = null; this.tints = null;
    this.meshes = new Array(8).fill(null); // per section: [opaque, cutout, translucent] meshes
    this.rev = new Uint32Array(8); // bumps on every change
    this.meshedRev = new Uint32Array(8);
    this.pending = new Uint8Array(8);
    this.dirty = 0xff; // sections needing a (re)mesh
    this.modified = false;
    this.tiles = new Map(); // idx -> tile entity
    this.loaded = false;
    this.neighbours = 0;
    this.empty = new Uint8Array(8); // section has no geometry at all (all air)
  }
}

export class World {
  constructor(game, seed, texInfo) {
    this.game = game;
    this.seed = seed;
    this.chunks = new Map();
    this.requested = new Set();
    this.scene = new THREE.Group();
    this.scene.name = 'chunks';
    this.texInfo = texInfo;
    this.mesher = new Mesher(texInfo);
    this.renderDistance = 8;
    this.materials = null; // set by renderer: [opaque, cutout, translucent]
    this.workers = [];
    this.jobs = new Map();
    this.jobId = 1;
    this.inflightGen = 0;
    this.inflightMesh = 0;
    this.lastCenter = null;
    this.wanted = [];
    this.savedKeys = new Set(); // chunks present in the save
    this.loadChunkData = null; // async (cx,cz) => {blocks, tiles} | null
    this.dirtySections = new Set();
    this.sectionMeshes = new Set();
    this.onChunkLoaded = null;
    this.fastLeaves = false;
    this._c = null; // last chunk cache
    this.stats = { gen: 0, mesh: 0 };
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const blob = new Blob([__WORKER_SRC__], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      w.onmessage = (e) => this.onWorker(e.data, w);
      w.onerror = (e) => console.error('worker error', e.message || e);
      w.postMessage({ type: 'init', seed, tex: texInfo, fastLeaves: this.fastLeaves });
      w.busy = 0;
      this.workers.push(w);
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this.disposeChunkMeshes(c);
    this.chunks.clear();
  }

  setFastLeaves(v) {
    this.fastLeaves = v;
    this.mesher.fastLeaves = v;
    for (const w of this.workers) w.postMessage({ type: 'opts', fastLeaves: v });
    for (const c of this.chunks.values()) { c.dirty = 0xff; }
  }

  pickWorker() {
    let best = this.workers[0];
    for (const w of this.workers) if (w.busy < best.busy) best = w;
    return best;
  }

  // ------------------------------------------------------------ access
  getChunk(cx, cz) {
    const c = this._c;
    if (c && c.cx === cx && c.cz === cz) return c;
    const r = this.chunks.get(ckey(cx, cz));
    if (r && r.blocks) this._c = r;
    return r;
  }

  getBlock(x, y, z) {
    if (y < 0) return B.bedrock;
    if (y >= WH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.blocks) return 0;
    return c.blocks[idx(x & 15, y, z & 15)];
  }
  getId(x, y, z) { return this.getBlock(x, y, z) & 1023; }
  isLoaded(x, z) { const c = this.getChunk(x >> 4, z >> 4); return !!(c && c.blocks); }

  getLight(x, y, z) {
    if (y >= WH) return 0xf0;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.light) return 0xf0;
    return c.light[idx(x & 15, y, z & 15)];
  }
  skyLight(x, y, z) { return this.getLight(x, y, z) >> 4; }
  blockLight(x, y, z) { return this.getLight(x, y, z) & 15; }

  biomeAt(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.biomes) return BIOMES[1];
    return BIOMES[c.biomes[((z & 15) << 4) | (x & 15)]];
  }

  // highest non-air block y (or -1)
  topY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.blocks) return -1;
    const lx = x & 15, lz = z & 15;
    for (let y = WH - 1; y >= 0; y--) if (c.blocks[idx(lx, y, lz)] & 1023) return y;
    return -1;
  }
  // highest block that blocks rain/sun
  rainY(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.blocks) return -1;
    const lx = x & 15, lz = z & 15;
    for (let y = WH - 1; y >= 0; y--) {
      const id = c.blocks[idx(lx, y, lz)] & 1023;
      if (id && (BLOCKS[id].solid || BLOCKS[id].liquid || LIGHT_OPACITY[id])) return y;
    }
    return -1;
  }

  // ------------------------------------------------------------ edits
  setBlock(x, y, z, v, opts = {}) {
    if (y < 0 || y >= WH) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.blocks) return false;
    const i = idx(x & 15, y, z & 15);
    const old = c.blocks[i];
    if (old === v) return false;
    c.blocks[i] = v;
    c.modified = true;
    const oid = old & 1023, nid = v & 1023;
    if (oid !== nid && c.tiles.has(i) && !opts.keepTile) {
      const t = c.tiles.get(i);
      c.tiles.delete(i);
      if (this.onTileRemoved) this.onTileRemoved(t, x, y, z);
    }
    if (LIGHT_OPACITY[oid] !== LIGHT_OPACITY[nid] || EMIT[oid] !== EMIT[nid]) this.relight(x, y, z, oid, nid);
    this.markDirty(x, y, z);
    if (!opts.noUpdate && this.onBlockChanged) this.onBlockChanged(x, y, z, old, v);
    if (opts.sync) this.flushDirty(x >> 4, z >> 4);
    return true;
  }

  getTile(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return null;
    return c.tiles.get(idx(x & 15, y, z & 15)) || null;
  }
  setTile(x, y, z, t) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    t.x = x; t.y = y; t.z = z;
    c.tiles.set(idx(x & 15, y, z & 15), t);
    c.modified = true;
  }

  markDirty(x, y, z) {
    const lx = x & 15, ly = y & 15, lz = z & 15;
    const cx = x >> 4, cz = z >> 4, sy = y >> 4;
    this.markSection(cx, sy, cz);
    if (lx === 0) this.markSection(cx - 1, sy, cz); else if (lx === 15) this.markSection(cx + 1, sy, cz);
    if (lz === 0) this.markSection(cx, sy, cz - 1); else if (lz === 15) this.markSection(cx, sy, cz + 1);
    if (ly === 0) this.markSection(cx, sy - 1, cz); else if (ly === 15) this.markSection(cx, sy + 1, cz);
    if ((lx === 0 || lx === 15) && (lz === 0 || lz === 15)) this.markSection(cx + (lx ? 1 : -1), sy, cz + (lz ? 1 : -1));
  }
  markSection(cx, sy, cz) {
    if (sy < 0 || sy >= 8) return;
    const c = this.chunks.get(ckey(cx, cz));
    if (!c || !c.blocks) return;
    c.dirty |= 1 << sy;
    c.rev[sy]++;
  }

  // ------------------------------------------------------------ lighting
  relight(x, y, z, oid, nid) {
    // block light
    this.updateChannel(x, y, z, 0, EMIT[nid]);
    // sky light
    this.updateChannel(x, y, z, 4, 0);
  }

  // shift 4: sky, 0: block. emit: new emission at the changed cell
  updateChannel(x, y, z, shift, emit) {
    const rem = [], add = [];
    const cur = (this.getLight(x, y, z) >> shift) & 15;
    const op = LIGHT_OPACITY[this.getId(x, y, z)];
    // remove existing light from this cell outward
    if (cur > 0) {
      this.setLightChannel(x, y, z, shift, 0);
      rem.push(x, y, z, cur);
      this.removeBFS(rem, add, shift);
    }
    if (emit > 0) {
      this.setLightChannel(x, y, z, shift, emit);
      add.push(x, y, z);
    }
    if (op < 15) {
      // pull light from neighbours into this cell
      for (const d of DIRS) add.push(x + d[0], y + d[1], z + d[2]);
      if (shift === 4 && y + 1 >= WH) { this.setLightChannel(x, y, z, 4, 15); add.push(x, y, z); }
    }
    this.addBFS(add, shift);
  }

  setLightChannel(x, y, z, shift, v) {
    if (y < 0 || y >= WH) return;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || !c.light) return;
    const i = idx(x & 15, y, z & 15);
    const mask = shift ? 0x0f : 0xf0;
    const nv = (c.light[i] & mask) | (v << shift);
    if (c.light[i] !== nv) { c.light[i] = nv; this.markDirty(x, y, z); }
  }

  removeBFS(q, add, shift) {
    let h = 0;
    while (h < q.length) {
      const x = q[h], y = q[h + 1], z = q[h + 2], l = q[h + 3];
      h += 4;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (ny < 0 || ny >= WH) continue;
        const c = this.getChunk(nx >> 4, nz >> 4);
        if (!c || !c.light) continue;
        const ln = (c.light[idx(nx & 15, ny, nz & 15)] >> shift) & 15;
        if (ln === 0) continue;
        const beam = shift === 4 && d === 3 && l === 15 && ln === 15;
        if (ln < l || beam) {
          // keep emitters, re-add them later
          const e = shift === 0 ? EMIT[c.blocks[idx(nx & 15, ny, nz & 15)] & 1023] : 0;
          this.setLightChannel(nx, ny, nz, shift, 0);
          q.push(nx, ny, nz, ln);
          if (e) { this.setLightChannel(nx, ny, nz, shift, e); add.push(nx, ny, nz); }
        } else {
          add.push(nx, ny, nz);
        }
      }
      if (q.length > 400000) break;
    }
  }

  addBFS(q, shift) {
    let h = 0;
    while (h < q.length) {
      const x = q[h], y = q[h + 1], z = q[h + 2];
      h += 3;
      if (y < 0 || y >= WH) continue;
      const c = this.getChunk(x >> 4, z >> 4);
      if (!c || !c.light) continue;
      const l = (c.light[idx(x & 15, y, z & 15)] >> shift) & 15;
      if (l < 2) continue;
      for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const nx = x + D[0], ny = y + D[1], nz = z + D[2];
        if (ny < 0 || ny >= WH) continue;
        const nc = this.getChunk(nx >> 4, nz >> 4);
        if (!nc || !nc.light) continue;
        const ni = idx(nx & 15, ny, nz & 15);
        const op = LIGHT_OPACITY[nc.blocks[ni] & 1023];
        if (op >= 15) continue;
        const nl = (shift === 4 && d === 3 && l === 15 && op === 0) ? 15 : l - Math.max(1, op);
        if (nl > ((nc.light[ni] >> shift) & 15)) {
          this.setLightChannel(nx, ny, nz, shift, nl);
          q.push(nx, ny, nz);
        }
      }
      if (q.length > 600000) break;
    }
  }

  // spread light across the border between a new chunk and its loaded neighbours
  stitchLight(c) {
    for (const shift of [4, 0]) {
      const q = [];
      const tryPair = (ax, az, bx, bz) => {
        const nb = this.getChunk(bx >> 4, bz >> 4);
        if (!nb || !nb.light) return;
        for (let y = 0; y < WH; y++) {
          const la = (this.getLight(ax, y, az) >> shift) & 15;
          const lb = (this.getLight(bx, y, bz) >> shift) & 15;
          if (la > lb + 1) q.push(ax, y, az); else if (lb > la + 1) q.push(bx, y, bz);
        }
      };
      const x0 = c.cx * 16, z0 = c.cz * 16;
      for (let i = 0; i < 16; i++) {
        tryPair(x0 + i, z0, x0 + i, z0 - 1);
        tryPair(x0 + i, z0 + 15, x0 + i, z0 + 16);
        tryPair(x0, z0 + i, x0 - 1, z0 + i);
        tryPair(x0 + 15, z0 + i, x0 + 16, z0 + i);
      }
      this.addBFS(q, shift);
    }
  }

  // ------------------------------------------------------------ streaming
  update(px, pz, camera) {
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    const R = this.renderDistance;
    const center = pcx + ',' + pcz + ',' + R;
    if (center !== this.lastCenter) {
      this.lastCenter = center;
      this.wanted = [];
      const r2 = (R + 1.5) * (R + 1.5);
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        this.wanted.push([pcx + dx, pcz + dz, d2]);
      }
      this.wanted.sort((a, b) => a[2] - b[2]);
      // unload far chunks
      const ur2 = (R + 3.5) * (R + 3.5);
      for (const c of this.chunks.values()) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > ur2) this.unloadChunk(c);
      }
    }
    // request generation
    const maxGen = this.workers.length * 2;
    for (const [cx, cz] of this.wanted) {
      if (this.inflightGen >= maxGen) break;
      const k = ckey(cx, cz);
      if (this.chunks.has(k)) continue;
      this.requestChunk(cx, cz);
    }
    this.scheduleMeshes(px, pz, camera);
  }

  requestChunk(cx, cz) {
    const k = ckey(cx, cz);
    const c = new Chunk(cx, cz);
    this.chunks.set(k, c);
    this.inflightGen++;
    const id = this.jobId++;
    const w = this.pickWorker();
    w.busy++;
    this.jobs.set(id, { w });
    if (this.savedKeys.has(k) && this.loadChunkData) {
      this.loadChunkData(cx, cz).then((data) => {
        if (this.chunks.get(k) !== c) { w.busy--; this.inflightGen--; return; }
        if (data) { c.savedTiles = data.tiles; w.postMessage({ type: 'load', id, cx, cz, blocks: data.blocks }, [data.blocks.buffer]); }
        else w.postMessage({ type: 'gen', id, cx, cz });
      });
    } else {
      w.postMessage({ type: 'gen', id, cx, cz });
    }
  }

  unloadChunk(c) {
    if (c.modified && this.saveChunk) this.saveChunk(c);
    this.disposeChunkMeshes(c);
    this.chunks.delete(c.key);
    if (this._c === c) this._c = null;
    if (this.onChunkUnloaded) this.onChunkUnloaded(c);
  }

  disposeChunkMeshes(c) {
    for (let s = 0; s < 8; s++) this.setSectionMeshes(c, s, null);
  }

  onWorker(m, w) {
    const job = this.jobs.get(m.id);
    if (job) { this.jobs.delete(m.id); job.w.busy--; }
    if (m.type === 'gen') {
      this.inflightGen--;
      const c = this.chunks.get(ckey(m.cx, m.cz));
      if (!c || c.blocks) return;
      c.blocks = m.blocks; c.light = m.light; c.biomes = m.biomes; c.tints = m.tints;
      c.loaded = !!m.loaded;
      if (c.loaded) c.modified = false;
      this.stats.gen++;
      this.stitchLight(c);
      // tile entities
      const tiles = c.savedTiles || m.tiles || [];
      for (const t of tiles) {
        if (!t) continue;
        c.tiles.set(idx(t.x & 15, t.y, t.z & 15), t);
      }
      c.savedTiles = null;
      if (this.onChunkLoaded) this.onChunkLoaded(c, m.loaded ? [] : m.spawns, !m.loaded && m.tiles && m.tiles.length);
      // neighbours may now be meshable; light changes already marked dirty
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
        if (n && n.blocks && (dx || dz)) n.dirty = 0xff;
      }
    } else if (m.type === 'mesh') {
      this.inflightMesh--;
      const [k, s] = m.key;
      const c = this.chunks.get(k);
      if (!c) return;
      c.pending[s] = 0;
      if (m.rev !== c.rev[s]) { c.dirty |= 1 << s; return; } // stale
      this.applyMesh(c, s, m.out);
      c.meshedRev[s] = m.rev;
    }
  }

  meshable(c) {
    if (!c.blocks) return false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
      if (!n || !n.blocks) return false;
    }
    return true;
  }

  scheduleMeshes(px, pz) {
    const maxJobs = this.workers.length * 3;
    if (this.inflightMesh >= maxJobs) return;
    // closest dirty chunks first
    const list = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty || !c.blocks) continue;
      const dx = c.cx * 16 + 8 - px, dz = c.cz * 16 + 8 - pz;
      list.push([dx * dx + dz * dz, c]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [, c] of list) {
      if (this.inflightMesh >= maxJobs) break;
      if (!this.meshable(c)) continue;
      for (let s = 0; s < 8; s++) {
        if (!(c.dirty & (1 << s))) continue;
        if (c.pending[s]) continue;
        c.dirty &= ~(1 << s);
        this.postMesh(c, s);
        if (this.inflightMesh >= maxJobs) break;
      }
    }
  }

  // build padded 18^3 volume of blocks + light and 18x18 tints around a section
  gather(c, s) {
    const blocks = new Uint16Array(P * P * P);
    const light = new Uint8Array(P * P * P);
    const grass = new Uint32Array(P * P), foliage = new Uint32Array(P * P), water = new Uint32Array(P * P);
    const y0 = s * 16;
    let any = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunks.get(ckey(c.cx + dx, c.cz + dz));
      const xs = dx < 0 ? 15 : 0, xe = dx > 0 ? 0 : 15;
      const zs = dz < 0 ? 15 : 0, ze = dz > 0 ? 0 : 15;
      for (let lz = zs; lz <= ze; lz++) for (let lx = xs; lx <= xe; lx++) {
        const px = lx + dx * 16, pz = lz + dz * 16; // -1..16
        const ti = (pz + 1) * P + (px + 1);
        const ci = lz * 16 + lx;
        grass[ti] = n.tints.grass[ci]; foliage[ti] = n.tints.foliage[ci]; water[ti] = n.tints.water[ci];
        for (let py = -1; py <= 16; py++) {
          const wy = y0 + py;
          const p = pidx(px, py, pz);
          if (wy < 0) { blocks[p] = B.bedrock; light[p] = 0; continue; }
          if (wy >= WH) { blocks[p] = 0; light[p] = 0xf0; continue; }
          const i = (wy << 8) | (lz << 4) | lx;
          const v = n.blocks[i];
          blocks[p] = v; light[p] = n.light[i];
          if (v && dx === 0 && dz === 0 && py >= 0 && py < 16) any = true;
        }
      }
    }
    return { blocks, light, tints: { grass, foliage, water }, any };
  }

  postMesh(c, s) {
    const g = this.gather(c, s);
    if (!g.any) {
      c.meshedRev[s] = c.rev[s];
      this.setSectionMeshes(c, s, null);
      return;
    }
    const id = this.jobId++;
    const w = this.pickWorker();
    w.busy++;
    this.jobs.set(id, { w });
    c.pending[s] = 1;
    this.inflightMesh++;
    w.postMessage({
      type: 'mesh', id, key: [c.key, s], rev: c.rev[s], blocks: g.blocks, light: g.light, tints: g.tints,
      ox: c.cx * 16, oy: s * 16, oz: c.cz * 16,
    }, [g.blocks.buffer, g.light.buffer, g.tints.grass.buffer, g.tints.foliage.buffer, g.tints.water.buffer]);
  }

  // mesh dirty sections right now on the main thread (used after the player edits blocks)
  flushDirty(ccx, ccz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(ckey(ccx + dx, ccz + dz));
      if (!c || !c.dirty || !this.meshable(c)) continue;
      for (let s = 0; s < 8; s++) {
        if (!(c.dirty & (1 << s))) continue;
        if (!c.meshes[s] && c.meshedRev[s] === 0 && !c.pending[s]) continue; // never meshed: leave to workers
        c.dirty &= ~(1 << s);
        const g = this.gather(c, s);
        if (!g.any) { this.setSectionMeshes(c, s, null); c.meshedRev[s] = c.rev[s]; continue; }
        const out = this.mesher.mesh(g.blocks, g.light, g.tints, c.cx * 16, s * 16, c.cz * 16);
        this.applyMesh(c, s, out);
        c.meshedRev[s] = c.rev[s];
      }
    }
  }

  applyMesh(c, s, out) {
    const meshes = [null, null, null];
    for (let l = 0; l < 3; l++) {
      const o = out[l];
      if (!o) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(o.pos, 4));
      g.setAttribute('aTex', new THREE.BufferAttribute(o.tex, 4));
      g.setAttribute('aCol', new THREE.BufferAttribute(o.col, 4, true));
      g.setAttribute('aLight', new THREE.BufferAttribute(o.light, 4));
      g.setIndex(new THREE.BufferAttribute(o.index, 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 8, 8), 14.5);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 16, 16));
      const m = new THREE.Mesh(g, this.materials[l]);
      m.position.set(c.cx * 16, s * 16, c.cz * 16);
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.renderOrder = l;
      m.userData.section = true;
      meshes[l] = m;
    }
    this.setSectionMeshes(c, s, meshes);
  }

  setSectionMeshes(c, s, meshes) {
    const old = c.meshes[s];
    if (old) for (const m of old) if (m) { this.scene.remove(m); m.geometry.dispose(); this.sectionMeshes.delete(m); }
    c.meshes[s] = meshes;
    if (meshes) for (const m of meshes) if (m) { this.scene.add(m); this.sectionMeshes.add(m); }
  }

  loadedCount() { let n = 0; for (const c of this.chunks.values()) if (c.blocks) n++; return n; }

  // is everything within r chunks generated and meshed?
  readyAround(px, pz, r) {
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const c = this.chunks.get(ckey(pcx + dx, pcz + dz));
      if (!c || !c.blocks) return false;
      if (Math.abs(dx) < r && Math.abs(dz) < r && (c.dirty || c.pending.some((p) => p))) return false;
    }
    return true;
  }

  isOpaque(x, y, z) { return OPAQUE[this.getId(x, y, z)] === 1; }
}
