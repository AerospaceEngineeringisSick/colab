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

// piston facing (2 north, 3 south, 4 west, 5 east) -> model turn from south
const PISTON_YROT = { 2: 2, 3: 0, 4: 1, 5: 3 };

// redstone dust: conn bits 1 east, 2 west, 4 south, 8 north; +16/32/64/128 when that side climbs a block
function wireModel(t, conn) {
  const flat = (a, tex) => box(a, [null, null, tex, null, null, null]);
  const e = conn & 1, w = conn & 2, s = conn & 4, n = conn & 8;
  const k = !!e + !!w + !!s + !!n;
  const line = t.side, line90 = t.side + '_90';
  const out = [];
  if (k === 0) out.push(flat([0, 0.3, 0, 16, 0.3, 16], t.top));
  else if (!(e || w)) out.push(flat([0, 0.25, 0, 16, 0.25, 16], line));
  else if (!(n || s)) out.push(flat([0, 0.25, 0, 16, 0.25, 16], line90));
  else {
    out.push(flat([0, 0.3, 0, 16, 0.3, 16], t.top));
    if (n) out.push(flat([0, 0.25, 0, 16, 0.25, 8], line));
    if (s) out.push(flat([0, 0.25, 8, 16, 0.25, 16], line));
    if (w) out.push(flat([0, 0.25, 0, 8, 0.25, 16], line90));
    if (e) out.push(flat([8, 0.25, 0, 16, 0.25, 16], line90));
  }
  // up the side of the next block
  if (conn & 16) out.push(box([15.75, 0, 0, 15.75, 16, 16], [null, line, null, null, null, null]));
  if (conn & 32) out.push(box([0.25, 0, 0, 0.25, 16, 16], [line, null, null, null, null, null]));
  if (conn & 64) out.push(box([0, 0, 15.75, 16, 16, 15.75], [null, null, null, null, null, line]));
  if (conn & 128) out.push(box([0, 0, 0.25, 16, 16, 0.25], [null, null, null, null, line, null]));
  return M(out);
}

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
      const tx = t ? t.side : 'torch';
      if (meta === 0) return M([box([7, 0, 7, 9, 10, 9], tx, { uv })]);
      // wall torch, meta = facing + 1: base leans south, stuck into the north wall
      return M([box([7, 3.5, -1, 9, 13.5, 1], tx, { uv, r: { angle: 22.5, origin: [8, 3.5, 0] } })], (meta - 1) & 3);
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
    case R.WIRE: return wireModel(t, conn);
    case R.LEVER: {
      // cobblestone base and a stick that tilts one way when off, the other when on
      const on = meta & 8, a = meta & 7;
      const huv = [[7, 6, 9, 16], [7, 6, 9, 16], [7, 6, 9, 8], [7, 6, 9, 8], [7, 6, 9, 16], [7, 6, 9, 16]];
      if (a === 0) return M([box([5, 0, 4, 11, 3, 12], t.top), box([7, 3, 7, 9, 13, 9], t.side, { uv: huv, r: { angle: on ? 40 : -40, origin: [8, 3, 8] } })]);
      return M([box([5, 4, 0, 11, 12, 3], t.top), box([7, 8, 2, 9, 18, 4], t.side, { uv: huv, r: { angle: on ? 140 : 40, origin: [8, 8, 3] } })], (a - 1) & 3);
    }
    case R.BUTTON: {
      const d = meta & 8 ? 1 : 2, a = meta & 7;
      if (a === 0) return M([box([5, 0, 6, 11, d, 10], t.side)]);
      return M([box([5, 6, 0, 11, 10, d], t.side)], (a - 1) & 3);
    }
    case R.PLATE: return M([box([1, 0, 1, 15, meta & 1 ? 0.5 : 1, 15], t.side)]);
    case R.REPEATER: {
      // built pointing south (output +z); the back torch slides with the delay
      const on = meta & 16, delay = (meta >> 2) & 3;
      const torch = on ? 'redstone_torch' : 'redstone_torch_off';
      const tuv = [[7, 6, 9, 11], [7, 6, 9, 11], [7, 6, 9, 8], [7, 14, 9, 16], [7, 6, 9, 11], [7, 6, 9, 11]];
      return M([
        box([0, 0, 0, 16, 2, 16], [t.side, t.side, on ? t.front : t.top, t.bottom, t.side, t.side]),
        box([7, 2, 11, 9, 7, 13], torch, { uv: tuv }),
        box([7, 2, 3 + delay * 2, 9, 7, 5 + delay * 2], torch, { uv: tuv }),
      ], meta & 3);
    }
    case R.PISTON: {
      const f = meta & 7, ext = meta & 8, S = t.side;
      const face = ext ? t.inner : t.front;
      if (f >= 2) return M([box([0, 0, 0, 16, 16, ext ? 12 : 16], [S + '_270', S + '_90', S + '_180', S, face, t.bottom])], PISTON_YROT[f]);
      if (f === 1) return M([box([0, 0, 0, 16, ext ? 12 : 16, 16], [S, S, face, t.bottom, S, S])]);
      const D = S + '_180';
      return M([box([0, ext ? 4 : 0, 0, 16, 16, 16], [D, D, t.bottom, face, D, D])]);
    }
    case R.PISTON_HEAD: {
      const f = meta & 7, S = t.side;
      const face = meta & 8 ? t.inner : t.front;
      const along = [[0, 0, 16, 4], [0, 0, 16, 4], [0, 0, 16, 4], [0, 0, 16, 4], [6, 6, 10, 10], [6, 6, 10, 10]];
      const upright = [[12, 0, 16, 16], [12, 0, 16, 16], [6, 6, 10, 10], [6, 6, 10, 10], [12, 0, 16, 16], [12, 0, 16, 16]];
      const V = S + '_90';
      if (f >= 2) {
        return M([
          box([0, 0, 12, 16, 16, 16], [S + '_270', S + '_90', S + '_180', S, face, t.front]),
          box([6, 6, -4, 10, 10, 12], [S, S, S, S, null, null], { uv: along }),
        ], PISTON_YROT[f]);
      }
      if (f === 1) return M([box([0, 12, 0, 16, 16, 16], [S, S, face, t.front, S, S]), box([6, -4, 6, 10, 12, 10], [V, V, null, null, V, V], { uv: upright })]);
      const D = S + '_180';
      return M([box([0, 0, 0, 16, 4, 16], [D, D, t.front, face, D, D]), box([6, 4, 6, 10, 20, 10], [V, V, null, null, V, V], { uv: upright })]);
    }
    case R.RAIL: {
      // flat or 45-degree quad; curves use the curved texture (the 'side' slot), powered rails their lit texture
      const shape = meta & 7 | (meta & 8 && !b.straightOnly ? 8 : 0);
      const lit = b.straightOnly && (meta & 8);
      const tex = shape >= 6 ? t.side : lit ? t.side : t.top;
      const faces = [null, null, tex, tex, null, null];
      if (shape <= 1) return M([box([0, 1, 0, 16, 1, 16], faces)], shape);
      if (shape <= 5) {
        const uv = [FULL_UV, FULL_UV, FULL_UV, FULL_UV, FULL_UV, FULL_UV];
        // built rising toward the south, then turned: 5 south, 3 west, 4 north, 2 east
        return M([box([0, 1, 0, 16, 1, 16 * Math.SQRT2], faces, { uv, r: { angle: -45, origin: [0, 1, 0] } })], { 5: 0, 3: 1, 4: 2, 2: 3 }[shape]);
      }
      // curved texture joins south and east; turn for the other corners
      return M([box([0, 1, 0, 16, 1, 16], faces)], { 6: 0, 7: 1, 8: 2, 9: 3 }[shape]);
    }
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
      if (id === B.enchanting_table) return M([box([0, 0, 0, 16, 12, 16], [t.side, t.side, t.top, t.bottom, t.side, t.side])]);
      if (id === B.anvil) {
        // built facing south with the long top running east-west, then turned
        const base = 'anvil_base';
        return M([
          box([2, 0, 2, 14, 4, 14], base),
          box([4, 4, 3, 12, 5, 13], base),
          box([6, 5, 4, 10, 10, 12], base),
          box([0, 10, 3, 16, 16, 13], [base, base, 'anvil_top', base, 'anvil_side', 'anvil_side']),
        ], meta & 3);
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
      if (id === B.enchanting_table) return [[0, 0, 0, 1, 0.75, 1]];
      if (id === B.anvil) return modelBoxes(id, meta, conn);
      return FULL;
    }
    case R.PISTON: case R.PISTON_HEAD: return modelBoxes(id, meta, conn);
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
    case R.WIRE: return [[0, 0, 0, 1, 1 / 16, 1]];
    case R.LEVER: case R.BUTTON: case R.PLATE: case R.REPEATER: return modelBoxes(id, meta, conn).map((a) => [Math.max(0, a[0]), Math.max(0, a[1]), Math.max(0, a[2]), Math.min(1, a[3]), Math.max(a[4], a[1] + 1 / 16), Math.min(1, a[5])]);
    case R.RAIL: return (meta & 7) >= 2 && (meta & 7) <= 5 ? [[0, 0, 0, 1, 0.5, 1]] : [[0, 0, 0, 1, 2 / 16, 1]];
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

// redstone dust connections from a neighbour lookup get(dx, dy, dz) -> block value (see wireModel for the bits)
const H_DIRS = [[1, 0, 1, 16], [-1, 0, 2, 32], [0, 1, 4, 64], [0, -1, 8, 128]];
export function wireConn(get) {
  let m = 0;
  const aboveOpen = !BLOCKS[get(0, 1, 0) & 1023].opaque;
  for (const [dx, dz, bit, up] of H_DIRS) {
    const side = get(dx, 0, dz);
    if (wireLinks(side, dx, dz)) m |= bit;
    else if (!BLOCKS[side & 1023].opaque && (get(dx, -1, dz) & 1023) === B.redstone_wire) m |= bit;
    else if (aboveOpen && BLOCKS[side & 1023].opaque && (get(dx, 1, dz) & 1023) === B.redstone_wire) m |= bit | up;
  }
  return m;
}
// does dust visually join the block v lying in direction (dx, dz)?
export function wireLinks(v, dx, dz) {
  const b = BLOCKS[v & 1023], k = b.redstone;
  if (!k) return false;
  if (k === 'wire' || k === 'torch' || k === 'lever' || k === 'button' || k === 'plate' || k === 'block' || k === 'drail') return true;
  if (k === 'repeater') { const f = FACING_DIR[(v >>> 10) & 3]; return f[0] !== 0 ? dx !== 0 : dz !== 0; }
  return false;
}
// vanilla dust colour for a signal strength
export function wireColor(power) {
  const f = power / 15;
  const r = f * 0.6 + (power > 0 ? 0.4 : 0.3);
  const g = Math.max(0, f * f * 0.7 - 0.5), b = Math.max(0, f * f * 0.6 - 0.7);
  return ((r * 255) << 16) | ((g * 255) << 8) | (b * 255);
}
