// On-screen controls for touch devices.
import { el } from './ui.js';

const SVG = {
  jump: '<svg viewBox="0 0 24 24"><path d="M6 14l6-6 6 6"/><path d="M12 8v11"/></svg>',
  sneak: '<svg viewBox="0 0 24 24"><path d="M6 10l6 6 6-6"/><path d="M12 16V5"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7"/></svg>',
  inv: '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="12" rx="1"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M5 6h14v9H10l-4 3v-3H5z"/></svg>',
  drop: '<svg viewBox="0 0 24 24"><path d="M12 4v10M8 10l4 4 4-4"/><path d="M6 19h12"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z"/></svg>',
};

export class Touch {
  constructor(ui) {
    this.ui = ui;
    this.root = el('div', 'hidden', ui.root);
    this.root.id = 'touch';
    this.enabled = false;
    this.build();
    this.update();
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && this.ui.app.settings.touch === 'auto' && !this.enabled) { this.update(true); } }, true);
  }
  get input() { return this.ui.app.input; }

  update(force) {
    const s = this.ui.app.settings.touch;
    const coarse = force || (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
    this.enabled = s === 'on' || (s === 'auto' && coarse);
    this.input.touch.active = this.enabled;
    this.root.classList.toggle('hidden', !this.enabled || !this.ui.game);
  }
  onGameStart() { this.update(); }
  onGameStop() { this.root.classList.add('hidden'); }

  btn(cls, svg, x, y, opts = {}) {
    const b = el('div', 'tb ' + cls, this.root, svg);
    b.style[opts.left ? 'left' : 'right'] = `calc(${x} * var(--s))`;
    b.style[opts.top ? 'top' : 'bottom'] = `calc(${y} * var(--s))`;
    return b;
  }

  build() {
    const t = this.input.touch;
    const look = el('div', 'look', this.root);
    const ptrs = new Map();
    look.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      look.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: 0, hold: null });
      const p = ptrs.get(e.pointerId);
      p.hold = setTimeout(() => { if (p.moved < 14) { p.mining = true; t.attack = true; } }, 260);
    });
    look.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.sx, e.clientY - p.sy));
      const k = 1.6;
      t.lookDX += dx * k; t.lookDY += dy * k;
    });
    const end = (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      clearTimeout(p.hold);
      ptrs.delete(e.pointerId);
      if (p.mining) { t.attack = false; return; }
      if (performance.now() - p.t < 260 && p.moved < 14) {
        // quick tap: hit a mob, otherwise place / use
        const g = this.ui.game;
        if (g && g.interaction.targetEntity) { t.attack = true; setTimeout(() => { t.attack = false; }, 130); }
        else { t.use = true; setTimeout(() => { t.use = false; }, 130); }
      }
    };
    look.addEventListener('pointerup', end);
    look.addEventListener('pointercancel', end);

    // joystick
    const stick = el('div', 'stick', this.root);
    const knob = el('div', 'knob', stick);
    let sid = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (e.clientY - cy) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      t.mx = Math.abs(dx) < 0.15 ? 0 : dx;
      t.my = Math.abs(dy) < 0.15 ? 0 : dy;
      t.sprint = dy < -0.92;
      knob.style.transform = `translate(${dx * r.width * 0.35}px, ${dy * r.height * 0.35}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(e.pointerId); move(e); e.stopPropagation(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e); });
    const stop = (e) => { if (e.pointerId !== sid) return; sid = null; t.mx = t.my = 0; t.sprint = false; knob.style.transform = ''; };
    stick.addEventListener('pointerup', stop);
    stick.addEventListener('pointercancel', stop);

    const hold = (b, key) => {
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); b.setPointerCapture(e.pointerId); t[key] = true; b.classList.add('on'); });
      const up = () => { t[key] = false; b.classList.remove('on'); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    };
    const tap = (b, fn) => b.addEventListener('pointerdown', (e) => { e.stopPropagation(); fn(); });
    this.jumpBtn = this.btn('jump', SVG.jump, 22, 36);
    let lastJump = 0;
    this.jumpBtn.addEventListener('pointerdown', () => {
      const now = performance.now();
      const g = this.ui.game;
      if (g && now - lastJump < 300 && (g.player.creative || g.player.mode === 'spectator')) g.player.flying = !g.player.flying;
      lastJump = now;
    });
    hold(this.jumpBtn, 'jump');
    this.sneakBtn = this.btn('sneak', SVG.sneak, 52, 30);
    tap(this.sneakBtn, () => { t.sneak = !t.sneak; this.sneakBtn.classList.toggle('on', t.sneak); });
    this.upBtn = this.btn('up', SVG.up, 22, 66);
    hold(this.upBtn, 'flyUp');
    this.downBtn = this.btn('down', SVG.down, 52, 60);
    hold(this.downBtn, 'flyDown');
    const inv = this.btn('inv', SVG.inv, 6, 6, { top: true });
    tap(inv, () => { const ui = this.ui; if (ui.screenOpen) ui.closeScreen(); else if (ui.game) ui.openInventory(); });
    const pause = this.btn('pause', SVG.pause, 36, 6, { top: true });
    tap(pause, () => this.ui.app.pause());
    const chat = this.btn('chat', SVG.chat, 66, 6, { top: true });
    tap(chat, () => this.ui.openChat(''));
    const drop = this.btn('drop', SVG.drop, 96, 6, { top: true });
    tap(drop, () => this.ui.game && this.ui.game.dropHeld(false));
    const cam = this.btn('cam', SVG.cam, 126, 6, { top: true });
    tap(cam, () => { const g = this.ui.game; if (g) g.camMode = (g.camMode + 1) % 3; });
  }

  frame(game) {
    if (!this.enabled) return;
    const p = game.player;
    const fly = p.flying;
    this.upBtn.style.display = fly ? '' : 'none';
    this.downBtn.style.display = fly ? '' : 'none';
    this.sneakBtn.style.display = fly ? 'none' : '';
    this.root.style.visibility = this.ui.screenOpen || this.ui.menus.visible() ? 'hidden' : '';
  }
}
