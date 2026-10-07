// Mobs: definitions, AI, combat, animation.
import * as THREE from 'three';
import { B, BLOCKS } from '../shared/blocks.js';
import { I, ITEMS } from '../shared/items.js';
import { Entity, Arrow } from './entities.js';
import { moveBox, contacts } from './physics.js';
import { findPath } from './pathfind.js';
import { raycast } from './raycast.js';
import { MODELS, buildModel, addEyes } from '../engine/models.js';
import { makeItemObject } from '../engine/itemmesh.js';
import { enchLevel } from '../shared/enchant.js';
import { unlockLevel, restock } from './trading.js';
import { villagerTexture, imageTexture } from '../engine/textures.js';
import { Fireball } from './fireball.js';
import { SplashPotion } from './splash.js';
import { EFFECTS, POTIONS, potionColor } from '../shared/potions.js';

const r = Math.random;
const rint = (a, b) => a + Math.floor(r() * (b - a + 1));

export const MOBS = {
  zombie: {
    undead: true, model: 'zombie', tex: 'entity/zombie', w: 0.6, h: 1.95, eye: 1.74, health: 20, speed: 0.23, hostile: true, attack: 3,
    follow: 35, burns: true, armsForward: true, xp: 5, sounds: { say: 'zombie.say', hurt: 'zombie.hurt', death: 'zombie.death' },
    drops: () => [['rotten_flesh', rint(0, 2)], ...(r() < 0.025 ? [[['iron_ingot', 'carrot', 'potato'][rint(0, 2)], 1]] : [])],
  },
  skeleton: {
    undead: true, model: 'skeleton', tex: 'entity/skeleton', w: 0.6, h: 1.99, eye: 1.74, health: 20, speed: 0.25, hostile: true, ranged: true,
    follow: 16, burns: true, xp: 5, holds: 'bow', sounds: { say: 'skeleton.say', hurt: 'skeleton.hurt', death: 'skeleton.death' },
    drops: () => [['bone', rint(0, 2)], ['arrow', rint(0, 2)], ...(r() < 0.085 ? [['bow', 1]] : [])],
  },
  creeper: {
    model: 'creeper', tex: 'entity/creeper', w: 0.6, h: 1.7, eye: 1.5, health: 20, speed: 0.25, hostile: true, creeper: true,
    follow: 16, xp: 5, sounds: { hurt: 'creeper.fuse', death: 'creeper.death' },
    drops: () => [['gunpowder', rint(0, 2)]],
  },
  spider: {
    model: 'spider', tex: 'entity/spider', eyes: 'entity/spider_eyes', w: 1.4, h: 0.9, eye: 0.65, health: 16, speed: 0.3, hostile: true,
    spider: true, attack: 2, follow: 16, xp: 5, sounds: { say: 'spider.say', hurt: 'spider.hurt', death: 'spider.death' },
    drops: () => [['string', rint(0, 2)], ...(r() < 0.33 ? [['spider_eye', 1]] : [])],
  },
  enderman: {
    model: 'enderman', tex: 'entity/enderman', eyes: 'entity/enderman_eyes', w: 0.6, h: 2.9, eye: 2.55, health: 40, speed: 0.3,
    neutral: true, enderman: true, attack: 7, follow: 64, xp: 5, sounds: { say: 'enderman.say', hurt: 'enderman.hurt', death: 'enderman.death' },
    drops: () => (r() < 0.5 ? [['ender_pearl', 1]] : []),
  },
  pig: {
    model: 'pig', tex: 'entity/pig', w: 0.9, h: 0.9, eye: 0.7, health: 10, speed: 0.25, passive: true, xp: 2,
    breed: ['carrot', 'potato'], sounds: { say: 'pig.say', hurt: 'pig.hurt', death: 'pig.hurt' },
    drops: (m) => [[m.fire > 0 ? 'cooked_porkchop' : 'porkchop', rint(1, 3)]],
  },
  cow: {
    model: 'cow', tex: 'entity/cow', w: 0.9, h: 1.4, eye: 1.3, health: 10, speed: 0.2, passive: true, xp: 2,
    breed: ['wheat'], sounds: { say: 'cow.say', hurt: 'cow.hurt', death: 'cow.hurt' },
    drops: (m) => [['leather', rint(0, 2)], [m.fire > 0 ? 'cooked_beef' : 'beef', rint(1, 3)]],
  },
  sheep: {
    model: 'sheep', tex: 'entity/sheep', w: 0.9, h: 1.3, eye: 1.2, health: 8, speed: 0.23, passive: true, xp: 2, sheep: true,
    breed: ['wheat'], sounds: { say: 'sheep.say', hurt: 'sheep.say', death: 'sheep.say' },
    drops: (m) => [...(m.sheared ? [] : [[m.color + '_wool', 1]]), [m.fire > 0 ? 'cooked_mutton' : 'mutton', rint(1, 2)]],
  },
  chicken: {
    model: 'chicken', tex: 'entity/chicken', w: 0.4, h: 0.7, eye: 0.6, health: 4, speed: 0.25, passive: true, xp: 2, chicken: true,
    breed: ['wheat_seeds', 'melon_seeds', 'pumpkin_seeds'], sounds: { say: 'chicken.say', hurt: 'chicken.hurt', death: 'chicken.hurt' },
    drops: (m) => [['feather', rint(0, 2)], [m.fire > 0 ? 'cooked_chicken' : 'chicken', 1]],
  },
  villager: {
    model: 'villager', tex: 'entity/villager_base', w: 0.6, h: 1.95, eye: 1.62, health: 20, speed: 0.22, passive: true, villager: true, xp: 0,
    sounds: { say: 'villager.say', hurt: 'villager.hurt', death: 'villager.hurt' }, drops: () => [],
  },
  iron_golem: {
    model: 'iron_golem', tex: 'entity/iron_golem', w: 1.4, h: 2.7, eye: 2.4, health: 100, speed: 0.17, neutral: true, golem: true,
    attack: 7, follow: 24, xp: 0, noFall: true, sounds: { hurt: 'golem.hurt', death: 'golem.hurt' },
    drops: () => [['iron_ingot', rint(3, 5)], ['poppy', rint(0, 2)]],
  },
  // ---- the Nether
  zombified_piglin: {
    undead: true, model: 'zombified_piglin', tex: 'entity/zombified_piglin', w: 0.6, h: 1.95, eye: 1.79, health: 20, speed: 0.23, neutral: true,
    piglin: true, attack: 5, follow: 35, fireImmune: true, xp: 5, holds: 'golden_sword',
    sounds: { say: 'piglin.say', hurt: 'piglin.hurt', death: 'piglin.death' },
    drops: () => [['rotten_flesh', rint(0, 1)], ['gold_nugget', rint(0, 1)], ...(r() < 0.025 ? [['gold_ingot', 1]] : [])],
  },
  ghast: {
    model: 'ghast', tex: 'entity/ghast', w: 4, h: 4, eye: 2.6, health: 10, speed: 0.02, hostile: true, ghast: true, flies: true,
    fireImmune: true, noFall: true, follow: 64, xp: 5, sounds: { say: 'ghast.say', hurt: 'ghast.hurt', death: 'ghast.death' },
    drops: () => [['ghast_tear', rint(0, 1)], ['gunpowder', rint(0, 2)]],
  },
  blaze: {
    model: 'blaze', tex: 'entity/blaze', w: 0.6, h: 1.8, eye: 1.5, health: 20, speed: 0.23, hostile: true, blaze: true, fireImmune: true,
    noFall: true, attack: 6, follow: 48, xp: 10, fullbright: true, sounds: { say: 'blaze.breath', hurt: 'blaze.hurt', death: 'blaze.death' },
    drops: (m, byPlayer) => (byPlayer ? [['blaze_rod', rint(0, 1)]] : []),
  },
  magma_cube: {
    model: 'magma_cube', tex: 'entity/magma_cube', texSize: [64, 32], w: 0.52, h: 0.52, eye: 0.3, health: 1, speed: 0.2, hostile: true,
    slime: true, magma: true, fireImmune: true, noFall: true, follow: 16, xp: 1, sounds: { hurt: 'magma.say', death: 'magma.say' },
    drops: (m) => (m.size > 1 && r() < 0.5 ? [['magma_cream', 1]] : []),
  },
  slime: {
    model: 'slime', tex: 'entity/slime', texSize: [64, 32], w: 0.52, h: 0.52, eye: 0.3, health: 1, speed: 0.2, hostile: true, slime: true,
    follow: 16, xp: 1, noFall: true, sounds: { hurt: 'slime.hurt', death: 'slime.death' },
    drops: (m) => (m.size === 1 ? [['slime_ball', rint(0, 2)]] : []),
  },
  wither_skeleton: {
    undead: true, model: 'wither_skeleton', tex: 'entity/wither_skeleton', w: 0.7, h: 2.4, eye: 2.1, health: 20, speed: 0.25, hostile: true,
    attack: 8, follow: 16, fireImmune: true, wither: true, xp: 5, holds: 'stone_sword',
    sounds: { say: 'skeleton.say', hurt: 'skeleton.hurt', death: 'skeleton.death' },
    drops: () => [['coal', rint(0, 1)], ['bone', rint(0, 2)]],
  },
  witch: {
    model: 'witch', tex: 'entity/witch', w: 0.6, h: 1.95, eye: 1.62, health: 26, speed: 0.25, hostile: true, witch: true, ranged: true,
    follow: 16, xp: 5, pitch: 0.75, sounds: { say: 'villager.say', hurt: 'villager.hurt', death: 'villager.hurt' },
    drops: () => {
      const pool = ['glowstone_dust', 'sugar', 'redstone', 'spider_eye', 'glass_bottle', 'gunpowder', 'stick', 'stick'];
      const out = [];
      for (let i = rint(1, 3); i > 0; i--) out.push([pool[rint(0, pool.length - 1)], rint(0, 2)]);
      return out;
    },
  },
  wolf: {
    model: 'wolf', tex: 'entity/wolf', w: 0.6, h: 0.85, eye: 0.7, health: 8, speed: 0.3, neutral: true, wolf: true, attack: 4, xp: 2,
    follow: 16, sounds: { hurt: 'wolf.hurt', death: 'wolf.death' }, drops: () => [],
  },
};
for (const [k, d] of Object.entries(MOBS)) d.name = k;

const SHEEP_COLORS = [['white', 0.818], ['light_gray', 0.05], ['gray', 0.05], ['black', 0.05], ['brown', 0.03], ['pink', 0.002]];
const WOOL_RGB = {
  white: [1, 1, 1], light_gray: [0.62, 0.62, 0.6], gray: [0.3, 0.32, 0.34], black: [0.1, 0.1, 0.12], brown: [0.45, 0.3, 0.2], pink: [0.95, 0.6, 0.7],
  orange: [0.95, 0.5, 0.1], magenta: [0.75, 0.3, 0.75], light_blue: [0.3, 0.7, 0.85], yellow: [0.97, 0.78, 0.15], lime: [0.45, 0.75, 0.1],
  cyan: [0.08, 0.55, 0.57], purple: [0.47, 0.17, 0.66], blue: [0.2, 0.22, 0.6], green: [0.33, 0.43, 0.1], red: [0.63, 0.15, 0.13],
};

export class Mob extends Entity {
  constructor(game, type, x, y, z, opts = {}) {
    super(game, x, y, z);
    this.type = 'mob';
    this.isMob = true;
    this.kind = type;
    this.def = MOBS[type];
    const d = this.def;
    this.baby = !!opts.baby;
    this.growAge = this.baby ? -24000 : 0;
    this.scale = this.baby ? 0.5 : 1;
    this.w = d.w * this.scale; this.h = d.h * this.scale;
    this.health = opts.health ?? d.health;
    this.maxHealth = d.health;
    this.yaw = opts.yaw ?? r() * Math.PI * 2;
    this.bodyYaw = this.yaw; this.pbodyYaw = this.yaw;
    this.headYaw = this.yaw; this.pheadYaw = this.yaw; this.headPitch = 0;
    this.hurtTime = 0; this.invuln = 0;
    this.deathTime = 0; this.dead = false;
    this.limbSwing = 0; this.limbAmt = 0; this.plimbAmt = 0;
    this.moveSpeed = 0; this.moveDir = [0, 0];
    this.target = null;
    this.path = null; this.pathTimer = 0;
    this.wanderTimer = rint(20, 120);
    this.wanderTo = null;
    this.panic = 0;
    this.attackCooldown = 0;
    this.sayTimer = rint(80, 400);
    this.fuse = 0; this.pfuse = 0;
    this.persistent = !!d.passive || !!opts.persistent;
    this.loveTime = 0; this.breedCooldown = 0;
    this.angry = 0;
    this.fallDistance = 0;
    this.knock = null;
    if (d.sheep) {
      this.color = opts.color || pickColor();
      this.sheared = !!opts.sheared;
      this.eatTimer = 0;
    }
    if (d.chicken) this.eggTimer = rint(6000, 12000);
    if (d.wolf) { this.tame = !!opts.tame; this.sitting = !!opts.sitting; this.owner = opts.tame ? 'player' : null; if (this.tame) this.maxHealth = this.health = opts.health ?? 20; }
    if (d.enderman) { this.stareTimer = 0; this.teleportCooldown = 0; }
    if (d.villager) {
      this.profession = opts.profession || 'nitwit';
      this.vtype = opts.vtype || 'plains';
      this.home = opts.home || [Math.floor(x), Math.floor(y), Math.floor(z)];
      this.tradeSeed = opts.tradeSeed ?? ((Math.random() * 4294967296) >>> 0);
      this.tradeLevel = opts.tradeLevel || 0;
      this.tradeXp = opts.tradeXp || 0;
      this.offers = opts.offers || [];
      this.lastRestock = opts.lastRestock ?? -1;
      if (!opts.offers) unlockLevel(this, 0);
    }
    if (d.golem) this.home = opts.home || null;
    if (d.slime) {
      this.size = opts.size || [1, 2, 4][rint(0, 2)];
      this.w = this.h = (d.magma ? 0.52 : 0.51) * this.size;
      this.maxHealth = this.size * this.size;
      this.health = opts.health ?? this.maxHealth;
      this.jumpDelay = rint(10, 30);
      this.squish = 0; this.psquish = 0;
    }
    if (d.ghast || d.blaze) { this.charge = 0; this.attackStep = 0; this.attackTime = 0; }
    this.effects = {};
    this.nameTag = null;
  }

  // ---------------------------------------------------------------- environment helpers
  isDay() { return this.game.isDay(); }
  lightAt() {
    const w = this.world;
    const x = Math.floor(this.x), y = Math.floor(this.y + this.h * 0.8), z = Math.floor(this.z);
    return w.getLight(x, y, z);
  }
  canSee(e) {
    const ox = this.x, oy = this.y + this.def.eye * this.scale, oz = this.z;
    const tx = e.x, ty = e.y + (e.eye || e.h * 0.85), tz = e.z;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    const hit = raycast(this.world, ox, oy, oz, dx / d, dy / d, dz / d, d);
    return !hit || (!BLOCKS[hit.id].opaque && hit.id !== B.glass ? true : false);
  }

  // ---------------------------------------------------------------- tick
  tick() {
    super.tick();
    this.pbodyYaw = this.bodyYaw; this.pheadYaw = this.headYaw;
    this.plimbAmt = this.limbAmt;
    this.pfuse = this.fuse;
    const g = this.game;
    if (this.dead) {
      this.deathTime++;
      if (this.deathTime === 20) {
        g.particles.poof(this.x, this.y, this.z, this.w, this.h);
        this.remove();
      }
      this.physics(0.08, 0.98, 0);
      return;
    }
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.panic > 0) this.panic--;
    if (this.angry > 0) this.angry--;
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.loveTime > 0) { this.loveTime--; if (this.loveTime % 10 === 0) g.particles.hearts(this.x, this.y + this.h, this.z, 1); }
    if (this.baby) {
      this.growAge++;
      if (this.growAge >= 0) this.setBaby(false);
    }
    // ambient sounds
    if (--this.sayTimer <= 0) {
      this.sayTimer = rint(160, 500);
      if (this.def.sounds.say) g.sound.play(this.def.sounds.say, this.x, this.y, this.z, 0.6, this.baby ? 1.4 : (this.def.pitch || 1));
    }
    this.ai();
    this.move();
    this.environment();
    this.effectTick();
  }

  // ---------------------------------------------------------------- status effects
  addEffect(name, ticks, amp = 0, scale = 1, source = null) {
    const E = EFFECTS[name];
    if (!E || this.dead) return;
    const undead = this.def.undead;
    if (E.instant) {
      // healing hurts the undead and harming heals them
      const harm = (name === 'instant_damage') !== !!undead;
      if (harm) this.hurt(Math.floor((6 << amp) * scale), source, this.x, this.z, 'magic');
      else this.health = Math.min(this.maxHealth, this.health + Math.floor((4 << amp) * scale));
      return;
    }
    if (undead && (name === 'poison' || name === 'regeneration')) return;
    const cur = this.effects[name];
    if (cur && (cur.amp > amp || (cur.amp === amp && cur.t >= ticks))) return;
    this.effects[name] = { amp, t: ticks };
  }
  effectTick() {
    const g = this.game;
    for (const n of Object.keys(this.effects)) {
      const e = this.effects[n], a = e.amp;
      if (n === 'poison' && e.t % Math.max(1, 25 >> a) === 0 && this.health > 1) this.hurt(1, null, this.x, this.z, 'magic');
      else if (n === 'wither' && e.t % Math.max(1, 40 >> a) === 0) this.hurt(1, null, this.x, this.z, 'magic');
      else if (n === 'regeneration' && e.t % Math.max(1, 50 >> a) === 0) this.health = Math.min(this.maxHealth, this.health + 1);
      if (r() < 0.15 && !this.effects.invisibility) g.particles.effectSwirl(this.x + (r() - 0.5) * this.w, this.y + r() * this.h, this.z + (r() - 0.5) * this.w, EFFECTS[n].color);
      if (--e.t <= 0) delete this.effects[n];
    }
  }

  setBaby(b) {
    this.baby = b;
    this.scale = b ? 0.5 : 1;
    this.w = this.def.w * this.scale; this.h = this.def.h * this.scale;
    if (this.model) this.model.inner.scale.setScalar(this.scale * (MODELS[this.def.model].scale || 1));
  }

  environment() {
    const g = this.game;
    const c = contacts(this.world, this.x, this.y, this.z, this.w, this.h);
    this.inWater = c.water; this.inLava = c.lava;
    const immune = this.def.fireImmune || !!this.effects.fire_resistance;
    if (c.lava && !immune) { this.fire = 300; if (this.age % 10 === 0) this.hurt(4, null, this.x, this.z, 'lava'); }
    if (c.fire && !immune) { this.fire = Math.max(this.fire, 160); if (this.age % 10 === 0) this.hurt(1, null, this.x, this.z, 'fire'); }
    if (immune) this.fire = 0;
    if (!immune && this.onGround && this.world.getId(Math.floor(this.x), Math.floor(this.y - 0.05), Math.floor(this.z)) === B.magma_block && this.age % 10 === 0) this.hurt(1, null, this.x, this.z, 'fire');
    if (c.water && this.fire > 0) this.fire = 0;
    if (this.fire > 0) {
      this.fire--;
      if (this.fire % 20 === 0) this.hurt(1, null, this.x, this.z, 'fire');
      if (this.age % 3 === 0) g.particles.flame(this.x + (r() - 0.5) * this.w, this.y + r() * this.h, this.z + (r() - 0.5) * this.w);
    }
    if (c.cactus && this.age % 10 === 0) this.hurt(1, null, this.x, this.z, 'cactus');
    // undead burn in daylight
    if (this.def.burns && this.isDay() && !c.water && !g.weather.rain) {
      const l = this.lightAt();
      if ((l >> 4) >= 15 && this.world.rainY(Math.floor(this.x), Math.floor(this.z)) <= this.y + this.h && r() < 0.05) this.fire = Math.max(this.fire, 160);
    }
    // endermen hate water
    if (this.def.enderman && (c.water || (g.weather.rain && this.world.rainY(Math.floor(this.x), Math.floor(this.z)) < this.y))) {
      if (this.age % 10 === 0) this.hurt(1, null, this.x, this.z, 'water');
      if (r() < 0.1) this.teleportRandom();
    }
    // falling damage
    if (!this.onGround && this.vy < 0 && !c.water) this.fallDistance -= (this.y - this.py);
    if (this.onGround || c.water) {
      if (this.fallDistance > 3 && !this.def.chicken && !this.def.noFall) this.hurt(Math.ceil(this.fallDistance - 3), null, this.x, this.z, 'fall');
      this.fallDistance = 0;
    }
    if (this.y < -30) this.remove();
  }

  // ---------------------------------------------------------------- AI
  ai() {
    const g = this.game, d = this.def, p = g.player;
    this.moveSpeed = 0;
    const dist = Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z);
    const playerOk = !p.dead && p.mode === 'survival' && g.difficulty > 0;

    // ---- target acquisition
    if (d.hostile) {
      let hostileNow = true;
      if (d.spider) {
        const l = this.lightAt();
        const eff = Math.max(l & 15, (l >> 4) - g.skyDarken());
        hostileNow = eff < 9 || this.angry > 0;
      }
      const follow = p.effects && p.effects.invisibility ? d.follow * 0.15 : d.follow;
      if (playerOk && hostileNow && dist < follow) {
        if (this.target === p || this.canSee(p) || dist < 6) this.target = p;
      } else if (this.target === p) this.target = null;
      if (this.target === p && (!playerOk || dist > d.follow * 1.2)) this.target = null;
    } else if (d.neutral) {
      if (d.enderman) this.endermanStare(p, dist, playerOk);
      if (d.wolf && this.tame) return this.tameWolfAI(p, dist);
      if (this.angry > 0 && playerOk && dist < (d.follow || 16) * 1.5) this.target = p;
      else if (this.target === p) this.target = null;
    }
    if (this.target && (this.target.removed || this.target.dead)) this.target = null;

    if (d.villager) return this.villagerAI(p, dist);
    if (d.witch && this.witchDrink()) { this.moveSpeed = 0; return; }
    if (d.ghast) return this.ghastAI();
    if (d.slime) return this.slimeAI();
    if (d.blaze && this.target) return this.blazeAI(this.target);
    if (d.blaze && r() < 0.1) this.game.particles.smoke(this.x + (r() - 0.5) * 0.6, this.y + r() * this.h, this.z + (r() - 0.5) * 0.6, 1, 0.4, 0.15);
    if (d.golem) {
      // iron golems hunt monsters near the village (not creepers), and anyone who hit them
      if (this.target && this.target !== p && (this.target.removed || this.target.dead || this.distTo(this.target.x, this.target.y, this.target.z) > 24)) this.target = null;
      if (!this.target && this.age % 10 === 0) {
        let best = null, bd = 16;
        for (const e of g.entities.mobsNear(this.x, this.y, this.z, 16)) {
          if (!e.def.hostile || e.def.creeper || e.dead) continue;
          const dd = this.distTo(e.x, e.y, e.z);
          if (dd < bd) { bd = dd; best = e; }
        }
        this.target = best;
      }
    }
    // zombies go after villagers when there's no player to chase
    if (d.name === 'zombie' && !this.target && this.age % 20 === 0) {
      for (const e of g.entities.mobsNear(this.x, this.y, this.z, 16)) if (e.def.villager && !e.dead) { this.target = e; break; }
    }

    // ---- behaviours
    if (this.target) return this.combat(this.target);
    if (this.panic > 0) return this.wander(true);
    if (d.passive) {
      // tempt: follow a player holding food
      const held = p.inv.held;
      if (d.breed && held && d.breed.includes(ITEMS[held.id].name) && dist < 10 && !p.dead) {
        this.lookAt(p.x, p.y + p.eye, p.z);
        if (dist > 2.5) this.navigate(p.x, p.y, p.z, 1.0);
        return;
      }
      if (this.loveTime > 0) {
        const mate = this.findMate();
        if (mate) {
          this.lookAt(mate.x, mate.y + mate.h * 0.8, mate.z);
          if (this.distTo(mate.x, mate.y, mate.z) > 1.5) this.navigate(mate.x, mate.y, mate.z, 1.0);
          else if (this.id < mate.id) this.breedWith(mate);
          return;
        }
      }
      if (d.sheep && this.onGround && !this.baby) this.graze();
      if (d.chicken && --this.eggTimer <= 0) {
        this.eggTimer = rint(6000, 12000);
        g.sound.play('chicken.egg', this.x, this.y, this.z, 0.6);
        g.dropItem(this.x, this.y + 0.3, this.z, { id: I.egg, count: 1 });
      }
    }
    this.wander(false);
  }

  villagerAI(p, dist) {
    const g = this.game;
    // hold still and face whoever is trading
    if (this.trading) {
      if (g.ui.screens.kind !== 'trade' || g.ui.screens.tile !== this) this.trading = false;
      else { this.lookAt(p.x, p.y + p.eye, p.z); return; }
    }
    if (this.lastRestock !== g.day && g.time > 1000 && g.time < 9000) { restock(this); this.lastRestock = g.day; }
    // run from zombies
    if (this.age % 10 === 0) {
      this.threat = null;
      for (const e of g.entities.mobsNear(this.x, this.y, this.z, 8)) if (e.def.name === 'zombie' && !e.dead) { this.threat = e; break; }
    }
    if (this.threat && !this.threat.dead && !this.threat.removed) {
      const dx = this.x - this.threat.x, dz = this.z - this.threat.z, l = Math.hypot(dx, dz) || 1;
      this.navigate(this.x + dx / l * 6, this.y, this.z + dz / l * 6, 1.7);
      return;
    }
    if (this.panic > 0) return this.wander(true);
    const [hx, hy, hz] = this.home;
    const away = Math.hypot(hx + 0.5 - this.x, hz + 0.5 - this.z);
    // nights are spent at home
    if (!g.isDay()) { if (away > 1.5) this.navigate(hx + 0.5, hy, hz + 0.5, 1.0); return; }
    if (dist < 6 && !p.dead && p.mode !== 'spectator' && r() < 0.5 && !this.wanderTo) { this.lookAt(p.x, p.y + p.eye, p.z); return; }
    if (away > 28) { this.navigate(hx + 0.5, hy, hz + 0.5, 1.0); return; }
    this.wander(false);
  }

  // ghasts drift about the caverns and lob fireballs at anything they can see
  ghastAI() {
    const g = this.game, w = this.world, t = this.target;
    const ft = this.floatTo;
    if (!ft || r() < 0.01 || this.hitH || this.hitV || Math.hypot(ft[0] - this.x, ft[1] - this.y, ft[2] - this.z) < 2) {
      this.floatTo = null;
      for (let i = 0; i < 8; i++) {
        const tx = this.x + (r() * 2 - 1) * 16, ty = this.y + (r() * 2 - 1) * 16, tz = this.z + (r() * 2 - 1) * 16;
        if (ty < 4 || ty > 120 || !w.isLoaded(Math.floor(tx), Math.floor(tz))) continue;
        let free = true;
        for (let k = 0; k <= 4 && free; k++) {
          const f = k / 4;
          const sx = this.x + (tx - this.x) * f, sy = this.y + (ty - this.y) * f + 2, sz = this.z + (tz - this.z) * f;
          if (BLOCKS[w.getId(Math.floor(sx), Math.floor(sy), Math.floor(sz))].solid) free = false;
        }
        if (free) { this.floatTo = [tx, ty, tz]; break; }
      }
    }
    if (this.floatTo) {
      const [tx, ty, tz] = this.floatTo, dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, l = Math.hypot(dx, dy, dz) || 1;
      this.vx += dx / l * 0.02; this.vy += dy / l * 0.02; this.vz += dz / l * 0.02;
    }
    if (t) {
      this.lookAt(t.x, t.y + (t.eye || t.h / 2), t.z);
      this.yaw = this.headYaw;
      const sees = this.distTo(t.x, t.y, t.z) < 64 && this.canSee(t);
      if (sees) {
        this.charge++;
        if (this.charge === 10) g.sound.play('ghast.say', this.x, this.y, this.z, 2, 1, { range: 64 });
        if (this.charge >= 20) {
          const d = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
          const ox = this.x + d[0] * 2.5, oy = this.y + this.h / 2, oz = this.z + d[2] * 2.5;
          g.entities.add(new Fireball(g, ox, oy - 0.5, oz, t.x - ox, t.y + (t.h || 1.8) / 2 - oy, t.z - oz, this, false));
          g.sound.play('ghast.shoot', this.x, this.y, this.z, 2, 1, { range: 64 });
          this.charge = -40;
        }
      } else if (this.charge > 0) this.charge--;
    } else {
      if (this.charge > 0) this.charge--;
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > 0.01) this.yaw = turnToward(this.yaw, Math.atan2(-this.vx, -this.vz), 0.1);
      this.headYaw = this.yaw; this.headPitch = 0;
    }
    this.shooting = this.charge > 10;
  }

  // blazes hover at their target's height, swat when close, otherwise loose bursts of three fireballs
  blazeAI(t) {
    const g = this.game;
    const dist = this.distTo(t.x, t.y, t.z);
    this.lookAt(t.x, t.y + (t.eye || t.h / 2), t.z);
    this.yaw = this.headYaw;
    if (t.y + (t.eye || 1.6) > this.y + this.def.eye + 0.5) this.vy += (0.3 - this.vy) * 0.3;
    const sees = this.canSee(t);
    this.attackTime--;
    if (dist < 2) {
      if (this.attackTime <= 0) {
        this.attackTime = 20;
        if (t === g.player) t.damage(this.def.attack, 'mob', false, this);
        else t.hurt(this.def.attack, this, this.x, this.z, 'mob');
      }
      this.navigate(t.x, t.y, t.z, 1.0);
    } else if (dist < this.def.follow && sees) {
      if (this.attackTime <= 0) {
        this.attackStep++;
        if (this.attackStep === 1) { this.attackTime = 60; this.charged = true; }
        else if (this.attackStep <= 4) {
          this.attackTime = 6;
          const spread = Math.sqrt(Math.sqrt(dist)) * 0.5;
          const ox = this.x, oy = this.y + this.h / 2 + 0.5, oz = this.z;
          const gauss = () => (r() + r() + r() - 1.5) * spread;
          g.entities.add(new Fireball(g, ox, oy - 0.15, oz, t.x - ox + gauss(), t.y + (t.h || 1.8) / 2 - oy, t.z - oz + gauss(), this, true));
          g.sound.play('fireball', this.x, this.y, this.z, 0.8, 1);
        } else { this.attackTime = 100; this.attackStep = 0; this.charged = false; }
      }
    } else {
      this.navigate(t.x, t.y, t.z, 1.0);
      this.charged = false; this.attackStep = 0;
    }
    if (this.charged && r() < 0.5) g.particles.flame(this.x + (r() - 0.5) * 0.8, this.y + r() * this.h, this.z + (r() - 0.5) * 0.8);
    if (r() < 0.15) g.particles.smoke(this.x + (r() - 0.5) * 0.6, this.y + r() * this.h, this.z + (r() - 0.5) * 0.6, 1, 0.4, 0.15);
  }

  // slimes and magma cubes hop toward their target and hurt on contact
  slimeAI() {
    const g = this.game, d = this.def, t = this.target;
    this.psquish = this.squish; this.squish *= 0.6;
    if (t) { this.lookAt(t.x, t.y, t.z); this.yaw = this.headYaw; }
    else if (--this.wanderTimer <= 0) { this.wanderTimer = rint(40, 120); this.yaw = r() * Math.PI * 2; this.headYaw = this.yaw; }
    this.moveSpeed = 0;
    if (this.onGround) {
      if (!this.wasGround) {
        this.squish = -0.5;
        if (this.size > 1 || d.magma) g.sound.play(d.magma ? 'magma.big' : 'slime.jump', this.x, this.y, this.z, 0.4 * this.size, (r() * 0.4 + 0.8) / (this.size * 0.5 + 0.5));
        g.particles.landing(this.x, this.y - 0.5, this.z, g.world.getId(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z)), this.size * 2);
      }
      this.vx *= 0.5; this.vz *= 0.5;
      if (--this.jumpDelay <= 0) {
        this.jumpDelay = t ? rint(10, 30) / 3 | 0 : rint(10, 30);
        const sp = (0.2 + 0.1 * this.size) * 0.6;
        this.vx = -Math.sin(this.yaw) * sp; this.vz = -Math.cos(this.yaw) * sp;
        this.vy = d.magma ? 0.42 + 0.1 * this.size : 0.42;
        this.squish = 1;
        if (!d.magma || r() < 0.5) g.sound.play(d.magma ? 'magma.say' : 'slime.jump', this.x, this.y, this.z, 0.3 * this.size, 1.2 / this.size);
      }
    } else {
      this.vx += -Math.sin(this.yaw) * 0.01; this.vz += -Math.cos(this.yaw) * 0.01;
    }
    this.wasGround = this.onGround;
    // contact damage (tiny slimes are harmless)
    const dmg = d.magma ? this.size + 2 : (this.size > 1 ? this.size : 0);
    if (t && dmg && this.attackCooldown === 0) {
      const reach = this.w / 2 + 0.6 + (t.w || 0.6) / 2;
      if (Math.hypot(t.x - this.x, t.z - this.z) < reach && Math.abs(t.y - this.y) < this.h + 0.5 && this.canSee(t)) {
        this.attackCooldown = 20;
        if (t === g.player) { if (t.damage(dmg, 'mob', false, this) > 0) g.sound.play(d.magma ? 'magma.attack' : 'slime.attack', this.x, this.y, this.z, 0.6); }
        else t.hurt(dmg, this, this.x, this.z, 'mob');
      }
    }
  }

  lookAt(x, y, z) {
    const dx = x - this.x, dz = z - this.z, dy = y - (this.y + this.def.eye * this.scale);
    this.headYaw = Math.atan2(-dx, -dz);
    this.headPitch = Math.atan2(dy, Math.hypot(dx, dz));
  }

  wander(panic) {
    const speed = panic ? 2.0 : 1.0;
    if (panic) {
      if (!this.wanderTo || this.distTo(this.wanderTo[0], this.wanderTo[1], this.wanderTo[2]) < 1.5 || r() < 0.03) this.pickWanderTarget(8);
    } else {
      if (--this.wanderTimer <= 0) {
        this.wanderTimer = rint(80, 240);
        if (r() < 0.7) this.pickWanderTarget(10); else this.wanderTo = null;
      }
      if (r() < 0.02) { this.headYaw = this.bodyYaw + (r() - 0.5) * 1.6; this.headPitch = (r() - 0.5) * 0.6; }
    }
    if (this.wanderTo) {
      const [tx, ty, tz] = this.wanderTo;
      if (Math.hypot(tx - this.x, tz - this.z) < 0.8) { this.wanderTo = null; this.path = null; return; }
      this.navigate(tx, ty, tz, speed);
    }
  }

  pickWanderTarget(range) {
    const w = this.world;
    for (let i = 0; i < 10; i++) {
      const tx = Math.floor(this.x + (r() - 0.5) * range * 2), tz = Math.floor(this.z + (r() - 0.5) * range * 2);
      let ty = Math.floor(this.y) + 3;
      if (!w.isLoaded(tx, tz)) continue;
      while (ty > this.y - 6 && !BLOCKS[w.getId(tx, ty - 1, tz)].solid) ty--;
      const below = w.getId(tx, ty - 1, tz);
      if (!BLOCKS[below].solid || below === B.lava || below === B.cactus) continue;
      if (BLOCKS[w.getId(tx, ty, tz)].solid) continue;
      // animals prefer grass, hostiles prefer darkness
      if (this.def.passive && below !== B.grass_block && r() < 0.6) continue;
      if (w.getId(tx, ty, tz) === B.water && !this.def.chicken && r() < 0.8) continue;
      this.wanderTo = [tx + 0.5, ty, tz + 0.5];
      this.path = null;
      return;
    }
    this.wanderTo = null;
  }

  // steer toward a point, using A* when the direct line is blocked
  navigate(tx, ty, tz, speedMod) {
    this.pathTimer--;
    const fx = Math.floor(this.x), fy = Math.floor(this.y + 0.1), fz = Math.floor(this.z);
    const gx = Math.floor(tx), gy = Math.floor(ty), gz = Math.floor(tz);
    if (!this.path || this.pathTimer <= 0 || this.pathGoal !== gx + ',' + gy + ',' + gz) {
      if (this.pathTimer <= 0 || !this.path) {
        this.path = findPath(this.world, fx, fy, fz, gx, gy, gz, { height: Math.ceil(this.h), maxNodes: this.target ? 500 : 200, reach: 0 }) || [];
        this.pathGoal = gx + ',' + gy + ',' + gz;
        this.pathTimer = this.target ? 10 + rint(0, 10) : 60;
        this.pathIdx = 0;
      }
    }
    let wx = tx, wz = tz;
    if (this.path && this.path.length) {
      while (this.pathIdx < this.path.length) {
        const n = this.path[this.pathIdx];
        if (Math.hypot(n[0] - this.x, n[2] - this.z) < 0.45 && Math.abs(n[1] - this.y) < 1.2) this.pathIdx++;
        else break;
      }
      if (this.pathIdx < this.path.length) { const n = this.path[this.pathIdx]; wx = n[0]; wz = n[2]; this.wantUp = n[1] > this.y + 0.5; }
      else this.wantUp = false;
    }
    const dx = wx - this.x, dz = wz - this.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 0.05) return;
    this.moveDir[0] = dx / dl; this.moveDir[1] = dz / dl;
    this.moveSpeed = this.def.speed * speedMod;
    const yaw = Math.atan2(-dx, -dz);
    this.yaw = turnToward(this.yaw, yaw, 0.5);
    if (!this.target) this.headYaw = turnToward(this.headYaw, yaw, 0.3);
  }

  move() {
    const w = this.world;
    if (this.def.flies) {
      // free flight: no gravity, air drag on every axis
      moveBox(w, this, this.vx, this.vy, this.vz, 0);
      if (this.hitX) this.vx = 0; if (this.hitZ) this.vz = 0; if (this.hitV) this.vy = 0;
      this.vx *= 0.91; this.vy *= 0.91; this.vz *= 0.91;
      this.bodyYaw = this.yaw;
      return;
    }
    const friction = this.onGround ? 0.546 : 0.91;
    let s = this.moveSpeed;
    if (this.baby && this.def.passive) s *= 1.3;
    if (this.effects.speed) s *= 1 + 0.2 * (this.effects.speed.amp + 1);
    if (this.effects.slowness) s *= Math.max(0, 1 - 0.15 * (this.effects.slowness.amp + 1));
    if (s > 0) {
      const acc = this.onGround ? s * s * (0.16277136 / (friction * friction * friction)) : s * 0.1;
      this.vx += this.moveDir[0] * acc;
      this.vz += this.moveDir[1] * acc;
    }
    if (this.inWater || this.inLava) {
      // float up and swim
      if (this.def.passive || r() < 0.8) this.vy += 0.03;
      moveBox(w, this, this.vx, this.vy, this.vz, 0.6);
      if (this.hitX) this.vx = 0; if (this.hitZ) this.vz = 0; if (this.hitV) this.vy = 0;
      this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8;
      this.vy -= 0.02;
      if (this.hitH && s > 0) this.vy = 0.3;
    } else {
      const prevOnGround = this.onGround;
      moveBox(w, this, this.vx, this.vy, this.vz, this.def.spider ? 1.0 : 0.6);
      if (this.hitX) this.vx = 0; if (this.hitZ) this.vz = 0;
      if (this.hitV) this.vy = 0;
      // jump over obstacles; spiders climb walls
      if (this.hitH && s > 0) {
        if (this.def.spider) this.vy = 0.2;
        else if (prevOnGround || this.onGround) this.vy = 0.42;
      } else if (this.wantUp && this.onGround && s > 0 && r() < 0.2) this.vy = 0.42;
      this.vy -= 0.08;
      this.vy *= 0.98;
      if (this.def.chicken && this.vy < -0.06) this.vy = -0.06; // flappy fall
      if (this.def.blaze && !this.onGround && this.vy < 0) this.vy *= 0.6; // blazes drift down slowly
      this.vx *= friction; this.vz *= friction;
    }
    if (this.knock) { this.vx += this.knock[0]; this.vz += this.knock[1]; if (this.onGround) this.vy = Math.max(this.vy, this.knock[2]); this.knock = null; }
    // body follows movement, head follows body loosely
    const hs = Math.hypot(this.x - this.px, this.z - this.pz);
    if (hs > 0.01) this.bodyYaw = turnToward(this.bodyYaw, Math.atan2(-(this.x - this.px), -(this.z - this.pz)), 0.35);
    this.bodyYaw = turnToward(this.bodyYaw, this.headYaw, 0.08);
    this.limbAmt += (Math.min(1, hs * 4) - this.limbAmt) * 0.4;
    this.limbSwing += this.limbAmt;
  }

  // ---------------------------------------------------------------- combat
  combat(t) {
    const g = this.game, d = this.def;
    const dist = Math.hypot(t.x - this.x, t.z - this.z);
    const dy = t.y - this.y;
    this.lookAt(t.x, t.y + (t.eye || t.h * 0.8), t.z);
    if (d.creeper) {
      const close = dist < 3 && Math.abs(dy) < 3 && this.canSee(t);
      if (close || (this.fuse > 0 && dist < 7)) {
        if (this.fuse === 0) g.sound.play('creeper.fuse', this.x, this.y, this.z, 1, 0.5);
        this.fuse++;
        if (this.fuse >= 30) { this.explodeSelf(); return; }
      } else if (this.fuse > 0) this.fuse = Math.max(0, this.fuse - 1);
      if (this.fuse === 0 || dist > 2) this.navigate(t.x, t.y, t.z, 1.0);
      return;
    }
    if (d.ranged) {
      const sees = this.canSee(t);
      if (dist > 12 || !sees) this.navigate(t.x, t.y, t.z, 1.0);
      else {
        // strafe while in range
        if (!this.strafe || r() < 0.03) this.strafe = r() < 0.5 ? 1 : -1;
        const ang = Math.atan2(t.x - this.x, t.z - this.z) + this.strafe * Math.PI / 2;
        this.moveDir[0] = Math.sin(ang); this.moveDir[1] = Math.cos(ang);
        this.moveSpeed = d.speed * 0.5;
        if (dist < 5) { this.moveDir[0] = -(t.x - this.x) / dist; this.moveDir[1] = -(t.z - this.z) / dist; this.moveSpeed = d.speed; }
        this.yaw = this.headYaw;
      }
      if (sees && dist < 16 && this.attackCooldown === 0) {
        this.attackCooldown = g.difficulty >= 3 ? 20 : 40;
        this.drawing = 15;
        this.shootAt(t);
      }
      if (this.drawing > 0) this.drawing--;
      return;
    }
    // melee
    if (d.spider && this.onGround && dist > 2 && dist < 4 && r() < 0.1) {
      this.vx += (t.x - this.x) / dist * 0.3; this.vz += (t.z - this.z) / dist * 0.3; this.vy = 0.4;
    }
    const reach = this.w / 2 + 1.1 + (t.w || 0.6) / 2;
    if (dist < reach && Math.abs(dy) < 2.5) {
      if (this.attackCooldown === 0 && this.canSee(t)) {
        this.attackCooldown = 20;
        this.swingTime = 8;
        let dmg = d.golem ? 7 + rint(0, 14) : d.attack;
        if (d.golem) this.swingTime = 10;
        if (t === g.player) {
          if (t.damage(dmg, 'mob', false, this) > 0) {
            t.knockback(this.x, this.z, 0.4);
            if (d.golem) t.vy = Math.max(t.vy, 0.6);
            if (d.spider) g.sound.play('spider.attack', this.x, this.y, this.z, 0.7);
            if (this.fire > 0 && r() < 0.3) t.fire = Math.max(t.fire, 80);
            if (d.wither && t.addEffect) t.addEffect('wither', 200, 0);
          }
        } else if (t.hurt(dmg, this, this.x, this.z, 'mob') && d.golem && t.knock) t.knock[2] = 0.7;
      }
      if (dist > 1) this.navigate(t.x, t.y, t.z, d.enderman ? 1.5 : 1.0);
    } else this.navigate(t.x, t.y, t.z, d.enderman ? 1.5 : (d.wolf ? 1.4 : 1.0));
  }

  shootAt(t) {
    const g = this.game;
    if (this.def.witch) return this.throwPotionAt(t);
    const ox = this.x, oy = this.y + this.def.eye * this.scale - 0.1, oz = this.z;
    const tx = t.x, ty = t.y + (t.eye ? t.eye * 0.6 : t.h * 0.5), tz = t.z;
    const dx = tx - ox, dz = tz - oz, dh = Math.hypot(dx, dz);
    const dy = ty - oy + dh * 0.2 * 0.6;
    const len = Math.hypot(dx, dy, dz);
    const sp = 1.6;
    const inacc = (14 - g.difficulty * 4) * 0.0075;
    const a = new Arrow(g, ox + dx / len * 0.6, oy, oz + dz / len * 0.6,
      (dx / len + (r() - 0.5) * inacc) * sp, (dy / len + (r() - 0.5) * inacc) * sp, (dz / len + (r() - 0.5) * inacc) * sp, this, 2 + g.difficulty * 0.11);
    g.entities.add(a);
    g.sound.play('bow.shoot', this.x, this.y, this.z, 0.8, 1 / (r() * 0.4 + 0.8));
  }

  // witches pick a nasty potion for the situation, like vanilla's
  throwPotionAt(t) {
    const g = this.game;
    const dist = this.distTo(t.x, t.y, t.z);
    const fx = t.effects || {};
    let pot = 'harming';
    if (dist >= 8 && !fx.slowness) pot = 'slowness';
    else if ((t.health || 0) >= 8 && !fx.poison) pot = 'poison';
    else if (dist <= 3 && !fx.weakness && r() < 0.25) pot = 'weakness';
    const ox = this.x, oy = this.y + this.def.eye - 0.1, oz = this.z;
    const dx = t.x + (t.vx || 0) - ox, dz = t.z + (t.vz || 0) - oz, dh = Math.hypot(dx, dz);
    const dy = t.y + (t.h || 1.8) * 0.5 - oy + dh * 0.2;
    const l = Math.hypot(dx, dy, dz) || 1;
    g.entities.add(new SplashPotion(g, ox + dx / l * 0.5, oy, oz + dz / l * 0.5, dx / l * 0.75, dy / l * 0.75, dz / l * 0.75, pot, this));
    g.sound.play('throw', this.x, this.y, this.z, 0.6, 0.8);
    this.attackCooldown = 60;
  }

  witchDrink() {
    if (this.drinking > 0) {
      if (--this.drinking === 0 && this.drinkPotion) {
        for (const [e, t, amp] of POTIONS[this.drinkPotion].effects) this.addEffect(e, t, amp);
        this.drinkPotion = null;
      }
      return true;
    }
    let pot = null;
    if (this.fire > 0 && !this.effects.fire_resistance) pot = 'fire_resistance';
    else if (this.health < this.maxHealth && r() < 0.05) pot = 'healing';
    else if (this.target && !this.effects.speed && this.distTo(this.target.x, this.target.y, this.target.z) > 11 && r() < 0.01) pot = 'swiftness';
    if (!pot) return false;
    this.drinking = 32; this.drinkPotion = pot;
    this.game.sound.play('potion.drink', this.x, this.y, this.z, 0.6, 0.9);
    return true;
  }

  explodeSelf() {
    const g = this.game;
    this.dead = true;
    this.remove();
    g.explode(this.x, this.y + 0.5, this.z, 3, this);
  }

  endermanStare(p, dist, playerOk) {
    if (!playerOk || dist > 64) return;
    // is the player looking at our head?
    const hx = this.x, hy = this.y + this.def.eye, hz = this.z;
    const [lx, ly, lz] = p.lookDir();
    const ex = hx - p.x, ey = hy - (p.y + p.eye), ez = hz - p.z;
    const el = Math.hypot(ex, ey, ez);
    const dot = (lx * ex + ly * ey + lz * ez) / el;
    const helmetPumpkin = false;
    if (dot > 1 - 0.025 / el * 4 && !helmetPumpkin && this.canSee(p)) {
      if (++this.stareTimer > 5 && this.angry === 0) {
        this.angry = 600;
        this.game.sound.play('enderman.say', this.x, this.y, this.z, 1, 0.8);
      }
    } else this.stareTimer = 0;
    if (this.angry > 0 && dist > 12 && r() < 0.02) this.teleportToward(p);
  }

  teleportRandom() {
    for (let i = 0; i < 16; i++) {
      const tx = this.x + (r() - 0.5) * 32, tz = this.z + (r() - 0.5) * 32;
      if (this.tryTeleport(tx, this.y + (r() - 0.5) * 16, tz)) return true;
    }
    return false;
  }
  teleportToward(p) {
    const dx = this.x - p.x, dz = this.z - p.z, d = Math.hypot(dx, dz) || 1;
    const tx = this.x - dx / d * 12 + (r() - 0.5) * 8, tz = this.z - dz / d * 12 + (r() - 0.5) * 8;
    this.tryTeleport(tx, p.y + (r() - 0.5) * 6, tz);
  }
  tryTeleport(tx, ty, tz) {
    const w = this.world;
    const bx = Math.floor(tx), bz = Math.floor(tz);
    if (!w.isLoaded(bx, bz)) return false;
    let by = Math.floor(ty);
    while (by > 1 && !BLOCKS[w.getId(bx, by - 1, bz)].solid) by--;
    for (let k = 0; k < 3; k++) if (BLOCKS[w.getId(bx, by + k, bz)].solid || w.getId(bx, by + k, bz) === B.water) return false;
    if (!BLOCKS[w.getId(bx, by - 1, bz)].solid) return false;
    this.game.particles.poof(this.x, this.y, this.z, this.w, this.h);
    this.game.sound.play('enderman.say', this.x, this.y, this.z, 0.8, 1.3);
    this.x = this.px = bx + 0.5; this.y = this.py = by; this.z = this.pz = bz + 0.5;
    this.game.sound.play('enderman.say', this.x, this.y, this.z, 0.8, 1.3);
    this.path = null;
    return true;
  }

  tameWolfAI(p, dist) {
    if (this.sitting) { this.target = null; return; }
    // defend the owner
    const lastAttacker = p.lastHitBy;
    if (lastAttacker && lastAttacker.isMob && !lastAttacker.dead && lastAttacker !== this && p.hurtTime > 0) this.target = lastAttacker;
    if (p.lastTargetMob && !p.lastTargetMob.dead && !p.lastTargetMob.removed && p.lastTargetMob !== this) this.target = p.lastTargetMob;
    if (this.target && (this.target.dead || this.target.removed || this.distTo(this.target.x, this.target.y, this.target.z) > 24)) this.target = null;
    if (this.target) return this.combat(this.target);
    if (dist > 12 && !p.dead) {
      // teleport next to the owner
      if (this.tryTeleport(p.x + (r() - 0.5) * 3, p.y, p.z + (r() - 0.5) * 3)) return;
    }
    if (dist > 3) { this.navigate(p.x, p.y, p.z, 1.3); this.lookAt(p.x, p.y + p.eye, p.z); }
    else this.wander(false);
  }

  graze() {
    if (r() > (this.sheared ? 0.01 : 0.001)) return;
    const bx = Math.floor(this.x), by = Math.floor(this.y - 0.5), bz = Math.floor(this.z);
    const w = this.world;
    const above = w.getId(bx, by + 1, bz);
    if (above === B.short_grass) { w.setBlock(bx, by + 1, bz, 0); this.eatGrass(); }
    else if (w.getId(bx, by, bz) === B.grass_block) { w.setBlock(bx, by, bz, B.dirt); this.eatGrass(); }
  }
  eatGrass() {
    this.eating = 40;
    this.sheared = false;
    this.game.sound.play('animal.eat', this.x, this.y, this.z, 0.6);
    if (this.baby) this.growAge = Math.min(0, this.growAge + 1200);
  }

  findMate() {
    for (const e of this.game.entities.mobsNear(this.x, this.y, this.z, 8)) {
      if (e !== this && e.kind === this.kind && e.loveTime > 0 && !e.baby) return e;
    }
    return null;
  }
  breedWith(mate) {
    const g = this.game;
    this.loveTime = 0; mate.loveTime = 0;
    this.breedCooldown = 6000; mate.breedCooldown = 6000;
    const opts = { baby: true };
    if (this.def.sheep) opts.color = r() < 0.5 ? this.color : mate.color;
    g.spawnMob(this.kind, (this.x + mate.x) / 2, this.y, (this.z + mate.z) / 2, opts);
    g.particles.hearts(this.x, this.y + this.h, this.z, 7);
    g.spawnXp(this.x, this.y + 0.5, this.z, rint(1, 7));
    g.advance('breed');
  }

  // feed / interact with the player's held item. returns true if consumed
  interact(player) {
    const g = this.game;
    const held = player.inv.held;
    const name = held ? ITEMS[held.id].name : null;
    const d = this.def;
    if (d.villager && !this.baby && !this.dead) {
      if (!this.offers.length) { g.sound.play('villager.hurt', this.x, this.y, this.z, 0.6, 1.3); this.headYaw += 0.4; return true; }
      this.trading = true;
      g.ui.openTrade(this);
      g.sound.play('villager.say', this.x, this.y, this.z, 0.7);
      return true;
    }
    // a name tag renamed on an anvil names the mob (and keeps it from despawning)
    if (name === 'name_tag' && held.label) {
      this.customName = held.label;
      this.persistent = true;
      return 'consume';
    }
    if (d.breed && name && d.breed.includes(name)) {
      if (this.baby) { this.growAge = Math.min(0, this.growAge + 2400); g.particles.hearts(this.x, this.y + this.h, this.z, 2); return 'consume'; }
      if (this.loveTime === 0 && this.breedCooldown === 0) { this.loveTime = 600; g.particles.hearts(this.x, this.y + this.h, this.z, 4); return 'consume'; }
      return false;
    }
    if (d.sheep && name === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      const n = rint(1, 3);
      for (let i = 0; i < n; i++) g.dropItem(this.x, this.y + 1, this.z, { id: I[this.color + '_wool'], count: 1 }, { vy: 0.2 + r() * 0.1 });
      g.sound.play('sheep.say', this.x, this.y, this.z, 0.6);
      return 'damage';
    }
    if (d.name === 'cow' && name === 'bucket' && !this.baby) {
      g.sound.play('cow.milk', this.x, this.y, this.z, 0.8);
      return { replace: 'milk_bucket' };
    }
    if (d.wolf) {
      if (!this.tame && name === 'bone' && this.angry === 0) {
        if (r() < 0.33) {
          this.tame = true; this.owner = 'player'; this.maxHealth = 20; this.health = 20; this.sitting = true;
          g.particles.hearts(this.x, this.y + this.h, this.z, 7);
          g.advance('tame');
        } else g.particles.smoke(this.x, this.y + this.h, this.z, 6, 0.4, 0.4);
        return 'consume';
      }
      if (this.tame) {
        const food = held && ITEMS[held.id].food && ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'cooked_chicken', 'rotten_flesh', 'mutton', 'cooked_mutton'].includes(name);
        if (food && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + ITEMS[held.id].food.hunger); g.particles.hearts(this.x, this.y + this.h, this.z, 2); return 'consume'; }
        this.sitting = !this.sitting; this.target = null; this.path = null;
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- damage
  hurt(dmg, source, fromX, fromZ, cause = 'mob') {
    if (this.dead) return false;
    if (this.invuln > 10 && cause !== 'fire' && cause !== 'lava') return false;
    const g = this.game;
    if (this.def.enderman && (cause === 'arrow' || cause === 'thrown')) { this.teleportRandom(); return false; }
    this.health -= dmg;
    this.hurtTime = 10;
    this.invuln = 20;
    if (dmg > 0 && cause !== 'fire' && cause !== 'cactus' && cause !== 'lava' && cause !== 'water') {
      let kx = this.x - fromX, kz = this.z - fromZ;
      const kl = Math.hypot(kx, kz) || 1;
      const k = cause === 'sprint' ? 0.65 : 0.4;
      this.knock = [kx / kl * k, kz / kl * k, 0.36];
    }
    if (source === g.player) {
      if (this.def.passive) this.panic = 100;
      if (this.def.neutral || this.def.spider) { this.angry = 600; this.target = g.player; if (this.def.wolf && !this.tame) this.alertPack(); }
      if (this.def.wolf && this.tame) { this.sitting = false; }
    } else if (source && source.isMob && this.def.neutral && !this.tame) { this.target = source; this.angry = 200; }
    if (this.def.passive && cause !== 'fire') this.panic = 100;
    if (this.def.piglin && source === g.player) {
      for (const e of g.entities.mobsNear(this.x, this.y, this.z, 32)) if (e.def.piglin && !e.dead) { e.angry = 600; e.target = g.player; }
      g.sound.play('piglin.angry', this.x, this.y, this.z, 1);
    }
    if (this.def.villager && source === g.player) {
      for (const e of g.entities.mobsNear(this.x, this.y, this.z, 24)) if (e.def.golem) { e.angry = 600; e.target = g.player; }
    }
    if (this.def.enderman && r() < 0.5 && cause !== 'fire') this.teleportRandom();
    if (this.health <= 0) { this.die(source, cause); return true; }
    if (this.def.sounds.hurt) g.sound.play(this.def.sounds.hurt, this.x, this.y, this.z, 0.8, this.baby ? 1.4 : 1);
    return true;
  }

  alertPack() {
    for (const e of this.game.entities.mobsNear(this.x, this.y, this.z, 16)) if (e.def.wolf && !e.tame) { e.angry = 600; e.target = this.game.player; }
  }

  die(source, cause) {
    const g = this.game;
    this.dead = true;
    this.deathTime = 0;
    this.health = 0;
    this.moveSpeed = 0;
    if (this.def.sounds.death) g.sound.play(this.def.sounds.death, this.x, this.y, this.z, 0.9, this.baby ? 1.4 : 1);
    const byPlayer = source === g.player || (source && source.def && source.def.wolf && source.tame);
    if (!this.baby) {
      // looting: up to one extra of each drop per level (not wool)
      const loot = source === g.player ? enchLevel(g.player.inv.held, 'looting') : 0;
      for (let [n, c] of this.def.drops(this, byPlayer)) {
        if (loot && !n.endsWith('_wool')) c += Math.floor(Math.random() * (loot + 1));
        if (c > 0 && I[n] !== undefined) g.dropItem(this.x, this.y + 0.5, this.z, { id: I[n], count: c });
      }
      if (byPlayer || this.def.hostile) g.spawnXp(this.x, this.y + 0.5, this.z, this.def.slime ? this.size : this.def.hostile ? (this.def.xp || 5) : rint(1, 3));
    }
    // big slimes burst into smaller ones
    if (this.def.slime && this.size > 1) {
      const n = rint(2, 4);
      for (let i = 0; i < n; i++) {
        const ox = ((i % 2) - 0.5) * this.size / 2, oz = ((i >> 1) - 0.5) * this.size / 2;
        g.spawnMob(this.kind, this.x + ox, this.y + 0.5, this.z + oz, { size: this.size / 2 });
      }
    }
    if (source === g.player) g.onMobKilled(this, cause);
  }

  // ---------------------------------------------------------------- render
  ensureModel() {
    if (this.model) return;
    const d = this.def;
    let tex = d.tex;
    if (d.wolf && this.tame) tex = 'entity/wolf_tame';
    if (d.villager) tex = villagerTexture(this.vtype, this.profession);
    const m = buildModel(MODELS[d.model], tex, { texSize: d.texSize });
    if (d.eyes) addEyes(m, MODELS[d.model], d.eyes);
    if (d.sheep) {
      const fur = buildModel(MODELS.sheep_fur, 'entity/sheep_fur');
      // attach fur parts to the matching body parts
      for (const [name, part] of Object.entries(fur.parts)) {
        for (const child of [...part.children]) m.parts[name].add(child);
      }
      this.furMats = fur.mats;
      m.mats.push(...fur.mats);
      this.furObjs = Object.values(m.parts).flatMap((p) => p.children.filter((c) => c.material === fur.mats[0]));
    }
    if (d.holds) {
      const it = makeItemObject(I[d.holds]);
      it.scale.setScalar(0.6);
      if (d.holds === 'bow') { it.position.set(0, -0.6, 0.1); it.rotation.set(0, Math.PI / 2, Math.PI * 0.25); }
      else { it.position.set(-0.05, -0.62, 0.12); it.rotation.set(-Math.PI / 2, Math.PI / 2, 0, 'YXZ'); }
      m.parts.rightArm.add(it);
      this.heldObj = it;
    }
    if (d.fullbright) for (const mat of m.mats) if (mat.uniforms.uFullbright) mat.uniforms.uFullbright.value = 1;
    m.inner.scale.setScalar(this.scale * (MODELS[d.model].scale || 1) * (this.size || 1));
    this.model = m;
    this.object = m.root;
    this.game.entities.group.add(m.root);
    this.texIsTame = this.tame;
  }

  render(a, t) {
    if (this.def.wolf && this.model && this.texIsTame !== !!this.tame) { this.game.entities.group.remove(this.model.root); this.model = null; }
    this.ensureModel();
    const m = this.model, P = m.parts, d = this.def;
    const [x, y, z] = this.lerp(a);
    m.root.position.set(x, y, z);
    m.root.visible = !this.effects.invisibility;
    const by = lerpAngle(this.pbodyYaw, this.bodyYaw, a);
    m.root.rotation.set(0, by + Math.PI, 0);
    this.renderName(x, y, z);
    // death: topple over
    if (this.dead) m.inner.rotation.z = Math.min(1, (this.deathTime + a) / 20 * 1.6) * Math.PI / 2;
    const swing = this.limbSwing, amt = this.plimbAmt + (this.limbAmt - this.plimbAmt) * a;
    const hy = lerpAngle(this.pheadYaw, this.headYaw, a) - by;
    const head = P.head;
    if (head) {
      head.rotation.y = wrap(hy);
      head.rotation.x = -this.headPitch;
      if (this.eating > 0 && d.sheep) { head.rotation.x = 0.9; this.eating--; }
    }
    const c = Math.cos(swing * 0.6662), c2 = Math.cos(swing * 0.6662 + Math.PI);
    if (P.rightLeg) { P.rightLeg.rotation.x = c * 1.4 * amt; P.leftLeg.rotation.x = c2 * 1.4 * amt; }
    if (P.rightArm) {
      if (d.armsForward || (d.piglin && this.target)) {
        P.rightArm.rotation.x = -Math.PI / 2 + Math.sin(t * 3) * 0.05; P.leftArm.rotation.x = -Math.PI / 2 - Math.sin(t * 3) * 0.05;
        P.rightArm.rotation.z = 0; P.leftArm.rotation.z = 0;
      } else if (d.ranged && this.target) {
        P.rightArm.rotation.x = -Math.PI / 2 + this.headPitch * -1; P.leftArm.rotation.x = -Math.PI / 2;
        P.leftArm.rotation.y = 0.4; P.rightArm.rotation.y = -0.1;
      } else {
        P.rightArm.rotation.x = c2 * amt; P.leftArm.rotation.x = c * amt;
        P.rightArm.rotation.z = Math.sin(t * 1.3) * 0.04 + 0.03; P.leftArm.rotation.z = -Math.sin(t * 1.3) * 0.04 - 0.03;
        P.rightArm.rotation.y = 0; P.leftArm.rotation.y = 0;
      }
      if (this.swingTime > 0 && d.golem) {
        // iron golems swing both arms up and over
        const k = Math.sin(this.swingTime / 10 * Math.PI) * 2;
        P.rightArm.rotation.x = P.leftArm.rotation.x = -k;
        this.swingTime -= 0.5;
      } else if (this.swingTime > 0) { P.rightArm.rotation.x -= Math.sin(this.swingTime / 8 * Math.PI) * 0.8; this.swingTime -= 0.5; }
      if (d.enderman && this.angry > 0) { head.position.y = 42 / 16 + 0.1; }
    }
    for (let i = 0; i < 4; i++) {
      const L = P['leg' + i];
      if (!L) continue;
      L.rotation.x = ((i === 0 || i === 3) ? c : c2) * 1.4 * amt;
    }
    if (d.spider) {
      // vanilla leg pose (mirrored into this model space) plus a walking scuttle
      const Y = [-0.785, 0.785, -0.393, 0.393, 0.393, -0.393, 0.785, -0.785];
      const Z = [0.785, -0.785, 0.58, -0.58, 0.58, -0.58, 0.785, -0.785];
      const ph = [0, 0, Math.PI, Math.PI, Math.PI / 2, Math.PI / 2, Math.PI * 1.5, Math.PI * 1.5];
      for (let i = 0; i < 8; i++) {
        const L = P['leg' + i];
        const side = i % 2 ? 1 : -1;
        const sy = Math.cos(swing * 1.33 + ph[i]) * 0.4 * amt;
        const sz = Math.abs(Math.sin(swing * 0.67 + ph[i])) * 0.4 * amt;
        L.rotation.set(0, Y[i] + sy * side, Z[i] - sz * side, 'YZX');
      }
    }
    if (d.chicken) {
      const flap = this.onGround ? 0 : Math.sin(t * 25) * 0.9 + 0.9;
      P.rightWing.rotation.z = -flap; P.leftWing.rotation.z = flap;
    }
    if (d.wolf) {
      P.tail.rotation.x = (this.tame ? 1.2 + Math.sin(t * 8) * 0.25 : 0.63) + (this.angry > 0 ? 0.6 : 0);
      if (this.sitting) {
        m.inner.position.y = -0.2; P.body.rotation.x = Math.PI / 4 + Math.PI / 2; P.leg0.rotation.x = P.leg1.rotation.x = Math.PI * 1.5 * 0.4;
      } else { m.inner.position.y = 0; P.body.rotation.x = Math.PI / 2; }
    }
    if (d.sheep && this.furObjs) for (const f of this.furObjs) f.visible = !this.sheared;
    if (d.sheep && this.furMats) { const c3 = WOOL_RGB[this.color] || [1, 1, 1]; for (const fm of this.furMats) fm.uniforms.uColor.value.setRGB(c3[0], c3[1], c3[2]); }
    // creeper swell
    if (d.creeper) {
      const f = (this.pfuse + (this.fuse - this.pfuse) * a) / 30;
      const s = 1 + Math.sin(f * 100) * f * 0.01;
      const k = 1 + f * f * 0.4;
      m.inner.scale.set(k * this.scale, (1 + f * 0.1) / s * this.scale, k * this.scale);
    }
    if (d.ghast) {
      for (let i = 0; i < 9; i++) P['tentacle' + i].rotation.x = 0.2 * Math.sin((this.age + a) * 0.3 + i) + 0.4;
      const want = this.shooting ? 'entity/ghast_shooting' : 'entity/ghast';
      if (this.ghastTex !== want) { this.ghastTex = want; m.mats[0].uniforms.uMap.value = imageTexture(want); }
    }
    if (d.blaze) {
      // three rings of rods, spinning like vanilla's
      const T = this.age + a;
      let f = T * Math.PI * -0.1;
      for (let i = 0; i < 4; i++, f++) P['rod' + i].position.set(Math.cos(f) * 9 / 16, (24 - (-2 + Math.cos((i * 2 + T) * 0.25))) / 16, -Math.sin(f) * 9 / 16);
      f = Math.PI / 4 + T * Math.PI * 0.03;
      for (let i = 4; i < 8; i++, f++) P['rod' + i].position.set(Math.cos(f) * 7 / 16, (24 - (2 + Math.cos((i * 2 + T) * 0.25))) / 16, -Math.sin(f) * 7 / 16);
      f = 0.47123894 + T * Math.PI * -0.05;
      for (let i = 8; i < 12; i++, f++) P['rod' + i].position.set(Math.cos(f) * 5 / 16, (24 - (11 + Math.cos((i * 1.5 + T) * 0.5))) / 16, -Math.sin(f) * 5 / 16);
    }
    if (d.slime) {
      // squash and stretch, and magma cube slices spring apart mid-jump
      this.psquish = this.psquish ?? 0;
      const sq = (this.psquish + (this.squish - this.psquish) * a) / (this.size * 0.5 + 1);
      const k = 1 / (sq + 1);
      m.inner.scale.set(k * this.size, (1 / k) * this.size, k * this.size);
      if (d.magma) for (let i = 0; i < 8; i++) P['slice' + i].position.y = (7 - i + (4 - i) * Math.max(0, sq) * 1.7) / 16;
    }
    // lighting and hurt flash
    const [sk, bl] = this.light();
    const lit = this.fire > 0 || d.fullbright ? 15 : bl;
    const hurt = this.hurtTime > 0 || this.dead;
    let flash = 0;
    if (d.creeper && this.fuse > 0) flash = Math.floor(this.fuse / 2.5) % 2 ? 0.5 : 0;
    for (const mat of m.mats) {
      if (!mat.uniforms.uLight) continue;
      mat.uniforms.uLight.value.set(sk, lit);
      mat.uniforms.uOverlay.value.set(flash ? 1 : 1, flash ? 1 : 0, flash ? 1 : 0, flash || (hurt ? 0.4 : 0));
    }
    if (this.heldObj) this.heldObj.userData.setLight(sk, lit);
  }

  // floating name over named mobs, like vanilla's name plates
  renderName(x, y, z) {
    if (!this.customName) return;
    const g = this.game;
    if (!this.nameSprite || this.nameSprite.userData.text !== this.customName) {
      if (this.nameSprite) { this.nameSprite.parent.remove(this.nameSprite); this.nameSprite.material.map.dispose(); this.nameSprite.material.dispose(); }
      const c = document.createElement('canvas');
      const ctx = c.getContext('2d');
      ctx.font = '28px "Pixelify Sans", sans-serif';
      const w = Math.ceil(ctx.measureText(this.customName).width) + 16;
      c.width = w; c.height = 40;
      const cx = c.getContext('2d');
      cx.fillStyle = 'rgba(0,0,0,0.3)';
      cx.fillRect(0, 0, w, 40);
      cx.font = '28px "Pixelify Sans", sans-serif';
      cx.fillStyle = '#fff';
      cx.textBaseline = 'middle';
      cx.fillText(this.customName, 8, 21);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
      sp.scale.set(w / 40 * 0.25, 0.25, 1);
      sp.userData.text = this.customName;
      g.entities.group.add(sp);
      this.nameSprite = sp;
    }
    this.nameSprite.position.set(x, y + this.h + 0.35, z);
    this.nameSprite.visible = Math.hypot(x - g.player.x, z - g.player.z) < 24;
  }
  remove() {
    if (this.nameSprite) { this.nameSprite.parent && this.nameSprite.parent.remove(this.nameSprite); this.nameSprite.material.map.dispose(); this.nameSprite.material.dispose(); this.nameSprite = null; }
    super.remove();
  }

  toJSON() {
    if (this.dead) return null;
    const o = { t: 'mob', k: this.kind, x: this.x, y: this.y, z: this.z, yaw: this.yaw, h: this.health };
    if (this.baby) { o.baby = 1; o.grow = this.growAge; }
    if (this.def.sheep) { o.color = this.color; o.sheared = this.sheared ? 1 : 0; }
    if (this.def.wolf && this.tame) { o.tame = 1; o.sit = this.sitting ? 1 : 0; }
    if (this.customName) o.name = this.customName;
    if (this.def.villager) o.extra = { profession: this.profession, vtype: this.vtype, home: this.home, tradeSeed: this.tradeSeed, tradeLevel: this.tradeLevel, tradeXp: this.tradeXp, offers: this.offers, lastRestock: this.lastRestock };
    if (this.def.golem && this.home) o.extra = { home: this.home };
    if (this.def.slime) o.extra = { size: this.size };
    return o;
  }
}

function pickColor() {
  let x = r();
  for (const [c, p] of SHEEP_COLORS) { if (x < p) return c; x -= p; }
  return 'white';
}
function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function turnToward(a, b, max) { const d = wrap(b - a); return a + Math.max(-max, Math.min(max, d)); }
function lerpAngle(a, b, t) { return a + wrap(b - a) * t; }
export { WOOL_RGB };
void THREE;
