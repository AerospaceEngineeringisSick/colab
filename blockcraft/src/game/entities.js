// Non-mob entities and the entity manager.
import * as THREE from 'three';
import { BLOCKS, B, R, OPAQUE } from '../shared/blocks.js';
import { ITEMS, I } from '../shared/items.js';
import { moveBox, contacts } from './physics.js';
import { makeItemObject } from '../engine/itemmesh.js';
import { entityMaterial } from '../engine/materials.js';
import { imageTexture, images } from '../engine/textures.js';
import { boxGeometry } from '../engine/models.js';
import { raycast } from './raycast.js';

let nextId = 1;

export class Entity {
  constructor(game, x, y, z) {
    this.game = game;
    this.id = nextId++;
    this.x = x; this.y = y; this.z = z;
    this.px = x; this.py = y; this.pz = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.w = 0.25; this.h = 0.25;
    this.yaw = 0; this.pyaw = 0;
    this.onGround = false;
    this.age = 0;
    this.removed = false;
    this.object = null;
    this.inWater = false;
    this.fire = 0;
  }
  get world() { return this.game.world; }
  tick() {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw;
    this.age++;
  }
  physics(gravity = 0.04, drag = 0.98, step = 0) {
    const c = contacts(this.world, this.x, this.y, this.z, this.w, this.h);
    this.inWater = c.water; this.inLava = c.lava;
    if (c.water) { this.vy += 0.01; this.vx *= 0.9; this.vz *= 0.9; this.vy *= 0.9; }
    moveBox(this.world, this, this.vx, this.vy, this.vz, step);
    if (this.hitX) this.vx = 0;
    if (this.hitZ) this.vz = 0;
    if (this.hitV) this.vy = 0;
    this.vy -= gravity;
    this.vy *= drag;
    const f = this.onGround ? 0.6 * 0.98 : drag;
    this.vx *= f; this.vz *= f;
  }
  lerp(a) {
    return [this.px + (this.x - this.px) * a, this.py + (this.y - this.py) * a, this.pz + (this.z - this.pz) * a];
  }
  light() {
    const l = this.world.getLight(Math.floor(this.x), Math.floor(this.y + this.h * 0.5), Math.floor(this.z));
    return [l >> 4, l & 15];
  }
  render() {}
  remove() {
    this.removed = true;
    if (this.object) {
      this.object.parent && this.object.parent.remove(this.object);
      this.object.traverse((o) => { if (o.material && o.material.dispose) o.material.dispose(); });
      if (this.object.userData.dispose) this.object.userData.dispose();
      this.object = null;
    }
  }
  distTo(x, y, z) { const dx = this.x - x, dy = this.y - y, dz = this.z - z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  intersects(x0, y0, z0, x1, y1, z1) {
    const hw = this.w / 2;
    return this.x - hw < x1 && this.x + hw > x0 && this.y < y1 && this.y + this.h > y0 && this.z - hw < z1 && this.z + hw > z0;
  }
  toJSON() { return null; }
}

// ------------------------------------------------------------------ dropped items
export class ItemEntity extends Entity {
  constructor(game, x, y, z, stack, opts = {}) {
    super(game, x, y, z);
    this.type = 'item';
    this.stack = stack;
    this.w = 0.25; this.h = 0.25;
    this.pickupDelay = opts.delay ?? 10;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.vx = opts.vx ?? (Math.random() - 0.5) * 0.2;
    this.vy = opts.vy ?? 0.2;
    this.vz = opts.vz ?? (Math.random() - 0.5) * 0.2;
    this.lifetime = 6000; // 5 minutes
    this.shownCount = 0;
  }
  tick() {
    super.tick();
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.physics(0.04, 0.98);
    if (this.inLava) { this.game.sound.play('item.burn', this.x, this.y, this.z, 0.4); this.game.particles.smoke(this.x, this.y + 0.2, this.z, 3, 0.3, 0.3); this.remove(); return; }
    if (this.age >= this.lifetime) { this.remove(); return; }
    // merge with nearby identical stacks
    if (this.age % 20 === 5) {
      for (const e of this.game.entities.near(this.x, this.y, this.z, 1.5)) {
        if (e === this || e.type !== 'item' || e.removed) continue;
        const a = this.stack, b = e.stack;
        if (a.id !== b.id || (a.dmg || 0) !== (b.dmg || 0) || ITEMS[a.id].durability) continue;
        const max = ITEMS[a.id].maxStack;
        if (a.count + b.count > max) continue;
        a.count += b.count;
        this.age = Math.min(this.age, e.age);
        e.remove();
      }
    }
    // pickup
    const p = this.game.player;
    if (this.pickupDelay === 0 && !p.dead && p.mode !== 'spectator') {
      const dx = p.x - this.x, dy = (p.y + 0.5) - this.y, dz = p.z - this.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 1.6 * 1.6) {
        const before = this.stack.count;
        const left = p.inv.give(this.stack);
        if (left < before) {
          this.game.onPickup(this.stack.id, before - left, this);
          this.stack.count = left;
          if (left <= 0) this.remove();
        }
      }
    }
  }
  ensureObject() {
    const n = Math.min(this.stack.count > 32 ? 4 : this.stack.count > 16 ? 3 : this.stack.count > 1 ? 2 : 1, 4);
    if (this.object && this.shownCount === n) return;
    if (this.object) { this.game.entities.group.remove(this.object); this.object.traverse((o) => o.material && o.material.dispose && o.material.dispose()); }
    const g = new THREE.Group();
    this.parts = [];
    for (let i = 0; i < n; i++) {
      const o = makeItemObject(this.stack.id);
      const block = o.userData.block;
      o.scale.setScalar(block ? 0.25 : 0.42);
      if (i) o.position.set((Math.sin(i * 7.1) * 0.06), (block ? 0.04 : 0.02) * i, (Math.cos(i * 3.3) * 0.06 - (block ? 0 : i * 0.03)));
      g.add(o);
      this.parts.push(o);
    }
    this.shownCount = n;
    this.object = g;
    this.game.entities.group.add(g);
  }
  render(a, t) {
    this.ensureObject();
    const [x, y, z] = this.lerp(a);
    const bob = Math.sin(t * 2.2 + this.bobOffset) * 0.08 + 0.1;
    this.object.position.set(x, y + bob + 0.05, z);
    this.object.rotation.y = t * 1.2 + this.bobOffset;
    const [s, b] = this.light();
    for (const p of this.parts) p.userData.setLight(s, b);
  }
  toJSON() { return { t: 'item', x: this.x, y: this.y, z: this.z, s: [this.stack.id, this.stack.count, this.stack.dmg || 0], age: this.age }; }
}

// ------------------------------------------------------------------ experience orbs
let orbTex = null;
export class XpOrb extends Entity {
  constructor(game, x, y, z, value) {
    super(game, x, y, z);
    this.type = 'xp';
    this.value = value;
    this.w = 0.3; this.h = 0.3;
    this.vx = (Math.random() - 0.5) * 0.2; this.vy = Math.random() * 0.2 + 0.1; this.vz = (Math.random() - 0.5) * 0.2;
    this.delay = 10;
  }
  tick() {
    super.tick();
    const p = this.game.player;
    if (this.delay > 0) this.delay--;
    if (!p.dead && this.delay === 0) {
      const dx = p.x - this.x, dy = p.y + p.eye / 2 - this.y, dz = p.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 8) {
        const f = (1 - d / 8) ** 2 * 0.1;
        this.vx += (dx / d) * f; this.vy += (dy / d) * f; this.vz += (dz / d) * f;
      }
      if (d < 1.2) {
        p.addXp(this.value);
        this.game.sound.play('xp.orb', this.x, this.y, this.z, 0.25, 0.55 + Math.random() * 0.4);
        this.remove();
        return;
      }
    }
    this.physics(0.03, 0.98);
    if (this.age > 6000) this.remove();
  }
  render(a, t) {
    if (!this.object) {
      if (!orbTex) {
        // first 15x15 frame of the orb strip, recoloured per size
        orbTex = imageTexture(images['env/xp_orb']);
      }
      const m = new THREE.SpriteMaterial({ map: orbTex, color: 0xffffff, depthWrite: false, transparent: true });
      const frames = Math.max(1, Math.floor(images['env/xp_orb'].height / images['env/xp_orb'].width));
      const sz = this.value >= 17 ? 3 : this.value >= 7 ? 2 : this.value >= 3 ? 1 : 0;
      this.frame = Math.min(frames - 1, sz);
      orbTex.repeat.set(1, 1 / frames);
      this.object = new THREE.Sprite(m);
      this.object.scale.setScalar(0.25 + sz * 0.05);
      this.game.entities.group.add(this.object);
      this.frames = frames;
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y + 0.15, z);
    const pulse = (Math.sin(t * 6 + this.id) + 1) / 2;
    this.object.material.color.setRGB(0.6 + pulse * 0.4, 1, 0.25 + pulse * 0.2);
  }
}

// ------------------------------------------------------------------ arrows
let arrowGeo = null;
export class Arrow extends Entity {
  constructor(game, x, y, z, vx, vy, vz, shooter, damage = 2) {
    super(game, x, y, z);
    this.type = 'arrow';
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.shooter = shooter;
    this.damage = damage;
    this.stuck = false;
    this.w = 0.1; this.h = 0.1;
    this.pickup = shooter === game.player && game.player.mode !== 'creative';
    this.pitch = 0;
    this.crit = false;
  }
  tick() {
    super.tick();
    if (this.stuck) {
      if (this.age > 1200) this.remove();
      // player picks up stuck arrows
      const p = this.game.player;
      if (this.pickup && this.distTo(p.x, p.y + 0.5, p.z) < 1.5) {
        if (p.inv.give({ id: I.arrow, count: 1, dmg: 0 }) === 0) { this.game.sound.pop(); this.remove(); }
      }
      // falls if the block disappears
      if (!OPAQUE[this.world.getId(this.sx, this.sy, this.sz)] && !BLOCKS[this.world.getId(this.sx, this.sy, this.sz)].solid) { this.stuck = false; }
      return;
    }
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    // block hit
    const hit = raycast(this.world, this.x, this.y, this.z, this.vx / sp, this.vy / sp, this.vz / sp, sp);
    let end = hit ? hit.dist : sp;
    // entity hit along the segment
    let target = null, tbest = end;
    for (const e of this.game.entities.mobsNear(this.x, this.y, this.z, sp + 2)) {
      if (e === this.shooter || e.dead) continue;
      const t = segBox(this.x, this.y, this.z, this.vx / sp, this.vy / sp, this.vz / sp, e);
      if (t !== null && t < tbest) { tbest = t; target = e; }
    }
    const p = this.game.player;
    if (this.shooter !== p && !p.dead) {
      const t = segBox(this.x, this.y, this.z, this.vx / sp, this.vy / sp, this.vz / sp, p);
      if (t !== null && t < tbest) { tbest = t; target = p; }
    }
    if (target && this.age > 1) {
      const dmg = Math.ceil(sp * this.damage) + (this.crit ? Math.floor(Math.random() * 3) : 0);
      if (target === p) {
        if (p.damage(dmg, 'arrow', false, this.shooter) > 0) { p.knockback(this.x - this.vx, this.z - this.vz, 0.3); this.game.sound.play('bow.hitplayer', p.x, p.y, p.z, 0.8); }
      } else {
        target.hurt(dmg, this.shooter, this.x - this.vx, this.z - this.vz, 'arrow');
        this.game.sound.play('bow.hit', target.x, target.y, target.z, 0.8);
      }
      this.remove();
      return;
    }
    if (hit) {
      this.x = hit.px - this.vx / sp * 0.05; this.y = hit.py - this.vy / sp * 0.05; this.z = hit.pz - this.vz / sp * 0.05;
      this.stuck = true; this.sx = hit.x; this.sy = hit.y; this.sz = hit.z;
      this.game.sound.play('bow.hit', this.x, this.y, this.z, 0.6);
      this.age = 0;
      if (hit.id === B.tnt && this.fire) this.game.igniteTnt(hit.x, hit.y, hit.z);
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    const inWater = this.world.getId(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.water;
    const drag = inWater ? 0.6 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= 0.05;
    if (this.crit && this.age % 2 === 0) this.game.particles.crit(this.x, this.y, this.z, 1);
    if (this.age > 1200) this.remove();
  }
  render(a) {
    if (!this.object) {
      if (!arrowGeo) {
        // shaft from the arrow entity texture (32 x 5 strip at top-left of a 64x64 sheet in vanilla layout)
        const g = new THREE.BoxGeometry(0.5, 0.06, 0.06);
        arrowGeo = g;
      }
      const tex = imageTexture('item/arrow');
      const m = entityMaterial(tex, { alphaTest: 0.5, side: THREE.DoubleSide });
      // two crossed planes showing the arrow item sprite, like vanilla's arrow
      const grp = new THREE.Group();
      const plane = new THREE.PlaneGeometry(0.6, 0.6);
      const p1 = new THREE.Mesh(plane, m);
      p1.rotation.z = -Math.PI / 4;
      const holder = new THREE.Group();
      holder.add(p1);
      const p2 = p1.clone();
      const holder2 = new THREE.Group();
      holder2.rotation.x = Math.PI / 2;
      holder2.add(p2);
      grp.add(holder, holder2);
      this.object = new THREE.Group();
      this.object.add(grp);
      grp.rotation.y = Math.PI / 2; // sprite points along +x; align to -z forward
      this.mat = m;
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y, z);
    if (!this.stuck) {
      const yaw = Math.atan2(this.vx, this.vz);
      const pitch = Math.atan2(this.vy, Math.hypot(this.vx, this.vz));
      this.object.rotation.set(0, 0, 0);
      this.object.rotation.order = 'YXZ';
      this.object.rotation.y = yaw + Math.PI;
      this.object.rotation.x = pitch;
    }
    const [s, b] = this.light();
    this.mat.uniforms.uLight.value.set(s, b);
  }
}

// ray segment vs entity box -> distance or null
function segBox(ox, oy, oz, dx, dy, dz, e) {
  const hw = e.w / 2 + 0.1;
  const b = [e.x - hw, e.y - 0.1, e.z - hw, e.x + hw, e.y + e.h + 0.1, e.z + hw];
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < b[i] || o[i] > b[i + 3]) return null; continue; }
    let t1 = (b[i] - o[i]) / d[i], t2 = (b[i + 3] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
export { segBox };

// ------------------------------------------------------------------ falling blocks
export class FallingBlock extends Entity {
  constructor(game, x, y, z, v) {
    super(game, x + 0.5, y, z + 0.5);
    this.type = 'falling';
    this.v = v;
    this.w = 0.98; this.h = 0.98;
  }
  tick() {
    super.tick();
    this.vy -= 0.04;
    moveBox(this.world, this, 0, this.vy, 0);
    this.vy *= 0.98;
    if (this.onGround || this.age > 600) {
      const bx = Math.floor(this.x), by = Math.floor(this.y + 0.5), bz = Math.floor(this.z);
      const cur = this.world.getId(bx, by, bz);
      if (BLOCKS[cur].replaceable) {
        this.world.setBlock(bx, by, bz, this.v);
        this.game.sound.place(bx, by, bz, this.v & 1023);
      } else {
        this.game.dropItem(bx + 0.5, by + 0.5, bz + 0.5, { id: this.v & 1023, count: 1 });
      }
      this.remove();
    }
  }
  render(a) {
    if (!this.object) {
      this.object = makeItemObject(this.v & 1023);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y + 0.5, z);
    const [s, b] = this.light();
    this.object.userData.setLight(s, b);
  }
}

// ------------------------------------------------------------------ primed TNT
export class PrimedTnt extends Entity {
  constructor(game, x, y, z, fuse = 80) {
    super(game, x + 0.5, y, z + 0.5);
    this.type = 'tnt';
    this.fuse = fuse;
    this.w = 0.98; this.h = 0.98;
    const a = Math.random() * Math.PI * 2;
    this.vx = -Math.sin(a) * 0.02; this.vy = 0.2; this.vz = -Math.cos(a) * 0.02;
  }
  tick() {
    super.tick();
    this.physics(0.04, 0.98);
    if (this.age % 2 === 0) this.game.particles.smoke(this.x, this.y + 1, this.z, 1, 0.2, 0.5);
    if (--this.fuse <= 0) {
      this.remove();
      this.game.explode(this.x, this.y + 0.5, this.z, 4, this);
    }
  }
  render(a) {
    if (!this.object) {
      this.object = makeItemObject(B.tnt);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y + 0.5, z);
    let s = 1;
    if (this.fuse < 10) s = 1 + (1 - this.fuse / 10) * 0.2;
    this.object.scale.setScalar(s);
    const flash = Math.floor(this.fuse / 5) % 2 === 0;
    this.object.userData.setLight(flash ? 15 : 15, flash ? 15 : 0);
    for (const m of this.object.userData.mats) if (m.uniforms.uDaylight) m.uniforms.uItemLight.value.set(15, flash ? 15 : 0);
  }
}

// ------------------------------------------------------------------ thrown items
export class Thrown extends Entity {
  constructor(game, x, y, z, vx, vy, vz, itemId, thrower) {
    super(game, x, y, z);
    this.type = 'thrown';
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.itemId = itemId;
    this.thrower = thrower;
    this.w = 0.25; this.h = 0.25;
  }
  tick() {
    super.tick();
    const sp = Math.hypot(this.vx, this.vy, this.vz) || 1e-6;
    const hit = raycast(this.world, this.x, this.y, this.z, this.vx / sp, this.vy / sp, this.vz / sp, sp);
    let target = null, tb = hit ? hit.dist : sp;
    for (const e of this.game.entities.mobsNear(this.x, this.y, this.z, sp + 2)) {
      const t = segBox(this.x, this.y, this.z, this.vx / sp, this.vy / sp, this.vz / sp, e);
      if (t !== null && t < tb) { tb = t; target = e; }
    }
    if ((target || hit) && this.age > 0) {
      const ix = this.x + this.vx / sp * tb, iy = this.y + this.vy / sp * tb, iz = this.z + this.vz / sp * tb;
      this.impact(ix, iy, iz, target, hit);
      this.remove();
      return;
    }
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    const drag = this.world.getId(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.water ? 0.8 : 0.99;
    this.vx *= drag; this.vy *= drag; this.vz *= drag;
    this.vy -= 0.03;
    if (this.age > 400 || this.y < -10) this.remove();
  }
  impact(x, y, z, target, hit) {
    const g = this.game;
    g.particles.itemCrumbs(x, y, z, this.itemId, 8);
    if (this.itemId === I.snowball) {
      if (target) target.hurt(target.def && target.def.name === 'blaze' ? 3 : 0, this.thrower, this.x, this.z, 'thrown');
    } else if (this.itemId === I.egg) {
      if (target) target.hurt(0, this.thrower, this.x, this.z, 'thrown');
      if (Math.random() < 0.125) {
        const n = Math.random() < 1 / 32 ? 4 : 1;
        for (let i = 0; i < n; i++) g.spawnMob('chicken', x, y, z, { baby: true });
      }
    } else if (this.itemId === I.ender_pearl) {
      const p = g.player;
      if (this.thrower === p && !p.dead) {
        let ty = y;
        if (hit && hit.face === 3) ty -= 1.8;
        p.x = x; p.y = ty; p.z = z; p.px = x; p.py = ty; p.pz = z; p.vx = p.vy = p.vz = 0;
        p.fallDistance = 0;
        p.damage(5, 'fall', true);
        g.sound.play('enderman.say', x, y, z, 0.6, 1.4);
        g.particles.poof(x, y, z);
      }
    }
  }
  render(a) {
    if (!this.object) {
      const it = ITEMS[this.itemId];
      const tex = imageTexture(images[it.icon]);
      this.object = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.5 }));
      this.object.scale.setScalar(0.35);
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y, z);
    const [s] = this.light();
    const v = 0.3 + s / 15 * 0.7;
    this.object.material.color.setRGB(v, v, v);
  }
}

// ------------------------------------------------------------------ manager
export class Entities {
  constructor(game, scene) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'entities';
    scene.add(this.group);
  }
  add(e) { this.list.push(e); return e; }
  tick() {
    for (const e of this.list) if (!e.removed) e.tick();
    if (this.list.some((e) => e.removed)) this.list = this.list.filter((e) => !e.removed);
  }
  render(a, t) {
    for (const e of this.list) if (!e.removed) e.render(a, t);
  }
  near(x, y, z, r) {
    const r2 = r * r;
    return this.list.filter((e) => !e.removed && (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2 <= r2);
  }
  mobsNear(x, y, z, r) {
    const r2 = r * r;
    return this.list.filter((e) => e.isMob && !e.removed && !e.dead && (e.x - x) ** 2 + (e.y - y) ** 2 + (e.z - z) ** 2 <= r2);
  }
  mobs() { return this.list.filter((e) => e.isMob && !e.removed); }
  clear() { for (const e of this.list) e.remove(); this.list = []; }
}
void R;
