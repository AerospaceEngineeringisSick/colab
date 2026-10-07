// Container screens: inventory, crafting table, furnace, chest, creative. Minecraft click rules.
import { ITEMS, I, FUEL, maxStack, ARMOR_SLOTS } from '../shared/items.js';
import { BLOCKS, B, R } from '../shared/blocks.js';
import { Container, same, withCount, cloneStack, stackKey, itemName } from '../game/inventory.js';
import { LEVEL_NAMES, LEVEL_XP, PROFESSION_NAMES, gainTradeXp } from '../game/trading.js';
import { ENCHANTS, enchName, isEnchanted, enchantability, tableOffers, countShelves, anvilCombine, repairTest } from '../shared/enchant.js';
import { matchRecipe, RECIPES, SMELT } from '../game/recipes.js';
import { images, canvas } from '../engine/textures.js';
import { iconStyle } from './icons.js';
import { el, slotHTML } from './ui.js';

const S = (n) => `calc(${n} * var(--s))`;
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
let ARROW = null, ARROW_FILL = null;
function arrows() {
  if (ARROW) return;
  const src = images['gui/craft_arrow'];
  ARROW = src.toDataURL();
  const c = canvas(src.width, src.height), g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  ARROW_FILL = c.toDataURL();
}

// "Standard Galactic" gibberish for the enchanting table rows: three recoloured copies (normal, hover, disabled)
function glyphText(seed) {
  let k = (seed >>> 0) || 1;
  const rnd = () => { k = (Math.imul(k, 1103515245) + 12345) >>> 0; return (k >>> 8) / 16777216; };
  const W = 86, H = 16;
  const c = canvas(W, H), g = c.getContext('2d');
  let x = 0, y = 1;
  for (let w = 0; w < 6; w++) {
    const len = 2 + Math.floor(rnd() * 5);
    if (x + len * 7 > W) { if (y > 1) break; x = 0; y = 9; }
    for (let i = 0; i < len && x + 6 <= W; i++, x += 7) g.drawImage(images['gui/glyph_' + (1 + Math.floor(rnd() * 18))], x, y);
    x += 4;
  }
  return ['#685e4a', '#ffff80', '#342f25'].map((col) => {
    const o = canvas(W, H), og = o.getContext('2d');
    og.drawImage(c, 0, 0);
    og.globalCompositeOperation = 'source-in';
    og.fillStyle = col;
    og.fillRect(0, 0, W, H);
    return o.toDataURL();
  });
}

// creative tabs
const CREATIVE_TABS = [
  { name: 'Building Blocks', icon: 'bricks', filter: (it) => it.block !== undefined && BLOCKS[it.block].render !== R.CROSS && !isFunctional(it) && !isNature(it) },
  { name: 'Nature', icon: 'grass_block', filter: (it) => it.block !== undefined && isNature(it) },
  { name: 'Functional', icon: 'crafting_table', filter: (it) => it.block !== undefined && isFunctional(it) },
  { name: 'Tools & Combat', icon: 'iron_pickaxe', filter: (it) => it.id >= 1024 && (it.tool || it.armor || it.durability || it.name === 'arrow' || it.name === 'enchanted_book' || it.use === 'boat' || it.use === 'minecart') },
  { name: 'Food & Materials', icon: 'apple', filter: (it) => it.id >= 1024 && !it.tool && !it.armor && !it.durability && !it.egg && it.name !== 'arrow' && it.name !== 'enchanted_book' && it.use !== 'boat' && it.use !== 'minecart' },
  { name: 'Spawn Eggs', icon: 'pig_spawn_egg', filter: (it) => !!it.egg },
  { name: 'Search', icon: 'compass', filter: () => true, search: true },
  { name: 'Survival Inventory', icon: 'chest', inv: true },
];
const NATURE = ['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'sand', 'red_sand', 'gravel', 'clay', 'snow_block', 'snow', 'ice', 'packed_ice', 'stone', 'granite', 'diorite', 'andesite', 'cobblestone', 'mossy_cobblestone', 'bedrock', 'obsidian', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore', 'cactus', 'sugar_cane', 'pumpkin', 'melon', 'cobweb', 'vine', 'lily_pad'];
const FUNCTIONAL = ['crafting_table', 'furnace', 'chest', 'enchanting_table', 'anvil', 'rail', 'powered_rail', 'detector_rail', 'torch', 'ladder', 'oak_door', 'red_bed', 'tnt', 'bookshelf', 'jack_o_lantern', 'glowstone', 'sea_lantern', 'spawner', 'cake', 'farmland', 'dirt_path', 'oak_fence'];
function isNature(it) { const n = it.name; return NATURE.includes(n) || n.endsWith('_log') || n.endsWith('_leaves') || n.endsWith('_sapling') || BLOCKS[it.block].plant || BLOCKS[it.block].render === R.CROSS; }
function isFunctional(it) { return FUNCTIONAL.includes(it.name); }

export class Screens {
  constructor(ui) {
    this.ui = ui;
    this.cursor = null;
    this.slots = [];
    this.kind = null;
    this.cursorEl = el('div', '', ui.root); this.cursorEl.id = 'cursorStack';
    this.tooltip = el('div', 't hidden', ui.root); this.tooltip.id = 'tooltip';
    this.hover = null;
    this.drag = null;
    this.lastClick = { t: 0, slot: null };
    this.recipeOpen = false;
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }
  get game() { return this.ui.game; }
  get inv() { return this.game.player.inv; }

  // ---------------------------------------------------------------- open / close
  open(kind, tile) {
    const ui = this.ui;
    this.close(true);
    ui.screenOpen = true;
    ui.app.input.unlock();
    this.kind = kind;
    this.tile = tile;
    this.slots = [];
    this.root = el('div', '', ui.root);
    this.root.id = 'screen';
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.clickOutside(e); });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    if (kind === 'inventory') this.buildInventory();
    else if (kind === 'crafting') this.buildCrafting();
    else if (kind === 'furnace') this.buildFurnace();
    else if (kind === 'chest') this.buildChest();
    else if (kind === 'creative') this.buildCreative();
    else if (kind === 'enchant') this.buildEnchant();
    else if (kind === 'anvil') this.buildAnvil();
    else if (kind === 'trade') this.buildTrade();
    this.render(true);
  }

  close(quiet) {
    const ui = this.ui;
    if (!this.root) { ui.screenOpen = false; return; }
    const g = this.game;
    if (g) {
      // return the crafting grid and the cursor to the inventory
      const back = (s) => {
        if (!s) return;
        const left = this.inv.give(s);
        if (left > 0) g.dropItem(g.player.x, g.player.y + 1.2, g.player.z, withCount(s, left));
      };
      for (const c of [this.grid, this.extra]) {
        if (c) for (let i = 0; i < c.slots.length; i++) { back(c.slots[i]); c.slots[i] = null; }
      }
      back(this.cursor);
    }
    this.cursor = null;
    this.grid = null;
    this.extra = null;
    this.offers = null;
    this.anvilRes = null;
    this.root.remove();
    this.root = null;
    this.kind = null;
    this.tooltip.classList.add('hidden');
    this.cursorEl.innerHTML = '';
    ui.screenOpen = false;
    void quiet;
  }

  // ---------------------------------------------------------------- layout helpers
  panel(w, h, title) {
    const p = el('div', 'panel', this.root);
    p.style.width = S(w); p.style.height = S(h);
    if (title) this.label(p, title, 8, 6);
    this.panelEl = p;
    return p;
  }
  label(p, text, x, y) {
    const l = el('div', 'lbl', p);
    l.textContent = text;
    l.style.left = S(x); l.style.top = S(y);
    return l;
  }
  // a slot at GUI pixel position (x,y) of the 16x16 item area
  slot(p, x, y, get, set, opts = {}) {
    const e = el('div', 'slot' + (opts.big ? ' big' : ''), p);
    const off = opts.big ? 5 : 1;
    e.style.left = S(x - off); e.style.top = S(y - off);
    const inner = el('div', 'in', e);
    if (opts.ghost) { const gh = el('div', 'ghost', e); gh.style.backgroundImage = `url(${images[opts.ghost].toDataURL()})`; gh.style.left = S(off); gh.style.top = S(off); gh.style.width = S(16); gh.style.height = S(16); gh.style.right = 'auto'; gh.style.bottom = 'auto'; e._ghost = gh; }
    const s = { el: e, inner, get, set, ...opts, key: null };
    e.addEventListener('pointerdown', (ev) => this.onDown(ev, s));
    e.addEventListener('pointerenter', () => { this.hover = s; this.onEnter(s); });
    e.addEventListener('pointerleave', () => { if (this.hover === s) this.hover = null; this.tooltip.classList.add('hidden'); });
    this.slots.push(s);
    return s;
  }
  containerSlot(p, c, i, x, y, opts = {}) {
    return this.slot(p, x, y, () => c.slots[i], (v) => { c.slots[i] = v; }, { container: c, index: i, ...opts });
  }
  playerSlots(p, top, label = true, left = 8) {
    const inv = this.inv;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) this.containerSlot(p, inv, 9 + r * 9 + c, left + c * 18, top + r * 18, { group: 'main' });
    for (let c = 0; c < 9; c++) this.containerSlot(p, inv, c, left + c * 18, top + 58, { group: 'hotbar' });
    if (label) this.label(p, 'Inventory', left, top - 11);
  }

  // ---------------------------------------------------------------- screens
  buildInventory() {
    const p = this.panel(176, 166);
    const inv = this.inv;
    // armour
    for (let i = 0; i < 4; i++) {
      this.slot(p, 8, 8 + i * 18, () => inv.armor.slots[i], (v) => { inv.armor.slots[i] = v; }, {
        armor: i, ghost: 'gui/slot_' + ARMOR_SLOTS[i], accept: (s) => ITEMS[s.id].armor && ITEMS[s.id].armor.slot === i, max: 1,
      });
    }
    // player doll
    const doll = el('div', 'doll', p);
    doll.style.left = S(25); doll.style.top = S(7); doll.style.width = S(51); doll.style.height = S(72);
    doll.appendChild(this.dollCanvas());
    this.label(p, 'Crafting', 97, 6);
    this.grid = new Container(4);
    for (let i = 0; i < 4; i++) this.containerSlot(p, this.grid, i, 98 + (i % 2) * 18, 18 + Math.floor(i / 2) * 18, { craft: true });
    arrows();
    const ar = el('div', 'arrow', p); ar.style.left = S(134); ar.style.top = S(29); ar.style.width = S(18); ar.style.height = S(13); ar.style.backgroundImage = `url(${ARROW})`;
    this.result = this.slot(p, 154, 28, () => this.craftResult, () => {}, { result: true });
    this.craftW = 2;
    this.playerSlots(p, 84, false);
    this.recipeBook(p, 2);
  }

  buildCrafting() {
    const p = this.panel(176, 166, 'Crafting');
    this.grid = new Container(9);
    for (let i = 0; i < 9; i++) this.containerSlot(p, this.grid, i, 30 + (i % 3) * 18, 17 + Math.floor(i / 3) * 18, { craft: true });
    arrows();
    const ar = el('div', 'arrow', p); ar.style.left = S(89); ar.style.top = S(35); ar.style.width = S(24); ar.style.height = S(17); ar.style.backgroundImage = `url(${ARROW})`;
    this.result = this.slot(p, 124, 35, () => this.craftResult, () => {}, { result: true, big: true });
    this.craftW = 3;
    this.playerSlots(p, 84);
    this.recipeBook(p, 3);
  }

  buildFurnace() {
    const p = this.panel(176, 166, 'Furnace');
    const t = this.tile;
    this.containerSlot(p, t.items, 0, 56, 17, { furnaceIn: true });
    this.containerSlot(p, t.items, 1, 56, 53, { fuel: true, accept: (s) => !!FUEL[s.id] });
    this.slot(p, 116, 35, () => t.items.slots[2], (v) => { t.items.slots[2] = v; }, { big: true, output: true, container: t.items, index: 2 });
    const fire = el('div', 'fire', p); fire.style.left = S(57); fire.style.top = S(37);
    const fb = el('i', '', fire); fb.style.backgroundImage = `url(${images['gui/fire_bg'].toDataURL()})`;
    this.fireFg = el('i', '', fire); this.fireFg.style.backgroundImage = `url(${images['gui/fire_fg'].toDataURL()})`;
    const arrow = el('div', 'arrow', p); arrow.style.left = S(79); arrow.style.top = S(34); arrow.style.width = S(24); arrow.style.height = S(17);
    arrows();
    const ab = el('i', 'arrowf', arrow); ab.style.backgroundImage = `url(${ARROW})`;
    this.arrowFg = el('i', 'arrowf', arrow); this.arrowFg.style.backgroundImage = `url(${ARROW_FILL})`;
    this.playerSlots(p, 84);
  }

  buildChest() {
    const p = this.panel(176, 166, 'Chest');
    const c = this.tile.items;
    for (let i = 0; i < 27; i++) this.containerSlot(p, c, i, 8 + (i % 9) * 18, 18 + Math.floor(i / 9) * 18, { chest: true });
    this.playerSlots(p, 84);
  }

  // ---------------------------------------------------------------- enchanting table
  buildEnchant() {
    const p = this.panel(176, 166, 'Enchant');
    this.extra = new Container(2);
    const c = this.extra;
    this.containerSlot(p, c, 0, 15, 47, { max: 1 });
    this.containerSlot(p, c, 1, 35, 47, { lapis: true, ghost: 'gui/slot_lapis', accept: (st) => st.id === I.lapis_lazuli });
    const book = el('div', 'enchbook', p);
    book.style.left = S(18); book.style.top = S(16); book.style.width = S(28); book.style.height = S(20);
    book.style.backgroundImage = `url(${images['gui/enchant_book'].toDataURL()})`;
    this.enchRows = [0, 1, 2].map((i) => {
      const r = el('div', 'enchopt', p);
      r.style.left = S(60); r.style.top = S(14 + 19 * i); r.style.width = S(108); r.style.height = S(19);
      const badge = el('i', 'badge', r);
      const glyphs = el('i', 'glyphs', r);
      const lvl = el('span', 'lvl', r);
      r.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.enchantClick(i); });
      r.addEventListener('pointerenter', () => { this.enchHover = i; this.enchKey = null; this.showEnchTip(i); });
      r.addEventListener('pointerleave', () => { this.enchHover = -1; this.enchKey = null; this.tooltip.classList.add('hidden'); });
      return { el: r, badge, glyphs, lvl };
    });
    this.enchHover = -1;
    this.enchKey = null;
    this.offerKey = null;
    this.playerSlots(p, 84);
    this.updateEnchant();
  }

  // recompute offers when the item changes; restyle rows when affordability changes
  updateEnchant() {
    const g = this.game, p = g.player, t = this.tile, c = this.extra;
    if (!c) return;
    const item = c.slots[0], lapis = c.slots[1];
    const ok = item && item.count === 1 && !isEnchanted(item) && enchantability(item.id) > 0;
    const ok2 = ok ? `${item.id}:${p.enchSeed}` : 'none';
    if (ok2 !== this.offerKey) {
      this.offerKey = ok2;
      this.shelves = countShelves(g.world, t.x, t.y, t.z);
      this.offers = ok ? tableOffers(item.id, this.shelves, p.enchSeed) : [null, null, null];
      this.glyphURLs = [0, 1, 2].map((i) => glyphText(p.enchSeed * 3 + i));
      this.enchKey = null;
    }
    const creative = p.mode !== 'survival';
    const nLapis = lapis ? lapis.count : 0;
    const key = `${this.offerKey}:${nLapis}:${p.level}:${creative}:${this.enchHover}`;
    if (key === this.enchKey) return;
    this.enchKey = key;
    this.enchRows.forEach((row, i) => {
      const o = this.offers[i];
      const can = !!o && (creative || (p.level >= o.cost && nLapis >= i + 1));
      row.el.className = 'enchopt ' + (!o ? 'empty' : !can ? 'off' : this.enchHover === i ? 'hover' : 'on');
      row.badge.style.backgroundImage = o ? `url(${images[`gui/enchant_cost_${i + 1}${can ? '' : '_off'}`].toDataURL()})` : '';
      row.glyphs.style.backgroundImage = o ? `url(${this.glyphURLs[i][!can ? 2 : this.enchHover === i ? 1 : 0]})` : '';
      row.lvl.textContent = o ? o.cost : '';
    });
    if (this.enchHover >= 0) this.showEnchTip(this.enchHover);
  }

  showEnchTip(i) {
    const o = this.offers && this.offers[i];
    const t = this.tooltip;
    if (!o || this.cursor) { t.classList.add('hidden'); return; }
    const p = this.game.player;
    let h = `<div>${enchName(o.hint)} . . . ?</div>`;
    if (p.mode === 'survival') {
      const lapis = this.extra.slots[1] ? this.extra.slots[1].count : 0;
      if (p.level < o.cost) h += `<div class="sub" style="color:#ff5555">Level Requirement: ${o.cost}</div>`;
      else {
        h += `<div class="sub" style="color:${lapis >= i + 1 ? '#a8a8a8' : '#ff5555'}">${i + 1} Lapis Lazuli</div>`;
        h += `<div class="sub">${i + 1} Enchantment Level${i ? 's' : ''}</div>`;
      }
    }
    t.innerHTML = h;
    t.classList.remove('hidden');
    t.style.left = (this.mx || 0) + 14 + 'px'; t.style.top = (this.my || 0) - 26 + 'px';
    this.clampTooltip();
  }

  enchantClick(i) {
    const o = this.offers && this.offers[i];
    if (!o) return;
    const g = this.game, p = g.player, c = this.extra;
    const item = c.slots[0], lapis = c.slots[1];
    const creative = p.mode !== 'survival';
    if (!item || (!creative && (p.level < o.cost || !lapis || lapis.count < i + 1))) return;
    const ench = o.list.map((e) => [e[0], e[1]]);
    if (item.id === I.book) c.slots[0] = { id: I.enchanted_book, count: 1, dmg: 0, ench };
    else item.ench = ench;
    if (!creative) {
      lapis.count -= i + 1;
      if (lapis.count <= 0) c.slots[1] = null;
      p.spendLevels(i + 1);
    }
    p.enchSeed = (Math.random() * 0x7fffffff) | 0;
    const t = this.tile;
    g.sound.play('enchant', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 0.9 + Math.random() * 0.2);
    g.advance('enchant');
    g.stats.enchanted++;
    this.changed();
  }

  // ---------------------------------------------------------------- anvil
  buildAnvil() {
    const p = this.panel(176, 166);
    this.label(p, 'Repair & Name', 60, 6);
    this.extra = new Container(2);
    const c = this.extra;
    const ham = el('div', 'anvilham', p);
    ham.style.left = S(14); ham.style.top = S(12); ham.style.width = S(32); ham.style.height = S(32);
    ham.style.backgroundImage = `url(${images['gui/anvil_hammer'].toDataURL()})`;
    const name = el('input', 'rename', p);
    name.style.left = S(59); name.style.top = S(20); name.style.width = S(110); name.style.height = S(14);
    name.maxLength = 35;
    name.spellcheck = false;
    name.disabled = true;
    name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.ui.closeScreen(); });
    name.addEventListener('input', () => this.changed());
    this.renameEl = name;
    this.containerSlot(p, c, 0, 27, 47, { anvilIn: true });
    this.containerSlot(p, c, 1, 76, 47, { anvilIn: true });
    this.label(p, '+', 56, 46).classList.add('plus');
    arrows();
    const ar = el('div', 'arrow', p); ar.style.left = S(100); ar.style.top = S(46); ar.style.width = S(24); ar.style.height = S(17); ar.style.backgroundImage = `url(${ARROW})`;
    this.anvilX = el('div', 'anvilx', p); this.anvilX.style.left = S(103); this.anvilX.style.top = S(45); this.anvilX.textContent = '✕';
    this.slot(p, 134, 47, () => (this.anvilRes ? this.anvilRes.out : null), () => {}, { result: true, anvilResult: true });
    this.costEl = el('div', 'lbl anvilcost', p);
    this.costEl.style.right = S(8); this.costEl.style.top = S(69);
    this.anvilLeft = null;
    this.playerSlots(p, 84);
    this.updateAnvil();
  }

  updateAnvil() {
    const c = this.extra, p = this.game.player;
    if (!c) return;
    const left = c.slots[0], right = c.slots[1];
    const name = this.renameEl;
    // a new item in the left slot resets the name field to its current name
    if (left !== this.anvilLeft) {
      this.anvilLeft = left;
      name.disabled = !left;
      name.value = left ? itemName(left) : '';
    }
    let rename;
    if (left) {
      let want = name.value.trim().slice(0, 35);
      if (want === ITEMS[left.id].display) want = '';
      if (want !== (left.label || '')) rename = want;
    }
    const r = left ? anvilCombine(left, right, repairTest(left.id), rename) : null;
    this.anvilRes = r;
    const creative = p.mode !== 'survival';
    const tooMuch = r && !creative && r.cost >= 40;
    this.anvilX.style.display = left && right && !r ? '' : 'none';
    if (!r) { this.costEl.textContent = ''; return; }
    this.costEl.textContent = tooMuch ? 'Too Expensive!' : `Enchantment Cost: ${r.cost}`;
    this.costEl.style.color = tooMuch || (!creative && p.level < r.cost) ? '#ff6060' : '#80ff20';
  }

  takeAnvil(shift) {
    const r = this.anvilRes, c = this.extra;
    if (!r) return;
    const g = this.game, p = g.player, creative = p.mode !== 'survival';
    if (!creative && (r.cost >= 40 || p.level < r.cost)) return;
    const out = cloneStack(r.out);
    if (shift) { if (this.inv.give(out) > 0) return; }
    else { if (this.cursor) return; this.cursor = out; }
    c.slots[0] = null;
    if (c.slots[1] && r.use) { c.slots[1].count -= r.use; if (c.slots[1].count <= 0) c.slots[1] = null; }
    if (!creative) p.spendLevels(r.cost);
    const t = this.tile;
    g.sound.play('place.metal', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.8, 0.6);
    this.changed();
  }

  // ---------------------------------------------------------------- villager trading
  buildTrade() {
    const v = this.tile;
    const p = this.panel(276, 166);
    this.extra = new Container(2);
    this.tradeSel = -1;
    this.tradeScroll = 0;
    this.tradeTitle = this.label(p, '', 107, 6);
    this.tradeTitle.style.width = S(162); this.tradeTitle.style.textAlign = 'center';
    const bar = el('div', 'tradexp', p);
    bar.style.left = S(136); bar.style.top = S(16); bar.style.width = S(102); bar.style.height = S(5);
    this.tradeBar = el('i', '', bar);
    this.label(p, 'Trades', 5, 6);
    this.tradeList = el('div', 'tradelist', p);
    this.tradeList.style.left = S(4); this.tradeList.style.top = S(17); this.tradeList.style.width = S(96); this.tradeList.style.height = S(140);
    this.tradeList.addEventListener('wheel', (e) => { this.tradeScroll = Math.max(0, Math.min(Math.max(0, v.offers.length - 7), this.tradeScroll + Math.sign(e.deltaY))); this.fillTrades(); }, { passive: true });
    this.containerSlot(p, this.extra, 0, 136, 37, { tradeIn: true });
    this.containerSlot(p, this.extra, 1, 162, 37, { tradeIn: true });
    arrows();
    const ar = el('div', 'arrow', p); ar.style.left = S(186); ar.style.top = S(36); ar.style.width = S(24); ar.style.height = S(17); ar.style.backgroundImage = `url(${ARROW})`;
    this.tradeX = el('div', 'anvilx', p); this.tradeX.style.left = S(190); this.tradeX.style.top = S(35); this.tradeX.textContent = '✕';
    this.slot(p, 220, 37, () => (this.tradeOut ? this.tradeOut.out : null), () => {}, { result: true, tradeResult: true });
    this.playerSlots(p, 84, true, 108);
    this.fillTrades();
    this.updateTrade();
  }

  fillTrades() {
    const v = this.tile, list = this.tradeList;
    list.innerHTML = '';
    v.offers.slice(this.tradeScroll, this.tradeScroll + 7).forEach((o, k) => {
      const i = k + this.tradeScroll;
      const row = el('div', 'traderow' + (i === this.tradeSel ? ' on' : '') + (o.uses >= o.max ? ' out' : ''), list);
      row.style.top = S(k * 20);
      const icon = (st, x) => { const c = el('div', 'tslot', row); c.style.left = S(x); c.innerHTML = slotHTML(st); return c; };
      icon(o.a, 4);
      if (o.b) icon(o.b, 24);
      const arw = el('div', 'tarrow', row); arw.style.left = S(48); arw.textContent = o.uses >= o.max ? '✕' : '→';
      icon(o.out, 68);
      row.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.selectTrade(i); });
      row.addEventListener('pointerenter', () => { this.hover = { get: () => o.out }; this.showTooltip(this.hover); });
      row.addEventListener('pointerleave', () => { this.hover = null; this.tooltip.classList.add('hidden'); });
    });
  }

  // pick an offer and move its price from the inventory into the cost slots
  selectTrade(i) {
    const v = this.tile, o = v.offers[i], c = this.extra, inv = this.inv;
    this.tradeSel = i;
    for (let k = 0; k < 2; k++) if (c.slots[k]) { const left = inv.give(c.slots[k]); c.slots[k] = left > 0 ? withCount(c.slots[k], left) : null; }
    const pull = (want, k) => {
      if (!want || c.slots[k]) return;
      let need = maxStack(want.id), got = null;
      for (let j = 0; j < 36 && need > 0; j++) {
        const st = inv.slots[j];
        if (!st || st.id !== want.id || st.ench || st.label || (ITEMS[st.id].durability && st.dmg)) continue;
        const n = Math.min(need, st.count);
        got = got ? withCount(got, got.count + n) : withCount(st, n);
        st.count -= n; need -= n;
        if (st.count <= 0) inv.slots[j] = null;
      }
      if (got) c.slots[k] = got;
    };
    pull(o.a, 0);
    pull(o.b, 1);
    this.game.sound.click();
    this.changed();
    this.fillTrades();
  }

  updateTrade() {
    const v = this.tile, c = this.extra;
    if (!c) return;
    const lvl = v.tradeLevel;
    this.tradeTitle.textContent = `${PROFESSION_NAMES[v.profession] || 'Villager'} - ${LEVEL_NAMES[lvl]}`;
    const lo = LEVEL_XP[lvl], hi = LEVEL_XP[Math.min(4, lvl + 1)];
    this.tradeBar.style.width = (lvl >= 4 ? 100 : Math.max(0, Math.min(100, (v.tradeXp - lo) / (hi - lo) * 100))) + '%';
    // the offer the cost slots satisfy: the selected one first, then any other
    const fits = (o) => {
      const a = c.slots[0], b = c.slots[1];
      if (!a || a.id !== o.a.id || a.count < o.a.count) return false;
      if (o.b && (!b || b.id !== o.b.id || b.count < o.b.count)) return false;
      return o.uses < o.max;
    };
    let pick = null;
    if (this.tradeSel >= 0 && v.offers[this.tradeSel] && fits(v.offers[this.tradeSel])) pick = v.offers[this.tradeSel];
    else pick = v.offers.find(fits) || null;
    this.tradeOut = pick ? { offer: pick, out: pick.out } : null;
    const sel = v.offers[this.tradeSel];
    this.tradeX.style.display = sel && sel.uses >= sel.max ? '' : 'none';
  }

  takeTrade(shift) {
    const v = this.tile, c = this.extra, g = this.game, p = g.player;
    for (let n = 0; n < (shift ? 64 : 1); n++) {
      const t = this.tradeOut;
      if (!t) break;
      const o = t.offer;
      const out = cloneStack(o.out);
      if (shift) { if (this.inv.give(out) > 0) break; }
      else {
        if (this.cursor && !(same(this.cursor, out) && this.cursor.count + out.count <= maxStack(out.id))) return;
        if (this.cursor) this.cursor.count += out.count; else this.cursor = out;
      }
      c.slots[0].count -= o.a.count;
      if (c.slots[0].count <= 0) c.slots[0] = null;
      if (o.b) { c.slots[1].count -= o.b.count; if (c.slots[1].count <= 0) c.slots[1] = null; }
      o.uses++;
      const up = gainTradeXp(v, o.xp);
      p.addXp(3 + Math.floor(Math.random() * 4) + (up ? 5 : 0));
      g.sound.play(up ? 'villager.yes' : 'villager.trade', v.x, v.y + 1.5, v.z, 0.7);
      if (up) g.particles.hearts(v.x, v.y + v.h, v.z, 4);
      g.advance('trade');
      this.updateTrade();
    }
    this.fillTrades();
    this.changed();
  }

  buildCreative() {
    const p = this.panel(195, 165);
    this.panelEl.style.top = 'calc(50% + 14 * var(--s))';
    this.tabIdx = this.tabIdx ?? 0;
    const tabs = el('div', 'tabs', p);
    tabs.style.left = S(0); tabs.style.top = S(-28);
    this.tabEls = CREATIVE_TABS.map((t, i) => {
      const te = el('div', 'tab', tabs);
      te.title = t.name;
      const id = I[t.icon];
      te.innerHTML = `<div class="in"><div class="icon" style="${iconStyle(id)}"></div></div>`;
      te.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.tabIdx = i; this.buildCreativeTab(); });
      return te;
    });
    this.creativeBody = el('div', '', p);
    this.buildCreativeTab();
  }

  buildCreativeTab() {
    const tab = CREATIVE_TABS[this.tabIdx];
    this.tabEls.forEach((t, i) => t.classList.toggle('on', i === this.tabIdx));
    // remove old slots belonging to the body
    this.slots = this.slots.filter((s) => !this.creativeBody.contains(s.el));
    this.creativeBody.innerHTML = '';
    const p = this.creativeBody;
    const P = this.panelEl;
    const old = P.querySelector('.lbl'); if (old) old.remove();
    this.label(P, tab.name, 8, 6);
    if (tab.inv) {
      const inv = this.inv;
      for (let i = 0; i < 4; i++) {
        this.slot(p, 54 + i * 18 + (i > 1 ? 0 : 0), 6, () => inv.armor.slots[i], (v) => { inv.armor.slots[i] = v; }, { armor: i, ghost: 'gui/slot_' + ARMOR_SLOTS[i], accept: (s) => ITEMS[s.id].armor && ITEMS[s.id].armor.slot === i, max: 1 });
      }
      for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) this.containerSlot(p, inv, 9 + r * 9 + c, 9 + c * 18, 54 + r * 18, { group: 'main' });
      for (let c = 0; c < 9; c++) this.containerSlot(p, inv, c, 9 + c * 18, 112 + 30, { group: 'hotbar' });
      this.trashSlot(p, 173, 142);
      this.render(true);
      return;
    }
    if (tab.search) {
      const inp = el('input', 'search', p);
      inp.style.left = S(80); inp.style.top = S(4); inp.style.width = S(89);
      inp.placeholder = 'Search...';
      inp.value = this.searchText || '';
      inp.addEventListener('input', () => { this.searchText = inp.value; this.fillCreative(); });
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      setTimeout(() => inp.focus(), 0);
    }
    this.creativeItems = [];
    this.creativeScroll = 0;
    this.creativeSlots = [];
    for (let r = 0; r < 6; r++) for (let c = 0; c < 9; c++) {
      const k = r * 9 + c;
      const s = this.slot(p, 9 + c * 18, 18 + r * 18, () => this.creativeAt(k), () => {}, { creative: true });
      this.creativeSlots.push(s);
    }
    // scrollbar
    const sc = el('div', 'scroller', p);
    sc.style.left = S(174); sc.style.top = S(17); sc.style.width = S(14); sc.style.height = S(108);
    this.scrollThumb = el('i', '', sc);
    const scrollTo = (e) => {
      const r = sc.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      this.creativeScroll = Math.round(f * this.maxScroll());
      this.render(true);
    };
    sc.addEventListener('pointerdown', (e) => { e.stopPropagation(); scrollTo(e); const mv = (ev) => scrollTo(ev); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true }); });
    p.addEventListener('wheel', (e) => { this.creativeScroll = Math.max(0, Math.min(this.maxScroll(), this.creativeScroll + Math.sign(e.deltaY))); this.render(true); }, { passive: true });
    // hotbar row
    for (let c = 0; c < 9; c++) this.containerSlot(p, this.inv, c, 9 + c * 18, 142, { group: 'hotbar' });
    this.trashSlot(p, 173, 142);
    this.fillCreative();
  }

  trashSlot(p, x, y) {
    const s = this.slot(p, x, y, () => null, () => {}, { trash: true });
    s.inner.innerHTML = '<div style="position:absolute;inset:15%;border:calc(1.5*var(--s)) solid #6a1010;background:#a02424"></div>';
    s.static = true;
    return s;
  }

  fillCreative() {
    const tab = CREATIVE_TABS[this.tabIdx];
    let items = [];
    for (const it of ITEMS) {
      if (!it || it.hidden || !tab.filter(it)) continue;
      // one enchanted book per enchantment level, like vanilla
      if (it.id === I.enchanted_book) { for (const e of ENCHANTS) for (let l = 1; l <= e.max; l++) items.push({ id: it.id, count: 1, dmg: 0, ench: [[e.id, l]] }); }
      else items.push({ id: it.id, count: 1, dmg: 0 });
    }
    if (tab.search && this.searchText) {
      const q = this.searchText.toLowerCase();
      items = items.filter((st) => {
        const it = ITEMS[st.id];
        return it.display.toLowerCase().includes(q) || it.name.includes(q) || (st.ench || []).some((p) => enchName(p).toLowerCase().includes(q));
      });
    }
    this.creativeItems = items;
    this.creativeScroll = Math.min(this.creativeScroll, this.maxScroll());
    this.render(true);
  }
  maxScroll() { return Math.max(0, Math.ceil((this.creativeItems || []).length / 9) - 6); }
  creativeAt(k) {
    const st = this.creativeItems && this.creativeItems[this.creativeScroll * 9 + k];
    return st ? { ...st } : null;
  }

  // simple paper-doll of the player skin (front view)
  dollCanvas() {
    const sk = images['entity/steve'];
    const c = canvas(16, 32), g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(sk, 8, 8, 8, 8, 4, 0, 8, 8); // head
    g.drawImage(sk, 40, 8, 8, 8, 4, 0, 8, 8); // hat
    g.drawImage(sk, 20, 20, 8, 12, 4, 8, 8, 12); // body
    g.drawImage(sk, 44, 20, 4, 12, 0, 8, 4, 12); // right arm
    g.save(); g.scale(-1, 1); g.drawImage(sk, 44, 20, 4, 12, -16, 8, 4, 12); g.restore(); // left arm
    g.drawImage(sk, 4, 20, 4, 12, 4, 20, 4, 12); // right leg
    g.save(); g.scale(-1, 1); g.drawImage(sk, 4, 20, 4, 12, -12, 20, 4, 12); g.restore();
    c.style.width = S(32); c.style.height = S(64);
    return c;
  }

  // ---------------------------------------------------------------- recipe book
  recipeBook(p, w) {
    const btn = el('div', 'slot', p);
    btn.style.left = S(w === 2 ? 104 : 4); btn.style.top = S(w === 2 ? 60 : 32);
    btn.style.width = S(20); btn.style.height = S(18); btn.title = 'Recipe Book';
    btn.innerHTML = `<div class="in"><div class="icon" style="${iconStyle(I.book)}"></div></div>`;
    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.recipeOpen = !this.recipeOpen; this.buildRecipePanel(w); });
    this.buildRecipePanel(w);
  }
  buildRecipePanel(w) {
    if (this.recipePanel) { this.slots = this.slots.filter((s) => !this.recipePanel.contains(s.el)); this.recipePanel.remove(); this.recipePanel = null; }
    this.panelEl.style.marginLeft = '';
    if (!this.recipeOpen) return;
    const rp = el('div', 'panel', this.root);
    rp.style.width = S(147); rp.style.height = S(166);
    rp.style.transform = 'translate(-100%, -50%)';
    rp.style.left = `calc(50% - ${88 - 0} * var(--s) + 0px)`;
    this.panelEl.style.marginLeft = S(74);
    rp.style.marginLeft = S(74 - 2);
    this.recipePanel = rp;
    this.recipeW = w;
    this.recipeAll = this.recipeAll || false;
    const lbl = el('div', 'lbl', rp); lbl.style.left = S(8); lbl.style.top = S(6); lbl.textContent = 'Recipe Book';
    const tog = el('div', 'lbl', rp); tog.style.left = S(8); tog.style.top = S(150); tog.style.cursor = 'pointer'; tog.style.color = '#2a6a2a';
    tog.textContent = this.recipeAll ? '[All]' : '[Craftable]';
    tog.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.recipeAll = !this.recipeAll; this.buildRecipePanel(w); });
    this.recipeGrid = el('div', '', rp);
    this.recipePage = 0;
    this.fillRecipes();
  }
  fillRecipes() {
    const rp = this.recipePanel;
    if (!rp) return;
    this.slots = this.slots.filter((s) => !this.recipeGrid.contains(s.el));
    this.recipeGrid.innerHTML = '';
    const have = new Map();
    const add = (s) => { if (s) have.set(s.id, (have.get(s.id) || 0) + s.count); };
    this.inv.slots.forEach(add);
    if (this.grid) this.grid.slots.forEach(add);
    const seen = new Set();
    const list = [];
    for (const r of RECIPES) {
      if (r.hidden || seen.has(r.result)) continue;
      if (r.type === 'shaped' && (r.rows.length > this.recipeW || r.rows[0].length > this.recipeW)) continue;
      if (r.type === 'shapeless' && r.ings.length > this.recipeW * this.recipeW) continue;
      const can = this.canAfford(r, have);
      if (!can && !this.recipeAll) continue;
      seen.add(r.result);
      list.push([r, can]);
    }
    const per = 25;
    const pages = Math.max(1, Math.ceil(list.length / per));
    this.recipePage = Math.min(this.recipePage, pages - 1);
    list.slice(this.recipePage * per, this.recipePage * per + per).forEach(([r, can], i) => {
      const s = this.slot(this.recipeGrid, 11 + (i % 5) * 25, 20 + Math.floor(i / 5) * 25, () => ({ id: r.result, count: r.count, dmg: 0 }), () => {}, { recipe: r });
      s.el.style.width = S(22); s.el.style.height = S(22);
      s.inner.style.left = S(3); s.inner.style.top = S(3);
      if (!can) s.el.style.background = '#b35a5a';
      else s.el.style.background = '#8b8b8b';
    });
    if (pages > 1) {
      const nav = el('div', 'lbl', this.recipeGrid);
      nav.style.left = S(104); nav.style.top = S(150);
      nav.innerHTML = `<span style="cursor:pointer">&lt;</span> ${this.recipePage + 1}/${pages} <span style="cursor:pointer">&gt;</span>`;
      const [prev, next] = nav.querySelectorAll('span');
      prev.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.recipePage = (this.recipePage - 1 + pages) % pages; this.fillRecipes(); });
      next.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.recipePage = (this.recipePage + 1) % pages; this.fillRecipes(); });
    }
    this.render(true);
  }
  // ingredient list of a recipe as [want, count]
  ingredients(r) {
    const cnt = new Map();
    if (r.type === 'shaped') for (const row of r.rows) for (const c of row) { if (c !== ' ') cnt.set(r.key[c], (cnt.get(r.key[c]) || 0) + 1); }
    else for (const w of r.ings) cnt.set(w, (cnt.get(w) || 0) + 1);
    return cnt;
  }
  matches(want, id) {
    if (want[0] === '#') {
      const tag = want.slice(1);
      const n = ITEMS[id].name;
      if (tag === 'planks') return n.endsWith('_planks');
      if (tag === 'logs') return n.endsWith('_log');
      if (tag === 'wool') return n.endsWith('_wool');
      if (tag === 'coals') return n === 'coal' || n === 'charcoal';
      if (tag === 'cobble') return n === 'cobblestone' || n === 'mossy_cobblestone';
      return false;
    }
    return I[want] === id;
  }
  canAfford(r, have) {
    const need = this.ingredients(r);
    const pool = new Map(have);
    for (const [want, n] of need) {
      let left = n;
      for (const [id, c] of pool) {
        if (left <= 0) break;
        if (!this.matches(want, id)) continue;
        const take = Math.min(c, left);
        pool.set(id, c - take);
        left -= take;
      }
      if (left > 0) return false;
    }
    return true;
  }
  // move ingredients for recipe r from the inventory into the grid
  fillGrid(r, max) {
    const w = this.craftW;
    // return current grid contents first
    for (let i = 0; i < this.grid.slots.length; i++) { const s = this.grid.slots[i]; if (s) { this.inv.give(s); this.grid.slots[i] = null; } }
    const cells = [];
    if (r.type === 'shaped') {
      r.rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== ' ') cells.push([y * w + x, r.key[c]]); }));
    } else r.ings.forEach((want, i) => cells.push([i, want]));
    let times = max ? 64 : 1;
    for (const [, want] of cells) {
      let avail = 0;
      for (const s of this.inv.slots) if (s && this.matches(want, s.id)) avail += s.count;
      const uses = cells.filter((c) => c[1] === want).length;
      times = Math.min(times, Math.floor(avail / uses));
    }
    if (times <= 0) { this.render(true); return; }
    for (const [cell, want] of cells) {
      // pick an id that matches and take `times` of it
      for (let i = 0; i < 36 && (!this.grid.slots[cell] || this.grid.slots[cell].count < times); i++) {
        const s = this.inv.slots[i];
        if (!s || !this.matches(want, s.id)) continue;
        if (this.grid.slots[cell] && this.grid.slots[cell].id !== s.id) continue;
        const need = times - (this.grid.slots[cell] ? this.grid.slots[cell].count : 0);
        const take = Math.min(need, s.count, maxStack(s.id));
        if (!this.grid.slots[cell]) this.grid.slots[cell] = { id: s.id, count: 0, dmg: 0 };
        this.grid.slots[cell].count += take;
        s.count -= take;
        if (s.count <= 0) this.inv.slots[i] = null;
      }
    }
    this.render(true);
  }

  // ---------------------------------------------------------------- crafting result
  get craftResult() {
    if (!this.grid || this.kind === 'creative') return null;
    const r = this._recipe;
    return r ? { id: r.result, count: r.count, dmg: 0 } : null;
  }
  updateRecipe() {
    if (!this.grid) { this._recipe = null; return; }
    const ids = this.grid.slots.map((s) => (s ? s.id : null));
    this._recipe = matchRecipe(ids, this.craftW);
  }
  // consume one set of ingredients; returns crafted stack
  craftOnce() {
    const r = this._recipe;
    if (!r) return null;
    for (let i = 0; i < this.grid.slots.length; i++) {
      const s = this.grid.slots[i];
      if (!s) continue;
      const remain = r.remain && r.remain[ITEMS[s.id].name];
      s.count--;
      if (s.count <= 0) this.grid.slots[i] = null;
      if (remain) {
        const left = this.inv.give({ id: I[remain], count: 1, dmg: 0 });
        if (left) this.game.dropItem(this.game.player.x, this.game.player.y + 1, this.game.player.z, { id: I[remain], count: 1 });
      }
    }
    this.game.onCraft(r.result, r.count);
    const out = { id: r.result, count: r.count, dmg: 0 };
    this.updateRecipe();
    return out;
  }

  // ---------------------------------------------------------------- input
  onDown(e, s) {
    e.preventDefault(); e.stopPropagation();
    if (e.pointerType === 'touch') {
      // touch: tap = left click, long press = right click
      clearTimeout(this.pressTimer);
      let fired = false;
      this.pressTimer = setTimeout(() => { fired = true; this.click(s, 2, false); if (navigator.vibrate) navigator.vibrate(15); }, 380);
      const up = () => { clearTimeout(this.pressTimer); if (!fired) this.click(s, 0, false); };
      window.addEventListener('pointerup', up, { once: true });
      return;
    }
    const btn = e.button === 2 ? 2 : e.button === 1 ? 1 : 0;
    const shift = e.shiftKey;
    // drag distribution starts when holding a stack over an empty or matching slot
    if (this.cursor && !shift && !s.result && !s.creative && !s.trash && !s.recipe && (btn === 0 || btn === 2)) {
      this.drag = { btn, slots: [s], start: s };
      return;
    }
    this.click(s, btn, shift);
  }
  onEnter(s) {
    if (this.drag && !this.drag.slots.includes(s) && !s.result && !s.creative && !s.trash && !s.recipe) {
      const st = s.get();
      if (!st || same(st, this.cursor)) { this.drag.slots.push(s); s.el.classList.add('hl'); }
    }
    this.showTooltip(s);
  }
  onUp(e) {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    for (const s of d.slots) s.el.classList.remove('hl');
    if (d.slots.length <= 1) { this.click(d.start, d.btn, false); return; }
    // distribute
    const c = this.cursor;
    if (!c) return;
    const slots = d.slots.filter((s) => (!s.accept || s.accept(c)));
    if (d.btn === 0) {
      const each = Math.floor(c.count / slots.length);
      if (each < 1) return;
      for (const s of slots) {
        const st = s.get();
        const max = Math.min(maxStack(c.id), s.max || 64);
        const have = st ? st.count : 0;
        const put = Math.min(each, max - have);
        if (put <= 0) continue;
        s.set(withCount(c, have + put));
        c.count -= put;
      }
    } else {
      for (const s of slots) {
        if (c.count <= 0) break;
        const st = s.get();
        const max = Math.min(maxStack(c.id), s.max || 64);
        if (st && st.count >= max) continue;
        s.set(withCount(c, (st ? st.count : 0) + 1));
        c.count--;
      }
    }
    if (c.count <= 0) this.cursor = null;
    this.changed();
    void e;
  }
  onMove(e) {
    if (!this.root) return;
    this.mx = e.clientX; this.my = e.clientY;
    this.cursorEl.style.left = e.clientX + 'px';
    this.cursorEl.style.top = e.clientY + 'px';
    const t = this.tooltip;
    if (!t.classList.contains('hidden')) { t.style.left = e.clientX + 14 + 'px'; t.style.top = e.clientY - 26 + 'px'; this.clampTooltip(); }
  }
  clampTooltip() {
    const t = this.tooltip, r = t.getBoundingClientRect();
    if (r.right > innerWidth - 4) t.style.left = (this.mx - r.width - 14) + 'px';
    if (r.top < 4) t.style.top = '4px';
  }
  onKey(e) {
    if (!this.root) return;
    const ui = this.ui;
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.code;
    if (k === 'Escape' || k === ui.app.input.binds.inventory) {
      e.preventDefault(); e.stopPropagation();
      ui.closeScreen();
      return;
    }
    const s = this.hover;
    if (!s) return;
    if (/^Digit[1-9]$/.test(k) && !s.result && !s.recipe) {
      e.preventDefault(); e.stopPropagation();
      const n = +k.slice(5) - 1;
      const inv = this.inv;
      if (s.creative) { const st = s.get(); if (st) inv.slots[n] = withCount(st, maxStack(st.id)); this.changed(); return; }
      const a = s.get(), b = inv.slots[n];
      if (b && s.accept && !s.accept(b)) return;
      s.set(b ? { ...b } : null);
      inv.slots[n] = a ? { ...a } : null;
      this.changed();
    } else if (k === ui.app.input.binds.drop && !s.creative && !s.recipe) {
      e.preventDefault(); e.stopPropagation();
      const st = s.get();
      if (!st) return;
      if (s.result) { const out = this.craftOnce(); if (out) this.drop(out); this.changed(); return; }
      const n = e.ctrlKey ? st.count : 1;
      this.drop(withCount(st, n));
      st.count -= n;
      if (st.count <= 0) s.set(null);
      this.changed();
    }
  }

  drop(stack) {
    const g = this.game, p = g.player, d = p.lookDir();
    g.dropItem(p.x, p.y + p.eye - 0.3, p.z, stack, { vx: d[0] * 0.3, vy: 0.15, vz: d[2] * 0.3, delay: 40 });
  }

  clickOutside(e) {
    if (!this.cursor) { return; }
    const n = e.button === 2 ? 1 : this.cursor.count;
    this.drop(withCount(this.cursor, n));
    this.cursor.count -= n;
    if (this.cursor.count <= 0) this.cursor = null;
    this.changed();
  }

  // core click logic
  click(s, btn, shift) {
    const g = this.game;
    const now = performance.now();
    const dbl = now - this.lastClick.t < 300 && this.lastClick.slot === s && btn === 0;
    this.lastClick = { t: now, slot: s };
    g.sound.click();
    if (s.recipe) { this.fillGrid(s.recipe, shift); return; }
    if (s.trash) {
      if (this.cursor) this.cursor = null;
      else if (shift) { for (let i = 0; i < 36; i++) this.inv.slots[i] = null; }
      this.changed();
      return;
    }
    if (s.creative) {
      const st = s.get();
      if (this.cursor) { this.cursor = null; this.changed(); return; }
      if (!st) return;
      if (shift) { this.inv.give(withCount(st, maxStack(st.id))); this.changed(); return; }
      this.cursor = withCount(st, btn === 2 ? 1 : maxStack(st.id));
      this.changed();
      return;
    }
    if (s.anvilResult) { this.takeAnvil(shift); return; }
    if (s.tradeResult) { this.takeTrade(shift); return; }
    if (s.result) {
      if (shift) {
        // craft as many as fit
        let guard = 0;
        while (this._recipe && guard++ < 64) {
          const r = this._recipe;
          const test = { id: r.result, count: r.count, dmg: 0 };
          const left = this.inv.give(test);
          if (left > 0) { if (left < r.count) { /* partial: undo not possible, drop rest */ this.drop({ id: r.result, count: left }); this.consumeOnly(); } break; }
          this.consumeOnly();
        }
      } else {
        const out = this.craftResult;
        if (!out) return;
        if (this.cursor && (!same(this.cursor, out) || this.cursor.count + out.count > maxStack(out.id))) return;
        this.craftOnce();
        if (this.cursor) this.cursor.count += out.count; else this.cursor = out;
      }
      this.changed();
      return;
    }
    if (shift) { this.quickMove(s); this.changed(); return; }
    if (dbl && this.cursor) {
      // collect matching stacks onto the cursor
      const c = this.cursor, max = maxStack(c.id);
      for (const o of this.slots) {
        if (c.count >= max) break;
        if (o.result || o.creative || o.recipe || o.trash) continue;
        const st = o.get();
        if (!st || !same(st, c)) continue;
        const n = Math.min(st.count, max - c.count);
        c.count += n; st.count -= n;
        if (st.count <= 0) o.set(null);
      }
      this.changed();
      return;
    }
    const st = s.get();
    const c = this.cursor;
    const cap = (id) => Math.min(maxStack(id), s.max || 64);
    if (s.output) {
      // furnace output: take only
      if (!st) return;
      if (c && (!same(c, st) || c.count + st.count > maxStack(c.id))) return;
      if (c) c.count += st.count; else this.cursor = { ...st };
      s.set(null);
      this.furnaceXp();
      this.changed();
      return;
    }
    if (btn === 0) {
      if (!c && st) { this.cursor = st; s.set(null); }
      else if (c && !st) {
        if (s.accept && !s.accept(c)) return;
        const n = Math.min(c.count, cap(c.id));
        s.set(withCount(c, n));
        c.count -= n;
        if (c.count <= 0) this.cursor = null;
      } else if (c && st) {
        if (same(c, st)) {
          const n = Math.min(c.count, cap(st.id) - st.count);
          st.count += n; c.count -= n;
          if (c.count <= 0) this.cursor = null;
        } else {
          if (s.accept && !s.accept(c)) return;
          if (c.count > cap(c.id)) return;
          s.set(c); this.cursor = st;
        }
      }
    } else if (btn === 2) {
      if (!c && st) {
        const half = Math.ceil(st.count / 2);
        this.cursor = withCount(st, half);
        st.count -= half;
        if (st.count <= 0) s.set(null);
      } else if (c) {
        if (s.accept && !s.accept(c)) return;
        if (!st) { s.set(withCount(c, 1)); c.count--; }
        else if (same(c, st) && st.count < cap(st.id)) { st.count++; c.count--; }
        else if (!same(c, st)) { s.set(c); this.cursor = st; }
        if (this.cursor && this.cursor.count <= 0) this.cursor = null;
      }
    }
    if (s.armor !== undefined) g.sound.play('armor.equip', null, null, null, 0.4);
    this.changed();
  }

  consumeOnly() { this.craftOnce(); }

  furnaceXp() {
    const t = this.tile;
    if (t && t.xp >= 1) {
      const n = Math.floor(t.xp);
      t.xp -= n;
      this.game.player.addXp(n);
      this.game.sound.play('xp.orb', null, null, null, 0.3, 0.7);
    }
  }

  // shift-click: move a stack between the open container and the player inventory
  quickMove(s) {
    const st = s.get();
    if (!st) return;
    const inv = this.inv;
    const it = ITEMS[st.id];
    const moveInto = (targets) => {
      const max = maxStack(st.id);
      for (const t of targets) {
        if (st.count <= 0) break;
        const ts = t.get();
        if (ts && same(ts, st) && ts.count < max) { const n = Math.min(st.count, max - ts.count); ts.count += n; st.count -= n; }
      }
      for (const t of targets) {
        if (st.count <= 0) break;
        if (!t.get() && (!t.accept || t.accept(st))) { const n = Math.min(st.count, t.max || max); t.set(withCount(st, n)); st.count -= n; }
      }
      if (st.count <= 0) s.set(null);
    };
    const playerMain = this.slots.filter((t) => t.group === 'main');
    const playerHot = this.slots.filter((t) => t.group === 'hotbar');
    const inPlayer = s.group === 'main' || s.group === 'hotbar';
    if (s.output) { moveInto([...playerHot.slice().reverse(), ...playerMain.slice().reverse()]); this.furnaceXp(); return; }
    if (!inPlayer) { moveInto([...playerHot.slice().reverse(), ...playerMain.slice().reverse()]); return; }
    // from the player inventory into the container
    if (this.kind === 'chest') { moveInto(this.slots.filter((t) => t.chest)); return; }
    if (this.kind === 'enchant') {
      if (st.id === I.lapis_lazuli) moveInto(this.slots.filter((t) => t.lapis));
      else if (enchantability(st.id) > 0 && !this.extra.slots[0]) {
        // a single item goes onto the table
        this.extra.slots[0] = withCount(st, 1);
        st.count--;
        if (st.count <= 0) s.set(null);
      } else moveInto(s.group === 'main' ? playerHot : playerMain);
      return;
    }
    if (this.kind === 'trade') {
      moveInto(this.slots.filter((t) => t.tradeIn));
      if (st.count > 0 && s.get()) moveInto(s.group === 'main' ? playerHot : playerMain);
      return;
    }
    if (this.kind === 'anvil') {
      moveInto(this.slots.filter((t) => t.anvilIn));
      if (st.count > 0 && s.get()) moveInto(s.group === 'main' ? playerHot : playerMain);
      return;
    }
    if (this.kind === 'furnace') {
      if (SMELT[st.id]) moveInto(this.slots.filter((t) => t.furnaceIn));
      else if (FUEL[st.id]) moveInto(this.slots.filter((t) => t.fuel));
      else moveInto(s.group === 'main' ? playerHot : playerMain);
      return;
    }
    if ((this.kind === 'inventory' || (this.kind === 'creative')) && it.armor) {
      const a = this.slots.find((t) => t.armor === it.armor.slot);
      if (a && !a.get()) { moveInto([a]); return; }
    }
    moveInto(s.group === 'main' ? playerHot : playerMain);
  }

  changed() {
    if (this.kind === 'enchant') this.updateEnchant();
    if (this.kind === 'anvil') this.updateAnvil();
    if (this.kind === 'trade') this.updateTrade();
    this.updateRecipe();
    this.render(true);
    if (this.recipePanel) this.fillRecipes();
  }

  showTooltip(s) {
    const st = s.get();
    const t = this.tooltip;
    if (!st || this.cursor) { t.classList.add('hidden'); return; }
    const it = ITEMS[st.id];
    const rare = isEnchanted(st) || it.glint || it.id === I.golden_apple || it.id === I.enchanting_table;
    let h = `<div style="color:${rare ? '#55ffff' : it.id === I.diamond || it.id === I.anvil ? '#ffff55' : '#fff'}${st.label ? ';font-style:italic' : ''}">${esc(itemName(st))}</div>`;
    for (const p of st.ench || []) h += `<div class="sub" style="color:${ENCHANTS[p[0]] && ENCHANTS[p[0]].treasure ? '#a8a8ff' : '#a8a8a8'}">${enchName(p)}</div>`;
    if (it.food) h += `<div class="sub">Restores ${it.food.hunger / 2} hunger</div>`;
    if (it.damage && it.tool) h += `<div class="sub" style="color:#5555ff"> ${it.damage} Attack Damage</div>`;
    if (it.armor) h += `<div class="sub" style="color:#5555ff">+${it.armor.def} Armor</div>`;
    if (it.durability) h += `<div class="sub">Durability: ${it.durability - (st.dmg || 0)} / ${it.durability}</div>`;
    if (s.recipe) {
      const need = this.ingredients(s.recipe);
      const parts = [];
      for (const [w, n] of need) parts.push(`${n}x ${w[0] === '#' ? w.slice(1).replace(/^./, (c) => c.toUpperCase()) : ITEMS[I[w]].display}`);
      h += `<div class="sub">${parts.join('\n')}</div><div class="sub" style="color:#ffff55">Click to fill, shift-click for max</div>`;
    }
    t.innerHTML = h;
    t.classList.remove('hidden');
    t.style.left = (this.mx || 0) + 14 + 'px'; t.style.top = (this.my || 0) - 26 + 'px';
    this.clampTooltip();
  }

  // ---------------------------------------------------------------- per frame
  render(force) {
    if (!this.root) return;
    if (force) this.updateRecipe();
    for (const s of this.slots) {
      if (s.static) continue;
      const st = s.get();
      const key = stackKey(st);
      if (key !== s.key || force) {
        s.key = key;
        s.inner.innerHTML = slotHTML(st);
        if (s._ghost) s._ghost.style.display = st ? 'none' : '';
      }
    }
    const ck = stackKey(this.cursor);
    if (ck !== this.cursorKey) { this.cursorKey = ck; this.cursorEl.innerHTML = slotHTML(this.cursor); }
    if (this.scrollThumb) {
      const m = this.maxScroll();
      this.scrollThumb.style.top = `calc(${m ? (this.creativeScroll / m) * 91 : 0} * var(--s))`;
    }
  }

  frame(game) {
    if (!this.root) return;
    if (this.kind === 'enchant') this.updateEnchant();
    if (this.kind === 'furnace') {
      const t = this.tile;
      const f = t.burnMax ? t.burn / t.burnMax : 0;
      this.fireFg.style.clipPath = `inset(${(1 - f) * 100}% 0 0 0)`;
      this.arrowFg.style.clipPath = `inset(0 ${(1 - t.cook / 200) * 100}% 0 0)`;
    }
    this.render(false);
    void game;
  }
}
void B;
