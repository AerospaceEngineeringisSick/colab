// Item stacks and containers.
import { ITEMS, I, maxStack } from '../shared/items.js';
import { copyEnch, sameEnch } from '../shared/enchant.js';
import { potionName } from '../shared/potions.js';

// a stack is { id, count, dmg } plus optional ench (enchantments), label (anvil name) and work (anvil uses)
export const stack = (id, count = 1, dmg = 0) => ({ id, count, dmg });
export const cloneStack = (s) => (s ? { ...s, ench: copyEnch(s.ench) } : null);
// the same stack data with a different count
export const withCount = (s, n) => ({ ...s, count: n });
export const same = (a, b) => a && b && a.id === b.id && (a.dmg || 0) === (b.dmg || 0) && !ITEMS[a.id].durability
  && sameEnch(a.ench, b.ench) && (a.label || '') === (b.label || '') && (a.work || 0) === (b.work || 0) && (a.potion || '') === (b.potion || '');
export const itemName = (s) => (s ? s.label || (s.potion ? potionName(s.potion, s.id === I.splash_potion) : ITEMS[s.id].display) : '');
// key that changes whenever anything visible about a stack changes
export const stackKey = (s) => (s ? `${s.id}:${s.count}:${s.dmg || 0}:${s.ench ? s.ench.length : 0}:${s.label || ''}:${s.potion || ''}` : '');

// saves: [id, count, dmg] with a 4th element { e, l, w } only when there is extra data.
// Item names are accepted for the id (world generation writes loot that way).
export function stackToJSON(s) {
  if (!s) return null;
  const x = {};
  if (s.ench && s.ench.length) x.e = s.ench;
  if (s.label) x.l = s.label;
  if (s.work) x.w = s.work;
  if (s.potion) x.p = s.potion;
  return Object.keys(x).length ? [s.id, s.count, s.dmg || 0, x] : [s.id, s.count, s.dmg || 0];
}
export function stackFromJSON(v) {
  if (!v) return null;
  const id = typeof v[0] === 'string' ? I[v[0]] : v[0];
  if (id === undefined || !ITEMS[id]) return null;
  const s = { id, count: v[1] || 1, dmg: v[2] || 0 };
  const x = v[3];
  if (x) {
    if (x.e && x.e.length) s.ench = copyEnch(x.e);
    if (x.l) s.label = String(x.l);
    if (x.w) s.work = x.w | 0;
    if (x.p) s.potion = String(x.p);
  }
  return s;
}

// resolve 'name' or id
export const idOf = (n) => (typeof n === 'number' ? n : I[n]);

export class Container {
  constructor(size) {
    this.slots = new Array(size).fill(null);
  }
  get size() { return this.slots.length; }

  // add a stack; fills matching stacks first then empty slots in `order`. Returns leftover count.
  add(s, order) {
    if (!s) return 0;
    let left = s.count;
    const max = maxStack(s.id);
    const idxs = order || this.slots.map((_, i) => i);
    for (const i of idxs) {
      const t = this.slots[i];
      if (left <= 0) break;
      if (t && same(t, s) && t.count < max) {
        const n = Math.min(left, max - t.count);
        t.count += n; left -= n;
      }
    }
    for (const i of idxs) {
      if (left <= 0) break;
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = withCount(s, n);
        left -= n;
      }
    }
    return left;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  remove(id, count) {
    for (let i = this.slots.length - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(count, s.count);
        s.count -= n; count -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return count === 0;
  }

  clear() { this.slots.fill(null); }
  toJSON() { return this.slots.map(stackToJSON); }
  load(arr) {
    if (!arr) return;
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = stackFromJSON(arr[i]);
  }
}

// player inventory: 36 slots (0-8 hotbar), 4 armour, 2x2 crafting grid
export class PlayerInventory extends Container {
  constructor() {
    super(36);
    this.armor = new Container(4); // helmet, chestplate, leggings, boots
    this.craft = new Container(4);
    this.selected = 0;
  }
  get held() { return this.slots[this.selected]; }
  set held(s) { this.slots[this.selected] = s; }
  // hotbar first, then the main inventory
  give(s) {
    const order = [];
    for (let i = 0; i < 36; i++) order.push(i);
    return this.add(s, order);
  }
  armorPoints() {
    let p = 0;
    for (const s of this.armor.slots) if (s && ITEMS[s.id].armor) p += ITEMS[s.id].armor.def;
    return p;
  }
  armorToughness() {
    let p = 0;
    for (const s of this.armor.slots) if (s && ITEMS[s.id].armor) p += ITEMS[s.id].armor.tough;
    return p;
  }
  toJSON() {
    return { slots: super.toJSON(), armor: this.armor.toJSON(), selected: this.selected };
  }
  load(o) {
    if (!o) return;
    super.load(o.slots);
    this.armor.load(o.armor);
    this.selected = o.selected || 0;
  }
}
