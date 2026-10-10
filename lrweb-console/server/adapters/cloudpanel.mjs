// CloudPanel adapter. Mock mode simulates provisioning; ssh mode runs `clpctl` on the server.
// Every subprocess goes through execFile with an argv array: no local shell, ever.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import {
  OPTIONS, ValidationError, deriveSiteUser, isDomain, isHost, randomPassword, shellQuote,
} from '../validate.mjs';

const defaultExec = promisify(execFile);
const PANEL_PORT = 8443;
const PANEL_PROBE_MS = 4000;
const SAMPLE_LIMIT = 60;
const SSH_TIMEOUT_MS = 120_000;
const SSH_MAX_BUFFER = 1024 * 1024;
const CHECK_STEPS = ['ssh', 'clpctl', 'panel', 'os'];
const SSH_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SITE_USER_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const IDENT_RE = /^[a-z][a-z0-9_]{2,31}$/;
const PUBKEY_RE = /^ssh-(ed25519|rsa|ecdsa-sha2-nistp\d+) [A-Za-z0-9+\/=]+( [A-Za-z0-9@._-]+)?$/;
const DEMO_PUBKEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDEMOKEYDEMOKEYDEMOKEYDEMOKEYDEMOKEYDEMOKEY lrweb-console-demo';
const PLACEHOLDER_PUBKEY = 'ssh-ed25519 AAAA_REPLACE_WITH_LRWEB_PUBLIC_KEY lrweb-console';
const MOCK_PANEL_VERSION = '2.5.1';
const OS_RELEASE_CMD = '. /etc/os-release; echo "$ID-$VERSION_ID"';
// One fixed probe with no user input. The echo markers let parseLiveMetrics split the output.
const LIVE_METRICS_CMD = [
  'echo LOAD; cat /proc/loadavg',
  'echo UPTIME; cat /proc/uptime',
  'echo CPUS; nproc',
  'echo MEM; LC_ALL=C free -b',
  'echo DISK; LC_ALL=C df -P /',
  'echo NET; cat /proc/net/dev',
].join('; ');
const MOCK_DETAILS = {
  ssh: (s) => `${s.sshUser}@${s.host} accepted the key`,
  clpctl: () => 'clpctl 2.x found',
  panel: () => `Panel answering on port ${PANEL_PORT}`,
  os: (s) => `Detected ${s.os}`,
};

const noop = () => {};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const isoMinute = (minute) => new Date(minute * 60_000).toISOString();
const pause = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : undefined);
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
const notFound = (what) => fail(404, 'not_found', `${what} not found`);
const notReady = () => fail(409, 'not_ready', 'Server is not ready yet: run the connection check first');
const panelUrlFor = (host) => `https://${host.includes(':') ? `[${host}]` : host}:${PANEL_PORT}`;
const snapshotOf = (s) => ({ cpu: s.cpu, mem: s.mem, disk: s.disk, load: s.load, uptimeSec: s.uptimeSec });
const uptimeSince = (createdAt, nowMs) => Math.max(0, Math.floor((nowMs - Date.parse(createdAt)) / 1000)) || 0;

/** Strips credentials from text that may reach an error message. */
export function redact(text, secrets = []) {
  let out = String(text ?? '')
    .replace(/--\w*password=\S+/gi, '[redacted]')
    .replace(/(password[ \t]*[=:][ \t]*)\S+/gi, '$1[redacted]');
  for (const s of secrets) if (s) out = out.split(s).join('[redacted]');
  return out;
}

// ---- input validation (re-run here: defence in depth, the HTTP layer parses too) ----

function oneOf(value, list, fallback, field, label) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!list.includes(value)) throw new ValidationError(`${label} must be one of: ${list.join(', ')}`, field);
  return value;
}
function matching(value, re, field, message) {
  if (typeof value !== 'string' || !re.test(value)) throw new ValidationError(message, field);
  return value;
}
function requireDomain(value) {
  if (!isDomain(value)) throw new ValidationError('Enter a valid domain such as example.com', 'domain');
  return value;
}
function requirePort(value, field, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > 65535) throw new ValidationError(`${field} must be between ${min} and 65535`, field);
  return n;
}
function requireProxyUrl(value) {
  let url;
  try { url = new URL(String(value ?? '')); } catch { throw new ValidationError('Reverse proxy URL must be a valid http(s) URL', 'reverseProxyUrl'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ValidationError('Reverse proxy URL must be http or https', 'reverseProxyUrl');
  return url.href;
}
// Paths reach the ssh argv, so refuse anything that could be read as an option or split a word.
function safePath(p, label) {
  if (typeof p !== 'string' || !p || p.startsWith('-') || /[\s\x00-\x1f\x7f]/.test(p)) {
    throw fail(503, 'not_configured', `${label} is missing or contains unsafe characters`);
  }
  return p;
}

/** clpctl argv for `site:add:<type>`. Every value is validated here; passwords are passed as flags. */
function siteAddArgs(type, spec, domain, siteUser, password) {
  const common = [`--domainName=${domain}`];
  const user = [`--siteUser=${siteUser}`, `--siteUserPassword=${password}`];
  switch (type) {
    case 'php':
      return ['site:add:php', ...common,
        `--phpVersion=${oneOf(spec.phpVersion, OPTIONS.phpVersions, OPTIONS.phpVersions[1], 'phpVersion', 'PHP version')}`,
        `--vhostTemplate=${oneOf(spec.vhostTemplate, OPTIONS.vhostTemplates, 'Generic', 'vhostTemplate', 'Vhost template')}`,
        ...user];
    case 'nodejs':
      return ['site:add:nodejs', ...common,
        `--nodejsVersion=${oneOf(spec.nodejsVersion, OPTIONS.nodejsVersions, OPTIONS.nodejsVersions[0], 'nodejsVersion', 'Node.js version')}`,
        `--appPort=${requirePort(spec.appPort ?? 3000, 'appPort', 1024)}`,
        ...user];
    case 'python':
      return ['site:add:python', ...common,
        `--pythonVersion=${oneOf(spec.pythonVersion, OPTIONS.pythonVersions, OPTIONS.pythonVersions[1], 'pythonVersion', 'Python version')}`,
        `--appPort=${requirePort(spec.appPort ?? 8080, 'appPort', 1024)}`,
        ...user];
    case 'static':
      return ['site:add:static', ...common, ...user];
    case 'reverse-proxy':
      return ['site:add:reverse-proxy', ...common, `--reverseProxyUrl=${requireProxyUrl(spec.reverseProxyUrl)}`, ...user];
    default:
      throw new ValidationError(`Site type must be one of: ${OPTIONS.siteTypes.join(', ')}`, 'type');
  }
}

// ---- ssh/clpctl plumbing ----

/** Turns a failed execFile call into an Error with no argv, no raw message and redacted stderr. */
function execFailure(err, secrets) {
  const detail = redact(err?.stderr ?? '', secrets).replace(/\s+/g, ' ').trim().slice(0, 300);
  const suffix = detail ? `: ${detail}` : '';
  if (err?.code === 'ENOENT') return fail(502, 'ssh_failed', 'The ssh client is not installed on the LRWeb host');
  if (err?.killed) return fail(502, 'ssh_failed', 'SSH command timed out');
  if (err?.code === 255) return fail(502, 'ssh_failed', `SSH connection failed${suffix}`);
  return fail(502, 'clpctl_failed', `clpctl failed${suffix}`);
}

/** Parses the fixed live probe into a sample. Net bytes are cumulative; the caller turns them into a rate. */
export function parseLiveMetrics(text) {
  const sec = {};
  let current = null;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (/^(LOAD|UPTIME|CPUS|MEM|DISK|NET)$/.test(line)) {
      current = line;
      sec[current] = [];
    } else if (current && line) {
      sec[current].push(line);
    }
  }
  const bad = () => fail(502, 'metrics_unavailable', 'Could not read metrics from the server');
  const need = (k) => {
    if (!sec[k]?.length) throw bad();
    return sec[k];
  };

  const load = need('LOAD')[0].split(/\s+/).slice(0, 3).map(Number);
  const uptimeSec = Math.floor(Number(need('UPTIME')[0].split(/\s+/)[0]));
  const cpus = Number.parseInt(need('CPUS')[0], 10);

  const memLines = need('MEM');
  const memHeader = memLines[0].split(/\s+/);
  const memRow = memLines.find((l) => l.startsWith('Mem:'))?.split(/\s+/).slice(1).map(Number);
  if (!memRow) throw bad();
  const mem = Object.fromEntries(memHeader.map((h, i) => [h, memRow[i]]));
  const available = Number.isFinite(mem.available) ? mem.available : mem.free + (mem.buffers ?? 0) + (mem.cached ?? 0);
  const memPct = ((mem.total - available) / mem.total) * 100;

  const dfRow = need('DISK').map((l) => l.split(/\s+/)).find((cols) => cols.at(-1) === '/');
  const diskPct = Number.parseInt(dfRow?.[4] ?? '', 10);

  let bytes = 0;
  for (const line of sec.NET ?? []) {
    const i = line.indexOf(':');
    if (i < 0 || line.slice(0, i).trim() === 'lo') continue;
    const cols = line.slice(i + 1).trim().split(/\s+/).map(Number);
    if (Number.isFinite(cols[0]) && Number.isFinite(cols[8])) bytes += cols[0] + cols[8];
  }

  if (![cpus, uptimeSec, memPct, diskPct, ...load].every(Number.isFinite) || cpus < 1) throw bad();
  return {
    cpu: round1(clamp((load[0] / cpus) * 100, 0, 100)),
    mem: round1(clamp(memPct, 0, 100)),
    disk: clamp(diskPct, 0, 100),
    load: load.map(round2),
    uptimeSec,
    bytes,
  };
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const finish = (result) => {
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(timeoutMs, () => finish({ ok: false, error: `Port ${port} did not answer within ${timeoutMs / 1000}s` }));
    sock.once('connect', () => finish({ ok: true, detail: `Port ${port} open` }));
    sock.once('error', (err) => finish({ ok: false, error: `Port ${port} unreachable (${err.code ?? 'error'})` }));
  });
}

// ---- mock series: deterministic per server and minute, so charts move but do not jitter ----

const hash = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};
const mix = (n) => {
  let x = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
};
const noise = (seed, k) => (mix((seed ^ Math.imul(k, 0x9e3779b1)) >>> 0) / 4294967296) * 2 - 1;

function mockPoint(seed, degraded, k) {
  const phase = (n) => ((seed >>> n) % 628) / 100;
  let cpu;
  let mem;
  if (degraded) {
    cpu = clamp(86 + 3 * Math.sin(k / 9 + phase(1)) + 2 * noise(seed, k), 80, 92);
    mem = clamp(80 + 3 * Math.sin(k / 15 + phase(2)) + 2 * noise(seed + 1, k), 74, 88);
  } else {
    cpu = clamp(20 + (seed % 16) + 9 * Math.sin(k / 7 + phase(3)) + 4 * Math.sin(k / 23 + phase(4)) + 3 * noise(seed, k), 15, 55);
    mem = clamp(40 + ((seed >>> 5) % 20) + 5 * Math.sin(k / 13 + phase(5)) + 2 * noise(seed + 1, k), 20, 90);
  }
  const net = Math.max(0.2, (degraded ? 30 : 12) + 10 * Math.sin(k / 5 + phase(6)) + 6 * noise(seed + 2, k));
  return { cpu: round1(cpu), mem: round1(mem), net: round2(net) };
}

function mockMetrics(server, nowMs) {
  const seed = hash(server.id);
  const degraded = server.status === 'degraded';
  const minute = Math.floor(nowMs / 60_000);
  const series = { cpu: [], mem: [], net: [], labels: [] };
  for (let i = 0; i < SAMPLE_LIMIT; i++) {
    const k = minute - (SAMPLE_LIMIT - 1 - i);
    const p = mockPoint(seed, degraded, k);
    series.cpu.push(p.cpu);
    series.mem.push(p.mem);
    series.net.push(p.net);
    series.labels.push(isoMinute(k));
  }
  const cpu = series.cpu.at(-1);
  return {
    ...series,
    current: {
      cpu,
      mem: series.mem.at(-1),
      disk: 28 + (seed % 46),
      load: [round2(cpu / 40), round2(cpu / 45), round2(cpu / 50)],
      uptimeSec: uptimeSince(server.createdAt, nowMs),
    },
  };
}

/** Builds the 60-point series from live samples, repeating the first sample to fill missing history. */
function liveSeries(list) {
  const recent = list.slice(-SAMPLE_LIMIT);
  const padded = [...Array(SAMPLE_LIMIT - recent.length).fill(recent[0]), ...recent];
  const endMinute = Math.floor(recent.at(-1).ts / 60_000);
  return {
    cpu: padded.map((s) => s.cpu),
    mem: padded.map((s) => s.mem),
    net: padded.map((s) => s.net),
    labels: padded.map((_, i) => isoMinute(endMinute - (SAMPLE_LIMIT - 1 - i))),
    current: snapshotOf(recent.at(-1)),
  };
}

// ---- the adapter ----

/**
 * @param {{ config: object, store: object, exec?: (file: string, argv: string[], opts: object) => Promise<{stdout?: string, stderr?: string}> }} deps
 *   exec is injectable so tests never spawn ssh.
 */
export function createCloudPanel({ config, store, exec = defaultExec }) {
  const live = () => config.cloudpanel.mode === 'ssh';
  const delayMs = () => Math.max(0, Number(config.demoDelayMs) || 0);
  const samples = new Map(); // serverId -> recent live samples, oldest first
  const inflight = new Map(); // serverId -> pending metrics refresh (dedupes concurrent polls)

  const serverRow = (id) => {
    const row = store.get('servers', id);
    if (!row) throw notFound('Server');
    return row;
  };
  const readyRow = (id) => {
    const row = serverRow(id);
    if (row.status === 'pending') throw notReady();
    return row;
  };
  const siteCountFor = (serverId) => store.find('sites', (s) => s.serverId === serverId).length;

  const toServer = (row, metrics) => {
    const server = {
      id: row.id,
      name: row.name,
      host: row.host,
      sshPort: row.sshPort ?? 22,
      sshUser: row.sshUser ?? 'lrweb',
      os: row.os,
      provider: row.provider ?? '',
      region: row.region ?? '',
      status: row.status,
      panelVersion: row.panelVersion ?? '',
      panelUrl: row.panelUrl || panelUrlFor(row.host),
      createdAt: row.createdAt,
      siteCount: siteCountFor(row.id),
    };
    if (metrics) server.metrics = metrics;
    return server;
  };

  /** Current snapshot without touching ssh. Pending servers have none. */
  const snapshotFor = (row, nowMs) => {
    if (row.status === 'pending') return undefined;
    if (!live()) return mockMetrics(row, nowMs).current;
    const last = samples.get(row.id)?.at(-1);
    return last ? snapshotOf(last) : undefined;
  };

  const sshArgv = (server, remoteCommand) => {
    const { keyPath, knownHostsPath, connectTimeoutSec } = config.cloudpanel.ssh;
    const key = safePath(keyPath, 'LRWEB_SSH_KEY');
    const hostKey = knownHostsPath
      ? `UserKnownHostsFile=${safePath(knownHostsPath, 'LRWEB_SSH_KNOWN_HOSTS')}`
      : 'StrictHostKeyChecking=accept-new';
    const secs = clamp(Math.trunc(Number(connectTimeoutSec)) || 10, 1, 120);
    if (!isHost(server.host)) throw new ValidationError('Host must be a hostname or IP address', 'host');
    matching(server.sshUser, SSH_USER_RE, 'sshUser', 'SSH user must be a valid Linux username');
    const port = requirePort(server.sshPort, 'sshPort', 1);
    // `--` goes before the destination: ssh stops option parsing at the host, so a trailing `--`
    // would reach the remote shell as part of the command.
    return [
      '-i', key, '-p', String(port),
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${secs}`,
      '-o', 'IdentitiesOnly=yes',
      '-o', hostKey,
      '--', `${server.sshUser}@${server.host}`,
      remoteCommand,
    ];
  };

  async function sshRun(server, remoteCommand, secrets = []) {
    const argv = sshArgv(server, remoteCommand);
    try {
      const res = await exec('ssh', argv, { timeout: SSH_TIMEOUT_MS, maxBuffer: SSH_MAX_BUFFER });
      return typeof res === 'string' ? res : String(res?.stdout ?? '');
    } catch (err) {
      throw execFailure(err, secrets);
    }
  }

  /** Runs `sudo -n clpctl <args>` with every argument shell-quoted. */
  const clpctl = (server, args, secrets = []) => {
    const prefix = config.cloudpanel.ssh.useSudo === false ? 'clpctl' : 'sudo -n clpctl';
    return sshRun(server, [prefix, ...args.map((a) => shellQuote(a))].join(' '), secrets);
  };

  function refreshLive(server) {
    if (!inflight.has(server.id)) {
      const job = (async () => {
        const raw = parseLiveMetrics(await sshRun(server, LIVE_METRICS_CMD));
        const now = Date.now();
        const list = samples.get(server.id) ?? [];
        const prev = list.at(-1);
        const dtSec = prev ? (now - prev.ts) / 1000 : 0;
        const net = prev && dtSec > 0 ? Math.max(0, ((raw.bytes - prev.bytes) * 8) / 1e6 / dtSec) : 0;
        list.push({ ...raw, net: round2(net), ts: now });
        if (list.length > SAMPLE_LIMIT) list.splice(0, list.length - SAMPLE_LIMIT);
        samples.set(server.id, list);
        return list;
      })().finally(() => inflight.delete(server.id));
      inflight.set(server.id, job);
    }
    return inflight.get(server.id);
  }

  /** One connection-check step. Returns { ok, detail?, error?, os? }. Never throws. */
  async function checkStep(server, key) {
    if (!live()) {
      await pause(delayMs());
      if (key === 'ssh' && /fail/i.test(server.name)) return { ok: false, error: 'Connection timed out' };
      return { ok: true, detail: MOCK_DETAILS[key](server) };
    }
    try {
      if (key === 'ssh') {
        await sshRun(server, 'true');
        return { ok: true, detail: `${server.sshUser}@${server.host} accepted the key` };
      }
      if (key === 'clpctl') {
        await clpctl(server, ['list', '--raw']);
        return { ok: true, detail: 'clpctl responded' };
      }
      if (key === 'panel') return await tcpProbe(server.host, PANEL_PORT, PANEL_PROBE_MS);
      const release = (await sshRun(server, OS_RELEASE_CMD)).trim();
      if (!/^[a-z]+-[0-9.]+$/.test(release)) return { ok: false, error: 'Could not read /etc/os-release' };
      return { ok: true, os: release, detail: `Detected ${release}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return {
    get mode() {
      return live() ? 'ssh' : 'mock';
    },

    describe() {
      if (!live()) {
        return { mode: 'mock', label: 'CloudPanel (simulated)', ready: true, details: { note: 'No real servers are contacted' } };
      }
      const { keyPath, knownHostsPath, useSudo } = config.cloudpanel.ssh;
      return {
        mode: 'ssh',
        label: 'CloudPanel over SSH',
        ready: Boolean(keyPath) && existsSync(keyPath),
        // Served from the unauthenticated /api/health, so no paths here.
        details: {
          auth: 'SSH key only (BatchMode)',
          hostKeys: knownHostsPath ? 'pinned known_hosts file' : 'accept-new on first connect',
          clpctl: useSudo === false ? 'run directly (root login)' : 'sudo -n clpctl',
        },
      };
    },

    bootstrapScript({ os, dbEngine, name, installCloudpanel, sshPort } = {}) {
      const warnings = [];
      const osList = OPTIONS.osOptions.map((o) => o.value);
      const engineList = OPTIONS.dbEngines.map((o) => o.value);
      const targetOs = osList.includes(os) ? os : 'ubuntu-24.04';
      const engine = engineList.includes(dbEngine) ? dbEngine : 'MYSQL_8.4';
      if (os !== undefined && os !== targetOs) warnings.push('Unknown OS value; defaulted to Ubuntu 24.04.');
      if (dbEngine !== undefined && dbEngine !== engine) warnings.push('Unknown database engine; defaulted to MySQL 8.4.');

      let port = 22;
      if (sshPort !== undefined && sshPort !== null && sshPort !== '') port = requirePort(sshPort, 'sshPort', 1);

      // The name lands in a comment. Stripping everything else also removes newlines, so it cannot start a command.
      const safeName = String(name ?? '').replace(/[^A-Za-z0-9 ._-]/g, '').trim().slice(0, 60) || 'server';

      let publicKey = DEMO_PUBKEY;
      if (live()) {
        const { keyPath } = config.cloudpanel.ssh;
        let raw = '';
        if (keyPath) {
          try { raw = readFileSync(`${keyPath}.pub`, 'utf8').trim(); } catch { raw = ''; }
        }
        if (PUBKEY_RE.test(raw)) {
          publicKey = raw;
        } else {
          publicKey = PLACEHOLDER_PUBKEY;
          warnings.push('WARNING: could not read a valid LRWeb public key, so the script has a placeholder. Replace it before running.');
        }
      } else {
        warnings.push('Mock mode: the demo public key is embedded. Use LRWEB_CLOUDPANEL_MODE=ssh with a real key before running on a server.');
      }

      const install = installCloudpanel === true || ['1', 'true', 'yes'].includes(String(installCloudpanel).toLowerCase());
      const cloudpanelStep = install
        ? `echo "==> Downloading the CloudPanel installer"
curl -fsSL https://installer.cloudpanel.io/ce/v2/install.sh -o /root/cloudpanel-install.sh
echo "==> SHA-256 of the installer (compare it with the official docs):"
sha256sum /root/cloudpanel-install.sh
echo "Official docs: https://www.cloudpanel.io/docs/v2/getting-started/other/"
read -r -p "Hash matches the docs? Type yes to run the installer: " ok </dev/tty
if [ "$ok" != "yes" ]; then
  echo "Stopped before installing CloudPanel." >&2
  exit 1
fi
DB_ENGINE=${engine} bash /root/cloudpanel-install.sh
`
        : 'echo "==> Skipping the CloudPanel install (clpctl must already be present)"\n';

      const script = `#!/usr/bin/env bash
# LRWeb Console bootstrap for: ${safeName}
# Target: ${targetOs}, database ${engine}, SSH port ${port}
# Run as root on a FRESH, EMPTY server. Read it before you run it.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root (for example: sudo -i)." >&2
  exit 1
fi

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y && apt-get -y upgrade && apt-get -y install curl wget sudo ca-certificates ufw

${cloudpanelStep}
echo "==> Creating the lrweb automation user"
if ! id -u lrweb >/dev/null 2>&1; then
  adduser --disabled-password --gecos "LRWeb automation" lrweb
fi
install -d -m 700 -o lrweb -g lrweb /home/lrweb/.ssh
touch /home/lrweb/.ssh/authorized_keys
grep -qxF '${publicKey}' /home/lrweb/.ssh/authorized_keys || echo '${publicKey}' >> /home/lrweb/.ssh/authorized_keys
chmod 600 /home/lrweb/.ssh/authorized_keys
chown -R lrweb:lrweb /home/lrweb/.ssh

echo "==> Granting lrweb permission to run clpctl as root"
CLPCTL="$(command -v clpctl || true)"
if [ -z "$CLPCTL" ]; then
  echo "clpctl was not found. Install CloudPanel first, then run this script again." >&2
  exit 1
fi
SUDOERS_TMP="$(mktemp /etc/sudoers.d/lrweb.XXXXXX)"
printf 'lrweb ALL=(root) NOPASSWD: %s\\n' "$CLPCTL" > "$SUDOERS_TMP"
chmod 440 "$SUDOERS_TMP"
if ! visudo -cf "$SUDOERS_TMP"; then
  rm -f "$SUDOERS_TMP"
  echo "The sudoers rule failed validation; nothing was installed." >&2
  exit 1
fi
mv -f "$SUDOERS_TMP" /etc/sudoers.d/lrweb

echo "==> Configuring the firewall (SSH first, then web and panel ports)"
ufw allow ${port}/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8443/tcp
ufw --force enable

echo "==> Bootstrap finished."
echo "Open https://<server-ip>:8443 NOW and create the CloudPanel admin user."
echo "Bots scan fresh installs, so do this before anything else."
`;

      const notes = [
        ...warnings,
        'Supported OS: Ubuntu 24.04 and 22.04, Debian 12 and 11.',
        'Run on a fresh, empty server.',
        'The LRWeb key can run clpctl as root via sudo: protect it and consider restricting port 8443 to your IP.',
      ];
      if (install) notes.push('Verify the installer hash against the official CloudPanel docs before answering yes.');
      return { script, publicKey, notes };
    },

    async listServers() {
      const now = Date.now();
      return store.all('servers').map((row) => toServer(row, snapshotFor(row, now)));
    },

    async getServer(id) {
      const row = store.get('servers', id);
      return row ? toServer(row, snapshotFor(row, Date.now())) : undefined;
    },

    async registerServer(input = {}) {
      const host = String(input.host ?? '').trim().toLowerCase();
      if (!isHost(host)) throw new ValidationError('Host must be a hostname or IP address', 'host');
      const row = store.insert('servers', {
        name: String(input.name ?? host),
        host,
        sshPort: input.sshPort ?? 22,
        sshUser: input.sshUser ?? 'lrweb',
        os: input.os ?? 'ubuntu-24.04',
        provider: input.provider ?? '',
        region: input.region ?? '',
        status: 'pending',
        panelVersion: '',
        panelUrl: panelUrlFor(host),
        createdAt: new Date().toISOString(),
      });
      return toServer(row);
    },

    async checkServer(id, onStep) {
      const server = serverRow(id);
      const emit = onStep ?? noop;
      let os = server.os;
      for (let i = 0; i < CHECK_STEPS.length; i++) {
        const key = CHECK_STEPS[i];
        emit({ key, status: 'running' });
        const r = await checkStep(server, key);
        if (!r.ok) {
          emit({ key, status: 'failed', detail: r.error });
          for (const rest of CHECK_STEPS.slice(i + 1)) emit({ key: rest, status: 'skipped' });
          return { ok: false, error: r.error };
        }
        emit({ key, status: 'done', detail: r.detail });
        if (r.os) os = r.os;
      }
      store.update('servers', id, (row) => ({
        status: 'online',
        panelVersion: row.panelVersion || (live() ? '' : MOCK_PANEL_VERSION),
      }));
      return live() ? { ok: true, os } : { ok: true, os, clpctlVersion: '2.x' };
    },

    async removeServer(id) {
      if (!store.get('servers', id)) throw notFound('Server');
      if (siteCountFor(id) > 0) throw fail(409, 'has_sites', "Remove this server's sites first");
      store.remove('servers', id);
      samples.delete(id);
    },

    async metrics(id) {
      const server = serverRow(id);
      if (server.status === 'pending') throw notReady();
      if (!live()) return mockMetrics(server, Date.now());
      await refreshLive(server);
      return liveSeries(samples.get(id));
    },

    async createSite(serverId, spec = {}, onStep) {
      const server = readyRow(serverId);
      const emit = onStep ?? noop;
      const type = oneOf(spec.type, OPTIONS.siteTypes, 'php', 'type', 'Site type');
      const domain = requireDomain(spec.domain);
      const siteUser = matching(spec.siteUser || deriveSiteUser(domain), SITE_USER_RE, 'siteUser',
        'Site user must be 3-32 chars: a-z, 0-9, _ or -, starting with a letter');
      const password = randomPassword();
      const args = siteAddArgs(type, spec, domain, siteUser, password);

      emit({ key: 'site', status: 'running' });
      try {
        if (live()) await clpctl(server, args, [password]);
        else await pause(delayMs());
      } catch (err) {
        emit({ key: 'site', status: 'failed', detail: err.message });
        throw err;
      }
      emit({ key: 'site', status: 'done', detail: `${domain} created` });
      return { siteUser, siteUserPassword: password };
    },

    async createDatabase(serverId, { domain, dbName, dbUser } = {}) {
      const server = readyRow(serverId);
      requireDomain(domain);
      matching(dbName, IDENT_RE, 'dbName', 'Database name must be 3-32 chars: a-z, 0-9 or _, starting with a letter');
      matching(dbUser, IDENT_RE, 'dbUser', 'Database user must be 3-32 chars: a-z, 0-9 or _, starting with a letter');
      const dbPassword = randomPassword();
      if (live()) {
        await clpctl(server, [
          'db:add',
          `--domainName=${domain}`,
          `--databaseName=${dbName}`,
          `--databaseUserName=${dbUser}`,
          `--databaseUserPassword=${dbPassword}`,
        ], [dbPassword]);
      } else {
        await pause(delayMs());
      }
      return { dbName, dbUser, dbPassword };
    },

    async issueCertificate(serverId, domain) {
      const server = readyRow(serverId);
      requireDomain(domain);
      if (!live()) {
        await pause(delayMs());
        return { issued: true, detail: 'Certificate issued (simulated)' };
      }
      try {
        await clpctl(server, ['lets-encrypt:install:certificate', `--domainName=${domain}`]);
        return { issued: true };
      } catch (err) {
        // A failed Let's Encrypt run is expected (DNS not pointed yet), so report it instead of throwing.
        if (err.code !== 'clpctl_failed') throw err;
        return { issued: false, detail: err.message };
      }
    },

    async deleteSite(serverId, domain) {
      const server = serverRow(serverId);
      requireDomain(domain);
      if (live()) await clpctl(server, ['site:delete', `--domainName=${domain}`, '--force']);
      else await pause(delayMs());
    },
  };
}
