// End things that aren't the dragon itself: thrown eyes of ender, end crystals, dragon fireballs and
// the lingering clouds of dragon's breath they leave.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { Fireball } from './fireball.js';
import { imageTexture } from '../engine/textures.js';
import { iconImage } from '../engine/itemmesh.js';
import { entityMaterial } from '../engine/materials.js';
import { boxGeometry } from '../engine/models.js';
import { I } from '../shared/items.js';
import { nearestStronghold } from '../shared/strongholds.js';

const r = Math.random;

// ------------------------------------------------------------------ eye of ender
// flies a little way toward the nearest stronghold, hovers, then drops (or shatters)
export class EnderEye extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.type = 'ender_eye';
    const s = nearestStronghold(game.meta.seed, x, z);
    const dx = s.x - x, dz = s.z - z, d = Math.hypot(dx, dz) || 1;
    // aim at a point up to 12 blocks along the way, a little above the thrower
    const k = Math.min(12, d);
    this.tx = x + dx / d * k; this.tz = z + dz / d * k; this.ty = d > 12 ? y + 8 : s.y;
    this.w = this.h = 0.25;
  }
  tick() {
    super.tick();
    const g = this.game;
    const dx = this.tx - this.x, dz = this.tz - this.z, f = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    let sp = Math.hypot(this.vx, this.vz);
    sp += (f * 0.0025 + 0.2 - sp) * 0.05;
    if (f < 1) { sp *= 0.8; this.vy *= 0.8; }
    this.vx = Math.cos(ang) * sp; this.vz = Math.sin(ang) * sp;
    this.vy += ((this.y < this.ty ? 1 : -1) - this.vy) * 0.015;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    if (this.age % 2 === 0) g.particles.portal(this.x, this.y, this.z);
    if (this.age >= 80) {
      this.remove();
      if (r() < 0.8) g.dropItem(this.x, this.y, this.z, { id: I.ender_eye, count: 1 }, { vx: 0, vy: 0, vz: 0, delay: 10 });
      else { g.sound.play('potion.break', this.x, this.y, this.z, 0.8, 1.2); for (let i = 0; i < 12; i++) g.particles.portal(this.x, this.y, this.z); }
    }
  }
  render(a) {
    if (!this.object) {
      this.object = new THREE.Sprite(new THREE.SpriteMaterial({ map: imageTexture(iconImage(I.ender_eye)), transparent: true, alphaTest: 0.5 }));
      this.object.scale.setScalar(0.4);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y, z);
  }
  toJSON() { return null; }
}

// ------------------------------------------------------------------ end crystal
// a spinning cage of glass around a glowing core; any hit sets it off. Heals the dragon nearby.
let crystalParts = null;
function crystalGeometry() {
  if (crystalParts) return crystalParts;
  const T = [64, 32];
  crystalParts = {
    glass: boxGeometry([-4, -4, -4], [8, 8, 8], [0, 0], T[0], T[1]),
    core: boxGeometry([-4, -4, -4], [8, 8, 8], [32, 0], T[0], T[1]),
    base: boxGeometry([-6, 0, -6], [12, 4, 12], [0, 16], T[0], T[1]),
  };
  return crystalParts;
}

export class EndCrystal extends Entity {
  constructor(game, x, y, z, base = true) {
    super(game, x, y, z);
    this.type = 'end_crystal';
    this.isMob = true; // so it can be hit, shot and blown up
    this.def = { name: 'end_crystal' };
    this.kind = 'end_crystal';
    this.persistent = true;
    this.base = base;
    this.w = 2; this.h = 2;
    this.dead = false;
    this.spin = r() * 100;
  }
  addEffect() {}
  tick() { super.tick(); this.spin++; }
  hurt(dmg, source) {
    if (this.dead) return false;
    this.dead = true;
    this.remove();
    this.game.explode(this.x, this.y + 1, this.z, 6, source || this);
    if (this.game.dragon) this.game.dragon.crystalDestroyed(this, source);
    return true;
  }
  render(a, t) {
    const g = this.game;
    if (!this.object) {
      const geo = crystalGeometry();
      const tex = imageTexture('entity/end_crystal');
      this.mats = [entityMaterial(tex, { alphaTest: 0.1, fullbright: true }), entityMaterial(tex, { alphaTest: 0.1, fullbright: true })];
      const root = new THREE.Group();
      if (this.base) root.add(new THREE.Mesh(geo.base, this.mats[0]));
      this.spinA = new THREE.Group(); this.spinB = new THREE.Group(); this.spinC = new THREE.Group();
      this.spinA.add(new THREE.Mesh(geo.glass, this.mats[1]));
      const inner = new THREE.Mesh(geo.glass, this.mats[1]); inner.scale.setScalar(0.875); this.spinB.add(inner);
      const core = new THREE.Mesh(geo.core, this.mats[0]); core.scale.setScalar(0.766); this.spinC.add(core);
      this.spinA.add(this.spinB); this.spinB.add(this.spinC);
      root.add(this.spinA);
      this.object = root;
      g.entities.group.add(root);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y, z);
    const s = (this.spin + a) * 3 * Math.PI / 180;
    const bob = Math.sin(s * 2) * 0.5 + 0.5;
    this.spinA.position.y = (bob * bob + bob) * 0.4 + 1.2;
    this.spinA.rotation.set(Math.PI / 3, s, Math.PI / 4, 'YXZ');
    this.spinB.rotation.set(Math.PI / 3, s, Math.PI / 4, 'YXZ');
    this.spinC.rotation.set(Math.PI / 3, s, Math.PI / 4, 'YXZ');
    void t;
  }
  remove() {
    if (this.beam) { this.beam.parent && this.beam.parent.remove(this.beam); this.beam = null; }
    super.remove();
  }
  toJSON() { return this.dead ? null : { t: 'end_crystal', x: this.x, y: this.y, z: this.z, base: this.base }; }
}

// ------------------------------------------------------------------ dragon fireball and its breath
export class DragonFireball extends Fireball {
  constructor(game, x, y, z, dx, dy, dz, owner) {
    super(game, x, y, z, dx, dy, dz, owner, false);
    this.type = 'dragon_fireball';
  }
  get deflectable() { return false; }
  impact(x, y, z) {
    const g = this.game;
    g.sound.play('fireball', x, y, z, 1, 0.8);
    // the cloud settles on the ground below the hit
    let gy = Math.floor(y);
    for (let k = 0; k < 8 && gy > 1 && !g.world.isOpaque(Math.floor(x), gy - 1, Math.floor(z)); k++) gy--;
    g.entities.add(new BreathCloud(g, x, gy, z, this.owner));
  }
  render(a) {
    if (!this.object) {
      this.object = new THREE.Sprite(new THREE.SpriteMaterial({ map: imageTexture('entity/dragon_fireball'), transparent: true, alphaTest: 0.3 }));
      this.object.scale.setScalar(1.2);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y + this.h / 2, z);
    this.object.material.rotation = this.age * 0.3;
    if (this.age % 2 === 0) this.game.particles.breath(x, y + 0.5, z, 1);
  }
}

// a lingering purple cloud that hurts anything standing in it
export class BreathCloud extends Entity {
  constructor(game, x, y, z, owner) {
    super(game, x, y, z);
    this.type = 'breath';
    this.owner = owner;
    this.radius = 3;
    this.life = 160;
  }
  tick() {
    super.tick();
    const g = this.game;
    this.radius = Math.max(0.5, this.radius - 0.005);
    for (let i = 0; i < 4; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * this.radius;
      g.particles.breath(this.x + Math.cos(a) * d, this.y + 0.1 + r() * 0.4, this.z + Math.sin(a) * d, 0.3);
    }
    if (this.age % 20 === 0) {
      const p = g.player;
      const hit = (e) => Math.hypot(e.x - this.x, e.z - this.z) < this.radius && e.y > this.y - 0.5 && e.y < this.y + 1.5;
      if (!p.dead && hit(p)) p.addEffect('instant_damage', 1, 0);
      for (const e of g.entities.mobsNear(this.x, this.y, this.z, this.radius + 2)) if (e !== this.owner && e.def && !e.def.boss && hit(e)) e.addEffect('instant_damage', 1, 0);
    }
    if (this.age >= this.life) this.remove();
  }
  toJSON() { return null; }
}
