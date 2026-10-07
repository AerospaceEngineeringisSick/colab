// Status effects, potions and brewing, after vanilla's tables. Durations are in ticks.

// effect -> display name, colour (for potions and particles), HUD icon, beneficial?
export const EFFECTS = {
  speed: { name: 'Speed', color: 0x7cafc6, icon: 'swift', good: true },
  slowness: { name: 'Slowness', color: 0x5a6c81, icon: 'slow' },
  strength: { name: 'Strength', color: 0x932423, icon: 'strong', good: true },
  weakness: { name: 'Weakness', color: 0x484d48, icon: 'weak' },
  instant_health: { name: 'Instant Health', color: 0xf82423, instant: true, good: true },
  instant_damage: { name: 'Instant Damage', color: 0x430a09, instant: true },
  jump_boost: { name: 'Jump Boost', color: 0x22ff4c, icon: 'leaping', good: true },
  regeneration: { name: 'Regeneration', color: 0xcd5cab, icon: 'regenerating', good: true },
  fire_resistance: { name: 'Fire Resistance', color: 0xe49a3a, icon: 'fire_proof', good: true },
  water_breathing: { name: 'Water Breathing', color: 0x2e5299, icon: 'water_breathing', good: true },
  night_vision: { name: 'Night Vision', color: 0x1f1fa1, icon: 'night_vision', good: true },
  invisibility: { name: 'Invisibility', color: 0x7f8392, icon: 'invisible', good: true },
  poison: { name: 'Poison', color: 0x4e9331, icon: 'poisoned' },
  wither: { name: 'Wither', color: 0x352a27, icon: 'withering' },
  hunger: { name: 'Hunger', color: 0x587653, icon: 'food_poisoning' },
  absorption: { name: 'Absorption', color: 0x2552a5, icon: 'absorb', good: true },
};

const P = (effect, ticks, amp = 0) => [effect, ticks, amp];
// potion -> { name, effects }
export const POTIONS = {
  water: { name: 'Water Bottle', effects: [], color: 0x385dc6 },
  awkward: { name: 'Awkward Potion', effects: [], color: 0x385dc6 },
  mundane: { name: 'Mundane Potion', effects: [], color: 0x385dc6 },
  thick: { name: 'Thick Potion', effects: [], color: 0x385dc6 },
  swiftness: { effects: [P('speed', 3600)] }, long_swiftness: { effects: [P('speed', 9600)] }, strong_swiftness: { effects: [P('speed', 1800, 1)] },
  slowness: { effects: [P('slowness', 1800)] }, long_slowness: { effects: [P('slowness', 4800)] }, strong_slowness: { effects: [P('slowness', 400, 3)] },
  strength: { effects: [P('strength', 3600)] }, long_strength: { effects: [P('strength', 9600)] }, strong_strength: { effects: [P('strength', 1800, 1)] },
  weakness: { effects: [P('weakness', 1800)] }, long_weakness: { effects: [P('weakness', 4800)] },
  healing: { effects: [P('instant_health', 1)] }, strong_healing: { effects: [P('instant_health', 1, 1)] },
  harming: { effects: [P('instant_damage', 1)] }, strong_harming: { effects: [P('instant_damage', 1, 1)] },
  poison: { effects: [P('poison', 900)] }, long_poison: { effects: [P('poison', 1800)] }, strong_poison: { effects: [P('poison', 432, 1)] },
  regeneration: { effects: [P('regeneration', 900)] }, long_regeneration: { effects: [P('regeneration', 1800)] }, strong_regeneration: { effects: [P('regeneration', 450, 1)] },
  fire_resistance: { effects: [P('fire_resistance', 3600)] }, long_fire_resistance: { effects: [P('fire_resistance', 9600)] },
  water_breathing: { effects: [P('water_breathing', 3600)] }, long_water_breathing: { effects: [P('water_breathing', 9600)] },
  night_vision: { effects: [P('night_vision', 3600)] }, long_night_vision: { effects: [P('night_vision', 9600)] },
  invisibility: { effects: [P('invisibility', 3600)] }, long_invisibility: { effects: [P('invisibility', 9600)] },
  leaping: { effects: [P('jump_boost', 3600)] }, long_leaping: { effects: [P('jump_boost', 9600)] }, strong_leaping: { effects: [P('jump_boost', 1800, 1)] },
};
const ROMAN = ['', ' II', ' III', ' IV', ' V'];
for (const [k, p] of Object.entries(POTIONS)) {
  p.key = k;
  if (!p.name) {
    const e = EFFECTS[p.effects[0][0]];
    // vanilla names potions after the effect (Swiftness for Speed, Healing for Instant Health...)
    const base = k.replace(/^(long|strong)_/, '');
    p.name = 'Potion of ' + base.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    p.color = e.color;
  }
}

export const potionName = (key, splash) => {
  const p = POTIONS[key] || POTIONS.water;
  if (!splash) return p.name;
  return p.name.startsWith('Potion of') ? 'Splash ' + p.name : 'Splash ' + p.name.replace(' Bottle', ' Bottle');
};
// the tooltip lines: "Speed II (1:30)"
export const fmtTicks = (t) => { const s = Math.floor(t / 20); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const effectLine = (e, ticks, amp) => EFFECTS[e].name + ROMAN[amp] + (EFFECTS[e].instant ? '' : ` (${fmtTicks(ticks)})`);

// ------------------------------------------------------------------ brewing
// ingredient -> { from potion: to potion }
const AWKWARD = { sugar: 'swiftness', glistering_melon_slice: 'healing', spider_eye: 'poison', ghast_tear: 'regeneration', blaze_powder: 'strength',
  magma_cream: 'fire_resistance', pufferfish: 'water_breathing', golden_carrot: 'night_vision' };
const CORRUPT = { swiftness: 'slowness', long_swiftness: 'long_slowness', leaping: 'slowness', long_leaping: 'long_slowness', healing: 'harming',
  strong_healing: 'strong_harming', poison: 'harming', long_poison: 'harming', strong_poison: 'strong_harming', night_vision: 'invisibility',
  long_night_vision: 'long_invisibility', water: 'weakness' };
const MUNDANE = ['sugar', 'glistering_melon_slice', 'spider_eye', 'ghast_tear', 'blaze_powder', 'magma_cream', 'redstone'];
export const INGREDIENTS = new Set([...Object.keys(AWKWARD), 'nether_wart', 'redstone', 'glowstone_dust', 'fermented_spider_eye', 'gunpowder']);

// what a potion becomes with an ingredient (null: no reaction)
export function brewResult(potion, ingredient) {
  if (ingredient === 'nether_wart') return potion === 'water' ? 'awkward' : null;
  if (ingredient === 'fermented_spider_eye') return CORRUPT[potion] || null;
  if (potion === 'water') {
    if (ingredient === 'glowstone_dust') return 'thick';
    if (MUNDANE.includes(ingredient)) return 'mundane';
    return null;
  }
  if (potion === 'awkward') return AWKWARD[ingredient] || null;
  if (potion.startsWith('long_') || potion.startsWith('strong_')) {
    // redstone and glowstone swap between the two upgraded forms
    const base = potion.replace(/^(long|strong)_/, '');
    if (ingredient === 'redstone' && potion.startsWith('strong_') && POTIONS['long_' + base]) return 'long_' + base;
    if (ingredient === 'glowstone_dust' && potion.startsWith('long_') && POTIONS['strong_' + base]) return 'strong_' + base;
    return null;
  }
  if (ingredient === 'redstone' && POTIONS['long_' + potion]) return 'long_' + potion;
  if (ingredient === 'glowstone_dust' && POTIONS['strong_' + potion]) return 'strong_' + potion;
  return null;
}

// a potion's colour mixed from its effects (vanilla averages them)
export function potionColor(key) {
  const p = POTIONS[key];
  return p ? p.color : 0x385dc6;
}
