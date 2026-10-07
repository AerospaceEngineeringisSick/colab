// Natural mob spawning and despawning.
import { BLOCKS, B, OPAQUE, LIQUID } from '../shared/blocks.js';
import { BI } from '../shared/biomes.js';
import { WH } from '../shared/constants.js';
import { hash2 } from '../shared/noise.js';

// [mob, weight, min pack, max pack]
const NETHER = {
  [BI.NETHER_WASTES]: [['zombified_piglin', 100, 2, 4], ['ghast', 50, 1, 1], ['magma_cube', 4, 1, 3], ['enderman', 1, 1, 2]],
  [BI.CRIMSON_FOREST]: [['zombified_piglin', 40, 2, 4], ['magma_cube', 4, 1, 2]],
  [BI.WARPED_FOREST]: [['enderman', 1, 1, 3]],
  [BI.SOUL_SAND_VALLEY]: [['skeleton', 20, 2, 4], ['ghast', 50, 1, 1], ['enderman', 1, 1, 2]],
};
const FORTRESS = [['blaze', 10, 2, 3], ['zombified_piglin', 5, 2, 4], ['wither_skeleton', 8, 2, 4], ['skeleton', 2, 1, 3], ['magma_cube', 3, 1, 3]];
const pickW = (list) => {
  let t = 0;
  for (const e of list) t += e[1];
  let x = Math.random() * t;
  for (const e of list) { x -= e[1]; if (x <= 0) return e; }
  return list[0];
};

const HOSTILE = [['zombie', 95], ['skeleton', 100], ['creeper', 100], ['spider', 100], ['enderman', 10], ['witch', 5]];
const totalW = HOSTILE.reduce((s, h) => s + h[1], 0);

export class Spawner {
  constructor(game) { this.game = game; this.passiveTimer = 0; }

  pickHostile() {
    let r = Math.random() * totalW;
    for (const [n, w] of HOSTILE) { r -= w; if (r <= 0) return n; }
    return 'zombie';
  }

  tick() {
    const g = this.game, p = g.player;
    const mobs = g.entities.mobs();
    // despawn
    for (const m of mobs) {
      if (m.dead) continue;
      if (g.difficulty === 0 && m.def.hostile) { m.remove(); continue; }
      if (m.persistent) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y, m.z - p.z);
      if (d > 128) m.remove();
      else if (d > 32 && Math.random() < 1 / 40) m.remove();
    }
    if (p.dead) return;
    const w = g.world;
    // the Nether has its own creatures
    if (g.dim === 'nether') {
      if (g.difficulty > 0 && g.settings.spawnMobs !== false) this.netherTick(mobs);
      return;
    }
    // hostile spawning
    if (g.difficulty > 0 && g.settings.spawnMobs !== false) {
      const hostiles = mobs.filter((m) => m.def.hostile && !m.dead).length;
      const cap = Math.min(30, 10 + w.renderDistance * 2);
      for (let attempt = 0; attempt < 3 && hostiles < cap; attempt++) {
        const ang = Math.random() * Math.PI * 2, dist = 24 + Math.random() * 40;
        const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
        if (!w.isLoaded(x, z)) continue;
        const top = w.topY(x, z);
        const y = 1 + Math.floor(Math.random() * Math.min(WH - 2, top + 1));
        let type = this.pickHostile();
        // slimes: in swamps at night, and deep underground in slime chunks
        const bio = w.biomeAt(x, z).id;
        if ((bio === BI.SWAMP && y > 50 && y < 70 && !g.isDay() && Math.random() < 0.3) || (y < 40 && hash2(x >> 4, z >> 4, g.meta.seed ^ 0x51) < 0.1 && Math.random() < 0.3)) type = 'slime';
        const packN = 1 + Math.floor(Math.random() * 4);
        let n = 0;
        for (let k = 0; k < packN * 3 && n < packN; k++) {
          const sx = x + Math.floor(Math.random() * 7) - 3, sz = z + Math.floor(Math.random() * 7) - 3;
          if (!this.canSpawnHostile(sx, y, sz, type)) continue;
          if (Math.hypot(sx - p.x, y - p.y, sz - p.z) < 24) continue;
          g.spawnMob(type, sx + 0.5, y, sz + 0.5);
          n++;
        }
      }
    }
    // passive animals, rarely, in daylight on grass
    if (++this.passiveTimer >= 20) {
      this.passiveTimer = 0;
      const animals = mobs.filter((m) => m.def.passive && Math.hypot(m.x - p.x, m.z - p.z) < 96).length;
      if (animals < 12 && g.settings.spawnAnimals !== false) {
        const ang = Math.random() * Math.PI * 2, dist = 32 + Math.random() * 40;
        const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
        if (!w.isLoaded(x, z)) return;
        const y = w.topY(x, z);
        if (w.getId(x, y, z) !== B.grass_block || w.getId(x, y + 1, z) !== 0) return;
        if ((w.getLight(x, y + 1, z) >> 4) < 9) return;
        const bio = w.biomeAt(x, z).id;
        let types = ['cow', 'pig', 'sheep', 'chicken'];
        if (bio === BI.TAIGA || bio === BI.FOREST || bio === BI.SNOWY_TAIGA) types = types.concat(['wolf']);
        if (bio === BI.SNOWY_PLAINS) types = ['sheep'];
        const type = types[Math.floor(Math.random() * types.length)];
        const n = type === 'wolf' ? 3 : 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const sx = x + Math.floor(Math.random() * 5) - 2, sz = z + Math.floor(Math.random() * 5) - 2;
          const sy = w.topY(sx, sz);
          if (w.getId(sx, sy, sz) !== B.grass_block) continue;
          g.spawnMob(type, sx + 0.5, sy + 1, sz + 0.5, { persistent: true });
        }
      }
    }
  }

  netherTick(mobs) {
    const g = this.game, p = g.player, w = g.world;
    const hostiles = mobs.filter((m) => m.def.hostile || m.def.piglin).length;
    const cap = Math.min(40, 14 + w.renderDistance * 2);
    for (let attempt = 0; attempt < 4 && hostiles < cap; attempt++) {
      const ang = Math.random() * Math.PI * 2, dist = 24 + Math.random() * 40;
      const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
      if (!w.isLoaded(x, z)) continue;
      // drop from a random height to the floor beneath
      let y = 8 + Math.floor(Math.random() * 112);
      for (let k = 0; k < 24 && y > 2 && !(OPAQUE[w.getId(x, y - 1, z)] && w.getId(x, y, z) === 0); k++) y--;
      if (!OPAQUE[w.getId(x, y - 1, z)] || w.getId(x, y, z) !== 0) continue;
      const fort = g.netherGen.inFortress(x, y, z);
      const [type, , lo, hi] = pickW(fort && Math.random() < 0.8 ? FORTRESS : (NETHER[w.biomeAt(x, z).id] || NETHER[BI.NETHER_WASTES]));
      const packN = lo + Math.floor(Math.random() * (hi - lo + 1));
      let n = 0;
      for (let k = 0; k < packN * 3 && n < packN; k++) {
        const sx = x + Math.floor(Math.random() * 7) - 3, sz = z + Math.floor(Math.random() * 7) - 3;
        if (!this.canSpawnHostile(sx, y, sz, type)) continue;
        if (Math.hypot(sx - p.x, y - p.y, sz - p.z) < 24) continue;
        g.spawnMob(type, sx + 0.5, y, sz + 0.5);
        n++;
      }
    }
  }

  canSpawnHostile(x, y, z, type) {
    const g = this.game, w = g.world;
    const below = w.getId(x, y - 1, z);
    if (!OPAQUE[below] || below === B.bedrock || below === B.glass) return false;
    if (type === 'ghast') {
      // ghasts need a big pocket of air
      for (let dx = -2; dx <= 1; dx++) for (let dz = -2; dz <= 1; dz++) for (let dy = 0; dy < 4; dy++) if (w.getId(x + dx, y + dy, z + dz) !== 0) return false;
      return Math.random() < 0.3;
    }
    if (g.dim === 'nether') {
      // nether monsters only mind bright block light
      for (let i = 0; i < (type === 'enderman' ? 3 : type === 'wither_skeleton' ? 3 : 2); i++) { const id = w.getId(x, y + i, z); if (BLOCKS[id].solid || LIQUID[id]) return false; }
      return (w.getLight(x, y, z) & 15) <= 11 || type === 'zombified_piglin';
    }
    const h = type === 'enderman' ? 3 : 2;
    for (let i = 0; i < h; i++) {
      const id = w.getId(x, y + i, z);
      if (BLOCKS[id].solid || LIQUID[id]) return false;
    }
    if (type === 'spider') {
      // spiders are wide
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) if (BLOCKS[w.getId(x + dx, y, z + dz)].solid) return false;
    }
    const l = w.getLight(x, y, z);
    if ((l & 15) > 0) return false;
    const sky = Math.max(0, (l >> 4) - g.skyDarken());
    if (sky > Math.floor(Math.random() * 8)) return false;
    return true;
  }
}
