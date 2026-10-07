// Sound effects (embedded MP3s) with distance attenuation and stereo panning,
// plus a generative ambient piano soundtrack.
import { BLOCKS } from '../shared/blocks.js';

const STEP = { grass: 'grass', dirt: 'dirt', stone: 'stone', wood: 'wood', sand: 'sand', gravel: 'gravel', snow: 'snow', glass: 'glass', cloth: 'snow', metal: 'metal', water: 'water', ice: 'ice' };
const DIG = { grass: 'dig.grass', dirt: 'dig.dirt', stone: 'dig.stone', wood: 'dig.wood', sand: 'dig.sand', gravel: 'dig.gravel', snow: 'dig.snow', glass: 'dig.stone', cloth: 'dig.cloth', metal: 'dig.metal', ice: 'dig.ice' };
const BREAK = { grass: 'dig.grass', dirt: 'dig.dirt', stone: 'dig.stone', wood: 'dig.wood', sand: 'dig.sand', gravel: 'dug.gravel', snow: 'dig.snow', glass: 'dig.glass', cloth: 'dig.cloth', metal: 'dug.metal', ice: 'dig.glass' };

export class Sound {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // name -> [AudioBuffer...]
    this.variants = new Map(); // base name -> [file names]
    this.volume = { master: 1, music: 0.5, sfx: 1 };
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.loops = new Map();
    const S = window.ASSETS.sounds;
    for (const k of Object.keys(S)) {
      const base = k.replace(/\.\d+$/, '');
      if (!this.variants.has(base)) this.variants.set(base, []);
      this.variants.get(base).push(k);
    }
    this.music = null;
  }

  // must be called from a user gesture
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.applyVolume();
    this.decodeAll();
    this.music = new Music(this.ctx, this.musicBus);
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.value = this.volume.master;
    this.sfxBus.gain.value = this.volume.sfx;
    this.musicBus.gain.value = this.volume.music;
  }

  async decodeAll() {
    const S = window.ASSETS.sounds;
    for (const k of Object.keys(S)) {
      try {
        const bin = atob(S[k]);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const ab = await this.ctx.decodeAudioData(buf.buffer);
        this.buffers.set(k, ab);
      } catch (e) { /* unsupported codec: skip */ }
    }
  }

  setListener(x, y, z, yaw) { const l = this.listener; l.x = x; l.y = y; l.z = z; l.yaw = yaw; }

  // play a named sound at a world position (or null for UI/player sounds)
  play(name, x, y, z, vol = 1, pitch = 1, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const list = this.variants.get(name);
    if (!list) return null;
    const key = list[(Math.random() * list.length) | 0];
    const buf = this.buffers.get(key);
    if (!buf) return null;
    let gain = vol, pan = 0;
    if (x !== undefined && x !== null) {
      const l = this.listener;
      const dx = x - l.x, dy = y - l.y, dz = z - l.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = opts.range || 16;
      if (d > range * 1.5) return null;
      gain *= Math.max(0, 1 - d / (range * 1.5)) ** 1.4;
      if (d > 0.5) {
        // angle relative to view: right vector = (cos yaw, -sin yaw)
        const rx = Math.cos(l.yaw), rz = -Math.sin(l.yaw);
        pan = Math.max(-0.85, Math.min(0.85, (dx * rx + dz * rz) / d));
      }
    }
    if (gain < 0.01) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch * (opts.noJitter ? 1 : (0.94 + Math.random() * 0.12));
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = src.connect(g);
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.sfxBus);
    if (opts.loop) src.loop = true;
    src.start();
    return { src, g };
  }

  group(id) { return (BLOCKS[id] && BLOCKS[id].sound) || 'stone'; }
  step(x, y, z, id) { if (id) this.play('step.' + (STEP[this.group(id)] || 'stone'), x, y, z, 0.32, 1); }
  dig(x, y, z, id) { this.play(DIG[this.group(id)] || 'dig.stone', x, y, z, 0.32, 0.6); }
  breakBlock(x, y, z, id) { this.play(BREAK[this.group(id)] || 'dig.stone', x, y, z, 0.9, 0.85); }
  place(x, y, z, id) {
    const g = this.group(id);
    if (g === 'stone') this.play('place.hard', x, y, z, 0.8, 0.9);
    else if (g === 'metal') this.play('place.metal', x, y, z, 0.8);
    else this.play(DIG[g] || 'place.node', x, y, z, 0.8, 0.8);
  }

  // short synthesized UI click
  click() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(820, t); o.frequency.exponentialRampToValueAtTime(400, t + 0.05);
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + 0.08);
  }
  // item pickup "pop"
  pop() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine';
    const f = 700 + Math.random() * 500;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.06);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(this.sfxBus); o.start(t); o.stop(t + 0.12);
  }

  loop(name, on, vol = 0.4) {
    if (!this.ctx) return;
    const cur = this.loops.get(name);
    if (on && !cur) {
      const h = this.play(name, null, null, null, 0.0001, 1, { loop: true, noJitter: true });
      if (h) { h.g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 1.5); this.loops.set(name, h); }
    } else if (!on && cur) {
      cur.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5);
      cur.src.stop(this.ctx.currentTime + 1.6);
      this.loops.delete(name);
    }
  }

  stopLoops() { for (const k of [...this.loops.keys()]) this.loop(k, false); }
}

// ------------------------------------------------------------------ music
// Sparse, gentle piano phrases in the spirit of calm sandbox soundtracks.
class Music {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.55;
    // simple generated reverb
    const len = ctx.sampleRate * 3.2;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.45;
    this.out.connect(out);
    this.out.connect(this.verb).connect(wet).connect(out);
    this.playing = false;
    this.nextAt = ctx.currentTime + 20 + Math.random() * 30;
    this.enabled = true;
  }

  note(midi, t, dur, vel) {
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vel * 0.35, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.3;
    g.connect(lp).connect(this.out);
    // piano-ish partials with slight inharmonicity
    const partials = [[1, 1], [2.003, 0.42], [3.01, 0.18], [4.02, 0.08], [5.04, 0.04]];
    for (const [m, a] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * m;
      const pg = ctx.createGain();
      pg.gain.value = a;
      o.connect(pg).connect(g);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  // compose and schedule one piece (~60-90s)
  piece() {
    const t0 = this.ctx.currentTime + 0.5;
    const keys = [60, 62, 57, 65, 55];
    const root = keys[(Math.random() * keys.length) | 0];
    const scale = Math.random() < 0.5 ? [0, 2, 4, 7, 9, 12, 14, 16] : [0, 2, 3, 7, 8, 12, 14, 15];
    const prog = [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]];
    let t = t0;
    const bars = 10 + ((Math.random() * 6) | 0);
    const beat = 0.9 + Math.random() * 0.5;
    for (let b = 0; b < bars; b++) {
      const ch = prog[(b + (Math.random() < 0.2 ? 1 : 0)) % prog.length];
      // soft low chord
      for (const n of ch) this.note(root - 12 + n, t, beat * 4.5, 0.05);
      // melody: a few notes per bar, with rests
      let bt = 0;
      while (bt < 4) {
        const len = [1, 1, 2, 0.5, 1.5][(Math.random() * 5) | 0];
        if (Math.random() < 0.72) {
          const n = root + scale[(Math.random() * scale.length) | 0];
          this.note(n, t + bt * beat, beat * len * 2.6, 0.08 + Math.random() * 0.05);
          if (Math.random() < 0.15) this.note(n + 12, t + bt * beat + beat * 0.5, beat * 2, 0.035);
        }
        bt += len;
      }
      t += beat * 4;
    }
    return t - t0;
  }

  update(on) {
    if (!this.enabled || !on) return;
    const now = this.ctx.currentTime;
    if (now >= this.nextAt) {
      const dur = this.piece();
      this.nextAt = now + dur + 90 + Math.random() * 180;
    }
  }
}
