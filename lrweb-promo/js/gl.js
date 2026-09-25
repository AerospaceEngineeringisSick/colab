// WebGL layer for the LRWeb promo: liquid backgrounds, the glossy 3D LR mark, particles, devices, post FX.
// Everything is driven by a plain state object each frame (see promo.js), so any frame renders the same way twice.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const lin = (hex) => new THREE.Color(hex); // THREE.Color converts sRGB hex to linear working space
const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

// ------------------------------------------------------------------ the LR mark (traced from the logo)
const L_PTS = [[17, 1.5], [34, 1.5], [24.5, 49.5], [69, 49.5], [84.5, 65], [4, 65]];
function markShapes() {
  const f = (x, y) => [x - 61.5, -(y - 33.25)];
  const L = new THREE.Shape(); L_PTS.forEach(([x, y], i) => (i ? L.lineTo(...f(x, y)) : L.moveTo(...f(x, y))));
  const R = new THREE.Shape();
  const m = (x, y) => R.moveTo(...f(x, y)), l = (x, y) => R.lineTo(...f(x, y)), q = (cx, cy, x, y) => R.quadraticCurveTo(...f(cx, cy), ...f(x, y));
  m(44, 1.5); l(95, 1.5); q(110, 1.5, 110, 16); l(110, 27); q(110, 36, 97, 43); l(119, 65); l(96, 65); l(62.5, 29.5); l(89, 29.5);
  q(95, 29.5, 95, 23); l(95, 21); q(95, 15, 89, 15); l(58, 15); l(51, 43); l(34, 43); l(44, 1.5);
  return { L, R };
}
// 2D path for sampling particle targets
const MARK_PATH = 'M17 1.5H34L24.5 49.5H69L84.5 65H4Z M44 1.5H95Q110 1.5 110 16V27Q110 36 97 43L119 65H96L62.5 29.5H89Q95 29.5 95 23V21Q95 15 89 15H58L51 43H34Z';

// ------------------------------------------------------------------ shaders
const FS_QUAD_V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const NOISE = `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<5;i++){ s += a*vn(p); p = p*2.03 + 17.1; a *= .5; } return s; }`;

const BG_F = `
precision highp float; varying vec2 vUv;
uniform float t, aspect, wNight, wAlert, wBrand, wSun, wLight, wSolid, sunY, flow, pulse, aurora;
uniform vec3 solid;
${NOISE}
vec3 L(vec3 c){ return pow(c, vec3(2.2)); }
vec3 ramp(float x){ // green -> blue -> indigo -> navy
  vec3 a = L(vec3(.239,.722,.553)), b = L(vec3(.043,.525,.918)), c = L(vec3(.247,.302,.902)), d = L(vec3(.071,.004,.553));
  x = clamp(x, 0., 1.);
  return x < .33 ? mix(a, b, x/.33) : x < .66 ? mix(b, c, (x-.33)/.33) : mix(c, d, (x-.66)/.34);
}
void main(){
  vec2 uv = vUv; vec2 p = vec2(uv.x * aspect, uv.y);
  float tt = t * flow;
  vec3 col = vec3(0.);
  // night: deep navy + aurora ribbons
  if (wNight > 0.) {
    vec3 c = mix(L(vec3(.016,.02,.1)), L(vec3(.063,.07,.29)), 1. - uv.y);
    float a1 = fbm(vec2(p.x*1.4 + tt*.05, uv.y*2.2 - tt*.08));
    float band = smoothstep(.25, .0, abs(uv.y - .72 - .12*sin(p.x*1.7 + tt*.3) - .1*(a1-.5)));
    float band2 = smoothstep(.2, .0, abs(uv.y - .58 - .1*sin(p.x*2.3 - tt*.25 + 1.)));
    c += aurora * (band * mix(L(vec3(.24,.72,.55)), L(vec3(.04,.52,.92)), a1) * .55 + band2 * L(vec3(.25,.3,.9)) * .35) * (.6 + .6*a1);
    col += wNight * c;
  }
  // alert: bruised red fog
  if (wAlert > 0.) {
    float f = fbm(p*2.2 + vec2(tt*.2, -tt*.1));
    vec3 c = mix(L(vec3(.05,.01,.05)), L(vec3(.38,.02,.09)), smoothstep(.35, .85, f));
    c += L(vec3(1.,.18,.3)) * pow(smoothstep(.62, .9, f), 3.) * .6;
    col += wAlert * c;
  }
  // brand: liquid domain-warped gradient
  if (wBrand > 0.) {
    vec2 q = vec2(fbm(p*1.1 + tt*.07), fbm(p*1.1 + vec2(5.2, 1.3) - tt*.06));
    float w = fbm(p*1.3 + q*2.2 + tt*.05);
    vec3 c = ramp(w * 1.25 - .1 + .15*sin(tt*.2));
    c *= .75 + .5 * smoothstep(.2, .9, fbm(p*3. + q*4.));
    col += wBrand * c * (1. + pulse*.25);
  }
  // sunrise: sky gradient + the LRWeb sun (brand gradient disc) on a white horizon
  if (wSun > 0.) {
    float hz = .2;
    vec3 sky = mix(L(vec3(.2,.45,.75)), L(vec3(.04,.04,.2)), smoothstep(hz, 1., uv.y));
    sky = mix(sky, L(vec3(.24,.72,.55)), smoothstep(.35, .0, uv.y - hz) * .5);
    float cl = fbm(vec2(p.x*2. + tt*.03, uv.y*6.));
    sky += L(vec3(.55,.6,.95)) * smoothstep(.55, .8, cl) * smoothstep(.9, .4, uv.y) * .15;
    vec2 sc = vec2(.5*aspect, hz + sunY);
    float R = .34;
    float d = length(p - sc);
    vec2 g = (p - sc) / R; float gx = clamp(.5 + .5*(g.x*.8 + g.y*.6), 0., 1.);
    vec3 sunc = ramp(1. - gx);
    float disc = smoothstep(R + .004, R - .004, d) * step(hz, uv.y);
    float glow = exp(-max(d - R, 0.) * 6.) * .5;
    sky = mix(sky, sunc * 1.25, disc);
    sky += L(vec3(.2,.55,.95)) * glow * step(hz, uv.y) * .6;
    // horizon bar
    sky = mix(sky, L(vec3(.96,.97,.98)), smoothstep(.0045, .002, abs(uv.y - hz)) * smoothstep(.62, .5, abs(p.x - .5*aspect) / aspect));
    sky += vec3(1.) * exp(-abs(uv.y - hz) * 60.) * .08;
    // ground below horizon: dark reflection
    if (uv.y < hz) sky = mix(L(vec3(.03,.03,.12)), sunc * .35, smoothstep(.3, .0, abs(p.x - sc.x)) * smoothstep(0., hz, uv.y) * smoothstep(.0, .7, sunY + .2));
    col += wSun * sky;
  }
  // light: clean off-white with soft brand blobs
  if (wLight > 0.) {
    vec3 c = L(vec3(.96,.972,.98));
    float b1 = smoothstep(.75, .0, length(p - vec2(.85*aspect + .1*sin(tt*.3), .8)));
    float b2 = smoothstep(.8, .0, length(p - vec2(.1*aspect, .1 + .08*cos(tt*.25))));
    c = mix(c, L(vec3(.62,.82,1.)), b1 * .45);
    c = mix(c, L(vec3(.62,.92,.8)), b2 * .5);
    col += wLight * c;
  }
  if (wSolid > 0.) {
    float f = fbm(p*2. + tt*.1);
    vec3 c = solid * (.82 + .35*f) * (1. + pulse*.2);
    col += wSolid * c;
  }
  // vignette
  col *= mix(1., smoothstep(1.25, .35, length((uv - .5) * vec2(aspect, 1.))), .55);
  gl_FragColor = vec4(col, 1.);
}`;

const PARTS_V = `
attribute vec3 aStart; attribute vec3 aTarget; attribute float aRnd;
uniform float uProg, uT, uScatter, uSize, uWarp;
varying float vRnd; varying float vX;
void main(){
  float d = aRnd * .35;
  float p = clamp((uProg - d) / (1. - d), 0., 1.);
  p = 1. - pow(1. - p, 3.);
  vec3 swirl = vec3(sin(uT*1.3 + aRnd*40.), cos(uT*1.1 + aRnd*31.), sin(uT*.9 + aRnd*17.)) * .08 * (1. - p);
  vec3 pos = mix(aStart, aTarget, p) + swirl;
  pos += normalize(aTarget + vec3(.001)) * uScatter * (1.5 + aRnd * 4.);
  vec4 mv = modelViewMatrix * vec4(pos, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.6 + aRnd) * (6. / -mv.z);
  vRnd = aRnd; vX = aTarget.x;
}`;
const PARTS_F = `
precision highp float; varying float vRnd; varying float vX; uniform float uAlpha;
void main(){
  vec2 c = gl_PointCoord - .5; float r = length(c); if (r > .5) discard;
  float a = smoothstep(.5, .0, r);
  vec3 g = mix(vec3(.24,.72,.55), vec3(.04,.52,.92), clamp(vX * .6 + .5, 0., 1.));
  g = mix(g, vec3(1.), step(.85, vRnd) * .6);
  gl_FragColor = vec4(g * 2.2, a * uAlpha);
}`;

const STARS_V = `
attribute float aRnd; uniform float uT, uWarp, uSize, uDrift;
varying float vA;
void main(){
  vec3 p = position;
  p.z = mod(p.z + uT * (uDrift + uWarp * 40.) + 60., 60.) - 55.;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (.5 + aRnd) * (8. / -mv.z) * (1. + uWarp * 2.);
  vA = smoothstep(-55., -40., p.z) * (.4 + .6 * fract(aRnd * 13.1 + uT * .3 * aRnd));
}`;
const STARS_F = `precision highp float; varying float vA; uniform float uAlpha; uniform vec3 uCol;
void main(){ vec2 c = gl_PointCoord - .5; float r = length(c); if (r > .5) discard; gl_FragColor = vec4(uCol * 1.6, smoothstep(.5, .0, r) * vA * uAlpha); }`;

const WARP_V = `attribute float aRnd; attribute float aEnd; uniform float uT, uLen; varying float vA;
void main(){ vec3 p = position; float z = mod(p.z + uT * 45. + 60., 60.) - 55.; p.z = z + aEnd * uLen * (.5 + aRnd);
  vA = smoothstep(-55., -35., z) * (1. - aEnd * .9);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`;
const WARP_F = `precision highp float; varying float vA; uniform float uAlpha; void main(){ gl_FragColor = vec4(vec3(.6,.85,1.) * 1.8, vA * uAlpha); }`;

const RING_F = `precision highp float; varying vec2 vUv; uniform float uP;
void main(){ float r = length(vUv - .5) * 2.; float w = .06 + .1 * uP;
  float a = smoothstep(w, 0., abs(r - .9)) * (1. - uP);
  gl_FragColor = vec4(mix(vec3(.4,1.,.8), vec3(.4,.6,1.), vUv.x) * 2.5, a); }`;
const RING_V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;

const FINAL_F = `
precision highp float; varying vec2 vUv;
uniform sampler2D tDiffuse; uniform float rgb, glitch, seed, sat, crt, bright, aspect;
${NOISE}
void main(){
  vec2 uv = vUv;
  // block glitch: horizontal tears + blocky offsets
  if (glitch > 0.) {
    float row = floor(uv.y * 28. + seed * 13.);
    float tear = step(1. - glitch * .55, h21(vec2(row, seed)));
    uv.x += tear * (h21(vec2(row, seed + 1.)) - .5) * .18 * glitch;
    vec2 blk = floor(uv * vec2(18., 10.) + seed);
    float b = step(1. - glitch * .25, h21(blk));
    uv += b * (vec2(h21(blk + 3.), h21(blk + 7.)) - .5) * .06 * glitch;
  }
  vec2 dir = (uv - .5) * rgb * .012;
  vec3 c;
  c.r = texture2D(tDiffuse, uv + dir + vec2(rgb * .002, 0.)).r;
  c.g = texture2D(tDiffuse, uv).g;
  c.b = texture2D(tDiffuse, uv - dir - vec2(rgb * .002, 0.)).b;
  float l = dot(c, vec3(.299,.587,.114));
  c = mix(vec3(l), c, sat);
  if (crt > 0.) c *= 1. - crt * .35 * (.5 + .5 * sin(vUv.y * 900.));
  c *= bright;
  gl_FragColor = vec4(c, 1.);
}`;

const MOSH_F = `
precision highp float; varying vec2 vUv;
uniform sampler2D tOld, tNew; uniform float p, aOld, aNew, aspect;
${NOISE}
vec2 cover(vec2 uv, float ta){ // ta = texture aspect (w/h); stage aspect = aspect
  vec2 s = aspect > ta ? vec2(1., ta/aspect) : vec2(aspect/ta, 1.);
  return (uv - .5) * s + .5;
}
void main(){
  vec2 uv = vUv;
  vec2 blk = floor(uv * vec2(40., 24.));
  float n = h21(blk);
  // motion vectors per block, growing with progress: the old frame smears downward/sideways
  vec2 mv = (vec2(h21(blk + 1.), h21(blk + 2.)) - vec2(.5, .8)) * vec2(.25, .5) * smoothstep(0., .6, p);
  float reveal = smoothstep(n * .7, n * .7 + .3, p * 1.25);
  vec2 ou = cover(uv + mv * p, aOld);
  vec2 nu = cover(uv + mv * (1. - p) * .3, aNew);
  vec3 o = texture2D(tOld, clamp(ou, 0., 1.)).rgb;
  vec3 nw = texture2D(tNew, clamp(nu, 0., 1.)).rgb;
  // colour bleeding: old chroma over new luma on the boundary
  float edge = reveal * (1. - reveal) * 4.;
  vec3 c = mix(o, nw, reveal);
  c = mix(c, vec3(dot(nw, vec3(.33))) + (o - vec3(dot(o, vec3(.33)))) * 1.4, edge * .7);
  gl_FragColor = vec4(c, 1.);
}`;

// ------------------------------------------------------------------ engine
export class GL {
  constructor(canvas, W, H) {
    this.W = W; this.H = H; this.aspect = W / H;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false }));
    r.setPixelRatio(1); r.setSize(W, H, false);
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 200);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture;
    this.loader = new THREE.TextureLoader();
  }

  tex(url, repeatY = 1) {
    const t = this.loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  async init(assets) {
    const { W, H } = this;
    this.images = {};
    await Promise.all(Object.entries(assets).map(([k, url]) => new Promise((res) => {
      const t = this.loader.load(url, (tx) => { tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; this.images[k] = tx; res(); }, undefined, () => res());
    })));

    // background: rendered at half res into a target used as scene.background
    this.bgRT = new THREE.WebGLRenderTarget(Math.round(W / 2), Math.round(H / 2), { type: THREE.HalfFloatType });
    this.bgRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: FS_QUAD_V, fragmentShader: BG_F, depthWrite: false,
      uniforms: Object.fromEntries(['t', 'wNight', 'wAlert', 'wBrand', 'wSun', 'wLight', 'wSolid', 'sunY', 'flow', 'pulse', 'aurora'].map((k) => [k, { value: 0 }]).concat([['aspect', { value: this.aspect }], ['solid', { value: new THREE.Color() }]])),
    });
    this.bgScene = new THREE.Scene(); this.bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat));
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene.background = this.bgRT.texture;

    // lights for extra specular kicks on the glossy mark
    this.key = new THREE.DirectionalLight(0xffffff, 2.2); this.key.position.set(3, 4, 5); this.scene.add(this.key);
    this.rim = new THREE.PointLight(0x6fe0b4, 30, 20); this.rim.position.set(-4, 1, -2); this.scene.add(this.rim);
    this.rim2 = new THREE.PointLight(0x3f4de6, 30, 20); this.rim2.position.set(4, -1, -2); this.scene.add(this.rim2);

    this.buildLogo(); this.buildParticles(); this.buildStars(); this.buildWarp(); this.buildRing(); this.buildDevices();

    // post
    const comp = (this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 })));
    comp.setPixelRatio(1); comp.setSize(W, H);
    comp.addPass(new RenderPass(this.scene, this.camera));
    // sanitise HDR before bloom: clamp blown speculars and kill NaN/Inf, which otherwise smear into black blocks
    comp.addPass(new ShaderPass(new THREE.ShaderMaterial({ vertexShader: FS_QUAD_V, uniforms: { tDiffuse: { value: null } },
      fragmentShader: 'precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec4(0.,0.,0.,1.); gl_FragColor = vec4(clamp(c.rgb, 0., 6.), 1.); }' })));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.6, 0.55, 0.78);
    comp.addPass(this.bloom);
    comp.addPass(new OutputPass());
    this.mosh = new ShaderPass(new THREE.ShaderMaterial({ vertexShader: FS_QUAD_V, fragmentShader: MOSH_F,
      uniforms: { tOld: { value: null }, tNew: { value: null }, p: { value: 0 }, aOld: { value: 1 }, aNew: { value: 1 }, aspect: { value: this.aspect } } }), 'tDummy');
    this.mosh.enabled = false; comp.addPass(this.mosh);
    this.final = new ShaderPass(new THREE.ShaderMaterial({ vertexShader: FS_QUAD_V, fragmentShader: FINAL_F,
      uniforms: { tDiffuse: { value: null }, rgb: { value: 0 }, glitch: { value: 0 }, seed: { value: 0 }, sat: { value: 1 }, crt: { value: 0 }, bright: { value: 1 }, aspect: { value: this.aspect } } }));
    comp.addPass(this.final);
  }

  buildLogo() {
    const { L, R } = markShapes();
    const opts = { depth: 16, bevelEnabled: true, bevelThickness: 3.2, bevelSize: 2.2, bevelSegments: 5, curveSegments: 24 };
    const mk = (shape, color) => new THREE.Mesh(new THREE.ExtrudeGeometry(shape, opts).translate(0, 0, -8),
      new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6, transparent: true }));
    this.logo = new THREE.Group();
    this.logoL = mk(L, 0x0a74c9); this.logoR = mk(R, 0x3cb88c);
    this.logo.add(this.logoL, this.logoR);
    this.logo.scale.setScalar(0.03);
    const holder = (this.logoHolder = new THREE.Group()); holder.add(this.logo); this.scene.add(holder);
  }

  buildParticles() {
    // targets: sample points inside the mark
    const c = document.createElement('canvas'); c.width = 240; c.height = 140; const x = c.getContext('2d');
    x.scale(1.8, 1.8); x.fill(new Path2D(MARK_PATH));
    const d = x.getImageData(0, 0, 240, 140).data; const inside = [];
    for (let j = 0; j < 140; j++) for (let i = 0; i < 240; i++) if (d[(j * 240 + i) * 4 + 3] > 128) inside.push([i / 1.8, j / 1.8]);
    const N = 16000;
    const start = new Float32Array(N * 3), target = new Float32Array(N * 3), rnd = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const [px, py] = inside[Math.floor(rand() * inside.length)];
      target[k * 3] = (px - 61.5 + rand() * .5) * 0.03; target[k * 3 + 1] = -(py - 33.25 + rand() * .5) * 0.03; target[k * 3 + 2] = (rand() - .5) * 0.5;
      const th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1), rr = 4 + rand() * 9;
      start[k * 3] = rr * Math.sin(ph) * Math.cos(th); start[k * 3 + 1] = rr * Math.sin(ph) * Math.sin(th); start[k * 3 + 2] = rr * Math.cos(ph) - 3;
      rnd[k] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(target, 3));
    g.setAttribute('aStart', new THREE.BufferAttribute(start, 3)); g.setAttribute('aTarget', new THREE.BufferAttribute(target, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    this.partMat = new THREE.ShaderMaterial({ vertexShader: PARTS_V, fragmentShader: PARTS_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uProg: { value: 0 }, uT: { value: 0 }, uScatter: { value: 0 }, uSize: { value: 3 }, uAlpha: { value: 1 }, uWarp: { value: 0 } } });
    this.parts = new THREE.Points(g, this.partMat); this.parts.frustumCulled = false;
    this.logoHolder.add(this.parts);
  }

  buildStars() {
    const N = 2500, p = new Float32Array(N * 3), r = new Float32Array(N);
    for (let i = 0; i < N; i++) { p[i * 3] = (rand() - .5) * 40; p[i * 3 + 1] = (rand() - .5) * 24; p[i * 3 + 2] = -rand() * 60 + 5; r[i] = rand(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(r, 1));
    this.starMat = new THREE.ShaderMaterial({ vertexShader: STARS_V, fragmentShader: STARS_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uWarp: { value: 0 }, uSize: { value: 2.4 }, uAlpha: { value: 1 }, uDrift: { value: 0.4 }, uCol: { value: new THREE.Color(0.85, 0.92, 1) } } });
    this.stars = new THREE.Points(g, this.starMat); this.stars.frustumCulled = false; this.scene.add(this.stars);
  }

  buildWarp() {
    const N = 700, p = new Float32Array(N * 6), r = new Float32Array(N * 2), e = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2, rad = 1.2 + rand() * 10, x = Math.cos(a) * rad, y = Math.sin(a) * rad * .7, z = -rand() * 60 + 5;
      p.set([x, y, z, x, y, z], i * 6); r[i * 2] = r[i * 2 + 1] = rand(); e[i * 2] = 0; e[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(r, 1)); g.setAttribute('aEnd', new THREE.BufferAttribute(e, 1));
    this.warpMat = new THREE.ShaderMaterial({ vertexShader: WARP_V, fragmentShader: WARP_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uT: { value: 0 }, uLen: { value: 3 }, uAlpha: { value: 0 } } });
    this.warp = new THREE.LineSegments(g, this.warpMat); this.warp.frustumCulled = false; this.scene.add(this.warp);
  }

  buildRing() {
    this.ringMat = new THREE.ShaderMaterial({ vertexShader: RING_V, fragmentShader: RING_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uP: { value: 0 } } });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ringMat); this.scene.add(this.ring);
  }

  laptop(tex, texAspect = 1200 / 750) {
    const metal = new THREE.MeshPhysicalMaterial({ color: 0x2a2e3a, metalness: 0.85, roughness: 0.32, clearcoat: .4, envMapIntensity: 1.2 });
    const g = new THREE.Group();
    const base = new THREE.Mesh(new RoundedBoxGeometry(3.5, 0.11, 2.35, 4, 0.05), metal); base.position.set(0, -0.055, 1.175); g.add(base);
    const kb = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.3), new THREE.MeshStandardMaterial({ color: 0x0b0d1c, roughness: .8 })); kb.rotation.x = -Math.PI / 2; kb.position.set(0, 0.002, .85); g.add(kb);
    const lid = new THREE.Group(); g.add(lid);
    const shell = new THREE.Mesh(new RoundedBoxGeometry(3.5, 2.25, 0.07, 4, 0.04), metal); shell.position.set(0, 1.125, -0.035); lid.add(shell);
    const bez = new THREE.Mesh(new THREE.PlaneGeometry(3.42, 2.17), new THREE.MeshBasicMaterial({ color: 0x05060d })); bez.position.set(0, 1.125, 0.001); lid.add(bez);
    const scrMat = new THREE.MeshBasicMaterial({ map: tex ? tex.clone() : null, toneMapped: false, color: 0xffffff });
    if (scrMat.map) { scrMat.map.needsUpdate = true; }
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(3.28, 2.05), scrMat); scr.position.set(0, 1.14, 0.002); lid.add(scr);
    g.userData = { lid, scr, scrMat, texAspect };
    return g;
  }

  phone(tex) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.05, 2.15, 0.11, 6, 0.16), new THREE.MeshPhysicalMaterial({ color: 0x1a1d2a, metalness: .9, roughness: .25, clearcoat: 1, envMapIntensity: 1.4 }));
    g.add(body);
    const scrMat = new THREE.MeshBasicMaterial({ map: tex ? tex.clone() : null, toneMapped: false });
    if (scrMat.map) scrMat.map.needsUpdate = true;
    const scr = new THREE.Mesh(new RoundedBoxGeometry(0.97, 2.07, 0.001, 6, 0.12), scrMat); scr.position.z = 0.056; g.add(scr);
    g.userData = { scr, scrMat };
    return g;
  }

  // crop a page texture to the screen's aspect (top of page), with vertical scroll 0..1 of the remaining page
  screen(dev, key, scroll = 0, screenAspect = 3.28 / 2.05, imgAspect = null) {
    const m = dev.userData.scrMat;
    const img = this.images[key]; if (!img) return;
    if (m.userData.key !== key) { m.map = img.clone(); m.map.needsUpdate = true; m.userData.key = key; m.needsUpdate = true; }
    const ia = imgAspect || img.image.width / img.image.height;
    if (ia < screenAspect) { // page taller than screen: show a window and scroll
      const rep = ia / screenAspect;
      m.map.repeat.set(1, rep); m.map.offset.set(0, 1 - rep - scroll * (1 - rep));
    } else { const rep = screenAspect / ia; m.map.repeat.set(rep, 1); m.map.offset.set((1 - rep) / 2, 0); }
  }

  buildDevices() {
    this.devices = new THREE.Group(); this.scene.add(this.devices);
    this.nightLap = this.laptop(null); this.devices.add(this.nightLap);
    this.showLaps = Array.from({ length: 6 }, () => { const l = this.laptop(null); this.devices.add(l); return l; });
    this.resLap = this.laptop(null); this.devices.add(this.resLap);
    this.resPhone = this.phone(null); this.devices.add(this.resPhone);
    // spotlight cone for the lonely night laptop
    const cone = new THREE.ConeGeometry(2.6, 7, 48, 1, true);
    this.cone = new THREE.Mesh(cone, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'precision highp float; varying vec2 vUv; uniform float uA; void main(){ float a = pow(1. - vUv.y, 1.6) * .35 + .0; a *= smoothstep(0., .25, sin(vUv.x * 3.14159)); gl_FragColor = vec4(vec3(.55,.75,1.) * a * uA, a * uA); }' }));
    this.scene.add(this.cone);
  }

  render(t, S) {
    const u = this.bgMat.uniforms, b = S.bg || {};
    u.t.value = t; u.flow.value = b.flow ?? 1; u.pulse.value = b.pulse ?? 0; u.aurora.value = b.aurora ?? 1;
    for (const k of ['Night', 'Alert', 'Brand', 'Sun', 'Light', 'Solid']) u['w' + k].value = b[k.toLowerCase()] ?? 0;
    u.sunY.value = b.sunY ?? 0; if (b.solidColor) u.solid.value.set(b.solidColor);
    this.renderer.setRenderTarget(this.bgRT); this.renderer.render(this.bgScene, this.ortho); this.renderer.setRenderTarget(null);

    const c = S.cam || {};
    this.camera.fov = c.fov ?? 35; this.camera.position.set(...(c.pos || [0, 0, 10])); this.camera.up.set(0, 1, 0);
    this.camera.lookAt(...(c.look || [0, 0, 0])); if (c.roll) this.camera.rotateZ(c.roll); this.camera.updateProjectionMatrix();

    // logo
    const lg = S.logo;
    this.logoHolder.visible = !!lg;
    if (lg) {
      this.logoHolder.position.set(...(lg.pos || [0, 0, 0])); this.logoHolder.rotation.set(...(lg.rot || [0, 0, 0])); this.logoHolder.scale.setScalar(lg.scale ?? 1);
      this.logo.visible = (lg.mesh ?? 1) > 0.001;
      for (const m of [this.logoL, this.logoR]) { m.material.opacity = lg.mesh ?? 1; m.material.depthWrite = (lg.mesh ?? 1) > .98; }
      this.parts.visible = (lg.parts ?? 0) > 0.001;
      const pu = this.partMat.uniforms; pu.uProg.value = lg.prog ?? 1; pu.uT.value = t; pu.uScatter.value = lg.scatter ?? 0; pu.uAlpha.value = lg.parts ?? 0; pu.uSize.value = (lg.psize ?? 3) * this.H / 1080;
    }
    // stars / warp
    const st = S.stars; this.stars.visible = !!st;
    if (st) { const su = this.starMat.uniforms; su.uT.value = t; su.uWarp.value = st.warp ?? 0; su.uAlpha.value = st.a ?? 1; su.uDrift.value = st.drift ?? .4; su.uSize.value = (st.size ?? 2.4) * this.H / 1080; }
    const wp = S.warp; this.warp.visible = !!wp;
    if (wp) { this.warpMat.uniforms.uT.value = wp.t ?? t; this.warpMat.uniforms.uAlpha.value = wp.a ?? 1; this.warpMat.uniforms.uLen.value = wp.len ?? 3; }
    // ring
    const rg = S.ring; this.ring.visible = !!rg;
    if (rg) { this.ring.position.set(...(rg.pos || [0, 0, 0])); this.ring.scale.setScalar(rg.size ?? 6); this.ringMat.uniforms.uP.value = rg.p; this.ring.lookAt(this.camera.position); }
    // devices
    for (const d of [this.nightLap, ...this.showLaps, this.resLap, this.resPhone]) d.visible = false;
    const place = (dev, o) => {
      dev.visible = true; dev.position.set(...(o.pos || [0, 0, 0])); dev.rotation.set(...(o.rot || [0, 0, 0])); dev.scale.setScalar(o.scale ?? 1);
      if (dev.userData.lid) dev.userData.lid.rotation.x = -(o.open ?? 1.75) + Math.PI / 2;
      if (o.screen) this.screen(dev, o.screen, o.scroll ?? 0, dev.userData.lid ? 3.28 / 2.05 : 0.97 / 2.07);
      dev.userData.scrMat.color.setScalar(o.glow ?? 1);
    };
    if (S.nightLap) place(this.nightLap, S.nightLap);
    (S.showLaps || []).forEach((o, i) => o && place(this.showLaps[i], o));
    if (S.resLap) place(this.resLap, S.resLap);
    if (S.resPhone) place(this.resPhone, S.resPhone);
    this.cone.visible = !!S.cone; if (S.cone) { this.cone.position.set(...S.cone.pos); this.cone.material.uniforms.uA.value = S.cone.a; }

    // post
    const p = S.post || {};
    this.bloom.strength = p.bloom ?? 0.6; this.bloom.radius = p.bloomRadius ?? .55; this.bloom.threshold = p.bloomThreshold ?? .78;
    const f = this.final.uniforms; f.rgb.value = p.rgb ?? 0; f.glitch.value = p.glitch ?? 0; f.seed.value = p.seed ?? 0; f.sat.value = p.sat ?? 1; f.crt.value = p.crt ?? 0; f.bright.value = p.bright ?? 1;
    const m = S.mosh; this.mosh.enabled = !!m;
    if (m) { const mu = this.mosh.material.uniforms; mu.tOld.value = this.images[m.old]; mu.tNew.value = this.images[m.new]; mu.p.value = m.p;
      mu.aOld.value = this.images[m.old] ? this.images[m.old].image.width / this.images[m.old].image.height : 1; mu.aNew.value = this.images[m.new] ? this.images[m.new].image.width / this.images[m.new].image.height : 1; }
    this.composer.render();
  }
}
