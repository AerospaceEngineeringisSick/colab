// Player interaction: targeting, mining, placing, using items and attacking.
import { BLOCKS, B, R, OPAQUE, SLABS, LIQUID } from '../shared/blocks.js';
import { ITEMS, I } from '../shared/items.js';
import { WH } from '../shared/constants.js';
import { raycast } from './raycast.js';
import { segBox, Arrow, Thrown } from './entities.js';
import { collisionBoxes, FACING_DIR } from '../shared/shapes.js';
import { enchLevel, armorLevel } from '../shared/enchant.js';
import { Boat, Minecart } from './vehicles.js';
import { Bobber } from './fishing.js';
import { boxBlocked } from './physics.js';

const boxBlockedAt = (w, x, y, z, wd, h) => boxBlocked(w, x - wd / 2, y, z - wd / 2, x + wd / 2, y + h, z + wd / 2);

const FACE_DIR = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SLAB_FULL = {};
for (const [n, s] of Object.entries(SLABS)) SLAB_FULL[n] = s.full;

export class Interaction {
  constructor(game) {
    this.game = game;
    this.target = null; // block hit
    this.targetEntity = null;
    this.mining = null; // {x,y,z,id,progress}
    this.useDelay = 0;
    this.breakDelay = 0;
    this.using = null; // {id, ticks, kind}
    this.lastAttackTick = -100;
  }
  get player() { return this.game.player; }
  get world() { return this.game.world; }

  reach() { return this.player.creative ? 5 : 4.5; }

  // per frame: what are we looking at?
  updateTarget(eye, dir) {
    const p = this.player;
    if (p.dead || p.mode === 'spectator') { this.target = null; this.targetEntity = null; return; }
    const hit = raycast(this.world, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], this.reach());
    let ent = null, best = hit ? hit.dist : this.reach();
    const er = p.creative ? 5 : 3.2;
    for (const e of this.game.entities.targetable(eye[0], eye[1], eye[2], er + 3)) {
      if (e === p.vehicle) continue;
      const t = segBox(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], e);
      if (t !== null && t <= Math.min(best, er)) { best = t; ent = e; }
    }
    this.targetEntity = ent;
    this.target = ent ? null : hit;
  }

  // ---------------------------------------------------------------- break speed
  breakTicks(id, meta) {
    const p = this.player, b = BLOCKS[id];
    if (b.hardness < 0) return Infinity;
    if (b.hardness === 0) return 0;
    const held = p.inv.held;
    const it = held ? ITEMS[held.id] : null;
    const tool = it && it.tool;
    let speed = 1;
    let harvest = !b.needsTool;
    if (tool) {
      if (tool.type === b.tool) {
        speed = tool.speed;
        if (tool.tier >= b.tier) harvest = true;
      }
      if (tool.type === 'shears') {
        if (id === B.cobweb || b.name.endsWith('_leaves')) { speed = 15; harvest = true; }
        else if (b.name.endsWith('_wool')) speed = 5;
        else if (id === B.vine) speed = 2;
      }
      if (tool.type === 'sword') {
        if (id === B.cobweb) { speed = 15; harvest = true; }
        else if (b.name.endsWith('_leaves') || b.plant || id === B.pumpkin || id === B.melon) speed = 1.5;
      }
    }
    if (b.needsTool && b.tool === 'pickaxe' && !(tool && tool.type === 'pickaxe' && tool.tier >= b.tier)) harvest = false;
    if (b.needsTool && b.tool === 'shovel' && id === B.snow && !(tool && tool.type === 'shovel')) harvest = false;
    // efficiency only helps a tool that is already the right one for the block
    const eff = enchLevel(held, 'efficiency');
    if (eff && speed > 1) speed += eff * eff + 1;
    if (p.eyeInWater && !armorLevel(p.inv, 'aqua_affinity')) speed /= 5;
    if (!p.onGround && !p.flying) speed /= 5;
    const dmg = speed / b.hardness / (harvest ? 30 : 100);
    if (dmg >= 1) return 0;
    return Math.ceil(1 / dmg);
  }

  canHarvest(id) {
    const b = BLOCKS[id];
    if (!b.needsTool) return true;
    const held = this.player.inv.held;
    const tool = held && ITEMS[held.id].tool;
    if (!tool) return false;
    if (id === B.cobweb) return tool.type === 'shears' || tool.type === 'sword';
    return tool.type === b.tool && tool.tier >= b.tier;
  }

  // ---------------------------------------------------------------- per tick
  tick(inp) {
    const g = this.game, p = this.player;
    if (this.useDelay > 0) this.useDelay--;
    if (this.breakDelay > 0) this.breakDelay--;
    if (p.dead || g.ui.screenOpen) { this.stopMining(); this.stopUsing(true); return; }
    // item use in progress (eat / drink / bow)
    if (this.using) {
      if (!inp.use) { this.releaseUse(); }
      else this.continueUse();
    }
    // attack / mine
    if (inp.attack) {
      if (this.targetEntity) {
        this.stopMining();
        if (inp.attackPressed || g.tickCount - this.lastAttackTick >= 10) this.attack(this.targetEntity);
      } else if (this.target) {
        this.mine(this.target, inp.attackPressed);
      } else {
        this.stopMining();
        if (inp.attackPressed) p.swing = 6;
      }
    } else this.stopMining();
    // use / place
    if (inp.use && !this.using && (inp.usePressed || this.useDelay === 0)) {
      this.useDelay = 4;
      this.use(inp.usePressed);
    }
  }

  stopMining() {
    if (this.mining) { this.mining = null; this.game.setBreakProgress(null); }
  }

  mine(hit, pressed) {
    const g = this.game, p = this.player;
    const { x, y, z } = hit;
    const v = this.world.getBlock(x, y, z);
    const id = v & 1023;
    if (!id) { this.stopMining(); return; }
    p.swing = Math.max(p.swing, 4);
    if (pressed && hit.face !== undefined) {
      const f = FACE_DIR[hit.face];
      if (this.world.getId(x + f[0], y + f[1], z + f[2]) === B.fire) {
        this.world.setBlock(x + f[0], y + f[1], z + f[2], 0, { sync: true });
        g.sound.play('fire.extinguish', x + 0.5, y + 1, z + 0.5, 0.5, 1.5);
        this.breakDelay = 5;
        return;
      }
    }
    if (p.creative) {
      if (pressed || this.breakDelay === 0) {
        const held = p.inv.held;
        if (held && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') return;
        this.breakDelay = 5;
        this.breakBlock(x, y, z, false);
      }
      return;
    }
    if (!this.mining || this.mining.x !== x || this.mining.y !== y || this.mining.z !== z || this.mining.id !== id) {
      if (this.breakDelay > 0) return;
      this.mining = { x, y, z, id, ticks: 0, total: this.breakTicks(id, v >>> 10) };
      if (this.mining.total === 0) { this.breakBlock(x, y, z, true); this.breakDelay = 5; this.mining = null; return; }
    }
    const m = this.mining;
    m.total = this.breakTicks(id, v >>> 10);
    m.ticks++;
    if (m.ticks % 4 === 1) { g.sound.dig(x + 0.5, y + 0.5, z + 0.5, id); g.particles.hitBlock(hit); }
    if (m.ticks >= m.total) {
      this.breakBlock(x, y, z, true);
      this.mining = null;
      this.breakDelay = 5;
      g.setBreakProgress(null);
    } else g.setBreakProgress({ x, y, z, stage: Math.min(9, Math.floor(m.ticks / m.total * 10)) });
  }

  breakBlock(x, y, z, survival) {
    const g = this.game, p = this.player;
    const v = this.world.getBlock(x, y, z);
    const id = v & 1023;
    const b = BLOCKS[id];
    const held = p.inv.held;
    const it = held ? ITEMS[held.id] : null;
    const toolType = it && it.tool ? it.tool.type : null;
    g.breakBlockNaturally(x, y, z, survival && this.canHarvest(id), false, toolType, true);
    if (survival) {
      p.addExhaustion(0.005);
      if (it && it.durability && b.hardness > 0) g.damageHeld(it.tool && it.tool.type === 'sword' ? 2 : 1);
      if (it && it.tool && it.tool.type === 'shears' && b.hardness === 0 && (b.plant || id === B.vine)) g.damageHeld(1);
    }
    g.stats.mined++;
  }

  // ---------------------------------------------------------------- combat
  attack(e) {
    const g = this.game, p = this.player;
    this.lastAttackTick = g.tickCount;
    p.swing = 6;
    if (e.dead) return;
    const held = p.inv.held;
    const it = held ? ITEMS[held.id] : null;
    let dmg = it && it.damage ? it.damage : 1;
    const crit = p.vy < 0 && !p.onGround && !p.inWater && !p.flying;
    if (crit) { dmg *= 1.5; g.particles.crit(e.x, e.y + e.h * 0.7, e.z, 12); }
    // damage enchantments
    const sharp = enchLevel(held, 'sharpness'), smite = enchLevel(held, 'smite'), bane = enchLevel(held, 'bane_of_arthropods');
    let bonus = sharp ? 0.5 * sharp + 0.5 : 0;
    if (smite && e.def.undead) bonus += 2.5 * smite;
    if (bane && e.def.spider) bonus += 2.5 * bane;
    if (bonus) { dmg += bonus; g.particles.crit(e.x, e.y + e.h * 0.7, e.z, 6); }
    if (g.difficulty === 0 && e.def.hostile) dmg = Math.max(dmg, 4);
    const ok = e.hurt(dmg, p, p.x, p.z, p.sprinting ? 'sprint' : 'player');
    if (ok) {
      const kb = enchLevel(held, 'knockback'), fa = enchLevel(held, 'fire_aspect');
      if (kb && e.knock) { const k = 1 + kb * 1.25; e.knock[0] *= k; e.knock[1] *= k; }
      if (fa && !e.dead) e.fire = Math.max(e.fire || 0, 80 * fa);
      if (e.isMob) p.lastTargetMob = e;
      if (p.sprinting) p.sprinting = false;
      p.addExhaustion(0.1);
      if (it && it.durability) g.damageHeld(it.tool && it.tool.type === 'sword' ? 1 : 2);
    }
  }

  // ---------------------------------------------------------------- right click
  use(pressed) {
    const g = this.game, p = this.player;
    const held = p.inv.held;
    const it = held ? ITEMS[held.id] : null;
    // entity interaction
    if (this.targetEntity && pressed) {
      const r = this.targetEntity.interact(p);
      if (r) {
        p.swing = 6;
        if (r === 'consume' && !p.creative) this.consumeHeld(1);
        else if (r === 'damage') g.damageHeld(1);
        else if (r && r.replace) this.replaceHeld(I[r.replace]);
        return;
      }
    }
    const hit = this.target;
    // block interaction (unless sneaking with an item)
    if (hit && pressed && !(p.sneaking && held)) {
      if (g.interactBlock(hit.x, hit.y, hit.z, hit)) { p.swing = 6; return; }
    }
    if (it) {
      if (it.use === 'boat') { if (pressed) this.placeBoat(it); return; }
      if (it.use === 'fish') { if (pressed) this.useRod(); return; }
      if (it.use === 'minecart') { if (pressed && hit && BLOCKS[hit.id].render === R.RAIL) this.placeMinecart(hit); return; }
      if (it.food) { if (pressed) this.startUse(it, 'eat'); return; }
      if (it.use === 'milk') { if (pressed) this.startUse(it, 'drink'); return; }
      if (it.use === 'bow') { if (pressed && (p.creative || p.inv.count(I.arrow) > 0)) this.startUse(it, 'bow'); return; }
      if (it.use === 'throw') { if (pressed) this.throwItem(it); return; }
      if (it.use === 'bucket') { if (pressed) this.useBucket(it); return; }
      if (it.use === 'spawn_egg') { if (pressed && hit) this.spawnEgg(it, hit); return; }
      if (it.armor && pressed) { this.equipArmor(it); return; }
      if (hit) {
        if (it.tool && it.tool.type === 'hoe' && this.till(hit)) return;
        if (it.tool && it.tool.type === 'shovel' && this.makePath(hit)) return;
        if (it.use === 'bonemeal' && pressed) {
          if (g.ticks.fertilize(hit.x, hit.y, hit.z)) { p.swing = 6; if (!p.creative) this.consumeHeld(1); g.advance('bonemeal'); }
          return;
        }
        if ((it.use === 'ignite' || it.use === 'fire_charge') && pressed) {
          p.swing = 6;
          if (g.ignite(hit) && !p.creative) {
            if (it.use === 'ignite') g.damageHeld(1);
            else this.consumeHeld(1);
          }
          return;
        }
        if (it.place) { this.placeCrop(it, hit); return; }
        if (it.placeBlock) { this.place({ ...it, block: B[it.placeBlock] }, hit); return; }
        if (it.block !== undefined && !it.hidden) { this.place(it, hit); return; }
      }
    }
  }

  // cast the line, or reel it in
  useRod() {
    const g = this.game, p = this.player;
    p.swing = 6;
    if (p.bobber && !p.bobber.removed) {
      const wear = p.bobber.reel();
      if (wear) g.damageHeld(wear);
      return;
    }
    p.bobber = g.entities.add(new Bobber(g, p));
    g.sound.play('throw', p.x, p.y + 1.5, p.z, 0.5, 0.4 / (Math.random() * 0.4 + 0.8));
  }

  // boats go on water (or on the ground), facing the way the player looks
  placeBoat(it) {
    const g = this.game, p = this.player, w = this.world;
    const eye = g.eyePos(), d = p.lookDir();
    const hit = raycast(w, eye[0], eye[1], eye[2], d[0], d[1], d[2], this.reach(), 'any');
    if (!hit) return;
    let y = hit.y + 1;
    if (LIQUID[hit.id]) y = hit.y + 0.6;
    else if (hit.face !== 2) return;
    const x = hit.px, z = hit.pz;
    if (boxBlockedAt(w, x, y, z, 1.375, 0.5625)) return;
    g.entities.add(new Boat(g, x, y, z, it.wood, p.yaw));
    g.sound.play('place.node', x, y, z, 0.8);
    p.swing = 6;
    if (!p.creative) this.consumeHeld(1);
  }
  placeMinecart(hit) {
    const g = this.game, p = this.player;
    const c = new Minecart(g, hit.x + 0.5, hit.y, hit.z + 0.5);
    g.entities.add(c);
    g.sound.play('place.metal', hit.x + 0.5, hit.y, hit.z + 0.5, 0.8);
    p.swing = 6;
    if (!p.creative) this.consumeHeld(1);
  }

  startUse(it, kind) {
    const p = this.player;
    if (kind === 'eat' && p.food >= 20 && !p.creative && !(it.food && it.food.effect && it.food.effect.regen)) return;
    this.using = { id: it.id, ticks: 0, kind };
    p.usingItem = true;
  }
  continueUse() {
    const g = this.game, p = this.player, u = this.using;
    const held = p.inv.held;
    if (!held || held.id !== u.id) { this.stopUsing(true); return; }
    u.ticks++;
    if (u.kind === 'eat' || u.kind === 'drink') {
      if (u.ticks % 4 === 0 && u.ticks > 6) {
        if (u.kind === 'eat') { g.sound.play('player.eat', p.x, p.y, p.z, 0.5, 0.9 + Math.random() * 0.3); const d = p.lookDir(); g.particles.itemCrumbs(p.x + d[0] * 0.4, p.y + p.eye - 0.2, p.z + d[2] * 0.4, u.id, 3); }
        else g.sound.play('player.drink', p.x, p.y, p.z, 0.5);
      }
      if (u.ticks >= 32) {
        const it = ITEMS[u.id];
        if (u.kind === 'eat') {
          p.eat(it.food, u.id);
          g.sound.play('player.eat', p.x, p.y, p.z, 0.6, 0.8);
          if (!p.creative) {
            if (it.food.returns) this.replaceHeld(I[it.food.returns]);
            else this.consumeHeld(1);
          }
          g.advance('eat');
        } else {
          p.poison = 0; p.hungerEffect = 0;
          if (!p.creative) this.replaceHeld(I.bucket);
        }
        this.stopUsing(false);
      }
    }
  }
  releaseUse() {
    const u = this.using;
    if (u && u.kind === 'bow') this.shootBow(u.ticks);
    this.stopUsing(false);
  }
  stopUsing() {
    this.using = null;
    if (this.player) this.player.usingItem = false;
  }

  shootBow(ticks) {
    const g = this.game, p = this.player;
    let f = ticks / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    if (f > 1) f = 1;
    const d = p.lookDir();
    const sp = f * 3;
    const bow = p.inv.held;
    const power = enchLevel(bow, 'power'), infinity = enchLevel(bow, 'infinity');
    const a = new Arrow(g, p.x + d[0] * 0.3, p.y + p.eye - 0.1, p.z + d[2] * 0.3, d[0] * sp + p.vx, d[1] * sp + (p.onGround ? 0 : p.vy), d[2] * sp + p.vz, p, power ? 2.5 + 0.5 * power : 2);
    a.crit = f >= 1;
    a.fire = !!enchLevel(bow, 'flame');
    a.punch = enchLevel(bow, 'punch');
    if (infinity) a.pickup = false;
    g.entities.add(a);
    g.sound.play('bow.shoot', p.x, p.y, p.z, 1, 1 / (Math.random() * 0.4 + 1.2) + f * 0.5);
    if (!p.creative) { if (!infinity) p.inv.remove(I.arrow, 1); g.damageHeld(1); }
    g.advance('bow');
  }

  throwItem(it) {
    const g = this.game, p = this.player;
    const d = p.lookDir();
    const sp = 1.5;
    g.entities.add(new Thrown(g, p.x + d[0] * 0.3, p.y + p.eye - 0.1, p.z + d[2] * 0.3, d[0] * sp + p.vx, d[1] * sp + 0.1, d[2] * sp + p.vz, it.id, p));
    g.sound.play('throw', p.x, p.y, p.z, 0.5, 0.5);
    p.swing = 6;
    if (!p.creative) this.consumeHeld(1);
  }

  useBucket(it) {
    const g = this.game, p = this.player, w = this.world;
    const eye = g.eyePos(), d = p.lookDir();
    if (!it.fluid) {
      const hit = raycast(w, eye[0], eye[1], eye[2], d[0], d[1], d[2], this.reach(), 'source');
      if (!hit || !LIQUID[hit.id]) {
        return;
      }
      w.setBlock(hit.x, hit.y, hit.z, 0);
      g.sound.play(hit.id === B.water ? 'dug.water' : 'place.lava', hit.x, hit.y, hit.z, 0.8);
      this.replaceHeld(hit.id === B.water ? I.water_bucket : I.lava_bucket);
      p.swing = 6;
      return;
    }
    const hit = this.target;
    if (!hit) return;
    let x = hit.x, y = hit.y, z = hit.z;
    if (!BLOCKS[hit.id].replaceable) { const f = FACE_DIR[hit.face]; x += f[0]; y += f[1]; z += f[2]; }
    const cur = w.getId(x, y, z);
    if (cur && !BLOCKS[cur].replaceable) return;
    const fluid = it.fluid === 'water' ? B.water : B.lava;
    if (fluid === B.water && g.dim === 'nether') {
      g.sound.play('fire.extinguish', x + 0.5, y + 0.5, z + 0.5, 0.6, 1.8);
      g.particles.smoke(x + 0.5, y + 0.5, z + 0.5, 8, 0.8, 0.5);
      p.swing = 6;
      if (!p.creative) this.replaceHeld(I.bucket);
      return;
    }
    if (cur && !LIQUID[cur]) g.breakBlockNaturally(x, y, z, true, true);
    w.setBlock(x, y, z, fluid);
    g.ticks.schedule(x, y, z, g.ticks.flowDelay(fluid === B.water));
    g.sound.play(fluid === B.water ? 'place.water' : 'place.lava', x, y, z, 0.8);
    p.swing = 6;
    if (!p.creative) this.replaceHeld(I.bucket);
  }

  spawnEgg(it, hit) {
    const g = this.game, p = this.player;
    const f = FACE_DIR[hit.face];
    g.spawnMob(it.egg.mob, hit.x + 0.5 + f[0], hit.y + (f[1] > 0 ? 1 : f[1] < 0 ? -1 : 0), hit.z + 0.5 + f[2], { persistent: true });
    p.swing = 6;
    if (!p.creative) this.consumeHeld(1);
  }

  equipArmor(it) {
    const g = this.game, p = this.player;
    const slot = it.armor.slot;
    const cur = p.inv.armor.slots[slot];
    p.inv.armor.slots[slot] = p.inv.held;
    p.inv.held = cur;
    g.sound.play('armor.equip', p.x, p.y, p.z, 0.8);
    g.advance('armor');
  }

  till(hit) {
    const g = this.game, w = this.world;
    const id = hit.id;
    if ((id === B.grass_block || id === B.dirt || id === B.dirt_path || id === B.coarse_dirt) && w.getId(hit.x, hit.y + 1, hit.z) === 0 && hit.face !== 3) {
      w.setBlock(hit.x, hit.y, hit.z, id === B.coarse_dirt ? B.dirt : B.farmland);
      g.sound.play('step.gravel', hit.x, hit.y, hit.z, 0.8);
      g.damageHeld(1);
      this.player.swing = 6;
      g.advance('hoe');
      return true;
    }
    return false;
  }
  makePath(hit) {
    const g = this.game, w = this.world;
    if (hit.id === B.grass_block && w.getId(hit.x, hit.y + 1, hit.z) === 0 && hit.face !== 3) {
      w.setBlock(hit.x, hit.y, hit.z, B.dirt_path);
      g.sound.play('step.grass', hit.x, hit.y, hit.z, 0.8);
      g.damageHeld(1);
      this.player.swing = 6;
      return true;
    }
    return false;
  }

  placeCrop(it, hit) {
    const g = this.game, w = this.world;
    if (hit.id !== B.farmland || hit.face !== 2) return;
    if (w.getId(hit.x, hit.y + 1, hit.z) !== 0) return;
    const bid = B[it.place];
    w.setBlock(hit.x, hit.y + 1, hit.z, bid);
    g.sound.play('dig.grass', hit.x, hit.y + 1, hit.z, 0.7);
    this.player.swing = 6;
    if (!this.player.creative) this.consumeHeld(1);
    g.advance('plant');
  }

  // ---------------------------------------------------------------- placing blocks
  place(it, hit) {
    const g = this.game, p = this.player, w = this.world;
    const bid = it.block;
    const b = BLOCKS[bid];
    const tb = BLOCKS[hit.id];
    let x = hit.x, y = hit.y, z = hit.z;
    let face = hit.face;
    // slab on slab of the same kind -> full block
    if (b.render === R.SLAB && hit.id === bid) {
      const meta = hit.meta & 1;
      if ((face === 2 && meta === 0) || (face === 3 && meta === 1)) {
        const full = B[SLAB_FULL[b.name]];
        if (this.fits(x, y, z, full, 0)) { this.commitPlace(x, y, z, full, it); return; }
      }
    }
    // snow layers stack
    if (bid === B.snow && hit.id === B.snow && (hit.meta & 7) < 7 && face === 2) {
      this.commitPlace(x, y, z, B.snow | (((hit.meta & 7) + 1) << 10), it);
      return;
    }
    if (!(tb.replaceable && hit.id !== bid) || (hit.id === B.snow && hit.meta > 0)) {
      const f = FACE_DIR[face];
      x += f[0]; y += f[1]; z += f[2];
    } else face = 2;
    if (y < 0 || y >= WH) return;
    const cur = w.getBlock(x, y, z);
    const cid = cur & 1023;
    if (cid && !BLOCKS[cid].replaceable) {
      // slab into the other half of an existing slab
      if (b.render === R.SLAB && cid === bid) {
        const full = B[SLAB_FULL[b.name]];
        if (this.fits(x, y, z, full, 0)) this.commitPlace(x, y, z, full, it);
      }
      return;
    }
    if (cid === bid && !b.liquid) return;
    const meta = this.placeMeta(bid, face, hit, x, y, z);
    if (meta === null) return;
    // validity checks
    if (!this.canPlaceAt(bid, meta, x, y, z, face)) return;
    if (!this.fits(x, y, z, bid, meta)) return;
    // two-block structures
    if (bid === B.oak_door) {
      if (y + 1 >= WH || (w.getId(x, y + 1, z) && !BLOCKS[w.getId(x, y + 1, z)].replaceable)) return;
      this.commitPlace(x, y, z, bid | (meta << 10), it, true);
      w.setBlock(x, y + 1, z, bid | ((meta | 4) << 10));
      return;
    }
    if (bid === B.red_bed) {
      const [dx, dz] = FACING_DIR[meta & 3];
      const hx = x + dx, hz = z + dz;
      const hid = w.getId(hx, y, hz);
      if ((hid && !BLOCKS[hid].replaceable) || !BLOCKS[w.getId(hx, y - 1, hz)].solid) return;
      this.commitPlace(x, y, z, bid | (meta << 10), it, true);
      w.setBlock(hx, y, hz, bid | ((meta | 4) << 10));
      return;
    }
    this.commitPlace(x, y, z, bid | (meta << 10), it);
  }

  commitPlace(x, y, z, v, it, noConsume) {
    const g = this.game, p = this.player, w = this.world;
    const cur = w.getId(x, y, z);
    if (cur && BLOCKS[cur].plant && !LIQUID[cur]) g.breakBlockNaturally(x, y, z, false, true);
    // waterlogged replace keeps nothing (no waterlogging)
    w.setBlock(x, y, z, v, { sync: true });
    g.sound.place(x + 0.5, y + 0.5, z + 0.5, v & 1023);
    p.swing = 6;
    g.onBlockPlaced(x, y, z, v);
    if (!p.creative && !noConsume) this.consumeHeld(1);
    else if (!p.creative && noConsume) this.consumeHeld(1);
  }

  // block state from placement context. returns null if it can't be placed this way
  placeMeta(bid, face, hit, x, y, z) {
    const p = this.player;
    const b = BLOCKS[bid];
    const f = p.facing();
    if (b.rotate === 'axis') return face < 2 ? 1 : face < 4 ? 0 : 2;
    if (bid === B.torch || bid === B.redstone_torch || b.render === R.LEVER || b.render === R.BUTTON) {
      if (face === 3) return null;
      if (face === 2) return 0;
      // wall torch faces away from the wall it is on
      return [3, 1, 0, 0, 0, 2][face] + 1;
    }
    if (b.render === R.REPEATER) return f; // points away from the player
    if (b.redstone === 'piston') {
      // faces the player, up or down when looked at steeply
      if (p.pitch < -0.85) return 1;
      if (p.pitch > 0.85) return 0;
      return [2, 5, 3, 4][f]; // player looking south -> face north, etc.
    }
    if (bid === B.ladder) {
      if (face < 2 || face > 3) return [3, 1, 0, 0, 0, 2][face];
      return null;
    }
    if (bid === B.vine) {
      if (face === 2 || face === 3) return null;
      return [2, 1, 0, 0, 8, 4][face];
    }
    if (b.render === R.STAIRS) {
      const upside = face === 3 || (face !== 2 && (hit.py - hit.y) > 0.5);
      return f | (upside ? 4 : 0);
    }
    if (b.render === R.SLAB) return face === 3 || (face !== 2 && (hit.py - hit.y) > 0.5) ? 1 : 0;
    if (bid === B.oak_door) return f;
    if (bid === B.red_bed) return f;
    if (b.rotate === 'facing') return (f + 2) & 3; // face the player
    if (b.name.endsWith('_leaves')) return 1; // persistent
    return 0;
  }

  canPlaceAt(bid, meta, x, y, z, face) {
    const w = this.world, b = BLOCKS[bid];
    const below = w.getId(x, y - 1, z);
    if (b.plant) {
      if (bid === B.cactus) {
        if (!(below === B.sand || below === B.red_sand || below === B.cactus)) return false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (BLOCKS[w.getId(x + dx, y, z + dz)].solid) return false;
        return true;
      }
      if (bid === B.sugar_cane) {
        if (below === B.sugar_cane) return true;
        if (!(below === B.grass_block || below === B.dirt || below === B.sand || below === B.red_sand || below === B.podzol || below === B.coarse_dirt)) return false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getId(x + dx, y - 1, z + dz) === B.water) return true;
        return false;
      }
      if (bid === B.brown_mushroom || bid === B.red_mushroom) return OPAQUE[below] === 1;
      if (bid === B.dead_bush) return below === B.sand || below === B.red_sand || below === B.grass_block || below === B.dirt;
      if (b.soil === 'soul_sand') return below === B.soul_sand;
      if (b.soil === 'nether') return [B.crimson_nylium, B.warped_nylium, B.soul_sand, B.soul_soil, B.netherrack, B.grass_block, B.dirt, B.podzol, B.coarse_dirt, B.farmland].includes(below);
      return below === B.grass_block || below === B.dirt || below === B.podzol || below === B.coarse_dirt || below === B.farmland;
    }
    if (bid === B.torch || bid === B.redstone_torch) {
      if (meta === 0) return BLOCKS[below].solid || BLOCKS[below].render === R.FENCE;
      const back = [[0, -1], [1, 0], [0, 1], [-1, 0]][meta - 1];
      return OPAQUE[w.getId(x + back[0], y, z + back[1])] === 1;
    }
    if (bid === B.ladder) {
      const back = [[0, -1], [1, 0], [0, 1], [-1, 0]][meta & 3];
      return OPAQUE[w.getId(x + back[0], y, z + back[1])] === 1;
    }
    if (bid === B.weeping_vines) { const up = w.getId(x, y + 1, z); return up === bid || BLOCKS[up].solid; }
    if (bid === B.twisting_vines) return below === bid || BLOCKS[below].solid;
    if (bid === B.lily_pad) return below === B.water;
    if (b.render === R.RAIL || b.render === R.WIRE || b.render === R.PLATE || b.render === R.REPEATER) return OPAQUE[below] === 1;
    if (b.render === R.LEVER || b.render === R.BUTTON) {
      if (meta === 0) return OPAQUE[below] === 1;
      const back = [[0, -1], [1, 0], [0, 1], [-1, 0]][(meta - 1) & 3];
      return OPAQUE[w.getId(x + back[0], y, z + back[1])] === 1;
    }
    if (bid === B.snow) return BLOCKS[below].solid && below !== B.ice;
    if (bid === B.oak_door) return BLOCKS[below].solid;
    if (bid === B.cake) return BLOCKS[below].solid;
    void face;
    return true;
  }

  // the new block must not overlap the player or mobs
  fits(x, y, z, bid, meta) {
    const p = this.player;
    const boxes = collisionBoxes(bid, meta);
    for (const c of boxes) {
      const x0 = x + c[0], y0 = y + c[1], z0 = z + c[2], x1 = x + c[3], y1 = y + c[4], z1 = z + c[5];
      if (p.mode !== 'spectator' && p.x - 0.3 < x1 - 0.001 && p.x + 0.3 > x0 + 0.001 && p.y < y1 - 0.001 && p.y + p.h > y0 + 0.001 && p.z - 0.3 < z1 - 0.001 && p.z + 0.3 > z0 + 0.001) return false;
      for (const e of this.game.entities.mobsNear(x + 0.5, y + 0.5, z + 0.5, 3)) if (e.intersects(x0, y0, z0, x1, y1, z1)) return false;
    }
    return true;
  }

  consumeHeld(n) {
    const p = this.player;
    const h = p.inv.held;
    if (!h) return;
    h.count -= n;
    if (h.count <= 0) p.inv.held = null;
  }
  replaceHeld(id) {
    const p = this.player;
    const h = p.inv.held;
    if (h && h.count > 1) {
      h.count--;
      const left = p.inv.give({ id, count: 1, dmg: 0 });
      if (left) this.game.dropItem(p.x, p.y + 1.2, p.z, { id, count: 1 });
    } else p.inv.held = { id, count: 1, dmg: 0 };
  }
}
