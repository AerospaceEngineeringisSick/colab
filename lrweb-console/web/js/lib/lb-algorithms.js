// Load-balancing rules, shared by the server, the browser console and the offline mockup.
// Pure functions only: no imports, no network, no clock. Everything here is a model.
// Nothing in this file talks to a real server.

export const ALGORITHMS = [
  {
    id: 'round_robin',
    label: 'Take turns',
    description: 'Each visit goes to the next server in turn. Weights are not used.',
    hint: 'Simple. Best when every server is the same size.',
  },
  {
    id: 'weighted',
    label: 'Weighted turns',
    description: 'Takes turns, but a server with weight 3 gets three visits for every one a weight 1 server gets.',
    hint: 'The usual choice. Set weights to match each server size.',
  },
  {
    id: 'least_conn',
    label: 'Least busy',
    description: 'Each visit goes to the server with the fewest open visits for its weight.',
    hint: 'Good when some visits take much longer than others.',
  },
  {
    id: 'ip_hash',
    label: 'Same visitor, same server',
    description: "A visitor's address always goes to the same server while the list of servers stays the same. Weights are not used.",
    hint: 'Use when visitors must stay on one server. Adding or removing a server moves most visitors.',
  },
  {
    id: 'random_two',
    label: 'Two random picks',
    description: 'Picks two servers at random and sends the visit to the less busy one.',
    hint: 'Almost as even as least busy, with less coordination between servers.',
  },
];

export const DEFAULT_HEALTH_CHECK = Object.freeze({
  path: '/', intervalSec: 10, timeoutSec: 3, unhealthyThreshold: 3, healthyThreshold: 2, expectStatus: 200,
});

export const MEMBER_ROLES = Object.freeze(['active', 'standby', 'drain']);

const ALGORITHM_IDS = ALGORITHMS.map((a) => a.id);
// Methods where a server's share follows its weight. The others split visits evenly.
const WEIGHTED_METHODS = new Set(['weighted', 'least_conn', 'random_two']);
// Methods that ignore weights, so the nginx config writes every server as weight=1.
const EQUAL_WEIGHT_METHODS = new Set(['round_robin', 'ip_hash']);
// nginx does not support spare (backup) servers with these methods, so spares are written as down.
const NO_BACKUP_METHODS = new Set(['ip_hash', 'random_two']);
const MAX_STICKY_KEYS = 5000;

/** FNV-1a, 32-bit. Used for ip_hash and for stable seeds. */
export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small seeded PRNG (mulberry32). The same seed always gives the same sequence. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST_RE = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`, 'i');
const DOMAIN_RE = new RegExp(`^(?=.{1,253}$)(?:${LABEL}\\.)+[a-z]{2,63}$`, 'i');
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Splits "host:port" into { host, port } or returns null. Hostnames and IPv4 only. */
export function parseAddress(value) {
  const m = typeof value === 'string' ? /^([^:\s]+):([1-9]\d{0,4})$/.exec(value.trim()) : null;
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = Number(m[2]);
  if (port > 65535) return null;
  const ok = /^[0-9.]+$/.test(host) ? IPV4_RE.test(host) : HOST_RE.test(host);
  return ok ? { host, port } : null;
}

export const isValidAddress = (value) => parseAddress(value) !== null;
export const isValidDomain = (value) => typeof value === 'string' && DOMAIN_RE.test(value);

const weightOf = (m) => (Number.isFinite(m.weight) && m.weight > 0 ? m.weight : 1);
const isHealthy = (m) => (typeof m.healthy === 'boolean' ? m.healthy : m.status === 'healthy');

/**
 * Members that may take visits: healthy `active` members, or healthy `standby` members only when
 * no active member is healthy. `drain` members never take visits.
 */
export function eligibleMembers(members = []) {
  const up = members.filter(isHealthy);
  const active = up.filter((m) => m.role === 'active');
  return active.length ? active : up.filter((m) => m.role === 'standby');
}

/**
 * Picks a server for each visit. Members: [{ id, weight, role, healthy }].
 * - round_robin: strict rotation over the eligible members, weights ignored.
 * - weighted: smooth weighted round robin, the same order nginx uses.
 * - least_conn: the member with the fewest open visits for its weight; ties go to the first in the list.
 * - ip_hash: FNV-1a of the visitor address, modulo the eligible list. The same address gets the same
 *   server while the list is unchanged. Adding or removing a server re-maps most visitors, because the
 *   index is hash modulo list length. Visits without an address fall back to round robin.
 * - random_two: two different eligible members at random, the less busy one wins.
 * sticky + key: a key keeps the member it first got while that member stays eligible. At most
 * 5000 keys are remembered; the least recently used key is dropped first.
 * done(id) marks a visit as finished, which lowers that member's open-visit count.
 */
export function createBalancer({ algorithm, members = [], sticky = false, rng = Math.random } = {}) {
  if (!ALGORITHM_IDS.includes(algorithm)) throw new Error(`Unknown balancing method: ${algorithm}`);
  let eligible = [];
  let current = new Map(); // smooth weighted round robin counters
  let turn = 0;
  let known = [];
  const open = new Map(); // member id -> visits still in progress
  const served = new Map(); // member id -> visits sent in total
  const pinned = new Map(); // sticky key -> member id, least recently used first

  const load = (m) => (open.get(m.id) ?? 0) / weightOf(m);

  function roundRobin() {
    const i = turn % eligible.length;
    turn = i + 1;
    return eligible[i].id;
  }

  function smoothWeighted() {
    let total = 0;
    let best = null;
    for (const m of eligible) {
      const w = weightOf(m);
      const score = (current.get(m.id) ?? 0) + w;
      current.set(m.id, score);
      total += w;
      if (best === null || score > current.get(best.id)) best = m;
    }
    current.set(best.id, current.get(best.id) - total);
    return best.id;
  }

  function choose(ip) {
    const n = eligible.length;
    switch (algorithm) {
      case 'weighted':
        return smoothWeighted();
      case 'least_conn':
        return eligible.reduce((best, m) => (load(m) < load(best) ? m : best)).id;
      case 'ip_hash':
        if (ip === undefined || ip === null || ip === '') return roundRobin();
        return eligible[fnv1a(String(ip)) % n].id;
      case 'random_two': {
        if (n === 1) return eligible[0].id;
        const i = Math.min(n - 1, Math.floor(rng() * n));
        let j = Math.min(n - 2, Math.floor(rng() * (n - 1)));
        if (j >= i) j += 1; // second pick is always a different member
        const a = eligible[i];
        const b = eligible[j];
        return load(b) < load(a) ? b.id : a.id;
      }
      default:
        return roundRobin();
    }
  }

  function take(id) {
    served.set(id, (served.get(id) ?? 0) + 1);
    open.set(id, (open.get(id) ?? 0) + 1);
    return id;
  }

  function pick({ ip, key } = {}) {
    if (!eligible.length) return null;
    if (sticky && key !== undefined && key !== null) {
      const kept = pinned.get(key);
      if (kept !== undefined && eligible.some((m) => m.id === kept)) {
        pinned.delete(key);
        pinned.set(key, kept); // now the most recently used key
        return take(kept);
      }
      const id = choose(ip);
      pinned.delete(key);
      pinned.set(key, id);
      if (pinned.size > MAX_STICKY_KEYS) pinned.delete(pinned.keys().next().value);
      return take(id);
    }
    return take(choose(ip));
  }

  function done(memberId) {
    const n = open.get(memberId) ?? 0;
    if (n > 0) open.set(memberId, n - 1);
  }

  function setMembers(list = []) {
    known = list.map((m) => m.id);
    eligible = eligibleMembers(list);
    current = new Map();
    for (const id of known) {
      if (!open.has(id)) open.set(id, 0);
      if (!served.has(id)) served.set(id, 0);
    }
  }

  function stats() {
    const out = {};
    for (const id of known) out[id] = { picked: served.get(id) ?? 0, active: open.get(id) ?? 0 };
    return out;
  }

  setMembers(members);
  return { pick, done, setMembers, stats };
}

/**
 * Sends `requests` simulated visits through the chosen method. `clients` visitors are active at once,
 * and each visit stays open until a later one replaces it, so least busy methods see real load.
 * maxSkew is the largest amount by which one server's share exceeds its fair share (weight share for
 * weighted methods, equal share otherwise). Output is deterministic for a given seed.
 */
export function simulateTraffic({ algorithm, members = [], requests = 1000, clients = 50, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const balancer = createBalancer({ algorithm, members, sticky: false, rng });
  const visitors = Math.max(1, Math.trunc(clients) || 1);
  const openVisits = [];
  const sent = new Map();
  let total = 0;
  for (let i = 0; i < requests; i += 1) {
    const k = Math.floor(rng() * visitors);
    const id = balancer.pick({ ip: `10.0.${(k >> 8) & 255}.${k & 255}` });
    if (id === null) continue;
    total += 1;
    sent.set(id, (sent.get(id) ?? 0) + 1);
    openVisits.push(id);
    if (openVisits.length > visitors) balancer.done(openVisits.shift());
  }

  const eligibleIds = new Set(eligibleMembers(members).map((m) => m.id));
  const weightSum = members.filter((m) => eligibleIds.has(m.id)).reduce((s, m) => s + weightOf(m), 0);
  const distribution = members.map((m) => {
    const picked = sent.get(m.id) ?? 0;
    return { memberId: m.id, picked, share: total ? picked / total : 0 };
  });
  let maxSkew = 0;
  members.forEach((m, i) => {
    let fair = 0;
    if (eligibleIds.has(m.id)) {
      fair = WEIGHTED_METHODS.has(algorithm) ? weightOf(m) / weightSum : 1 / eligibleIds.size;
    }
    maxSkew = Math.max(maxSkew, distribution[i].share - fair);
  });
  return { distribution, maxSkew };
}

/** Human-readable weight problems. An empty list means every weight is a whole number from 1 to 100. */
export function validateWeights(members = []) {
  const problems = [];
  for (const m of members) {
    const w = m?.weight;
    if (Number.isInteger(w) && w >= 1 && w <= 100) continue;
    const who = m?.name || m?.id || 'A server';
    problems.push(`${who} has weight ${w === undefined ? 'missing' : String(w)}. Weights must be whole numbers from 1 to 100.`);
  }
  return problems;
}

/** Human-readable health check problems. Empty list means the settings are usable. */
export function validateHealthCheck(hc = {}) {
  const problems = [];
  const whole = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  if (typeof hc.path !== 'string' || !/^\/[A-Za-z0-9._~\/-]{0,199}$/.test(hc.path)) {
    problems.push('The health check path must start with / and use only letters, numbers and . _ ~ - /');
  }
  if (!whole(hc.intervalSec, 5, 300)) problems.push('The health check interval must be a whole number of seconds from 5 to 300.');
  if (!whole(hc.timeoutSec, 1, 60)) {
    problems.push('The health check timeout must be a whole number of seconds from 1 to 60.');
  } else if (whole(hc.intervalSec, 5, 300) && hc.timeoutSec >= hc.intervalSec) {
    problems.push('The health check timeout must be shorter than the interval.');
  }
  if (!whole(hc.unhealthyThreshold, 1, 10)) problems.push('Failures before a server is skipped must be a whole number from 1 to 10.');
  if (!whole(hc.healthyThreshold, 1, 10)) problems.push('Successes before a server returns must be a whole number from 1 to 10.');
  if (!whole(hc.expectStatus, 100, 599)) problems.push('The expected status code must be a whole number from 100 to 599.');
  return problems;
}

const SLUG_RE = /^[a-z0-9_]{1,40}$/;
const SAFE_LABEL_RE = /^[A-Za-z0-9 ._-]{1,60}$/;
const DIRECTIVE = { round_robin: null, weighted: null, least_conn: 'least_conn;', ip_hash: 'ip_hash;', random_two: 'random two least_conn;' };
const METHOD_NOTE = {
  round_robin: 'Take turns: each visit goes to the next server in turn.',
  weighted: 'Weighted turns: a server with a bigger weight gets proportionally more visits.',
  least_conn: 'Least busy: each visit goes to the server with the fewest open visits for its weight.',
  ip_hash: "Same visitor, same server: a visitor's address always goes to the same server while this list stays the same.",
  random_two: 'Two random picks: nginx picks two servers at random and sends the visit to the less busy one.',
};

function slugOf(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  if (!SLUG_RE.test(slug)) throw new Error('Give the pool a name with letters or numbers in it.');
  return slug;
}

/**
 * Builds the nginx upstream and server blocks for a pool. Nothing is sent anywhere: the text is for the
 * operator to review and apply. Every value is validated before it is written.
 * Members: [{ address, weight, role, name? }]. Roles: active (takes visits), standby (spare, used only
 * when no active server is healthy), drain (takes no visits).
 */
export function nginxConfig({ name, domain, algorithm, members = [], sticky = false, healthCheck, serverName } = {}) {
  const slug = slugOf(name);
  if (!isValidDomain(domain)) throw new Error('Enter a valid domain such as example.com.');
  if (!ALGORITHM_IDS.includes(algorithm)) throw new Error('Pick a balancing method from the list.');
  const hc = { ...DEFAULT_HEALTH_CHECK, ...(healthCheck ?? {}) };
  const hcProblem = validateHealthCheck(hc)[0];
  if (hcProblem) throw new Error(hcProblem);
  if (serverName !== undefined && (typeof serverName !== 'string' || !SAFE_LABEL_RE.test(serverName))) {
    throw new Error('The entry server name can only use letters, numbers, spaces, dots, dashes and underscores.');
  }
  if (!Array.isArray(members) || members.length === 0) throw new Error('Add at least one server to the pool.');
  const weightProblem = validateWeights(members)[0];
  if (weightProblem) throw new Error(weightProblem);
  const parsed = members.map((m) => {
    const addr = parseAddress(m.address);
    if (!addr) throw new Error('A server address is not valid. Use host:port, for example 203.0.113.10:80.');
    if (!MEMBER_ROLES.includes(m.role)) throw new Error('Each server needs a role of active, standby or drain.');
    return { addr: `${addr.host}:${addr.port}`, weight: m.weight, role: m.role };
  });
  if (!parsed.some((m) => m.role === 'active')) throw new Error('Pick at least one active server');

  const dom = domain.toLowerCase();
  const upstream = `lrweb_${slug}`;
  const method = sticky ? 'ip_hash' : algorithm;
  const equalWeights = EQUAL_WEIGHT_METHODS.has(method);
  const noBackup = NO_BACKUP_METHODS.has(method);

  const out = [
    '# Generated by LRWeb Console',
    `# Load balancer for ${dom}, upstream name ${upstream}.`,
    '# This is a suggested setup for you to review and apply on the entry server.',
    '# LRWeb Console does not change any server, so nothing here is live until you apply it.',
  ];
  if (serverName) out.push(`# Entry server: ${serverName}`);
  out.push('');
  out.push(`# ${METHOD_NOTE[method]}`);
  if (sticky) {
    out.push('# Sticky visitors: open-source nginx cannot pin visitors with a cookie, so ip_hash keeps each visitor on one server by address.');
  }
  if (equalWeights) out.push('# This method does not use weights, so every server is written with weight=1.');
  if (noBackup) out.push('# nginx does not support spare (backup) servers with this method, so spares are written as down.');
  out.push(`# Health: a server that fails ${hc.unhealthyThreshold} visits in a row is skipped for ${hc.intervalSec} seconds.`);
  out.push(`# Open-source nginx judges health from real visits, so the check path ${hc.path} (expecting ${hc.expectStatus}) is for reference only.`);
  out.push(`upstream ${upstream} {`);
  if (DIRECTIVE[method]) out.push(`    ${DIRECTIVE[method]}`);
  for (const m of parsed) {
    const parts = [
      `server ${m.addr}`,
      `weight=${equalWeights ? 1 : m.weight}`,
      `max_fails=${hc.unhealthyThreshold}`,
      `fail_timeout=${hc.intervalSec}s`,
    ];
    if (m.role === 'drain' || (m.role === 'standby' && noBackup)) parts.push('down');
    else if (m.role === 'standby') parts.push('backup');
    out.push(`    ${parts.join(' ')};`);
  }
  out.push('    keepalive 32;');
  out.push('}');
  out.push('');
  out.push('server {');
  out.push('    listen 80;');
  out.push(`    server_name ${dom};`);
  out.push('');
  out.push('    location / {');
  out.push(`        proxy_pass http://${upstream};`);
  out.push('        proxy_set_header Host $host;');
  out.push('        proxy_set_header X-Real-IP $remote_addr;');
  out.push('        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
  out.push('        proxy_set_header X-Forwarded-Proto $scheme;');
  out.push('        proxy_http_version 1.1;');
  out.push('        proxy_set_header Connection "";');
  out.push('        proxy_next_upstream error timeout http_502 http_503 http_504;');
  out.push('    }');
  out.push('}');
  return `${out.join('\n')}\n`;
}
