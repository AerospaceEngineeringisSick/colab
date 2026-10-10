#!/usr/bin/env node
// LRWeb Console server: static UI + JSON API. Secrets and SSH keys stay here, never in the browser.
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { brotliCompress, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import { loadConfig, validateConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { seedIfEmpty } from './seed.mjs';
import { createJobs } from './jobs.mjs';
import { createCloudPanel } from './adapters/cloudpanel.mjs';
import { createBilling } from './adapters/billing.mjs';
import { OPTIONS, ValidationError, parseClientInput, parseServerInput, parseSiteSpec } from './validate.mjs';

const VERSION = '1.0.0';
const br = promisify(brotliCompress);
const gz = promisify(gzip);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

class HttpError extends Error {
  constructor(status, code, message, field) { super(message); this.status = status; this.code = code; this.field = field; }
}
const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);

export function createApp({ config, store, cloudpanel, billing, jobs }) {
  const addEvent = (kind, text) => store.insert('events', { ts: new Date().toISOString(), kind, text });
  const sha = (s) => createHash('sha256').update(String(s)).digest();
  const tokenHash = config.adminToken ? sha(config.adminToken) : null;
  const authFails = new Map(); // ip -> { n, reset }

  /* ---------- shared helpers ---------- */

  const planPrice = (plans, id) => plans.find((p) => p.id === id)?.priceCents ?? 0;

  async function clientRows() {
    const [plans, invoices] = await Promise.all([billing.listPlans(), billing.listInvoices({ limit: 500 })]);
    const sites = store.all('sites');
    const balance = new Map();
    for (const inv of invoices) if (inv.status === 'open' || inv.status === 'overdue') balance.set(inv.clientId, (balance.get(inv.clientId) || 0) + inv.amountCents);
    return store.all('clients').map((c) => ({
      ...c,
      siteCount: sites.filter((s) => s.clientId === c.id).length,
      mrrCents: c.status === 'active' ? planPrice(plans, c.planId) : 0,
      balanceCents: balance.get(c.id) || 0,
    }));
  }
  const enrichSites = (sites) => {
    const servers = new Map(store.all('servers').map((s) => [s.id, s]));
    const clients = new Map(store.all('clients').map((c) => [c.id, c]));
    return sites.map((s) => ({ ...s, serverName: servers.get(s.serverId)?.name || '', clientName: clients.get(s.clientId)?.company || clients.get(s.clientId)?.name || '' }));
  };
  const requireServer = async (id) => (await cloudpanel.getServer(id)) || (() => { throw notFound('Server'); })();

  /** Provision one site (site → database → SSL) inside a job. Shared by site.create and client.onboard. */
  async function provision(j, spec, clientId) {
    const server = await requireServer(spec.serverId);
    const runtime = spec.phpVersion || spec.nodejsVersion || spec.pythonVersion || '';
    const row = store.insert('sites', {
      domain: spec.domain, serverId: spec.serverId, clientId: clientId || '', type: spec.type, runtime, siteUser: spec.siteUser,
      status: 'provisioning', ssl: 'none', database: '', diskMb: 0, createdAt: new Date().toISOString(),
    });
    try {
      await j.step('site', async () => {
        const creds = await cloudpanel.createSite(spec.serverId, spec);
        j.secret('siteUser', creds.siteUser);
        j.secret('siteUserPassword', creds.siteUserPassword);
        return `on ${server.name}`;
      });
      if (spec.createDatabase) {
        await j.step('db', async () => {
          const db = await cloudpanel.createDatabase(spec.serverId, { domain: spec.domain, dbName: spec.dbName, dbUser: spec.dbUser });
          j.secret('dbName', db.dbName);
          j.secret('dbUser', db.dbUser);
          j.secret('dbPassword', db.dbPassword);
          store.update('sites', row.id, { database: db.dbName });
          return db.dbName;
        });
      }
      let ssl = 'none';
      if (spec.issueCertificate) {
        // A certificate fails when DNS does not point at the server yet; that must not undo a working site.
        j.setStep('ssl', 'running');
        try {
          const r = await cloudpanel.issueCertificate(spec.serverId, spec.domain);
          ssl = r.issued ? 'active' : 'pending';
          j.setStep('ssl', r.issued ? 'done' : 'skipped', r.issued ? undefined : r.detail || 'Point DNS at the server, then retry from the Sites page.');
        } catch (e) {
          j.setStep('ssl', 'skipped', 'Could not issue a certificate yet. Check that DNS points at the server.');
        }
      }
      store.update('sites', row.id, { status: 'active', ssl });
      addEvent('site', `Provisioned ${spec.domain} on ${server.name}`);
      j.result({ siteId: row.id, domain: spec.domain });
      return row.id;
    } catch (e) {
      store.update('sites', row.id, { status: 'failed' });
      throw e;
    }
  }
  const siteSteps = (spec) => [
    { key: 'site', label: `Create ${spec.type} site ${spec.domain}` },
    ...(spec.createDatabase ? [{ key: 'db', label: 'Create database' }] : []),
    ...(spec.issueCertificate ? [{ key: 'ssl', label: "Issue Let's Encrypt certificate" }] : []),
  ];

  async function requirePlan(planId) {
    const plans = await billing.listPlans();
    const plan = plans.find((p) => p.id === planId);
    if (!plan) throw new ValidationError('Choose a valid plan', 'planId');
    return plan;
  }
  async function createClient(input, planId) {
    const plan = await requirePlan(planId);
    if (store.findOne('clients', (c) => c.email === input.email)) throw new HttpError(409, 'email_taken', 'A client with this email already exists', 'email');
    const { customerId } = await billing.createCustomer({ name: input.name, email: input.email, company: input.company });
    const client = store.insert('clients', { ...input, planId, status: 'pending', billingCustomerId: customerId, createdAt: new Date().toISOString() });
    return { client, plan, customerId };
  }

  /* ---------- routes ---------- */

  const routes = [];
  const route = (method, path, handler) => {
    const keys = [];
    const re = new RegExp(`^${path.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/api/health', () => ({ version: VERSION, authRequired: Boolean(tokenHash), integrations: { cloudpanel: cloudpanel.describe(), billing: billing.describe() } }));
  route('GET', '/api/meta', () => OPTIONS);

  route('GET', '/api/overview', async () => {
    const [servers, summary] = await Promise.all([cloudpanel.listServers(), billing.summary()]);
    const sites = store.all('sites');
    const clients = store.all('clients');
    return {
      kpis: {
        servers: { total: servers.length, online: servers.filter((s) => s.status === 'online').length },
        sites: { total: sites.length, sslActive: sites.filter((s) => s.ssl === 'active').length },
        clients: { total: clients.length, active: clients.filter((c) => c.status === 'active').length },
        mrrCents: summary.mrrCents, outstandingCents: summary.outstandingCents, currency: summary.currency,
      },
      revenue: summary.revenue,
      servers: servers.map((s) => ({ id: s.id, name: s.name, status: s.status, cpu: s.metrics?.cpu ?? 0, mem: s.metrics?.mem ?? 0, disk: s.metrics?.disk ?? 0 })),
      activity: store.all('events').sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8),
      integrations: { cloudpanel: cloudpanel.describe(), billing: billing.describe() },
    };
  });

  /* servers */
  route('GET', '/api/servers', () => cloudpanel.listServers());
  route('GET', '/api/servers/bootstrap-script', ({ query }) => cloudpanel.bootstrapScript({
    os: query.get('os') || undefined, dbEngine: query.get('dbEngine') || undefined, name: query.get('name') || 'new-server',
    sshPort: Number(query.get('sshPort') || 22), installCloudpanel: ['1', 'true'].includes(query.get('installCloudpanel') ?? '1'),
  }));
  route('POST', '/api/servers', async ({ body }) => {
    const input = parseServerInput(body);
    if (store.findOne('servers', (s) => s.host === input.host && s.sshPort === input.sshPort)) throw new HttpError(409, 'host_taken', 'This host is already registered', 'host');
    const server = await cloudpanel.registerServer(input);
    addEvent('server', `${server.name} registered, waiting for CloudPanel install`);
    return server;
  });
  route('GET', '/api/servers/:id', async ({ params }) => {
    const server = await requireServer(params.id);
    return { ...server, sites: enrichSites(store.find('sites', (s) => s.serverId === server.id)) };
  });
  route('GET', '/api/servers/:id/metrics', async ({ params }) => { await requireServer(params.id); return cloudpanel.metrics(params.id); });
  route('POST', '/api/servers/:id/check', async ({ params }) => {
    const server = await requireServer(params.id);
    const labels = { ssh: 'Reach server over SSH', clpctl: 'Verify clpctl is available', panel: 'Check CloudPanel on port 8443', os: 'Detect operating system' };
    return jobs.start({ kind: 'server.check', steps: Object.entries(labels).map(([key, label]) => ({ key, label })) }, async (j) => {
      const r = await cloudpanel.checkServer(server.id, ({ key, status, detail }) => j.setStep(key, status, detail));
      if (!r.ok) throw new Error(r.error || 'Connection check failed');
      j.result({ serverId: server.id, os: r.os });
      addEvent('server', `${server.name} is online`);
    });
  });
  route('DELETE', '/api/servers/:id', async ({ params }) => {
    const server = await requireServer(params.id);
    if (store.find('sites', (s) => s.serverId === server.id).length) throw new HttpError(409, 'server_has_sites', 'Remove or move this server\'s sites before deleting it');
    await cloudpanel.removeServer(server.id);
    addEvent('server', `${server.name} removed`);
    return { removed: true };
  });

  /* clients */
  route('GET', '/api/clients', async ({ query }) => {
    const status = query.get('status');
    return (await clientRows()).filter((c) => !status || c.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  route('POST', '/api/clients', async ({ body }) => {
    const input = parseClientInput(body);
    const { client, customerId } = await createClient(input, body.planId);
    await billing.subscribe({ customerId, planId: body.planId });
    store.update('clients', client.id, { status: 'active' });
    addEvent('client', `${client.name} joined${client.company ? ` (${client.company})` : ''}`);
    return (await clientRows()).find((c) => c.id === client.id);
  });
  route('GET', '/api/clients/:id', async ({ params }) => {
    const client = (await clientRows()).find((c) => c.id === params.id);
    if (!client) throw notFound('Client');
    return { ...client, sites: enrichSites(store.find('sites', (s) => s.clientId === client.id)), invoices: await billing.listInvoices({ clientId: client.id, limit: 100 }) };
  });

  /* sites */
  route('GET', '/api/sites', ({ query }) => {
    const sid = query.get('serverId');
    const cid = query.get('clientId');
    return enrichSites(store.find('sites', (s) => (!sid || s.serverId === sid) && (!cid || s.clientId === cid))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  const checkSiteSpec = async (spec) => {
    const server = await requireServer(spec.serverId);
    if (!['online', 'degraded'].includes(server.status)) throw new HttpError(409, 'server_not_ready', `${server.name} is not online yet. Finish onboarding it first.`, 'serverId');
    if (spec.clientId && !store.get('clients', spec.clientId)) throw new ValidationError('Unknown client', 'clientId');
    if (store.findOne('sites', (s) => s.domain === spec.domain)) throw new HttpError(409, 'domain_taken', `${spec.domain} already exists`, 'domain');
  };
  route('POST', '/api/sites', async ({ body }) => {
    const spec = parseSiteSpec(body);
    await checkSiteSpec(spec);
    return jobs.start({ kind: 'site.create', steps: siteSteps(spec) }, (j) => provision(j, spec, spec.clientId));
  });
  route('DELETE', '/api/sites/:id', async ({ params }) => {
    const site = store.get('sites', params.id);
    if (!site) throw notFound('Site');
    await cloudpanel.deleteSite(site.serverId, site.domain);
    store.remove('sites', site.id);
    addEvent('site', `Deleted ${site.domain}`);
    return { removed: true };
  });

  /* onboarding: client + billing + (optional) site in one tracked job */
  route('POST', '/api/onboard/client', async ({ body }) => {
    const input = parseClientInput(body.client);
    const plan = await requirePlan(body.planId);
    if (store.findOne('clients', (c) => c.email === input.email)) throw new HttpError(409, 'email_taken', 'A client with this email already exists', 'email');
    const spec = body.site ? parseSiteSpec({ ...body.site, clientId: '' }) : null;
    if (spec) await checkSiteSpec(spec);
    const steps = [
      { key: 'client', label: 'Create client record' },
      { key: 'billing', label: 'Create billing customer' },
      { key: 'subscription', label: `Start ${plan.name} subscription` },
      ...(spec ? siteSteps(spec) : []),
    ];
    return jobs.start({ kind: 'client.onboard', steps }, async (j) => {
      let client;
      let customerId;
      await j.step('client', async () => {
        client = store.insert('clients', { ...input, planId: plan.id, status: 'pending', billingCustomerId: '', createdAt: new Date().toISOString() });
        j.result({ clientId: client.id });
      });
      await j.step('billing', async () => {
        ({ customerId } = await billing.createCustomer({ name: input.name, email: input.email, company: input.company }));
        store.update('clients', client.id, { billingCustomerId: customerId });
        return customerId;
      });
      await j.step('subscription', async () => {
        const sub = await billing.subscribe({ customerId, planId: plan.id });
        store.update('clients', client.id, { status: 'active' });
        j.result({ invoiceId: sub.invoice?.id });
        return sub.invoice ? `First invoice ${sub.invoice.number}` : undefined;
      });
      addEvent('client', `${input.name} onboarded${input.company ? ` (${input.company})` : ''} on ${plan.name}`);
      if (spec) await provision(j, spec, client.id);
    });
  });

  route('GET', '/api/jobs/:id', ({ params }) => jobs.get(params.id) || (() => { throw notFound('Job'); })());

  /* billing */
  route('GET', '/api/billing/plans', () => billing.listPlans());
  route('GET', '/api/billing/summary', () => billing.summary());
  route('GET', '/api/billing/invoices', ({ query }) => billing.listInvoices({
    clientId: query.get('clientId') || undefined, status: query.get('status') || undefined, limit: Math.min(500, Number(query.get('limit')) || 100),
  }));
  route('POST', '/api/billing/invoices/:id/send', async ({ params }) => billing.sendInvoice(params.id));
  route('POST', '/api/billing/invoices/:id/pay', async ({ params }) => {
    const inv = await billing.markPaid(params.id);
    addEvent('billing', `Invoice ${inv.number} marked paid`);
    return inv;
  });

  /* ---------- request plumbing ---------- */

  const send = (res, status, payload, extra = {}) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra });
    res.end(body);
  };

  async function readBody(req) {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return {};
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json');
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > 64 * 1024) throw new HttpError(413, 'too_large', 'Request body too large');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'Invalid JSON'); }
  }

  function authenticate(req) {
    if (!tokenHash) return;
    const ip = req.socket.remoteAddress || '?';
    const rec = authFails.get(ip);
    if (rec && rec.n >= 10 && Date.now() < rec.reset) throw new HttpError(429, 'rate_limited', 'Too many failed attempts. Try again in a minute.');
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (m && timingSafeEqual(sha(m[1]), tokenHash)) { authFails.delete(ip); return; }
    const n = rec && Date.now() < rec.reset ? rec.n + 1 : 1;
    authFails.set(ip, { n, reset: Date.now() + 60_000 });
    throw new HttpError(401, 'unauthorized', 'A valid admin token is required');
  }

  async function handleApi(req, res, url) {
    try {
      const hit = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!hit) {
        if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        throw notFound('Endpoint');
      }
      if (url.pathname !== '/api/health') authenticate(req);
      if (req.method !== 'GET') {
        // Same-origin only: blocks cross-site form posts / fetches aimed at a local console.
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'forbidden_origin', 'Cross-origin requests are not allowed');
      }
      const m = hit.re.exec(url.pathname);
      const params = Object.fromEntries(hit.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = await readBody(req);
      const data = await hit.handler({ req, params, query: url.searchParams, body });
      send(res, 200, { ok: true, data });
    } catch (e) {
      const status = e.status && e.status < 600 ? e.status : 500;
      if (status === 500) console.error('[api]', e);
      send(res, status, { ok: false, error: { code: e.code || 'internal', message: status === 500 ? 'Internal server error' : e.message, ...(e.field ? { field: e.field } : {}) } });
    }
  }

  const fileCache = new Map(); // path -> { mtimeMs, etag, raw, gz, br }
  async function serveStatic(req, res, url) {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = normalize(join(config.publicDir, rel));
    if (file !== config.publicDir.replace(/[\\/]$/, '') && !file.startsWith(config.publicDir.endsWith(sep) ? config.publicDir : config.publicDir + sep)) { res.writeHead(403); return res.end(); }
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      const ext = extname(file).toLowerCase();
      let entry = fileCache.get(file);
      if (!entry || entry.mtimeMs !== st.mtimeMs) {
        const raw = await readFile(file);
        entry = { mtimeMs: st.mtimeMs, raw, etag: `"${createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"` };
        if (COMPRESSIBLE.has(ext) && raw.length > 512) { [entry.br, entry.gz] = await Promise.all([br(raw), gz(raw)]); }
        fileCache.set(file, entry);
      }
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream', ETag: entry.etag, Vary: 'Accept-Encoding', ...SECURITY_HEADERS,
        // Revalidate always (cheap 304s): no stale UI after a deploy, no build-time hashing needed.
        'Cache-Control': 'no-cache',
      };
      if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); return res.end(); }
      const ae = req.headers['accept-encoding'] || '';
      let payload = entry.raw;
      if (entry.br && /\bbr\b/.test(ae)) { payload = entry.br; headers['Content-Encoding'] = 'br'; }
      else if (entry.gz && /\bgzip\b/.test(ae)) { payload = entry.gz; headers['Content-Encoding'] = 'gzip'; }
      headers['Content-Length'] = payload.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : payload);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Not found');
    }
  }

  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    return serveStatic(req, res, url);
  };
}

export function buildServices(config) {
  const store = createStore({ dir: config.dataDir });
  if (config.cloudpanel.mode === 'mock' && config.billing.mode === 'mock') seedIfEmpty(store);
  const cloudpanel = createCloudPanel({ config, store });
  const billing = createBilling({ config, store });
  const jobs = createJobs({ store });
  return { config, store, cloudpanel, billing, jobs };
}

/* ---------- entrypoint ---------- */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const config = loadConfig();
  const problems = validateConfig(config);
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(config.host);
  if (!loopback && !config.adminToken) problems.push('LRWEB_ADMIN_TOKEN is required when LRWEB_HOST is not a loopback address');
  if (problems.length) {
    console.error(`\nLRWeb Console cannot start:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exit(1);
  }
  const services = buildServices(config);
  const server = http.createServer(createApp(services));
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.listen(config.port, config.host, () => {
    console.log(`\n  LRWeb Console ${VERSION}\n  → http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`);
    console.log(`  CloudPanel: ${config.cloudpanel.mode}   Billing: ${config.billing.mode}   Auth: ${config.adminToken ? 'token required' : 'open (loopback only)'}\n`);
  });
  const stop = () => { services.store.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
