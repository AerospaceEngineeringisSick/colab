// The Nether: caverns between a bedrock floor and roof over a lava sea, four biomes, glowstone,
// fungus forests and nether brick fortresses. Deterministic per chunk like the overworld generator.
import { Simplex, hash2, rng } from './noise.js';
import { CS, WH, idx } from './constants.js';
import { B, OPAQUE } from './blocks.js';
import { BIOMES, BI } from './biomes.js';

export const LAVA_SEA = 31;
const M = (id, meta = 0) => id | (meta << 10);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const pack = (c) => c & 0xffffff;

// fortresses: at most one per region, spread out like vanilla's
const FREGION = 432;
const FDIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class NetherGen {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nA = new Simplex(s ^ 0x6a11);
    this.nB = new Simplex(s ^ 0x1c37);
    this.nT = new Simplex(s ^ 0x4e2b);
    this.nH = new Simplex(s ^ 0x7710);
    this.nPatch = new Simplex(s ^ 0x3d5c);
    this.fortCache = new Map();
  }

  // ------------------------------------------------------------- biomes
  column(x, z, out) {
    const t = this.nT.fbm2(x * 0.0045, z * 0.0045, 2), h = this.nH.fbm2(x * 0.0045 + 40, z * 0.0045 - 70, 2);
    // nearest climate point; the wastes win ties
    const pts = [[BI.NETHER_WASTES, 0, 0, 0.75], [BI.CRIMSON_FOREST, 0.42, 0.25, 1], [BI.WARPED_FOREST, -0.42, 0.3, 1], [BI.SOUL_SAND_VALLEY, 0.05, -0.45, 1]];
    let best = BI.NETHER_WASTES, bd = 1e9;
    for (const [id, pt, ph, w] of pts) {
      const d = ((t - pt) ** 2 + (h - ph) ** 2) * w;
      if (d < bd) { bd = d; best = id; }
    }
    const b = BIOMES[best];
    out.biome = best; out.h = 64;
    out.grass = pack(b.grass); out.foliage = pack(b.foliage); out.water = pack(b.water);
    return out;
  }
  biomeAt(x, z) { return this.column(x, z, {}).biome; }

  // terrain density: > 0 is rock. Solid near the floor and roof, open caverns in between.
  density(x, y, z) {
    const n = this.nA.noise3(x * 0.011, y * 0.02, z * 0.011) * 0.62 + this.nB.noise3(x * 0.032, y * 0.05, z * 0.032) * 0.28;
    return n + 1.7 * smooth(36, 6, y) + 1.9 * smooth(94, 124, y) - 0.22;
  }

  // ------------------------------------------------------------- chunks
  generate(cx, cz) {
    const x0 = cx * CS, z0 = cz * CS;
    const blocks = new Uint16Array(CS * CS * WH);
    const biomes = new Uint8Array(256);
    const grass = new Uint32Array(256), foliage = new Uint32Array(256), water = new Uint32Array(256);
    const col = {};
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      this.column(x0 + x, z0 + z, col);
      const i = z * 16 + x;
      biomes[i] = col.biome; grass[i] = col.grass; foliage[i] = col.foliage; water[i] = col.water;
    }
    const R = rng(hash2(cx, cz, this.seed ^ 0x5eed) * 4294967296);
    const ctx = { cx, cz, x0, z0, blocks, biomes, R, tiles: [], spawns: [] };
    this.terrain(ctx);
    this.surface(ctx);
    this.ores(ctx);
    this.glowstone(ctx);
    this.decorate(ctx);
    this.fortresses(ctx);
    return { blocks, biomes, tints: { grass, foliage, water }, tiles: ctx.tiles, spawns: ctx.spawns };
  }

  terrain(ctx) {
    const { blocks, x0, z0, R } = ctx;
    // density on a coarse grid (every 4 blocks), trilinear in between
    const GY = WH / 4 + 1;
    const grid = new Float32Array(5 * 5 * GY);
    for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < GY; gy++) {
      grid[(gz * 5 + gx) * GY + gy] = this.density(x0 + gx * 4, gy * 4, z0 + gz * 4);
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const fx = x / 4, fz = z / 4, ix = Math.min(3, fx | 0), iz = Math.min(3, fz | 0), tx = fx - ix, tz = fz - iz;
      const g = (a, c, gy) => grid[((iz + c) * 5 + (ix + a)) * GY + gy];
      for (let y = 0; y < WH; y++) {
        const fy = y / 4, iy = Math.min(GY - 2, fy | 0), ty = fy - iy;
        const d0 = lerp(lerp(g(0, 0, iy), g(1, 0, iy), tx), lerp(g(0, 1, iy), g(1, 1, iy), tx), tz);
        const d1 = lerp(lerp(g(0, 0, iy + 1), g(1, 0, iy + 1), tx), lerp(g(0, 1, iy + 1), g(1, 1, iy + 1), tx), tz);
        let v = lerp(d0, d1, ty) > 0 ? B.netherrack : (y <= LAVA_SEA ? B.lava : 0);
        if (y === 0 || y === WH - 1 || (y < 5 && R() < (5 - y) / 6) || (y > WH - 6 && R() < (y - (WH - 6)) / 6)) v = B.bedrock;
        blocks[idx(x, y, z)] = v;
      }
    }
  }

  surface(ctx) {
    const { blocks, biomes, x0, z0, R } = ctx;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const bio = biomes[z * 16 + x];
      const wx = x0 + x, wz = z0 + z;
      const patch = this.nPatch.noise2(wx * 0.06, wz * 0.06);
      const soulMix = this.nPatch.noise2(wx * 0.11 + 30, wz * 0.11);
      for (let y = WH - 6; y > 5; y--) {
        const p = idx(x, y, z);
        if (blocks[p] !== B.netherrack || blocks[p + 256] !== 0) continue;
        // a floor with open air above it
        if (bio === BI.CRIMSON_FOREST) blocks[p] = B.crimson_nylium;
        else if (bio === BI.WARPED_FOREST) blocks[p] = B.warped_nylium;
        else if (bio === BI.SOUL_SAND_VALLEY) {
          const depth = 2 + ((R() * 2) | 0);
          for (let d = 0; d < depth && blocks[p - d * 256] === B.netherrack; d++) blocks[p - d * 256] = soulMix > 0 ? B.soul_sand : B.soul_soil;
        } else if (y >= LAVA_SEA - 3 && y <= LAVA_SEA + 4) {
          // beaches of soul sand and gravel along the lava sea
          const k = patch > 0.25 ? B.soul_sand : patch < -0.35 ? B.gravel : 0;
          if (k) for (let d = 0; d < 3 && blocks[p - d * 256] === B.netherrack; d++) blocks[p - d * 256] = k;
        }
      }
    }
  }

  ores(ctx) {
    const { blocks, R } = ctx;
    const vein = (id, count, size, ymin, ymax) => {
      for (let n = 0; n < count; n++) {
        let x = (R() * 16) | 0, y = ymin + ((R() * (ymax - ymin)) | 0), z = (R() * 16) | 0;
        for (let i = 0; i < size; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH && blocks[idx(x, y, z)] === B.netherrack) blocks[idx(x, y, z)] = id;
          const d = (R() * 6) | 0;
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    };
    vein(B.nether_quartz_ore, 16, 12, 10, 118);
    vein(B.nether_gold_ore, 10, 8, 10, 118);
    vein(B.magma_block, 3, 14, LAVA_SEA - 4, LAVA_SEA + 5);
    vein(B.gravel, 2, 20, 5, 40);
  }

  // glowstone clusters hanging from the roof of caverns
  glowstone(ctx) {
    const { blocks, R } = ctx;
    const n = 2 + ((R() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const x = 3 + ((R() * 10) | 0), z = 3 + ((R() * 10) | 0);
      let y = 40 + ((R() * 80) | 0);
      // find a ceiling above an open space
      while (y < WH - 6 && !(OPAQUE[blocks[idx(x, y + 1, z)]] && blocks[idx(x, y, z)] === 0)) y++;
      if (y >= WH - 6) continue;
      blocks[idx(x, y, z)] = B.glowstone;
      for (let i = 0; i < 300; i++) {
        const gx = x + ((R() * 7) | 0) - 3, gy = y - ((R() * 10) | 0), gz = z + ((R() * 7) | 0) - 3;
        if (gx < 0 || gx > 15 || gz < 0 || gz > 15 || gy < 2 || blocks[idx(gx, gy, gz)] !== 0) continue;
        let nb = 0;
        if (blocks[idx(gx, gy + 1, gz)] === B.glowstone) nb++;
        if (gy > 0 && blocks[idx(gx, gy - 1, gz)] === B.glowstone) nb++;
        if (gx > 0 && blocks[idx(gx - 1, gy, gz)] === B.glowstone) nb++;
        if (gx < 15 && blocks[idx(gx + 1, gy, gz)] === B.glowstone) nb++;
        if (gz > 0 && blocks[idx(gx, gy, gz - 1)] === B.glowstone) nb++;
        if (gz < 15 && blocks[idx(gx, gy, gz + 1)] === B.glowstone) nb++;
        if (nb === 1) blocks[idx(gx, gy, gz)] = B.glowstone;
      }
    }
  }

  // fire, fungi, plants, vines, basalt pillars, fossils
  decorate(ctx) {
    const { blocks, biomes, R } = ctx;
    const at = (x, y, z) => blocks[idx(x, y, z)];
    const set = (x, y, z, v) => { if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH - 1) blocks[idx(x, y, z)] = v; };
    // huge fungi, kept inside the chunk so nothing is cut at the border
    for (let k = 0; k < 6; k++) {
      const x = 3 + ((R() * 10) | 0), z = 3 + ((R() * 10) | 0);
      const bio = biomes[z * 16 + x];
      if (bio !== BI.CRIMSON_FOREST && bio !== BI.WARPED_FOREST) continue;
      const nyl = bio === BI.CRIMSON_FOREST ? B.crimson_nylium : B.warped_nylium;
      for (let y = 10 + ((R() * 30) | 0); y < WH - 20; y++) {
        if (at(x, y, z) !== nyl || at(x, y + 1, z) !== 0) continue;
        growFungus(bio === BI.CRIMSON_FOREST ? 'crimson' : 'warped', (bx, by, bz, v) => {
          if (bx < 0 || bx > 15 || bz < 0 || bz > 15 || by < 1 || by >= WH - 1) return;
          const cur = blocks[idx(bx, by, bz)];
          if (cur === 0 || cur === B.crimson_roots || cur === B.warped_roots || cur === B.nether_sprouts || cur === B.fire) blocks[idx(bx, by, bz)] = v;
        }, x, y + 1, z, R, (bx, by, bz) => (bx < 0 || bx > 15 || bz < 0 || bz > 15 ? 0 : at(bx, by, bz)));
        break;
      }
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const bio = biomes[z * 16 + x];
      for (let y = WH - 6; y > 5; y--) {
        const v = at(x, y, z);
        if (!v || at(x, y + 1, z) !== 0) {
          // ceilings: weeping vines hang from crimson rock
          if (bio === BI.CRIMSON_FOREST && OPAQUE[v] && at(x, y - 1, z) === 0 && R() < 0.04) {
            const len = 1 + ((R() * 5) | 0);
            for (let i = 1; i <= len && at(x, y - i, z) === 0; i++) set(x, y - i, z, B.weeping_vines);
          }
          continue;
        }
        const r = R();
        if (v === B.netherrack && bio === BI.NETHER_WASTES) {
          if (r < 0.012) set(x, y + 1, z, B.fire);
        } else if (v === B.crimson_nylium) {
          if (r < 0.3) set(x, y + 1, z, B.crimson_roots);
          else if (r < 0.36) set(x, y + 1, z, B.crimson_fungus);
          else if (r < 0.38) set(x, y + 1, z, B.warped_fungus);
        } else if (v === B.warped_nylium) {
          if (r < 0.2) set(x, y + 1, z, B.warped_roots);
          else if (r < 0.32) set(x, y + 1, z, B.nether_sprouts);
          else if (r < 0.36) set(x, y + 1, z, B.warped_fungus);
          else if (r < 0.41) {
            const len = 1 + ((R() * 6) | 0);
            for (let i = 1; i <= len && at(x, y + i, z) === 0; i++) set(x, y + i, z, B.twisting_vines);
          }
        } else if ((v === B.soul_sand || v === B.soul_soil) && r < 0.004) {
          // basalt pillar up to the roof, or a stub
          let top = y + 1;
          while (top < WH - 2 && at(x, top, z) === 0) top++;
          const h = top - y - 1;
          const n = h < 24 && R() < 0.6 ? h : 1 + ((R() * 4) | 0);
          for (let i = 1; i <= n; i++) set(x, y + i, z, B.basalt);
        }
      }
    }
    // a fossil in the soul sand valley now and then
    if (biomes[136] === BI.SOUL_SAND_VALLEY && R() < 0.08) {
      const x = 4 + ((R() * 6) | 0), z = 4 + ((R() * 6) | 0);
      let y = 40;
      while (y < 100 && !(at(x, y, z) !== 0 && at(x, y + 1, z) === 0)) y++;
      if (y < 100) {
        const len = 4 + ((R() * 4) | 0), alongX = R() < 0.5;
        for (let i = 0; i < len; i++) {
          const bx = alongX ? x + i - 2 : x, bz = alongX ? z : z + i - 2;
          set(bx, y + 1, bz, M(B.bone_block, alongX ? 1 : 2));
          if (i % 2 === 0) for (const s of [-1, 1]) { set(alongX ? bx : bx + s, y + 2, alongX ? bz + s : bz, B.bone_block); set(alongX ? bx : bx + s * 2, y + 1, alongX ? bz + s * 2 : bz, B.bone_block); }
        }
      }
    }
  }

  // ------------------------------------------------------------- fortresses
  fortressIn(rx, rz) {
    const key = rx * 65536 + rz;
    if (this.fortCache.has(key)) return this.fortCache.get(key);
    let f = null;
    if (hash2(rx, rz, this.seed ^ 0xf047) < 0.8) f = makeFortress(this, rx, rz);
    if (this.fortCache.size > 64) this.fortCache.clear();
    this.fortCache.set(key, f);
    return f;
  }
  fortressesNear(x0, z0, x1, z1) {
    const out = [];
    for (let rz = Math.floor((z0 - 200) / FREGION); rz <= Math.floor((z1 + 200) / FREGION); rz++) {
      for (let rx = Math.floor((x0 - 200) / FREGION); rx <= Math.floor((x1 + 200) / FREGION); rx++) {
        const f = this.fortressIn(rx, rz);
        if (f && f.bx1 >= x0 && f.bx0 <= x1 && f.bz1 >= z0 && f.bz0 <= z1) out.push(f);
      }
    }
    return out;
  }
  // is (x, y, z) inside a fortress piece? (blazes and wither skeletons spawn there)
  inFortress(x, y, z) {
    for (const f of this.fortressesNear(x, z, x, z)) {
      if (y < f.y0 - 2 || y > f.y0 + 7) continue;
      for (const p of f.pieces) if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return true;
    }
    return false;
  }

  fortresses(ctx) {
    const { x0, z0 } = ctx;
    for (const f of this.fortressesNear(x0, z0, x0 + 15, z0 + 15)) stampFortress(this, ctx, f);
  }
}

// ------------------------------------------------------------------ fungus trees
// put(x, y, z, v) writes a block; get(x, y, z) reads one (for space checks)
export function growFungus(kind, put, x, y, z, R, get) {
  const stem = kind === 'crimson' ? B.crimson_stem : B.warped_stem;
  const wart = kind === 'crimson' ? B.nether_wart_block : B.warped_wart_block;
  let h = 4 + ((R() * 9) | 0);
  if (R() < 0.08) h += 4;
  // shorten under low ceilings
  if (get) { let free = 0; while (free < h + 2 && get(x, y + free, z) === 0) free++; if (free < 5) return false; h = Math.min(h, free - 2); }
  for (let i = 0; i < h; i++) put(x, y + i, z, stem);
  const top = y + h;
  const r = h >= 8 ? 2 : 1;
  // cap: a dome of wart blocks, shroomlights tucked inside
  for (let dy = -Math.max(2, Math.floor(h / 3)); dy <= 0; dy++) {
    const rr = dy === 0 ? r - 1 : r;
    for (let dx = -rr - 1; dx <= rr + 1; dx++) for (let dz = -rr - 1; dz <= rr + 1; dz++) {
      const edge = Math.abs(dx) === rr + 1 || Math.abs(dz) === rr + 1;
      if (Math.abs(dx) === rr + 1 && Math.abs(dz) === rr + 1) continue;
      if (!edge && dy < 0 && !(dx === 0 && dz === 0) && R() > 0.25) continue;
      if (dx === 0 && dz === 0 && dy < 0) continue;
      const v = !edge && R() < 0.12 ? B.shroomlight : wart;
      put(x + dx, top + dy, z + dz, v);
      // weeping vines from crimson caps
      if (edge && dy === -Math.max(2, Math.floor(h / 3)) && kind === 'crimson' && R() < 0.3) {
        const len = 1 + ((R() * 3) | 0);
        for (let i = 1; i <= len; i++) put(x + dx, top + dy - i, z + dz, B.weeping_vines);
      }
    }
  }
  put(x, top, z, wart);
  return true;
}

// ------------------------------------------------------------------ fortress layout
// pieces: corridors (5 wide) and rooms (9x9 or 11x11) on a common deck height
function makeFortress(gen, rx, rz) {
  const R = rng(hash2(rx, rz, gen.seed ^ 0xf0f0) * 4294967296);
  const cx = rx * FREGION + 96 + ((R() * (FREGION - 192)) | 0);
  const cz = rz * FREGION + 96 + ((R() * (FREGION - 192)) | 0);
  const y0 = 50 + ((R() * 20) | 0);
  const nodes = [{ x: cx, z: cz, kind: 'cross' }];
  const corridors = [];
  // four arms from the centre, a few branches off their ends
  const kinds = ['blaze', 'wart', 'blaze', 'chest', 'chest', 'stair'];
  for (let i = kinds.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }
  let ki = 0;
  for (const [dx, dz] of FDIR) {
    if (R() < 0.15) continue;
    const len = 24 + ((R() * 36) | 0);
    const end = { x: cx + dx * len, z: cz + dz * len, kind: 'cross' };
    nodes.push(end);
    corridors.push({ a: nodes[0], b: end, dx, dz });
    // a side branch from the far end
    const turns = FDIR.filter(([ex, ez]) => ex !== -dx || ez !== -dz);
    const nb = 1 + ((R() * 2) | 0);
    for (let k = 0; k < nb; k++) {
      const [ex, ez] = turns[(R() * turns.length) | 0];
      if (corridors.some((c) => c.a === end && c.dx === ex && c.dz === ez)) continue;
      const l2 = 18 + ((R() * 24) | 0);
      const tip = { x: end.x + ex * l2, z: end.z + ez * l2, kind: kinds[ki++ % kinds.length] };
      nodes.push(tip);
      corridors.push({ a: end, b: tip, dx: ex, dz: ez });
    }
  }
  const pieces = [];
  for (const n of nodes) {
    const h = n.kind === 'blaze' || n.kind === 'wart' ? 5 : 4;
    n.half = h;
    pieces.push({ x0: n.x - h, z0: n.z - h, x1: n.x + h, z1: n.z + h });
  }
  for (const c of corridors) {
    pieces.push({ x0: Math.min(c.a.x, c.b.x) - 2, z0: Math.min(c.a.z, c.b.z) - 2, x1: Math.max(c.a.x, c.b.x) + 2, z1: Math.max(c.a.z, c.b.z) + 2 });
  }
  let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
  for (const p of pieces) { bx0 = Math.min(bx0, p.x0); bz0 = Math.min(bz0, p.z0); bx1 = Math.max(bx1, p.x1); bz1 = Math.max(bz1, p.z1); }
  return { x: cx, z: cz, y0, nodes, corridors, pieces, bx0: bx0 - 2, bz0: bz0 - 2, bx1: bx1 + 2, bz1: bz1 + 2, seed: hash2(rx, rz, gen.seed ^ 0xbeef) };
}

function stampFortress(gen, ctx, f) {
  const { blocks, x0, z0 } = ctx;
  const y0 = f.y0;
  const inside = (x, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
  const set = (x, y, z, v) => { if (inside(x, z) && y > 0 && y < WH - 1) blocks[idx(x - x0, y, z - z0)] = v; };
  const get = (x, y, z) => (inside(x, z) ? blocks[idx(x - x0, y, z - z0)] : 0);
  const NB = B.nether_bricks, FENCE = B.nether_brick_fence;
  // a pier from just under the deck down to solid ground, through lava
  const pier = (x, z, top) => {
    if (!inside(x, z)) return;
    for (let y = top; y > 1; y--) {
      const id = get(x, y, z) & 1023;
      if (id && id !== B.lava && id !== B.fire) break;
      set(x, y, z, NB);
    }
  };
  // ---- corridors
  for (const c of f.corridors) {
    const len = Math.abs(c.b.x - c.a.x) + Math.abs(c.b.z - c.a.z);
    const px = c.dz !== 0 ? 1 : 0, pz = c.dx !== 0 ? 1 : 0; // across the corridor
    for (let t = c.a.half + 1; t < len - c.b.half; t++) {
      const mx = c.a.x + c.dx * t, mz = c.a.z + c.dz * t;
      if (!(mx + 2 >= x0 && mx - 2 < x0 + 16 && mz + 2 >= z0 && mz - 2 < z0 + 16)) continue;
      // enclosed where it runs through rock, an open bridge where it spans a cavern
      const enclosed = gen.density(mx, y0 + 2, mz) > 0;
      const window = t % 4 === 2;
      for (let s = -2; s <= 2; s++) {
        const x = mx + px * s, z = mz + pz * s;
        set(x, y0 - 1, z, NB);
        set(x, y0 - 2, z, NB);
        if (Math.abs(s) === 2) {
          if (enclosed) {
            for (let y = y0; y <= y0 + 3; y++) set(x, y, z, window && (y === y0 + 1 || y === y0 + 2) ? FENCE : NB);
          } else {
            set(x, y0, z, NB);
            set(x, y0 + 1, z, FENCE);
            for (let y = y0 + 2; y <= y0 + 4; y++) if (get(x, y, z) & 1023) set(x, y, z, 0);
          }
        } else {
          for (let y = y0; y <= y0 + 3; y++) set(x, y, z, 0);
          if (enclosed) set(x, y0 + 4, z, NB);
        }
        if (enclosed && Math.abs(s) === 2) set(x, y0 + 4, z, NB);
        // piers every so often under open spans
        if (!enclosed && t % 10 < 2) pier(x, z, y0 - 3);
      }
      // a chest tucked against the wall now and then
      if (enclosed && t % 13 === 6 && hash2(mx, mz, gen.seed ^ 0xc4e5) < 0.35) {
        const x = mx + px, z = mz + pz;
        if (inside(x, z)) {
          set(x, y0, z, M(B.chest, px ? 1 : 2));
          ctx.tiles.push({ type: 'chest', x, y: y0, z, items: fortressLoot(rng(hash2(x, z, gen.seed) * 4294967296)) });
        }
      }
    }
  }
  // ---- rooms
  for (const n of f.nodes) {
    const h = n.half;
    if (n.x + h < x0 || n.x - h >= x0 + 16 || n.z + h < z0 || n.z - h >= z0 + 16) continue;
    const doors = new Set();
    for (const c of f.corridors) {
      if (c.a === n) doors.add(c.dx + ',' + c.dz);
      if (c.b === n) doors.add(-c.dx + ',' + -c.dz);
    }
    const open = n.kind === 'blaze';
    const roof = y0 + (n.kind === 'wart' ? 6 : 5);
    for (let dx = -h; dx <= h; dx++) for (let dz = -h; dz <= h; dz++) {
      const x = n.x + dx, z = n.z + dz;
      if (!inside(x, z)) continue;
      const wallX = Math.abs(dx) === h, wallZ = Math.abs(dz) === h;
      const wall = wallX || wallZ;
      // which door (if any) this wall cell belongs to
      const door = wall && ((wallX && Math.abs(dz) <= 1 && doors.has(Math.sign(dx) + ',0')) || (wallZ && Math.abs(dx) <= 1 && doors.has('0,' + Math.sign(dz))));
      set(x, y0 - 1, z, NB);
      set(x, y0 - 2, z, NB);
      for (let y = y0; y <= roof; y++) {
        let v = 0;
        if (open) {
          if (wall && !door && y === y0) v = FENCE;
        } else if (y === roof) v = NB;
        else if (wall && !(door && y <= y0 + 2)) v = (y === y0 + 2 || y === y0 + 3) && (dx + dz) % 3 === 0 && !(wallX && wallZ) ? FENCE : NB;
        set(x, y, z, v);
      }
      if ((wallX && wallZ) || (open && wall && (dx + dz) % 4 === 0)) pier(x, z, y0 - 3);
    }
    if (n.kind === 'blaze') {
      // the spawner on a small raised dais
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(n.x + dx, y0, n.z + dz, NB);
      if (inside(n.x, n.z)) {
        set(n.x, y0 + 1, n.z, B.spawner);
        ctx.tiles.push({ type: 'spawner', x: n.x, y: y0 + 1, z: n.z, mob: 'blaze', delay: 200 });
      }
      for (const [sx, sz, fa] of [[0, 2, 2], [0, -2, 0], [2, 0, 1], [-2, 0, 3]]) set(n.x + sx, y0, n.z + sz, M(B.nether_brick_stairs, fa));
    } else if (n.kind === 'wart') {
      // two beds of soul sand with nether wart, stairs along the back
      for (let dx = -h + 1; dx <= h - 1; dx++) for (const dz of [-h + 1, -h + 2, h - 2, h - 1]) {
        const x = n.x + dx, z = n.z + dz;
        if (Math.abs(dx) <= 1) continue;
        set(x, y0 - 1, z, B.soul_sand);
        set(x, y0, z, M(B.nether_wart, (hash2(x, z, gen.seed) * 4) | 0));
      }
      if (inside(n.x + h - 1, n.z)) {
        set(n.x + h - 1, y0, n.z, M(B.chest, 1));
        ctx.tiles.push({ type: 'chest', x: n.x + h - 1, y: y0, z: n.z, items: fortressLoot(rng(hash2(n.x, n.z, gen.seed) * 4294967296)) });
      }
    } else if (n.kind === 'chest') {
      if (inside(n.x, n.z)) {
        set(n.x, y0, n.z, M(B.chest, 0));
        ctx.tiles.push({ type: 'chest', x: n.x, y: y0, z: n.z, items: fortressLoot(rng(hash2(n.x, n.z, gen.seed) * 4294967296)) });
      }
    } else if (n.kind === 'stair') {
      // a lava well in the middle of the room
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) set(n.x + dx, y0, n.z + dz, Math.abs(dx) + Math.abs(dz) === 0 ? B.lava : NB);
    }
  }
}

function fortressLoot(R) {
  const table = [
    ['diamond', 1, 3, 5], ['iron_ingot', 1, 5, 5], ['gold_ingot', 1, 3, 15], ['golden_sword', 1, 1, 5], ['golden_chestplate', 1, 1, 5],
    ['flint_and_steel', 1, 1, 5], ['nether_wart', 3, 7, 5], ['saddle', 1, 1, 10], ['obsidian', 2, 4, 2],
  ];
  const total = table.reduce((s, t) => s + t[3], 0);
  const items = new Array(27).fill(null);
  const n = 2 + ((R() * 4) | 0);
  for (let i = 0; i < n; i++) {
    let r = R() * total, pick = table[0];
    for (const t of table) { r -= t[3]; if (r <= 0) { pick = t; break; } }
    let slot = (R() * 27) | 0;
    while (items[slot]) slot = (slot + 1) % 27;
    items[slot] = [pick[0], pick[1] + ((R() * (pick[2] - pick[1] + 1)) | 0)];
  }
  return items;
}
