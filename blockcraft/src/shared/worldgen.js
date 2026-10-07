// Deterministic terrain generator. Every column is a pure function of the seed
// and its coordinates, so chunks can be generated independently in workers.
import { Simplex, hash2, hash3, rng } from './noise.js';
import { CS, WH, SEA, idx } from './constants.js';
import { B, OPAQUE, FLOWERS } from './blocks.js';
import { BIOMES, BI, LAND, snowsAt } from './biomes.js';
import { ENCHANTS } from './enchant.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const pack = (r, g, b) => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);

const M = (id, meta) => id | (meta << 10);

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    const s = this.seed;
    this.nTemp = new Simplex(s ^ 0x51a3);
    this.nHum = new Simplex(s ^ 0x7c21);
    this.nCont = new Simplex(s ^ 0x1f9e);
    this.nMount = new Simplex(s ^ 0x3b77);
    this.nRidge = new Simplex(s ^ 0x6e05);
    this.nDetail = new Simplex(s ^ 0x29d4);
    this.nRiver = new Simplex(s ^ 0x4af1);
    this.nOver = new Simplex(s ^ 0x13c8);
    this.nCaveA = new Simplex(s ^ 0x5e62);
    this.nCaveB = new Simplex(s ^ 0x0b39);
    this.nCheese = new Simplex(s ^ 0x77d0);
    this.nPatch = new Simplex(s ^ 0x2266);
    this.tmp = {};
  }

  // ------------------------------------------------------------- climate
  column(x, z, out) {
    const T = this.nTemp.fbm2(x * 0.00062, z * 0.00062, 3) / 0.5 + this.nPatch.noise2(x * 0.05, z * 0.05) * 0.03;
    const Hm = this.nHum.fbm2(x * 0.00078 + 31.7, z * 0.00078 - 17.3, 3) / 0.5;
    const c = this.nCont.fbm2(x * 0.0011 + 101.3, z * 0.0011 + 47.1, 4) / 0.5 + 0.2;
    let wsum = 0, base = 0, amp = 0, best = 1, bestW = -1;
    let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0;
    for (const b of LAND) {
      const dt = T - b.t, dh = Hm - b.h;
      const w = Math.exp(-(dt * dt + dh * dh) * 9);
      wsum += w;
      base += b.base * w; amp += b.amp * w;
      gr += b.grassRGB[0] * w; gg += b.grassRGB[1] * w; gb += b.grassRGB[2] * w;
      fr += b.foliageRGB[0] * w; fg += b.foliageRGB[1] * w; fb += b.foliageRGB[2] * w;
      wr += b.waterRGB[0] * w; wg += b.waterRGB[1] * w; wb += b.waterRGB[2] * w;
      if (w > bestW) { bestW = w; best = b.id; }
    }
    const iw = 1 / wsum;
    base *= iw; amp *= iw;
    gr *= iw; gg *= iw; gb *= iw; fr *= iw; fg *= iw; fb *= iw; wr *= iw; wg *= iw; wb *= iw;

    const land = smooth(-0.3, -0.08, c);
    const detail = this.nDetail.fbm2(x * 0.0105, z * 0.0105, 4);
    const inland = Math.max(0, c + 0.08);
    const landH = SEA + 1 + base + detail * amp * 1.7 + inland * 9;
    const oceanH = SEA - 6 - 17 * smooth(-0.3, -0.9, c) + detail * 4;
    let h = lerp(oceanH, landH, land);

    const mn = this.nMount.fbm2(x * 0.0015 - 71.3, z * 0.0015 + 13.7, 3) / 0.5;
    const mf = smooth(0.3, 0.85, mn) * land;
    if (mf > 0) {
      const ridge = this.nRidge.ridged2(x * 0.0042, z * 0.0042, 4);
      h += mf * (10 + 50 * ridge + detail * 8);
    }
    const rn = Math.abs(this.nRiver.fbm2(x * 0.0024 + 9.1, z * 0.0024 - 3.3, 3));
    const rv = (1 - smooth(0.012, 0.055, rn)) * land * (1 - smooth(0.15, 0.45, mf));
    if (rv > 0) h = lerp(h, Math.min(h, SEA - 3 + detail * 2), rv);
    h = Math.max(3, Math.min(WH - 8, h));

    let biome = best;
    const cold = T < -0.55;
    if (h < SEA - 1 && land < 0.7) biome = cold ? BI.FROZEN_OCEAN : BI.OCEAN;
    else if (rv > 0.4) biome = cold ? BI.FROZEN_RIVER : BI.RIVER;
    else if (mf > 0.38) biome = (cold || T < -0.3) ? BI.SNOWY_MOUNTAINS : BI.MOUNTAINS;
    else if (h <= SEA + 2.6 && c < 0.1 && best !== BI.SWAMP) biome = cold ? BI.SNOWY_BEACH : best === BI.DESERT ? BI.DESERT : BI.BEACH;

    // colours: blend land colours with ocean / mountain / river overrides
    const mix = (rgb, key, t) => {
      const o = BIOMES[key];
      return [lerp(rgb[0], o[0], t), lerp(rgb[1], o[1], t), lerp(rgb[2], o[2], t)];
    };
    let G = [gr, gg, gb], F = [fr, fg, fb], W = [wr, wg, wb];
    const mt = smooth(0.2, 0.5, mf);
    if (mt > 0) {
      const mb = BIOMES[cold || T < -0.3 ? BI.SNOWY_MOUNTAINS : BI.MOUNTAINS];
      G = G.map((v, i) => lerp(v, mb.grassRGB[i], mt)); F = F.map((v, i) => lerp(v, mb.foliageRGB[i], mt));
    }
    const ot = 1 - land;
    if (ot > 0) W = W.map((v, i) => lerp(v, BIOMES[cold ? BI.FROZEN_OCEAN : BI.OCEAN].waterRGB[i], ot));
    if (rv > 0) W = W.map((v, i) => lerp(v, BIOMES[BI.RIVER].waterRGB[i], rv));
    void mix;

    out.h = Math.floor(h);
    out.T = T; out.Hm = Hm; out.mf = mf; out.rv = rv; out.land = land; out.c = c;
    out.biome = biome; out.land_best = best;
    out.grass = pack(G[0], G[1], G[2]);
    out.foliage = pack(F[0], F[1], F[2]);
    out.water = pack(W[0], W[1], W[2]);
    return out;
  }

  biomeAt(x, z) { return this.column(x, z, this.tmp).biome; }

  // ------------------------------------------------------------- chunks
  generate(cx, cz) {
    const x0 = cx * CS, z0 = cz * CS;
    const blocks = new Uint16Array(CS * CS * WH);
    const biomes = new Uint8Array(256);
    const heights = new Int16Array(256);
    const mfs = new Float32Array(256);
    const rvs = new Float32Array(256);
    const temps = new Float32Array(256);
    const grass = new Uint32Array(256), foliage = new Uint32Array(256), water = new Uint32Array(256);
    const col = {};
    let maxMf = 0;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      this.column(x0 + x, z0 + z, col);
      const i = z * 16 + x;
      heights[i] = col.h; biomes[i] = col.biome; mfs[i] = col.mf; rvs[i] = col.rv; temps[i] = col.T;
      grass[i] = col.grass; foliage[i] = col.foliage; water[i] = col.water;
      if (col.mf > maxMf) maxMf = col.mf;
    }
    const R = rng(hash2(cx, cz, this.seed) * 4294967296);
    const ctx = { cx, cz, x0, z0, blocks, biomes, heights, mfs, rvs, temps, R, tiles: [], spawns: [] };

    this.terrain(ctx, maxMf);
    this.surface(ctx);
    this.caves(ctx);
    this.ores(ctx);
    this.dungeon(ctx);
    this.trees(ctx);
    this.plants(ctx);
    this.snow(ctx);
    this.animals(ctx);

    return { blocks, biomes, tints: { grass, foliage, water }, tiles: ctx.tiles, spawns: ctx.spawns };
  }

  terrain(ctx, maxMf) {
    const { blocks, heights, mfs, x0, z0, R } = ctx;
    // coarse 3D noise for cliffs/overhangs in mountains (5 x 33 x 5 grid, trilinear)
    let grid = null;
    const GY = WH / 4 + 1;
    if (maxMf > 0.12) {
      grid = new Float32Array(5 * 5 * GY);
      for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < GY; gy++) {
        const wx = x0 + gx * 4, wz = z0 + gz * 4, wy = gy * 4;
        grid[(gz * 5 + gx) * GY + gy] = this.nOver.noise3(wx * 0.03, wy * 0.045, wz * 0.03) * 0.7 + this.nOver.noise3(wx * 0.07, wy * 0.09, wz * 0.07) * 0.3;
      }
    }
    const sample = (x, y, z) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(3, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(3, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const g = (a, b, c) => grid[((iz + c) * 5 + (ix + a)) * GY + iy + b];
      const c00 = lerp(g(0, 0, 0), g(1, 0, 0), tx), c10 = lerp(g(0, 1, 0), g(1, 1, 0), tx);
      const c01 = lerp(g(0, 0, 1), g(1, 0, 1), tx), c11 = lerp(g(0, 1, 1), g(1, 1, 1), tx);
      return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
    };
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const i = z * 16 + x;
      const h = heights[i], mf = mfs[i];
      let top = 0;
      for (let y = 0; y < WH; y++) {
        let solid = y <= h;
        if (grid && mf > 0.12 && y > h - 18 && y < h + 12) {
          // cliffs and overhangs near the surface; fades out above so nothing floats
          const above = Math.max(0, y - h);
          const d = (h - y) + sample(x, y, z) * 13 * mf * (1 - above / 12);
          solid = d > 0;
        }
        let v = 0;
        if (solid) { v = B.stone; top = y; }
        else if (y <= SEA) v = B.water;
        if (y === 0 || (y < 4 && R() < (4 - y) / 5)) v = B.bedrock;
        blocks[idx(x, y, z)] = v;
      }
      heights[i] = Math.max(top, 1);
    }
  }

  surface(ctx) {
    const { blocks, heights, biomes, mfs, x0, z0, R } = ctx;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const i = z * 16 + x;
      const bio = biomes[i];
      const wx = x0 + x, wz = z0 + z;
      const patch = this.nPatch.noise2(wx * 0.06, wz * 0.06);
      // slope from the 2D height field (neighbours inside the chunk only)
      const hN = heights[Math.max(0, z - 1) * 16 + x], hS = heights[Math.min(15, z + 1) * 16 + x];
      const hW = heights[z * 16 + Math.max(0, x - 1)], hE = heights[z * 16 + Math.min(15, x + 1)];
      const slope = Math.max(Math.abs(hN - hS), Math.abs(hE - hW));
      const snowLine = 92 + patch * 6;
      let depth = -1, fill = 3 + (R() * 2 | 0);
      let underwater = false;
      for (let y = WH - 1; y > 0; y--) {
        const p = idx(x, y, z);
        const v = blocks[p];
        if (v !== B.stone) {
          if (v === 0 || v === B.water) { depth = -1; underwater = v === B.water; }
          continue;
        }
        if (depth === -1) {
          depth = 0;
          let top = B.grass_block, filler = B.dirt;
          if (underwater || y < SEA) {
            // sea/river floor
            if (bio === BI.RIVER || bio === BI.FROZEN_RIVER) { top = patch > 0.3 ? B.gravel : B.sand; filler = top; if (patch < -0.45) top = filler = B.clay; }
            else if (y >= SEA - 5) { top = filler = B.sand; }
            else { top = filler = patch > 0.15 ? B.gravel : B.sand; if (patch < -0.5) top = B.clay; }
            if (bio === BI.SWAMP) { top = B.dirt; filler = B.dirt; if (patch > 0.3) top = B.clay; }
          } else {
            switch (bio) {
              case BI.DESERT: top = filler = B.sand; fill = 4; break;
              case BI.BEACH: case BI.SNOWY_BEACH: top = filler = B.sand; break;
              case BI.MOUNTAINS: case BI.SNOWY_MOUNTAINS:
                if (y > snowLine + 6) { top = B.snow_block; filler = B.stone; }
                else if (slope > 4 || y > snowLine) { top = B.stone; filler = B.stone; if (patch > 0.4) top = filler = B.gravel; }
                break;
              case BI.TAIGA: case BI.SNOWY_TAIGA:
                if (patch > 0.35) top = B.podzol; else if (patch < -0.55) top = B.coarse_dirt;
                break;
              case BI.SAVANNA: if (patch > 0.5) top = B.coarse_dirt; break;
              case BI.OCEAN: case BI.FROZEN_OCEAN: top = filler = B.sand; break;
              default:
                if (slope > 6 && mfs[i] > 0.1) { top = B.stone; filler = B.stone; }
            }
          }
          blocks[p] = top;
          if (top === B.sand && (bio === BI.DESERT || bio === BI.BEACH)) fill = 4;
          ctx.filler = filler;
          continue;
        }
        if (depth < fill) {
          depth++;
          let f = ctx.filler;
          if (f === B.sand && depth >= fill - 1) f = B.sandstone;
          blocks[p] = f;
        }
      }
    }
  }

  caves(ctx) {
    const { blocks, heights, x0, z0 } = ctx;
    // coarse grid 5 x 33 x 5 for three noises
    const GY = WH / 4 + 1;
    const A = new Float32Array(25 * GY), Bn = new Float32Array(25 * GY), C = new Float32Array(25 * GY);
    for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) for (let gy = 0; gy < GY; gy++) {
      const wx = x0 + gx * 4, wz = z0 + gz * 4, wy = gy * 4;
      const k = (gz * 5 + gx) * GY + gy;
      A[k] = this.nCaveA.noise3(wx * 0.022, wy * 0.034, wz * 0.022);
      Bn[k] = this.nCaveB.noise3(wx * 0.022, wy * 0.034, wz * 0.022);
      C[k] = this.nCheese.noise3(wx * 0.014, wy * 0.026, wz * 0.014) + this.nCheese.noise3(wx * 0.05, wy * 0.06, wz * 0.05) * 0.25;
    }
    const tri = (G, x, y, z) => {
      const fx = x / 4, fy = y / 4, fz = z / 4;
      const ix = Math.min(3, fx | 0), iy = Math.min(GY - 2, fy | 0), iz = Math.min(3, fz | 0);
      const tx = fx - ix, ty = fy - iy, tz = fz - iz;
      const g = (a, b, c) => G[((iz + c) * 5 + (ix + a)) * GY + iy + b];
      return lerp(
        lerp(lerp(g(0, 0, 0), g(1, 0, 0), tx), lerp(g(0, 1, 0), g(1, 1, 0), tx), ty),
        lerp(lerp(g(0, 0, 1), g(1, 0, 1), tx), lerp(g(0, 1, 1), g(1, 1, 1), tx), ty), tz);
    };
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const h = heights[z * 16 + x];
      const wet = h < SEA + 2; // don't open caves into the sea or rivers
      const ymax = wet ? h - 6 : h + 1;
      for (let y = 1; y <= ymax && y < WH - 1; y++) {
        const p = idx(x, y, z);
        const v = blocks[p];
        if (v === 0 || v === B.water || v === B.bedrock) continue;
        const a = tri(A, x, y, z), b = tri(Bn, x, y, z);
        // spaghetti tunnels: intersection of two noise zero-sets, wider deeper down
        const w = 0.0045 + 0.004 * (1 - y / WH);
        let carve = a * a + b * b < w;
        if (!carve && y < 52) {
          const c = tri(C, x, y, z);
          carve = c > 0.52 + (y < 14 ? 0 : 0) + Math.max(0, (y - 36) / 60);
        }
        if (!carve) continue;
        // keep a ceiling under water
        const above = blocks[p + 256];
        if (above === B.water) continue;
        blocks[p] = y < 11 ? B.lava : 0;
        // exposed dirt under removed grass stays as-is; grass above a carved block remains
      }
    }
  }

  ores(ctx) {
    const { blocks, R } = ctx;
    const vein = (id, count, size, ymin, ymax) => {
      for (let n = 0; n < count; n++) {
        let x = (R() * 16) | 0, y = ymin + ((R() * (ymax - ymin)) | 0), z = (R() * 16) | 0;
        for (let i = 0; i < size; i++) {
          if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < WH) {
            const p = idx(x, y, z);
            if (blocks[p] === B.stone) blocks[p] = id;
          }
          const d = (R() * 6) | 0;
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    };
    const blob = (id, count, rmin, rmax, ymin, ymax, replace) => {
      for (let n = 0; n < count; n++) {
        const cx = R() * 16, cy = ymin + R() * (ymax - ymin), cz = R() * 16;
        const r = rmin + R() * (rmax - rmin);
        const r2 = r * r;
        for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(WH - 1, Math.ceil(cy + r)); y++)
          for (let z = Math.max(0, Math.floor(cz - r)); z <= Math.min(15, Math.ceil(cz + r)); z++)
            for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(15, Math.ceil(cx + r)); x++) {
              const dx = x - cx, dy = (y - cy) * 1.3, dz = z - cz;
              if (dx * dx + dy * dy + dz * dz > r2) continue;
              const p = idx(x, y, z);
              if (blocks[p] === replace) blocks[p] = id;
            }
      }
    };
    blob(B.granite, 2, 2, 4, 1, 80, B.stone);
    blob(B.diorite, 2, 2, 4, 1, 80, B.stone);
    blob(B.andesite, 2, 2, 4, 1, 80, B.stone);
    blob(B.dirt, 2, 1.5, 3, 1, 100, B.stone);
    blob(B.gravel, 2, 1.5, 3, 1, 100, B.stone);
    vein(B.coal_ore, 18, 14, 5, 110);
    vein(B.iron_ore, 16, 8, 2, 64);
    vein(B.gold_ore, 2, 8, 2, 32);
    vein(B.redstone_ore, 6, 7, 2, 16);
    vein(B.diamond_ore, 1, 7, 2, 16);
    vein(B.lapis_ore, 1, 6, 5, 30);
    // emeralds: single blocks in mountains
    if (ctx.biomes[136] === BI.MOUNTAINS || ctx.biomes[136] === BI.SNOWY_MOUNTAINS) vein(B.emerald_ore, 4, 1, 4, 32);
  }

  dungeon(ctx) {
    const { blocks, R } = ctx;
    if (R() > 0.12) return;
    const cx = 4 + ((R() * 8) | 0), cz = 4 + ((R() * 8) | 0), cy = 12 + ((R() * 36) | 0);
    const rx = 2 + (R() < 0.5 ? 1 : 0), rz = 2 + (R() < 0.5 ? 1 : 0);
    // the floor and ceiling must be solid and it must not touch liquids
    let openings = 0;
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) {
      for (let y = cy - 1; y <= cy + 4; y++) {
        const v = blocks[idx(x, y, z)];
        if (v === B.water || v === B.lava) return;
        const edgeY = y === cy - 1 || y === cy + 4;
        if (edgeY && !OPAQUE[v]) return;
        const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1;
        if (wall && y === cy && v === 0) openings++;
      }
    }
    if (openings < 1 || openings > 6) return;
    for (let x = cx - rx - 1; x <= cx + rx + 1; x++) for (let z = cz - rz - 1; z <= cz + rz + 1; z++) {
      for (let y = cy - 1; y <= cy + 4; y++) {
        const p = idx(x, y, z);
        const wall = x === cx - rx - 1 || x === cx + rx + 1 || z === cz - rz - 1 || z === cz + rz + 1;
        if (y === cy - 1) blocks[p] = R() < 0.6 ? B.mossy_cobblestone : B.cobblestone;
        else if (y === cy + 4) blocks[p] = B.cobblestone;
        else if (wall) { if (blocks[p] !== 0) blocks[p] = R() < 0.3 ? B.mossy_cobblestone : B.cobblestone; }
        else blocks[p] = 0;
      }
    }
    blocks[idx(cx, cy, cz)] = B.spawner;
    const mob = ['zombie', 'zombie', 'skeleton', 'spider'][(R() * 4) | 0];
    ctx.tiles.push({ type: 'spawner', x: ctx.x0 + cx, y: cy, z: ctx.z0 + cz, mob, delay: 200 });
    // chests against walls
    let chests = 0;
    for (let tries = 0; tries < 12 && chests < 2; tries++) {
      const x = cx - rx + ((R() * (rx * 2 + 1)) | 0), z = cz - rz + ((R() * (rz * 2 + 1)) | 0);
      if (x === cx && z === cz) continue;
      const nearWall = x === cx - rx || x === cx + rx || z === cz - rz || z === cz + rz;
      if (!nearWall || blocks[idx(x, cy, z)] !== 0) continue;
      const facing = z === cz - rz ? 0 : z === cz + rz ? 2 : x === cx - rx ? 3 : 1;
      blocks[idx(x, cy, z)] = M(B.chest, facing);
      ctx.tiles.push({ type: 'chest', x: ctx.x0 + x, y: cy, z: ctx.z0 + z, items: dungeonLoot(R) });
      chests++;
    }
  }

  // --------------------------------------------------------- trees
  trees(ctx) {
    const { x0, z0 } = ctx;
    const col = {};
    const CELL = 4, MARGIN = 6;
    const gx0 = Math.floor((x0 - MARGIN) / CELL), gx1 = Math.floor((x0 + 15 + MARGIN) / CELL);
    const gz0 = Math.floor((z0 - MARGIN) / CELL), gz1 = Math.floor((z0 + 15 + MARGIN) / CELL);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const hx = hash2(gx, gz, this.seed + 101), hz = hash2(gx, gz, this.seed + 202), hp = hash2(gx, gz, this.seed + 303);
      const wx = gx * CELL + ((hx * CELL) | 0), wz = gz * CELL + ((hz * CELL) | 0);
      if (wx < x0 - MARGIN || wx > x0 + 15 + MARGIN || wz < z0 - MARGIN || wz > z0 + 15 + MARGIN) continue;
      this.column(wx, wz, col);
      if (col.h <= SEA || col.mf > 0.12 || col.rv > 0.3) continue;
      const kind = treeFor(col.biome, hp, hash2(wx, wz, this.seed + 404));
      if (!kind) continue;
      // in mountains only below the tree line
      if ((col.biome === BI.MOUNTAINS || col.biome === BI.SNOWY_MOUNTAINS) && col.h > 88) continue;
      const lx = wx - x0, lz = wz - z0;
      // the ground must be soil (checked when the trunk column is in this chunk)
      if (lx >= 0 && lx < 16 && lz >= 0 && lz < 16) {
        const g = ctx.blocks[idx(lx, col.h, lz)];
        if (g !== B.grass_block && g !== B.dirt && g !== B.podzol && g !== B.coarse_dirt) continue;
        if (ctx.blocks[idx(lx, col.h + 1, lz)] !== 0) continue;
        ctx.blocks[idx(lx, col.h, lz)] = B.dirt;
      }
      const R = rng(hash2(wx, wz, this.seed + 505) * 4294967296);
      growTree(kind, (x, y, z, v, mode) => this.put(ctx, x - x0, y, z - z0, v, mode), wx, col.h + 1, wz, R);
    }
  }

  // write a block if inside this chunk. mode 0: log (replaces air, leaves, plants); 1: leaves (air/plants only)
  put(ctx, x, y, z, v, mode) {
    if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || y >= WH) return;
    const p = idx(x, y, z);
    const cur = ctx.blocks[p] & 1023;
    if (mode === 1) { if (cur !== 0 && !isPlant(cur)) return; }
    else if (cur !== 0 && !isPlant(cur) && !isLeaves(cur) && cur !== B.dirt && cur !== B.grass_block && cur !== B.snow) return;
    ctx.blocks[p] = v;
  }

  // --------------------------------------------------------- small plants
  plants(ctx) {
    const { blocks, biomes, x0, z0, R } = ctx;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const bio = biomes[z * 16 + x];
      // find surface
      let y = WH - 2;
      while (y > 0 && blocks[idx(x, y, z)] === 0) y--;
      const p = idx(x, y, z);
      const g = blocks[p];
      const above = p + 256;
      if (blocks[above] !== 0) continue;
      const wx = x0 + x, wz = z0 + z;
      const r = R();
      const flowerNoise = this.nPatch.noise2(wx * 0.04 + 300, wz * 0.04);
      if (g === B.grass_block) {
        let dens = 0.08, fern = 0, flowerP = 0.01;
        switch (bio) {
          case BI.PLAINS: dens = 0.28; flowerP = flowerNoise > 0.3 ? 0.12 : 0.02; break;
          case BI.FOREST: dens = 0.14; flowerP = 0.025; break;
          case BI.BIRCH_FOREST: dens = 0.12; flowerP = 0.02; break;
          case BI.DARK_FOREST: dens = 0.06; flowerP = 0.003; break;
          case BI.TAIGA: dens = 0.14; fern = 0.6; flowerP = 0.002; break;
          case BI.JUNGLE: dens = 0.4; fern = 0.4; flowerP = 0.005; break;
          case BI.SAVANNA: dens = 0.35; flowerP = 0.003; break;
          case BI.SWAMP: dens = 0.12; flowerP = 0.02; break;
          case BI.SNOWY_PLAINS: case BI.SNOWY_TAIGA: case BI.SNOWY_MOUNTAINS: dens = 0.02; flowerP = 0; break;
        }
        if (r < flowerP) {
          blocks[above] = pickFlower(bio, flowerNoise, R);
        } else if (r < flowerP + dens) {
          blocks[above] = R() < fern ? B.fern : B.short_grass;
        } else if (r < flowerP + dens + 0.0015 && (bio === BI.PLAINS || bio === BI.FOREST || bio === BI.TAIGA)) {
          blocks[above] = M(B.pumpkin, (R() * 4) | 0);
        } else if (bio === BI.JUNGLE && r > 0.997) {
          blocks[above] = B.melon;
        } else if ((bio === BI.DARK_FOREST || bio === BI.SWAMP || bio === BI.TAIGA) && r > 0.993) {
          blocks[above] = R() < 0.5 ? B.brown_mushroom : B.red_mushroom;
        }
      } else if (g === B.sand && bio === BI.DESERT) {
        if (r < 0.006 && x > 0 && x < 15 && z > 0 && z < 15) {
          // cactus needs free sides
          const free = (dx, dz) => blocks[idx(x + dx, y + 1, z + dz)] === 0;
          if (free(1, 0) && free(-1, 0) && free(0, 1) && free(0, -1)) {
            const hgt = 1 + ((R() * 3) | 0);
            for (let k = 1; k <= hgt; k++) blocks[idx(x, y + k, z)] = B.cactus;
          }
        } else if (r < 0.014) blocks[above] = B.dead_bush;
      } else if (g === B.water && y === SEA && bio === BI.SWAMP && r < 0.05) {
        blocks[above] = B.lily_pad;
      }
      // sugar cane next to water
      if ((g === B.grass_block || g === B.sand || g === B.dirt) && y === SEA && blocks[above] === 0 && x > 0 && x < 15 && z > 0 && z < 15 && R() < 0.12) {
        const w = (dx, dz) => blocks[idx(x + dx, y, z + dz)] === B.water;
        if (w(1, 0) || w(-1, 0) || w(0, 1) || w(0, -1)) {
          const hgt = 1 + ((R() * 3) | 0);
          for (let k = 1; k <= hgt; k++) blocks[idx(x, y + k, z)] = B.sugar_cane;
        }
      }
    }
  }

  snow(ctx) {
    const { blocks, biomes, temps, heights } = ctx;
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const i = z * 16 + x;
      const bio = biomes[i];
      const snowy = snowsAt(BIOMES[bio], heights[i]);
      if (!snowy) continue;
      let y = WH - 2;
      while (y > 0 && blocks[idx(x, y, z)] === 0) y--;
      const p = idx(x, y, z);
      const v = blocks[p] & 1023;
      if (v === B.water) { if (y === SEA && temps[i] < -0.5) blocks[p] = B.ice; continue; }
      if (OPAQUE[v] || isLeaves(v)) { if (blocks[p + 256] === 0) blocks[p + 256] = B.snow; }
      else if (isPlant(v) && v !== B.sugar_cane && v !== B.cactus) { blocks[p] = B.snow; }
    }
  }

  animals(ctx) {
    const { blocks, biomes, R } = ctx;
    if (R() > 0.12) return;
    const x = 2 + ((R() * 12) | 0), z = 2 + ((R() * 12) | 0);
    const bio = biomes[z * 16 + x];
    let types;
    switch (bio) {
      case BI.PLAINS: case BI.FOREST: case BI.BIRCH_FOREST: case BI.MOUNTAINS: case BI.SAVANNA: types = ['cow', 'pig', 'sheep', 'chicken']; break;
      case BI.TAIGA: case BI.DARK_FOREST: case BI.JUNGLE: case BI.SWAMP: types = ['pig', 'chicken', 'sheep', 'cow']; break;
      case BI.SNOWY_PLAINS: case BI.SNOWY_TAIGA: types = ['sheep']; break;
      default: return;
    }
    const type = types[(R() * types.length) | 0];
    const n = 2 + ((R() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const ax = Math.max(0, Math.min(15, x + ((R() * 5) | 0) - 2)), az = Math.max(0, Math.min(15, z + ((R() * 5) | 0) - 2));
      let y = WH - 2;
      while (y > 0 && blocks[idx(ax, y, az)] === 0) y--;
      if (blocks[idx(ax, y, az)] !== B.grass_block && (blocks[idx(ax, y, az)] & 1023) !== B.snow) continue;
      ctx.spawns.push({ type, x: ctx.x0 + ax + 0.5, y: y + 1, z: ctx.z0 + az + 0.5 });
    }
  }
}

const LEAVES = new Set();
const PLANTS = new Set();
function isLeaves(id) {
  if (!LEAVES.size) for (const n of ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak']) LEAVES.add(B[n + '_leaves']);
  return LEAVES.has(id);
}
function isPlant(id) {
  if (!PLANTS.size) {
    for (const n of ['short_grass', 'fern', 'dead_bush', 'brown_mushroom', 'red_mushroom', 'snow', 'vine', ...FLOWERS]) PLANTS.add(B[n]);
  }
  return PLANTS.has(id);
}

function pickFlower(bio, n, R) {
  if (bio === BI.SWAMP) return B.blue_orchid;
  if (bio === BI.FOREST || bio === BI.BIRCH_FOREST || bio === BI.DARK_FOREST) {
    return [B.dandelion, B.poppy, B.lily_of_the_valley, B.allium, B.poppy][(R() * 5) | 0];
  }
  if (bio === BI.PLAINS) {
    if (n > 0.3) return [B.red_tulip, B.orange_tulip, B.white_tulip, B.pink_tulip][(R() * 4) | 0];
    return [B.dandelion, B.poppy, B.oxeye_daisy, B.cornflower, B.azure_bluet][(R() * 5) | 0];
  }
  return R() < 0.5 ? B.dandelion : B.poppy;
}

// choose a tree kind for a candidate site, or null
function treeFor(bio, p, q) {
  switch (bio) {
    case BI.PLAINS: return p < 0.035 ? 'oak' : null;
    case BI.FOREST: return p < 0.62 ? (q < 0.2 ? 'birch' : q < 0.25 ? 'big_oak' : 'oak') : null;
    case BI.BIRCH_FOREST: return p < 0.6 ? (q < 0.85 ? 'birch' : 'oak') : null;
    case BI.DARK_FOREST: return p < 0.8 ? (q < 0.75 ? 'dark_oak' : q < 0.85 ? 'birch' : 'oak') : null;
    case BI.TAIGA: return p < 0.55 ? 'spruce' : null;
    case BI.SNOWY_TAIGA: return p < 0.45 ? 'spruce' : null;
    case BI.SNOWY_PLAINS: return p < 0.02 ? 'spruce' : null;
    case BI.SAVANNA: return p < 0.08 ? (q < 0.8 ? 'acacia' : 'oak') : null;
    case BI.JUNGLE: return p < 0.85 ? (q < 0.22 ? 'mega_jungle' : q < 0.6 ? 'jungle' : 'jungle_bush') : null;
    case BI.SWAMP: return p < 0.18 ? 'swamp_oak' : null;
    case BI.MOUNTAINS: return p < 0.12 ? (q < 0.5 ? 'spruce' : 'oak') : null;
    case BI.SNOWY_MOUNTAINS: return p < 0.06 ? 'spruce' : null;
    case BI.BEACH: return null;
    default: return null;
  }
}

// grow a tree with put(x,y,z,value,mode) in world coordinates
export function growTree(kind, put, x, y, z, R) {
  const LOG = (w) => B[w + '_log'];
  const LEAF = (w) => B[w + '_leaves'];
  const leafBlob = (w, cx, cy, cz, r, skip) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (skip && Math.abs(dx) === r && Math.abs(dz) === r && (skip === 2 || R() < 0.5)) continue;
      put(cx + dx, cy, cz + dz, LEAF(w), 1);
    }
  };
  const oakLike = (w, h, wide) => {
    for (let i = 0; i < h; i++) put(x, y + i, z, LOG(w), 0);
    const top = y + h - 1;
    for (let ly = top - 2; ly <= top + 1; ly++) {
      const r = ly >= top ? 1 : (wide ? 3 : 2);
      leafBlob(w, x, ly, z, r, ly === top + 1 ? 2 : 1);
    }
  };
  switch (kind) {
    case 'oak': oakLike('oak', 4 + ((R() * 3) | 0)); break;
    case 'birch': oakLike('birch', 5 + ((R() * 3) | 0)); break;
    case 'swamp_oak': {
      const h = 4 + ((R() * 3) | 0);
      oakLike('oak', h, true);
      // hanging vines on the canopy edge
      for (let i = 0; i < 10; i++) {
        const dx = ((R() * 7) | 0) - 3, dz = ((R() * 7) | 0) - 3;
        if (Math.abs(dx) !== 3 && Math.abs(dz) !== 3) continue;
        const side = dx === 3 ? 2 : dx === -3 ? 1 : dz === 3 ? 8 : 4;
        const len = 1 + ((R() * 4) | 0);
        for (let k = 0; k < len; k++) put(x + dx + (dx === 3 ? 1 : dx === -3 ? -1 : 0), y + h - 3 - k, z + dz + (dz === 3 ? 1 : dz === -3 ? -1 : 0), M(B.vine, side), 1);
      }
      break;
    }
    case 'big_oak': {
      const h = 7 + ((R() * 4) | 0);
      for (let i = 0; i < h; i++) put(x, y + i, z, LOG('oak'), 0);
      const top = y + h;
      leafBlob('oak', x, top, z, 1, 2);
      leafBlob('oak', x, top - 1, z, 2, 1);
      leafBlob('oak', x, top - 2, z, 3, 1);
      leafBlob('oak', x, top - 3, z, 3, 2);
      leafBlob('oak', x, top - 4, z, 2, 1);
      // branches
      for (let b = 0; b < 3; b++) {
        const dx = R() < 0.5 ? -1 : 1, dz = R() < 0.5 ? -1 : 1;
        const by = top - 3 - ((R() * 2) | 0);
        put(x + dx, by, z + dz, M(LOG('oak'), 1), 0);
        put(x + dx * 2, by + 1, z + dz * 2, M(LOG('oak'), 1), 0);
        leafBlob('oak', x + dx * 2, by + 2, z + dz * 2, 1, 2);
      }
      break;
    }
    case 'spruce': {
      const h = 7 + ((R() * 5) | 0);
      for (let i = 0; i < h; i++) put(x, y + i, z, LOG('spruce'), 0);
      const top = y + h;
      put(x, top, z, LEAF('spruce'), 1);
      put(x, top + 1, z, LEAF('spruce'), 1);
      let r = 1, maxR = 2 + ((R() * 2) | 0);
      for (let ly = top - 1; ly >= y + 2 + ((R() * 2) | 0); ly--) {
        leafBlob('spruce', x, ly, z, r, 2);
        r = r >= maxR ? 1 : r + 1;
        if (r === 1 && maxR < 3) maxR++;
      }
      break;
    }
    case 'jungle': {
      const h = 5 + ((R() * 6) | 0);
      for (let i = 0; i < h; i++) put(x, y + i, z, LOG('jungle'), 0);
      const top = y + h - 1;
      for (let ly = top - 2; ly <= top + 1; ly++) leafBlob('jungle', x, ly, z, ly >= top ? 1 : 2, 1);
      // cocoa-less vines on the trunk
      for (let i = 0; i < h - 2; i++) if (R() < 0.4) put(x + 1, y + i, z, M(B.vine, 2), 1);
      break;
    }
    case 'mega_jungle': {
      const h = 12 + ((R() * 10) | 0);
      for (let i = 0; i < h; i++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x + dx, y + i, z + dz, LOG('jungle'), 0);
      const top = y + h;
      for (let ly = top - 3; ly <= top; ly++) {
        const r = ly === top ? 2 : ly === top - 3 ? 3 : 4;
        for (let dx = -r; dx <= r + 1; dx++) for (let dz = -r; dz <= r + 1; dz++) {
          const ddx = dx - 0.5, ddz = dz - 0.5;
          if (ddx * ddx + ddz * ddz > (r + 0.5) * (r + 0.5)) continue;
          put(x + dx, ly, z + dz, LEAF('jungle'), 1);
        }
      }
      // vines down the trunk sides
      for (let i = 2; i < h - 2; i++) {
        if (R() < 0.5) put(x - 1, y + i, z, M(B.vine, 1), 1);
        if (R() < 0.5) put(x + 2, y + i, z + 1, M(B.vine, 2), 1);
        if (R() < 0.5) put(x, y + i, z - 1, M(B.vine, 4), 1);
        if (R() < 0.5) put(x + 1, y + i, z + 2, M(B.vine, 8), 1);
      }
      break;
    }
    case 'jungle_bush': {
      put(x, y, z, LOG('jungle'), 0);
      leafBlob('oak', x, y, z, 2, 1);
      leafBlob('oak', x, y + 1, z, 1, 1);
      break;
    }
    case 'acacia': {
      const h = 4 + ((R() * 2) | 0);
      let tx = x, tz = z;
      const dx = R() < 0.5 ? -1 : 1, dz = R() < 0.5 ? -1 : 1;
      const bend = 2 + ((R() * 2) | 0);
      let ty = y;
      for (let i = 0; i < h; i++) {
        if (i >= bend) { tx += (i % 2 === 0) ? dx : 0; tz += (i % 2 === 1) ? dz : 0; }
        put(tx, ty, tz, LOG('acacia'), 0);
        ty++;
      }
      for (let ddx = -3; ddx <= 3; ddx++) for (let ddz = -3; ddz <= 3; ddz++) {
        if (Math.abs(ddx) === 3 && Math.abs(ddz) === 3) continue;
        if ((Math.abs(ddx) === 3 || Math.abs(ddz) === 3) && R() < 0.25) continue;
        put(tx + ddx, ty - 1, tz + ddz, LEAF('acacia'), 1);
      }
      leafBlob('acacia', tx, ty, tz, 1, 2);
      leafBlob('acacia', tx, ty, tz, 2, 2);
      // a side branch
      if (R() < 0.6) {
        const bx = x - dx, bz = z - dz;
        put(bx, y + bend, bz, LOG('acacia'), 0);
        put(bx - dx, y + bend + 1, bz - dz, LOG('acacia'), 0);
        leafBlob('acacia', bx - dx, y + bend + 2, bz - dz, 2, 2);
        leafBlob('acacia', bx - dx, y + bend + 3, bz - dz, 1, 2);
      }
      break;
    }
    case 'dark_oak': {
      const h = 6 + ((R() * 3) | 0);
      for (let i = 0; i < h; i++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) put(x + dx, y + i, z + dz, LOG('dark_oak'), 0);
      const top = y + h;
      for (let ly = top - 2; ly <= top + 1; ly++) {
        const r = ly === top + 1 ? 2 : ly === top - 2 ? 3 : 4;
        for (let dx = -r; dx <= r + 1; dx++) for (let dz = -r; dz <= r + 1; dz++) {
          const ddx = dx - 0.5, ddz = dz - 0.5;
          if (ddx * ddx + ddz * ddz > (r + 0.3) * (r + 0.3)) continue;
          put(x + dx, ly, z + dz, LEAF('dark_oak'), 1);
        }
      }
      break;
    }
  }
}

function dungeonLoot(R) {
  const table = [
    ['bread', 1, 3, 15], ['wheat', 1, 4, 15], ['iron_ingot', 1, 4, 12], ['gold_ingot', 1, 4, 6], ['coal', 2, 8, 12],
    ['string', 1, 4, 12], ['bone', 1, 6, 12], ['rotten_flesh', 1, 6, 12], ['gunpowder', 1, 4, 10], ['bucket', 1, 1, 8],
    ['redstone', 1, 4, 8], ['apple', 1, 3, 10], ['golden_apple', 1, 1, 3], ['diamond', 1, 2, 3], ['saddle', 0, 0, 0],
    ['iron_pickaxe', 1, 1, 3], ['iron_sword', 1, 1, 3], ['melon_seeds', 2, 4, 6], ['pumpkin_seeds', 2, 4, 6], ['book', 1, 3, 6],
    ['iron_helmet', 1, 1, 2], ['iron_chestplate', 1, 1, 2], ['bow', 1, 1, 4], ['arrow', 4, 12, 8], ['emerald', 1, 2, 3],
    ['enchanted_book', 1, 1, 8],
  ].filter((t) => t[3] > 0);
  const total = table.reduce((s, t) => s + t[3], 0);
  const items = new Array(27).fill(null);
  const n = 4 + ((R() * 5) | 0);
  for (let i = 0; i < n; i++) {
    let r = R() * total;
    let pick = table[0];
    for (const t of table) { r -= t[3]; if (r <= 0) { pick = t; break; } }
    const count = pick[1] + ((R() * (pick[2] - pick[1] + 1)) | 0);
    let slot = (R() * 27) | 0;
    while (items[slot]) slot = (slot + 1) % 27;
    if (pick[0] === 'enchanted_book') {
      // any enchantment, treasure ones (mending) included, at a random level
      const e = ENCHANTS[(R() * ENCHANTS.length) | 0];
      items[slot] = ['enchanted_book', 1, 0, { e: [[e.id, 1 + ((R() * e.max) | 0)]] }];
    } else items[slot] = [pick[0], count];
  }
  return items;
}

export { hash3 };
