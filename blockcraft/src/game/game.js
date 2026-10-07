// The running game: ties world, player, entities, rendering, sound and UI together.
import * as THREE from 'three';
import { BLOCKS, B, R, OPAQUE, LIQUID, WOODS } from '../shared/blocks.js';
import { ITEMS, I } from '../shared/items.js';
import { WH, SEA } from '../shared/constants.js';
import { WorldGen } from '../shared/worldgen.js';
import { BIOMES, BI, snowsAt } from '../shared/biomes.js';
import { rng } from '../shared/noise.js';
import { World } from '../world/world.js';
import { BlockTicks } from '../world/blockticks.js';
import { Player } from './player.js';
import { Entities, ItemEntity, XpOrb, FallingBlock, PrimedTnt } from './entities.js';
import { Mob, MOBS } from './mobs.js';
import { Boat, Minecart, isRail, connectRail } from './vehicles.js';
import { Redstone } from '../world/redstone.js';
import { Interaction } from './interact.js';
import { Particles } from '../engine/particles.js';
import { Hand, PlayerModel } from '../engine/hand.js';
import { Weather } from '../engine/weather.js';
import { EnchantBook } from '../engine/enchbook.js';
import { texInfo, blockArray } from '../engine/textures.js';
import { selectionBoxes, fenceConn } from '../shared/shapes.js';
import { Container, withCount, cloneStack, stackFromJSON } from './inventory.js';
import { SMELT } from './recipes.js';
import { FUEL } from '../shared/items.js';
import { Spawner } from './spawner.js';
import { ADVANCEMENTS } from './advancements.js';
import { runCommand } from './commands.js';
import { U } from '../engine/materials.js';
import { enchLevel, shelfOffsets } from '../shared/enchant.js';
import { NetherGen } from '../shared/nethergen.js';
import { brewResult, EFFECTS } from '../shared/potions.js';
import { EndGen, ARRIVAL, buildPodium } from '../shared/endgen.js';
import { EndCrystal } from './endentities.js';
import { EnderDragon } from './dragon.js';
import { lightPortal, portalCorner, findPortal, buildPortal } from './portals.js';

const TICK = 0.05;
// blocks silk touch never picks up whole
const NO_SILK = new Set([B.spawner, B.farmland, B.dirt_path, B.cake, B.red_bed, B.oak_door]);
const DIFF_NAMES = ['Peaceful', 'Easy', 'Normal', 'Hard'];

export class Game {
  constructor(app) {
    this.app = app;
    this.r = app.renderer;
    this.sound = app.sound;
    this.input = app.input;
    this.ui = app.ui;
    this.settings = app.settings;
    this.running = false;
    this.paused = false;
  }

  // ---------------------------------------------------------------- lifecycle
  async start(meta, store, onProgress) {
    const r = this.r;
    this.meta = meta;
    this.store = store;
    this.difficulty = meta.difficulty ?? 2;
    this.tickCount = 0;
    this.time = meta.time ?? 1000;
    this.day = meta.day ?? 0;
    this.weather = Object.assign({ rain: false, thunder: false, timer: 12000 + Math.random() * 96000, rainAmt: 0, thunderAmt: 0, flash: 0 }, meta.weather || {});
    this.stats = Object.assign({ mined: 0, placed: 0, kills: 0, deaths: 0, crafted: 0, walked: 0, enchanted: 0 }, meta.stats || {});
    this.advancements = new Set(meta.advancements || []);
    this.gen = new WorldGen(meta.seed);
    this.netherGen = new NetherGen(meta.seed);
    this.endGen = new EndGen(meta.seed);
    meta.portals = meta.portals || { overworld: [], nether: [] };
    r.renderDistance = this.settings.renderDistance;
    await this.makeWorld(meta.dim || 'overworld');

    this.entities = new Entities(this, r.scene);
    this.particles = new Particles(r.scene, blockArray, this.world);
    this.particles.tintFn = (kind, x, z) => this.tintAt(kind, x, z);
    this.ticks = new BlockTicks(this);
    this.redstone = new Redstone(this);
    this.player = new Player(this);
    this.interaction = new Interaction(this);
    this.spawner = new Spawner(this);
    this.hand = new Hand(r, 'entity/steve');
    this.playerModel = new PlayerModel(r.scene, 'entity/steve');
    this.weatherFx = new Weather(r.scene);
    this.activeTiles = new Set();
    this.books = new Map(); // enchanting table books by block key
    this.selection = this.makeSelectionBox();
    this.breakOverlay = this.makeBreakOverlay();
    this.camMode = 0; // 0 first person, 1 back, 2 front
    this.hurtTilt = 0;
    this.shake = 0;
    this.acc = 0;
    this.clock = 0;
    this.fovSmooth = 1;
    this.sleepTimer = 0;
    this.lastSave = 0;

    if (meta.player) {
      this.player.load(meta.player);
      this.player.mode = meta.player.mode || meta.mode;
    } else {
      this.player.mode = meta.mode || 'survival';
      const sp = this.findSpawn();
      meta.spawn = sp;
      this.player.x = this.player.px = sp[0] + 0.5;
      this.player.z = this.player.pz = sp[2] + 0.5;
      this.player.y = this.player.py = sp[1];
      this.needsGround = true;
      this.player.yaw = Math.random() * Math.PI * 2;
    }
    this.spawnPos = meta.spawn || [0, 80, 0];
    if (this.player.mode === 'creative') this.player.flying = !!(meta.player && meta.player.flying);
    // saved entities wait until their chunk is loaded
    this.parked = (meta.entities || []).filter(Boolean);

    // wait for the terrain around the player
    await this.waitForTerrain(onProgress);
    if (this.needsGround) this.dropToGround();
    this.running = true;
    this.lastFrame = performance.now();
    this.ui.onGameStart(this);
    this.message(`Welcome to ${meta.name}!`, '#ffff55');
    if (this.player.dead) this.ui.showDeath(this.deathMessage || 'You died!', this.player.level);
  }

  // a fresh World for one dimension; chunks of other dimensions are stored under id~dimension
  async makeWorld(dim) {
    const r = this.r, meta = this.meta, store = this.store;
    const key = dim === 'overworld' ? meta.id : meta.id + '~' + dim;
    this.dim = dim;
    this.dimKey = key;
    const w = new World(this, meta.seed, texInfo, dim);
    w.materials = r.chunkMats;
    w.renderDistance = this.settings.renderDistance;
    w.setFastLeaves(!this.settings.fancyLeaves);
    w.loadChunkData = (cx, cz) => store.loadChunk(key, cx, cz);
    w.saveChunk = (c) => this.saveChunk(c);
    w.onBlockChanged = (x, y, z, old, v) => this.blockChanged(x, y, z, old, v);
    w.onChunkLoaded = (c, spawns, fresh) => this.chunkLoaded(c, spawns, fresh);
    w.onChunkUnloaded = (c) => this.chunkUnloaded(c);
    w.onTileRemoved = (t, x, y, z) => this.tileRemoved(t, x, y, z);
    w.savedKeys = await store.chunkKeys(key);
    r.scene.add(w.scene);
    this.world = w;
    if (this.particles) this.particles.world = w;
  }

  // wait until the terrain around the player is generated and meshed
  waitForTerrain(onProgress) {
    const t0 = performance.now(), p = this.player, cam = this.r.camera;
    return new Promise((resolve) => {
      const step = () => {
        this.world.update(p.x, p.z, cam);
        const n = Math.min(2, this.world.renderDistance);
        const ready = this.world.readyAround(p.x, p.z, n);
        if (onProgress) onProgress(Math.min(0.99, this.world.loadedCount() / ((2 * n + 3) ** 2)));
        if (ready || performance.now() - t0 > 30000) resolve();
        else setTimeout(step, 30);
      };
      step();
    });
  }

  // move the player to another dimension. arrive() runs once the new terrain is ready.
  async changeDimension(dim, x, y, z, arrive) {
    if (this.travelling) return;
    this.travelling = true;
    const p = this.player, meta = this.meta;
    const names = { nether: 'the Nether', end: 'the End', overworld: 'the Overworld' };
    this.ui.closeScreen();
    this.app.ui.menus.showLoading(dim === 'overworld' ? 'Leaving ' + names[this.dim] : 'Entering ' + names[dim]);
    this.running = false;
    if (p.vehicle) p.vehicle.dismount();
    if (p.bobber) p.bobber.remove();
    this.interaction.stopMining();
    this.interaction.stopUsing();
    // put this dimension away: its chunks, and its creatures for when we come back
    await this.save();
    meta.away = meta.away || {};
    meta.away[this.dim] = meta.entities || [];
    meta.entities = [];
    this.world.dispose();
    this.r.scene.remove(this.world.scene);
    this.entities.clear();
    this.particles.clear();
    for (const b of this.books.values()) b.dispose();
    this.books.clear();
    this.activeTiles.clear();
    this.ticks.sched.clear(); this.ticks.queue = [];
    this.redstone.pending.clear(); this.redstone.plates.clear(); this.redstone.detectors.clear();
    this.sound.stopLoops();
    this.parked = (meta.away[dim] || []).filter(Boolean);
    delete meta.away[dim];
    await this.makeWorld(dim);
    p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z;
    p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
    await this.waitForTerrain((f) => this.app.ui.menus.loadProgress(f));
    if (arrive) arrive();
    p.px = p.x; p.py = p.y; p.pz = p.z;
    this.app.ui.menus.hideLoading();
    this.travelling = false;
    this.running = true;
    this.lastFrame = performance.now();
    if (dim === 'nether') { this.advance('portal'); this.advance('nether'); }
    this.save();
  }

  // ---------------------------------------------------------------- portals
  podiumY() { return this.endGen.podiumY(); }

  portalTick() {
    const p = this.player;
    const w = this.world;
    // end portals take you at once
    if (!p.dead && !this.travelling && !p.portalLock && w.getId(Math.floor(p.x), Math.floor(p.y + 0.1), Math.floor(p.z)) === B.end_portal) {
      p.portalLock = true;
      this.sound.play('portal.travel', null, null, null, 0.7, 0.7);
      if (this.dim === 'end') this.leaveEnd();
      else this.changeDimension('end', ARRIVAL[0] + 0.5, ARRIVAL[1], ARRIVAL[2] + 0.5, () => this.arriveInEnd());
      return;
    }
    const inPortal = !p.dead && [0.2, 1.2].some((dy) => w.getId(Math.floor(p.x), Math.floor(p.y + dy), Math.floor(p.z)) === B.nether_portal);
    if (!inPortal) { p.portalTime = 0; p.portalLock = false; return; }
    if (p.portalLock || this.travelling || p.mode === 'spectator') return;
    p.portalTime = (p.portalTime || 0) + 1;
    if (p.portalTime === 2) this.sound.play('portal.travel', p.x, p.y, p.z, 0.3, 0.6);
    if (p.portalTime >= (p.creative ? 2 : 80)) {
      p.portalTime = 0;
      p.portalLock = true;
      this.usePortal();
    }
  }

  // a fresh obsidian platform out over the void, like vanilla's
  arriveInEnd() {
    const w = this.world, p = this.player;
    const [ax, ay, az] = ARRIVAL;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      w.setBlock(ax + dx, ay - 1, az + dz, B.obsidian);
      for (let y = ay; y < ay + 3; y++) w.setBlock(ax + dx, y, az + dz, 0);
    }
    w.flushDirty(ax >> 4, az >> 4);
    p.x = ax + 0.5; p.y = ay; p.z = az + 0.5; p.yaw = Math.PI / 2;
    p.portalLock = true;
    this.advance('end');
    this.ensureDragon();
  }

  // the dragon lives until it is killed (it comes back if you leave and return)
  ensureDragon() {
    if (this.dim !== 'end' || this.meta.dragonKilled) return;
    if (this.dragon && !this.dragon.removed) return;
    this.dragon = this.entities.add(new EnderDragon(this, 0.5, 90, 40.5));
  }

  // dragon slain: the exit portal opens, the egg appears and the experience rains down
  onDragonDeath(d) {
    const first = !this.meta.dragonKilled && !this.meta.dragonEver;
    this.meta.dragonKilled = true;
    this.meta.dragonEver = true;
    this.dragon = null;
    const y0 = this.podiumY(), w = this.world;
    buildPodium((x, y, z, v) => w.setBlock(x, y, z, v), y0, true);
    if (first) w.setBlock(0, y0 + 4, 0, B.dragon_egg);
    w.flushDirty(0, 0);
    const orbs = first ? 48 : 20, each = first ? 250 : 25;
    for (let i = 0; i < orbs; i++) this.entities.add(new XpOrb(this, d.x + (Math.random() - 0.5) * 4, d.y, d.z + (Math.random() - 0.5) * 4, each));
    this.message('The Ender Dragon has been defeated!', '#ff55ff');
    this.advance('dragon');
  }

  // four crystals around the exit portal summon the dragon again
  crystalPlaced() {
    if (this.dim !== 'end' || !this.meta.dragonKilled) return;
    const y0 = this.podiumY();
    const near = this.entities.list.filter((e) => e.type === 'end_crystal' && !e.dead && Math.hypot(e.x, e.z) < 6 && Math.abs(e.y - y0) < 3);
    if (near.length < 4) return;
    for (const c of near) { c.dead = true; c.remove(); this.particles.explosion(c.x, c.y + 1, c.z, 1); }
    this.meta.dragonKilled = false;
    const w = this.world;
    buildPodium((x, y, z, v) => w.setBlock(x, y, z, v), y0, false);
    w.flushDirty(0, 0);
    this.sound.play('dragon.growl', 0, y0 + 10, 0, 3, 0.7, { range: 200 });
    this.message('The Ender Dragon returns!', '#ff55ff');
    this.ensureDragon();
  }

  // through the exit portal: the credits roll, then home
  leaveEnd() {
    const p = this.player;
    const go = () => {
      const s = p.spawn || this.spawnPos;
      this.changeDimension('overworld', s[0] + 0.5, s[1], s[2] + 0.5, () => {
        const ok = p.spawn && this.world.getId(p.spawn[0], p.spawn[1] - 1, p.spawn[2]) === B.red_bed;
        if (!ok) { const t = this.spawnPos; p.x = t[0] + 0.5; p.z = t[2] + 0.5; p.y = t[1]; this.dropToGround(); }
      });
    };
    if (!this.meta.seenCredits) { this.meta.seenCredits = true; this.running = false; this.app.ui.menus.showEndCredits(() => { this.running = true; this.lastFrame = performance.now(); go(); }); } else go();
  }

  // an eye placed in a frame: a complete ring of twelve eyes opens the portal
  checkEndPortal(x, y, z) {
    const w = this.world;
    const v = w.getBlock(x, y, z), f = (v >>> 10) & 3;
    const D = [[0, 1], [-1, 0], [0, -1], [1, 0]][f]; // the way the frame faces (into the ring)
    const P = [D[1], D[0]]; // along the frame's side
    const frameOK = (fx, fz, facing) => { const fv = w.getBlock(fx, y, fz); return (fv & 1023) === B.end_portal_frame && ((fv >>> 10) & 3) === facing && ((fv >>> 10) & 4); };
    for (let k = -1; k <= 1; k++) {
      const cx = x + D[0] * 2 + P[0] * k, cz = z + D[1] * 2 + P[1] * k;
      let ok = true;
      for (let j = -1; j <= 1 && ok; j++) {
        ok = frameOK(cx + j, cz - 2, 0) && frameOK(cx + j, cz + 2, 2) && frameOK(cx - 2, cz + j, 3) && frameOK(cx + 2, cz + j, 1);
      }
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.setBlock(cx + dx, y, cz + dz, B.end_portal);
      w.flushDirty(cx >> 4, cz >> 4);
      this.sound.play('portal.end_open', null, null, null, 1, 1);
      return true;
    }
    return false;
  }

  recordPortal(dim, c) {
    const list = this.meta.portals[dim] || (this.meta.portals[dim] = []);
    if (!list.some((q) => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) list.push(c.slice(0, 4));
    if (list.length > 64) list.shift();
  }

  usePortal() {
    const p = this.player, w = this.world;
    if (this.dim === 'end') return;
    const from = this.dim, to = from === 'nether' ? 'overworld' : 'nether';
    const here = portalCorner(w, Math.floor(p.x), Math.floor(p.y + 0.2), Math.floor(p.z)) || portalCorner(w, Math.floor(p.x), Math.floor(p.y + 1.2), Math.floor(p.z));
    if (here) this.recordPortal(from, here);
    const s = to === 'nether' ? 1 / 8 : 8;
    const tx = Math.floor(p.x * s), tz = Math.floor(p.z * s);
    const ty = Math.floor(to === 'nether' ? Math.max(34, Math.min(110, p.y)) : Math.min(WH - 10, p.y));
    // the nearest portal already linked on the other side
    const r = to === 'nether' ? 16 : 128;
    let link = null, bd = Infinity;
    for (const q of this.meta.portals[to] || []) {
      const d = Math.max(Math.abs(q[0] - tx), Math.abs(q[2] - tz));
      if (d <= r && d < bd) { bd = d; link = q; }
    }
    const goal = link ? [link[0] + 0.5, link[1], link[2] + 0.5] : [tx + 0.5, ty, tz + 0.5];
    this.sound.play('portal.travel', null, null, null, 0.6, 0.9);
    this.changeDimension(to, goal[0], goal[1], goal[2], () => this.arriveByPortal(to, link, tx, ty, tz));
  }

  // stand the player in the portal on this side, building one if there is none
  arriveByPortal(dim, link, tx, ty, tz) {
    const w = this.world, p = this.player;
    let c = null;
    if (link) {
      c = findPortal(w, link[0], link[1], link[2], 3);
      if (!c) this.meta.portals[dim] = (this.meta.portals[dim] || []).filter((q) => q !== link);
    }
    if (!c) c = findPortal(w, tx, ty, tz, dim === 'nether' ? 16 : 24);
    if (!c) c = buildPortal(w, tx, ty, tz, dim);
    this.recordPortal(dim, c);
    const [x, y, z, axis] = c;
    p.x = x + 0.5 + (axis === 0 ? 0.5 : 0); p.z = z + 0.5 + (axis === 1 ? 0.5 : 0); p.y = y;
    // step out facing away from the portal's plane
    p.yaw = axis === 0 ? (Math.cos(p.yaw) >= 0 ? 0 : Math.PI) : (Math.sin(p.yaw) >= 0 ? Math.PI / 2 : -Math.PI / 2);
    p.portalLock = true; p.portalTime = 0;
  }

  async stop(save = true) {
    this.running = false;
    if (save) await this.save();
    this.sound.stopLoops();
    this.world.dispose();
    this.entities.clear();
    this.particles.clear();
    this.r.scene.remove(this.world.scene);
    this.r.scene.remove(this.entities.group);
    this.r.scene.remove(this.particles.mesh);
    this.r.scene.remove(this.selection);
    this.r.scene.remove(this.breakOverlay);
    this.r.scene.remove(this.playerModel.root);
    this.r.handScene.remove(this.hand.root);
    this.weatherFx.dispose(this.r.scene);
    for (const b of this.books.values()) b.dispose();
    this.books.clear();
  }

  // pick a land column near the origin for a new world
  findSpawn() {
    const col = {};
    const rnd = rng(this.meta.seed);
    for (let r = 0; r < 2000; r += 16) {
      for (let i = 0; i < 12; i++) {
        const a = rnd() * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        this.gen.column(x, z, col);
        const b = col.biome;
        if (b === BI.OCEAN || b === BI.FROZEN_OCEAN || b === BI.RIVER || b === BI.FROZEN_RIVER || b === BI.BEACH) continue;
        if (col.h <= SEA + 1 || col.mf > 0.2) continue;
        if (r < 200 && (b === BI.MOUNTAINS || b === BI.SNOWY_MOUNTAINS || b === BI.DARK_FOREST)) continue;
        return [x, col.h + 1, z];
      }
    }
    return [0, 90, 0];
  }

  dropToGround() {
    const p = this.player;
    const x = Math.floor(p.x), z = Math.floor(p.z);
    let y = WH - 1;
    while (y > 0) {
      const id = this.world.getId(x, y, z);
      if (id && (BLOCKS[id].solid || LIQUID[id])) break;
      y--;
    }
    // avoid spawning inside leaves: walk down through the canopy to open ground nearby
    if (BLOCKS[this.world.getId(x, y, z)].name.endsWith('_leaves')) {
      for (let r = 1; r < 12; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        let yy = WH - 1;
        while (yy > 0 && !(this.world.getId(x + dx, yy, z + dz) && (BLOCKS[this.world.getId(x + dx, yy, z + dz)].solid || LIQUID[this.world.getId(x + dx, yy, z + dz)]))) yy--;
        const gid = this.world.getId(x + dx, yy, z + dz);
        if (gid === B.grass_block || gid === B.sand || gid === B.snow || gid === B.dirt || gid === B.podzol) {
          p.x = p.px = x + dx + 0.5; p.z = p.pz = z + dz + 0.5; p.y = p.py = yy + 1;
          this.spawnPos = this.meta.spawn = [x + dx, yy + 1, z + dz];
          return;
        }
      }
    }
    p.y = p.py = y + 1;
    this.spawnPos = this.meta.spawn = [x, y + 1, z];
  }

  // ---------------------------------------------------------------- main loop
  frame(now) {
    if (!this.running) return;
    let dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.clock += dt;
    const p = this.player;
    const paused = this.paused;
    if (!paused) {
      this.readInput(dt);
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK && n < 6) { this.tick(); this.acc -= TICK; n++; }
      if (n >= 6) this.acc = 0;
    }
    const a = paused ? 1 : this.acc / TICK;
    // camera
    const eye = this.eyePos(a);
    const cam = this.r.camera;
    this.updateCamera(eye, a, dt);
    const dir = p.lookDir();
    this.interaction.updateTarget(this.eyePos(1), dir);
    this.world.update(p.x, p.z, cam);
    this.sound.setListener(eye[0], eye[1], eye[2], p.yaw);
    // environment
    const under = p.eyeInWater ? 1 : p.eyeInLava ? 2 : 0;
    const over = this.dim === 'overworld';
    this.daylight = this.r.updateEnvironment({
      time: this.time + a, day: this.day, rain: over ? this.weather.rainAmt : 0, thunder: over ? this.weather.thunderAmt : 0, flash: over ? this.weather.flash : 0,
      underwater: under, dt, time_s: this.clock, clouds: this.settings.clouds, gamma: this.settings.gamma,
      dim: this.dim, fog: over ? undefined : this.biomeAt(p.x, p.z).fog,
      nightVision: p.effects.night_vision ? (p.effects.night_vision.t > 200 ? 1 : 0.7 + 0.3 * Math.sin(p.effects.night_vision.t * 0.3)) : 0,
    });
    // dim the sky light when standing in a cave so fog isn't glowing
    this.entities.render(a, this.clock);
    this.renderBooks(a);
    this.particles.update(paused ? 0 : dt);
    this.weatherFx.update(this.world, this, cam.position, over ? this.weather.rainAmt : 0, paused ? 0 : dt);
    this.updateSelection();
    this.updateHand(a, dt);
    const third = this.camMode !== 0;
    this.playerModel.root.visible = third && !p.dead;
    if (third) {
      this.playerModel.setHeld(p.inv.held);
      const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
      this.playerModel.update(p, a, this.clock, [l >> 4, l & 15]);
    }
    this.r.render(!third && !p.dead && !this.ui.hideHud && p.mode !== 'spectator');
    this.ui.frame(this, dt);
    this.sound.music && this.sound.music.update(this.settings.music > 0);
    this.input.endFrame();
  }

  readInput(dt) {
    const inp = this.input, p = this.player, ui = this.ui;
    const t = inp.touch;
    const gameInput = !ui.screenOpen && !ui.chatOpen;
    const sens = 0.0022 * (this.settings.sensitivity / 100 * 2);
    if (gameInput) {
      let dx = inp.mouseDX, dy = inp.mouseDY;
      dx += t.lookDX; dy += t.lookDY;
      if (this.settings.invertY) dy = -dy;
      if (!p.sleeping && !p.dead) {
        p.yaw -= dx * sens;
        p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch - dy * sens));
      }
      // hotbar
      if (inp.wheel) p.inv.selected = ((p.inv.selected + inp.wheel) % 9 + 9) % 9;
      for (let i = 0; i < 9; i++) if (inp.hitCode('Digit' + (i + 1))) p.inv.selected = i;
    }
    // continuous inputs are sampled per tick in tick()
    void dt;
  }

  gatherTickInput() {
    const inp = this.input, p = this.player, t = inp.touch;
    const ok = !this.ui.screenOpen && !this.ui.chatOpen && !p.dead;
    const I2 = p.input;
    if (!ok) { I2.f = I2.s = 0; I2.jump = I2.sneak = I2.sprint = false; this._attack = false; this._use = false; return { attack: false, use: false }; }
    let f = 0, s = 0;
    if (inp.down('forward')) f += 1;
    if (inp.down('back')) f -= 1;
    if (inp.down('left')) s -= 1;
    if (inp.down('right')) s += 1;
    f += -t.my; s += t.mx;
    I2.f = Math.max(-1, Math.min(1, f)); I2.s = Math.max(-1, Math.min(1, s));
    I2.jump = inp.down('jump') || t.jump || t.flyUp;
    I2.sneak = inp.down('sneak') || t.sneak || t.flyDown;
    I2.sprint = inp.down('sprint') || inp.sprintTap || t.sprint;
    I2.up = t.flyUp; I2.down = t.flyDown;
    // creative flight toggle: double tap jump
    if (this._doubleSpace && (p.creative || p.mode === 'spectator')) { p.flying = !p.flying || p.mode === 'spectator'; p.vy = 0; }
    this._doubleSpace = false;
    const attack = inp.mouse(0) || t.attack;
    const use = inp.mouse(2) || t.use;
    const res = { attack, use, attackPressed: attack && !this._attack, usePressed: use && !this._use };
    this._attack = attack; this._use = use;
    return res;
  }

  tick() {
    const p = this.player;
    this.tickCount++;
    // time of day
    if (!this.frozenTime) {
      this.time += 1;
      if (this.time >= 24000) { this.time -= 24000; this.day++; }
    }
    this.weatherTick();
    const inp = this.gatherTickInput();
    this.interaction.tick(inp);
    if (this.needsGround && this.world.isLoaded(Math.floor(p.x), Math.floor(p.z))) { this.dropToGround(); this.needsGround = false; }
    const wasDead = p.dead;
    p.tick();
    if (!wasDead && !p.dead) this.stats.walked += Math.hypot(p.x - p.px, p.z - p.pz);
    this.entities.tick();
    this.tickBooks();
    this.ticks.runScheduled();
    this.redstone.tick();
    this.ticks.randomTicks(p.x, p.z, Math.min(6, this.world.renderDistance), 3);
    this.tileTick();
    if (this.tickCount % 20 === 0) this.spawner.tick();
    this.ambientTick();
    this.sleepTick();
    this.portalTick();
    if (this.dim === 'end' && this.tickCount % 100 === 0) this.ensureDragon();
    if (this.tickCount - this.lastSave > 20 * 45) { this.lastSave = this.tickCount; this.save(); }
  }

  // ---------------------------------------------------------------- input from keyboard (per frame events)
  handleKey(code) {
    const p = this.player, inp = this.input;
    const B2 = inp.binds;
    if (code === B2.perspective) { this.camMode = (this.camMode + 1) % 3; return true; }
    if (code === B2.drop && !p.dead) { this.dropHeld(inp.down('sprint')); return true; }
    if (code === B2.swap) return true;
    if (code === B2.jump) {
      const now = performance.now();
      if (now - (this.lastJumpTap || 0) < 280) this._doubleSpace = true;
      this.lastJumpTap = now;
    }
    return false;
  }

  dropHeld(all) {
    const p = this.player;
    const h = p.inv.held;
    if (!h) return;
    const n = all ? h.count : 1;
    const d = p.lookDir();
    this.dropItem(p.x, p.y + p.eye - 0.3, p.z, withCount(h, n), { vx: d[0] * 0.3, vy: d[1] * 0.3 + 0.1, vz: d[2] * 0.3, delay: 40 });
    h.count -= n;
    if (h.count <= 0) p.inv.held = null;
    p.swing = 6;
  }

  // ---------------------------------------------------------------- camera
  eyePos(a = 1) {
    const p = this.player;
    const [x, y, z] = p.renderPos(a);
    const eye = p.prevEye + (p.eyeSmooth - p.prevEye) * a;
    return [x, y + (p.sleeping ? 0.3 : eye), z];
  }

  updateCamera(eye, a, dt) {
    const p = this.player, cam = this.r.camera;
    let [x, y, z] = eye;
    let yaw = p.yaw, pitch = p.pitch, roll = 0;
    // view bobbing
    const bob = this.settings.viewBobbing ? p.prevBob + (p.bob - p.prevBob) * a : 0;
    const walk = (p.walkDist + (p.walkDist - p.prevWalkDist) * a) * 0.6;
    this.bobX = Math.sin(walk * Math.PI) * bob * 0.5;
    this.bobY = -Math.abs(Math.cos(walk * Math.PI) * bob);
    // hurt tilt
    if (p.hurtTime > 0) this.hurtTilt = Math.max(this.hurtTilt, p.hurtTime / 10);
    this.hurtTilt = Math.max(0, this.hurtTilt - dt * 4);
    roll += Math.sin(this.hurtTilt * Math.PI) * 0.12 * (this.settings.viewBobbing ? 1 : 0.5);
    if (p.dead) roll = Math.min(1, (p.deadTime || 0) / 20) * 0.6;
    if (this.camMode === 0) {
      const sin = Math.sin(yaw), cos = Math.cos(yaw);
      x += cos * this.bobX; z -= sin * this.bobX; y += this.bobY;
      roll += this.bobX * 0.04;
      pitch += Math.abs(Math.cos(walk * Math.PI - 0.2) * bob) * 0.04;
    } else {
      // third person: back off along the view direction, stopping at walls
      const d = this.camMode === 1 ? -1 : 1;
      const cp = Math.cos(pitch);
      const dx = Math.sin(yaw) * cp * d, dy = -Math.sin(pitch) * d, dz = Math.cos(yaw) * cp * d;
      let dist = 4;
      for (let t = 0.2; t <= 4; t += 0.1) {
        if (OPAQUE[this.world.getId(Math.floor(x - dx * t), Math.floor(y - dy * t), Math.floor(z - dz * t))]) { dist = t - 0.25; break; }
      }
      x -= dx * dist; y -= dy * dist; z -= dz * dist;
      if (this.camMode === 2) { yaw += Math.PI; pitch = -pitch; }
    }
    if (this.shake > 0) { x += (Math.random() - 0.5) * this.shake; y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 2); }
    cam.position.set(x, y, z);
    cam.rotation.set(pitch, yaw, roll);
    // FOV effects
    let fov = 1;
    if (p.sprinting && this.settings.fovEffects) fov *= 1.12;
    if (p.flying && p.sprinting) fov *= 1.05;
    const u = this.interaction.using;
    if (u && u.kind === 'bow') fov *= 1 - Math.min(1, u.ticks / 20) * 0.15;
    if (p.eyeInWater) fov *= 0.88;
    this.fovSmooth += (fov - this.fovSmooth) * Math.min(1, dt * 10);
    this.r.fov = this.settings.fov;
    this.r.fovMul = this.fovSmooth;
  }

  // where the fishing line leaves the rod: in front of the eye in first person, out past the hand otherwise
  rodTip(a) {
    const p = this.player;
    const [x, y, z] = p.renderPos(a);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    if (this.camMode === 0) {
      const d = p.lookDir();
      return [x + d[0] * 0.6 + rx * 0.32, y + p.eye + d[1] * 0.6 + 0.06, z + d[2] * 0.6 + rz * 0.32];
    }
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    return [x + rx * 0.35 + fx * 0.9, y + 1.85, z + rz * 0.35 + fz * 0.9];
  }

  updateHand(a, dt) {
    const p = this.player;
    const l = this.world.getLight(Math.floor(p.x), Math.floor(p.y + p.eye), Math.floor(p.z));
    const swingT = p.swing > 0 ? (6 - p.swing + a) / 6 : 0;
    this.hand.update({
      stack: p.inv.held, slot: p.inv.selected, swing: Math.max(0, Math.min(1, swingT)), bobX: this.bobX || 0, bobY: this.bobY || 0,
      light: [l >> 4, l & 15], using: this.interaction.using, time: this.clock,
    }, dt);
  }

  // ---------------------------------------------------------------- selection + crack overlay
  makeSelectionBox() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24 * 3 * 6), 3));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
    m.frustumCulled = false;
    m.visible = false;
    this.r.scene.add(m);
    return m;
  }
  updateSelection() {
    const t = this.interaction.target;
    const sel = this.selection;
    if (!t || this.ui.hideHud) { sel.visible = false; return; }
    let conn = 0;
    if (BLOCKS[t.id].render === R.FENCE) conn = fenceConn((dx, dz) => this.world.getId(t.x + dx, t.y, t.z + dz));
    const boxes = selectionBoxes(t.id, t.meta, conn);
    const pos = sel.geometry.attributes.position.array;
    let n = 0;
    const e = 0.002;
    for (const b of boxes.slice(0, 6)) {
      const x0 = t.x + b[0] - e, y0 = t.y + b[1] - e, z0 = t.z + b[2] - e, x1 = t.x + b[3] + e, y1 = t.y + b[4] + e, z1 = t.z + b[5] + e;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (const i of edges) { pos[n++] = c[i][0]; pos[n++] = c[i][1]; pos[n++] = c[i][2]; }
    }
    sel.geometry.setDrawRange(0, n / 3);
    sel.geometry.attributes.position.needsUpdate = true;
    sel.visible = true;
  }

  makeBreakOverlay() {
    const info = texInfo.destroy;
    const g = new THREE.BoxGeometry(1.003, 1.003, 1.003);
    const layer = info ? info.layer : 0;
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uAtlas: { value: blockArray }, uLayer: { value: layer } },
      vertexShader: 'out vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'precision highp sampler2DArray; uniform sampler2DArray uAtlas; uniform float uLayer; in vec2 vUv; out vec4 o; void main(){ vec4 c = texture(uAtlas, vec3(vUv.x, 1.0 - vUv.y, uLayer)); if (c.a < 0.1) discard; o = vec4(c.rgb * 0.6, c.a * 0.75); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(g, mat);
    m.visible = false;
    m.renderOrder = 20;
    this.r.scene.add(m);
    this.destroyBase = layer;
    return m;
  }
  setBreakProgress(st) {
    const m = this.breakOverlay;
    if (!st) { m.visible = false; return; }
    m.visible = true;
    m.position.set(st.x + 0.5, st.y + 0.5, st.z + 0.5);
    m.material.uniforms.uLayer.value = this.destroyBase + st.stage;
  }

  // ---------------------------------------------------------------- world events
  blockChanged(x, y, z, old, v) {
    this.redstone.changed(x, y, z);
    if ((old & 1023) === B.enchanting_table) this.removeBook(x, y, z);
    if ((v & 1023) === B.enchanting_table) this.addBook(x, y, z);
    this.ticks.neighborChanged(x, y, z);
    const oid = old & 1023;
    if (WOODS.some((w) => B[w + '_log'] === oid)) this.ticks.logRemoved(x, y, z);
  }

  // ---------------------------------------------------------------- enchanting table books
  addBook(x, y, z) {
    const k = `${x},${y},${z}`;
    if (!this.books.has(k)) this.books.set(k, new EnchantBook(this.entities.group, x, y, z));
  }
  removeBook(x, y, z) {
    const k = `${x},${y},${z}`;
    const b = this.books.get(k);
    if (b) { b.dispose(); this.books.delete(k); }
  }
  tickBooks() {
    const p = this.player;
    for (const b of this.books.values()) {
      const d = Math.hypot(p.x - b.x - 0.5, p.y - b.y - 0.5, p.z - b.z - 0.5);
      b.tick(!p.dead && p.mode !== 'spectator' && d < 3 ? p : null);
      if (d > 24) continue;
      // glyphs drift from the bookshelves that power the table
      if (!b.shelves || this.tickCount % 40 === 0) b.shelves = shelfOffsets(this.world, b.x, b.y, b.z);
      for (const o of b.shelves) if (Math.random() < 1 / 16) this.particles.enchantGlyph(b.x, b.y, b.z, o[0], o[1], o[2]);
    }
  }
  renderBooks(a) {
    for (const b of this.books.values()) {
      const l = this.world.getLight(b.x, b.y + 1, b.z);
      b.render(a, [l >> 4, Math.max(7, l & 15)]);
    }
  }

  chunkLoaded(c, spawns, freshTiles) {
    // enchanting tables get their floating book
    if (c.blocks) {
      const bl = c.blocks;
      for (let i = 0; i < bl.length; i++) {
        if ((bl[i] & 1023) === B.enchanting_table) this.addBook(c.cx * 16 + (i & 15), i >> 8, c.cz * 16 + ((i >> 4) & 15));
      }
    }
    // generated tile entities carry item names: convert
    for (const t of c.tiles.values()) {
      if (t.type === 'chest' && Array.isArray(t.items) && !(t.items instanceof Container)) {
        const ct = new Container(27);
        t.items.forEach((s, i) => { ct.slots[i] = stackFromJSON(s); });
        t.items = ct;
        if (freshTiles) t.dungeon = true;
      }
      if (t.type === 'furnace' && Array.isArray(t.items)) {
        const ct = new Container(3);
        ct.load(t.items);
        t.items = ct;
      }
      if (t.type === 'brewing' && Array.isArray(t.items)) {
        const ct = new Container(5);
        ct.load(t.items);
        t.items = ct;
      }
      if (t.type === 'furnace' || t.type === 'spawner' || t.type === 'brewing') this.activeTiles.add(t);
    }
    for (const s of spawns || []) {
      if (s.type === 'end_crystal') { if (!this.meta.dragonKilled || !this.meta.dragonEver) this.entities.add(new EndCrystal(this, s.x, s.y, s.z, true)); continue; }
      this.spawnMob(s.type, s.x, s.y, s.z, { persistent: true, ...(s.opts || {}) });
    }
    // bring back entities that were saved or parked in this chunk
    if (this.parked && this.parked.length) {
      const x0 = c.cx * 16, z0 = c.cz * 16;
      const keep = [];
      for (const o of this.parked) {
        if (o.x >= x0 && o.x < x0 + 16 && o.z >= z0 && o.z < z0 + 16) this.loadEntity(o);
        else keep.push(o);
      }
      this.parked = keep;
    }
  }
  chunkUnloaded(c) {
    for (const t of c.tiles.values()) this.activeTiles.delete(t);
    for (const [k, b] of this.books) if (b.x >> 4 === c.cx && b.z >> 4 === c.cz) { b.dispose(); this.books.delete(k); }
    // freeze far-away entities: remove non-persistent ones, keep animals (saved with the world)
    const x0 = c.cx * 16, z0 = c.cz * 16;
    for (const e of this.entities.list) {
      if (e.removed || (e.def && e.def.boss)) continue; // the dragon roams beyond loaded terrain
      if (e.x >= x0 && e.x < x0 + 16 && e.z >= z0 && e.z < z0 + 16) {
        if ((e.isMob && e.persistent) || (e.isVehicle && !e.rider)) { const o = e.toJSON(); if (o) this.parked.push(o); }
        e.remove();
      }
    }
  }
  tileRemoved(t, x, y, z) {
    this.activeTiles.delete(t);
    if (t.items && t.items.slots) {
      for (const s of t.items.slots) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, { ...s }, { vx: (Math.random() - 0.5) * 0.3, vy: 0.2, vz: (Math.random() - 0.5) * 0.3 });
    }
    if (t.type === 'furnace' && t.xp > 0) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, Math.floor(t.xp));
    if (this.ui.openTile === t) this.ui.closeScreen();
  }

  tintAt(kind, x, z) {
    const c = this.world.getChunk(x >> 4, z >> 4);
    if (!c || !c.tints) return [0.5, 0.75, 0.35];
    const v = c.tints[kind][((z & 15) << 4) | (x & 15)];
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  // ---------------------------------------------------------------- spawning helpers
  dropItem(x, y, z, stack, opts) {
    if (!stack || stack.count <= 0 || !ITEMS[stack.id]) return null;
    return this.entities.add(new ItemEntity(this, x, y, z, cloneStack(stack), opts));
  }
  spawnXp(x, y, z, n) {
    while (n > 0) {
      const v = n >= 17 ? 17 : n >= 7 ? 7 : n >= 3 ? 3 : 1;
      n -= v;
      this.entities.add(new XpOrb(this, x, y, z, v));
    }
  }
  spawnMob(type, x, y, z, opts = {}) {
    if (!MOBS[type]) return null;
    return this.entities.add(new Mob(this, type, x, y, z, opts));
  }
  spawnFalling(x, y, z, v) { this.entities.add(new FallingBlock(this, x, y, z, v)); }
  igniteTnt(x, y, z, fuse = 80) {
    this.world.setBlock(x, y, z, 0);
    this.entities.add(new PrimedTnt(this, x, y, z, fuse));
    this.sound.play('tnt.ignite', x, y, z, 1);
  }

  loadEntity(o) {
    if (!o) return;
    if (o.t === 'mob') {
      const m = this.spawnMob(o.k, o.x, o.y, o.z, { health: o.h, baby: !!o.baby, color: o.color, sheared: !!o.sheared, tame: !!o.tame, sitting: !!o.sit, persistent: true, yaw: o.yaw, ...(o.extra || {}) });
      if (m && o.baby) m.growAge = o.grow ?? -24000;
      if (m && o.name) m.customName = o.name;
    } else if (o.t === 'item') {
      const e = this.dropItem(o.x, o.y, o.z, stackFromJSON(o.s), { vx: 0, vy: 0, vz: 0, delay: 0 });
      if (e) e.age = o.age || 0;
    } else if (o.t === 'end_crystal') {
      this.entities.add(new EndCrystal(this, o.x, o.y, o.z, o.base !== false));
    } else if (o.t === 'boat' || o.t === 'minecart') {
      const v = this.entities.add(o.t === 'boat' ? new Boat(this, o.x, o.y, o.z, o.wood, o.yaw || 0) : new Minecart(this, o.x, o.y, o.z));
      if (o.t === 'minecart') { v.vx = o.vx || 0; v.vz = o.vz || 0; }
      // a player saved while riding gets back in
      const p = this.player;
      if (p.ridingType === o.t && Math.hypot(p.x - v.x, p.z - v.z) < 1.5) { p.ridingType = null; v.mount(p); }
    }
  }

  // break a block in the world, dropping its items. byPlayer: from player mining (particles, sound)
  breakBlockNaturally(x, y, z, drops = true, silent = false, toolType = null, byPlayer = false) {
    const w = this.world;
    const v = w.getBlock(x, y, z);
    const id = v & 1023, meta = v >>> 10;
    if (!id) return;
    const b = BLOCKS[id];
    if (!silent || byPlayer) {
      this.particles.breakBlock(x, y, z, id);
      this.sound.breakBlock(x + 0.5, y + 0.5, z + 0.5, id);
    }
    // enchantments on the tool that broke it
    const held = byPlayer ? this.player.inv.held : null;
    const silk = enchLevel(held, 'silk_touch') > 0 && ITEMS[id] && !ITEMS[id].hidden && !NO_SILK.has(id) && !b.plant;
    const fortune = silk ? 0 : enchLevel(held, 'fortune');
    // multi-block structures
    let newV = 0;
    if (id === B.ice && byPlayer && !silk && this.player.mode === 'survival' && BLOCKS[w.getId(x, y - 1, z)].solid && this.dim !== 'nether') newV = B.water;
    w.setBlock(x, y, z, newV, { sync: byPlayer });
    if (id === B.oak_door) {
      const oy = (meta & 4) ? y - 1 : y + 1;
      if (w.getId(x, oy, z) === B.oak_door) w.setBlock(x, oy, z, 0, { sync: byPlayer });
    }
    if (id === B.red_bed) {
      const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][meta & 3];
      const ox = (meta & 4) ? x - dx : x + dx, oz = (meta & 4) ? z - dz : z + dz;
      if (w.getId(ox, y, oz) === B.red_bed) w.setBlock(ox, y, oz, 0, { sync: byPlayer });
    }
    if (drops && (!byPlayer || this.player.mode === 'survival')) {
      const rnd = Math.random;
      let list;
      if (silk) list = [[id, 1]];
      else if (b.drop === null) list = [];
      else if (typeof b.drop === 'function') list = b.drop(meta, rnd, toolType, fortune);
      else list = [[ITEMS[id] && !ITEMS[id].hidden ? id : null, 1]];
      if (id === B.oak_door) list = [[I.oak_door, 1]];
      if (id === B.red_bed) list = [[I.red_bed, 1]];
      for (const [it, n] of list) {
        const iid = typeof it === 'string' ? I[it] : it;
        if (iid === null || iid === undefined || n <= 0) continue;
        this.dropItem(x + 0.5 + (rnd() - 0.5) * 0.4, y + 0.3, z + 0.5 + (rnd() - 0.5) * 0.4, { id: iid, count: n });
      }
      if (b.xp && byPlayer && !silk) this.spawnXp(x + 0.5, y + 0.5, z + 0.5, b.xp[0] + Math.floor(rnd() * (b.xp[1] - b.xp[0] + 1)));
    }
  }

  // apply durability damage to the held item
  damageHeld(n) {
    const p = this.player;
    if (p.creative) return;
    const h = p.inv.held;
    if (!h) return;
    const it = ITEMS[h.id];
    if (!it.durability) return;
    // unbreaking: each point of wear only lands with chance 1 / (level + 1)
    const ub = enchLevel(h, 'unbreaking');
    if (ub) { let k = 0; for (let i = 0; i < n; i++) if (Math.random() < 1 / (ub + 1)) k++; n = k; }
    h.dmg = (h.dmg || 0) + n;
    if (h.dmg >= it.durability) {
      p.inv.held = null;
      this.sound.play('tool.break', p.x, p.y, p.z, 0.9);
      this.particles.itemCrumbs(p.x, p.y + p.eye - 0.3, p.z, h.id, 10, p.lookDir());
    }
  }

  // ---------------------------------------------------------------- block interaction (right click)
  interactBlock(x, y, z, hit) {
    const w = this.world, p = this.player;
    const v = w.getBlock(x, y, z);
    const id = v & 1023, meta = v >>> 10;
    switch (id) {
      case B.crafting_table: this.ui.openCrafting(); return true;
      case B.enchanting_table: this.ui.openEnchanting({ x, y, z }); return true;
      case B.brewing_stand: {
        let t = w.getTile(x, y, z);
        if (!t) { t = { type: 'brewing', items: new Container(5), fuel: 0, brew: 0 }; w.setTile(x, y, z, t); this.activeTiles.add(t); }
        this.ui.openBrewing(t);
        return true;
      }
      case B.anvil: this.ui.openAnvil({ x, y, z }); return true;
      case B.furnace: case B.lit_furnace: {
        let t = w.getTile(x, y, z);
        if (!t) { t = { type: 'furnace', items: new Container(3), burn: 0, burnMax: 0, cook: 0, xp: 0 }; w.setTile(x, y, z, t); this.activeTiles.add(t); }
        this.ui.openFurnace(t);
        return true;
      }
      case B.chest: {
        let t = w.getTile(x, y, z);
        if (!t) { t = { type: 'chest', items: new Container(27) }; w.setTile(x, y, z, t); }
        if (OPAQUE[w.getId(x, y + 1, z)]) return true;
        this.ui.openChest(t);
        this.sound.play('chest.open', x + 0.5, y + 0.5, z + 0.5, 0.6);
        if (t.dungeon) { this.advance('dungeon'); t.dungeon = false; }
        return true;
      }
      case B.end_portal_frame: {
        const held = p.inv.held;
        if (!held || held.id !== I.ender_eye || (meta & 4)) return false;
        w.setBlock(x, y, z, B.end_portal_frame | ((meta | 4) << 10), { sync: true });
        this.sound.play('portal.eye', x + 0.5, y + 0.5, z + 0.5, 0.8);
        for (let i = 0; i < 8; i++) this.particles.smoke(x + 0.5, y + 1, z + 0.5, 1, 0.4, 0.3);
        if (!p.creative) { held.count--; if (held.count <= 0) p.inv.held = null; }
        this.checkEndPortal(x, y, z);
        return true;
      }
      case B.dragon_egg: {
        // the egg won't be taken by hand: it blinks away
        for (let i = 0; i < 64; i++) {
          const tx = x + Math.floor((Math.random() - 0.5) * 16), ty = y + Math.floor((Math.random() - 0.5) * 8), tz = z + Math.floor((Math.random() - 0.5) * 16);
          if (w.getId(tx, ty, tz) !== 0 || !BLOCKS[w.getId(tx, ty - 1, tz)].solid) continue;
          w.setBlock(x, y, z, 0, { sync: true });
          w.setBlock(tx, ty, tz, B.dragon_egg, { sync: true });
          for (let k = 0; k < 16; k++) { const t = k / 16; this.particles.portal(x + 0.5 + (tx - x) * t, y + 0.5 + (ty - y) * t, z + 0.5 + (tz - z) * t); }
          break;
        }
        return true;
      }
      case B.lever: this.redstone.toggleLever(x, y, z); return true;
      case B.stone_button: case B.oak_button: this.redstone.pressButton(x, y, z); return true;
      case B.repeater: this.redstone.cycleRepeater(x, y, z); return true;
      case B.oak_door: {
        const lower = (meta & 4) ? y - 1 : y;
        const lv = w.getBlock(x, lower, z), uv = w.getBlock(x, lower + 1, z);
        const open = ((lv >>> 10) & 8) ? 0 : 8;
        w.setBlock(x, lower, z, B.oak_door | ((((lv >>> 10) & 23) | open) << 10), { sync: true });
        w.setBlock(x, lower + 1, z, B.oak_door | ((((uv >>> 10) & 7) | open) << 10), { sync: true });
        this.sound.play(open ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 0.7);
        return true;
      }
      case B.red_bed: return this.trySleep(x, y, z, meta);
      case B.cake: {
        if (p.food >= 20 && !p.creative) return false;
        p.eat({ hunger: 2, sat: 0.4 });
        this.sound.play('player.eat', x, y, z, 0.6);
        if (meta >= 6) w.setBlock(x, y, z, 0, { sync: true });
        else w.setBlock(x, y, z, B.cake | ((meta + 1) << 10), { sync: true });
        return true;
      }
      case B.tnt: {
        const held = p.inv.held;
        if (held && held.id === I.flint_and_steel) { this.igniteTnt(x, y, z); this.damageHeld(1); return true; }
        return false;
      }
    }
    void hit;
    return false;
  }

  // ---------------------------------------------------------------- sleeping
  trySleep(x, y, z, meta) {
    const p = this.player;
    if (this.dim !== 'overworld') {
      this.world.setBlock(x, y, z, 0);
      this.explode(x + 0.5, y + 0.5, z + 0.5, 5, null, true);
      return true;
    }
    if (!this.canSleepNow()) { this.actionBar('You can only sleep at night or during thunderstorms'); this.setSpawn(x, y, z, meta); return true; }
    if (this.entities.mobsNear(x, y, z, 8).some((m) => m.def.hostile)) { this.actionBar('You may not rest now; there are monsters nearby'); return true; }
    if (Math.hypot(p.x - x - 0.5, p.z - z - 0.5) > 3) { this.actionBar('You may not rest now; the bed is too far away'); return true; }
    this.setSpawn(x, y, z, meta);
    p.sleeping = true;
    p.x = p.px = x + 0.5; p.z = p.pz = z + 0.5; p.y = p.py = y + 0.56;
    this.sleepTimer = 0;
    return true;
  }
  setSpawn(x, y, z, meta) {
    const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][meta & 3];
    void dx; void dz;
    this.player.spawn = [x, y + 1, z];
    this.actionBar('Respawn point set');
  }
  canSleepNow() { return (this.time >= 12542 && this.time <= 23460) || this.weather.thunder; }
  sleepTick() {
    const p = this.player;
    if (!p.sleeping) return;
    this.sleepTimer++;
    if (this.sleepTimer >= 100) {
      this.time = 0; this.day++;
      this.weather.rain = false; this.weather.thunder = false;
      p.sleeping = false;
      this.advance('sleep');
      this.dropToGroundNear();
    }
  }
  wake() { const p = this.player; if (p.sleeping) { p.sleeping = false; this.dropToGroundNear(); } }
  dropToGroundNear() {
    const p = this.player;
    p.y = Math.floor(p.y) + 0.6;
    // step off the bed
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz, y = Math.floor(p.y);
      if (!BLOCKS[this.world.getId(x, y, z)].solid && !BLOCKS[this.world.getId(x, y + 1, z)].solid) { p.x = p.px = x + 0.5; p.z = p.pz = z + 0.5; return; }
    }
  }

  // ---------------------------------------------------------------- time & weather
  skyDarken() {
    const ang = (this.time / 24000) * Math.PI * 2;
    const sunH = Math.sin(ang);
    let f = Math.max(0, Math.min(1, sunH * 3 + 0.5));
    f *= 1 - this.weather.rainAmt * 0.3125;
    f *= 1 - this.weather.thunderAmt * 0.3125;
    return Math.round((1 - f) * 11);
  }
  isDay() { return this.skyDarken() < 4; }

  weatherTick() {
    const w = this.weather;
    if (--w.timer <= 0) {
      if (w.rain) { w.rain = false; w.thunder = false; w.timer = 12000 + Math.random() * 156000; }
      else { w.rain = true; w.thunder = Math.random() < 0.15; w.timer = 12000 + Math.random() * 12000; }
    }
    w.rainAmt += ((w.rain ? 1 : 0) - w.rainAmt) * 0.01;
    w.thunderAmt += ((w.thunder ? 1 : 0) - w.thunderAmt) * 0.01;
    if (w.flash > 0) w.flash = Math.max(0, w.flash - 0.1);
    if (w.thunder && Math.random() < 1 / 2000) {
      w.flash = 1;
      const p = this.player;
      setTimeout(() => this.sound.play('weather.thunder', null, null, null, 0.9, 0.8 + Math.random() * 0.2), 300 + Math.random() * 1500);
      void p;
    }
    // rain sound when exposed
    const p = this.player;
    const top = this.world.rainY(Math.floor(p.x), Math.floor(p.z)), pb = this.biomeAt(p.x, p.z);
    const exposed = this.dim === 'overworld' && w.rainAmt > 0.2 && top <= p.y + p.eye + 4 && !snowsAt(pb, top) && !pb.dry;
    this.sound.loop('weather.rain', exposed && this.settings.sfx > 0, 0.35 * w.rainAmt);
  }
  biomeAt(x, z) { return this.world.biomeAt(Math.floor(x), Math.floor(z)); }

  // ambient effects around the player (torch flames, lava pops, rain splashes, snowfall)
  ambientTick() {
    const p = this.player, w = this.world;
    const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
    for (let i = 0; i < 400; i++) {
      const x = px + ((Math.random() * 32) | 0) - 16, y = py + ((Math.random() * 24) | 0) - 12, z = pz + ((Math.random() * 32) | 0) - 16;
      const v = w.getBlock(x, y, z);
      const id = v & 1023;
      if (id === B.torch) {
        const m = v >>> 10;
        if (m === 0) this.particles.flame(x + 0.5, y + 0.7, z + 0.5);
        else {
          const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][(m - 1) & 3];
          this.particles.flame(x + 0.5 - dx * 0.27 + dx * 0.0, y + 0.92, z + 0.5 - dz * 0.27);
        }
      } else if (id === B.lava && w.getId(x, y + 1, z) === 0 && Math.random() < 0.05) {
        this.particles.lavaPop(x + Math.random(), y + 1, z + Math.random());
      } else if (id === B.lit_furnace && Math.random() < 0.3) {
        this.particles.smoke(x + 0.5, y + 1.1, z + 0.5, 1, 0.3, 0.3);
      } else if (id === B.nether_portal) {
        for (let k = 0; k < 4; k++) this.particles.portal(x + Math.random(), y + Math.random(), z + Math.random());
      } else if (id === B.fire && Math.random() < 0.3) {
        this.particles.smoke(x + Math.random(), y + 0.8, z + Math.random(), 1, 0.4, 0.2);
      } else if (id === B.spawner && Math.random() < 0.4) {
        this.particles.smoke(x + 0.5, y + 0.5, z + 0.5, 1, 0.5, 0.2);
        this.particles.flame(x + Math.random(), y + Math.random(), z + Math.random());
      }
    }
    // rain splashes on the ground (the falling rain itself is drawn by Weather)
    const wr = this.dim === 'overworld' ? this.weather.rainAmt : 0;
    if (wr > 0.05) {
      const n = Math.floor(wr * 12 * (this.settings.particles / 2));
      for (let i = 0; i < n; i++) {
        const x = p.x + (Math.random() - 0.5) * 16, z = p.z + (Math.random() - 0.5) * 16;
        const bio = this.biomeAt(x, z);
        if (bio.dry) continue;
        const top = w.rainY(Math.floor(x), Math.floor(z));
        if (top < 0 || snowsAt(bio, top) || Math.abs(top - p.y) > 10) continue;
        this.particles.rainDrop(x, top + 1.02, z);
      }
    }
    // the Nether's air: ash in the soul sand valleys, spores in the forests
    if (this.dim === 'nether' && this.settings.particles > 0) {
      const bio = this.biomeAt(p.x, p.z);
      const kind = bio.id === BI.SOUL_SAND_VALLEY ? [0.55, 0.6, 0.62] : bio.id === BI.CRIMSON_FOREST ? [0.9, 0.25, 0.2] : bio.id === BI.WARPED_FOREST ? [0.3, 0.55, 0.9] : null;
      if (kind) for (let i = 0; i < 3; i++) this.particles.mote(p.x + (Math.random() - 0.5) * 24, p.y + (Math.random() - 0.3) * 12, p.z + (Math.random() - 0.5) * 24, kind, bio.id !== BI.SOUL_SAND_VALLEY);
    }
    if (this.dim === 'nether' && this.tickCount % 40 === 0 && this.netherGen.inFortress(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) this.advance('fortress');
    // swirls of colour around the player while potions are working (seen in third person)
    if (this.camMode !== 0 || this.tickCount % 4 === 0) {
      for (const n of Object.keys(p.effects)) {
        if (n === 'invisibility' || Math.random() > 0.3) continue;
        this.particles.effectSwirl(p.x + (Math.random() - 0.5) * 0.6, p.y + Math.random() * 1.8, p.z + (Math.random() - 0.5) * 0.6, EFFECTS[n].color, this.camMode === 0 ? 0.35 : 1);
      }
    }
    // underwater bubbles from the player
    if (p.eyeInWater && this.tickCount % 10 === 0 && !p.creative) this.particles.bubbles(p.x, p.y + p.eye, p.z, 2);
  }

  // ---------------------------------------------------------------- tile entities
  tileTick() {
    for (const t of this.activeTiles) {
      if (t.type === 'furnace') this.furnaceTick(t);
      else if (t.type === 'spawner') this.spawnerTileTick(t);
      else if (t.type === 'brewing') this.brewingTick(t);
    }
  }

  furnaceTick(t) {
    const s = t.items.slots;
    const input = s[0], fuel = s[1], out = s[2];
    const recipe = input ? SMELT[input.id] : null;
    const canOut = recipe && (!out || (out.id === recipe.result && out.count < ITEMS[out.id].maxStack));
    const wasBurning = t.burn > 0;
    if (t.burn > 0) t.burn--;
    if (t.burn <= 0 && canOut && fuel && FUEL[fuel.id]) {
      t.burnMax = t.burn = FUEL[fuel.id] * 20;
      if (fuel.id === I.lava_bucket) s[1] = { id: I.bucket, count: 1, dmg: 0 };
      else { fuel.count--; if (fuel.count <= 0) s[1] = null; }
    }
    if (t.burn > 0 && canOut) {
      t.cook++;
      if (t.cook >= 200) {
        t.cook = 0;
        if (out) out.count++; else s[2] = { id: recipe.result, count: 1, dmg: 0 };
        input.count--; if (input.count <= 0) s[0] = null;
        t.xp += recipe.xp;
        if (recipe.result === I.iron_ingot) this.advance('iron');
      }
    } else if (t.cook > 0) t.cook = Math.max(0, t.cook - 2);
    const burning = t.burn > 0;
    if (burning !== wasBurning || t._lit === undefined) {
      t._lit = burning;
      const v = this.world.getBlock(t.x, t.y, t.z);
      const id = v & 1023;
      if (id === B.furnace || id === B.lit_furnace) {
        const want = burning ? B.lit_furnace : B.furnace;
        if (id !== want) this.world.setBlock(t.x, t.y, t.z, want | (v & ~1023), { keepTile: true, noUpdate: true });
      }
    }
  }

  // brewing stand: 0-2 bottles, 3 ingredient, 4 blaze powder. A brew takes 20 seconds and one fuel.
  brewingTick(t) {
    const s = t.items.slots;
    if ((t.fuel || 0) <= 0 && s[4] && s[4].id === I.blaze_powder) {
      t.fuel = 20;
      if (--s[4].count <= 0) s[4] = null;
    }
    const ing = s[3];
    const can = !!ing && this.canBrew(s, ing.id);
    if (t.brew > 0) {
      t.brew--;
      if (!can || ing.id !== t.ingId) t.brew = 0;
      else if (t.brew === 0) this.finishBrew(t);
    } else if (can && t.fuel > 0) {
      t.brew = 400; t.ingId = ing.id; t.fuel--;
    }
    // the stand shows a bottle on each arm that holds one
    const bits = (s[0] ? 1 : 0) | (s[1] ? 2 : 0) | (s[2] ? 4 : 0);
    const v = this.world.getBlock(t.x, t.y, t.z);
    if ((v & 1023) === B.brewing_stand && (v >>> 10) !== bits) this.world.setBlock(t.x, t.y, t.z, B.brewing_stand | (bits << 10), { keepTile: true, noUpdate: true });
  }
  canBrew(s, ingId) {
    const name = ITEMS[ingId].name;
    for (let i = 0; i < 3; i++) {
      const b = s[i];
      if (!b || (b.id !== I.potion && b.id !== I.splash_potion)) continue;
      if (name === 'gunpowder') { if (b.id === I.potion) return true; continue; }
      if (brewResult(b.potion || 'water', name)) return true;
    }
    return false;
  }
  finishBrew(t) {
    const s = t.items.slots, ing = s[3];
    const name = ITEMS[ing.id].name;
    for (let i = 0; i < 3; i++) {
      const b = s[i];
      if (!b || (b.id !== I.potion && b.id !== I.splash_potion)) continue;
      if (name === 'gunpowder') { if (b.id === I.potion) s[i] = { ...b, id: I.splash_potion }; continue; }
      const r = brewResult(b.potion || 'water', name);
      if (r) s[i] = { ...b, potion: r };
    }
    if (--ing.count <= 0) s[3] = null;
    this.sound.play('brewing.done', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.8);
    this.advance('brew');
  }

  spawnerTileTick(t) {
    const p = this.player;
    if (Math.hypot(p.x - t.x, p.y - t.y, p.z - t.z) > 16 || this.difficulty === 0) return;
    if (--t.delay > 0) return;
    t.delay = 200 + Math.floor(Math.random() * 600);
    const near = this.entities.mobsNear(t.x, t.y, t.z, 9).filter((m) => m.kind === t.mob).length;
    if (near >= 6) return;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const x = t.x + 0.5 + (Math.random() - 0.5) * 8, z = t.z + 0.5 + (Math.random() - 0.5) * 8, y = t.y + Math.floor(Math.random() * 3) - 1;
      const bx = Math.floor(x), bz = Math.floor(z);
      if (BLOCKS[this.world.getId(bx, y, bz)].solid || BLOCKS[this.world.getId(bx, y + 1, bz)].solid || !BLOCKS[this.world.getId(bx, y - 1, bz)].solid) continue;
      this.spawnMob(t.mob, x, y, z);
      this.particles.poof(x, y, z);
    }
  }

  // ---------------------------------------------------------------- fire
  placeFire(x, y, z) {
    const w = this.world;
    const cur = w.getId(x, y, z);
    if (cur !== 0 && !(BLOCKS[cur].replaceable && !LIQUID[cur])) return false;
    // fire inside an obsidian frame opens a portal instead
    if (this.dim !== 'end' && [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => w.getId(x + dx, y + dy, z + dz) === B.obsidian)) {
      const pf = lightPortal(w, x, y, z);
      if (pf) { this.recordPortal(this.dim, [pf.x, pf.y, pf.z, pf.axis]); return true; }
    }
    w.setBlock(x, y, z, B.fire, { sync: true });
    this.ticks.schedule(x, y, z, 30 + Math.floor(Math.random() * 10));
    return true;
  }

  // flint and steel / fire charge on a block face: light a portal frame, else set a fire
  ignite(hit) {
    const w = this.world;
    const f = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][hit.face];
    const x = hit.x + f[0], y = hit.y + f[1], z = hit.z + f[2];
    if (hit.id === B.tnt) { this.igniteTnt(hit.x, hit.y, hit.z); return true; }
    const id = w.getId(x, y, z);
    if (id !== 0) return false;
    this.sound.play('fire.ignite', x + 0.5, y + 0.5, z + 0.5, 0.8, 0.9 + Math.random() * 0.2);
    return this.placeFire(x, y, z);
  }

  // ---------------------------------------------------------------- explosions
  explode(x, y, z, power, source, fire = false) {
    const w = this.world;
    this.sound.play('tnt.explode', x, y, z, 1.2, 0.9, { range: 48 });
    this.particles.explosion(x, y, z, power);
    const p = this.player;
    const pd = Math.hypot(p.x - x, p.y - y, p.z - z);
    if (pd < 20) this.shake = Math.max(this.shake, (1 - pd / 20) * 0.5);
    const destroyed = new Set();
    if (this.settings.mobGriefing !== false) {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) for (let k = 0; k < 16; k++) {
        if (!(i === 0 || i === 15 || j === 0 || j === 15 || k === 0 || k === 15)) continue;
        let dx = i / 15 * 2 - 1, dy = j / 15 * 2 - 1, dz = k / 15 * 2 - 1;
        const len = Math.hypot(dx, dy, dz);
        dx /= len; dy /= len; dz /= len;
        let f = power * (0.7 + Math.random() * 0.6);
        let px = x, py = y, pz = z;
        while (f > 0) {
          const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
          const id = w.getId(bx, by, bz);
          if (id) {
            const b = BLOCKS[id];
            const res = b.hardness < 0 ? 3600000 : id === B.obsidian ? 1200 : b.liquid ? 100 : b.tool === 'pickaxe' ? Math.min(6, b.hardness * 3) : b.hardness;
            f -= (res + 0.3) * 0.3;
            if (f > 0 && !b.liquid) destroyed.add(bx + ',' + by + ',' + bz);
          }
          px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
          f -= 0.225;
        }
      }
    }
    for (const key of destroyed) {
      const [bx, by, bz] = key.split(',').map(Number);
      const id = w.getId(bx, by, bz);
      if (!id) continue;
      if (id === B.tnt) { this.igniteTnt(bx, by, bz, 10 + Math.floor(Math.random() * 20)); continue; }
      const t = w.getTile(bx, by, bz);
      if (t) this.tileRemoved(t, bx, by, bz);
      if (Math.random() < 1 / power) this.breakBlockNaturally(bx, by, bz, true, true);
      else w.setBlock(bx, by, bz, 0);
    }
    // fiery explosions (ghast fireballs, beds in the Nether) leave flames behind
    if (fire) {
      for (const key of destroyed) {
        if (Math.random() > 1 / 3) continue;
        const [bx, by, bz] = key.split(',').map(Number);
        if (w.getId(bx, by, bz) === 0 && OPAQUE[w.getId(bx, by - 1, bz)]) this.placeFire(bx, by, bz);
      }
      if (!destroyed.size) {
        for (let i = 0; i < 6; i++) {
          const bx = Math.floor(x + (Math.random() - 0.5) * power * 2), bz = Math.floor(z + (Math.random() - 0.5) * power * 2);
          let by = Math.floor(y) + 1;
          while (by > Math.floor(y) - 3 && w.getId(bx, by - 1, bz) === 0) by--;
          if (w.getId(bx, by, bz) === 0 && OPAQUE[w.getId(bx, by - 1, bz)]) this.placeFire(bx, by, bz);
        }
      }
    }
    w.flushDirty(Math.floor(x) >> 4, Math.floor(z) >> 4);
    // damage entities
    const r2 = power * 2;
    const hurt = (e, isPlayer) => {
      const ex = e.x, ey = e.y + (isPlayer ? 0.9 : e.h / 2), ez = e.z;
      const d = Math.hypot(ex - x, ey - y, ez - z);
      if (d > r2) return;
      const imp = (1 - d / r2);
      const dmg = Math.floor((imp * imp + imp) / 2 * 7 * r2 + 1);
      const kx = (ex - x) / (d || 1), kz = (ez - z) / (d || 1), ky = (ey - y) / (d || 1);
      if (isPlayer) {
        e.damage(dmg, 'explosion', false, source);
        e.vx += kx * imp; e.vy += ky * imp * 0.8 + 0.1; e.vz += kz * imp;
      } else {
        e.hurt(dmg, source, x, z, 'explosion');
        e.vx += kx * imp; e.vy += ky * imp * 0.8; e.vz += kz * imp;
      }
    };
    if (!p.dead) hurt(p, true);
    for (const e of this.entities.mobsNear(x, y, z, r2 + 2)) if (e !== source) hurt(e, false);
    for (const e of this.entities.near(x, y, z, r2)) if (e.type === 'item' && Math.random() < 0.5) e.remove();
  }

  // ---------------------------------------------------------------- player events
  onPickup(id, count, ent) {
    this.sound.pop();
    const name = ITEMS[id].name;
    if (name.endsWith('_log')) this.advance('wood');
    if (id === I.diamond) this.advance('diamond');
    if (id === I.leather) this.advance('leather');
    if (id === B.obsidian) this.advance('obsidian');
    if (id === I.cobblestone) this.advance('stone');
    if (id === I.blaze_rod) this.advance('blazerod');
    if (id === I.quartz) this.advance('quartz');
    if (id === I.dragon_egg) this.advance('egg');
    void count; void ent;
  }
  onBlockPlaced(x, y, z, v) {
    this.stats.placed++;
    if (isRail(v & 1023)) connectRail(this.world, x, y, z);
    if ((v & 1023) === B.pumpkin || (v & 1023) === B.jack_o_lantern) this.buildGolem(x, y, z);
  }
  // a pumpkin on a T of four iron blocks comes to life
  buildGolem(x, y, z) {
    const w = this.world;
    if (w.getId(x, y - 1, z) !== B.iron_block || w.getId(x, y - 2, z) !== B.iron_block) return;
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (w.getId(x + dx, y - 1, z + dz) !== B.iron_block || w.getId(x - dx, y - 1, z - dz) !== B.iron_block) continue;
      for (const [cx, cy, cz] of [[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + dx, y - 1, z + dz], [x - dx, y - 1, z - dz]]) {
        this.particles.breakBlock(cx, cy, cz, w.getId(cx, cy, cz));
        w.setBlock(cx, cy, cz, 0);
      }
      this.spawnMob('iron_golem', x + 0.5, y - 2, z + 0.5, { persistent: true, home: [x, y - 2, z] });
      this.advance('golem');
      return;
    }
  }
  onCraft(id, count) {
    this.stats.crafted += count;
    const n = ITEMS[id].name;
    const map = { crafting_table: 'bench', wooden_pickaxe: 'pick', furnace: 'furnace', stone_pickaxe: 'stonepick', iron_pickaxe: 'ironpick', bread: 'bread', cake: 'cake', bookshelf: 'bookshelf', wooden_hoe: 'hoe', torch: 'torch', diamond_pickaxe: 'diamondpick', enchanting_table: 'table', anvil: 'anvil' };
    if (map[n]) this.advance(map[n]);
  }
  onMobKilled(m, cause) {
    this.stats.kills++;
    if (m.def.hostile) this.advance('hunter');
    if (m.kind === 'skeleton' && cause === 'arrow') this.advance('sniper');
    if (m.kind === 'creeper') this.advance('creeper');
    if (m.kind === 'ghast' && cause === 'fireball') this.advance('return');
  }
  onPlayerHurt(amount, cause) {
    const p = this.player;
    this.sound.play(cause === 'fall' && amount > 4 ? 'player.fall' : 'player.hurt', p.x, p.y, p.z, 0.8);
    this.ui.flashDamage();
  }
  onPlayerDeath(cause, source) {
    const p = this.player;
    p.deadTime = 0;
    this.stats.deaths++;
    const src = source && source.def ? source.def.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;
    const name = this.settings.playerName || 'Player';
    const msgs = {
      fall: `${name} fell from a high place`, drown: `${name} drowned`, lava: `${name} tried to swim in lava`,
      fire: `${name} burned to death`, starve: `${name} starved to death`, cactus: `${name} was pricked to death`,
      explosion: src ? `${name} was blown up by ${src}` : `${name} blew up`, void: `${name} fell out of the world`,
      arrow: `${name} was shot by ${src || 'Skeleton'}`, mob: `${name} was slain by ${src || 'a mob'}`, poison: `${name} died`,
      anvil: `${name} was squashed by a falling anvil`, thorns: `${name} was killed trying to hurt ${src || 'a mob'}`,
      hot_floor: `${name} discovered the floor was lava`, magic: `${name} was killed by magic`, fireball: `${name} was fireballed by ${src || 'a Ghast'}`, wither: `${name} withered away`,
    };
    const msg = msgs[cause] || `${name} died`;
    this.deathMessage = msg;
    this.message(msg);
    if (!this.settings.keepInventory) {
      const drop = (s) => s && this.dropItem(p.x, p.y + 1, p.z, s, { vx: (Math.random() - 0.5) * 0.5, vy: Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.5, delay: 40 });
      for (let i = 0; i < 36; i++) { drop(p.inv.slots[i]); p.inv.slots[i] = null; }
      for (let i = 0; i < 4; i++) { drop(p.inv.armor.slots[i]); p.inv.armor.slots[i] = null; }
      for (let i = 0; i < 4; i++) { drop(p.inv.craft.slots[i]); p.inv.craft.slots[i] = null; }
      this.spawnXp(p.x, p.y + 1, p.z, Math.min(100, p.level * 7));
      p.level = 0; p.xp = 0; p.xpTotal = 0;
    }
    this.interaction.stopMining();
    this.ui.closeScreen();
    this.ui.showDeath(msg, p.level);
  }
  respawn() {
    const p = this.player;
    if (this.dim !== 'overworld') {
      const s = p.spawn || this.spawnPos;
      p.respawnAt(s[0] + 0.5, s[1], s[2] + 0.5);
      this.ui.hideDeath();
      this.changeDimension('overworld', s[0] + 0.5, s[1], s[2] + 0.5, () => {
        const ok = p.spawn && this.world.getId(p.spawn[0], p.spawn[1] - 1, p.spawn[2]) === B.red_bed;
        if (!ok) { const t = this.spawnPos; p.x = t[0] + 0.5; p.z = t[2] + 0.5; p.y = t[1]; this.dropToGround(); if (p.spawn) { this.actionBar('You have no home bed, or it was obstructed'); p.spawn = null; } }
      });
      return;
    }
    const sp = p.spawn && this.world.getId(p.spawn[0], p.spawn[1] - 1, p.spawn[2]) === B.red_bed || (p.spawn && !this.world.isLoaded(p.spawn[0], p.spawn[2])) ? p.spawn : null;
    const s = sp || this.spawnPos;
    p.respawnAt(s[0] + 0.5, s[1], s[2] + 0.5);
    if (!sp && p.spawn) { this.actionBar('You have no home bed, or it was obstructed'); p.spawn = null; }
    if (!this.world.isLoaded(Math.floor(p.x), Math.floor(p.z))) this.needsGround = !sp;
    this.ui.hideDeath();
  }

  // ---------------------------------------------------------------- messages & progress
  message(text, color) { this.ui.chatMessage(text, color); }
  actionBar(text) { this.ui.actionBar(text); }
  advance(key) {
    if (this.advancements.has(key)) return;
    const a = ADVANCEMENTS.find((x) => x.key === key);
    if (!a) return;
    if (a.requires && !this.advancements.has(a.requires)) { this.advancements.add(a.requires); }
    this.advancements.add(key);
    this.ui.toast(a);
    this.message(`${this.settings.playerName || 'Player'} has made the advancement §a[${a.title}]`, '#ffffff');
    this.sound.play('xp.levelup', null, null, null, 0.5, 1.2);
  }
  command(text) { return runCommand(this, text); }

  // ---------------------------------------------------------------- saving
  saveChunk(c) {
    if (!c.blocks) return;
    const tiles = [];
    for (const t of c.tiles.values()) {
      const o = { ...t };
      if (t.items && t.items.toJSON) o.items = t.items.toJSON();
      delete o._lit;
      tiles.push(o);
    }
    c.modified = false;
    this.world.savedKeys.add(c.key);
    return this.store.saveChunk(this.dimKey, c.cx, c.cz, c.blocks, tiles);
  }

  async save(thumbnail) {
    if (!this.world) return;
    const jobs = [];
    for (const c of this.world.chunks.values()) if (c.modified && c.blocks) jobs.push(this.saveChunk(c));
    const ents = [];
    for (const e of this.entities.list) {
      if (e.removed) continue;
      if (e.isMob && !e.persistent) continue;
      const o = e.toJSON();
      if (o) ents.push(o);
    }
    if (this.parked) ents.push(...this.parked.filter(Boolean));
    const m = this.meta;
    Object.assign(m, {
      time: this.time, day: this.day, weather: { rain: this.weather.rain, thunder: this.weather.thunder, timer: this.weather.timer },
      player: this.player.toJSON(), entities: ents.slice(0, 600), spawn: this.spawnPos, difficulty: this.difficulty,
      lastPlayed: Date.now(), stats: this.stats, advancements: [...this.advancements], mode: this.player.mode, dim: this.dim,
    });
    if (thumbnail) m.thumb = thumbnail;
    jobs.push(this.store.saveWorld(m));
    try { await Promise.all(jobs); } catch (e) { console.warn('save failed', e); }
  }

  get difficultyName() { return DIFF_NAMES[this.difficulty]; }
}
void U;
