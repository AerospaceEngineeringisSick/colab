// Natural mob spawning and despawning.
import { BLOCKS, B, OPAQUE, LIQUID } from '../shared/blocks.js';
import { BI } from '../shared/biomes.js';
import { WH } from '../shared/constants.js';

const HOSTILE = [['zombie', 95], ['skeleton', 100], ['creeper', 100], ['spider', 100], ['enderman', 10]];
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
        const type = this.pickHostile();
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

  canSpawnHostile(x, y, z, type) {
    const g = this.game, w = g.world;
    const below = w.getId(x, y - 1, z);
    if (!OPAQUE[below] || below === B.bedrock || below === B.glass) return false;
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
