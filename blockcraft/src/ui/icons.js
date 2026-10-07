// Item icon sprite sheet: 3D block icons rendered once with WebGL, flat items from their PNGs.
import * as THREE from 'three';
import { ITEMS } from '../shared/items.js';
import { isBlockModel, makeItemObject, iconImage } from '../engine/itemmesh.js';
import { canvas } from '../engine/textures.js';
import { U } from '../engine/materials.js';

export const ICON = 64; // pixels per icon in the sheet
const COLS = 16;
const pos = new Map(); // item id -> index
export let sheetURL = '';
let sheetCanvas = null;

export function buildIcons(renderer) {
  const ids = ITEMS.filter(Boolean).map((it) => it.id);
  ids.forEach((id, i) => pos.set(id, i));
  const rows = Math.ceil(ids.length / COLS);
  const W = COLS * ICON, H = rows * ICON;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  // 3D blocks: render everything in one orthographic pass
  const gl = renderer.gl;
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, COLS, 0, -rows, -10, 10);
  cam.position.z = 5;
  const objs = [];
  const save = { daylight: U.uDaylight.value, near: U.uFogNear.value, far: U.uFogFar.value, gamma: U.uGamma.value, flash: U.uFlash.value };
  U.uDaylight.value = 1; U.uFogNear.value = 1e6; U.uFogFar.value = 2e6; U.uGamma.value = 0.5; U.uFlash.value = 0;
  U.uSkyLightColor.value.setRGB(1, 1, 1);
  ids.forEach((id, i) => {
    if (!isBlockModel(id)) return;
    const o = makeItemObject(id);
    o.userData.setLight(15, 0);
    const holder = new THREE.Group();
    holder.position.set((i % COLS) + 0.5, -(Math.floor(i / COLS) + 0.5) - 0.02, 0);
    o.rotation.set(Math.PI / 6, -Math.PI / 4, 0, 'XYZ');
    o.scale.setScalar(0.6);
    holder.add(o);
    scene.add(holder);
    objs.push(o);
  });
  const rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const prevClear = gl.getClearColor(new THREE.Color()), prevAlpha = gl.getClearAlpha();
  gl.setRenderTarget(rt);
  gl.setClearColor(0x000000, 0);
  gl.clear();
  gl.render(scene, cam);
  const px = new Uint8Array(W * H * 4);
  gl.readRenderTargetPixels(rt, 0, 0, W, H, px);
  gl.setRenderTarget(null);
  gl.setClearColor(prevClear, prevAlpha);
  rt.dispose();
  for (const o of objs) o.userData.dispose();
  U.uDaylight.value = save.daylight; U.uFogNear.value = save.near; U.uFogFar.value = save.far; U.uGamma.value = save.gamma; U.uFlash.value = save.flash;
  // flip vertically into the canvas
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  g.putImageData(img, 0, 0);

  // flat icons
  ids.forEach((id, i) => {
    if (isBlockModel(id)) return;
    const im = iconImage(id);
    if (!im) return;
    const x = (i % COLS) * ICON, y = Math.floor(i / COLS) * ICON;
    g.drawImage(im, 0, 0, im.width, Math.min(im.height, im.width), x + 4, y + 4, ICON - 8, ICON - 8);
  });
  sheetCanvas = c;
  sheetURL = c.toDataURL('image/png');
  document.documentElement.style.setProperty('--icons', `url(${sheetURL})`);
  document.documentElement.style.setProperty('--icon-cols', COLS);
  document.documentElement.style.setProperty('--icon-rows', rows);
  return c;
}

// CSS background-position for an item icon, as percentages (size independent)
export function iconStyle(id) {
  const i = pos.get(id);
  if (i === undefined) return '';
  const rows = Math.ceil(pos.size / COLS);
  const x = (i % COLS) / (COLS - 1) * 100, y = Math.floor(i / COLS) / (rows - 1) * 100;
  return `background-position:${x}% ${y}%`;
}
// the same position for a mask over the icon sheet (glint overlay)
export function iconMask(id) {
  const st = iconStyle(id);
  if (!st) return '';
  const v = st.slice(st.indexOf(':') + 1);
  return `-webkit-mask-position:${v};mask-position:${v}`;
}

// draw an icon into a 2D canvas context (e.g. toasts)
export function drawIcon(ctx, id, x, y, size) {
  const i = pos.get(id);
  if (i === undefined || !sheetCanvas) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheetCanvas, (i % COLS) * ICON, Math.floor(i / COLS) * ICON, ICON, ICON, x, y, size, size);
}
