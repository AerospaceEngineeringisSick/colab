// Biome table. Climate centres are in normalised temperature/humidity space (-1..1).
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

export const BIOMES = [
  { name: 'Ocean', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4 },
  { name: 'Plains', t: 0.05, h: -0.45, base: 3, amp: 3.5, grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, rain: 1 },
  { name: 'Forest', t: 0.15, h: 0.4, base: 5, amp: 7, grass: 0x79c05a, foliage: 0x59ae30, water: 0x3f76e4, rain: 1 },
  { name: 'Birch Forest', t: -0.05, h: 0.1, base: 5, amp: 6, grass: 0x88bb67, foliage: 0x6ba941, water: 0x3f76e4, rain: 1 },
  { name: 'Dark Forest', t: 0.1, h: 0.85, base: 5, amp: 6, grass: 0x507a32, foliage: 0x59ae30, water: 0x3f76e4, rain: 1 },
  { name: 'Taiga', t: -0.42, h: 0.2, base: 7, amp: 9, grass: 0x86b783, foliage: 0x68a464, water: 0x287082, rain: 1 },
  { name: 'Snowy Taiga', t: -0.82, h: 0.45, base: 6, amp: 8, grass: 0x80b497, foliage: 0x60a17b, water: 0x3d57d6, snow: 1 },
  { name: 'Snowy Plains', t: -0.85, h: -0.4, base: 4, amp: 4, grass: 0x80b497, foliage: 0x60a17b, water: 0x3938c9, snow: 1 },
  { name: 'Desert', t: 0.85, h: -0.75, base: 4, amp: 5, grass: 0xbfb755, foliage: 0xaea42a, water: 0x32a598, dry: 1 },
  { name: 'Savanna', t: 0.6, h: -0.25, base: 6, amp: 5, grass: 0xbfb755, foliage: 0xaea42a, water: 0x2c8b9c, dry: 1 },
  { name: 'Jungle', t: 0.8, h: 0.6, base: 6, amp: 11, grass: 0x59c93c, foliage: 0x30bb0b, water: 0x14a2c5, rain: 1 },
  { name: 'Swamp', t: 0.45, h: 0.8, base: 0.4, amp: 1.6, grass: 0x6a7039, foliage: 0x6a7039, water: 0x617b64, rain: 1 },
  { name: 'Mountains', grass: 0x8ab689, foliage: 0x6da36b, water: 0x3f76e4, rain: 1 },
  { name: 'Beach', grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, rain: 1 },
  { name: 'River', grass: 0x8eb971, foliage: 0x71a74d, water: 0x3f76e4, rain: 1 },
  { name: 'Frozen Ocean', grass: 0x80b497, foliage: 0x60a17b, water: 0x3938c9, snow: 1 },
  { name: 'Snowy Beach', grass: 0x80b497, foliage: 0x60a17b, water: 0x3d57d6, snow: 1 },
  { name: 'Frozen River', grass: 0x80b497, foliage: 0x60a17b, water: 0x3938c9, snow: 1 },
  { name: 'Snowy Mountains', grass: 0x80b497, foliage: 0x60a17b, water: 0x3938c9, snow: 1 },
];
BIOMES.forEach((b, i) => {
  b.id = i;
  b.grassRGB = hex(b.grass);
  b.foliageRGB = hex(b.foliage);
  b.waterRGB = hex(b.water);
});

export const BI = {};
for (const b of BIOMES) BI[b.name.replace(/ /g, '_').toUpperCase()] = b.id;

// land biomes that take part in climate blending
export const LAND = BIOMES.filter((b) => b.t !== undefined);
