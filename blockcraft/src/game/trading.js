// Villager trades: per-profession offers unlocked over five levels, modelled on vanilla's tables.
import { I, ITEMS } from '../shared/items.js';
import { rollEnchants, rng, ENCHANTS } from '../shared/enchant.js';

export const LEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
export const LEVEL_XP = [0, 10, 70, 150, 250]; // villager experience needed for each level
export const PROFESSION_NAMES = {
  armorer: 'Armorer', butcher: 'Butcher', cartographer: 'Cartographer', cleric: 'Cleric', farmer: 'Farmer', fisherman: 'Fisherman',
  fletcher: 'Fletcher', leatherworker: 'Leatherworker', librarian: 'Librarian', mason: 'Mason', nitwit: 'Nitwit', shepherd: 'Shepherd',
  toolsmith: 'Toolsmith', weaponsmith: 'Weaponsmith',
};

// [give, giveCount, take, takeCount, villagerXp, opts]  -- "give" is what the player pays
const E = 'emerald';
const buy = (item, n, xp = 2) => [item, n, E, 1, xp];
const sell = (price, item, n, xp = 1, opts) => [E, price, item, n, xp, opts];
const TABLES = {
  farmer: [
    [buy('wheat', 20), buy('potato', 26), buy('carrot', 22), sell(1, 'bread', 6)],
    [buy('pumpkin', 6, 10), sell(1, 'pumpkin_pie', 4, 5), sell(1, 'apple', 4, 5)],
    [buy('melon', 4, 20), sell(3, 'cookie', 18, 10)],
    [sell(1, 'cake', 1, 15)],
    [sell(3, 'golden_apple', 1, 30)],
  ],
  librarian: [
    [buy('paper', 24), sell(9, 'bookshelf', 1), sell(-1, 'enchanted_book', 1, 1, { book: true })],
    [buy('book', 4, 10), sell(5, 'compass', 1, 5), sell(-1, 'enchanted_book', 1, 5, { book: true })],
    [buy('ink_sac', 5, 20), sell(1, 'glass', 4, 10), sell(-1, 'enchanted_book', 1, 10, { book: true })],
    [sell(5, 'clock', 1, 15), sell(-1, 'enchanted_book', 1, 15, { book: true })],
    [sell(20, 'name_tag', 1, 30)],
  ],
  armorer: [
    [buy('coal', 15), sell(7, 'iron_leggings', 1), sell(4, 'iron_boots', 1), sell(5, 'iron_helmet', 1), sell(9, 'iron_chestplate', 1)],
    [buy('iron_ingot', 4, 10), sell(3, 'chainmail_boots', 1, 5), sell(1, 'chainmail_leggings', 1, 5)],
    [buy('lava_bucket', 1, 20), buy('diamond', 1, 20), sell(1, 'chainmail_helmet', 1, 10), sell(4, 'chainmail_chestplate', 1, 10)],
    [sell(19, 'diamond_leggings', 1, 15, { ench: 1 }), sell(13, 'diamond_boots', 1, 15, { ench: 1 })],
    [sell(13, 'diamond_helmet', 1, 30, { ench: 1 }), sell(21, 'diamond_chestplate', 1, 30, { ench: 1 })],
  ],
  weaponsmith: [
    [buy('coal', 15), sell(3, 'iron_axe', 1), sell(-1, 'iron_sword', 1, 1, { ench: 1 })],
    [buy('iron_ingot', 4, 10)],
    [buy('flint', 24, 20)],
    [buy('diamond', 1, 30), sell(-1, 'diamond_axe', 1, 15, { ench: 1 })],
    [sell(-1, 'diamond_sword', 1, 30, { ench: 1 })],
  ],
  toolsmith: [
    [buy('coal', 15), sell(1, 'stone_axe', 1), sell(1, 'stone_shovel', 1), sell(1, 'stone_pickaxe', 1), sell(1, 'stone_hoe', 1)],
    [buy('iron_ingot', 4, 10)],
    [buy('flint', 30, 20), sell(-1, 'iron_axe', 1, 10, { ench: 1 }), sell(-1, 'iron_shovel', 1, 10, { ench: 1 }), sell(-1, 'iron_pickaxe', 1, 10, { ench: 1 })],
    [buy('diamond', 1, 30), sell(4, 'diamond_hoe', 1, 15)],
    [sell(-1, 'diamond_axe', 1, 30, { ench: 1 }), sell(-1, 'diamond_shovel', 1, 30, { ench: 1 }), sell(-1, 'diamond_pickaxe', 1, 30, { ench: 1 })],
  ],
  butcher: [
    [buy('chicken', 14), buy('porkchop', 7), sell(1, 'rabbit_stew', 1)],
    [buy('coal', 15), sell(1, 'cooked_porkchop', 5, 5), sell(1, 'cooked_chicken', 8, 5)],
    [buy('mutton', 7, 20), buy('beef', 10, 20)],
    [buy('cod', 10, 30)],
    [buy('salmon', 10, 30)],
  ],
  cleric: [
    [buy('rotten_flesh', 32), sell(1, 'redstone', 2)],
    [buy('gold_ingot', 3, 10), sell(1, 'lapis_lazuli', 1, 5)],
    [buy('spider_eye', 2, 20), sell(4, 'glowstone', 1, 10)],
    [buy('gunpowder', 4, 30), sell(5, 'ender_pearl', 1, 15)],
    [buy('bone', 16, 30), sell(3, 'experience_bottle', 1, 30)],
  ],
  shepherd: [
    [buy('white_wool', 18), buy('brown_wool', 18), buy('black_wool', 18), buy('gray_wool', 18), sell(2, 'shears', 1)],
    [buy('ink_sac', 12, 10), sell(1, 'white_wool', 1, 5), sell(1, 'red_wool', 1, 5), sell(1, 'blue_wool', 1, 5)],
    [buy('lapis_lazuli', 12, 20), sell(3, 'red_bed', 1, 10)],
    [buy('bone_meal', 12, 30)],
    [sell(2, 'painting', 3, 30)],
  ],
  fletcher: [
    [buy('stick', 32), sell(1, 'arrow', 16), ['gravel', 10, 'flint', 10, 1, { extra: [E, 1] }]],
    [buy('flint', 26, 10), sell(2, 'bow', 1, 5)],
    [buy('string', 14, 20)],
    [buy('feather', 24, 30)],
    [sell(-1, 'bow', 1, 30, { ench: 1 })],
  ],
  fisherman: [
    [buy('string', 20), buy('coal', 10), ['cod', 6, 'cooked_cod', 6, 1, { extra: [E, 1] }]],
    [buy('cod', 15, 10), ['salmon', 6, 'cooked_salmon', 6, 5, { extra: [E, 1] }], sell(2, 'oak_boat', 1, 5)],
    [buy('salmon', 13, 20), sell(-1, 'fishing_rod', 1, 10, { ench: 1 })],
    [buy('tropical_fish', 6, 30)],
    [buy('pufferfish', 4, 30)],
  ],
  leatherworker: [
    [buy('leather', 6), sell(3, 'leather_leggings', 1), sell(7, 'leather_chestplate', 1)],
    [buy('flint', 26, 10), sell(5, 'leather_helmet', 1, 5), sell(4, 'leather_boots', 1, 5)],
    [buy('string', 9, 20), sell(6, 'saddle', 1, 10)],
    [buy('feather', 24, 30)],
    [sell(6, 'saddle', 1, 30)],
  ],
  mason: [
    [buy('clay_ball', 10), sell(1, 'bricks', 10)],
    [buy('stone', 20, 10), sell(1, 'chiseled_stone_bricks', 4, 5)],
    [buy('granite', 16, 20), buy('andesite', 16, 20), buy('diorite', 16, 20), sell(1, 'polished_andesite', 4, 10)],
    [sell(1, 'stone_bricks', 4, 15), sell(1, 'mossy_stone_bricks', 4, 15)],
    [sell(1, 'smooth_stone', 4, 30)],
  ],
  cartographer: [
    [buy('paper', 24), sell(7, 'compass', 1)],
    [buy('glass', 11, 10), sell(3, 'clock', 1, 5)],
    [buy('compass', 1, 20)],
    [sell(7, 'book', 3, 15)],
    [sell(8, 'name_tag', 1, 30)],
  ],
  nitwit: [[], [], [], [], []],
};

const pickN = (list, n, R) => {
  const pool = list.slice(), out = [];
  while (pool.length && out.length < n) out.push(pool.splice((R() * pool.length) | 0, 1)[0]);
  return out;
};

// turn a table row into a concrete offer
function makeOffer(row, level, R) {
  const [give, gn, take, tn, xp, opts = {}] = row;
  if (I[give] === undefined || I[take] === undefined) return null;
  const offer = { a: { id: I[give], count: gn }, out: { id: I[take], count: tn, dmg: 0 }, uses: 0, max: give === E && tn === 1 && ITEMS[I[take]].durability ? 3 : 12, xp: xp || 1, level };
  if (opts.extra && I[opts.extra[0]] !== undefined) offer.b = { id: I[opts.extra[0]], count: opts.extra[1] };
  if (opts.book) {
    // an enchanted book: price scales with the level of the enchantment
    const usable = ENCHANTS.filter((e) => !e.treasure || e.key === 'mending');
    const e = usable[(R() * usable.length) | 0];
    const lvl = 1 + ((R() * e.max) | 0);
    offer.out = { id: I.enchanted_book, count: 1, dmg: 0, ench: [[e.id, lvl]] };
    offer.a = { id: I.emerald, count: Math.min(64, 2 + lvl * 3 + ((R() * (5 + lvl * 10)) | 0)) * (e.treasure ? 2 : 1) };
    offer.b = { id: I.book, count: 1 };
    offer.max = 12;
  } else if (opts.ench) {
    // enchanted gear: rolled like a level 5-19 enchant, priced to match
    const lvl = 5 + ((R() * 15) | 0);
    const ench = rollEnchants(offer.out.id, lvl, rng((R() * 4294967296) >>> 0));
    if (ench.length) offer.out.ench = ench;
    if (gn < 0) offer.a = { id: I.emerald, count: Math.min(64, Math.max(2, Math.round(lvl * (ITEMS[offer.out.id].name.startsWith('diamond') ? 1.6 : 0.9)))) };
  }
  if (offer.a.count < 0) offer.a.count = 1 + ((R() * 3) | 0);
  return offer;
}

// add the offers for one level (two of the table's rows, like vanilla)
export function unlockLevel(v, level) {
  const table = TABLES[v.profession];
  if (!table || !table[level]) return;
  const R = rng(((v.tradeSeed + level * 7919) >>> 0) || 1);
  for (const row of pickN(table[level], 2, R)) {
    const o = makeOffer(row, level, R);
    if (o) v.offers.push(o);
  }
}

// a villager's experience after a trade, levelling up when it passes the next threshold
export function gainTradeXp(v, xp) {
  v.tradeXp = (v.tradeXp || 0) + xp;
  let up = false;
  while (v.tradeLevel < 4 && v.tradeXp >= LEVEL_XP[v.tradeLevel + 1]) {
    v.tradeLevel++;
    unlockLevel(v, v.tradeLevel);
    up = true;
  }
  return up;
}

// each new day restocks every offer
export function restock(v) {
  for (const o of v.offers) o.uses = 0;
}
