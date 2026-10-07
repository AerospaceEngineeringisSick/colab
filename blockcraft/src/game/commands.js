// Chat commands.
import { ITEMS, I } from '../shared/items.js';
import { MOBS } from './mobs.js';
import { B } from '../shared/blocks.js';
import { WH } from '../shared/constants.js';
import { ENCHANTS, EN, canApply, compatible, enchName } from '../shared/enchant.js';
import { villagesNear } from '../shared/villages.js';

const HELP = [
  '/gamemode <survival|creative|spectator>', '/time set <day|noon|night|midnight|ticks>', '/weather <clear|rain|thunder>',
  '/give <item> [count]', '/tp <x> <y> <z>', '/summon <mob>', '/difficulty <peaceful|easy|normal|hard>', '/kill',
  '/setblock <x> <y> <z> <block>', '/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>', '/enchant <enchantment> [level]',
  '/seed', '/spawnpoint', '/clear', '/heal', '/xp <amount>', '/biome', '/dimension <overworld|nether>', '/locate <fortress|village>',
];

export function runCommand(g, text) {
  const p = g.player;
  const args = text.trim().replace(/^\//, '').split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const say = (t, c = '#aaaaaa') => g.message(t, c);
  const err = (t) => g.message(t, '#ff5555');
  // coordinates: absolute, or ~ / ~n relative to the player
  const rel = (s, base) => (s && s.startsWith('~') ? base + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
  switch (cmd) {
    case 'help': case '?': for (const h of HELP) say(h); return;
    case 'gamemode': case 'gm': {
      const m = { s: 'survival', survival: 'survival', 0: 'survival', c: 'creative', creative: 'creative', 1: 'creative', sp: 'spectator', spectator: 'spectator', 3: 'spectator' }[(args[0] || '').toLowerCase()];
      if (!m) return err('Usage: /gamemode <survival|creative|spectator>');
      p.mode = m;
      p.flying = m === 'spectator' ? true : m === 'creative' ? p.flying : false;
      if (m === 'survival') { p.fallDistance = 0; }
      g.ui.refreshHud();
      return say(`Set own game mode to ${m[0].toUpperCase() + m.slice(1)} Mode`);
    }
    case 'time': {
      if (args[0] === 'set') {
        const v = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 }[args[1]] ?? parseInt(args[1], 10);
        if (Number.isNaN(v)) return err('Usage: /time set <day|night|ticks>');
        g.time = ((v % 24000) + 24000) % 24000;
        return say(`Set the time to ${v}`);
      }
      if (args[0] === 'add') { g.time = (g.time + (parseInt(args[1], 10) || 0)) % 24000; return say('Added time'); }
      if (args[0] === 'query') return say(`The time is ${Math.floor(g.time)}`);
      return err('Usage: /time <set|add|query> <value>');
    }
    case 'weather': {
      const w = g.weather;
      if (args[0] === 'clear') { w.rain = false; w.thunder = false; w.timer = 12000 + Math.random() * 100000; }
      else if (args[0] === 'rain') { w.rain = true; w.thunder = false; w.timer = 12000; }
      else if (args[0] === 'thunder') { w.rain = true; w.thunder = true; w.timer = 12000; }
      else return err('Usage: /weather <clear|rain|thunder>');
      return say(`Set the weather to ${args[0]}`);
    }
    case 'give': {
      const name = (args[0] || '').replace(/^minecraft:/, '').toLowerCase();
      const id = I[name];
      if (id === undefined || !ITEMS[id]) return err(`Unknown item '${name}'`);
      const n = Math.max(1, Math.min(64 * 36, parseInt(args[1], 10) || 1));
      let left = n;
      while (left > 0) {
        const c = Math.min(left, ITEMS[id].maxStack);
        const r = p.inv.give({ id, count: c, dmg: 0 });
        if (r) g.dropItem(p.x, p.y + 1, p.z, { id, count: r });
        left -= c;
      }
      return say(`Gave ${n} [${ITEMS[id].display}] to ${g.settings.playerName || 'Player'}`);
    }
    case 'tp': case 'teleport': {
      const x = rel(args[0], p.x), y = rel(args[1], p.y), z = rel(args[2], p.z);
      if ([x, y, z].some((v) => Number.isNaN(v))) return err('Usage: /tp <x> <y> <z>');
      p.x = p.px = x; p.y = p.py = y; p.z = p.pz = z; p.vx = p.vy = p.vz = 0; p.fallDistance = 0;
      return say(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
    }
    case 'summon': {
      const m = (args[0] || '').toLowerCase();
      if (!MOBS[m]) return err(`Unknown entity. Try: ${Object.keys(MOBS).join(', ')}`);
      const d = p.lookDir();
      g.spawnMob(m, p.x + d[0] * 3, p.y + 0.5, p.z + d[2] * 3, { persistent: true });
      return say(`Summoned new ${m}`);
    }
    case 'difficulty': {
      const v = { peaceful: 0, p: 0, 0: 0, easy: 1, e: 1, 1: 1, normal: 2, n: 2, 2: 2, hard: 3, h: 3, 3: 3 }[(args[0] || '').toLowerCase()];
      if (v === undefined) return say(`The difficulty is ${g.difficultyName}`);
      g.difficulty = v;
      return say(`Set game difficulty to ${g.difficultyName}`);
    }
    case 'kill': p.health = 0; p.die('void'); return undefined;
    case 'seed': return say(`Seed: [${g.meta.seed}]`, '#55ff55');
    case 'spawnpoint': p.spawn = [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)]; return say('Set spawn point');
    case 'clear': for (let i = 0; i < 36; i++) p.inv.slots[i] = null; return say('Cleared inventory');
    case 'heal': p.health = p.maxHealth; p.food = 20; p.saturation = 5; return say('Healed');
    case 'xp': case 'experience': { const n = parseInt(args[0], 10) || 0; p.addXp(n); return say(`Gave ${n} experience`); }
    case 'biome': return say(`Biome: ${g.world.biomeAt(Math.floor(p.x), Math.floor(p.z)).name}`);
    case 'dimension': case 'dim': {
      const d = { overworld: 'overworld', o: 'overworld', nether: 'nether', n: 'nether', the_nether: 'nether' }[(args[0] || '').toLowerCase()];
      if (!d) return err('Usage: /dimension <overworld|nether>');
      if (d === g.dim) return say(`Already in the ${d}`);
      const s = d === 'nether' ? 1 / 8 : 8;
      const x = Math.floor(p.x * s), z = Math.floor(p.z * s);
      g.changeDimension(d, x + 0.5, 70, z + 0.5, () => g.arriveByPortal(d, null, x, d === 'nether' ? 64 : 70, z));
      return undefined;
    }
    case 'locate': {
      const what = (args[0] || '').toLowerCase();
      if (what === 'fortress') {
        if (g.dim !== 'nether') return err('Fortresses are in the Nether');
        const fs = g.netherGen.fortressesNear(p.x - 1200, p.z - 1200, p.x + 1200, p.z + 1200);
        if (!fs.length) return err('No fortress nearby');
        fs.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        const f = fs[0];
        return say(`Nearest fortress is at [${f.x}, ${f.y0}, ${f.z}] (${Math.round(Math.hypot(f.x - p.x, f.z - p.z))} blocks away)`, '#55ff55');
      }
      if (what === 'village') {
        if (g.dim !== 'overworld') return err('Villages are in the Overworld');
        const vs = villagesNear(g.gen, p.x - 1500, p.z - 1500, p.x + 1500, p.z + 1500);
        if (!vs.length) return err('No village nearby');
        vs.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        return say(`Nearest village is at [${vs[0].x}, ~, ${vs[0].z}] (${Math.round(Math.hypot(vs[0].x - p.x, vs[0].z - p.z))} blocks away)`, '#55ff55');
      }
      return err('Usage: /locate <fortress|village>');
    }
    case 'enchant': {
      const key = (args[0] || '').replace(/^minecraft:/, '').toLowerCase();
      const e = ENCHANTS[EN[key]];
      if (!e) return err(`Unknown enchantment '${key}'. Try: ${ENCHANTS.map((x) => x.key).join(', ')}`);
      const lvl = args[1] === undefined ? 1 : parseInt(args[1], 10);
      if (!(lvl >= 1 && lvl <= e.max)) return err(`${lvl} is not a valid level for ${e.name} (1-${e.max})`);
      const h = p.inv.held;
      if (!h || !canApply(e, h.id) || h.id === I.book) return err(`${h ? ITEMS[h.id].display : 'Nothing'} cannot support that enchantment`);
      const ench = h.ench || [];
      if (ench.some((x) => x[0] !== e.id && !compatible(ENCHANTS[x[0]], e))) return err(`${ITEMS[h.id].display} has an enchantment that conflicts with ${e.name}`);
      h.ench = ench.filter((x) => x[0] !== e.id).concat([[e.id, lvl]]);
      return say(`Applied enchantment ${enchName([e.id, lvl])} to ${ITEMS[h.id].display}`);
    }
    case 'setblock': case 'fill': {
      const n = cmd === 'fill' ? 6 : 3;
      const c = [];
      for (let i = 0; i < n; i++) c.push(Math.floor(rel(args[i], [p.x, p.y, p.z][i % 3])));
      const name = (args[n] || '').replace(/^minecraft:/, '').toLowerCase();
      const id = name === 'air' ? 0 : B[name];
      if (c.some((v) => Number.isNaN(v)) || id === undefined) {
        return err(id === undefined && name ? `Unknown block '${name}'` : cmd === 'fill' ? 'Usage: /fill <x1> <y1> <z1> <x2> <y2> <z2> <block>' : 'Usage: /setblock <x> <y> <z> <block>');
      }
      const [x0, y0, z0, x1 = x0, y1 = y0, z1 = z0] = c;
      const lo = [Math.min(x0, x1), Math.max(0, Math.min(y0, y1)), Math.min(z0, z1)];
      const hi = [Math.max(x0, x1), Math.min(WH - 1, Math.max(y0, y1)), Math.max(z0, z1)];
      const vol = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
      if (vol > 32768) return err(`Too many blocks in the specified area (${vol} > 32768)`);
      let changed = 0;
      for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
        if (g.world.setBlock(x, y, z, id)) changed++;
      }
      return changed ? say(cmd === 'fill' ? `Successfully filled ${changed} block(s)` : 'Changed the block') : err('No blocks were changed');
    }
    default: return err(`Unknown command '${cmd}'. Type /help for a list.`);
  }
}
