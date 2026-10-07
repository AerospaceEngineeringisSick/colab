// BlockCraft: application shell.
import * as THREE from 'three';
import { loadImages, buildBlockArray, texInfo } from './engine/textures.js';
import { resolveBlockTextures, BLOCKS, B } from './shared/blocks.js';
import { ITEMS, I } from './shared/items.js';
import { Renderer } from './engine/renderer.js';
import { initItemMeshes } from './engine/itemmesh.js';
import { Sound } from './engine/audio.js';
import { World } from './world/world.js';
import { WorldGen } from './shared/worldgen.js';
import { BI } from './shared/biomes.js';
import { seedFrom } from './shared/noise.js';
import { SEA } from './shared/constants.js';
import { Input } from './game/input.js';
import { Game } from './game/game.js';
import { Store, loadSettings, saveSettings } from './game/save.js';
import { Container } from './game/inventory.js';
import { UI } from './ui/ui.js';
import { buildIcons } from './ui/icons.js';

class App {
  async boot() {
    this.settings = loadSettings();
    this.canvas = document.getElementById('gl');
    this.bootScreen();
    await loadImages((f) => this.bootProgress(f * 0.7));
    const atlas = buildBlockArray();
    resolveBlockTextures(texInfo);
    this.renderer = new Renderer(this.canvas);
    this.renderer.initChunkMaterials(atlas);
    initItemMeshes(atlas);
    this.bootProgress(0.8);
    buildIcons(this.renderer);
    this.bootProgress(0.95);
    this.input = new Input(this.canvas);
    this.input.onKey = (e) => this.onKey(e);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.sound = new Sound();
    this.store = new Store();
    await this.store.open();
    this.ui = new UI(this);
    this.applySettings();
    document.getElementById('boot').remove();
    // audio needs a user gesture
    const unlock = () => { this.sound.unlock(); this.applySettings(); };
    window.addEventListener('pointerdown', unlock, { once: false, capture: true });
    window.addEventListener('keydown', unlock, { once: false, capture: true });
    this.canvas.addEventListener('mousedown', () => {
      if (this.game && this.game.running && !this.ui.screenOpen && !this.ui.chatOpen && !this.ui.menus.visible() && !this.input.locked) this.lockPointer();
    });
    window.addEventListener('beforeunload', () => { if (this.game) this.game.save(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.game) { this.game.save(); if (!this.game.paused) this.pause(); }
    });
    this.startPanorama();
    this.ui.menus.showTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    // automation hook for tests
    window.__blockcraft = this;
  }

  bootScreen() {
    const d = document.createElement('div');
    d.id = 'boot';
    d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#1b1b1b;color:#fff;font:20px Pixel,monospace;z-index:100';
    d.innerHTML = '<div style="font-size:42px;letter-spacing:2px;margin-bottom:24px;color:#ddd;text-shadow:3px 3px 0 #333">BLOCKCRAFT</div><div style="width:220px;height:6px;background:#444"><i id="bootbar" style="display:block;height:100%;width:0;background:#80ff80;transition:width .2s"></i></div>';
    document.body.appendChild(d);
  }
  bootProgress(f) { const b = document.getElementById('bootbar'); if (b) b.style.width = Math.round(f * 100) + '%'; }

  // ---------------------------------------------------------------- settings
  saveSettings() { saveSettings(this.settings); }
  applySettings() {
    const S = this.settings;
    this.sound.volume.master = S.master / 100;
    this.sound.volume.music = S.music / 100;
    this.sound.volume.sfx = S.sfx / 100;
    this.sound.applyVolume();
    const dpr = window.devicePixelRatio || 1;
    const pr = S.pixelRatio ? Math.min(dpr, S.pixelRatio * dpr) : Math.min(dpr, 2);
    if (Math.abs(pr - this.renderer.pixelRatio) > 0.01) this.renderer.setPixelRatio(pr);
    const g = this.game;
    if (g && g.world) {
      g.world.renderDistance = S.renderDistance;
      this.renderer.renderDistance = S.renderDistance;
      g.world.lastCenter = null;
      if (g.world.fastLeaves === S.fancyLeaves) g.world.setFastLeaves(!S.fancyLeaves);
    }
    if (this.ui) this.ui.applyScale();
  }

  // ---------------------------------------------------------------- title panorama
  startPanorama() {
    const seed = seedFrom('BlockCraft panorama');
    const gen = new WorldGen(seed);
    // find a pretty spot: land near water with some relief
    const col = {};
    let spot = [0, 90, 0];
    for (let i = 0; i < 400; i++) {
      const x = (i * 97) % 1600 - 800, z = Math.floor(i * 53 / 7) % 1600 - 800;
      gen.column(x, z, col);
      if (col.biome === BI.FOREST || col.biome === BI.PLAINS || col.biome === BI.BIRCH_FOREST) {
        if (col.h > SEA + 4 && col.h < SEA + 20) { spot = [x, col.h + 12, z]; break; }
      }
    }
    const w = new World(null, seed, texInfo);
    w.materials = this.renderer.chunkMats;
    w.renderDistance = Math.min(6, this.settings.renderDistance);
    this.renderer.renderDistance = w.renderDistance;
    this.renderer.scene.add(w.scene);
    this.pano = { world: w, x: spot[0] + 0.5, y: spot[1], z: spot[2] + 0.5, yaw: 0.6, t: 0 };
  }
  stopPanorama() {
    if (!this.pano) return;
    this.renderer.scene.remove(this.pano.world.scene);
    this.pano.world.dispose();
    this.pano = null;
  }

  // ---------------------------------------------------------------- worlds
  async createWorld(o) {
    const id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const meta = {
      id, name: o.name, seed: seedFrom(o.seedText), seedText: o.seedText, mode: o.mode, difficulty: o.difficulty,
      created: Date.now(), lastPlayed: Date.now(), bonus: o.bonus, version: 1,
    };
    await this.store.saveWorld(meta);
    return this.playWorld(id);
  }

  async playWorld(id) {
    const meta = await this.store.getWorld(id);
    if (!meta) return;
    this.ui.menus.hideAll();
    this.ui.menus.showLoading(meta.player ? 'Loading world' : 'Building terrain');
    this.stopPanorama();
    const g = new Game(this);
    this.game = g;
    try {
      await g.start(meta, this.store, (f) => this.ui.menus.loadProgress(f));
    } catch (e) {
      console.error(e);
      this.ui.menus.hideLoading();
      this.game = null;
      this.startPanorama();
      this.ui.menus.showTitle();
      return;
    }
    this.ui.menus.hideLoading();
    if (meta.bonus && !meta.bonusPlaced) { this.placeBonusChest(g); meta.bonusPlaced = true; }
    if (!meta.player) g.save();
    this.lockPointer();
  }

  placeBonusChest(g) {
    const p = g.player;
    const w = g.world;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2]]) {
      const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
      const y = w.topY(x, z) + 1;
      if (y <= 1 || BLOCKS[w.getId(x, y, z)].solid || !BLOCKS[w.getId(x, y - 1, z)].solid) continue;
      w.setBlock(x, y, z, B.chest, { sync: true });
      const c = new Container(27);
      const items = [['oak_log', 8], ['oak_planks', 16], ['stick', 8], ['wooden_pickaxe', 1], ['wooden_axe', 1], ['apple', 6], ['bread', 4], ['torch', 8], ['oak_sapling', 2]];
      items.forEach(([n, k], i) => { c.slots[i * 3 % 27] = { id: I[n], count: k, dmg: 0 }; });
      w.setTile(x, y, z, { type: 'chest', items: c });
      for (let i = 0; i < 4; i++) w.setBlock(x + [1, -1, 0, 0][i], y, z + [0, 0, 1, -1][i], w.getId(x + [1, -1, 0, 0][i], y, z + [0, 0, 1, -1][i]) ? w.getBlock(x + [1, -1, 0, 0][i], y, z + [0, 0, 1, -1][i]) : B.torch);
      return;
    }
  }

  async quitToTitle() {
    const g = this.game;
    if (!g) return;
    this.input.unlock();
    const thumb = this.thumbnail();
    g.running = false;
    await g.save(thumb);
    await g.stop(false);
    this.game = null;
    this.ui.onGameStop();
    this.renderer.handScene.clear();
    this.renderer.handScene.add(this.renderer.handCamera);
    this.startPanorama();
    this.ui.menus.showTitle();
  }

  thumbnail() {
    try {
      const c = document.createElement('canvas');
      c.width = 192; c.height = 108;
      const g = c.getContext('2d');
      const src = this.canvas;
      const ar = src.width / src.height, tr = 192 / 108;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (ar > tr) { sw = sh * tr; sx = (src.width - sw) / 2; } else { sh = sw / tr; sy = (src.height - sh) / 2; }
      this.game.r.render(false);
      g.drawImage(src, sx, sy, sw, sh, 0, 0, 192, 108);
      return c.toDataURL('image/jpeg', 0.75);
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------- pause & pointer
  lockPointer() {
    if (this.ui.touch.enabled) return;
    this.input.lock();
  }
  pause() {
    const g = this.game;
    if (!g || g.player.dead) return;
    if (this.ui.screenOpen) this.ui.closeScreen(true);
    if (this.ui.chatOpen) this.ui.closeChat();
    g.paused = true;
    this.input.unlock();
    this.ui.menus.showPause();
    g.save();
  }
  resume() {
    const g = this.game;
    if (!g) return;
    g.paused = false;
    g.lastFrame = performance.now();
    this.ui.menus.hideAll();
    this.lockPointer();
  }
  onLockChange(locked) {
    const g = this.game;
    if (!locked && g && g.running && !g.paused && !this.ui.screenOpen && !this.ui.chatOpen && !g.player.dead && !this.ui.touch.enabled) this.pause();
  }

  // ---------------------------------------------------------------- keys
  onKey(e) {
    const g = this.game, ui = this.ui;
    if (e.target && e.target.tagName === 'INPUT') return true;
    if (!g || !g.running) return false;
    if (ui.chatOpen) return true;
    const code = e.code, B2 = this.input.binds;
    if (ui.screenOpen) return false; // screens handle their own keys
    if (ui.menus.visible()) {
      if (code === 'Escape' && g.paused && !g.player.dead) { e.preventDefault(); return false; }
      return false;
    }
    if (code === 'Escape') { e.preventDefault(); this.pause(); return true; }
    if (g.player.dead) return true;
    if (code === B2.inventory) { e.preventDefault(); if (g.player.sleeping) g.wake(); else ui.openInventory(); return true; }
    if (code === B2.chat) { e.preventDefault(); ui.openChat(''); return true; }
    if (code === B2.command) { e.preventDefault(); ui.openChat('/'); return true; }
    if (code === B2.debug) { e.preventDefault(); ui.toggleDebug(); return true; }
    if (code === B2.hideHud) { e.preventDefault(); ui.hideHud = !ui.hideHud; return true; }
    if (code === B2.screenshot) { e.preventDefault(); this.wantShot = true; return true; }
    if (g.handleKey(code)) { e.preventDefault(); }
    return false;
  }

  pickBlock() {
    const g = this.game, p = g.player, t = g.interaction.target;
    if (!t) return;
    let id = t.id;
    if (ITEMS[id] && ITEMS[id].hidden) {
      if (id === B.lit_furnace) id = B.furnace;
      else if (id === B.wheat) id = I.wheat_seeds; else if (id === B.carrots) id = I.carrot; else if (id === B.potatoes) id = I.potato;
      else return;
    }
    const slot = p.inv.slots.findIndex((s, i) => i < 9 && s && s.id === id);
    if (slot >= 0) { p.inv.selected = slot; return; }
    if (p.creative) {
      const empty = p.inv.slots.findIndex((s, i) => i < 9 && !s);
      p.inv.selected = empty >= 0 ? empty : p.inv.selected;
      p.inv.slots[p.inv.selected] = { id, count: 1, dmg: 0 };
    } else {
      const idx = p.inv.slots.findIndex((s) => s && s.id === id);
      if (idx >= 9) { const tmp = p.inv.slots[p.inv.selected]; p.inv.slots[p.inv.selected] = p.inv.slots[idx]; p.inv.slots[idx] = tmp; }
    }
  }

  screenshot() {
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `blockcraft-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      if (this.game) this.game.message('Saved screenshot as ' + a.download, '#aaaaaa');
    });
  }

  // ---------------------------------------------------------------- frame
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    if (g && g.running) {
      if (this.input.clicks.has(1) && !this.ui.screenOpen) this.pickBlock();
      g.frame(now);
      if (this.wantShot) { this.wantShot = false; this.screenshot(); }
      return;
    }
    if (this.pano) {
      const P = this.pano;
      P.t += dt;
      P.yaw += dt * 0.035;
      const cam = this.renderer.camera;
      cam.position.set(P.x, P.y, P.z);
      cam.rotation.set(-0.12 + Math.sin(P.t * 0.05) * 0.05, P.yaw, 0);
      P.world.update(P.x, P.z, cam);
      this.renderer.updateEnvironment({ time: 2500, day: 0, rain: 0, thunder: 0, underwater: 0, dt, time_s: P.t, clouds: true, gamma: 0.5 });
      this.renderer.render(false);
    }
    this.input.endFrame();
  }
}

new App().boot().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:0;color:#f88;background:#200;padding:20px;white-space:pre-wrap;z-index:999">BlockCraft failed to start:\n${e && e.stack || e}</pre>`);
});
void THREE;
