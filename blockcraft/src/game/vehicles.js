// Rideable vehicles: boats (vanilla paddling and buoyancy) and minecarts (vanilla rail-following).
import * as THREE from 'three';
import { BLOCKS, B, R } from '../shared/blocks.js';
import { I } from '../shared/items.js';
import { Entity } from './entities.js';
import { moveBox, contacts, boxBlocked } from './physics.js';
import { MODELS, buildModel } from '../engine/models.js';

const DEG = Math.PI / 180;
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// rail shapes: the two exits of each shape as [dx, dy, dz] (dy -1: that end is the low end of a slope)
export const RAIL_EXITS = [
  [[0, 0, -1], [0, 0, 1]], // 0 north-south
  [[-1, 0, 0], [1, 0, 0]], // 1 east-west
  [[-1, -1, 0], [1, 0, 0]], // 2 ascending east
  [[-1, 0, 0], [1, -1, 0]], // 3 ascending west
  [[0, 0, -1], [0, -1, 1]], // 4 ascending north
  [[0, -1, -1], [0, 0, 1]], // 5 ascending south
  [[0, 0, 1], [1, 0, 0]], // 6 curve south-east
  [[0, 0, 1], [-1, 0, 0]], // 7 curve south-west
  [[0, 0, -1], [-1, 0, 0]], // 8 curve north-west
  [[0, 0, -1], [1, 0, 0]], // 9 curve north-east
];
export const isRail = (id) => BLOCKS[id] && BLOCKS[id].render === R.RAIL;
export const railShape = (v) => {
  const id = v & 1023, meta = v >>> 10;
  return BLOCKS[id].straightOnly ? meta & 7 : meta & 15;
};

class Vehicle extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.isVehicle = true;
    this.def = { vehicle: true, sounds: {} }; // combat code reads def flags
    this.rider = null;
    this.hits = 0;
    this.hurtTime = 0;
    this.hurtDir = 1;
    this.dead = false;
  }
  hurt(dmg, source) {
    if (this.removed) return false;
    const p = this.game.player;
    this.hurtTime = 10;
    this.hurtDir = -this.hurtDir;
    this.hits += dmg * 10;
    this.game.sound.play('dig.wood', this.x, this.y, this.z, 0.6, 1.2);
    if (source === p && p.creative) this.breakApart(true);
    else if (this.hits > 40) this.breakApart(false);
    return true;
  }
  breakApart(noDrop) {
    if (this.rider) this.dismount();
    if (!noDrop) this.game.dropItem(this.x, this.y + 0.3, this.z, { id: this.itemId(), count: 1 });
    this.dead = true;
    this.remove();
  }
  interact(p) {
    if (this.rider || p.sneaking) return false;
    this.mount(p);
    return true;
  }
  mount(p) {
    if (p.vehicle) p.vehicle.dismount();
    this.rider = p;
    p.vehicle = this;
    p.vx = p.vy = p.vz = 0;
    p.sprinting = false;
    p.fallDistance = 0;
    this.placeRider();
    p.px = p.x; p.py = p.y; p.pz = p.z;
  }
  dismount() {
    const p = this.rider;
    if (!p) return;
    this.rider = null;
    p.vehicle = null;
    // step off to the side if there is room, otherwise on top
    const w = this.world;
    const side = this.yaw + Math.PI / 2;
    const spots = [[-Math.sin(side), -Math.cos(side)], [Math.sin(side), Math.cos(side)], [-Math.sin(this.yaw), -Math.cos(this.yaw)], [Math.sin(this.yaw), Math.cos(this.yaw)]];
    let pos = [this.x, this.y + this.h, this.z];
    for (const [dx, dz] of spots) {
      const x = this.x + dx * (this.w / 2 + 0.5), z = this.z + dz * (this.w / 2 + 0.5);
      for (const dy of [0, 1, -1]) {
        const y = Math.floor(this.y) + dy;
        if (!boxBlocked(w, x - 0.3, y, z - 0.3, x + 0.3, y + 1.8, z + 0.3) && boxBlocked(w, x - 0.3, y - 0.5, z - 0.3, x + 0.3, y, z + 0.3)) { pos = [x, y, z]; break; }
      }
      if (pos[1] !== this.y + this.h) break;
    }
    p.x = p.px = pos[0]; p.y = p.py = pos[1]; p.z = p.pz = pos[2];
    p.vx = this.vx; p.vz = this.vz; p.vy = 0;
  }
  // put the rider in the seat (feet position)
  placeRider() {
    const p = this.rider;
    if (!p) return;
    p.x = this.x; p.y = this.y + this.seatY; p.z = this.z;
    p.vx = p.vy = p.vz = 0;
    p.onGround = true;
    p.fallDistance = 0;
  }
  remove() {
    if (this.rider) this.dismount();
    super.remove();
  }
  renderCommon(a) {
    if (!this.model) {
      this.model = buildModel(MODELS[this.modelName], this.texName);
      this.object = this.model.root;
      this.game.entities.group.add(this.object);
    }
    const [x, y, z] = this.lerp(a);
    this.object.position.set(x, y, z);
    const [s, b] = this.light();
    for (const m of this.model.mats) m.uniforms.uLight.value.set(s, b);
    // hurt wobble and red flash
    const ht = this.hurtTime - a;
    const flash = ht > 0 ? 0.3 : 0;
    for (const m of this.model.mats) m.uniforms.uOverlay.value.set(1, 0, 0, flash);
    return ht > 0 ? Math.sin(ht) * ht * this.hits / 400 * this.hurtDir : 0;
  }
}

// ------------------------------------------------------------------ boats
export class Boat extends Vehicle {
  constructor(game, x, y, z, wood = 'oak', yaw = 0) {
    super(game, x, y, z);
    this.type = 'boat';
    this.wood = wood;
    this.yaw = this.pyaw = yaw;
    this.w = 1.375; this.h = 0.5625;
    this.seatY = -0.45;
    this.turn = 0; // degrees per tick
    this.paddle = [0, 0];
    this.paddling = [false, false];
    this.modelName = 'boat';
    this.texName = 'entity/boat_' + wood;
  }
  itemId() { return I[this.wood + '_boat']; }

  tick() {
    super.tick();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.hits > 0) this.hits = Math.max(0, this.hits - 1);
    const w = this.world;
    const c = contacts(w, this.x, this.y, this.z, this.w, this.h);
    this.inWater = c.water;
    // status like vanilla: under water / in water / on land / in air
    const under = c.water && c.waterTop > this.y + this.h + 0.01;
    let friction, lift = 0, grav = -0.04;
    if (under) { lift = 0.01; friction = 0.45; }
    else if (c.water) { lift = (c.waterTop - this.y) / this.h; friction = 0.9; }
    else if (this.onGround) {
      // land friction from the blocks under the hull (ice lets boats glide)
      const below = w.getId(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z));
      friction = (BLOCKS[below].slip || 0.6) * (this.rider ? 0.5 : 1);
    } else friction = 0.9;
    this.vx *= friction; this.vz *= friction;
    this.vy += grav;
    this.turn *= friction;
    if (lift > 0) this.vy = (this.vy + lift * 0.06153846) * 0.75;
    // paddling
    this.paddling[0] = this.paddling[1] = false;
    const p = this.rider;
    if (p) {
      const inp = p.input;
      const fwd = inp.f > 0.3, back = inp.f < -0.3, left = inp.s < -0.3, right = inp.s > 0.3;
      let f = 0;
      if (left) this.turn += 1;
      if (right) this.turn -= 1;
      if (left !== right && !fwd && !back) f += 0.005;
      if (fwd) f += 0.04;
      if (back) f -= 0.005;
      this.yaw += this.turn * DEG;
      p.yaw += this.turn * DEG;
      this.vx += -Math.sin(this.yaw) * f;
      this.vz += -Math.cos(this.yaw) * f;
      this.paddling[0] = (right && !left) || fwd;
      this.paddling[1] = (left && !right) || fwd;
      if (inp.sneak) { this.dismount(); }
    }
    for (let i = 0; i < 2; i++) if (this.paddling[i]) {
      this.paddle[i] += Math.PI / 8;
      if (c.water && Math.floor(this.paddle[i] / (2 * Math.PI)) !== Math.floor((this.paddle[i] - Math.PI / 8) / (2 * Math.PI))) this.game.sound.play('player.splash', this.x, this.y, this.z, 0.15, 1.2 + Math.random() * 0.3);
    }
    moveBox(w, this, this.vx, this.vy, this.vz, 0);
    if (this.hitX) this.vx = 0;
    if (this.hitZ) this.vz = 0;
    if (this.hitV) this.vy = 0;
    this.pushPlayer();
    this.placeRider();
  }

  // a walking player bumps into the boat and nudges it
  pushPlayer() {
    const p = this.game.player;
    if (this.rider === p || p.vehicle) return;
    const dx = p.x - this.x, dz = p.z - this.z;
    const r = this.w / 2 + 0.3;
    if (Math.abs(dx) < r && Math.abs(dz) < r && p.y < this.y + this.h && p.y + p.h > this.y) {
      const d = Math.hypot(dx, dz) || 1;
      this.vx -= dx / d * 0.02; this.vz -= dz / d * 0.02;
    }
  }

  render(a) {
    const wob = this.renderCommon(a);
    if (!this.patch) {
      // vanilla's water mask: a depth-only lid over the hull so water isn't drawn inside the boat
      const g = new THREE.PlaneGeometry(26 / 16, 14 / 16);
      g.rotateX(-Math.PI / 2);
      this.patch = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false }));
      this.patch.position.y = 6.6 / 16;
      this.patch.renderOrder = 10;
      this.model.inner.add(this.patch);
    }
    const yaw = this.pyaw + wrapPi(this.yaw - this.pyaw) * a;
    this.object.rotation.set(wob * 0.2, yaw + Math.PI, 0, 'YXZ');
    this.model.inner.rotation.y = -Math.PI / 2;
    // paddles swing like vanilla's rowing animation
    const P = this.model.parts;
    for (let i = 0; i < 2; i++) {
      const part = i === 0 ? P.leftPaddle : P.rightPaddle;
      const t = this.paddle[i] + (this.paddling[i] ? a * Math.PI / 8 : 0);
      const lerp = (lo, hi, k) => lo + (hi - lo) * Math.max(0, Math.min(1, k));
      const rx = lerp(-Math.PI / 3, -Math.PI / 12, (Math.sin(-t) + 1) / 2);
      let ry = lerp(-Math.PI / 4, Math.PI / 4, (Math.sin(-t + 1) + 1) / 2);
      if (i === 1) ry = Math.PI - ry;
      // our frame negates y and z rotations relative to vanilla's model frame
      part.rotation.set(rx, -ry, -0.19634955);
    }
  }

  toJSON() { return { t: 'boat', x: this.x, y: this.y, z: this.z, yaw: this.yaw, wood: this.wood }; }
}

// ------------------------------------------------------------------ minecarts
const MAX_SPEED = 0.4;

export class Minecart extends Vehicle {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.type = 'minecart';
    this.w = 0.98; this.h = 0.7;
    this.seatY = -0.32;
    this.modelName = 'minecart';
    this.texName = 'entity/minecart';
    this.ryaw = 0; this.pryaw = 0; this.pitch = 0;
    this.onRail = false;
  }
  itemId() { return I.minecart; }

  // rail block under the cart: [x, y, z, v] or null
  railAt() {
    const w = this.world;
    const bx = Math.floor(this.x), by = Math.floor(this.y + 0.01), bz = Math.floor(this.z);
    // (one up as well: a fast cart can leave a slope before its height catches up)
    for (const y of [by, by - 1, by + 1]) {
      const v = w.getBlock(bx, y, bz);
      if (isRail(v & 1023)) return [bx, y, bz, v];
    }
    return null;
  }
  // cart height on a rail cell at its current x/z
  railY(bx, by, bz, shape) {
    const f = shape === 2 ? this.x - bx : shape === 3 ? bx + 1 - this.x : shape === 4 ? bz + 1 - this.z : shape === 5 ? this.z - bz : 0;
    return by + Math.max(0, Math.min(1, f));
  }

  tick() {
    super.tick();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.hits > 0) this.hits = Math.max(0, this.hits - 1);
    this.pryaw = this.ryaw;
    const p = this.rider;
    if (p && p.input.sneak) this.dismount();
    const rail = this.railAt();
    this.onRail = !!rail;
    if (rail) this.alongTrack(rail);
    else {
      // off the rails: a heavy box with friction
      this.vy -= 0.04;
      this.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vx));
      this.vz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vz));
      if (this.onGround) { this.vx *= 0.5; this.vz *= 0.5; }
      moveBox(this.world, this, this.vx, this.vy, this.vz, 0);
      if (this.hitX) this.vx = 0;
      if (this.hitZ) this.vz = 0;
      if (this.hitV) this.vy = 0;
      if (!this.onGround) { this.vx *= 0.95; this.vz *= 0.95; this.vy *= 0.95; }
      this.pitch = 0;
    }
    this.pushes();
    // face the direction of travel (the cart looks the same both ways round, so keep the nearest)
    if (Math.hypot(this.x - this.px, this.z - this.pz) > 0.001) {
      let t = Math.atan2(-(this.z - this.pz), this.x - this.px);
      if (Math.abs(wrapPi(t - this.ryaw)) > Math.PI / 2) t = wrapPi(t + Math.PI);
      this.ryaw = t;
    }
    this.placeRider();
  }

  alongTrack([bx, by, bz, v]) {
    const w = this.world;
    const id = v & 1023;
    const shape = railShape(v);
    const powered = id === B.powered_rail && (v >>> 10 & 8);
    this.fallDistance = 0;
    this.vy = 0;
    // slopes pull the cart downhill
    const S = 0.0078125;
    if (shape === 2) this.vx -= S; else if (shape === 3) this.vx += S; else if (shape === 4) this.vz += S; else if (shape === 5) this.vz -= S;
    const [e0, e1] = RAIL_EXITS[shape] || RAIL_EXITS[0];
    let ex = e1[0] - e0[0], ez = e1[2] - e0[2];
    const el = Math.hypot(ex, ez);
    if (this.vx * ex + this.vz * ez < 0) { ex = -ex; ez = -ez; }
    let sp = Math.min(2, Math.hypot(this.vx, this.vz));
    // the rider can nudge a stopped cart forward
    const p = this.rider;
    if (p && p.input.f > 0.3 && sp < 0.01) {
      const dx = -Math.sin(p.yaw), dz = -Math.cos(p.yaw);
      if (Math.abs(dx * ex + dz * ez) > 0.3) { if (dx * ex + dz * ez < 0) { ex = -ex; ez = -ez; } sp = 0.06; }
    }
    this.vx = sp * ex / el; this.vz = sp * ez / el;
    // a powered rail without power brakes the cart
    if (id === B.powered_rail && !powered) {
      if (sp < 0.03) { this.vx = this.vz = 0; } else { this.vx *= 0.5; this.vz *= 0.5; }
    }
    // keep the cart on the rail's centre line
    const x0 = bx + 0.5 + e0[0] * 0.5, z0 = bz + 0.5 + e0[2] * 0.5;
    const x1 = bx + 0.5 + e1[0] * 0.5, z1 = bz + 0.5 + e1[2] * 0.5;
    const dx = x1 - x0, dz = z1 - z0;
    let t;
    if (dx === 0) { this.x = bx + 0.5; t = this.z - bz; }
    else if (dz === 0) { this.z = bz + 0.5; t = this.x - bx; }
    else { t = ((this.x - x0) * dx + (this.z - z0) * dz) * 2; }
    if (dx !== 0 && dz !== 0) { this.x = x0 + dx * t; this.z = z0 + dz * t; }
    // move along the track, stopping at walls where the rail ends
    const mul = this.rider ? 0.75 : 1;
    const mx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vx * mul)), mz = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, this.vz * mul));
    const nx = this.x + mx, nz = this.z + mz;
    const nbx = Math.floor(nx), nbz = Math.floor(nz);
    if (nbx !== bx || nbz !== bz) {
      let next = false;
      for (const dy of [0, 1, -1]) if (isRail(w.getId(nbx, by + dy, nbz))) next = true;
      const cy = Math.floor(this.y + 0.01);
      if (!next && (BLOCKS[w.getId(nbx, cy, nbz)].solid || BLOCKS[w.getId(nbx, cy + 1, nbz)].solid)) {
        // buffer stop: bounce back gently
        this.vx = -this.vx * 0.3; this.vz = -this.vz * 0.3;
        this.game.sound.play('dig.metal', this.x, this.y, this.z, 0.3, 0.8);
        return this.settle(bx, by, bz, shape);
      }
      if (!next) {
        // runs off the end of the line
        this.x = nx; this.z = nz;
        return;
      }
    }
    this.x = nx; this.z = nz;
    // follow slopes into the next cell
    const r2 = this.railAt();
    if (r2) this.settle(r2[0], r2[1], r2[2], railShape(r2[3]));
    // drag, and powered rails push
    const drag = this.rider ? 0.997 : 0.96;
    this.vx *= drag; this.vz *= drag;
    if (powered) {
      const s = Math.hypot(this.vx, this.vz);
      if (s > 0.01) { this.vx += this.vx / s * 0.06; this.vz += this.vz / s * 0.06; }
      else if (shape === 1) {
        // kick off a wall
        if (BLOCKS[w.getId(bx - 1, by, bz)].solid) this.vx = 0.02; else if (BLOCKS[w.getId(bx + 1, by, bz)].solid) this.vx = -0.02;
      } else if (shape === 0) {
        if (BLOCKS[w.getId(bx, by, bz - 1)].solid) this.vz = 0.02; else if (BLOCKS[w.getId(bx, by, bz + 1)].solid) this.vz = -0.02;
      }
    }
    const s = Math.hypot(this.vx, this.vz);
    if (s > MAX_SPEED * 1.5) { this.vx *= MAX_SPEED * 1.5 / s; this.vz *= MAX_SPEED * 1.5 / s; }
  }
  settle(bx, by, bz, shape) {
    this.y = this.railY(bx, by, bz, shape);
    this.pitch = shape === 2 || shape === 5 ? 1 : shape === 3 || shape === 4 ? -1 : 0;
    this.onGround = true;
  }

  // walking players push carts; carts bump each other
  pushes() {
    const p = this.game.player;
    const push = (o, k) => {
      const dx = o.x - this.x, dz = o.z - this.z;
      const r = (this.w + (o.w || 0.6)) / 2;
      if (Math.abs(dx) < r && Math.abs(dz) < r && o.y < this.y + this.h && o.y + (o.h || 1.8) > this.y) {
        const d = Math.hypot(dx, dz) || 1;
        this.vx -= dx / d * k; this.vz -= dz / d * k;
        return true;
      }
      return false;
    };
    if (!p.vehicle && p !== this.rider) push(p, 0.02);
    for (const e of this.game.entities.list) if (e !== this && e.type === 'minecart' && !e.removed) push(e, 0.03);
  }

  render(a) {
    const wob = this.renderCommon(a);
    const ry = this.pryaw + wrapPi(this.ryaw - this.pryaw) * a;
    // slope tilt: pitch sign relative to the cart's facing
    const fx = Math.cos(ry), fz = -Math.sin(ry);
    let tilt = 0;
    if (this.pitch) {
      const rail = this.railAt();
      const shape = rail ? railShape(rail[3]) : -1;
      const up = shape === 2 ? [1, 0] : shape === 3 ? [-1, 0] : shape === 4 ? [0, -1] : shape === 5 ? [0, 1] : [0, 0];
      tilt = (up[0] * fx + up[1] * fz) * Math.PI / 4;
    }
    this.object.rotation.set(wob * 0.2, ry, tilt, 'YZX');
  }

  toJSON() { return { t: 'minecart', x: this.x, y: this.y, z: this.z, vx: this.vx, vz: this.vz }; }
}

// ------------------------------------------------------------------ rail placement
// Pick a shape for a rail at (x,y,z) from its neighbours, and bend neighbours toward it (simplified vanilla rules).
export function shapeRail(world, x, y, z) {
  const v = world.getBlock(x, y, z);
  const id = v & 1023;
  if (!isRail(id)) return;
  const straight = BLOCKS[id].straightOnly;
  const dirs = [[0, -1, 'n'], [0, 1, 's'], [1, 0, 'e'], [-1, 0, 'w']];
  // neighbours that are rails at the same height, one below, or one above (we climb toward those)
  const nb = {};
  for (const [dx, dz, k] of dirs) {
    if (isRail(world.getId(x + dx, y, z + dz))) nb[k] = 0;
    else if (isRail(world.getId(x + dx, y + 1, z + dz))) nb[k] = 1;
    else if (isRail(world.getId(x + dx, y - 1, z + dz))) nb[k] = -1;
  }
  const has = (k) => nb[k] !== undefined;
  let shape;
  if ((has('n') || has('s')) && !has('e') && !has('w')) shape = nb.n === 1 ? 4 : nb.s === 1 ? 5 : 0;
  else if ((has('e') || has('w')) && !has('n') && !has('s')) shape = nb.e === 1 ? 2 : nb.w === 1 ? 3 : 1;
  else if (!straight && has('s') && has('e')) shape = 6;
  else if (!straight && has('s') && has('w')) shape = 7;
  else if (!straight && has('n') && has('w')) shape = 8;
  else if (!straight && has('n') && has('e')) shape = 9;
  else if (has('n') || has('s')) shape = nb.n === 1 ? 4 : nb.s === 1 ? 5 : 0;
  else shape = 1;
  const keep = straight ? (v >>> 10) & 8 : 0;
  world.setBlock(x, y, z, id | ((shape | keep) << 10));
}
// after placing a rail, let lone neighbours bend toward it
export function connectRail(world, x, y, z) {
  shapeRail(world, x, y, z);
  for (const [dx, dz] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) {
    for (const dy of [0, -1, 1]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const nv = world.getBlock(nx, ny, nz);
      if (!isRail(nv & 1023)) continue;
      // only reshape neighbours with a free end (fewer than two rail connections)
      let links = 0;
      const [a, b] = RAIL_EXITS[railShape(nv)] || RAIL_EXITS[0];
      for (const e of [a, b]) {
        const ex = nx + e[0], ez = nz + e[2];
        if (ex === x && ez === z) continue;
        for (const ddy of [0, 1, -1]) if (isRail(world.getId(ex, ny + ddy, ez))) { links++; break; }
      }
      if (links < 2) shapeRail(world, nx, ny, nz);
    }
  }
  shapeRail(world, x, y, z);
}
