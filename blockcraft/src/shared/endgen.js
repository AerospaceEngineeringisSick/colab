// The End: a floating island of end stone ringed by obsidian spikes topped with crystals, the exit
// podium at its centre, and scattered outer islands far beyond the void.
import { Simplex, hash2, rng } from './noise.js';
import { CS, WH, idx } from './constants.js';
import { B } from './blocks.js';
import { BIOMES, BI } from './biomes.js';

const M = (id, meta = 0) => id | (meta << 10);
export const ARRIVAL = [100, 49, 0]; // where travellers land: an obsidian platform out over the void

export class EndGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.n = new Simplex(this.seed ^ 0xe4d1);
    this.n2 = new Simplex(this.seed ^ 0x2b7e);
    // ten obsidian spikes on a ring of radius 42, heights 76..103 in shuffled order
    const R = rng(hash2(1, 1, this.seed ^ 0x5e1e) * 4294967296);
    const order = [...Array(10).keys()];
    for (let i = 9; i > 0; i--) { const j = (R() * (i + 1)) | 0; [order[i], order[j]] = [order[j], order[i]]; }
    this.spikes = order.map((k, i) => {
      const a = 2 * (-Math.PI + (Math.PI / 10) * i);
      return { x: Math.round(42 * Math.cos(a)), z: Math.round(42 * Math.sin(a)), r: 2 + ((k / 3) | 0), h: 76 + k * 3 };
    });
  }

  column(x, z, out) {
    const b = BIOMES[BI.THE_END];
    out.biome = BI.THE_END; out.h = 64;
    out.grass = b.grass; out.foliage = b.foliage; out.water = b.water;
    return out;
  }
  biomeAt() { return BI.THE_END; }

  // [bottom, top] of end stone in a column, or null for the void
  island(x, z) {
    const d = Math.hypot(x, z);
    const edge = 96 + this.n.noise2(Math.atan2(z, x) * 2.5, 3.7) * 14 + this.n2.noise2(x * 0.03, z * 0.03) * 6;
    if (d < edge) {
      const f = d / edge;
      const top = Math.round(62 + (1 - f * f) * 4 + this.n2.noise2(x * 0.05, z * 0.05) * 1.5);
      const bottom = Math.round(top - 3 - (1 - f) * (1 - f) * 44 - Math.abs(this.n.noise2(x * 0.08, z * 0.08)) * 6);
      return [bottom, top];
    }
    if (d > 850) {
      const v = this.n.fbm2(x * 0.011, z * 0.011, 3);
      if (v > 0.32) {
        const k = Math.min(1, (v - 0.32) / 0.3);
        const top = Math.round(56 + k * 10 + this.n2.noise2(x * 0.06, z * 0.06) * 2);
        return [Math.round(top - 2 - k * 28), top];
      }
    }
    return null;
  }

  // the height the exit podium stands on
  podiumY() { return this.island(0, 0)[1] + 1; }

  generate(cx, cz) {
    const x0 = cx * CS, z0 = cz * CS;
    const blocks = new Uint16Array(CS * CS * WH);
    const biomes = new Uint8Array(256).fill(BI.THE_END);
    const col = this.column(0, 0, {});
    const grass = new Uint32Array(256).fill(col.grass), foliage = new Uint32Array(256).fill(col.foliage), water = new Uint32Array(256).fill(col.water);
    const ctx = { cx, cz, x0, z0, blocks, tiles: [], spawns: [] };
    const set = (x, y, z, v) => { const lx = x - x0, lz = z - z0; if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16 && y > 0 && y < WH) blocks[idx(lx, y, lz)] = v; };
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const isl = this.island(x0 + x, z0 + z);
      if (!isl) continue;
      for (let y = Math.max(1, isl[0]); y <= isl[1]; y++) blocks[idx(x, y, z)] = B.end_stone;
    }
    // the spikes, each capped with bedrock and a crystal
    for (const s of this.spikes) {
      if (s.x + s.r < x0 || s.x - s.r > x0 + 15 || s.z + s.r < z0 || s.z - s.r > z0 + 15) continue;
      const base = (this.island(s.x, s.z) || [50, 50])[0];
      for (let x = s.x - s.r; x <= s.x + s.r; x++) for (let z = s.z - s.r; z <= s.z + s.r; z++) {
        if ((x - s.x) ** 2 + (z - s.z) ** 2 > (s.r + 0.5) ** 2) continue;
        for (let y = base; y <= s.h; y++) set(x, y, z, B.obsidian);
      }
      set(s.x, s.h + 1, s.z, B.bedrock);
      if (s.x >= x0 && s.x < x0 + 16 && s.z >= z0 && s.z < z0 + 16) ctx.spawns.push({ type: 'end_crystal', x: s.x + 0.5, y: s.h + 2, z: s.z + 0.5 });
    }
    // the exit podium: a bedrock bowl around a pillar lit by four torches
    if (x0 <= 4 && x0 + 15 >= -4 && z0 <= 4 && z0 + 15 >= -4) buildPodium(set, this.podiumY(), false);
    return { blocks, biomes, tints: { grass, foliage, water }, tiles: ctx.tiles, spawns: ctx.spawns };
  }
}

// active: the dragon is dead and the portal is open
export function buildPodium(set, y0, active) {
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    const d = Math.hypot(x, z);
    if (d > 3.5) continue;
    set(x, y0 - 1, z, B.bedrock);
    set(x, y0, z, d > 2.5 ? B.bedrock : active ? B.end_portal : 0);
    for (let y = y0 + 1; y <= y0 + 4; y++) set(x, y, z, 0);
  }
  for (let y = y0 - 1; y <= y0 + 3; y++) set(0, y, 0, B.bedrock);
  // torches on the pillar (meta: wall torch facing + 1)
  set(1, y0 + 2, 0, M(B.torch, 4)); set(-1, y0 + 2, 0, M(B.torch, 2));
  set(0, y0 + 2, 1, M(B.torch, 1)); set(0, y0 + 2, -1, M(B.torch, 3));
}
