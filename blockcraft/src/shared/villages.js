// Villages: one candidate per 288-block region, laid out deterministically from the seed and stamped into
// every chunk it touches (like trees, so a village is identical whichever chunk generates first).
import { B, BLOCKS, R } from './blocks.js';
import { BI } from './biomes.js';
import { SEA, WH, CS, idx } from './constants.js';
import { hash2, rng } from './noise.js';

const REGION = 288;
export const VILLAGE_RADIUS = 56;

const STYLE = {
  plains: { planks: 'oak_planks', log: 'oak_log', base: 'cobblestone', stairs: 'oak_stairs', slab: 'oak_slab', path: 'dirt_path', type: 'plains' },
  taiga: { planks: 'spruce_planks', log: 'spruce_log', base: 'cobblestone', stairs: 'spruce_stairs', slab: 'oak_slab', path: 'dirt_path', type: 'taiga' },
  snowy: { planks: 'spruce_planks', log: 'spruce_log', base: 'cobblestone', stairs: 'spruce_stairs', slab: 'oak_slab', path: 'dirt_path', type: 'snow' },
  savanna: { planks: 'acacia_planks', log: 'acacia_log', base: 'cobblestone', stairs: 'acacia_stairs', slab: 'oak_slab', path: 'dirt_path', type: 'savanna' },
  desert: { planks: 'cut_sandstone', log: 'sandstone', base: 'sandstone', stairs: 'sandstone_stairs', slab: 'sandstone_slab', path: 'cut_sandstone', type: 'desert', flat: true },
};
const BIOME_STYLE = {
  [BI.PLAINS]: 'plains', [BI.SAVANNA]: 'savanna', [BI.DESERT]: 'desert', [BI.TAIGA]: 'taiga', [BI.SNOWY_PLAINS]: 'snowy', [BI.SNOWY_TAIGA]: 'snowy',
};

const FDIR = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // facing 0 south, 1 west, 2 north, 3 east

// turn a block value with the building (k quarter turns south -> west -> north -> east)
function rotV(v, k) {
  const id = v & 1023;
  let m = v >>> 10;
  if (!k || !id) return v;
  const b = BLOCKS[id];
  if (b.render === R.STAIRS || b.render === R.DOOR || b.render === R.BED || b.render === R.LADDER || b.rotate === 'facing') m = (m & ~3) | (((m & 3) + k) & 3);
  else if (b.render === R.TORCH && m > 0) m = (((m - 1) + k) & 3) + 1;
  else if (b.rotate === 'axis' && k & 1 && m !== 0) m = m === 1 ? 2 : 1;
  return id | (m << 10);
}

// ------------------------------------------------------------------ building templates
// Each draws into local coordinates facing south (front / door on the z = d-1 side). set(x, y, z, block, meta)
const TEMPLATES = {
  house: { w: 5, d: 5, draw: (s, S, R) => { walls(s, S, 5, 5, 3); gable(s, S, 5, 5, 4); interior(s, S, R, 5, 5); } },
  big_house: { w: 7, d: 6, draw: (s, S, R) => { walls(s, S, 7, 6, 3); gable(s, S, 7, 6, 4); interior(s, S, R, 7, 6); s(5, 1, 1, 'crafting_table'); } },
  library: {
    w: 9, d: 7, draw: (s, S) => {
      walls(s, S, 9, 7, 4); gable(s, S, 9, 7, 5);
      for (let x = 1; x < 8; x++) { s(x, 1, 1, 'bookshelf'); s(x, 2, 1, 'bookshelf'); }
      for (let z = 2; z < 5; z++) { s(1, 1, z, 'bookshelf'); s(7, 1, z, 'bookshelf'); }
      s(4, 1, 3, 'crafting_table'); s(4, 3, 1, 'torch', 1);
    },
  },
  smith: {
    w: 7, d: 6, draw: (s, S) => {
      floor(s, S, 7, 6, S.base);
      for (const [x, z] of [[0, 0], [6, 0], [0, 5], [6, 5]]) for (let y = 1; y <= 3; y++) s(x, y, z, S.log);
      for (let x = 0; x < 7; x++) for (let y = 1; y <= 3; y++) s(x, y, 0, x === 0 || x === 6 ? S.log : 'cobblestone');
      for (let z = 1; z < 5; z++) for (let y = 1; y <= 3; y++) { s(0, y, z, 'cobblestone'); s(6, y, z, z === 2 && y === 2 ? 'glass' : 'cobblestone'); }
      for (let x = 0; x < 7; x++) for (let z = 0; z < 6; z++) s(x, 4, z, S.slab);
      s(1, 1, 1, 'furnace', 0); s(2, 1, 1, 'furnace', 0); s(4, 1, 1, 'chest', 0, 'smith'); s(5, 1, 1, 'anvil', 1);
      s(3, 3, 1, 'torch', 1);
    },
  },
  church: {
    w: 5, d: 8, draw: (s, S) => {
      floor(s, S, 5, 8, S.base);
      for (let z = 0; z < 8; z++) for (let x = 0; x < 5; x++) {
        const edge = x === 0 || x === 4 || z === 0 || z === 7;
        const tower = z < 4;
        const top = tower ? 9 : 4;
        for (let y = 1; y <= top; y++) if (edge || (tower && y === 5)) s(x, y, z, 'cobblestone');
        s(x, top + 1, z, 'cobblestone_slab');
      }
      for (const [x, z] of [[0, 5], [4, 5], [0, 2], [4, 2]]) s(x, 2, z, 'glass');
      for (const [x, z] of [[2, 0], [0, 2], [4, 2]]) { s(x, 7, z, 'glass'); s(x, 8, z, 'glass'); }
      s(2, 1, 7, 'oak_door', 0); s(2, 2, 7, 'oak_door', 4);
      for (let y = 1; y <= 5; y++) s(2, y, 1, 'ladder', 0);
      s(1, 3, 6, 'torch', 4); s(3, 3, 6, 'torch', 2);
    },
  },
  farm: {
    w: 9, d: 7, flatOnly: true, draw: (s, S, R) => {
      for (let x = 0; x < 9; x++) for (let z = 0; z < 7; z++) {
        const edge = x === 0 || x === 8 || z === 0 || z === 6;
        if (edge) { s(x, 0, z, S.log, 2); continue; }
        if (x === 4) { s(x, 0, z, 'water'); continue; }
        s(x, 0, z, 'farmland', 7);
        const crop = x < 4 ? (R() < 0.6 ? 'wheat' : 'carrots') : (R() < 0.6 ? 'wheat' : 'potatoes');
        s(x, 1, z, crop, 2 + ((R() * 6) | 0));
      }
    },
  },
  lamp: {
    w: 1, d: 1, draw: (s, S) => { for (let y = 1; y <= 3; y++) s(0, y, 0, 'oak_fence'); s(0, 4, 0, 'glowstone'); void S; },
  },
};

function floor(s, S, w, d, mat) {
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) s(x, 0, z, mat);
}
// plank walls on a stone base, log corners, windows, a door in the middle of the front
function walls(s, S, w, d, h) {
  floor(s, S, w, d, S.base);
  for (let x = 1; x < w - 1; x++) for (let z = 1; z < d - 1; z++) s(x, 0, z, S.flat ? S.planks : 'oak_planks');
  const door = w >> 1;
  for (let y = 1; y <= h; y++) {
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) {
      const edge = x === 0 || x === w - 1 || z === 0 || z === d - 1;
      if (!edge) continue;
      const corner = (x === 0 || x === w - 1) && (z === 0 || z === d - 1);
      let mat = corner ? S.log : S.planks;
      const window = !corner && y === 2 && ((z === 0 || z === d - 1) ? (x === 1 || x === w - 2) && w > 4 : (z === d >> 1));
      if (window) mat = 'glass';
      if (z === d - 1 && x === door && y <= 2) continue;
      s(x, y, z, mat);
    }
  }
  s(door, 1, d - 1, 'oak_door', 0);
  s(door, 2, d - 1, 'oak_door', 4);
  s(door, h, d, 'torch', 1); // over the door, outside
}
// a pitched roof of stairs with the ridge running east-west (flat slab roof in the desert)
function gable(s, S, w, d, y0) {
  if (S.flat) {
    for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) s(x, y0, z, S.planks);
    return;
  }
  // rows of stairs climb in from both eaves (one block of overhang) until they meet at the ridge
  for (let k = 0; ; k++) {
    const zn = k - 1, zs = d - k, y = y0 + k;
    for (let x = -1; x <= w; x++) {
      if (zn === zs) s(x, y, zn, S.slab);
      else { s(x, y, zn, S.stairs, 0); s(x, y, zs, S.stairs, 2); }
      // fill the gable ends under the slope
      if (x === 0 || x === w - 1) for (let z = Math.max(0, zn + 1); z < Math.min(d, zs); z++) s(x, y, z, S.planks);
    }
    if (zn + 1 >= zs) break;
  }
}
function interior(s, S, R, w, d) {
  s(1, 1, 1, 'red_bed', 3); s(2, 1, 1, 'red_bed', 3 | 4);
  if (R() < 0.6) s(w - 2, 1, 1, 'crafting_table');
  s(w - 2, 3, 1, 'torch', 1);
  void S; void d;
}

// ------------------------------------------------------------------ layout
function region(seed, rx, rz) {
  return (k) => hash2(rx * 73 + k * 11, rz * 37 - k * 7, seed + 7777);
}

// the village of a region, or null. gen: a WorldGen (for terrain heights and biomes)
export function villageLayout(gen, rx, rz) {
  const cache = gen.villageCache || (gen.villageCache = new Map());
  const ck = rx + ',' + rz;
  if (cache.has(ck)) return cache.get(ck);
  const v = makeLayout(gen, rx, rz);
  cache.set(ck, v);
  return v;
}

function makeLayout(gen, rx, rz) {
  const H = region(gen.seed, rx, rz);
  if (H(0) > 0.75) return null;
  const vx = rx * REGION + 64 + Math.floor(H(1) * (REGION - 128));
  const vz = rz * REGION + 64 + Math.floor(H(2) * (REGION - 128));
  const col = {};
  const at = (x, z) => gen.column(x, z, col);
  at(vx, vz);
  const styleName = BIOME_STYLE[col.biome];
  if (!styleName || col.mf > 0.08 || col.rv > 0.12 || col.h <= SEA + 1 || col.h > 100) return null;
  const S = STYLE[styleName];
  const R = rng(H(3) * 4294967296);
  const vil = { x: vx, z: vz, style: S, roads: new Map(), buildings: [], golem: null };
  const taken = []; // [x0, z0, x1, z1]
  const free = (x0, z0, x1, z1) => taken.every((t) => x1 < t[0] || x0 > t[2] || z1 < t[1] || z0 > t[3]);
  const road = (x, z) => { at(x, z); if (col.h > 0) vil.roads.set(x + ',' + z, [x, z]); };
  // the well in the middle
  const well = { type: 'well', x0: vx - 2, z0: vz - 2, w: 4, d: 4, k: 0, y: col.h };
  vil.buildings.push(well);
  taken.push([vx - 3, vz - 3, vx + 2, vz + 2]);
  // roads out from the well, with buildings along both sides
  const weights = [['house', 40], ['big_house', 18], ['farm', 16], ['library', 6], ['smith', 7], ['church', 5], ['lamp', 8]];
  const pick = () => { let t = 0; for (const w of weights) t += w[1]; let r = R() * t; for (const w of weights) { r -= w[1]; if (r < 0) return w[0]; } return 'house'; };
  for (let dir = 0; dir < 4; dir++) {
    if (R() > 0.85 && dir > 0) continue;
    const [dx, dz] = FDIR[dir];
    const len = 18 + Math.floor(R() * 22);
    for (let i = 3; i <= len; i++) for (let w = -1; w <= 1; w++) road(vx + dx * i + dz * w, vz + dz * i + dx * w);
    taken.push([Math.min(vx, vx + dx * len) - Math.abs(dz) - 1, Math.min(vz, vz + dz * len) - Math.abs(dx) - 1, Math.max(vx, vx + dx * len) + Math.abs(dz) + 1, Math.max(vz, vz + dz * len) + Math.abs(dx) + 1]);
    // plots every few blocks on alternating sides
    for (let i = 5; i <= len - 2; i += 5 + Math.floor(R() * 4)) {
      for (const side of [-1, 1]) {
        if (R() < 0.25) continue;
        const type = pick();
        const T = TEMPLATES[type];
        // facing so the front looks back at the road: side is perpendicular to the road direction
        const px = dz * side, pz = dx * side; // unit vector from road to plot
        const face = px === 1 ? 1 : px === -1 ? 3 : pz === 1 ? 2 : 0; // door toward the road
        const w = face & 1 ? T.d : T.w, d = face & 1 ? T.w : T.d;
        // set back from the road by a block of verge
        const back = 3 + Math.ceil((px ? w : d) / 2);
        const cxr = vx + dx * i + px * back, czr = vz + dz * i + pz * back;
        const x0 = cxr - (w >> 1), z0 = czr - (d >> 1);
        if (!free(x0 - 1, z0 - 1, x0 + w, z0 + d)) continue;
        // ground: level enough and dry
        at(cxr, czr);
        const y = col.h;
        if (col.h <= SEA || col.rv > 0.2) continue;
        let ok = true;
        for (const [qx, qz] of [[x0, z0], [x0 + w - 1, z0], [x0, z0 + d - 1], [x0 + w - 1, z0 + d - 1]]) {
          at(qx, qz);
          if (Math.abs(col.h - y) > (T.flatOnly ? 2 : 4) || col.h <= SEA) ok = false;
        }
        if (!ok) continue;
        const b = { type, x0, z0, w, d, k: face, y, seed: (R() * 4294967296) >>> 0 };
        b.villagers = type === 'lamp' ? [] : type === 'farm' ? [['farmer', 0.8]] : type === 'library' ? [['librarian', 1]] : type === 'smith' ? [[['armorer', 'weaponsmith', 'toolsmith'][(R() * 3) | 0], 1]]
          : type === 'church' ? [['cleric', 1]] : [[HOUSE_JOBS[(R() * HOUSE_JOBS.length) | 0], 1], [HOUSE_JOBS[(R() * HOUSE_JOBS.length) | 0], type === 'big_house' ? 0.8 : 0.4]];
        vil.buildings.push(b);
        taken.push([x0 - 1, z0 - 1, x0 + w, z0 + d]);
      }
    }
  }
  if (vil.buildings.length < 4) return null;
  vil.golem = [vx + 3.5, vz + 3.5];
  return vil;
}
const HOUSE_JOBS = ['farmer', 'shepherd', 'fletcher', 'butcher', 'fisherman', 'leatherworker', 'mason', 'nitwit', 'librarian', 'cleric'];

// villages whose area might touch a box
export function villagesNear(gen, x0, z0, x1, z1) {
  const out = [];
  for (let rz = Math.floor((z0 - VILLAGE_RADIUS) / REGION); rz <= Math.floor((z1 + VILLAGE_RADIUS) / REGION); rz++) {
    for (let rx = Math.floor((x0 - VILLAGE_RADIUS) / REGION); rx <= Math.floor((x1 + VILLAGE_RADIUS) / REGION); rx++) {
      const v = villageLayout(gen, rx, rz);
      if (v && v.x + VILLAGE_RADIUS >= x0 && v.x - VILLAGE_RADIUS <= x1 && v.z + VILLAGE_RADIUS >= z0 && v.z - VILLAGE_RADIUS <= z1) out.push(v);
    }
  }
  return out;
}

// ------------------------------------------------------------------ stamping
export function stampVillages(gen, ctx) {
  const { x0, z0 } = ctx;
  for (const v of villagesNear(gen, x0, z0, x0 + 15, z0 + 15)) stamp(gen, ctx, v);
}

function stamp(gen, ctx, vil) {
  const { blocks, x0, z0 } = ctx;
  const S = vil.style;
  const inChunk = (x, z) => x >= x0 && x < x0 + CS && z >= z0 && z < z0 + CS;
  const set = (x, y, z, v) => { if (y > 0 && y < WH && inChunk(x, z)) blocks[idx(x - x0, y, z - z0)] = v; };
  const get = (x, y, z) => blocks[idx(x - x0, y, z - z0)];
  // roads: path on the surface, plank bridges over water
  const pathId = B[S.path];
  for (const [x, z] of vil.roads.values()) {
    if (!inChunk(x, z)) continue;
    let y = WH - 2;
    while (y > 1 && (get(x, y, z) === 0 || BLOCKS[get(x, y, z) & 1023].plant || BLOCKS[get(x, y, z) & 1023].name.endsWith('_leaves') || (get(x, y, z) & 1023) === B.snow)) y--;
    const g = get(x, y, z) & 1023;
    if (g === B.water || g === B.ice) set(x, y, z, B[S.planks]);
    else if (BLOCKS[g].opaque) set(x, y, z, pathId);
    for (let k = 1; k <= 3; k++) { const a = get(x, y + k, z) & 1023; if (a && !BLOCKS[a].opaque) set(x, y + k, z, 0); }
  }
  for (const b of vil.buildings) {
    if (b.x0 > x0 + 15 || b.x0 + b.w - 1 < x0 || b.z0 > z0 + 15 || b.z0 + b.d - 1 < z0) {
      // still might need its overhanging roof
      if (b.x0 - 1 > x0 + 15 || b.x0 + b.w < x0 || b.z0 - 1 > z0 + 15 || b.z0 + b.d < z0) continue;
    }
    if (b.type === 'well') { drawWell(b, set, get, S); continue; }
    const T = TEMPLATES[b.type];
    const tw = T.w, td = T.d;
    // footprint: clear above, shore up below with the base block
    const H = b.type === 'church' ? 12 : 9;
    for (let lx = 0; lx < b.w; lx++) for (let lz = 0; lz < b.d; lz++) {
      const x = b.x0 + lx, z = b.z0 + lz;
      if (!inChunk(x, z)) continue;
      for (let y = b.y + 1; y <= Math.min(WH - 1, b.y + H); y++) set(x, y, z, 0);
      for (let y = b.y; y > b.y - 8 && y > 0; y--) {
        const g = get(x, y, z) & 1023;
        if (y < b.y && BLOCKS[g].opaque) break;
        set(x, y, z, y === b.y && T.flatOnly ? B.dirt : B[S.base]);
      }
    }
    // the template itself, turned to face the road
    const R = rng(b.seed);
    const k = b.k;
    const tset = (lx, ly, lz, name, meta = 0, loot) => {
      const id = B[name];
      if (id === undefined) return;
      let wx, wz;
      if (k === 0) { wx = lx; wz = lz; } else if (k === 1) { wx = td - 1 - lz; wz = lx; } else if (k === 2) { wx = tw - 1 - lx; wz = td - 1 - lz; } else { wx = lz; wz = tw - 1 - lx; }
      const x = b.x0 + wx, y = b.y + ly, z = b.z0 + wz;
      set(x, y, z, rotV(id | (meta << 10), k));
      if (loot && inChunk(x, z)) ctx.tiles.push({ type: 'chest', x, y, z, items: smithLoot(R) });
    };
    T.draw(tset, S, R);
    // its villagers (spawned by whichever chunk holds the building's centre)
    const cx = b.x0 + (b.w >> 1), cz = b.z0 + (b.d >> 1);
    if (inChunk(cx, cz)) {
      for (const [job, p] of b.villagers) if (R() < p) ctx.spawns.push({ type: 'villager', x: cx + 0.5, y: b.y + 1, z: cz + 0.5, opts: { profession: job, vtype: S.type, home: [cx, b.y + 1, cz] } });
    }
  }
  if (vil.golem && inChunk(Math.floor(vil.golem[0]), Math.floor(vil.golem[1]))) {
    ctx.spawns.push({ type: 'iron_golem', x: vil.golem[0], y: vil.buildings[0].y + 1, z: vil.golem[1], opts: { home: [vil.x, vil.buildings[0].y + 1, vil.z] } });
  }
}

function drawWell(b, set, get, S) {
  const y = b.y;
  for (let lx = 0; lx < 4; lx++) for (let lz = 0; lz < 4; lz++) {
    const x = b.x0 + lx, z = b.z0 + lz;
    const inner = lx > 0 && lx < 3 && lz > 0 && lz < 3;
    for (let yy = y - 3; yy <= y + 4; yy++) set(x, yy, z, 0);
    for (let yy = y - 4; yy < y; yy++) set(x, yy, z, inner && yy > y - 4 ? B.water : B[S.base]);
    set(x, y, z, inner ? B.water : B[S.base]);
    if (!inner) set(x, y + 1, z, B[S.base]);
    const corner = (lx === 0 || lx === 3) && (lz === 0 || lz === 3);
    if (corner) { set(x, y + 2, z, B.oak_fence); set(x, y + 3, z, B.oak_fence); }
    set(x, y + 4, z, B[S.slab]);
  }
  void get;
}

function smithLoot(R) {
  const pool = [['iron_ingot', 1, 5], ['bread', 1, 3], ['apple', 1, 3], ['iron_pickaxe', 1, 1], ['iron_sword', 1, 1], ['iron_helmet', 1, 1],
    ['iron_chestplate', 1, 1], ['obsidian', 3, 7], ['oak_sapling', 3, 7], ['diamond', 1, 3], ['gold_ingot', 1, 3]];
  const items = new Array(27).fill(null);
  const n = 3 + ((R() * 5) | 0);
  for (let i = 0; i < n; i++) {
    const [name, a, b] = pool[(R() * pool.length) | 0];
    let slot = (R() * 27) | 0;
    while (items[slot]) slot = (slot + 1) % 27;
    items[slot] = [name, a + ((R() * (b - a + 1)) | 0)];
  }
  return items;
}
