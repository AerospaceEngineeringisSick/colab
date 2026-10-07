// Strongholds: three per world on a ring around spawn, buried in the stone. Each holds the End portal room,
// a library and storerooms joined by brick corridors. Like villages they are laid out from the seed alone
// and stamped into whichever chunks they touch.
import { B } from './blocks.js';
import { WH, idx } from './constants.js';
import { hash2, hash3, rng } from './noise.js';
import { ENCHANTS } from './enchant.js';

const M = (id, meta = 0) => id | (meta << 10);
const cache = new Map();

// the three strongholds of a world: { x, y, z (portal room centre), rooms, corridors, bounds }
export function strongholds(seed) {
  if (cache.has(seed)) return cache.get(seed);
  const R = rng(hash2(7, 13, seed ^ 0x57a1) * 4294967296);
  const a0 = R() * Math.PI * 2;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const ang = a0 + (i * Math.PI * 2) / 3 + (R() - 0.5) * 0.6;
    const dist = 640 + R() * 512;
    out.push(layout(Math.round(Math.cos(ang) * dist), 22 + ((R() * 10) | 0), Math.round(Math.sin(ang) * dist), R));
  }
  cache.set(seed, out);
  return out;
}

// rooms: { x0, z0, x1, z1 (outer walls), y, h (interior height), kind }
function layout(x, y, z, R) {
  const rooms = [], corridors = [];
  const room = (cx, cz, hx, hz, h, kind) => { const r = { x0: cx - hx, z0: cz - hz, x1: cx + hx, z1: cz + hz, y, h, kind, cx, cz }; rooms.push(r); return r; };
  const portal = room(x, z, 5, 8, 7, 'portal');
  // north of the portal room: a crossing with branches to a library, a storeroom and a dead-end prison
  const l1 = 8 + ((R() * 10) | 0);
  const cross = room(x, portal.z0 - l1 - 4, 4, 4, 5, 'cross');
  corridors.push({ x0: x - 2, x1: x + 2, z0: cross.z1, z1: portal.z0, y });
  const lw = 8 + ((R() * 8) | 0), le = 8 + ((R() * 8) | 0), ln = 6 + ((R() * 8) | 0);
  const lib = room(cross.x0 - lw - 6, cross.cz, 6, 6, 8, 'library');
  corridors.push({ x0: lib.x1, x1: cross.x0, z0: cross.cz - 2, z1: cross.cz + 2, y });
  const store = room(cross.x1 + le + 4, cross.cz, 4, 4, 5, 'store');
  corridors.push({ x0: cross.x1, x1: store.x0, z0: cross.cz - 2, z1: cross.cz + 2, y });
  const cells = room(x, cross.z0 - ln - 4, 4, 4, 5, 'prison');
  corridors.push({ x0: x - 2, x1: x + 2, z0: cells.z1, z1: cross.z0, y });
  let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
  for (const r of [...rooms, ...corridors]) { bx0 = Math.min(bx0, r.x0); bz0 = Math.min(bz0, r.z0); bx1 = Math.max(bx1, r.x1); bz1 = Math.max(bz1, r.z1); }
  return { x, y, z, rooms, corridors, bx0, bz0, bx1, bz1, seed: (R() * 4294967296) >>> 0 };
}

export function strongholdsNear(seed, x0, z0, x1, z1) {
  return strongholds(seed).filter((s) => s.bx1 >= x0 && s.bx0 <= x1 && s.bz1 >= z0 && s.bz0 <= z1);
}

// the nearest stronghold to (x, z): where eyes of ender fly
export function nearestStronghold(seed, x, z) {
  let best = null, bd = Infinity;
  for (const s of strongholds(seed)) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
  return best;
}

export function stampStrongholds(gen, ctx) {
  const { x0, z0 } = ctx;
  for (const s of strongholdsNear(gen.seed, x0, z0, x0 + 15, z0 + 15)) stamp(gen, ctx, s);
}

function stamp(gen, ctx, s) {
  const { blocks, x0, z0 } = ctx;
  const inside = (x, z) => x >= x0 && x < x0 + 16 && z >= z0 && z < z0 + 16;
  const set = (x, y, z, v) => { if (inside(x, z) && y > 0 && y < WH - 1) blocks[idx(x - x0, y, z - z0)] = v; };
  // weathered brickwork: mostly plain, some mossy and cracked
  const brick = (x, y, z) => {
    const h = hash3(x, y, z, s.seed);
    return h < 0.2 ? B.mossy_stone_bricks : h < 0.32 ? B.cracked_stone_bricks : B.stone_bricks;
  };
  const box = (r, h) => {
    for (let x = Math.max(r.x0, x0); x <= Math.min(r.x1, x0 + 15); x++) for (let z = Math.max(r.z0, z0); z <= Math.min(r.z1, z0 + 15); z++) {
      const wall = x === r.x0 || x === r.x1 || z === r.z0 || z === r.z1;
      for (let y = r.y - 1; y <= r.y + h; y++) set(x, y, z, wall || y === r.y - 1 || y === r.y + h ? brick(x, y, z) : 0);
    }
  };
  for (const c of s.corridors) box(c, 4);
  for (const r of s.rooms) box(r, r.h);
  // doorways between rooms and corridors
  for (const c of s.corridors) {
    const alongZ = c.x1 - c.x0 === 4;
    for (let k = 1; k <= 3; k++) for (let y = c.y; y < c.y + 3; y++) {
      if (alongZ) { set(c.x0 + k, y, c.z0, 0); set(c.x0 + k, y, c.z1, 0); }
      else { set(c.x0, y, c.z0 + k, 0); set(c.x1, y, c.z0 + k, 0); }
    }
    // a torch now and then along corridors
    if (alongZ) for (let z = c.z0 + 3; z < c.z1; z += 6) set(c.x0 + 1, c.y + 2, z, M(B.torch, 4));
    else for (let x = c.x0 + 3; x < c.x1; x += 6) set(x, c.y + 2, c.z0 + 1, M(B.torch, 1));
  }
  for (const r of s.rooms) {
    if (r.kind === 'portal') portalRoom(ctx, set, s, r);
    else if (r.kind === 'library') library(ctx, set, s, r, inside);
    else if (r.kind === 'store') {
      for (const [dx, f] of [[-2, 3], [2, 1]]) {
        const x = r.cx + dx, z = r.cz;
        if (!inside(x, z)) continue;
        set(x, r.y, z, M(B.chest, f));
        ctx.tiles.push({ type: 'chest', x, y: r.y, z, items: loot(rng(hash2(x, z, s.seed) * 4294967296), CORRIDOR_LOOT) });
      }
      set(r.cx, r.y + 3, r.cz + 3, M(B.torch, 3));
    } else if (r.kind === 'prison') {
      // iron-barred cells are just cobwebbed alcoves here
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) set(r.cx + dx, r.y + 2, r.cz + dz, B.cobweb);
    } else if (r.kind === 'cross') {
      set(r.cx, r.y, r.cz, B.stone_bricks); set(r.cx, r.y + 1, r.cz, B.stone_brick_slab);
      set(r.cx, r.y + 2, r.cz, B.torch);
    }
  }
}

// the End portal: a frame of twelve on a raised dais over a lava pool, stairs up to it, and a silverfish spawner
function portalRoom(ctx, set, s, r) {
  const { x0, z0 } = ctx;
  const cx = r.cx, cz = r.cz + 2, y = r.y;
  for (let x = cx - 2; x <= cx + 2; x++) for (let z = cz - 2; z <= cz + 2; z++) for (let h = 0; h < 3; h++) set(x, y + h, z, B.stone_bricks);
  for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) { set(x, y + 2, z, B.lava); set(x, y + 1, z, B.stone_bricks); }
  const frame = (x, z, f) => {
    const eye = hash2(x, z, s.seed ^ 0xe7e) < 0.1 ? 4 : 0;
    set(x, y + 3, z, M(B.end_portal_frame, f | eye));
  };
  for (let k = -1; k <= 1; k++) {
    frame(cx + k, cz - 2, 0); frame(cx + k, cz + 2, 2);
    frame(cx - 2, cz + k, 3); frame(cx + 2, cz + k, 1);
  }
  // stairs up from the north
  for (let k = -1; k <= 1; k++) {
    set(cx + k, y, cz - 5, M(B.stone_brick_stairs, 0));
    set(cx + k, y, cz - 4, B.stone_bricks); set(cx + k, y + 1, cz - 4, M(B.stone_brick_stairs, 0));
    set(cx + k, y, cz - 3, B.stone_bricks); set(cx + k, y + 1, cz - 3, B.stone_bricks); set(cx + k, y + 2, cz - 3, M(B.stone_brick_stairs, 0));
  }
  // the spawner on a little platform at the far end
  const sx = cx + 3, sz = r.z0 + 2;
  set(sx, y, sz, B.spawner);
  if (sx >= x0 && sx < x0 + 16 && sz >= z0 && sz < z0 + 16) ctx.tiles.push({ type: 'spawner', x: sx, y, z: sz, mob: 'silverfish', delay: 200 });
  for (const [dx, dz] of [[-4, -6], [4, -6], [-4, 6], [4, 6]]) set(r.cx + dx, y + 3, r.cz + dz, M(B.torch, dx < 0 ? 4 : 2));
}

function library(ctx, set, s, r, inside) {
  // shelves line the walls, two chests and plenty of cobwebs
  for (let x = r.x0 + 1; x < r.x1; x++) for (let z = r.z0 + 1; z < r.z1; z++) {
    const edge = x === r.x0 + 1 || x === r.x1 - 1 || z === r.z0 + 1 || z === r.z1 - 1;
    for (let y = r.y; y < r.y + 5; y++) {
      if (edge && !(Math.abs(z - r.cz) <= 1 && (x === r.x1 - 1)) && y < r.y + 4) set(x, y, z, B.bookshelf);
    }
    if (!edge && (x - r.x0) % 3 === 0 && Math.abs(z - r.cz) > 1) for (let y = r.y; y < r.y + 3; y++) set(x, y, z, B.bookshelf);
    if (hash2(x, z, s.seed ^ 0xc0b) < 0.08) set(x, r.y + 4 + ((hash2(z, x, s.seed) * 3) | 0), z, B.cobweb);
  }
  for (const [dx, dz, f] of [[-4, 0, 3], [2, -4, 0]]) {
    const x = r.cx + dx, z = r.cz + dz;
    if (!inside(x, z)) continue;
    set(x, r.y, z, M(B.chest, f));
    ctx.tiles.push({ type: 'chest', x, y: r.y, z, items: loot(rng(hash2(x, z, s.seed) * 4294967296), LIBRARY_LOOT) });
  }
  set(r.cx, r.y + 4, r.cz, B.torch);
}

const CORRIDOR_LOOT = [
  ['ender_pearl', 1, 1, 10], ['diamond', 1, 3, 3], ['iron_ingot', 1, 5, 10], ['gold_ingot', 1, 3, 5], ['redstone', 4, 9, 5],
  ['bread', 1, 3, 15], ['apple', 1, 3, 15], ['iron_pickaxe', 1, 1, 5], ['iron_sword', 1, 1, 5], ['iron_chestplate', 1, 1, 5],
  ['iron_helmet', 1, 1, 5], ['iron_leggings', 1, 1, 5], ['iron_boots', 1, 1, 5], ['golden_apple', 1, 1, 1], ['saddle', 1, 1, 1],
  ['enchanted_book', 1, 1, 6],
];
const LIBRARY_LOOT = [['book', 1, 3, 20], ['paper', 2, 7, 20], ['compass', 1, 1, 1], ['enchanted_book', 1, 1, 10]];

function loot(R, table) {
  const total = table.reduce((a, t) => a + t[3], 0);
  const items = new Array(27).fill(null);
  const n = 2 + ((R() * 4) | 0);
  for (let i = 0; i < n; i++) {
    let r = R() * total, pick = table[0];
    for (const t of table) { r -= t[3]; if (r <= 0) { pick = t; break; } }
    let slot = (R() * 27) | 0;
    while (items[slot]) slot = (slot + 1) % 27;
    if (pick[0] === 'enchanted_book') { const e = ENCHANTS[(R() * ENCHANTS.length) | 0]; items[slot] = ['enchanted_book', 1, 0, { e: [[e.id, 1 + ((R() * e.max) | 0)]] }]; }
    else items[slot] = [pick[0], pick[1] + ((R() * (pick[2] - pick[1] + 1)) | 0)];
  }
  return items;
}
