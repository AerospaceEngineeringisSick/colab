import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../index.mjs';
import { loadConfig } from '../config.mjs';
import { createStore } from '../store.mjs';
import { seedIfEmpty } from '../seed.mjs';
import { createJobs } from '../jobs.mjs';
import { createCloudPanel } from '../adapters/cloudpanel.mjs';
import { createBilling } from '../adapters/billing.mjs';

const TOKEN = 'test-token-0123456789abcdef';

async function boot(env = {}) {
  const config = loadConfig({ LRWEB_DEMO_DELAY_MS: '0', ...env });
  const store = createStore({ memory: true });
  seedIfEmpty(store);
  const services = { config, store, cloudpanel: createCloudPanel({ config, store }), billing: createBilling({ config, store }), jobs: createJobs({ store }) };
  const server = http.createServer(createApp(services));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body = method === 'POST' ? {} : undefined, token, headers = {} } = {}) => {
    // Like the browser client, POSTs always carry a JSON body.
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* static asset */ }
    return { status: res.status, headers: res.headers, json, text };
  };
  const finish = async (id, token) => {
    for (let i = 0; i < 100; i++) {
      const { json } = await call('GET', `/api/jobs/${id}`, { token });
      if (json.data.status === 'done' || json.data.status === 'failed') return json.data;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('job did not finish');
  };
  return { call, finish, store, base, close: () => new Promise((r) => server.close(r)) };
}

describe('API (mock mode)', () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t.close());

  test('health and meta', async () => {
    const h = await t.call('GET', '/api/health');
    assert.equal(h.status, 200);
    assert.equal(h.json.data.integrations.cloudpanel.mode, 'mock');
    assert.equal(h.json.data.authRequired, false);
    const m = await t.call('GET', '/api/meta');
    assert.ok(m.json.data.phpVersions.includes('8.3'));
  });

  test('overview has KPIs, 12 revenue months and activity', async () => {
    const { json } = await t.call('GET', '/api/overview');
    const o = json.data;
    assert.equal(o.kpis.servers.total, 4);
    assert.equal(o.revenue.length, 12);
    assert.ok(o.kpis.mrrCents > 0);
    assert.ok(o.activity.length > 0 && o.activity.length <= 8);
  });

  test('servers list carries site counts and metrics; pending server has none', async () => {
    const { json } = await t.call('GET', '/api/servers');
    const ldn = json.data.find((s) => s.id === 'srv_ldn1');
    assert.ok(ldn.siteCount > 0);
    assert.ok(ldn.metrics.cpu >= 0);
    assert.equal(json.data.find((s) => s.id === 'srv_stg1').metrics, undefined);
  });

  test('validation errors are 400 with the offending field', async () => {
    const r = await t.call('POST', '/api/servers', { body: { name: 'x', host: 'not a host!', os: 'ubuntu-24.04' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, 'host');
    const s = await t.call('POST', '/api/sites', { body: { serverId: 'srv_ldn1', domain: 'bad domain;rm -rf /', type: 'php' } });
    assert.equal(s.status, 400);
    assert.equal(s.json.error.field, 'domain');
  });

  test('site.create job runs to completion and releases secrets exactly once', async () => {
    const r = await t.call('POST', '/api/sites', { body: { serverId: 'srv_ldn1', domain: 'qa-one.example.com', type: 'php', createDatabase: true, issueCertificate: true } });
    assert.equal(r.status, 200);
    const first = await t.finish(r.json.data.id);
    assert.equal(first.status, 'done');
    assert.ok(first.steps.every((s) => ['done', 'skipped'].includes(s.status)));
    assert.match(first.secrets.siteUserPassword, /^[A-Za-z0-9]{16,}$/);
    assert.ok(first.secrets.dbPassword);
    const again = await t.call('GET', `/api/jobs/${r.json.data.id}`);
    assert.equal(again.json.data.secrets, undefined);
    const sites = await t.call('GET', '/api/sites?serverId=srv_ldn1');
    assert.ok(sites.json.data.some((s) => s.domain === 'qa-one.example.com' && s.status === 'active'));
    // passwords never reach the persisted store
    assert.ok(!JSON.stringify(t.store.all('jobs')).includes(first.secrets.siteUserPassword));
    const dup = await t.call('POST', '/api/sites', { body: { serverId: 'srv_ldn1', domain: 'qa-one.example.com', type: 'static' } });
    assert.equal(dup.status, 409);
  });

  test('cannot provision onto a pending server', async () => {
    const r = await t.call('POST', '/api/sites', { body: { serverId: 'srv_stg1', domain: 'nowhere.example.com', type: 'static' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'server_not_ready');
  });

  test('client onboarding creates client, subscription, invoice and site', async () => {
    const r = await t.call('POST', '/api/onboard/client', { body: {
      client: { name: 'Ada Lovelace', email: 'ada@analytical.example', company: 'Analytical Engines' }, planId: 'plan_plus',
      site: { serverId: 'srv_man1', domain: 'analytical.example.com', type: 'nodejs', appPort: 3100 },
    } });
    assert.equal(r.status, 200);
    const job = await t.finish(r.json.data.id);
    assert.equal(job.status, 'done', job.error);
    assert.ok(job.result.clientId && job.result.siteId && job.result.invoiceId);
    const c = await t.call('GET', `/api/clients/${job.result.clientId}`);
    assert.equal(c.json.data.status, 'active');
    assert.equal(c.json.data.sites.length, 1);
    assert.ok(c.json.data.invoices.length >= 1);
    const dup = await t.call('POST', '/api/onboard/client', { body: { client: { name: 'Ada Again', email: 'ada@analytical.example' }, planId: 'plan_essential' } });
    assert.equal(dup.status, 409);
  });

  test('server check job brings a pending server online; fail-named servers fail', async () => {
    const r = await t.call('POST', '/api/servers/srv_stg1/check');
    const job = await t.finish(r.json.data.id);
    assert.equal(job.status, 'done');
    assert.equal((await t.call('GET', '/api/servers/srv_stg1')).json.data.status, 'online');
    const reg = await t.call('POST', '/api/servers', { body: { name: 'fail-test', host: '192.0.2.99', os: 'debian-12' } });
    const bad = await t.finish((await t.call('POST', `/api/servers/${reg.json.data.id}/check`)).json.data.id);
    assert.equal(bad.status, 'failed');
    assert.ok(bad.steps.some((s) => s.status === 'failed'));
  });

  test('deleting a server with sites is refused', async () => {
    const r = await t.call('DELETE', '/api/servers/srv_ldn1');
    assert.equal(r.status, 409);
  });

  test('billing: invoices, send, pay', async () => {
    const list = (await t.call('GET', '/api/billing/invoices?status=overdue')).json.data;
    assert.ok(list.length > 0 && list.every((i) => i.status === 'overdue'));
    assert.deepEqual((await t.call('POST', `/api/billing/invoices/${list[0].id}/send`)).json.data, { sent: true });
    const paid = (await t.call('POST', `/api/billing/invoices/${list[0].id}/pay`)).json.data;
    assert.equal(paid.status, 'paid');
  });

  test('clients list is enriched', async () => {
    const { json } = await t.call('GET', '/api/clients');
    const c = json.data.find((x) => x.id === 'cli_tide');
    assert.ok(c.siteCount >= 2 && c.mrrCents === 8900);
  });

  test('guards: unknown route 404, wrong method 405, cross-origin 403, non-JSON 415', async () => {
    assert.equal((await t.call('GET', '/api/nope')).status, 404);
    assert.equal((await t.call('PUT', '/api/health')).status, 405);
    assert.equal((await t.call('POST', '/api/clients', { body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
    const res = await fetch(`${t.base}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(res.status, 415);
  });

  test('static: serves the UI with CSP + compression; blocks path traversal', async () => {
    const res = await fetch(`${t.base}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    const etag = res.headers.get('etag');
    assert.equal((await fetch(`${t.base}/`, { headers: { 'If-None-Match': etag } })).status, 304);
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: new URL(t.base).port, path: '/..%2f..%2fserver%2fconfig.mjs' }, (r) => { r.resume(); resolve(r.statusCode); });
    });
    assert.ok([403, 404].includes(status));
  });
});

describe('API (token auth)', () => {
  let t;
  before(async () => { t = await boot({ LRWEB_ADMIN_TOKEN: TOKEN }); });
  after(() => t.close());

  test('health is public but reports auth; everything else needs the token', async () => {
    assert.equal((await t.call('GET', '/api/health')).json.data.authRequired, true);
    assert.equal((await t.call('GET', '/api/overview')).status, 401);
    assert.equal((await t.call('GET', '/api/overview', { token: 'wrong-token-wrong-token' })).status, 401);
    assert.equal((await t.call('GET', '/api/overview', { token: TOKEN })).status, 200);
  });

  test('repeated failures are rate limited', async () => {
    for (let i = 0; i < 12; i++) await t.call('GET', '/api/servers', { token: `bad-${i}` });
    assert.equal((await t.call('GET', '/api/servers', { token: TOKEN })).status, 429);
  });
});

describe('demo seed (LRWeb identity)', () => {
  const NOW = Date.UTC(2026, 9, 10, 12);
  const DAY = 86_400_000;
  const CARE_PLANS = ['plan_essential', 'plan_plus', 'plan_pro'];
  const seeded = () => {
    const store = createStore({ memory: true });
    seedIfEmpty(store, NOW);
    return store;
  };

  test('four servers with the LRWeb names, statuses and RFC 5737 addresses', () => {
    const servers = seeded().all('servers');
    assert.deepEqual(servers.map((s) => [s.id, s.name, s.status]), [
      ['srv_ldn1', 'ldn-web-01', 'online'],
      ['srv_man1', 'man-web-01', 'online'],
      ['srv_dub1', 'dub-web-01', 'degraded'],
      ['srv_stg1', 'staging-01', 'pending'],
    ]);
    assert.ok(servers.every((s) => s.provider === 'Example Cloud'));
    assert.ok(servers.every((s) => /^(203\.0\.113|198\.51\.100|192\.0\.2)\.\d+$/.test(s.host)), 'documentation addresses only');
    assert.equal(servers.find((s) => s.id === 'srv_stg1').panelVersion, '');
  });

  test('seven made-up clients with the LRWeb statuses, care plans and .example contacts', () => {
    const clients = seeded().all('clients');
    assert.deepEqual(clients.map((c) => c.id).sort(), ['cli_crumb', 'cli_form', 'cli_north', 'cli_petal', 'cli_smith', 'cli_tide', 'cli_volt']);
    const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
    assert.equal(byId.cli_north.status, 'suspended');
    assert.equal(byId.cli_form.status, 'trial');
    assert.ok(clients.filter((c) => !['cli_north', 'cli_form'].includes(c.id)).every((c) => c.status === 'active'));
    assert.ok(clients.every((c) => CARE_PLANS.includes(c.planId)));
    assert.equal(byId.cli_tide.planId, 'plan_pro');
    assert.ok(clients.every((c) => /^cus_[a-z]+$/.test(c.billingCustomerId)));
    assert.ok(clients.every((c) => c.email.endsWith('.example')));
    assert.ok(clients.every((c) => Date.parse(c.createdAt) >= NOW - 245 * DAY && Date.parse(c.createdAt) < NOW), 'joined in the last eight months');
  });

  test('12 to 14 sites whose references resolve, never on the pending server, never before their server or client', () => {
    const store = seeded();
    const sites = store.all('sites');
    assert.ok(sites.length >= 12 && sites.length <= 14);
    const servers = new Map(store.all('servers').map((s) => [s.id, s]));
    const clients = new Map(store.all('clients').map((c) => [c.id, c]));
    assert.ok(sites.every((s) => servers.has(s.serverId) && clients.has(s.clientId)));
    assert.ok(sites.every((s) => s.serverId !== 'srv_stg1'));
    assert.ok(sites.every((s) => Date.parse(s.createdAt) >= Date.parse(servers.get(s.serverId).createdAt)));
    assert.ok(sites.every((s) => Date.parse(s.createdAt) >= Date.parse(clients.get(s.clientId).createdAt)));
    assert.equal(new Set(sites.map((s) => s.domain)).size, sites.length);
    assert.ok(sites.every((s) => s.domain.endsWith('.example')));
    assert.equal(sites.find((s) => s.id === 'sit_tide1').serverId, 'srv_ldn1');
    assert.equal(sites.find((s) => s.id === 'sit_north1').status, 'suspended');
    assert.equal(sites.find((s) => s.domain === 'formandfield.example').ssl, 'pending');
  });

  test('eight plain activity lines, with no em dashes in any demo copy', () => {
    const store = seeded();
    assert.equal(store.all('events').length, 8);
    assert.ok(store.all('events').every((e) => ['client', 'site', 'billing', 'server'].includes(e.kind)));
    const copy = JSON.stringify(['servers', 'clients', 'sites', 'events'].map((c) => store.all(c)));
    assert.ok(!copy.includes('\u2014'));
  });

  test('seeding runs once: a second call changes nothing', () => {
    const store = createStore({ memory: true });
    assert.equal(seedIfEmpty(store, NOW), true);
    const sites = store.all('sites').length;
    assert.equal(seedIfEmpty(store, NOW), false);
    assert.equal(store.all('servers').length, 4);
    assert.equal(store.all('sites').length, sites);
  });
});
