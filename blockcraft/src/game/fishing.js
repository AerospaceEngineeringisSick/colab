// Fishing: the bobber, vanilla's wait -> approach -> bite cycle, loot tables, and the line.
import * as THREE from 'three';
import { B } from '../shared/blocks.js';
import { ITEMS, I } from '../shared/items.js';
import { Entity } from './entities.js';
import { moveBox, contacts } from './physics.js';
import { entityMaterial } from '../engine/materials.js';
import { imageTexture } from '../engine/textures.js';
import { enchLevel, rollEnchants, rng } from '../shared/enchant.js';

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pickW = (list) => {
  let t = 0;
  for (const e of list) t += e[1];
  let r = Math.random() * t;
  for (const e of list) { r -= e[1]; if (r < 0) return e[0]; }
  return list[0][0];
};

// what comes up: fish, junk or treasure (vanilla weights; Luck of the Sea shifts them toward treasure)
export function fishingLoot(luck) {
  const fish = Math.max(0, 85 - luck);
  const junk = Math.max(0, 10 - 2 * luck);
  const treasure = 5 + 2 * luck;
  const kind = pickW([['fish', fish], ['junk', junk], ['treasure', treasure]]);
  if (kind === 'fish') return { id: I[pickW([['cod', 60], ['salmon', 25], ['tropical_fish', 2], ['pufferfish', 13]])], count: 1 };
  if (kind === 'junk') {
    const n = pickW([['leather_boots', 10], ['leather', 10], ['bone', 10], ['potion', 10], ['string', 5], ['fishing_rod', 2], ['bowl', 10],
      ['stick', 5], ['ink_sac', 1], ['rotten_flesh', 10], ['lily_pad', 17]]);
    const s = { id: I[n], count: 1 };
    if (n === 'potion') s.potion = 'water';
    if (ITEMS[s.id].durability) s.dmg = Math.floor(ITEMS[s.id].durability * (0.1 + Math.random() * 0.8));
    return s;
  }
  const n = pickW([['bow', 1], ['enchanted_book', 1], ['fishing_rod', 1], ['name_tag', 1], ['saddle', 1]]);
  const s = { id: I[n], count: 1 };
  // treasure gear comes enchanted at level 30, treasure enchantments allowed
  if (n === 'bow' || n === 'fishing_rod') {
    s.ench = rollEnchants(s.id, 30, rng((Math.random() * 1e9) | 0), true);
    s.dmg = Math.floor(ITEMS[s.id].durability * Math.random() * 0.25);
  } else if (n === 'enchanted_book') {
    s.ench = rollEnchants(I.book, 30, rng((Math.random() * 1e9) | 0), true);
  }
  return s;
}

let bobberMat = null;

export class Bobber extends Entity {
  constructor(game, owner) {
    const d = owner.lookDir();
    super(game, owner.x + d[0] * 0.3, owner.y + owner.eye - 0.1, owner.z + d[2] * 0.3);
    this.type = 'bobber';
    this.owner = owner;
    this.w = 0.25; this.h = 0.25;
    // a cast like vanilla's: along the look direction with a little wobble
    const sp = 0.6 + Math.random() * 0.1;
    this.vx = d[0] * sp + (Math.random() - 0.5) * 0.03;
    this.vy = d[1] * sp + 0.1;
    this.vz = d[2] * sp + (Math.random() - 0.5) * 0.03;
    this.inWater = false;
    this.ground = false;
    const rod = owner.inv.held;
    this.lure = enchLevel(rod, 'lure');
    this.luck = enchLevel(rod, 'luck_of_the_sea');
    this.wait = 0; // ticks until a fish notices
    this.approach = 0; // ticks a fish is swimming in
    this.hooked = 0; // ticks the fish stays on the hook
    this.angle = 0;
  }

  resetWait() { this.wait = Math.max(20, rint(100, 600) - this.lure * 100); }

  tick() {
    super.tick();
    const p = this.owner, g = this.game;
    const rod = p.inv.held;
    if (p.dead || !rod || ITEMS[rod.id].use !== 'fish' || this.distTo(p.x, p.y, p.z) > 32) { this.remove(); return; }
    const c = contacts(this.world, this.x, this.y, this.z, this.w, this.h);
    const wasWater = this.inWater;
    this.inWater = c.water;
    if (this.inWater) {
      // float at the surface
      const surface = c.waterTop - 0.12;
      this.vy += (surface - this.y) * 0.08;
      this.vy *= 0.8;
      this.vx *= 0.9; this.vz *= 0.9;
      if (!wasWater) {
        g.sound.play('fishing.cast', this.x, this.y, this.z, 0.3, 1.2 + Math.random() * 0.3);
        g.particles.splash(this.x, c.waterTop, this.z, 6);
        this.resetWait();
      }
      this.fish(c.waterTop);
    } else {
      this.vy -= 0.03;
      this.vx *= 0.92; this.vy *= 0.92; this.vz *= 0.92;
    }
    if (!this.ground) {
      moveBox(this.world, this, this.vx, this.vy, this.vz, 0);
      if ((this.hitX || this.hitZ || (this.onGround && !this.inWater))) { this.ground = true; this.vx = this.vy = this.vz = 0; }
    }
  }

  // the fish's side of things
  fish(top) {
    const g = this.game;
    if (this.hooked > 0) {
      this.hooked--;
      if (this.hooked === 0) this.resetWait(); // it got away
      return;
    }
    if (this.approach > 0) {
      this.approach--;
      // a trail of bubbles closing in on the bobber
      const r = this.approach * 0.1;
      if (Math.random() < 0.5) g.particles.bubbles(this.x + Math.sin(this.angle) * r, top - 0.05, this.z + Math.cos(this.angle) * r, 1);
      if (this.approach === 0) {
        this.hooked = rint(20, 40);
        this.vy -= 0.2;
        g.sound.play('fishing.bite', this.x, this.y, this.z, 0.5, 1 + (Math.random() - 0.5) * 0.4);
        g.particles.splash(this.x, top, this.z, 10);
      }
      return;
    }
    if (this.wait > 0 && --this.wait === 0) {
      this.approach = rint(20, 80);
      this.angle = Math.random() * Math.PI * 2;
    }
  }

  // the player pulls the line in; returns rod wear
  reel() {
    const g = this.game, p = this.owner;
    let wear = 0;
    if (this.hooked > 0) {
      const loot = fishingLoot(this.luck);
      const dx = p.x - this.x, dy = p.y + 1 - this.y, dz = p.z - this.z;
      const dist = Math.hypot(dx, dy, dz) || 1;
      g.dropItem(this.x, this.y + 0.2, this.z, loot, { vx: dx * 0.1, vy: dy * 0.1 + Math.sqrt(dist) * 0.08, vz: dz * 0.1, delay: 0 });
      g.spawnXp(p.x, p.y + 0.5, p.z, rint(1, 6));
      g.stats.fished = (g.stats.fished || 0) + 1;
      g.advance('fish');
      wear = 1;
    } else if (this.ground) wear = 2;
    g.sound.play('fishing.reel', this.x, this.y, this.z, 0.4, 1);
    this.remove();
    return wear;
  }

  remove() {
    if (this.owner && this.owner.bobber === this) this.owner.bobber = null;
    if (this.line) { this.line.parent && this.line.parent.remove(this.line); this.line.geometry.dispose(); this.line.material.dispose(); this.line = null; }
    super.remove();
  }

  render(a) {
    const g = this.game;
    if (!this.object) {
      if (!bobberMat) bobberMat = entityMaterial(imageTexture('entity/fishing_bobber'), { alphaTest: 0.5, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), bobberMat.clone());
      this.object = m;
      g.entities.group.add(m);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(17 * 3), 3));
      this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
      this.line.frustumCulled = false;
      g.entities.group.add(this.line);
    }
    const [x, y, z] = this.lerp(a);
    const bob = this.hooked > 0 ? -0.08 : Math.sin((this.age + a) * 0.2) * 0.02;
    this.object.position.set(x, y + 0.12 + bob, z);
    this.object.quaternion.copy(g.r.camera.quaternion);
    const [s, b] = this.light();
    this.object.material.uniforms.uLight.value.set(s, b);
    // line from the rod tip, sagging a little
    const tip = g.rodTip(a);
    const pos = this.line.geometry.attributes.position.array;
    const ex = x, ey = y + 0.2 + bob, ez = z;
    const len = Math.hypot(ex - tip[0], ey - tip[1], ez - tip[2]);
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pos[i * 3] = tip[0] + (ex - tip[0]) * t;
      pos[i * 3 + 1] = tip[1] + (ey - tip[1]) * t - Math.sin(t * Math.PI) * Math.min(1.5, len * 0.06) * (this.hooked > 0 ? 0.2 : 1);
      pos[i * 3 + 2] = tip[2] + (ez - tip[2]) * t;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
  }
}
