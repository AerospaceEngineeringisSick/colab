// Instanced billboard particles sampling the block texture array.
import * as THREE from 'three';
import { particleMaterial } from './materials.js';
import { texInfo } from './textures.js';
import { BLOCKS, B } from '../shared/blocks.js';
import { ITEMS } from '../shared/items.js';

const MAX = 4096;

export class Particles {
  constructor(scene, atlas, world) {
    this.world = world;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iTex = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.iLight = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    for (const a of [this.iPos, this.iTex, this.iCol, this.iLight]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.iPos);
    g.setAttribute('iTex', this.iTex);
    g.setAttribute('iCol', this.iCol);
    g.setAttribute('iLight', this.iLight);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, particleMaterial(atlas));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.list = [];
    this.tintFn = null; // (blockId, x, z) -> [r,g,b]
  }

  layer(name) { const t = texInfo[name]; return t ? t.layer : 0; }

  add(p) {
    if (this.list.length >= MAX) this.list.shift();
    p.age = 0;
    p.vx = p.vx || 0; p.vy = p.vy || 0; p.vz = p.vz || 0;
    p.g = p.g ?? 0;
    p.drag = p.drag ?? 0.98;
    p.r = p.r ?? 1; p.gg = p.gg ?? 1; p.b = p.b ?? 1; p.a = p.a ?? 1;
    p.uv = p.uv ?? 1; p.u0 = p.u0 ?? 0; p.v0 = p.v0 ?? 0;
    p.frames = p.frames || 1;
    this.list.push(p);
  }

  blockTexLayer(id, face = 2) {
    const b = BLOCKS[id];
    if (!b || !b.faces) return 0;
    return b.faces[face] ?? b.faces[0];
  }

  tintFor(id, x, z) {
    const b = BLOCKS[id];
    if (!b || !b.tint) return [1, 1, 1];
    if (Array.isArray(b.tint)) return b.tint;
    if (this.tintFn) return this.tintFn(b.tint, x, z);
    return [0.5, 0.75, 0.35];
  }

  // shards of a broken block
  breakBlock(x, y, z, id) {
    if (!id) return;
    const layer = this.blockTexLayer(id, id === B.grass_block ? 3 : 4);
    const t = id === B.grass_block ? [1, 1, 1] : this.tintFor(id, x, z);
    const n = 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
      if (Math.random() < 0.55) continue;
      const px = x + (i + 0.5) / n, py = y + (j + 0.5) / n, pz = z + (k + 0.5) / n;
      this.add({
        x: px, y: py, z: pz,
        vx: (px - x - 0.5) * 0.12 * 20 * (Math.random() * 0.5 + 0.6), vy: (py - y - 0.5) * 0.12 * 20 + Math.random() * 2.2, vz: (pz - z - 0.5) * 0.12 * 20 * (Math.random() * 0.5 + 0.6),
        g: 16, life: 0.4 + Math.random() * 0.8, size: 0.08 + Math.random() * 0.08, layer,
        u0: Math.random() * 0.75, v0: Math.random() * 0.75, uv: 0.25, r: t[0], gg: t[1], b: t[2], collide: true,
      });
    }
  }

  // small chips while mining
  hitBlock(hit) {
    const { x, y, z, id, face } = hit;
    const layer = this.blockTexLayer(id, face);
    const t = this.tintFor(id, x, z);
    const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][face];
    const px = x + 0.5 + n[0] * 0.55 + (n[0] ? 0 : (Math.random() - 0.5) * 0.9);
    const py = y + 0.5 + n[1] * 0.55 + (n[1] ? 0 : (Math.random() - 0.5) * 0.9);
    const pz = z + 0.5 + n[2] * 0.55 + (n[2] ? 0 : (Math.random() - 0.5) * 0.9);
    this.add({
      x: px, y: py, z: pz, vx: n[0] * 1.5 + (Math.random() - 0.5), vy: n[1] * 1.5 + Math.random(), vz: n[2] * 1.5 + (Math.random() - 0.5),
      g: 16, life: 0.3 + Math.random() * 0.5, size: 0.07 + Math.random() * 0.06, layer,
      u0: Math.random() * 0.75, v0: Math.random() * 0.75, uv: 0.25, r: t[0], gg: t[1], b: t[2], collide: true,
    });
  }

  landing(x, y, z, id, fall) {
    if (!id) return;
    const layer = this.blockTexLayer(id, 2);
    const t = this.tintFor(id, x, z);
    const n = Math.min(30, 4 + fall * 3) | 0;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.add({
        x: x + Math.cos(a) * 0.3, y: y + 0.05, z: z + Math.sin(a) * 0.3, vx: Math.cos(a) * 2, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * 2,
        g: 16, life: 0.4 + Math.random() * 0.4, size: 0.08, layer, u0: Math.random() * 0.75, v0: Math.random() * 0.75, uv: 0.25,
        r: t[0], gg: t[1], b: t[2], collide: true,
      });
    }
  }

  itemCrumbs(x, y, z, itemId, n = 6, dir = null) {
    const it = ITEMS[itemId];
    let layer;
    if (it && it.icon && texInfo[it.icon.replace(/^block\//, '')] && it.icon.startsWith('block/')) layer = texInfo[it.icon.slice(6)].layer;
    else if (it && it.icon && texInfo[it.icon]) layer = texInfo[it.icon].layer;
    else if (it && it.block !== undefined) layer = this.blockTexLayer(it.block, 4);
    else return;
    for (let i = 0; i < n; i++) {
      this.add({
        x, y, z, vx: (Math.random() - 0.5) * 2 + (dir ? dir[0] * 2 : 0), vy: Math.random() * 2 + 1, vz: (Math.random() - 0.5) * 2 + (dir ? dir[2] * 2 : 0),
        g: 16, life: 0.4 + Math.random() * 0.4, size: 0.08, layer, u0: Math.random() * 0.75, v0: Math.random() * 0.75, uv: 0.25, collide: true,
      });
    }
  }

  smoke(x, y, z, n = 1, big = 1, color = 0.9) {
    const layer = this.layer('env/smoke');
    for (let i = 0; i < n; i++) {
      const c = color * (0.75 + Math.random() * 0.25);
      this.add({
        x: x + (Math.random() - 0.5) * big, y: y + (Math.random() - 0.5) * big, z: z + (Math.random() - 0.5) * big,
        vx: (Math.random() - 0.5) * big * 1.5, vy: Math.random() * 1.2 + 0.4, vz: (Math.random() - 0.5) * big * 1.5,
        g: -0.6, drag: 0.92, life: 0.8 + Math.random() * 1.2, size: (0.25 + Math.random() * 0.35) * big, layer, r: c, gg: c, b: c,
        grow: 1.2,
      });
    }
  }

  explosion(x, y, z, r) {
    this.smoke(x, y, z, 40, r * 0.8, 0.95);
    for (let i = 0; i < 16; i++) this.smoke(x + (Math.random() - 0.5) * r * 2, y + (Math.random() - 0.5) * r * 2, z + (Math.random() - 0.5) * r * 2, 1, 1.6, 0.85);
  }

  flame(x, y, z) {
    this.add({ x: x + (Math.random() - 0.5) * 0.05, y, z: z + (Math.random() - 0.5) * 0.05, vy: 0.08, g: 0, drag: 0.9, life: 0.4 + Math.random() * 0.3, size: 0.09, layer: this.layer('env/flame'), light: -1, shrink: true });
    if (Math.random() < 0.4) this.add({ x, y: y + 0.12, z, vy: 0.5, g: -0.2, drag: 0.95, life: 0.8, size: 0.1, layer: this.layer('env/smoke'), r: 0.15, gg: 0.15, b: 0.15, grow: 0.6 });
  }

  // a glyph flying from a bookshelf at offset (dx,dy,dz) into the enchanting table at (x,y,z)
  enchantGlyph(x, y, z, dx, dy, dz) {
    const c = Math.random() * 0.6 + 0.4;
    this.add({
      fly: true, ox: x + 0.5, oy: y + 2, oz: z + 0.5, dx: dx + Math.random() - 0.5, dy: dy - Math.random() - 1, dz: dz + Math.random() - 0.5,
      x: x + 0.5 + dx, y: y + 2 + dy, z: z + 0.5 + dz, life: (30 + Math.random() * 10) / 20, size: 0.06 + Math.random() * 0.04,
      layer: this.layer('env/glyph_' + (1 + Math.floor(Math.random() * 18))), r: c * 0.9, gg: c * 0.9, b: c, light: -1, fade: false,
    });
  }

  lavaPop(x, y, z) {
    this.add({ x, y, z, vx: (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 2, g: 16, life: 1.5, size: 0.12, layer: this.layer('env/lava_particle'), light: -1, collide: true, shrink: true });
  }

  bubbles(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) this.add({ x: x + (Math.random() - 0.5) * 0.4, y: y + Math.random() * 0.3, z: z + (Math.random() - 0.5) * 0.4, vy: 1.2 + Math.random(), g: -2, drag: 0.85, life: 0.6 + Math.random() * 0.6, size: 0.08, layer: this.layer('env/bubble'), inWater: true });
  }

  splash(x, y, z, n = 20) {
    const layer = this.layer('env/bubble');
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * 2.5;
      this.add({ x, y, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * 3, vz: Math.sin(a) * s, g: 16, life: 0.5 + Math.random() * 0.4, size: 0.07, layer, r: 0.6, gg: 0.75, b: 1 });
    }
  }

  hearts(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) this.add({ x: x + (Math.random() - 0.5) * 0.8, y: y + Math.random() * 0.5, z: z + (Math.random() - 0.5) * 0.8, vy: 0.6, g: 0, drag: 0.95, life: 1 + Math.random(), size: 0.22, layer: this.layer('gui/heart'), light: -1 });
  }

  crit(x, y, z, n = 10) {
    const layer = this.layer('env/bonemeal');
    for (let i = 0; i < n; i++) {
      this.add({ x, y, z, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6, g: 8, drag: 0.85, life: 0.4 + Math.random() * 0.3, size: 0.12, layer, r: 1, gg: 0.85, b: 0.4, light: -1 });
    }
  }

  bonemeal(x, y, z, n = 12) {
    const layer = this.layer('env/bonemeal');
    for (let i = 0; i < n; i++) this.add({ x: x + Math.random(), y: y + Math.random() * 0.6, z: z + Math.random(), vy: 0.6 + Math.random(), g: 0, drag: 0.9, life: 1 + Math.random(), size: 0.1, layer, r: 0.6, gg: 1, b: 0.5, light: -1 });
  }

  rainDrop(x, y, z) {
    this.add({ x, y, z, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 1.5, g: 14, life: 0.3, size: 0.05, layer: this.layer('env/rain'), r: 0.6, gg: 0.7, b: 1 });
  }

  poof(x, y, z, w = 0.6, h = 1.8) {
    for (let i = 0; i < 20; i++) {
      this.add({
        x: x + (Math.random() - 0.5) * w, y: y + Math.random() * h, z: z + (Math.random() - 0.5) * w,
        vx: (Math.random() - 0.5) * 0.6, vy: Math.random() * 0.6 + 0.2, vz: (Math.random() - 0.5) * 0.6,
        g: -0.3, drag: 0.9, life: 0.6 + Math.random() * 0.6, size: 0.2 + Math.random() * 0.2, layer: this.layer('env/smoke'), grow: 0.5,
      });
    }
  }

  update(dt) {
    const w = this.world;
    const list = this.list;
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (p.fly) {
        // enchanting glyph: drifts from its start offset back into the origin with a little dip (vanilla curve)
        const f = 1 - p.age / p.life, f1 = (1 - f) ** 4;
        p.x = p.ox + p.dx * f; p.y = p.oy + p.dy * f - f1 * 1.2; p.z = p.oz + p.dz * f;
        list[j++] = p;
        continue;
      }
      p.vy -= p.g * dt;
      const d = Math.pow(p.drag, dt * 20);
      p.vx *= d; p.vy *= d; p.vz *= d;
      let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.collide && w) {
        if (w.isOpaque(Math.floor(nx), Math.floor(ny), Math.floor(nz))) {
          if (!w.isOpaque(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { nx = p.x; nz = p.z; p.vx *= -0.2; p.vz *= -0.2; }
          else { ny = p.y; p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; }
        }
      }
      if (p.inWater && w && w.getId(Math.floor(nx), Math.floor(ny), Math.floor(nz)) !== B.water) continue;
      p.x = nx; p.y = ny; p.z = nz;
      list[j++] = p;
    }
    list.length = j;
    const n = list.length;
    const P = this.iPos.array, T = this.iTex.array, C = this.iCol.array, L = this.iLight.array;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const t = p.age / p.life;
      let size = p.size;
      if (p.grow) size *= 1 + t * p.grow;
      if (p.shrink) size *= 1 - t * 0.7;
      P[i * 4] = p.x; P[i * 4 + 1] = p.y; P[i * 4 + 2] = p.z; P[i * 4 + 3] = size;
      T[i * 4] = p.layer; T[i * 4 + 1] = p.u0; T[i * 4 + 2] = p.v0; T[i * 4 + 3] = p.uv;
      C[i * 4] = p.r; C[i * 4 + 1] = p.gg; C[i * 4 + 2] = p.b; C[i * 4 + 3] = p.a * (p.fade === false ? 1 : Math.min(1, (1 - t) * 3));
      if (p.light === -1 || !w) { L[i * 2] = -1; L[i * 2 + 1] = 0; }
      else {
        if (!p.lt || (p.lc = (p.lc || 0) + 1) % 8 === 0) {
          const l = w.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          p.lt = [l >> 4, l & 15];
        }
        L[i * 2] = p.lt[0]; L[i * 2 + 1] = p.lt[1];
      }
    }
    this.geo.instanceCount = n;
    this.iPos.needsUpdate = this.iTex.needsUpdate = this.iCol.needsUpdate = this.iLight.needsUpdate = true;
    this.iPos.addUpdateRange(0, n * 4); this.iTex.addUpdateRange(0, n * 4); this.iCol.addUpdateRange(0, n * 4); this.iLight.addUpdateRange(0, n * 2);
  }

  clear() { this.list.length = 0; }
}
