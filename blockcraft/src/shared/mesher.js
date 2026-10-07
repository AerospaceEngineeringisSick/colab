// Section mesher: turns a padded 18x18x18 block volume into vertex buffers.
// Runs in workers (and on the main thread for item models).
//
// Vertex layout (24 bytes):
//   position Uint16x4: (x+1)*1024, (y+1)*1024, (z+1)*1024, packed uv (u16 | v16 << 5)
//   aTex     Uint16x4: layer, overlay layer + 1 (0 = none), animation frames, flags (1 = sway)
//   aCol     Uint8x4 : tint rgb, face shade (normalised)
//   aLight   Uint8x4 : sky*16, block*16, ao (0..3), 0
import {
  BLOCKS, B, R, OPAQUE, RENDER, LAYER, LIQUID, CULL_SAME,
} from './blocks.js';
import { blockModel, fenceConn, wireConn, wireColor } from './shapes.js';

export const P = 18; // padded size
const SX = 1, SZ = P, SY = P * P;
export const pidx = (x, y, z) => (y + 1) * SY + (z + 1) * SZ + (x + 1);

// face frames: normal, TL corner, U and V directions (unit cube), stride of normal in padded volume
// corner positions as [x,y,z] for (s,t) = (0,0),(0,1),(1,1),(1,0)
const FACES = [];
function face(n, tl, du, dv) {
  const corners = [];
  for (const [s, t] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
    corners.push([tl[0] + du[0] * s + dv[0] * t, tl[1] + du[1] * s + dv[1] * t, tl[2] + du[2] * s + dv[2] * t]);
  }
  return { n, tl, du, dv, corners };
}
FACES[0] = face([1, 0, 0], [1, 1, 1], [0, 0, -1], [0, -1, 0]); // east
FACES[1] = face([-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]); // west
FACES[2] = face([0, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]); // up
FACES[3] = face([0, -1, 0], [0, 0, 1], [1, 0, 0], [0, 0, -1]); // down
FACES[4] = face([0, 0, 1], [0, 1, 1], [1, 0, 0], [0, -1, 0]); // south
FACES[5] = face([0, 0, -1], [1, 1, 0], [-1, 0, 0], [0, -1, 0]); // north
const SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const nstride = (n) => n[0] * SX + n[1] * SY + n[2] * SZ;
for (const f of FACES) {
  f.ns = nstride(f.n);
  // per corner: offsets of side1, side2, corner cells relative to the face-adjacent cell
  f.ao = f.corners.map((c, i) => {
    const s = i === 2 || i === 3 ? 1 : -1; // along U
    const t = i === 1 || i === 2 ? 1 : -1; // along V
    const u = nstride(f.du) * s, v = nstride(f.dv) * t;
    return [u, v, u + v];
  });
  // uv for corners (s,t) -> (u,v) in 0..16
  f.uv = [[0, 0], [0, 16], [16, 16], [16, 0]];
}
export { FACES };

class Buf {
  constructor() { this.cap = 0; this.n = 0; this.alloc(1024); this.quads = 0; this.flip = []; }
  alloc(cap) {
    const pos = new Uint16Array(cap * 4), tex = new Uint16Array(cap * 4);
    const col = new Uint8Array(cap * 4), light = new Uint8Array(cap * 4);
    if (this.cap) { pos.set(this.pos); tex.set(this.tex); col.set(this.col); light.set(this.light); }
    this.pos = pos; this.tex = tex; this.col = col; this.light = light; this.cap = cap;
  }
  reset() { this.n = 0; this.quads = 0; this.flip.length = 0; }
  vert(x, y, z, u, v, layer, ov, frames, flags, r, g, b, shade, sky, blk, ao) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const i = this.n * 4;
    this.pos[i] = Math.round((x + 1) * 1024); this.pos[i + 1] = Math.round((y + 1) * 1024); this.pos[i + 2] = Math.round((z + 1) * 1024);
    this.pos[i + 3] = (Math.round(u) & 31) | ((Math.round(v) & 31) << 5);
    this.tex[i] = layer; this.tex[i + 1] = ov; this.tex[i + 2] = frames; this.tex[i + 3] = flags;
    this.col[i] = r; this.col[i + 1] = g; this.col[i + 2] = b; this.col[i + 3] = shade;
    this.light[i] = sky; this.light[i + 1] = blk; this.light[i + 2] = ao; this.light[i + 3] = 0;
    this.n++;
  }
  // finish one quad (4 verts already pushed); flip chooses the other diagonal
  quad(flip) { this.flip.push(flip ? 1 : 0); this.quads++; }
  result() {
    const n = this.n;
    if (!n) return null;
    const big = n > 65535;
    const index = big ? new Uint32Array(this.quads * 6) : new Uint16Array(this.quads * 6);
    for (let q = 0; q < this.quads; q++) {
      const b = q * 4, o = q * 6;
      if (this.flip[q]) { index[o] = b + 1; index[o + 1] = b + 2; index[o + 2] = b + 3; index[o + 3] = b + 1; index[o + 4] = b + 3; index[o + 5] = b; }
      else { index[o] = b; index[o + 1] = b + 1; index[o + 2] = b + 2; index[o + 3] = b; index[o + 4] = b + 2; index[o + 5] = b + 3; }
    }
    return {
      pos: this.pos.slice(0, n * 4), tex: this.tex.slice(0, n * 4), col: this.col.slice(0, n * 4),
      light: this.light.slice(0, n * 4), index,
    };
  }
}

export class Mesher {
  constructor(texInfo) {
    this.tex = texInfo; // name -> {layer, frames}
    this.bufs = [new Buf(), new Buf(), new Buf()];
    this.modelCache = new Map();
    this.L = (n) => this.tex[n] || this.tex.stone;
  }

  // cached resolved model for (id, meta, conn)
  model(id, meta, conn) {
    const key = (id << 16) | (meta << 8) | conn;
    let m = this.modelCache.get(key);
    if (m) return m;
    const raw = blockModel(id, meta, conn);
    m = { yrot: raw.yrot, boxes: raw.boxes.map((bx) => ({ ...bx, f: bx.f.map((n) => (n ? this.L(n) : null)) })) };
    this.modelCache.set(key, m);
    return m;
  }

  /**
   * blocks: Uint16Array(18^3) padded cells, light: Uint8Array(18^3) (sky<<4 | block)
   * tints: { grass, foliage, water } Uint32Array(18*18) packed 0xRRGGBB, index (z+1)*18+(x+1)
   * seed: positional hash seed for plant offsets; ox,oy,oz: world origin of the section
   */
  mesh(blocks, light, tints, ox = 0, oy = 0, oz = 0) {
    this.blocks = blocks; this.light = light; this.tints = tints;
    this.ox = ox; this.oy = oy; this.oz = oz;
    for (const b of this.bufs) b.reset();
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        let p = pidx(0, y, z);
        for (let x = 0; x < 16; x++, p++) {
          const v = blocks[p];
          const id = v & 1023;
          if (id === 0) continue;
          const rt = RENDER[id];
          switch (rt) {
            case R.CUBE: this.cube(x, y, z, p, id, v >>> 10); break;
            case R.CROSS: this.cross(x, y, z, p, id, v >>> 10); break;
            case R.CROP: this.crop(x, y, z, p, id, v >>> 10); break;
            case R.LIQUID: this.liquid(x, y, z, p, id, v >>> 10); break;
            case R.VINE: this.vine(x, y, z, p, id, v >>> 10); break;
            case R.NONE: break;
            default: this.boxes(x, y, z, p, id, v >>> 10); break;
          }
        }
      }
    }
    return this.bufs.map((b) => b.result());
  }

  tint(kind, x, z) {
    if (!kind) return 0xffffff;
    if (typeof kind !== 'string') return ((kind[0] * 255) << 16) | ((kind[1] * 255) << 8) | (kind[2] * 255);
    const t = this.tints[kind];
    return t ? t[(z + 1) * P + (x + 1)] : 0xffffff;
  }

  // ---------------------------------------------------------------- cubes
  faceVisible(id, p, f) {
    const nb = this.blocks[p + FACES[f].ns] & 1023;
    if (OPAQUE[nb]) return false;
    if (nb === id && CULL_SAME[id]) return false;
    return true;
  }

  cube(x, y, z, p, id, meta) {
    const blk = BLOCKS[id];
    const blocks = this.blocks;
    const buf = this.bufs[LAYER[id]];
    const fancyLeaves = blk.layer === 1 && !blk.cullSame;
    for (let f = 0; f < 6; f++) {
      const F = FACES[f];
      const q = p + F.ns;
      const nb = blocks[q] & 1023;
      if (OPAQUE[nb]) continue;
      if (nb === id && (CULL_SAME[id] || (fancyLeaves && this.fastLeaves))) continue;
      let layer = blk.faces[f], frames = blk.anim[f], ov = 0, rot = 0;
      let tintKind = blk.tint;
      // orientation
      if (blk.rotate === 'axis') {
        const ax = meta & 3; // 0 y, 1 x, 2 z
        if (ax === 1) { if (f < 2) layer = blk.end; else if (f === 2 || f === 3 || f >= 4) { layer = blk.faces[0]; rot = 1; } }
        else if (ax === 2) { if (f >= 4) layer = blk.end; else { layer = blk.faces[0]; rot = (f < 2) ? 1 : 0; } }
      } else if (blk.rotate === 'facing' && blk.front !== undefined) {
        const front = [4, 1, 5, 0][meta & 3];
        if (f === front) layer = blk.front;
      }
      if (id === B.grass_block) {
        if (f === 3) tintKind = null;
        else if (f !== 2) {
          const above = blocks[p + SY] & 1023;
          if (above === B.snow || above === B.snow_block) { layer = this.L('grass_side_snow').layer; tintKind = null; }
          else ov = blk.overlay + 1;
        }
      }
      const tint = this.tint(tintKind, x, z);
      this.cubeFace(buf, x, y, z, q, F, f, layer, ov, frames, tint, rot, blk.sway ? 1 : 0);
    }
  }

  // emit one full face with smooth light + AO; q = padded index of the face-adjacent cell
  cubeFace(buf, x, y, z, q, F, f, layer, ov, frames, tint, rot, flags) {
    const blocks = this.blocks, light = this.light;
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
    const shade = SHADE[f] * 255;
    const l0 = light[q];
    let ao0 = 0, ao1 = 0, ao2 = 0, ao3 = 0;
    for (let i = 0; i < 4; i++) {
      const o = F.ao[i];
      const s1 = OPAQUE[blocks[q + o[0]] & 1023], s2 = OPAQUE[blocks[q + o[1]] & 1023];
      const c = OPAQUE[blocks[q + o[2]] & 1023];
      const ao = (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
      // smooth light: average of up to 4 non-opaque cells
      let sky = l0 >> 4, bl = l0 & 15, n = 1;
      if (!s1) { const l = light[q + o[0]]; sky += l >> 4; bl += l & 15; n++; }
      if (!s2) { const l = light[q + o[1]]; sky += l >> 4; bl += l & 15; n++; }
      if (!c && !(s1 && s2)) { const l = light[q + o[2]]; sky += l >> 4; bl += l & 15; n++; }
      const c3 = F.corners[i];
      const uv = F.uv[(i + rot) & 3];
      buf.vert(x + c3[0], y + c3[1], z + c3[2], uv[0], uv[1], layer, ov, frames, flags, r, g, b, shade, (sky * 16 / n) | 0, (bl * 16 / n) | 0, ao);
      if (i === 0) ao0 = ao; else if (i === 1) ao1 = ao; else if (i === 2) ao2 = ao; else ao3 = ao;
    }
    buf.quad(ao0 + ao2 < ao1 + ao3);
  }

  // ---------------------------------------------------------------- plants
  posHash(x, y, z) {
    let h = Math.imul((x + this.ox) | 0, 3129871) ^ Math.imul((z + this.oz) | 0, 116129781) ^ ((y + this.oy) | 0);
    h = Math.imul(h, Math.imul(h, 42317861) + 11);
    return h >>> 0;
  }

  cross(x, y, z, p, id, meta) {
    const blk = BLOCKS[id];
    const buf = this.bufs[1];
    const l = this.light[p];
    const sky = (l >> 4) * 16, bl = (l & 15) * 16;
    const tint = this.tint(blk.tint, x, z);
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
    let ox = 0, oz = 0;
    if (blk.plant && id !== B.sugar_cane && !(id >= B.oak_sapling && id <= B.dark_oak_sapling)) {
      const h = this.posHash(x, y, z);
      ox = (((h >> 16) & 15) / 15 - 0.5) * 0.4;
      oz = (((h >> 24) & 15) / 15 - 0.5) * 0.4;
    }
    const layer = blk.faces[2], frames = blk.anim[2];
    const flags = blk.sway ? 1 : 0;
    const d = 0.45; // half diagonal extent
    const cx = x + 0.5 + ox, cz = z + 0.5 + oz;
    const h = 1;
    const planes = [[cx - d, cz - d, cx + d, cz + d], [cx - d, cz + d, cx + d, cz - d]];
    for (const [x0, z0, x1, z1] of planes) {
      // front
      buf.vert(x0, y + h, z0, 0, 0, layer, 0, frames, flags, r, g, b, 230, sky, bl, 3);
      buf.vert(x0, y, z0, 0, 16, layer, 0, frames, 0, r, g, b, 230, sky, bl, 3);
      buf.vert(x1, y, z1, 16, 16, layer, 0, frames, 0, r, g, b, 230, sky, bl, 3);
      buf.vert(x1, y + h, z1, 16, 0, layer, 0, frames, flags, r, g, b, 230, sky, bl, 3);
      buf.quad(false);
      // back
      buf.vert(x1, y + h, z1, 16, 0, layer, 0, frames, flags, r, g, b, 230, sky, bl, 3);
      buf.vert(x1, y, z1, 16, 16, layer, 0, frames, 0, r, g, b, 230, sky, bl, 3);
      buf.vert(x0, y, z0, 0, 16, layer, 0, frames, 0, r, g, b, 230, sky, bl, 3);
      buf.vert(x0, y + h, z0, 0, 0, layer, 0, frames, flags, r, g, b, 230, sky, bl, 3);
      buf.quad(false);
    }
  }

  crop(x, y, z, p, id, meta) {
    const buf = this.bufs[1];
    const l = this.light[p];
    const sky = (l >> 4) * 16, bl = (l & 15) * 16;
    let name;
    if (id === B.wheat) name = 'wheat' + Math.min(7, meta);
    else if (id === B.nether_wart) name = 'nether_wart' + [0, 1, 1, 2][Math.min(3, meta)];
    else name = (id === B.carrots ? 'carrots' : 'potatoes') + Math.min(3, meta >> 1);
    const t = this.L(name);
    const yb = y - 1 / 16;
    const h = 1;
    for (const off of [4 / 16, 12 / 16]) {
      // planes along x at z = off and along z at x = off, both sides
      const quads = [
        [x, z + off, x + 1, z + off], [x + 1, z + off, x, z + off],
        [x + off, z, x + off, z + 1], [x + off, z + 1, x + off, z],
      ];
      for (const [x0, z0, x1, z1] of quads) {
        buf.vert(x0, yb + h, z0, 0, 0, t.layer, 0, t.frames, 1, 255, 255, 255, 230, sky, bl, 3);
        buf.vert(x0, yb, z0, 0, 16, t.layer, 0, t.frames, 0, 255, 255, 255, 230, sky, bl, 3);
        buf.vert(x1, yb, z1, 16, 16, t.layer, 0, t.frames, 0, 255, 255, 255, 230, sky, bl, 3);
        buf.vert(x1, yb + h, z1, 16, 0, t.layer, 0, t.frames, 1, 255, 255, 255, 230, sky, bl, 3);
        buf.quad(false);
      }
    }
  }

  vine(x, y, z, p, id, meta) {
    // meta bits: 0 east wall, 1 west, 2 south, 3 north (side the vine hangs on)
    const blk = BLOCKS[id];
    const buf = this.bufs[1];
    const l = this.light[p];
    const sky = (l >> 4) * 16, bl = (l & 15) * 16;
    const tint = this.tint(blk.tint, x, z);
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
    const layer = blk.faces[0];
    const e = 0.05;
    const planes = [];
    if (meta & 1) planes.push([x + 1 - e, z + 1, x + 1 - e, z]);
    if (meta & 2) planes.push([x + e, z, x + e, z + 1]);
    if (meta & 4) planes.push([x, z + 1 - e, x + 1, z + 1 - e]);
    if (meta & 8) planes.push([x + 1, z + e, x, z + e]);
    if (!planes.length) planes.push([x, z + 1 - e, x + 1, z + 1 - e]);
    for (const [x0, z0, x1, z1] of planes) {
      for (const [a0, b0, a1, b1] of [[x0, z0, x1, z1], [x1, z1, x0, z0]]) {
        buf.vert(a0, y + 1, b0, 0, 0, layer, 0, 1, 0, r, g, b, 210, sky, bl, 3);
        buf.vert(a0, y, b0, 0, 16, layer, 0, 1, 0, r, g, b, 210, sky, bl, 3);
        buf.vert(a1, y, b1, 16, 16, layer, 0, 1, 0, r, g, b, 210, sky, bl, 3);
        buf.vert(a1, y + 1, b1, 16, 0, layer, 0, 1, 0, r, g, b, 210, sky, bl, 3);
        buf.quad(false);
      }
    }
  }

  // ---------------------------------------------------------------- liquids
  liquidHeight(p, id) {
    const v = this.blocks[p];
    if ((v & 1023) !== id) return -1;
    if ((this.blocks[p + SY] & 1023) === id) return 1;
    const lvl = (v >>> 10) & 7;
    return lvl === 0 ? 0.889 : Math.max(0.12, (8 - lvl) / 9);
  }

  cornerHeight(p, id, dx, dz) {
    // average over the 4 columns that share this top corner
    let sum = 0, n = 0;
    for (let i = 0; i < 4; i++) {
      const q = p + (i & 1 ? dx : 0) + (i & 2 ? dz : 0);
      if ((this.blocks[q + SY] & 1023) === id) return 1;
      const h = this.liquidHeight(q, id);
      if (h >= 0) { sum += h; n++; }
    }
    return n ? sum / n : 0.889;
  }

  liquid(x, y, z, p, id, meta) {
    const blk = BLOCKS[id];
    const buf = this.bufs[LAYER[id]];
    const blocks = this.blocks, light = this.light;
    const tint = this.tint(blk.tint, x, z);
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
    const above = blocks[p + SY] & 1023;
    const topCovered = above === id;
    // corner heights: (x0,z0) (x0,z1) (x1,z1) (x1,z0)
    let h00 = 1, h01 = 1, h11 = 1, h10 = 1;
    if (!topCovered) {
      h00 = this.cornerHeight(p, id, -1, -SZ);
      h01 = this.cornerHeight(p, id, -1, SZ);
      h11 = this.cornerHeight(p, id, 1, SZ);
      h10 = this.cornerHeight(p, id, 1, -SZ);
    }
    const still = this.L(id === B.water ? 'water_still' : 'lava_still');
    const flow = this.L(id === B.water ? 'water_flow' : 'lava_flow');
    const lp = (q) => { const l = light[q]; return [(l >> 4) * 16, (l & 15) * 16]; };
    const emit = blk.emit ? 240 : 0;
    // top
    if (!topCovered && !OPAQUE[above]) {
      const [sky, bl0] = lp(p + SY);
      const bl = Math.max(bl0, emit);
      const flat = h00 === h01 && h01 === h11 && h11 === h10;
      const t = flat ? still : flow;
      // flow direction -> uv rotation
      let rot = 0;
      if (!flat) {
        const dx = (h00 + h01) - (h10 + h11), dz = (h00 + h10) - (h01 + h11);
        if (Math.abs(dx) > Math.abs(dz)) rot = dx > 0 ? 3 : 1; else rot = dz > 0 ? 0 : 2;
      }
      const uvs = [[0, 0], [0, 16], [16, 16], [16, 0]];
      const c = [[x, y + h00, z], [x, y + h01, z + 1], [x + 1, y + h11, z + 1], [x + 1, y + h10, z]];
      for (let i = 0; i < 4; i++) {
        const uv = uvs[(i + rot) & 3];
        buf.vert(c[i][0], c[i][1], c[i][2], uv[0], uv[1], t.layer, 0, t.frames, 0, r, g, b, 255, sky, bl, 3);
      }
      buf.quad(false);
      // underside of the surface (seen from below the water)
      for (let i = 3; i >= 0; i--) {
        const uv = uvs[(i + rot) & 3];
        buf.vert(c[i][0], c[i][1], c[i][2], uv[0], uv[1], t.layer, 0, t.frames, 0, r, g, b, 200, sky, bl, 3);
      }
      buf.quad(false);
    }
    // bottom
    const below = blocks[p - SY] & 1023;
    if (below !== id && !OPAQUE[below]) {
      const [sky, bl0] = lp(p - SY);
      const bl = Math.max(bl0, emit);
      const c = [[x, y, z + 1], [x, y, z], [x + 1, y, z], [x + 1, y, z + 1]];
      const uvs = [[0, 0], [0, 16], [16, 16], [16, 0]];
      for (let i = 0; i < 4; i++) buf.vert(c[i][0], c[i][1], c[i][2], uvs[i][0], uvs[i][1], still.layer, 0, still.frames, 0, r, g, b, 128, sky, bl, 3);
      buf.quad(false);
    }
    // sides: [face, neighbour offset, corner A, corner B (top-left -> top-right seen from outside)]
    const sides = [
      [0, 1, [x + 1, z + 1, h11], [x + 1, z, h10]],
      [1, -1, [x, z, h00], [x, z + 1, h01]],
      [4, SZ, [x, z + 1, h01], [x + 1, z + 1, h11]],
      [5, -SZ, [x + 1, z, h10], [x, z, h00]],
    ];
    for (const [f, off, A, Bc] of sides) {
      const q = p + off;
      const nb = blocks[q] & 1023;
      if (nb === id || OPAQUE[nb]) continue;
      if (LIQUID[nb] && nb !== id && id === B.water) continue;
      const [sky, bl0] = lp(q);
      const bl = Math.max(bl0, emit);
      const shade = SHADE[f] * 255;
      const ha = A[2], hb = Bc[2];
      buf.vert(A[0], y + ha, A[1], 0, (1 - ha) * 8, flow.layer, 0, flow.frames, 0, r, g, b, shade, sky, bl, 3);
      buf.vert(A[0], y, A[1], 0, 8, flow.layer, 0, flow.frames, 0, r, g, b, shade, sky, bl, 3);
      buf.vert(Bc[0], y, Bc[1], 8, 8, flow.layer, 0, flow.frames, 0, r, g, b, shade, sky, bl, 3);
      buf.vert(Bc[0], y + hb, Bc[1], 8, (1 - hb) * 8, flow.layer, 0, flow.frames, 0, r, g, b, shade, sky, bl, 3);
      buf.quad(false);
      // inner side for seeing out from inside the water
      buf.vert(Bc[0], y + hb, Bc[1], 8, (1 - hb) * 8, flow.layer, 0, flow.frames, 0, r, g, b, shade * 0.8, sky, bl, 3);
      buf.vert(Bc[0], y, Bc[1], 8, 8, flow.layer, 0, flow.frames, 0, r, g, b, shade * 0.8, sky, bl, 3);
      buf.vert(A[0], y, A[1], 0, 8, flow.layer, 0, flow.frames, 0, r, g, b, shade * 0.8, sky, bl, 3);
      buf.vert(A[0], y + ha, A[1], 0, (1 - ha) * 8, flow.layer, 0, flow.frames, 0, r, g, b, shade * 0.8, sky, bl, 3);
      buf.quad(false);
    }
  }

  // ---------------------------------------------------------------- models
  boxes(x, y, z, p, id, meta) {
    const blk = BLOCKS[id];
    const blocks = this.blocks, light = this.light;
    let conn = 0;
    if (blk.render === R.FENCE) conn = fenceConn((dx, dz) => blocks[p + dx + dz * SZ] & 1023);
    else if (blk.render === R.WIRE) conn = wireConn((dx, dy, dz) => blocks[p + dx + dy * SY + dz * SZ]);
    const m = this.model(id, meta, conn);
    const buf = this.bufs[LAYER[id]];
    const tint = blk.render === R.WIRE ? wireColor(meta) : this.tint(blk.tint, x, z);
    const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
    const own = light[p];
    const emit = blk.emit * 16;
    for (const bx of m.boxes) {
      const a = bx.a;
      const x0 = a[0] / 16, y0 = a[1] / 16, z0 = a[2] / 16, x1 = a[3] / 16, y1 = a[4] / 16, z1 = a[5] / 16;
      for (let f = 0; f < 6; f++) {
        const t = bx.f[f];
        if (!t) continue;
        const F = FACES[f];
        // face extents in the unrotated frame
        const onEdge = !bx.r && ((f === 0 && x1 === 1) || (f === 1 && x0 === 0) || (f === 2 && y1 === 1) || (f === 3 && y0 === 0) || (f === 4 && z1 === 1) || (f === 5 && z0 === 0));
        // world face after y rotation
        const wf = rotFace(f, m.yrot);
        const q = p + FACES[wf].ns;
        if (onEdge && OPAQUE[blocks[q] & 1023]) continue;
        // inner faces use the cell's own light, or the neighbour's when the cell blocks light (paths, farmland)
        const lq = OPAQUE[blocks[q] & 1023] ? 0 : light[q];
        const l = onEdge ? lq : Math.max(own >> 4, lq >> 4) << 4 | Math.max(own & 15, lq & 15);
        const sky = (l >> 4) * 16, bl = Math.max((l & 15) * 16, emit);
        // auto uv from box extents
        let uv = bx.uv ? bx.uv[f] : autoUV(f, a);
        const shade = SHADE[wf] * 255;
        for (let i = 0; i < 4; i++) {
          const c = F.corners[i];
          let px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
          if (bx.r) {
            // tilt around the x axis through origin
            const o = bx.r.origin, ang = bx.r.angle * Math.PI / 180;
            const yy = py - o[1] / 16, zz = pz - o[2] / 16;
            py = o[1] / 16 + yy * Math.cos(ang) - zz * Math.sin(ang);
            pz = o[2] / 16 + yy * Math.sin(ang) + zz * Math.cos(ang);
          }
          if (m.yrot) {
            const [rx, rz] = rotXZ01(px, pz, m.yrot);
            px = rx; pz = rz;
          }
          const s = i === 2 || i === 3, tt = i === 1 || i === 2;
          buf.vert(x + px, y + py, z + pz, s ? uv[2] : uv[0], tt ? uv[3] : uv[1], t.layer, 0, t.frames, 0, r, g, b, shade, sky, bl, 3);
        }
        buf.quad(false);
      }
    }
  }
}

function rotXZ01(x, z, k) {
  switch (k & 3) {
    case 1: return [1 - z, x];
    case 2: return [1 - x, 1 - z];
    case 3: return [z, 1 - x];
    default: return [x, z];
  }
}
// face index after rotating the model k quarter turns (S -> W -> N -> E)
const ROT_FACE = [
  [0, 1, 2, 3, 4, 5],
  [4, 5, 2, 3, 1, 0],
  [1, 0, 2, 3, 5, 4],
  [5, 4, 2, 3, 0, 1],
];
function rotFace(f, k) { return ROT_FACE[k & 3][f]; }

// MC-style automatic UVs (u0,v0,u1,v1) from a box (1/16 units)
function autoUV(f, a) {
  const [x0, y0, z0, x1, y1, z1] = a;
  switch (f) {
    case 0: return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
    case 1: return [z0, 16 - y1, z1, 16 - y0];
    case 2: return [x0, z0, x1, z1];
    case 3: return [x0, 16 - z1, x1, 16 - z0];
    case 4: return [x0, 16 - y1, x1, 16 - y0];
    default: return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
  }
}
