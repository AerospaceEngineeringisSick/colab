// LRWeb promo v3: choreography. window.seek(t) renders any moment deterministically.
import { Aurora } from './aurora.js';

const TL = window.TL;
const Q = new URLSearchParams(location.search);
const EDIT = TL.EDITS[Q.get('edit') || 'landscape'];
const { W, H } = EDIT;
const V = H > W, BAR = TL.BAR;
const DPR = window.devicePixelRatio || 1;
const STEPT = BAR / 16;

// ------------------------------------------------------------------ utils
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const P = (x, a, b) => clamp((x - a) / (b - a));
const lerp = (a, b, x) => a + (b - a) * x;
const E = {
  out: (x) => 1 - (1 - x) ** 3, out4: (x) => 1 - (1 - x) ** 4, expo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  in: (x) => x * x * x, inOut: (x) => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  inOut5: (x) => (x < .5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
  back: (x) => { const c = 1.6; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
const $ = (s, r = document) => r.querySelector(s);
const html = (s) => { const d = document.createElement('div'); d.innerHTML = s.trim(); return d.firstChild; };
const add = (p, s, css = {}) => { const e = typeof s === 'string' ? html(s) : s; Object.assign(e.style, css); p.appendChild(e); return e; };
const px = (v) => `${v}px`;
const show = (el, o = 1, tf = '', f = '') => { el.style.opacity = o; el.style.visibility = o > .003 ? 'visible' : 'hidden'; el.style.transform = tf; el.style.filter = f; };
const hide = (el) => { el.style.visibility = 'hidden'; el.style.opacity = 0; };
const gOK = (w) => w.classList.contains('g');
const blurF = (b, extra = '') => (b > .3 ? `blur(${b.toFixed(1)}px) ${extra}` : extra);
const L = (a, b) => (V ? b : a); // landscape value, vertical value

// stage
document.documentElement.style.cssText = `width:${W}px;height:${H}px`;
document.body.style.cssText = `width:${W}px;height:${H}px`;
const stage = $('#stage'); stage.style.width = px(W); stage.style.height = px(H);
const dom = $('#dom'); if (V) document.body.classList.add('V');
const fxc = $('#fx'); fxc.width = W * DPR; fxc.height = H * DPR; const fx = fxc.getContext('2d'); fx.scale(DPR, DPR);

// ------------------------------------------------------------------ icons
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

// the LR mark (traced from the logo): fill + a light-drawn outline
const MARK_L = 'M17 1.5H34L24.5 49.5H69L84.5 65H4Z';
const MARK_R = 'M44 1.5H95Q110 1.5 110 16V27Q110 36 97 43L119 65H96L62.5 29.5H89Q95 29.5 95 23V21Q95 15 89 15H58L51 43H34Z';
const markSVG = () => `<svg viewBox="0 0 123 67"><path class="fl" d="${MARK_L}" fill="#0A74C9"/><path class="fr" d="${MARK_R}" fill="#3CB88C"/>
  <path class="sl" d="${MARK_L}" fill="none" stroke="#E6FFF6" stroke-width="1.3" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/>
  <path class="sr" d="${MARK_R}" fill="none" stroke="#E6FFF6" stroke-width="1.3" stroke-linejoin="round" pathLength="1" stroke-dasharray="1"/></svg>`;
const logoHTML = () => `<div class="logo">${markSVG()}<div class="wm">${[...'LRWeb'].map((c) => `<span>${c}</span>`).join('')}</div></div>`;
function animLogo(lg, d, wordAt) {
  const draw = E.inOut(P(d, 0, .55)), fill = E.out(P(d, .42, .85));
  lg.querySelectorAll('.sl,.sr').forEach((p) => { p.style.strokeDashoffset = 1 - draw; p.style.opacity = 1 - .9 * fill; });
  lg.querySelectorAll('.fl,.fr').forEach((p) => { p.style.opacity = fill; });
  lg.querySelector('svg').style.filter = `drop-shadow(0 0 ${14 + 30 * (1 - fill)}px rgba(111,224,180,${.3 + .5 * (1 - fill)}))`;
  [...lg.querySelectorAll('.wm span')].forEach((c, i) => { const e = d - wordAt - i * .05; const p = E.expo(clamp(e / .6)); c.style.transform = `translateY(${(1 - p) * 105}%)`; c.style.opacity = e < 0 ? 0 : 1; });
}

// ------------------------------------------------------------------ kinetic type
// lines: strings; a word wrapped in *stars* gets the aurora gradient
function heading(parent, lines, css = {}, cls = 'h c soft') {
  const e = add(parent, `<div class="${cls}"></div>`, css); const words = [];
  lines.forEach((ln) => {
    const l = add(e, '<span class="ln"></span>');
    ln.split(' ').forEach((w, i) => {
      const g = w.includes('*'); const s = add(l, `<span class="w${g ? ' g' : ''}">${w.replace(/\*/g, '')}</span>`);
      if (i) l.insertBefore(document.createTextNode(' '), s); words.push(s);
    });
  });
  e._words = words; return e;
}
// masked rise per word; optional exit (seconds after cue) rising out
function rise(e, dt, o = {}) {
  const { st = .055, dur = .75, ex = null, exDur = .45, blur = 0 } = o;
  if (dt < 0 || (ex !== null && dt > ex + exDur + st * e._words.length * .5 + .05)) { hide(e); return; }
  e.style.visibility = 'visible'; e.style.opacity = 1;
  e._words.forEach((w, i) => {
    const p = E.expo(clamp((dt - i * st) / dur)); let y = (1 - p) * 110, op = clamp((dt - i * st) / .12), b = blur * (1 - p);
    if (ex !== null) { const q = E.in(clamp((dt - ex - i * st * .5) / exDur)); y -= q * 110; op *= 1 - q; b += q * 6; }
    w.style.transform = `translateY(${y}%)`; w.style.opacity = op; w.style.filter = b > .3 ? `blur(${b.toFixed(1)}px)${gOK(w) ? ' drop-shadow(0 3px 16px rgba(4,5,28,.75))' : ''}` : '';
  });
}
function letters(parent, text, css, cls = 'h c soft') {
  const e = add(parent, `<div class="${cls}"></div>`, css);
  e._ch = [...text].map((c) => add(e, `<span class="ch">${c === ' ' ? '&nbsp;' : c}</span>`)); return e;
}

// ------------------------------------------------------------------ timing
const SFX = TL.sfx(EDIT);
const KICKS = [];
for (const [sec, a, l] of EDIT.music) {
  if (sec === 'drop' || sec === 'drop2') for (let b = 0; b < l * 4; b++) KICKS.push((a + b / 4) * BAR);
  if (sec === 'build') for (let b = 0; b < (l - .25) * 4; b++) KICKS.push((a + b / 4) * BAR);
}
const env = (t, times, tau) => { let v = 0; for (const x of times) { const d = t - x; if (d >= 0 && d < tau * 4) v = Math.max(v, Math.exp(-d / tau)); } return v; };
const sfxAt = (kinds) => SFX.filter((e) => kinds.includes(e.kind)).map((e) => e.t);
const BIG = sfxAt(['drop', 'final']), LANDS = sfxAt(['land']);

// ------------------------------------------------------------------ particles (deterministic bursts)
const bursts = [];
function burst(t0, x, y, w, h, n, seed) { bursts.push({ t0, x, y, w, h, n, seed }); }
const PCOL = ['111,224,180', '11,134,234', '230,255,245', '139,149,247'];
function drawParticles(t) {
  fx.clearRect(0, 0, W, H); fx.globalCompositeOperation = 'lighter';
  for (const b of bursts) {
    const dt = t - b.t0; if (dt < 0 || dt > 1.8) continue;
    for (let i = 0; i < b.n; i++) {
      const r1 = hash(b.seed + i * 1.37), r2 = hash(b.seed + i * 2.71), r3 = hash(b.seed + i * 4.13);
      const drag = (1 - Math.exp(-2.4 * dt)) / 2.4;
      const x = b.x + r1 * b.w + (420 + 780 * r3) * drag, y = b.y + r2 * b.h + (-220 + 360 * hash(b.seed + i * 7.1)) * drag - 50 * dt * dt;
      const life = clamp(1 - dt / (.8 + .9 * r1)), s = (1 + 2.6 * r2) * (.5 + life * .7);
      fx.fillStyle = `rgba(${PCOL[i % 4]},${(life * .95).toFixed(3)})`; fx.beginPath(); fx.arc(x, y, s, 0, 6.283); fx.fill();
    }
  }
  fx.globalCompositeOperation = 'source-over';
}

// ------------------------------------------------------------------ scenes
const scenes = []; const shared = {};
const mkRoot = () => add(dom, '<div class="scene"></div>');
const SAFE = V ? { top: 230, bottom: 1480 } : { top: 50, bottom: 960 };
// the drop's aurora wave sweeps left→right and clears the centre just before the downbeat
const WAVE0 = -.42, WAVE1 = .22;
const passT = (x) => WAVE0 + .05 + clamp(x / W, -.2, 1.2) * (WAVE1 - WAVE0) * .85;

const builders = {
  // ---------------------------------------------------------------- HOOK: every website comes with jobs
  hook(sc) {
    const r = (sc.root = shared.problem = mkRoot()), o = sc.o;
    const world = add(r, '<div class="world"><div class="rig"></div></div>'); const rig = (shared.rig = world.firstChild);
    const head = (shared.head = heading(r, V ? ['Every website', 'comes with', '*jobs.*'] : ['Every website', 'comes with *jobs.*'], { top: px(L(330, 610)), fontSize: px(L(140, 138)) }));
    const POS = V ? [[70, 250, 0], [560, 400, -120], [40, 1060, 60], [590, 1200, -80], [110, 1360, 20], [600, 1500, -220], [30, 1520, -260], [560, 230, 90], [330, 1650, -60], [60, 420, 140]]
      : [[110, 80, 0], [1380, 120, -120], [60, 700, 60], [1420, 690, -60], [740, 860, 110], [1230, 400, -260], [220, 400, -220], [860, 40, -160], [1480, 900, 40], [60, 900, -100]];
    shared.notes = TL.POPS.map((p, i) => { const n = add(rig, noteHTML(p)); n._p = POS[i % POS.length]; Object.assign(n.style, { left: px(n._p[0]), top: px(n._p[1]) }); return n; });
    sc.update = (ls, lb, G) => {
      const up = E.inOut(P(lb, 0, 2.4));
      G.sky = { inten: E.out(P(ls, 0, 2.4)), stars: E.out(P(ls, 0, 1.6)), cam: { tilt: lerp(-.44, 0, up), zoom: lerp(1.14, 1, E.out(P(lb, 0, 4))), pan: ls * .015 } };
      rise(head, ls - o.head * BAR, { st: .09, dur: .9, blur: 6 });
      const rec = E.inOut(P(lb, 3.1, 3.9));
      if (ls >= o.head * BAR) { head.style.transform = `scale(${1 - .08 * rec}) translateY(${-rec * 30}px)`; head.style.filter = blurF(rec * 5); head.style.opacity = 1 - .5 * rec; }
      const dolly = -260 * E.inOut(P(lb, 1.4, 4));
      rig.style.transform = `translateZ(${dolly}px) rotateY(${noise(ls * .2) * 2}deg) rotateX(${noise(ls * .17 + 3) * 1.5}deg)`;
      shared.notes.forEach((n, i) => {
        const dt = ls - o.pops[i] * BAR; if (dt < 0) return hide(n);
        const p = E.back(clamp(dt / .45)), z = n._p[2];
        show(n, clamp(dt / .12), `translate3d(0,${(1 - p) * 30 + Math.sin(ls * .9 + i * 1.7) * 6}px,${z}px) scale(${lerp(.86, 1, p)})`, blurF(Math.abs(z + dolly * .3) * .012));
      });
    };
  },

  // ---------------------------------------------------------------- STORM: the jobs pile up
  storm(sc) {
    const r = (sc.root = shared.problem), rig = shared.rig, o = sc.o;
    const extra = (shared.extra = o.pops.map((b, i) => {
      const n = add(rig, noteHTML(TL.POPS[(i + 3) % TL.POPS.length]));
      n._p = [hash(i * 3.1 + .5) * (W - 460) + 10, SAFE.top - 30 + hash(i * 7.3 + .2) * (SAFE.bottom - SAFE.top - 60), -420 + hash(i * 5.7) * 620];
      Object.assign(n.style, { left: px(n._p[0]), top: px(n._p[1]) }); return n;
    }));
    const dlgs = (shared.dlgs = o.dialogs.map((b, i) => {
      const [tt, msg] = TL.DIALOGS[i % TL.DIALOGS.length];
      const d = add(rig, `<div class="dlg"><div class="tb"><span>${tt}</span><b>×</b></div><div class="bd"><div class="x">✕</div><div>${msg}</div></div><div class="ok">OK</div></div>`);
      d._p = V ? [150 + i * 50, 560 + i * 100, 160] : [440 + i * 80, 170 + i * 75, 180];
      Object.assign(d.style, { left: px(d._p[0]), top: px(d._p[1]) }); return d;
    }));
    const jobs = TL.JOBS.slice(0, o.jobs.length).map((w) => heading(r, [w], { top: px(L(420, 800)), fontSize: px(L(180, 160)) }, 'h c glow'));
    const who = (shared.who = letters(r, 'Whose job is that?', V ? { top: px(760), fontSize: px(118), whiteSpace: 'normal', padding: '0 40px' } : { top: px(440), fontSize: px(150) }, 'h c glow'));
    [...extra, ...dlgs, ...jobs, who].forEach(hide); // shares the hook's stage: start hidden
    sc.update = (ls, lb, G) => {
      const tension = P(lb, 0, o.gap), gap = lb >= o.gap, focusWho = lb >= o.who;
      G.sky = { storm: E.inOut(P(lb, 0, 1.5)), inten: gap ? .35 : 1 + .25 * G.kick, stars: 1 - tension * .5, speed: 1 + tension,
        cam: { tilt: noise(ls * 4) * .006 * tension, zoom: 1 + .06 * tension + (gap ? .05 * P(lb, o.gap, sc.len) : 0), pan: .06 + ls * .02 } };
      rise(shared.head, ls + 10, { ex: 10, exDur: .5, st: .03 });
      const dolly = -260 - 140 * E.inOut(tension);
      rig.style.transform = `translateZ(${dolly}px) rotateY(${noise(ls * .3) * 3 * (1 + tension)}deg) rotateX(${noise(ls * .25 + 3) * 2}deg)`;
      const jit = tension ** 2 * 8, dim = gap ? .12 : 1;
      shared.notes.forEach((n, i) => show(n, dim, `translate3d(${noise(ls * 9 + i) * jit}px,${Math.sin(ls * .9 + i * 1.7) * 6}px,${n._p[2]}px)`, blurF((focusWho ? 5 : 1.5) + Math.abs(n._p[2]) * .006)));
      extra.forEach((n, i) => {
        const dt = ls - o.pops[i] * BAR; if (dt < 0) return hide(n);
        const p = E.back(clamp(dt / .3));
        show(n, dim * clamp(dt / .08), `translate3d(${noise(ls * 9 + i * 3) * jit}px,${(1 - p) * 24}px,${n._p[2]}px) scale(${lerp(.8, 1, p)})`, blurF((focusWho ? 5 : 0) + Math.abs(n._p[2]) * .008));
      });
      dlgs.forEach((d, i) => {
        const dt = ls - o.dialogs[i] * BAR; if (dt < 0) return hide(d);
        const p = E.back(clamp(dt / .18));
        show(d, dim, `translate3d(${noise(ls * 11 + i) * jit}px,0,${d._p[2]}px) scale(${lerp(.6, 1, p)})`, blurF(focusWho ? 4 : 0));
      });
      jobs.forEach((j, i) => {
        const dt = ls - o.jobs[i] * BAR, next = i + 1 < jobs.length ? (o.jobs[i + 1] - o.jobs[i]) * BAR : .8;
        if (dt < 0 || dt > next) return hide(j);
        const p = E.expo(clamp(dt / .18)); j._words.forEach((w) => { w.style.transform = ''; w.style.opacity = 1; });
        show(j, 1, `scale(${lerp(1.25, 1, p) + dt * .03})`, blurF((1 - p) * 14));
      });
      const wt = ls - o.who * BAR;
      if (wt < 0) hide(who); else {
        show(who, 1, `scale(${1 + (gap ? .07 * E.out(P(lb, o.gap, sc.len)) : 0)})`);
        who._ch.forEach((c, i) => { const d = wt - i * STEPT * L(.9, .45), p = E.expo(clamp(d / .2)); c.style.opacity = d < 0 ? 0 : 1; c.style.transform = `translateY(${(1 - p) * 40}%)`; c.style.filter = blurF((1 - p) * 8); });
      }
    };
  },

  // ---------------------------------------------------------------- DROP: the aurora wave, "Ours.", the logo
  drop(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const ours = letters(r, 'Ours.', { top: px(L(320, 700)), fontSize: px(L(320, 280)) }, 'h c glow');
    const lg = add(r, logoHTML(), { fontSize: px(L(170, 190)) });
    if (V) Object.assign(lg.style, { flexDirection: 'column', gap: '.18em', left: 0, right: 0, top: px(640) }); else Object.assign(lg.style, { left: 0, right: 0, justifyContent: 'center', top: px(350) });
    const tag = heading(r, V ? ['Your website,', '*handled.*'] : ['Your website, *handled.*'], { top: px(L(610, 1120)), fontSize: px(L(76, 96)) });
    sc.pre = -WAVE0 + .05; // the wave starts in the silent beat before the downbeat, so this scene takes over early
    sc.update = (ls, lb, G) => {
      const wp = P(ls, WAVE0, WAVE1), storm = scenes.find((s) => s.name === 'storm');
      if (ls < .9) storm.update(ls + storm.len * BAR, lb + storm.len, G); // the storm stays underneath while the wave dissolves it
      const pre = G.sky, sky = { inten: 1.15 + .5 * Math.exp(-Math.max(0, ls) / .6) + .2 * G.kick, stars: .8, waveX: lerp(-1.4, 1.6, E.inOut(wp)), waveA: Math.sin(Math.PI * wp) * 1.2,
        cam: { tilt: .3 * E.expo(P(ls, 0, .5)) - .16 * E.inOut(P(ls, .5, BAR * 2)), zoom: 1 + .04 * E.out(P(lb, 0, 2)), pan: .12 + ls * .03 } };
      if (ls < 0) { const k = E.in(P(ls, WAVE0, 0)); Object.assign(sky, { inten: lerp(pre.inten, sky.inten, k), storm: 1 - k, stars: lerp(pre.stars, .8, k), cam: pre.cam, speed: pre.speed }); } // camera cuts on the downbeat
      G.sky = sky;
      if (ls > WAVE0 - .05 && ls < .6) G.mb = 6;
      // the storm dissolves as the wave passes (keep the problem scene visible for the first beat)
      if (ls < .9) {
        const prob = shared.problem; prob.style.display = 'block';
        [...shared.notes, ...shared.extra, ...shared.dlgs].forEach((n) => {
          const q = P(ls, passT(n._p[0] + 200), passT(n._p[0] + 200) + .22), op = +n.style.opacity || 0;
          n.style.opacity = op * (1 - q); n.style.filter = blurF(q * 16, `brightness(${1 + q * 2})`);
        });
        const q = P(ls, passT(W * .35), passT(W * .65)); shared.who.style.opacity = 1 - q; shared.who.style.filter = blurF(q * 20, `brightness(${1 + 3 * q})`);
        if (ls > 0) shared.rig.style.transform += ` translateX(${E.in(P(ls, 0, .6)) * 300}px)`;
      }
      const od = ls - o.ours * BAR, oe = (o.logo - o.ours) * BAR - .1;
      if (od < 0 || od > oe + .3) hide(ours); else {
        const ex = E.in(P(od, oe, oe + .3));
        show(ours, 1 - ex, `scale(${1 + .04 * od - ex * .2})`, blurF(ex * 16));
        ours._ch.forEach((c, i) => { const d = od - i * .04, p = E.expo(clamp(d / .35)); c.style.opacity = d < 0 ? 0 : 1; c.style.transform = `translateY(${(1 - p) * 60}%) scale(${lerp(1.3, 1, p)})`; c.style.filter = blurF((1 - p) * 10); });
      }
      const ld = ls - o.logo * BAR;
      if (ld < 0) hide(lg); else { show(lg, 1, `scale(${1 + .03 * E.out(P(ld, 0, 3))})`); animLogo(lg, ld, (o.word - o.logo) * BAR); }
      rise(tag, ls - o.tag * BAR, { blur: 6 });
    };
  },

  // ---------------------------------------------------------------- TWO JOBS
  jobs(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const a = heading(r, ['Two jobs.'], { top: px(L(290, 640)), fontSize: px(L(150, 140)) });
    const b = heading(r, ['We do *both.*'], { top: px(L(450, 800)), fontSize: px(L(150, 140)) });
    const c1 = add(r, '<div class="chip"><b>01</b>We build it</div>', { fontSize: px(L(26, 30)) });
    const c2 = add(r, '<div class="chip"><b>02</b>We look after it</div>', { fontSize: px(L(26, 30)) });
    sc.update = (ls, lb, G) => {
      const exit = sc.len * BAR - .35;
      rise(a, ls - o.a * BAR, { ex: exit, exDur: .3, blur: 4 }); rise(b, ls - o.b * BAR, { ex: exit - o.b * BAR, exDur: .3, blur: 4 });
      [c1, c2].forEach((el, i) => {
        const p = E.out4(P(ls, o.b * BAR + .15 + i * .15, o.b * BAR + .6 + i * .15)), w = el.offsetWidth;
        Object.assign(el.style, { left: px(V ? (W - w) / 2 : W / 2 + (i ? 20 : -w - 20)), top: px(V ? 1010 + i * 100 : 680) });
        show(el, p * (1 - E.in(P(ls, exit, exit + .3))), `translateY(${(1 - p) * 30}px)`);
      });
      G.sky = { inten: 1.1 + .25 * G.kick, cam: { tilt: .14 - .04 * lb, pan: .2 + ls * .06, zoom: 1.04 } };
      if (ls > exit) G.mb = 4;
    };
  },

  // ---------------------------------------------------------------- JOB ONE: we build it (Crumb & Kiln rebuild + showcase)
  build(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const chip = add(r, '<div class="chip"><b>01</b>We build it</div>', { fontSize: px(L(22, 28)), left: px(70), top: px(L(56, 230)) });
    const world = add(r, '<div class="world"><div class="rig"></div></div>'); const rig = world.firstChild;
    const ww = L(1180, 960), wh = L(738, 860), wy = L(170, 500);
    const win = add(rig, `<div class="win"><div class="bar ie"><span>🌐 Crumb &amp; Kiln Bakery - Microsoft Internet Explorer</span></div><div class="bar mod"><i></i><i></i><i></i><div class="url">🔒 crumbandkiln.co.uk</div></div><div class="body"></div></div>`,
      { width: px(ww), height: px(wh), left: px((W - ww) / 2), top: px(wy) });
    const body = win.querySelector('.body'), barIE = win.querySelector('.bar.ie'), barMod = win.querySelector('.bar.mod');
    const deskW = V ? 1100 : 1440, deskH = Math.round(deskW * (wh - 44) / ww);
    const fr = add(body, `<iframe src="../lrweb/work/crumb-and-kiln/?shot" scrolling="no"></iframe>`, { width: px(deskW), height: px(deskH), transform: `scale(${ww / deskW})` });
    const old = add(body, `<div class="old"><div class="banner">~ Crumb &amp; Kiln Bakery ~</div>
      <div class="nav"><u>Home</u>|<u>Our Bread</u>|<u>Cakes!!</u>|<u>Guestbook</u>|<u>Contact Us</u></div>
      <div class="mq"><span class="mqi" style="display:inline-block">★ FRESH BREAD DAILY ★ WE DO WEDDING CAKES ★ SPECIAL OFFER ON TEACAKES ★ FRESH BREAD DAILY ★ WE DO WEDDING CAKES ★</span></div>
      <div class="row"><div class="pic">OUR_LOAF.JPG</div><div class="box"><h3>Welcome to our website!!!</h3>We are a family bakery in Bristol. We sell bread, cakes and more. Please sign our guestbook and tell your freinds!!<div class="blink">NEW!! Order by phone</div></div></div>
      <div class="uc">🚧 MENU COMING SOON 🚧</div>
      <div class="foot">Best viewed in Internet Explorer 6 at 800x600 · Last updated 12/03/2009 · You are visitor <span class="cnt">000217</span></div></div>`);
    const beam = add(body, '<div class="beam"></div>');
    const tagB = add(r, '<div class="tag" style="background:#FF5C6C;color:#fff">Before · 2009</div>');
    const tagA = add(r, '<div class="tag" style="background:#3DB88D;color:#fff">After · LRWeb</div>');
    const phone = add(rig, `<div class="phone"><div class="scr"><div class="isl"></div></div></div>`, V ? { left: px(590), top: px(760), width: '330px', height: '682px' } : { left: px(1340), top: px(270) });
    const pscr = phone.querySelector('.scr'), pw = V ? 308 : 278, ph = V ? 660 : 598;
    const mf = add(pscr, `<iframe src="../lrweb/work/crumb-and-kiln/?shot" scrolling="no"></iframe>`, { width: '390px', height: px(Math.round(390 * ph / pw)), transform: `scale(${pw / 390})` });
    const cap = heading(r, V ? ['Same bakery.', '*Brand new website.*'] : ['Same bakery. *Brand new website.*'], { top: px(L(955, 1480)), fontSize: px(L(54, 70)) });
    const strip = add(rig, '<div class="abs" style="left:0;top:0;transform-style:preserve-3d"></div>');
    const cards = TL.SITES.map(([img, kind, url], i) => {
      const cw = V ? 330 : 560, ch = V ? 714 : 350;
      const c = add(strip, `<div class="abs" style="transform-style:preserve-3d"><div class="card" style="width:${cw}px;height:${ch}px"><img src="captures/${img}-${V ? 'mhero' : 'hero'}.jpg"></div><div class="label" style="left:4px;top:${ch + 18}px">${kind}<small>${url}</small></div></div>`);
      return c;
    });
    const showCap = heading(r, V ? ['Built for real', '*local businesses.*'] : ['Built for real *local businesses.*'], { top: px(L(80, 330)), fontSize: px(L(64, 84)) });
    shared.frames = [fr, mf]; shared.deskH = deskH;
    sc.update = (ls, lb, G) => {
      const B = (b) => b * BAR;
      const end = sc.len * BAR;
      show(chip, E.out(P(ls, 0, .5)) * (1 - E.in(P(ls, end - .3, end))), `translateY(${(1 - E.out(P(ls, 0, .5))) * -20}px)`);
      const wa = E.out4(P(ls, B(o.before), B(o.before) + 1.1));
      const pull = E.inOut5(P(ls, B(o.pull), B(o.pull) + 1.2));
      const away = E.inOut5(P(ls, B(o.show) - .1, B(o.show) + .9));
      const wx = V ? lerp(0, -150, pull) : lerp(0, -300, pull), wyo = V ? lerp(0, -150, pull) : 0, ws = lerp(1, V ? .72 : .74, pull);
      if (ls < B(o.before) || away >= 1) hide(win);
      else show(win, wa, `translate3d(${wx - away * W * 1.2}px,${wyo + (1 - wa) * 60}px,${(1 - wa) * -700}px) rotateX(${(1 - wa) * 16}deg) rotateY(${pull * (V ? 0 : 10)}deg) scale(${ws})`);
      // the beam rebuilds the page from top to bottom
      const sp = P(ls, B(o.scan), B(o.scanEnd)), bh = wh - 44, by = E.inOut(sp) * (bh + 20) - 10;
      old.style.clipPath = sp > 0 ? `inset(${Math.max(0, by)}px 0 0 0)` : ''; old.style.display = sp >= 1 ? 'none' : 'block';
      $('.mqi', old).style.transform = `translateX(${-((ls * 220) % 900)}px)`;
      show(beam, sp > 0 && sp < 1 ? 1 : 0, `translateY(${by - 3}px)`);
      barIE.style.opacity = 1 - E.out(P(sp, 0, .15)); barMod.style.opacity = E.out(P(sp, 0, .15));
      buildSite(fr.contentDocument, ls - B(o.scan), B(o.scanEnd) - B(o.scan), deskH);
      const tr = { left: (W - ww * ws) / 2 + wx, top: wy + wyo + wh * (1 - ws) / 2 };
      const tb = E.out(P(ls, B(o.before) + .5, B(o.before) + .9)) * (1 - E.out(P(sp, 0, .2)));
      Object.assign(tagB.style, { left: px(tr.left + 16), top: px(tr.top - 58) }); show(tagB, tb, `translateY(${(1 - tb) * 10}px)`);
      const ta = E.out(P(sp, .85, 1)) * (1 - away);
      Object.assign(tagA.style, { left: px(tr.left + 16), top: px(tr.top - 58) }); show(tagA, ta);
      // the phone: real mobile layout, scrolling
      const pp = E.out4(P(ls, B(o.pull) + .25, B(o.pull) + 1.3));
      if (pp <= 0 || away >= 1) hide(phone); else show(phone, pp, `translate3d(${(1 - pp) * 500 - away * W * 1.25}px,${(1 - pp) * 200}px,${(1 - pp) * -300}px) rotateY(${V ? 0 : -14 * pp}deg) rotateZ(${(1 - pp) * 8}deg)`);
      try { mf.contentWindow.scrollTo(0, Math.round(E.inOut(P(ls, B(o.pull) + .9, B(o.show) + .6)) * 900)); } catch (e) { /* not ready */ }
      rise(cap, ls - (B(o.pull) + .9), { ex: B(o.show) - B(o.pull) - 1.1, exDur: .35, blur: 4 });
      // showcase: other sites drift past in depth
      const sd = ls - B(o.show);
      if (sd < -.2) { strip.style.display = 'none'; hide(showCap); } else {
        strip.style.display = 'block';
        const travel = E.out(P(sd, -.2, 1.2)) * W * .9 + sd * 220;
        cards.forEach((c, i) => {
          const z = [-200, 60, -380, 0, -260, 100][i];
          const x = V ? W + 40 + i * 390 - travel * 1.3 : W + 80 + i * 470 - travel;
          const y = V ? 620 + [0, 90, -40, 70, 10, 100][i] : 250 + [0, 170, -30, 210, 40, 150][i];
          const a = E.out(P(sd, i * .08 - .2, i * .08 + .45));
          c.style.visibility = a > 0 ? 'visible' : 'hidden'; c.style.opacity = a * (1 - E.in(P(ls, end - .3, end)));
          c.style.transform = `translate3d(${x}px,${y + (1 - a) * 80}px,${z}px) rotateY(${V ? 0 : -8}deg)`;
        });
        rise(showCap, sd - .3, { blur: 4, ex: end - B(o.show) - .7, exDur: .35 });
      }
      G.sky = { inten: 1.05 + .2 * G.kick, cam: { tilt: .06 + .02 * Math.sin(ls * .3), pan: .35 + ls * .04 + away * .5, zoom: 1.03 } };
      if ((pull > 0 && pull < 1) || (away > 0 && away < 1)) G.mb = 4;
    };
  },

  // ---------------------------------------------------------------- JOB TWO: we look after it (systems + a human), dawn begins
  care(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const chip = add(r, '<div class="chip"><b>02</b>We look after it</div>', { fontSize: px(L(22, 28)), left: px(70), top: px(L(56, 230)) });
    const head = heading(r, V ? ['Then we', '*look after it.*'] : ['Then we *look after it.*'], { top: px(L(110, 320)), fontSize: px(L(92, 104)) });
    const clock = add(r, `<div class="chip"><b>${icon('moon')}</b><span>23:00</span></div>`, { fontSize: px(L(22, 28)), right: px(70), top: px(L(56, 230)) });
    clock.querySelector('b svg').style.cssText = 'width:58%;height:58%';
    const cols = V ? 2 : 3, cw = V ? 476 : 440, chh = V ? 250 : 200;
    const x0 = (W - (cols * cw + (cols - 1) * 34)) / 2, y0 = L(300, 600);
    const cards = TL.SYSTEMS.map(([tt, s, ic], i) => add(r, `<div class="sys"><div class="top"><div class="ic">${icon(ic)}</div><div><b>${tt}</b><small>${s}</small></div><div class="ok">${icon('check', '#fff', 3)}</div></div><div class="viz"></div></div>`,
      { width: px(cw), left: px(x0 + (i % cols) * (cw + 34)), top: px(y0 + Math.floor(i / cols) * (chh + 30)) }));
    const viz = cards.map((c) => c.querySelector('.viz'));
    viz[0].innerHTML = '<svg viewBox="0 0 340 44" preserveAspectRatio="none" style="width:100%;height:100%"><polyline fill="none" stroke="#6FE0B4" stroke-width="2.5" points=""/></svg>';
    viz[1].innerHTML = Array.from({ length: 7 }, (_, k) => `<i style="display:inline-block;width:34px;height:34px;margin-right:9px;border-radius:9px;background:rgba(255,255,255,.1);font:600 13px var(--mono);font-style:normal;color:#fff;text-align:center;line-height:34px">${'MTWTFSS'[k]}</i>`).join('');
    viz[2].innerHTML = '<div style="height:10px;border-radius:10px;background:rgba(255,255,255,.12);margin-top:16px;overflow:hidden"><div class="bar" style="height:100%;width:0;background:linear-gradient(90deg,#3DB88D,#0B86EA)"></div></div>';
    viz[3].innerHTML = '<div style="position:relative;height:40px;border-radius:10px;background:rgba(255,255,255,.07);overflow:hidden"><div class="scan" style="position:absolute;top:0;bottom:0;width:70px;background:linear-gradient(90deg,transparent,rgba(111,224,180,.6),transparent)"></div><span style="position:absolute;right:12px;top:9px;font:600 16px var(--mono)">0 threats</span></div>';
    viz[4].innerHTML = '<div style="font:600 17px var(--mono);color:#C9F5E4;padding-top:10px">https:// · renews every 90 days</div>';
    viz[5].innerHTML = '<div style="display:flex;align-items:baseline;gap:10px"><span style="font:800 40px var(--display);letter-spacing:-.04em">0.8s</span><span style="font:500 16px var(--body);color:#C5CBE6">page load</span></div>';
    const human = heading(r, V ? ['Need a change?', '*Email a human.*'] : ['Need a change? *Email a human.*'], { top: px(L(820, 1480)), fontSize: px(L(58, 72)) });
    const run1 = heading(r, V ? ['You run', 'your business.'] : ['You run your business.'], { top: px(L(350, 640)), fontSize: px(L(112, 118)) });
    const run2 = heading(r, V ? ['We run', 'your *website.*'] : ['We run your *website.*'], { top: px(L(490, 920)), fontSize: px(L(112, 118)) });
    sc.update = (ls, lb, G) => {
      const out = E.in(P(lb, o.run - .2, o.run));
      show(chip, E.out(P(ls, 0, .5)) * (1 - out));
      rise(head, ls, { blur: 6, ex: o.run * BAR - .5, exDur: .4 });
      const mins = Math.floor(lerp(23 * 60, 31 * 60, E.inOut(P(lb, 0, sc.len - .3))));
      clock.querySelector('span').textContent = `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      show(clock, E.out(P(ls, .2, .7)) * (1 - E.in(P(lb, sc.len - .3, sc.len))));
      cards.forEach((c, i) => {
        const dt = ls - o.cards[i] * BAR; if (dt < 0 || out >= 1) return hide(c);
        const p = E.out4(clamp(dt / .6));
        show(c, clamp(dt / .15) * (1 - out), `translateY(${(1 - p) * 50 - out * 40}px) scale(${lerp(.94, 1, p)})`, blurF((1 - p) * 8 + out * 10 + (lb >= o.human ? 2.5 : 0)));
        c.querySelector('.ok').style.transform = `scale(${E.back(clamp((dt - .2) / .3))})`;
      });
      viz[0].querySelector('polyline').setAttribute('points', Array.from({ length: 60 }, (_, k) => { const spike = Math.abs(((k + Math.floor(ls * 12)) % 15) - 7) < 1 ? -16 : 0; return `${(k * 340 / 59).toFixed(1)},${(22 + spike + Math.sin(k * .9 + ls * 3) * 2).toFixed(1)}`; }).join(' '));
      viz[1].querySelectorAll('i').forEach((d, k) => { d.style.background = ls - o.cards[1] * BAR - .3 - k * .12 > 0 ? 'linear-gradient(135deg,#3DB88D,#0B86EA)' : 'rgba(255,255,255,.1)'; });
      viz[2].querySelector('.bar').style.width = `${100 * E.inOut(P(ls - o.cards[2] * BAR, .2, 1.4))}%`;
      viz[3].querySelector('.scan').style.left = `${((ls * .8) % 1.2 - .1) * 100}%`;
      rise(human, ls - o.human * BAR, { blur: 4, ex: (o.run - o.human) * BAR - .45, exDur: .35 });
      rise(run1, ls - o.run * BAR, { blur: 6, st: .07 }); rise(run2, ls - o.runB * BAR, { blur: 6, st: .07 });
      const dawn = E.inOut(P(lb, .5, sc.len));
      G.sky = { inten: .95, speed: .7, dawn: dawn * .55, sunY: lerp(-.32, -.1, dawn), cam: { tilt: lerp(.04, -.08, E.inOut(P(lb, 0, sc.len))), pan: .9 + ls * .02, zoom: 1.02 } };
    };
  },

  // ---------------------------------------------------------------- PRICING: the gap, the plans, 95p a day, £299
  pricing(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const head = heading(r, ['The *gap.*'], { top: px(L(80, 330)), fontSize: px(L(124, 150)) });
    const sub = add(r, `<div class="sub c">Cheap and on your own, or brilliant at agency prices.</div>`, { top: px(L(230, 480)), fontSize: px(L(30, 34)), padding: '0 70px', whiteSpace: V ? 'normal' : 'nowrap' });
    const world = add(r, '<div class="abs" style="left:0;top:0;width:100%;height:100%"></div>');
    const span = 3 * W, ly = L(640, 1150);
    const line = add(world, '<div class="gapline"></div>', { left: px(0), width: px(span), top: px(ly) });
    const cardAt = (x, htmlS) => add(world, `<div class="gcard">${htmlS}</div>`, { left: px(x - 180), top: px(ly - 230) });
    const pinL = add(world, '<div class="pin"></div>', { left: px(span * .12), top: px(ly + 2) }), pinR = add(world, '<div class="pin"></div>', { left: px(span * .88), top: px(ly + 2) });
    const cL = cardAt(span * .12, '<b style="color:#FFB547">£3<span style="font-size:.45em">/mo</span></b><small>Cheap hosting. You’re on your own when it breaks.</small>');
    const cR = cardAt(span * .88, '<b style="color:#B9C0FF">£10,000+</b><small>An agency. Lovely work, eye-watering invoices.</small>');
    const pinM = add(world, '<div class="pin" style="background:#6FE0B4;box-shadow:0 0 0 10px rgba(111,224,180,.25),0 0 60px #6FE0B4"></div>', { left: px(span * .5), top: px(ly + 2) });
    const ring = add(world, '<div class="abs" style="width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid #6FE0B4"></div>', { left: px(span * .5), top: px(ly + 2) });
    const mw = L(640, 860);
    const cM = add(world, `<div class="gcard" style="width:${mw}px;text-align:center;border-color:rgba(111,224,180,.6);background:linear-gradient(160deg,rgba(61,184,141,.3),rgba(11,134,234,.25),rgba(63,77,230,.28))"><small style="font:600 18px var(--mono);letter-spacing:.14em;color:#C9F5E4;margin:0 0 8px">LRWEB CARE PLANS</small><b style="font-size:108px">from <span class="g">£<span class="num">29</span></span><span style="font-size:.3em;color:#C5CBE6">/month</span></b><small style="font-size:20px">Hosting, updates, backups, security and two real humans.</small></div>`,
      { left: px(span * .5 - mw / 2), top: px(ly - L(330, 370)) });
    const plans = TL.PLANS.map(([n, p, d, day], i) => add(r, `<div class="plan${i === 0 ? ' hi' : ''}"><div class="nm">${n}</div><div class="pr">£<span class="num">${p}</span><small>/month</small></div><p>${d}</p><div class="day">About ${day}</div></div>`));
    const note = add(r, '<div class="sub c">No contract. No VAT to add. Leave any time.</div>', { top: px(L(900, 1560)), fontSize: px(L(26, 30)) });
    const day = heading(r, V ? ['About *95p*', 'a day.'] : ['About *95p* a day.'], { top: px(L(360, 700)), fontSize: px(L(150, 150)) });
    const math = add(r, '<div class="sub c" style="font-family:var(--mono);color:#AEB5D6">£29 × 12 ÷ 365 = £0.95</div>', { top: px(L(560, 1060)), fontSize: px(L(28, 34)) });
    const b1 = heading(r, V ? ['Websites', 'from *£299.*'] : ['Websites from *£299.*'], { top: px(L(370, 680)), fontSize: px(L(130, 150)) });
    const b2 = add(r, '<div class="sub c">Fixed price, agreed in writing before we start.</div>', { top: px(L(550, 1040)), fontSize: px(L(34, 40)), padding: '0 60px', whiteSpace: V ? 'normal' : 'nowrap' });
    sc.update = (ls, lb, G) => {
      const B = (b) => b * BAR;
      rise(head, ls, { blur: 6, ex: B(o.plans[0]) - .6, exDur: .35 });
      const sp = E.out(P(ls, .3, .9)) * (1 - E.in(P(ls, B(o.plans[0]) - .6, B(o.plans[0]) - .25))); show(sub, sp, `translateY(${(1 - sp) * 16}px)`);
      const toL = E.inOut5(P(ls, B(o.left) - .5, B(o.left) + .15)), toR = E.inOut5(P(ls, B(o.right) - .45, B(o.right) + .1)), toM = E.inOut5(P(ls, B(o.land) - .45, B(o.land) + .05));
      const camX = lerp(lerp(lerp(span * .5, span * .12, toL), span * .88, toR), span * .5, toM);
      const wOut = E.in(P(ls, B(o.plans[0]) - .5, B(o.plans[0]) - .1));
      world.style.transform = `translateX(${W / 2 - camX}px) translateY(${wOut * 120}px)`; world.style.opacity = 1 - wOut; world.style.filter = blurF(wOut * 10);
      show(line, E.out(P(ls, .1, .7))); line.style.transform = `scaleX(${E.out(P(ls, .1, .9))})`;
      const cl = E.out4(P(ls, B(o.left) - .1, B(o.left) + .35)); show(cL, cl, `translateY(${(1 - cl) * 30}px)`); show(pinL, cl);
      const cr = E.out4(P(ls, B(o.right) - .1, B(o.right) + .35)); show(cR, cr, `translateY(${(1 - cr) * 30}px)`); show(pinR, cr);
      const ld = ls - B(o.land);
      if (ld < -.3) { hide(pinM); hide(cM); hide(ring); } else {
        show(pinM, 1, `translateY(${(1 - E.out(clamp((ld + .3) / .3))) * -300}px)`);
        const rp = clamp(ld / .7); show(ring, ld > 0 ? 1 - rp : 0, `scale(${1 + rp * 12})`);
        const cm = E.back(clamp(ld / .45)); show(cM, clamp(ld / .15), `translateY(${(1 - cm) * 40}px) scale(${lerp(.85, 1, cm)})`);
        cM.querySelector('.num').textContent = Math.round(29 * E.out(clamp(ld / .5)));
      }
      if ((toL > 0 && toL < 1) || (toR > 0 && toR < 1) || (toM > 0 && toM < 1)) G.mb = 5;
      const pOut = E.in(P(ls, B(o.day) - .4, B(o.day) - .05));
      plans.forEach((pl, i) => {
        const dt = ls - B(o.plans[i]); if (dt < 0 || pOut >= 1) return hide(pl);
        const p = E.out4(clamp(dt / .6));
        if (V) Object.assign(pl.style, { width: '640px', left: px((W - 640) / 2), top: px(420 + i * 300), padding: '22px 30px' });
        else Object.assign(pl.style, { left: px(W / 2 - 190 + (i - 1) * 430), top: px(270) });
        show(pl, clamp(dt / .15) * (1 - pOut), `translateY(${(1 - p) * 140 + pOut * 60}px) rotate(${(1 - p) * (i - 1) * 8}deg) scale(${(i === 0 && !V ? 1.04 : 1) * lerp(.9, 1, p)})`, blurF(pOut * 10));
        pl.querySelector('.num').textContent = Math.round(TL.PLANS[i][1] * E.out(clamp(dt / .5)));
      });
      show(note, E.out(P(ls, B(o.plans[2]) + .3, B(o.plans[2]) + .7)) * (1 - pOut));
      rise(day, ls - B(o.day), { blur: 6, ex: B(o.build) - B(o.day) - .45, exDur: .35 });
      show(math, E.out(P(ls, B(o.day) + .5, B(o.day) + .9)) * (1 - E.in(P(ls, B(o.build) - .45, B(o.build) - .1))));
      rise(b1, ls - B(o.build), { blur: 6 }); const bp = E.out(P(ls, B(o.build) + .4, B(o.build) + .8)); show(b2, bp, `translateY(${(1 - bp) * 16}px)`);
      G.sky = { inten: 1.1 + .3 * G.kick, dawn: .15, sunY: -.4, cam: { tilt: .08, pan: 1.3 + (camX / span - .5) * .6 + ls * .02, zoom: 1.03 } };
    };
  },

  // ---------------------------------------------------------------- HUMANS: Luke & Ralph
  humans(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const lines = [['No call centre.'], ['No chatbot.'], ['Just *Luke & Ralph.*']].map((ln, i) => heading(r, ln,
      V ? { top: px(300 + i * 150), fontSize: px(i === 2 ? 110 : 100) } : { left: px(110), top: px(160 + i * 150), fontSize: px(i === 2 ? 112 : 96) }, V ? 'h c soft' : 'h soft'));
    lines.slice(0, 2).forEach((l) => Object.assign(l.firstChild.style, { position: 'relative', display: 'inline-block' }));
    const strikes = lines.slice(0, 2).map((l) => add(l.firstChild, '<div class="strike"></div>'));
    const avR = add(r, `<div class="av"><div class="c" style="background:linear-gradient(135deg,#3DB88D,#0B86EA)">R</div><div><b>Ralph</b><small>HUNGERFORD &amp; KINTBURY</small></div></div>`, V ? { left: px(80), top: px(830) } : { left: px(110), top: px(700) });
    const avL = add(r, `<div class="av"><div class="c" style="background:linear-gradient(135deg,#0B86EA,#3F4DE6)">L</div><div><b>Luke</b><small>WOKINGHAM</small></div></div>`, V ? { left: px(600), top: px(830) } : { left: px(590), top: px(700) });
    const bq = add(r, '<div class="bub q"><small>A client · 09:02</small>Can you change our Saturday hours to 9 till 1?</div>', V ? { left: px(70), top: px(1030), width: px(760), maxWidth: 'none', fontSize: '30px' } : { left: px(1140), top: px(300), width: px(560) });
    const ba = add(r, '<div class="bub a"><small>Luke · 09:06</small>Done! It’s live now. Anything else?</div>', V ? { right: px(70), top: px(1230), width: px(700), maxWidth: 'none', fontSize: '30px' } : { right: px(120), top: px(500), width: px(520) });
    sc.update = (ls, lb, G) => {
      lines.forEach((l, i) => rise(l, ls - o.lines[i] * BAR, { blur: 5 }));
      strikes.forEach((s, i) => { const d = ls - o.lines[i] * BAR - .3; s.style.transform = `scaleX(${E.out4(clamp(d / .25))})`; if (d > 0) lines[i].style.opacity = lerp(1, .5, clamp(d / .3)); });
      const a1 = E.back(P(ls, o.lines[2] * BAR + .3, o.lines[2] * BAR + .75)), a2 = E.back(P(ls, o.lines[2] * BAR + .45, o.lines[2] * BAR + .9));
      show(avR, clamp(a1 * 2), `scale(${a1})`); show(avL, clamp(a2 * 2), `scale(${a2})`);
      const q = E.back(clamp((ls - o.q * BAR) / .4)); if (ls < o.q * BAR) hide(bq); else show(bq, clamp(q * 2), `translateY(${(1 - q) * 30}px) scale(${lerp(.85, 1, q)})`);
      const a = E.back(clamp((ls - o.a * BAR) / .4)); if (ls < o.a * BAR) hide(ba); else show(ba, clamp(a * 2), `translateY(${(1 - a) * 30}px) scale(${lerp(.85, 1, a)})`);
      const ex = E.in(P(lb, sc.len - .12, sc.len)); r.style.opacity = 1 - ex; r.style.filter = blurF(ex * 12);
      G.sky = { inten: 1 + .25 * G.kick, dawn: .3, sunY: -.3, cam: { tilt: .02, pan: 1.9 + ls * .03, zoom: 1.02 } };
    };
  },

  // ---------------------------------------------------------------- END: sunrise, logo, lrweb.uk
  end(sc) {
    const r = (sc.root = mkRoot()), o = sc.o;
    const lg = add(r, logoHTML(), { fontSize: px(L(150, 190)) });
    if (V) Object.assign(lg.style, { flexDirection: 'column', gap: '.18em', left: 0, right: 0, top: px(330) }); else Object.assign(lg.style, { left: 0, right: 0, justifyContent: 'center', top: px(150) });
    const tag = heading(r, V ? ['We build it.', 'Then we *look after it.*'] : ['We build it. Then we *look after it.*'], { top: px(L(400, 840)), fontSize: px(L(76, 84)) });
    const pill = add(r, '<div class="pill">lrweb.uk</div>', { fontSize: px(L(64, 76)) });
    const fine = add(r, `<div class="fine">${V ? 'Websites from £299<br>Care from £29/month<br>hello@lrweb.uk' : 'Websites from £299  ·  Care from £29/month  ·  hello@lrweb.uk'}</div>`, { top: px(L(640, 1260)), fontSize: px(L(24, 32)), lineHeight: 1.6 });
    sc.update = (ls, lb, G) => {
      G.sky = { dawn: lerp(.45, 1, E.inOut(P(lb, 0, 1.2))), sunY: lerp(-.16, .03, E.out(P(lb, 0, sc.len + .25))), inten: .9, speed: .6, stars: .5,
        cam: { tilt: lerp(.08, -.06, E.inOut(P(lb, 0, sc.len))), pan: 2.3 + ls * .015, zoom: lerp(1.06, 1, E.out(P(lb, 0, sc.len))) } };
      const ld = ls - o.logo * BAR;
      show(lg, 1, `scale(${1 + .02 * E.out(P(ld, 0, 4))})`); animLogo(lg, ld, .3);
      rise(tag, ls - o.tag * BAR, { blur: 5 });
      const pw = pill.offsetWidth; Object.assign(pill.style, { left: px((W - pw) / 2), top: px(L(510, 1090)) });
      const up = E.back(clamp((ls - o.url * BAR) / .45)); if (ls < o.url * BAR) hide(pill); else show(pill, clamp(up * 2), `scale(${lerp(.6, 1, up)})`);
      const fp = E.out(P(ls, o.fine * BAR, o.fine * BAR + .5)); show(fine, fp, `translateY(${(1 - fp) * 14}px)`);
    };
  },
};

for (const [name, s, len, o] of EDIT.scenes) { const sc = { name, s, len, o, root: null }; scenes.push(sc); builders[name](sc); }

// ------------------------------------------------------------------ the Crumb & Kiln site building itself (inside the iframe)
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
  crumbEls.forEach((e, i) => {
    const t0 = clamp(e._y / viewH, 0, 1.1) * dur * .9 + (e._k === 'pop' ? .15 : 0);
    const p = dt < 0 ? 0 : E.out4(clamp((dt - t0) / .55));
    const tf = e._k === 'pop' ? `scale(${lerp(.6, 1, E.back(clamp((dt - t0) / .6)))})` : `translateY(${(1 - p) * 34}px)`;
    e.style.setProperty('opacity', String(p), 'important'); e.style.setProperty('transform', p >= 1 ? 'none' : tf, 'important');
    if (e._k !== 'pop') e.style.setProperty('filter', p < 1 ? `blur(${((1 - p) * 6).toFixed(1)}px)` : 'none', 'important');
  });
}

// ------------------------------------------------------------------ overlays
// film grain is added at encode time (ffmpeg), the vignette lives in the sky shader
function registerBursts() {
  const t0 = scenes.find((s) => s.name === 'drop').s * BAR;
  [...shared.notes, ...shared.extra, ...shared.dlgs].forEach((n, i) => burst(t0 + passT(n._p[0] + 200), n._p[0], n._p[1], 420, 110, 26, i * 13.7));
  burst(t0 + passT(W * .4), W * .15, L(440, 780), W * .7, 180, 110, 999);
}

// ------------------------------------------------------------------ render
let sky = null;
function render(t) {
  const bar = t / BAR;
  const G = { t, kick: env(t, KICKS, .12), flash: .32 * env(t, BIG, .1) + .12 * env(t, LANDS, .08), mb: 1, sky: {} };
  let active = scenes[0];
  for (const sc of scenes) if (bar >= sc.s - (sc.pre || 0) / BAR) active = sc;
  for (const sc of scenes) if (sc.root !== active.root) sc.root.style.display = 'none';
  active.root.style.display = 'block';
  const lb = bar - active.s; active.update(lb * BAR, lb, G);
  drawParticles(t);
  if (sky) sky.render(t, G.sky);
  $('#flash').style.opacity = G.flash;
  $('#black').style.opacity = Math.max(1 - P(t, 0, .5), P(t, EDIT.end - 1.0, EDIT.end - .05));
  return G.mb;
}

window.seek = (t) => render(t); // WebGL uses preserveDrawingBuffer + finish(); the screenshot waits for the next frame itself
window.EDIT = EDIT;
window.ready = (async () => {
  await document.fonts.ready;
  await Promise.all([document.fonts.load('800 100px "Bricolage Grotesque"'), document.fonts.load('700 100px "Bricolage Grotesque"'), document.fonts.load('500 20px "IBM Plex Mono"'), document.fonts.load('600 20px "Instrument Sans"')]);
  const frames = [...document.querySelectorAll('iframe')];
  await Promise.all(frames.map((f) => new Promise((res) => { const done = () => { try { prepCrumb(f.contentDocument); } catch (e) { /* cross-origin in odd setups */ } res(); };
    if (f.contentDocument && f.contentDocument.readyState === 'complete' && f.contentDocument.body) done(); else f.addEventListener('load', done, { once: true }); })));
  await Promise.all(frames.map((f) => f.contentDocument?.fonts?.ready));
  await Promise.all([...document.images].map((i) => i.decode().catch(() => 0)));
  sky = new Aurora($('#sky'), W, H, DPR, +(Q.get('sky') || 1)); // sky resolution factor (render.mjs uses .66 on CPU)
  scenes.forEach((s) => (s.root.style.display = 'block')); registerBursts(); scenes.forEach((s) => (s.root.style.display = 'none'));
  render(0);
  return true;
})();
if (Q.has('t')) window.ready.then(() => render(+Q.get('t')));
if (Q.has('play')) {
  const a = new Audio(`soundtrack-${EDIT.name}.wav`);
  document.addEventListener('click', () => { a.currentTime = +(Q.get('from') || 0); a.play(); const loop = () => { render(a.currentTime); if (!a.paused) requestAnimationFrame(loop); }; loop(); });
}
