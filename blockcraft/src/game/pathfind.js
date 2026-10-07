// Small A* over walkable voxel cells for mobs.
import { BLOCKS, B } from '../shared/blocks.js';

const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

function passable(world, x, y, z) {
  const id = world.getId(x, y, z);
  if (!id) return true;
  const b = BLOCKS[id];
  if (id === B.lava || id === B.cactus || id === B.cobweb) return false;
  return !b.solid;
}
function standable(world, x, y, z, h, canSwim) {
  if (!world.isLoaded(x, z)) return false;
  for (let i = 0; i < h; i++) if (!passable(world, x, y + i, z)) return false;
  const below = world.getId(x, y - 1, z);
  if (below === B.lava || below === B.cactus) return false;
  if (BLOCKS[below].solid) return true;
  if (canSwim && (world.getId(x, y, z) === B.water || below === B.water)) return true;
  return false;
}

class Heap {
  constructor() { this.a = []; }
  push(n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

// returns list of [x,y,z] cell centres (feet) from start to goal, or null
export function findPath(world, sx, sy, sz, gx, gy, gz, opts = {}) {
  const h = opts.height || 2;
  const maxNodes = opts.maxNodes || 400;
  const maxDrop = opts.maxDrop ?? 3;
  const canSwim = opts.swim !== false;
  const key = (x, y, z) => ((x + 4096) * 8192 + (z + 4096)) * 256 + y;
  const start = { x: sx, y: sy, z: sz, g: 0, f: 0, p: null };
  const heur = (x, y, z) => Math.abs(x - gx) + Math.abs(z - gz) + Math.abs(y - gy) * 0.5;
  start.f = heur(sx, sy, sz);
  const open = new Heap();
  open.push(start);
  const seen = new Map();
  seen.set(key(sx, sy, sz), start);
  let best = start, bestH = start.f;
  let n = 0;
  while (open.size && n < maxNodes) {
    const cur = open.pop();
    if (cur.closed) continue;
    cur.closed = true;
    n++;
    const hh = heur(cur.x, cur.y, cur.z);
    if (hh < bestH) { bestH = hh; best = cur; }
    if (Math.abs(cur.x - gx) <= (opts.reach || 0) && Math.abs(cur.z - gz) <= (opts.reach || 0) && Math.abs(cur.y - gy) <= 1) { best = cur; break; }
    for (let d = 0; d < 8; d++) {
      const [dx, dz] = DIRS8[d];
      const nx = cur.x + dx, nz = cur.z + dz;
      if (d >= 4) {
        // no corner cutting
        if (!passable(world, cur.x + dx, cur.y, cur.z) || !passable(world, cur.x, cur.y, cur.z + dz)) continue;
        if (h > 1 && (!passable(world, cur.x + dx, cur.y + 1, cur.z) || !passable(world, cur.x, cur.y + 1, cur.z + dz))) continue;
      }
      let ny = null;
      if (standable(world, nx, cur.y, nz, h, canSwim)) ny = cur.y;
      else if (standable(world, nx, cur.y + 1, nz, h, canSwim) && passable(world, cur.x, cur.y + h, cur.z)) ny = cur.y + 1;
      else {
        for (let k = 1; k <= maxDrop; k++) {
          if (!passable(world, nx, cur.y - k + h, nz) && k > 1) break;
          if (standable(world, nx, cur.y - k, nz, h, canSwim)) { ny = cur.y - k; break; }
        }
      }
      if (ny === null) continue;
      const k = key(nx, ny, nz);
      const cost = (d >= 4 ? 1.414 : 1) + (ny > cur.y ? 0.6 : ny < cur.y ? 0.3 : 0) + (world.getId(nx, ny, nz) === B.water ? 1.5 : 0);
      const g = cur.g + cost;
      let node = seen.get(k);
      if (node && (node.closed || node.g <= g)) continue;
      if (!node) { node = { x: nx, y: ny, z: nz, g, f: 0, p: cur }; seen.set(k, node); }
      node.g = g; node.p = cur;
      node.f = g + heur(nx, ny, nz) * 1.1;
      open.push(node);
    }
  }
  if (best === start) return null;
  const path = [];
  for (let c = best; c && c !== start; c = c.p) path.push([c.x + 0.5, c.y, c.z + 0.5]);
  path.reverse();
  return path;
}
