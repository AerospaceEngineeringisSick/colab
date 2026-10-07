// Loads the embedded PNGs, builds the block texture array (one 16x16 layer per
// texture / animation frame) and exposes helpers for icons and item sprites.
import * as THREE from 'three';
import { blockTextureNames } from '../shared/blocks.js';

export const images = {}; // 'block/stone' -> HTMLCanvasElement (16x16 or source size)
export const texInfo = {}; // block texture name -> { layer, frames }
export let blockArray = null; // THREE.DataArrayTexture
export let layerCount = 0;
export let layerPixels = null; // Uint8Array RGBA for every layer (for particles/icons)

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export { canvas };

async function decode(b64) {
  // createImageBitmap from bytes: reliable even for hundreds of images
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let src;
  try {
    src = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  } catch (e) {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    src = img;
  }
  const c = canvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  if (src.close) src.close();
  return c;
}

export async function loadImages(onProgress) {
  const T = window.ASSETS.textures;
  const keys = Object.keys(T);
  const bad = [];
  let done = 0;
  // decode in small batches; browsers refuse very large parallel decode bursts
  for (let i = 0; i < keys.length; i += 24) {
    await Promise.all(keys.slice(i, i + 24).map(async (k) => {
      try { images[k] = await decode(T[k]); } catch (e) {
        try { images[k] = await decode(T[k]); } catch (e2) { bad.push(k); images[k] = canvas(16, 16); }
      }
      done++;
    }));
    if (onProgress) onProgress(done / keys.length);
  }
  if (bad.length) console.warn('undecodable textures: ' + bad.join(', '));
  buildDerived();
}

// copy a w x h region of src (canvas) at (sx,sy) to dst ctx at (dx,dy), optional transform fn
function blit(ctx, src, sx, sy, w, h, dx, dy) {
  ctx.drawImage(src, sx, sy, w, h, dx, dy, w, h);
}

function buildDerived() {
  // chest faces from the 64x64 entity texture (lid 14x5 over base 14x10)
  const ch = images['entity/chest'];
  {
    const top = canvas(16, 16), t = top.getContext('2d');
    blit(t, ch, 14, 0, 14, 14, 1, 1);
    images['block/chest_top'] = top;
    const front = canvas(16, 16), f = front.getContext('2d');
    blit(f, ch, 14, 14, 14, 5, 1, 2); // lid front
    blit(f, ch, 14, 34, 14, 9, 1, 7); // base front
    blit(f, ch, 1, 1, 2, 4, 7, 5); // latch
    images['block/chest_front'] = front;
    const side = canvas(16, 16), s = side.getContext('2d');
    blit(s, ch, 0, 14, 14, 5, 1, 2);
    blit(s, ch, 0, 34, 14, 9, 1, 7);
    images['block/chest_side'] = side;
  }
  // bed faces from the 64x64 entity texture
  const bd = images['entity/bed'];
  const planks = images['block/oak_planks'];
  {
    const mk = (fn) => { const c = canvas(16, 16); fn(c.getContext('2d')); return c; };
    images['block/bed_head_top'] = mk((g) => blit(g, bd, 6, 6, 16, 16, 0, 0));
    images['block/bed_foot_top'] = mk((g) => blit(g, bd, 6, 28, 16, 16, 0, 0));
    // sides: the 6-wide strip rotated to 16 wide x 6 tall, frame below
    const strip = (g, sy) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 6; j++) {
        // strip column (5-j) at row sy+i -> side pixel (i, 7+j)
        g.drawImage(bd, 5 - j, sy + i, 1, 1, 15 - i, 7 + j, 1, 1);
      }
      g.drawImage(planks, 0, 13, 16, 3, 0, 13, 16, 3);
    };
    images['block/bed_head_side'] = mk((g) => strip(g, 6));
    images['block/bed_foot_side'] = mk((g) => strip(g, 28));
    images['block/bed_head_end'] = mk((g) => { blit(g, bd, 6, 0, 16, 6, 0, 7); g.drawImage(planks, 0, 13, 16, 3, 0, 13, 16, 3); });
    images['block/bed_foot_end'] = mk((g) => { blit(g, bd, 22, 22, 16, 6, 0, 7); g.drawImage(planks, 0, 13, 16, 3, 0, 13, 16, 3); });
  }
  // tintable textures: convert to grey and normalise brightness, like vanilla's greyscale art
  const grey = (name, target) => {
    const c = images[name];
    if (!c) return;
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    let sum = 0, n = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 8) continue;
      const l = (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11);
      p[i] = p[i + 1] = p[i + 2] = l;
      sum += l; n++;
    }
    const k = n ? (target * 255) / (sum / n) : 1;
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.min(255, p[i] * k);
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    g.putImageData(d, 0, 0);
  };
  grey('block/grass_top', 0.64);
  grey('block/grass_side_overlay', 0.66);
  for (const w of ['oak', 'jungle', 'acacia', 'dark_oak', 'birch', 'spruce']) grey(`block/${w}_leaves`, 0.6);
  grey('block/short_grass', 0.68);
  grey('block/fern', 0.66);
  grey('block/sugar_cane', 0.72);
  grey('block/water_still', 0.82);
  grey('block/water_flow', 0.82);
  // turned copies for faces whose art has a direction (piston sides, redstone dust arms)
  const rotated = (name, deg) => {
    const src = images[name];
    if (!src) return;
    const c = canvas(src.width, src.height), g = c.getContext('2d');
    g.translate(src.width / 2, src.height / 2);
    g.rotate(deg * Math.PI / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    images[name + '_' + deg] = c;
  };
  for (const d of [90, 180, 270]) rotated('block/piston_side', d);
  rotated('block/redstone_dust_line', 90);
}

// -------------------------------------------------------------------- array
export function buildBlockArray() {
  const names = blockTextureNames();
  // particle sprites share the array
  const extra = ['env/smoke', 'env/flame', 'env/bonemeal', 'env/bubble', 'env/lava_particle', 'env/rain', 'env/snowflake'];
  // enchanting glyphs (6x6) become 16x16 particle sprites at double size
  for (let i = 1; i <= 18; i++) {
    const src = images['gui/glyph_' + i];
    if (!src) continue;
    const c = canvas(16, 16), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 2, 2, 12, 12);
    images['env/glyph_' + i] = c;
    extra.push('env/glyph_' + i);
  }
  const list = [];
  for (const n of names) {
    const c = images['block/' + n];
    if (!c) { console.warn('missing block texture', n); continue; }
    list.push([n, c]);
  }
  for (const n of extra) if (images[n]) list.push([n, images[n]]);
  let layers = 0;
  for (const [n, c] of list) {
    const frames = c.height > c.width ? Math.floor(c.height / c.width) : 1;
    texInfo[n] = { layer: layers, frames };
    layers += frames;
  }
  const S = 16;
  const data = new Uint8Array(S * S * 4 * layers);
  const tmp = canvas(S, S);
  const tg = tmp.getContext('2d', { willReadFrequently: true });
  for (const [n, c] of list) {
    const { layer, frames } = texInfo[n];
    const fw = c.width;
    for (let f = 0; f < frames; f++) {
      tg.clearRect(0, 0, S, S);
      tg.imageSmoothingEnabled = false;
      tg.drawImage(c, 0, f * fw, fw, fw, 0, 0, S, S);
      const px = tg.getImageData(0, 0, S, S).data;
      bleed(px, S);
      data.set(px, (layer + f) * S * S * 4);
    }
  }
  layerCount = layers;
  layerPixels = data;
  const t = new THREE.DataArrayTexture(data, S, S, layers);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  blockArray = t;
  return t;
}

// fill fully transparent texels with neighbouring colours so mipmaps don't darken edges
function bleed(px, S) {
  const src = px.slice();
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (src[i + 3] > 0) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
      const j = (yy * S + xx) * 4;
      if (src[j + 3] > 0) { r += src[j]; g += src[j + 1]; b += src[j + 2]; n++; }
    }
    if (n) { px[i] = r / n; px[i + 1] = g / n; px[i + 2] = b / n; }
  }
}

// RGBA pixels (16x16) of a layer, e.g. for particles
export function layerData(layer) {
  return layerPixels.subarray(layer * 1024, layer * 1024 + 1024);
}

// average colour of a texture (for map/particles)
export function avgColor(name) {
  const t = texInfo[name];
  if (!t) return [128, 128, 128];
  const d = layerData(t.layer);
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

// make a three.js texture from an image (entities, items, sky)
const texCache = new Map();
// villager skin = base + biome outfit + profession layer (vanilla draws them as separate layers on one model)
export function villagerTexture(type, prof) {
  const name = `entity/villager_${type}_${prof}`;
  if (images[name]) return name;
  const c = canvas(64, 64), g = c.getContext('2d');
  for (const n of ['entity/villager_base', 'entity/villager_' + type, prof ? 'entity/villager_profession_' + prof : null]) if (n && images[n]) g.drawImage(images[n], 0, 0);
  images[name] = c;
  return name;
}

export function imageTexture(name, opts = {}) {
  // canvases are keyed by identity (string concatenation would collapse them all into one key)
  if (typeof name !== 'string') {
    let m = objTexCache.get(name);
    if (!m) objTexCache.set(name, m = {});
    const k = opts.repeat ? 'r' : 'n';
    if (!m[k]) m[k] = canvasTexture(name, opts);
    return m[k];
  }
  const key = name + (opts.repeat ? '#r' : '');
  if (texCache.has(key)) return texCache.get(key);
  const c = images[name];
  if (!c) throw new Error('no image ' + name);
  const t = canvasTexture(c, opts);
  texCache.set(key, t);
  return t;
}
const objTexCache = new WeakMap();
function canvasTexture(c, opts) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
