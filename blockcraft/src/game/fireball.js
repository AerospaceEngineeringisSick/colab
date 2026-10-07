// Fireballs: ghasts lob big ones that explode, blazes spit small ones that set things alight.
// Like vanilla they fly in a straight line, speeding up along their aim, and a big one can be punched back.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { raycast } from './raycast.js';
import { imageTexture } from '../engine/textures.js';

// distance along a ray to an entity's (padded) box, or null
function segBox(ox, oy, oz, dx, dy, dz, e, pad) {
  const hw = e.w / 2 + pad;
  const lo = [e.x - hw, e.y - pad, e.z - hw], hi = [e.x + hw, e.y + e.h + pad, e.z + hw];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
    let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

export class Fireball extends Entity {
  constructor(game, x, y, z, dx, dy, dz, owner, small = false) {
    super(game, x, y, z);
    this.type = 'fireball';
    this.owner = owner;
    this.small = small;
    this.w = this.h = small ? 0.3125 : 1;
    this.def = { name: 'fireball' };
    this.aim(dx, dy, dz);
    this.vx = this.ax; this.vy = this.ay; this.vz = this.az;
  }

  aim(dx, dy, dz) {
    const l = Math.hypot(dx, dy, dz) || 1;
    this.ax = dx / l * 0.1; this.ay = dy / l * 0.1; this.az = dz / l * 0.1;
  }

  // the player can bat a big fireball back where they're looking
  get deflectable() { return !this.small; }
  hurt(dmg, source) {
    if (this.small || !source || source !== this.game.player) return false;
    const d = source.lookDir();
    this.aim(d[0], d[1], d[2]);
    this.vx = this.ax * 3; this.vy = this.ay * 3; this.vz = this.az * 3;
    this.owner = source;
    return true;
  }

  tick() {
    super.tick();
    const g = this.game, w = this.world;
    this.vx = (this.vx + this.ax) * 0.95; this.vy = (this.vy + this.ay) * 0.95; this.vz = (this.vz + this.az) * 0.95;
    const sp = Math.hypot(this.vx, this.vy, this.vz) || 1e-6;
    const dx = this.vx / sp, dy = this.vy / sp, dz = this.vz / sp;
    const cy = this.y + this.h / 2;
    const hit = raycast(w, this.x, cy, this.z, dx, dy, dz, sp);
    let ent = null, tb = hit ? hit.dist : sp;
    const cands = g.entities.mobsNear(this.x, cy, this.z, sp + 4);
    const p = g.player;
    if (!p.dead && p.mode !== 'spectator') cands.push(p);
    for (const e of cands) {
      if (e === this.owner || (this.small && e.def && e.def.blaze)) continue;
      const t = segBox(this.x, cy, this.z, dx, dy, dz, e, this.w / 2);
      if (t !== null && t < tb) { tb = t; ent = e; }
    }
    if (ent || hit) {
      this.impact(this.x + dx * tb, cy + dy * tb, this.z + dz * tb, ent, hit);
      this.remove();
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    if (this.age % 2 === 0) g.particles.smoke(this.x, this.y + this.h / 2, this.z, 1, this.small ? 0.2 : 0.5, 0.25);
    if (this.age > 300 || this.y < -10 || this.y > 300) this.remove();
  }

  impact(x, y, z, ent, hit) {
    const g = this.game, p = g.player;
    if (this.small) {
      if (ent) {
        if (!(ent.def && ent.def.fireImmune)) {
          if (ent === p) { if (p.damage(5, 'fireball', false, this.owner) > 0) p.fire = Math.max(p.fire, 100); }
          else if (ent.hurt(5, this.owner, x, z, 'fireball')) ent.fire = Math.max(ent.fire || 0, 100);
        }
      } else if (hit) {
        const f = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][hit.face];
        if (g.settings.mobGriefing !== false || this.owner === p) g.placeFire(hit.x + f[0], hit.y + f[1], hit.z + f[2]);
      }
      g.particles.smoke(x, y, z, 4, 0.3, 0.3);
      return;
    }
    if (ent) {
      if (ent === p) p.damage(6, 'fireball', false, this.owner);
      else ent.hurt(6, this.owner, x, z, 'fireball');
    }
    g.explode(x, y, z, 1, this.owner, true);
  }

  render(a) {
    if (!this.object) {
      const mat = new THREE.SpriteMaterial({ map: imageTexture('entity/fireball'), transparent: true, alphaTest: 0.3 });
      this.object = new THREE.Sprite(mat);
      this.object.scale.setScalar(this.small ? 0.4 : 1.1);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y + this.h / 2, z);
    this.object.material.rotation = this.age * 0.3;
  }

  toJSON() { return null; }
}
