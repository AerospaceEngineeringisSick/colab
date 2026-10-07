export const CS = 16; // chunk width/depth
export const WH = 128; // world height
export const SEA = 62; // water fills up to and including this y
export const SECTIONS = WH / CS;
export const COL_SIZE = CS * CS * WH;

// block cell value: low 10 bits block id, high 6 bits state ("meta")
export const ID_MASK = 1023;
export const META_SHIFT = 10;
export const idOf = (v) => v & ID_MASK;
export const metaOf = (v) => v >>> META_SHIFT;
export const cell = (id, meta = 0) => id | (meta << META_SHIFT);

// local column index: y*256 + z*16 + x
export const idx = (x, y, z) => (y << 8) | (z << 4) | x;

// faces: 0 east +X, 1 west -X, 2 up +Y, 3 down -Y, 4 south +Z, 5 north -Z
export const DIRS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
export const OPPOSITE = [1, 0, 3, 2, 5, 4];

export const TICKS_PER_DAY = 24000;
export const ITEM_BASE = 1024; // ids below are block items
