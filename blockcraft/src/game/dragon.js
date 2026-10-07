// The Ender Dragon: circles the island's spikes, strafes the player with fireballs, perches on the exit
// podium to breathe, heals from end crystals, and when it dies opens the way home.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { MODELS, buildModel } from '../engine/models.js';
import { DragonFireball, BreathCloud } from './endentities.js';

const r = Math.random;
const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const turn = (a, b, max) => a + Math.max(-max, Math.min(max, wrap(b - a)));

export class EnderDragon extends Entity {
  constructor(game, x, y, z) {
    super(game, x, y, z);
    this.type = 'mob';
    this.isMob = true;
    this.kind = 'ender_dragon';
    this.def = { name: 'ender_dragon', hostile: true, boss: true, sounds: {}, eye: 3 };
    this.w = 8; this.h = 5;
    this.maxHealth = 200; this.health = 200;
    this.persistent = true;
    this.dead = false; this.deathTime = 0;
    this.hurtTime = 0; this.invuln = 0;
    this.effects = {};
    this.phase = 'hold'; this.phaseTime = 0;
    this.circle = r() * Math.PI * 2;
    this.flap = 0; this.pflap = 0;
    this.pitch = 0;
    this.yaw = 0; this.pyaw = 0;
    this.healFrom = null;
    this.hits = 0;
  }
  addEffect() {}
  get podium() { return this.game.podiumY(); }

  setPhase(p) { this.phase = p; this.phaseTime = 0; this.shot = false; this.hits = 0; }

  tick() {
    super.tick();
    const g = this.game, p = g.player;
    this.pflap = this.flap;
    this.pyaw = this.yaw;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    if (this.dead) return this.dyingTick();
    this.phaseTime++;
    // wings beat faster when climbing, slower when gliding
    this.flap += this.phase === 'perch' ? 0.02 : 0.2 / (Math.hypot(this.vx, this.vz) * 10 + 1) + 0.04;
    const pd = Math.hypot(p.x - this.x, p.z - this.z);
    const canSee = !p.dead && p.mode !== 'spectator' && p.mode !== 'creative';
    switch (this.phase) {
      case 'hold': {
        // circle the spikes, drifting up and down
        this.circle += 0.006;
        const R = 60;
        const tx = Math.cos(this.circle) * R, tz = Math.sin(this.circle) * R, ty = 78 + Math.sin(this.phaseTime * 0.01) * 10;
        this.flyTo(tx, ty, tz, 0.55);
        const crystals = this.crystals().length;
        if (canSee && pd < 150 && this.phaseTime > 100 && r() < 1 / 260) this.setPhase(r() < 0.35 ? 'charge' : 'strafe');
        else if (this.phaseTime > 300 && r() < 1 / (220 + crystals * 40)) this.setPhase('landing');
        break;
      }
      case 'strafe': {
        // swoop toward the player and loose a fireball when lined up
        this.flyTo(p.x, p.y + 14, p.z, 0.7);
        const d = this.distTo(p.x, p.y, p.z);
        if (!this.shot && d < 60 && d > 12) {
          const hx = this.x - Math.sin(this.yaw) * 6, hz = this.z - Math.cos(this.yaw) * 6, hy = this.y + 2;
          g.entities.add(new DragonFireball(g, hx, hy, hz, p.x - hx, p.y + 1 - hy, p.z - hz, this));
          g.sound.play('dragon.shoot', this.x, this.y, this.z, 3, 1, { range: 96 });
          this.shot = true;
        }
        if ((this.shot && d < 20) || this.phaseTime > 220 || !canSee) this.setPhase('hold');
        break;
      }
      case 'charge': {
        this.flyTo(p.x, p.y + 1, p.z, 0.9);
        if (this.distTo(p.x, p.y, p.z) < 4 || this.phaseTime > 120 || !canSee) this.setPhase('hold');
        break;
      }
      case 'landing': {
        const y0 = this.podium + 4;
        const hd = Math.hypot(this.x, this.z);
        if (hd > 3) this.flyTo(0.5, Math.max(y0, Math.min(this.y, y0 + 24)), 0.5, 0.5);
        else { this.vx *= 0.7; this.vz *= 0.7; this.vy += (y0 - this.y) * 0.05 - this.vy * 0.3; this.x += (0.5 - this.x) * 0.2; this.z += (0.5 - this.z) * 0.2; }
        if (hd < 1.5 && Math.abs(this.y - y0) < 0.6) { this.setPhase('perch'); this.vx = this.vy = this.vz = 0; }
        if (this.phaseTime > 600) this.setPhase('hold');
        break;
      }
      case 'perch': {
        // settle on the pillar, glare at the player, breathe on them now and then
        this.vx = this.vy = this.vz = 0;
        this.y += (this.podium + 4 - this.y) * 0.3;
        if (canSee) this.yaw = turn(this.yaw, Math.atan2(-(p.x - this.x), -(p.z - this.z)), 0.06);
        if (this.phaseTime % 70 === 40 && canSee && pd < 24) {
          const hx = this.x - Math.sin(this.yaw) * 7, hz = this.z - Math.cos(this.yaw) * 7;
          g.entities.add(new BreathCloud(g, hx, this.podium, hz, this));
          g.sound.play('dragon.growl', this.x, this.y, this.z, 2, 0.8, { range: 64 });
        }
        if (this.phaseTime > 260 + r() * 100 || this.hits >= 4) this.setPhase('takeoff');
        break;
      }
      case 'takeoff': {
        this.flyTo(this.x - Math.sin(this.yaw) * 30, this.podium + 40, this.z - Math.cos(this.yaw) * 30, 0.5);
        if (this.y > this.podium + 30 || this.phaseTime > 160) this.setPhase('hold');
        break;
      }
    }
    if (this.phase !== 'perch' && this.phase !== 'landing') {
      this.x += this.vx; this.y += this.vy; this.z += this.vz;
      const sp = Math.hypot(this.vx, this.vz);
      if (sp > 0.02) this.yaw = turn(this.yaw, Math.atan2(-this.vx, -this.vz), 0.07);
      this.pitch += (Math.max(-0.5, Math.min(0.5, -this.vy * 1.2)) - this.pitch) * 0.1;
    } else {
      this.x += this.vx; this.y += this.vy; this.z += this.vz;
      this.pitch *= 0.9;
    }
    // body slams: anything under the wings is knocked away
    if (this.phase !== 'perch' && canSee && this.age % 5 === 0) {
      const dx = p.x - this.x, dy = p.y + 1 - (this.y + 2), dz = p.z - this.z;
      if (Math.abs(dy) < 4 && Math.hypot(dx, dz) < 5) {
        if (p.damage(this.phase === 'charge' ? 10 : 5, 'mob', false, this) > 0) {
          const l = Math.hypot(dx, dz) || 1;
          p.vx += dx / l * 1.2; p.vz += dz / l * 1.2; p.vy = Math.max(p.vy, 0.6);
        }
      }
    }
    // the nearest crystal mends it
    if (this.age % 10 === 0) {
      let best = null, bd = 32;
      for (const c of this.crystals()) { const d = this.distTo(c.x, c.y, c.z); if (d < bd) { bd = d; best = c; } }
      this.healFrom = best;
      if (best && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);
    }
    if (this.age % 120 === 0 && r() < 0.5) g.sound.play('dragon.growl', this.x, this.y, this.z, 3, 0.9 + r() * 0.2, { range: 128 });
  }

  crystals() { return this.game.entities.list.filter((e) => e.type === 'end_crystal' && !e.dead && !e.removed); }

  flyTo(tx, ty, tz, speed) {
    const dx = tx - this.x, dy = ty - this.y, dz = tz - this.z, d = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(1, d / 6);
    this.vx += (dx / d * speed * k - this.vx) * 0.05;
    this.vy += (dy / d * speed * k - this.vy) * 0.05;
    this.vz += (dz / d * speed * k - this.vz) * 0.05;
  }

  // a crystal blown up while it was healing us hurts
  crystalDestroyed(c, source) {
    if (this.healFrom === c && !this.dead) this.hurt(10, source, c.x, c.z, 'explosion');
  }

  hurt(dmg, source, fromX, fromZ, cause = 'mob') {
    if (this.dead || this.invuln > 0 || cause === 'magic' || cause === 'fire' || cause === 'lava') return false;
    const g = this.game;
    // the head takes full damage when it's down at the podium; everywhere else armour soaks most of it
    const amt = this.phase === 'perch' && cause !== 'explosion' ? dmg : dmg / 4 + 1;
    this.health -= amt;
    this.hurtTime = 10; this.invuln = 10;
    this.hits++;
    g.sound.play('dragon.growl', this.x, this.y, this.z, 2.5, 1.1, { range: 96 });
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathTime = 0;
      this.setPhase('dying');
      if (source === g.player) g.onMobKilled(this, cause);
    } else if (this.phase === 'perch' && this.hits >= 3) this.setPhase('takeoff');
    void fromX; void fromZ;
    return true;
  }

  // the death: it rises, glows and comes apart in bursts of light
  dyingTick() {
    const g = this.game;
    this.deathTime++;
    this.y += 0.1;
    this.yaw += 0.02;
    if (this.deathTime % 5 === 0) {
      const ox = (r() - 0.5) * 8, oy = (r() - 0.5) * 4 + 2, oz = (r() - 0.5) * 8;
      g.particles.explosion(this.x + ox, this.y + oy, this.z + oz, 1.5);
      if (this.deathTime % 20 === 0) g.sound.play('tnt.explode', this.x, this.y, this.z, 1.5, 1.4, { range: 128 });
    }
    if (this.deathTime >= 200) { this.remove(); g.onDragonDeath(this); }
  }

  render(a, t) {
    const g = this.game;
    if (!this.model) {
      this.model = buildModel(MODELS.ender_dragon, 'entity/ender_dragon');
      this.object = this.model.root;
      g.entities.group.add(this.object);
    }
    const m = this.model, P = m.parts;
    const [x, y, z] = this.lerp(a);
    m.root.position.set(x, y, z);
    const yaw = this.pyaw + wrap(this.yaw - this.pyaw) * a;
    m.root.rotation.set(0, yaw + Math.PI, 0);
    m.inner.rotation.x = this.pitch;
    const f = (this.pflap + (this.flap - this.pflap) * a) * Math.PI * 2;
    // wings (vanilla's flap curves, mirrored for the right side)
    const wx = 0.125 - Math.cos(f) * 0.2, wz = (Math.sin(f) + 0.125) * 0.8, tz = -(Math.sin(f + 2) + 0.5) * 0.75;
    P.leftWing.rotation.set(wx, 0.25, wz); P.rightWing.rotation.set(wx, -0.25, -wz);
    P.leftWingTip.rotation.set(0, 0, tz); P.rightWingTip.rotation.set(0, 0, -tz);
    // legs tucked back in flight, braced when perched
    const perch = this.phase === 'perch' ? 1 : 0;
    for (const s of ['left', 'right']) {
      P[s + 'FrontLeg'].rotation.x = 1.3 - perch * 1.1 + Math.sin(f) * 0.1;
      P[s + 'FrontLegTip'].rotation.x = 0.5 - perch * 0.3;
      P[s + 'FrontFoot'].rotation.x = 0.75 - perch * 0.7;
      P[s + 'HindLeg'].rotation.x = 1.0 - perch * 0.9;
      P[s + 'HindLegTip'].rotation.x = 0.5 - perch * 0.3;
      P[s + 'HindFoot'].rotation.x = 0.75 - perch * 0.7;
    }
    // neck: a gentle S toward the head (lowered when perched)
    let nx = 0, ny = 4, nz = 12;
    const lower = perch ? 0.22 : 0;
    for (let i = 0; i < 5; i++) {
      const sway = Math.sin(t * 1.2 + i * 0.6) * 0.05;
      const pitch = lower + Math.sin(f + i * 0.4) * 0.03;
      const N = P['neck' + i];
      N.position.set(nx / 16, ny / 16, nz / 16);
      N.rotation.set(pitch, sway, 0);
      nx += Math.sin(sway) * Math.cos(pitch) * 10; ny -= Math.sin(pitch) * 10; nz += Math.cos(sway) * Math.cos(pitch) * 10;
    }
    P.head.position.set(nx / 16, ny / 16, nz / 16);
    P.head.rotation.set(lower * 1.5, 0, 0);
    P.jaw.rotation.x = (Math.sin(f) + 1) * 0.2 + (this.phase === 'perch' && this.phaseTime % 70 > 30 ? 0.4 : 0);
    // tail: a wave travelling back
    let tx = 0, ty = 14, tzz = -60;
    for (let i = 0; i < 12; i++) {
      const sway = Math.sin(t * 1.5 - i * 0.45) * 0.12;
      const T = P['tail' + i];
      T.position.set(tx / 16, ty / 16, tzz / 16);
      T.rotation.set(0.02 * i, sway, 0);
      tx -= Math.sin(sway) * 10; tzz -= Math.cos(sway) * 10; ty -= 0.3;
    }
    // red flash when hurt, a white-hot glow while dying
    const hurt = this.hurtTime > 0;
    const glow = this.dead ? Math.min(1, this.deathTime / 150) : 0;
    for (const mat of m.mats) {
      if (!mat.uniforms.uLight) continue;
      mat.uniforms.uLight.value.set(15, 15);
      mat.uniforms.uOverlay.value.set(1, glow ? 1 : 0, glow ? 1 : 0, glow ? glow * 0.8 : hurt ? 0.4 : 0);
    }
    this.renderBeam();
  }

  // the purple beam from a healing crystal
  renderBeam() {
    const g = this.game;
    const c = this.healFrom && !this.healFrom.removed && !this.dead ? this.healFrom : null;
    if (!c) { if (this.beam) this.beam.visible = false; return; }
    if (!this.beam) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
      this.beam = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xd28cff }));
      this.beam.frustumCulled = false;
      g.entities.group.add(this.beam);
    }
    const pos = this.beam.geometry.attributes.position.array;
    pos[0] = c.x; pos[1] = c.y + 1.6; pos[2] = c.z; pos[3] = this.x; pos[4] = this.y + 2; pos[5] = this.z;
    this.beam.geometry.attributes.position.needsUpdate = true;
    this.beam.visible = true;
  }

  remove() {
    if (this.beam) { this.beam.parent && this.beam.parent.remove(this.beam); this.beam = null; }
    super.remove();
  }
  toJSON() { return null; }
}
