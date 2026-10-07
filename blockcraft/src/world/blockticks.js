// Block behaviour: scheduled ticks (fluids, gravity), neighbour updates and random ticks.
import { BLOCKS, B, R, OPAQUE, LIQUID, WOODS } from '../shared/blocks.js';
import { WH, idx, DIRS } from '../shared/constants.js';
import { growTree } from '../shared/worldgen.js';
import { rng } from '../shared/noise.js';

const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SOIL = new Set();
const LEAVES = new Set();
const LOGS = new Set();
const SAPLINGS = new Set();

export class BlockTicks {
  constructor(game) {
    this.game = game;
    this.sched = new Map(); // key -> due tick
    this.queue = []; // [due, x, y, z]
    if (!SOIL.size) {
      for (const n of ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'farmland']) SOIL.add(B[n]);
      for (const w of WOODS) { LEAVES.add(B[w + '_leaves']); LOGS.add(B[w + '_log']); SAPLINGS.add(B[w + '_sapling']); }
    }
  }
  get world() { return this.game.world; }

  schedule(x, y, z, delay) {
    const k = x + ',' + y + ',' + z;
    const due = this.game.tickCount + delay;
    const cur = this.sched.get(k);
    if (cur !== undefined && cur <= due) return;
    this.sched.set(k, due);
    this.queue.push([due, x, y, z]);
  }

  runScheduled() {
    if (!this.queue.length) return;
    const now = this.game.tickCount;
    const due = [];
    const keep = [];
    for (const q of this.queue) (q[0] <= now ? due : keep).push(q);
    if (!due.length) return;
    this.queue = keep;
    due.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [, x, y, z] of due) {
      const k = x + ',' + y + ',' + z;
      if (this.sched.get(k) > now) continue;
      this.sched.delete(k);
      if (!this.world.isLoaded(x, z)) continue;
      this.scheduledTick(x, y, z);
      if (++n > 2000) break; // runaway protection
    }
  }

  scheduledTick(x, y, z) {
    const w = this.world;
    const v = w.getBlock(x, y, z);
    const id = v & 1023;
    if (LIQUID[id]) return this.fluidTick(x, y, z, id, v >>> 10);
    if (BLOCKS[id].gravity) return this.gravityCheck(x, y, z, v);
    if (LEAVES.has(id)) return this.leafDecay(x, y, z, v);
  }

  // called whenever a block changes (world.onBlockChanged)
  neighborChanged(x, y, z) {
    const w = this.world;
    for (let d = 0; d < 7; d++) {
      const D = d < 6 ? DIRS[d] : [0, 0, 0];
      const nx = x + D[0], ny = y + D[1], nz = z + D[2];
      if (ny < 0 || ny >= WH) continue;
      const v = w.getBlock(nx, ny, nz);
      const id = v & 1023;
      if (!id) continue;
      const b = BLOCKS[id];
      if (b.liquid) this.schedule(nx, ny, nz, id === B.water ? 5 : 30);
      else if (b.gravity) this.schedule(nx, ny, nz, 2);
      else this.checkSupport(nx, ny, nz, v);
    }
    // fluids next to a removed block may flow into it
    for (const D of DIRS) {
      const id = w.getId(x + D[0], y + D[1], z + D[2]);
      if (LIQUID[id]) this.schedule(x + D[0], y + D[1], z + D[2], id === B.water ? 5 : 30);
    }
  }

  // ---------------------------------------------------------------- support rules
  checkSupport(x, y, z, v) {
    const w = this.world, id = v & 1023, meta = v >>> 10, b = BLOCKS[id];
    const below = w.getId(x, y - 1, z);
    let ok = true;
    if (b.plant) {
      if (id === B.cactus) {
        ok = (below === B.sand || below === B.red_sand || below === B.cactus);
        for (const [dx, dz] of H4) if (BLOCKS[w.getId(x + dx, y, z + dz)].solid) ok = false;
      } else if (id === B.sugar_cane) {
        if (below !== B.sugar_cane) {
          ok = SOIL.has(below) || below === B.sand || below === B.red_sand;
          if (ok) { ok = false; for (const [dx, dz] of H4) if (w.getId(x + dx, y - 1, z + dz) === B.water) ok = true; }
        }
      } else if (id === B.wheat || id === B.carrots || id === B.potatoes) ok = below === B.farmland;
      else if (id === B.brown_mushroom || id === B.red_mushroom) ok = BLOCKS[below].opaque;
      else if (id === B.dead_bush) ok = below === B.sand || below === B.red_sand || SOIL.has(below);
      else ok = SOIL.has(below);
    } else if (id === B.torch) {
      if (meta === 0) ok = BLOCKS[below].solid && below !== B.glass ? true : BLOCKS[below].render === R.FENCE;
      else { const f = meta - 1; const back = [[0, -1], [1, 0], [0, 1], [-1, 0]][f]; ok = OPAQUE[w.getId(x + back[0], y, z + back[1])] === 1; }
    } else if (id === B.ladder) {
      const back = [[0, -1], [1, 0], [0, 1], [-1, 0]][meta & 3];
      ok = OPAQUE[w.getId(x + back[0], y, z + back[1])] === 1;
    } else if (id === B.oak_door) {
      if (meta & 4) ok = w.getId(x, y - 1, z) === B.oak_door;
      else ok = w.getId(x, y + 1, z) === B.oak_door && BLOCKS[below].solid;
    } else if (id === B.red_bed) {
      const f = meta & 3, head = meta & 4;
      const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][f];
      const ox = head ? x - dx : x + dx, oz = head ? z - dz : z + dz;
      ok = w.getId(ox, y, oz) === B.red_bed;
    } else if (id === B.snow) ok = BLOCKS[below].solid && below !== B.ice && below !== B.packed_ice;
    else if (id === B.lily_pad) ok = below === B.water || below === B.ice;
    else if (id === B.vine) {
      ok = w.getId(x, y + 1, z) === B.vine;
      const sides = [[1, 0, 1], [-1, 0, 2], [0, 1, 4], [0, -1, 8]];
      for (const [dx, dz, bit] of sides) if ((meta & bit) && OPAQUE[w.getId(x + dx, y, z + dz)]) ok = true;
      if (OPAQUE[w.getId(x, y + 1, z)]) ok = true;
    } else if (id === B.farmland) {
      if (BLOCKS[w.getId(x, y + 1, z)].solid) { w.setBlock(x, y, z, B.dirt); return; }
    } else if (id === B.cake) ok = BLOCKS[below].solid;
    if (!ok) this.game.breakBlockNaturally(x, y, z, id !== B.snow);
  }

  gravityCheck(x, y, z, v) {
    const w = this.world;
    const below = w.getId(x, y - 1, z);
    if (y > 0 && (below === 0 || BLOCKS[below].liquid || (BLOCKS[below].replaceable && !BLOCKS[below].solid))) {
      w.setBlock(x, y, z, 0);
      this.game.spawnFalling(x, y, z, v);
    }
  }

  // ---------------------------------------------------------------- fluids
  fluidTick(x, y, z, id, meta) {
    const w = this.world;
    const water = id === B.water;
    const drop = water ? 1 : 2;
    let level = meta & 7, falling = (meta & 8) !== 0;
    const isSource = level === 0 && !falling;
    const lvlOf = (v) => ((v & 1023) === id ? ((v >>> 10) & 8 ? 0 : (v >>> 10) & 7) : -1);
    if (!isSource) {
      // recompute from neighbours
      let newLevel = 99, newFalling = false;
      const above = w.getBlock(x, y + 1, z);
      if ((above & 1023) === id) { newLevel = 0; newFalling = true; }
      let sources = 0;
      for (const [dx, dz] of H4) {
        const nv = w.getBlock(x + dx, y, z + dz);
        const l = lvlOf(nv);
        if (l < 0) continue;
        if (l === 0 && !(((nv >>> 10) & 8))) sources++;
        if (!newFalling) newLevel = Math.min(newLevel, l + drop);
      }
      // infinite water source
      if (water && sources >= 2) {
        const below = w.getBlock(x, y - 1, z);
        if (BLOCKS[below & 1023].solid || ((below & 1023) === B.water && ((below >>> 10) & 7) === 0)) { newLevel = 0; newFalling = false; }
      }
      if (newLevel > 7) { w.setBlock(x, y, z, 0); return; }
      const nm = (newFalling ? 8 : 0) | newLevel;
      if (nm !== meta) {
        w.setBlock(x, y, z, id | (nm << 10));
        level = newLevel; falling = newFalling;
        if (!(newLevel === 0 && !newFalling)) { /* keep flowing */ }
      }
    }
    // lava next to water
    if (!water && this.lavaMeetsWater(x, y, z, level === 0 && !falling)) return;
    // flow down
    const belowV = w.getBlock(x, y - 1, z);
    const bid = belowV & 1023;
    if (y > 0 && this.canFlowInto(bid, id)) {
      if (LIQUID[bid] && bid !== id) {
        // lava flowing onto water -> stone, water onto lava -> obsidian/cobble
        if (water) w.setBlock(x, y - 1, z, ((belowV >>> 10) & 7) === 0 ? B.obsidian : B.cobblestone);
        else w.setBlock(x, y - 1, z, B.stone);
        this.game.sound.play('fire.extinguish', x, y, z, 0.5);
        return;
      }
      if (bid !== id) this.replaceWithFluid(x, y - 1, z, id, 8);
      else if (((belowV >>> 10) & 8) === 0 && ((belowV >>> 10) & 7) !== 0) w.setBlock(x, y - 1, z, id | (8 << 10));
      this.schedule(x, y - 1, z, water ? 5 : 30);
      if (!(level === 0 && !falling)) return;
    }
    // spread sideways
    const next = falling ? drop : level + drop;
    if (next > 7) return;
    // can't spread sideways while resting on fluid of the same type (unless source)
    if (bid === id && !(level === 0 && !falling)) return;
    const dirs = this.flowDirs(x, y, z, id);
    for (const [dx, dz] of dirs) {
      const nx = x + dx, nz = z + dz;
      const nv = w.getBlock(nx, y, nz);
      const nid = nv & 1023;
      if (nid === id) {
        const nl = (nv >>> 10) & 7, nf = (nv >>> 10) & 8;
        if (!nf && nl > next) { w.setBlock(nx, y, nz, id | (next << 10)); this.schedule(nx, y, nz, water ? 5 : 30); }
        continue;
      }
      if (LIQUID[nid]) {
        if (!water) this.lavaMeetsWater(x, y, z, level === 0);
        else w.setBlock(nx, y, nz, ((nv >>> 10) & 7) === 0 ? B.obsidian : B.cobblestone);
        continue;
      }
      if (!this.canFlowInto(nid, id)) continue;
      this.replaceWithFluid(nx, y, nz, id, next);
      this.schedule(nx, y, nz, water ? 5 : 30);
    }
  }

  canFlowInto(nid, id) {
    if (nid === 0) return true;
    const b = BLOCKS[nid];
    if (b.liquid) return true;
    if (b.solid && nid !== B.snow) return false;
    if (nid === B.oak_door || nid === B.ladder) return false;
    return b.replaceable || b.plant || nid === B.torch || nid === B.snow || nid === B.cobweb || nid === B.vine;
  }

  replaceWithFluid(x, y, z, id, meta) {
    const w = this.world;
    const old = w.getId(x, y, z);
    if (old && !LIQUID[old]) {
      if (old === B.torch && id === B.lava) this.game.sound.play('fire.extinguish', x, y, z, 0.3);
      this.game.breakBlockNaturally(x, y, z, true, true);
    }
    w.setBlock(x, y, z, id | (meta << 10));
  }

  // prefer directions that lead toward a drop within 4 blocks (like vanilla)
  flowDirs(x, y, z, id) {
    const w = this.world;
    let best = 99;
    const res = [];
    for (const [dx, dz] of H4) {
      const nid = w.getId(x + dx, y, z + dz);
      if (!this.canFlowInto(nid, id) || (nid === id && (w.getBlock(x + dx, y, z + dz) >>> 10) === 0)) { res.push([dx, dz, 98]); continue; }
      let dist = 99;
      // BFS up to 4 blocks looking for a hole
      const seen = new Set();
      let frontier = [[x + dx, z + dz, 1]];
      while (frontier.length) {
        const nf = [];
        for (const [fx, fz, d] of frontier) {
          const below = w.getId(fx, y - 1, fz);
          if (this.canFlowInto(below, id) && below !== id) { dist = Math.min(dist, d); continue; }
          if (below === id) { dist = Math.min(dist, d); continue; }
          if (d >= 4) continue;
          for (const [ex, ez] of H4) {
            const kx = fx + ex, kz = fz + ez;
            const key = kx * 100003 + kz;
            if (seen.has(key) || (kx === x && kz === z)) continue;
            seen.add(key);
            if (!this.canFlowInto(w.getId(kx, y, kz), id)) continue;
            nf.push([kx, kz, d + 1]);
          }
        }
        frontier = nf;
        if (dist < 99) break;
      }
      res.push([dx, dz, dist]);
      best = Math.min(best, dist);
    }
    return res.filter((r) => r[2] <= best || best >= 98).filter((r) => r[2] !== 98 || best >= 98).map((r) => [r[0], r[1]]);
  }

  lavaMeetsWater(x, y, z, source) {
    const w = this.world;
    for (const D of DIRS) {
      if (D[1] === -1) continue;
      if (w.getId(x + D[0], y + D[1], z + D[2]) === B.water) {
        w.setBlock(x, y, z, source ? B.obsidian : B.cobblestone);
        this.game.sound.play('fire.extinguish', x, y, z, 0.5);
        this.game.particles.smoke(x + 0.5, y + 1, z + 0.5, 6, 0.6, 0.6);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- leaves
  leafDecay(x, y, z, v) {
    if ((v >>> 10) & 1) return; // placed by the player
    const w = this.world;
    // is there a log within 4 steps through leaves?
    const seen = new Set([x + ',' + y + ',' + z]);
    let frontier = [[x, y, z]];
    for (let d = 0; d < 4; d++) {
      const nf = [];
      for (const [fx, fy, fz] of frontier) {
        for (const D of DIRS) {
          const nx = fx + D[0], ny = fy + D[1], nz = fz + D[2];
          const k = nx + ',' + ny + ',' + nz;
          if (seen.has(k)) continue;
          seen.add(k);
          const id = w.getId(nx, ny, nz);
          if (LOGS.has(id)) return;
          if (LEAVES.has(id)) nf.push([nx, ny, nz]);
        }
      }
      frontier = nf;
    }
    this.game.breakBlockNaturally(x, y, z, true);
  }

  // when a log disappears, nearby leaves check if they should decay
  logRemoved(x, y, z) {
    const w = this.world;
    for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
      const id = w.getId(x + dx, y + dy, z + dz);
      if (LEAVES.has(id)) this.schedule(x + dx, y + dy, z + dz, 20 + ((Math.random() * 200) | 0));
    }
  }

  // ---------------------------------------------------------------- random ticks
  randomTicks(px, pz, radius = 6, speed = 3) {
    const w = this.world;
    const pcx = Math.floor(px / 16), pcz = Math.floor(pz / 16);
    for (let cz = pcz - radius; cz <= pcz + radius; cz++) for (let cx = pcx - radius; cx <= pcx + radius; cx++) {
      const c = w.getChunk(cx, cz);
      if (!c || !c.blocks) continue;
      for (let s = 0; s < 8; s++) {
        for (let i = 0; i < speed; i++) {
          const r = (Math.random() * 4096) | 0;
          const lx = r & 15, lz = (r >> 4) & 15, ly = (r >> 8) + s * 16;
          const v = c.blocks[idx(lx, ly, lz)];
          const id = v & 1023;
          if (!id || !RANDOM_TICKED.has(id)) continue;
          this.randomTick(cx * 16 + lx, ly, cz * 16 + lz, id, v >>> 10);
        }
      }
    }
  }

  randomTick(x, y, z, id, meta) {
    const w = this.world, g = this.game;
    const lightAbove = () => {
      const l = w.getLight(x, y + 1, z);
      return Math.max(l & 15, (l >> 4) - g.skyDarken());
    };
    switch (id) {
      case B.grass_block: {
        const above = w.getId(x, y + 1, z);
        if (OPAQUE[above] || BLOCKS[above].liquid) { w.setBlock(x, y, z, B.dirt); return; }
        if (lightAbove() >= 9) {
          for (let i = 0; i < 4; i++) {
            const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 5) | 0) - 3, nz = z + ((Math.random() * 3) | 0) - 1;
            if (w.getId(nx, ny, nz) === B.dirt && !OPAQUE[w.getId(nx, ny + 1, nz)] && !LIQUID[w.getId(nx, ny + 1, nz)] && (w.getLight(nx, ny + 1, nz) >> 4) >= 4) {
              w.setBlock(nx, ny, nz, B.grass_block);
            }
          }
        }
        return;
      }
      case B.wheat: case B.carrots: case B.potatoes: {
        if (meta >= 7 || lightAbove() < 9) return;
        const moist = w.getBlock(x, y - 1, z) >>> 10;
        if (Math.random() < (moist > 0 ? 0.33 : 0.14)) w.setBlock(x, y, z, id | ((meta + 1) << 10));
        return;
      }
      case B.farmland: {
        let wet = false;
        for (let dx = -4; dx <= 4 && !wet; dx++) for (let dz = -4; dz <= 4 && !wet; dz++) for (let dy = 0; dy <= 1; dy++) if (w.getId(x + dx, y + dy, z + dz) === B.water) { wet = true; break; }
        if (wet || g.weather.rain && w.rainY(x, z) <= y) { if (meta !== 7) w.setBlock(x, y, z, B.farmland | (7 << 10)); }
        else if (meta > 0) w.setBlock(x, y, z, B.farmland | ((meta - 1) << 10));
        else if (!BLOCKS[w.getId(x, y + 1, z)].plant) w.setBlock(x, y, z, B.dirt);
        return;
      }
      case B.sugar_cane: case B.cactus: {
        if (w.getId(x, y + 1, z) !== 0) return;
        let h = 1;
        while (w.getId(x, y - h, z) === id) h++;
        if (h >= 3) return;
        if (meta >= 15) { w.setBlock(x, y + 1, z, id); w.setBlock(x, y, z, id); }
        else w.setBlock(x, y, z, id | ((meta + 1) << 10), { noUpdate: true });
        return;
      }
      case B.ice: if ((w.getLight(x, y, z) & 15) > 11 || (w.getLight(x, y + 1, z) & 15) > 11) w.setBlock(x, y, z, B.water); return;
      case B.snow: if ((w.getLight(x, y, z) & 15) > 11) { w.setBlock(x, y, z, 0); } return;
      default:
        if (SAPLINGS.has(id)) {
          if (lightAbove() >= 9 && Math.random() < 0.14) this.growSapling(x, y, z, id);
        } else if (LEAVES.has(id)) {
          if (Math.random() < 0.1) this.leafDecay(x, y, z, w.getBlock(x, y, z));
        }
    }
  }

  growSapling(x, y, z, id) {
    const w = this.world;
    const wood = BLOCKS[id].name.replace('_sapling', '');
    let kind = wood;
    if (wood === 'jungle') kind = 'jungle';
    if (wood === 'dark_oak') {
      // needs 2x2 saplings: find the north-west corner
      let found = null;
      for (const [ox, oz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const ok = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([a, b]) => w.getId(x + ox + a, y, z + oz + b) === id);
        if (ok) { found = [x + ox, z + oz]; break; }
      }
      if (!found) return false;
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) w.setBlock(found[0] + a, y, found[1] + b, 0);
      x = found[0]; z = found[1];
    }
    // check vertical space
    for (let i = 1; i < 6; i++) if (OPAQUE[w.getId(x, y + i, z)]) return false;
    w.setBlock(x, y, z, 0);
    const R2 = rng((Math.random() * 1e9) | 0);
    growTree(kind, (bx, by, bz, v, mode) => {
      const cur = w.getId(bx, by, bz);
      if (mode === 1) { if (cur !== 0 && !BLOCKS[cur].replaceable) return; }
      else if (cur !== 0 && !BLOCKS[cur].replaceable && !LEAVES.has(cur) && !SAPLINGS.has(cur)) return;
      w.setBlock(bx, by, bz, v);
    }, x, y, z, R2);
    if (w.getId(x, y - 1, z) === B.grass_block) w.setBlock(x, y - 1, z, B.dirt);
    return true;
  }

  // bone meal
  fertilize(x, y, z) {
    const w = this.world, g = this.game;
    const v = w.getBlock(x, y, z);
    const id = v & 1023, meta = v >>> 10;
    if (id === B.wheat || id === B.carrots || id === B.potatoes) {
      if (meta >= 7) return false;
      w.setBlock(x, y, z, id | (Math.min(7, meta + 2 + ((Math.random() * 3) | 0)) << 10));
      g.particles.bonemeal(x, y, z);
      return true;
    }
    if (SAPLINGS.has(id)) {
      g.particles.bonemeal(x, y, z);
      if (Math.random() < 0.45) this.growSapling(x, y, z, id);
      return true;
    }
    if (id === B.grass_block) {
      for (let i = 0; i < 40; i++) {
        const nx = x + ((Math.random() * 7) | 0) - 3, nz = z + ((Math.random() * 7) | 0) - 3;
        for (let dy = 1; dy >= -1; dy--) {
          if (w.getId(nx, y + dy, nz) === B.grass_block && w.getId(nx, y + dy + 1, nz) === 0) {
            const r = Math.random();
            w.setBlock(nx, y + dy + 1, nz, r < 0.8 ? B.short_grass : r < 0.9 ? B.dandelion : B.poppy);
            break;
          }
        }
      }
      g.particles.bonemeal(x - 2, y + 1, z - 2, 20);
      return true;
    }
    if (id === B.sugar_cane || id === B.cactus) return false;
    return false;
  }
}

const RANDOM_TICKED = new Set();
setTimeout(() => {}, 0);
export function initRandomTicked() {
  for (const n of ['grass_block', 'wheat', 'carrots', 'potatoes', 'farmland', 'sugar_cane', 'cactus', 'ice', 'snow']) RANDOM_TICKED.add(B[n]);
  for (const w of WOODS) { RANDOM_TICKED.add(B[w + '_sapling']); RANDOM_TICKED.add(B[w + '_leaves']); }
}
initRandomTicked();
