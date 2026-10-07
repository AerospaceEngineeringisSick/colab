// Worker: world generation, column lighting and section meshing.
import { WorldGen } from '../shared/worldgen.js';
import { computeColumnLight } from '../shared/light.js';
import { Mesher } from '../shared/mesher.js';
import { resolveBlockTextures } from '../shared/blocks.js';

let gen = null;
let mesher = null;

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      gen = new WorldGen(m.seed);
      resolveBlockTextures(m.tex);
      mesher = new Mesher(m.tex);
      mesher.fastLeaves = !!m.fastLeaves;
      break;
    case 'opts':
      if (mesher) { mesher.fastLeaves = !!m.fastLeaves; mesher.modelCache.clear(); }
      break;
    case 'gen': {
      const r = gen.generate(m.cx, m.cz);
      const light = computeColumnLight(r.blocks);
      self.postMessage({
        type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: r.blocks, light, biomes: r.biomes,
        tints: r.tints, tiles: r.tiles, spawns: r.spawns,
      }, [r.blocks.buffer, light.buffer, r.biomes.buffer, r.tints.grass.buffer, r.tints.foliage.buffer, r.tints.water.buffer]);
      break;
    }
    case 'load': {
      // a saved chunk: recompute biomes/tints from the seed, light from the blocks
      const r = gen.generateClimate ? null : null;
      void r;
      const light = computeColumnLight(m.blocks);
      const clim = climate(m.cx, m.cz);
      self.postMessage({
        type: 'gen', id: m.id, cx: m.cx, cz: m.cz, blocks: m.blocks, light, biomes: clim.biomes,
        tints: clim.tints, tiles: null, spawns: [], loaded: true,
      }, [m.blocks.buffer, light.buffer, clim.biomes.buffer, clim.tints.grass.buffer, clim.tints.foliage.buffer, clim.tints.water.buffer]);
      break;
    }
    case 'mesh': {
      const out = mesher.mesh(m.blocks, m.light, m.tints, m.ox, m.oy, m.oz);
      const transfer = [];
      for (const o of out) if (o) transfer.push(o.pos.buffer, o.tex.buffer, o.col.buffer, o.light.buffer, o.index.buffer);
      self.postMessage({ type: 'mesh', id: m.id, key: m.key, rev: m.rev, out }, transfer);
      break;
    }
  }
};

function climate(cx, cz) {
  const biomes = new Uint8Array(256);
  const grass = new Uint32Array(256), foliage = new Uint32Array(256), water = new Uint32Array(256);
  const col = {};
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    gen.column(cx * 16 + x, cz * 16 + z, col);
    const i = z * 16 + x;
    biomes[i] = col.biome; grass[i] = col.grass; foliage[i] = col.foliage; water[i] = col.water;
  }
  return { biomes, tints: { grass, foliage, water } };
}
