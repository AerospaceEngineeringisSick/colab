// Nether portals: lighting obsidian frames, keeping portals intact, and finding or building
// the matching portal on the other side.
import { BLOCKS, B, OPAQUE, LIQUID } from '../shared/blocks.js';
import { WH } from '../shared/constants.js';

const AXIS = [[1, 0], [0, 1]]; // meta 0: the portal runs along x, 1: along z
const open = (id) => id === 0 || id === B.fire;

// the inside of an obsidian frame containing (x, y, z) on one axis, or null
function frameAt(w, x, y, z, axis) {
  const [dx, dz] = AXIS[axis];
  if (!open(w.getId(x, y, z))) return null;
  let by = y;
  for (let n = 0; n < 21 && by > 1 && open(w.getId(x, by - 1, z)); n++) by--;
  if (w.getId(x, by - 1, z) !== B.obsidian) return null;
  let lx = x, lz = z;
  for (let n = 0; n < 21 && open(w.getId(lx - dx, by, lz - dz)); n++) { lx -= dx; lz -= dz; }
  if (w.getId(lx - dx, by, lz - dz) !== B.obsidian) return null;
  let width = 0;
  while (width < 22 && open(w.getId(lx + dx * width, by, lz + dz * width))) width++;
  if (width < 2 || width > 21 || w.getId(lx + dx * width, by, lz + dz * width) !== B.obsidian) return null;
  let height = 0;
  for (; height < 22; height++) {
    let rowOpen = true;
    for (let i = 0; i < width; i++) if (!open(w.getId(lx + dx * i, by + height, lz + dz * i))) { rowOpen = false; break; }
    if (!rowOpen) break;
    if (w.getId(lx - dx, by + height, lz - dz) !== B.obsidian || w.getId(lx + dx * width, by + height, lz + dz * width) !== B.obsidian) return null;
  }
  if (height < 3 || height > 21) return null;
  for (let i = 0; i < width; i++) {
    if (w.getId(lx + dx * i, by + height, lz + dz * i) !== B.obsidian) return null;
    if (w.getId(lx + dx * i, by - 1, lz + dz * i) !== B.obsidian) return null;
  }
  return { x: lx, y: by, z: lz, axis, width, height };
}

// light a frame around the open cell (x, y, z); returns the portal's corner or null
export function lightPortal(w, x, y, z) {
  for (const axis of [0, 1]) {
    const f = frameAt(w, x, y, z, axis);
    if (!f) continue;
    const [dx, dz] = AXIS[axis];
    for (let h = 0; h < f.height; h++) for (let i = 0; i < f.width; i++) {
      w.setBlock(f.x + dx * i, f.y + h, f.z + dz * i, B.nether_portal | (axis << 10), { noUpdate: true });
    }
    w.flushDirty(f.x >> 4, f.z >> 4);
    return f;
  }
  return null;
}

// a portal block stays only while its frame (or more portal) surrounds it on its plane
export function portalIntact(w, x, y, z, meta) {
  const axis = meta & 1, [dx, dz] = AXIS[axis];
  const ok = (id, v) => id === B.obsidian || (id === B.nether_portal && ((v >>> 10) & 1) === axis);
  for (const [ax, ay, az] of [[dx, 0, dz], [-dx, 0, -dz], [0, 1, 0], [0, -1, 0]]) {
    const v = w.getBlock(x + ax, y + ay, z + az);
    if (!ok(v & 1023, v)) return false;
  }
  return true;
}

// the bottom corner of a portal around a block of it
export function portalCorner(w, x, y, z) {
  const v = w.getBlock(x, y, z);
  if ((v & 1023) !== B.nether_portal) return null;
  const axis = (v >>> 10) & 1, [dx, dz] = AXIS[axis];
  while (w.getId(x, y - 1, z) === B.nether_portal) y--;
  while (w.getId(x - dx, y, z - dz) === B.nether_portal) { x -= dx; z -= dz; }
  return [x, y, z, axis];
}

// look through loaded terrain for a portal near (x, y, z)
export function findPortal(w, x, y, z, r) {
  let best = null, bd = Infinity;
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    const bx = x + dx, bz = z + dz;
    if (!w.isLoaded(bx, bz)) continue;
    const c = w.getChunk(bx >> 4, bz >> 4);
    const lx = bx & 15, lz = bz & 15;
    for (let by = 1; by < WH - 1; by++) {
      if ((c.blocks[(by << 8) | (lz << 4) | lx] & 1023) !== B.nether_portal) continue;
      const d = dx * dx + dz * dz + (by - y) * (by - y);
      if (d < bd) { bd = d; best = [bx, by, bz]; }
    }
  }
  return best ? portalCorner(w, best[0], best[1], best[2]) : null;
}

// a place a 4x5 portal fits standing on solid ground with room to step out
function spotOK(w, x, y, z, axis) {
  const [dx, dz] = AXIS[axis], px = dz, pz = dx; // px/pz: across the portal
  for (let a = -1; a <= 2; a++) for (let b = -1; b <= 1; b++) {
    const gx = x + dx * a + px * b, gz = z + dz * a + pz * b;
    const ground = w.getId(gx, y - 1, gz);
    if (!BLOCKS[ground].solid || LIQUID[ground]) return false;
    for (let h = 0; h <= 3; h++) {
      const id = w.getId(gx, y + h, gz);
      if (id !== 0 && !BLOCKS[id].replaceable) return false;
      if (LIQUID[id]) return false;
    }
  }
  return true;
}

// build a portal for a traveller arriving near (tx, ty, tz); returns its corner
export function buildPortal(w, tx, ty, tz, dim) {
  const ymin = dim === 'nether' ? 32 : 2, ymax = dim === 'nether' ? 118 : WH - 6;
  let best = null, bd = Infinity;
  for (let r = 0; r <= 16; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = tx + dx, z = tz + dz;
      if (!w.isLoaded(x, z)) continue;
      for (let y = ymax; y >= ymin; y--) {
        for (const axis of [0, 1]) {
          if (!spotOK(w, x, y, z, axis)) continue;
          const d = r * r + (y - ty) * (y - ty) * 0.5;
          if (d < bd) { bd = d; best = [x, y, z, axis]; }
        }
      }
    }
  }
  let forced = false;
  if (!best) {
    // nowhere fits: carve a space and stand the portal on an obsidian ledge
    best = [tx, Math.max(ymin + 2, Math.min(ymax - 8, ty)), tz, 0];
    forced = true;
  }
  const [x, y, z, axis] = best;
  const [dx, dz] = AXIS[axis], px = dz, pz = dx;
  if (forced) {
    for (let a = -1; a <= 2; a++) for (let b = -1; b <= 1; b++) {
      const gx = x + dx * a + px * b, gz = z + dz * a + pz * b;
      w.setBlock(gx, y - 1, gz, B.obsidian);
      for (let h = 0; h <= 3; h++) w.setBlock(gx, y + h, gz, 0);
    }
  }
  // the frame, then the portal sheet (without updates, so it doesn't break itself half-built)
  for (let a = -1; a <= 2; a++) { w.setBlock(x + dx * a, y - 1, z + dz * a, B.obsidian); w.setBlock(x + dx * a, y + 3, z + dz * a, B.obsidian); }
  for (let h = 0; h < 3; h++) { w.setBlock(x - dx, y + h, z - dz, B.obsidian); w.setBlock(x + dx * 2, y + h, z + dz * 2, B.obsidian); }
  for (let h = 0; h < 3; h++) for (let a = 0; a < 2; a++) w.setBlock(x + dx * a, y + h, z + dz * a, B.nether_portal | (axis << 10), { noUpdate: true });
  w.flushDirty(x >> 4, z >> 4);
  return [x, y, z, axis];
}

// is there obsidian or solid rock right here (for stepping out of a portal)
export const solidAt = (w, x, y, z) => OPAQUE[w.getId(x, y, z)] === 1;
