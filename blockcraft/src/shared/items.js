// Item registry. Block items share the block's id (0..1023); other items start at ITEM_BASE.
// Ids are stored in saves: only append.
import { BLOCKS, B, R, WOODS, COLORS, FLOWERS } from './blocks.js';
import { ITEM_BASE } from './constants.js';

export const ITEMS = [];
export const I = {};

const titleCase = (s) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// --- block items
const NO_ITEM = new Set(['air', 'water', 'lava', 'lit_furnace', 'wheat', 'carrots', 'potatoes', 'redstone_wire', 'unlit_redstone_torch',
  'lit_redstone_lamp', 'piston_head']);
const FLAT_ICON = { // blocks shown with a flat texture in the inventory
  torch: 'block/torch', ladder: 'block/ladder', oak_door: 'item/oak_door', red_bed: 'item/red_bed', sugar_cane: 'item/sugar_cane',
  cobweb: 'block/cobweb', vine: 'block/vine', lily_pad: 'block/lily_pad', cake: 'item/cake', short_grass: 'block/short_grass',
  fern: 'block/fern', dead_bush: 'block/dead_bush', brown_mushroom: 'block/brown_mushroom', red_mushroom: 'block/red_mushroom',
};
for (const w of WOODS) FLAT_ICON[w + '_sapling'] = 'block/' + w + '_sapling';
for (const n of ['rail', 'powered_rail', 'detector_rail', 'redstone_torch']) FLAT_ICON[n] = 'block/' + n;
FLAT_ICON.lever = 'item/lever';
FLAT_ICON.repeater = 'item/repeater';
for (const f of FLOWERS) FLAT_ICON[f] = 'block/' + f;

for (const b of BLOCKS) {
  const it = {
    id: b.id, name: b.name, display: titleCase(b.name), block: b.id, maxStack: 64,
    icon: FLAT_ICON[b.name] || null, // null -> rendered 3D block icon
    hidden: NO_ITEM.has(b.name),
    tintIcon: b.name === 'short_grass' || b.name === 'fern' || b.name === 'sugar_cane' || b.name === 'vine' ? 'grass' : null,
  };
  ITEMS[b.id] = it;
  I[b.name] = b.id;
}
ITEMS[B.red_bed].maxStack = 1;
ITEMS[B.oak_door].maxStack = 64;
ITEMS[B.cake].maxStack = 1;
ITEMS[B.snow].display = 'Snow Layer';
ITEMS[B.snow_block].display = 'Snow Block';
ITEMS[B.tnt].display = 'TNT';
ITEMS[B.red_bed].display = 'Bed';
ITEMS[B.jack_o_lantern].display = "Jack o'Lantern";
ITEMS[B.short_grass].display = 'Grass';
ITEMS[B.grass_block].display = 'Grass Block';
ITEMS[B.repeater].display = 'Redstone Repeater';
ITEMS[B.redstone_lamp].display = 'Redstone Lamp';

let next = ITEM_BASE;
function item(name, p = {}) {
  const it = Object.assign({ id: next++, name, display: titleCase(name), maxStack: 64, icon: 'item/' + name }, p);
  ITEMS[it.id] = it;
  I[name] = it.id;
  return it;
}

// --- materials
for (const n of ['stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'lapis_lazuli', 'redstone',
  'flint', 'clay_ball', 'brick', 'bone', 'bone_meal', 'string', 'feather', 'gunpowder', 'leather', 'paper', 'book',
  'sugar', 'wheat', 'wheat_seeds', 'glowstone_dust', 'iron_nugget', 'gold_nugget', 'slime_ball', 'ink_sac']) item(n);
ITEMS[I.lapis_lazuli].display = 'Lapis Lazuli';
ITEMS[I.redstone].display = 'Redstone Dust';
ITEMS[I.redstone].placeBlock = 'redstone_wire';
ITEMS[I.wheat_seeds].display = 'Seeds';
ITEMS[I.wheat_seeds].place = 'wheat';
ITEMS[I.bone_meal].use = 'bonemeal';

// --- food: [hunger, saturation]
const FOOD = {
  apple: [4, 2.4], bread: [5, 6], porkchop: [3, 1.8], cooked_porkchop: [8, 12.8], beef: [3, 1.8], cooked_beef: [8, 12.8],
  chicken: [2, 1.2], cooked_chicken: [6, 7.2], mutton: [2, 1.2], cooked_mutton: [6, 9.6], carrot: [3, 3.6], potato: [1, 0.6],
  baked_potato: [5, 6], golden_apple: [4, 9.6], mushroom_stew: [6, 7.2], rotten_flesh: [4, 0.8], spider_eye: [2, 3.2],
  melon_slice: [2, 1.2], pumpkin_pie: [8, 4.8], cookie: [2, 0.4],
};
for (const [n, [h, s]] of Object.entries(FOOD)) item(n, { food: { hunger: h, sat: s } });
ITEMS[I.mushroom_stew].maxStack = 1;
ITEMS[I.mushroom_stew].food.returns = 'bowl';
ITEMS[I.carrot].place = 'carrots';
ITEMS[I.potato].place = 'potatoes';
ITEMS[I.rotten_flesh].food.effect = { hunger: 0.8 };
ITEMS[I.spider_eye].food.effect = { poison: 1 };
ITEMS[I.chicken].food.effect = { hunger: 0.3 };
ITEMS[I.golden_apple].food.effect = { regen: 1 };
ITEMS[I.golden_apple].glint = false;
ITEMS[I.cooked_porkchop].display = 'Cooked Porkchop';
ITEMS[I.porkchop].display = 'Raw Porkchop';
ITEMS[I.beef].display = 'Raw Beef';
ITEMS[I.cooked_beef].display = 'Steak';
ITEMS[I.chicken].display = 'Raw Chicken';
ITEMS[I.mutton].display = 'Raw Mutton';

// --- tools
export const TIERS = {
  wooden: { tier: 0, speed: 2, uses: 59, dmg: 0, ench: 15 },
  stone: { tier: 1, speed: 4, uses: 131, dmg: 1, ench: 5 },
  iron: { tier: 2, speed: 6, uses: 250, dmg: 2, ench: 14 },
  golden: { tier: 0, speed: 12, uses: 32, dmg: 0, ench: 22 },
  diamond: { tier: 3, speed: 8, uses: 1561, dmg: 3, ench: 10 },
};
const BASE_DMG = { sword: 4, axe: 3, pickaxe: 2, shovel: 1, hoe: 1 };
for (const [mat, t] of Object.entries(TIERS)) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
    item(`${mat}_${kind}`, {
      maxStack: 1,
      tool: { type: kind, tier: t.tier, speed: t.speed, mat },
      durability: t.uses,
      damage: BASE_DMG[kind] + t.dmg,
    });
  }
}
item('shears', { maxStack: 1, tool: { type: 'shears', tier: 0, speed: 1.5 }, durability: 238 });
item('flint_and_steel', { maxStack: 1, durability: 64, use: 'ignite' });
item('bow', { maxStack: 1, durability: 384, use: 'bow' });
item('arrow');
item('bucket', { maxStack: 16, use: 'bucket' });
item('water_bucket', { maxStack: 1, use: 'bucket', fluid: 'water' });
item('lava_bucket', { maxStack: 1, use: 'bucket', fluid: 'lava' });
item('milk_bucket', { maxStack: 1, use: 'milk' });
item('bowl');
item('egg', { maxStack: 16, use: 'throw' });
item('snowball', { maxStack: 16, use: 'throw' });
item('ender_pearl', { maxStack: 16, use: 'throw' });
item('compass', { maxStack: 1 });
item('clock', { maxStack: 1 });

// --- armour: [slot, defence per material]
export const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR = {
  leather: { def: [1, 3, 2, 1], mult: 5, tex: 'leather' },
  chainmail: { def: [2, 5, 4, 1], mult: 15, tex: 'chain' },
  iron: { def: [2, 6, 5, 2], mult: 15, tex: 'iron' },
  golden: { def: [2, 5, 3, 1], mult: 7, tex: 'gold' },
  diamond: { def: [3, 8, 6, 3], mult: 33, tex: 'diamond', tough: 2 },
};
const ARMOR_BASE = [11, 16, 15, 13];
for (const [mat, a] of Object.entries(ARMOR)) {
  ARMOR_SLOTS.forEach((slot, i) => {
    item(`${mat}_${slot}`, {
      maxStack: 1,
      armor: { slot: i, def: a.def[i], tough: a.tough || 0, tex: `entity/armor_${a.tex}_${slot}`, mat },
      durability: ARMOR_BASE[i] * a.mult,
    });
  });
}

// --- misc
item('melon_seeds', { hidden: true });
item('pumpkin_seeds', { hidden: true });
item('spawn_egg', { hidden: true });

// spawn eggs for creative mode
export const SPAWN_EGGS = {
  pig: [0xf0a5a2, 0xdb635f], cow: [0x443626, 0xa1a1a1], sheep: [0xe7e7e7, 0xffb5b5], chicken: [0xa1a1a1, 0xff0000],
  zombie: [0x00afaf, 0x799c65], skeleton: [0xc1c1c1, 0x494949], creeper: [0x0da70b, 0x000000], spider: [0x342d27, 0xa80e0e],
  enderman: [0x161616, 0x000000], wolf: [0xd7d3d3, 0xceaf96],
};
for (const [mob, col] of Object.entries(SPAWN_EGGS)) {
  item(mob + '_spawn_egg', { icon: 'egg', egg: { mob, col }, use: 'spawn_egg' });
}

// enchanted books carry their enchantments in the stack (stack.ench)
item('enchanted_book', { maxStack: 1, glint: true });

// vehicles
for (const w of WOODS) item(w + '_boat', { maxStack: 1, use: 'boat', wood: w });
item('minecart', { maxStack: 1, use: 'minecart' });

// fishing
item('fishing_rod', { maxStack: 1, durability: 64, use: 'fish' });
for (const [n, h, sat] of [['cod', 2, 0.4], ['cooked_cod', 5, 6], ['salmon', 2, 0.4], ['cooked_salmon', 6, 9.6], ['tropical_fish', 1, 0.2], ['pufferfish', 1, 0.2]]) {
  item(n, { food: { hunger: h, sat } });
}
ITEMS[I.cod].display = 'Raw Cod';
ITEMS[I.salmon].display = 'Raw Salmon';
ITEMS[I.pufferfish].food.effect = { poison: 3, hunger: 1 };
item('saddle', { maxStack: 1 });
item('name_tag', { use: 'name_tag' });

// spawn eggs for mobs added later (appended so older item ids stay put)
export const MORE_EGGS = { villager: [0x563c33, 0xbd8b72], iron_golem: [0xdbcdc2, 0x74a332] };
for (const [mob, col] of Object.entries(MORE_EGGS)) item(mob + '_spawn_egg', { icon: 'egg', egg: { mob, col }, use: 'spawn_egg' });

// cake & bed & door & sugar cane are block items placed directly
ITEMS[B.cake].maxStack = 1;

// ------------------------------------------------------------------ fuels (seconds of burn)
export const FUEL = {};
const fuel = (n, s) => { if (I[n] !== undefined) FUEL[I[n]] = s; };
fuel('coal', 80); fuel('charcoal', 80); fuel('coal_block', 800); fuel('lava_bucket', 1000); fuel('stick', 5);
fuel('crafting_table', 15); fuel('bookshelf', 15); fuel('chest', 15); fuel('oak_fence', 15); fuel('ladder', 15);
fuel('oak_slab', 7.5); fuel('oak_stairs', 15); fuel('bow', 15); fuel('bowl', 5); fuel('oak_door', 10);
for (const w of WOODS) { fuel(w + '_log', 15); fuel(w + '_planks', 15); fuel(w + '_sapling', 5); }
for (const c of COLORS) fuel(c + '_wool', 5);
for (const k of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) fuel('wooden_' + k, 10);

// ------------------------------------------------------------------ helpers
export const itemByName = (n) => ITEMS[I[n]];
export const maxStack = (id) => (ITEMS[id] ? ITEMS[id].maxStack : 64);
export const isBlockItem = (id) => id < ITEM_BASE && ITEMS[id] && ITEMS[id].block !== undefined;

void R;
