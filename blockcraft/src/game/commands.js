// Chat commands.
import { ITEMS, I } from '../shared/items.js';
import { MOBS } from './mobs.js';
import { BIOMES } from '../shared/biomes.js';

const HELP = [
  '/gamemode <survival|creative|spectator>', '/time set <day|noon|night|midnight|ticks>', '/weather <clear|rain|thunder>',
  '/give <item> [count]', '/tp <x> <y> <z>', '/summon <mob>', '/difficulty <peaceful|easy|normal|hard>', '/kill',
  '/seed', '/spawnpoint', '/clear', '/heal', '/xp <amount>', '/biome',
];

export function runCommand(g, text) {
  const p = g.player;
  const args = text.trim().replace(/^\//, '').split(/\s+/);
  const cmd = (args.shift() || '').toLowerCase();
  const say = (t, c = '#aaaaaa') => g.message(t, c);
  const err = (t) => g.message(t, '#ff5555');
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
      const rel = (s, base) => (s && s.startsWith('~') ? base + (parseFloat(s.slice(1)) || 0) : parseFloat(s));
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
    case 'fill': return err('Not supported');
    default: return err(`Unknown command '${cmd}'. Type /help for a list.`);
  }
}
void BIOMES;
