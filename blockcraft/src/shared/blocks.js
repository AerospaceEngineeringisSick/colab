// Block registry, shared by the main thread and the workers.
// Block ids are stored in saves: only ever append new blocks to the end.
import { ID_MASK } from './constants.js';

export const BLOCKS = [];
export const B = {};

// render types
export const R = {
  NONE: 0, CUBE: 1, CROSS: 2, CROP: 3, LIQUID: 4, BOXES: 5, TORCH: 6, DOOR: 7,
  LADDER: 8, FENCE: 9, STAIRS: 10, SLAB: 11, VINE: 12, PAD: 13, BED: 14, RAIL: 15,
};

const DEFAULTS = {
  render: R.CUBE,
  layer: 0, // 0 opaque, 1 cutout, 2 translucent
  opaque: true, // full opaque cube: culls faces, casts AO, blocks light
  solid: true, // has collision
  lightOpacity: 15,
  emit: 0,
  hardness: 1,
  tool: null, // pickaxe | axe | shovel | hoe | sword | shears
  tier: 0, // minimum tool tier for drops: 0 wood, 1 stone, 2 iron, 3 diamond
  needsTool: false,
  sound: 'stone',
  tint: null, // 'grass' | 'foliage' | 'water' | [r,g,b]
  cullSame: false,
  replaceable: false,
  gravity: false,
  climbable: false,
  liquid: false,
  rotate: null, // 'axis' | 'facing'
  plant: false, // needs soil below, breaks when unsupported
  slip: 0.6,
  drop: undefined, // undefined: itself; null: nothing; or a function(meta, rand, tool, fortune)
  xp: null, // [min,max]
  flammable: false,
  sway: false,
};

function block(name, props = {}) {
  const b = Object.assign({ id: BLOCKS.length, name }, DEFAULTS, props);
  if (b.tex === undefined) b.tex = name;
  if (b.render !== R.CUBE && props.opaque === undefined) b.opaque = false;
  if (!b.opaque && props.lightOpacity === undefined) b.lightOpacity = 0;
  if (b.render === R.CROSS || b.render === R.CROP) {
    if (props.solid === undefined) b.solid = false;
    if (props.layer === undefined) b.layer = 1;
  }
  BLOCKS.push(b);
  B[name] = b.id;
  return b;
}

const one = (item, n = 1) => () => [[item, n]];
const chance = (r, p) => r() < p;
// fortune on ores: multiplies the drop by 1..fortune+1 (1 is the most likely)
const oreBonus = (r, f) => (f ? Math.max(1, Math.floor(r() * (f + 2))) : 1);

// --------------------------------------------------------------- natural
block('air', { render: R.NONE, opaque: false, solid: false, lightOpacity: 0, replaceable: true, hardness: 0, tex: null });
block('stone', { hardness: 1.5, tool: 'pickaxe', needsTool: true, drop: one('cobblestone') });
block('grass_block', {
  hardness: 0.6, tool: 'shovel', sound: 'grass', tint: 'grass',
  tex: { top: 'grass_top', bottom: 'dirt', side: 'dirt', overlay: 'grass_side_overlay' }, drop: one('dirt'),
});
block('dirt', { hardness: 0.5, tool: 'shovel', sound: 'dirt' });
block('coarse_dirt', { hardness: 0.5, tool: 'shovel', sound: 'dirt' });
block('podzol', { hardness: 0.5, tool: 'shovel', sound: 'dirt', tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, drop: one('dirt') });
block('cobblestone', { hardness: 2, tool: 'pickaxe', needsTool: true });
block('mossy_cobblestone', { hardness: 2, tool: 'pickaxe', needsTool: true });
block('bedrock', { hardness: -1 });
block('sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
block('red_sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
block('gravel', {
  hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
  drop: (m, r, t, f = 0) => [[chance(r, [0.1, 0.143, 0.25, 1][Math.min(3, f)]) ? 'flint' : 'gravel', 1]],
});
block('sandstone', { hardness: 0.8, tool: 'pickaxe', needsTool: true, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' } });
block('cut_sandstone', { hardness: 0.8, tool: 'pickaxe', needsTool: true, tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'cut_sandstone' } });
block('chiseled_sandstone', { hardness: 0.8, tool: 'pickaxe', needsTool: true, tex: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'chiseled_sandstone' } });
block('red_sandstone', { hardness: 0.8, tool: 'pickaxe', needsTool: true, tex: { top: 'red_sandstone_top', bottom: 'red_sandstone_bottom', side: 'red_sandstone_side' } });
block('clay', { hardness: 0.6, tool: 'shovel', sound: 'dirt', drop: one('clay_ball', 4) });
block('snow_block', { hardness: 0.2, tool: 'shovel', sound: 'snow', tex: 'snow', drop: one('snowball', 4) });
block('snow', {
  render: R.BOXES, hardness: 0.1, tool: 'shovel', needsTool: true, sound: 'snow', replaceable: true,
  drop: one('snowball'), layer: 0,
});
block('ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', opaque: false, layer: 2, lightOpacity: 2, cullSame: true, slip: 0.98, drop: null });
block('packed_ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drop: null });
block('obsidian', { hardness: 50, tool: 'pickaxe', tier: 3, needsTool: true });
block('granite', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('polished_granite', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('diorite', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('polished_diorite', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('andesite', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('polished_andesite', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
// ores
block('coal_ore', { hardness: 3, tool: 'pickaxe', needsTool: true, drop: (m, r, t, f) => [['coal', oreBonus(r, f)]], xp: [0, 2] });
block('iron_ore', { hardness: 3, tool: 'pickaxe', tier: 1, needsTool: true });
block('gold_ore', { hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true });
block('diamond_ore', { hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true, drop: (m, r, t, f) => [['diamond', oreBonus(r, f)]], xp: [3, 7] });
block('redstone_ore', { hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true, drop: (m, r, t, f = 0) => [['redstone', 4 + (r() * 2 | 0) + (r() * (f + 1) | 0)]], xp: [1, 5] });
block('lapis_ore', { hardness: 3, tool: 'pickaxe', tier: 1, needsTool: true, drop: (m, r, t, f) => [['lapis_lazuli', (4 + (r() * 5 | 0)) * oreBonus(r, f)]], xp: [2, 5] });
block('emerald_ore', { hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true, drop: (m, r, t, f) => [['emerald', oreBonus(r, f)]], xp: [3, 7] });

// --------------------------------------------------------------- wood
export const WOODS = ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak'];
for (const w of WOODS) block(w + '_log', { hardness: 2, tool: 'axe', sound: 'wood', rotate: 'axis', flammable: true, tex: { end: w + '_log_top', side: w + '_log' } });
for (const w of WOODS) block(w + '_planks', { hardness: 2, tool: 'axe', sound: 'wood', flammable: true });
const LEAF_TINT = { birch: [0.5, 0.65, 0.33], spruce: [0.38, 0.6, 0.38] };
for (const w of WOODS) block(w + '_leaves', {
  hardness: 0.2, tool: 'hoe', sound: 'grass', opaque: false, layer: 1, lightOpacity: 1, flammable: true,
  tint: LEAF_TINT[w] || 'foliage', sway: true,
  drop: (m, r, tool, f = 0) => {
    if (tool === 'shears') return [[w + '_leaves', 1]];
    const out = [];
    const k = Math.min(3, f);
    if (chance(r, w === 'jungle' ? [1 / 40, 1 / 36, 1 / 32, 1 / 24][k] : [1 / 20, 1 / 16, 1 / 12, 1 / 10][k])) out.push([w + '_sapling', 1]);
    if (chance(r, 0.02)) out.push(['stick', 1 + (r() * 2 | 0)]);
    if ((w === 'oak' || w === 'dark_oak') && chance(r, [1 / 200, 1 / 180, 1 / 160, 1 / 120][k])) out.push(['apple', 1]);
    return out;
  },
});
for (const w of WOODS) block(w + '_sapling', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, flammable: true });

// --------------------------------------------------------------- fluids
block('water', {
  render: R.LIQUID, layer: 2, solid: false, lightOpacity: 2, replaceable: true, hardness: 100, liquid: true,
  tint: 'water', tex: { top: 'water_still', side: 'water_flow' }, drop: null, sound: 'water',
});
block('lava', {
  render: R.LIQUID, layer: 0, solid: false, lightOpacity: 1, replaceable: true, hardness: 100, liquid: true,
  emit: 15, tex: { top: 'lava_still', side: 'lava_flow' }, drop: null,
});

// --------------------------------------------------------------- building
block('glass', { hardness: 0.3, sound: 'glass', opaque: false, layer: 1, cullSame: true, drop: null });
block('bricks', { hardness: 2, tool: 'pickaxe', needsTool: true });
block('stone_bricks', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('mossy_stone_bricks', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('cracked_stone_bricks', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('chiseled_stone_bricks', { hardness: 1.5, tool: 'pickaxe', needsTool: true });
block('bookshelf', { hardness: 1.5, tool: 'axe', sound: 'wood', flammable: true, tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' }, drop: one('book', 3) });
block('crafting_table', { hardness: 2.5, tool: 'axe', sound: 'wood', rotate: 'facing', tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' } });
block('furnace', { hardness: 3.5, tool: 'pickaxe', needsTool: true, rotate: 'facing', tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' } });
block('lit_furnace', { hardness: 3.5, tool: 'pickaxe', needsTool: true, rotate: 'facing', emit: 13, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_on' }, drop: one('furnace') });
block('chest', { render: R.BOXES, hardness: 2.5, tool: 'axe', sound: 'wood', rotate: 'facing', layer: 0, tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front' } });
block('torch', { render: R.TORCH, solid: false, hardness: 0, sound: 'wood', emit: 14, layer: 1 });
block('tnt', { hardness: 0, sound: 'grass', tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' } });
block('ladder', { render: R.LADDER, hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, layer: 1 });
block('oak_door', { render: R.DOOR, tex: { side: 'oak_door_bottom', top: 'oak_door_top' }, hardness: 3, tool: 'axe', sound: 'wood', layer: 1, drop: (m) => (m & 4) ? [] : [['oak_door', 1]] });

// --------------------------------------------------------------- farming
block('farmland', { render: R.BOXES, hardness: 0.6, tool: 'shovel', sound: 'dirt', lightOpacity: 15, drop: one('dirt'), tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' } });
block('wheat', {
  render: R.CROP, tex: 'wheat7', hardness: 0, sound: 'grass', plant: true,
  drop: (m, r, t, f = 0) => m >= 7 ? [['wheat', 1], ['wheat_seeds', 1 + (r() * 3 | 0) + (r() * (f + 1) | 0)]] : [['wheat_seeds', 1]],
});
block('carrots', { render: R.CROP, tex: 'carrots3', hardness: 0, sound: 'grass', plant: true, drop: (m, r, t, f = 0) => [['carrot', m >= 7 ? 2 + (r() * 3 | 0) + (r() * (f + 1) | 0) : 1]] });
block('potatoes', {
  render: R.CROP, tex: 'potatoes3', hardness: 0, sound: 'grass', plant: true,
  drop: (m, r, t, f = 0) => m >= 7 ? [['potato', 2 + (r() * 3 | 0) + (r() * (f + 1) | 0)]] : [['potato', 1]],
});
block('pumpkin', { hardness: 1, tool: 'axe', sound: 'wood', rotate: 'facing', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' } });
block('jack_o_lantern', { hardness: 1, tool: 'axe', sound: 'wood', rotate: 'facing', emit: 15, tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' } });
block('melon', { hardness: 1, tool: 'axe', sound: 'wood', tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }, drop: (m, r, t, f = 0) => [['melon_slice', Math.min(9, 3 + (r() * 5 | 0) + (r() * (f + 1) | 0))]] });
block('hay_block', { hardness: 0.5, tool: 'hoe', sound: 'grass', rotate: 'axis', tex: { end: 'hay_top', side: 'hay_side' } });
block('cactus', { render: R.BOXES, hardness: 0.4, sound: 'cloth', layer: 1, plant: true, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' } });
block('sugar_cane', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, tint: 'grass', drop: one('sugar_cane') });

// --------------------------------------------------------------- plants
block('short_grass', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, replaceable: true, tint: 'grass', sway: true, drop: (m, r, tool) => tool === 'shears' ? [['short_grass', 1]] : chance(r, 0.125) ? [['wheat_seeds', 1]] : [] });
block('fern', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, replaceable: true, tint: 'grass', sway: true, drop: (m, r, tool) => tool === 'shears' ? [['fern', 1]] : chance(r, 0.125) ? [['wheat_seeds', 1]] : [] });
block('dead_bush', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, replaceable: true, drop: (m, r) => [['stick', r() * 3 | 0]] });
export const FLOWERS = ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'];
for (const f of FLOWERS) block(f, { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, sway: true });
block('brown_mushroom', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true, emit: 1 });
block('red_mushroom', { render: R.CROSS, hardness: 0, sound: 'grass', plant: true });
block('lily_pad', { render: R.PAD, hardness: 0, sound: 'grass', layer: 1, tint: [0.45, 0.75, 0.35] });
block('vine', { render: R.VINE, hardness: 0.2, tool: 'shears', sound: 'grass', solid: false, climbable: true, replaceable: true, layer: 1, tint: 'foliage', drop: (m, r, tool) => tool === 'shears' ? [['vine', 1]] : [] });
block('cobweb', { render: R.CROSS, hardness: 4, tool: 'sword', sound: 'cloth', drop: (m, r, tool) => tool === 'shears' ? [['cobweb', 1]] : [['string', 1]] });

// --------------------------------------------------------------- mineral blocks
block('coal_block', { hardness: 5, tool: 'pickaxe', needsTool: true, flammable: true });
block('iron_block', { hardness: 5, tool: 'pickaxe', tier: 1, needsTool: true, sound: 'metal' });
block('gold_block', { hardness: 3, tool: 'pickaxe', tier: 2, needsTool: true, sound: 'metal' });
block('diamond_block', { hardness: 5, tool: 'pickaxe', tier: 2, needsTool: true, sound: 'metal' });
block('emerald_block', { hardness: 5, tool: 'pickaxe', tier: 2, needsTool: true, sound: 'metal' });
block('lapis_block', { hardness: 3, tool: 'pickaxe', tier: 1, needsTool: true });
block('redstone_block', { hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal' });
block('smooth_stone', { hardness: 2, tool: 'pickaxe', needsTool: true, tex: { top: 'smooth_stone', bottom: 'smooth_stone', side: 'smooth_stone_slab_side' } });

// slabs: meta 0 bottom, 1 top. A slab placed on its twin becomes `full`.
export const SLABS = {
  smooth_stone_slab: { tex: { top: 'smooth_stone', bottom: 'smooth_stone', side: 'smooth_stone_slab_side' }, full: 'smooth_stone', p: 'pickaxe' },
  cobblestone_slab: { tex: 'cobblestone', full: 'cobblestone', p: 'pickaxe' },
  oak_slab: { tex: 'oak_planks', full: 'oak_planks', p: 'axe' },
  stone_brick_slab: { tex: 'stone_bricks', full: 'stone_bricks', p: 'pickaxe' },
  sandstone_slab: { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, full: 'sandstone', p: 'pickaxe' },
  brick_slab: { tex: 'bricks', full: 'bricks', p: 'pickaxe' },
};
for (const [n, s] of Object.entries(SLABS)) block(n, {
  render: R.SLAB, tex: s.tex, hardness: 2, tool: s.p, needsTool: s.p === 'pickaxe', sound: s.p === 'axe' ? 'wood' : 'stone', layer: 0,
});
// stairs: meta bits 0-1 facing (direction of the tall side), bit 2 upside down
export const STAIRS = {
  oak_stairs: { tex: 'oak_planks', p: 'axe' },
  cobblestone_stairs: { tex: 'cobblestone', p: 'pickaxe' },
  stone_brick_stairs: { tex: 'stone_bricks', p: 'pickaxe' },
  brick_stairs: { tex: 'bricks', p: 'pickaxe' },
  sandstone_stairs: { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, p: 'pickaxe' },
};
for (const [n, s] of Object.entries(STAIRS)) block(n, {
  render: R.STAIRS, tex: s.tex, hardness: 2, tool: s.p, needsTool: s.p === 'pickaxe', sound: s.p === 'axe' ? 'wood' : 'stone', layer: 0,
});
block('oak_fence', { render: R.FENCE, tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', layer: 0 });
block('dirt_path', { render: R.BOXES, hardness: 0.65, tool: 'shovel', sound: 'grass', lightOpacity: 15, drop: one('dirt'), tex: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' } });
block('spawner', { hardness: 5, tool: 'pickaxe', needsTool: true, sound: 'metal', opaque: false, layer: 1, drop: null, xp: [15, 43] });
block('glowstone', { hardness: 0.3, sound: 'glass', emit: 15, drop: (m, r, t, f = 0) => [['glowstone_dust', Math.min(4, 2 + (r() * 3 | 0) + (r() * (f + 1) | 0))]] });
block('cake', { render: R.BOXES, hardness: 0.5, sound: 'cloth', drop: null, layer: 0, tex: { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side', inner: 'cake_inner' } });
// bed: meta bits 0-1 facing (towards the head), bit 2 head part
block('red_bed', { render: R.BED, tex: { top: 'bed_head_top', side: 'bed_head_side', bottom: 'oak_planks' }, hardness: 0.2, sound: 'wood', layer: 0, drop: (m) => (m & 4) ? [['red_bed', 1]] : [] });
export const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of COLORS) block(c + '_wool', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: true, tex: 'wool_' + c });
block('sea_lantern', { hardness: 0.3, sound: 'glass', emit: 15, drop: null });
block('bone_block', { hardness: 2, tool: 'pickaxe', needsTool: true, rotate: 'axis', tex: { end: 'bone_block_top', side: 'bone_block_side' } });
block('enchanting_table', { render: R.BOXES, hardness: 5, tool: 'pickaxe', needsTool: true, opaque: false, lightOpacity: 0, emit: 7, layer: 1,
  tex: { top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'enchanting_table_bottom' } });
// anvil: meta bits 0-1 facing (the long side runs across the player's view)
block('anvil', { render: R.BOXES, hardness: 5, tool: 'pickaxe', needsTool: true, opaque: false, lightOpacity: 0, sound: 'metal', layer: 0,
  rotate: 'facing', gravity: true, tex: { top: 'anvil_top', side: 'anvil_side', bottom: 'anvil_base' } });
// rails: meta = shape (0 N-S, 1 E-W, 2-5 ascending E/W/N/S, 6-9 curves SE/SW/NW/NE); powered kinds add 8 when on
const RAIL = { render: R.RAIL, hardness: 0.7, tool: 'pickaxe', sound: 'metal', solid: false, opaque: false, lightOpacity: 0, layer: 1 };
block('rail', { ...RAIL, tex: { top: 'rail', side: 'rail_curved' } });
block('powered_rail', { ...RAIL, tex: { top: 'powered_rail', side: 'powered_rail_on' }, straightOnly: true });
block('detector_rail', { ...RAIL, tex: { top: 'detector_rail', side: 'detector_rail_on' }, straightOnly: true });

// ------------------------------------------------------------------ tables
const N = 1024;
export const OPAQUE = new Uint8Array(N);
export const SOLID = new Uint8Array(N);
export const LIGHT_OPACITY = new Uint8Array(N);
export const EMIT = new Uint8Array(N);
export const RENDER = new Uint8Array(N);
export const LAYER = new Uint8Array(N);
export const LIQUID = new Uint8Array(N);
export const REPLACEABLE = new Uint8Array(N);
export const CULL_SAME = new Uint8Array(N);
for (const b of BLOCKS) {
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  SOLID[b.id] = b.solid ? 1 : 0;
  LIGHT_OPACITY[b.id] = b.lightOpacity;
  EMIT[b.id] = b.emit;
  RENDER[b.id] = b.render;
  LAYER[b.id] = b.layer;
  LIQUID[b.id] = b.liquid ? 1 : 0;
  REPLACEABLE[b.id] = b.replaceable ? 1 : 0;
  CULL_SAME[b.id] = b.cullSame ? 1 : 0;
}

export const blockOf = (v) => BLOCKS[v & ID_MASK];

// every texture name a block needs (for building the texture array)
export function blockTextureNames() {
  const set = new Set();
  const add = (t) => {
    if (!t) return;
    if (typeof t === 'string') set.add(t);
    else for (const v of Object.values(t)) set.add(v);
  };
  for (const b of BLOCKS) add(b.tex);
  for (const n of ['grass_side_snow', 'farmland_moist', 'torch', 'ladder', 'oak_door_top', 'oak_door_bottom',
    'bed_head_top', 'bed_foot_top', 'bed_head_side', 'bed_foot_side', 'bed_head_end', 'bed_foot_end',
    'destroy', 'snow', 'short_grass', 'fern', 'wheat0', 'carrots0', 'potatoes0']) set.add(n);
  for (let i = 0; i < 8; i++) set.add('wheat' + i);
  for (let i = 0; i < 4; i++) { set.add('carrots' + i); set.add('potatoes' + i); }
  for (const w of WOODS) set.add(w + '_sapling');
  return [...set];
}

// Resolve texture names to texture-array layers. `tex` maps name -> {layer, frames}.
// Fills b.faces (6 layers) and b.anim (6 frame counts) for the default orientation.
export function resolveBlockTextures(tex) {
  const L = (n) => {
    const t = tex[n];
    if (!t) throw new Error('missing texture ' + n);
    return t;
  };
  for (const b of BLOCKS) {
    b.faces = new Int32Array(6);
    b.anim = new Uint8Array(6);
    if (!b.tex) continue;
    const t = typeof b.tex === 'string' ? { all: b.tex } : b.tex;
    const side = t.side || t.all;
    const top = t.top || t.end || t.all || side;
    const bottom = t.bottom || t.end || top;
    const names = [side, side, top, bottom, side, side];
    for (let f = 0; f < 6; f++) {
      const r = L(names[f]);
      b.faces[f] = r.layer;
      b.anim[f] = r.frames;
    }
    if (t.front) b.front = L(t.front).layer;
    if (t.end) b.end = L(t.end).layer;
    if (t.overlay) b.overlay = L(t.overlay).layer;
    if (t.inner) b.inner = L(t.inner).layer;
  }
}
