// LRWeb promo v2: choreography. window.seek(t) renders any moment deterministically.
import { GL } from './gl.js';

const TL = window.TL;
const Q = new URLSearchParams(location.search);
const EDIT = TL.EDITS[Q.get('edit') || 'landscape'];
const PREP = Q.get('prep');
const { W, H } = EDIT;
const V = H > W, BAR = TL.BAR, U = Math.min(W, H) / 1080;
const ASSET = (p) => `../lrweb/assets/work/${p}`;

// ------------------------------------------------------------------ utils
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (x, a, b) => clamp((x - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const mixv = (a, b, x) => a.map((v, i) => lerp(v, b[i], x));
const E = {
  out: (x) => 1 - (1 - x) ** 3, out5: (x) => 1 - (1 - x) ** 5, in: (x) => x ** 3, in2: (x) => x * x,
  inOut: (x) => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  expo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  back: (x) => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
const $ = (s, r = document) => r.querySelector(s);
const html = (s) => { const d = document.createElement('div'); d.innerHTML = s.trim(); return d.firstChild; };
const add = (parent, s, css = {}) => { const e = typeof s === 'string' ? html(s) : s; Object.assign(e.style, css); parent.appendChild(e); return e; };
const px = (v) => `${v}px`;
const hide = (el) => { el.style.visibility = 'hidden'; el.style.opacity = 0; };
const vis = (el, o = 1, tf = '', filter = '') => { el.style.visibility = o > .002 ? 'visible' : 'hidden'; el.style.opacity = o; el.style.transform = tf; el.style.filter = filter; };

// stage size
document.documentElement.style.cssText = `width:${W}px;height:${H}px`;
document.body.style.cssText = `width:${W}px;height:${H}px`;
const stage = $('#stage'); stage.style.width = px(W); stage.style.height = px(H);
const canvas = $('#gl'); canvas.width = W; canvas.height = H;
const dom = $('#dom');
document.documentElement.style.setProperty('--U', px(U));

// ------------------------------------------------------------------ kinetic type
function kt(parent, text, cls = '', css = {}) {
  if (text.includes('class="g"')) cls += ' noghost';
  const e = add(parent, `<div class="kt ${cls}" data-text="${text.replace(/"/g, '&quot;')}"><span>${text}</span></div>`, css);
  return e;
}
// measure the natural size at 100px and scale the font so it fits maxW x maxH
const fits = [];
function fit(el, maxW, maxH = 1e9) { fits.push([el, maxW, maxH]); return el; }
function runFits() {
  scenes.forEach((sc) => (sc.root.style.display = 'block'));
  for (const [el, maxW, maxH] of fits) {
    el.style.fontSize = '100px'; el.style.visibility = 'hidden';
    const s = el.firstElementChild || el; const w = s.offsetWidth, h = s.offsetHeight;
    const fs = 100 * Math.min(maxW / w, maxH / h);
    el.style.fontSize = px(fs); el.dataset.fs = fs;
    el.dataset.w = w * fs / 100; el.dataset.h = h * fs / 100;
  }
  scenes.forEach((sc) => (sc.root.style.display = 'none'));
}
// slam: quick scale-down + blur-in, optional exit
function slam(el, dt, o = {}) {
  const { dur = .16, s0 = 1.45, exit = null, exitDur = .16, blur = 16, y0 = 0, x0 = 0, rot = 0 } = o;
  if (dt < 0 || (exit !== null && dt > exit + exitDur)) { hide(el); return 0; }
  const p = E.expo(clamp(dt / dur));
  let s = lerp(s0, 1, p), op = clamp(.4 + dt / .03), bl = (1 - p) * blur, tx = x0 * (1 - p), ty = y0 * (1 - p);
  if (o.drift) s *= 1 + o.drift * dt;
  if (exit !== null && dt > exit) { const q = E.in2(clamp((dt - exit) / exitDur)); op *= 1 - q; bl += q * blur; s *= 1 + q * (o.exitScale ?? .2); ty += q * (o.exitY ?? 0); tx += q * (o.exitX ?? 0); }
  vis(el, op, `translate(${tx}px,${ty}px) rotate(${rot * (1 - p) + (o.rotEnd || 0)}deg) scale(${s})`, bl > .4 ? `blur(${bl.toFixed(1)}px)` : '');
  return p;
}
const centerKT = (parent, text, y, maxW, maxH, cls = '') => fit(kt(parent, text, 'center ' + cls, { left: 0, right: 0, top: px(y) }), maxW, maxH);

// ------------------------------------------------------------------ timing: hits and envelopes
const SFX = TL.sfx(EDIT);
const at = (kinds) => SFX.filter((e) => kinds.includes(e.kind)).map((e) => e.t);
const KICKS = [], SNARES = [];
for (const [sec, a, l] of EDIT.music) {
  if (sec === 'build') { for (let b = a; b < a + l - .25; b++) KICKS.push(b * BAR); continue; }
  if (!['drop', 'drop2', 'outro'].includes(sec)) continue;
  const nb = sec === 'outro' ? 1 : Math.ceil(l);
  for (let b = 0; b < nb; b++) {
    const bar = a + b, pat = [0, 10].concat(b % 4 === 1 ? [7] : []);
    for (const s of pat) if (bar + s / 16 < a + l - 1e-6) KICKS.push((bar + s / 16) * BAR);
    if (bar + .5 < a + l - 1e-6) SNARES.push((bar + .5) * BAR);
  }
}
KICKS.sort((a, b) => a - b);
function env(t, times, tau, win = 3) { let v = 0; for (const x of times) { const d = t - x; if (d >= 0 && d < tau * win) v = Math.max(v, Math.exp(-d / tau)); } return v; }
const BIG = at(['hook', 'drop', 'drop2', 'final']), SLAMS = at(['slam', 'stamp', 'cash']), GLITCH = at(['glitch', 'mosh']), ERR = at(['error']), SNAPS = at(['snap', 'pass', 'whoosh']);

// ------------------------------------------------------------------ scenes
const scenes = [];
function scene(name, s, len, o) { const root = add(dom, `<div class="scene" data-s="${name}"></div>`); const sc = { name, s, len, o, root }; scenes.push(sc); return sc; }
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

const builders = {
  // ---------------------------------------------------------------- 11PM, home alone
  night(sc) {
    const r = sc.root, o = sc.o;
    const clock = add(r, `<div class="clockchip"><i></i><span></span></div>`, { left: 0, right: 0, justifyContent: 'center', top: px(H * (V ? .13 : .085)), fontSize: px(U * (V ? 30 : 24)) });
    const [[a1, k1, w1], [a2, k2, w2]] = o.lines;
    const kA = centerKT(r, k1, H * (V ? .158 : .16), W * (V ? .3 : .14), H * .07);
    const bA = centerKT(r, w1, H * (V ? .235 : .215), W * (V ? .86 : .5), H * (V ? .15 : .3));
    const kB = centerKT(r, k2, H * (V ? .158 : .16), W * (V ? .72 : .4), H * .07);
    const bB = V ? [centerKT(r, 'HOME', H * .228, W * .8, H * .13), centerKT(r, 'ALONE.', H * .33, W * .86, H * .13)] : [centerKT(r, w2, H * .215, W * .82, H * .3)];
    sc.update = (ls, lb, S, g) => {
      const secs = Math.floor(ls * 3.2) % 60;
      clock.lastChild.textContent = `TUE · 23:00:${String(secs).padStart(2, '0')}`;
      vis(clock, clamp(ls / .15) * (1 - P(lb, sc.len - .15, sc.len)));
      const tA = a1 * BAR, tB = a2 * BAR;
      slam(kA, ls - tA + .08, { exit: tB - tA - .12, exitY: -40, s0: 1.2 });
      slam(bA, ls - tA, { exit: tB - tA - .08, exitY: -60, drift: .03 });
      slam(kB, ls - tB + .1, { s0: 1.2, exit: sc.len * BAR - tB - .05, exitY: -30 });
      bB.forEach((e, i) => slam(e, ls - tB - i * .05, { drift: .025, exit: sc.len * BAR - tB - .02 - i * .05, exitY: -40 }));
      // GL: lonely laptop under a spotlight
      const p = lb / sc.len;
      S.bg = { night: 1, aurora: .45 + .3 * p };
      S.stars = { a: 1, drift: .5 };
      S.nightLap = { pos: [0, -1.35, 0], rot: [0, -.42 + .12 * p, 0], open: 1.9, screen: 'oldL', glow: .78 };
      S.post = { bloomThreshold: .9 };
      S.cone = { pos: [0, 2.25, .6], a: .8 };
      S.cam = V ? { fov: 50, pos: mixv([0, .9, 13], [0, .6, 11.2], E.out(p)), look: [0, 1.4, 0] } : { pos: mixv([0, 1.1, 11], [0, .7, 9.2], E.out(p)), look: [0, -.2, 0] };
    };
  },

  // ---------------------------------------------------------------- the error avalanche
  errors(sc) {
    const r = sc.root, o = sc.o;
    const dl = o.spawn.map((b, i) => {
      const [title, sub] = TL.ERRORS[i % TL.ERRORS.length];
      const d = add(r, `<div class="dlg"><div class="tb"><span>${i % 3 === 1 ? 'Error' : 'Warning'}</span><b>×</b></div><div class="bd"><div class="ic">✕</div><div class="tx"><b>${title}</b><small>${sub}</small></div></div><div class="ok">OK</div></div>`,
        { fontSize: px(U * (V ? 30 : 21)), width: px(V ? W * .8 : W * .29) });
      let x, y;
      if (V) { x = W * (.05 + .018 * i + (i % 2) * .04); y = H * (.13 + .066 * i); }
      else { const k = Math.floor(i / 2); x = i % 2 ? W * (.66 - .035 * k) : W * (.04 + .04 * k); y = H * (i % 2 ? .06 + .085 * k : .1 + .085 * k); }
      Object.assign(d.style, { left: px(x), top: px(y) });
      return d;
    });
    const whoTxt = ['WHO’S', 'LOOKING', 'AFTER IT?'];
    const who = whoTxt.map((w, i) => centerKT(r, w, H * (V ? .3 + i * .125 : .12 + i * .245), W * (V ? .88 : .8), H * (V ? .12 : .23), i === 2 ? 'red' : ''));
    who[2].style.color = '#FF3B5C';
    sc.update = (ls, lb, S, g) => {
      const tension = P(lb, 0, o.gap);
      const whoOn = lb >= o.who[0], gap = lb >= o.gap;
      o.spawn.forEach((b, i) => {
        const dt = ls - b * BAR;
        if (dt < 0 || gap) return hide(dl[i]);
        const p = E.back(clamp(dt / .1));
        const j = tension * tension * 10;
        vis(dl[i], 1, `translate(${noise(g.t * 21 + i * 7) * j}px,${noise(g.t * 17 + i * 3) * j}px) scale(${lerp(.55, 1, p)}) rotate(${(hash(i) - .5) * 4}deg)`, whoOn ? `blur(${3 + 4 * P(lb, o.who[0], o.who[0] + .2)}px) brightness(.45)` : '');
      });
      who.forEach((e, i) => {
        const dt = ls - o.who[i] * BAR;
        const gl = g.glitch;
        const jx = gl > .05 ? (hash(Math.floor(g.t * 30) + i * 9) - .5) * 60 * gl : 0;
        slam(e, dt, { s0: 1.6, drift: gap ? .06 : .015, x0: 0 });
        if (dt >= 0) e.style.transform += ` translateX(${jx}px) skewX(${jx * .15}deg)`;
      });
      // GL
      S.bg = { night: 1 - E.in2(tension), alert: E.in2(tension), aurora: .5 * (1 - tension), flow: 1 + 2 * tension };
      S.stars = { a: 1 - tension * .6, drift: .5 + tension * 2 };
      const flick = .55 + .4 * hash(Math.floor(g.t * 14));
      S.nightLap = { pos: [0, -1.35, 0], rot: [0, -.3 + .05 * noise(g.t * 3), 0], open: 1.9, screen: 'oldL', glow: flick };
      S.cone = { pos: [0, 2.25, .6], a: .8 * flick };
      const c0 = V ? [0, .6, 11.2] : [0, .7, 9.2], c1 = V ? [0, .2, 8.5] : [0, .3, 6.2];
      S.cam = { fov: V ? 50 : 35, pos: mixv(c0, c1, E.inOut(tension)), look: V ? [0, 1.2, 0] : [0, -.3, 0], roll: noise(g.t * 5) * .03 * tension };
      S.post = { glitch: .12 * tension + .9 * g.glitch, rgb: 1.5 * tension + 3 * g.glitch, seed: Math.floor(g.t * 20) };
      if (gap) { S.post.bright = .12; S.post.sat = .2; g.zoom *= 1 + .08 * P(lb, o.gap, sc.len); }
    };
  },

  // ---------------------------------------------------------------- DROP: 3D logo
  logo(sc) {
    const r = sc.root;
    const wm = add(r, `<div class="wordmark">LRWeb</div>`, { fontSize: px(V ? W * .25 : H * .26) });
    const kick = add(r, `<div class="kicker">Managed websites for small UK businesses</div>`, { fontSize: px(U * (V ? 30 : 26)) });
    const flare = add(r, `<div class="flare"></div>`, { top: px(V ? H * .36 : H * .5) });
    sc.update = (ls, lb, S, g) => {
      const rev = E.out5(P(lb, .3, .6));
      if (V) Object.assign(wm.style, { left: 0, right: 0, textAlign: 'center', top: px(H * .5) });
      else Object.assign(wm.style, { left: px(W * .455), top: px(H * .5 - H * .15) });
      vis(wm, rev > 0 ? 1 : 0, `translateX(${(1 - rev) * (V ? 0 : -80)}px) translateY(${V ? (1 - rev) * 40 : 0}px)`);
      wm.style.clipPath = rev >= 1 ? 'none' : V ? `inset(-50% ${(1 - rev) * 50}% -50% ${(1 - rev) * 50}%)` : `inset(-50% ${(1 - rev) * 110 - 10}% -50% -20%)`;
      const kp = E.out(P(lb, .55, .8));
      if (V) Object.assign(kick.style, { left: 0, right: 0, textAlign: 'center', top: px(H * .62) });
      else Object.assign(kick.style, { left: px(W * .462), top: px(H * .66) });
      vis(kick, kp, `translateY(${(1 - kp) * 20}px)`);
      const fp = P(ls, 0, .7); vis(flare, (1 - fp) * clamp(ls / .02), `scaleX(${.4 + fp * 1.2})`);
      // GL
      S.bg = { brand: 1, pulse: g.kick, flow: 1.4 };
      const prog = E.out(P(lb, 0, .4));
      S.logo = { pos: V ? [0, 1.55, 0] : [-2.55, 0, 0], scale: V ? .9 : 1, rot: [.12 * Math.sin(ls * .8), lerp(-2.4, .28, E.back(P(lb, 0, .55))) + .08 * Math.sin(ls * 1.2), 0],
        prog, mesh: E.out(P(lb, .2, .42)), parts: (1 - P(lb, .42, .8)) * (V ? .45 : 1), psize: V ? 2.4 : 3.2 };
      S.ring = { pos: S.logo.pos, p: E.out(P(ls, 0, .8)), size: lerp(2, V ? 9 : 18, E.out(P(ls, 0, .8))) };
      S.stars = { a: .6, drift: 1.5 };
      S.cam = V ? { fov: 50, pos: [0, 0, lerp(12, 11, E.out(lb))], look: [0, .4, 0] } : { pos: [0, 0, lerp(10, 9.3, E.out(lb))], look: [0, 0, 0] };
      S.post = { bloom: V ? .6 + .4 * env(g.t, BIG, .3) : .9 + .8 * env(g.t, BIG, .3) };
    };
  },

  // ---------------------------------------------------------------- word montage
  words(sc) {
    const r = sc.root, o = sc.o;
    const rows = [0, 1, 2, 3].map((i) => add(r, `<div class="outline"></div>`, { fontSize: px(H * (V ? .085 : .16)), top: px(H * (V ? .12 + i * .2 : .02 + i * .25)), left: 0 }));
    const words = TL.WORDS.map((w) => centerKT(r, w, H * (V ? .43 : .34), W * (V ? .9 : .88), H * (V ? .13 : .32)));
    const counter = add(r, `<div class="kicker"></div>`, { left: 0, right: 0, textAlign: 'center', top: px(H * (V ? .64 : .8)), fontSize: px(U * (V ? 28 : 24)), color: '#fff' });
    const COLS = ['#3DB88D', '#12018D', '#0B86EA', '#3F4DE6', '#070824', '#1F7A5C', '#0A6FC2', null];
    sc.update = (ls, lb, S, g) => {
      let cur = 0; o.at.forEach((b, i) => { if (lb >= b) cur = i; });
      words.forEach((e, i) => (i === cur ? slam(e, ls - o.at[i] * BAR, { s0: 1.7, dur: .12, blur: 20 }) : hide(e)));
      rows.forEach((row, i) => {
        row.textContent = Array(6).fill(TL.WORDS[cur]).join(' ');
        const dir = i % 2 ? 1 : -1;
        vis(row, 1, `translateX(${-W * .3 + dir * (ls * 380 + cur * 90)}px)`);
      });
      counter.textContent = `${String(cur + 1).padStart(2, '0')} / 08 · looked after by LRWeb`;
      vis(counter, 1);
      const col = COLS[cur];
      S.bg = col ? { solid: 1, solidColor: col, pulse: g.kick } : { brand: 1, pulse: g.kick, flow: 2 };
      const pc = E.out5(P(ls - o.at[cur] * BAR, 0, .25));
      S.logo = { pos: [0, 0, -2], scale: V ? 1.2 : 1.9, rot: [.25, (cur + pc) * Math.PI / 2 + ls * .4, .1], mesh: 1, prog: 1, parts: 0 };
      S.cam = { fov: V ? 50 : 35, pos: [0, 0, 10], look: [0, 0, 0] };
      S.post = { bloom: .45, rgb: 2.5 * env(g.t, SNAPS, .08) };
      g.flash = Math.max(g.flash, .22 * env(g.t, o.at.slice(1).map((b) => (sc.s + b) * BAR), .05));
    };
  },

  // ---------------------------------------------------------------- the night shift
  overnight(sc) {
    const r = sc.root, o = sc.o;
    const kick = add(r, `<div class="kicker">One night of looking after your site</div>`, V ? { left: 0, right: 0, textAlign: 'center', top: px(H * .13), fontSize: px(U * 30) } : { left: px(W * .06), top: px(H * .2), fontSize: px(U * 24) });
    const fs = V ? W * .25 : W * .14;
    const reels = add(r, `<div class="reels"></div>`, V ? { left: 0, right: 0, justifyContent: 'center', top: px(H * .165), fontSize: px(fs) } : { left: px(W * .055), top: px(H * .27), fontSize: px(fs) });
    const mkReel = (n) => { const e = add(reels, `<div class="reel"><div class="col">${Array.from({ length: n + 1 }, (_, i) => `<span>${i % n}</span>`).join('')}</div></div>`); return e.firstChild; };
    const h1 = mkReel(3), h0 = mkReel(10); add(reels, `<div class="colon">:</div>`); const m1 = mkReel(6), m0 = mkReel(10);
    const cap = add(r, `<div class="kicker" style="color:#DCE1F5">Most of it happens while you sleep</div>`, V ? { left: 0, right: 0, textAlign: 'center', top: px(H * .315), fontSize: px(U * 26) } : { left: px(W * .06), top: px(H * .56), fontSize: px(U * 22) });
    const stack = add(r, `<div class="stack"></div>`, V ? { left: px(W * .06), right: px(W * .06), top: px(H * .39), height: px(H * .4), fontSize: px(U * 31) } : { left: px(W * .53), right: px(W * .05), top: px(H * .17), height: px(H * .7), fontSize: px(U * 25) });
    const tickets = TL.CARE.map(([tm, tx]) => add(stack, `<div class="ticket"><span class="tm">${tm}</span><span class="tx">${tx}</span><span class="ck">${CHECK}</span></div>`));
    const slept = [centerKT(r, 'YOU SLEPT.', H * (V ? .3 : .22), W * (V ? .86 : .62), H * .2), centerKT(r, 'WE DIDN’T.', H * (V ? .42 : .47), W * (V ? .88 : .7), H * .24)];
    slept[0].style.color = '#C9D0EA';
    const step = V ? 2.2 : 2.35; // ticket slot height in em
    sc.update = (ls, lb, S, g) => {
      const out = E.in2(P(lb, o.slept[0] - .08, o.slept[0] + .06));
      const ci = E.out5(P(ls, 0, .25));
      vis(kick, ci * (1 - out)); vis(cap, P(ls, .2, .45) * (1 - out));
      vis(reels, ci * (1 - out), `scale(${1 - .15 * out})`, out > .01 ? `blur(${out * 12}px)` : '');
      const mins = lerp(23 * 60, 32 * 60, E.inOut(P(lb, .05, o.slept[0] - .05)));
      const tot = Math.floor(mins), hh = Math.floor(tot / 60) % 24, mm = tot % 60;
      const speed = Math.abs(tot - (+reels.dataset.last || tot)); reels.dataset.last = tot;
      [[h1, Math.floor(hh / 10)], [h0, hh % 10], [m1, Math.floor(mm / 10)], [m0, mm % 10]].forEach(([col, d], k) => {
        col.style.transform = `translateY(${-d}em)`;
        col.parentNode.style.filter = k === 3 && speed > 1 ? `blur(${Math.min(5, speed)}px)` : '';
      });
      tickets.forEach((tk, i) => {
        const dt = ls - o.ticks[i] * BAR;
        if (dt < 0 || out >= 1) return hide(tk);
        const p = E.out5(clamp(dt / .22));
        const newer = o.ticks.filter((b, j) => j > i && lb >= b).length;
        const slot = newer * step;
        const shift = newer > 0 ? E.out5(clamp((ls - o.ticks[i + newer] * BAR) / .2)) : 1;
        const y = (newer - 1 + shift) * step * (newer ? 1 : 0);
        const fadeOld = newer >= (V ? 5 : 5) ? 1 - P(newer, V ? 5 : 5, 6) : 1;
        tk.style.top = '0';
        vis(tk, clamp(dt / .06) * fadeOld * (1 - out), `translateY(${y}em) translateZ(${(1 - p) * -1800}px) rotateX(${(1 - p) * 50}deg) rotateZ(${(1 - p) * -6}deg)`);
        const ck = tk.querySelector('.ck'); ck.style.transform = `scale(${E.back(clamp((dt - .12) / .2))})`;
      });
      slept.forEach((e, i) => slam(e, ls - o.slept[i] * BAR, { s0: 1.5, drift: .02 }));
      // GL: night into sunrise
      const p = E.inOut(P(lb, .1, sc.len * .95));
      S.bg = { night: 1 - p, sun: p, sunY: lerp(-.36, V ? .0 : .02, E.out(P(lb, .15, sc.len))), aurora: .8, pulse: g.kick * .5 };
      S.stars = { a: 1 - p * .8, drift: .3 };
      S.cam = { fov: V ? 50 : 35, pos: [0, 0, 10], look: [0, 0, 0] };
      S.post = { bloom: .5 };
    };
  },

  // ---------------------------------------------------------------- 3D showcase fly-through
  showcase(sc) {
    const r = sc.root, o = sc.o;
    const kick = add(r, `<div class="kicker">Example sites</div>`, { left: 0, right: 0, textAlign: 'center', top: px(H * (V ? .105 : .055)), fontSize: px(U * (V ? 28 : 22)) });
    const title = centerKT(r, 'BUILT FOR BUSINESSES LIKE YOURS.', H * (V ? .13 : .09), W * (V ? .88 : .64), H * .09);
    const counter = add(r, `<div class="kicker" style="color:#fff"></div>`, { left: 0, right: 0, textAlign: 'center', top: px(H * (V ? .655 : .775)), fontSize: px(U * (V ? 28 : 22)) });
    const kinds = TL.SITES.map(([, , k]) => centerKT(r, k, H * (V ? .68 : .81), W * (V ? .8 : .5), H * (V ? .09 : .14)));
    // laptops along a winding path
    const LP = TL.SITES.map((_, i) => [i % 2 ? 1.5 : -1.5, (i % 3 - 1) * .35, -i * 7.5]);
    const camFor = (i) => { const p = LP[i]; return V ? { pos: [p[0] * .6, p[1] + 1.25, p[2] + 7.6], look: [p[0], p[1] + 1.0, p[2]] } : { pos: [p[0] * .55, p[1] + 1.3, p[2] + 5.6], look: [p[0], p[1] + 1.02, p[2]] }; };
    sc.update = (ls, lb, S, g) => {
      const stopP = P(lb, o.stop, sc.len);
      const tl = lb < o.stop ? lb : o.stop + (lb - o.stop) * (1 - stopP) * .6; // tape-stop freeze
      let cur = 0; o.at.forEach((b, i) => { if (tl >= b - .05) cur = i; });
      const ti = E.out5(P(ls, 0, .3));
      vis(kick, ti); slam(title, ls, { s0: 1.3 });
      counter.textContent = `${String(cur + 1).padStart(2, '0')} / 06 · ${TL.SITES[cur][1]}`;
      vis(counter, ti);
      kinds.forEach((e, i) => (i === cur ? slam(e, (tl - o.at[i]) * BAR, { s0: 1.5, dur: .14 }) : hide(e)));
      // camera: move between laptops, arriving on each cue
      let cam = camFor(0), moving = 0;
      for (let i = 1; i < o.at.length; i++) {
        const a = o.at[i] - .22, b = o.at[i] + .04;
        if (tl >= a) { const q = E.inOut(P(tl, a, b)); const c0 = camFor(i - 1), c1 = camFor(i); cam = { pos: mixv(c0.pos, c1.pos, q), look: mixv(c0.look, c1.look, q) }; moving = Math.max(moving, Math.sin(Math.PI * P(tl, a, b))); }
      }
      const intro = E.out5(P(ls, 0, .45));
      cam.pos = mixv([cam.pos[0], cam.pos[1] + 1.5, cam.pos[2] + 6], cam.pos, intro);
      S.cam = { fov: V ? 52 : 38, pos: cam.pos, look: cam.look, roll: (cur % 2 ? 1 : -1) * .04 * moving };
      S.showLaps = LP.map((p, i) => ({ pos: p, rot: [0, -p[0] * .22, 0], open: 1.82, screen: TL.SITES[i][0], scroll: E.inOut(P(tl, o.at[i] + .05, o.at[i] + .5)) * .45, glow: .86 }));
      S.bg = { night: 1, aurora: .9, flow: 1.5 };
      S.stars = { a: 1, drift: .6, warp: moving * .5 };
      S.warp = { a: moving * .9, len: 3 };
      S.post = { bloom: .55, bloomThreshold: .9, rgb: moving * 1.5, sat: 1 - stopP, bright: 1 + stopP * 1.2 };
      // CRT switch-off with the tape stop
      if (stopP > 0) { const q = stopP; g.crt = q < .7 ? [1, lerp(1, .004, E.in(q / .7))] : [lerp(1, 0, E.in((q - .7) / .3)), .004]; }
    };
  },

  // ---------------------------------------------------------------- 2009, then the datamosh
  old(sc) {
    const r = sc.root, o = sc.o;
    r.style.background = '#008080';
    const f = U * (V ? 29 : 23);
    const ie = add(r, `<div class="ie"><div class="tb">🌐 J Smith and Sons - Home Page - Microsoft Internet Explorer</div><div class="addr">Address <span>http://www.jsmithandsons.co.uk/index_new2_FINAL.htm</span> Go</div>
      <div class="old"><h1>~*~ J SMITH &amp; SONS ~*~</h1><div class="nav9">Home | About_Us | Services | Gallery (broken) | Contact!!</div>
      <div class="mq"><span class="mqi" style="display:inline-block">★ WELCOME TO OUR WEBSITE ★ PLUMBING &amp; HEATING ★ CALL NOW ★ WELCOME TO OUR WEBSITE ★ PLUMBING &amp; HEATING ★</span></div>
      <p>Welcome to the offical home page of J Smith and Sons. We are a family run busines serving the local area. Please bare with us while the site is under construction.</p>
      <div class="uc">🚧 UNDER CONSTRUCTION 🚧</div><p class="lnk">Click here to download our price list (Word 97 document, 14MB)</p>
      <div class="ft">Best viewed in Internet Explorer 6 · Last updated March 2014 · Visitors: <span class="cnt">000042</span></div></div></div>`,
      V ? { left: px(W * .03), right: px(W * .03), top: px(H * .1), bottom: px(H * .16), fontSize: px(f) } : { left: px(W * .025), right: px(W * .025), top: px(H * .04), bottom: px(H * .04), fontSize: px(f) });
    add(r, `<div class="vhs"></div>`);
    const track = add(r, `<div class="track"></div>`, { height: px(H * .05) });
    const osd1 = add(r, `<div class="osd">▶ PLAY</div>`, { left: px(W * .06), top: px(H * (V ? .045 : .2)), fontSize: px(U * (V ? 40 : 34)) });
    add(r, `<div class="osd">MAR 14 2009&nbsp;&nbsp;23:04</div>`, { left: px(W * .06), top: px(H * (V ? .87 : .86)), fontSize: px(U * (V ? 36 : 30)) });
    const stick = add(r, `<div class="sticker">${V ? 'Still stuck<br>in 2009?' : 'Still stuck in 2009?'}</div>`, { fontSize: px(U * (V ? 118 : 96)), left: 0, top: px(H * (V ? .4 : .4)) });
    const mq = $('.mqi', r);
    sc.update = (ls, lb, S, g) => {
      const mosh = !PREP && lb >= o.mosh;
      r.style.display = mosh ? 'none' : 'block';
      const on = P(ls, 0, .12);
      r.style.transform = `scale(${lerp(1.02, 1, on)},${lerp(.008, 1, E.out5(on))})`;
      r.style.filter = `brightness(${lerp(3, 1, on)}) contrast(1.08) saturate(1.1)`;
      mq.style.transform = `translateX(${-((ls * 260) % 700)}px)`;
      track.style.top = px(((ls * .45) % 1.2 - .1) * H);
      ie.style.transform = `translate(${noise(ls * 12) * 3}px,${noise(ls * 9 + 4) * 2}px)`;
      osd1.style.opacity = (ls * 1.5) % 1 < .65 ? 1 : 0;
      const sw = stick.offsetWidth; stick.style.left = px((W - sw) / 2);
      slam(stick, ls - o.stuck * BAR, { s0: 2.4, dur: .12, rot: 14, rotEnd: -4, blur: 0 });
      // GL: black until the datamosh takes over
      S.bg = { solid: 1, solidColor: '#000000' };
      S.cam = { pos: [0, 0, 10], look: [0, 0, 0] };
      if (mosh) S.mosh = { old: V ? 'oldV' : 'oldL', new: V ? 'mobile' : 'hero', p: E.inOut(P(lb, o.mosh, sc.len)) };
      S.post = { glitch: mosh ? .35 * Math.sin(Math.PI * P(lb, o.mosh, sc.len)) + g.glitch : 0, rgb: mosh ? 2 : 1, seed: Math.floor(g.t * 24) };
    };
  },

  // ---------------------------------------------------------------- DROP 2: the rescue in 3D
  rescue(sc) {
    const r = sc.root, o = sc.o;
    const c1 = fit(kt(r, 'SAME BUSINESS.', '', V ? { left: 0, right: 0, textAlign: 'center', top: px(H * .1) } : { left: px(W * .05), top: px(H * .08) }), W * (V ? .86 : .46), H * .12);
    const plate = add(r, `<div class="plate"></div>`, { background: '#070824' });
    const c2 = fit(kt(plate, 'BRAND NEW WEBSITE.', 'noghost', { left: '.18em', top: '.12em', position: 'relative' }), W * (V ? .78 : .4), H * .1);
    c2.firstChild.classList.add('gtext');
    sc.update = (ls, lb, S, g) => {
      slam(c1, ls - o.cap[0] * BAR, { s0: 1.5 });
      const pw = +c2.dataset.w + +c2.dataset.fs * .36, ph = +c2.dataset.h + +c2.dataset.fs * .24;
      Object.assign(plate.style, { width: px(pw), height: px(ph), left: px(V ? (W - pw) / 2 : W * .05), top: px(H * (V ? .175 : .21)) });
      const pp = slam(plate, ls - o.cap[1] * BAR, { s0: 1.3, rot: -3, rotEnd: -1.5 });
      c2.style.visibility = plate.style.visibility; c2.style.opacity = 1;
      // GL: from full-screen site back into a laptop + phone
      const z = E.inOut(P(lb, .02, .75));
      S.bg = { brand: 1, pulse: g.kick, flow: 1.3 };
      if (!V) {
        S.resLap = { pos: mixv([0, 0, 0], [.5, -.55, 0], z), rot: [0, lerp(0, -.42, z), 0], open: lerp(Math.PI / 2, 1.9, z), screen: 'hero', glow: .9 };
        const pp2 = E.out5(P(lb, .2, .6));
        S.resPhone = { pos: mixv([5.5, -2.5, 2.5], [-2.0, -.05, 1.6], pp2), rot: [0, lerp(1.2, .38, pp2), lerp(.3, .04, pp2)], screen: 'mobile', glow: .9 };
        S.cam = { pos: mixv([0, 1.14, 2.94], [.4, 1.7, 7.6], z), look: mixv([0, 1.14, 0], [-.2, .55, 0], z), fov: 35 };
      } else {
        S.resPhone = { pos: mixv([0, 0, 0], [.45, -1.55, 1.2], z), rot: [0, lerp(0, -.38, z), lerp(0, .04, z)], screen: 'mobile', glow: .9 };
        const lp = E.out5(P(lb, .2, .65));
        S.resLap = { pos: mixv([-.5, 5, -4], [-.25, -.1, -2.4], lp), rot: [.12, lerp(.9, .42, lp), 0], open: 1.9, screen: 'hero', scale: .95, glow: .9 };
        S.cam = { pos: mixv([0, 0, 2.3], [1.0, .6, 8.6], z), look: mixv([0, 0, 0], [0, -.1, 0], z), fov: 50 };
      }
      S.stars = { a: .5, drift: 1 };
      S.post = { bloom: .5 + .6 * env(g.t, BIG, .3), bloomThreshold: .9, rgb: 2 * env(g.t, BIG, .15) };
    };
  },

  // ---------------------------------------------------------------- prices
  price(sc) {
    const r = sc.root, o = sc.o;
    const kick = add(r, `<div class="kicker ink">Care plans from</div>`, V ? { left: 0, right: 0, textAlign: 'center', top: px(H * .105), fontSize: px(U * 32) } : { left: px(W * .06), top: px(H * .14), fontSize: px(U * 28) });
    const dsz = V ? H * .2 : H * .44;
    const dg = add(r, `<div class="digits"><span class="cur gtext">£</span></div>`, { fontSize: px(dsz), ...(V ? { left: 0, right: 0, justifyContent: 'center', top: px(H * .13) } : { left: px(W * .05), top: px(H * .2) }) });
    const reels = [[2, 18], [9, 25]].map(([v, n]) => { const e = add(dg, `<div class="reel"><div class="col">${Array.from({ length: n + 1 }, (_, i) => `<span class="gtext">${i === n ? v : i % 10}</span>`).join('')}</div></div>`); return { col: e.firstChild, n }; });
    add(dg, `<span class="per">/month</span>`);
    const note = add(r, `<div class="kicker ink" style="color:#5A6478">${V ? 'No contract<br>No VAT to add<br>Leave any time' : 'No contract · No VAT to add · Leave any time'}</div>`, V ? { left: px(W * .07), top: px(H * .345), fontSize: px(U * 28), lineHeight: 1.6 } : { left: px(W * .06), top: px(H * .72), fontSize: px(U * 22) });
    const st = add(r, `<div class="stamp95"><div>≈95p<small>a day</small></div></div>`, V ? { width: px(W * .3), height: px(W * .3), left: px(W * .63), top: px(H * .33), fontSize: px(W * .088) } : { width: px(H * .3), height: px(H * .3), left: px(W * .37), top: px(H * .1), fontSize: px(H * .09) });
    const itemsBox = add(r, `<div class="items"></div>`, V ? { left: px(W * .07), right: px(W * .07), top: px(H * .505), fontSize: px(U * 32) } : { left: px(W * .6), right: px(W * .05), top: px(H * .12), fontSize: px(U * 25) });
    const items = TL.RECEIPT.map((t, i) => add(itemsBox, `<div class="item"><i>✓</i>${t}<em>INCL.</em></div>`));
    const plate = add(r, `<div class="plate"></div>`, V ? { left: px(W * .06), width: px(W * .88), top: px(H * .34), height: px(H * .26) } : { left: px(W * .14), width: px(W * .72), top: px(H * .26), height: px(H * .5) });
    const pk = add(plate, `<div class="kicker">One-off build · fixed price in writing</div>`, { left: 0, right: 0, textAlign: 'center', top: px(V ? H * .035 : H * .07), fontSize: px(U * (V ? 26 : 26)) });
    const p1 = fit(kt(plate, 'WEBSITES FROM', 'center noghost', { left: 0, right: 0, top: px(V ? H * .07 : H * .13) }), W * (V ? .7 : .5), H * .08);
    const p2 = fit(kt(plate, '<span class="g">£299</span>', 'center noghost', { left: 0, right: 0, top: px(V ? H * .12 : H * .23) }), W * .6, H * (V ? .12 : .22));
    p2.dataset.text = '£299';
    sc.update = (ls, lb, S, g) => {
      const whip = E.in(P(lb, sc.len - .1, sc.len));
      r.style.transform = `translateX(${-whip * W * 1.1}px)`; r.style.filter = whip > 0 ? `blur(${whip * 30}px)` : '';
      const dim = E.out(P(lb, o.build, o.build + .1));
      const dimF = dim > 0 ? `blur(${dim * 8}px) brightness(${1 - dim * .25})` : '';
      vis(kick, E.out(P(ls, 0, .2)), '', dimF);
      const dp = slam(dg, ls - o.from * BAR, { s0: 1.2, dur: .2 });
      if (dim) dg.style.filter = dimF;
      reels.forEach((rl, i) => { const q = E.out5(P(ls, o.from * BAR, o.slam * BAR + .05 + i * .06)); rl.col.style.transform = `translateY(${-rl.n * q}em)`; rl.col.parentNode.style.filter = q < .98 ? `blur(${(1 - q) * 6}px)` : ''; });
      vis(note, E.out(P(lb, o.slam + .1, o.slam + .3)), '', dimF);
      const sp = ls - o.sticker * BAR;
      if (sp < 0) hide(st); else vis(st, 1, `rotate(${lerp(-40, -12, E.out(clamp(sp / .2)))}deg) scale(${lerp(2.6, 1, E.back(clamp(sp / .18))) * (1 + .03 * g.kick)})`, dimF);
      const ih = V ? 2.05 : 2.45;
      items.forEach((it, i) => {
        const dt = ls - o.receipt[i] * BAR;
        if (dt < 0) return hide(it);
        const p = E.out5(clamp(dt / .18));
        it.style.top = `${i * ih}em`;
        vis(it, clamp(dt / .05), `translateX(${(1 - p) * 300}px) rotate(${(1 - p) * 6}deg)`, dimF);
      });
      const bp = ls - o.build * BAR;
      if (bp < 0) hide(plate); else vis(plate, 1, `scale(${lerp(1.5, 1, E.expo(clamp(bp / .16))) * (1 + .015 * g.kick)}) rotate(${lerp(-6, -1.5, E.out(clamp(bp / .2)))}deg)`);
      [pk, p1, p2].forEach((e) => (e.style.visibility = plate.style.visibility));
      S.bg = { light: 1, flow: 1.5 };
      S.cam = { pos: [0, 0, 10], look: [0, 0, 0] };
      S.post = { bloom: .2, rgb: 1.5 * env(g.t, SLAMS, .1) };
    };
  },

  // ---------------------------------------------------------------- humans
  humans(sc) {
    const r = sc.root, o = sc.o;
    const mk = (txt, top, maxW, maxH, strike) => { const e = fit(kt(r, txt, '', V ? { left: 0, right: 0, textAlign: 'center', top: px(top) } : { left: px(W * .05), top: px(top) }), maxW, maxH); if (strike) e.firstChild.style.position = 'relative'; return e; };
    const l1 = mk('NO CALL CENTRE.', H * (V ? .1 : .09), W * (V ? .86 : .5), H * .12, 1);
    const l2 = mk('NO CHATBOT.', H * (V ? .19 : .24), W * (V ? .7 : .4), H * .12, 1);
    const l3 = mk('JUST <span class="g">LUKE &amp; RALPH.</span>', H * (V ? .285 : .4), W * (V ? .9 : .55), H * .15);
    l3.dataset.text = 'JUST LUKE & RALPH.';
    const s1 = add(l1.firstChild, `<div class="strike"></div>`), s2 = add(l2.firstChild, `<div class="strike"></div>`);
    const avR = add(r, `<div class="av"><div class="c" style="background:linear-gradient(35deg,#3DB88D,#0B86EA)">R</div><div><b>Ralph</b><small>HUNGERFORD &amp; KINTBURY</small></div></div>`, V ? { left: px(W * .07), top: px(H * .43), fontSize: px(U * 50) } : { left: px(W * .06), top: px(H * .68), fontSize: px(U * 46) });
    const avL = add(r, `<div class="av"><div class="c" style="background:linear-gradient(35deg,#0B86EA,#3F4DE6)">L</div><div><b>Luke</b><small>WOKINGHAM</small></div></div>`, V ? { left: px(W * .56), top: px(H * .43), fontSize: px(U * 50) } : { left: px(W * .34), top: px(H * .68), fontSize: px(U * 46) });
    const arc = add(r, `<svg class="abs" viewBox="0 0 100 30" preserveAspectRatio="none"><defs><linearGradient id="ag" x1="0" x2="1"><stop offset="0" stop-color="#3DB88D"/><stop offset=".55" stop-color="#0B86EA"/><stop offset="1" stop-color="#3F4DE6"/></linearGradient></defs><path d="M4 28 Q50 -18 96 28" fill="none" stroke="url(#ag)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="1 3.2" vector-effect="non-scaling-stroke" style="stroke-width:6px"/></svg>`,
      V ? { left: px(W * .12), width: px(W * .62), top: px(H * .37), height: px(H * .06) } : { left: px(W * .08), width: px(W * .3), top: px(H * .6), height: px(H * .08) });
    const bq = add(r, `<div class="bub q"><small>client · 09:02</small>Can you change our Saturday hours to 9 till 1?</div>`, V ? { left: px(W * .06), width: px(W * .74), top: px(H * .53), fontSize: px(U * 34) } : { left: px(W * .6), width: px(W * .34), top: px(H * .2), fontSize: px(U * 30) });
    const bt = add(r, `<div class="bub a"><div class="dots"><i></i><i></i><i></i></div></div>`, V ? { right: px(W * .06), top: px(H * .66), fontSize: px(U * 34) } : { right: px(W * .06), top: px(H * .47), fontSize: px(U * 30) });
    const ba = add(r, `<div class="bub a"><small>Luke · 09:06</small>Done! It’s live now. Anything else?</div>`, V ? { right: px(W * .06), width: px(W * .7), top: px(H * .66), fontSize: px(U * 34) } : { right: px(W * .06), width: px(W * .32), top: px(H * .47), fontSize: px(U * 30) });
    sc.update = (ls, lb, S, g) => {
      const q1 = ls - o.lines[0] * BAR, q2 = ls - o.lines[1] * BAR, q3 = ls - o.lines[2] * BAR;
      slam(l1, q1, { s0: 1.5 }); slam(l2, q2, { s0: 1.5 }); slam(l3, q3, { s0: 1.5 });
      s1.style.transform = `scaleX(${E.out5(clamp((q1 - .18) / .14))})`; s2.style.transform = `scaleX(${E.out5(clamp((q2 - .18) / .14))})`;
      if (q1 > .2) l1.style.opacity = lerp(1, .45, clamp((q1 - .2) / .2)); if (q2 > .2) l2.style.opacity = lerp(1, .45, clamp((q2 - .2) / .2));
      const ap = E.back(P(ls, o.lines[2] * BAR + .15, o.lines[2] * BAR + .4));
      vis(avR, clamp(ap * 2), `scale(${ap})`); vis(avL, clamp(ap * 2), `scale(${E.back(P(ls, o.lines[2] * BAR + .25, o.lines[2] * BAR + .5))})`);
      const arP = E.out(P(ls, o.lines[2] * BAR + .3, o.lines[2] * BAR + .75));
      vis(arc, arP > 0 ? 1 : 0); arc.style.clipPath = `inset(0 ${(1 - arP) * 100}% 0 0)`;
      $('path', arc).style.strokeDashoffset = -ls * 8;
      const pq = E.back(clamp((ls - o.q * BAR) / .25)); if (ls < o.q * BAR) hide(bq); else vis(bq, 1, `translateY(${(1 - pq) * 40}px) scale(${lerp(.7, 1, pq)})`);
      const typing = ls > o.q * BAR + .2 && ls < o.a * BAR;
      if (typing) { vis(bt, 1); [...bt.querySelectorAll('i')].forEach((d, i) => (d.style.transform = `translateY(${-6 * Math.max(0, Math.sin(ls * 14 - i * .9))}px)`)); } else hide(bt);
      const pa = E.back(clamp((ls - o.a * BAR) / .25)); if (ls < o.a * BAR) hide(ba); else vis(ba, 1, `translateY(${(1 - pa) * 40}px) scale(${lerp(.7, 1, pa)})`);
      const inn = E.out5(P(ls, 0, .22));
      r.style.transform = `translateX(${(1 - inn) * W}px)`; r.style.filter = inn < 1 ? `blur(${(1 - inn) * 30}px)` : '';
      S.bg = { night: 1, aurora: 1.1, pulse: g.kick * .5 };
      S.stars = { a: 1, drift: .5 };
      S.cam = { pos: [0, 0, 10], look: [0, 0, 0] };
      S.post = { bloom: .5, rgb: 1.2 * env(g.t, SLAMS.concat(SNARES), .08) };
    };
  },

  // ---------------------------------------------------------------- the build: warp speed
  build(sc) {
    const r = sc.root, o = sc.o;
    const t1 = centerKT(r, 'TWO HUMANS.', H * (V ? .33 : .26), W * (V ? .9 : .78), H * .22);
    const t2 = centerKT(r, '<span class="g">ZERO DRAMA.</span>', H * (V ? .45 : .5), W * (V ? .9 : .78), H * .22); t2.dataset.text = 'ZERO DRAMA.';
    const echoes = [t1, t2].map((t) => [0, 1, 2].map(() => { const e = t.cloneNode(true); e.classList.add('noghost'); e.style.color = 'transparent'; e.style.webkitTextStroke = '2px rgba(255,255,255,.5)'; e.innerHTML = `<span>${t.dataset.text}</span>`; r.appendChild(e); return e; }));
    const line = add(r, `<div class="abs"></div>`, { left: px(W * .3), width: px(W * .4), top: px(H * .5 - 1), height: '2px', background: '#fff', boxShadow: '0 0 30px #fff' });
    sc.update = (ls, lb, S, g) => {
      const gap = lb >= o.gap;
      [t1, t2].forEach((t, k) => {
        const dt = ls - o.lines[k] * BAR;
        if (gap) { hide(t); echoes[k].forEach(hide); return; }
        slam(t, dt, { s0: 1.8, drift: .12 });
        echoes[k].forEach((e, j) => {
          if (dt < 0) return hide(e);
          const ph = ((dt / TL.BEAT) + j / 3) % 1;
          vis(e, (1 - ph) * .6, `scale(${1 + ph * 1.6})`);
        });
      });
      vis(line, gap ? 1 : 0, `scaleX(${1 - P(lb, o.gap, sc.len) * .9})`);
      const p = P(lb, 0, o.gap);
      S.bg = gap ? { solid: 1, solidColor: '#000000' } : { night: .5, brand: .5, flow: 3, pulse: g.snare };
      S.stars = { a: gap ? 0 : 1, warp: 1 + p * 2 };
      S.warp = { a: gap ? 0 : .7 + .3 * p, len: 2 + p * 5, t: g.t * (1 + p * 2) };
      S.cam = { pos: [0, 0, 10], look: [0, 0, 0], roll: ls * .25, fov: V ? 55 : 40 };
      S.post = { bloom: .8, rgb: 1 + 3 * p, bright: gap ? 0 : 1 };
      g.zoom *= 1 + .12 * E.in2(p);
      g.shake += p * p * 6;
    };
  },

  // ---------------------------------------------------------------- end card
  end(sc) {
    const r = sc.root, o = sc.o;
    // projection helper to line the DOM wordmark up with the 3D mark
    const cam = V ? { z: 12.5, fov: 50 } : { z: 10.5, fov: 35 };
    const th = Math.tan(cam.fov * Math.PI / 360);
    const proj = (x, y) => [W / 2 + x / (2 * cam.z * th * (W / H)) * W, H / 2 - y / (2 * cam.z * th) * H];
    const markPos = V ? [0, 2.55, 0] : [-2.65, .95, 0], markScale = V ? 1 : .95;
    const halfW = 57.5 * .03 * markScale, halfH = 32 * .03 * markScale;
    const [mx, my] = proj(markPos[0] + halfW, markPos[1]);
    const [, myTop] = proj(0, markPos[1] + halfH), [, myBot] = proj(0, markPos[1] - halfH);
    const markHpx = myBot - myTop;
    const wm = add(r, `<div class="wordmark">LRWeb</div>`, { fontSize: px(markHpx * 1.05) });
    if (V) Object.assign(wm.style, { left: 0, right: 0, textAlign: 'center', top: px(myBot + H * .005), fontSize: px(W * .23) });
    else Object.assign(wm.style, { left: px(mx + W * .02), top: px(my - markHpx * .56) });
    const tag = centerKT(r, 'WE BUILD IT. THEN WE LOOK AFTER IT.', H * (V ? .5 : .6), W * (V ? .9 : .78), H * .08);
    tag.style.textShadow = '0 6px 40px rgba(7,8,36,.55)';
    if (V) { tag.innerHTML = '<span>WE BUILD IT.<br>THEN WE LOOK AFTER IT.</span>'; tag.style.lineHeight = '.95'; tag.style.top = px(H * .525); tag.classList.add('noghost'); fits.pop(); fit(tag, W * .88, H * .12); }
    const pill = add(r, `<div class="pill">lrweb.uk</div>`, { fontSize: px(U * (V ? 86 : 74)) });
    const fine = add(r, `<div class="fine">${V ? 'Websites from £299<br>Care from £29/mo · hello@lrweb.uk' : 'Websites from £299 · Care from £29/mo · hello@lrweb.uk'}</div>`, { left: 0, right: 0, textAlign: 'center', top: px(H * (V ? .735 : .84)), fontSize: px(U * (V ? 30 : 26)), lineHeight: 1.5 });
    sc.update = (ls, lb, S, g) => {
      const wp = E.out5(P(lb, .2, .45));
      vis(wm, wp > 0 ? 1 : 0, `translateX(${V ? 0 : (1 - wp) * -60}px) translateY(${V ? (1 - wp) * 30 : 0}px)`);
      wm.style.clipPath = wp >= 1 ? 'none' : V ? `inset(-50% ${(1 - wp) * 50}% -50% ${(1 - wp) * 50}%)` : `inset(-50% ${(1 - wp) * 110 - 10}% -50% -20%)`;
      slam(tag, ls - o.tag * BAR, { s0: 1.3 });
      const pw = pill.offsetWidth; pill.style.left = px((W - pw) / 2); pill.style.top = px(H * (V ? .65 : .71));
      const up = E.back(clamp((ls - o.url * BAR) / .3)); if (ls < o.url * BAR) hide(pill); else vis(pill, clamp(up * 2), `scale(${lerp(.4, 1, up) * (1 + .02 * Math.sin(ls * 4))})`);
      vis(fine, E.out(P(lb, o.fine, o.fine + .25)), `translateY(${(1 - E.out(P(lb, o.fine, o.fine + .25))) * 20}px)`);
      S.bg = { sun: 1, sunY: lerp(-.3, V ? -.04 : .02, E.out5(P(lb, 0, 1.4))), flow: 1, pulse: g.kick * .6 };
      const prog = E.out(P(lb, 0, .35));
      S.logo = { pos: markPos, scale: markScale, rot: [.1 * Math.sin(ls * .7), lerp(-2.2, .22, E.back(P(lb, 0, .5))) + .1 * Math.sin(ls * .9), 0], prog, mesh: E.out(P(lb, .16, .36)), parts: 1 - P(lb, .3, .5), psize: 3 };
      S.ring = { pos: markPos, p: E.out(P(ls, 0, .9)), size: lerp(2, V ? 10 : 20, E.out(P(ls, 0, .9))) };
      S.stars = { a: .7, drift: .3 };
      S.cam = { fov: cam.fov, pos: [0, 0, cam.z], look: [0, 0, 0] };
      S.post = { bloom: .7 + .8 * env(g.t, BIG, .35) };
      g.leaks = .55;
    };
  },
};

for (const [name, s, len, o] of EDIT.scenes) { const sc = scene(name, s, len, o); builders[name](sc); }

// ------------------------------------------------------------------ overlays
const grain = $('#grain');
const tiles = [0, 1, 2, 3].map((k) => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const d = x.createImageData(256, 256);
  for (let i = 0; i < d.data.length; i += 4) { const v = hash(i * .37 + k * 1000) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); return c.toDataURL(); });
const leaks = $('#leaks');

// ------------------------------------------------------------------ render
let gl = null;
function render(t) {
  const bar = t / BAR;
  const g = { t, kick: env(t, KICKS, .12), snare: env(t, SNARES, .1), glitch: Math.max(env(t, GLITCH, .12), .35 * env(t, ERR, .06), .8 * env(t, at(['hook']), .2)), flash: 0, shake: 0, zoom: 1, crt: null, leaks: 0 };
  g.flash = Math.max(.85 * env(t, BIG, .09), .25 * env(t, SLAMS, .05));
  g.shake = 26 * env(t, BIG, .12) + 10 * env(t, SLAMS, .08) + 3 * g.kick + 2 * g.snare;
  const S = { post: {} };
  let active = null;
  for (const sc of scenes) {
    const on = bar >= sc.s && bar < sc.s + sc.len;
    sc.root.style.display = on ? 'block' : 'none';
    if (on) active = sc;
  }
  if (active) {
    const lb = bar - active.s;
    active.update(lb * BAR, lb, S, g);
  }
  S.post.glitch = Math.max(S.post.glitch || 0, g.glitch * .6);
  S.post.rgb = Math.max(S.post.rgb || 0, 4 * env(t, BIG, .12) + 2 * g.glitch);
  S.post.seed = S.post.seed ?? Math.floor(t * 24);
  if (gl && !PREP) gl.render(t, S);
  // stage: shake / zoom / CRT
  const sx = noise(t * 37) * g.shake, sy = noise(t * 31 + 9) * g.shake;
  const crt = g.crt;
  stage.style.transform = crt ? `scale(${crt[0]},${crt[1]})` : `translate(${sx}px,${sy}px) scale(${g.zoom * (1 + .006 * g.kick)})`;
  stage.style.filter = crt ? `brightness(${1 + 3 * (1 - crt[1])})` : '';
  document.documentElement.style.setProperty('--gx', px(Math.min(26, (S.post.rgb || 0) * 3 * U)));
  $('#flash').style.opacity = g.flash;
  leaks.style.opacity = g.leaks;
  if (g.leaks) leaks.style.background = `radial-gradient(${W * .5}px ${H * .6}px at ${50 + 30 * Math.sin(t * .4)}% ${20 + 10 * Math.cos(t * .5)}%, rgba(111,224,180,.35), transparent 70%), radial-gradient(${W * .6}px ${H * .5}px at ${80 - 20 * Math.sin(t * .3)}% ${80}%, rgba(63,77,230,.35), transparent 70%)`;
  const endFade = P(t, EDIT.end - .7, EDIT.end - .05);
  $('#black').style.opacity = endFade;
  const fi = Math.floor(t * 60); grain.style.backgroundImage = `url(${tiles[fi % 4]})`; grain.style.backgroundPosition = `${Math.floor(hash(fi) * 256)}px ${Math.floor(hash(fi + .5) * 256)}px`;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.seek = async (t) => {
  render(t);
  if (gl) gl.renderer.getContext().finish();
  await nextFrame(); // make sure the compositor has presented the WebGL frame before a screenshot
  return true;
};
window.EDIT = EDIT;
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([document.fonts.load('800 100px "Bricolage Grotesque"'), document.fonts.load('500 20px "IBM Plex Mono"'), document.fonts.load('600 20px "Instrument Sans"')]);
  runFits();
  if (!PREP) {
    gl = new GL(canvas, W, H);
    const assets = { oldL: 'assets/old-landscape.png', oldV: 'assets/old-vertical.png', hero: ASSET('smith-and-sons-hero.jpg'), mobile: ASSET('smith-and-sons-mobile.jpg') };
    for (const [img] of TL.SITES) assets[img] = ASSET(img + '.jpg');
    await gl.init(assets);
  }
  render(0);
  return true;
})();

if (Q.has('t')) window.ready.then(() => render(+Q.get('t')));
if (Q.has('play')) {
  const a = new Audio(`soundtrack-${EDIT.name}.wav`);
  document.addEventListener('click', () => { a.currentTime = 0; a.play(); const loop = () => { render(a.currentTime); if (!a.paused) requestAnimationFrame(loop); }; loop(); });
}
