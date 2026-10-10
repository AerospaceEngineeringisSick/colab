// Site migration tests. Mock CloudPanel by default. Live mode uses a stub, so nothing spawns ssh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createStore } from '../store.mjs';
import { seedIfEmpty } from '../seed.mjs';
import { loadConfig } from '../config.mjs';
import { createCloudPanel } from '../adapters/cloudpanel.mjs';
import { createJobs } from '../jobs.mjs';
import { createMigrator, migrateRoutes } from '../migrate.mjs';
import { ValidationError } from '../validate.mjs';

const DB = 'lrtest_db';
const ALL_STEPS = ['prepare', 'database', 'files', 'dbcopy', 'verify', 'ssl', 'cutover-ready'];

function fixture({ env = {}, cloudpanel } = {}) {
  const store = createStore({ memory: true });
  seedIfEmpty(store);
  const config = loadConfig({ LRWEB_DEMO_DELAY_MS: '0', ...env });
  const cp = cloudpanel ?? createCloudPanel({ config, store });
  const jobs = createJobs({ store });
  const migrator = createMigrator({ store, cloudpanel: cp, jobs, config });

  // Look data up in whatever seed is loaded, so renamed ids cannot break these tests.
  const found = store.find('sites', (s) => s.status === 'active' && s.type === 'php')[0];
  assert.ok(found, 'seed needs an active PHP site');
  if (!found.database) store.update('sites', found.id, { database: DB });
  const site = store.get('sites', found.id);
  const servers = store.all('servers');
  const target = servers.find((s) => s.status === 'online' && s.id !== site.serverId)
    ?? servers.find((s) => s.status === 'degraded' && s.id !== site.serverId);
  assert.ok(target, 'seed needs an online or degraded server other than the site server');
  return { store, config, jobs, migrator, site, target, cloudpanel: cp };
}

const addServer = (store, status, host = '192.0.2.200') => store.insert('servers', {
  name: `${status}-test-01`, host, sshPort: 22, sshUser: 'lrweb', os: 'ubuntu-24.04',
  provider: '', region: '', status, panelVersion: '', createdAt: new Date().toISOString(),
});

async function settle(store, jobId) {
  for (let i = 0; i < 2000; i++) {
    const job = store.get('jobs', jobId);
    if (job.status === 'done' || job.status === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('job did not finish in time');
}

test('plan rejects a move to the server the site is already on', () => {
  const { migrator, site } = fixture();
  assert.throws(
    () => migrator.plan(site.id, { toServerId: site.serverId }),
    (err) => err.status === 409 && err.message === 'Pick a different server from the one the site is already on',
  );
});

test('plan rejects servers that are pending, offline or missing', () => {
  const { store, migrator, site } = fixture();
  const pending = addServer(store, 'pending');
  const offline = addServer(store, 'offline', '192.0.2.201');
  assert.throws(() => migrator.plan(site.id, { toServerId: pending.id }), (err) => err.status === 409 && /still being set up/.test(err.message));
  assert.throws(() => migrator.plan(site.id, { toServerId: offline.id }), (err) => err.status === 409 && /offline/.test(err.message));
  assert.throws(() => migrator.plan(site.id, { toServerId: 'srv_missing' }), (err) => err.status === 404);
});

test('plan rejects unknown sites and a missing server choice', () => {
  const { migrator, target } = fixture();
  assert.throws(() => migrator.plan('sit_missing', { toServerId: target.id }), (err) => err.status === 404);
  assert.throws(() => migrator.plan(undefined, { toServerId: target.id }), (err) => err.status === 404);
  assert.throws(() => migrator.plan(target.id, {}), (err) => err.status === 404);
  const { migrator: m2, site } = fixture();
  assert.throws(() => m2.plan(site.id, {}), ValidationError);
});

test('plan refuses sites that are not active, and reverse-proxy sites', () => {
  const suspended = fixture();
  suspended.store.update('sites', suspended.site.id, { status: 'suspended' });
  assert.throws(
    () => suspended.migrator.plan(suspended.site.id, { toServerId: suspended.target.id }),
    (err) => err.status === 409 && err.code === 'site_not_active',
  );

  const proxy = fixture();
  proxy.store.update('sites', proxy.site.id, { type: 'reverse-proxy', runtime: '' });
  assert.throws(
    () => proxy.migrator.plan(proxy.site.id, { toServerId: proxy.target.id }),
    (err) => err.status === 409 && err.code === 'unsupported_type',
  );
});

test('plan steps follow the options chosen, and planning changes nothing', () => {
  const { store, migrator, site, target } = fixture();
  const keys = (opts) => migrator.plan(site.id, { toServerId: target.id, ...opts }).steps.map((s) => s.key);

  assert.deepEqual(keys({}), ALL_STEPS);
  assert.deepEqual(keys({ copyFiles: false }), ['prepare', 'database', 'dbcopy', 'verify', 'ssl', 'cutover-ready']);
  assert.deepEqual(keys({ copyDatabase: false }), ['prepare', 'files', 'verify', 'ssl', 'cutover-ready']);
  assert.deepEqual(keys({ issueCertificate: false }), ['prepare', 'database', 'files', 'dbcopy', 'verify', 'cutover-ready']);
  assert.throws(() => keys({ copyFiles: 'no' }), (err) => err instanceof ValidationError && err.field === 'copyFiles');

  store.update('sites', site.id, { database: '' });
  assert.deepEqual(keys({}), ['prepare', 'files', 'verify', 'ssl', 'cutover-ready']);

  const sitesBefore = store.all('sites');
  const plan = migrator.plan(site.id, { toServerId: target.id });
  for (const step of plan.steps) {
    assert.equal(typeof step.label, 'string');
    assert.equal(typeof step.detail, 'string');
    assert.ok(['low', 'medium', 'high'].includes(step.risk), step.risk);
  }
  assert.deepEqual(store.all('sites'), sitesBefore);
});

test('plan estimates come from the site size and the options', () => {
  const { migrator, site, target } = fixture();
  const full = migrator.plan(site.id, { toServerId: target.id });
  assert.equal(full.estimate.filesMb, site.diskMb);
  assert.equal(full.estimate.dbMb, Math.round(site.diskMb * 0.1));
  assert.equal(full.estimate.downtimeSec, 0);

  const partial = migrator.plan(site.id, { toServerId: target.id, copyFiles: false });
  assert.equal(partial.estimate.filesMb, 0);
  assert.ok(partial.estimate.downtimeSec > 0);
});

test('runbook has the key commands in order and is valid bash', () => {
  const { migrator, site, target } = fixture();
  const { runbook } = migrator.plan(site.id, { toServerId: target.id });
  const dir = `/home/${site.siteUser}/htdocs/${site.domain}/`;

  assert.equal(runbook.split('\n').filter((l) => l.startsWith('rsync -azP --delete -e ')).length, 2);
  for (const needle of [
    `rsync -azP --delete -e 'ssh -p ${target.sshPort ?? 22}' ${dir} ${target.sshUser ?? 'lrweb'}@${target.host}:${dir}`,
    `sudo clpctl db:export --databaseName=${site.database} --file=/tmp/${site.database}.sql.gz`,
    `scp -P ${target.sshPort ?? 22} /tmp/${site.database}.sql.gz`,
    `sudo clpctl db:import --databaseName=${site.database} --file=/tmp/${site.database}.sql.gz`,
    `sudo clpctl lets-encrypt:install:certificate --domainName=${site.domain}`,
    '7 days',
    'Check this path on your server',
  ]) assert.ok(runbook.includes(needle), needle);

  const at = (text) => runbook.indexOf(text);
  assert.ok(at('db:export') < at('db:import'));
  assert.ok(at('db:import') < at('The switch'));
  assert.ok(at('The switch') < at('lets-encrypt'));
  assert.ok(at('lets-encrypt') < at('7 days'));

  assert.doesNotThrow(() => execFileSync('bash', ['-n'], { input: runbook }));
});

test('runbook leaves out the copies that were not chosen, and still parses', () => {
  const { migrator, site, target } = fixture();
  const { runbook } = migrator.plan(site.id, { toServerId: target.id, copyFiles: false, copyDatabase: false, issueCertificate: false });
  assert.ok(!runbook.includes('rsync '));
  assert.ok(!runbook.includes('db:export'));
  assert.ok(!runbook.includes('lets-encrypt'));
  assert.doesNotThrow(() => execFileSync('bash', ['-n'], { input: runbook }));
});

test('runbook commands are shell-safe, contain no passwords, and use no em dashes', () => {
  const { migrator, site, target } = fixture();
  const plan = migrator.plan(site.id, { toServerId: target.id });
  const commands = plan.runbook.split('\n').filter((l) => l && !l.startsWith('#'));
  assert.ok(commands.length >= 6);
  for (const line of commands) {
    const bare = line.replace(/'[^']*'/g, '');
    assert.doesNotMatch(bare, /[;|&$`<>(){}*?!\\"]/, line);
  }
  assert.doesNotMatch(plan.runbook, /password=/i);
  const copy = JSON.stringify(plan);
  assert.ok(!copy.includes('\u2014'), 'no em dashes in plan text');
});

test('hostile domains, site users and databases are rejected before any command is built', () => {
  const cases = [
    ['domain', { domain: 'shop.example.com; rm -rf /' }],
    ['siteUser', { siteUser: 'x;rm' }],
    ['database', { database: 'a$(id)' }],
    ['runtime', { runtime: '8.9' }],
  ];
  for (const [field, patch] of cases) {
    const { store, migrator, site, target } = fixture();
    store.update('sites', site.id, patch);
    assert.throws(
      () => migrator.plan(site.id, { toServerId: target.id }),
      (err) => err instanceof ValidationError && err.field === field,
      field,
    );
  }
});

test('warnings explain the switch, the SSH path and the TTL in plain English', () => {
  const { migrator, site, target } = fixture();
  const { warnings } = migrator.plan(site.id, { toServerId: target.id });
  assert.ok(warnings.some((w) => /until you point DNS/.test(w)));
  assert.ok(warnings.some((w) => /TTL/.test(w) && /a day before/.test(w)));
  assert.ok(warnings.some((w) => /over SSH/.test(w)));
  assert.ok(warnings.every((w) => !w.includes('\u2014')));
});

test('live mode warns that data copies are not automated', () => {
  const { migrator, site, target } = fixture({ env: { LRWEB_CLOUDPANEL_MODE: 'ssh' }, cloudpanel: {} });
  const { warnings } = migrator.plan(site.id, { toServerId: target.id });
  assert.ok(warnings.some((w) => /not automated/.test(w)));
});

test('start runs a mock move to completion, adds a target row and leaves the source alone', async () => {
  const { store, migrator, site, target } = fixture();
  const sourceBefore = store.get('sites', site.id);
  const countBefore = store.all('sites').length;

  const job = migrator.start(site.id, { toServerId: target.id });
  assert.equal(job.kind, 'site.migrate');
  const done = await settle(store, job.id);

  assert.equal(done.status, 'done', done.error);
  assert.deepEqual(done.steps.map((s) => s.key), ALL_STEPS);
  assert.ok(done.steps.every((s) => s.status === 'done'), JSON.stringify(done.steps));
  assert.match(done.steps.find((s) => s.key === 'files').detail, /simulated/);

  const row = store.get('sites', done.result.targetSiteId);
  assert.equal(row.migratedFrom, site.id);
  assert.equal(row.serverId, target.id);
  assert.equal(row.domain, site.domain);
  assert.equal(row.siteUser, site.siteUser);
  assert.equal(row.status, 'active');
  assert.equal(row.ssl, 'active');
  assert.equal(done.result.targetServerId, target.id);
  assert.match(done.result.runbook, /^#!\/usr\/bin\/env bash/);
  assert.equal(store.all('sites').length, countBefore + 1);
  assert.deepEqual(store.get('sites', site.id), sourceBefore);
  assert.ok(store.all('events').some((e) => e.text === `Migrated ${site.domain} to ${target.name}, ready to switch`));
});

test('credentials reach the job once and never enter the store', async () => {
  const { store, jobs, migrator, site, target } = fixture();
  const job = migrator.start(site.id, { toServerId: target.id });
  await settle(store, job.id);

  const once = jobs.get(job.id);
  assert.match(once.secrets.siteUserPassword, /^[A-Za-z0-9]{22}$/);
  assert.match(once.secrets.dbPassword, /^[A-Za-z0-9]{22}$/);
  assert.equal(jobs.get(job.id).secrets, undefined);

  const dump = JSON.stringify([store.all('jobs'), store.all('sites'), store.all('events')]);
  assert.ok(!dump.includes(once.secrets.siteUserPassword));
  assert.ok(!dump.includes(once.secrets.dbPassword));
});

test('a second move of the same site is refused while the first is still running', async () => {
  const { store, migrator, site, target } = fixture();
  const job = migrator.start(site.id, { toServerId: target.id });
  assert.throws(() => migrator.start(site.id, { toServerId: target.id }), (err) => err.status === 409);
  await settle(store, job.id);
});

test('a certificate that cannot be issued yet skips the step and does not fail the move', async () => {
  const stubs = [
    async () => { throw new Error('boom'); },
    async () => ({ issued: false, detail: 'raw clpctl output with a secret' }),
  ];
  for (const issueCertificate of stubs) {
    const base = fixture();
    const cloudpanel = { ...base.cloudpanel, issueCertificate };
    const migrator = createMigrator({ store: base.store, cloudpanel, jobs: base.jobs, config: base.config });
    const job = migrator.start(base.site.id, { toServerId: base.target.id });
    const done = await settle(base.store, job.id);

    assert.equal(done.status, 'done', done.error);
    const ssl = done.steps.find((s) => s.key === 'ssl');
    assert.equal(ssl.status, 'skipped');
    assert.match(ssl.detail, /DNS probably does not point/);
    assert.ok(!ssl.detail.includes('raw clpctl'));
    assert.equal(base.store.get('sites', done.result.targetSiteId).ssl, 'pending');
    assert.equal(base.store.get('sites', done.result.targetSiteId).status, 'active');
  }
});

test('live mode automates only the create steps and marks the data copies as runbook steps', async () => {
  const calls = [];
  const stub = {
    createSite: async (serverId, spec) => {
      calls.push(['createSite', serverId, spec]);
      return { siteUser: spec.siteUser, siteUserPassword: 'StubSitePass123456789a' };
    },
    createDatabase: async (serverId, input) => {
      calls.push(['createDatabase', serverId, input]);
      return { dbName: input.dbName, dbUser: input.dbUser, dbPassword: 'StubDbPass1234567890b' };
    },
    issueCertificate: async (serverId, domain) => {
      calls.push(['issueCertificate', serverId, domain]);
      return { issued: true };
    },
  };
  const { store, migrator, site, target } = fixture({ env: { LRWEB_CLOUDPANEL_MODE: 'ssh' }, cloudpanel: stub });
  const job = migrator.start(site.id, { toServerId: target.id });
  const done = await settle(store, job.id);

  assert.equal(done.status, 'done', done.error);
  const byKey = Object.fromEntries(done.steps.map((s) => [s.key, s]));
  for (const key of ['files', 'dbcopy', 'verify']) {
    assert.equal(byKey[key].status, 'skipped', key);
    assert.equal(byKey[key].detail, 'Run this from the runbook', key);
  }
  for (const key of ['prepare', 'database', 'ssl', 'cutover-ready']) assert.equal(byKey[key].status, 'done', key);

  const [create, db, cert] = calls;
  assert.equal(create[1], target.id);
  assert.equal(create[2].domain, site.domain);
  assert.equal(create[2].type, 'php');
  assert.equal(create[2].siteUser, site.siteUser);
  assert.equal(create[2].phpVersion, site.runtime);
  assert.equal(create[2].vhostTemplate, 'Generic');
  assert.equal(db[2].dbName, site.database);
  assert.equal(cert[2], site.domain);
  assert.equal(store.get('sites', done.result.targetSiteId).status, 'active');
});

test('migrate routes are POST only, use the default owner and admin rule, and return the plan', async () => {
  const { migrator, site, target } = fixture();
  const routes = migrateRoutes({ migrator });
  assert.deepEqual(routes.map((r) => [r.method, r.path]), [
    ['POST', '/api/sites/:id/migrate/plan'],
    ['POST', '/api/sites/:id/migrate'],
  ]);
  assert.ok(routes.every((r) => r.roles === undefined && r.auth === 'any' && typeof r.handler === 'function'));

  const plan = await routes[0].handler({ params: { id: site.id }, body: { toServerId: target.id } });
  assert.deepEqual(plan.steps.map((s) => s.key), ALL_STEPS);
});
