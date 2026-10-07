// Crafting (shaped + shapeless) and smelting recipes.
import { I, ITEMS } from '../shared/items.js';
import { WOODS, COLORS } from '../shared/blocks.js';

const TAGS = {
  planks: WOODS.map((w) => w + '_planks'),
  logs: WOODS.map((w) => w + '_log'),
  wool: COLORS.map((c) => c + '_wool'),
  coals: ['coal', 'charcoal'],
  cobble: ['cobblestone', 'mossy_cobblestone'],
};
const tagIds = {};
for (const [k, list] of Object.entries(TAGS)) tagIds[k] = new Set(list.map((n) => I[n]));

export const RECIPES = [];

// key: char -> item name or '#tag'
function shaped(result, count, rows, key, extra = {}) {
  const k = {};
  for (const [c, v] of Object.entries(key)) k[c] = v;
  RECIPES.push({ type: 'shaped', result: I[result], count, rows, key: k, ...extra });
}
function shapeless(result, count, ings, extra = {}) {
  RECIPES.push({ type: 'shapeless', result: I[result], count, ings, ...extra });
}

// ------------------------------------------------------------------ the recipe book
for (const w of WOODS) shapeless(w + '_planks', 4, [w + '_log']);
shaped('stick', 4, ['P', 'P'], { P: '#planks' });
shaped('crafting_table', 1, ['PP', 'PP'], { P: '#planks' });
shaped('chest', 1, ['PPP', 'P P', 'PPP'], { P: '#planks' });
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: '#cobble' });
shaped('torch', 4, ['C', 'S'], { C: '#coals', S: 'stick' });

const MATS = { wooden: '#planks', stone: '#cobble', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [m, mat] of Object.entries(MATS)) {
  shaped(`${m}_pickaxe`, 1, ['MMM', ' S ', ' S '], { M: mat, S: 'stick' });
  shaped(`${m}_axe`, 1, ['MM', 'MS', ' S'], { M: mat, S: 'stick' });
  shaped(`${m}_shovel`, 1, ['M', 'S', 'S'], { M: mat, S: 'stick' });
  shaped(`${m}_sword`, 1, ['M', 'M', 'S'], { M: mat, S: 'stick' });
  shaped(`${m}_hoe`, 1, ['MM', ' S', ' S'], { M: mat, S: 'stick' });
}
const AMATS = { leather: 'leather', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond' };
for (const [m, mat] of Object.entries(AMATS)) {
  shaped(`${m}_helmet`, 1, ['MMM', 'M M'], { M: mat });
  shaped(`${m}_chestplate`, 1, ['M M', 'MMM', 'MMM'], { M: mat });
  shaped(`${m}_leggings`, 1, ['MMM', 'M M', 'M M'], { M: mat });
  shaped(`${m}_boots`, 1, ['M M', 'M M'], { M: mat });
}
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
shaped('bow', 1, [' TS', 'T S', ' TS'], { T: 'stick', S: 'string' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('cake', 1, ['MMM', 'SES', 'WWW'], { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' }, { remain: { milk_bucket: 'bucket' } });
shapeless('sugar', 1, ['sugar_cane']);
shaped('paper', 3, ['RRR'], { R: 'sugar_cane' });
shapeless('book', 1, ['paper', 'paper', 'paper', 'leather']);
shaped('bookshelf', 1, ['PPP', 'BBB', 'PPP'], { P: '#planks', B: 'book' });
shaped('enchanting_table', 1, [' B ', 'DOD', 'OOO'], { B: 'book', D: 'diamond', O: 'obsidian' });
shaped('anvil', 1, ['BBB', ' I ', 'III'], { B: 'iron_block', I: 'iron_ingot' });
for (const w of WOODS) shaped(w + '_boat', 1, ['P P', 'PPP'], { P: w + '_planks' });
shaped('minecart', 1, ['I I', 'III'], { I: 'iron_ingot' });
shaped('rail', 16, ['I I', 'ISI', 'I I'], { I: 'iron_ingot', S: 'stick' });
shaped('powered_rail', 6, ['G G', 'GSG', 'GRG'], { G: 'gold_ingot', S: 'stick', R: 'redstone' });
shaped('detector_rail', 6, ['I I', 'IPI', 'IRI'], { I: 'iron_ingot', P: 'stone_pressure_plate', R: 'redstone' });
shaped('redstone_torch', 1, ['R', 'S'], { R: 'redstone', S: 'stick' });
shaped('lever', 1, ['S', 'C'], { S: 'stick', C: 'cobblestone' });
shapeless('stone_button', 1, ['stone']);
shapeless('oak_button', 1, ['#planks']);
shaped('stone_pressure_plate', 1, ['SS'], { S: 'stone' });
shaped('oak_pressure_plate', 1, ['PP'], { P: '#planks' });
shaped('repeater', 1, ['TRT', 'SSS'], { T: 'redstone_torch', R: 'redstone', S: 'stone' });
shaped('redstone_lamp', 1, [' R ', 'RGR', ' R '], { R: 'redstone', G: 'glowstone' });
shaped('piston', 1, ['PPP', 'CIC', 'CRC'], { P: '#planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' });
shaped('sticky_piston', 1, ['S', 'P'], { S: 'slime_ball', P: 'piston' });
shaped('fishing_rod', 1, ['  S', ' ST', 'S T'], { S: 'stick', T: 'string' });
shaped('bowl', 4, ['P P', ' P '], { P: '#planks' });
shapeless('mushroom_stew', 1, ['bowl', 'brown_mushroom', 'red_mushroom']);
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shaped('ladder', 3, ['S S', 'SSS', 'S S'], { S: 'stick' });
shaped('oak_door', 3, ['PP', 'PP', 'PP'], { P: '#planks' });
shaped('oak_fence', 3, ['PSP', 'PSP'], { P: '#planks', S: 'stick' });
shaped('red_bed', 1, ['WWW', 'PPP'], { W: '#wool', P: '#planks' });
shaped('smooth_stone_slab', 6, ['MMM'], { M: 'smooth_stone' });
shaped('cobblestone_slab', 6, ['MMM'], { M: 'cobblestone' });
shaped('oak_slab', 6, ['MMM'], { M: '#planks' });
shaped('stone_brick_slab', 6, ['MMM'], { M: 'stone_bricks' });
shaped('sandstone_slab', 6, ['MMM'], { M: 'sandstone' });
shaped('brick_slab', 6, ['MMM'], { M: 'bricks' });
for (const w of ['oak', 'spruce', 'acacia', 'birch', 'jungle', 'dark_oak']) shaped(w + '_stairs', 4, ['M  ', 'MM ', 'MMM'], { M: w + '_planks' });
shaped('cobblestone_stairs', 4, ['M  ', 'MM ', 'MMM'], { M: 'cobblestone' });
shaped('stone_brick_stairs', 4, ['M  ', 'MM ', 'MMM'], { M: 'stone_bricks' });
shaped('brick_stairs', 4, ['M  ', 'MM ', 'MMM'], { M: 'bricks' });
shaped('sandstone_stairs', 4, ['M  ', 'MM ', 'MMM'], { M: 'sandstone' });
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
shapeless('mossy_cobblestone', 1, ['cobblestone', 'vine']);
shapeless('mossy_stone_bricks', 1, ['stone_bricks', 'vine']);
shaped('chiseled_stone_bricks', 1, ['S', 'S'], { S: 'stone_brick_slab' });
shaped('bricks', 1, ['BB', 'BB'], { B: 'brick' });
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('red_sandstone', 1, ['SS', 'SS'], { S: 'red_sand' });
shaped('cut_sandstone', 4, ['SS', 'SS'], { S: 'sandstone' });
shaped('chiseled_sandstone', 1, ['S', 'S'], { S: 'sandstone_slab' });
shaped('polished_granite', 4, ['SS', 'SS'], { S: 'granite' });
shaped('polished_diorite', 4, ['SS', 'SS'], { S: 'diorite' });
shaped('polished_andesite', 4, ['SS', 'SS'], { S: 'andesite' });
shapeless('andesite', 2, ['diorite', 'cobblestone']);
shaped('tnt', 1, ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' });
shaped('glowstone', 1, ['GG', 'GG'], { G: 'glowstone_dust' });
shapeless('jack_o_lantern', 1, ['pumpkin', 'torch']);
shaped('snow_block', 1, ['SS', 'SS'], { S: 'snowball' });
shaped('snow', 6, ['SSS'], { S: 'snow_block' });
shaped('clay', 1, ['CC', 'CC'], { C: 'clay_ball' });
shaped('hay_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'wheat' });
shapeless('wheat', 9, ['hay_block']);
shaped('melon', 1, ['MMM', 'MMM', 'MMM'], { M: 'melon_slice' });
for (const [blk, it] of [['coal_block', 'coal'], ['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['diamond_block', 'diamond'],
  ['emerald_block', 'emerald'], ['lapis_block', 'lapis_lazuli'], ['redstone_block', 'redstone'], ['bone_block', 'bone_meal']]) {
  shaped(blk, 1, ['MMM', 'MMM', 'MMM'], { M: it });
  shapeless(it, 9, [blk]);
}
shaped('iron_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'iron_nugget' }, { id: 'iron_from_nuggets' });
shapeless('iron_nugget', 9, ['iron_ingot']);
shaped('gold_ingot', 1, ['NNN', 'NNN', 'NNN'], { N: 'gold_nugget' }, { id: 'gold_from_nuggets' });
shapeless('gold_nugget', 9, ['gold_ingot']);
shapeless('bone_meal', 3, ['bone']);
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' });
shaped('compass', 1, [' I ', 'IRI', ' I '], { I: 'iron_ingot', R: 'redstone' });
shaped('clock', 1, [' G ', 'GRG', ' G '], { G: 'gold_ingot', R: 'redstone' });
shapeless('pumpkin_pie', 1, ['pumpkin', 'sugar', 'egg']);
shapeless('black_wool', 1, ['#wool', 'ink_sac']);
shapeless('blue_wool', 1, ['#wool', 'lapis_lazuli']);
shapeless('white_wool', 1, ['#wool', 'bone_meal']);
shapeless('red_wool', 1, ['#wool', 'redstone']);
shaped('smooth_stone', 1, ['SS'], { S: 'smooth_stone_slab' }, { hidden: true });

// ------------------------------------------------------------------ matching
function ingMatch(want, id) {
  if (!want) return id === undefined || id === null;
  if (id === undefined || id === null) return false;
  if (want[0] === '#') return tagIds[want.slice(1)].has(id);
  return I[want] === id;
}

// grid: array of item ids (or null), size w x w (2 or 3)
export function matchRecipe(grid, w) {
  // bounding box of non-empty cells
  let minX = w, minY = w, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    if (grid[y * w + x] != null) { n++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  }
  if (!n) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const at = (x, y) => grid[(y + minY) * w + (x + minX)];
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      const rh = r.rows.length, rw = r.rows[0].length;
      if (rw !== bw || rh !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < rh && ok; y++) for (let x = 0; x < rw && ok; x++) {
          const c = r.rows[y][mirror ? rw - 1 - x : x];
          const want = c === ' ' ? null : r.key[c];
          const v = at(x, y);
          if (!ingMatch(want, v == null ? null : v)) ok = false;
        }
        if (ok) return r;
      }
    } else {
      if (r.ings.length !== n) continue;
      const used = new Array(r.ings.length).fill(false);
      let ok = true;
      for (let i = 0; i < w * w && ok; i++) {
        const v = grid[i];
        if (v == null) continue;
        let found = false;
        for (let j = 0; j < r.ings.length; j++) {
          if (!used[j] && ingMatch(r.ings[j], v)) { used[j] = true; found = true; break; }
        }
        if (!found) ok = false;
      }
      if (ok) return r;
    }
  }
  return null;
}

// recipes that produce an item (for the recipe book)
export function recipesFor(id) { return RECIPES.filter((r) => r.result === id && !r.hidden); }

// ------------------------------------------------------------------ smelting
export const SMELT = {};
const smelt = (a, b, xp) => { if (I[a] !== undefined && I[b] !== undefined) SMELT[I[a]] = { result: I[b], xp }; };
smelt('iron_ore', 'iron_ingot', 0.7); smelt('gold_ore', 'gold_ingot', 1); smelt('diamond_ore', 'diamond', 1);
smelt('coal_ore', 'coal', 0.1); smelt('lapis_ore', 'lapis_lazuli', 0.2); smelt('redstone_ore', 'redstone', 0.3);
smelt('emerald_ore', 'emerald', 1); smelt('sand', 'glass', 0.1); smelt('red_sand', 'glass', 0.1);
smelt('cobblestone', 'stone', 0.1); smelt('stone', 'smooth_stone', 0.1); smelt('clay_ball', 'brick', 0.3);
smelt('cod', 'cooked_cod', 0.35); smelt('salmon', 'cooked_salmon', 0.35);
smelt('porkchop', 'cooked_porkchop', 0.35); smelt('beef', 'cooked_beef', 0.35); smelt('chicken', 'cooked_chicken', 0.35);
smelt('mutton', 'cooked_mutton', 0.35); smelt('potato', 'baked_potato', 0.35); smelt('stone_bricks', 'cracked_stone_bricks', 0.1);
for (const w of WOODS) smelt(w + '_log', 'charcoal', 0.15);
void ITEMS;
