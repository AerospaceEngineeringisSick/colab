/* LRWeb Console: practice mockup. Vanilla JS, no libraries, no network. Everything here is pretend.
 * LB (web/js/lib/lb-algorithms.js) and LRCrypto (web/js/chat/crypto.js) are the real shared code, inlined by
 * tools/build-mockup.mjs. Nothing in this file talks to a server, and nothing is sent anywhere. */
(() => {
  'use strict';

  /* ================= helpers ================= */

  const root = document.documentElement;
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const NS = 'http://www.w3.org/2000/svg';
  const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');
  const KEY = { theme: 'lrweb.mock.theme', fx: 'lrweb.mock.fx', progress: 'lrweb.mock.progress', votes: 'lrweb.mock.votes' };
  const GBP = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
  const COUNT = new Intl.NumberFormat('en-GB');
  const percent = (x) => `${Math.round(x * 100)}%`;
  const NAMES = { luke: 'Luke', ralph: 'Ralph' };
  const PREFS = { blur: false, disappear: false };
  const hasCrypto = () => Boolean(globalThis.crypto && globalThis.crypto.subtle) && typeof LRCrypto === 'object';

  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false || k === true) continue;
      if (Array.isArray(k)) append(el, k);
      else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  /* Tiny hyperscript: children are text nodes or nodes, never parsed as HTML. */
  function h(tag, props, ...kids) {
    const isProps = props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props);
    if (!isProps) kids.unshift(props);
    const el = document.createElement(tag);
    const late = [];
    for (const [k, v] of Object.entries(isProps ? props : {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', [].concat(v).filter(Boolean).join(' '));
      else if (k === 'style') {
        for (const [p, val] of Object.entries(v)) (p.startsWith('--') ? el.style.setProperty(p, val) : (el.style[p] = val));
      } else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked') late.push(() => { el[k] = v; });
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    append(el, kids);
    late.forEach((fn) => fn());
    return el;
  }

  function svg(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
    append(el, kids);
    return el;
  }

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    external: '<path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h8M8 13h5"/>',
    swap: '<path d="m8 3-4 4 4 4M4 7h16M16 21l4-4-4-4M20 17H4"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
    bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    'thumbs-up': '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
    'thumbs-down': '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  };

  function icon(name, size = 20) {
    const el = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'icon' });
    el.innerHTML = ICONS[name] ?? ICONS.info; // static markup from the table above, never user data
    return el;
  }

  /** button({ variant, size, icon, cls, ...handlers }, ...label) */
  function button({ variant = 'glass', size = 'md', icon: ic, cls, ...rest } = {}, ...label) {
    return h('button', { type: 'button', class: ['btn', `btn--${variant}`, `btn--${size}`, cls], ...rest },
      ic && icon(ic, size === 'sm' ? 16 : 18),
      label.length ? h('span', { class: 'btn__label' }, ...label) : null);
  }

  const badge = (kind, text) => h('span', { class: ['badge', `badge--${kind}`] }, h('i', { class: 'badge__dot' }), text);

  function card(title, sub, ...kids) {
    return h('section', { class: 'glass card' },
      (title || sub) && h('header', { class: 'card__head' },
        h('div', {}, title && h('h2', { class: 'card__title' }, title), sub && h('p', { class: 'card__sub muted' }, sub))),
      ...kids);
  }

  const pageHead = (title, subtitle) => h('header', { class: 'page-head' },
    h('div', { class: 'page-head__text' }, h('h1', {}, title), subtitle && h('p', { class: 'muted' }, subtitle)));

  function statTile(label, value, hint) {
    return h('div', { class: 'glass stat' },
      h('div', { class: 'stat__top' }, h('span', { class: 'stat__label' }, label)),
      h('div', { class: 'stat__value num' }, value),
      h('div', { class: 'stat__foot' }, hint && h('span', { class: 'muted stat__hint' }, hint)));
  }

  function ring(value, label) {
    const r = 42;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, value));
    const wrap = h('div', { class: 'ring ring--ok', style: { width: '104px', height: '104px' }, role: 'img', 'aria-label': `${label} missions done` });
    wrap.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring__bg" cx="50" cy="50" r="${r}"/><circle class="ring__fg" cx="50" cy="50" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - v / 100)).toFixed(1)}"/></svg>`;
    wrap.append(h('div', { class: 'ring__text' }, h('strong', { class: 'num' }, label)));
    return wrap;
  }

  function toggle(label, checked, onchange) {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch__input', checked, onchange: (e) => onchange(e.target.checked) });
    return h('label', { class: 'switch' }, input, h('span', { class: 'switch__track' }, h('i')), h('span', { class: 'switch__label' }, label));
  }

  /** Runs an async handler and turns any failure into a friendly toast instead of an unhandled error. */
  const safe = (fn) => (...args) => { Promise.resolve().then(() => fn(...args)).catch((e) => toast('Something went wrong', e?.message || String(e), 'bad')); };

  function toast(title, message, kind = 'info') {
    const el = h('div', { class: ['glass glass--thick toast', `toast--${kind}`], role: 'status' },
      h('span', { class: 'toast__icon' }, icon(kind === 'bad' ? 'alert' : kind === 'warn' ? 'info' : 'check', 16)),
      h('div', { class: 'toast__body' }, h('strong', {}, title), message ? h('p', {}, message) : null));
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 240); }, 4200);
  }

  function copyBlock(text, label) {
    const code = h('code', {}, text);
    const btn = button({ size: 'sm', variant: 'glass', icon: 'copy', onclick: async () => {
      try {
        await navigator.clipboard.writeText(text);
        btn.querySelector('.btn__label').textContent = 'Copied';
        setTimeout(() => { btn.querySelector('.btn__label').textContent = 'Copy'; }, 1600);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(code);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        toast('Press Ctrl or Cmd and C', 'The text is selected, so you can copy it by hand.', 'info');
      }
    } }, 'Copy');
    return h('div', { class: 'copyblock' },
      h('div', { class: 'copyblock__bar' }, h('span', { class: 'muted' }, label), btn),
      h('pre', { tabindex: 0, style: { maxHeight: '320px' } }, code));
  }

  function readStore(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); } catch { return fallback; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: the practice still works, it just forgets */ }
  }
  function writeRaw(key, value) {
    try { localStorage.setItem(key, value); } catch { /* storage blocked */ }
  }

  /* ================= motion: animation only while it is safe ================= */

  const motionListeners = new Set();
  const motionOK = () => !document.hidden && !reduceMq.matches && root.dataset.fx !== 'lite';
  function onMotion(fn) { motionListeners.add(fn); return () => motionListeners.delete(fn); }
  function motionChanged() {
    document.body.classList.toggle('is-hidden', document.hidden);
    document.body.classList.toggle('is-blurred', document.hidden && PREFS.blur);
    for (const fn of [...motionListeners]) fn(motionOK());
  }
  document.addEventListener('visibilitychange', motionChanged);
  reduceMq.addEventListener('change', motionChanged);

  /** Steps that move on by themselves while motion is safe, or one click at a time (Next step) when it is not. */
  class Runner {
    constructor(steps, { delay = 800, onStep } = {}) {
      this.steps = steps; this.i = 0; this.delay = delay; this.onStep = onStep;
      this.timer = 0; this.cancelled = false; this.done = false;
    }
    get active() { return !this.cancelled && !this.done; }
    get waiting() { return this.active && this.i > 0 && !motionOK(); }
    next() {
      if (!this.active || this.i >= this.steps.length) return;
      clearTimeout(this.timer);
      const idx = this.i;
      this.i += 1;
      this.steps[idx].run();
      if (this.cancelled) return;
      if (this.i >= this.steps.length) this.done = true;
      this.onStep?.(idx);
      if (!this.done && motionOK()) this.timer = setTimeout(() => this.next(), this.delay);
    }
    cancel() { this.cancelled = true; clearTimeout(this.timer); }
  }

  /* ================= glossary: plain-English tooltips ================= */

  const GLOSSARY = {
    'load balancer': 'A traffic director. It spreads visitors across several servers and skips any server that is down.',
    standby: 'A spare server. It only takes visitors when no main server is both up and taking visits.',
    'health check': 'A quick, regular test that asks each server "are you OK?". A server that fails it is skipped.',
    weight: 'How big a share of visits a server gets. Weight 3 gets three visits for every one that weight 1 gets.',
    'round robin': 'Taking turns: server 1, then 2, then 3, then back to 1.',
    draining: 'Sending a server no new visitors while it finishes what it is doing, so you can safely work on it.',
    cutover: 'The moment visitors start going to the new server instead of the old one.',
    dns: "The internet's address book. It tells browsers which server a web address lives on.",
    padlock: 'The padlock in the browser. It scrambles traffic between a visitor and the site so nobody can snoop.',
    runbook: 'A step-by-step list of commands, in order.',
    nginx: 'The software on a server that receives visitors and hands them to the right website.',
    'end-to-end encryption': "Messages are scrambled on the sender's device and only unscrambled on the other person's device. The server cannot read them.",
    ciphertext: 'The scrambled version of a message. Without the right key it is just random letters.',
    signature: 'A tamper seal. If even one letter changes, the seal breaks and the message is refused.',
    passphrase: 'Your secret vault password. It never leaves your device, and the server cannot reset it.',
    vault: 'Locked storage for your chat keys and message history on this device. Your passphrase opens it.',
    'safety number': "A long number made from both people's keys. If both screens show the same number, nobody is in the middle.",
    'key rotation': 'Swapping the chat lock for a fresh one every few days, so old messages stay safe if a key is ever stolen.',
    pbkdf2: 'A deliberately slow way to turn a passphrase into a key, so guessing passphrases takes far longer.',
    'care plan': "LRWeb's monthly plan: hosting, updates, backups, security and real people to help.",
    simulated: 'This is practice data. Nothing is being changed on any real server.',
  };

  let tipEl = null;
  let tipTimer = 0;
  let tipSeq = 0;
  function hideTip() { clearTimeout(tipTimer); tipEl?.remove(); tipEl = null; }
  function showTip(anchor, text) {
    hideTip();
    tipEl = h('div', { class: 'glass glass--thick term-tip', role: 'tooltip' }, text);
    document.body.append(tipEl);
    const r = anchor.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + tipEl.offsetHeight < innerHeight;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - tipEl.offsetHeight)}px`;
  }
  /** Term('load balancer') or Term('load balancer', 'traffic director'): a dotted term with a plain-English tip. */
  function Term(key, label) {
    const text = GLOSSARY[key.toLowerCase()];
    if (!text) return document.createTextNode(label ?? key);
    const id = `tip-${++tipSeq}`;
    const el = h('button', {
      type: 'button', class: 'term',
      onmouseenter: () => { showTip(el, text); el.setAttribute('aria-describedby', id); },
      onmouseleave: () => { tipTimer = setTimeout(hideTip, 120); },
      onfocus: () => { showTip(el, text); el.setAttribute('aria-describedby', id); },
      onblur: hideTip,
      onclick: (e) => { e.preventDefault(); if (tipEl) hideTip(); else showTip(el, text); },
      onkeydown: (e) => { if (e.key === 'Escape') hideTip(); },
    }, label ?? key);
    return el;
  }
  addEventListener('scroll', hideTip, { passive: true, capture: true });
  addEventListener('resize', hideTip);

  /* ================= missions and progress ================= */

  const MISSIONS = [
    { id: 'm1', title: 'Try all five ways of sharing visitors', page: 'traffic', where: 'Traffic lab' },
    { id: 'm2', title: 'Pretend a server goes down and watch the spare take over', page: 'traffic', where: 'Traffic lab' },
    { id: 'm3', title: 'Switch visitors to another server gradually', page: 'traffic', where: 'Traffic lab' },
    { id: 'm4', title: 'Set up the chat vault and send Ralph a message', page: 'chat', where: 'Secure chat' },
    { id: 'm5', title: 'Compare safety numbers', page: 'chat', where: 'Secure chat' },
    { id: 'm6', title: 'Catch a tampered message', page: 'chat', where: 'Secure chat' },
    { id: 'm7', title: 'Spot the swapped key', page: 'chat', where: 'Secure chat' },
  ];
  const P = { done: {}, algos: [] };
  const missionSlots = new Set();

  function loadProgress() {
    const s = readStore(KEY.progress, {});
    P.done = s && typeof s.done === 'object' && s.done ? s.done : {};
    P.algos = Array.isArray(s?.algos) ? s.algos.filter((id) => LB.ALGORITHMS.some((a) => a.id === id)) : [];
  }
  const saveProgress = () => writeStore(KEY.progress, { done: P.done, algos: P.algos });
  const isDone = (id) => (id === 'm1' ? P.algos.length === LB.ALGORITHMS.length || Boolean(P.done.m1) : Boolean(P.done[id]));
  function paintMissions() { for (const slot of missionSlots) slot.render(); }
  function complete(id) {
    if (isDone(id)) return;
    P.done[id] = true;
    saveProgress();
    toast('Mission complete', MISSIONS.find((m) => m.id === id).title, 'ok');
    paintMissions();
  }
  function tryAlgorithm(id) {
    if (!P.algos.includes(id)) { P.algos.push(id); saveProgress(); }
    if (P.algos.length === LB.ALGORITHMS.length) complete('m1');
    else paintMissions();
  }

  /* ================= 1. Traffic lab ================= */

  const ADDRESS = { ldn: '203.0.113.11:80', man: '203.0.113.12:80', dub: '203.0.113.13:80', spare: '203.0.113.14:80' };
  const seedMembers = () => [
    { id: 'ldn', name: 'ldn-web-01', place: 'London', weight: 3, role: 'active', healthy: true, count: 0 },
    { id: 'man', name: 'man-web-01', place: 'Manchester', weight: 2, role: 'active', healthy: true, count: 0 },
    { id: 'dub', name: 'dub-web-01', place: 'Dublin', weight: 1, role: 'active', healthy: true, count: 0 },
    { id: 'spare', name: 'spare-01', place: 'Standby', weight: 1, role: 'standby', healthy: true, count: 0 },
  ];
  const newTraffic = () => ({
    algo: 'weighted', rate: 6, running: true, total: 0, dropped: 0, members: seedMembers(), bal: null, inflight: [],
    move: null, moveTarget: 'man', moveMode: 'gradual', moveMsg: null, drill: null, drillLog: [], view: null,
  });
  let TR = newTraffic();

  const member = (id) => TR.members.find((m) => m.id === id);
  const mainsUp = () => TR.members.filter((m) => m.role === 'active' && m.healthy).length;
  const lbMembers = () => TR.members.map((m) => ({ id: m.id, weight: m.weight, role: m.role, healthy: m.healthy }));
  const algoLabel = (id) => LB.ALGORITHMS.find((a) => a.id === id)?.label ?? id;

  function syncBalancer() {
    if (!TR.bal) TR.bal = LB.createBalancer({ algorithm: TR.algo, members: lbMembers(), sticky: false });
    else TR.bal.setMembers(lbMembers());
    if (TR.move) buildMoveBalancers();
  }

  function nodeState(m) {
    if (!m.healthy) return 'Down';
    if (m.role === 'drain') return 'Paused: no new visits';
    if (m.role === 'standby') return mainsUp() ? 'Spare: waiting' : 'Spare: taking over';
    if (TR.move && TR.move.target === m.id) return 'Taking visits (moving over)';
    return 'Taking visits';
  }
  const roleText = (m) => (m.role === 'standby' ? 'Spare (standby)' : m.role === 'drain' ? 'Main, paused' : 'Main');

  /** Picks the server for one visit. During a gradual move, a weighted split sends the chosen share to the new server. */
  function pickFor(ip) {
    const mv = TR.move;
    if (!mv) {
      const id = TR.bal.pick({ ip });
      if (id) track(TR.bal, id);
      return id;
    }
    if (mv.split.pick() === 'to') return mv.target;
    const id = mv.rest.pick({ ip });
    if (id) { track(mv.rest, id); return id; }
    return member(mv.target).healthy ? mv.target : null;
  }
  function track(bal, id) {
    TR.inflight.push({ bal, id });
    if (TR.inflight.length > 8) { const old = TR.inflight.shift(); old.bal.done(old.id); }
  }

  function visitOnce() {
    const ip = `198.51.${1 + Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}`;
    const id = pickFor(ip);
    if (!id) { TR.dropped += 1; return null; }
    member(id).count += 1;
    TR.total += 1;
    if (id === 'spare') complete('m2');
    return id;
  }

  function buildMoveBalancers() {
    const mv = TR.move;
    const target = member(mv.target);
    const rest = TR.members.filter((m) => m.id !== mv.target);
    const restUp = rest.some((m) => m.healthy && (m.role === 'active' || m.role === 'standby'));
    const pct = Math.round(mv.fraction * 100);
    mv.split = LB.createBalancer({ algorithm: 'weighted', members: [
      { id: 'to', weight: Math.max(1, pct), role: 'active', healthy: target.healthy },
      { id: 'rest', weight: Math.max(1, 100 - pct), role: 'active', healthy: restUp },
    ] });
    mv.rest = LB.createBalancer({ algorithm: TR.algo, members: rest.map((m) => ({ id: m.id, weight: m.weight, role: m.role, healthy: m.healthy })) });
  }

  function setMoveMsg(text, tone = 'info') {
    TR.moveMsg = { text, tone };
    if (TR.view) paintTraffic();
  }

  function preflight(target) {
    if (!target.healthy) return { ok: false, text: `Not moved. ${target.name} is down, so it cannot take visitors. Visitors stay where they are.` };
    return { ok: true, text: `${target.name} passed its health check (simulated).` };
  }

  function startMove(targetId, mode) {
    if (TR.move?.runner?.active) return setMoveMsg('A move is already running. Let it finish first.', 'warn');
    const target = member(targetId);
    const pf = preflight(target);
    if (!pf.ok) return setMoveMsg(pf.text, 'bad');
    if (mode === 'instant') return finishMove(targetId, false);
    const mv = { target: targetId, fraction: 0, applied: 0, split: null, rest: null, runner: null };
    TR.move = mv;
    TR.lastGradual = false;
    buildMoveBalancers(); // so visits that arrive before the first step still have a split to use
    const abort = (text) => { mv.runner?.cancel(); TR.move = null; setMoveMsg(text, 'bad'); };
    const steps = [0.1, 0.25, 0.5].map((f) => ({ run: () => {
      if (!member(targetId).healthy) return abort(`Move stopped. ${target.name} went down, so visitors stay on the main servers.`);
      mv.fraction = f;
      mv.applied += 1;
      buildMoveBalancers();
      return undefined;
    } }));
    steps.push({ run: () => { if (TR.move === mv) { mv.applied += 1; finishMove(targetId, true); } } });
    mv.runner = new Runner(steps, { delay: 1500, onStep: () => paintTraffic() });
    setMoveMsg(`Moving visitors to ${target.name} in steps: 10%, 25%, 50%, then all of them.`, 'info');
    mv.runner.next();
    paintTraffic();
    return undefined;
  }

  function finishMove(targetId, gradual) {
    TR.move?.runner?.cancel();
    TR.move = null;
    for (const m of TR.members) {
      if (m.id === 'spare') continue;
      if (m.id === targetId) m.role = 'active';
      else if (m.role === 'active') m.role = 'drain';
    }
    if (targetId === 'spare') member('spare').role = 'active';
    syncBalancer();
    if (gradual) complete('m3');
    TR.lastGradual = gradual;
    const name = member(targetId).name;
    setMoveMsg(`Done. ${name} now takes the visits. The other main servers stop taking new visits, so you can work on them safely.`, 'ok');
    toast('Visitors moved (simulated)', name, 'ok');
    paintTraffic();
  }

  function chooseAlgorithm(id) {
    if (id !== TR.algo) { TR.algo = id; TR.bal = null; syncBalancer(); }
    tryAlgorithm(id);
    paintTraffic();
  }

  function setWeight(id, w) { member(id).weight = w; syncBalancer(); paintTraffic(); }
  function toggleHealth(id) { const m = member(id); m.healthy = !m.healthy; syncBalancer(); paintTraffic(); }
  function togglePause(id) { const m = member(id); m.role = m.role === 'drain' ? 'active' : 'drain'; syncBalancer(); paintTraffic(); }
  function bringAllBack() {
    TR.move?.runner?.cancel();
    TR.move = null;
    for (const m of TR.members) { m.healthy = true; if (m.id !== 'spare') m.role = 'active'; }
    member('spare').role = 'standby';
    syncBalancer();
    setMoveMsg('Everything is back on and taking visits (simulated).', 'ok');
    paintTraffic();
  }
  function resetCounts() {
    TR.total = 0; TR.dropped = 0;
    for (const m of TR.members) m.count = 0;
    paintTraffic();
  }

  function startDrill() {
    if (TR.drill?.active) return;
    TR.drillLog = [];
    const killed = [];
    let got = 0;
    const log = (t) => { TR.drillLog.push(t); };
    const steps = [
      { run: () => {
        for (const m of TR.members) if (m.id !== 'spare' && m.healthy) { m.healthy = false; killed.push(m.id); }
        syncBalancer();
        log(`Switched off ${killed.length} main servers (simulated). Nothing real went down.`);
      } },
      { run: () => {
        const before = member('spare').count;
        for (let i = 0; i < 40; i += 1) visitOnce();
        got = member('spare').count - before;
        log(`Sent 40 test visits. The spare took ${got}.`);
      } },
      { run: () => log(got > 0 ? 'Result: the spare took over, as it should.' : 'Result: the spare did not take over. Check the setup.') },
      { run: () => {
        for (const id of killed) member(id).healthy = true;
        syncBalancer();
        log('Switched the main servers back on.');
      } },
      { run: () => {
        const before = member('spare').count;
        for (let i = 0; i < 40; i += 1) visitOnce();
        const again = member('spare').count - before;
        log(again === 0 ? 'Sent 40 more visits. The spare took none, so it is waiting again.' : `Sent 40 more visits. The spare took ${again}, which is unexpected.`);
      } },
      { run: () => log('Drill finished.') },
    ];
    TR.drill = new Runner(steps, { delay: 800, onStep: () => paintTraffic() });
    TR.drill.next();
    paintTraffic();
  }

  /* live map frame loop: only while motion is safe and the lab is on screen */
  function shouldAnimate() { return Boolean(TR.view) && TR.running && motionOK(); }
  function syncLoop() {
    const v = TR.view;
    if (!v) return;
    if (shouldAnimate()) {
      if (!v.raf) { v.lastT = 0; v.raf = requestAnimationFrame(frame); }
    } else {
      cancelAnimationFrame(v.raf);
      v.raf = 0;
      for (const d of v.dots) d.el.remove();
      v.dots = [];
    }
  }
  function frame(t) {
    const v = TR.view;
    if (!v) return;
    v.raf = 0;
    if (!shouldAnimate()) { syncLoop(); return; }
    const dt = v.lastT ? Math.min(0.1, (t - v.lastT) / 1000) : 0;
    v.lastT = t;
    v.acc += dt * TR.rate;
    let burst = 0;
    while (v.acc >= 1 && burst < 6) {
      v.acc -= 1;
      burst += 1;
      const id = visitOnce();
      if (id) spawnDot(v, id, t);
    }
    if (v.acc > 6) v.acc = 0;
    moveDots(v, t);
    if (burst) paintCounts();
    v.raf = requestAnimationFrame(frame);
  }
  function spawnDot(v, id, t) {
    if (v.dots.length >= 40 || !v.pos?.[id]) return;
    const el = h('i', { class: ['tmap__dot', id === 'spare' && 'is-spare'], 'aria-hidden': 'true' });
    v.dotLayer.append(el);
    v.dots.push({ el, to: id, t0: t });
  }
  const LEG1 = 380;
  const LEG2 = 520;
  function moveDots(v, t) {
    v.dots = v.dots.filter((d) => {
      const e = t - d.t0;
      if (e >= LEG1 + LEG2) { d.el.remove(); return false; }
      let a = v.pos.visitors;
      let b = v.pos.lb;
      let p = e / LEG1;
      if (e >= LEG1) { a = v.pos.lb; b = v.pos[d.to]; p = (e - LEG1) / LEG2; }
      const x = a.x + (b.x - a.x) * p;
      const y = a.y + (b.y - a.y) * p;
      d.el.style.transform = `translate3d(${(x - 5).toFixed(1)}px, ${(y - 5).toFixed(1)}px, 0)`;
      return true;
    });
  }

  function layoutMap() {
    const v = TR.view;
    if (!v || !v.map.isConnected) return;
    const box = v.map.getBoundingClientRect();
    const at = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 }; };
    v.pos = { visitors: at(v.visitors), lb: at(v.lb) };
    for (const m of TR.members) v.pos[m.id] = at(v.nodes[m.id]);
    v.lines.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
    const seg = (a, b, cls) => ({ x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1), class: cls || null });
    const lines = [svg('line', seg(v.pos.visitors, v.pos.lb, ''))];
    for (const m of TR.members) {
      let cls = '';
      if (m.id === 'spare') cls = 'is-spare';
      else if (!m.healthy) cls = 'is-down';
      else if (m.role === 'drain') cls = 'is-idle';
      lines.push(svg('line', seg(v.pos.lb, v.pos[m.id], cls)));
    }
    v.lines.replaceChildren(...lines);
  }

  /** Cheap numbers, safe to run on every frame. */
  function paintCounts() {
    const v = TR.view;
    if (!v) return;
    v.total.textContent = COUNT.format(TR.total);
    v.spare.textContent = COUNT.format(member('spare').count);
    v.mainsUp.textContent = `${mainsUp()} of 3`;
    v.dropped.textContent = COUNT.format(TR.dropped);
    for (const m of TR.members) {
      const share = TR.total ? m.count / TR.total : 0;
      v.counts[m.id].textContent = COUNT.format(m.count);
      v.pcts[m.id].textContent = percent(share);
      v.bars[m.id].style.width = `${(share * 100).toFixed(1)}%`;
      v.nodes[m.id].querySelector('[data-state]').textContent = nodeState(m);
      v.rows[m.id].visits.textContent = COUNT.format(m.count);
    }
  }

  /** Everything, after an action. */
  function paintTraffic() {
    const v = TR.view;
    if (!v) return;
    paintCounts();
    for (const m of TR.members) {
      const node = v.nodes[m.id];
      node.classList.toggle('is-down', !m.healthy);
      node.classList.toggle('is-drain', m.healthy && m.role === 'drain');
      node.classList.toggle('is-spare', m.id === 'spare');
      node.classList.toggle('is-taking', m.healthy && m.role === 'active');
      node.classList.toggle('is-selected', TR.moveTarget === m.id);
      const row = v.rows[m.id];
      row.state.textContent = nodeState(m);
      row.role.textContent = roleText(m);
      row.health.textContent = m.healthy ? 'Up' : 'Down';
      row.down.querySelector('.btn__label').textContent = m.healthy ? 'Pretend down' : 'Back up';
      if (row.pause) row.pause.querySelector('.btn__label').textContent = m.role === 'drain' ? 'Send visits again' : 'Stop sending visits';
      if (row.weight) { row.weight.value = String(m.weight); row.weightOut.textContent = String(m.weight); }
    }
    for (const id of Object.keys(v.algoInputs)) {
      v.algoInputs[id].checked = id === TR.algo;
      v.algoInputs[id].closest('.algo').classList.toggle('is-on', id === TR.algo);
    }
    v.lbAlgo.textContent = algoLabel(TR.algo);
    v.rate.value = String(TR.rate);
    v.rateOut.textContent = `${TR.rate} a second`;
    v.runBtn.querySelector('.btn__label').textContent = TR.running ? 'Pause visitors' : 'Start visitors';
    const why = reduceMq.matches ? 'reduced motion' : root.dataset.fx === 'lite' ? 'Lite effects' : '';
    v.note.textContent = why ? `Visitor animation is off (${why} is on). Use "Send 10 visits" to watch the numbers move.` : '';
    paintMove();
    paintFairness();
    paintConfig();
    paintDrill();
    layoutMap();
    syncLoop();
  }

  function paintMove() {
    const v = TR.view;
    if (!v) return;
    for (const m of TR.members) v.targetOpts[m.id].textContent = `${m.name}, ${m.place}${m.healthy ? '' : ' (down)'}`;
    v.target.value = TR.moveTarget;
    v.modeInputs.gradual.checked = TR.moveMode === 'gradual';
    v.modeInputs.instant.checked = TR.moveMode === 'instant';
    const mv = TR.move;
    v.startBtn.disabled = Boolean(mv?.runner?.active);
    v.nextMove.hidden = !(mv?.runner?.waiting);
    v.chips.forEach((chip, i) => {
      const state = mv ? (i < mv.applied ? 'is-done' : i === mv.applied ? 'is-current' : '') : (TR.lastGradual ? 'is-done' : '');
      chip.className = state ? `chip-step ${state}` : 'chip-step';
    });
    const msg = TR.moveMsg;
    v.moveMsg.textContent = msg ? msg.text : '';
    v.moveMsg.className = `move-msg move-msg--${msg?.tone ?? 'info'}`;
  }

  function paintFairness() {
    const v = TR.view;
    if (!v) return;
    const sim = LB.simulateTraffic({ algorithm: TR.algo, members: lbMembers(), requests: 1000, clients: 50, seed: 1 });
    v.fairRows.replaceChildren(...sim.distribution.map((d) => h('tr', {},
      h('th', { scope: 'row' }, member(d.memberId).name),
      h('td', { class: 'num-cell ta-right', 'data-label': 'Share' }, percent(d.share)),
      h('td', { class: 'num-cell ta-right', 'data-label': 'Visits' }, COUNT.format(d.picked)))));
    v.fairGap.textContent = `Biggest gap from a perfectly fair split: ${(sim.maxSkew * 100).toFixed(1)} percentage points.`;
  }

  function paintConfig() {
    const v = TR.view;
    if (!v) return;
    let text;
    try {
      text = LB.nginxConfig({
        name: 'Practice pool', domain: 'tidewater.example', algorithm: TR.algo, sticky: false, serverName: 'practice-entry-01',
        members: TR.members.map((m) => ({ name: m.name, address: ADDRESS[m.id], weight: m.weight, role: m.role })),
      });
    } catch (e) {
      text = `# Not available yet: ${e.message}\n`;
    }
    if (text === v.configText) return;
    v.configText = text;
    v.config.replaceChildren(copyBlock(text, 'Generated server setup file. Practice only: nothing is applied anywhere.'));
  }

  function paintDrill() {
    const v = TR.view;
    if (!v) return;
    v.drillList.replaceChildren(...TR.drillLog.map((t) => h('li', {}, t)));
    v.drillStart.disabled = Boolean(TR.drill?.active);
    v.drillNext.hidden = !(TR.drill?.waiting);
  }

  function mountTraffic(page) {
    const v = {
      nodes: {}, rows: {}, counts: {}, pcts: {}, bars: {}, algoInputs: {}, targetOpts: {}, modeInputs: {}, chips: [],
      dots: [], dotLayer: null, pos: null, raf: 0, lastT: 0, acc: 0, configText: '',
    };
    TR.view = v;

    const algoList = h('div', { class: 'algo-list', role: 'radiogroup', 'aria-label': 'How visitors are shared between servers' },
      LB.ALGORITHMS.map((a) => {
        const input = h('input', { type: 'radio', name: 'algo', value: a.id, onclick: () => chooseAlgorithm(a.id) });
        v.algoInputs[a.id] = input;
        return h('label', { class: 'algo' }, input,
          h('span', { class: 'algo__name' }, a.label),
          h('span', { class: 'algo__desc' }, a.description),
          h('span', { class: 'algo__hint' }, a.hint, ' ', h('span', { class: 'mono' }, `(${a.id.replace(/_/g, ' ')})`)));
      }));
    v.lbAlgo = h('span', {});

    v.lines = svg('svg', { class: 'tmap__lines', 'aria-hidden': 'true', focusable: 'false' });
    v.dotLayer = h('div', { class: 'tmap__dots', 'aria-hidden': 'true' });
    v.visitors = h('button', { type: 'button', class: 'map-node map-node--visitors', 'data-node': 'visitors' },
      h('strong', {}, 'Visitors'), h('small', {}, 'People opening your sites'),
      h('span', { class: 'map-node__count' }, 'Visits sent: ', h('b', { 'data-total': '' }, '0')));
    v.lb = h('button', { type: 'button', class: 'map-node map-node--lb', 'data-node': 'lb' },
      h('strong', {}, 'Load balancer'), h('small', {}, 'Traffic director'),
      h('span', { class: 'map-node__count' }, v.lbAlgo));
    const servers = TR.members.map((m) => {
      const count = h('b', {}, '0');
      v.counts[m.id] = count;
      const btn = h('button', { type: 'button', class: 'map-node', 'data-node': m.id, onclick: () => selectTarget(m.id) },
        h('strong', {}, m.name),
        h('small', {}, m.place),
        h('span', { class: 'map-node__state', 'data-state': '' }, ''),
        h('span', { class: 'map-node__count' }, 'Visits ', count));
      v.nodes[m.id] = btn;
      return btn;
    });
    v.map = h('div', { class: 'tmap', 'data-map': '' },
      v.lines, v.dotLayer,
      h('div', { class: 'tmap__col tmap__col--visitors' }, v.visitors),
      h('div', { class: 'tmap__col tmap__col--lb' }, v.lb),
      h('div', { class: 'tmap__col tmap__col--servers' }, servers));

    v.total = h('span', { class: 'num' }, '0');
    v.spare = h('span', { class: 'num' }, '0');
    v.mainsUp = h('span', { class: 'num' }, '3 of 3');
    v.dropped = h('span', { class: 'num' }, '0');
    const tiles = h('div', { class: 'tiles' },
      statTile('Visits sent', v.total, 'Pretend visitors'),
      statTile('Spare took', v.spare, 'Only when no main is up'),
      statTile('Main servers up', v.mainsUp, 'Taking visits'),
      statTile('Found no server', v.dropped, 'Should stay at 0'));

    v.note = h('p', { class: 'footnote', role: 'status' }, '');
    v.runBtn = button({ variant: 'glass', size: 'sm', icon: 'activity', onclick: () => { TR.running = !TR.running; paintTraffic(); } }, 'Pause visitors');
    v.rateOut = h('span', { class: 'num' }, '');

    const liveCard = card('Live map', 'Visitors arrive, the load balancer picks a server for each one, and the counts move.',
      tiles,
      v.map,
      h('div', { class: 'range-row' },
        h('div', { class: 'range-row__top' }, h('label', { for: 'rate-range' }, 'Visitors per second'), v.rateOut),
        h('input', { type: 'range', id: 'rate-range', min: 1, max: 30, value: TR.rate, 'aria-label': 'Visitors per second', oninput: (e) => { TR.rate = Number(e.target.value); paintTraffic(); } })),
      h('div', { class: 'btn-row' },
        v.runBtn,
        button({ variant: 'glass', size: 'sm', icon: 'plus', onclick: () => { for (let i = 0; i < 10; i += 1) visitOnce(); paintCounts(); } }, 'Send 10 visits'),
        button({ variant: 'ghost', size: 'sm', icon: 'refresh', onclick: resetCounts }, 'Reset counts'),
        button({ variant: 'ghost', size: 'sm', onclick: bringAllBack }, 'Bring everything back')),
      v.note);
    v.rate = liveCard.querySelector('#rate-range');
    v.rateOut = liveCard.querySelector('.range-row__top .num') ?? v.rateOut;

    // Servers table: status, weight and the pretend buttons.
    const rowsEl = h('tbody', {});
    for (const m of TR.members) {
      const row = { };
      row.state = h('span', {}, '');
      row.role = h('span', {}, '');
      row.health = h('span', {}, '');
      row.visits = h('span', { class: 'num' }, '0');
      row.down = button({ size: 'sm', variant: 'glass', onclick: () => toggleHealth(m.id) }, 'Pretend down');
      const actions = [row.down];
      if (m.id !== 'spare') {
        row.pause = button({ size: 'sm', variant: 'ghost', onclick: () => togglePause(m.id) }, 'Stop sending visits');
        actions.push(row.pause);
        row.weight = h('input', { type: 'range', min: 1, max: 10, value: m.weight, 'aria-label': `Weight for ${m.name}`, oninput: (e) => setWeight(m.id, Number(e.target.value)) });
        row.weightOut = h('span', { class: 'num' }, String(m.weight));
      }
      v.rows[m.id] = row;
      rowsEl.append(h('tr', {},
        h('th', { scope: 'row' }, m.name, h('small', { class: 'muted', style: { display: 'block', fontWeight: 400 } }, m.place)),
        h('td', { 'data-label': 'Role' }, row.role),
        h('td', { 'data-label': 'Health' }, row.health),
        h('td', { 'data-label': 'Status' }, row.state),
        h('td', { 'data-label': 'Weight' }, row.weight ? h('div', { class: 'row' }, row.weight, row.weightOut) : h('span', { class: 'muted' }, 'Not used for spares')),
        h('td', { 'data-label': 'Visits', class: 'ta-right' }, row.visits),
        h('td', { 'data-label': 'Actions' }, h('div', { class: 'actions-cell' }, actions))));
    }
    const serverCard = card('Servers', 'Weights only matter for the weighted methods. Pretend down switches a server off in this practice.',
      h('div', { class: 'table-wrap' }, h('table', { class: 'table server-table' },
        h('thead', {}, h('tr', {}, ['Server', 'Role', 'Health', 'Status', 'Weight', 'Visits', 'Actions'].map((t) => h('th', { scope: 'col' }, t)))),
        rowsEl)));

    // Algorithm picker, fairness check and the generated file.
    v.fairRows = h('tbody', {});
    v.fairGap = h('p', { class: 'footnote' }, '');
    v.config = h('div', {});
    const algoCard = card('1. Pick how visitors are shared', 'Five ways to share visits. Try each one, then see how evenly it spreads them.',
      algoList,
      h('div', { class: 'card__block' },
        h('h3', { class: 'card__title', style: { fontSize: 'var(--fs-md)' } }, 'Fairness check'),
        h('p', { class: 'muted footnote' }, '1,000 simulated visits with the same settings each time.'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Server'), h('th', { scope: 'col', class: 'ta-right' }, 'Share'), h('th', { scope: 'col', class: 'ta-right' }, 'Visits'))),
          v.fairRows)),
        v.fairGap));

    // Move visitors card
    v.target = h('select', { class: 'input select', id: 'move-target', 'aria-label': 'Server to move visitors to', onchange: (e) => { TR.moveTarget = e.target.value; paintTraffic(); } },
      TR.members.map((m) => { const opt = h('option', { value: m.id }, m.name); v.targetOpts[m.id] = opt; return opt; }));
    const modeGroup = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'How to move' },
      [['gradual', 'Gradually'], ['instant', 'All at once']].map(([val, label]) => {
        const input = h('input', { type: 'radio', name: 'move-mode', value: val, onclick: () => { TR.moveMode = val; paintTraffic(); } });
        v.modeInputs[val] = input;
        return h('label', {}, input, h('span', {}, label));
      }));
    v.moveMsg = h('p', { class: 'move-msg', role: 'status' }, '');
    v.startBtn = button({ variant: 'primary', icon: 'arrow-right', onclick: () => startMove(TR.moveTarget, TR.moveMode) }, 'Start the move');
    v.nextMove = button({ variant: 'glass', size: 'sm', onclick: () => TR.move?.runner?.next() }, 'Next step');
    v.nextMove.hidden = true;
    v.chips = ['10%', '25%', '50%', '100%'].map((t) => h('li', { class: 'chip-step' }, t));
    const moveCard = card('2. Move visitors to another server', 'Choose a server and how fast to move. A server that is down is refused, so visitors stay put.',
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'move-target' }, 'Move visitors to'), v.target),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'How to move'), modeGroup),
      h('p', { class: 'muted footnote' }, 'All at once sends every visit to the new server straight away. Gradually moves 10%, then 25%, then 50%, then all of them, so you can check at each step.'),
      v.moveMsg,
      h('ol', { class: 'chips', 'aria-label': 'Gradual steps' }, v.chips),
      h('div', { class: 'btn-row' }, v.startBtn, v.nextMove));

    // Drill card
    v.drillList = h('ol', { class: 'drill-log', 'aria-label': 'Drill results' });
    v.drillStart = button({ variant: 'primary', icon: 'shield', onclick: startDrill }, 'Run safety drill');
    v.drillNext = button({ variant: 'glass', size: 'sm', onclick: () => TR.drill?.next() }, 'Next step');
    v.drillNext.hidden = true;
    const drillCard = card('3. Safety drill', 'Pretends every main server is down, checks that the spare takes over, then puts everything back.',
      h('div', { class: 'btn-row' }, v.drillStart, v.drillNext),
      v.drillList,
      h('p', { class: 'footnote' }, 'Simulated. Nothing real is switched off.'));

    const configCard = card('4. The server setup file', 'The same settings, written as the file a server would use. Read it, copy it, and see what each setting does.',
      v.config);

    const activityCard = card('Who got the visits', null,
      h('ul', { class: 'sharebars' }, TR.members.map((m) => {
        const pct = h('b', {}, '0%');
        v.pcts[m.id] = pct;
        const bar = h('i', {});
        v.bars[m.id] = bar;
        return h('li', { class: m.id === 'spare' ? 'is-spare' : '' }, h('span', {}, m.name, ' ', h('small', { class: 'muted' }, m.id === 'spare' ? '(spare)' : '')), h('div', { class: 'bar' }, bar), pct);
      })));

    const layout = h('div', { class: 'traffic-grid' },
      h('div', { class: 'span-all' }, card(null, null,
        h('p', { class: 'lead' }, 'A ', Term('load balancer'), ' sits in front of your servers. Each visitor goes to one server it picks, and it never sends visitors to a server that is down.'),
        h('p', { class: 'muted footnote' }, 'Everything below is a practice copy. Breaking a server here breaks nothing real.'))),
      liveCard, activityCard,
      algoCard, moveCard,
      serverCard,
      drillCard, configCard);

    const head = pageHead('Traffic lab', 'Watch visitors flow through a load balancer, break servers on purpose, and move traffic safely.');
    page.append(h('div', { class: 'practice' }, head, layout));

    // Keep the map geometry right on resize and when the lab opens.
    const ro = new ResizeObserver(() => layoutMap());
    ro.observe(v.map);
    const unsubMotion = onMotion(() => { syncLoop(); paintMove(); paintDrill(); });
    syncBalancer();
    paintTraffic();
    requestAnimationFrame(layoutMap);
    return () => {
      if (TR.view === v) TR.view = null;
      cancelAnimationFrame(v.raf);
      ro.disconnect();
      unsubMotion();
    };
  }

  function selectTarget(id) {
    TR.moveTarget = id;
    if (TR.view) paintTraffic();
    setMoveMsg(`${member(id).name} is selected. Press "Start the move" when you are ready.`, 'info');
    TR.view?.target?.focus?.();
  }

  /* ================= 2. Secure chat practice ================= */

  const REPLIES = ['Got it, thanks Luke.', 'Sounds good. Speak soon.', 'Happy with that. Let us go ahead.'];
  const REASON = {
    bad_signature: ['Rejected', 'bad', 'the seal is broken, so the message was changed after it was sent.'],
    not_recipient: ['Refused', 'bad', 'it was not addressed to this device.'],
    no_key: ['Unreadable', 'info', 'the key it was sent to has been deleted, so it cannot be opened.'],
    bad_decrypt: ['Rejected', 'bad', 'it could not be unlocked.'],
    no_pin: ['Held back', 'warn', 'the sender is not known to this device yet.'],
  };
  let CHAT = null;
  let chatInit = null;

  const blankDevice = (id) => ({
    id, bundle: null, signPubJwk: null, signPriv: null, keyId: null, encPrivs: new Map(), vault: null, vaultKey: null,
    unlocked: false, pins: {}, seen: new Set(), timeline: [], n: 0,
  });
  function newChat() {
    return {
      view: null, convId: null, draft: '', passDraft: '', unlockDraft: '', vaultError: '', composeError: '',
      busy: false, creating: false, unlocking: false, identityChange: false, replyIdx: 0, attack: null,
      safetyToken: 0, safetyResult: null,
      relay: { directory: {}, mailbox: { luke: [], ralph: [] }, records: [], ids: new Set(), seq: 0, log: [] },
      luke: blankDevice('luke'), ralph: blankDevice('ralph'),
    };
  }

  const canSend = () => Boolean(CHAT && CHAT.convId && CHAT.luke.unlocked && CHAT.luke.signPriv && CHAT.luke.pins.ralph && !CHAT.identityChange);

  function ensureChat() {
    if (!CHAT) {
      CHAT = newChat();
      chatInit = (async () => {
        await setupRalph();
        CHAT.convId = await LRCrypto.deriveConvId(['luke', 'ralph']);
      })();
      chatInit.catch((e) => { if (CHAT) CHAT.vaultError = `Could not start the practice: ${e.message}`; });
    }
    return chatInit;
  }

  async function makeIdentity(userId) {
    const sign = await LRCrypto.generateSigningKeyPair(true);
    const enc = await LRCrypto.generateEncKeyPair(true);
    const signPubJwk = await LRCrypto.exportPublicJwk(sign.publicKey);
    const encPubJwk = await LRCrypto.exportPublicJwk(enc.publicKey);
    const bundle = await LRCrypto.createBundle({ userId, signPrivateKey: sign.privateKey, signPublicJwk: signPubJwk, encPublicJwk: encPubJwk });
    return { sign, enc, signPubJwk, bundle };
  }

  async function setupRalph() {
    const id = await makeIdentity('ralph');
    Object.assign(CHAT.ralph, {
      bundle: id.bundle, signPubJwk: id.signPubJwk, signPriv: id.sign.privateKey, keyId: id.bundle.keyId,
      encPrivs: new Map([[id.bundle.keyId, id.enc.privateKey]]), unlocked: true,
      fp: await LRCrypto.fingerprint(id.signPubJwk), // own identity, pinned for yourself as seal() requires
    });
    CHAT.relay.directory.ralph = id.bundle;
  }

  /** Trust on first use: remember the contact's signing key the first time we see it. */
  async function pinFrom(bundle) {
    const info = await LRCrypto.verifyBundle(bundle);
    return { fp: info.signFingerprint, signPubJwk: bundle.signPub, verified: false };
  }

  function note(dev, text, tone = 'info') { dev.timeline.push({ kind: 'note', text, tone }); }

  async function createVault(pass) {
    const check = LRCrypto.checkPassphrase(pass);
    if (!check.ok) { CHAT.vaultError = check.reason; paintChat(); return; }
    CHAT.creating = true;
    CHAT.vaultError = '';
    paintChat();
    try {
      const salt = LRCrypto.newSalt();
      const kek = await LRCrypto.deriveKek(pass, salt); // PBKDF2 with LRCrypto.KDF.iterations rounds: slow on purpose
      const raw = await LRCrypto.exportAesKey(await LRCrypto.newAesKey(true));
      const wrapped = await LRCrypto.encryptBlob(kek, raw, 'vault:luke');
      const vaultKey = await LRCrypto.importAesKey(raw);
      raw.fill(0);
      const id = await makeIdentity('luke');
      const signPrivJwk = await LRCrypto.exportPrivateJwk(id.sign.privateKey);
      const encPrivJwk = await LRCrypto.exportPrivateJwk(id.enc.privateKey);
      const keyId = id.bundle.keyId;
      CHAT.luke.vault = {
        salt: LRCrypto.b64.enc(salt), iterations: LRCrypto.KDF.iterations, wrapped,
        identity: await LRCrypto.encryptJson(vaultKey, signPrivJwk, 'identity:luke'),
        encKeys: { [keyId]: await LRCrypto.encryptJson(vaultKey, encPrivJwk, `enc:luke:${keyId}`) },
        msgs: [],
      };
      Object.assign(CHAT.luke, {
        bundle: id.bundle, signPubJwk: id.signPubJwk, keyId, signPriv: await LRCrypto.importSignPrivate(signPrivJwk),
        encPrivs: new Map([[keyId, await LRCrypto.importEncPrivate(encPrivJwk)]]), vaultKey, unlocked: true,
        fp: await LRCrypto.fingerprint(id.signPubJwk),
      });
      CHAT.relay.directory.luke = id.bundle;
      CHAT.luke.pins.ralph = await pinFrom(CHAT.relay.directory.ralph);
      CHAT.ralph.pins.luke = await pinFrom(id.bundle);
      note(CHAT.luke, "Vault created. Ralph's key is saved on first contact (trust on first use). Compare safety numbers to be sure.", 'ok');
      toast('Vault created', "Luke's keys are scrambled by your passphrase.", 'ok');
    } catch (e) {
      CHAT.vaultError = `Could not create the vault: ${e.message}`;
    } finally {
      CHAT.creating = false;
    }
    paintChat();
  }

  async function unlockVault(pass) {
    const L = CHAT.luke;
    const v = L.vault;
    CHAT.unlocking = true;
    CHAT.vaultError = '';
    paintChat();
    try {
      const kek = await LRCrypto.deriveKek(pass, LRCrypto.b64.dec(v.salt), v.iterations);
      const raw = await LRCrypto.decryptBlob(kek, v.wrapped, 'vault:luke');
      const vaultKey = await LRCrypto.importAesKey(raw);
      const signJwk = await LRCrypto.decryptJson(vaultKey, v.identity, 'identity:luke');
      const [keyId] = Object.keys(v.encKeys);
      const encJwk = await LRCrypto.decryptJson(vaultKey, v.encKeys[keyId], `enc:luke:${keyId}`);
      const timeline = [];
      for (const m of v.msgs) timeline.push(await LRCrypto.decryptJson(vaultKey, m.blob, `msg:${m.id}`));
      Object.assign(L, {
        signPriv: await LRCrypto.importSignPrivate(signJwk),
        encPrivs: new Map([[keyId, await LRCrypto.importEncPrivate(encJwk)]]),
        vaultKey, unlocked: true, timeline,
      });
      CHAT.unlockDraft = '';
    } catch (e) {
      CHAT.vaultError = e.code === 'bad_decrypt' ? 'That passphrase does not open this vault.' : `Could not unlock: ${e.message}`;
    } finally {
      CHAT.unlocking = false;
    }
    paintChat();
  }

  function lockVault() {
    Object.assign(CHAT.luke, { signPriv: null, encPrivs: new Map(), vaultKey: null, unlocked: false, timeline: [] });
    CHAT.composeError = '';
    paintChat();
  }

  async function persistMessage(item) {
    const L = CHAT.luke;
    if (!L.vaultKey) return;
    L.vault.msgs.push({ id: item.id, blob: await LRCrypto.encryptJson(L.vaultKey, item, `msg:${item.id}`) });
  }

  function logRelay(text) {
    CHAT.relay.log.unshift(text);
    CHAT.relay.log.length = Math.min(CHAT.relay.log.length, 6);
  }

  /** The practice server: checks the seal, stores one copy per person, and never reads the text. */
  async function relayAccept(env) {
    const R = CHAT.relay;
    const head = env.header;
    const sender = R.directory[head.from];
    const ok = sender ? await LRCrypto.verifyEnvelopeSignature(env, sender.signPub).catch(() => false) : false;
    if (!ok) {
      logRelay(`Refused a message from ${NAMES[head.from] ?? head.from}: its seal did not check out, so it was not stored.`);
      throw Object.assign(new Error('The server refused the message.'), { code: 'bad_signature' });
    }
    if (R.ids.has(head.id)) {
      logRelay('Refused a repeated message ID.');
      throw Object.assign(new Error('Duplicate message.'), { code: 'duplicate' });
    }
    R.ids.add(head.id);
    const rec = { id: head.id, from: head.from, to: head.to, env, ts: head.ts, bytes: LRCrypto.b64.dec(env.ct).length, changedFor: null };
    R.records.unshift(rec);
    for (const to of head.to) R.mailbox[to].push({ seq: ++R.seq, id: head.id, env, rec });
    logRelay(`Stored a message from ${NAMES[head.from]} for ${head.to.map((x) => NAMES[x]).join(' and ')}. The seal checked out. The text was not read.`);
    return rec;
  }

  /** A device collects its mail: opens each message with the pinned key, drops repeats, and shows refusals plainly. */
  async function pollInbox(dev) {
    if (!dev.unlocked) return;
    const box = CHAT.relay.mailbox[dev.id];
    if (!box.length) return;
    for (const entry of box.splice(0)) {
      const env = entry.env;
      const from = env.header.from;
      try {
        const key = from === dev.id ? dev.signPubJwk : dev.pins[from]?.signPubJwk;
        if (!key) throw Object.assign(new Error('unknown sender'), { code: 'no_pin' });
        const { header, message } = await LRCrypto.open({ envelope: env, myUserId: dev.id, encKeys: dev.encPrivs, senderSignPublicJwk: key, now: Date.now() });
        if (dev.seen.has(header.id)) { note(dev, 'Ignored: this device already has that message, so the repeat was dropped.', 'warn'); continue; }
        dev.seen.add(header.id);
        const item = { kind: 'msg', id: header.id, from, text: String(message.text ?? ''), ts: header.ts, ttl: header.ttl, mine: from === dev.id };
        dev.timeline.push(item);
        if (dev.id === 'luke') await persistMessage(item);
      } catch (e) {
        const [label, tone, why] = REASON[e.code] ?? ['Rejected', 'bad', 'something did not check out.'];
        note(dev, `${label}: ${why}`, tone);
      }
    }
    paintChat();
  }

  async function sendFromLuke(text, { deliver = true } = {}) {
    const L = CHAT.luke;
    const ralphBundle = CHAT.relay.directory.ralph;
    await LRCrypto.verifyBundle(ralphBundle, { pinnedSignFingerprint: L.pins.ralph.fp }); // throws identity_changed if the key moved
    const env = await LRCrypto.seal({
      message: { text }, convId: CHAT.convId, from: 'luke', n: ++L.n, ttl: PREFS.disappear ? 30 : 0,
      recipients: [
        { userId: 'luke', bundle: L.bundle, pinnedSignFingerprint: L.fp },
        { userId: 'ralph', bundle: ralphBundle, pinnedSignFingerprint: L.pins.ralph.fp },
      ],
      signPrivateKey: L.signPriv,
    });
    await relayAccept(env);
    if (deliver) { await pollInbox(CHAT.ralph); await pollInbox(L); }
    return env;
  }

  async function onSend() {
    const text = CHAT.draft.trim();
    if (!text || !canSend() || CHAT.busy) return;
    CHAT.composeError = '';
    try {
      await sendFromLuke(text, { deliver: true });
      CHAT.draft = '';
      complete('m4');
    } catch (e) {
      if (e.code === 'identity_changed') {
        CHAT.identityChange = true;
        complete('m7');
        CHAT.composeError = "Not sent. Ralph's key is not the one you checked before. Review it first.";
      } else {
        CHAT.composeError = `Not sent: ${e.message}`;
      }
    }
    paintChat();
  }

  async function ralphReply() {
    if (!CHAT.luke.bundle) return;
    const R = CHAT.ralph;
    const text = REPLIES[CHAT.replyIdx % REPLIES.length];
    CHAT.replyIdx += 1;
    try {
      const env = await LRCrypto.seal({
        message: { text }, convId: CHAT.convId, from: 'ralph', n: ++R.n, ttl: PREFS.disappear ? 30 : 0,
        recipients: [
          { userId: 'ralph', bundle: R.bundle, pinnedSignFingerprint: R.fp },
          { userId: 'luke', bundle: CHAT.relay.directory.luke, pinnedSignFingerprint: R.pins.luke.fp },
        ],
        signPrivateKey: R.signPriv,
      });
      await relayAccept(env);
      await pollInbox(CHAT.luke);
      await pollInbox(R);
    } catch (e) {
      note(R, `Not sent: ${e.message}`, 'bad');
    }
    paintChat();
  }

  async function refreshIdentity() {
    const pin = CHAT.luke.pins.ralph;
    if (!pin) return;
    try {
      await LRCrypto.verifyBundle(CHAT.relay.directory.ralph, { pinnedSignFingerprint: pin.fp });
      CHAT.identityChange = false;
    } catch (e) {
      if (e.code !== 'identity_changed') throw e;
      CHAT.identityChange = true;
    }
  }

  function restoreRealKey() {
    CHAT.relay.directory.ralph = CHAT.ralph.bundle;
    CHAT.identityChange = false;
    toast('Real key restored', "The server is showing Ralph's real key again.", 'ok');
    paintChat();
  }

  async function acceptNewKey() {
    CHAT.luke.pins.ralph = await pinFrom(CHAT.relay.directory.ralph);
    CHAT.identityChange = false;
    toast('New key accepted', 'Only do this after the numbers match in person or on the phone.', 'warn');
    paintChat();
  }

  async function rotateRalphKey() {
    const R = CHAT.ralph;
    const enc = await LRCrypto.generateEncKeyPair(true);
    const encPubJwk = await LRCrypto.exportPublicJwk(enc.publicKey);
    const bundle = await LRCrypto.createBundle({ userId: 'ralph', signPrivateKey: R.signPriv, signPublicJwk: R.signPubJwk, encPublicJwk: encPubJwk });
    R.bundle = bundle;
    R.keyId = bundle.keyId;
    R.encPrivs = new Map([[bundle.keyId, enc.privateKey]]); // the old private key is gone
    CHAT.relay.directory.ralph = bundle;
  }

  /* ----- attacks: each one runs the real code and reports the real result ----- */

  function startAttack(title) {
    CHAT.busy = true;
    CHAT.attack = { title, steps: [], outcome: null };
    paintChat();
    return {
      step(text) { CHAT.attack.steps.push(text); paintAttacks(); },
      finish(label, tone, text) { CHAT.attack.outcome = { label, tone, text }; CHAT.busy = false; paintChat(); },
      fail(e) { CHAT.attack.outcome = { label: 'Could not run', tone: 'warn', text: e.message }; CHAT.busy = false; paintChat(); },
    };
  }

  function changeOneLetter(env) {
    const i = Math.floor(env.ct.length / 2);
    const swap = env.ct[i] === 'A' ? 'B' : 'A';
    return { ...env, ct: env.ct.slice(0, i) + swap + env.ct.slice(i + 1) };
  }

  async function attackTamper() {
    const a = startAttack('Server changes one letter of a message');
    try {
      const env = await sendFromLuke('Practice message: the server will try to change one letter of this.', { deliver: false });
      a.step('Luke sends a message. The server stores it and keeps a copy for Ralph.');
      const entry = CHAT.relay.mailbox.ralph.find((e) => e.id === env.header.id);
      entry.env = changeOneLetter(entry.env);
      entry.rec.changedFor = 'ralph';
      a.step("The server changes one letter in the copy it is holding for Ralph.");
      await pollInbox(CHAT.ralph);
      a.step("Ralph's device checks the seal on the message. The seal is broken.");
      await pollInbox(CHAT.luke);
      a.finish('Rejected', 'bad', "Ralph's device refused the message, so it was never shown. One changed letter is enough to break the seal.");
      complete('m6');
    } catch (e) { a.fail(e); }
  }

  async function attackReplay() {
    const a = startAttack('Server replays an old message');
    try {
      let old = CHAT.relay.records.find((r) => r.from === 'luke');
      if (old) {
        a.step('The server picks a message from Luke that Ralph already has.');
      } else {
        await sendFromLuke('Practice message to replay.', { deliver: true });
        old = CHAT.relay.records.find((r) => r.from === 'luke');
        a.step('Luke sends a message first, and Ralph receives it as normal.');
      }
      CHAT.relay.mailbox.ralph.push({ seq: ++CHAT.relay.seq, id: old.id, env: old.env, rec: old });
      a.step('The server delivers the same message to Ralph a second time.');
      await pollInbox(CHAT.ralph);
      a.step("Ralph's device sees a message ID it already has, and skips it.");
      a.finish('Ignored', 'warn', 'Ralph does not see the message twice. Repeat copies are dropped using the message ID.');
    } catch (e) { a.fail(e); }
  }

  async function attackSwapKey() {
    const a = startAttack("Server swaps Ralph's key for its own");
    try {
      const fake = await makeIdentity('ralph');
      CHAT.relay.directory.ralph = fake.bundle;
      a.step("The server puts its own key in the directory, in place of Ralph's key.");
      a.step("Luke's app checks that key against the one it saved the first time they met.");
      await refreshIdentity();
      a.step(CHAT.identityChange ? 'They differ, so Luke\'s app blocks sending.' : 'They match, which is unexpected.');
      complete('m7');
      a.finish('Blocked', 'bad', "Sending is paused. Compare the safety numbers with Ralph in person or on the phone. Restoring Ralph's real key is the safe fix in this practice.");
    } catch (e) { a.fail(e); }
  }

  async function attackWrongPerson() {
    const a = startAttack('Message to the wrong person');
    try {
      const env = await sendFromLuke("Practice message meant for Ralph only.", { deliver: false });
      a.step('Luke sends a message to Ralph.');
      CHAT.relay.mailbox.ralph = CHAT.relay.mailbox.ralph.filter((e) => e.id !== env.header.id);
      a.step("The server hands the message to a stranger's device instead. Ralph's copy never arrives.");
      try {
        await LRCrypto.open({ envelope: env, myUserId: 'stranger', encKeys: new Map(), senderSignPublicJwk: CHAT.luke.signPubJwk, now: Date.now() });
        a.finish('Opened', 'bad', 'This should never happen. The stranger was not meant to read it.');
      } catch (e) {
        a.step(e.code === 'not_recipient' ? "The stranger's device tries to open it. It is refused: the message was not addressed to that device." : `The stranger's device refuses it (${e.code}).`);
        a.finish('Refused', 'bad', "The message is locked to Ralph's key, so a stranger cannot open it even though the server handed it over. Ralph would notice nothing arrived.");
      }
    } catch (e) { a.fail(e); }
  }

  async function attackForget() {
    const a = startAttack('Forget the key');
    try {
      await sendFromLuke('Practice message sent just before Ralph changes his key.', { deliver: false });
      a.step("Luke sends a message to Ralph's current chat key. Ralph has not opened it yet.");
      await rotateRalphKey();
      a.step("Ralph's device swaps to a fresh chat key and deletes the old private key, as it does every few days.");
      await pollInbox(CHAT.ralph);
      a.step("Ralph's device tries to open the earlier message with the old key. That key is gone.");
      a.finish('Unreadable', 'info', 'That is the point of deleting old keys: even if a key is stolen later, old messages stay unreadable. The real app keeps old keys for a short grace period, so a message sent just before a change can still be read. This practice deletes the key straight away to show the effect.');
    } catch (e) { a.fail(e); }
  }

  const ATTACKS = [
    { title: 'Server changes one letter of a message', desc: 'Luke sends a message. The server edits one letter before Ralph gets it.', run: attackTamper },
    { title: 'Server replays an old message', desc: 'The server sends a message Ralph already has, a second time.', run: attackReplay },
    { title: "Server swaps Ralph's key for its own", desc: 'The server puts its own key in the directory, pretending to be Ralph.', run: attackSwapKey },
    { title: 'Message to the wrong person', desc: "The server hands Luke's message to a stranger's device.", run: attackWrongPerson },
    { title: 'Forget the key', desc: "Ralph's device changes keys and deletes the old one before he reads the message.", run: attackForget },
  ];

  /* ----- paint the chat ----- */

  function timelineItem(item) {
    if (item.kind === 'note') return h('div', { class: `note note--${item.tone || 'info'}` }, item.text);
    const gone = item.ttl > 0 && Date.now() > item.ts + item.ttl * 1000;
    if (item.ttl > 0 && !gone && !item.timer) item.timer = setTimeout(() => paintChat(), item.ts + item.ttl * 1000 - Date.now() + 60);
    return h('div', { class: ['bubble', item.mine && 'bubble--mine'] },
      h('span', { class: 'bubble__who' }, item.mine ? 'You' : NAMES[item.from]),
      gone ? h('span', { class: 'bubble__gone' }, 'This disappearing message has gone.') : item.text);
  }

  function timelineBox(items, empty) {
    return h('div', { class: 'timeline', role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' },
      items.length ? items.map(timelineItem) : h('p', { class: 'empty-line' }, empty));
  }

  function paintVault() {
    const v = CHAT.view;
    const L = CHAT.luke;
    if (!v) return;
    let kids;
    if (!L.vault) {
      kids = [
        h('p', { class: 'lead' }, "Set up Luke's vault. Your passphrase locks Luke's keys on this device. The server never sees it."),
        h('div', { class: 'field' },
          h('label', { class: 'field__label', for: 'pass-new' }, 'Your ', Term('passphrase', 'passphrase')),
          h('input', { class: 'input', id: 'pass-new', type: 'password', autocomplete: 'new-password', placeholder: 'At least 12 characters', 'aria-describedby': 'pass-hint', value: CHAT.passDraft, oninput: (e) => { CHAT.passDraft = e.target.value; } }),
          h('p', { class: 'field__hint muted', id: 'pass-hint' }, 'At least 12 characters. A few random words works well. It never leaves this device.')),
        h('div', { class: 'btn-row' },
          button({ variant: 'primary', icon: 'lock', cls: CHAT.creating ? 'is-loading' : undefined, disabled: CHAT.creating, onclick: safe(() => createVault(CHAT.passDraft)) }, CHAT.creating ? 'Working...' : "Create Luke's vault"),
          button({ variant: 'ghost', size: 'sm', onclick: () => { CHAT.passDraft = 'tangerine lighthouse river 42'; paintVault(); } }, 'Fill in a practice passphrase')),
        CHAT.creating ? h('p', { class: 'footnote', role: 'status' }, 'Working out the passphrase key. This takes a moment on purpose, so guessing passphrases is slow.') : null,
        CHAT.vaultError ? h('p', { class: 'composer__error', role: 'alert' }, CHAT.vaultError) : null,
      ];
    } else if (L.unlocked) {
      const enc = Object.values(L.vault.encKeys)[0];
      kids = [
        badge('ok', 'Vault unlocked'),
        h('p', { class: 'lead' }, "Luke's keys and history are stored in this vault, scrambled. This is what the vault holds:"),
        h('dl', { class: 'vault-facts' },
          h('dt', {}, 'Identity key'), h('dd', {}, `scrambled, ${LRCrypto.b64.dec(L.vault.identity.ct).length} bytes`),
          h('dt', {}, 'Chat key'), h('dd', {}, `scrambled, ${LRCrypto.b64.dec(enc.ct).length} bytes`),
          h('dt', {}, 'Message history'), h('dd', {}, `${L.vault.msgs.length} message${L.vault.msgs.length === 1 ? '' : 's'}, each scrambled`),
          h('dt', {}, 'Passphrase step'), h('dd', {}, Term('pbkdf2', 'PBKDF2'), ` with ${LRCrypto.KDF.iterations.toLocaleString('en-GB')} rounds`)),
        h('div', { class: 'btn-row' }, button({ variant: 'glass', size: 'sm', icon: 'lock', onclick: lockVault }, 'Lock vault')),
        h('p', { class: 'footnote' }, 'Locking drops the keys from memory. Messages stay scrambled until you unlock again.'),
      ];
    } else {
      kids = [
        badge('warn', 'Vault locked'),
        h('p', { class: 'lead' }, "Enter the passphrase to unlock Luke's keys. Opening the vault takes a moment, on purpose."),
        h('div', { class: 'field' },
          h('label', { class: 'field__label', for: 'pass-unlock' }, 'Vault passphrase'),
          h('input', { class: 'input', id: 'pass-unlock', type: 'password', autocomplete: 'current-password', value: CHAT.unlockDraft, oninput: (e) => { CHAT.unlockDraft = e.target.value; } })),
        h('div', { class: 'btn-row' },
          button({ variant: 'primary', icon: 'lock', cls: CHAT.unlocking ? 'is-loading' : undefined, disabled: CHAT.unlocking, onclick: safe(() => unlockVault(CHAT.unlockDraft)) }, CHAT.unlocking ? 'Unlocking...' : 'Unlock vault')),
        CHAT.vaultError ? h('p', { class: 'composer__error', role: 'alert' }, CHAT.vaultError) : null,
      ];
    }
    v.vault.replaceChildren(...kids.filter(Boolean));
  }

  function paintLuke() {
    const v = CHAT.view;
    const L = CHAT.luke;
    if (!v) return;
    const status = [
      L.vault ? badge(L.unlocked ? 'ok' : 'warn', L.unlocked ? 'Vault open' : 'Vault locked') : badge('neutral', 'No vault yet'),
      L.pins.ralph ? badge(L.pins.ralph.verified ? 'ok' : 'info', L.pins.ralph.verified ? "Ralph's numbers match" : "Ralph's key saved") : badge('neutral', 'Ralph not saved yet'),
    ];
    const kids = [h('div', { class: 'chat-pane__head' }, h('h2', {}, "Luke's screen"), h('div', { class: 'chat-pane__status' }, status))];
    if (CHAT.identityChange) {
      kids.push(h('div', { class: 'callout callout--bad', role: 'alert' }, icon('alert', 18),
        h('div', {},
          h('strong', {}, "Ralph's key has changed."),
          h('p', {}, "Sending is paused. The key the server is showing now is not the one Luke saved the first time. Compare the safety numbers below with Ralph before anything else."),
          h('div', { class: 'callout__actions' },
            button({ variant: 'glass', size: 'sm', icon: 'refresh', onclick: restoreRealKey }, "Restore Ralph's real key"),
            button({ variant: 'danger', size: 'sm', onclick: safe(acceptNewKey) }, 'Accept the new key anyway')))));
    }
    const empty = !L.vault ? 'Create the vault first.' : !L.unlocked ? 'Locked. Unlock the vault to read Luke\'s messages.' : L.bundle ? 'No messages yet. Send Ralph one below.' : 'Create the vault first.';
    kids.push(timelineBox(L.unlocked ? L.timeline : [], empty));
    const ready = canSend();
    const hint = !L.vault ? 'Create the vault first.' : !L.unlocked ? 'Unlock the vault to send.' : CHAT.identityChange ? "Paused until you review Ralph's key." : 'Ctrl+Enter sends.';
    kids.push(h('div', { class: 'composer' },
      h('label', { class: 'sr-only', for: 'compose' }, 'Message to Ralph'),
      h('textarea', { class: 'input textarea', id: 'compose', rows: 3, maxlength: 1000, placeholder: 'Write to Ralph', disabled: !ready, value: CHAT.draft, oninput: (e) => { CHAT.draft = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); safe(onSend)(); } } }),
      h('div', { class: 'composer__row' },
        h('p', { class: 'composer__hint' }, hint),
        button({ variant: 'primary', icon: 'arrow-right', disabled: !ready || CHAT.busy, onclick: safe(onSend) }, 'Send')),
      CHAT.composeError ? h('p', { class: 'composer__error', role: 'alert' }, CHAT.composeError) : null));
    v.luke.replaceChildren(...kids);
  }

  function paintRalph() {
    const v = CHAT.view;
    const R = CHAT.ralph;
    if (!v) return;
    v.ralph.replaceChildren(
      h('div', { class: 'chat-pane__head' }, h('h2', {}, "Ralph's screen"),
        h('div', { class: 'chat-pane__status' }, badge('ok', 'Ready'), R.pins.luke ? badge('info', "Luke's key saved") : badge('neutral', 'Not met yet'))),
      h('p', { class: 'footnote' }, "Ralph's device is open here so the practice keeps moving. In the real app, Ralph has his own device and his own passphrase."),
      timelineBox(R.timeline, 'Nothing yet. Send Luke a message, or let Ralph reply.'),
      h('div', { class: 'btn-row' }, button({ variant: 'primary', icon: 'chat', disabled: !CHAT.luke.bundle, onclick: safe(ralphReply) }, 'Ralph replies')));
  }

  function envelopeCard(rec) {
    const when = new Date(rec.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return h('article', { class: ['envelope', rec.changedFor && 'is-changed'] },
      h('div', { class: 'envelope__top' }, h('strong', {}, `Message ${rec.id.slice(0, 6)}`),
        rec.changedFor ? badge('bad', `Changed for ${NAMES[rec.changedFor]}`) : badge('ok', 'Stored')),
      h('dl', {},
        h('dt', {}, 'From'), h('dd', {}, NAMES[rec.from]),
        h('dt', {}, 'To'), h('dd', {}, rec.to.map((x) => NAMES[x]).join(' and ')),
        h('dt', {}, 'Size'), h('dd', {}, `${rec.bytes} bytes (padded)`),
        h('dt', {}, 'Time'), h('dd', {}, when),
        h('dt', {}, 'Scrambled'), h('dd', { class: 'envelope__cipher' }, `${rec.env.ct.slice(0, 34)}...`)),
      h('p', { class: 'envelope__cannot' }, 'It cannot read the message.'));
  }

  function paintServer() {
    const v = CHAT.view;
    const R = CHAT.relay;
    if (!v) return;
    const kids = [
      h('div', { class: 'chat-pane__head' }, h('h2', {}, 'What the server can see')),
      h('p', { class: 'lead' }, 'The server only passes scrambled text between the two devices. It can see who sent what to whom, when, and roughly how long each message is.'),
      h('p', { class: 'footnote' }, 'Scrambled text is shown as ', Term('ciphertext'), '. Every message is also sealed with a ', Term('signature'), ' so changes are caught.'),
    ];
    if (!R.records.length) kids.push(h('p', { class: 'empty-line' }, 'Nothing sent yet. Once a message is sent, its envelope appears here.'));
    for (const rec of R.records.slice(0, 5)) kids.push(envelopeCard(rec));
    kids.push(h('ol', { class: 'relay-log', 'aria-label': 'Server log' }, R.log.map((t) => h('li', {}, t))));
    v.server.replaceChildren(...kids);
  }

  function compareNumbers(onLuke, onRalph) {
    const same = onLuke === onRalph;
    CHAT.safetyResult = same
      ? { ok: true, text: 'They match. Nobody is in the middle.' }
      : { ok: false, text: 'These do not match. Do not trust this key. Stop and check again in person or on the phone.' };
    if (same) CHAT.luke.pins.ralph.verified = true;
    complete('m5');
    paintChat();
  }

  async function paintSafety() {
    const v = CHAT.view;
    if (!v) return;
    const token = ++CHAT.safetyToken;
    const L = CHAT.luke;
    const R = CHAT.ralph;
    if (!L.signPubJwk || !L.pins.ralph || !R.pins.luke) {
      v.safety.replaceChildren(h('p', { class: 'empty-line' }, "Set up Luke's vault first. Then both numbers appear here."));
      return;
    }
    const onLuke = await LRCrypto.safetyNumber(CHAT.relay.directory.ralph.signPub, L.signPubJwk);
    const onRalph = await LRCrypto.safetyNumber(R.pins.luke.signPubJwk, R.signPubJwk);
    if (token !== CHAT.safetyToken || CHAT.view !== v) return;
    const res = CHAT.safetyResult;
    v.safety.replaceChildren(
      h('div', { class: 'safety-grid' },
        h('div', { class: 'safety-box' }, h('h3', {}, "On Luke's screen"), h('p', { class: 'safety-num', 'data-safety': 'luke' }, onLuke)),
        h('div', { class: 'safety-box' }, h('h3', {}, "On Ralph's screen"), h('p', { class: 'safety-num', 'data-safety': 'ralph' }, onRalph))),
      h('div', { class: 'btn-row' }, button({ variant: 'primary', icon: 'check', onclick: () => compareNumbers(onLuke, onRalph) }, 'They match')),
      ...(res ? [h('p', { class: `safety-result safety-result--${res.ok ? 'ok' : 'bad'}`, role: 'status' }, res.text)] : []),
      h('p', { class: 'footnote' }, 'Read both numbers out loud, in person or on the phone. If they match, nobody is in the middle. ', Term('safety number', 'What is a safety number?')));
  }

  function paintAttacks() {
    const v = CHAT.view;
    if (!v) return;
    const ready = canSend() && !CHAT.busy;
    const kids = [];
    if (!ready) kids.push(h('p', { class: 'footnote' }, CHAT.busy ? 'Running...' : "Set up Luke's vault first, and clear any blocked key warning, to try these."));
    kids.push(h('div', { class: 'attack-grid' }, ATTACKS.map((a) => button({ variant: 'glass', cls: 'attack', disabled: !ready, onclick: safe(a.run) },
      h('span', { class: 'attack__title' }, a.title), h('span', { class: 'attack__desc' }, a.desc)))));
    if (CHAT.attack) {
      kids.push(h('h3', { class: 'card__title', style: { fontSize: 'var(--fs-md)' } }, CHAT.attack.title));
      kids.push(h('ol', { class: 'attack-log', 'aria-label': 'What happened' }, CHAT.attack.steps.map((t, i) => h('li', {}, h('span', {}, String(i + 1)), h('span', {}, t)))));
      const o = CHAT.attack.outcome;
      if (o) kids.push(h('div', { class: `attack-outcome attack-outcome--${o.tone}`, role: 'status' }, badge(o.tone, o.label), h('p', {}, o.text)));
    }
    v.attacks.replaceChildren(...kids);
  }

  function paintChat() {
    if (!CHAT || !CHAT.view) return;
    paintVault();
    paintLuke();
    paintServer();
    paintRalph();
    paintSafety();
    paintAttacks();
  }

  function mountChat(page) {
    if (!hasCrypto()) {
      page.append(
        pageHead('Secure chat practice', 'This page needs your browser\'s secure key tools.'),
        card('Why this is not running', null,
          h('p', {}, 'Secure chat uses your browser\'s built-in key tools (crypto.subtle). Some browsers switch them off on pages they do not trust, for example when the file is opened from a plain network address.'),
          h('p', { class: 'muted' }, 'Open this file directly from your computer, in a current Chrome, Edge, Firefox or Safari. The rest of the practice still works here.')));
      return undefined;
    }
    const ready = ensureChat();
    const v = {
      vault: h('div', { class: 'card__block' }), luke: h('div', { class: 'chat-pane' }), server: h('div', { class: 'chat-pane' }),
      ralph: h('div', { class: 'chat-pane' }), safety: h('div', { class: 'card__block' }), attacks: h('div', { class: 'card__block' }),
    };
    CHAT.view = v;
    const toggles = h('div', { class: 'toggle-line' },
      toggle('Disappearing messages (30 seconds)', PREFS.disappear, (on) => { PREFS.disappear = on; }),
      toggle('Blur this page when the tab is hidden', PREFS.blur, (on) => { PREFS.blur = on; motionChanged(); }));
    page.append(h('div', { class: 'practice' },
      pageHead('Secure chat practice', 'Two people, one page. Send messages, then try to break them the way a dishonest server could.'),
      card('How this works', null,
        h('div', { class: 'explainer' },
          h('p', { class: 'lead' }, 'In the real app, Luke and Ralph each have their own device. The server in the middle only passes scrambled text between them, using ', Term('end-to-end encryption'), '.'),
          h('ol', {},
            h('li', {}, "Here both people live on this page, so you can see every step. Ralph's replies are pre-written."),
            h('li', {}, 'Everything uses the real code the app uses: the same keys, seals and checks.'),
            h('li', {}, 'This practice forgets everything when the page reloads. Your missions stay ticked.'))),
        toggles),
      card('Step 1: Luke\'s vault', 'The passphrase locks Luke\'s keys. Try locking and unlocking it.', v.vault),
      h('div', { class: 'chat-grid' },
        card(null, null, v.luke),
        card(null, null, v.server),
        card(null, null, v.ralph)),
      card('Safety numbers', 'Both screens should show the same number. Compare them, then press the button.', v.safety),
      card('Attack lab', 'Pick an attack. The real code runs, and you see what the real checks decide.', v.attacks)));
    ready.then(() => { if (CHAT && CHAT.view === v) paintChat(); }, () => { if (CHAT && CHAT.view === v) paintChat(); });
    paintChat();
    return () => { if (CHAT && CHAT.view === v) CHAT.view = null; };
  }

  /* ================= 3. Move a website practice ================= */

  const SITES = [
    { id: 'smith', name: 'Smith & Sons', trade: 'Plumber', domain: 'smithandsons.example', server: 'ldn' },
    { id: 'crumb', name: 'Crumb & Kiln', trade: 'Bakery', domain: 'crumbandkiln.example', server: 'man' },
    { id: 'north', name: 'Northside Barber', trade: 'Barber', domain: 'northsidebarber.example', server: 'ldn' },
    { id: 'petal', name: 'Petal & Stem', trade: 'Florist', domain: 'petalandstem.example', server: 'dub' },
    { id: 'volt', name: 'VOLT Strength', trade: 'Gym', domain: 'voltstrength.example', server: 'man' },
    { id: 'tide', name: 'Tidewater', trade: 'Seafood restaurant', domain: 'tidewater.example', server: 'ldn' },
    { id: 'form', name: 'Form & Field', trade: 'Architects', domain: 'formandfield.example', server: 'man' },
  ];
  const RISK = { low: ['ok', 'Low risk'], medium: ['warn', 'Medium risk'], high: ['bad', 'High risk'] };
  const newMigrate = () => ({ site: 'smith', target: 'dub', copyFiles: true, copyDb: true, ssl: true, runner: null, done: new Set(), phase: 'idle', movedTo: null, msg: null, view: null });
  let MG = newMigrate();

  function planSteps() {
    const target = member(MG.target)?.name ?? MG.target;
    const steps = [
      { key: 'prepare', label: 'Create the site on the new server', detail: `Makes an empty copy of the site settings on ${target}. The old site is not touched.`, risk: 'low' },
      MG.copyDb && { key: 'database', label: 'Copy the database', detail: 'Makes a copy of the site database on the new server.', risk: 'high' },
      MG.copyFiles && { key: 'files', label: 'Copy the site files', detail: 'Copies pictures, pages and theme files across.', risk: 'medium' },
      { key: 'check', label: 'Check the copy before visitors see it', detail: 'Opens the copy privately and checks that the pages load.', risk: 'low' },
      MG.ssl && { key: 'padlock', label: 'Set up the padlock on the new server', detail: 'Issues the security certificate that shows the padlock in the browser.', risk: 'medium' },
      { key: 'ready', label: 'Ready to switch visitors', detail: 'Nothing changes for visitors until you press the switch button.', risk: 'high' },
    ];
    return steps.filter(Boolean);
  }

  function resetMigrate(keepSite = true) {
    MG.runner?.cancel();
    const site = keepSite ? MG.site : 'smith';
    MG = { ...newMigrate(), site, view: MG.view };
  }

  function setMigMsg(text, tone = 'info') { MG.msg = { text, tone }; paintMigrate(); }

  function startMigrate() {
    const site = SITES.find((s) => s.id === MG.site);
    const target = member(MG.target);
    if (MG.runner?.active) return;
    if (MG.movedTo) return setMigMsg(`${site.name} has already been switched in this practice. Reset the practice to try again.`, 'warn');
    if (site.server === MG.target) return setMigMsg(`${site.name} is already on ${target.name} in this practice. Pick a different server.`, 'warn');
    if (!target.healthy) return setMigMsg(`Not started. ${target.name} is down in the traffic lab, so it cannot receive the site. Bring it back first.`, 'bad');
    MG.done = new Set();
    MG.phase = 'running';
    const plan = planSteps();
    MG.runner = new Runner(plan.map((s) => ({ run: () => { MG.done.add(s.key); } })), {
      delay: 900,
      onStep: () => {
        if (MG.done.size === plan.length) { MG.phase = 'ready'; setMigMsg('The copy is ready and checked. Visitors still use the old server. Press the switch button when you are ready.', 'ok'); }
        else paintMigrate();
      },
    });
    setMigMsg(`Building a copy of ${site.name} on ${target.name}. The old site is not changed.`, 'info');
    MG.runner.next();
    paintMigrate();
    return undefined;
  }

  function switchVisitors() {
    if (MG.phase !== 'ready') return;
    MG.phase = 'switched';
    MG.movedTo = MG.target;
    setMigMsg(`Visitors now go to ${member(MG.target).name} (simulated). The old site has not been changed or deleted.`, 'ok');
  }

  function visitorText() {
    const target = member(MG.target)?.name ?? MG.target;
    if (MG.phase === 'running') return 'Visitors still use the old server. The new copy is being built beside it, so nothing changes for them yet.';
    if (MG.phase === 'ready') return 'The new copy is ready and checked. Visitors still use the old server. The switch points the domain at the new server, and it is the only step that changes what visitors see.';
    if (MG.phase === 'switched') return `Visitors now go to ${target} (simulated). The old server is left as it was.`;
    return 'Right now visitors still use the old server. Starting the practice move builds a copy on the new server. Visitors notice nothing until the switch.';
  }

  function runbookText() {
    const site = SITES.find((s) => s.id === MG.site);
    const target = member(MG.target)?.name ?? MG.target;
    return [
      '# Example runbook. Practice only: nothing here is run.',
      `# Site: ${site.domain}  ->  new server: ${target}`,
      '1. Make a backup of the current site.',
      `2. Create the site on ${target} for ${site.domain}.`,
      MG.copyDb && '3. Copy the database to the new server.',
      MG.copyFiles && '4. Copy the site files to the new server, for example: rsync -a <old-server>:/site/ <new-server>:/site/',
      '5. Check the new copy using a private test address.',
      MG.ssl && '6. Set up the padlock (certificate) on the new server.',
      `${MG.copyDb && MG.copyFiles && MG.ssl ? '7' : '6'}. Point the domain's address book entry (DNS) at the new server. This is the switch.`,
    ].filter(Boolean).join('\n');
  }

  function paintMigrate() {
    const v = MG.view;
    if (!v) return;
    const site = SITES.find((s) => s.id === MG.site);
    const target = member(MG.target);
    v.site.replaceChildren(
      h('strong', {}, site.name),
      h('span', { class: 'muted' }, site.trade),
      h('span', { class: 'mono' }, site.domain),
      h('span', {}, 'Practice: currently on ', member(site.server).name, MG.movedTo ? ` (moved to ${member(MG.movedTo).name})` : ''));
    v.siteSelect.value = MG.site;
    v.targetSelect.value = MG.target;
    for (const m of TR.members.filter((x) => x.id !== 'spare')) v.targetOpts[m.id].textContent = `${m.name}, ${m.place}${m.healthy ? '' : ' (down)'}`;
    const busy = Boolean(MG.runner?.active);
    for (const el of [v.siteSelect, v.targetSelect, v.copyFiles, v.copyDb, v.ssl]) el.disabled = busy || MG.phase === 'switched';
    v.copyFiles.checked = MG.copyFiles;
    v.copyDb.checked = MG.copyDb;
    v.ssl.checked = MG.ssl;
    const warns = [];
    if (!MG.copyDb) warns.push('Without the database, pages that need stored content may not work on the new server.');
    if (!MG.ssl) warns.push('Without a padlock on the new server, visitors may see a browser warning until one is set up.');
    if (site.server === MG.target && !MG.movedTo) warns.push('This is the server the site is already on. Pick a different one.');
    v.warn.replaceChildren(...warns.map((w) => h('div', { class: 'callout callout--warn' }, icon('alert', 18), h('p', {}, w))));
    const plan = planSteps();
    const firstOpen = plan.findIndex((s) => !MG.done.has(s.key));
    v.plan.replaceChildren(...plan.map((s, i) => {
      const done = MG.done.has(s.key);
      const running = busy && i === firstOpen;
      const [kind, label] = RISK[s.risk];
      return h('li', { class: ['plan-step', done && 'is-done', running && 'is-running', !done && !running && 'is-waiting'] },
        h('span', { class: 'job__mark' }, icon('check', 14), h('span', { class: 'spinner' }), h('b', {}, String(i + 1))),
        h('span', { class: 'plan-step__label' }, s.label, h('small', {}, s.detail)),
        h('span', { class: 'plan-step__tags' }, badge(kind, label), h('span', { class: 'sim-tag' }, 'Simulated')));
    }));
    v.visitors.textContent = visitorText();
    v.startBtn.disabled = busy || MG.phase === 'ready' || MG.phase === 'switched';
    v.nextBtn.hidden = !(MG.runner?.waiting);
    v.switchBtn.hidden = MG.phase !== 'ready';
    v.msg.textContent = MG.msg ? MG.msg.text : '';
    v.msg.className = `move-msg move-msg--${MG.msg?.tone ?? 'info'}`;
    const rb = runbookText();
    if (rb !== v.runbookText) { v.runbookText = rb; v.runbook.replaceChildren(copyBlock(rb, 'Practice runbook (simulated). Nothing runs.')); }
  }

  function mountMigrate(page) {
    const v = { runbookText: '', targetOpts: {} };
    MG.view = v;
    v.siteSelect = h('select', { class: 'input select', id: 'site-pick', 'aria-label': 'Made-up site to move', onchange: (e) => { resetMigrate(false); MG.site = e.target.value; paintMigrate(); } },
      SITES.map((s) => h('option', { value: s.id }, `${s.name} (${s.domain})`)));
    v.site = h('div', { class: 'site-card' });
    v.warn = h('div', { class: 'stack' });
    v.targetSelect = h('select', { class: 'input select', id: 'mig-target', 'aria-label': 'New server', onchange: (e) => { if (MG.phase === 'idle') { MG.target = e.target.value; paintMigrate(); } } },
      TR.members.filter((m) => m.id !== 'spare').map((m) => { const o = h('option', { value: m.id }, m.name); v.targetOpts[m.id] = o; return o; }));
    const option = (label, key, sub) => {
      const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch__input', checked: MG[key], onchange: (e) => { MG[key] = e.target.checked; resetMigrateKeep(); paintMigrate(); } });
      v[key] = input;
      return h('label', { class: 'switch' }, input, h('span', { class: 'switch__track' }, h('i')), h('span', { class: 'switch__label' }, label, sub ? h('small', { class: 'muted', style: { display: 'block', fontWeight: 400 } }, sub) : null));
    };
    const resetMigrateKeep = () => { if (MG.phase === 'ready' || MG.phase === 'idle') { MG.done = new Set(); MG.phase = 'idle'; MG.msg = null; } };
    v.visitors = h('p', { class: 'visitors-box' }, '');
    v.plan = h('ol', { class: 'plan-steps', 'aria-label': 'Plan steps' });
    v.startBtn = button({ variant: 'primary', icon: 'arrow-right', onclick: startMigrate }, 'Start the practice move');
    v.nextBtn = button({ variant: 'glass', size: 'sm', onclick: () => MG.runner?.next() }, 'Next step');
    v.nextBtn.hidden = true;
    v.switchBtn = button({ variant: 'primary', icon: 'swap', onclick: switchVisitors }, 'Switch visitors to the new server');
    v.switchBtn.hidden = true;
    v.msg = h('p', { class: 'move-msg', role: 'status' }, '');
    v.runbook = h('div', {});
    const pickCard = card('Pick a made-up site', 'These are LRWeb\'s example businesses. Their domains end in .example, so nothing is real.',
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'site-pick' }, 'Site'), v.siteSelect),
      v.site,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'mig-target' }, 'Move it to'), v.targetSelect),
      h('div', { class: 'opt-list' },
        option('Copy the files', 'copyFiles'),
        option('Copy the database', 'copyDb'),
        option('Set up the padlock on the new server', 'ssl', 'Needed so visitors see a secure page')),
      v.warn);
    const planCard = card('Plan the move', 'Each step runs in order. Visitors keep using the old server until the switch.',
      v.visitors,
      v.plan,
      h('div', { class: 'btn-row' }, v.startBtn, v.nextBtn, v.switchBtn),
      v.msg,
      h('h3', { class: 'card__title', style: { fontSize: 'var(--fs-md)', marginTop: 'var(--s2)' } }, 'Runbook'),
      h('p', { class: 'muted footnote' }, 'The commands a person would follow, written out. Practice only.'),
      v.runbook);
    page.append(h('div', { class: 'practice' },
      pageHead('Move a website', 'Practise moving a made-up site to another server, step by step, with the risks shown.'),
      h('div', { class: 'mig-grid' }, pickCard, planCard)));
    paintMigrate();
    return () => { if (MG.view === v) MG.view = null; };
  }

  /* ================= 4. Dashboard teaser ================= */

  const PLANS = [
    { name: 'Essential', price: 29, count: 4 },
    { name: 'Plus', price: 49, count: 6, note: 'Most popular' },
    { name: 'Pro', price: 89, count: 2 },
  ];
  const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  const SERIES = [392, 421, 430, 455, 470, 498, 512, 531, 547, 560, 575, 588];

  function areaChart(values, months) {
    const W = 640;
    const H = 260;
    const L = 64;
    const R = 16;
    const T = 16;
    const B = 34;
    const top = Math.ceil((Math.max(...values) * 1.12) / 100) * 100;
    const x = (i) => L + (i / (values.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - v / top) * (H - T - B);
    const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const base = (H - B).toFixed(1);
    const area = `${line}L${x(values.length - 1).toFixed(1)},${base}L${x(0).toFixed(1)},${base}Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const val = Math.round(top * f);
      const yy = y(val).toFixed(1);
      return svg('g', {}, svg('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: 'grid-line' }),
        svg('text', { x: L - 10, y: yy, 'text-anchor': 'end', 'dominant-baseline': 'middle', class: 'axis' }, GBP.format(val)));
    });
    const labels = months.map((m, i) => (i % 2 === 1 || i === months.length - 1 ? svg('text', { x: x(i).toFixed(1), y: H - 10, 'text-anchor': 'middle', class: 'axis' }, m) : null));
    return svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Area chart of monthly income from care plans, demo data' },
      svg('defs', {}, svg('linearGradient', { id: 'dash-area', x1: 0, y1: 0, x2: 0, y2: 1 },
        svg('stop', { offset: 0, style: 'stop-color: var(--accent); stop-opacity: .45' }),
        svg('stop', { offset: 1, style: 'stop-color: var(--accent); stop-opacity: 0' }))),
      grid,
      svg('path', { d: area, fill: 'url(#dash-area)' }),
      svg('path', { d: line, fill: 'none', style: 'stroke: var(--accent); stroke-width: 2.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      svg('circle', { cx: x(values.length - 1).toFixed(1), cy: y(values[values.length - 1]).toFixed(1), r: 5, style: 'fill: var(--accent)' }),
      labels);
  }

  function mountDashboard(page) {
    const mrr = PLANS.reduce((sum, p) => sum + p.price * p.count, 0);
    const clients = PLANS.reduce((sum, p) => sum + p.count, 0);
    const mix = PLANS.map((p) => h('div', { class: 'plan-mix__row' },
      h('div', { class: 'plan-mix__top' }, h('strong', {}, p.name, p.note ? h('span', { class: 'muted', style: { fontWeight: 400, fontSize: 'var(--fs-xs)', marginLeft: '8px' } }, p.note) : null),
        h('span', {}, `${GBP.format(p.price)} a month, ${p.count} clients`)),
      h('div', { class: 'bar' }, h('i', { style: { width: `${((p.count / clients) * 100).toFixed(1)}%` } }))));
    page.append(h('div', { class: 'practice' },
      pageHead('Dashboard teaser', 'A sketch of what a business view could look like. Every number on this page is made up.'),
      h('div', { class: 'callout' }, icon('info', 18), h('p', {}, h('span', { class: 'sim-tag' }, 'Demo data'), ' These numbers are made up to show the layout. They are not LRWeb\'s figures. Care plan prices are the real ones: Essential, Plus and Pro.')),
      h('div', { class: 'dash-grid' },
        statTile('Clients on a care plan', COUNT.format(clients), 'Demo data'),
        statTile('Monthly from care plans', GBP.format(mrr), 'Demo data, a month'),
        statTile('Sites that answered their checks', '11 of 12', 'Demo data, this week'),
        statTile('Invoices waiting', '2', 'Demo data')),
      h('div', { class: 'dash-chart-grid' },
        card('Monthly from care plans', 'Last 12 months. Demo data.', h('div', { class: 'chart-wrap' }, areaChart(SERIES, MONTHS))),
        card('Care plan mix', 'Price per month for each plan. Demo data.', h('div', { class: 'plan-mix' }, mix),
          h('p', { class: 'footnote' }, ['Plans: ', Term('care plan', 'Care plan'), ' prices are the real Essential, Plus and Pro monthly prices.'])))));
    return undefined;
  }

  /* ================= 5. Ideas to practise next ================= */

  const IDEAS = [
    { id: 'backups', title: 'Automatic backups', body: 'Keep regular copies of each website and its database somewhere safe, so a broken update can be undone.' },
    { id: 'uptime', title: 'Uptime alerts', body: 'Get a message when a website stops answering, so you hear about it before a client does.' },
    { id: 'portal', title: 'Client portal', body: 'A page where each client sees their own care plan, their own site and their own invoices.' },
    { id: 'twostep', title: 'Two-step sign-in', body: 'A second check, such as a code on your phone, when someone signs in to the console.' },
    { id: 'pdf', title: 'Invoice PDFs', body: 'A tidy PDF copy of each invoice, ready to send or file away.' },
  ];

  function mountIdeas(page) {
    const votes = readStore(KEY.votes, {});
    const cards = IDEAS.map((idea) => {
      const cur = votes[idea.id] ?? null;
      const tally = h('p', { class: 'vote__tally', role: 'status' }, cur ? `You said ${cur === 'yes' ? 'yes' : 'no'}. Tap again to change.` : 'No answer yet.');
      const vote = (val) => {
        const next = votes[idea.id] === val ? null : val;
        if (next) votes[idea.id] = next; else delete votes[idea.id];
        writeStore(KEY.votes, votes);
        yes.setAttribute('aria-pressed', String(next === 'yes'));
        no.setAttribute('aria-pressed', String(next === 'no'));
        tally.textContent = next ? `You said ${next === 'yes' ? 'yes' : 'no'}. Tap again to change.` : 'No answer yet.';
      };
      const yes = button({ size: 'sm', variant: 'glass', icon: 'thumbs-up', onclick: () => vote('yes'), 'aria-label': `Yes, I would use ${idea.title}` }, 'Yes');
      const no = button({ size: 'sm', variant: 'glass', icon: 'thumbs-down', onclick: () => vote('no'), 'aria-label': `No, I would not use ${idea.title}` }, 'No');
      yes.setAttribute('aria-pressed', String(cur === 'yes'));
      no.setAttribute('aria-pressed', String(cur === 'no'));
      return h('article', { class: 'glass card idea' },
        h('span', { class: 'sim-tag' }, 'An idea, not built yet'),
        h('h2', {}, idea.title),
        h('p', {}, idea.body),
        h('div', { class: 'vote' },
          h('span', { class: 'field__label' }, 'Would you use this?'),
          h('div', { class: 'vote__buttons' }, yes, no),
          tally));
    });
    page.append(h('div', { class: 'practice' },
      pageHead('Ideas to practise next', 'Possible improvements, in plain English. Tell us which ones you would use. Nothing here is promised.'),
      h('div', { class: 'idea-grid' }, cards)));
    return undefined;
  }

  /* ================= shell, navigation and start page ================= */

  const VIEWS = [
    { id: 'start', label: 'Start here', icon: 'rocket', group: 'Practice', dock: true, mount: mountStart },
    { id: 'traffic', label: 'Traffic lab', icon: 'activity', group: 'Servers', dock: true, mount: mountTraffic },
    { id: 'migrate', label: 'Move a website', icon: 'swap', group: 'Servers', dock: true, mount: mountMigrate },
    { id: 'chat', label: 'Secure chat', icon: 'chat', group: 'Together', dock: true, mount: mountChat },
    { id: 'dashboard', label: 'Dashboard teaser', icon: 'dashboard', group: 'Business', mount: mountDashboard },
    { id: 'ideas', label: 'Ideas to practise', icon: 'sparkle', group: 'Ideas', mount: mountIdeas },
  ];

  const navList = $('#nav-list');
  for (const group of [...new Set(VIEWS.map((v) => v.group))]) {
    navList.append(h('li', { class: 'nav-group', 'aria-hidden': 'true' }, group));
    for (const v of VIEWS.filter((x) => x.group === group)) {
      navList.append(h('li', { 'data-dock': v.dock ? '1' : '0' },
        h('a', { class: 'nav-item', href: `#${v.id}`, 'data-nav': v.id, title: v.label }, icon(v.icon, 20), h('span', { class: 'nav-item__label' }, v.label))));
    }
  }

  // Phone dock: "More" opens a glass sheet with everything that does not fit on the dock.
  const moreSheet = h('div', { class: 'glass glass--thick more-sheet', id: 'more-sheet', hidden: true, role: 'menu', 'aria-label': 'More pages' },
    VIEWS.filter((v) => !v.dock).map((v) => h('a', { class: 'more-sheet__item', href: `#${v.id}`, 'data-nav': v.id, role: 'menuitem' }, icon(v.icon, 22), h('span', {}, v.label))));
  document.body.append(moreSheet);
  const moreBtn = h('button', { type: 'button', class: 'nav-item nav-more', 'aria-label': 'More pages', 'aria-expanded': 'false', 'aria-controls': 'more-sheet' },
    icon('more', 22), h('span', { class: 'nav-item__label' }, 'More'));
  navList.append(h('li', { class: 'nav-more-li' }, moreBtn));
  const setMore = (open) => { moreSheet.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); moreBtn.classList.toggle('is-active', open); };
  moreBtn.addEventListener('click', () => setMore(moreSheet.hidden));
  document.addEventListener('pointerdown', (e) => { if (!moreSheet.hidden && !moreSheet.contains(e.target) && !moreBtn.contains(e.target)) setMore(false); });
  moreSheet.addEventListener('click', (e) => { if (e.target.closest('a')) setMore(false); });

  const main = $('#main');
  let current = null;
  const currentId = () => {
    const id = location.hash.replace(/^#\/?/, '');
    return VIEWS.some((v) => v.id === id) ? id : 'start';
  };
  function navState(id) {
    document.querySelectorAll('.nav-item[data-nav], .more-sheet__item').forEach((a) => {
      const on = a.dataset.nav === id;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    moreBtn.classList.toggle('has-active', VIEWS.some((v) => !v.dock && v.id === id));
  }
  function route() {
    const view = VIEWS.find((v) => v.id === currentId());
    current?.cleanup?.();
    main.replaceChildren();
    const page = h('div', { class: 'view', 'data-view': view.id });
    main.append(page);
    current = { id: view.id, cleanup: view.mount(page) };
    setMore(false);
    navState(view.id);
    $('#topbar-page').textContent = view.label;
    document.title = `${view.label}: practice | LRWeb Console`;
    window.scrollTo(0, 0);
  }
  addEventListener('hashchange', route);
  $('#skip-link').addEventListener('click', () => main.focus());

  // Theme and Lite effects (same stored values as the real console's boot script).
  $('#toggle-theme').addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    writeRaw(KEY.theme, next);
  });
  const liteBtn = $('#toggle-lite');
  const paintLite = () => liteBtn.setAttribute('aria-pressed', String(root.dataset.fx === 'lite'));
  liteBtn.addEventListener('click', () => {
    const on = root.dataset.fx !== 'lite';
    root.dataset.fx = on ? 'lite' : 'full';
    writeRaw(KEY.fx, on ? 'lite' : 'full');
    paintLite();
    motionChanged();
  });
  paintLite();

  /* ----- start: welcome, missions and reset ----- */

  function resetPractice() {
    P.done = {};
    P.algos = [];
    saveProgress();
    writeStore(KEY.votes, {});
    TR.move?.runner?.cancel();
    TR.drill?.cancel();
    MG.runner?.cancel();
    TR = newTraffic();
    MG = newMigrate();
    CHAT = null;
    chatInit = null;
    toast('Practice reset', 'Missions, votes and every practice screen are back to the start.', 'ok');
    route();
  }

  function mountStart(page) {
    const list = h('ol', { class: 'mission-list', 'aria-label': 'Practice missions' });
    const ringBox = h('div', {});
    const summary = h('p', { class: 'num', role: 'status' }, '');
    const slot = {
      render() {
        const done = MISSIONS.filter((m) => isDone(m.id)).length;
        ringBox.replaceChildren(ring(Math.round((done / MISSIONS.length) * 100), `${done} of ${MISSIONS.length}`));
        summary.textContent = done === MISSIONS.length
          ? 'Every mission is done. Well practised.'
          : `${done} of ${MISSIONS.length} done. Each one ticks off by itself when you do it.`;
        list.replaceChildren(...MISSIONS.map((m, i) => {
          const finished = isDone(m.id);
          return h('li', { class: ['mission', finished && 'mission--done'] },
            h('span', { class: 'mission__mark' }, icon('check', 14), h('b', {}, String(i + 1))),
            h('span', { class: 'mission__text' }, h('span', {}, m.title), h('span', { class: 'mission__where' }, m.where)),
            h('a', { class: 'mission__go', href: `#${m.page}` }, finished ? 'Done' : 'Open'));
        }));
      },
    };
    missionSlots.add(slot);
    slot.render();
    page.append(h('div', { class: 'practice' },
      pageHead('Practice console', 'Welcome, Luke. Everything on these pages is pretend, so try anything.'),
      h('div', { class: 'start-grid' },
        card('How to practise', null,
          h('ul', { class: 'explainer', style: { paddingLeft: '1.2em', margin: 0, display: 'grid', gap: '8px', color: 'var(--ink-2)', fontSize: 'var(--fs-sm)' } },
            h('li', {}, 'Each page is a practice area with pretend data.'),
            h('li', {}, 'Breaking things here breaks nothing real. That is the point.'),
            h('li', {}, 'Things you do tick off the missions. Your progress is kept on this device.')),
          h('p', { class: 'footnote' }, 'Look for the ', Term('simulated', 'Simulated'), ' tags. They mark every step that only pretends.')),
        card('Practice missions', 'Seven things to try. Each one ticks off by itself.',
          h('div', { class: 'progress' }, ringBox, summary),
          list)),
      card('Where to go next', null,
        h('div', { class: 'dest-grid' },
          VIEWS.filter((v) => v.id !== 'start').map((v) => h('a', { class: 'dest', href: `#${v.id}` }, h('strong', {}, v.label), h('span', {}, DEST_HINT[v.id])))),
      ),
      card('Reset practice', 'Clears missions, votes and every practice screen. It cannot touch anything real.',
        button({ variant: 'ghost', icon: 'refresh', onclick: resetPractice }, 'Reset practice'))));
    return () => missionSlots.delete(slot);
  }

  const DEST_HINT = {
    traffic: 'Send visitors through a load balancer, break a server, and move traffic safely.',
    migrate: 'Move a made-up site to another server, one step at a time.',
    chat: 'Send end-to-end encrypted messages and try to break them.',
    dashboard: 'A demo of what a business view could show.',
    ideas: 'Possible improvements. Tell us which you would use.',
  };

  /* ----- boot ----- */

  loadProgress();
  motionChanged();
  route();
})();
