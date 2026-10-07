// The player: movement physics (20 TPS, Minecraft constants), survival stats, camera.
import { BLOCKS, B } from '../shared/blocks.js';
import { ITEMS } from '../shared/items.js';
import { WH } from '../shared/constants.js';
import { moveBox, contacts, boxBlocked } from './physics.js';
import { PlayerInventory } from './inventory.js';
import { enchLevel, armorLevel } from '../shared/enchant.js';

export const xpForLevel = (l) => (l < 16 ? 2 * l + 7 : l < 31 ? 5 * l - 38 : 9 * l - 158);

export class Player {
  constructor(game) {
    this.game = game;
    this.x = 0.5; this.y = 80; this.z = 0.5;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.w = 0.6; this.h = 1.8; this.eye = 1.62;
    this.eyeSmooth = 1.62; this.prevEye = 1.62;
    this.onGround = false;
    this.sneaking = false; this.sprinting = false; this.flying = false;
    this.inWater = false; this.inLava = false; this.eyeInWater = false; this.eyeInLava = false;
    this.health = 20; this.maxHealth = 20;
    this.food = 20; this.saturation = 5; this.exhaustion = 0;
    this.foodTimer = 0;
    this.air = 300;
    this.level = 0; this.xp = 0; this.xpTotal = 0; // xp: progress 0..1
    this.fallDistance = 0;
    this.hurtTime = 0; this.invuln = 0; this.lastDamage = 0;
    this.fire = 0;
    this.enchSeed = (Math.random() * 0x7fffffff) | 0; // keeps enchanting-table offers stable until used
    this.dead = false;
    this.mode = 'survival'; // survival | creative | spectator
    this.spawn = null; // [x,y,z] bed spawn
    this.inv = new PlayerInventory();
    this.vehicle = null; // boat or minecart being ridden
    this.walkDist = 0; this.prevWalkDist = 0; this.bob = 0; this.prevBob = 0;
    this.stepDist = 0;
    this.jumpCooldown = 0;
    this.wasOnGround = true;
    this.input = { f: 0, s: 0, jump: false, sneak: false, sprint: false, up: false, down: false };
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.poison = 0; this.hungerEffect = 0; this.regenEffect = 0;
    this.sleeping = false;
    this.swing = 0; // arm swing progress
    this.age = 0;
    this.knock = [0, 0];
    this.fovSprint = 1;
    this.lastHitBy = null;
  }

  get creative() { return this.mode === 'creative'; }
  get eyeY() { return this.y + this.eye; }

  // interpolated render position
  renderPos(a) {
    return [this.px + (this.x - this.px) * a, this.py + (this.y - this.py) * a, this.pz + (this.z - this.pz) * a];
  }

  facing() {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 3 : 1;
    return fz > 0 ? 0 : 2;
  }
  lookDir() {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  addExhaustion(v) { if (!this.creative) this.exhaustion = Math.min(40, this.exhaustion + v); }

  // ------------------------------------------------------------ tick (20/s)
  tick() {
    const world = this.game.world;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.prevWalkDist = this.walkDist; this.prevBob = this.bob;
    this.prevEye = this.eyeSmooth;
    this.age++;
    if (this.dead) return;
    if (this.sleeping) { this.vx = this.vz = 0; return; }
    const inp = this.input;
    // riding: the vehicle moves us (it reads our input when it ticks)
    if (this.vehicle) {
      if (this.vehicle.removed) this.vehicle = null;
      else {
        this.sneaking = false; this.h = 1.8; this.eye = 1.62;
        this.eyeSmooth += (1.62 - this.eyeSmooth) * 0.5;
        this.sprinting = false;
        const c = contacts(world, this.x, this.y, this.z, this.w, this.h);
        this.inWater = c.water; this.inLava = c.lava;
        this.eyeInWater = world.getId(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z)) === B.water;
        this.eyeInLava = world.getId(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z)) === B.lava;
        this.fallDistance = 0;
        this.bob *= 0.6;
        this.survivalTick(c);
        return;
      }
    }
    // wait for the ground to exist
    if (!world.isLoaded(Math.floor(this.x), Math.floor(this.z))) return;

    // sneaking / eye height
    const wantSneak = inp.sneak && !this.flying;
    if (wantSneak) { this.sneaking = true; this.h = 1.5; }
    else if (this.sneaking) {
      // stand up only if there's room
      if (!boxBlocked(world, this.x - 0.3, this.y, this.z - 0.3, this.x + 0.3, this.y + 1.8, this.z + 0.3)) { this.sneaking = false; this.h = 1.8; }
    }
    const targetEye = this.sneaking ? 1.27 : 1.62;
    this.eye = targetEye;
    this.eyeSmooth += (targetEye - this.eyeSmooth) * 0.5;

    const c = contacts(world, this.x, this.y, this.z, this.w, this.h);
    this.inWater = c.water; this.inLava = c.lava;
    const eyeV = world.getBlock(Math.floor(this.x), Math.floor(this.y + this.eye), Math.floor(this.z));
    const eyeId = eyeV & 1023;
    this.eyeInWater = eyeId === B.water && (this.y + this.eye) < Math.floor(this.y + this.eye) + (world.getId(Math.floor(this.x), Math.floor(this.y + this.eye) + 1, Math.floor(this.z)) === B.water ? 1 : 0.9);
    this.eyeInLava = eyeId === B.lava;

    // sprinting rules
    const canSprint = (this.food > 6 || this.creative || this.flying) && !this.sneaking && inp.f > 0.5;
    if (inp.sprint && canSprint) this.sprinting = true;
    if (!canSprint || this.hitHForSprint || (this.inWater && !this.eyeInWater && false)) this.sprinting = false;
    this.hitHForSprint = false;

    let f = inp.f * 0.98, s = inp.s * 0.98;
    if (this.sneaking) { f *= 0.3; s *= 0.3; }
    if (this.usingItem) { f *= 0.2; s *= 0.2; }
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // world-space input direction (forward is -z at yaw 0)
    const ix = -sin * f + cos * s;
    const iz = -cos * f - sin * s;

    if (this.jumpCooldown > 0) this.jumpCooldown--;
    const speed = 0.1 * (this.sprinting ? 1.3 : 1);

    if (this.flying) {
      const fs = (this.sprinting ? 0.1 : 0.05);
      this.vx += ix * fs; this.vz += iz * fs;
      if (inp.jump || inp.up) this.vy += 0.15;
      if (inp.sneak || inp.down) this.vy -= 0.15;
      this.move(this.vx, this.vy, this.vz, 0.6);
      this.vx *= 0.91; this.vz *= 0.91; this.vy *= 0.6;
      if (this.onGround && !this.creativeFlightOnGround) this.flying = this.mode === 'spectator';
      this.fallDistance = 0;
    } else if (this.inWater || this.inLava) {
      const drag = this.inWater ? 0.8 : 0.5;
      const acc = 0.02 * (this.sprinting && this.inWater ? 1.6 : 1);
      this.vx += ix * acc; this.vz += iz * acc;
      if (inp.jump) this.vy += 0.04;
      else if (inp.sneak) this.vy -= 0.02;
      const prevY = this.y;
      this.move(this.vx, this.vy, this.vz, 0.6);
      this.vx *= drag; this.vy *= drag; this.vz *= drag;
      this.vy -= 0.02;
      // hop out of water onto a ledge
      if (this.hitH && !boxBlocked(world, this.x - 0.3, prevY + 0.6 + this.vy, this.z - 0.3, this.x + 0.3, prevY + 0.6 + this.vy + this.h, this.z + 0.3)) this.vy = 0.3;
      this.fallDistance = 0;
    } else {
      // ground friction from the block below
      const below = world.getId(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
      const slip = this.onGround ? (BLOCKS[below].slip || 0.6) : 1;
      const friction = slip * 0.91;
      const acc = this.onGround ? speed * (0.16277136 / (friction * friction * friction)) : (this.sprinting ? 0.026 : 0.02);
      this.vx += ix * acc; this.vz += iz * acc;
      // jumping
      if (inp.jump && this.onGround && this.jumpCooldown === 0) {
        this.vy = 0.42;
        this.jumpCooldown = 10;
        if (this.sprinting) {
          this.vx += -sin * 0.2; this.vz += -cos * 0.2;
          this.addExhaustion(0.2);
        } else this.addExhaustion(0.05);
      }
      // ladders & vines
      if (c.ladder) {
        this.vx = Math.max(-0.15, Math.min(0.15, this.vx));
        this.vz = Math.max(-0.15, Math.min(0.15, this.vz));
        this.fallDistance = 0;
        if (this.vy < -0.15) this.vy = -0.15;
        if (this.sneaking && this.vy < 0) this.vy = 0;
      }
      if (c.web) { this.vx *= 0.25; this.vy *= 0.05; this.vz *= 0.25; this.fallDistance = 0; }
      const vy0 = this.vy;
      this.move(this.vx, this.vy, this.vz, 0.6);
      if (c.ladder && (this.hitH || inp.jump)) this.vy = 0.2;
      this.vy -= 0.08;
      this.vy *= 0.98;
      this.vx *= friction; this.vz *= friction;
      void vy0;
    }
    if (this.hitH) this.hitHForSprint = this.sprinting && !this.flying;

    // knockback applied once
    if (this.knock[0] || this.knock[1]) { this.vx += this.knock[0]; this.vz += this.knock[1]; this.knock[0] = this.knock[1] = 0; }

    // walk distance for bobbing / footsteps
    const dx = this.x - this.px, dz = this.z - this.pz;
    const d = Math.hypot(dx, dz);
    if (this.onGround && !this.flying) {
      this.walkDist += d;
      this.stepDist += d;
      if (this.stepDist > 1.7 * (this.sprinting ? 1.15 : 1)) {
        this.stepDist = 0;
        if (!this.sneaking) this.game.sound.step(this.x, this.y, this.z, this.blockUnder());
      }
    }
    const tb = this.onGround && !this.flying ? Math.min(0.1, d) : 0;
    this.bob += (tb - this.bob) * 0.4;
    if (this.sprinting) this.addExhaustion(0.1 * d);
    else if (this.inWater) this.addExhaustion(0.01 * Math.hypot(d, this.y - this.py));

    // falling
    if (!this.onGround && this.vy < 0 && !this.inWater && !c.ladder) this.fallDistance -= (this.y - this.py);
    if (this.onGround) {
      if (this.fallDistance > 3 && !this.creative) {
        let dmg = Math.ceil(this.fallDistance - 3);
        if (this.blockUnder() === B.hay_block) dmg = Math.ceil(dmg * 0.2);
        if (dmg > 0) this.damage(dmg, 'fall');
      }
      if (this.fallDistance > 1.5 && !this.creative) this.game.particles.landing(this.x, this.y, this.z, this.blockUnder(), this.fallDistance);
      this.fallDistance = 0;
    }
    if (this.inWater) this.fallDistance = 0;
    this.wasOnGround = this.onGround;

    this.survivalTick(c);
  }

  move(dx, dy, dz, step) {
    const r = moveBox(this.game.world, this, dx, dy, dz, step, this.sneaking && this.onGround && !this.flying);
    if (this.hitX) this.vx = 0;
    if (this.hitZ) this.vz = 0;
    if (this.hitV) this.vy = 0;
    return r;
  }

  blockUnder() {
    const w = this.game.world;
    let id = w.getId(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
    if (!id) {
      // standing on an edge: check the corners
      for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        id = w.getId(Math.floor(this.x + ox), Math.floor(this.y - 0.2), Math.floor(this.z + oz));
        if (id) break;
      }
    }
    return id;
  }

  survivalTick(c) {
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    if (this.swing > 0) this.swing = Math.max(0, this.swing - 1);
    const diff = this.game.difficulty;
    if (this.creative || this.mode === 'spectator') { this.air = 300; this.fire = 0; return; }
    // drowning (respiration: each level adds a chance to skip losing air)
    if (this.eyeInWater) {
      const resp = armorLevel(this.inv, 'respiration');
      if (!resp || Math.random() < 1 / (resp + 1)) this.air--;
      if (this.air <= -20) { this.air = 0; this.damage(2, 'drown'); }
    } else this.air = Math.min(300, this.air + 4);
    // lava / fire
    if (this.inLava) { this.fire = Math.round(300 * Math.max(0.1, 1 - 0.15 * armorLevel(this.inv, 'fire_protection'))); if (this.age % 10 === 0) this.damage(4, 'lava'); }
    if (this.inWater && this.fire > 0) { this.fire = 0; this.game.sound.play('fire.extinguish', this.x, this.y, this.z, 0.5); }
    if (this.fire > 0) {
      this.fire--;
      if (this.fire % 20 === 0 && !this.inLava) this.damage(1, 'fire');
    }
    if (c.cactus && this.age % 10 === 0) this.damage(1, 'cactus');
    // void
    if (this.y < -20) this.damage(4, 'void');
    // effects
    if (this.poison > 0) { this.poison--; if (this.poison % 25 === 0 && this.health > 1) this.damage(1, 'poison', true); }
    if (this.hungerEffect > 0) { this.hungerEffect--; this.addExhaustion(0.025); }
    if (this.regenEffect > 0) { this.regenEffect--; if (this.regenEffect % 50 === 0) this.heal(1); }
    // hunger
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (diff > 0) this.food = Math.max(0, this.food - 1);
    }
    if (diff === 0 && this.age % 20 === 0) { if (this.food < 20) this.food++; if (this.health < this.maxHealth) this.heal(1); }
    if (this.health < this.maxHealth && this.food >= 18) {
      // fast regen while saturated
      if (this.saturation > 0 && this.food >= 20) {
        if (++this.regenTimer >= 10) { this.regenTimer = 0; const h = Math.min(1, this.saturation / 6); this.heal(h); this.addExhaustion(h * 6); }
      } else if (++this.regenTimer >= 80) { this.regenTimer = 0; this.heal(1); this.addExhaustion(6); }
    } else this.regenTimer = 0;
    if (this.food <= 0) {
      if (++this.starveTimer >= 80) {
        this.starveTimer = 0;
        const floor = diff === 1 ? 10 : diff === 2 ? 1 : 0;
        if (this.health > floor) this.damage(1, 'starve', true);
      }
    } else this.starveTimer = 0;
  }

  heal(n) { if (!this.dead) this.health = Math.min(this.maxHealth, this.health + n); }

  // returns damage actually taken
  damage(amount, cause = 'generic', bypassArmor = false, source = null) {
    if (this.dead || this.creative || this.mode === 'spectator') return 0;
    if (cause !== 'void' && cause !== 'starve' && this.invuln > 10) {
      if (amount <= this.lastDamage) return 0;
      const extra = amount - this.lastDamage;
      this.lastDamage = amount;
      amount = extra;
    } else {
      this.lastDamage = amount;
      this.invuln = 20;
    }
    const diff = this.game.difficulty;
    if (source && source.hostile) {
      if (diff === 0) return 0;
      if (diff === 1) amount = Math.min(amount / 2 + 1, amount);
      if (diff === 3) amount *= 1.5;
    }
    if (!bypassArmor && ['generic', 'mob', 'arrow', 'explosion', 'cactus', 'fire', 'lava'].includes(cause)) {
      const def = this.inv.armorPoints(), tough = this.inv.armorToughness();
      const red = Math.min(20, Math.max(def / 5, def - amount / (2 + tough / 4))) / 25;
      amount *= 1 - red;
      if (def > 0 && cause !== 'fire') this.damageArmor(amount);
    }
    // enchantment protection factor: 4% less damage per point, at most 80%
    if (!bypassArmor && cause !== 'void') {
      const epf = Math.min(20, this.protectionPoints(cause));
      if (epf > 0) amount *= 1 - epf / 25;
    }
    if (source && source.isMob && cause === 'mob') this.thorns(source);
    if (amount <= 0) return 0;
    this.health = Math.max(0, this.health - amount);
    this.hurtTime = 10;
    this.addExhaustion(0.1);
    this.lastCause = cause;
    this.lastHitBy = source;
    this.game.onPlayerHurt(amount, cause);
    if (this.health <= 0) this.die(cause, source);
    return amount;
  }

  protectionPoints(cause) {
    let p = 0;
    for (const s of this.inv.armor.slots) {
      if (!s || !s.ench) continue;
      p += enchLevel(s, 'protection');
      if (cause === 'fire' || cause === 'lava') p += 2 * enchLevel(s, 'fire_protection');
      if (cause === 'explosion') p += 2 * enchLevel(s, 'blast_protection');
      if (cause === 'arrow' || cause === 'thrown') p += 2 * enchLevel(s, 'projectile_protection');
      if (cause === 'fall') p += 3 * enchLevel(s, 'feather_falling');
    }
    return p;
  }

  // thorns: a chance to hurt melee attackers
  thorns(source) {
    const slots = this.inv.armor.slots;
    for (let i = 0; i < 4; i++) {
      const l = enchLevel(slots[i], 'thorns');
      if (l && Math.random() < 0.15 * l) {
        source.hurt(1 + Math.floor(Math.random() * 4), this, this.x, this.z, 'thorns');
        this.damageArmorPiece(i, 2);
      }
    }
  }

  damageArmor(amount) {
    const n = Math.max(1, Math.floor(amount / 4));
    for (let i = 0; i < 4; i++) this.damageArmorPiece(i, n);
  }
  damageArmorPiece(i, n) {
    const slots = this.inv.armor.slots;
    const s = slots[i];
    if (!s) return;
    // unbreaking on armour: each point of damage lands with chance 0.6 + 0.4 / (level + 1)
    const ub = enchLevel(s, 'unbreaking');
    if (ub) { let k = 0; for (let j = 0; j < n; j++) if (Math.random() < 0.6 + 0.4 / (ub + 1)) k++; n = k; }
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= ITEMS[s.id].durability) { slots[i] = null; this.game.sound.play('tool.break', this.x, this.y, this.z); }
  }

  knockback(fromX, fromZ, strength = 0.4) {
    let dx = this.x - fromX, dz = this.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    this.vx = this.vx / 2 + dx * strength;
    this.vz = this.vz / 2 + dz * strength;
    if (this.onGround) this.vy = Math.min(0.4, this.vy / 2 + strength);
  }

  die(cause, source) {
    if (this.vehicle) this.vehicle.dismount();
    this.dead = true;
    this.game.onPlayerDeath(cause, source);
  }

  // picking up experience: mending repairs a random damaged item first (2 durability per point)
  collectXp(n) {
    const inv = this.inv;
    const cands = [inv.held, ...inv.armor.slots].filter((s) => s && s.dmg > 0 && enchLevel(s, 'mending'));
    if (cands.length) {
      const s = cands[Math.floor(Math.random() * cands.length)];
      const fix = Math.min(n * 2, s.dmg);
      s.dmg -= fix;
      n -= Math.ceil(fix / 2);
    }
    if (n > 0) this.addXp(n);
  }

  spendLevels(n) { this.level = Math.max(0, this.level - n); }

  addXp(n) {
    this.xpTotal += n;
    let need = xpForLevel(this.level);
    this.xp += n / need;
    let leveled = false;
    while (this.xp >= 1) {
      this.xp -= 1;
      this.level++;
      need = xpForLevel(this.level);
      this.xp = this.xp * xpForLevel(this.level - 1) / need;
      leveled = true;
    }
    if (leveled && this.level % 5 === 0) this.game.sound.play('xp.levelup', this.x, this.y, this.z, 0.75);
    else if (leveled) this.game.sound.play('xp.levelup', this.x, this.y, this.z, 0.4);
    return leveled;
  }

  eat(food, itemId) {
    this.food = Math.min(20, this.food + food.hunger);
    this.saturation = Math.min(this.food, this.saturation + food.sat);
    if (food.effect) {
      if (food.effect.poison) this.poison = 100;
      if (food.effect.hunger && Math.random() < food.effect.hunger) this.hungerEffect = 600;
      if (food.effect.regen) this.regenEffect = 100;
    }
    void itemId;
  }

  respawnAt(x, y, z) {
    this.x = this.px = x; this.y = this.py = y; this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
    this.health = 20; this.food = 20; this.saturation = 5; this.exhaustion = 0; this.air = 300;
    this.fire = 0; this.fallDistance = 0; this.dead = false; this.hurtTime = 0; this.invuln = 60;
    this.poison = this.hungerEffect = this.regenEffect = 0;
  }

  toJSON() {
    return {
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, health: this.health, food: this.food,
      saturation: this.saturation, exhaustion: this.exhaustion, air: this.air, level: this.level, xp: this.xp, xpTotal: this.xpTotal,
      mode: this.mode, spawn: this.spawn, inv: this.inv.toJSON(), flying: this.flying, fire: this.fire, dead: this.dead,
      enchSeed: this.enchSeed, riding: this.vehicle ? this.vehicle.type : null,
    };
  }

  load(o) {
    if (!o) return;
    for (const k of ['x', 'y', 'z', 'yaw', 'pitch', 'health', 'food', 'saturation', 'exhaustion', 'air', 'level', 'xp', 'xpTotal', 'mode', 'spawn', 'flying', 'fire', 'enchSeed']) {
      if (o[k] !== undefined) this[k] = o[k];
    }
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.inv.load(o.inv);
    this.ridingType = o.riding || null; // remounted once vehicles load
    if (o.dead) this.health = 0;
    if (this.y > WH + 50) this.y = WH;
  }
}
