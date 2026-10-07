// 3D item models: extruded sprites for flat items, mini block models for block items.
import * as THREE from 'three';
import { ITEMS } from '../shared/items.js';
import { BLOCKS, R } from '../shared/blocks.js';
import { Mesher, P, pidx } from '../shared/mesher.js';
import { images, imageTexture, texInfo, canvas } from './textures.js';
import { entityMaterial, itemBlockMaterial } from './materials.js';
import { potionColor } from '../shared/potions.js';

const flatCache = new Map();
const blockCache = new Map();
let mesher = null;
let atlas = null;

export function initItemMeshes(arrayTex) {
  atlas = arrayTex;
  mesher = new Mesher(texInfo);
}

// which image draws a flat item (null if the item renders as a 3D block)
export function flatIconName(id) {
  const it = ITEMS[id];
  if (!it) return 'item/stick';
  if (it.icon && it.icon !== 'egg') return it.icon;
  if (it.egg) return 'egg:' + it.egg.mob;
  return null;
}

// draw a tinted spawn egg / tinted icon into a canvas
export function iconCanvas(name) {
  if (name.startsWith('egg:')) {
    const mob = name.slice(4);
    const key = 'egg/' + mob;
    if (images[key]) return images[key];
    const it = Object.values(ITEMS).find((i) => i && i.egg && i.egg.mob === mob);
    const [c1, c2] = it.egg.col;
    const c = canvas(16, 16), g = c.getContext('2d');
    const tint = (img, col) => {
      const t = canvas(16, 16), tg = t.getContext('2d');
      tg.drawImage(img, 0, 0);
      tg.globalCompositeOperation = 'multiply';
      tg.fillStyle = '#' + col.toString(16).padStart(6, '0');
      tg.fillRect(0, 0, 16, 16);
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(img, 0, 0);
      return t;
    };
    g.drawImage(tint(images['item/spawn_egg'], c1), 0, 0);
    g.drawImage(tint(images['item/spawn_egg_overlay'], c2), 0, 0);
    images[key] = c;
    return c;
  }
  return images[name];
}

// extruded sprite geometry from a 16x16 image (1/16 thick), centred on origin, 1 unit wide
function extrude(img) {
  const S = img.width;
  const g2 = canvas(S, S).getContext('2d', { willReadFrequently: true });
  g2.drawImage(img, 0, 0, S, S, 0, 0, S, S);
  const px = g2.getImageData(0, 0, S, S).data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < S && y < S && px[(y * S + x) * 4 + 3] > 20;
  const pos = [], uv = [], nor = [], idx = [];
  const t = 1 / 32; // half thickness
  const quad = (a, b, c, d, n, u0, v0, u1, v1) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    uv.push(u0, v0, u0, v1, u1, v1, u1, v0);
    for (let k = 0; k < 4; k++) nor.push(...n);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const X = (x) => x / S - 0.5, Y = (y) => 0.5 - y / S;
  // front (+z) and back (-z)
  quad([-0.5, 0.5, t], [-0.5, -0.5, t], [0.5, -0.5, t], [0.5, 0.5, t], [0, 0, 1], 0, 1, 1, 0);
  quad([0.5, 0.5, -t], [0.5, -0.5, -t], [-0.5, -0.5, -t], [-0.5, 0.5, -t], [0, 0, -1], 1, 1, 0, 0);
  // edges of each solid pixel
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!solid(x, y)) continue;
    const u0 = x / S, u1 = (x + 1) / S, v0 = 1 - y / S, v1 = 1 - (y + 1) / S;
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    if (!solid(x - 1, y)) quad([X(x), Y(y), -t], [X(x), Y(y + 1), -t], [X(x), Y(y + 1), t], [X(x), Y(y), t], [-1, 0, 0], uc, v0, uc, v1);
    if (!solid(x + 1, y)) quad([X(x + 1), Y(y), t], [X(x + 1), Y(y + 1), t], [X(x + 1), Y(y + 1), -t], [X(x + 1), Y(y), -t], [1, 0, 0], uc, v0, uc, v1);
    if (!solid(x, y - 1)) quad([X(x), Y(y), -t], [X(x), Y(y), t], [X(x + 1), Y(y), t], [X(x + 1), Y(y), -t], [0, 1, 0], u0, vc, u1, vc);
    if (!solid(x, y + 1)) quad([X(x), Y(y + 1), t], [X(x), Y(y + 1), -t], [X(x + 1), Y(y + 1), -t], [X(x + 1), Y(y + 1), t], [0, -1, 0], u0, vc, u1, vc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// tinted copy of a block texture for flat block items (grass, ferns, vines)
function tintedImage(name, rgb) {
  const key = name + '#tint';
  if (images[key]) return images[key];
  const src = images[name];
  const c = canvas(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(src, 0, 0);
  images[key] = c;
  return c;
}
// a potion bottle with its liquid tinted the potion's colour
function potionImage(id, potion) {
  const it = ITEMS[id];
  const key = `potion:${id}:${potion}`;
  if (images[key]) return images[key];
  const bottle = images[it.icon], over = images[it.potionIcon];
  const c = canvas(bottle.width, bottle.height), g = c.getContext('2d');
  const col = potionColor(potion);
  const t = canvas(over.width, over.height), tg = t.getContext('2d');
  tg.drawImage(over, 0, 0);
  tg.globalCompositeOperation = 'multiply';
  tg.fillStyle = '#' + col.toString(16).padStart(6, '0');
  tg.fillRect(0, 0, t.width, t.height);
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(over, 0, 0);
  g.drawImage(t, 0, 0, bottle.width, bottle.height);
  g.drawImage(bottle, 0, 0);
  images[key] = c;
  return c;
}

export function iconImage(id, potion) {
  const it = ITEMS[id];
  if (potion && it && it.potionIcon) return potionImage(id, potion);
  const name = flatIconName(id);
  if (!name) return null;
  if (name.startsWith('egg:')) return iconCanvas(name);
  if (it.tintIcon) return tintedImage(name, [110, 175, 70]);
  return images[name];
}

export function flatItemGeometry(id, potion) {
  const key = potion ? id + ':' + potion : id;
  if (flatCache.has(key)) return flatCache.get(key);
  const img = iconImage(id, potion) || images['item/stick'];
  const geo = extrude(img);
  const tex = imageTexture(img);
  const r = { geo, tex };
  flatCache.set(key, r);
  return r;
}

// block geometry in the chunk vertex format, centred at (0.5,0.5,0.5) in block units
export function blockItemGeometry(blockId, meta = 0) {
  const key = blockId * 64 + meta;
  if (blockCache.has(key)) return blockCache.get(key);
  const blocks = new Uint16Array(P * P * P);
  const light = new Uint8Array(P * P * P).fill(0xf0);
  blocks[pidx(0, 0, 0)] = blockId | (meta << 10);
  const tint = new Uint32Array(P * P).fill(0x7ab55c);
  const fol = new Uint32Array(P * P).fill(0x5fa530);
  const wat = new Uint32Array(P * P).fill(0x3f76e4);
  const out = mesher.mesh(blocks, light, { grass: tint, foliage: fol, water: wat }, 0, 0, 0);
  const geos = [];
  for (const o of out) {
    if (!o) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(o.pos, 4));
    g.setAttribute('aTex', new THREE.BufferAttribute(o.tex, 4));
    g.setAttribute('aCol', new THREE.BufferAttribute(o.col, 4, true));
    g.setAttribute('aLight', new THREE.BufferAttribute(o.light, 4));
    g.setIndex(new THREE.BufferAttribute(o.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
    geos.push(g);
  }
  blockCache.set(key, geos);
  return geos;
}

// does this item render as a 3D block?
export function isBlockModel(id) {
  const it = ITEMS[id];
  if (!it || it.block === undefined || it.icon) return false;
  const b = BLOCKS[it.block];
  return b.render !== R.CROSS && b.render !== R.NONE && b.render !== R.LIQUID;
}

// a THREE.Object3D for an item, with per-instance material(s). setLight(sky, block) updates lighting.
export function makeItemObject(id, opts = {}) {
  const group = new THREE.Group();
  const mats = [];
  if (isBlockModel(id)) {
    const geos = blockItemGeometry(ITEMS[id].block, opts.meta || defaultMeta(id));
    for (const g of geos) {
      const m = itemBlockMaterial(atlas, opts);
      mats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    group.userData.block = true;
  } else {
    const { geo, tex } = flatItemGeometry(id, opts.potion);
    const m = entityMaterial(tex, { alphaTest: 0.5, glint: opts.glint });
    if (opts.depthTest === false) m.depthTest = false;
    mats.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false;
    group.add(mesh);
    group.userData.block = false;
  }
  group.userData.mats = mats;
  group.userData.setLight = (sky, blk) => {
    for (const m of mats) {
      if (m.uniforms.uItemLight) m.uniforms.uItemLight.value.set(sky, blk);
      else m.uniforms.uLight.value.set(sky, blk);
    }
  };
  group.userData.dispose = () => { for (const m of mats) m.dispose(); };
  return group;
}

function defaultMeta(id) {
  const it = ITEMS[id];
  const b = BLOCKS[it.block];
  if (b.render === R.STAIRS) return 0;
  if (b.render === R.BOXES && b.rotate === 'facing') return 0;
  return 0;
}
