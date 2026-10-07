// UI controller: HUD, chat, toasts, debug screen, overlays and screen management.
import { ITEMS } from '../shared/items.js';
import { BLOCKS } from '../shared/blocks.js';
import { images, canvas } from '../engine/textures.js';
import { iconStyle } from './icons.js';
import { Screens } from './screens.js';
import { Menus } from './menus.js';
import { Touch } from './touch.js';

const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
export { el };

// "§a" colour codes -> spans
const CODES = { 0: '#000', 1: '#00a', 2: '#0a0', 3: '#0aa', 4: '#a00', 5: '#a0a', 6: '#fa0', 7: '#aaa', 8: '#555', 9: '#55f', a: '#5f5', b: '#5ff', c: '#f55', d: '#f5f', e: '#ff5', f: '#fff' };
export function fmt(text, color) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const parts = String(text).split('§');
  let out = `<span style="color:${color || '#fff'}">${esc(parts[0])}</span>`;
  for (let i = 1; i < parts.length; i++) {
    const c = CODES[parts[i][0]];
    out += `<span style="color:${c || '#fff'}">${esc(parts[i].slice(1))}</span>`;
  }
  return out;
}

export function slotHTML(stack) {
  if (!stack) return '';
  const it = ITEMS[stack.id];
  let h = `<div class="icon" style="${iconStyle(stack.id)}"></div>`;
  if (stack.count > 1) h += `<span class="count">${stack.count}</span>`;
  if (it && it.durability && stack.dmg > 0) {
    const f = 1 - stack.dmg / it.durability;
    const col = `hsl(${Math.round(f * 120)},100%,45%)`;
    h += `<div class="dura"><i style="width:${Math.round(f * 13) / 13 * 100}%;background:${col}"></i></div>`;
  }
  return h;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.screenOpen = false;
    this.chatOpen = false;
    this.hideHud = false;
    this.debug = false;
    this.openTile = null;
    this.game = null;
    this.buildHudIcons();
    this.buildHud();
    this.screens = new Screens(this);
    this.menus = new Menus(this);
    this.touch = new Touch(this);
    this.applyScale();
    window.addEventListener('resize', () => this.applyScale());
    this.fpsFrames = 0; this.fpsTime = 0; this.fps = 0;
    this.hudCache = {};
  }

  applyScale() {
    const s = this.app.settings.guiScale;
    const w = window.innerWidth, h = window.innerHeight;
    let auto = Math.max(1, Math.min(Math.floor(w / 320), Math.floor(h / 240)));
    auto = Math.min(auto, 4);
    // phones and small windows: a fractional scale keeps things big enough to tap
    const touch = this.touch && this.touch.enabled;
    if (touch || w < 700 || h < 500) auto = Math.max(auto, Math.floor(Math.min(w / 300, h / 225) * 4) / 4);
    let scale = s ? Math.min(s, auto + 1) : auto;
    if (182 * scale > w * 0.98) scale = (w * 0.98) / 182;
    if (176 * scale > w * 0.98 || 172 * scale > h) scale = Math.min((w * 0.98) / 176, h / 172);
    this.root.classList.toggle('touch', !!touch);
    this.scale = scale;
    document.documentElement.style.setProperty('--s', scale + 'px');
  }

  // ---------------------------------------------------------------- HUD icons (hearts etc.)
  buildHudIcons() {
    const outline = (img, fillCol, half) => {
      const c = canvas(9, 9), g = c.getContext('2d');
      g.drawImage(img, 0, 0, 9, 9);
      const d = g.getImageData(0, 0, 9, 9), p = d.data;
      const a = (x, y) => (x < 0 || y < 0 || x > 8 || y > 8 ? 0 : p[(y * 9 + x) * 4 + 3]);
      const src = new Uint8ClampedArray(p);
      for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
        const i = (y * 9 + x) * 4;
        if (!src[i + 3]) continue;
        const edge = !a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1);
        if (half !== undefined && x < 5 && half) continue; // keep the original (filled) left half
        if (edge) { p[i] = p[i + 1] = p[i + 2] = 0; }
        else { p[i] = fillCol[0]; p[i + 1] = fillCol[1]; p[i + 2] = fillCol[2]; }
        p[i + 3] = 255;
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL();
    };
    const full = (img) => { const c = canvas(9, 9); c.getContext('2d').drawImage(img, 0, 0, 9, 9); return c.toDataURL(); };
    const heart = images['gui/heart'], food = images['gui/hunger'], bubble = images['gui/bubble'];
    const armorImg = canvas(9, 9);
    {
      const g = armorImg.getContext('2d');
      const art = [
        '.XX...XX.',
        'XLLXXXLLX',
        'XLLLLLLDX',
        '.XLLLLLX.',
        '.XLLLLDX.',
        '.XLLLLDX.',
        '.XLLLLDX.',
        '.XLDDDDX.',
        '..XXXXX..',
      ];
      const col = { X: '#2b2b2b', L: '#dcdcdc', D: '#8f8f8f' };
      art.forEach((row, y) => [...row].forEach((ch, x) => { if (col[ch]) { g.fillStyle = col[ch]; g.fillRect(x, y, 1, 1); } }));
    }
    this.hudIcons = {
      heart: full(heart), heartHalf: outline(heart, [40, 40, 40], true), heartEmpty: outline(heart, [40, 40, 40]),
      heartFlash: outline(heart, [240, 240, 240]),
      food: full(food), foodHalf: outline(food, [40, 40, 40], true), foodEmpty: outline(food, [40, 40, 40]),
      armor: full(armorImg), armorHalf: outline(armorImg, [50, 50, 50], true), armorEmpty: outline(armorImg, [50, 50, 50]),
      bubble: full(bubble),
    };
    const root = document.documentElement.style;
    root.setProperty('--hotbar', `url(${images['gui/hotbar'].toDataURL()})`);
    root.setProperty('--hotbar-sel', `url(${images['gui/hotbar_selected'].toDataURL()})`);
    const tile = (n, dark) => { const c = canvas(16, 16), g = c.getContext('2d'); g.drawImage(images[n], 0, 0, 16, 16, 0, 0, 16, 16); if (dark) { g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, 0, 16, 16); } return `url(${c.toDataURL()})`; };
    root.setProperty('--dirt', tile('block/dirt'));
    root.setProperty('--stone', tile('block/stone'));
  }

  buildHud() {
    const hud = el('div', '', this.root);
    hud.id = 'hud';
    hud.classList.add('hidden');
    this.hud = hud;
    el('div', '', hud).id = 'vignette';
    this.damageEl = el('div', '', hud); this.damageEl.id = 'damage';
    this.lowhpEl = el('div', '', hud); this.lowhpEl.id = 'lowhp';
    this.waterEl = el('div', '', hud); this.waterEl.id = 'water';
    this.fireEl = el('div', '', hud); this.fireEl.id = 'fireov';
    this.crosshair = el('div', '', hud); this.crosshair.id = 'crosshair';
    this.hotbar = el('div', '', hud); this.hotbar.id = 'hotbar';
    this.hbSlots = [];
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'hb', this.hotbar);
      s.style.left = `calc(${3 + i * 20} * var(--s))`;
      s.addEventListener('pointerdown', (e) => { if (this.game) { this.game.player.inv.selected = i; e.stopPropagation(); } });
      this.hbSlots.push(s);
    }
    this.hbSel = el('div', '', this.hotbar); this.hbSel.id = 'hb-sel';
    const stats = el('div', '', hud); stats.id = 'stats';
    const row = (id) => {
      const r = el('div', 'row9', stats); r.id = id;
      const fromRight = id === 'food' || id === 'air';
      const items = [];
      for (let i = 0; i < 10; i++) { const x = el('i', '', r); x.style[fromRight ? 'right' : 'left'] = `calc(${i * 8} * var(--s))`; items.push(x); }
      return items;
    };
    this.hearts = row('hearts'); this.armorRow = row('armor'); this.foodRow = row('food'); this.airRow = row('air');
    const xp = el('div', '', hud); xp.id = 'xp';
    this.xpFill = el('i', '', xp); this.xpLevel = el('b', '', xp);
    this.itemName = el('div', 't', hud); this.itemName.id = 'itemname';
    this.actionEl = el('div', 't', hud); this.actionEl.id = 'actionbar';
    const chat = el('div', '', this.root); chat.id = 'chat';
    this.chatEl = chat;
    this.chatLog = el('div', '', chat); this.chatLog.id = 'chatlog';
    this.chatInput = el('input', 'hidden', chat); this.chatInput.id = 'chatinput';
    this.chatInput.maxLength = 256;
    this.chatInput.addEventListener('keydown', (e) => this.chatKey(e));
    this.toasts = el('div', '', this.root); this.toasts.id = 'toasts';
    this.debugL = el('div', 't hidden', hud); this.debugL.id = 'debug';
    this.debugR = el('div', 't hidden', hud); this.debugR.id = 'debugR';
    this.fpsEl = el('div', 't hidden', hud); this.fpsEl.id = 'fps';
    this.sleepEl = el('div', '', this.root); this.sleepEl.id = 'sleep';
    this.history = [];
    this.histIdx = -1;
  }

  // ---------------------------------------------------------------- game hooks
  onGameStart(game) {
    this.game = game;
    this.hud.classList.remove('hidden');
    this.menus.hideAll();
    this.refreshHud();
    this.touch.onGameStart();
  }
  onGameStop() {
    this.game = null;
    this.hud.classList.add('hidden');
    this.closeScreen(true);
    this.chatLog.innerHTML = '';
    this.toasts.innerHTML = '';
    this.sleepEl.style.opacity = 0;
    this.touch.onGameStop();
  }

  refreshHud() { this.hudCache = {}; }

  frame(game, dt) {
    const p = game.player;
    this.hud.classList.toggle('creative', p.mode !== 'survival');
    this.hud.style.visibility = this.hideHud ? 'hidden' : '';
    // hotbar
    const inv = p.inv;
    for (let i = 0; i < 9; i++) {
      const s = inv.slots[i];
      const key = s ? `${s.id}:${s.count}:${s.dmg}` : '';
      if (this.hudCache['hb' + i] !== key) { this.hudCache['hb' + i] = key; this.hbSlots[i].innerHTML = slotHTML(s); }
    }
    this.hbSel.style.left = `calc(${inv.selected * 20 - 1} * var(--s))`;
    this.hotbar.style.display = p.mode === 'spectator' ? 'none' : '';
    // held item name popup
    const held = inv.held;
    const hk = held ? held.id + ':' + inv.selected : 'none:' + inv.selected;
    if (hk !== this.lastHeldKey) {
      this.lastHeldKey = hk;
      this.itemName.textContent = held ? ITEMS[held.id].display : '';
      this.itemNameTime = 2.2;
    }
    this.itemNameTime = (this.itemNameTime || 0) - dt;
    this.itemName.style.opacity = this.itemNameTime > 0 ? Math.min(1, this.itemNameTime * 2) : 0;
    this.actionTime = (this.actionTime || 0) - dt;
    this.actionEl.style.opacity = this.actionTime > 0 ? Math.min(1, this.actionTime) : 0;
    if (p.mode === 'survival') this.updateStats(game, dt);
    // overlays
    this.lowhpEl.style.opacity = p.mode === 'survival' && p.health <= 4 && !p.dead ? 0.6 + Math.sin(game.clock * 6) * 0.2 : 0;
    this.fireEl.style.opacity = p.fire > 0 && !p.creative && !p.inWater ? 0.6 + Math.sin(game.clock * 20) * 0.2 : 0;
    this.waterEl.style.opacity = p.eyeInWater ? 1 : 0;
    this.sleepEl.style.opacity = p.sleeping ? Math.min(1, game.sleepTimer / 80) : 0;
    // chat fade
    const now = performance.now();
    for (const d of this.chatLog.children) {
      const age = (now - d._t) / 1000;
      d.style.opacity = age > 10 ? Math.max(0, 1 - (age - 10)) : 1;
    }
    if (this.debug) this.updateDebug(game, dt);
    this.fpsFrames++; this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }
    this.fpsEl.classList.toggle('hidden', !this.app.settings.showFps || this.debug);
    if (this.app.settings.showFps) this.fpsEl.textContent = this.fps + ' fps';
    if (this.screenOpen) this.screens.frame(game, dt);
    this.touch.frame(game);
  }

  updateStats(game, dt) {
    const p = game.player, I2 = this.hudIcons;
    const c = game.clock;
    // write a style property only when it changes (keeps per-frame DOM work tiny)
    const css = (e, k, v) => { if (e['_' + k] !== v) { e['_' + k] = v; e.style[k] = v; } };
    const img = (e, src) => { if (e._src !== src) { e._src = src; e.style.backgroundImage = `url(${src})`; } };
    // hearts with low-health jitter, hurt flash and the regeneration wave
    const hp = Math.ceil(p.health);
    const flash = p.hurtTime > 0 && p.hurtTime % 4 < 2;
    const regenWave = p.regenTimer === 0 && p.health < p.maxHealth && p.food >= 18 ? Math.floor(c * 20) % 15 : -1;
    for (let i = 0; i < 10; i++) {
      const e = this.hearts[i];
      const v = hp - i * 2;
      img(e, v >= 2 ? I2.heart : v === 1 ? I2.heartHalf : (flash ? I2.heartFlash : I2.heartEmpty));
      let dy = 0;
      if (p.health <= 4) dy = Math.round(Math.sin(c * 30 + i * 7.1) * 1.2);
      if (regenWave === i) dy -= 2;
      css(e, 'transform', dy ? `translateY(${dy * this.scale}px)` : '');
    }
    // food (right to left) with jitter when saturation is empty
    for (let i = 0; i < 10; i++) {
      const e = this.foodRow[i];
      const v = p.food - i * 2;
      img(e, v >= 2 ? I2.food : v === 1 ? I2.foodHalf : I2.foodEmpty);
      const dy = p.saturation <= 0 && Math.floor(c * 20) % (p.food * 3 + 1) === 0 ? Math.round(Math.random() * 2 - 1) : 0;
      css(e, 'transform', dy ? `translateY(${dy * this.scale}px)` : '');
      css(e, 'filter', p.hungerEffect > 0 ? 'hue-rotate(60deg) saturate(0.7)' : '');
    }
    // armour
    const ap = p.inv.armorPoints();
    for (let i = 0; i < 10; i++) {
      const e = this.armorRow[i];
      css(e, 'display', ap > 0 ? '' : 'none');
      const v = ap - i * 2;
      img(e, v >= 2 ? I2.armor : v === 1 ? I2.armorHalf : I2.armorEmpty);
    }
    // air bubbles
    const showAir = p.eyeInWater || p.air < 300;
    const bubbles = Math.ceil(Math.max(0, p.air) / 30);
    for (let i = 0; i < 10; i++) {
      const e = this.airRow[i];
      css(e, 'display', showAir && i < bubbles ? '' : 'none');
      img(e, I2.bubble);
    }
    css(this.xpFill, 'width', (p.xp * 100).toFixed(1) + '%');
    const lv = p.level > 0 ? String(p.level) : '';
    if (this.xpLevel.textContent !== lv) this.xpLevel.textContent = lv;
    void dt;
  }

  updateDebug(game, dt) {
    const p = game.player, w = game.world;
    if ((this.dbgT = (this.dbgT || 0) - dt) > 0) return;
    this.dbgT = 0.15;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const dirs = ['south (Towards positive Z)', 'west (Towards negative X)', 'north (Towards negative Z)', 'east (Towards positive X)'];
    const l = w.getLight(bx, by, bz);
    const t = game.interaction.target;
    const yawDeg = (((-p.yaw * 180 / Math.PI) % 360) + 540) % 360 - 180;
    const left = [
      `BlockCraft 1.0 (${this.fps} fps)`,
      `C: ${w.loadedCount()} loaded, ${w.inflightGen} gen, ${w.inflightMesh} mesh  E: ${game.entities.list.length}`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by} ${bz}`,
      `Chunk: ${bx & 15} ${by & 15} ${bz & 15} in ${bx >> 4} ${by >> 4} ${bz >> 4}`,
      `Facing: ${dirs[p.facing()]} (${yawDeg.toFixed(1)} / ${(-p.pitch * 180 / Math.PI).toFixed(1)})`,
      `Light: ${Math.max(l & 15, (l >> 4) - game.skyDarken())} (${l >> 4} sky, ${l & 15} block)`,
      `Biome: ${w.biomeAt(bx, bz).name}`,
      `Local Difficulty: ${game.difficultyName}  Day ${game.day}  Time ${Math.floor(game.time)}`,
      `Weather: ${game.weather.thunder ? 'thunder' : game.weather.rain ? 'rain' : 'clear'}`,
    ];
    const right = [
      `JS heap: ${performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : 'n/a'}`,
      `Render distance: ${w.renderDistance}`,
      `Display: ${innerWidth}x${innerHeight} @${this.app.renderer.pixelRatio.toFixed(2)}`,
      `Draw calls: ${this.app.renderer.gl.info.render.calls}  Tris: ${(this.app.renderer.gl.info.render.triangles / 1000).toFixed(0)}k`,
      '',
    ];
    if (t) {
      const b = BLOCKS[t.id];
      right.push(`Targeted Block: ${t.x}, ${t.y}, ${t.z}`, `blockcraft:${b.name}`, t.meta ? `state: ${t.meta}` : '');
    }
    this.debugL.innerHTML = left.map((s) => (s ? `<div>${s}</div>` : '<br>')).join('');
    this.debugR.innerHTML = right.map((s) => (s ? `<div>${s}</div>` : '<br>')).join('');
  }

  toggleDebug() {
    this.debug = !this.debug;
    this.debugL.classList.toggle('hidden', !this.debug);
    this.debugR.classList.toggle('hidden', !this.debug);
  }

  // ---------------------------------------------------------------- messages
  chatMessage(text, color) {
    const d = el('div', 't', this.chatLog, fmt(text, color));
    d._t = performance.now();
    while (this.chatLog.children.length > 100) this.chatLog.firstChild.remove();
  }
  actionBar(text) {
    this.actionEl.innerHTML = fmt(text);
    this.actionTime = 3;
  }
  flashDamage() {
    this.damageEl.style.transition = 'none';
    this.damageEl.style.opacity = 0.9;
    requestAnimationFrame(() => { this.damageEl.style.transition = 'opacity 0.6s'; this.damageEl.style.opacity = 0; });
  }
  toast(a) {
    const t = el('div', 'toast', this.toasts);
    const id = ITEMS.find((it) => it && it.name === a.icon)?.id;
    t.innerHTML = `<div class="ti"><div class="icon" style="${iconStyle(id)}"></div></div><div class="tt">Advancement Made!</div><div class="td">${a.title}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('in')));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 600); }, 5000);
  }

  // ---------------------------------------------------------------- chat input
  openChat(prefix = '') {
    if (!this.game) return;
    this.chatOpen = true;
    this.chatEl.classList.add('open');
    this.chatInput.classList.remove('hidden');
    this.chatInput.value = prefix;
    this.app.input.unlock();
    setTimeout(() => { this.chatInput.focus(); this.chatInput.setSelectionRange(prefix.length, prefix.length); }, 0);
    this.histIdx = this.history.length;
  }
  closeChat() {
    this.chatOpen = false;
    this.chatEl.classList.remove('open');
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
    if (this.game && !this.screenOpen) this.app.lockPointer();
  }
  chatKey(e) {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const v = this.chatInput.value.trim();
      if (v) {
        this.history.push(v);
        if (v.startsWith('/')) this.game.command(v);
        else this.chatMessage(`<${this.app.settings.playerName || 'Player'}> ${v}`);
      }
      this.closeChat();
    } else if (e.key === 'Escape') { e.preventDefault(); this.closeChat(); }
    else if (e.key === 'ArrowUp') { this.histIdx = Math.max(0, this.histIdx - 1); this.chatInput.value = this.history[this.histIdx] || ''; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { this.histIdx = Math.min(this.history.length, this.histIdx + 1); this.chatInput.value = this.history[this.histIdx] || ''; e.preventDefault(); }
  }

  // ---------------------------------------------------------------- screens
  openInventory() { if (this.game.player.mode === 'creative') this.screens.open('creative'); else this.screens.open('inventory'); this.game.advance('inventory'); }
  openCrafting() { this.screens.open('crafting'); }
  openFurnace(t) { this.openTile = t; this.screens.open('furnace', t); }
  openChest(t) { this.openTile = t; this.screens.open('chest', t); }
  closeScreen(silent) {
    if (!this.screenOpen) return;
    const t = this.openTile;
    this.screens.close();
    this.openTile = null;
    if (t && t.type === 'chest' && this.game && !silent) this.game.sound.play('chest.close', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.6);
    if (this.game && !silent) this.app.lockPointer();
  }

  // ---------------------------------------------------------------- death
  showDeath(msg, score) { this.menus.showDeath(msg, score); }
  hideDeath() { this.menus.hideAll(); this.app.lockPointer(); }
}
