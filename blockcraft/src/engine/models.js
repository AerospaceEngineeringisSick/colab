// Box models with Minecraft-style skin UV layout.
// Coordinates are in pixels (1/16 block), Y up, models face +Z.
import * as THREE from 'three';
import { entityMaterial } from './materials.js';
import { imageTexture, images } from './textures.js';

// Build a box geometry: origin o (min corner relative to the part pivot), size s, texture offset uv.
export function boxGeometry(o, s, uv, texW, texH, opts = {}) {
  const inf = opts.inflate || 0;
  const [w, h, d] = s;
  const x0 = o[0] - inf, y0 = o[1] - inf, z0 = o[2] - inf;
  const x1 = o[0] + w + inf, y1 = o[1] + h + inf, z1 = o[2] + d + inf;
  const [u, v] = uv;
  // pixel rects [u0, v0, u1, v1]
  let R = {
    top: [u + d, v, u + d + w, v + d],
    bottom: [u + d + w, v, u + d + w + w, v + d],
    right: [u, v + d, u + d, v + d + h], // -X side (model's right)
    front: [u + d, v + d, u + d + w, v + d + h], // +Z
    left: [u + d + w, v + d, u + d + w + d, v + d + h], // +X
    back: [u + d + w + d, v + d, u + d + w + d + w, v + d + h], // -Z
  };
  if (opts.mirror) {
    const m = (r) => [r[2], r[1], r[0], r[3]];
    R = { top: m(R.top), bottom: m(R.bottom), right: m(R.left), front: m(R.front), left: m(R.right), back: m(R.back) };
  }
  const pos = [], uvs = [], nor = [], idx = [];
  // quad corners TL, BL, BR, TR (as seen from outside) with uv rect
  const quad = (a, b, c, e, n, r) => {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...e);
    const U0 = r[0] / texW, U1 = r[2] / texW, V0 = 1 - r[1] / texH, V1 = 1 - r[3] / texH;
    uvs.push(U0, V0, U0, V1, U1, V1, U1, V0);
    for (let k = 0; k < 4; k++) nor.push(...n);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  const S = 1 / 16;
  const P = (x, y, z) => [x * S, y * S, z * S];
  quad(P(x0, y1, z1), P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), [0, 0, 1], R.front);
  quad(P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), [0, 0, -1], R.back);
  quad(P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), [-1, 0, 0], R.right);
  quad(P(x1, y1, z1), P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), [1, 0, 0], R.left);
  quad(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), [0, 1, 0], R.top);
  quad(P(x0, y0, z1), P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), [0, -1, 0], R.bottom);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ model definitions
// part: { pivot:[x,y,z], boxes:[{o,s,uv,inflate,mirror,layer}], rot:[x,y,z] }
const biped = (tw, th, legacy, armW = 4) => ({
  tex: [tw, th],
  parts: {
    body: { pivot: [0, 24, 0], boxes: [{ o: [-4, -12, -2], s: [8, 12, 4], uv: [16, 16] }].concat(legacy ? [] : [{ o: [-4, -12, -2], s: [8, 12, 4], uv: [16, 32], inflate: 0.25, layer: 1 }]) },
    head: { pivot: [0, 24, 0], boxes: [{ o: [-4, 0, -4], s: [8, 8, 8], uv: [0, 0] }, { o: [-4, 0, -4], s: [8, 8, 8], uv: [32, 0], inflate: 0.5, layer: 1 }] },
    rightArm: { pivot: [-5, 22, 0], boxes: [{ o: [armW === 4 ? -3 : -2, -10, -2], s: [armW, 12, 4], uv: [40, 16] }].concat(legacy ? [] : [{ o: [armW === 4 ? -3 : -2, -10, -2], s: [armW, 12, 4], uv: [40, 32], inflate: 0.25, layer: 1 }]) },
    leftArm: { pivot: [5, 22, 0], boxes: legacy ? [{ o: [-1, -10, -2], s: [armW, 12, 4], uv: [40, 16], mirror: true }] : [{ o: [-1, -10, -2], s: [armW, 12, 4], uv: [32, 48] }, { o: [-1, -10, -2], s: [armW, 12, 4], uv: [48, 48], inflate: 0.25, layer: 1 }] },
    rightLeg: { pivot: [-1.9, 12, 0], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }].concat(legacy ? [] : [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 32], inflate: 0.25, layer: 1 }]) },
    leftLeg: { pivot: [1.9, 12, 0], boxes: legacy ? [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16], mirror: true }] : [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [16, 48] }, { o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 48], inflate: 0.25, layer: 1 }] },
  },
});

const PI = Math.PI;
// boat paddle (side 1 = left, -1 = right): shaft plus blade
const paddle = (uv, side) => ({
  pivot: [3, 11, side * -9], rot: [0, side > 0 ? 0 : -PI, -0.19634955],
  boxes: [{ o: [-1, -2, -13], s: [2, 2, 18], uv }, { o: [side > 0 ? -1.001 : 0.001, -3, -15], s: [1, 6, 7], uv }],
});

export const MODELS = {
  // vanilla boat (128x64), long axis along x; the renderer turns it to face +z
  boat: {
    tex: [128, 64],
    parts: {
      bottom: { pivot: [0, 3, -1], rot: [PI / 2, 0, 0], boxes: [{ o: [-14, -7, 0], s: [28, 16, 3], uv: [0, 0] }] },
      back: { pivot: [-15, 2, -4], rot: [0, -PI * 1.5, 0], boxes: [{ o: [-13, 1, -1], s: [18, 6, 2], uv: [0, 19] }] },
      front: { pivot: [15, 2, 0], rot: [0, -PI / 2, 0], boxes: [{ o: [-8, 1, -1], s: [16, 6, 2], uv: [0, 27] }] },
      right: { pivot: [0, 2, 9], rot: [0, -PI, 0], boxes: [{ o: [-14, 1, -1], s: [28, 6, 2], uv: [0, 35] }] },
      left: { pivot: [0, 2, -9], boxes: [{ o: [-14, 1, -1], s: [28, 6, 2], uv: [0, 43] }] },
      leftPaddle: paddle([62, 0], 1),
      rightPaddle: paddle([62, 20], -1),
    },
  },
  // vanilla minecart (64x32), long axis along x
  minecart: {
    tex: [64, 32],
    parts: {
      bottom: { pivot: [0, 2, 0], rot: [PI / 2, 0, 0], boxes: [{ o: [-10, -8, -1], s: [20, 16, 2], uv: [0, 10] }] },
      front: { pivot: [-9, 2, 0], rot: [0, -PI * 1.5, 0], boxes: [{ o: [-8, 1, -1], s: [16, 8, 2], uv: [0, 0] }] },
      back: { pivot: [9, 2, 0], rot: [0, -PI / 2, 0], boxes: [{ o: [-8, 1, -1], s: [16, 8, 2], uv: [0, 0] }] },
      left: { pivot: [0, 2, 7], rot: [0, -PI, 0], boxes: [{ o: [-8, 1, -1], s: [16, 8, 2], uv: [0, 0] }] },
      right: { pivot: [0, 2, -7], boxes: [{ o: [-8, 1, -1], s: [16, 8, 2], uv: [0, 0] }] },
    },
  },
  player: biped(64, 32, true),
  zombie: biped(64, 64, true),
  skeleton: {
    tex: [64, 32],
    parts: {
      body: { pivot: [0, 24, 0], boxes: [{ o: [-4, -12, -2], s: [8, 12, 4], uv: [16, 16] }] },
      head: { pivot: [0, 24, 0], boxes: [{ o: [-4, 0, -4], s: [8, 8, 8], uv: [0, 0] }] },
      rightArm: { pivot: [-5, 22, 0], boxes: [{ o: [-1, -10, -1], s: [2, 12, 2], uv: [40, 16] }] },
      leftArm: { pivot: [5, 22, 0], boxes: [{ o: [-1, -10, -1], s: [2, 12, 2], uv: [40, 16], mirror: true }] },
      rightLeg: { pivot: [-2, 12, 0], boxes: [{ o: [-1, -12, -1], s: [2, 12, 2], uv: [0, 16] }] },
      leftLeg: { pivot: [2, 12, 0], boxes: [{ o: [-1, -12, -1], s: [2, 12, 2], uv: [0, 16], mirror: true }] },
    },
  },
  creeper: {
    tex: [64, 32],
    parts: {
      body: { pivot: [0, 6, 0], boxes: [{ o: [-4, 0, -2], s: [8, 12, 4], uv: [16, 16] }] },
      head: { pivot: [0, 18, 0], boxes: [{ o: [-4, 0, -4], s: [8, 8, 8], uv: [0, 0] }] },
      leg0: { pivot: [-2, 6, -4], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
      leg1: { pivot: [2, 6, -4], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
      leg2: { pivot: [-2, 6, 4], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
      leg3: { pivot: [2, 6, 4], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
    },
  },
  spider: {
    tex: [64, 32],
    parts: {
      head: { pivot: [0, 9, 3], boxes: [{ o: [-4, -4, 0], s: [8, 8, 8], uv: [32, 4] }] },
      neck: { pivot: [0, 9, 0], boxes: [{ o: [-3, -3, -3], s: [6, 6, 6], uv: [0, 0] }] },
      body: { pivot: [0, 9, -9], boxes: [{ o: [-5, -4, -6], s: [10, 8, 12], uv: [0, 12] }] },
      ...Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const left = i % 2 === 1; // +X side
        const zi = [-2, -1, 0, 1][i >> 1];
        return ['leg' + i, { pivot: [left ? 4 : -4, 9, zi], boxes: [{ o: [left ? -1 : -15, -1, -1], s: [16, 2, 2], uv: [18, 0], mirror: left }] }];
      })),
    },
  },
  enderman: {
    tex: [64, 32],
    parts: {
      body: { pivot: [0, 38, 0], boxes: [{ o: [-4, -12, -2], s: [8, 12, 4], uv: [32, 16] }] },
      head: { pivot: [0, 38, 0], boxes: [{ o: [-4, 0, -4], s: [8, 8, 8], uv: [0, 0] }, { o: [-4, 0, -4], s: [8, 8, 8], uv: [0, 16], inflate: -0.5 }] },
      rightArm: { pivot: [-5, 36, 0], boxes: [{ o: [-1, -28, -1], s: [2, 30, 2], uv: [56, 0] }] },
      leftArm: { pivot: [5, 36, 0], boxes: [{ o: [-1, -28, -1], s: [2, 30, 2], uv: [56, 0], mirror: true }] },
      rightLeg: { pivot: [-2, 29, 0], boxes: [{ o: [-1, -30, -1], s: [2, 30, 2], uv: [56, 0] }] },
      leftLeg: { pivot: [2, 29, 0], boxes: [{ o: [-1, -30, -1], s: [2, 30, 2], uv: [56, 0], mirror: true }] },
    },
  },
  pig: {
    tex: [64, 32],
    parts: {
      head: { pivot: [0, 12, 6], boxes: [{ o: [-4, -4, 0], s: [8, 8, 8], uv: [0, 0] }, { o: [-2, -3, 8], s: [4, 3, 1], uv: [16, 16] }] },
      body: { pivot: [0, 13, -2], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-5, -6, -1], s: [10, 16, 8], uv: [28, 8] }] },
      leg0: { pivot: [-3, 6, -7], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
      leg1: { pivot: [3, 6, -7], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
      leg2: { pivot: [-3, 6, 5], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
      leg3: { pivot: [3, 6, 5], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16] }] },
    },
  },
  cow: {
    tex: [64, 32],
    parts: {
      head: { pivot: [0, 20, 8], boxes: [{ o: [-4, -4, 0], s: [8, 8, 6], uv: [0, 0] }, { o: [-5, 2, 1], s: [1, 3, 1], uv: [22, 0] }, { o: [4, 2, 1], s: [1, 3, 1], uv: [22, 0] }] },
      body: { pivot: [0, 19, -2], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-6, -8, -3], s: [12, 18, 10], uv: [18, 4] }, { o: [-2, -8, 7], s: [4, 6, 1], uv: [52, 0] }] },
      leg0: { pivot: [-4, 12, -7], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
      leg1: { pivot: [4, 12, -7], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
      leg2: { pivot: [-4, 12, 6], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
      leg3: { pivot: [4, 12, 6], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
    },
  },
  sheep: {
    tex: [64, 32],
    parts: {
      head: { pivot: [0, 18, 8], boxes: [{ o: [-3, -2, -2], s: [6, 6, 8], uv: [0, 0] }] },
      body: { pivot: [0, 19, -2], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-4, -6, 1], s: [8, 16, 6], uv: [28, 8] }] },
      leg0: { pivot: [-3, 12, -7], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
      leg1: { pivot: [3, 12, -7], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
      leg2: { pivot: [-3, 12, 5], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
      leg3: { pivot: [3, 12, 5], boxes: [{ o: [-2, -12, -2], s: [4, 12, 4], uv: [0, 16] }] },
    },
  },
  sheep_fur: {
    tex: [64, 32],
    parts: {
      head: { pivot: [0, 18, 8], boxes: [{ o: [-3, -2, -2], s: [6, 6, 6], uv: [0, 0], inflate: 0.6 }] },
      body: { pivot: [0, 19, -2], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-4, -6, 1], s: [8, 16, 6], uv: [28, 8], inflate: 1.75 }] },
      leg0: { pivot: [-3, 12, -7], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16], inflate: 0.5 }] },
      leg1: { pivot: [3, 12, -7], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16], inflate: 0.5 }] },
      leg2: { pivot: [-3, 12, 5], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16], inflate: 0.5 }] },
      leg3: { pivot: [3, 12, 5], boxes: [{ o: [-2, -6, -2], s: [4, 6, 4], uv: [0, 16], inflate: 0.5 }] },
    },
  },
  chicken: {
    tex: [64, 32],
    parts: {
      head: { pivot: [0, 9, 4], boxes: [{ o: [-2, 0, -1], s: [4, 6, 3], uv: [0, 0] }, { o: [-2, 2, 2], s: [4, 2, 2], uv: [14, 0] }, { o: [-1, 0, 1], s: [2, 2, 2], uv: [14, 4] }] },
      body: { pivot: [0, 8, 0], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-3, -4, -3], s: [6, 8, 6], uv: [0, 9] }] },
      leg0: { pivot: [-2, 5, -1], boxes: [{ o: [-1, -5, 0], s: [3, 5, 3], uv: [26, 0] }] },
      leg1: { pivot: [1, 5, -1], boxes: [{ o: [-1, -5, 0], s: [3, 5, 3], uv: [26, 0] }] },
      rightWing: { pivot: [-4, 11, 0], boxes: [{ o: [0, -4, -3], s: [1, 4, 6], uv: [24, 13] }] },
      leftWing: { pivot: [4, 11, 0], boxes: [{ o: [-1, -4, -3], s: [1, 4, 6], uv: [24, 13] }] },
    },
  },
  wolf: {
    tex: [64, 32],
    parts: {
      head: { pivot: [-1, 10.5, 7], boxes: [{ o: [-3, -3, -2], s: [6, 6, 4], uv: [0, 0] }, { o: [-3, 3, -1], s: [2, 2, 1], uv: [16, 14] }, { o: [1, 3, -1], s: [2, 2, 1], uv: [16, 14] }, { o: [-1.5, -3, 1], s: [3, 3, 4], uv: [0, 10] }] },
      body: { pivot: [0, 10, -2], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-4, -7, -3], s: [6, 9, 6], uv: [18, 14] }] },
      mane: { pivot: [-1, 10, 3], rot: [Math.PI / 2, 0, 0], boxes: [{ o: [-4, -3, -4], s: [8, 6, 7], uv: [21, 0] }] },
      leg0: { pivot: [-2.5, 8, -7], boxes: [{ o: [0, -8, -1], s: [2, 8, 2], uv: [0, 18] }] },
      leg1: { pivot: [0.5, 8, -7], boxes: [{ o: [0, -8, -1], s: [2, 8, 2], uv: [0, 18] }] },
      leg2: { pivot: [-2.5, 8, 4], boxes: [{ o: [0, -8, -1], s: [2, 8, 2], uv: [0, 18] }] },
      leg3: { pivot: [0.5, 8, 4], boxes: [{ o: [0, -8, -1], s: [2, 8, 2], uv: [0, 18] }] },
      tail: { pivot: [-1, 12, -8], rot: [0.63, 0, 0], boxes: [{ o: [0, -8, -1], s: [2, 8, 2], uv: [9, 18] }] },
    },
  },
};

// instantiate a model as a THREE.Group of part groups
export function buildModel(def, texName, opts = {}) {
  const tex = imageTexture(texName);
  const [tw, th] = opts.texSize || def.tex;
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(opts.scale || 1);
  root.add(inner);
  const mat = entityMaterial(tex, { alphaTest: 0.1, side: THREE.DoubleSide });
  const mats = [mat];
  let overlayMat = null;
  const parts = {};
  for (const [name, p] of Object.entries(def.parts)) {
    const g = new THREE.Group();
    g.position.set(p.pivot[0] / 16, p.pivot[1] / 16, p.pivot[2] / 16);
    if (p.rot) g.rotation.set(p.rot[0], p.rot[1], p.rot[2]);
    g.userData.base = p.rot ? p.rot.slice() : [0, 0, 0];
    for (const b of p.boxes) {
      let m = mat;
      if (b.layer === 1) {
        if (opts.noOverlay) continue;
        if (!overlayMat) { overlayMat = entityMaterial(tex, { alphaTest: 0.1, side: THREE.DoubleSide }); mats.push(overlayMat); }
        m = overlayMat;
      }
      const mesh = new THREE.Mesh(boxGeometry(b.o, b.s, b.uv, tw, th, b), m);
      g.add(mesh);
    }
    inner.add(g);
    parts[name] = g;
  }
  return { root, inner, parts, mats, tex };
}

// glowing eyes layer (spider, enderman) built on the same parts
export function addEyes(model, def, texName) {
  if (!images[texName]) return;
  const tex = imageTexture(texName);
  const mat = entityMaterial(tex, { alphaTest: 0.1, fullbright: true, polygonOffset: true });
  const [tw, th] = def.tex;
  const p = def.parts.head;
  const b = p.boxes[0];
  const mesh = new THREE.Mesh(boxGeometry(b.o, b.s, b.uv, tw, th, { inflate: 0.02 }), mat);
  model.parts.head.add(mesh);
  model.mats.push(mat);
  model.eyeMat = mat;
}
