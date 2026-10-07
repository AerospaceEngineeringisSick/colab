// The book floating above an enchanting table: turns toward a nearby player, opens and flips pages (vanilla animation).
import * as THREE from 'three';
import { boxGeometry } from './models.js';
import { entityMaterial } from './materials.js';
import { imageTexture } from './textures.js';

const TAU = Math.PI * 2;
const wrap = (a) => { while (a >= Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// a vanilla model box in block space: block-entity renderers do not flip models like entity renderers do,
// so build it in our entity convention and turn it back over
function box(o, s, uv) {
  const g = boxGeometry([o[0], -(o[1] + s[1]), -(o[2] + s[2])], s, uv, 64, 32);
  g.rotateX(Math.PI);
  return g;
}
let GEO = null;
function geometries() {
  if (GEO) return GEO;
  GEO = {
    leftLid: box([-6, -5, -0.005], [6, 10, 0.005], [0, 0]),
    rightLid: box([0, -5, -0.005], [6, 10, 0.005], [16, 0]),
    seam: box([-1, -5, 0], [2, 10, 0.005], [12, 0]),
    leftPages: box([0, -4, -0.99], [5, 8, 1], [0, 10]),
    rightPages: box([0, -4, -0.01], [5, 8, 1], [12, 10]),
    flip: box([0, -4, 0], [5, 8, 0.005], [24, 10]),
  };
  return GEO;
}

export class EnchantBook {
  constructor(scene, x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.time = Math.floor(Math.random() * 1000);
    this.flip = this.oFlip = this.flipT = this.flipA = 0;
    this.open = this.oOpen = 0;
    this.rot = this.oRot = this.tRot = 0;
    const G = geometries();
    this.mat = entityMaterial(imageTexture('entity/enchanting_book'), { alphaTest: 0.1, side: THREE.DoubleSide });
    const part = (geo, px = 0, py = 0, pz = 0) => {
      const g = new THREE.Group();
      g.position.set(px / 16, py / 16, pz / 16);
      g.rotation.order = 'ZYX';
      const m = new THREE.Mesh(geo, this.mat);
      m.frustumCulled = false;
      g.add(m);
      this.root.add(g);
      return g;
    };
    this.root = new THREE.Group();
    this.root.rotation.order = 'YZX';
    this.p = {
      leftLid: part(G.leftLid, 0, 0, -1),
      rightLid: part(G.rightLid, 0, 0, 1),
      seam: part(G.seam),
      leftPages: part(G.leftPages),
      rightPages: part(G.rightPages),
      flip1: part(G.flip),
      flip2: part(G.flip),
    };
    this.p.seam.rotation.y = Math.PI / 2;
    scene.add(this.root);
    this.scene = scene;
  }

  // 20 Hz; player = {x, z} or null when nobody is within 3 blocks
  tick(player) {
    this.oOpen = this.open;
    this.oRot = this.rot;
    if (player) {
      this.tRot = Math.atan2(player.z - (this.z + 0.5), player.x - (this.x + 0.5));
      this.open += 0.1;
      if (this.open < 0.5 || Math.random() < 1 / 40) {
        const f = this.flipT;
        do { this.flipT += Math.floor(Math.random() * 4) - Math.floor(Math.random() * 4); } while (f === this.flipT);
      }
    } else {
      this.tRot += 0.02;
      this.open -= 0.1;
    }
    this.rot = wrap(this.rot);
    this.tRot = wrap(this.tRot);
    this.rot += wrap(this.tRot - this.rot) * 0.4;
    this.open = clamp(this.open, 0, 1);
    this.time++;
    this.oFlip = this.flip;
    const d = clamp((this.flipT - this.flip) * 0.4, -0.2, 0.2);
    this.flipA += (d - this.flipA) * 0.9;
    this.flip += this.flipA;
  }

  render(a, light) {
    const t = this.time + a;
    const r = this.root;
    r.position.set(this.x + 0.5, this.y + 0.75 + 0.1 + Math.sin(t * 0.1) * 0.01, this.z + 0.5);
    const rot = this.oRot + wrap(this.rot - this.oRot) * a;
    r.rotation.set(0, -rot, 80 * Math.PI / 180);
    const fl = lerp(this.oFlip, this.flip, a);
    const f1 = clamp((fl + 0.25) - Math.floor(fl + 0.25), 0, 1) * 1.6 - 0.3;
    const f2 = clamp((fl + 0.75) - Math.floor(fl + 0.75), 0, 1) * 1.6 - 0.3;
    const open = lerp(this.oOpen, this.open, a);
    const f = (Math.sin(t * 0.02) * 0.1 + 1.25) * open;
    const P = this.p;
    P.leftLid.rotation.y = Math.PI + f;
    P.rightLid.rotation.y = -f;
    P.leftPages.rotation.y = f;
    P.rightPages.rotation.y = -f;
    P.flip1.rotation.y = f - f * 2 * clamp(f1, 0, 1);
    P.flip2.rotation.y = f - f * 2 * clamp(f2, 0, 1);
    const sx = Math.sin(f) / 16;
    P.leftPages.position.x = P.rightPages.position.x = P.flip1.position.x = P.flip2.position.x = sx;
    this.mat.uniforms.uLight.value.set(light[0], light[1]);
  }

  dispose() {
    this.scene.remove(this.root);
    this.mat.dispose();
  }
}
