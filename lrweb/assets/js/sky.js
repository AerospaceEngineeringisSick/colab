/* LRWeb sky: a WebGL night that turns into an LRWeb dawn.
   Aurora in the brand greens/blues/indigos, stars, a rising gradient sun,
   and a calm sea reflecting all of it with sun-glitter.
   Usage: new LRSky(canvas, { prog, hz, sunX, sunR, aurora })  */
(() => {
  const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes; uniform float uTime, uProg, uHz, uSunX, uSunR, uAur, uQ; uniform vec2 uMouse;
const vec3 GREEN = vec3(.239,.722,.553);
const vec3 BLUE = vec3(.043,.525,.918);
const vec3 INDIGO = vec3(.247,.302,.902);
float hash(vec2 p){ p = fract(p*vec2(233.34,851.73)); p += dot(p,p+23.45); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
vec3 brand(float t){ t = clamp(t,0.,1.); return t < .5 ? mix(GREEN,BLUE,t*2.) : mix(BLUE,INDIGO,(t-.5)*2.); }

vec3 sky(vec2 uv, float ax){
  float h = clamp((uv.y - uHz) / (1. - uHz), 0., 1.);
  float d = smoothstep(.35, 1., uProg);
  vec3 top = mix(vec3(.018,.02,.078), vec3(.05,.06,.24), d);
  vec3 mid = mix(vec3(.03,.036,.15), vec3(.1,.14,.54), d);
  vec3 hor = mix(vec3(.07,.078,.33), vec3(.15,.44,.8), d);
  vec3 col = mix(hor, mid, smoothstep(0., .45, h));
  col = mix(col, top, smoothstep(.35, 1., h));
  col += GREEN * .32 * d * exp(-h * 6.);
  // stars
  vec2 sp = vec2(ax, uv.y) * 150.;
  vec2 cell = floor(sp); vec2 f = fract(sp) - .5;
  float r = hash(cell);
  vec2 off = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - .5) * .6;
  float px = 150. / uRes.y;                       // one canvas pixel in cell units
  float star = step(.982, r) * smoothstep(max(.12, px * 1.5), 0., length(f + off));
  float tw = .5 + .5 * sin(uTime * (1. + r * 3.) + r * 60.);
  float fadeS = (1. - smoothstep(.55, .95, uProg)) * smoothstep(.02, .2, h);
  col += vec3(.9, .95, 1.) * star * tw * fadeS * (r > .997 ? 1.6 : .75);
  // aurora curtains
  float aStr = uAur * (1. - smoothstep(.55, .9, uProg));
  if (aStr > .001) {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float x = ax * .9 + (uMouse.x - .5) * .22 + fi * 1.7;
      float base = uHz + .3 + fi * .085 + (fbm(vec2(x * 1.05 + uTime * .03, fi * 3.1)) - .5) * .34;
      base += (uMouse.y - .5) * .04 * (1. - fi * .3);
      float above = uv.y - base;
      float curtain = smoothstep(-.03, 0., above) * exp(-max(above, 0.) * (5. + fi * 2.2));
      float under = exp(min(above, 0.) * 45.) * .1;
      float rays = .3 + .7 * fbm(vec2(x * 24. + uTime * .12, uTime * .07 + fi));
      rays *= .6 + .4 * sin(x * 55. + uTime * .5 + fi * 2.) * sin(x * 13. - uTime * .2);
      vec3 ac = i == 0 ? mix(GREEN, BLUE, clamp(above * 4., 0., 1.))
              : i == 1 ? mix(BLUE, INDIGO, clamp(above * 3., 0., 1.))
                       : mix(GREEN, INDIGO, clamp(above * 2.5, 0., 1.));
      col += ac * (curtain * rays + under * (1. - curtain)) * aStr * (.8 - fi * .18);
    }
  }
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float asp = uRes.x / uRes.y;
  float ax = (uv.x - .5) * asp;
  float t = uTime;
  float rise = smoothstep(.38, 1., uProg);
  float R = uSunR;
  vec2 sunC = vec2((uSunX - .5) * asp, uHz - R * 1.03 + rise * R * 1.3);
  vec3 col;
  if (uv.y >= uHz) {
    col = sky(uv, ax);
    float dd = length(vec2(ax, uv.y) - sunC);
    float disc = smoothstep(R, R - 1.6 / uRes.y, dd);
    float rr = dd / R;
    vec3 sc = brand((ax - sunC.x) / (2. * R) + .5) * (1.08 - .2 * rr * rr) + .05 + .12 * smoothstep(.75, 1., rr);
    col = mix(col, sc, disc);
  } else {
    float k = uHz - uv.y;
    float depth = k / max(uHz, .001);
    float w = fbm(vec2(uv.x * 7., k * 55. / (depth * 2. + .25) - t * .45)) - .5;
    float rx = uv.x + w * .035 * (.2 + depth);
    float ry = uHz + k * 1.6 + w * .02;
    col = sky(vec2(rx, min(ry, .999)), (rx - .5) * asp) * (.74 - .32 * depth);
    col = mix(col, vec3(.014, .018, .07), depth * .42);
    float dx = abs(ax - sunC.x);
    float colW = R * (.5 + depth * 1.2);
    float column = exp(-pow(dx / colW, 2.) * 2.) * rise;
    // glitter: one soft, randomly placed glint per cell of a perspective grid on the water.
    // Gaussian shapes fade out well inside each cell, so no cell edges ever show.
    float z = 1. / (depth + .08);
    vec2 gp = vec2(ax * z * 40. + w * 2., z * 9.);
    vec2 cid = floor(gp), f = fract(gp) - .5;
    float r = hash(cid);
    vec2 o = (vec2(hash(cid + 1.7), hash(cid + 4.3)) - .5) * .45;
    vec2 q = (f - o) / vec2(.3, .12);
    float tw = .5 + .5 * sin(t * (1.6 + r * 3.5) + r * 40.);
    float spark = exp(-dot(q, q) * 2.4) * smoothstep(.45, .95, tw) * step(.3, r) * 3.2 * smoothstep(.03, .16, depth);
    col += brand((ax - sunC.x) / (2. * R) + .5) * column * (.16 + spark) * (1. - depth * .45);
    col += vec3(.55, .75, 1.) * spark * .045 * (1. - column);
  }
  float d2 = length(vec2(ax, uv.y) - sunC);
  col += mix(BLUE, GREEN, .35) * exp(-max(d2 - R, 0.) * 6.5) * rise * .38;
  col += vec3(.85, .92, 1.) * exp(-abs(uv.y - uHz) * uRes.y * .55) * .42 * step(.001, uHz);
  col *= 1. - .22 * pow(length(uv - vec2(.5, .58)) * 1.2, 2.);
  col += (hash(gl_FragCoord.xy) - .5) * .008;   // static dither against banding
  gl_FragColor = vec4(col, 1.);
}`;

  class LRSky {
    constructor(canvas, o = {}) {
      this.c = canvas;
      this.o = Object.assign({ prog: 0, hz: .18, sunX: .72, sunR: .22, aurora: 1, quality: 1 }, o);
      this.mouse = [.5, .5]; this.mt = [.5, .5];
      this.visible = true; this.ok = false;
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
      if (!gl) { canvas.classList.add('sky-fallback'); return; }
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      try {
        const pr = gl.createProgram();
        gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(pr); gl.useProgram(pr);
        this.pr = pr;
      } catch (e) { console.warn(e); canvas.classList.add('sky-fallback'); return; }
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(this.pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; ['uRes', 'uTime', 'uProg', 'uHz', 'uSunX', 'uSunR', 'uAur', 'uMouse', 'uQ'].forEach(n => this.u[n] = gl.getUniformLocation(this.pr, n));
      this.gl = gl; this.ok = true; this.t0 = performance.now();
      this.resize();
      new IntersectionObserver(([e]) => this.visible = e.isIntersecting, { rootMargin: '100px' }).observe(canvas);
      // size follows the element, not just the window (fixes skies that start at 0x0)
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(canvas);
      else addEventListener('resize', () => this.resize());
      this.scale = 1; this.slow = 0; this.last = 0;
      canvas.classList.add('sky-ready');
    }
    resize() {
      if (!this.ok) return;
      const small = innerWidth < 760, dpr = Math.min(devicePixelRatio || 1, 2);
      // aim for ~0.8 CSS px per canvas px on desktop, less on phones; adaptive scale drops it if frames get slow
      this.q = Math.min(dpr, small ? 1.1 : 1.25) * (small ? .62 : .8) * this.o.quality * (this.scale || 1);
      const w = this.c.clientWidth, h = this.c.clientHeight;
      const W = Math.max(2, Math.round(w * this.q)), H = Math.max(2, Math.round(h * this.q));
      if (W === this.c.width && H === this.c.height) return;
      this.c.width = W; this.c.height = H;
      this.gl.viewport(0, 0, W, H);
    }
    set(k, v) { this.o[k] = v; }
    pointer(x, y) { this.mt = [x, y]; }
    render(now) {
      if (!this.ok || !this.visible) return;
      // adaptive quality: if frames keep taking longer than ~22ms, render fewer pixels
      if (this.last) { const dt = now - this.last; this.slow = dt > 22 && dt < 200 ? this.slow + 1 : Math.max(0, this.slow - 1); if (this.slow > 40 && this.scale > .55) { this.scale *= .85; this.slow = 0; this.resize(); } }
      this.last = now;
      const gl = this.gl, u = this.u, o = this.o, reduce = LRSky.reduce;
      this.mouse[0] += (this.mt[0] - this.mouse[0]) * .04; this.mouse[1] += (this.mt[1] - this.mouse[1]) * .04;
      gl.uniform2f(u.uRes, this.c.width, this.c.height);
      gl.uniform1f(u.uTime, reduce ? 12 : (now - this.t0) / 1000);
      gl.uniform1f(u.uProg, o.prog); gl.uniform1f(u.uHz, o.hz); gl.uniform1f(u.uSunX, o.sunX); gl.uniform1f(u.uSunR, o.sunR);
      gl.uniform1f(u.uAur, o.aurora); gl.uniform1f(u.uQ, this.q);
      gl.uniform2f(u.uMouse, this.mouse[0], this.mouse[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  LRSky.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.LRSky = LRSky;
})();
