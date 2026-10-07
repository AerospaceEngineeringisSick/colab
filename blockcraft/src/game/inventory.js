// Item stacks and containers.
import { ITEMS, I, maxStack } from '../shared/items.js';

export const stack = (id, count = 1, dmg = 0) => ({ id, count, dmg });
export const cloneStack = (s) => (s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null);
export const same = (a, b) => a && b && a.id === b.id && (a.dmg || 0) === (b.dmg || 0) && !ITEMS[a.id].durability;
export const itemName = (s) => (s ? ITEMS[s.id].display : '');

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
        this.slots[i] = { id: s.id, count: n, dmg: s.dmg || 0 };
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
  toJSON() { return this.slots.map((s) => (s ? [s.id, s.count, s.dmg || 0] : null)); }
  load(arr) {
    if (!arr) return;
    for (let i = 0; i < this.slots.length; i++) {
      const v = arr[i];
      this.slots[i] = v && ITEMS[v[0]] ? { id: v[0], count: v[1], dmg: v[2] || 0 } : null;
    }
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
