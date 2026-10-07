// Enchantments: definitions, the enchanting table's offers (vanilla's algorithm), anvil rules and stack helpers.
// Stacks carry enchantments as `ench: [[enchId, level], ...]`. Ids are stored in saves: only append.
import { ITEMS, I, TIERS } from './items.js';
import { B } from './blocks.js';

export const ENCHANTS = [];
export const EN = {};

const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// cats: item categories that accept it at the table. min(l): lowest modified level that rolls level l;
// span: width of that window. excl: mutually exclusive group. treasure: never offered by the table.
function ench(key, o) {
  const e = { id: ENCHANTS.length, key, name: o.name || titleCase(key), excl: null, treasure: false, ...o };
  e.maxCost = (l) => (o.maxCost ? o.maxCost(l) : e.min(l) + e.span);
  ENCHANTS.push(e);
  EN[key] = e.id;
}
ench('protection', { max: 4, weight: 10, cats: ['armor'], min: (l) => 1 + (l - 1) * 11, span: 11, excl: 'protection' });
ench('fire_protection', { max: 4, weight: 5, cats: ['armor'], min: (l) => 10 + (l - 1) * 8, span: 8, excl: 'protection' });
ench('feather_falling', { max: 4, weight: 5, cats: ['feet'], min: (l) => 5 + (l - 1) * 6, span: 6 });
ench('blast_protection', { max: 4, weight: 2, cats: ['armor'], min: (l) => 5 + (l - 1) * 8, span: 8, excl: 'protection' });
ench('projectile_protection', { max: 4, weight: 5, cats: ['armor'], min: (l) => 3 + (l - 1) * 6, span: 6, excl: 'protection' });
ench('respiration', { max: 3, weight: 2, cats: ['head'], min: (l) => 10 * l, span: 30 });
ench('aqua_affinity', { max: 1, weight: 2, cats: ['head'], min: () => 1, span: 40 });
ench('thorns', { max: 3, weight: 1, cats: ['chest'], min: (l) => 10 + 20 * (l - 1), span: 50 });
ench('sharpness', { max: 5, weight: 10, cats: ['weapon'], min: (l) => 1 + (l - 1) * 11, span: 20, excl: 'damage' });
ench('smite', { max: 5, weight: 5, cats: ['weapon'], min: (l) => 5 + (l - 1) * 8, span: 20, excl: 'damage' });
ench('bane_of_arthropods', { max: 5, weight: 5, cats: ['weapon'], min: (l) => 5 + (l - 1) * 8, span: 20, excl: 'damage', name: 'Bane of Arthropods' });
ench('knockback', { max: 2, weight: 5, cats: ['weapon'], min: (l) => 5 + 20 * (l - 1), span: 50 });
ench('fire_aspect', { max: 2, weight: 2, cats: ['weapon'], min: (l) => 10 + 20 * (l - 1), span: 50 });
ench('looting', { max: 3, weight: 2, cats: ['weapon'], min: (l) => 15 + (l - 1) * 9, span: 50 });
ench('efficiency', { max: 5, weight: 10, cats: ['digger'], min: (l) => 1 + 10 * (l - 1), span: 50 });
ench('silk_touch', { max: 1, weight: 1, cats: ['digger'], min: () => 15, span: 50, excl: 'loot' });
ench('unbreaking', { max: 3, weight: 5, cats: ['breakable'], min: (l) => 5 + (l - 1) * 8, span: 50 });
ench('fortune', { max: 3, weight: 2, cats: ['digger'], min: (l) => 15 + (l - 1) * 9, span: 50, excl: 'loot' });
ench('power', { max: 5, weight: 10, cats: ['bow'], min: (l) => 1 + (l - 1) * 10, span: 15 });
ench('punch', { max: 2, weight: 2, cats: ['bow'], min: (l) => 12 + (l - 1) * 20, span: 25 });
ench('flame', { max: 1, weight: 2, cats: ['bow'], min: () => 20, span: 30 });
ench('infinity', { max: 1, weight: 1, cats: ['bow'], min: () => 20, span: 30, excl: 'infinite' });
ench('mending', { max: 1, weight: 2, cats: ['breakable'], min: (l) => 25 * l, span: 50, excl: 'infinite', treasure: true });

const ARMOR_ENCH = { leather: 15, chainmail: 12, iron: 9, golden: 25, diamond: 10 };
// anvil repair materials by tool / armour material
const REPAIR = { stone: ['cobblestone'], iron: ['iron_ingot'], golden: ['gold_ingot'], diamond: ['diamond'], leather: ['leather'], chainmail: ['iron_ingot'] };
export function repairTest(id) {
  const it = ITEMS[id];
  const mat = it && ((it.tool && it.tool.mat) || (it.armor && it.armor.mat));
  if (!mat) return null;
  if (mat === 'wooden') return (rid) => ITEMS[rid] && ITEMS[rid].name.endsWith('_planks');
  const ids = (REPAIR[mat] || []).map((n) => I[n]);
  return (rid) => ids.includes(rid);
}

// how readily an item takes enchantments (0 = not at the table)
export function enchantability(id) {
  const it = ITEMS[id];
  if (!it) return 0;
  if (id === I.book) return 1;
  if (it.tool && it.tool.mat) return TIERS[it.tool.mat].ench;
  if (it.armor) return ARMOR_ENCH[it.armor.mat] || 0;
  if (it.use === 'bow') return 1;
  return 0;
}

// categories an item belongs to
export function itemCats(id) {
  const it = ITEMS[id], c = new Set();
  if (!it) return c;
  if (it.durability) c.add('breakable');
  if (it.armor) { c.add('armor'); c.add(['head', 'chest', 'legs', 'feet'][it.armor.slot]); }
  if (it.tool) {
    if (it.tool.type === 'sword') c.add('weapon');
    else if (['pickaxe', 'axe', 'shovel', 'hoe'].includes(it.tool.type)) c.add('digger');
  }
  if (it.use === 'bow') c.add('bow');
  return c;
}

// can enchantment e go onto item id (anvil rules: axes also take the damage enchantments)
export function canApply(e, id) {
  const it = ITEMS[id];
  if (id === I.enchanted_book || id === I.book) return true;
  const cats = itemCats(id);
  if (e.cats.some((c) => cats.has(c))) return true;
  return !!(it && it.tool && it.tool.type === 'axe' && e.excl === 'damage');
}
export const compatible = (a, b) => a.id !== b.id && !(a.excl && a.excl === b.excl);

// small seeded generator (offers must stay the same until the player enchants)
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ri = (r, n) => Math.floor(r() * n);

function pickWeighted(list, r) {
  let total = 0;
  for (const a of list) total += a.e.weight;
  let k = r() * total;
  for (const a of list) { k -= a.e.weight; if (k < 0) return a; }
  return list[list.length - 1];
}

// enchantments (and their levels) available at a modified enchanting level
function available(id, level, treasure) {
  const book = id === I.book;
  const cats = itemCats(id);
  const out = [];
  for (const e of ENCHANTS) {
    if (e.treasure && !treasure) continue;
    if (!book && !e.cats.some((c) => cats.has(c))) continue;
    for (let l = e.max; l >= 1; l--) {
      if (level >= e.min(l) && level <= e.maxCost(l)) { out.push({ e, lvl: l }); break; }
    }
  }
  return out;
}

// vanilla selectEnchantment: returns [[enchId, level], ...]
export function rollEnchants(id, level, r, treasure = false) {
  const ench = enchantability(id);
  if (ench <= 0) return [];
  level += 1 + ri(r, (ench >> 2) + 1) + ri(r, (ench >> 2) + 1);
  const f = (r() + r() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * f));
  let avail = available(id, level, treasure);
  const out = [];
  if (!avail.length) return out;
  let pick = pickWeighted(avail, r);
  out.push([pick.e.id, pick.lvl]);
  while (ri(r, 50) <= level) {
    const last = pick.e;
    avail = avail.filter((a) => compatible(a.e, last));
    if (!avail.length) break;
    pick = pickWeighted(avail, r);
    out.push([pick.e.id, pick.lvl]);
    level = Math.floor(level / 2);
  }
  if (id === I.book && out.length > 1) out.splice(ri(r, out.length), 1);
  return out;
}

// the table's three offers: { cost, list, hint } or null per row
export function tableOffers(id, shelves, seed) {
  if (enchantability(id) <= 0) return [null, null, null];
  const r = rng(seed);
  const b = Math.min(15, shelves);
  const costs = [0, 1, 2].map((i) => {
    const base = ri(r, 8) + 1 + (b >> 1) + ri(r, b + 1);
    const c = i === 0 ? Math.max(Math.floor(base / 3), 1) : i === 1 ? Math.floor(base * 2 / 3) + 1 : Math.max(base, b * 2);
    return c < i + 1 ? 0 : c;
  });
  return costs.map((cost, i) => {
    if (!cost) return null;
    const rr = rng(seed + i + 1);
    const list = rollEnchants(id, cost, rr);
    if (!list.length) return null;
    return { cost, list, hint: list[ri(rr, list.length)] };
  });
}

// bookshelves around a table: two blocks out, at table height and one above, with air in between.
// Returns their offsets from the table.
export function shelfOffsets(world, x, y, z) {
  const out = [];
  const at = (ox, oy, oz) => { if (world.getId(x + ox, y + oy, z + oz) === B.bookshelf) out.push([ox, oy, oz]); };
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      if (world.getId(x + dx, y, z + dz) || world.getId(x + dx, y + 1, z + dz)) continue;
      for (let k = 0; k <= 1; k++) {
        at(dx * 2, k, dz * 2);
        if (dx && dz) { at(dx * 2, k, dz); at(dx, k, dz * 2); }
      }
    }
  }
  return out;
}
export const countShelves = (world, x, y, z) => shelfOffsets(world, x, y, z).length;

// ------------------------------------------------------------------ stack helpers
export const isEnchanted = (s) => !!(s && s.ench && s.ench.length);
export function enchLevel(s, key) {
  if (!s || !s.ench) return 0;
  const id = EN[key];
  for (const [e, l] of s.ench) if (e === id) return l;
  return 0;
}
// total level of an enchantment across worn armour
export function armorLevel(inv, key) {
  let n = 0;
  for (const s of inv.armor.slots) n += enchLevel(s, key);
  return n;
}
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = (n) => ROMAN[n] || String(n);
export function enchName([id, l]) {
  const e = ENCHANTS[id];
  return e ? e.name + (e.max > 1 || l > 1 ? ' ' + roman(l) : '') : '?';
}
export const copyEnch = (list) => (list ? list.map((p) => [p[0], p[1]]) : undefined);
export const sameEnch = (a, b) => {
  const x = a || [], y = b || [];
  return x.length === y.length && x.every((p, i) => p[0] === y[i][0] && p[1] === y[i][1]);
};

// ------------------------------------------------------------------ anvil
// combine `left` with `right` (same item, an enchanted book or the repair material) and/or rename it.
// isRepair(id): is that item the repair material for `left`. rename: undefined = keep, '' = reset, else the new name.
// Returns { out, cost, use } (use = how many of `right` are consumed) or null when nothing would change.
export function anvilCombine(left, right, isRepair, rename) {
  if (!left) return null;
  const it = ITEMS[left.id];
  const out = { ...left, ench: copyEnch(left.ench) || [] };
  let cost = 0, changed = false, use = right ? 1 : 0;
  if (right) {
    const book = right.id === I.enchanted_book;
    if (isRepair && isRepair(right.id) && it.durability) {
      // each unit of material restores a quarter of the maximum durability
      if (!left.dmg) return null;
      let dmg = left.dmg;
      use = 0;
      while (dmg > 0 && use < right.count) { dmg = Math.max(0, dmg - Math.floor(it.durability / 4)); use++; }
      out.dmg = dmg;
      cost += use;
      changed = true;
    } else if (right.id === left.id || book) {
      if (!book && !it.durability && left.id !== I.enchanted_book) return null;
      if (!book && it.durability && (left.dmg || 0) > 0) {
        // two of the same tool: remaining durability of both plus a 12% bonus
        const a = it.durability - left.dmg, b = it.durability - (right.dmg || 0);
        out.dmg = Math.max(0, it.durability - (a + b + Math.floor(it.durability * 0.12)));
        cost += 2;
        changed = true;
      }
      for (const [eid, lvl] of right.ench || []) {
        const e = ENCHANTS[eid];
        if (!canApply(e, left.id) || out.ench.some((p) => p[0] !== eid && !compatible(ENCHANTS[p[0]], e))) { cost++; continue; }
        const cur = out.ench.find((p) => p[0] === eid);
        const nl = cur ? (cur[1] === lvl ? Math.min(e.max, lvl + 1) : Math.max(cur[1], lvl)) : lvl;
        if (cur && cur[1] === nl) continue;
        if (cur) cur[1] = nl; else out.ench.push([eid, nl]);
        const mult = e.weight >= 10 ? 1 : e.weight >= 5 ? 2 : e.weight >= 2 ? 4 : 8;
        cost += nl * (book ? Math.max(1, mult >> 1) : mult);
        changed = true;
      }
    } else return null;
  }
  if (rename !== undefined && rename !== (left.label || '')) {
    cost++;
    changed = true;
    if (rename) out.label = rename; else delete out.label;
  }
  if (!changed) return null;
  // prior work penalty: doubles every time an item goes through the anvil
  cost += (left.work || 0) + (right ? right.work || 0 : 0);
  out.work = Math.max(left.work || 0, right ? right.work || 0 : 0) * 2 + 1;
  if (!out.ench.length) delete out.ench;
  return { out, cost, use };
}
