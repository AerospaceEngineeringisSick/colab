import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../store.mjs';
import { createJobs } from '../jobs.mjs';
import { ValidationError } from '../validate.mjs';
import { createLoadBalancer, lbRoutes, seedPools } from '../lb.mjs';
import * as lib from '../../web/js/lib/lb-algorithms.js';

const EM_DASH = String.fromCharCode(0x2014);
const NOW = Date.parse('2026-10-10T12:00:00Z');

const member = (id, weight = 1, role = 'active', healthy = true) => ({ id, weight, role, healthy });
const count = (text, ch) => text.split(ch).length - 1;

/* ---------- fixtures ---------- */

function setup({ demoDelayMs = 0 } = {}) {
  const store = createStore({ memory: true });
  const servers = [
    { id: 'srv_ldn1', name: 'ldn-web-01', host: '192.0.2.10', status: 'online' },
    { id: 'srv_man1', name: 'man-web-01', host: '192.0.2.11', status: 'online' },
    { id: 'srv_dub1', name: 'dub-web-01', host: '192.0.2.12', status: 'degraded' },
    { id: 'srv_stg1', name: 'staging-01', host: '192.0.2.55', status: 'pending' },
    { id: 'srv_off1', name: 'old-web-01', host: '192.0.2.77', status: 'offline' },
  ];
  servers.forEach((s) => store.insert('servers', { ...s }));
  // The fake reads the same objects the test mutates, so changing a status here changes what the pool sees.
  const cloudpanel = {
    async listServers() { return servers.map((s) => ({ ...s })); },
    async getServer(id) { const s = servers.find((x) => x.id === id); return s ? { ...s } : undefined; },
  };
  const config = { demoDelayMs };
  const lb = createLoadBalancer({ config, store, cloudpanel, now: () => NOW });
  const jobs = createJobs({ store });
  const routes = lbRoutes({ lb, jobs });
  const route = (method, path) => routes.find((r) => r.method === method && r.path === path).handler;
  const setStatus = (id, status) => { servers.find((s) => s.id === id).status = status; };
  return { store, lb, jobs, route, setStatus };
}

const goodBody = (over = {}) => ({
  name: 'Shop',
  domain: 'shop.example',
  serverId: 'srv_ldn1',
  algorithm: 'weighted',
  sticky: false,
  members: [
    { serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 3, role: 'active' },
    { serverId: 'srv_man1', address: '192.0.2.11:80', weight: 2, role: 'active' },
    { serverId: 'srv_dub1', address: '192.0.2.12:80', weight: 1, role: 'standby' },
  ],
  ...over,
});

async function finish(jobs, id) {
  for (let i = 0; i < 1000; i += 1) {
    const job = jobs.get(id);
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('job did not finish');
}

const rejects = (promise, { field, message, status = 400 }) => assert.rejects(promise, (err) => {
  assert.equal(err.status, status);
  if (field !== undefined) assert.equal(err.field, field);
  if (message !== undefined) assert.match(err.message, new RegExp(message));
  return true;
});

/* ---------- algorithms ---------- */

describe('balancing algorithms', () => {
  test('smooth weighted round robin matches nginx: weights 5,1,1 give a,a,b,a,c,a,a', () => {
    const b = lib.createBalancer({ algorithm: 'weighted', members: [member('a', 5), member('b', 1), member('c', 1)] });
    const seq = Array.from({ length: 7 }, () => b.pick());
    assert.deepEqual(seq, ['a', 'a', 'b', 'a', 'c', 'a', 'a']);
  });

  test('round_robin splits 10k visits evenly and ignores weights', () => {
    const r = lib.simulateTraffic({ algorithm: 'round_robin', members: [member('a', 3), member('b', 2), member('c', 1)], requests: 10000 });
    for (const d of r.distribution) assert.ok(Math.abs(d.share - 1 / 3) < 0.01, `${d.memberId} got ${d.share}`);
  });

  test('weighted follows the weights on 10k visits', () => {
    const r = lib.simulateTraffic({ algorithm: 'weighted', members: [member('a', 3), member('b', 2), member('c', 1)], requests: 10000 });
    const target = { a: 0.5, b: 1 / 3, c: 1 / 6 };
    for (const d of r.distribution) assert.ok(Math.abs(d.share - target[d.memberId]) < 0.01, `${d.memberId} got ${d.share}`);
    assert.ok(r.maxSkew < 0.01);
  });

  test('least_conn and random_two follow the weights within 3 points on 10k visits', () => {
    const target = { a: 0.5, b: 1 / 3, c: 1 / 6 };
    for (const algorithm of ['least_conn', 'random_two']) {
      const r = lib.simulateTraffic({ algorithm, members: [member('a', 3), member('b', 2), member('c', 1)], requests: 10000, clients: 50, seed: 7 });
      for (const d of r.distribution) assert.ok(Math.abs(d.share - target[d.memberId]) < 0.03, `${algorithm} ${d.memberId} got ${d.share}`);
    }
  });

  test('ip_hash spreads 10k distinct visitors close to evenly', () => {
    const b = lib.createBalancer({ algorithm: 'ip_hash', members: [member('a'), member('b'), member('c')] });
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 10000; i += 1) counts[b.pick({ ip: `198.51.${(i >> 8) & 255}.${i & 255}` })] += 1;
    for (const id of ['a', 'b', 'c']) assert.ok(Math.abs(counts[id] / 10000 - 1 / 3) < 0.03, `${id} got ${counts[id]}`);
  });

  test('ip_hash is stable per address; removing a server moves most visitors (actual behaviour)', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => member(id));
    const b = lib.createBalancer({ algorithm: 'ip_hash', members: four });
    const ips = Array.from({ length: 1000 }, (_, i) => `198.51.${(i >> 8) & 255}.${i & 255}`);
    const before = new Map(ips.map((ip) => [ip, b.pick({ ip })]));
    for (const ip of ips) assert.equal(b.pick({ ip }), before.get(ip), 'same address must keep its server');
    b.setMembers(four.slice(0, 3));
    const moved = ips.filter((ip) => b.pick({ ip }) !== before.get(ip));
    const onRemoved = ips.filter((ip) => before.get(ip) === 'd');
    assert.ok(onRemoved.length > 0);
    // Hash modulo list length, so visitors on the other servers move too. Only the removed server's
    // visitors are forced to move; roughly three quarters of all visitors end up on a new server.
    assert.ok(moved.length >= onRemoved.length);
    assert.ok(moved.length > ips.length / 2, `${moved.length} of ${ips.length} visitors moved`);
  });

  test('least_conn prefers idle members and ties go to the first in the list', () => {
    const b = lib.createBalancer({ algorithm: 'least_conn', members: [member('a'), member('b'), member('c')] });
    assert.deepEqual([b.pick(), b.pick(), b.pick(), b.pick()], ['a', 'b', 'c', 'a']);
    b.done('b');
    b.done('c');
    assert.equal(b.pick(), 'b', 'an idle member is preferred over a busy one');
  });

  test('least_conn divides load by weight', () => {
    const b = lib.createBalancer({ algorithm: 'least_conn', members: [member('a', 2), member('b', 1)] });
    assert.deepEqual([b.pick(), b.pick(), b.pick()], ['a', 'b', 'a']);
  });

  test('standby takes visits only when every active member is unhealthy', () => {
    const b = lib.createBalancer({ algorithm: 'weighted', members: [member('a', 1, 'active', true), member('s', 1, 'standby', true)] });
    const seen = new Set(Array.from({ length: 1000 }, () => b.pick()));
    assert.deepEqual([...seen], ['a']);
    b.setMembers([member('a', 1, 'active', false), member('s', 1, 'standby', true)]);
    const after = new Set(Array.from({ length: 100 }, () => b.pick()));
    assert.deepEqual([...after], ['s']);
  });

  test('drain members never get new visits', () => {
    const r = lib.simulateTraffic({
      algorithm: 'round_robin', members: [member('a'), member('b'), member('d', 1, 'drain')], requests: 1000,
    });
    assert.equal(r.distribution.find((d) => d.memberId === 'd').picked, 0);
  });

  test('sticky keys keep their member while it stays eligible', () => {
    const members = [member('a'), member('b'), member('c')];
    const b = lib.createBalancer({ algorithm: 'round_robin', sticky: true, members });
    const first = b.pick({ key: 'visitor-1' });
    for (let i = 0; i < 20; i += 1) assert.equal(b.pick({ key: 'visitor-1' }), first);
    const others = new Set(Array.from({ length: 3 }, (_, i) => b.pick({ key: `other-${i}` })));
    assert.equal(others.size, 3, 'other keys still rotate');
    // Take the pinned member out: the key moves once, then stays on its new member.
    b.setMembers(members.map((m) => (m.id === first ? { ...m, healthy: false } : m)));
    const moved = b.pick({ key: 'visitor-1' });
    assert.notEqual(moved, first);
    for (let i = 0; i < 10; i += 1) assert.equal(b.pick({ key: 'visitor-1' }), moved);
  });

  test('sticky map keeps recently used keys when it is full', () => {
    const b = lib.createBalancer({ algorithm: 'round_robin', sticky: true, members: [member('a'), member('b'), member('c')] });
    const keeper = b.pick({ key: 'keeper' });
    for (let i = 0; i < 6000; i += 1) {
      b.pick({ key: `other-${i}` });
      if (i % 100 === 0) assert.equal(b.pick({ key: 'keeper' }), keeper);
    }
    assert.equal(b.pick({ key: 'keeper' }), keeper);
  });

  test('pick returns null when nothing is eligible', () => {
    const b = lib.createBalancer({ algorithm: 'round_robin', members: [member('d', 1, 'drain')] });
    assert.equal(b.pick(), null);
    assert.deepEqual(lib.eligibleMembers([member('d', 1, 'drain')]), []);
  });

  test('eligibleMembers: healthy actives, else healthy standbys, never drain', () => {
    const ids = (list) => lib.eligibleMembers(list).map((m) => m.id);
    assert.deepEqual(ids([member('a'), member('b', 1, 'active', false), member('s', 1, 'standby')]), ['a']);
    assert.deepEqual(ids([member('a', 1, 'active', false), member('s', 1, 'standby')]), ['s']);
    assert.deepEqual(ids([member('a', 1, 'active', false), member('s', 1, 'standby', false)]), []);
  });

  test('simulateTraffic is deterministic for a seed and reports skew', () => {
    const members = [member('a', 3), member('b', 2), member('c', 1)];
    const x = lib.simulateTraffic({ algorithm: 'random_two', members, requests: 500, seed: 42 });
    const y = lib.simulateTraffic({ algorithm: 'random_two', members, requests: 500, seed: 42 });
    assert.deepEqual(x, y);
    assert.ok(x.maxSkew >= 0);
  });

  test('unknown algorithm is refused', () => {
    assert.throws(() => lib.createBalancer({ algorithm: 'magic', members: [member('a')] }), /Unknown balancing method/);
  });
});

/* ---------- nginx output and weights ---------- */

describe('nginxConfig and validateWeights', () => {
  const base = { name: 'Tidewater', domain: 'tidewater.example', algorithm: 'weighted', serverName: 'ldn-web-01' };
  const members = [
    { address: '192.0.2.10:80', weight: 3, role: 'active' },
    { address: '192.0.2.11:80', weight: 2, role: 'active' },
    { address: '192.0.2.12:80', weight: 1, role: 'standby' },
    { address: '192.0.2.13:80', weight: 1, role: 'drain' },
  ];

  test('braces balance and every member appears exactly once', () => {
    const text = lib.nginxConfig({ ...base, members });
    assert.equal(count(text, '{'), count(text, '}'));
    for (const m of members) assert.equal(count(text, `server ${m.address} `), 1, m.address);
    assert.match(text, /^# Generated by LRWeb Console$/m);
    assert.match(text, /^upstream lrweb_tidewater \{$/m);
    assert.match(text, /proxy_pass http:\/\/lrweb_tidewater;/);
    assert.match(text, /server_name tidewater\.example;/);
    assert.match(text, /proxy_next_upstream error timeout http_502 http_503 http_504;/);
  });

  test('roles map to plain, backup and down lines', () => {
    const text = lib.nginxConfig({ ...base, members });
    assert.match(text, /server 192\.0\.2\.10:80 weight=3 max_fails=3 fail_timeout=10s;/);
    assert.match(text, /server 192\.0\.2\.12:80 weight=1 max_fails=3 fail_timeout=10s backup;/);
    assert.match(text, /server 192\.0\.2\.13:80 weight=1 max_fails=3 fail_timeout=10s down;/);
  });

  test('round_robin writes weight=1 everywhere; least_conn keeps weights; sticky becomes ip_hash', () => {
    const rr = lib.nginxConfig({ ...base, algorithm: 'round_robin', members });
    assert.doesNotMatch(rr, /weight=[23]/);
    const lc = lib.nginxConfig({ ...base, algorithm: 'least_conn', members });
    assert.match(lc, /^ {4}least_conn;$/m);
    assert.match(lc, /weight=3/);
    const sticky = lib.nginxConfig({ ...base, algorithm: 'least_conn', sticky: true, members });
    assert.match(sticky, /^ {4}ip_hash;$/m);
    assert.match(sticky, /Sticky visitors: open-source nginx cannot pin visitors with a cookie/);
    assert.match(lib.nginxConfig({ ...base, algorithm: 'random_two', members }), /random two least_conn;/);
  });

  test('hostile addresses are refused, not written', () => {
    const hostile = [
      '192.0.2.10:80; rm -rf /',
      '192.0.2.10:80\nserver evil.example:1;',
      '192.0.2.10:80 }',
      '192.0.2.10:0',
      '192.0.2.10:70000',
      '999.1.1.1:80',
      '192.0.2.10',
      'exa mple.com:80',
    ];
    for (const address of hostile) {
      assert.throws(
        () => lib.nginxConfig({ ...base, members: [{ address, weight: 1, role: 'active' }] }),
        /address is not valid/,
        JSON.stringify(address),
      );
    }
  });

  test('hostile domains, server names and health paths are refused', () => {
    const one = [{ address: '192.0.2.10:80', weight: 1, role: 'active' }];
    for (const domain of ['tidewater.example; rm -rf /', 'tidewater.example\nlocation / {', 'tidewater.example{}', 'localhost']) {
      assert.throws(() => lib.nginxConfig({ ...base, domain, members: one }), /valid domain/, JSON.stringify(domain));
    }
    assert.throws(() => lib.nginxConfig({ ...base, serverName: 'ldn\n}', members: one }), /entry server name/);
    assert.throws(() => lib.nginxConfig({ ...base, healthCheck: { path: '/x; rm' }, members: one }), /health check path/);
  });

  test('the pool name is reduced to a safe upstream name', () => {
    const text = lib.nginxConfig({ ...base, name: 'x; rm -rf / {}', members: [{ address: '192.0.2.10:80', weight: 1, role: 'active' }] });
    assert.match(text, /^upstream lrweb_x_rm_rf \{$/m);
    assert.throws(() => lib.nginxConfig({ ...base, name: '!!!', members: [{ address: '192.0.2.10:80', weight: 1, role: 'active' }] }), /letters or numbers/);
  });

  test('at least one active member is required in the config', () => {
    assert.throws(
      () => lib.nginxConfig({ ...base, members: [{ address: '192.0.2.10:80', weight: 1, role: 'standby' }] }),
      /Pick at least one active server/,
    );
  });

  test('generated text has no em dashes', () => {
    assert.ok(!lib.nginxConfig({ ...base, members }).includes(EM_DASH));
    const problems = lib.validateWeights([{ name: 'x', weight: 0 }]);
    assert.ok(!problems.join('').includes(EM_DASH));
  });

  test('validateWeights flags weights outside 1-100 or not whole numbers', () => {
    assert.deepEqual(lib.validateWeights([{ id: 'a', weight: 1 }, { id: 'b', weight: 100 }]), []);
    const problems = lib.validateWeights([
      { id: 'a', weight: 0 }, { id: 'b', weight: 101 }, { id: 'c', weight: 1.5 }, { id: 'd', weight: '3' }, { id: 'e' },
    ]);
    assert.equal(problems.length, 5);
    assert.match(problems[0], /Weights must be whole numbers from 1 to 100/);
  });
});

/* ---------- pool CRUD ---------- */

describe('pool create, update and delete', () => {
  test('creates a pool and returns it with member stats and a derived status', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody());
    assert.equal(pool.name, 'Shop');
    assert.equal(pool.mode, 'balanced');
    assert.equal(pool.status, 'healthy');
    assert.equal(pool.members.length, 3);
    assert.ok(pool.id.startsWith('lbp_'));
    assert.deepEqual(pool.healthCheck, { path: '/', intervalSec: 10, timeoutSec: 3, unhealthyThreshold: 3, healthyThreshold: 2, expectStatus: 200 });
    const dub = pool.members.find((m) => m.serverId === 'srv_dub1');
    assert.equal(dub.status, 'healthy');
    assert.equal(dub.role, 'standby');
    assert.ok(dub.p95ms > pool.members[0].p95ms, 'degraded server reports a higher p95');
  });

  test('rejects bad input with plain-English messages and the right field', async () => {
    const { lb } = setup();
    const member1 = (over) => [{ serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 1, role: 'active', ...over }];
    const cases = [
      [{ name: '   ' }, 'name', 'Give the pool a name'],
      [{ name: 'x'.repeat(61) }, 'name', 'The name must be 60 characters or fewer'],
      [{ domain: 'not a domain' }, 'domain', 'Enter a valid domain such as example.com'],
      [{ algorithm: 'magic' }, 'algorithm', 'Pick a balancing method'],
      [{ members: [] }, 'members', 'Add between 1 and 12 servers'],
      [{ members: Array.from({ length: 13 }, () => member1()[0]) }, 'members', 'Add between 1 and 12 servers'],
      [{ members: [{ serverId: 'srv_nope', address: '192.0.2.10:80', weight: 1 }] }, 'members', 'knows about'],
      [{ members: member1({ address: '192.0.2.10' }) }, 'members', 'must look like host:port'],
      [{ members: member1({ address: '192.0.2.10:80; rm -rf /' }) }, 'members', 'must look like host:port'],
      [{ members: member1({ weight: 0 }) }, 'members', 'Weights must be whole numbers from 1 to 100'],
      [{ members: member1({ weight: 101 }) }, 'members', 'Weights must be whole numbers from 1 to 100'],
      [{ members: member1({ role: 'boss' }) }, 'members', 'role must be active, standby or drain'],
      [{ members: member1({ role: 'standby' }) }, 'members', 'Pick at least one active server'],
      [{ members: member1({ extra: 1 }) }, 'extra', 'Unknown field "extra"'],
      [{ members: [member1()[0], member1()[0]] }, 'members', 'more than once'],
      [{ serverId: 'srv_nope' }, 'serverId', 'Pick the server that will run the load balancer'],
      [{ sticky: 'yes' }, 'sticky', 'Sticky must be on or off'],
      [{ healthCheck: { path: 'no-slash' } }, 'healthCheck', 'health check path must start with /'],
      [{ healthCheck: { intervalSec: 3 } }, 'healthCheck', 'interval must be a whole number of seconds from 5 to 300'],
      [{ owner: 'someone' }, 'owner', 'Unknown field "owner"'],
    ];
    for (const [patch, field, message] of cases) {
      await rejects(lb.createPool(goodBody(patch)), { field, message }).catch((e) => { throw new Error(`${JSON.stringify(patch)}: ${e.message}`); });
    }
    await assert.rejects(lb.createPool('nope'), ValidationError);
  });

  test('a domain already used by another pool is a 409', async () => {
    const { lb } = setup();
    await lb.createPool(goodBody());
    await rejects(lb.createPool(goodBody({ name: 'Other' })), { field: 'domain', status: 409, message: 'already uses shop.example' });
  });

  test('update keeps failover only while its target stays active', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody());
    const ldn = pool.members.find((m) => m.serverId === 'srv_ldn1');
    const man = pool.members.find((m) => m.serverId === 'srv_man1');
    const dub = pool.members.find((m) => m.serverId === 'srv_dub1');
    await lb.switchTo(pool.id, dub.id, { mode: 'instant' }); // no job: the default stub is used
    const failover = await lb.getPool(pool.id);
    assert.equal(failover.mode, 'failover');
    assert.equal(failover.activeMemberId, dub.id);

    // Changing weights while the target stays active keeps failover.
    const kept = await lb.updatePool(pool.id, {
      members: [
        { id: ldn.id, serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 5, role: 'standby' },
        { id: man.id, serverId: 'srv_man1', address: '192.0.2.11:80', weight: 2, role: 'standby' },
        { id: dub.id, serverId: 'srv_dub1', address: '192.0.2.12:80', weight: 1, role: 'active' },
      ],
    });
    assert.equal(kept.mode, 'failover');
    assert.equal(kept.activeMemberId, dub.id);

    // Making someone else the only active server drops failover.
    const dropped = await lb.updatePool(pool.id, {
      members: [
        { id: ldn.id, serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 3, role: 'active' },
        { id: dub.id, serverId: 'srv_dub1', address: '192.0.2.12:80', weight: 1, role: 'standby' },
      ],
    });
    assert.equal(dropped.mode, 'balanced');
    assert.equal('activeMemberId' in dropped, false);

    await rejects(lb.updatePool(pool.id, { members: [] }), { field: 'members' });
    await rejects(lb.updatePool(pool.id, { members: [{ id: ldn.id, serverId: 'srv_man1', address: '192.0.2.11:80', weight: 1 }] }), { field: 'members', message: 'does not match' });
    await rejects(lb.updatePool(pool.id, { bogus: true }), { field: 'bogus' });
    await rejects(lb.updatePool('lbp_missing', {}), { status: 404 });
    const renamed = await lb.updatePool(pool.id, { name: 'Renamed', healthCheck: { intervalSec: 20 } });
    assert.equal(renamed.name, 'Renamed');
    assert.equal(renamed.healthCheck.intervalSec, 20);
    assert.equal(renamed.healthCheck.timeoutSec, 3, 'partial health check merges with the saved one');
  });

  test('delete removes the pool; unknown ids are 404', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody());
    await lb.deletePool(pool.id);
    assert.equal((await lb.listPools()).length, 0);
    await rejects(lb.getPool(pool.id), { status: 404 });
    await rejects(lb.deletePool(pool.id), { status: 404 });
  });
});

/* ---------- health and status ---------- */

describe('member and pool status', () => {
  test('online is healthy, degraded is healthy with a higher p95, offline is unhealthy, pending is unknown, drain is draining', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody({
      members: [
        { serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 1, role: 'active' },
        { serverId: 'srv_off1', address: '192.0.2.77:80', weight: 1, role: 'standby' },
        { serverId: 'srv_stg1', address: '192.0.2.55:80', weight: 1, role: 'standby' },
        { serverId: 'srv_man1', address: '192.0.2.11:80', weight: 1, role: 'active' },
      ],
    }));
    const by = (sid) => pool.members.find((m) => m.serverId === sid);
    assert.equal(by('srv_ldn1').status, 'healthy');
    assert.equal(by('srv_off1').status, 'unhealthy');
    assert.equal(by('srv_stg1').status, 'unknown');
    const drained = await lb.drain(pool.id, by('srv_man1').id);
    assert.equal(drained.members.find((m) => m.serverId === 'srv_man1').status, 'draining');
  });

  test('pool status is healthy, degraded, then down as servers fail', async () => {
    const { lb, setStatus } = setup();
    const pool = await lb.createPool(goodBody());
    assert.equal((await lb.getPool(pool.id)).status, 'healthy');
    setStatus('srv_man1', 'offline');
    assert.equal((await lb.getPool(pool.id)).status, 'degraded', 'an active member is down, the other is not');
    setStatus('srv_ldn1', 'offline');
    assert.equal((await lb.getPool(pool.id)).status, 'degraded', 'the healthy standby is taking visits');
    setStatus('srv_dub1', 'offline');
    assert.equal((await lb.getPool(pool.id)).status, 'down');
  });

  test('draining the last active server is refused', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody());
    const ldn = pool.members.find((m) => m.serverId === 'srv_ldn1');
    const man = pool.members.find((m) => m.serverId === 'srv_man1');
    const after = await lb.drain(pool.id, man.id);
    assert.equal(after.members.find((m) => m.id === man.id).role, 'drain');
    await rejects(lb.drain(pool.id, ldn.id), { status: 409, message: 'Pick another active server first' });
    await rejects(lb.drain(pool.id, 'mem_missing'), { status: 404 });
  });
});

/* ---------- traffic and config ---------- */

describe('simulated traffic and config', () => {
  test('traffic has 60 minute points, shares sum to 1 and totals match the series', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody({
      members: [
        { serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 3, role: 'active' },
        { serverId: 'srv_man1', address: '192.0.2.11:80', weight: 2, role: 'active' },
      ],
    }));
    const t = await lb.traffic(pool.id);
    assert.equal(t.labels.length, 60);
    assert.equal(t.labels.at(-1), new Date(Math.floor(NOW / 60000) * 60000).toISOString());
    assert.equal(t.simulated, true);
    assert.equal(t.series.length, 2);
    for (const s of t.series) assert.equal(s.rps.length, 60);
    const shareSum = t.distribution.reduce((s, d) => s + d.share, 0);
    assert.ok(Math.abs(shareSum - 1) < 0.001, `shares sum to ${shareSum}`);
    const ldn = t.distribution.find((d) => d.name === 'ldn-web-01');
    assert.ok(Math.abs(ldn.share - 0.6) < 0.01, `weights 3:2 give ${ldn.share}`);
    const meanTotal = t.series.reduce((s, series) => s + series.rps.reduce((a, b) => a + b, 0) / 60, 0);
    assert.ok(Math.abs(meanTotal - t.totals.rps) < 0.2, `series means ${meanTotal} vs totals ${t.totals.rps}`);
    assert.deepEqual(await lb.traffic(pool.id), t, 'the same minute gives the same numbers');
  });

  test('an offline server gets no simulated visits', async () => {
    const { lb, setStatus } = setup();
    const pool = await lb.createPool(goodBody({
      members: [
        { serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 1, role: 'active' },
        { serverId: 'srv_man1', address: '192.0.2.11:80', weight: 1, role: 'active' },
      ],
    }));
    setStatus('srv_man1', 'offline');
    const t = await lb.traffic(pool.id);
    const man = t.series.find((s) => s.name === 'man-web-01');
    assert.ok(man.rps.every((v) => v === 0));
    assert.equal(t.distribution.find((d) => d.name === 'ldn-web-01').share, 1);
  });

  test('config generates nginx text and notes say it is not applied and traffic is simulated', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody());
    const c = await lb.config(pool.id);
    assert.match(c.nginx, /^upstream lrweb_shop \{$/m);
    assert.equal(count(c.nginx, '{'), count(c.nginx, '}'));
    const notes = c.notes.join(' ');
    assert.match(notes, /generates the nginx setup/);
    assert.match(notes, /does not push it to any server/);
    assert.match(notes, /simulated/);
    assert.match(notes, /not measured from real visitors/);
    assert.match(notes, /CloudPanel has no API/);
  });
});

/* ---------- switching and drills (jobs) ---------- */

describe('switchTo and drill', () => {
  async function runRoute(world, method, path, params, body) {
    const job = await world.route(method, path)({ params, body });
    return finish(world.jobs, job.id);
  }

  test('a successful switch makes the target the only active server and saves failover', async () => {
    const world = setup();
    const pool = await world.lb.createPool(goodBody());
    const dub = pool.members.find((m) => m.serverId === 'srv_dub1');
    const job = await runRoute(world, 'POST', '/api/lb/pools/:id/switch', { id: pool.id }, { toMemberId: dub.id, mode: 'instant' });
    assert.equal(job.kind, 'lb.switch');
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(job.steps.map((s) => s.key), ['preflight', 'warmup', 'shift', 'verify', 'finalize']);
    assert.ok(job.steps.every((s) => s.status === 'done'));
    const after = await world.lb.getPool(pool.id);
    assert.equal(after.mode, 'failover');
    assert.equal(after.activeMemberId, dub.id);
    assert.equal(after.members.find((m) => m.id === dub.id).role, 'active');
    assert.equal(after.members.filter((m) => m.role === 'standby').length, 2);
    const t = await world.lb.traffic(pool.id);
    assert.equal(t.distribution.find((d) => d.memberId === dub.id).share, 1);
  });

  test('a preflight failure leaves the stored pool exactly as it was', async () => {
    const world = setup();
    const pool = await world.lb.createPool(goodBody());
    world.setStatus('srv_dub1', 'offline');
    const dub = pool.members.find((m) => m.serverId === 'srv_dub1');
    const before = world.store.get('pools', pool.id);
    const job = await runRoute(world, 'POST', '/api/lb/pools/:id/switch', { id: pool.id }, { toMemberId: dub.id });
    assert.equal(job.status, 'failed');
    assert.equal(job.steps[0].status, 'failed');
    assert.match(job.error, /Cannot move visitors yet/);
    assert.match(job.error, /dub-web-01 is not responding/);
    assert.match(job.error, /Nothing has changed|still on the current server/);
    assert.deepEqual(world.store.get('pools', pool.id), before);
  });

  test('a server being drained cannot be switched to', async () => {
    const world = setup();
    const pool = await world.lb.createPool(goodBody());
    const dub = pool.members.find((m) => m.serverId === 'srv_dub1');
    await world.lb.drain(pool.id, dub.id);
    const job = await runRoute(world, 'POST', '/api/lb/pools/:id/switch', { id: pool.id }, { toMemberId: dub.id });
    assert.equal(job.status, 'failed');
    assert.match(job.error, /being drained, so it cannot take visitors/);
  });

  test('switch input is checked before a job starts', async () => {
    const world = setup();
    const pool = await world.lb.createPool(goodBody());
    const switchRoute = world.route('POST', '/api/lb/pools/:id/switch');
    await rejects(switchRoute({ params: { id: pool.id }, body: { toMemberId: 'mem_nope' } }), { field: 'toMemberId' });
    await rejects(switchRoute({ params: { id: pool.id }, body: { toMemberId: pool.members[0].id, mode: 'fast' } }), { field: 'mode' });
    await rejects(switchRoute({ params: { id: pool.id }, body: { toMemberId: pool.members[0].id, extra: 1 } }), { field: 'extra' });
    await rejects(switchRoute({ params: { id: 'lbp_missing' }, body: { toMemberId: 'x' } }), { status: 404 });
  });

  test('a second move on the same pool is refused while the first is running', async () => {
    const world = setup({ demoDelayMs: 20 });
    const pool = await world.lb.createPool(goodBody());
    const [ldn, man, dub] = ['srv_ldn1', 'srv_man1', 'srv_dub1'].map((sid) => pool.members.find((m) => m.serverId === sid));
    const first = await world.route('POST', '/api/lb/pools/:id/switch')({ params: { id: pool.id }, body: { toMemberId: dub.id, mode: 'gradual' } });
    const second = await world.route('POST', '/api/lb/pools/:id/switch')({ params: { id: pool.id }, body: { toMemberId: ldn.id, mode: 'instant' } });
    assert.equal((await finish(world.jobs, second.id)).status, 'failed');
    assert.match(world.jobs.get(second.id).error, /Another move for this pool is still running/);
    assert.equal((await finish(world.jobs, first.id)).status, 'done');
    assert.equal((await world.lb.getPool(pool.id)).activeMemberId, dub.id);
    assert.ok(man, 'the middle server exists in the pool');
  });

  test('a gradual switch waits between stages', async () => {
    const world = setup({ demoDelayMs: 20 });
    const pool = await world.lb.createPool(goodBody());
    const dub = pool.members.find((m) => m.serverId === 'srv_dub1');
    const t0 = Date.now();
    const job = await runRoute(world, 'POST', '/api/lb/pools/:id/switch', { id: pool.id }, { toMemberId: dub.id, mode: 'gradual' });
    assert.equal(job.status, 'done', job.error);
    assert.ok(Date.now() - t0 >= 60, 'warm-up plus three gaps between the four stages');
    assert.match(job.steps.find((s) => s.key === 'shift').detail, /All visitors now go to/);
  });

  test('a drill succeeds and never changes stored state', async () => {
    const world = setup();
    const pool = await world.lb.createPool(goodBody());
    const before = world.store.get('pools', pool.id);
    const job = await runRoute(world, 'POST', '/api/lb/pools/:id/drill', { id: pool.id });
    assert.equal(job.kind, 'lb.drill');
    assert.equal(job.status, 'done', job.error);
    assert.deepEqual(job.steps.map((s) => s.key), ['pick', 'fail', 'takeover', 'restore']);
    assert.equal(job.result.changedStoredState, false);
    assert.equal(job.result.simulated, true);
    // ldn-web-01 has the most weight among the healthy actives, so it is the one tested. Its visitors
    // move to the other active server; the standby is only used when no active server is healthy.
    assert.equal(job.result.testedServer, 'ldn-web-01');
    assert.deepEqual(job.result.takeoverServers, ['man-web-01']);
    assert.deepEqual(world.store.get('pools', pool.id), before);
  });

  test('a drill with no other healthy server fails and changes nothing', async () => {
    const world = setup();
    const pool = await world.lb.createPool(goodBody({
      members: [{ serverId: 'srv_ldn1', address: '192.0.2.10:80', weight: 1, role: 'active' }],
    }));
    const before = world.store.get('pools', pool.id);
    const job = await runRoute(world, 'POST', '/api/lb/pools/:id/drill', { id: pool.id });
    assert.equal(job.status, 'failed');
    assert.match(job.error, /no healthy server would take its visitors/);
    assert.deepEqual(world.store.get('pools', pool.id), before);
  });

  test('routes cover the section 5 table', () => {
    const { route } = setup();
    const routes = lbRoutes({ lb: {}, jobs: {} }).map((r) => `${r.method} ${r.path}`);
    for (const expected of [
      'GET /api/lb/pools', 'POST /api/lb/pools', 'GET /api/lb/pools/:id', 'PUT /api/lb/pools/:id',
      'DELETE /api/lb/pools/:id', 'GET /api/lb/pools/:id/traffic', 'GET /api/lb/pools/:id/config',
      'POST /api/lb/pools/:id/members/:mid/drain', 'POST /api/lb/pools/:id/switch', 'POST /api/lb/pools/:id/drill',
    ]) assert.ok(routes.includes(expected), expected);
    assert.equal(typeof route('GET', '/api/lb/pools/:id/traffic'), 'function');
  });
});

/* ---------- seed ---------- */

describe('seedPools', () => {
  function storeWithDemoServers() {
    const store = createStore({ memory: true });
    store.insert('servers', { id: 'srv_ldn1', name: 'ldn-web-01', host: '192.0.2.10', status: 'online' });
    store.insert('servers', { id: 'srv_man1', name: 'man-web-01', host: '192.0.2.11', status: 'online' });
    store.insert('servers', { id: 'srv_dub1', name: 'dub-web-01', host: '192.0.2.12', status: 'degraded' });
    return store;
  }

  test('seeds lbp_main once and is idempotent', () => {
    const store = storeWithDemoServers();
    assert.equal(seedPools(store, NOW), true);
    assert.equal(seedPools(store, NOW), false);
    const pools = store.all('pools');
    assert.equal(pools.length, 1);
    const seeded = pools[0];
    assert.equal(seeded.id, 'lbp_main');
    assert.equal(seeded.domain, 'tidewater.example');
    assert.equal(seeded.algorithm, 'weighted');
    assert.deepEqual(seeded.members.map((m) => [m.serverId, m.weight, m.role]), [
      ['srv_ldn1', 3, 'active'], ['srv_man1', 2, 'active'], ['srv_dub1', 1, 'standby'],
    ]);
  });

  test('does nothing when the demo servers are missing, and is not re-seeded after deletion', () => {
    const empty = createStore({ memory: true });
    assert.equal(seedPools(empty, NOW), false);
    assert.equal(empty.all('pools').length, 0);

    const store = storeWithDemoServers();
    seedPools(store, NOW);
    store.remove('pools', 'lbp_main');
    assert.equal(seedPools(store, NOW), false, 'a deleted demo pool stays deleted');
  });
});

describe('style', () => {
  test('no em dashes in any generated text', async () => {
    const { lb } = setup();
    const pool = await lb.createPool(goodBody());
    const c = await lb.config(pool.id);
    assert.ok(!c.notes.join(' ').includes(EM_DASH));
    assert.ok(!c.nginx.includes(EM_DASH));
    for (const a of lib.ALGORITHMS) {
      assert.ok(!a.label.includes(EM_DASH) && !a.description.includes(EM_DASH) && !a.hint.includes(EM_DASH));
    }
  });
});
