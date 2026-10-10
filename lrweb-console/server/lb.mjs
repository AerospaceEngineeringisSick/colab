// Load balancing for LRWeb Console: pools of servers behind one domain, traffic switching and drills.
// Nothing here touches a real server. Health comes from each server's recorded status, traffic is
// simulated from the balancing rules, and config() only generates nginx text for the operator to apply.
import { randomBytes } from 'node:crypto';
import {
  ALGORITHMS, DEFAULT_HEALTH_CHECK, MEMBER_ROLES, eligibleMembers, fnv1a, isValidDomain, mulberry32,
  nginxConfig, parseAddress, simulateTraffic, validateHealthCheck, validateWeights,
} from '../web/js/lib/lb-algorithms.js';
import { ValidationError } from './validate.mjs';

const ALGORITHM_IDS = ALGORITHMS.map((a) => a.id);
const MAX_MEMBERS = 12;
const MAX_NAME = 60;
const MINUTES = 60;
const SIM_REQUESTS = 300; // simulated visits per minute
const SIM_VISITORS = 60;
const TOP_FIELDS = ['name', 'domain', 'serverId', 'algorithm', 'sticky', 'healthCheck', 'members'];
const UPDATE_FIELDS = ['name', 'domain', 'algorithm', 'sticky', 'healthCheck', 'members'];
const NEW_MEMBER_FIELDS = ['serverId', 'address', 'weight', 'role'];
const SAVED_MEMBER_FIELDS = ['id', ...NEW_MEMBER_FIELDS];
const SWITCH_FIELDS = ['toMemberId', 'mode'];
const SWITCH_STEPS = [
  { key: 'preflight', label: 'Check the new server is healthy' },
  { key: 'warmup', label: 'Warm up the new server' },
  { key: 'shift', label: 'Move visitors across' },
  { key: 'verify', label: 'Check visitors are arriving' },
  { key: 'finalize', label: 'Save the new layout' },
];
const DRILL_STEPS = [
  { key: 'pick', label: 'Pick the server to test' },
  { key: 'fail', label: 'Pretend it has failed' },
  { key: 'takeover', label: 'Check the rest of the pool takes over' },
  { key: 'restore', label: 'Put it back in service' },
];
const PLAIN_STATUS = {
  unhealthy: 'not responding',
  unknown: 'not reporting its status yet',
  draining: 'being drained, so it cannot take visitors',
};
const STUB_JOB = { step: async (_key, fn) => fn(), setStep() {}, result() {}, secret() {} };

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (n) => Math.round(n * 10) / 10;
const round4 = (n) => Math.round(n * 10000) / 10000;
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404, code: 'not_found' });
const blocked = (message) => Object.assign(new Error(message), { status: 409, code: 'lb_blocked' });

/** Accepts epoch milliseconds, a Date-like ISO string, or a function returning either. */
function toMs(value) {
  const v = typeof value === 'function' ? value() : value;
  return typeof v === 'number' ? v : Date.parse(v);
}

function asObject(value, message = 'Send the details as a JSON object', field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(message, field);
  return value;
}

function rejectUnknown(input, allowed) {
  const extra = Object.keys(input).find((k) => !allowed.includes(k));
  if (extra !== undefined) throw new ValidationError(`Unknown field "${extra}"`, extra);
}

/* ---------- validation ---------- */

function parseName(value) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError('Give the pool a name', 'name');
  const name = value.trim();
  if (name.length > MAX_NAME) throw new ValidationError(`The name must be ${MAX_NAME} characters or fewer`, 'name');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ValidationError('The name contains characters that are not allowed', 'name');
  return name;
}

function parseDomain(value) {
  const domain = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!isValidDomain(domain)) throw new ValidationError('Enter a valid domain such as example.com', 'domain');
  return domain;
}

function parseAlgorithm(value) {
  if (ALGORITHM_IDS.includes(value)) return value;
  const choices = ALGORITHMS.map((a) => a.label).join(', ');
  throw new ValidationError(`Pick a balancing method: ${choices}`, 'algorithm');
}

function parseSticky(value = false) {
  if (typeof value !== 'boolean') throw new ValidationError('Sticky must be on or off', 'sticky');
  return value;
}

function parseHealthCheck(value, base = DEFAULT_HEALTH_CHECK) {
  if (value === undefined) return { ...base };
  const input = asObject(value, 'The health check must be an object', 'healthCheck');
  rejectUnknown(input, Object.keys(DEFAULT_HEALTH_CHECK));
  const merged = { ...base, ...input };
  const problem = validateHealthCheck(merged)[0];
  if (problem) throw new ValidationError(problem, 'healthCheck');
  return merged;
}

/** `servers` is a Map of server records. `existing` is the saved member list when updating. */
function parseMembers(input, servers, existing = null) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_MEMBERS) {
    throw new ValidationError(`Add between 1 and ${MAX_MEMBERS} servers to the pool`, 'members');
  }
  const fields = existing ? SAVED_MEMBER_FIELDS : NEW_MEMBER_FIELDS;
  const seen = new Set();
  const members = input.map((raw) => {
    const item = asObject(raw, 'Each server in the pool needs a serverId, an address and a weight', 'members');
    rejectUnknown(item, fields);
    const server = typeof item.serverId === 'string' ? servers.get(item.serverId) : undefined;
    if (!server) throw new ValidationError('Pick a server that LRWeb Console knows about', 'members');
    if (seen.has(server.id)) throw new ValidationError(`${server.name} is in this pool more than once`, 'members');
    seen.add(server.id);
    const address = parseAddress(item.address);
    if (!address) {
      throw new ValidationError(`The address for ${server.name} must look like host:port, for example 203.0.113.10:80`, 'members');
    }
    const weight = item.weight === undefined ? 1 : item.weight;
    const weightProblem = validateWeights([{ name: server.name, weight }])[0];
    if (weightProblem) throw new ValidationError(weightProblem, 'members');
    const role = item.role === undefined ? 'active' : item.role;
    if (!MEMBER_ROLES.includes(role)) throw new ValidationError('Each server role must be active, standby or drain', 'members');
    let id = `mem_${randomBytes(4).toString('hex')}`;
    if (existing && item.id !== undefined) {
      const old = existing.find((m) => m.id === item.id);
      if (!old || old.serverId !== server.id) {
        throw new ValidationError(`${server.name} does not match a server already in this pool`, 'members');
      }
      id = old.id;
    }
    return { id, serverId: server.id, address: `${address.host}:${address.port}`, weight, role };
  });
  if (!members.some((m) => m.role === 'active')) throw new ValidationError('Pick at least one active server', 'members');
  return members;
}

/* ---------- health, status and traffic ---------- */

/** Server status (from the CloudPanel record) to member health. Latency and error figures are simulated. */
function healthOf(server) {
  const cpu = Number(server?.metrics?.cpu) || 0;
  switch (server?.status) {
    case 'online': return { health: 'healthy', p95ms: Math.round(110 + cpu * 0.6), errorRate: 0.002 };
    case 'degraded': return { health: 'healthy', p95ms: Math.round(360 + cpu * 0.6), errorRate: 0.012 };
    case 'offline': return { health: 'unhealthy', p95ms: 0, errorRate: 0 };
    default: return { health: 'unknown', p95ms: 0, errorRate: 0 };
  }
}

function liveMembers(pool, servers, nowMs) {
  const stamp = new Date(nowMs).toISOString();
  const threshold = (pool.healthCheck ?? DEFAULT_HEALTH_CHECK).unhealthyThreshold;
  return pool.members.map((m) => {
    const server = servers.get(m.serverId);
    const h = healthOf(server);
    return {
      id: m.id,
      serverId: m.serverId,
      name: server?.name ?? 'Unknown server',
      address: m.address,
      weight: m.weight,
      role: m.role,
      status: m.role === 'drain' ? 'draining' : h.health,
      p95ms: h.p95ms,
      errorRate: h.errorRate,
      connections: 0,
      rps: 0,
      failCount: h.health === 'unhealthy' ? threshold : 0,
      lastCheckAt: stamp,
    };
  });
}

const forBalancer = (members) => members.map((m) => ({
  id: m.id, weight: m.weight, role: m.role, healthy: m.status === 'healthy',
}));

/** healthy: every active member is healthy. degraded: some are not. down: nothing can take visits. */
function poolStatus(members) {
  if (!eligibleMembers(forBalancer(members)).length) return 'down';
  const actives = members.filter((m) => m.role === 'active');
  return actives.length > 0 && actives.every((m) => m.status === 'healthy') ? 'healthy' : 'degraded';
}

/** 60 one-minute points ending at the current minute. Every number is simulated and deterministic. */
function computeTraffic(pool, members, nowMs) {
  const endMinute = Math.floor(nowMs / 60000);
  const seed = fnv1a(pool.id);
  const baseRps = 30 + (seed % 40);
  const phase = (seed % 628) / 100;
  const labels = [];
  const acc = members.map(() => ({ sum: 0, latency: 0, errors: 0, series: [] }));

  for (let k = 0; k < MINUTES; k += 1) {
    const minute = endMinute - (MINUTES - 1 - k);
    labels.push(new Date(minute * 60000).toISOString());
    const rng = mulberry32((seed ^ Math.imul(minute, 0x9e3779b1)) >>> 0);
    const dayAngle = ((minute % 1440) / 1440) * 2 * Math.PI;
    const total = baseRps * (1 + 0.35 * Math.sin(dayAngle + phase)) * (0.85 + 0.3 * rng());
    const sim = simulateTraffic({
      algorithm: pool.algorithm, members: forBalancer(members), requests: SIM_REQUESTS, clients: SIM_VISITORS, seed: (seed ^ minute) >>> 0,
    });
    const share = new Map(sim.distribution.map((d) => [d.memberId, d.share]));
    members.forEach((m, i) => {
      const rps = total * (share.get(m.id) ?? 0);
      const latency = m.p95ms * (0.9 + 0.2 * rng());
      const errors = m.status === 'healthy' ? m.errorRate * (0.7 + 0.6 * rng()) : 0;
      acc[i].series.push(rps);
      acc[i].sum += rps;
      acc[i].latency += rps * latency;
      acc[i].errors += rps * errors;
    });
  }

  const served = acc.reduce((s, a) => s + a.sum, 0);
  const latencySum = acc.reduce((s, a) => s + a.latency, 0);
  const errorSum = acc.reduce((s, a) => s + a.errors, 0);
  return {
    labels,
    series: members.map((m, i) => ({ memberId: m.id, name: m.name, rps: acc[i].series.map(round1) })),
    totals: {
      rps: round1(served / MINUTES),
      p95ms: served ? Math.round(latencySum / served) : 0,
      errorRate: served ? round4(errorSum / served) : 0,
    },
    distribution: members.map((m, i) => ({ memberId: m.id, name: m.name, share: served ? round4(acc[i].sum / served) : 0 })),
    simulated: true,
  };
}

const memberView = (m) => ({
  id: m.id,
  serverId: m.serverId,
  name: m.name,
  address: m.address,
  weight: m.weight,
  role: m.role,
  status: m.status,
  connections: m.connections,
  rps: m.rps,
  p95ms: m.p95ms,
  failCount: m.failCount,
  lastCheckAt: m.lastCheckAt,
});

function poolView(pool, members) {
  return {
    id: pool.id,
    name: pool.name,
    domain: pool.domain,
    serverId: pool.serverId,
    algorithm: pool.algorithm,
    sticky: pool.sticky,
    healthCheck: pool.healthCheck,
    mode: pool.mode,
    ...(pool.mode === 'failover' && pool.activeMemberId ? { activeMemberId: pool.activeMemberId } : {}),
    members,
    status: poolStatus(members),
    createdAt: pool.createdAt,
    updatedAt: pool.updatedAt,
  };
}

function presentWith(pool, servers, nowMs) {
  const live = liveMembers(pool, servers, nowMs);
  const traffic = computeTraffic(pool, live, nowMs);
  const members = live.map((m, i) => {
    const rps = traffic.series[i].rps.at(-1) ?? 0;
    return memberView({ ...m, rps, connections: Math.round((rps * m.p95ms) / 1000) });
  });
  return poolView(pool, members);
}

/* ---------- pools ---------- */

/**
 * Inserts the demo pool `lbp_main` (Tidewater, weighted) once. It needs the demo servers to exist, so it
 * does nothing when they are missing, and it never comes back after being deleted.
 */
export function seedPools(store, now = () => Date.now()) {
  if (store.meta.get('lbSeeded') || store.get('pools', 'lbp_main')) return false;
  const servers = ['srv_ldn1', 'srv_man1', 'srv_dub1'].map((id) => store.get('servers', id));
  if (servers.some((s) => !s)) return false;
  const [ldn, man, dub] = servers;
  const addresses = [`${ldn.host}:80`, `${man.host}:80`, `${dub.host}:80`].map(parseAddress);
  if (addresses.some((a) => !a)) return false;
  const stamp = new Date(toMs(now)).toISOString();
  store.insert('pools', {
    id: 'lbp_main',
    name: 'Tidewater',
    domain: 'tidewater.example',
    serverId: ldn.id,
    algorithm: 'weighted',
    sticky: false,
    healthCheck: { ...DEFAULT_HEALTH_CHECK },
    members: [
      { id: 'mem_ldn1', serverId: ldn.id, address: `${ldn.host}:80`, weight: 3, role: 'active' },
      { id: 'mem_man1', serverId: man.id, address: `${man.host}:80`, weight: 2, role: 'active' },
      { id: 'mem_dub1', serverId: dub.id, address: `${dub.host}:80`, weight: 1, role: 'standby' },
    ],
    mode: 'balanced',
    activeMemberId: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  store.meta.set('lbSeeded', true);
  return true;
}

// `settings` is the app config. It is not called `config` because this module exposes a config(id) method.
export function createLoadBalancer({ config: settings, store, cloudpanel, now = () => Date.now() }) {
  const nowMs = () => toMs(now);
  const isoNow = () => new Date(nowMs()).toISOString();
  const pause = () => {
    const ms = Math.max(0, Number(settings?.demoDelayMs) || 0);
    return ms > 0 ? sleepFor(ms) : undefined;
  };
  const serverMap = async () => new Map((await cloudpanel.listServers()).map((s) => [s.id, s]));
  const requirePool = (id) => {
    const pool = store.get('pools', id);
    if (!pool) throw notFound('Pool');
    return pool;
  };
  const assertDomainFree = (domain, exceptId) => {
    if (store.findOne('pools', (p) => p.domain === domain && p.id !== exceptId)) {
      throw Object.assign(new Error(`Another pool already uses ${domain}`), { status: 409, code: 'domain_taken', field: 'domain' });
    }
  };
  const view = async (pool) => presentWith(pool, await serverMap(), nowMs());

  async function listPools() {
    const servers = await serverMap();
    const t = nowMs();
    return store.all('pools').map((pool) => presentWith(pool, servers, t));
  }

  async function getPool(id) {
    return view(requirePool(id));
  }

  async function createPool(input) {
    const body = asObject(input);
    rejectUnknown(body, TOP_FIELDS);
    const name = parseName(body.name);
    const domain = parseDomain(body.domain);
    const servers = await serverMap();
    if (typeof body.serverId !== 'string' || !servers.has(body.serverId)) {
      throw new ValidationError('Pick the server that will run the load balancer', 'serverId');
    }
    const algorithm = parseAlgorithm(body.algorithm ?? 'weighted');
    const sticky = parseSticky(body.sticky);
    const healthCheck = parseHealthCheck(body.healthCheck);
    const members = parseMembers(body.members, servers);
    assertDomainFree(domain);
    const stamp = isoNow();
    const row = store.insert('pools', {
      name, domain, serverId: body.serverId, algorithm, sticky, healthCheck, members,
      mode: 'balanced', activeMemberId: null, createdAt: stamp, updatedAt: stamp,
    });
    return view(row);
  }

  async function updatePool(id, input) {
    const pool = requirePool(id);
    const body = asObject(input);
    rejectUnknown(body, UPDATE_FIELDS);
    const changes = {};
    if ('name' in body) changes.name = parseName(body.name);
    if ('domain' in body) {
      changes.domain = parseDomain(body.domain);
      assertDomainFree(changes.domain, id);
    }
    if ('algorithm' in body) changes.algorithm = parseAlgorithm(body.algorithm);
    if ('sticky' in body) changes.sticky = parseSticky(body.sticky);
    if ('healthCheck' in body) changes.healthCheck = parseHealthCheck(body.healthCheck, pool.healthCheck);
    if ('members' in body) {
      const members = parseMembers(body.members, await serverMap(), pool.members);
      changes.members = members;
      // Failover only survives if its target is still the one active server.
      const keepFailover = pool.mode === 'failover'
        && members.some((m) => m.id === pool.activeMemberId && m.role === 'active');
      if (!keepFailover) {
        changes.mode = 'balanced';
        changes.activeMemberId = null;
      }
    }
    changes.updatedAt = isoNow();
    return view(store.update('pools', id, changes));
  }

  async function deletePool(id) {
    requirePool(id);
    store.remove('pools', id);
  }

  async function traffic(id) {
    const pool = requirePool(id);
    const t = nowMs();
    return computeTraffic(pool, liveMembers(pool, await serverMap(), t), t);
  }

  async function config(id) {
    const pool = requirePool(id);
    const servers = await serverMap();
    // Only letters, numbers, spaces, dots, dashes and underscores reach the nginx comment.
    const entryName = String(servers.get(pool.serverId)?.name ?? '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 60);
    let nginx;
    try {
      nginx = nginxConfig({
        name: pool.name,
        domain: pool.domain,
        algorithm: pool.algorithm,
        sticky: pool.sticky,
        healthCheck: pool.healthCheck,
        serverName: entryName || undefined,
        members: pool.members.map((m) => ({
          id: m.id, name: servers.get(m.serverId)?.name, address: m.address, weight: m.weight, role: m.role,
        })),
      });
    } catch (err) {
      throw new ValidationError(err.message);
    }
    const method = pool.sticky ? 'ip_hash' : pool.algorithm;
    const notes = [
      'This page generates the nginx setup for you to apply on the entry server. LRWeb Console does not push it to any server.',
      'CloudPanel has no API for load balancing, so the setup goes into a custom vhost template by hand.',
      "Traffic, speed and error figures are simulated from the balancing rules and each server's status. They are not measured from real visitors.",
      'Server health comes from the status LRWeb Console has on record. Live health checks are not connected yet.',
    ];
    if (pool.sticky) {
      notes.push('Sticky visitors are kept on one server by address, because open-source nginx cannot pin visitors with a cookie.');
    }
    if (method === 'round_robin' || method === 'ip_hash') {
      notes.push('This method does not use weights, so every server is written with weight=1.');
    }
    if (method === 'ip_hash' || method === 'random_two') {
      notes.push('Spare servers are written as down, because nginx does not support spare servers with this method.');
    }
    if (pool.mode === 'failover' && pool.activeMemberId) {
      const target = servers.get(pool.members.find((m) => m.id === pool.activeMemberId)?.serverId)?.name ?? 'the active server';
      notes.push(`Failover is on: all visitors go to ${target}. The other servers are kept as spares.`);
    }
    return { nginx, notes };
  }

  async function drain(id, memberId) {
    const pool = requirePool(id);
    const member = pool.members.find((m) => m.id === memberId);
    if (!member) throw notFound('Server in this pool');
    if (member.role === 'drain') return view(pool);
    const otherActive = pool.members.some((m) => m.id !== memberId && m.role === 'active');
    if (member.role === 'active' && !otherActive) {
      throw blocked('Pick another active server first, so at least one server stays active.');
    }
    const members = pool.members.map((m) => (m.id === memberId ? { ...m, role: 'drain' } : m));
    const patch = { members, updatedAt: isoNow() };
    if (pool.activeMemberId === memberId) {
      patch.mode = 'balanced';
      patch.activeMemberId = null;
    }
    return view(store.update('pools', id, patch));
  }

  /** Runs inside a `lb.switch` job. Stored state changes only at the final step, so a failure leaves it alone. */
  async function switchTo(id, memberId, { mode = 'gradual' } = {}, j = STUB_JOB) {
    const stages = mode === 'instant' ? [100] : [10, 25, 50, 100];
    let name = 'the new server';
    // Re-reads the target from the server records. Returns a plain-English sentence, or null when it can take visitors.
    const notReady = async (action) => {
      const pool = requirePool(id);
      const member = liveMembers(pool, await serverMap(), nowMs()).find((m) => m.id === memberId);
      if (!member) return `That server is no longer in this pool. ${action}`;
      name = member.name;
      if (member.status === 'healthy') return null;
      return `${name} is ${PLAIN_STATUS[member.status] ?? PLAIN_STATUS.unknown}. ${action}`;
    };

    await j.step('preflight', async () => {
      const problem = await notReady('Visitors are still on the current server.');
      if (problem) throw blocked(`Cannot move visitors yet. ${problem}`);
      return `${name} is healthy and ready`;
    });
    await j.step('warmup', async () => {
      await pause();
      return `${name} is warmed up (simulated)`;
    });
    await j.step('shift', async () => {
      for (let i = 0; i < stages.length; i += 1) {
        if (i > 0) await pause();
        const problem = await notReady('Visitors stay on the current server.');
        if (problem) throw blocked(`Stopped before sending ${stages[i]}% of visitors. ${problem}`);
        j.setStep('shift', 'running', `Sending ${stages[i]}% of visitors to ${name} (simulated)`);
      }
      return `All visitors now go to ${name} (simulated)`;
    });
    await j.step('verify', async () => {
      const problem = await notReady('Visitors stay on the current server.');
      if (problem) throw blocked(`The switch was not saved. ${problem}`);
      const pool = requirePool(id);
      const live = liveMembers(pool, await serverMap(), nowMs());
      const proposed = live.map((m) => {
        let role = m.role;
        if (m.id === memberId) role = 'active';
        else if (m.role === 'active') role = 'standby';
        return { id: m.id, weight: m.weight, role, healthy: m.status === 'healthy' };
      });
      const sim = simulateTraffic({ algorithm: pool.algorithm, members: proposed, requests: 200, clients: 40, seed: 3 });
      const share = sim.distribution.find((d) => d.memberId === memberId)?.share ?? 0;
      if (share < 0.999) {
        throw blocked(`The switch was not saved. In the check, not all visitors reached ${name}. Visitors stay on the current server.`);
      }
      return `${name} would take all visitors (simulated)`;
    });
    await j.step('finalize', async () => {
      const pool = requirePool(id);
      if (!pool.members.some((m) => m.id === memberId)) {
        throw blocked('That server was removed from the pool during the switch. Nothing has changed.');
      }
      const members = pool.members.map((m) => {
        if (m.id === memberId) return { ...m, role: 'active' };
        return m.role === 'active' ? { ...m, role: 'standby' } : m;
      });
      store.update('pools', id, { members, mode: 'failover', activeMemberId: memberId, updatedAt: isoNow() });
      return `Saved in LRWeb Console (simulated). Visitors go to ${name}. The live nginx config is not changed.`;
    });
  }

  /** Simulated failover drill. It reads the pool and never writes to it. */
  async function drill(id, j = STUB_JOB) {
    let live = [];
    let tested = null;
    let takers = [];
    await j.step('pick', async () => {
      const pool = requirePool(id);
      live = liveMembers(pool, await serverMap(), nowMs());
      const healthyActive = live.filter((m) => m.role === 'active' && m.status === 'healthy');
      tested = healthyActive.find((m) => m.id === pool.activeMemberId)
        ?? [...healthyActive].sort((a, b) => b.weight - a.weight)[0]
        ?? null;
      if (!tested) throw blocked('There is no healthy active server to test, so the drill cannot run. Nothing has changed.');
      return `Testing with ${tested.name}. No real visitors are affected.`;
    });
    await j.step('fail', async () => {
      await pause();
      return `Pretending ${tested.name} has stopped responding (simulated)`;
    });
    await j.step('takeover', async () => {
      const pool = requirePool(id);
      const after = live.map((m) => ({
        id: m.id, weight: m.weight, role: m.role, healthy: m.id !== tested.id && m.status === 'healthy',
      }));
      const sim = simulateTraffic({ algorithm: pool.algorithm, members: after, requests: SIM_REQUESTS, clients: SIM_VISITORS, seed: 11 });
      const sent = sim.distribution.reduce((s, d) => s + d.picked, 0);
      const toFailed = sim.distribution.find((d) => d.memberId === tested.id)?.picked ?? 0;
      if (sent === 0 || toFailed > 0) {
        throw blocked(`If ${tested.name} stopped, no healthy server would take its visitors. Add a spare server, then run the drill again. Nothing has changed.`);
      }
      takers = sim.distribution
        .filter((d) => d.picked > 0)
        .map((d) => live.find((m) => m.id === d.memberId)?.name ?? 'another server');
      return `${takers.join(', ')} would take over (simulated)`;
    });
    await j.step('restore', async () => {
      await pause();
      return `${tested.name} is back in service (simulated). Saved settings were not changed.`;
    });
    j.result({ simulated: true, changedStoredState: false, testedServer: tested.name, takeoverServers: takers });
  }

  return {
    listPools, getPool, createPool, updatePool, deletePool, traffic, config, drain, switchTo, drill,
  };
}

export function lbRoutes({ lb, jobs }) {
  return [
    { method: 'GET', path: '/api/lb/pools', auth: 'any', handler: () => lb.listPools() },
    { method: 'POST', path: '/api/lb/pools', auth: 'any', handler: ({ body }) => lb.createPool(body) },
    { method: 'GET', path: '/api/lb/pools/:id', auth: 'any', handler: ({ params }) => lb.getPool(params.id) },
    { method: 'PUT', path: '/api/lb/pools/:id', auth: 'any', handler: ({ params, body }) => lb.updatePool(params.id, body) },
    {
      method: 'DELETE',
      path: '/api/lb/pools/:id',
      auth: 'any',
      handler: async ({ params }) => {
        await lb.deletePool(params.id);
        return { removed: true };
      },
    },
    { method: 'GET', path: '/api/lb/pools/:id/traffic', auth: 'any', handler: ({ params }) => lb.traffic(params.id) },
    { method: 'GET', path: '/api/lb/pools/:id/config', auth: 'any', handler: ({ params }) => lb.config(params.id) },
    {
      method: 'POST',
      path: '/api/lb/pools/:id/members/:mid/drain',
      auth: 'any',
      handler: ({ params }) => lb.drain(params.id, params.mid),
    },
    {
      method: 'POST',
      path: '/api/lb/pools/:id/switch',
      auth: 'any',
      handler: async ({ params, body }) => {
        const input = asObject(body);
        rejectUnknown(input, SWITCH_FIELDS);
        const pool = await lb.getPool(params.id);
        const toMemberId = typeof input.toMemberId === 'string' ? input.toMemberId : '';
        if (!pool.members.some((m) => m.id === toMemberId)) {
          throw new ValidationError('Pick a server that is in this pool', 'toMemberId');
        }
        const mode = input.mode ?? 'gradual';
        if (!['gradual', 'instant'].includes(mode)) throw new ValidationError('Pick gradual or instant', 'mode');
        return jobs.start({ kind: 'lb.switch', steps: SWITCH_STEPS }, (j) => lb.switchTo(params.id, toMemberId, { mode }, j));
      },
    },
    {
      method: 'POST',
      path: '/api/lb/pools/:id/drill',
      auth: 'any',
      handler: async ({ params }) => {
        await lb.getPool(params.id);
        return jobs.start({ kind: 'lb.drill', steps: DRILL_STEPS }, (j) => lb.drill(params.id, j));
      },
    },
  ];
}
