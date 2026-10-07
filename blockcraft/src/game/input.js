// Keyboard / mouse input with pointer lock. Touch controls write into the same fields.
export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', chat: 'KeyT', command: 'Slash', perspective: 'F5', debug: 'F3', hideHud: 'F1',
  swap: 'KeyF', pause: 'Escape', screenshot: 'F2',
};

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0; this.mouseDY = 0;
    this.buttons = 0;
    this.clicks = new Set(); // mouse buttons pressed this frame
    this.releases = new Set();
    this.wheel = 0;
    this.locked = false;
    this.binds = { ...DEFAULT_KEYS };
    this.onKey = null; // (e) => bool handled (UI hook)
    this.lastW = 0; // double tap W to sprint
    this.sprintTap = false;
    this.lastSpace = 0;
    this.doubleSpace = false;
    // touch state (filled by the touch UI)
    this.touch = { active: false, mx: 0, my: 0, lookDX: 0, lookDY: 0, jump: false, sneak: false, sprint: false, attack: false, use: false, flyUp: false, flyDown: false };

    window.addEventListener('keydown', (e) => {
      if (this.onKey && this.onKey(e)) return;
      if (e.code === 'Tab' || e.code === 'F1' || e.code === 'F3' || e.code === 'F5' || (e.code === 'Space' && this.locked)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === this.binds.forward) {
        const now = performance.now();
        if (now - this.lastW < 300) this.sprintTap = true;
        this.lastW = now;
      }
      if (e.code === this.binds.jump) {
        const now = performance.now();
        if (now - this.lastSpace < 280) this.doubleSpace = true;
        this.lastSpace = now;
      }
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === this.binds.forward) this.sprintTap = false;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons = 0; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.keys.clear(); this.buttons = 0; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // ignore giant spikes some browsers send on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons |= 1 << e.button;
      this.clicks.add(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      this.buttons &= ~(1 << e.button);
      this.releases.add(e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => {
      if (!this.locked) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
  }

  lock() {
    if (this.touch.active) return;
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.el.requestPointerLock(); } catch (e) { /* ignore */ } });
    } catch (e) {
      try { this.el.requestPointerLock(); } catch (e2) { /* ignore */ }
    }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  down(action) { return this.keys.has(this.binds[action]) || (action === 'sneak' && this.keys.has('ShiftRight')) || (action === 'sprint' && this.keys.has('ControlRight')); }
  hit(action) { return this.pressed.has(this.binds[action]); }
  hitCode(code) { return this.pressed.has(code); }
  mouse(btn) { return (this.buttons & (1 << btn)) !== 0; }

  endFrame() {
    this.pressed.clear();
    this.clicks.clear();
    this.releases.clear();
    this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0;
    this.doubleSpace = false;
    this.touch.lookDX = 0; this.touch.lookDY = 0;
  }
}
