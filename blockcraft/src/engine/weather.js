// Rain and snow drawn as scrolling textured columns around the player, like vanilla.
import * as THREE from 'three';
import { images, canvas } from './textures.js';
import { U } from './materials.js';
import { snowsAt } from '../shared/biomes.js';

const R = 10; // radius in blocks
const MAXQ = (2 * R + 1) * (2 * R + 1) * 2;

function stripTexture(name, w, h, draw) {
  const c = canvas(w, h), g = c.getContext('2d');
  draw(g, c);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  void name;
  return t;
}

export class Weather {
  constructor(scene) {
    // rain: thin streaks scattered over a tile; snow: flakes from the snowflake sprite
    const drop = images['env/rain'];
    this.rainTex = stripTexture('rain', 32, 64, (g) => {
      for (let i = 0; i < 14; i++) {
        const x = (i * 7 + (i % 3) * 5) % 32, y = (i * 23) % 64;
        g.fillStyle = 'rgba(160,190,255,0.85)';
        g.fillRect(x, y, 1, 6 + (i % 4) * 2);
        if (drop) g.drawImage(drop, 0, 0, drop.width, drop.height, x, y, 1, 7);
      }
    });
    const flake = images['env/snowflake'];
    this.snowTex = stripTexture('snow', 32, 64, (g) => {
      for (let i = 0; i < 16; i++) {
        const x = (i * 11 + (i % 2) * 3) % 30, y = (i * 17) % 60;
        if (flake) g.drawImage(flake, 0, 0, flake.width, flake.height, x, y, 3, 3);
        else { g.fillStyle = '#fff'; g.fillRect(x, y, 2, 2); }
      }
    });
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXQ * 4 * 3);
    this.uv = new Float32Array(MAXQ * 4 * 2);
    this.extra = new Float32Array(MAXQ * 4 * 2); // light, alpha
    const idx = new Uint32Array(MAXQ * 6);
    for (let q = 0; q < MAXQ; q++) {
      const b = q * 4, o = q * 6;
      idx.set([b, b + 1, b + 2, b, b + 2, b + 3], o);
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aExtra', new THREE.BufferAttribute(this.extra, 2).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mk = (tex, snow) => new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uScroll: { value: 0 }, uDaylight: U.uDaylight, uFogColor: U.uFogColor, uSnow: { value: snow ? 1 : 0 } },
      vertexShader: /* glsl */`
        attribute vec2 aExtra; varying vec2 vUv; varying vec2 vE; varying float vD;
        void main() { vUv = uv; vE = aExtra; vec4 w = modelMatrix * vec4(position, 1.0); vD = length(w.xz - cameraPosition.xz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; uniform float uScroll; uniform float uDaylight; uniform vec3 uFogColor; uniform float uSnow;
        varying vec2 vUv; varying vec2 vE; varying float vD;
        void main() {
          vec2 uv = vUv + vec2(uSnow * sin(vUv.y * 3.0 + uScroll * 2.0) * 0.08, uScroll);
          vec4 c = texture2D(uMap, uv);
          float a = c.a * vE.y * (1.0 - smoothstep(4.0, 10.0, vD));
          if (a < 0.02) discard;
          float l = max(0.25, vE.x * uDaylight);
          gl_FragColor = vec4(c.rgb * l, a * 0.7);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.rainMat = mk(this.rainTex, false);
    this.snowMat = mk(this.snowTex, true);
    this.rainMesh = new THREE.Mesh(g, this.rainMat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.renderOrder = 8;
    scene.add(this.rainMesh);
    // snow uses a second geometry
    this.sgeo = g.clone();
    this.spos = this.sgeo.attributes.position.array;
    this.suv = this.sgeo.attributes.uv.array;
    this.sext = this.sgeo.attributes.aExtra.array;
    this.snowMesh = new THREE.Mesh(this.sgeo, this.snowMat);
    this.snowMesh.frustumCulled = false;
    this.snowMesh.renderOrder = 8;
    scene.add(this.snowMesh);
    this.t = 0;
    this.lastCell = '';
    this.timer = 0;
  }

  // world: World, cam: camera position, amount 0..1
  update(world, game, cam, amount, dt) {
    this.t += dt;
    this.rainMat.uniforms.uScroll.value = (this.t * 1.6) % 1;
    this.snowMat.uniforms.uScroll.value = (this.t * 0.22) % 1;
    const vis = amount > 0.02;
    this.rainMesh.visible = vis; this.snowMesh.visible = vis;
    if (!vis) return;
    this.timer -= dt;
    const cx = Math.floor(cam.x), cz = Math.floor(cam.z), cy = cam.y;
    const key = cx + ',' + cz + ',' + Math.floor(cy);
    if (key === this.lastCell && this.timer > 0) { this.setAlpha(amount); return; }
    this.lastCell = key; this.timer = 0.25;
    let nr = 0, ns = 0;
    const yaw = 0;
    void yaw;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R) continue;
      const x = cx + dx, z = cz + dz;
      const bio = world.biomeAt(x, z);
      if (bio.dry) continue;
      const top = world.rainY(x, z);
      if (top < 0) continue;
      const y0 = Math.max(top + 1, Math.floor(cy) - R);
      const y1 = Math.floor(cy) + R;
      if (y0 >= y1) continue;
      const snow = snowsAt(bio, top);
      const l = (world.getLight(x, Math.min(127, top + 1), z) >> 4) / 15;
      // a quad through the column centre, turned toward the camera
      const ox = x + 0.5, oz = z + 0.5;
      let ax = oz - cam.z, az = -(ox - cam.x);
      const al = Math.hypot(ax, az) || 1;
      ax = ax / al * 0.5; az = az / al * 0.5;
      const P = snow ? this.spos : this.pos, UV = snow ? this.suv : this.uv, E = snow ? this.sext : this.extra;
      const q = snow ? ns++ : nr++;
      const b = q * 4;
      const off = ((x * 3121 + z * 45238971) & 255) / 256;
      const v0 = y0 / 4 + off, v1 = y1 / 4 + off;
      P.set([ox - ax, y1, oz - az, ox - ax, y0, oz - az, ox + ax, y0, oz + az, ox + ax, y1, oz + az], b * 3);
      UV.set([0, v1, 0, v0, 1, v0, 1, v1], b * 2);
      for (let k = 0; k < 4; k++) { E[(b + k) * 2] = l; E[(b + k) * 2 + 1] = amount; }
    }
    this.geo.setDrawRange(0, nr * 6);
    this.sgeo.setDrawRange(0, ns * 6);
    for (const a of ['position', 'uv', 'aExtra']) { this.geo.attributes[a].needsUpdate = true; this.sgeo.attributes[a].needsUpdate = true; }
    this.counts = [nr, ns];
    void game;
  }

  setAlpha(a) {
    if (!this.counts) return;
    const [nr, ns] = this.counts;
    for (let i = 0; i < nr * 4; i++) this.extra[i * 2 + 1] = a;
    for (let i = 0; i < ns * 4; i++) this.sext[i * 2 + 1] = a;
    this.geo.attributes.aExtra.needsUpdate = true;
    this.sgeo.attributes.aExtra.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.rainMesh); scene.remove(this.snowMesh);
    this.geo.dispose(); this.sgeo.dispose();
  }
}
