// Block models (lists of boxes in 1/16 units) and collision/selection shapes.
// Facing convention: 0 south (+Z), 1 west (-X), 2 north (-Z), 3 east (+X).
// Models are built facing south and turned with `yrot` (= facing).
import { BLOCKS, B, R } from './blocks.js';

export const FACING_FACE = [4, 1, 5, 0]; // facing -> face index
export const FACING_DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // facing -> [dx, dz]

// rotate an (x,z) point in 1/16 units k quarter turns (south -> west -> north -> east)
export function rotXZ(x, z, k) {
  switch (k & 3) {
    case 1: return [16 - z, x];
    case 2: return [16 - x, 16 - z];
    case 3: return [z, 16 - x];
    default: return [x, z];
  }
}
export function rotBox(a, k) {
  const [x0, z0] = rotXZ(a[0], a[2], k);
  const [x1, z1] = rotXZ(a[3], a[5], k);
  return [Math.min(x0, x1), a[1], Math.min(z0, z1), Math.max(x0, x1), a[4], Math.max(z0, z1)];
}

// faces: 6 texture names (null = skip face) or a single name for all
function box(a, faces, opt = {}) {
  const f = Array.isArray(faces) ? faces : [faces, faces, faces, faces, faces, faces];
  return { a, f, uv: opt.uv || null, r: opt.r || null };
}
const M = (boxes, yrot = 0) => ({ boxes, yrot });

function texOf(b) {
  const t = b.tex;
  if (typeof t === 'string') return { top: t, bottom: t, side: t };
  const side = t.side || t.all;
  return { top: t.top || t.end || side, bottom: t.bottom || t.end || t.top || side, side, front: t.front, inner: t.inner };
}
const FULL_UV = [0, 0, 16, 16];
const U6 = [FULL_UV, FULL_UV, FULL_UV, FULL_UV, FULL_UV, FULL_UV];

// model for non-cube blocks. conn: neighbour connection bitmask by face (fences)
export function blockModel(id, meta, conn = 0) {
  const b = BLOCKS[id];
  const t = b.tex ? texOf(b) : null;
  switch (b.render) {
    case R.SLAB: {
      const y0 = (meta & 1) ? 8 : 0;
      return M([box([0, y0, 0, 16, y0 + 8, 16], [t.side, t.side, t.top, t.bottom, t.side, t.side])]);
    }
    case R.STAIRS: {
      // stairs keep world-aligned UVs, so their boxes are rotated directly
      const up = meta & 4, f = meta & 3;
      const fs = [t.side, t.side, t.top, t.bottom, t.side, t.side];
      const lower = up ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
      const upper = rotBox(up ? [0, 0, 8, 16, 8, 16] : [0, 8, 8, 16, 16, 16], f);
      return M([box(lower, fs), box(upper, fs)]);
    }
    case R.FENCE: {
      const tx = t.side;
      const out = [box([6, 0, 6, 10, 16, 10], tx)];
      const arms = [[10, 7, 16, 9], [0, 7, 6, 9], null, null, [7, 10, 9, 16], [7, 0, 9, 6]];
      for (const f of [0, 1, 4, 5]) {
        if (!(conn & (1 << f))) continue;
        const [x0, z0, x1, z1] = arms[f];
        out.push(box([x0, 12, z0, x1, 15, z1], tx));
        out.push(box([x0, 6, z0, x1, 9, z1], tx));
      }
      return M(out);
    }
    case R.TORCH: {
      const uv = [[7, 6, 9, 16], [7, 6, 9, 16], [7, 6, 9, 8], [7, 14, 9, 16], [7, 6, 9, 16], [7, 6, 9, 16]];
      if (meta === 0) return M([box([7, 0, 7, 9, 10, 9], 'torch', { uv })]);
      // wall torch, meta = facing + 1: base leans south, stuck into the north wall
      return M([box([7, 3.5, -1, 9, 13.5, 1], 'torch', { uv, r: { angle: 22.5, origin: [8, 3.5, 0] } })], (meta - 1) & 3);
    }
    case R.LADDER: // meta = facing (away from the wall); base: on the north wall facing south
      return M([box([0, 0, 0, 16, 16, 0.8], [null, null, null, null, 'ladder', 'ladder'], { uv: U6 })], meta & 3);
    case R.DOOR: {
      // bits 0-1 facing, bit 2 upper half, bit 3 open. base: closed panel on the north edge
      const f = meta & 3, upper = meta & 4, open = meta & 8;
      const tx = upper ? 'oak_door_top' : 'oak_door_bottom';
      return M([box([0, 0, 0, 16, 16, 3], tx)], open ? (f + 3) & 3 : f);
    }
    case R.BED: {
      // bits 0-1 facing (foot -> head), bit 2 head half. base: head toward south (+z)
      const head = meta & 4;
      const top = head ? 'bed_head_top' : 'bed_foot_top';
      const side = head ? 'bed_head_side' : 'bed_foot_side';
      const end = head ? 'bed_head_end' : 'bed_foot_end';
      const faces = [side, side, top, 'oak_planks', head ? end : null, head ? null : end];
      return M([box([0, 0, 0, 16, 9, 16], faces)], meta & 3);
    }
    case R.PAD:
      return M([box([0, 0, 0, 16, 0.25, 16], [null, null, 'lily_pad', 'lily_pad', null, null])]);
    case R.BOXES: {
      if (id === B.snow) {
        const h = Math.min(16, (meta + 1) * 2);
        return M([box([0, 0, 0, 16, h, 16], 'snow')]);
      }
      if (id === B.farmland) return M([box([0, 0, 0, 16, 15, 16], [t.side, t.side, meta > 0 ? 'farmland_moist' : 'farmland', t.bottom, t.side, t.side])]);
      if (id === B.dirt_path) return M([box([0, 0, 0, 16, 15, 16], [t.side, t.side, t.top, t.bottom, t.side, t.side])]);
      if (id === B.cactus) {
        return M([box([0, 0, 0, 16, 16, 16], [null, null, t.top, t.bottom, null, null]),
          box([1, 0, 1, 15, 16, 15], [t.side, t.side, null, null, t.side, t.side], { uv: U6 })]);
      }
      if (id === B.chest) {
        return M([box([1, 0, 1, 15, 14, 15], ['chest_side', 'chest_side', 'chest_top', 'chest_top', 'chest_front', 'chest_side'])], meta & 3);
      }
      if (id === B.cake) {
        const bites = Math.min(6, meta);
        return M([box([1 + bites * 2, 0, 1, 15, 8, 15], [t.side, bites ? t.inner : t.side, t.top, t.bottom, t.side, t.side])]);
      }
      return M([box([0, 0, 0, 16, 16, 16], t ? [t.side, t.side, t.top, t.bottom, t.side, t.side] : 'stone')]);
    }
  }
  return M([]);
}

// ------------------------------------------------------------- collision
const FULL = [[0, 0, 0, 1, 1, 1]];
const NONE = [];
const s16 = (a) => [a[0] / 16, a[1] / 16, a[2] / 16, a[3] / 16, a[4] / 16, a[5] / 16];

// axis-aligned boxes of a model (only for models without tilted boxes)
function modelBoxes(id, meta, conn) {
  const m = blockModel(id, meta, conn);
  return m.boxes.map((bx) => s16(rotBox(bx.a, m.yrot)));
}

export function collisionBoxes(id, meta, conn = 0) {
  const b = BLOCKS[id];
  if (!b.solid) return NONE;
  switch (b.render) {
    case R.CUBE: return FULL;
    case R.SLAB: return (meta & 1) ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    case R.STAIRS: case R.DOOR: case R.LADDER: return modelBoxes(id, meta, conn);
    case R.FENCE: {
      const out = [[6 / 16, 0, 6 / 16, 10 / 16, 1.5, 10 / 16]];
      if (conn & 1) out.push([10 / 16, 0, 6 / 16, 1, 1.5, 10 / 16]);
      if (conn & 2) out.push([0, 0, 6 / 16, 6 / 16, 1.5, 10 / 16]);
      if (conn & 16) out.push([6 / 16, 0, 10 / 16, 10 / 16, 1.5, 1]);
      if (conn & 32) out.push([6 / 16, 0, 0, 10 / 16, 1.5, 6 / 16]);
      return out;
    }
    case R.BED: return [[0, 0, 0, 1, 9 / 16, 1]];
    case R.PAD: return [[0, 0, 0, 1, 1 / 64, 1]];
    case R.BOXES: {
      if (id === B.snow) return meta === 0 ? NONE : [[0, 0, 0, 1, meta * 2 / 16, 1]];
      if (id === B.cactus) return [[1 / 16, 0, 1 / 16, 15 / 16, 15 / 16, 15 / 16]];
      if (id === B.chest) return [[1 / 16, 0, 1 / 16, 15 / 16, 14 / 16, 15 / 16]];
      if (id === B.farmland || id === B.dirt_path) return [[0, 0, 0, 1, 15 / 16, 1]];
      if (id === B.cake) return [[(1 + Math.min(6, meta) * 2) / 16, 0, 1 / 16, 15 / 16, 0.5, 15 / 16]];
      return FULL;
    }
  }
  return FULL;
}

// outline / raycast boxes (includes non-solid targets like plants and torches)
export function selectionBoxes(id, meta, conn = 0) {
  const b = BLOCKS[id];
  switch (b.render) {
    case R.NONE: case R.LIQUID: return NONE;
    case R.CUBE: return FULL;
    case R.CROSS: return [[2 / 16, 0, 2 / 16, 14 / 16, 13 / 16, 14 / 16]];
    case R.CROP: return [[0, 0, 0, 1, Math.max(2, (meta + 1) * 2) / 16, 1]];
    case R.TORCH: {
      if (meta === 0) return [[6 / 16, 0, 6 / 16, 10 / 16, 10 / 16, 10 / 16]];
      return [s16(rotBox([5.5, 3, 0, 10.5, 13, 5], (meta - 1) & 3))];
    }
    case R.VINE: return FULL;
    case R.FENCE: return collisionBoxes(id, meta, conn).map((a) => [a[0], 0, a[2], a[3], 1, a[5]]);
    case R.PAD: return [[0, 0, 0, 1, 1 / 16, 1]];
    case R.LADDER: return modelBoxes(id, meta, conn).map((a) => [Math.max(0, a[0] - 0.1), a[1], Math.max(0, a[2] - 0.1), Math.min(1, a[3] + 0.1), a[4], Math.min(1, a[5] + 0.1)]);
    case R.BOXES: if (id === B.snow) return [[0, 0, 0, 1, (meta + 1) * 2 / 16, 1]];
  }
  const c = collisionBoxes(id, meta, conn);
  return c.length ? c : FULL;
}

// fence connection mask from a neighbour lookup fn(dx,dz) -> block id
export function fenceConn(getId) {
  let m = 0;
  const test = (id) => id === B.oak_fence || BLOCKS[id].opaque;
  if (test(getId(1, 0))) m |= 1;
  if (test(getId(-1, 0))) m |= 2;
  if (test(getId(0, 1))) m |= 16;
  if (test(getId(0, -1))) m |= 32;
  return m;
}
