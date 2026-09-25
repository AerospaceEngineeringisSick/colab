// LRWeb promo v4, "Websites, handled.": a motion-design showreel. window.seek(t) renders any moment deterministically.
import { Aurora } from './aurora.js';

const TL = window.TL;
const Q = new URLSearchParams(location.search);
const EDIT = TL.EDITS[Q.get('edit') || 'landscape'];
const { W, H } = EDIT;
const V = H > W, BAR = TL.BAR, BEAT = TL.BEAT;
const DPR = window.devicePixelRatio || 1;
const L = (a, b) => (V ? b : a); // landscape value, vertical value

// ------------------------------------------------------------------ maths
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (x, a, b) => clamp((x - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const E = {
  out: (x) => 1 - (1 - x) ** 3, out4: (x) => 1 - (1 - x) ** 4, out5: (x) => 1 - (1 - x) ** 5, expo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  in: (x) => x * x * x, in2: (x) => x * x, inOut: (x) => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inOut5: (x) => (x < .5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2), back: (x, c = 1.7) => 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2,
};
// damped spring from 0 to 1 (closed form, deterministic)
const spring = (t, f = 1.6, z = .5) => { if (t <= 0) return 0; const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
const env = (t, times, tau) => { let v = 0; for (const x of times) { const d = t - x; if (d >= 0 && d < tau * 5) v = Math.max(v, Math.exp(-d / tau)); } return v; };

// ------------------------------------------------------------------ DOM
const $ = (s, r = document) => r.querySelector(s);
const html = (s) => { const d = document.createElement('div'); d.innerHTML = s.trim(); return d.firstChild; };
const add = (p, s, css = {}) => { const e = typeof s === 'string' ? html(s) : s; Object.assign(e.style, css); p.appendChild(e); return e; };
const px = (v) => `${v}px`;
function tf(o) {
  let s = '';
  if (o.x || o.y || o.z) s += `translate3d(${(o.x || 0).toFixed(2)}px,${(o.y || 0).toFixed(2)}px,${(o.z || 0).toFixed(2)}px) `;
  if (o.rx) s += `rotateX(${o.rx.toFixed(3)}deg) `; if (o.ry) s += `rotateY(${o.ry.toFixed(3)}deg) `; if (o.r) s += `rotate(${o.r.toFixed(3)}deg) `;
  if (o.skx) s += `skewX(${o.skx.toFixed(3)}deg) `;
  if (o.s != null && o.s !== 1) s += `scale(${o.s.toFixed(4)}) `;
  if (o.sx != null || o.sy != null) s += `scale(${(o.sx ?? 1).toFixed(4)},${(o.sy ?? 1).toFixed(4)}) `;
  return s || 'none';
}
function set(el, o = {}) {
  const op = clamp(o.o ?? 1); el.style.opacity = op; el.style.visibility = op > .002 ? 'visible' : 'hidden';
  el.style.transform = tf(o); const b = o.b || 0; el.style.filter = (b > .25 ? `blur(${b.toFixed(1)}px) ` : '') + (o.f || '');
}
const hide = (el) => { el.style.visibility = 'hidden'; el.style.opacity = 0; };
const wght = (el, w) => { el.style.fontVariationSettings = `'wght' ${w.toFixed(0)}`; };

// stage
document.documentElement.style.cssText = `width:${W}px;height:${H}px`;
document.body.style.cssText = `width:${W}px;height:${H}px`;
const stage = $('#stage'); stage.style.width = px(W); stage.style.height = px(H);
const dom = $('#dom'); if (V) document.body.classList.add('V');
const fxc = $('#fx'); fxc.width = W * DPR; fxc.height = H * DPR; const fx = fxc.getContext('2d'); fx.scale(DPR, DPR);

// ------------------------------------------------------------------ icons and marks
const I = {
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>', shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  db: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', check: '<path d="M5 12.5l4.2 4.2L19 7"/>', moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  update: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/>', backup: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>', uptime: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
};
const icon = (k, stroke = '#fff', w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${I[k]}</svg>`;
const APP = { Website: ['refresh', '#0B86EA,#3F4DE6'], Security: ['shield', '#FF5C6C,#C0266D'], Backups: ['db', '#FFB547,#E07A12'], Speed: ['gauge', '#FF8A3D,#E0442E'],
  Inbox: ['mail', '#0B86EA,#12A4E0'], Hosting: ['server', '#8B5CF6,#5B21B6'], Uptime: ['pulse', '#FF5C6C,#E0442E'] };
const noteHTML = ([app, title, body]) => { const [ic, cols] = APP[app] || APP.Website;
  return `<div class="note"><div class="ic" style="background:linear-gradient(135deg,${cols})">${icon(ic)}</div><div class="nb"><div class="nh"><b>${app}</b><span>now</span></div><div class="nt">${title}</div><div class="nd">${body}</div></div></div>`; };
// the LR mark, traced from the logo
const MARK_L = 'M17 1.5H34L24.5 49.5H69L84.5 65H4Z';
const MARK_R = 'M44 1.5H95Q110 1.5 110 16V27Q110 36 97 43L119 65H96L62.5 29.5H89Q95 29.5 95 23V21Q95 15 89 15H58L51 43H34Z';
let uid = 0;
function lockupHTML() {
  const id = `m${uid++}`;
  return `<div class="lockup"><svg viewBox="0 0 123 67"><defs><clipPath id="${id}c"><path d="${MARK_L}"/><path d="${MARK_R}"/></clipPath>
    <linearGradient id="${id}g" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <g class="pl"><path class="fl" d="${MARK_L}" fill="#0A74C9"/><path class="sl" d="${MARK_L}" fill="none" stroke="#E6FFF6" stroke-width="1.3" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/></g>
    <g class="pr"><path class="fr" d="${MARK_R}" fill="#3CB88C"/><path class="sr" d="${MARK_R}" fill="none" stroke="#E6FFF6" stroke-width="1.3" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/></g>
    <g clip-path="url(#${id}c)"><rect class="sweep" x="-60" y="-10" width="40" height="90" fill="url(#${id}g)" transform="skewX(-20)"/></g></svg>
    <div class="wm">${[...'LRWeb'].map((c) => `<span>${c}</span>`).join('')}</div></div>`;
}
// draw / snap / sweep / wordmark for a lockup at time d (seconds since the mark starts)
function markDraw(lg, d, o = {}) {
  const { drawDur = .6, fillAt = .45, wordAt = null } = o;
  const draw = E.inOut(P(d, 0, drawDur)), fill = E.out(P(d, fillAt, fillAt + .4));
  lg.querySelectorAll('.sl,.sr').forEach((p) => { p.style.strokeDashoffset = 1 - draw; p.style.opacity = d < 0 ? 0 : 1 - .95 * fill; });
  lg.querySelectorAll('.fl,.fr').forEach((p) => { p.style.opacity = fill; });
  const sw = P(d, fillAt + .3, fillAt + .85); lg.querySelector('.sweep').setAttribute('x', (-60 + sw * 200).toFixed(1));
  lg.querySelector('svg').style.filter = `drop-shadow(0 0 ${18 + 30 * (1 - fill)}px rgba(111,224,180,${(.35 + .45 * (1 - fill)).toFixed(2)}))`;
  wordmark(lg, wordAt === null ? -1 : d - wordAt);
}
function wordmark(lg, d) {
  [...lg.querySelectorAll('.wm span')].forEach((c, i) => { const e = d - i * .045, p = E.out4(clamp(e / .55)); c.style.transform = `translateX(${((1 - p) * -120).toFixed(1)}%)`; c.style.opacity = e < 0 ? 0 : 1; });
}

// ------------------------------------------------------------------ kinetic type
// T(parent, lines): a text block; a word in *stars* gets the aurora gradient; every character is its own span
function T(parent, lines, css = {}, cls = 't c') {
  const e = add(parent, `<div class="${cls}"></div>`, css); e.chars = []; e.words = []; e.fs = parseFloat(css.fontSize) || 100;
  e.scrim = add(e, '<div class="scrim"></div>');
  lines.forEach((ln) => {
    const l = add(e, '<span class="ln"></span>');
    ln.split(' ').forEach((w, i) => {
      if (i) add(l, '<span class="sp"></span>');
      const g = w.includes('*'); const we = add(l, '<span class="w"></span>'); we.g = g;
      we.chars = [...w.replace(/\*/g, '')].map((c) => { const ce = add(we, `<span class="ch${g ? ' gr' : ''}">${c}</span>`); e.chars.push(ce); return ce; });
      e.words.push(we);
    });
  });
  return e;
}
// after layout: make the gradient run continuously across each gradient word
function fixGradients(root = dom) {
  root.querySelectorAll('.t .w').forEach((we) => {
    if (!we.g) return; const ww = we.offsetWidth; let x = 0;
    we.chars.forEach((c) => { c.style.backgroundSize = `${ww}px 100%`; c.style.backgroundPosition = `${-x}px 0`; x += c.offsetWidth; });
  });
}
// one unit (char or word) arriving: rise, weight morph 200 -> 800, de-blur. Returns visible opacity.
function unit(u, d, fs, o = {}) {
  const { dur = .55, y = .32, w0 = 220, blur = 10, s0 = 1, ex = null, exDur = .35, xFrom = 0 } = o;
  if (d < 0) { u.style.opacity = 0; return 0; }
  const p = clamp(d / dur), pe = E.out4(p);
  let op = clamp(d / .1), ty = (1 - pe) * y * fs, b = (1 - E.out(p)) * blur, s = lerp(s0, 1, spring(d, 1.5, .55)), tx = (1 - pe) * xFrom * fs;
  if (ex !== null && d > ex) { const q = E.in2(clamp((d - ex) / exDur)); op *= 1 - q; ty -= q * .25 * fs; b += q * 10; }
  u.style.opacity = op; u.style.transform = `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px)${s !== 1 ? ` scale(${s.toFixed(4)})` : ''}`;
  u.style.filter = b > .3 ? `blur(${b.toFixed(1)}px)` : ''; wght(u, lerp(w0, 800, E.out(clamp(d / (dur * .9)))));
  return op;
}
// animate a text block: units 'chars' or 'words', staggered. dt = seconds since its cue.
function type(e, dt, o = {}) {
  const { units = 'words', st = .07, ex = null, exSt = .03 } = o;
  const U = units === 'chars' ? e.chars : e.words;
  if (dt < 0 || (ex !== null && dt > ex + (o.exDur ?? .35) + exSt * U.length + .05)) { e.style.visibility = 'hidden'; return 0; }
  e.style.visibility = 'visible'; let vis = 0;
  U.forEach((u, i) => { vis = Math.max(vis, unit(u, dt - i * st, e.fs, { ...o, ex: ex === null ? null : ex - i * st + i * exSt })); });
  e.scrim.style.opacity = vis * (o.scrim ?? 1);
  return vis;
}
const setVis = (e, on) => { e.style.visibility = on ? 'visible' : 'hidden'; };

// ------------------------------------------------------------------ fx canvas (particles, rings, streaks, tiles)
const FX = [];
const PCOL = ['111,224,180', '11,134,234', '230,255,245', '139,149,247'];
function burst(t0, cx, cy, n, spd, seed, life = 1.6) { FX.push({ k: 'burst', t0, cx, cy, n, spd, seed, life }); }
function rings(t0, cx, cy, n = 3, r1 = 900) { FX.push({ k: 'rings', t0, cx, cy, n, r1 }); }
function converge(t0, t1, cx, cy, n, seed) { FX.push({ k: 'conv', t0, t1, cx, cy, n, seed }); }
function drawFX(t) {
  fx.clearRect(0, 0, W, H);
  for (const f of FX) {
    if (f.k === 'burst') {
      const dt = t - f.t0; if (dt < 0 || dt > f.life) continue; fx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < f.n; i++) {
        const a = hash(f.seed + i * 1.37) * 6.283, v = f.spd * (.25 + hash(f.seed + i * 2.71) ** .6), dr = (1 - Math.exp(-3 * dt)) / 3;
        const x = f.cx + Math.cos(a) * v * dr, y = f.cy + Math.sin(a) * v * dr + 60 * dt * dt;
        const life = clamp(1 - dt / (f.life * (.45 + .55 * hash(f.seed + i * 4.1)))), s = (1 + 2.8 * hash(f.seed + i * 5.3)) * (.4 + .6 * life);
        fx.fillStyle = `rgba(${PCOL[i % 4]},${(life * .95).toFixed(3)})`; fx.beginPath(); fx.arc(x, y, s, 0, 6.283); fx.fill();
      }
    } else if (f.k === 'rings') {
      const dt = t - f.t0; if (dt < 0 || dt > 1.4) continue; fx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < f.n; i++) {
        const d = dt - i * .07; if (d < 0) continue; const p = E.out(clamp(d / 1.1)), r = 20 + p * f.r1 * (1 + i * .25);
        fx.strokeStyle = `rgba(${PCOL[i % 3]},${((1 - p) * .85).toFixed(3)})`; fx.lineWidth = lerp(14, 1, p) / (1 + i * .5);
        fx.beginPath(); fx.arc(f.cx, f.cy, r, 0, 6.283); fx.stroke();
      }
    } else if (f.k === 'conv') {
      if (t < f.t0 || t > f.t1 + .05) continue; fx.globalCompositeOperation = 'lighter'; const p = E.in(P(t, f.t0, f.t1));
      for (let i = 0; i < f.n; i++) {
        const a = hash(f.seed + i * 1.1) * 6.283, r0 = (200 + hash(f.seed + i * 2.3) * Math.max(W, H) * .7) * (1 - p);
        const x = f.cx + Math.cos(a + p * 1.5) * r0, y = f.cy + Math.sin(a + p * 1.5) * r0;
        fx.fillStyle = `rgba(${PCOL[i % 4]},${(.25 + .7 * p).toFixed(3)})`; fx.beginPath(); fx.arc(x, y, 1.2 + 2 * hash(i * 9.1), 0, 6.283); fx.fill();
      }
    } else if (f.k === 'draw') f.fn(t);
  }
  fx.globalCompositeOperation = 'source-over';
}
// tile wipe: rounded squares cover the frame in a diagonal wave, then uncover it
function tileWipe(tA, tB, tC) {
  FX.push({ k: 'draw', fn: (t) => {
    if (t < tA || t > tC) return;
    const cols = V ? 6 : 10, sz = W / cols, rows = Math.ceil(H / sz), n = cols + rows;
    const grad = ['#6FE0B4', '#3DB88D', '#0B86EA', '#3F4DE6', '#8B95F7'];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = (c + r) / n; let s;
      if (t < tB) s = E.out4(P(t, tA + k * (tB - tA) * .6, tA + k * (tB - tA) * .6 + (tB - tA) * .4));
      else s = 1 - E.in(P(t, tB + k * (tC - tB) * .6, tB + k * (tC - tB) * .6 + (tC - tB) * .4));
      if (s <= .001) continue;
      const w = sz * s * 1.02, x = c * sz + (sz - w) / 2, y = r * sz + (sz - w) / 2, rad = sz * .5 * (1 - s) + 4;
      fx.fillStyle = grad[Math.min(4, Math.floor(k * 5))]; fx.beginPath(); fx.roundRect(x, y, w, w, rad); fx.fill();
    }
  } });
}

// ------------------------------------------------------------------ scenes
const scenes = []; const shared = {}; const S = {};
const mkRoot = () => add(dom, '<div class="scene"></div>');
const B = (bar) => bar * BAR;
const CX = W / 2, CY = H / 2;

const builders = {
  // ================================================================ OPEN: a dot of light becomes a cursor and types
  open(sc) {
    const r = (sc.root = mkRoot()); sc.post = 3.0;
    const o = sc.o, J = S.jobs.o, j0 = B(S.jobs.s);
    const t1 = T(r, ['Every website'], { top: px(L(300, 640)), fontSize: px(L(150, 128)) });
    const t2 = T(r, V ? ['comes with'] : ['comes with *jobs.*'], { top: px(L(470, 790)), fontSize: px(L(150, 128)) });
    const t3 = V ? T(r, ['*jobs.*'], { top: px(930), fontSize: px(280) }) : null;
    const jobsW = V ? t3.words[0] : t2.words[2], lead = V ? t2.words : t2.words.slice(0, 2);
    const dot = add(r, '<div class="dot"></div>');
    const texts = [t1, t2, t3].filter(Boolean);
    shared.jobsW = jobsW; shared.openTexts = texts;
    const tc = (i) => B(o.type) + (i + 1) * B(.0625); // each letter on a 16th
    sc.measure = () => {
      const x0 = t1.chars[0].getBoundingClientRect().left;
      sc.rights = t1.chars.map((c) => c.getBoundingClientRect().right); sc.x0 = x0;
      const rc = t1.chars[0].getBoundingClientRect(); sc.cy = rc.top + rc.height * .55; sc.capH = t1.fs * .72;
    };
    sc.update = (ls, G) => {
      // the dot -> a line -> the cursor
      const LW = L(1100, 820);
      let w = 18, h = 18, x = CX, y = sc.cy, op = 1, rad = 9;
      const dd = ls - B(o.dot);
      if (dd < 0) op = 0;
      else if (ls < B(o.line)) { const s = spring(dd, 2.2, .42); w = h = 18 * s; }
      else if (ls < B(o.cursor)) { const p = E.expo(P(ls, B(o.line), B(o.line) + .45)); w = lerp(18, LW, p); h = lerp(18, 4, E.out4(p)); rad = h / 2; }
      else {
        const p = E.inOut(P(ls, B(o.cursor), B(o.cursor) + .2)); const typed = t1.chars.filter((c, i) => ls >= tc(i)).length;
        const tx = typed ? sc.rights[typed - 1] + 14 : sc.x0 - 10;
        const prev = typed > 1 ? sc.rights[typed - 2] + 14 : sc.x0 - 10;
        const cx = typed ? lerp(prev, tx, E.out(clamp((ls - tc(typed - 1)) / .07))) : tx;
        w = lerp(LW, 8, p); h = lerp(4, sc.capH, E.out(p)); x = lerp(CX, cx, p); rad = 4;
        if (ls > tc(12) + .1) op = Math.floor((ls - tc(12)) / .25) % 2 ? .15 : 1;
        op *= 1 - P(ls, j0, j0 + .2);
      }
      Object.assign(dot.style, { width: px(w), height: px(h), marginLeft: px(-w / 2), marginTop: px(-h / 2), left: px(x), top: px(y), borderRadius: px(rad), opacity: op, visibility: op > 0 ? 'visible' : 'hidden' });
      if (dd > 0 && dd < 1.2) G.mb = Math.max(G.mb, ls > B(o.line) - .05 && ls < B(o.line) + .5 ? 4 : 1);
      // the typed line
      setVis(t1, ls >= tc(0) - .05); let vis = 0;
      t1.chars.forEach((c, i) => { vis = Math.max(vis, unit(c, ls - tc(i), t1.fs, { dur: .38, y: .22, blur: 6, w0: 200 })); });
      t1.scrim.style.opacity = vis;
      // "comes with" then "jobs."
      const lead0 = j0 + B(J.l2), jb = j0 + B(J.l3);
      setVis(t2, ls >= lead0 - .05); if (t3) setVis(t3, ls >= jb - .05);
      lead.forEach((we, i) => unit(we, ls - lead0 - i * BEAT * .5, t2.fs, { dur: .6, y: .45, blur: 10 }));
      const jd = ls - jb; unit(jobsW, jd, (t3 || t2).fs, { dur: .6, y: .1, blur: 16, s0: 1.45 });
      if (!V) jobsW.style.transform += ''; // same block as "comes with" in landscape
      t2.scrim.style.opacity = Math.max(+lead[0].style.opacity || 0, 0); if (t3) t3.scrim.style.opacity = +jobsW.style.opacity || 0;
      if (jd > 0 && jd < .3) jobsW.style.filter = `brightness(${(1 + 1.2 * (1 - jd / .3)).toFixed(2)})`;
      // the iris: zoom through the "o" of jobs.
      const ir = G.iris;
      if (ir) {
        const { cx, cy } = shared.o;
        texts.forEach((e) => { e.style.transformOrigin = `${cx}px ${cy - parseFloat(e.style.top)}px`; e.style.transform = `translate(${ir.dx}px,${ir.dy}px) scale(${ir.s})`; e.scrim.style.opacity = 1 - P(ir.p, 0, .15); });
        jobsW.chars[1].style.visibility = 'hidden';
        texts.forEach((e) => setVis(e, ir.p < 1)); G.mb = Math.max(G.mb, ir.p > 0 && ir.p < 1 ? 6 : 1);
      } else {
        texts.forEach((e) => { e.style.transform = ''; }); if (jobsW.chars[1]) jobsW.chars[1].style.visibility = '';
      }
    };
    sc.sky = (ls) => ({ inten: 0, stars: .95 * E.out(P(ls, .6, 3.4)), meteor: 0, m1: [L(-.35, -.08), .34, 2.55, 1], cam: { tilt: .44, zoom: 1.02 - .02 * P(ls, 0, 4) } });
  },

  // ================================================================ JOBS: "comes with jobs." and the notification wall behind the o
  jobs(sc) {
    const r = (sc.root = shared.wall = mkRoot()); sc.post = B(S.storm.len) + .01; const J = sc.o, St = S.storm.o, s0 = B(S.storm.s);
    const world = add(r, '<div class="world"><div class="rig"></div></div>'); const rig = (shared.rig = world.firstChild);
    // pop-up times: three through the iris, one each beat of the storm, then a rush on 16ths
    const times = [...J.pops.map((b) => B(sc.s + b)), ...St.pops.map((b) => s0 + B(b + .125)), ...St.rush.map((b) => s0 + B(b))];
    const NW = L(560, 640), NH = L(120, 140);
    const zone = V ? { x0: 60, x1: 1020, y0: 740, y1: 1200 } : { x0: 400, x1: 1520, y0: 380, y1: 700 };
    const pos = []; let k = 0;
    while (pos.length < times.length && k < 20000) {
      k++; const x = 24 + hash(k * 1.31 + 7) * (W - NW - 48), y = 24 + hash(k * 2.17 + 3) * (H - NH - 48), cx = x + NW / 2, cy = y + NH / 2;
      if (cx > zone.x0 - NW * .35 && cx < zone.x1 + NW * .35 && cy > zone.y0 - NH * .5 && cy < zone.y1 + NH * .5 && k < 15000) continue;
      const tight = pos.length < 10 ? 1 : pos.length < 16 ? .75 : .5;
      if (k < 15000 && pos.some((p) => Math.abs(p.x - x) < NW * tight * .95 && Math.abs(p.y - y) < NH * tight * 1.3)) continue;
      pos.push({ x, y, z: -280 + hash(k * 3.7) * 400, r: (hash(k * 5.3) - .5) * 7 });
    }
    const notes = times.map((t0, i) => { const n = add(rig, noteHTML(TL.POPS[i % TL.POPS.length])); Object.assign(n.style, { left: px(pos[i].x), top: px(pos[i].y) }); n.t0 = t0; n.p = pos[i]; return n; });
    shared.notes = notes;
    // the ring used for the iris (above everything)
    const ringL = add(dom, '<div class="layer" style="pointer-events:none"></div>');
    shared.ring = add(ringL, `<svg class="abs" width="${W}" height="${H}" style="left:0;top:0;overflow:visible;visibility:hidden"><defs><linearGradient id="rg" x1="0" x2="1"><stop offset="0" stop-color="#C9FFE8"/><stop offset="1" stop-color="#8FD8FF"/></linearGradient></defs><path fill="url(#rg)" fill-rule="evenodd"/></svg>`);
    sc.measure = () => {
      const oc = shared.jobsW.chars[1], rc = oc.getBoundingClientRect(), fs = parseFloat(getComputedStyle(oc).fontSize);
      const cv = document.createElement('canvas'); cv.width = 800; cv.height = 800; const c = cv.getContext('2d');
      c.font = `800 400px Brico`; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic'; c.fillText('o', 200, 600);
      const m = c.measureText('o'), k2 = fs / 400, img = c.getImageData(0, 0, 800, 800).data;
      const midY = Math.round(600 - (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2), a = (x, y) => img[(y * 800 + x) * 4 + 3] > 128;
      let xs = []; for (let x = 1; x < 799; x++) if (a(x, midY) !== a(x - 1, midY)) xs.push(x);
      let ys = []; const midX = Math.round((xs[0] + xs[xs.length - 1]) / 2); for (let y = 1; y < 799; y++) if (a(midX, y) !== a(midX, y - 1)) ys.push(y);
      const fA = m.fontBoundingBoxAscent * k2, fD = m.fontBoundingBoxDescent * k2, base = rc.top + (rc.height - (fA + fD)) / 2 + fA;
      const cx = rc.left + (midX - 200) * k2, cy = base + ((ys[0] + ys[ys.length - 1]) / 2 - 600) * k2;
      const Rx = (xs[xs.length - 1] - xs[0]) / 2 * k2, Ry = (ys[ys.length - 1] - ys[0]) / 2 * k2, rx = (xs[2] - xs[1]) / 2 * k2, ry = (ys[2] - ys[1]) / 2 * k2;
      shared.o = { cx, cy, rx, ry };
      const el = (a1, b1) => `M${cx - a1} ${cy}a${a1} ${b1} 0 1 0 ${2 * a1} 0a${a1} ${b1} 0 1 0 ${-2 * a1} 0Z`;
      shared.ring.querySelector('path').setAttribute('d', el(Rx, Ry) + el(rx, ry));
    };
    const slams = St.words.map((b) => s0 + B(b));
    sc.update = (ls, G) => {
      const t = G.t, ir = G.iris;
      // the wall is only visible through the o until the iris completes
      if (t < B(sc.s + J.iris)) r.style.visibility = 'hidden';
      else { r.style.visibility = 'visible'; r.style.clipPath = ir ? `ellipse(${(shared.o.rx * ir.s * 1.02).toFixed(1)}px ${(shared.o.ry * ir.s * 1.02).toFixed(1)}px at ${ir.cx.toFixed(1)}px ${ir.cy.toFixed(1)}px)` : 'none'; }
      const ts = t - s0, words = ts >= 0 && ts < B(St.who), who = ts >= B(St.who), gap = ts >= B(St.gap), suck = P(ts, B(St.gap) + .25, B(4));
      const shake = env(t, slams, .07) * 9;
      const dz = -40 - Math.max(0, t - 6) * 12 - (who ? 280 * E.inOut(P(ts, B(St.who), B(St.who) + .8)) : 0);
      rig.style.transform = `translate3d(${(noise(t * 30) * shake).toFixed(1)}px,${(noise(t * 30 + 9) * shake).toFixed(1)}px,${dz.toFixed(1)}px) rotateY(${(noise(t * .25) * 4).toFixed(2)}deg) rotateX(${(noise(t * .2 + 4) * 3).toFixed(2)}deg)`;
      const dim = words ? .82 : who ? .5 : 1, blur = words ? 1.2 : who ? 5 : 0;
      notes.forEach((n, i) => {
        const d = t - n.t0; if (d < 0) return hide(n);
        const p = E.out4(clamp(d / .5)), sp = spring(d, 1.7, .5), q = E.in(suck);
        const x = lerp(0, CX - (n.p.x + L(280, 320)), q), y = lerp((1 - p) * 60, CY - (n.p.y + 60), q);
        set(n, { o: clamp(d / .1) * dim * (1 - q), x, y, z: n.p.z, r: n.p.r * (1 - q), s: lerp(.8, 1, sp) * (1 - .9 * q), b: blur + Math.abs(n.p.z + 80) * .004 + q * 8 });
      });
      r.style.filter = gap ? `grayscale(${P(ts, B(St.gap), B(St.gap) + .12).toFixed(2)})` : '';
      if (suck > 0 && suck < 1) G.mb = Math.max(G.mb, 6);
    };
    sc.sky = (ls) => ({ inten: .85 * E.out(P(ls, .8, 2.4)), stars: .95, meteor: .25, cam: { tilt: lerp(.44, .1, E.inOut(P(ls, .8, 2.6))), zoom: 1 + .35 * E.in(P(ls, 2, 2.95)) - .25 * P(ls, 2.95, 3.4), pan: 0 } });
  },

  // ================================================================ STORM: every job gets its own type treatment
  storm(sc) {
    const r = (sc.root = shared.wall), o = sc.o;
    const FS = L(230, 172), TOP = L(415, 870);
    const words = TL.JOBS.map((w) => T(r, [w], { top: px(TOP), fontSize: px(FS) }));
    words.forEach(hide);
    // 0 Updates: split-flap tiles
    words[0].chars.forEach((c) => { c.classList.add('flap'); c.orig = c.textContent; });
    // 1 Backups: echo copies
    const echoes = [1, 2, 3, 4, 5].map(() => { const e = T(r, [TL.JOBS[1]], { top: px(TOP), fontSize: px(FS) }, 't c outline'); e.scrim.remove(); hide(e); return e; });
    // 2 Security: decode + padlock
    words[2].chars.forEach((c) => { c.orig = c.textContent; });
    const lock = add(r, `<svg class="abs" viewBox="0 0 24 24" fill="none" stroke="#8CF0C8" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:${L(120, 110)}px;left:${CX - L(60, 55)}px;top:${TOP - L(150, 140)}px;overflow:visible">
      <rect x="5" y="11" width="14" height="10" rx="2" pathLength="1" stroke-dasharray="1"/><path class="sh" d="M8 11V8a4 4 0 0 1 8 0v3" pathLength="1" stroke-dasharray="1"/></svg>`); hide(lock);
    // 3 Hosting: server rack units wiping in behind the word
    const hw = words[3].words[0]; hw.style.position = 'relative'; hw.style.isolation = 'isolate';
    const racks = [0, 1, 2].map((i) => add(hw, `<div class="rack" style="top:${.12 + i * .3}em;width:100%;z-index:-1;background:linear-gradient(90deg,rgba(28,34,96,.95),rgba(40,52,140,.9));border:2px solid rgba(111,224,180,.45)"><i></i></div>`));
    // 4 Fixes: three slices snapping into line
    const slices = [0, 1, 2].map((i) => { const e = T(r, [TL.JOBS[4]], { top: px(TOP), fontSize: px(FS) }); e.scrim.remove(); e.style.clipPath = `inset(${i * 33.3}% -10% ${(2 - i) * 33.3}% -10%)`; hide(e); return e; });
    // 5 Speed: streaks
    const who = T(r, V ? ['Whose job', 'is that?'] : ['Whose job is that?'], { top: px(L(440, 780)), fontSize: px(L(150, 140)) }); hide(who);
    const GLY = '#$%&@*+=?/<>0123456789';
    FX.push({ k: 'draw', fn: (t) => { // speed streaks
      const d = t - B(sc.s + o.words[5]); if (d < 0 || d > 1) return;
      const a = 1 - P(d, .15, .45) + P(d, .8, .95) * (1 - P(d, .95, 1));
      if (a <= 0) return;
      for (let i = 0; i < 16; i++) {
        const y = TOP + FS * (.2 + .7 * hash(i * 3.3)), len = 200 + 500 * hash(i * 7.7), x = CX + (hash(i * 1.9) - .2) * W * .5 + (d < .5 ? (1 - E.out(P(d, 0, .25))) * W * .6 : -E.in(P(d, .8, 1)) * W);
        const g = fx.createLinearGradient(x, 0, x + len, 0); g.addColorStop(0, 'rgba(200,255,235,0)'); g.addColorStop(1, `rgba(200,255,235,${(.7 * a).toFixed(2)})`);
        fx.fillStyle = g; fx.fillRect(x, y, len, 2 + 2 * hash(i));
      }
    } });
    sc.update = (ls, G) => {
      const slot = (i) => ls - B(o.words[i]);
      words.forEach((w, i) => {
        const d = slot(i), end = i < 5 ? .5 * BAR : B(o.who - o.words[5]);
        if (d < 0 || d >= end) { hide(w); if (i === 1) echoes.forEach(hide); if (i === 4) slices.forEach(hide); if (i === 2) hide(lock); return; }
        const q = E.in2(P(d, end - .14, end)); // exit
        setVis(w, true); w.style.opacity = 1;
        let base = { o: 1 - q, s: 1 - .08 * q, b: q * 12 };
        if (d < .2) G.mb = Math.max(G.mb, 4);
        if (i === 0) { // split-flap
          w.chars.forEach((c, k) => {
            const land = .06 + k * .035, flips = Math.floor(Math.max(0, d) / .045);
            c.textContent = d < land ? GLY[(flips + k * 7) % GLY.length].replace(/[0-9#$%&@*+=?/<>]/, (m) => 'ABCDEFGHJKLMNPRSTUVWXYZ'[(flips * 3 + k * 5) % 23]) : c.orig;
            const fp = (d % .045) / .045; c.style.transform = d < land ? `perspective(400px) rotateX(${(-70 * (1 - fp)).toFixed(1)}deg)` : `perspective(400px) rotateX(${(-10 * Math.exp(-(d - land) * 20) * Math.cos((d - land) * 50)).toFixed(1)}deg)`;
            c.style.opacity = d < k * .02 ? 0 : 1; wght(c, 800); c.style.filter = '';
          });
          w.scrim.style.opacity = 1;
        } else if (i === 1) { // backups: stacked echoes collapse into the word
          w.chars.forEach((c) => unit(c, d, FS, { dur: .45, y: 0, blur: 8, w0: 500 })); w.scrim.style.opacity = 1;
          echoes.forEach((e, k) => { const sp = spring(d - .03 * k, 1.3, .6), off = lerp(90, 14, sp) * (k + 1); set(e, { o: (1 - q) * .55 ** (k + 1) * clamp(d / .1), x: off * L(1, .6), y: off * .55, s: 1 - .01 * k }); e.chars.forEach((c) => wght(c, 800)); });
        } else if (i === 2) { // security: decode left to right, a padlock locks
          w.chars.forEach((c, k) => {
            const res = .06 + k * .03; c.textContent = d < res ? GLY[(Math.floor(d / .035) * 7 + k * 3) % GLY.length] : c.orig;
            c.style.color = d < res ? '#8CF0C8' : ''; c.style.fontFamily = d < res ? 'var(--mono)' : ''; unit(c, d - k * .015, FS, { dur: .3, y: .12, blur: 4, w0: 800 });
          });
          w.scrim.style.opacity = 1;
          const lp = E.inOut(P(d, 0, .35)); set(lock, { o: 1 - q }); lock.querySelectorAll('rect,path').forEach((p) => { p.style.strokeDashoffset = 1 - lp; });
          lock.querySelector('.sh').style.transform = `translateY(${(-3.5 * (1 - E.back(P(d, .35, .55), 3))).toFixed(2)}px)`;
        } else if (i === 3) { // hosting: rack units wipe in, the word is revealed behind them
          racks.forEach((rk, k) => { rk.style.transform = `scaleX(${E.out4(P(d, k * .05, k * .05 + .3)).toFixed(3)})`; rk.style.opacity = 1 - .45 * P(d, .4, .7); });
          const rv = E.out4(P(d, .1, .42)); hw.style.clipPath = `inset(-20% ${((1 - rv) * 100).toFixed(1)}% -20% -5%)`;
          w.chars.forEach((c) => { c.style.opacity = 1; c.style.transform = ''; c.style.filter = ''; wght(c, 800); }); w.scrim.style.opacity = rv;
        } else if (i === 4) { // fixes: three slices snap into alignment
          const off = [-L(220, 160), L(260, 180), -L(160, 120)];
          slices.forEach((e, k) => { const sp = spring(d - .05 * k, 1.8, .45); set(e, { o: (d < .5 ? 1 : 0) * (1 - q), x: off[k] * (1 - sp) }); e.chars.forEach((c) => wght(c, 800)); });
          w.chars.forEach((c) => { c.style.opacity = d >= .5 ? 1 : 0; c.style.transform = ''; c.style.filter = ''; wght(c, 800); }); w.scrim.style.opacity = clamp(d / .2);
        } else if (i === 5) { // speed: whips in from the right, skewed, and out to the left
          const inP = E.expo(P(d, 0, .22)), outP = E.in(P(d, end - .3, end));
          w.chars.forEach((c) => { c.style.opacity = 1; c.style.transform = ''; c.style.filter = ''; wght(c, 800); });
          base = { o: 1 - outP, x: (1 - inP) * W * .8 - outP * W, skx: -28 * (1 - spring(d, 1.6, .4)) + 30 * outP, b: (1 - inP) * 16 + outP * 18 };
          w.scrim.style.opacity = inP * (1 - outP); if (d < .25 || outP > 0) G.mb = Math.max(G.mb, 6);
        }
        set(w, base);
      });
      // the question
      const wd = ls - B(o.who);
      if (wd < 0) hide(who); else {
        const suck = E.in(P(ls, B(o.gap) + .25, B(4)));
        type(who, wd, { units: 'words', st: .25, dur: .5, y: .4, blur: 10 });
        set(who, { s: (1 + .03 * wd) * (1 - .95 * suck), b: suck * 10, o: 1 - suck * .8 }); who.style.visibility = 'visible';
      }
    };
    sc.sky = (ls) => ({ storm: E.inOut(P(ls, 0, 3)), inten: .95 + .2 * P(ls, 0, 6), speed: 1 + .8 * P(ls, 0, 6), stars: .8, meteor: .05, cam: { tilt: .08 - .02 * P(ls, 0, 8), zoom: 1 + .06 * P(ls, 0, 7.5), pan: 0 } });
  },

  // ================================================================ DROP: shockwave, "Ours.", the mark snaps together, the wordmark
  drop(sc) {
    const r = (sc.root = mkRoot()), o = sc.o; sc.post = .3;
    const ours = T(r, ['*Ours.*'], { top: px(L(330, 760)), fontSize: px(L(300, 280)) });
    const lg = add(r, lockupHTML(), { fontSize: px(L(180, 150)), top: px(L(360, 800)) });
    const tag = T(r, V ? ['Your website,', '*handled.*'] : ['Your website, *handled.*'], { top: px(L(640, 1030)), fontSize: px(L(84, 96)) });
    const pl = lg.querySelector('.pl'), pr = lg.querySelector('.pr');
    [pl, pr].forEach((g) => { g.style.transformBox = 'fill-box'; g.style.transformOrigin = '50% 50%'; });
    sc.measure = () => { const r2 = lg.getBoundingClientRect(), m = lg.querySelector('svg').getBoundingClientRect(); sc.lw = r2.width; sc.mw = m.width; };
    const t0 = B(sc.s);
    burst(t0, CX, CY, 420, L(1300, 1100), 3.3); rings(t0, CX, CY, 3, L(1100, 1300));
    converge(t0 - .45, t0, CX, CY, 220, 8.1);
    sc.update = (ls, G) => {
      // Ours.
      const od = ls - B(o.ours), oe = B(o.mark) - .15;
      if (od > oe + .25) hide(ours); else {
        setVis(ours, true); let vis = 0;
        ours.chars.forEach((c, i) => { vis = Math.max(vis, unit(c, od - i * .03, ours.fs, { dur: .5, y: 0, blur: 22, s0: 2.4, w0: 800 })); });
        const q = E.in(P(od, oe, oe + .25)); set(ours, { s: (1 + .04 * od) * (1 - .8 * q), b: q * 14, o: 1 - q }); ours.scrim.style.opacity = vis;
      }
      // the mark: two pieces fly in and snap on the beat
      const md = ls - B(o.mark) + .25, wd = ls - B(o.word);
      if (md < 0) hide(lg); else {
        setVis(lg, true); lg.style.opacity = 1 - E.in(P(ls, B(sc.len) - .3, B(sc.len)));
        const p = E.in2(P(md, 0, .25)), after = md - .25;
        const bounce = after > 0 ? 1 + .07 * Math.exp(-after * 9) * Math.cos(after * 38) : 1;
        pl.style.transform = `translate(${(-(1 - p) * 180).toFixed(1)}%, ${((1 - p) * 60).toFixed(1)}%) rotate(${(-40 * (1 - p)).toFixed(1)}deg) scale(${(lerp(1.6, 1, p) * bounce).toFixed(3)})`;
        pr.style.transform = `translate(${((1 - p) * 180).toFixed(1)}%, ${(-(1 - p) * 60).toFixed(1)}%) rotate(${(40 * (1 - p)).toFixed(1)}deg) scale(${(lerp(1.6, 1, p) * bounce).toFixed(3)})`;
        markDraw(lg, md - .1, { drawDur: .35, fillAt: .2, wordAt: B(o.word) - B(o.mark) + .15 });
        const slide = E.inOut5(P(wd, -.05, .5));
        lg.style.left = px(CX - lerp(sc.mw / 2, sc.lw / 2, slide));
        lg.style.transform = `scale(${(1 + .02 * P(ls, B(o.mark), B(sc.len))).toFixed(4)})`;
        if (md < .45) G.mb = Math.max(G.mb, 6);
      }
      type(tag, ls - B(o.tag), { st: .12, dur: .6, y: .4, ex: B(sc.len - o.tag) - .45, exDur: .3 });
      G.flash = Math.max(G.flash, .75 * Math.exp(-Math.max(0, ls) / .12) * (ls >= 0 ? 1 : 0));
      if (ls < .35) G.mb = Math.max(G.mb, 5);
    };
    sc.sky = (ls) => ({ inten: 1.15 + .7 * Math.exp(-ls / .8), pulse: Math.exp(-ls / .5), waveX: lerp(-1.6, 1.6, E.out(P(ls, 0, .9))), waveA: 1.4 * (1 - P(ls, .5, 1.1)), storm: 0, stars: .75, meteor: .2,
      cam: { tilt: .12 - .05 * P(ls, 0, 4), zoom: 1.1 - .1 * E.out(P(ls, 0, 2.5)), pan: .1 } });
  },

  // ================================================================ TWO: a split screen, 01 / 02 (navy irises in over the aurora)
  two(sc) {
    const r = (sc.root = mkRoot()), o = sc.o; sc.pre = .5; sc.post = .62;
    const bg = add(r, '<div class="bg bg-navy"></div>');
    const top = add(r, '<div class="panel bg-canvas"></div>', { top: 0, height: px(H / 2) });
    const bot = add(r, '<div class="panel bg-brand"></div>', { top: px(H / 2), height: px(H / 2) });
    const g1 = add(top, '<div class="giant">01</div>', { right: px(L(40, -40)), top: px(L(-40, 300)), fontSize: px(L(520, 460)) });
    const g2 = add(bot, '<div class="giant lt">02</div>', { left: px(L(40, -40)), top: px(L(-40, 300)), fontSize: px(L(520, 460)) });
    const k1 = add(top, '<div class="kick c" style="color:#2A3570">01 · Job one</div>', { top: px(L(160, 440)) });
    const a = T(top, ['We *build* it.'], { top: px(L(210, 500)), fontSize: px(L(140, 124)) }, 't c dark');
    const k2 = add(bot, '<div class="kick c">02 · Job two</div>', { top: px(L(160, 440)) });
    const b = T(bot, ['We *look after* it.'], { top: px(L(210, 500)), fontSize: px(L(140, 104)) });
    const hyp = Math.hypot(W, H) / 2;
    sc.update = (ls, G) => {
      bg.style.clipPath = `circle(${(hyp * E.inOut(P(ls, -.5, -.02))).toFixed(1)}px at 50% 50%)`;
      const pt = E.expo(P(ls, B(o.split), B(o.split) + .55)), pb = E.expo(P(ls, B(o.split) + .08, B(o.split) + .63));
      const g = E.inOut5(P(ls, B(o.grow), B(o.grow) + .6));
      set(top, { x: -W * (1 - pt) }); top.style.height = px(lerp(H / 2, H, g));
      set(bot, { x: W * (1 - pb), y: g * H / 2 });
      set(g1, { x: -30 * ls, o: .9 }); set(g2, { x: 30 * ls, o: .9 });
      [k1, k2].forEach((k, i) => { const a0 = B(o.split) + .02 + i * .08; set(k, { o: E.out(P(ls, a0, a0 + .35)) * (1 - P(ls, B(o.grow) - .3, B(o.grow) - .05)), y: (1 - E.out(P(ls, a0, a0 + .35))) * 20 }); });
      type(a, ls - B(o.a) - .1, { st: .1, dur: .6, ex: B(o.grow - o.a) - .45, exDur: .25 }); type(b, ls - B(o.b) - .1, { st: .1, dur: .6 });
      if ((pt > 0 && pt < 1) || (g > 0 && g < 1) || (ls > -.5 && ls < 0)) G.mb = Math.max(G.mb, 5);
    };
    sc.sky = (ls) => ({ inten: .9, stars: .7, meteor: .2, cam: { tilt: .1, zoom: 1, pan: .25 } });
  },

  // ================================================================ BUILD: 2003 page -> exploded view -> wireframe -> rebuilt -> desktop + phone
  build(sc) {
    const r = (sc.root = mkRoot()), o = sc.o; sc.post = .02; sc.pre = .6;
    const bgc = add(r, '<div class="bg bg-canvas"></div>'), bgp = add(r, '<div class="bg bg-print"></div>');
    const chip = add(r, '<div class="chip"><b>01</b>We build it</div>', { left: px(L(70, 60)), top: px(L(56, 190)) });
    const steps = ['<b>1</b>Strip it back', '<b>2</b>Design it', '<b>3</b>Build it'].map((h) => add(r, `<div class="step">${h}</div>`, { top: px(L(965, 1640)) }));
    const world = add(r, '<div class="world"><div class="rig"></div></div>'); const rig = world.firstChild;
    const ww = L(1240, 1000), wh = L(760, 780), wx = (W - ww) / 2, wy = L(190, 330);
    const XP = 128, SB = 24, MOD = 46, bw = ww - 8;
    const win = add(rig, '<div class="win"></div>', { left: px(wx), top: px(wy), width: px(ww), height: px(wh) });
    add(win, '<div class="frame"></div>');
    const body = add(win, '<div class="body"></div>', { top: px(XP), height: px(wh - XP - SB - 4) });
    const deskW = 1440, sclD = bw / deskW;
    const fr = add(body, '<iframe src="../lrweb/work/crumb-and-kiln/?shot" scrolling="no"></iframe>', { width: px(deskW), height: px(Math.round((wh - MOD) / sclD)), transform: `scale(${sclD})` });
    const xp = add(win, `<div class="xp"><div class="tb"><div class="ie"></div><div class="ttl">Crumb &amp; Kiln Bakery - Microsoft Internet Explorer</div><div class="bt">_</div><div class="bt">□</div><div class="bt x">×</div></div>
      <div class="mb"><span>File</span><span>Edit</span><span>View</span><span>Favorites</span><span>Tools</span><span>Help</span></div>
      <div class="tlb"><div class="ar">‹</div>Back<div class="ar off">›</div><span>✖ Stop</span><span>⟳ Refresh</span><span>⌂ Home</span><span>☆ Favorites</span></div>
      <div class="adr">Address<div class="f">🌐 http://www.crumbandkiln.co.uk/index.htm</div><div class="go">Go</div></div></div>`, { width: px(ww) });
    const stb = add(win, '<div class="xp"><div class="stb"><span>✔ Done</span><span>🌐 Internet</span></div></div>', { top: px(wh - SB - 4), width: px(ww) });
    const mod = add(win, '<div class="mod"><i></i><i></i><i></i><div class="url">🔒 crumbandkiln.co.uk</div></div>', { width: px(ww) });
    // the 2003 page, one layer per block, sitting exactly on the body
    const bh = wh - XP - SB - 4, TW = 780, tx = (bw - TW) / 2;
    const old = add(win, '<div class="old"></div>', { left: '4px', top: px(XP), width: px(bw), height: px(bh) });
    const ly = (h, css) => add(old, `<div class="ly">${h}</div>`, css);
    const wa = [...'Crumb & Kiln'].map((c, i, a) => { const k = i / (a.length - 1) - .5; return `<span style="transform:translateY(${(k * k * 60 - 14).toFixed(1)}px) rotate(${(k * 22).toFixed(1)}deg)">${c === ' ' ? '&nbsp;' : c}</span>`; }).join('');
    const layers = [
      ly('', { left: 0, top: 0, width: px(bw), height: px(bh) }),
      ly('', { left: px(tx), top: '10px', width: px(TW), height: px(bh - 20) }),
      ly(`<div class="wa">${wa}</div>`, { left: px(tx), top: '28px', width: px(TW) }),
      ly('<div class="est">~*~ Family Bakers since 1987 ~*~</div>', { left: px(tx), top: '118px', width: px(TW) }),
      ly('<div class="mq"><span class="mqi" style="display:inline-block">★ FRESH BREAD DAILY ★ WEDDING CAKES MADE TO ORDER ★ TRY OUR TEACAKES!!! ★ FRESH BREAD DAILY ★ WEDDING CAKES MADE TO ORDER ★</span></div>', { left: px(tx + 14), top: '158px', width: px(TW - 28) }),
      ly('<div class="nav"><u>Home</u><u>Our Bread</u><u>Cakes!!</u><u>Guestbook</u><u>Links</u></div>', { left: px(tx + 16), top: '216px', width: '160px' }),
      ly('<div class="wel">Welcome to our website!!! <span class="new">NEW!</span></div>', { left: px(tx + 196), top: '212px' }),
      ly('<div class="pic"><img src="assets/old/loaf.jpg"></div><div class="cap">Our famous loaf (click to enlarge)</div>', { left: px(tx + 196), top: '266px', width: '236px' }),
      ly('<div class="txt">We are a family bakery in Bristol. We sell bread, cakes and more!! Please sign our guestbook :-)</div>', { left: px(tx + 452), top: '268px', width: px(TW - 470) }),
      ly('<div class="uc" style="height:54px"><b>UNDER CONSTRUCTION</b></div>', { left: px(tx + 452), top: '404px', width: px(TW - 470) }),
      ly('<div class="mail"><img src="assets/old/mail.png">Email us!</div>', { left: px(tx + 22), top: '470px' }),
      ly(`<div class="hr"></div><div class="cnt" style="margin-top:8px">You are visitor no. ${[...'000417'].map((d) => `<i>${d}</i>`).join('')}</div><div class="cnt">Best viewed in Internet Explorer 6 at 800x600</div>`, { left: px(tx + 16), top: '512px', width: px(TW - 32) }),
    ];
    layers[0].classList.add('bgt'); layers[1].classList.add('tbl');
    layers[7].querySelector('.pic').style.height = '172px';
    const mqi = old.querySelector('.mqi');
    // blueprint grid + wireframe of the new layout, on the base plane
    const bp = add(win, '<div class="bp"></div>', { left: '4px', top: px(XP), width: px(bw), height: px(bh), background: '#0B2A86', boxShadow: '0 0 0 3px rgba(255,255,255,.6)' });
    for (let c = 0; c <= 12; c++) add(bp, '<div class="gl"></div>', { left: px(40 + c * (bw - 80) / 12), top: 0, width: '1px', height: '100%' });
    for (let y = 0; y < bh; y += 48) add(bp, '<div class="gl"></div>', { left: 0, top: px(y), height: '1px', width: '100%', opacity: .5 });
    const wf = [[0, 0, bw, 58], [60, 120, bw * .42, 70], [60, 206, bw * .36, 70], [60, 300, bw * .3, 22], [60, 332, bw * .26, 22], [60, 392, 150, 52], [226, 392, 150, 52], [bw * .56, 96, bw * .36, bw * .36 * .8]]
      .map(([x, y, w, h], i) => add(bp, '<div class="wf"></div>', { left: px(x), top: px(y), width: px(w), height: px(Math.min(h, bh - y - 20)), borderRadius: i === 7 ? '50%' : '10px', transformOrigin: '0 50%' }));
    const labels = ['12-column grid', 'Mobile first', 'Loads in 0.8s'].map((s, i) => add(r, `<div class="bp"><div class="lab" style="position:static;font-size:${L(24, 28)}px">${s}</div></div>`,
      V ? { left: px([80, 560, 300][i]), top: px([220 + 60, 1180, 1250][i]) } : { left: px([150, 1450, 1420][i]), top: px([150, 300, 820][i]) }));
    const tagB = add(r, '<div class="tag" style="background:#FF5C6C;color:#fff">Before · 2003</div>', { left: px(wx + 10), top: px(wy - 64) });
    const tagA = add(r, '<div class="tag" style="background:#3DB88D;color:#fff">After · LRWeb</div>', { left: px(wx + 10), top: px(wy - 64) });
    // the phone lives outside the 3D rig, so it is always in front
    const phone = add(r, '<div class="phone"><div class="scr"><div class="isl"></div></div></div>');
    const scr = phone.querySelector('.scr');
    const mf = add(scr, '<iframe src="../lrweb/work/crumb-and-kiln/?shot" scrolling="no"></iframe>', { width: '390px', height: '1000px' });
    const cap = T(r, V ? ['Same bakery.', '*Brand new website.*'] : ['Same bakery. *Brand new website.*'], { top: px(L(962, 1620)), fontSize: px(L(64, 80)) }, 't c dark');
    shared.frames = [fr, mf]; sc.fr = fr;
    const PH = V ? { x: 610, y: 800, w: 360, h: 720 } : { x: 1420, y: 250, w: 330, h: 680 };
    sc.update = (ls, G) => {
      const Bl = (b) => B(b);
      // the canvas grows out of the split screen's top panel; blueprint mode while we take the old site apart
      const gr = E.inOut5(P(ls, -.5, .1)); bgc.style.clipPath = gr >= 1 ? 'none' : `inset(0 0 ${((1 - gr) * 50).toFixed(2)}% 0)`; setVis(bgc, ls >= -.5);
      const bpm = E.inOut(P(ls, Bl(o.explode) - .1, Bl(o.explode) + .35)) * (1 - E.inOut(P(ls, Bl(o.rebuild) + .1, Bl(o.rebuild) + .6)));
      set(bgp, { o: bpm }); bgp.style.clipPath = `circle(${(Math.hypot(W, H) * E.out(P(ls, Bl(o.explode) - .1, Bl(o.explode) + .45))).toFixed(0)}px at 50% 55%)`;
      const stT = [Bl(o.explode) + .15, Bl(o.design), Bl(o.rebuild) + .2, Bl(o.cap) - .35];
      steps.forEach((st, i) => { const a0 = stT[i], a1 = stT[i + 1]; const pin = E.out4(P(ls, a0, a0 + .3)), pout = E.in(P(ls, a1 - .2, a1)); set(st, { o: pin * (1 - pout), y: (1 - pin) * 30 - pout * 30 }); st.classList.toggle('lt', i < 2 || bpm > .5); });      set(chip, { o: E.out(P(ls, -.3, .3)) * (1 - P(ls, B(sc.len) - .4, B(sc.len) - .1)), y: (1 - E.out(P(ls, -.3, .3))) * -16 });
      // window entrance, explode, rebuild, shift for the phone
      const inP = E.out4(P(ls, Bl(o.before), Bl(o.before) + .8));
      const ex = E.inOut5(P(ls, Bl(o.explode), Bl(o.explode) + .7)), back = E.inOut5(P(ls, Bl(o.rebuild), Bl(o.rebuild) + .75)), tilt = ex * (1 - back);
      const mo = E.inOut5(P(ls, Bl(o.morph), Bl(o.morph) + .8));
      const shiftX = L(-270, 0) * mo, shiftY = L(0, -90) * mo, sc2 = lerp(1, L(.8, .86), mo);
      set(win, { o: inP, y: (1 - inP) * 90 + shiftY, x: shiftX, z: (1 - inP) * -500, rx: (1 - inP) * 14 + tilt * 52, r: tilt * L(-28, -22), s: sc2 * lerp(1, L(.74, .78), tilt) });
      if ((ex > 0 && ex < 1) || (back > 0 && back < 1) || (mo > 0 && mo < 1) || (inP > 0 && inP < 1)) G.mb = Math.max(G.mb, 4);
      // explode: every block lifts off the page, then flies away
      const fly = (i) => E.inOut(P(ls, Bl(o.explode) + .8 + (layers.length - 1 - i) * .05, Bl(o.explode) + 1.25 + (layers.length - 1 - i) * .05));
      const showOld = ls < Bl(o.rebuild);
      old.style.visibility = showOld ? 'visible' : 'hidden';
      layers.forEach((l, i) => { const f = fly(i); set(l, { z: i * 60 * ex + f * 120, x: f * 1500, o: 1 - P(f, .6, 1) }); });
      mqi.style.transform = `translateX(${(-((ls * 180) % 800)).toFixed(1)}px)`;
      old.querySelector('.new').style.visibility = Math.floor(ls / .25) % 2 ? 'hidden' : 'visible';
      // blueprint + wireframe
      const bpo = E.out(P(ls, Bl(o.explode) + .3, Bl(o.explode) + .8)) * (1 - E.out(P(ls, Bl(o.rebuild), Bl(o.rebuild) + .5)));
      set(bp, { o: bpo, z: 2 });
      wf.forEach((w, i) => { const p = E.out4(P(ls, Bl(o.design) + i * .07, Bl(o.design) + .35 + i * .07)); w.style.transform = `scaleX(${p.toFixed(3)})`; w.style.opacity = p; });
      labels.forEach((lb, i) => { const d = ls - Bl(o.explode) - .3 - i * .18; set(lb, { o: clamp(d / .2) * (1 - P(ls, Bl(o.rebuild) - .2, Bl(o.rebuild) + .1)), y: (1 - E.out(clamp(d / .4))) * 20 }); });
      // chrome: XP collapses, the modern bar arrives; the body grows into the space
      const ch = E.inOut(P(ls, Bl(o.chrome), Bl(o.chrome) + .5));
      set(xp, { sy: 1 - ch, o: 1 - ch }); set(stb, { o: 1 - ch }); set(mod, { o: ch });
      body.style.top = px(lerp(XP, MOD, ch)); body.style.height = px(lerp(wh - XP - SB - 4, wh - MOD - 4, ch));
      fr.style.visibility = ls >= Bl(o.rebuild) - .05 ? 'visible' : 'hidden';
      buildSite(fr.contentDocument, ls - Bl(o.rebuild) - .15, 1.3, (wh - MOD) / sclD);
      const tb = E.out(P(ls, Bl(o.before) + .5, Bl(o.before) + .9)) * (1 - E.out(P(ls, Bl(o.explode), Bl(o.explode) + .2)));
      set(tagB, { o: tb, y: (1 - tb) * 12 }); const ta = E.out(P(ls, Bl(o.rebuild) + .9, Bl(o.rebuild) + 1.2)) * (1 - E.out(P(ls, Bl(o.morph) + .3, Bl(o.morph) + .55))); set(tagA, { o: ta });
      // desktop -> phone: a copy peels off the window and becomes the phone
      if (mo <= 0) hide(phone); else {
        const s0 = { x: wx + ww * .62, y: wy + 20, w: ww * .34, h: wh - 40 };
        const rx = lerp(s0.x, PH.x, mo), ry = lerp(s0.y, PH.y, mo), rw = lerp(s0.w, PH.w, mo), rh = lerp(s0.h, PH.h, mo);
        Object.assign(phone.style, { left: px(rx), top: px(ry), width: px(rw), height: px(rh), borderRadius: px(lerp(10, 52, mo)) });
        set(phone, { o: E.out(P(mo, 0, .2)), r: L(4, 0) * Math.sin(mo * Math.PI) });
        scr.style.inset = px(lerp(4, 12, mo)); scr.style.borderRadius = px(lerp(6, 40, mo));
        const sw = rw - 2 * lerp(4, 12, mo); mf.style.transform = `scale(${(sw / 390).toFixed(4)})`; mf.style.opacity = E.out(P(mo, .3, .8));
        try { mf.contentWindow.scrollTo(0, Math.round(E.inOut(P(ls, Bl(o.morph) + 1.2, Bl(o.flip))) * 650)); } catch (e) { /* not ready */ }
      }
      type(cap, ls - Bl(o.cap), { st: .1, dur: .6 });
    };
    tileWipe(B(sc.s + o.flip), B(sc.s + o.flip) + .45, B(sc.s + o.flip) + .95);
    sc.sky = (ls) => ({ inten: .7, stars: .7, meteor: .15, cam: { tilt: .12, zoom: 1, pan: .35 + ls * .01 } });
  },

  // ================================================================ CARE: a live dashboard on deep navy; one card gets the spotlight
  care(sc) {
    const r = (sc.root = mkRoot()), o = sc.o; sc.pre = .02;
    add(r, '<div class="bg bg-navy"><div class="bg bg-grid"></div></div>');
    const glA = add(r, '<div class="glow"></div>', { width: '900px', height: '900px', background: 'rgba(11,134,234,.32)' });
    const glB = add(r, '<div class="glow"></div>', { width: '760px', height: '760px', background: 'rgba(63,77,230,.3)' });
    const chip = add(r, '<div class="chip"><b>02</b>We look after it</div>', { left: px(L(70, 60)), top: px(L(56, 190)) });
    const clock = add(r, `<div class="chip"><b>${icon('moon')}</b><span>23:00</span></div>`, V ? { right: px(60), top: px(190) } : { right: px(70), top: px(56) });
    const head = T(r, V ? ['Then we', '*look after it.*'] : ['Then we *look after it.*'], { top: px(L(140, 330)), fontSize: px(L(104, 112)) });
    const cols = V ? 2 : 3, cw = L(548, 480), chh = L(246, 290), gap = L(36, 30);
    const x0 = (W - (cols * cw + (cols - 1) * gap)) / 2, y0 = L(350, 640);
    const cards = TL.SYSTEMS.map(([tt, s, ic], i) => { const c = add(r, `<div class="card"><div class="hd"><div class="ic">${icon(ic)}</div><div><b>${tt}</b><small>${s}</small></div><div class="ok">${icon('check', '#fff', 3)}</div></div><div class="viz"></div></div>`,
      { width: px(cw), height: px(chh), left: px(x0 + (i % cols) * (cw + gap)), top: px(y0 + Math.floor(i / cols) * (chh + gap)) }); c.cx = x0 + (i % cols) * (cw + gap) + cw / 2; c.cy = y0 + Math.floor(i / cols) * (chh + gap) + chh / 2; return c; });
    const viz = cards.map((c) => c.querySelector('.viz'));
    const stat = (s) => `<div class="stat" style="position:absolute;left:0;bottom:0">${s}</div>`;
    viz[0].innerHTML = stat('<span class="n">99.9</span>%') + '<svg style="position:absolute;right:0;bottom:6px;width:52%;height:60px" viewBox="0 0 260 60" preserveAspectRatio="none"><polyline fill="none" stroke="#6FE0B4" stroke-width="3.5" stroke-linejoin="round"/></svg>';
    viz[1].innerHTML = stat('Nightly') + `<div style="position:absolute;right:0;bottom:8px;display:flex;gap:8px">${[...'MTWTFSS'].map((d) => `<i style="width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font:600 15px var(--mono);font-style:normal;background:rgba(255,255,255,.1)">${d}</i>`).join('')}</div>`;
    viz[2].innerHTML = stat('<span class="n">0</span>%') + '<div style="position:absolute;right:0;bottom:22px;width:52%;height:12px;border-radius:12px;background:rgba(255,255,255,.12);overflow:hidden"><div class="bar" style="height:100%;width:0;background:linear-gradient(90deg,#3DB88D,#0B86EA)"></div></div>';
    viz[3].innerHTML = stat('0 threats') + '<div style="position:absolute;right:0;bottom:10px;width:40%;height:44px;border-radius:12px;background:rgba(255,255,255,.07);overflow:hidden"><div class="scan" style="position:absolute;top:0;bottom:0;width:60px;background:linear-gradient(90deg,transparent,rgba(111,224,180,.7),transparent)"></div></div>';
    viz[4].innerHTML = stat('https://') + `<svg style="position:absolute;right:10px;bottom:0;width:60px;height:70px;overflow:visible" viewBox="0 0 24 28" fill="none" stroke="#6FE0B4" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="13" width="18" height="13" rx="3" fill="rgba(111,224,180,.18)"/><path class="sh" d="M7 13V9a5 5 0 0 1 10 0v4"/></svg>`;
    viz[5].innerHTML = stat('<span class="n">9.4</span>s') + '<svg style="position:absolute;right:0;bottom:0;width:120px;height:70px;overflow:visible" viewBox="0 0 120 70"><path d="M10 64a50 50 0 0 1 100 0" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="10" stroke-linecap="round"/><path class="arc" d="M10 64a50 50 0 0 1 100 0" fill="none" stroke="url(#spg)" stroke-width="10" stroke-linecap="round" pathLength="1" stroke-dasharray="1"/><defs><linearGradient id="spg"><stop offset="0" stop-color="#6FE0B4"/><stop offset="1" stop-color="#0B86EA"/></linearGradient></defs><line class="nd" x1="60" y1="64" x2="60" y2="22" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>';
    const spot = add(r, '<div class="kick c">Under a second</div>', { top: px(L(900, 1480)) });
    const run1 = T(r, V ? ['You run', 'your business.'] : ['You run your business.'], { top: px(L(370, 700)), fontSize: px(L(120, 116)) });
    const run2 = T(r, V ? ['We run', 'your *website.*'] : ['We run your *website.*'], { top: px(L(530, 990)), fontSize: px(L(120, 116)) });
    sc.update = (ls, G) => {
      const out = E.inOut(P(ls, B(o.run) - .25, B(o.run) + .2));
      const fo = E.inOut5(P(ls, B(o.focus), B(o.focus) + .55)) * (1 - E.inOut(P(ls, B(o.run) - .45, B(o.run) - .1)));
      const dawn = E.inOut(P(ls, .5, B(o.run)));
      set(glA, { x: CX - 450 + Math.sin(ls * .5) * L(420, 200), y: L(500, 1100) + Math.cos(ls * .4) * 120 });
      set(glB, { x: CX - 380 + Math.cos(ls * .45) * L(520, 260), y: L(-200, 100) + Math.sin(ls * .35) * 140 });
      glB.style.background = `rgba(${lerp(63, 61, dawn).toFixed(0)},${lerp(77, 184, dawn).toFixed(0)},${lerp(230, 141, dawn).toFixed(0)},.28)`;
      set(chip, { o: E.out(P(ls, .1, .5)) * (1 - out) }); set(clock, { o: E.out(P(ls, .3, .7)) * (1 - out) });
      const mins = Math.floor(lerp(23 * 60, 31 * 60, dawn));
      clock.querySelector('span').textContent = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      type(head, ls - B(o.title) - .1, { st: .09, dur: .6, ex: B(o.focus) - .45, exDur: .3 });
      cards.forEach((c, i) => {
        const d = ls - B(o.cards[i]); if (d < 0) return hide(c);
        const sp = spring(d, 1.5, .55), isF = i === 5;
        const pulse = P(d, .3, .9), ring = pulse > 0 && pulse < 1 ? `,0 0 0 ${(2 + 10 * pulse).toFixed(1)}px rgba(111,224,180,${(.55 * (1 - pulse)).toFixed(2)})` : '';
        c.style.boxShadow = `0 40px 90px rgba(0,0,0,.4),inset 0 1px 0 rgba(255,255,255,.12)${ring}`;
        const tx = isF ? (CX - c.cx) * fo : 0, ty = isF ? (L(560, 960) - c.cy) * fo : 0;
        set(c, { o: clamp(d / .1) * (1 - out) * (isF ? 1 : 1 - .82 * fo), x: tx, y: (1 - sp) * 60 + ty, s: lerp(.86, 1, sp) * (isF ? 1 + L(.7, .55) * fo : 1 - .06 * fo), b: isF ? 0 : fo * 5 });
        c.style.zIndex = isF ? 5 : 1;
        c.querySelector('.ok').style.transform = `scale(${E.back(P(d, .3, .6), 3).toFixed(3)})`;
      });
      set(spot, { o: fo, y: (1 - fo) * 20 });
      const d = (i) => ls - B(o.cards[i]);
      viz[0].querySelector('polyline').setAttribute('points', Array.from({ length: 52 }, (_, k) => { const ph = (k + Math.floor(ls * 16)) % 18; const y = ph === 8 ? 8 : ph === 9 ? 52 : ph === 10 ? 22 : 34; return `${(k * 260 / 51).toFixed(1)},${(k / 51 < E.inOut(P(d(0), 0, .8)) ? y : 34)}`; }).join(' '));
      viz[0].querySelector('.n').textContent = (99 + .99 * E.out(P(d(0), .1, 1.2))).toFixed(2).replace(/0$/, '');
      viz[1].querySelectorAll('i').forEach((dd, k) => { dd.style.background = d(1) - .25 - k * .09 > 0 ? 'linear-gradient(135deg,#3DB88D,#0B86EA)' : 'rgba(255,255,255,.1)'; });
      const up = E.inOut(P(d(2), .15, 1.3)); viz[2].querySelector('.bar').style.width = `${(100 * up).toFixed(1)}%`; viz[2].querySelector('.n').textContent = Math.round(100 * up);
      viz[3].querySelector('.scan').style.left = `${(((ls * .9) % 1.3) - .2) * 100}%`;
      viz[4].querySelector('.sh').style.transform = `translateY(${(-4 * (1 - E.back(P(d(4), .3, .6), 3))).toFixed(2)}px)`;
      const sp = E.inOut(P(ls, B(o.focus) + .35, B(o.focus) + 1.5)); viz[5].querySelector('.n').textContent = lerp(9.4, .8, sp).toFixed(1);
      viz[5].querySelector('.arc').style.strokeDashoffset = (1 - sp * .92).toFixed(3); viz[5].querySelector('.nd').setAttribute('transform', `rotate(${(-80 + 150 * sp).toFixed(1)} 60 64)`);
      type(run1, ls - B(o.run), { st: .1, dur: .6 }); type(run2, ls - B(o.runB), { st: .1, dur: .6 });
      if (fo > 0 && fo < 1) G.mb = Math.max(G.mb, 4);
    };
    sc.sky = (ls) => ({ inten: .9, dawn: .3, sunY: -.3, stars: .6, meteor: .1, cam: { tilt: .07, zoom: 1, pan: .6 } });
  },

  // ================================================================ PRICING: a brand-gradient burst; cards dealt; £29 bursts into a month of tiles; 95p; £299
  pricing(sc) {
    const r = (sc.root = mkRoot()), o = sc.o; sc.pre = .02; sc.post = .35;
    const bg = add(r, '<div class="bg bg-brand"></div>');
    const kick = add(r, '<div class="kick c" style="color:#E6FFF6">LRWeb care plans · monthly</div>', { top: px(L(190, 300)) });
    const odo = (n) => `<span class="cur">£</span>${[...String(n)].map((dg) => `<span class="odo" data-d="${dg}"><span>${'0123456789'.split('').join('</span><span>')}</span></span>`).join('')}<small>/month</small>`;
    const cards = TL.PLANS.map(([nm, pr, ds], i) => add(r, `<div class="plan${i === 0 ? ' hi' : ''}"><div class="nm">${nm}</div><div class="pr">${odo(pr)}</div><p>${ds}</p></div>`,
      V ? { left: px(110), top: px(400 + i * 350), width: px(860), height: px(310) } : { left: px(CX - 220 + (i - 1) * 480), top: px(280), width: px(440), height: px(430) }));
    const c0 = V ? { x: CX, y: 555 } : { x: CX - 480, y: 495 };
    const cols = 6, ts = L(100, 140), tg = L(14, 18), gw = cols * ts + (cols - 1) * tg, gx = (W - gw) / 2, gy = L(300, 600);
    const month = add(r, '<div class="kick c" style="color:#E6FFF6">£29 ÷ 30 days</div>', { top: px(gy - L(70, 90)) });
    const tiles = Array.from({ length: 30 }, (_, i) => { const tl = add(r, `<div class="tile">${i + 1}</div>`, { left: px(gx + (i % cols) * (ts + tg)), top: px(gy + Math.floor(i / cols) * (ts + tg)), width: px(ts), height: px(ts), fontSize: px(L(24, 32)) });
      tl.cx = gx + (i % cols) * (ts + tg) + ts / 2; tl.cy = gy + Math.floor(i / cols) * (ts + tg) + ts / 2; return tl; });
    const day = T(r, V ? ['About *95p*', 'a day.'] : ['About *95p* a day.'], { top: px(L(470, 820)), fontSize: px(L(160, 160)) });
    const b1 = T(r, V ? ['Websites', 'from *£299.*'] : ['Websites from *£299.*'], { top: px(L(380, 740)), fontSize: px(L(150, 150)) });
    const b2 = add(r, '<div class="sub c">Fixed price. Agreed up front.</div>', { top: px(L(590, 1120)), fontSize: px(L(46, 52)) });
    const t0 = B(sc.s); burst(t0, CX, CY, 260, 1100, 5.5, 1.3); rings(t0, CX, CY, 2, 1100);
    const hyp = Math.hypot(W, H) / 2;
    sc.update = (ls, G) => {
      bg.style.clipPath = `circle(${(hyp * E.out4(P(ls, 0, .35))).toFixed(1)}px at 50% 50%)`;
      const split = E.inOut5(P(ls, B(o.split), B(o.split) + .45));
      set(kick, { o: E.out(P(ls, .2, .6)) * (1 - split) });
      cards.forEach((c, i) => {
        const d = ls - B(o.plans[i]); if (d < 0) return hide(c);
        const p = E.out4(clamp(d / .55)), sp = spring(d, 1.3, .6);
        const away = i ? split : 0, fade = i === 0 ? E.in(P(ls, B(o.split), B(o.split) + .3)) : 0;
        set(c, { o: clamp(d / .1) * (1 - away) * (1 - fade), y: (1 - p) * H * .8 + (i ? away * H * .3 : 0), x: away * (i === 1 ? -1 : 1) * W * .7, rx: (1 - sp) * 60, r: (1 - p) * (i - 1) * 14 + away * (i === 1 ? -20 : 20), s: lerp(.8, 1, sp) * (1 - .6 * fade) });
        c.querySelectorAll('.odo').forEach((od, k) => { const dg = +od.dataset.d, q = E.out4(P(d, .1 + k * .06, .6 + k * .06)); od.firstChild.style.marginTop = `${(-dg * q).toFixed(3)}em`; });
        if (d < .6 || (away > 0 && away < 1)) G.mb = Math.max(G.mb, 5);
      });
      // £29 bursts into the 30 days of a month; the rest fall away; day one flips to 95p
      const dayIn = E.inOut5(P(ls, B(o.day) - .3, B(o.day) + .25)), gOut = E.in(P(ls, B(o.build) - .35, B(o.build)));
      set(month, { o: E.out(P(ls, B(o.split) + .15, B(o.split) + .4)) * (1 - E.in(P(ls, B(o.day) - .3, B(o.day) - .1))) });
      tiles.forEach((tl, i) => {
        const d = ls - B(o.split) - .1 - i * .018; if (d < 0) return hide(tl);
        const sp = spring(d, 1.4, .6), bx = (c0.x - tl.cx) * (1 - sp), by = (c0.y - tl.cy) * (1 - sp);
        if (i === 0) {
          const fl = P(ls, B(o.day) - .3, B(o.day) - .05), ang = 180 * E.inOut(fl);
          tl.textContent = ang > 90 ? '95p' : '1'; tl.classList.toggle('on', ang > 90);
          const tx = dayIn * (CX - tl.cx), ty = dayIn * (L(270, 590) - tl.cy);
          set(tl, { o: clamp(d / .08) * (1 - gOut), x: bx + tx, y: by + ty, ry: ang > 90 ? ang - 180 : ang, s: lerp(.3, 1, sp) * (1 + dayIn * L(1.1, .7)) * (1 - gOut), b: gOut * 8 });
          tl.style.zIndex = 3;
        } else {
          const f = ls - (B(o.day) - .35) - hash(i * 3.1) * .15, fall = f > 0 ? f : 0;
          set(tl, { o: clamp(d / .08) * (1 - P(fall, .2, .55)), x: bx + fall * (hash(i * 7.7) - .5) * 400, y: by + 1800 * fall * fall - 120 * fall, r: fall * (hash(i * 5.1) - .5) * 400, s: lerp(.3, 1, sp) });
        }
      });
      if (ls > B(o.split) && ls < B(o.split) + .7) G.mb = Math.max(G.mb, 4);
      type(day, ls - B(o.day), { st: .1, dur: .6, ex: B(o.build - o.day) - .4, exDur: .3 });
      type(b1, ls - B(o.build), { units: 'chars', st: .03, dur: .5, y: .2 });
      const bp = E.out(P(ls, B(o.build) + .6, B(o.build) + 1.0)); set(b2, { o: bp, y: (1 - bp) * 16 });
      G.flash = Math.max(G.flash, .45 * Math.exp(-Math.max(0, ls) / .12) * (ls >= 0 ? 1 : 0));
    };
    sc.sky = (ls) => ({ inten: 1, dawn: .3, sunY: -.3, stars: .6, meteor: .1, cam: { tilt: .08, zoom: 1, pan: .8 } });
  },

  // ================================================================ HUMANS: on warm paper; strike-throughs; LUKE + RALPH smash into LRWeb; iris out to the dawn
  humans(sc) {
    const r = (sc.root = mkRoot()), o = sc.o; sc.pre = .3;
    const bg = add(r, '<div class="bg bg-paper"></div>');
    const lines = (V ? [['No call centre.'], ['No chatbot.'], ['Just', '*Luke & Ralph.*']] : [['No call centre.'], ['No chatbot.'], ['Just *Luke & Ralph.*']]).map((ln, i) =>
      T(r, ln, V ? { top: px([500, 670, 870][i]), fontSize: px(i === 2 ? 128 : 116) } : { left: px(140), top: px([220, 380, 560][i]), fontSize: px(i === 2 ? 138 : 118) }, V ? 't c dark' : 't dark'));
    const strikes = lines.slice(0, 2).map((l) => { const ln = l.querySelector('.ln'); Object.assign(ln.style, { display: 'inline-block', position: 'relative' }); return add(ln, '<div class="strike"></div>'); });
    // the name smash
    const FS = L(230, 200), COL = { L: '#0A74C9', R: '#2FA97F' };
    const mk = (c, col) => add(r, `<div class="smash">${c}</div>`, { color: col || '#0B1240' });
    const luke = [...'Luke'].map((c, i) => mk(c, i === 0 ? COL.L : null)), ralph = [...'Ralph'].map((c, i) => mk(c, i === 0 ? COL.R : null)), web = [...'Web'].map((c) => mk(c));
    const all = [...luke, ...ralph, ...web];
    sc.measure = () => {
      const cv = document.createElement('canvas').getContext('2d'); cv.font = `800 ${FS}px Brico`;
      const w = (s) => cv.measureText(s).width - .02 * FS * s.length;
      const adv = (arr, s) => { let x = 0; return [...s].map((c) => { const v = x; x += w(c); return v; }); };
      sc.lk = { w: w('Luke'), off: adv(luke, 'Luke') }; sc.rp = { w: w('Ralph'), off: adv(ralph, 'Ralph') };
      const fin = adv(null, 'LRWeb'), fw = w('LRWeb'); sc.fin = fin.map((x) => CX - fw / 2 + x);
    };
    const top = CY - FS * .55;
    const t0 = B(sc.s);
    FX.push({ k: 'draw', fn: (t) => { // dark confetti on the paper at the impact
      const dt = t - (t0 + B(o.hit)); if (dt < 0 || dt > 1.2 || t > t0 + B(o.collapse)) return;
      const cols = ['11,134,234', '47,169,127', '63,77,230', '11,18,64'];
      for (let i = 0; i < 90; i++) {
        const a = hash(i * 1.7 + 3) * 6.283, v = 900 * (.3 + hash(i * 2.9) ** .6), dr = (1 - Math.exp(-3.2 * dt)) / 3.2;
        const x = CX + Math.cos(a) * v * dr, y = CY + Math.sin(a) * v * dr * .7 + 300 * dt * dt, life = clamp(1 - dt / (.5 + .6 * hash(i * 4.4)));
        fx.fillStyle = `rgba(${cols[i % 4]},${(life * .9).toFixed(2)})`; fx.save(); fx.translate(x, y); fx.rotate(dt * 8 * (hash(i) - .5)); fx.fillRect(-5, -2.5, 10, 5); fx.restore();
      }
    } });
    const hyp = Math.hypot(W, H) / 2;
    sc.update = (ls, G) => {
      // paper wipes in on a diagonal
      const wp = E.inOut5(P(ls, -.3, .15)), e0 = lerp(-.4, 1.2, wp) * W;
      bg.style.clipPath = wp >= 1 ? 'none' : `polygon(0 0,${e0.toFixed(0)}px 0,${(e0 - .4 * W).toFixed(0)}px 100%,0 100%)`;
      const exT = B(o.smash) - .1;
      lines.forEach((l, i) => type(l, ls - B(o.lines[i]), { st: .08, dur: .55, ex: exT - B(o.lines[i]), exDur: .25 }));
      strikes.forEach((s, i) => { const d = ls - B(o.lines[i]) - B(.25); s.style.transform = `scaleX(${E.out4(clamp(d / .22)).toFixed(3)})`; });
      lines.slice(0, 2).forEach((l, i) => { const d = ls - B(o.lines[i]) - B(.25); l.style.opacity = d > 0 ? lerp(1, .4, clamp(d / .3)) : 1; });
      // LUKE ->  <- RALPH ... BANG: L and R stay, the rest flies off, "Web" slides out of the R
      const ap = E.in2(P(ls, B(o.smash), B(o.hit))), hd = ls - B(o.hit), wd = ls - B(o.web);
      if (ls < B(o.smash) || !sc.fin) all.forEach(hide); else {
        const lx = CX - sc.lk.w - (1 - ap) * W * .75, rx = CX + (1 - ap) * W * .75;
        const shake = hd > 0 ? Math.exp(-hd / .08) * 14 : 0, sy = noise(ls * 40) * shake;
        luke.forEach((el, i) => {
          let x = lx + sc.lk.off[i], y = top + sy, rot = 0, op = 1;
          if (hd > 0) {
            if (i === 0) x = lerp(CX - sc.lk.w, sc.fin[0], E.out4(P(hd, .02, .3)));
            else { x += hd * (-300 - 500 * hash(i)); y += -700 * hd + 2600 * hd * hd; rot = -hd * 500 * (.5 + hash(i * 3)); op = 1 - P(hd, .2, .5); }
          }
          set(el, { x, y, r: rot, o: op, skx: hd < 0 ? -12 * ap : 0 });
        });
        ralph.forEach((el, i) => {
          let x = rx + sc.rp.off[i], y = top + sy, rot = 0, op = 1;
          if (hd > 0) {
            if (i === 0) x = lerp(CX, sc.fin[1], E.out4(P(hd, .02, .3)));
            else { x += hd * (300 + 500 * hash(i * 1.3)); y += -800 * hd + 2600 * hd * hd; rot = hd * 500 * (.5 + hash(i * 5)); op = 1 - P(hd, .2, .5); }
          }
          set(el, { x, y, r: rot, o: op, skx: hd < 0 ? 12 * ap : 0 });
        });
        web.forEach((el, i) => { const p = E.out4(P(wd, i * .05, .35 + i * .05)); set(el, { x: lerp(sc.fin[1], sc.fin[2 + i], p), y: top + sy, o: wd > 0 ? P(wd, i * .05, .1 + i * .05) : 0 }); el.style.zIndex = 1; });
        [luke[0], ralph[0]].forEach((el) => { el.style.zIndex = 2; });
        if (ap > 0 && ap < 1) G.mb = Math.max(G.mb, 6);
        if (hd > 0 && hd < .3) { G.mb = Math.max(G.mb, 4); G.flash = Math.max(G.flash, .25 * Math.exp(-hd / .08)); }
      }
      // iris out: the paper closes into the dot that becomes the dawn
      const c = E.in(P(ls, B(o.collapse), B(sc.len)));
      r.style.clipPath = c > 0 ? `circle(${Math.max(0, hyp * (1 - c)).toFixed(1)}px at ${CX}px ${CY}px)` : '';
      r.style.transformOrigin = `${CX}px ${CY}px`; r.style.transform = c > 0 ? `scale(${(1 - .5 * c).toFixed(4)})` : '';
      if (c > 0 && c < 1) G.mb = Math.max(G.mb, 5);
    };
    sc.sky = (ls) => ({ dawn: .35, sunY: -.26, inten: .8, speed: .6, stars: .5, meteor: 0, cam: { tilt: .1, zoom: 1.08, pan: 1.2 } });
  },

  // ================================================================ END: the dot becomes the sun; logo, line, address
  end(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const dot = add(r, '<div class="dot"></div>', { left: px(CX), top: px(CY) });
    const lg = add(r, lockupHTML(), { fontSize: px(L(170, 150)), top: px(L(250, 560)) });
    const tag = T(r, V ? ['We build it.', 'Then we *look after it.*'] : ['We build it. Then we *look after it.*'], { top: px(L(480, 790)), fontSize: px(L(72, 82)) });
    const pill = add(r, '<div class="pill">lrweb.uk</div>', { fontSize: px(L(74, 86)) });
    const fine = add(r, `<div class="fine">${V ? 'Websites from £299<br>Care from £29/month<br>hello@lrweb.uk' : 'Websites from £299  ·  Care from £29/month  ·  hello@lrweb.uk'}</div>`, { top: px(L(820, 1320)) });
    sc.measure = () => { sc.lw = lg.getBoundingClientRect().width; sc.pw = pill.getBoundingClientRect().width; };
    burst(B(sc.s), CX, CY, 160, 700, 21.1, 1.2); rings(B(sc.s), CX, CY, 2, 800);
    sc.update = (ls, G) => {
      const dp = E.inOut(P(ls, 0, 1.1));
      set(dot, { o: (ls < 0 ? 0 : 1) * (1 - P(ls, .7, 1.1)), y: dp * L(260, 520), s: 1 + 3 * Math.exp(-ls / .12) + dp * 6 });
      lg.style.left = px(CX - sc.lw / 2); setVis(lg, ls >= B(o.mark));
      markDraw(lg, ls - B(o.mark), { drawDur: .7, fillAt: .5, wordAt: B(o.word - o.mark) });
      type(tag, ls - B(o.tag), { st: .1, dur: .65 });
      Object.assign(pill.style, { left: px(CX - sc.pw / 2), top: px(L(620, 1100)) });
      const up = spring(ls - B(o.url), 1.5, .5); if (ls < B(o.url)) hide(pill); else set(pill, { o: clamp((ls - B(o.url)) / .12), s: lerp(.5, 1, up) });
      const fp = E.out(P(ls, B(o.fine), B(o.fine) + .6)); set(fine, { o: fp, y: (1 - fp) * 16 });
      G.flash = Math.max(G.flash, .5 * Math.exp(-Math.max(0, ls) / .15) * (ls >= 0 ? 1 : 0));
      if (ls < .5) G.mb = Math.max(G.mb, 4);
    };
    sc.sky = (ls) => ({ dawn: lerp(.35, 1, E.inOut(P(ls, 0, 2.5))), sunY: lerp(-.26, .02, E.out(P(ls, 0, 6))), inten: .8, speed: .6, stars: .5, meteor: 0,
      cam: { tilt: lerp(.1, -.05, E.inOut(P(ls, 0, 8))), zoom: lerp(1.08, 1, E.out(P(ls, 0, 8))), pan: 1.2 } });
  },
};

for (const [name, s, len, o] of EDIT.scenes) S[name] = { name, s, len, o };
for (const [name] of EDIT.scenes) { const sc = S[name]; sc.pre = 0; sc.post = 0; scenes.push(sc); builders[name](sc); }
// the soft legibility scrims are only for text over the aurora; the designed middle backdrops don't need them
for (const n of ['two', 'care', 'pricing', 'humans']) S[n].root.querySelectorAll('.scrim').forEach((e) => e.remove());

// ------------------------------------------------------------------ Crumb & Kiln building itself (inside the iframe)
let crumbEls = null;
function prepCrumb(doc) {
  const st = doc.createElement('style');
  st.textContent = `*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important} #flour{display:none!important} [data-r]{opacity:1!important;transform:none!important} html{scrollbar-width:none} ::-webkit-scrollbar{display:none} .top{position:absolute!important}`;
  doc.head.appendChild(st);
  doc.documentElement.classList.add('is-ready'); doc.body.classList.add('is-ready');
  const w = doc.defaultView; for (let i = 0; i < 5000; i++) { w.clearInterval(i); w.clearTimeout(i); } w.requestAnimationFrame = () => 0;
  const nbl = doc.getElementById('nbLabel'), nbi = doc.getElementById('nbItem'); if (nbl) nbl.textContent = 'Warm right now'; if (nbi) nbi.textContent = 'Brown butter cookies';
  doc.querySelectorAll('.plate,.loaf,.stamp,.now-baking').forEach((e) => { e.style.setProperty('opacity', '1', 'important'); e.style.setProperty('transform', 'none', 'important'); });
  doc.querySelectorAll('.hero h1 span').forEach((e) => { e.style.setProperty('opacity', '1', 'important'); e.style.setProperty('transform', 'none', 'important'); });
}
function buildSite(doc, dt, dur, viewH) {
  if (!doc || !doc.body) return;
  if (!crumbEls) {
    const q = (s) => [...doc.querySelectorAll(s)];
    const words = q('.hero h1 span').filter((e) => !e.querySelector('span'));
    crumbEls = [...q('.top'), ...q('.hero .kicker'), ...words, ...q('.hero .lede'), ...q('.hero .btn'), ...q('.plate'), ...q('.loaf'), ...q('.stamp'), ...q('.now-baking')];
    crumbEls.forEach((e) => { const r = e.getBoundingClientRect(); e._y = r.top + r.height / 2; e._k = /plate|loaf|stamp/.test(e.className) ? 'pop' : 'rise'; });
  }
  crumbEls.forEach((e) => {
    const t0 = clamp(e._y / viewH, 0, 1.1) * dur * .9 + (e._k === 'pop' ? .15 : 0);
    const p = dt < 0 ? 0 : E.out4(clamp((dt - t0) / .55));
    const tfm = e._k === 'pop' ? `scale(${lerp(.6, 1, E.back(clamp((dt - t0) / .6)))})` : `translateY(${(1 - p) * 34}px)`;
    e.style.setProperty('opacity', String(p), 'important'); e.style.setProperty('transform', p >= 1 ? 'none' : tfm, 'important');
    if (e._k !== 'pop') e.style.setProperty('filter', p < 1 ? `blur(${((1 - p) * 6).toFixed(1)}px)` : 'none', 'important');
  });
}

// ------------------------------------------------------------------ sky: each scene proposes a sky; they blend across the cuts
const SKY0 = { inten: 1, storm: 0, dawn: 0, stars: 1, speed: 1, sunY: -.5, meteor: .35, waveX: 0, waveA: 0, pulse: 0, lift: 0 };
function skyAt(t) {
  const acc = { cam: { pan: 0, tilt: 0, zoom: 0, roll: 0 } }; let wsum = 0, m1 = null, mw = 0;
  for (const k in SKY0) acc[k] = 0;
  for (const sc of scenes) {
    const a = B(sc.s), b = B(sc.s + sc.len), w = P(t, a - .3, a + .3) * (1 - P(t, b - .3, b + .3));
    if (w <= 0 || !sc.sky) continue;
    const s = sc.sky(t - a); wsum += w;
    for (const k in SKY0) acc[k] += w * (s[k] ?? SKY0[k]);
    const c = s.cam || {}; acc.cam.pan += w * (c.pan ?? 0); acc.cam.tilt += w * (c.tilt ?? 0); acc.cam.zoom += w * (c.zoom ?? 1); acc.cam.roll += w * (c.roll ?? 0);
    if (s.m1 && w > mw) { m1 = s.m1; mw = w; }
  }
  if (wsum <= 0) return { ...SKY0, cam: { pan: 0, tilt: 0, zoom: 1 } };
  for (const k in SKY0) acc[k] /= wsum; for (const k in acc.cam) acc.cam[k] /= wsum;
  acc.cam.pan += t * .012; acc.m1 = m1 || [0, 0, 0, 0];
  return acc;
}

// ------------------------------------------------------------------ the iris through the o of "jobs." (a pure function of time)
function irisAt(t) {
  if (!shared.o) return null; const ir = t - B(S.jobs.s + S.jobs.o.iris); if (ir < 0 || ir > 1.2) return null;
  const p = clamp(ir / .95), s = Math.pow(90, Math.pow(p, 1.7)), m = E.inOut(p), { cx, cy } = shared.o;
  const dx = (CX - cx) * m, dy = (CY - cy) * m; return { p, s, dx, dy, cx: cx + dx, cy: cy + dy };
}

// ------------------------------------------------------------------ render
let sky = null;
function render(t) {
  const G = { t, mb: 1, flash: 0, iris: irisAt(t) };
  const ring = shared.ring, ir = G.iris;
  if (ir && ir.p < 1) { const { cx, cy } = shared.o; ring.style.visibility = 'visible'; ring.style.transformOrigin = `${cx}px ${cy}px`; ring.style.transform = `translate(${ir.dx}px,${ir.dy}px) scale(${ir.s})`; }
  else ring.style.visibility = 'hidden';
  const act = new Set();
  for (const sc of scenes) { sc.on = t >= B(sc.s) - sc.pre && t < B(sc.s + sc.len) + sc.post; if (sc.on) act.add(sc.root); }
  for (const sc of scenes) sc.root.style.display = act.has(sc.root) ? 'block' : 'none';
  for (const sc of scenes) if (sc.on) sc.update(t - B(sc.s), G);
  drawFX(t);
  if (sky) sky.render(t, skyAt(t));
  $('#flash').style.opacity = G.flash;
  $('#black').style.opacity = Math.max(1 - P(t, 0, .3), P(t, EDIT.end - 1.0, EDIT.end - .05));
  return G.mb;
}

window.seek = (t) => render(t);
window.EDIT = EDIT;
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all(['800 100px Brico', '200 100px Brico', '500 20px "IBM Plex Mono"', '600 20px "Instrument Sans"', '700 20px "Comic Neue"', '400 20px Tinos', '700 20px Arimo'].map((f) => document.fonts.load(f)));
  const frames = [...document.querySelectorAll('iframe')];
  await Promise.all(frames.map((f) => new Promise((res) => { const done = () => { try { prepCrumb(f.contentDocument); } catch (e) { /* cross-origin in odd setups */ } res(); };
    if (f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentDocument.body) done(); else f.addEventListener('load', done, { once: true }); })));
  await Promise.all(frames.map((f) => f.contentDocument?.fonts?.ready));
  await Promise.all([...document.images].map((i) => i.decode().catch(() => 0)));
  sky = new Aurora($('#sky'), W, H, DPR, +(Q.get('sky') || 1));
  // measure everything at rest
  scenes.forEach((s) => { s.root.style.display = 'block'; s.root.style.visibility = 'hidden'; });
  fixGradients(); scenes.forEach((s) => s.measure && s.measure());
  scenes.forEach((s) => { s.root.style.display = 'none'; s.root.style.visibility = ''; });
  render(0);
  return true;
})();
if (Q.has('t')) window.ready.then(() => render(+Q.get('t')));
if (Q.has('play')) {
  const a = new Audio(`soundtrack-${EDIT.name}.wav`);
  document.addEventListener('click', () => { a.currentTime = +(Q.get('from') || 0); a.play(); const loop = () => { render(a.currentTime); if (!a.paused) requestAnimationFrame(loop); }; loop(); });
}
