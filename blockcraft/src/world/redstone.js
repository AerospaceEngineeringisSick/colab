// Redstone: signal strength, dust networks and component behaviour (vanilla rules, simplified where noted).
//
// Sources emit straight into neighbours. A solid block becomes "strongly" powered by a torch under it, a lever or
// button on it, a plate on it or a repeater pointing into it; dust running into or over it powers it "weakly".
// Components (lamps, torches, repeaters, doors, TNT, pistons, powered rails) read either kind; dust only reads
// strongly powered blocks, so signals don't leak backwards through blocks into other dust.
import { BLOCKS, B, OPAQUE } from '../shared/blocks.js';
import { FACING_DIR, wireLinks } from '../shared/shapes.js';
import { WH } from '../shared/constants.js';
import { isRail, railShape, RAIL_EXITS } from '../game/vehicles.js';

const D6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]; // +x -x +y -y +z -z
const UP = 2, DOWN = 3;
const opp = (d) => d ^ 1;
const FACING_D = [4, 1, 5, 0]; // facing (0 south, 1 west, 2 north, 3 east) -> D6 index
const PISTON_D = [3, 2, 5, 4, 1, 0]; // piston facing (down, up, north, south, west, east) -> D6 index
const key = (x, y, z) => `${x},${y},${z}`;

const kindOf = (v) => BLOCKS[v & 1023].redstone;
const isSolid = (v) => OPAQUE[v & 1023] === 1 && !BLOCKS[v & 1023].redstone;

// side a torch / lever / button hangs on (D6 index from the component to its support)
function attachDir(v) {
  const a = (v >>> 10) & 7;
  return a === 0 ? DOWN : opp(FACING_D[(a - 1) & 3]);
}

export class Redstone {
  constructor(game) {
    this.game = game;
    this.pending = new Set();
    this.plates = new Map(); // key -> ticks left pressed
    this.detectors = new Map(); // key -> ticks left on
  }
  get world() { return this.game.world; }
  get(x, y, z) { return y < 0 || y >= WH ? 0 : this.world.getBlock(x, y, z); }

  // ---------------------------------------------------------------- signal queries
  // power the block at (x,y,z) emits into its neighbour in direction d (D6 index)
  emits(x, y, z, d) {
    const v = this.get(x, y, z), k = kindOf(v), meta = v >>> 10;
    switch (k) {
      case 'block': return 15;
      case 'torch': return (v & 1023) === B.redstone_torch && d !== attachDir(v) ? 15 : 0;
      case 'lever': case 'button': return meta & 8 ? 15 : 0;
      case 'plate': return meta & 1 ? 15 : 0;
      case 'drail': return meta & 8 ? 15 : 0;
      case 'repeater': return meta & 16 && d === FACING_D[meta & 3] ? 15 : 0;
      case 'wire': return this.wirePoints(x, y, z, d) ? meta & 15 : 0;
    }
    return 0;
  }
  // does dust at (x,y,z) push its signal in direction d?
  wirePoints(x, y, z, d) {
    if (d === DOWN) return true;
    if (d === UP) return false;
    const c = this.wireSides(x, y, z);
    if (!c.n) return true; // a lone dot powers every side
    const [dx, , dz] = D6[d];
    const k = dx === 1 ? 'e' : dx === -1 ? 'w' : dz === 1 ? 's' : 'n';
    if (c[k]) return true;
    // a line with one end also runs out of the far side
    if (c.n === 1) return (k === 'e' && c.w) || (k === 'w' && c.e) || (k === 's' && c.nn) || (k === 'n' && c.s);
    return false;
  }
  wireSides(x, y, z) {
    const r = { e: false, w: false, s: false, nn: false, n: 0 };
    const above = !OPAQUE[this.get(x, y + 1, z) & 1023];
    for (const [dx, dz, k] of [[1, 0, 'e'], [-1, 0, 'w'], [0, 1, 's'], [0, -1, 'nn']]) {
      const side = this.get(x + dx, y, z + dz);
      const link = wireLinks(side, dx, dz)
        || (!OPAQUE[side & 1023] && (this.get(x + dx, y - 1, z + dz) & 1023) === B.redstone_wire)
        || (above && OPAQUE[side & 1023] && (this.get(x + dx, y + 1, z + dz) & 1023) === B.redstone_wire);
      if (link) { r[k] = true; r.n++; }
    }
    return r;
  }
  // strongest power pushed straight into a solid block from its neighbours (excluding dust)
  strongInto(x, y, z) {
    let p = 0;
    for (let d = 0; d < 6; d++) {
      const [dx, dy, dz] = D6[d];
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const v = this.get(nx, ny, nz), k = kindOf(v), meta = v >>> 10;
      const back = opp(d); // from the neighbour toward this block
      if (k === 'torch' && (v & 1023) === B.redstone_torch && d === DOWN && attachDir(v) !== UP) p = 15;
      else if ((k === 'lever' || k === 'button') && meta & 8 && attachDir(v) === back) p = 15;
      else if (k === 'plate' && meta & 1 && d === UP) p = 15;
      else if (k === 'drail' && meta & 8 && d === UP) p = 15;
      else if (k === 'repeater' && meta & 16 && FACING_D[meta & 3] === back) p = 15;
      if (p === 15) return 15;
    }
    return p;
  }
  // dust running into or across a solid block
  weakInto(x, y, z) {
    let p = 0;
    for (let d = 0; d < 6; d++) {
      if (d === DOWN) continue;
      const [dx, dy, dz] = D6[d];
      const v = this.get(x + dx, y + dy, z + dz);
      if ((v & 1023) !== B.redstone_wire) continue;
      if (this.wirePoints(x + dx, y + dy, z + dz, opp(d))) p = Math.max(p, (v >>> 10) & 15);
    }
    return p;
  }
  // signal reaching a component at (x,y,z), optionally ignoring one side
  input(x, y, z, skip = -1) {
    let p = 0;
    for (let d = 0; d < 6 && p < 15; d++) {
      if (d === skip) continue;
      const [dx, dy, dz] = D6[d];
      const nx = x + dx, ny = y + dy, nz = z + dz;
      p = Math.max(p, this.inputFrom(nx, ny, nz, opp(d)));
    }
    return p;
  }
  // signal coming out of the block at n toward direction d (a component on that side)
  inputFrom(nx, ny, nz, d) {
    const v = this.get(nx, ny, nz);
    if (kindOf(v)) return this.emits(nx, ny, nz, d);
    if (isSolid(v)) return Math.max(this.strongInto(nx, ny, nz), this.weakInto(nx, ny, nz));
    return 0;
  }

  // ---------------------------------------------------------------- updates
  // something changed at (x,y,z): queue redstone things nearby
  changed(x, y, z) {
    for (let dy = -2; dy <= 2; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= WH) continue;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 3) continue;
        if (kindOf(this.get(x + dx, yy, z + dz))) this.pending.add(key(x + dx, yy, z + dz));
      }
    }
  }

  // run queued updates until things settle (called every tick)
  flush() {
    for (let round = 0; round < 32 && this.pending.size; round++) {
      const list = [...this.pending];
      this.pending.clear();
      const done = new Set();
      for (const k of list) {
        if (done.has(k)) continue;
        const [x, y, z] = k.split(',').map(Number);
        const v = this.get(x, y, z);
        const kind = kindOf(v);
        if (kind === 'wire') for (const n of this.updateWire(x, y, z)) done.add(n);
        else if (kind) this.updateComponent(x, y, z, v, kind);
      }
    }
  }

  // per tick: pressure plates and detector rails watch for things on them
  tick() {
    const occupied = new Set();
    const touch = (e, w, h) => {
      const x0 = Math.floor(e.x - w / 2), x1 = Math.floor(e.x + w / 2), z0 = Math.floor(e.z - w / 2), z1 = Math.floor(e.z + w / 2);
      const y = Math.floor(e.y + 0.01);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) occupied.add(key(x, y, z));
    };
    const p = this.game.player;
    if (!p.dead && p.mode !== 'spectator') touch(p, 0.6, 1.8);
    for (const e of this.game.entities.list) if (!e.removed && !e.dead) touch(e, e.w || 0.25, e.h || 0.25);
    const w = this.world;
    for (const k of occupied) {
      const [x, y, z] = k.split(',').map(Number);
      const v = this.get(x, y, z), kind = kindOf(v);
      if (kind === 'plate') {
        this.plates.set(k, 20);
        if (!((v >>> 10) & 1)) { w.setBlock(x, y, z, (v & 1023) | (1 << 10)); this.click(x, y, z, 0.6); }
      } else if (kind === 'drail') {
        const isCart = this.game.entities.list.some((e) => e.type === 'minecart' && !e.removed && Math.floor(e.x) === x && Math.floor(e.z) === z && Math.abs(Math.floor(e.y + 0.01) - y) <= 1);
        if (isCart) {
          this.detectors.set(k, 20);
          if (!((v >>> 10) & 8)) w.setBlock(x, y, z, v | (8 << 10));
        }
      }
    }
    for (const [map, bit] of [[this.plates, 1], [this.detectors, 8]]) {
      for (const [k, t] of map) {
        if (occupied.has(k)) continue;
        if (t > 1) { map.set(k, t - 1); continue; }
        map.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        const v = this.get(x, y, z);
        if ((v >>> 10) & bit) {
          w.setBlock(x, y, z, v & ~(bit << 10));
          if (bit === 1) this.click(x, y, z, 0.5);
        }
      }
    }
    this.flush();
  }

  click(x, y, z, pitch) { this.game.sound.play('button.click', x + 0.5, y + 0.5, z + 0.5, 0.3, pitch); }

  // ---------------------------------------------------------------- dust
  // recompute a whole connected dust network; returns the keys visited
  updateWire(sx, sy, sz) {
    const net = new Map();
    const queue = [[sx, sy, sz]];
    net.set(key(sx, sy, sz), [sx, sy, sz]);
    while (queue.length && net.size < 4096) {
      const [x, y, z] = queue.pop();
      for (const [nx, ny, nz] of this.wireNeighbours(x, y, z)) {
        const k = key(nx, ny, nz);
        if (!net.has(k)) { net.set(k, [nx, ny, nz]); queue.push([nx, ny, nz]); }
      }
    }
    // outside input for every piece of dust, then let the strongest spread, losing one per step
    const level = new Map();
    const buckets = Array.from({ length: 16 }, () => []);
    for (const [k, [x, y, z]] of net) {
      let p = 0;
      for (let d = 0; d < 6 && p < 15; d++) {
        const [dx, dy, dz] = D6[d];
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const v = this.get(nx, ny, nz), kind = kindOf(v);
        if (kind === 'wire') continue;
        if (kind) p = Math.max(p, this.emits(nx, ny, nz, opp(d)));
        else if (isSolid(v)) p = Math.max(p, this.strongInto(nx, ny, nz));
      }
      level.set(k, p);
      if (p > 0) buckets[p].push(k);
    }
    for (let p = 15; p > 1; p--) {
      for (const k of buckets[p]) {
        if (level.get(k) !== p) continue;
        const [x, y, z] = net.get(k);
        for (const [nx, ny, nz] of this.wireNeighbours(x, y, z)) {
          const nk = key(nx, ny, nz);
          if ((level.get(nk) ?? 0) < p - 1) { level.set(nk, p - 1); buckets[p - 1].push(nk); }
        }
      }
    }
    // write back, and wake whatever the changed dust feeds
    const w = this.world;
    for (const [k, [x, y, z]] of net) {
      const v = this.get(x, y, z);
      const p = level.get(k) || 0;
      if (((v >>> 10) & 15) === p) continue;
      w.setBlock(x, y, z, B.redstone_wire | (p << 10), { noUpdate: true });
      this.wakeAround(x, y, z, net);
    }
    return net.keys();
  }
  // dust connected to this dust (same level, stepping up or down a block)
  wireNeighbours(x, y, z) {
    const out = [];
    const aboveOpen = !OPAQUE[this.get(x, y + 1, z) & 1023];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      const side = this.get(nx, y, nz);
      if ((side & 1023) === B.redstone_wire) out.push([nx, y, nz]);
      else if (!OPAQUE[side & 1023] && (this.get(nx, y - 1, nz) & 1023) === B.redstone_wire) out.push([nx, y - 1, nz]);
      else if (aboveOpen && OPAQUE[side & 1023] && (this.get(nx, y + 1, nz) & 1023) === B.redstone_wire) out.push([nx, y + 1, nz]);
    }
    return out;
  }
  // queue non-dust components within reach of a changed piece of dust
  wakeAround(x, y, z, skip) {
    for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
      const k = key(x + dx, y + dy, z + dz);
      if (skip.has(k)) continue;
      const kind = kindOf(this.get(x + dx, y + dy, z + dz));
      if (kind) this.pending.add(k);
    }
  }

  // ---------------------------------------------------------------- components
  updateComponent(x, y, z, v, kind) {
    const w = this.world, id = v & 1023, meta = v >>> 10;
    const ticks = this.game.ticks;
    switch (kind) {
      case 'torch': {
        // a torch goes out when the block it hangs on is powered (after a short delay)
        const a = attachDir(v);
        const [dx, dy, dz] = D6[a];
        const bv = this.get(x + dx, y + dy, z + dz);
        const powered = isSolid(bv) && Math.max(this.strongInto(x + dx, y + dy, z + dz), this.weakInto(x + dx, y + dy, z + dz)) > 0;
        if (powered === (id === B.redstone_torch)) ticks.schedule(x, y, z, 2);
        break;
      }
      case 'lamp': {
        const on = this.input(x, y, z) > 0;
        if (on && id === B.redstone_lamp) w.setBlock(x, y, z, B.lit_redstone_lamp);
        else if (!on && id === B.lit_redstone_lamp) ticks.schedule(x, y, z, 4);
        break;
      }
      case 'repeater': {
        const out = FACING_D[meta & 3];
        const [dx, dy, dz] = D6[opp(out)];
        const on = this.inputFrom(x + dx, y + dy, z + dz, out) > 0;
        if (on !== !!(meta & 16)) ticks.schedule(x, y, z, (((meta >> 2) & 3) + 1) * 2);
        break;
      }
      case 'door': {
        // doors follow power changes but can still be opened by hand
        const lower = meta & 4 ? y - 1 : y;
        const lv = this.get(x, lower, z), uv = this.get(x, lower + 1, z);
        if ((lv & 1023) !== B.oak_door) break;
        const on = this.input(x, lower, z) > 0 || this.input(x, lower + 1, z) > 0;
        const was = !!((lv >>> 10) & 16);
        if (on === was) break;
        const open = on ? 8 : 0;
        const lm = ((lv >>> 10) & ~(8 | 16)) | open | (on ? 16 : 0);
        w.setBlock(x, lower, z, B.oak_door | (lm << 10), { noUpdate: true });
        if ((uv & 1023) === B.oak_door) w.setBlock(x, lower + 1, z, B.oak_door | ((((uv >>> 10) & ~(8 | 16)) | open) << 10), { noUpdate: true });
        if (((lv >>> 10) & 8) !== open) this.game.sound.play(on ? 'door.open' : 'door.close', x + 0.5, lower + 0.5, z + 0.5, 0.8);
        break;
      }
      case 'tnt':
        if (this.input(x, y, z) > 0) this.game.igniteTnt(x, y, z);
        break;
      case 'piston': {
        const f = meta & 7, front = PISTON_D[f];
        const on = this.input(x, y, z, front) > 0;
        if (on && !(meta & 8)) this.extend(x, y, z, v);
        else if (!on && meta & 8) this.retract(x, y, z, v);
        break;
      }
      case 'prail': {
        const on = this.railPowered(x, y, z);
        if (on !== !!(meta & 8)) w.setBlock(x, y, z, on ? v | (8 << 10) : v & ~(8 << 10));
        break;
      }
    }
  }

  // delayed state changes (from BlockTicks)
  scheduled(x, y, z, v) {
    const w = this.world, id = v & 1023, meta = v >>> 10;
    const kind = kindOf(v);
    if (kind === 'torch') {
      const a = attachDir(v);
      const [dx, dy, dz] = D6[a];
      const bv = this.get(x + dx, y + dy, z + dz);
      const powered = isSolid(bv) && Math.max(this.strongInto(x + dx, y + dy, z + dz), this.weakInto(x + dx, y + dy, z + dz)) > 0;
      const want = powered ? B.unlit_redstone_torch : B.redstone_torch;
      if (id !== want) w.setBlock(x, y, z, want | (meta << 10));
    } else if (kind === 'lamp') {
      if (id === B.lit_redstone_lamp && this.input(x, y, z) === 0) w.setBlock(x, y, z, B.redstone_lamp);
    } else if (kind === 'repeater') {
      const out = FACING_D[meta & 3];
      const [dx, dy, dz] = D6[opp(out)];
      const on = this.inputFrom(x + dx, y + dy, z + dz, out) > 0;
      if (on !== !!(meta & 16)) w.setBlock(x, y, z, id | ((on ? meta | 16 : meta & ~16) << 10));
    } else if (kind === 'button') {
      if (meta & 8) { w.setBlock(x, y, z, id | ((meta & ~8) << 10)); this.click(x, y, z, 0.5); }
    }
  }

  // ---------------------------------------------------------------- player actions
  toggleLever(x, y, z) {
    const v = this.get(x, y, z);
    this.world.setBlock(x, y, z, v ^ (8 << 10));
    this.click(x, y, z, (v >>> 10) & 8 ? 0.5 : 0.6);
  }
  pressButton(x, y, z) {
    const v = this.get(x, y, z);
    if ((v >>> 10) & 8) return;
    this.world.setBlock(x, y, z, v | (8 << 10));
    this.game.sound.play(BLOCKS[v & 1023].sound === 'wood' ? 'button.wood' : 'button.click', x + 0.5, y + 0.5, z + 0.5, 0.3, 0.6);
    this.game.ticks.schedule(x, y, z, BLOCKS[v & 1023].pressTicks || 20);
  }
  cycleRepeater(x, y, z) {
    const v = this.get(x, y, z), meta = v >>> 10;
    const delay = (((meta >> 2) & 3) + 1) & 3;
    this.world.setBlock(x, y, z, (v & 1023) | (((meta & ~12) | (delay << 2)) << 10));
    this.click(x, y, z, 0.55);
  }

  // ---------------------------------------------------------------- powered rails
  // a powered rail is on when fed directly, or through up to 8 connected powered rails
  railPowered(x, y, z) {
    const seen = new Set([key(x, y, z)]);
    let frontier = [[x, y, z]];
    for (let depth = 0; depth <= 8 && frontier.length; depth++) {
      const next = [];
      for (const [rx, ry, rz] of frontier) {
        if (this.input(rx, ry, rz) > 0) return true;
        const v = this.get(rx, ry, rz);
        for (const e of RAIL_EXITS[railShape(v)] || []) {
          for (const dy of [0, 1, -1]) {
            const nx = rx + e[0], ny = ry + dy, nz = rz + e[2];
            const k = key(nx, ny, nz);
            if (seen.has(k) || (this.get(nx, ny, nz) & 1023) !== B.powered_rail) continue;
            seen.add(k);
            next.push([nx, ny, nz]);
          }
        }
      }
      frontier = next;
    }
    return false;
  }

  // ---------------------------------------------------------------- pistons
  movable(v) {
    const id = v & 1023, b = BLOCKS[id];
    if (!id) return 'air';
    if (b.liquid || !b.solid || b.replaceable) return 'break';
    if (b.hardness < 0 || id === B.obsidian || id === B.spawner || id === B.enchanting_table || id === B.piston_head) return 'stuck';
    if (b.redstone === 'piston' && (v >>> 10) & 8) return 'stuck';
    if (id === B.chest || id === B.furnace || id === B.lit_furnace) return 'stuck'; // blocks holding items stay put
    return 'move';
  }
  extend(x, y, z, v) {
    const w = this.world, meta = v >>> 10;
    const [dx, dy, dz] = D6[PISTON_D[meta & 7]];
    // find the run of blocks to push (at most 12)
    const line = [];
    let cx = x + dx, cy = y + dy, cz = z + dz;
    for (;;) {
      if (cy < 0 || cy >= WH) return;
      const cv = this.get(cx, cy, cz);
      const m = this.movable(cv);
      if (m === 'air' || m === 'break') {
        if (m === 'break') this.game.breakBlockNaturally(cx, cy, cz, true, true);
        break;
      }
      if (m === 'stuck' || line.length >= 12) return;
      line.push([cx, cy, cz, cv]);
      cx += dx; cy += dy; cz += dz;
    }
    // shift from the far end, then place the head
    for (let i = line.length - 1; i >= 0; i--) {
      const [bx, by, bz, bv] = line[i];
      w.setBlock(bx + dx, by + dy, bz + dz, bv);
    }
    w.setBlock(x, y, z, (v & 1023) | ((meta | 8) << 10), { noUpdate: true });
    w.setBlock(x + dx, y + dy, z + dz, B.piston_head | (((meta & 7) | (BLOCKS[v & 1023].sticky ? 8 : 0)) << 10));
    this.pushEntities(line.length ? line.map((l) => [l[0] + dx, l[1] + dy, l[2] + dz]).concat([[x + dx, y + dy, z + dz]]) : [[x + dx, y + dy, z + dz]], dx, dy, dz);
    this.game.sound.play('piston.out', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.8 + Math.random() * 0.2);
  }
  retract(x, y, z, v) {
    const w = this.world, meta = v >>> 10;
    const [dx, dy, dz] = D6[PISTON_D[meta & 7]];
    const hx = x + dx, hy = y + dy, hz = z + dz;
    w.setBlock(x, y, z, (v & 1023) | ((meta & 7) << 10), { noUpdate: true });
    if ((this.get(hx, hy, hz) & 1023) === B.piston_head) w.setBlock(hx, hy, hz, 0);
    // sticky pistons pull the block in front back with them
    if (BLOCKS[v & 1023].sticky) {
      const pv = this.get(hx + dx, hy + dy, hz + dz);
      if (this.movable(pv) === 'move') { w.setBlock(hx + dx, hy + dy, hz + dz, 0); w.setBlock(hx, hy, hz, pv); }
    }
    this.game.sound.play('piston.in', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.7 + Math.random() * 0.15);
  }
  // things standing in moved blocks get shoved along
  pushEntities(cells, dx, dy, dz) {
    const hit = (e, w, h) => cells.some(([cx, cy, cz]) => e.x + w / 2 > cx && e.x - w / 2 < cx + 1 && e.z + w / 2 > cz && e.z - w / 2 < cz + 1 && e.y < cy + 1 && e.y + h > cy);
    const p = this.game.player;
    if (hit(p, 0.6, p.h)) { p.x += dx; p.y += dy; p.z += dz; if (dy > 0) p.vy = Math.max(p.vy, 0); }
    for (const e of this.game.entities.list) if (!e.removed && hit(e, e.w || 0.25, e.h || 0.25)) { e.x += dx; e.y += dy; e.z += dz; }
  }
}
