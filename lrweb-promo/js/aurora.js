// The aurora world: curtains with light rays, stars, mountain ridges and a lake reflection, plus a brand sunrise.
// Curtain shapes are computed per column in JS (cheap 1-D noise) and uploaded as a small float texture each frame,
// so the per-pixel shader stays light enough to render at full 1440p.
const COLS = 1024, ROWS = 5, XMIN = -4, XMAX = 4;

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
const fbm = (x, y, o = 4) => { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= .5; } return s; };

const VS = `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D col;
uniform float aspect, t, inten, storm, dawn, waveX, waveA, stars, pulse, sunY, horizon, xmin, xmax, lake, mountains, dpr;
uniform vec4 cam; // pan, tilt, zoom, roll
uniform float meteor; uniform vec4 m1; // random shooting-star density; one scripted meteor (x, y, t0, direction)
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec4 C(float x, float row){ return texture(col, vec2((x - xmin) / (xmax - xmin), (row + .5) / 5.)); }
vec3 grad(float k, float hue){ // bottom green -> blue -> indigo/violet, with storm tint
  vec3 g = vec3(.28, 1., .62), b = vec3(.06, .62, 1.), v = vec3(.42, .32, 1.), pk = vec3(.95, .35, .9);
  vec3 c = k < .55 ? mix(g, b, k / .55) : mix(b, mix(v, pk, .25 + .25 * hue), clamp((k - .55) / .8, 0., 1.));
  c = mix(c, c.bgr * vec3(1., .8, 1.1), hue * .18);
  vec3 s = k < .5 ? mix(vec3(1., .25, .45), vec3(.95, .15, .7), k * 2.) : mix(vec3(.95, .15, .7), vec3(.5, .1, .9), clamp(k - .5, 0., 1.));
  return mix(c, s, storm);
}
vec3 aurora(vec2 v, float refl){
  vec3 acc = vec3(0.);
  for (int L = 0; L < 4; L++) {
    float d = 1. + float(L) * .6;
    float x = v.x + cam.x / d;
    vec4 c = C(x, float(L));           // base, height, brightness, hue
    float y = v.y - horizon;
    float dd = y - c.r;
    float body = smoothstep(-.006, .012, dd) * (exp(-max(dd, 0.) / max(c.g, .02)) + .9 * exp(-max(dd, 0.) * 38.));
    float under = exp(min(dd, 0.) * 70.);
    float glow = exp(-dd * dd / .02) * .18;
    float a = c.b * (body * under + glow);
    // fine vertical shimmer inside the curtain
    a *= .82 + .18 * sin(y * 38. + x * 7. + t * 1.3 + float(L) * 2.);
    acc += grad(clamp(dd / max(c.g, .02), 0., 1.6), c.a) * a * (1. - float(L) * .16);
  }
  // the drop: a bright wave travelling across the sky
  float w = exp(-pow((v.x * cam.z - waveX) * 3.2, 2.)) * waveA;
  acc *= 1. + w * 3.;
  acc += vec3(.55, 1., .8) * w * .35 * smoothstep(-.1, .5, v.y - horizon);
  return acc * inten * (1. - dawn * .55) * (1. + pulse * .22);
}
vec3 sky(vec2 v){
  float y = v.y - horizon;
  vec3 night = mix(vec3(.035, .045, .14), vec3(.008, .01, .045), smoothstep(0., .9, y));
  vec3 dawnc = mix(mix(vec3(.55, .78, .8), vec3(.12, .45, .85), smoothstep(0., .35, y)), vec3(.05, .09, .3), smoothstep(.3, 1.1, y));
  vec3 c = mix(night, dawnc, dawn);
  c += vec3(.6, .1, .2) * storm * .08 * smoothstep(.6, 0., y);
  return c;
}
float starfield(vec2 v){
  vec2 p = (v + vec2(cam.x / 3., 0.)) * 180.;
  vec2 i = floor(p), f = fract(p) - .5;
  float h = h21(i);
  if (h < .962) return 0.;
  vec2 off = vec2(h21(i + 3.1), h21(i + 7.7)) - .5;
  vec2 d = f - off * .6;
  float r = length(d), k = (h - .962) / .038;
  float s = smoothstep(.12 * (1. + k * 1.6) / dpr, 0., r);
  // scintillation: fast irregular flicker (two beating tones) plus a rare sparkle
  float ph = h * 91.7, fq = 5. + h21(i + 1.3) * 9.;
  float tw = .55 + .45 * sin(t * fq + ph) * sin(t * (fq * .61 + 2.3) + ph * 1.7);
  tw = mix(tw, 1.4, pow(max(0., sin(t * (1.3 + h * 2.) + ph * 3.)), 40.));
  float glint = k > .8 ? (exp(-abs(d.x) * 60.) * exp(-d.y * d.y * 900.) + exp(-abs(d.y) * 60.) * exp(-d.x * d.x * 900.)) * .3 * tw : 0.;
  return s * tw * (.35 + .65 * k) + glint;
}
vec3 starcol(vec2 v){ float c = h21(floor((v + vec2(cam.x / 3., 0.)) * 180.) + 11.); return c < .33 ? vec3(.8, .88, 1.) : c < .66 ? vec3(1.) : vec3(1., .92, .8); }
float segd(vec2 p, vec2 a, vec2 b, out float u){ vec2 ab = b - a; u = clamp(dot(p - a, ab) / dot(ab, ab), 0., 1.); return length(p - a - ab * u); }
float meteorAt(vec2 v, vec2 p0, float ang, float age, float dur, float len){
  if (age < 0. || age > dur) return 0.;
  vec2 dir = vec2(cos(ang), -sin(ang));
  vec2 head = p0 + dir * age * .9, tail = head - dir * len * min(1., age / (dur * .35));
  float u; float d = segd(v, tail, head, u);
  float e = sin(3.14159 * age / dur);
  return (exp(-d * d * 6e4 * dpr) * u * u + exp(-dot(v - head, v - head) * 1.2e4) * .6) * e;
}
float meteors(vec2 v){
  float acc = 0.;
  for (int k = 0; k < 2; k++) {
    float slot = floor(t / 2.3) - float(k), h = h21(vec2(slot, 4.2));
    if (h > meteor) continue;
    float t0 = slot * 2.3 + h21(vec2(slot, 1.7)) * 1.2;
    float sgn = h21(vec2(slot, 9.1)) > .5 ? 1. : -1.;
    vec2 p0 = vec2((h21(vec2(slot, 2.9)) - .5) * aspect * .8, horizon + .5 + h21(vec2(slot, 5.3)) * .25);
    float ang = sgn > 0. ? .35 + h * .3 : 3.14159 - .35 - h * .3;
    acc += meteorAt(v, p0, ang, t - t0, .55 + h21(vec2(slot, 8.8)) * .35, .2);
  }
  if (m1.w != 0.) acc += meteorAt(v, m1.xy, m1.w > 0. ? .42 : 3.14159 - .42, t - m1.z, .9, .32) * 1.4;
  return acc;
}
void main(){
  vec2 v = (uv - .5) * vec2(aspect, 1.);
  float cr = cos(cam.w), sr = sin(cam.w);
  v = mat2(cr, -sr, sr, cr) * v / cam.z;
  v.y -= cam.y;
  float y = v.y - horizon;
  vec3 c;
  // ridges (row 4): far ridge (r), near ridge (g)
  float far = C(v.x + cam.x / 1.4, 4.).r * mountains, near = C(v.x + cam.x * 1.25, 4.).g * mountains;
  if (y >= 0.) {
    c = sky(v) + aurora(v, 0.) + (starcol(v) * starfield(v) * stars * (1. - dawn) + vec3(.85, 1., .95) * meteors(v) * max(stars, .8) * (1. + .6 * dawn)) * smoothstep(0., .2, y);
    // sun (brand gradient disc) at dawn
    vec2 sp = v - vec2(0., horizon + sunY);
    float R = .15, ds = length(sp);
    vec2 gdir = sp / R; float gk = clamp(.5 + .5 * (gdir.x * .8 + gdir.y * .6), 0., 1.);
    vec3 sunc = gk < .5 ? mix(vec3(.24,.72,.55), vec3(.04,.52,.92), gk * 2.) : mix(vec3(.04,.52,.92), vec3(.25,.3,.9), gk * 2. - 1.);
    c = mix(c, sunc * 1.25, smoothstep(R + .003, R - .003, ds) * dawn);
    c += vec3(.35, .8, .95) * exp(-max(ds - R, 0.) * 5.) * .55 * dawn + vec3(.9, 1., .95) * exp(-abs(ds - R) * 120.) * .25 * dawn;
    // ridges
    float farM = smoothstep(far + .002, far - .002, y), nearM = smoothstep(near + .002, near - .002, y);
    vec3 farC = mix(vec3(.045, .06, .17), vec3(.16, .3, .5), dawn) + aurora(v, 0.) * .1;
    vec3 nearC = mix(vec3(.006, .008, .028), vec3(.03, .06, .14), dawn);
    c = mix(c, farC, farM);
    c += vec3(.3, .9, .7) * exp(-abs(y - far) * 250.) * .06 * inten * (1. - farM * .5);
    c = mix(c, nearC, nearM);
  } else {
    // lake: rippled reflection of sky, aurora, sun and ridges
    float depth = -y;
    vec2 r = vec2(v.x + sin(depth * 220. + t * 2.2) * .0022 * (.3 + depth * 4.) + sin(depth * 70. - t * 1.3) * .0018, horizon + depth * 1.05);
    vec3 rc = sky(r) + aurora(r, 1.);
    vec2 sp = r - vec2(0., horizon + sunY); float ds = length(sp);
    rc += vec3(.3, .75, .95) * smoothstep(.15, .12, ds) * dawn * .9 + vec3(.25,.6,.8) * exp(-abs(r.x) * 9.) * dawn * .25;
    float farR = C(r.x + cam.x / 1.4, 4.).r * mountains, nearR = C(r.x + cam.x * 1.25, 4.).g * mountains;
    float yr = r.y - horizon;
    if (yr < farR) rc = mix(vec3(.03, .04, .12), vec3(.1, .2, .35), dawn);
    if (yr < nearR) rc = mix(vec3(.012, .015, .05), vec3(.05, .08, .18), dawn);
    c = rc * mix(.55, .25, smoothstep(0., .5, depth)) * lake + vec3(.004, .006, .02);
    c += vec3(.8, 1., .95) * exp(-depth * 900.) * .05 * inten; // shoreline glint
  }
  c = 1. - exp(-c * 1.35);                  // soft filmic roll-off
  c *= mix(1., smoothstep(1.35, .35, length((uv - .5) * vec2(aspect, 1.))), .55);
  o = vec4(pow(c, vec3(.95)), 1.);
}`;

export class Aurora {
  constructor(canvas, W, H, dpr, res = 1) {
    this.W = W; this.H = H; this.aspect = W / H;
    canvas.width = Math.round(W * dpr * res); canvas.height = Math.round(H * dpr * res);
    const gl = (this.gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false }));
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = (this.prog = gl.createProgram());
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {}; for (const k of ['col', 'aspect', 't', 'inten', 'storm', 'dawn', 'waveX', 'waveA', 'stars', 'pulse', 'sunY', 'horizon', 'xmin', 'xmax', 'lake', 'mountains', 'cam', 'dpr', 'meteor', 'm1']) this.u[k] = gl.getUniformLocation(p, k);
    this.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.data = new Float32Array(COLS * ROWS * 4);
    this.dpr = dpr * res;
  }

  columns(t, s) {
    const d = this.data, speed = s.speed ?? 1, storm = s.storm ?? 0, tt = t * speed;
    const turb = 1 + storm * 1.6;
    //            main   upper   far    veil
    const BASE = [.1, .22, .3, .44], AMP = [.13, .11, .08, .07], H = [.26, .34, .22, .5], G = [1.3, .8, .55, .25], SL = [.02, -.018, .012, 0];
    for (let L = 0; L < 4; L++) {
      for (let c = 0; c < COLS; c++) {
        const x = XMIN + (XMAX - XMIN) * c / (COLS - 1);
        const ph = x * (1.05 + L * .23) + tt * (.11 + L * .03) * turb + L * 1.7;
        const foldBoost = 1 + 1.6 * Math.exp(-(Math.cos(ph) ** 2) * 7);      // sheet seen edge-on at the turns
        const xf = x + .18 * Math.sin(ph) + .1 * (fbm(x * .9 + L * 7, tt * .05 * turb) - .5);
        const wig = .035 * Math.sin(x * 4.3 + tt * .4 + L) + .018 * Math.sin(x * 9.7 - tt * .6 + L * 2) + .012 * Math.sin(x * 17 + tt * .9);
        const base = BASE[L] + SL[L] * x + AMP[L] * Math.sin(ph * .55 + 1.3 * L) + .09 * (fbm(xf * .7 + L * 3.1, tt * .04 * turb) - .5) + wig + (s.lift ?? 0);
        const height = H[L] * (.7 + .6 * fbm(xf * .8 + 11 + L, tt * .03)) * (1 + .4 * storm);
        const patch = Math.min(1.5, Math.pow(Math.max(0, fbm(xf * .5 + 5 + L * 2.3, tt * .03 * turb) - .36) * 3.2, 1.25));
        const r1 = vnoise(xf * 24 + L * 50, tt * .45), r2 = vnoise(xf * 58 + L * 9, tt * .8), r3 = vnoise(xf * 130 + L * 3, tt * 1.4);
        const rays = .35 + .65 * Math.pow(r1 * .55 + r2 * .3 + r3 * .15, 1.6) * 1.9;
        const flick = storm > 0 ? 1 + storm * .4 * (vnoise(x * 3 + L, t * 6) - .5) : 1;
        const i = (L * COLS + c) * 4;
        d[i] = base; d[i + 1] = height; d[i + 2] = patch * rays * foldBoost * flick * G[L]; d[i + 3] = fbm(xf * .35 + 20 + L, tt * .03);
      }
    }
    const ridged = (x, y, o) => { let s2 = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s2 += a * (1 - Math.abs(2 * vnoise(x * f, y) - 1)); f *= 2.1; a *= .5; } return s2; };
    for (let c = 0; c < COLS; c++) { // mountain ranges: far peaks (r), near forested ridge (g)
      const x = XMIN + (XMAX - XMIN) * c / (COLS - 1);
      const far = Math.max(0, .02 + .16 * Math.pow(ridged(x * .9 + 3, 1.7, 5), 2.2) * (.55 + .45 * Math.sin(x * .6 + .8) ** 2));
      const trees = .006 * vnoise(x * 180, 2) + .004 * vnoise(x * 420, 5);
      const near = .012 + .045 * Math.pow(fbm(x * 1.9 + 9, 4.2, 4), 1.5) + trees;
      const i = (4 * COLS + c) * 4; d[i] = far; d[i + 1] = near; d[i + 2] = 0; d[i + 3] = 0;
    }
  }

  render(t, s) {
    const gl = this.gl, u = this.u;
    this.columns(t, s);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, COLS, ROWS, 0, gl.RGBA, gl.FLOAT, this.data);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.uniform1i(u.col, 0);
    gl.uniform1f(u.aspect, this.aspect); gl.uniform1f(u.t, t); gl.uniform1f(u.dpr, this.dpr);
    gl.uniform1f(u.inten, s.inten ?? 1); gl.uniform1f(u.storm, s.storm ?? 0); gl.uniform1f(u.dawn, s.dawn ?? 0);
    gl.uniform1f(u.waveX, s.waveX ?? -9); gl.uniform1f(u.waveA, s.waveA ?? 0); gl.uniform1f(u.stars, s.stars ?? 1);
    gl.uniform1f(u.pulse, s.pulse ?? 0); gl.uniform1f(u.sunY, s.sunY ?? -.5); gl.uniform1f(u.horizon, s.horizon ?? -.28);
    gl.uniform1f(u.xmin, XMIN); gl.uniform1f(u.xmax, XMAX); gl.uniform1f(u.lake, s.lake ?? 1); gl.uniform1f(u.mountains, s.mountains ?? 1);
    gl.uniform1f(u.meteor, s.meteor ?? .35); const m = s.m1 || [0, 0, 0, 0]; gl.uniform4f(u.m1, m[0], m[1], m[2], m[3]);
    const c = s.cam || {}; gl.uniform4f(u.cam, c.pan ?? 0, c.tilt ?? 0, c.zoom ?? 1, c.roll ?? 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.finish();
  }
}
