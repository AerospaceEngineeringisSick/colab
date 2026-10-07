// One-off importer: copies the textures and sounds BlockCraft uses out of a
// Mineclonia checkout (https://codeberg.org/mineclonia/mineclonia) into
// assets/, renamed to the names the game expects. Sounds are transcoded to
// small mono MP3s so every browser (Safari included) can decode them.
//
//   node tools/import-assets.mjs /path/to/mineclonia
//
// The results are committed, so you only need this to refresh assets.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(path.join(SRC, 'mods'))) {
  console.error('usage: node tools/import-assets.mjs <mineclonia checkout>');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'assets');

// basename -> full path index of the source tree
const index = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!index.has(e.name)) index.set(e.name, p);
  }
})(path.join(SRC, 'mods'));

const find = (name) => {
  const p = index.get(name);
  if (!p) throw new Error('missing source file: ' + name);
  return p;
};

// ---------------------------------------------------------------- textures
const T = {
  block: {
    stone: 'default_stone', granite: 'mcl_core_granite', polished_granite: 'mcl_core_granite_smooth',
    diorite: 'mcl_core_diorite', polished_diorite: 'mcl_core_diorite_smooth', andesite: 'mcl_core_andesite',
    polished_andesite: 'mcl_core_andesite_smooth', grass_top: 'mcl_core_grass_block_top',
    grass_side_overlay: 'mcl_core_grass_block_side_overlay', grass_side_snow: 'mcl_core_grass_side_snowed',
    dirt: 'default_dirt', coarse_dirt: 'mcl_core_coarse_dirt', podzol_top: 'mcl_core_dirt_podzol_top',
    podzol_side: 'mcl_core_dirt_podzol_side', cobblestone: 'default_cobble', mossy_cobblestone: 'default_mossycobble',
    bedrock: 'mcl_core_bedrock', sand: 'default_sand', red_sand: 'mcl_core_red_sand', gravel: 'default_gravel',
    sandstone_top: 'mcl_core_sandstone_top', sandstone_bottom: 'mcl_core_sandstone_bottom',
    sandstone_side: 'mcl_core_sandstone_normal', cut_sandstone: 'mcl_core_sandstone_smooth',
    chiseled_sandstone: 'mcl_core_sandstone_carved', red_sandstone_top: 'mcl_core_red_sandstone_top',
    red_sandstone_bottom: 'mcl_core_red_sandstone_bottom', red_sandstone_side: 'mcl_core_red_sandstone_normal',
    clay: 'default_clay', snow: 'default_snow', ice: 'default_ice', packed_ice: 'mcl_core_ice_packed',
    obsidian: 'default_obsidian', coal_ore: 'mcl_core_coal_ore', iron_ore: 'mcl_core_iron_ore',
    gold_ore: 'mcl_core_gold_ore', diamond_ore: 'mcl_core_diamond_ore', redstone_ore: 'mcl_core_redstone_ore',
    lapis_ore: 'mcl_core_lapis_ore', emerald_ore: 'mcl_core_emerald_ore',
    oak_log: 'default_tree', oak_log_top: 'default_tree_top', birch_log: 'mcl_core_log_birch',
    birch_log_top: 'mcl_core_log_birch_top', spruce_log: 'mcl_core_log_spruce', spruce_log_top: 'mcl_core_log_spruce_top',
    jungle_log: 'default_jungletree', jungle_log_top: 'default_jungletree_top', acacia_log: 'default_acacia_tree',
    acacia_log_top: 'default_acacia_tree_top', dark_oak_log: 'mcl_core_log_big_oak', dark_oak_log_top: 'mcl_core_log_big_oak_top',
    oak_planks: 'default_wood', birch_planks: 'mcl_core_planks_birch', spruce_planks: 'mcl_core_planks_spruce',
    jungle_planks: 'default_junglewood', acacia_planks: 'default_acacia_wood', dark_oak_planks: 'mcl_core_planks_big_oak',
    oak_leaves: 'default_leaves', birch_leaves: 'mcl_core_leaves_birch', spruce_leaves: 'mcl_core_leaves_spruce',
    jungle_leaves: 'default_jungleleaves', acacia_leaves: 'default_acacia_leaves', dark_oak_leaves: 'mcl_core_leaves_big_oak',
    oak_sapling: 'default_sapling', birch_sapling: 'mcl_core_sapling_birch', spruce_sapling: 'mcl_core_sapling_spruce',
    jungle_sapling: 'default_junglesapling', acacia_sapling: 'default_acacia_sapling', dark_oak_sapling: 'mcl_core_sapling_big_oak',
    water_still: 'default_water_source_animated', water_flow: 'default_water_flowing_animated',
    lava_still: 'default_lava_source_animated', lava_flow: 'default_lava_flowing_animated',
    glass: 'default_glass', bricks: 'default_brick', stone_bricks: 'default_stone_brick',
    mossy_stone_bricks: 'mcl_core_stonebrick_mossy', cracked_stone_bricks: 'mcl_core_stonebrick_cracked',
    chiseled_stone_bricks: 'mcl_core_stonebrick_carved', bookshelf: 'default_bookshelf',
    crafting_table_top: 'crafting_workbench_top', crafting_table_side: 'crafting_workbench_side',
    crafting_table_front: 'crafting_workbench_front', furnace_top: 'default_furnace_top',
    furnace_side: 'default_furnace_side', furnace_front: 'default_furnace_front',
    furnace_front_on: 'default_furnace_front_active', torch: 'default_torch_on_floor',
    tnt_top: 'default_tnt_top', tnt_side: 'default_tnt_side', tnt_bottom: 'default_tnt_bottom',
    ladder: 'default_ladder', oak_door_top: 'mcl_doors_door_wood_upper', oak_door_bottom: 'mcl_doors_door_wood_lower',
    farmland: 'mcl_farming_farmland_dry', farmland_moist: 'mcl_farming_farmland_wet',
    pumpkin_top: 'farming_pumpkin_top', pumpkin_side: 'farming_pumpkin_side', pumpkin_face: 'farming_pumpkin_face',
    jack_o_lantern: 'farming_pumpkin_face_light', melon_top: 'farming_melon_top', melon_side: 'farming_melon_side',
    hay_top: 'mcl_farming_hayblock_top', hay_side: 'mcl_farming_hayblock_side',
    cactus_top: 'mcl_core_cactus_top', cactus_side: 'mcl_core_cactus_side', cactus_bottom: 'mcl_core_cactus_bottom',
    sugar_cane: 'mcl_core_papyrus', short_grass: 'mcl_flowers_tallgrass', fern: 'mcl_flowers_fern',
    dead_bush: 'default_dry_shrub', dandelion: 'flowers_dandelion_yellow', poppy: 'mcl_flowers_poppy',
    blue_orchid: 'mcl_flowers_blue_orchid', allium: 'mcl_flowers_allium', azure_bluet: 'mcl_flowers_azure_bluet',
    red_tulip: 'mcl_flowers_tulip_red', orange_tulip: 'flowers_tulip', white_tulip: 'mcl_flowers_tulip_white',
    pink_tulip: 'mcl_flowers_tulip_pink', oxeye_daisy: 'mcl_flowers_oxeye_daisy', cornflower: 'mcl_flowers_cornflower',
    lily_of_the_valley: 'mcl_flowers_lily_of_the_valley', brown_mushroom: 'farming_mushroom_brown',
    red_mushroom: 'farming_mushroom_red', lily_pad: 'flowers_waterlily', vine: 'mcl_core_vine', cobweb: 'mcl_core_web',
    coal_block: 'default_coal_block', iron_block: 'default_steel_block', gold_block: 'default_gold_block',
    diamond_block: 'default_diamond_block', emerald_block: 'mcl_core_emerald_block', lapis_block: 'mcl_core_lapis_block',
    redstone_block: 'redstone_redstone_block', smooth_stone: 'mcl_stairs_stone_slab_top',
    smooth_stone_slab_side: 'mcl_stairs_stone_slab_side', dirt_path_top: 'mcl_core_grass_path_top',
    dirt_path_side: 'mcl_core_grass_path_side', spawner: 'mob_spawner', glowstone: 'mcl_nether_glowstone',
    cake_top: 'cake_top', cake_side: 'cake_side', cake_bottom: 'cake_bottom', cake_inner: 'cake_inner',
    destroy: 'crack_anylength', sea_lantern: 'mcl_ocean_sea_lantern', bone_block_side: 'mcl_core_bone_block_side',
    bone_block_top: 'mcl_core_bone_block_top',
    wool_white: 'wool_white', wool_orange: 'wool_orange', wool_magenta: 'wool_magenta', wool_light_blue: 'mcl_wool_light_blue',
    wool_yellow: 'wool_yellow', wool_lime: 'mcl_wool_lime', wool_pink: 'wool_pink', wool_gray: 'wool_dark_grey',
    wool_light_gray: 'wool_grey', wool_cyan: 'wool_cyan', wool_purple: 'wool_violet', wool_blue: 'wool_blue',
    wool_brown: 'wool_brown', wool_green: 'wool_dark_green', wool_red: 'wool_red', wool_black: 'wool_black',
    enchanting_table_top: 'mcl_enchanting_table_top', enchanting_table_side: 'mcl_enchanting_table_side',
    enchanting_table_bottom: 'mcl_enchanting_table_bottom', anvil_top: 'mcl_anvils_anvil_top_damaged_0',
    anvil_side: 'mcl_anvils_anvil_side', anvil_base: 'mcl_anvils_anvil_base',
    rail: 'default_rail', rail_curved: 'default_rail_curved', powered_rail: 'mcl_minecarts_rail_golden',
    powered_rail_on: 'mcl_minecarts_rail_golden_powered', detector_rail: 'mcl_minecarts_rail_detector',
    detector_rail_on: 'mcl_minecarts_rail_detector_powered',
    redstone_dust_dot: 'redstone_redstone_dust_dot', redstone_dust_line: 'redstone_redstone_dust_line0',
    redstone_torch: 'jeija_torches_on', redstone_torch_off: 'jeija_torches_off', lever: 'mesecons_walllever_lever',
    repeater: 'mesecons_delayer_off', repeater_on: 'mesecons_delayer_on', redstone_lamp: 'jeija_lightstone_gray_off',
    redstone_lamp_on: 'jeija_lightstone_gray_on', piston_top: 'mesecons_piston_pusher_front',
    piston_top_sticky: 'mesecons_piston_pusher_front_sticky', piston_side: 'mesecons_piston_bottom',
    piston_bottom: 'mesecons_piston_back', piston_inner: 'mesecons_piston_on_front',
  },
  item: {
    stick: 'default_stick', coal: 'default_coal_lump', charcoal: 'mcl_core_charcoal', iron_ingot: 'default_steel_ingot',
    gold_ingot: 'default_gold_ingot', diamond: 'default_diamond', emerald: 'mcl_core_emerald', lapis_lazuli: 'mcl_core_lapis',
    redstone: 'redstone_redstone_dust', flint: 'default_flint', clay_ball: 'default_clay_lump', brick: 'default_clay_brick',
    bone: 'mcl_mobitems_bone', bone_meal: 'mcl_bone_meal_bone_meal', string: 'mcl_mobitems_string',
    feather: 'mcl_mobitems_feather', gunpowder: 'default_gunpowder', leather: 'mcl_mobitems_leather',
    rotten_flesh: 'mcl_mobitems_rotten_flesh', spider_eye: 'mcl_mobitems_spider_eye', arrow: 'mcl_bows_arrow_inv',
    bow: 'mcl_bows_bow', bow_pulling_0: 'mcl_bows_bow_0', bow_pulling_1: 'mcl_bows_bow_1', bow_pulling_2: 'mcl_bows_bow_2',
    wheat_seeds: 'mcl_farming_wheat_seeds', wheat: 'farming_wheat_harvested', bread: 'farming_bread', apple: 'default_apple',
    golden_apple: 'mcl_core_apple_golden', porkchop: 'mcl_mobitems_porkchop_raw', cooked_porkchop: 'mcl_mobitems_porkchop_cooked',
    beef: 'mcl_mobitems_beef_raw', cooked_beef: 'mcl_mobitems_beef_cooked', chicken: 'mcl_mobitems_chicken_raw',
    cooked_chicken: 'mcl_mobitems_chicken_cooked', mutton: 'mcl_mobitems_mutton_raw', cooked_mutton: 'mcl_mobitems_mutton_cooked',
    carrot: 'farming_carrot', potato: 'farming_potato', baked_potato: 'farming_potato_baked', sugar: 'mcl_core_sugar',
    paper: 'default_paper', book: 'default_book', bowl: 'mcl_core_bowl', mushroom_stew: 'farming_mushroom_stew',
    bucket: 'bucket', water_bucket: 'bucket_water', lava_bucket: 'bucket_lava', milk_bucket: 'mcl_mobitems_bucket_milk',
    flint_and_steel: 'mcl_fire_flint_and_steel', shears: 'default_tool_shears',
    wooden_pickaxe: 'default_tool_woodpick', wooden_axe: 'default_tool_woodaxe', wooden_shovel: 'default_tool_woodshovel',
    wooden_sword: 'default_tool_woodsword', wooden_hoe: 'farming_tool_woodhoe',
    stone_pickaxe: 'default_tool_stonepick', stone_axe: 'default_tool_stoneaxe', stone_shovel: 'default_tool_stoneshovel',
    stone_sword: 'default_tool_stonesword', stone_hoe: 'farming_tool_stonehoe',
    iron_pickaxe: 'default_tool_steelpick', iron_axe: 'default_tool_steelaxe', iron_shovel: 'default_tool_steelshovel',
    iron_sword: 'default_tool_steelsword', iron_hoe: 'farming_tool_steelhoe',
    golden_pickaxe: 'default_tool_goldpick', golden_axe: 'default_tool_goldaxe', golden_shovel: 'default_tool_goldshovel',
    golden_sword: 'default_tool_goldsword', golden_hoe: 'farming_tool_goldhoe',
    diamond_pickaxe: 'default_tool_diamondpick', diamond_axe: 'default_tool_diamondaxe', diamond_shovel: 'default_tool_diamondshovel',
    diamond_sword: 'default_tool_diamondsword', diamond_hoe: 'farming_tool_diamondhoe',
    egg: 'mcl_throwing_egg', snowball: 'mcl_throwing_snowball', ender_pearl: 'mcl_throwing_ender_pearl',
    compass: 'mcl_compass_compass_00', clock: 'mcl_clock_clock_00', sugar_cane: 'mcl_core_reeds',
    oak_door: 'doors_item_wood', red_bed: 'mcl_beds_bed_red_inv', melon_slice: 'farming_melon',
    pumpkin_seeds: 'mcl_farming_pumpkin_seeds', melon_seeds: 'mcl_farming_melon_seeds', pumpkin_pie: 'mcl_farming_pumpkin_pie',
    cookie: 'farming_cookie', cake: 'cake', glowstone_dust: 'mcl_nether_glowstone_dust', iron_nugget: 'mcl_core_iron_nugget',
    gold_nugget: 'mcl_core_gold_nugget', slime_ball: 'mcl_mobitems_slimeball', ink_sac: 'mcl_mobitems_ink_sac',
    spawn_egg: 'spawn_egg', spawn_egg_overlay: 'spawn_egg_overlay', enchanted_book: 'mcl_enchanting_book_enchanted',
    minecart: 'mcl_minecarts_minecart_normal', repeater: 'mesecons_delayer_item', lever: 'mesecons_walllever_lever_inv',
    fishing_rod: 'mcl_fishing_fishing_rod', cod: 'mcl_fishing_fish_raw', salmon: 'mcl_fishing_salmon_raw',
    tropical_fish: 'mcl_fishing_clownfish_raw', pufferfish: 'mcl_fishing_pufferfish_raw', cooked_cod: 'mcl_fishing_fish_cooked',
    cooked_salmon: 'mcl_fishing_salmon_cooked', saddle: 'mcl_mobitems_saddle', name_tag: 'mcl_mobitems_nametag',
  },
  entity: {
    zombie: 'mobs_mc_zombie', skeleton: 'mobs_mc_skeleton', creeper: 'mobs_mc_creeper', spider: 'mobs_mc_spider',
    spider_eyes: 'mobs_mc_spider_eyes', enderman: 'mobs_mc_enderman', enderman_eyes: 'mobs_mc_enderman_eyes',
    pig: 'mobs_mc_pig', cow: 'mobs_mc_cow', sheep: 'mobs_mc_sheep', sheep_fur: 'mobs_mc_sheep_fur',
    chicken: 'mobs_mc_chicken', wolf: 'mobs_mc_wolf', wolf_angry: 'mobs_mc_wolf_angry', wolf_tame: 'mobs_mc_wolf_tame',
    wolf_collar: 'mobs_mc_wolf_collar', steve: 'character', alex: 'mcl_skins_character_1', chest: 'mcl_chests_normal',
    bed: 'mcl_beds_bed_red', arrow: 'mcl_bows_arrow', slime: 'mobs_mc_slime',
    skeleton_overlay: 'mobs_mc_stray_overlay', enchanting_book: 'mcl_enchanting_book_entity',
    minecart: 'mcl_minecarts_minecart', fishing_bobber: 'mcl_fishing_bobber',
  },
  gui: {
    hotbar: 'mcl_inventory_hotbar', hotbar_selected: 'mcl_inventory_hotbar_selected', heart: 'heart',
    hunger: 'hbhunger_icon', bubble: 'bubble', xp_bar: 'mcl_experience_bar', xp_bar_bg: 'mcl_experience_bar_background',
    crosshair: 'crosshair', slot_helmet: 'mcl_inventory_empty_armor_slot_helmet',
    slot_chestplate: 'mcl_inventory_empty_armor_slot_chestplate', slot_leggings: 'mcl_inventory_empty_armor_slot_leggings',
    slot_boots: 'mcl_inventory_empty_armor_slot_boots', fire_bg: 'default_furnace_fire_bg', fire_fg: 'default_furnace_fire_fg',
    arrow_bg: 'gui_furnace_arrow_bg', arrow_fg: 'gui_furnace_arrow_fg', craft_arrow: 'gui_crafting_arrow',
    slot_lapis: 'mcl_enchanting_lapis_background', anvil_hammer: 'mcl_anvils_inventory_hammer',
    enchant_book: 'mcl_enchanting_book_open',
  },
  env: {
    moon_phases: 'mcl_moon_moon_phases', rain: 'weather_pack_rain_raindrop_1', snowflake: 'weather_pack_snow_snowflake1',
    smoke: 'smoke_puff', flame: 'mcl_particles_fire_flame', bonemeal: 'mcl_particles_bonemeal',
    bubble: 'mcl_particles_bubble', lava_particle: 'mcl_particles_lava', xp_orb: 'mcl_experience_orb',
  },
};

// armour layer textures (third person) and inventory icons
for (const m of ['leather', 'chain', 'iron', 'gold', 'diamond']) {
  const im = { leather: 'leather', chain: 'chainmail', iron: 'iron', gold: 'golden', diamond: 'diamond' }[m];
  for (const p of ['helmet', 'chestplate', 'leggings', 'boots']) {
    T.item[`${im}_${p}`] = `mcl_armor_inv_${p}_${m}`;
    T.entity[`armor_${m}_${p}`] = `mcl_armor_${p}_${m}`;
  }
}
// boats: inventory icons and entity textures per wood
for (const w of ['oak', 'birch', 'spruce', 'jungle', 'acacia', 'dark_oak']) {
  T.item[w + '_boat'] = `mcl_boats_${w}_boat`;
  T.entity['boat_' + w] = `mcl_boats_texture_${w}_boat`;
}
// villagers: base skin, biome outfit and profession layers (composited in game), iron golem
T.entity.villager_base = 'mobs_mc_villager_base';
for (const t of ['plains', 'desert', 'savanna', 'snow', 'taiga', 'jungle', 'swamp']) T.entity['villager_' + t] = 'mobs_mc_villager_' + t;
for (const p of ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman', 'fletcher', 'leatherworker', 'librarian', 'mason',
  'nitwit', 'shepherd', 'toolsmith', 'weaponsmith']) T.entity['villager_profession_' + p] = 'mobs_mc_villager_profession_' + p;
T.entity.iron_golem = 'mobs_mc_iron_golem';
// enchanting table glyphs (Standard Galactic) and level-cost badges
for (let i = 1; i <= 18; i++) T.gui['glyph_' + i] = 'mcl_enchanting_glyph_' + i;
for (let i = 1; i <= 3; i++) { T.gui['enchant_cost_' + i] = 'mcl_enchanting_number_' + i; T.gui[`enchant_cost_${i}_off`] = `mcl_enchanting_number_${i}_off`; }
// the Nether
Object.assign(T.block, {
  netherrack: 'mcl_nether_netherrack', nether_bricks: 'mcl_nether_nether_brick', red_nether_bricks: 'mcl_nether_red_nether_brick',
  cracked_nether_bricks: 'mcl_nether_cracked_nether_bricks', chiseled_nether_bricks: 'mcl_nether_chiseled_nether_bricks',
  soul_sand: 'mcl_nether_soul_sand', soul_soil: 'mcl_blackstone_soul_soil', magma_block: 'mcl_nether_magma',
  nether_quartz_ore: 'mcl_nether_quartz_ore', nether_gold_ore: 'mcl_nether_gold_ore', quartz_block_side: 'mcl_nether_quartz_block_side',
  quartz_block_top: 'mcl_nether_quartz_block_top', quartz_block_bottom: 'mcl_nether_quartz_block_bottom',
  quartz_pillar: 'mcl_nether_quartz_pillar_side', quartz_pillar_top: 'mcl_nether_quartz_pillar_top',
  chiseled_quartz_block: 'mcl_nether_quartz_chiseled_side', chiseled_quartz_block_top: 'mcl_nether_quartz_chiseled_top',
  nether_wart0: 'mcl_nether_nether_wart_stage_0', nether_wart1: 'mcl_nether_nether_wart_stage_1', nether_wart2: 'mcl_nether_nether_wart_stage_2',
  basalt_side: 'mcl_blackstone_basalt_side', basalt_top: 'mcl_blackstone_basalt_top', blackstone: 'mcl_blackstone_side',
  blackstone_top: 'mcl_blackstone_top', nether_portal: 'mcl_portals_portal', fire: 'fire_basic_flame_animated',
  crimson_stem: 'crimson_hyphae_side', crimson_stem_top: 'crimson_hyphae', warped_stem: 'warped_hyphae_side', warped_stem_top: 'warped_hyphae',
  crimson_planks: 'crimson_hyphae_wood', warped_planks: 'warped_hyphae_wood', crimson_nylium: 'crimson_nylium', warped_nylium: 'warped_nylium',
  crimson_nylium_side: 'crimson_nylium_side', warped_nylium_side: 'warped_nylium_side', nether_wart_block: 'nether_wart_block',
  warped_wart_block: 'warped_wart_block', shroomlight: 'shroomlight', crimson_roots: 'crimson_roots', warped_roots: 'warped_roots',
  crimson_fungus: 'farming_crimson_fungus', warped_fungus: 'farming_warped_fungus', nether_sprouts: 'nether_sprouts',
  weeping_vines: 'mcl_crimson_weeping_vines', twisting_vines: 'twisting_vines_plant',
});
Object.assign(T.item, {
  quartz: 'mcl_nether_quartz', nether_brick: 'mcl_nether_netherbrick', nether_wart: 'mcl_nether_nether_wart',
  blaze_rod: 'mcl_mobitems_blaze_rod', blaze_powder: 'mcl_mobitems_blaze_powder', ghast_tear: 'mcl_mobitems_ghast_tear',
  magma_cream: 'mcl_mobitems_magma_cream', fire_charge: 'mcl_fire_fire_charge',
});
Object.assign(T.entity, {
  zombified_piglin: 'extra_mobs_zombified_piglin', ghast: 'mobs_mc_ghast', ghast_shooting: 'mobs_mc_ghast_firing', blaze: 'mobs_mc_blaze',
  magma_cube: 'mobs_mc_magmacube', wither_skeleton: 'mobs_mc_wither_skeleton', fireball: 'mcl_fire_fire_charge',
});
T.env.portal_particle = 'mcl_particles_nether_portal';
// brewing and potions
Object.assign(T.block, { brewing_stand: 'mcl_brewing_stand', brewing_rack: 'mcl_brewing_rack', brewing_rack_bottle: 'mcl_brewing_rack_bottle' });
Object.assign(T.item, {
  glass_bottle: 'mcl_potions_potion_bottle', potion_overlay: 'mcl_potions_potion_overlay', splash_potion: 'mcl_potions_splash_bottle',
  splash_overlay: 'mcl_potions_splash_overlay', fermented_spider_eye: 'mcl_potions_spider_eye_fermented',
  glistering_melon_slice: 'mcl_potions_melon_speckled', golden_carrot: 'farming_carrot_gold', brewing_stand: 'mcl_brewing_stand_inv',
});
Object.assign(T.gui, {
  brew_bubbles: 'mcl_brewing_bubbles', brew_bubbles_on: 'mcl_brewing_bubbles_active', brew_burner: 'mcl_brewing_burner',
  brew_burner_on: 'mcl_brewing_burner_active', slot_bottle: 'mcl_brewing_bottle_bg', slot_fuel: 'mcl_brewing_fuel_bg',
  effect_absorb: 'mcl_potions_icon_absorb',
});
for (const e of ['swift', 'slow', 'strong', 'weak', 'leaping', 'regenerating', 'fire_proof', 'water_breathing', 'night_vision', 'invisible', 'poisoned', 'withering', 'food_poisoning']) T.gui['effect_' + e] = 'mcl_potions_effect_' + e;
Object.assign(T.env, { effect: 'mcl_particles_effect', instant_effect: 'mcl_particles_instant_effect', droplet: 'mcl_particles_droplet_bottle' });
T.entity.witch = 'mobs_mc_witch';
// the End
Object.assign(T.block, {
  end_stone: 'mcl_end_end_stone', end_stone_bricks: 'mcl_end_end_bricks', end_portal_frame_top: 'mcl_portals_endframe_top',
  end_portal_frame_side: 'mcl_portals_endframe_side', end_portal_frame_bottom: 'mcl_portals_endframe_bottom', end_portal_frame_eye: 'mcl_portals_endframe_eye',
  end_portal: 'mcl_portals_end_portal', dragon_egg: 'mcl_end_dragon_egg', purpur_block: 'mcl_end_purpur_block', purpur_pillar: 'mcl_end_purpur_pillar',
  purpur_pillar_top: 'mcl_end_purpur_pillar_top', end_rod: 'mcl_end_end_rod_side', end_rod_top: 'mcl_end_end_rod_top',
  chorus_plant: 'mcl_end_chorus_plant', chorus_flower: 'mcl_end_chorus_flower', chorus_flower_dead: 'mcl_end_chorus_flower_dead',
});
Object.assign(T.item, { ender_eye: 'mcl_end_ender_eye', chorus_fruit: 'mcl_end_chorus_fruit', popped_chorus_fruit: 'mcl_end_chorus_fruit_popped', end_crystal: 'mcl_end_crystal_item' });
Object.assign(T.entity, { ender_dragon: 'mobs_mc_dragon', dragon_fireball: 'mobs_mc_dragon_fireball', end_crystal: 'mcl_end_crystal', silverfish: 'mobs_mc_silverfish', endermite: 'mobs_mc_endermite' });
Object.assign(T.env, { end_sky: 'mcl_playerplus_end_sky', crystal_beam: 'mcl_end_crystal_beam', teleport: 'mcl_particles_teleport', dragon_breath: 'mcl_particles_dragon_breath_2' });
// crop stages
for (let i = 0; i < 8; i++) T.block['wheat' + i] = 'mcl_farming_wheat_stage_' + i;
for (let i = 0; i < 4; i++) T.block['potatoes' + i] = 'mcl_farming_potatoes_stage_' + i;
for (let i = 0; i < 4; i++) T.block['carrots' + i] = 'farming_carrot_' + (i + 1);

let nTex = 0;
for (const [cat, map] of Object.entries(T)) {
  const dir = path.join(OUT, 'textures', cat);
  fs.mkdirSync(dir, { recursive: true });
  for (const [dest, src] of Object.entries(map)) {
    // re-encode as plain 8-bit RGBA: some palette PNGs upset browser decoders
    const png = PNG.sync.read(fs.readFileSync(find(src + '.png')));
    fs.writeFileSync(path.join(dir, dest + '.png'), PNG.sync.write(png, { colorType: 6 }));
    nTex++;
  }
}
// big source images shrunk to what the game needs (box filter)
for (const [dest, size] of [['env/end_sky', 128]]) {
  const f = path.join(OUT, 'textures', dest + '.png');
  const src = PNG.sync.read(fs.readFileSync(f));
  const k = src.width / size, out = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const o = ((y * k + j) * src.width + x * k + i) * 4;
      for (let c = 0; c < 4; c++) acc[c] += src.data[o + c];
    }
    for (let c = 0; c < 4; c++) out.data[(y * size + x) * 4 + c] = Math.round(acc[c] / (k * k));
  }
  fs.writeFileSync(f, PNG.sync.write(out, { colorType: 6 }));
}
// side textures with see-through bottoms are laid over their base block
for (const [dest, base] of [['crimson_nylium_side', 'netherrack'], ['warped_nylium_side', 'netherrack']]) {
  const f = path.join(OUT, 'textures/block', dest + '.png');
  const top = PNG.sync.read(fs.readFileSync(f)), under = PNG.sync.read(fs.readFileSync(path.join(OUT, 'textures/block', base + '.png')));
  for (let i = 0; i < top.data.length; i += 4) {
    const a = top.data[i + 3] / 255;
    for (let k = 0; k < 3; k++) top.data[i + k] = Math.round(top.data[i + k] * a + under.data[i + k] * (1 - a));
    top.data[i + 3] = 255;
  }
  fs.writeFileSync(f, PNG.sync.write(top, { colorType: 6 }));
}

// ------------------------------------------------------------------ sounds
// dest name -> source basename(s); several sources become name.1, name.2...
const S = {
  'dig.grass': ['default_grass_footstep.1', 'default_grass_footstep.2', 'default_grass_footstep.3'],
  'dig.dirt': ['default_dig_crumbly', 'default_dirt_footstep.1', 'default_dirt_footstep.2'],
  'dig.stone': ['default_dig_cracky.1', 'default_dig_cracky.2', 'default_dig_cracky.3'],
  'dig.wood': ['default_dig_choppy.1', 'default_dig_choppy.2', 'default_dig_choppy.3'],
  'dig.gravel': ['default_gravel_dig.1', 'default_gravel_dig.2'],
  'dig.sand': ['default_sand_footstep.1', 'default_sand_footstep.2', 'default_sand_footstep.3'],
  'dig.snow': ['pedology_snow_soft_footstep.1', 'pedology_snow_soft_footstep.2', 'pedology_snow_soft_footstep.3'],
  'dig.glass': ['default_break_glass.1', 'default_break_glass.2', 'default_break_glass.3'],
  'dig.ice': ['default_ice_dig.1', 'default_ice_dig.2', 'default_ice_dig.3'],
  'dig.metal': ['default_dig_metal'],
  'dig.plant': ['default_dig_snappy'],
  'dig.cloth': ['default_dig_oddly_breakable_by_hand'],
  'dug.node': ['default_dug_node.1', 'default_dug_node.2'],
  'dug.gravel': ['default_gravel_dug.1', 'default_gravel_dug.2', 'default_gravel_dug.3'],
  'dug.ice': ['default_ice_dug'],
  'dug.metal': ['default_dug_metal.1', 'default_dug_metal.2'],
  'step.grass': ['default_grass_footstep.1', 'default_grass_footstep.2', 'default_grass_footstep.3'],
  'step.dirt': ['default_dirt_footstep.1', 'default_dirt_footstep.2'],
  'step.gravel': ['default_gravel_footstep.1', 'default_gravel_footstep.2', 'default_gravel_footstep.3', 'default_gravel_footstep.4'],
  'step.stone': ['default_hard_footstep.1', 'default_hard_footstep.2', 'default_hard_footstep.3'],
  'step.wood': ['default_wood_footstep.1', 'default_wood_footstep.2'],
  'step.sand': ['default_sand_footstep.1', 'default_sand_footstep.2', 'default_sand_footstep.3'],
  'step.snow': ['pedology_snow_soft_footstep.1', 'pedology_snow_soft_footstep.2', 'pedology_snow_soft_footstep.3', 'pedology_snow_soft_footstep.4'],
  'step.glass': ['default_glass_footstep'],
  'step.water': ['default_water_footstep.1', 'default_water_footstep.2', 'default_water_footstep.3'],
  'step.ice': ['default_ice_footstep.1', 'default_ice_footstep.2', 'default_ice_footstep.3'],
  'step.metal': ['default_metal_footstep.1', 'default_metal_footstep.2', 'default_metal_footstep.3'],
  'place.node': ['default_place_node.1', 'default_place_node.2', 'default_place_node.3'],
  'place.hard': ['default_place_node_hard.1', 'default_place_node_hard.2'],
  'place.metal': ['default_place_node_metal.1', 'default_place_node_metal.2'],
  'place.lava': ['default_place_node_lava'],
  'place.water': ['mcl_sounds_place_node_water'],
  'dug.water': ['mcl_sounds_dug_water'],
  'player.hurt': ['player_damage'],
  'player.fall': ['player_falling_damage'],
  'player.eat': ['mcl_hunger_bite', 'mcl_hunger_eat'],
  'player.drink': ['survival_thirst_drink'],
  'player.splash': ['watersplash'],
  'xp.orb': ['mcl_experience'],
  'xp.levelup': ['mcl_experience_level_up'],
  'tool.break': ['default_tool_breaks'],
  'zombie.say': ['mobs_mc_zombie_growl'],
  'zombie.hurt': ['mobs_mc_zombie_hurt'],
  'zombie.death': ['mobs_mc_zombie_death'],
  'skeleton.say': ['mobs_mc_skeleton_random.1', 'mobs_mc_skeleton_random.2'],
  'skeleton.hurt': ['mobs_mc_skeleton_hurt'],
  'skeleton.death': ['mobs_mc_skeleton_death'],
  'creeper.fuse': ['mobs_mc_creeper_hurt'],
  'creeper.death': ['mobs_mc_creeper_death'],
  'spider.say': ['mobs_mc_spider_random'],
  'spider.hurt': ['mobs_mc_spider_hurt.1', 'mobs_mc_spider_hurt.2', 'mobs_mc_spider_hurt.3'],
  'spider.death': ['mobs_mc_spider_death'],
  'spider.attack': ['mobs_mc_spider_attack.1', 'mobs_mc_spider_attack.2'],
  'enderman.hurt': ['mobs_mc_enderman_hurt.1', 'mobs_mc_enderman_hurt.2', 'mobs_mc_enderman_hurt.3'],
  'enderman.death': ['mobs_mc_enderman_death'],
  'enderman.say': ['mobs_mc_enderman_random.1'],
  'pig.say': ['mobs_pig'],
  'pig.hurt': ['mobs_pig_angry'],
  'cow.say': ['mobs_mc_cow'],
  'cow.hurt': ['mobs_mc_cow_hurt'],
  'cow.milk': ['mobs_mc_cow_milk'],
  'sheep.say': ['mobs_sheep'],
  'chicken.say': ['mobs_mc_chicken_buck.1', 'mobs_mc_chicken_buck.2', 'mobs_mc_chicken_buck.3'],
  'chicken.hurt': ['mobs_mc_chicken_hurt'],
  'chicken.egg': ['mobs_mc_chicken_lay_egg'],
  'wolf.hurt': ['mobs_mc_wolf_hurt.1', 'mobs_mc_wolf_hurt.2'],
  'wolf.death': ['mobs_mc_wolf_death'],
  'animal.eat': ['mobs_mc_animal_eat_generic'],
  'tnt.explode': ['tnt_explode'],
  'tnt.ignite': ['tnt_ignite'],
  'bow.shoot': ['mcl_bows_bow_shoot'],
  'bow.hit': ['mcl_bows_hit_other'],
  'bow.hitplayer': ['mcl_bows_hit_player'],
  'chest.open': ['default_chest_open'],
  'chest.close': ['default_chest_close'],
  'door.open': ['doors_door_open'],
  'door.close': ['doors_door_close'],
  'fire.ignite': ['fire_flint_and_steel'],
  'fire.extinguish': ['fire_extinguish_flame.1'],
  'weather.rain': ['weather_rain'],
  'weather.thunder': ['lightning_thunder.1', 'lightning_thunder.2', 'lightning_thunder.3'],
  'armor.equip': ['mcl_armor_equip_leather'],
  'throw': ['mcl_throwing_throw'],
  'item.pickup': ['item_drop_pickup'],
  'item.burn': ['builtin_item_lava'],
  'enchant': ['mcl_enchanting_enchant.0', 'mcl_enchanting_enchant.1', 'mcl_enchanting_enchant.2'],
  'button.click': ['mesecons_button_push'],
  'button.wood': ['mesecons_button_push_wood'],
  'piston.out': ['piston_extend'],
  'piston.in': ['piston_retract'],
  'fishing.cast': ['watersplash'],
  'fishing.bite': ['bloop'],
  'fishing.reel': ['reel'],
  'portal.travel': ['mcl_portals_teleport'],
  'portal.end_open': ['mcl_portals_open_end_portal'],
  'portal.eye': ['mcl_portals_place_frame_eye_1', 'mcl_portals_place_frame_eye_2', 'mcl_portals_place_frame_eye_3'],
  'bottle.fill': ['mcl_potions_bottle_fill'],
  'bottle.pour': ['mcl_potions_bottle_pour'],
  'potion.break': ['mcl_potions_breaking_glass'],
  'potion.drink': ['mcl_potions_drinking'],
  'brewing.done': ['mcl_brewing_complete'],
  'end.teleport': ['mcl_end_teleport'],
  'enderman.teleport': ['mobs_mc_enderman_teleport_src'],
  'villager.say': ['mobs_mc_villager.1', 'mobs_mc_villager.2', 'mobs_mc_villager.3', 'mobs_mc_villager.4'],
  'villager.hurt': ['mobs_mc_villager_hurt.1', 'mobs_mc_villager_hurt.2'],
  'villager.yes': ['mobs_mc_villager_accept.1', 'mobs_mc_villager_accept.2'],
  'villager.trade': ['mobs_mc_villager_trade.1', 'mobs_mc_villager_trade.2', 'mobs_mc_villager_trade.3'],
  'golem.hurt': ['mobs_mc_iron_golem_hurt'],
  'ghast.say': ['mobs_mc_ghast_hurt.1'],
  'ghast.hurt': ['mobs_mc_ghast_hurt.2'],
  'ghast.death': ['mobs_mc_ghast_dying'],
  'ghast.shoot': ['mobs_mc_ghast_shot.1', 'mobs_mc_ghast_shot.2'],
  'fireball': ['mobs_fireball'],
  'blaze.breath': ['mobs_mc_blaze_breath'],
  'blaze.hurt': ['mobs_mc_blaze_hurt'],
  'blaze.death': ['mobs_mc_blaze_died'],
  'magma.say': ['mobs_mc_magma_cube_small'],
  'magma.big': ['mobs_mc_magma_cube_big'],
  'piglin.say': ['mobs_mc_zombiepig_random.1'],
  'piglin.hurt': ['mobs_mc_zombiepig_hurt.1', 'mobs_mc_zombiepig_hurt.2'],
  'piglin.death': ['mobs_mc_zombiepig_death.1', 'mobs_mc_zombiepig_death.2'],
  'piglin.angry': ['mobs_mc_zombiepig_war_cry.1'],
  'slime.jump': ['green_slime_jump'],
  'slime.hurt': ['green_slime_damage'],
  'slime.death': ['green_slime_death'],
  'slime.attack': ['green_slime_attack'],
  'magma.attack': ['mobs_mc_magma_cube_attack'],
  'fire.crackle': ['fire_fire.1', 'fire_fire.2', 'fire_fire.3'],
  'silverfish.say': ['mobs_mc_silverfish_idle'],
  'silverfish.hurt': ['mobs_mc_silverfish_hurt'],
  'silverfish.death': ['mobs_mc_silverfish_death'],
  'dragon.growl': ['mobs_mc_ender_dragon_attack'],
  'dragon.shoot': ['mobs_mc_ender_dragon_shoot'],
};

const sdir = path.join(OUT, 'sounds');
fs.mkdirSync(sdir, { recursive: true });
let nSnd = 0;
for (const [dest, list] of Object.entries(S)) {
  list.forEach((src, i) => {
    let file;
    try { file = find(src + '.ogg'); } catch (e) { console.warn('  (skip) ' + e.message); return; }
    const out = path.join(sdir, list.length > 1 ? `${dest}.${i + 1}.mp3` : `${dest}.mp3`);
    // trim long ambience, mono 22kHz 48kbps keeps the whole set small
    const max = dest === 'weather.rain' ? ['-t', '12'] : dest.startsWith('weather.thunder') ? ['-t', '6'] : ['-t', '4'];
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, ...max, '-ac', '1', '-ar', '22050', '-b:a', '48k', out]);
    nSnd++;
  });
}

// --------------------------------------------------------------- licences
const ldir = path.join(OUT, 'licenses');
fs.mkdirSync(ldir, { recursive: true });
const lic = {
  'mineclonia-LEGAL.md': path.join(SRC, 'LEGAL.md'),
  'mineclonia-CREDITS.md': path.join(SRC, 'CREDITS.md'),
  'mcl_sounds-README.txt': path.join(SRC, 'mods/CORE/mcl_sounds/README.txt'),
  'mobs_mc-LICENSE-media.md': path.join(SRC, 'mods/ENTITIES/mobs_mc/LICENSE-media.md'),
  'mcl_tnt-README.md': path.join(SRC, 'mods/ITEMS/mcl_tnt/README.md'),
  'mcl_hunger-README.md': path.join(SRC, 'mods/PLAYER/mcl_hunger/README.md'),
  'mcl_bows-README.md': path.join(SRC, 'mods/ITEMS/mcl_bows/README.md'),
  'mcl_doors-README.md': path.join(SRC, 'mods/ITEMS/mcl_doors/README.md'),
  'mcl_weather-README.md': path.join(SRC, 'mods/ENVIRONMENT/mcl_weather/README.md'),
  'mcl_lightning-README.md': path.join(SRC, 'mods/ENVIRONMENT/mcl_lightning/README.md'),
  'mcl_fire-README.md': path.join(SRC, 'mods/ITEMS/mcl_fire/README.md'),
  'mcl_throwing-README.md': path.join(SRC, 'mods/ITEMS/mcl_throwing/README.md'),
  'mcl_item_entity-README.md': path.join(SRC, 'mods/ENTITIES/mcl_item_entity/README.txt'),
  'mcl_fishing-README.md': path.join(SRC, 'mods/ITEMS/mcl_fishing/README.md'),
  'mcl_enchanting-sounds-attributions.txt': path.join(SRC, 'mods/ITEMS/mcl_enchanting/sounds/attributions.txt'),
  'mcl_portals-README.md': path.join(SRC, 'mods/ITEMS/mcl_portals/README.md'),
  'mcl_potions-README.md': path.join(SRC, 'mods/ITEMS/mcl_potions/README.md'),
  'mcl_fishing-media-README.md': path.join(SRC, 'mods/ITEMS/mcl_fishing/README.md'),
  'REDSTONE-LICENSE.txt': path.join(SRC, 'mods/ITEMS/REDSTONE/LICENSE.txt'),
};
for (const [d, s] of Object.entries(lic)) if (fs.existsSync(s)) fs.copyFileSync(s, path.join(ldir, d));

console.log(`imported ${nTex} textures and ${nSnd} sounds into ${OUT}`);
