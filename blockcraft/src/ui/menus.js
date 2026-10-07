// Title screen, world selection, world creation, options, pause, death and info screens.
import { el } from './ui.js';
import { ADVANCEMENTS } from '../game/advancements.js';
import { ITEMS } from '../shared/items.js';
import { iconStyle } from './icons.js';

const SPLASHES = [
  'Also try the real thing!', 'Punch trees!', 'One HTML file!', 'Works offline!', '100% blocks!', 'Now with creepers!',
  'Mind the creeper!', 'Diamonds!', 'Shiny tools!', 'Pixel perfect!', 'Infinite worlds!', 'Crafting recipes!', 'Bake a cake!',
  'Build a house!', 'Tame a wolf!', 'Lava is hot!', 'Don\'t dig straight down!', 'Torches everywhere!', 'Sheep come in many colours!',
  'Made with three.js!', 'Smooth lighting!', 'Fluid physics!', 'Biomes!', 'Sleep through the night!', 'Moon phases!',
  'Watch out for endermen!', 'Bring a bucket!', 'Explore caves!', 'Find a dungeon!', 'Breed animals!', 'Farm wheat!',
];

export class Menus {
  constructor(ui) {
    this.ui = ui;
    this.root = el('div', 'hidden', ui.root);
    this.root.id = 'menu';
    this.stack = [];
    window.addEventListener('keydown', (e) => {
      if (this.root.classList.contains('hidden')) return;
      if (e.key === 'Escape' && this.back) { e.preventDefault(); e.stopPropagation(); this.click(); this.back(); }
    }, true);
  }
  get app() { return this.ui.app; }
  click() { this.app.sound.click(); }

  clear(bg = 'dirt') {
    this.root.innerHTML = '';
    this.root.className = bg;
    this.back = null;
    return this.root;
  }
  hideAll() { this.root.classList.add('hidden'); this.root.innerHTML = ''; this.back = null; }
  visible() { return !this.root.classList.contains('hidden'); }

  btn(parent, label, fn, cls = '') {
    const b = el('button', 'btn ' + cls, parent);
    b.textContent = label;
    b.addEventListener('click', (e) => { e.stopPropagation(); this.click(); fn(b); });
    return b;
  }
  title(parent, text) { const t = el('div', 't mtitle', parent); t.textContent = text; return t; }

  slider(parent, label, min, max, step, value, fmt, onChange) {
    const s = el('div', 'slider', parent);
    const knob = el('i', '', s);
    const txt = el('span', '', s);
    const set = (v) => {
      v = Math.round(Math.max(min, Math.min(max, v)) / step) * step;
      knob.style.left = `calc(${(v - min) / (max - min)} * (100% - 8 * var(--s)) + 4 * var(--s))`;
      txt.textContent = `${label}: ${fmt(v)}`;
      return v;
    };
    let cur = set(value);
    const drag = (e) => {
      const r = s.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      const v = set(min + f * (max - min));
      if (v !== cur) { cur = v; onChange(v); }
    };
    s.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      s.setPointerCapture(e.pointerId);
      drag(e);
      const mv = (ev) => drag(ev);
      s.addEventListener('pointermove', mv);
      s.addEventListener('pointerup', () => { s.removeEventListener('pointermove', mv); this.app.saveSettings(); }, { once: true });
    });
    return s;
  }
  toggle(parent, label, values, idx, onChange, names) {
    const b = this.btn(parent, '', () => {
      idx = (idx + 1) % values.length;
      b.textContent = `${label}: ${(names || values)[idx]}`;
      onChange(values[idx]);
      this.app.saveSettings();
    });
    b.textContent = `${label}: ${(names || values)[idx]}`;
    return b;
  }

  // ---------------------------------------------------------------- title
  showTitle() {
    const r = this.clear('');
    r.classList.remove('hidden');
    const logo = el('div', 'logo', r);
    logo.innerHTML = '<span>BLOCKCRAFT</span><small>Survival Edition</small>';
    const sp = el('div', 'splash', logo);
    sp.textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    this.btn(r, 'Singleplayer', () => this.showWorlds());
    this.btn(r, 'How to Play', () => this.showHelp(() => this.showTitle()));
    const row = el('div', 'btnrow', r);
    this.btn(row, 'Options...', () => this.showOptions(() => this.showTitle()), 'half');
    this.btn(row, 'Credits', () => this.showCredits(), 'half');
    const foot = el('div', 'foot t', r);
    foot.innerHTML = `<span>BlockCraft 1.0</span><span>Textures &amp; sounds: Mineclonia / Pixel Perfection (CC BY-SA)</span>`;
  }

  // ---------------------------------------------------------------- worlds
  async showWorlds() {
    const r = this.clear();
    r.classList.remove('hidden');
    this.back = () => this.showTitle();
    this.title(r, 'Select World');
    const list = el('div', 'worlds', r);
    const worlds = await this.app.store.listWorlds();
    let sel = worlds[0] ? worlds[0].id : null;
    const items = [];
    if (!worlds.length) {
      const e = el('div', 't', list);
      e.style.padding = 'calc(10 * var(--s))'; e.style.textAlign = 'center'; e.style.color = '#a0a0a0';
      e.textContent = 'No worlds yet. Create one!';
    }
    for (const w of worlds) {
      const row = el('div', 'world', list);
      const img = w.thumb ? `<img src="${w.thumb}" alt="">` : '<div class="noimg"></div>';
      const date = w.lastPlayed ? new Date(w.lastPlayed).toLocaleString() : 'never';
      row.innerHTML = `${img}<div><div class="t wn">${escapeHTML(w.name)}</div><div class="t wd">${date}</div><div class="t wd">${capital(w.mode || 'survival')} Mode, seed ${escapeHTML(String(w.seed))}</div></div>`;
      row.addEventListener('click', () => { sel = w.id; items.forEach((x) => x.classList.toggle('sel', x === row)); upd(); });
      row.addEventListener('dblclick', () => this.app.playWorld(w.id));
      if (w.id === sel) row.classList.add('sel');
      items.push(row);
    }
    const row1 = el('div', 'btnrow', r);
    const play = this.btn(row1, 'Play Selected World', () => sel && this.app.playWorld(sel), 'half');
    this.btn(row1, 'Create New World', () => this.showCreate(), 'half');
    const row2 = el('div', 'btnrow', r);
    const del = this.btn(row2, 'Delete', () => {
      const w = worlds.find((x) => x.id === sel);
      if (w) this.confirm(`Are you sure you want to delete '${w.name}'?`, "'" + w.name + "' will be lost forever! (A long time!)", async () => { await this.app.store.deleteWorld(sel); this.showWorlds(); }, () => this.showWorlds());
    }, 'half');
    this.btn(row2, 'Cancel', () => this.showTitle(), 'half');
    const upd = () => { play.disabled = !sel; del.disabled = !sel; };
    upd();
  }

  confirm(q, detail, yes, no) {
    const r = this.clear();
    r.classList.remove('hidden');
    this.title(r, q);
    const d = el('div', 't hint', r); d.textContent = detail; d.style.marginBottom = 'calc(16 * var(--s))';
    const row = el('div', 'btnrow', r);
    this.btn(row, 'Delete', yes, 'half');
    this.btn(row, 'Cancel', no, 'half');
    this.back = no;
  }

  showCreate() {
    const r = this.clear();
    r.classList.remove('hidden');
    this.back = () => this.showWorlds();
    this.title(r, 'Create New World');
    const f1 = el('div', 'field', r);
    el('label', 't', f1, 'World Name');
    const name = el('input', '', f1);
    name.value = 'New World';
    name.maxLength = 32;
    const f2 = el('div', 'field', r);
    el('label', 't', f2, 'Seed for the world generator (leave blank for random)');
    const seed = el('input', '', f2);
    seed.maxLength = 32;
    for (const i of [name, seed]) i.addEventListener('keydown', (e) => e.stopPropagation());
    let mode = 0, diff = 2, bonus = false;
    const modes = ['survival', 'creative'];
    const modeDesc = ['Search for resources, craft, gain levels, health and hunger', 'Unlimited resources, free flying and destroy blocks instantly'];
    const mb = this.btn(r, '', () => { mode = (mode + 1) % 2; upd(); });
    const md = el('div', 't hint', r); md.style.marginTop = '0';
    const db = this.btn(r, '', () => { diff = (diff + 1) % 4; upd(); });
    const bb = this.btn(r, '', () => { bonus = !bonus; upd(); });
    const upd = () => {
      mb.textContent = `Game Mode: ${capital(modes[mode])}`;
      md.textContent = modeDesc[mode];
      db.textContent = `Difficulty: ${['Peaceful', 'Easy', 'Normal', 'Hard'][diff]}`;
      bb.textContent = `Bonus Chest: ${bonus ? 'ON' : 'OFF'}`;
    };
    upd();
    const row = el('div', 'btnrow', r);
    row.style.marginTop = 'calc(8 * var(--s))';
    this.btn(row, 'Create New World', () => {
      const s = seed.value.trim() || String(Math.floor(Math.random() * 2 ** 31) * (Math.random() < 0.5 ? -1 : 1));
      this.app.createWorld({ name: name.value.trim() || 'New World', seedText: s, mode: modes[mode], difficulty: diff, bonus });
    }, 'half');
    this.btn(row, 'Cancel', () => this.showWorlds(), 'half');
    setTimeout(() => name.select(), 50);
  }

  // ---------------------------------------------------------------- options
  showOptions(back, inGame) {
    const r = this.clear(inGame ? 'dim' : 'dirt');
    r.classList.remove('hidden');
    this.back = back;
    const S = this.app.settings;
    this.title(r, 'Options');
    const g = el('div', 'opts', r);
    this.slider(g, 'FOV', 30, 110, 1, S.fov, (v) => (v === 70 ? 'Normal' : v >= 110 ? 'Quake Pro' : v), (v) => { S.fov = v; });
    this.slider(g, 'Render Distance', 2, 16, 1, S.renderDistance, (v) => `${v} chunks`, (v) => { S.renderDistance = v; this.app.applySettings(); });
    this.slider(g, 'Brightness', 0, 1, 0.05, S.gamma, (v) => (v === 0 ? 'Moody' : v === 1 ? 'Bright' : Math.round(v * 100) + '%'), (v) => { S.gamma = v; });
    this.slider(g, 'Mouse Sensitivity', 10, 200, 5, S.sensitivity, (v) => v + '%', (v) => { S.sensitivity = v; });
    this.slider(g, 'Master Volume', 0, 100, 5, S.master, (v) => (v ? v + '%' : 'OFF'), (v) => { S.master = v; this.app.applySettings(); });
    this.slider(g, 'Music', 0, 100, 5, S.music, (v) => (v ? v + '%' : 'OFF'), (v) => { S.music = v; this.app.applySettings(); });
    this.slider(g, 'Sounds', 0, 100, 5, S.sfx, (v) => (v ? v + '%' : 'OFF'), (v) => { S.sfx = v; this.app.applySettings(); });
    this.toggle(g, 'GUI Scale', [0, 1, 2, 3, 4], S.guiScale, (v) => { S.guiScale = v; this.ui.applyScale(); }, ['Auto', '1', '2', '3', '4']);
    this.toggle(g, 'Leaves', [true, false], S.fancyLeaves ? 0 : 1, (v) => { S.fancyLeaves = v; this.app.applySettings(); }, ['Fancy', 'Fast']);
    this.toggle(g, 'Clouds', [true, false], S.clouds ? 0 : 1, (v) => { S.clouds = v; }, ['ON', 'OFF']);
    this.toggle(g, 'Particles', [2, 1, 0], [2, 1, 0].indexOf(S.particles), (v) => { S.particles = v; }, ['All', 'Decreased', 'Minimal']);
    this.toggle(g, 'View Bobbing', [true, false], S.viewBobbing ? 0 : 1, (v) => { S.viewBobbing = v; }, ['ON', 'OFF']);
    this.toggle(g, 'FOV Effects', [true, false], S.fovEffects ? 0 : 1, (v) => { S.fovEffects = v; }, ['ON', 'OFF']);
    this.toggle(g, 'Invert Mouse', [false, true], S.invertY ? 1 : 0, (v) => { S.invertY = v; }, ['OFF', 'ON']);
    this.toggle(g, 'Show FPS', [false, true], S.showFps ? 1 : 0, (v) => { S.showFps = v; }, ['OFF', 'ON']);
    this.toggle(g, 'Resolution', [0, 1, 0.75, 0.5], [0, 1, 0.75, 0.5].indexOf(S.pixelRatio), (v) => { S.pixelRatio = v; this.app.applySettings(); }, ['Native', 'Standard', 'Reduced', 'Low']);
    this.toggle(g, 'Touch Controls', ['auto', 'on', 'off'], ['auto', 'on', 'off'].indexOf(S.touch), (v) => { S.touch = v; this.ui.touch.update(); }, ['Auto', 'ON', 'OFF']);
    this.toggle(g, 'Keep Inventory', [false, true], S.keepInventory ? 1 : 0, (v) => { S.keepInventory = v; }, ['OFF', 'ON']);
    if (inGame && this.ui.game) {
      const gm = this.ui.game;
      this.toggle(g, 'Difficulty', [0, 1, 2, 3], gm.difficulty, (v) => { gm.difficulty = v; }, ['Peaceful', 'Easy', 'Normal', 'Hard']);
    }
    const nf = el('div', 'field', g);
    nf.style.margin = '0';
    const ni = el('input', '', nf);
    ni.style.width = '100%';
    ni.value = S.playerName; ni.maxLength = 16; ni.placeholder = 'Player name';
    ni.addEventListener('keydown', (e) => e.stopPropagation());
    ni.addEventListener('change', () => { S.playerName = ni.value.trim() || 'Steve'; this.app.saveSettings(); });
    const done = this.btn(r, 'Done', () => { this.app.saveSettings(); back(); });
    done.style.marginTop = 'calc(8 * var(--s))';
  }

  // ---------------------------------------------------------------- pause
  showPause() {
    const g = this.ui.game;
    const r = this.clear('dim');
    r.classList.remove('hidden');
    this.back = () => this.app.resume();
    this.title(r, 'Game Menu');
    this.btn(r, 'Back to Game', () => this.app.resume());
    const row = el('div', 'btnrow', r);
    this.btn(row, 'Advancements', () => this.showAdvancements(), 'half');
    this.btn(row, 'Statistics', () => this.showStats(), 'half');
    const row2 = el('div', 'btnrow', r);
    this.btn(row2, 'Options...', () => this.showOptions(() => this.showPause(), true), 'half');
    this.btn(row2, 'Controls', () => this.showHelp(() => this.showPause(), true), 'half');
    const q = this.btn(r, 'Save and Quit to Title', () => { q.disabled = true; q.textContent = 'Saving world...'; this.app.quitToTitle(); });
    q.style.marginTop = 'calc(18 * var(--s))';
    void g;
  }

  showAdvancements() {
    const g = this.ui.game;
    const r = this.clear('dim');
    r.classList.remove('hidden');
    this.back = () => this.showPause();
    this.title(r, `Advancements (${ADVANCEMENTS.filter((a) => g.advancements.has(a.key)).length}/${ADVANCEMENTS.length})`);
    const grid = el('div', '', r);
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,calc(150 * var(--s)));gap:calc(3 * var(--s));width:min(calc(460 * var(--s)),94vw);max-height:62vh;overflow-y:auto;justify-content:center';
    for (const a of ADVANCEMENTS) {
      const done = g.advancements.has(a.key);
      const c = el('div', 'toast in', grid);
      c.style.transform = 'none';
      c.style.width = 'auto';
      c.style.opacity = done ? 1 : 0.55;
      const id = ITEMS.find((it) => it && it.name === a.icon)?.id;
      c.innerHTML = `<div class="ti"><div class="icon" style="${iconStyle(id)};${done ? '' : 'filter:grayscale(1) brightness(.6)'}"></div></div><div class="tt" style="color:${done ? '#ffff55' : '#aaa'}">${a.title}</div><div class="td">${a.desc}</div>`;
    }
    this.btn(r, 'Done', () => this.showPause()).style.marginTop = 'calc(8 * var(--s))';
  }

  showStats() {
    const g = this.ui.game;
    const p = g.player;
    const r = this.clear('dim');
    r.classList.remove('hidden');
    this.back = () => this.showPause();
    this.title(r, 'Statistics');
    const s = g.stats;
    const rows = [
      ['Blocks mined', s.mined], ['Blocks placed', s.placed], ['Items crafted', s.crafted], ['Mobs killed', s.kills], ['Items enchanted', s.enchanted || 0], ['Deaths', s.deaths],
      ['Distance walked', (s.walked / 1000).toFixed(2) + ' km'], ['Days survived', g.day], ['Experience level', p.level], ['World seed', g.meta.seed],
    ];
    const k = el('div', 'keys', r);
    k.innerHTML = rows.map(([a, b]) => `<div><b>${a}</b> ${b}</div>`).join('');
    this.btn(r, 'Done', () => this.showPause());
  }

  showHelp(back, inGame) {
    const r = this.clear(inGame ? 'dim' : 'dirt');
    r.classList.remove('hidden');
    this.back = back;
    this.title(r, 'How to Play');
    const k = el('div', 'keys', r);
    const touch = this.ui.touch.enabled;
    const lines = touch ? [
      ['Move', 'Left stick (push fully to sprint)'], ['Look', 'Drag on the right side'], ['Break / attack', 'Hold on a block or tap a mob'],
      ['Place / use', 'Tap a block'], ['Jump', 'Jump button (double tap in creative to fly)'], ['Inventory', 'Bag button'],
      ['Hotbar', 'Tap a slot'], ['Pause', 'Pause button'],
    ] : [
      ['W A S D', 'Move'], ['Mouse', 'Look around'], ['Left click', 'Break blocks / attack'], ['Right click', 'Place blocks / use items / open'],
      ['Space', 'Jump (double tap to fly in creative)'], ['Shift', 'Sneak (won\'t fall off edges)'], ['Ctrl / double W', 'Sprint'],
      ['E', 'Inventory & crafting'], ['1-9 / wheel', 'Choose hotbar slot'], ['Q', 'Drop item (Ctrl+Q: whole stack)'],
      ['Middle click', 'Pick block'], ['T  /  /', 'Chat / commands (/help)'], ['F5', 'Change camera'], ['F3', 'Debug info'],
      ['F1', 'Hide HUD'], ['F2', 'Screenshot'], ['Esc', 'Pause menu'],
    ];
    k.innerHTML = lines.map(([a, b]) => `<div><b>${a}</b> ${b}</div>`).join('') +
      '<div style="margin-top:calc(6*var(--s));color:#aaa;white-space:normal;max-width:min(calc(300*var(--s)),90vw)">Survive your first night: punch a tree for wood, craft planks, a crafting table and a wooden pickaxe, mine stone, and build a shelter before dark. Use the recipe book (book icon) in the crafting screen if you get stuck.</div>';
    this.btn(r, 'Done', back);
  }

  showCredits() {
    const r = this.clear();
    r.classList.remove('hidden');
    this.back = () => this.showTitle();
    this.title(r, 'Credits');
    const c = el('div', 'credits', r);
    c.innerHTML = `
      <p>BlockCraft is an independent fan-made voxel sandbox inspired by Minecraft. It is not affiliated with or endorsed by Mojang or Microsoft.</p>
      <h3>Textures</h3><p>From <a href="https://codeberg.org/mineclonia/mineclonia" target="_blank" rel="noopener">Mineclonia</a>, based on the Pixel Perfection resource pack by XSSheep and Pixel Perfection Legacy by Nova Wostra. Licence: CC BY-SA 4.0. Some images were combined, recoloured or converted to greyscale for biome tinting.</p>
      <h3>Sounds</h3><p>From Mineclonia (various authors via Freesound/OpenGameArt), licensed CC0, CC BY 3.0, CC BY-SA 3.0/4.0, MIT and WTFPL. Converted to MP3. Full attribution ships with the source in assets/licenses.</p>
      <h3>Font</h3><p>Pixelify Sans by Stefie Justprince, SIL Open Font License 1.1.</p>
      <h3>Engine</h3><p>three.js (MIT). Music is generated live with the Web Audio API.</p>`;
    this.btn(r, 'Done', () => this.showTitle());
  }

  // ---------------------------------------------------------------- loading & death
  showLoading(text) {
    let l = document.getElementById('loading');
    if (!l) {
      l = el('div', '', this.ui.root);
      l.id = 'loading';
      el('div', 't', l).id = 'loadText';
      const b = el('div', 'bar', l);
      el('i', '', b).id = 'loadBar';
      el('div', 't hint', l).id = 'loadHint';
    }
    l.classList.remove('hidden');
    document.getElementById('loadText').textContent = text;
    this.loadProgress(0);
    const hints = ['Tip: sneak with Shift to safely build at the edge of blocks.', 'Tip: torches stop monsters spawning nearby.', 'Tip: sleeping in a bed sets your spawn point.', 'Tip: creepers hate cats, and you, too.', 'Tip: water and lava make obsidian.', 'Tip: use the recipe book in the crafting screen.', 'Tip: sheep regrow wool by eating grass.'];
    document.getElementById('loadHint').textContent = hints[Math.floor(Math.random() * hints.length)];
  }
  loadProgress(f) { const b = document.getElementById('loadBar'); if (b) b.style.width = Math.round(f * 100) + '%'; }
  hideLoading() { const l = document.getElementById('loading'); if (l) l.classList.add('hidden'); }

  showDeath(msg, score) {
    const r = this.clear('');
    r.classList.remove('hidden');
    const d = el('div', 'death', r);
    el('h1', 't', d).textContent = 'You died!';
    el('p', 't', d).textContent = msg;
    const sc = el('p', 't', d);
    sc.innerHTML = `Score: <span style="color:#ffff55">${score}</span>`;
    const respawn = this.btn(d, 'Respawn', () => this.ui.game && this.ui.game.respawn());
    respawn.disabled = true;
    setTimeout(() => { respawn.disabled = false; }, 1200);
    this.btn(d, 'Title Screen', () => this.app.quitToTitle());
    this.app.input.unlock();
  }
}

function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function escapeHTML(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
