// Axis-aligned box collision against the voxel world, Minecraft style (y, then x, then z).
import { BLOCKS, B, R } from '../shared/blocks.js';
import { collisionBoxes, fenceConn } from '../shared/shapes.js';

const boxes = []; // scratch: flat list x0,y0,z0,x1,y1,z1

// collect collision boxes of blocks overlapping the region
export function gatherBoxes(world, minX, minY, minZ, maxX, maxY, maxZ) {
  boxes.length = 0;
  const x0 = Math.floor(minX), y0 = Math.floor(minY) - 1, z0 = Math.floor(minZ);
  const x1 = Math.floor(maxX), y1 = Math.floor(maxY), z1 = Math.floor(maxZ);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    if (!world.isLoaded(x, z)) {
      // unloaded chunks are solid walls so nothing falls out of the world
      boxes.push(x, y0, z, x + 1, y1 + 1, z + 1);
      continue;
    }
    for (let y = y0; y <= y1; y++) {
      const v = world.getBlock(x, y, z);
      const id = v & 1023;
      if (!id) continue;
      const b = BLOCKS[id];
      if (!b.solid) continue;
      let conn = 0;
      if (b.render === R.FENCE) conn = fenceConn((dx, dz) => world.getId(x + dx, y, z + dz));
      const list = collisionBoxes(id, v >>> 10, conn);
      for (const c of list) boxes.push(x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]);
    }
  }
  return boxes;
}

// clip motion d along axis (0 x, 1 y, 2 z) for box a against list
function clip(list, a, axis, d) {
  const o1 = (axis + 1) % 3, o2 = (axis + 2) % 3;
  for (let i = 0; i < list.length; i += 6) {
    // overlap on the other two axes?
    if (list[i + o1 + 3] <= a[o1] + 1e-7 || list[i + o1] >= a[o1 + 3] - 1e-7) continue;
    if (list[i + o2 + 3] <= a[o2] + 1e-7 || list[i + o2] >= a[o2 + 3] - 1e-7) continue;
    if (d > 0 && list[i + axis] >= a[axis + 3] - 1e-7) {
      const m = list[i + axis] - a[axis + 3];
      if (m < d) d = m;
    } else if (d < 0 && list[i + axis + 3] <= a[axis] + 1e-7) {
      const m = list[i + axis + 3] - a[axis];
      if (m > d) d = m;
    }
  }
  return d;
}

// e: { x, y, z (feet centre), w (width), h (height), vx, vy, vz }
// moves e by (dx,dy,dz) resolving collisions. Sets e.onGround, e.hitH, e.hitV. Returns actual motion.
export function moveBox(world, e, dx, dy, dz, stepHeight = 0, sneakEdge = false) {
  const hw = e.w / 2;
  const a = [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.h, e.z + hw];
  // sneaking: don't walk off edges
  if (sneakEdge && e.onGround) {
    const step = 0.05;
    const hasGround = (ox, oz) => {
      const l = gatherBoxes(world, a[0] + ox, a[1] - 1, a[2] + oz, a[3] + ox, a[1], a[5] + oz);
      const b2 = [a[0] + ox, a[1] - 0.6, a[2] + oz, a[3] + ox, a[1], a[5] + oz];
      for (let i = 0; i < l.length; i += 6) {
        if (l[i] < b2[3] && l[i + 3] > b2[0] && l[i + 1] < b2[4] && l[i + 4] > b2[1] && l[i + 2] < b2[5] && l[i + 5] > b2[2]) return true;
      }
      return false;
    };
    while (dx !== 0 && !hasGround(dx, 0)) { if (Math.abs(dx) < step) dx = 0; else dx -= step * Math.sign(dx); }
    while (dz !== 0 && !hasGround(0, dz)) { if (Math.abs(dz) < step) dz = 0; else dz -= step * Math.sign(dz); }
    while (dx !== 0 && dz !== 0 && !hasGround(dx, dz)) {
      if (Math.abs(dx) < step) dx = 0; else dx -= step * Math.sign(dx);
      if (Math.abs(dz) < step) dz = 0; else dz -= step * Math.sign(dz);
    }
  }
  const odx = dx, ody = dy, odz = dz;
  const list = gatherBoxes(world,
    Math.min(a[0], a[0] + dx) - 0.01, Math.min(a[1], a[1] + dy) - 0.01, Math.min(a[2], a[2] + dz) - 0.01,
    Math.max(a[3], a[3] + dx) + 0.01, Math.max(a[4], a[4] + dy) + 0.01 + stepHeight, Math.max(a[5], a[5] + dz) + 0.01);
  const start = a.slice();
  dy = clip(list, a, 1, dy); a[1] += dy; a[4] += dy;
  dx = clip(list, a, 0, dx); a[0] += dx; a[3] += dx;
  dz = clip(list, a, 2, dz); a[2] += dz; a[5] += dz;
  let onGround = ody < 0 && dy !== ody;
  // step up small ledges (slabs, stairs, full blocks for mobs with 1.0)
  if (stepHeight > 0 && (onGround || e.onGround) && (dx !== odx || dz !== odz)) {
    const b = start.slice();
    let sy = clip(list, b, 1, stepHeight); b[1] += sy; b[4] += sy;
    let sx = clip(list, b, 0, odx); b[0] += sx; b[3] += sx;
    let sz = clip(list, b, 2, odz); b[2] += sz; b[5] += sz;
    const down = clip(list, b, 1, -sy + (ody < 0 ? ody : 0)); b[1] += down; b[4] += down;
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-6) {
      for (let i = 0; i < 6; i++) a[i] = b[i];
      dx = sx; dz = sz; dy = b[1] - start[1];
      onGround = true;
    }
  }
  e.hitH = dx !== odx || dz !== odz;
  e.hitV = dy !== ody;
  e.hitX = dx !== odx; e.hitZ = dz !== odz;
  e.onGround = onGround;
  e.x = (a[0] + a[3]) / 2;
  e.y = a[1];
  e.z = (a[2] + a[5]) / 2;
  return [dx, dy, dz];
}

// does the box intersect any solid block?
export function boxBlocked(world, x0, y0, z0, x1, y1, z1) {
  const l = gatherBoxes(world, x0, y0, z0, x1, y1, z1);
  for (let i = 0; i < l.length; i += 6) {
    if (l[i] < x1 && l[i + 3] > x0 && l[i + 1] < y1 && l[i + 4] > y0 && l[i + 2] < z1 && l[i + 5] > z0) return true;
  }
  return false;
}

// fluid / special block contact for an entity box
export function contacts(world, x, y, z, w, h) {
  const hw = w / 2;
  const r = { water: false, lava: false, ladder: false, web: false, waterTop: -1, headWater: false, cactus: false, fire: false };
  const x0 = Math.floor(x - hw + 0.001), x1 = Math.floor(x + hw - 0.001);
  const z0 = Math.floor(z - hw + 0.001), z1 = Math.floor(z + hw - 0.001);
  const y0 = Math.floor(y + 0.001), y1 = Math.floor(y + h - 0.001);
  for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) for (let by = y0; by <= y1; by++) {
    const v = world.getBlock(bx, by, bz);
    const id = v & 1023;
    if (!id) continue;
    const b = BLOCKS[id];
    if (b.name === 'water') {
      const lvl = (v >>> 10) & 7;
      const top = by + (world.getId(bx, by + 1, bz) === id ? 1 : (lvl === 0 ? 0.89 : (8 - lvl) / 9));
      if (y < top) { r.water = true; r.waterTop = Math.max(r.waterTop, top); }
    } else if (b.name === 'lava') r.lava = true;
    else if (b.climbable) r.ladder = true;
    else if (b.name === 'cobweb') r.web = true;
  }
  // cactus touches from the side
  for (let bx = Math.floor(x - hw - 0.05); bx <= Math.floor(x + hw + 0.05); bx++)
    for (let bz = Math.floor(z - hw - 0.05); bz <= Math.floor(z + hw + 0.05); bz++)
      for (let by = y0; by <= y1; by++) if (world.getId(bx, by, bz) === B.cactus) r.cactus = true;
  return r;
}
