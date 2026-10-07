// Sky dome, sun, moon, stars and blocky 3D clouds.
import * as THREE from 'three';
import { U } from './materials.js';
import { images, canvas } from './textures.js';
import { rng } from '../shared/noise.js';

const SKY_VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FS = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform float uStars;
uniform float uVoid;
uniform vec3 uFog;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  float t = pow(max(h, 0.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, t);
  // below the horizon blend into the fog colour so the world edge disappears
  col = mix(col, uFog, smoothstep(0.03, -0.06, h));
  col = mix(col, uFog * 0.6, smoothstep(-0.2, -0.6, h) * uVoid);
  // sunrise / sunset glow around the sun near the horizon
  float s = max(dot(d, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
  float band = exp(-abs(h - 0.04) * 6.0);
  col = mix(col, uGlow, uGlowAmt * band * pow(s, 3.0));
  // stars
  if (uStars > 0.01 && h > 0.0) {
    vec3 q = floor(d * 380.0);
    float r = hash(q);
    if (r > 0.9975) {
      float tw = 0.6 + 0.4 * sin(r * 1000.0 + h * 50.0);
      col += vec3(0.95, 0.95, 1.0) * uStars * tw * smoothstep(0.0, 0.25, h);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  constructor(scene) {
    // dome, sun and moon live in their own scene, drawn first with a rotation-only camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 1, 1500);
    this.group = new THREE.Group();
    this.group.name = 'sky';
    this.scene.add(this.group);
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uGlow: { value: new THREE.Color(1.0, 0.55, 0.25) },
      uGlowAmt: { value: 0 },
      uStars: { value: 0 },
      uVoid: { value: 1 },
      uFog: { value: new THREE.Color() },
    };
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false }),
    );
    dome.renderOrder = -100;
    dome.frustumCulled = false;
    this.dome = dome;
    this.group.add(dome);

    // sun: bright square with a soft halo
    const sc = canvas(64, 64), sg = sc.getContext('2d');
    const grd = sg.createRadialGradient(32, 32, 4, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,180,0.9)');
    grd.addColorStop(0.35, 'rgba(255,220,140,0.35)');
    grd.addColorStop(1, 'rgba(255,200,120,0)');
    sg.fillStyle = grd; sg.fillRect(0, 0, 64, 64);
    sg.fillStyle = '#fffbe0'; sg.fillRect(20, 20, 24, 24);
    sg.fillStyle = '#fff3b0'; sg.fillRect(22, 22, 20, 20);
    const sunTex = new THREE.CanvasTexture(sc);
    sunTex.magFilter = THREE.NearestFilter;
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({
      map: sunTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }));
    this.sun.renderOrder = -99;
    this.group.add(this.sun);

    // moon phases texture: 4 x 2 grid
    const mp = images['env/moon_phases'];
    this.moonCanvas = canvas(32, 32);
    this.moonTex = new THREE.CanvasTexture(this.moonCanvas);
    this.moonTex.magFilter = THREE.NearestFilter;
    this.moonTex.minFilter = THREE.NearestFilter;
    this.moonImg = mp;
    this.moonPhase = -1;
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshBasicMaterial({
      map: this.moonTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }));
    this.moon.renderOrder = -99;
    this.group.add(this.moon);

    this.clouds = new Clouds(scene);
    this.horizon = new THREE.Color();
    this.fog = new THREE.Color();
    this.sunDir = new THREE.Vector3();
  }

  setMoonPhase(phase) {
    if (phase === this.moonPhase || !this.moonImg) return;
    this.moonPhase = phase;
    const img = this.moonImg;
    const cw = img.width / 4, chh = img.height / 2;
    const g = this.moonCanvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 32, 32);
    g.drawImage(img, (phase % 4) * cw, Math.floor(phase / 4) * chh, cw, chh, 0, 0, 32, 32);
    this.moonTex.needsUpdate = true;
  }

  // time: 0..24000 ticks (0 = sunrise). rain: 0..1. returns daylight 0..1
  update(camera, time, day, rain, thunder, viewDir, opts = {}) {
    const ang = (time / 24000) * Math.PI * 2;
    const sd = this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.15).normalize();
    const sc = this.camera;
    camera.getWorldQuaternion(sc.quaternion);
    if (sc.fov !== camera.fov || sc.aspect !== camera.aspect) { sc.fov = camera.fov; sc.aspect = camera.aspect; sc.updateProjectionMatrix(); }
    const DIST = 400;
    this.sun.position.copy(sd).multiplyScalar(DIST);
    this.sun.lookAt(0, 0, 0);
    this.moon.position.copy(sd).multiplyScalar(-DIST);
    this.moon.lookAt(0, 0, 0);
    this.setMoonPhase(day % 8);

    const sunH = sd.y;
    const dayAmt = THREE.MathUtils.smoothstep(sunH, -0.18, 0.25);
    const rainDark = 1 - rain * 0.55 - thunder * 0.2;
    const zenithDay = new THREE.Color(0.47, 0.65, 1.0);
    const horizonDay = new THREE.Color(0.75, 0.85, 1.0);
    const zenithNight = new THREE.Color(0.005, 0.008, 0.03);
    const horizonNight = new THREE.Color(0.03, 0.04, 0.09);
    const z = zenithNight.clone().lerp(zenithDay, dayAmt);
    const h = horizonNight.clone().lerp(horizonDay, dayAmt);
    if (rain > 0) {
      const grey = (c) => { const l = c.r * 0.3 + c.g * 0.59 + c.b * 0.11; c.lerp(new THREE.Color(l, l, l), rain * 0.7); c.multiplyScalar(rainDark); };
      grey(z); grey(h);
    }
    // sunrise/sunset glow strength: when the sun is near the horizon
    const glow = Math.max(0, 1 - Math.abs(sunH) / 0.32) * (1 - rain * 0.8);
    this.uniforms.uZenith.value.copy(z);
    this.uniforms.uHorizon.value.copy(h);
    this.uniforms.uSunDir.value.copy(sd);
    this.uniforms.uGlowAmt.value = glow * 0.85;
    this.uniforms.uStars.value = (1 - THREE.MathUtils.smoothstep(sunH, -0.3, 0.05)) * (1 - rain);
    this.sun.material.opacity = 1 - rain;
    this.moon.material.opacity = 1 - rain;
    this.sun.visible = this.moon.visible = !opts.underwater;

    // fog colour: horizon, tinted toward the glow when looking at the sun
    const look = Math.max(0, viewDir.x * Math.sign(sd.x || 1) * 0.7 + 0.3);
    this.fog.copy(h).lerp(this.uniforms.uGlow.value, glow * 0.45 * look);
    this.uniforms.uFog.value.copy(this.fog);
    this.horizon.copy(h);

    const daylight = THREE.MathUtils.smoothstep(sunH, -0.2, 0.2);
    this.clouds.update(camera, time, daylight, rain, opts);
    return daylight;
  }
}

// ------------------------------------------------------------------ clouds
const CELL = 12, TILE = 32, HEIGHT = 112, THICK = 4;
class Clouds {
  constructor(scene) {
    // tileable cloud map
    const r = rng(1337);
    const map = new Uint8Array(TILE * TILE);
    const grid = 8;
    const val = [];
    for (let i = 0; i < grid * grid; i++) val.push(r());
    const sample = (x, y) => {
      const gx = (x / TILE) * grid, gy = (y / TILE) * grid;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = gx - x0, ty = gy - y0;
      const v = (a, b) => val[((b % grid + grid) % grid) * grid + ((a % grid + grid) % grid)];
      const s = (t) => t * t * (3 - 2 * t);
      return (v(x0, y0) * (1 - s(tx)) + v(x0 + 1, y0) * s(tx)) * (1 - s(ty)) + (v(x0, y0 + 1) * (1 - s(tx)) + v(x0 + 1, y0 + 1) * s(tx)) * s(ty);
    };
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const n = sample(x, y) * 0.75 + r() * 0.25;
      map[y * TILE + x] = n > 0.56 ? 1 : 0;
    }
    const at = (x, y) => map[(((y % TILE) + TILE) % TILE) * TILE + (((x % TILE) + TILE) % TILE)];
    // geometry: 3x3 tiles of boxes with internal faces culled
    const pos = [], nor = [], idxs = [];
    const quad = (a, b, c, d, n) => {
      const o = pos.length / 3;
      pos.push(...a, ...b, ...c, ...d);
      for (let i = 0; i < 4; i++) nor.push(...n);
      idxs.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    const N = TILE * 3;
    for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
      if (!at(cx, cy)) continue;
      const x0 = cx * CELL, x1 = x0 + CELL, z0 = cy * CELL, z1 = z0 + CELL, y0 = 0, y1 = THICK;
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
      quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]);
      if (!at(cx + 1, cy)) quad([x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [1, 0, 0]);
      if (!at(cx - 1, cy)) quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
      if (!at(cx, cy + 1)) quad([x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [0, 0, 1]);
      if (!at(cx, cy - 1)) quad([x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [0, 0, -1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idxs);
    this.uniforms = {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uFar: { value: 300 },
      uCam: { value: new THREE.Vector3() },
      uFogColor: U.uFogColor,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying float vShade; varying vec3 vW;
        void main() {
          vShade = normal.y > 0.5 ? 1.0 : normal.y < -0.5 ? 0.72 : (abs(normal.x) > 0.5 ? 0.86 : 0.92);
          vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uFar; uniform vec3 uCam; uniform vec3 uFogColor;
        varying float vShade; varying vec3 vW;
        void main() {
          float d = length(vW.xz - uCam.xz);
          float a = 0.82 * (1.0 - smoothstep(uFar * 0.55, uFar, d));
          if (a < 0.01) discard;
          vec3 c = mix(uColor * vShade, uFogColor, smoothstep(uFar * 0.3, uFar, d) * 0.6);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.drift = 0;
  }

  update(camera, time, daylight, rain, opts) {
    this.mesh.visible = opts.clouds !== false;
    this.drift += (opts.dt || 0) * 0.9;
    const span = TILE * CELL;
    const cx = camera.position.x + this.drift, cz = camera.position.z;
    const ox = Math.floor(cx / span) * span - span, oz = Math.floor(cz / span) * span - span;
    this.mesh.position.set(ox - this.drift, HEIGHT, oz);
    const b = 0.18 + 0.82 * daylight;
    const grey = 1 - rain * 0.45;
    this.uniforms.uColor.value.setRGB(b * grey, b * grey, b * grey * (1.02 - 0.02 * daylight));
    this.uniforms.uFar.value = opts.far || 300;
    this.uniforms.uCam.value.copy(camera.position);
  }
}
