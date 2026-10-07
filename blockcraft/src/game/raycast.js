// Voxel ray casting against block selection shapes (Amanatides & Woo traversal).
import { BLOCKS, R } from '../shared/blocks.js';
import { selectionBoxes, fenceConn } from '../shared/shapes.js';

// ray vs box (slab method). returns [t, face] or null
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b[a] || o[a] > b[a + 3]) return null;
      continue;
    }
    let t1 = (b[a] - o[a]) / d[a], t2 = (b[a + 3] - o[a]) / d[a];
    let f1 = a * 2 + 1, f2 = a * 2; // entering min side -> negative face
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; const f = f1; f1 = f2; f2 = f; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  // face ids: 0 +x,1 -x,2 +y,3 -y,4 +z,5 -z  (axis*2 = positive side)
  const map = [0, 1, 2, 3, 4, 5];
  return [Math.max(tmin, 0), map[face]];
}

// fluids: false (skip), 'source' (stop at source blocks), 'any'
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, fluids = false) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tx = (dx > 0 ? x + 1 - ox : ox - x) * tdx;
  let ty = (dy > 0 ? y + 1 - oy : oy - y) * tdy;
  let tz = (dz > 0 ? z + 1 - oz : oz - z) * tdz;
  if (!isFinite(tx)) tx = Infinity; if (!isFinite(ty)) ty = Infinity; if (!isFinite(tz)) tz = Infinity;
  let t = 0;
  for (let i = 0; i < 64 && t <= maxDist; i++) {
    const v = world.getBlock(x, y, z);
    const id = v & 1023;
    if (id) {
      const b = BLOCKS[id];
      const meta = v >>> 10;
      if (b.liquid) {
        if (fluids === 'any' || (fluids === 'source' && (meta & 7) === 0)) {
          const r = rayBox(ox, oy, oz, dx, dy, dz, [x, y, z, x + 1, y + 1, z + 1]);
          if (r && r[0] <= maxDist) return hit(x, y, z, id, meta, r, ox, oy, oz, dx, dy, dz);
        }
      } else {
        let conn = 0;
        if (b.render === R.FENCE) conn = fenceConn((ax, az) => world.getId(x + ax, y, z + az));
        const boxes = selectionBoxes(id, meta, conn);
        let best = null;
        for (const c of boxes) {
          const r = rayBox(ox, oy, oz, dx, dy, dz, [x + c[0], y + c[1], z + c[2], x + c[3], y + c[4], z + c[5]]);
          if (r && (!best || r[0] < best[0])) best = r;
        }
        if (best && best[0] <= maxDist) return hit(x, y, z, id, meta, best, ox, oy, oz, dx, dy, dz);
      }
    }
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}

function hit(x, y, z, id, meta, r, ox, oy, oz, dx, dy, dz) {
  const t = r[0];
  return { x, y, z, id, meta, face: r[1], dist: t, px: ox + dx * t, py: oy + dy * t, pz: oz + dz * t };
}
