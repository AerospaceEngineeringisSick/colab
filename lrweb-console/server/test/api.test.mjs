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
    const nyc = json.data.find((s) => s.id === 'srv_nyc1');
    assert.ok(nyc.siteCount > 0);
    assert.ok(nyc.metrics.cpu >= 0);
    assert.equal(json.data.find((s) => s.id === 'srv_lon1').metrics, undefined);
  });

  test('validation errors are 400 with the offending field', async () => {
    const r = await t.call('POST', '/api/servers', { body: { name: 'x', host: 'not a host!', os: 'ubuntu-24.04' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.field, 'host');
    const s = await t.call('POST', '/api/sites', { body: { serverId: 'srv_nyc1', domain: 'bad domain;rm -rf /', type: 'php' } });
    assert.equal(s.status, 400);
    assert.equal(s.json.error.field, 'domain');
  });

  test('site.create job runs to completion and releases secrets exactly once', async () => {
    const r = await t.call('POST', '/api/sites', { body: { serverId: 'srv_nyc1', domain: 'qa-one.example.com', type: 'php', createDatabase: true, issueCertificate: true } });
    assert.equal(r.status, 200);
    const first = await t.finish(r.json.data.id);
    assert.equal(first.status, 'done');
    assert.ok(first.steps.every((s) => ['done', 'skipped'].includes(s.status)));
    assert.match(first.secrets.siteUserPassword, /^[A-Za-z0-9]{16,}$/);
    assert.ok(first.secrets.dbPassword);
    const again = await t.call('GET', `/api/jobs/${r.json.data.id}`);
    assert.equal(again.json.data.secrets, undefined);
    const sites = await t.call('GET', '/api/sites?serverId=srv_nyc1');
    assert.ok(sites.json.data.some((s) => s.domain === 'qa-one.example.com' && s.status === 'active'));
    // passwords never reach the persisted store
    assert.ok(!JSON.stringify(t.store.all('jobs')).includes(first.secrets.siteUserPassword));
    const dup = await t.call('POST', '/api/sites', { body: { serverId: 'srv_nyc1', domain: 'qa-one.example.com', type: 'static' } });
    assert.equal(dup.status, 409);
  });

  test('cannot provision onto a pending server', async () => {
    const r = await t.call('POST', '/api/sites', { body: { serverId: 'srv_lon1', domain: 'nowhere.example.com', type: 'static' } });
    assert.equal(r.status, 409);
    assert.equal(r.json.error.code, 'server_not_ready');
  });

  test('client onboarding creates client, subscription, invoice and site', async () => {
    const r = await t.call('POST', '/api/onboard/client', { body: {
      client: { name: 'Ada Lovelace', email: 'ada@analytical.example', company: 'Analytical Engines' }, planId: 'plan_business',
      site: { serverId: 'srv_fra1', domain: 'analytical.example.com', type: 'nodejs', appPort: 3100 },
    } });
    assert.equal(r.status, 200);
    const job = await t.finish(r.json.data.id);
    assert.equal(job.status, 'done', job.error);
    assert.ok(job.result.clientId && job.result.siteId && job.result.invoiceId);
    const c = await t.call('GET', `/api/clients/${job.result.clientId}`);
    assert.equal(c.json.data.status, 'active');
    assert.equal(c.json.data.sites.length, 1);
    assert.ok(c.json.data.invoices.length >= 1);
    const dup = await t.call('POST', '/api/onboard/client', { body: { client: { name: 'Ada Again', email: 'ada@analytical.example' }, planId: 'plan_starter' } });
    assert.equal(dup.status, 409);
  });

  test('server check job brings a pending server online; fail-named servers fail', async () => {
    const r = await t.call('POST', '/api/servers/srv_lon1/check');
    const job = await t.finish(r.json.data.id);
    assert.equal(job.status, 'done');
    assert.equal((await t.call('GET', '/api/servers/srv_lon1')).json.data.status, 'online');
    const reg = await t.call('POST', '/api/servers', { body: { name: 'fail-test', host: '192.0.2.99', os: 'debian-12' } });
    const bad = await t.finish((await t.call('POST', `/api/servers/${reg.json.data.id}/check`)).json.data.id);
    assert.equal(bad.status, 'failed');
    assert.ok(bad.steps.some((s) => s.status === 'failed'));
  });

  test('deleting a server with sites is refused', async () => {
    const r = await t.call('DELETE', '/api/servers/srv_nyc1');
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
    const c = json.data.find((x) => x.id === 'cli_acme');
    assert.ok(c.siteCount >= 2 && c.mrrCents > 0);
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
