// Splash potions: arc through the air and shatter, bathing everything nearby in the potion's effects.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { raycast } from './raycast.js';
import { imageTexture } from '../engine/textures.js';
import { iconImage } from '../engine/itemmesh.js';
import { B } from '../shared/blocks.js';
import { I } from '../shared/items.js';
import { POTIONS, EFFECTS, potionColor } from '../shared/potions.js';

export class SplashPotion extends Entity {
  constructor(game, x, y, z, vx, vy, vz, potion, thrower) {
    super(game, x, y, z);
    this.type = 'potion';
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.potion = potion;
    this.thrower = thrower;
    this.w = this.h = 0.25;
  }

  tick() {
    super.tick();
    const g = this.game;
    const sp = Math.hypot(this.vx, this.vy, this.vz) || 1e-6;
    const dx = this.vx / sp, dy = this.vy / sp, dz = this.vz / sp;
    const hit = raycast(this.world, this.x, this.y, this.z, dx, dy, dz, sp);
    let target = null, tb = hit ? hit.dist : sp;
    const cands = g.entities.mobsNear(this.x, this.y, this.z, sp + 3);
    const p = g.player;
    if (!p.dead && p.mode !== 'spectator' && this.thrower !== p) cands.push(p);
    for (const e of cands) {
      if (e === this.thrower && this.age < 5) continue;
      const hw = e.w / 2 + 0.15;
      // a cheap swept-point test against the entity's box
      for (let k = 0; k <= 4; k++) {
        const t = tb * k / 4, px = this.x + dx * t, py = this.y + dy * t, pz = this.z + dz * t;
        if (px > e.x - hw && px < e.x + hw && pz > e.z - hw && pz < e.z + hw && py > e.y - 0.15 && py < e.y + e.h + 0.15) { if (t < tb || !target) { tb = t; target = e; } break; }
      }
    }
    if (hit || target) {
      this.shatter(this.x + dx * tb, this.y + dy * tb, this.z + dz * tb, target, hit);
      this.remove();
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    this.vx *= 0.99; this.vy *= 0.99; this.vz *= 0.99;
    this.vy -= 0.05;
    if (this.age > 400 || this.y < -10) this.remove();
  }

  shatter(x, y, z, direct, hit) {
    const g = this.game;
    const col = potionColor(this.potion);
    g.sound.play('potion.break', x, y, z, 1, 0.9 + Math.random() * 0.2);
    g.particles.potionBurst(x, y, z, col, POTIONS[this.potion] && POTIONS[this.potion].effects.some((e) => EFFECTS[e[0]].instant));
    const pot = POTIONS[this.potion];
    // plain water puts out fires and stings water-haters
    if (!pot || !pot.effects.length) {
      if (this.potion === 'water') {
        for (let ax = -1; ax <= 1; ax++) for (let az = -1; az <= 1; az++) for (let ay = -1; ay <= 1; ay++) {
          const bx = Math.floor(x) + ax, by = Math.floor(y) + ay, bz = Math.floor(z) + az;
          if (g.world.getId(bx, by, bz) === B.fire) g.world.setBlock(bx, by, bz, 0);
        }
        for (const e of [...g.entities.mobsNear(x, y, z, 4), g.player]) {
          if (e.distTo ? e.distTo(x, y, z) > 4 : Math.hypot(e.x - x, e.y - y, e.z - z) > 4) continue;
          e.fire = 0;
          if (e.def && (e.def.enderman || e.def.blaze)) e.hurt(1, this.thrower, x, z, 'water');
        }
      }
      return;
    }
    const targets = g.entities.mobsNear(x, y, z, 5);
    if (!g.player.dead) targets.push(g.player);
    for (const e of targets) {
      const d = Math.hypot(e.x - x, e.y + e.h / 2 - y, e.z - z);
      if (d > 4 && e !== direct) continue;
      const k = e === direct ? 1 : 1 - d / 4;
      for (const [eff, t, amp] of pot.effects) {
        if (!e.addEffect) continue;
        if (EFFECTS[eff].instant) e.addEffect(eff, 1, amp, k, this.thrower);
        else if (Math.floor(t * k) > 20) e.addEffect(eff, Math.floor(t * k), amp);
      }
    }
    void hit;
  }

  render(a) {
    if (!this.object) {
      const img = iconImage(I.splash_potion, this.potion);
      this.object = new THREE.Sprite(new THREE.SpriteMaterial({ map: imageTexture(img), transparent: true, alphaTest: 0.5 }));
      this.object.scale.setScalar(0.35);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y, z);
    const [s] = this.light();
    const v = 0.3 + s / 15 * 0.7;
    this.object.material.color.setRGB(v, v, v);
  }

  toJSON() { return null; }
}
