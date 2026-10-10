// Site migration: copies a CloudPanel site to another server. The old site is never changed or deleted.
// Live mode automates only the verified clpctl steps (create site, database, certificate). File and
// database copies go into a runbook that a person runs, so no data moves without a human.
import { OPTIONS, ValidationError, isDomain, isHost, shellQuote } from './validate.mjs';

const SITE_USER_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const IDENT_RE = /^[a-z][a-z0-9_]{2,31}$/;
const SSH_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// Values made only of these characters need no quotes in the runbook. Anything else goes through shellQuote.
const PLAIN_RE = /^[A-Za-z0-9_./:=@,+-]+$/;
const READY_STATUSES = ['online', 'degraded'];
const RUNTIMES = { php: OPTIONS.phpVersions, nodejs: OPTIONS.nodejsVersions, python: OPTIONS.pythonVersions };
const RUNTIME_FIELD = { php: 'phpVersion', nodejs: 'nodejsVersion', python: 'pythonVersion' };
const TYPE_NAME = { php: 'PHP', nodejs: 'Node.js', python: 'Python', static: 'static' };
// The app port is not stored with a site, so the new site gets the same default as a fresh one.
const DEFAULT_APP_PORT = { nodejs: 3000, python: 8080 };
const NOT_ACTIVE = {
  provisioning: 'This site is still being set up, so it cannot be moved yet.',
  failed: 'This site did not finish setting up, so it cannot be moved.',
  suspended: 'This site is suspended, so it cannot be moved.',
};
const DB_SHARE = 0.1; // rough guess: a database is about a tenth of the site's disk use
const INCOMPLETE_DOWNTIME_SEC = 300; // small allowance: visitors could see a broken site until it is fixed
const RUNBOOK_DETAIL = 'Run this from the runbook';
const SSL_LATER = 'Not issued yet. DNS probably does not point at the new server yet. The runbook has the command to run after the switch.';

const now = () => new Date().toISOString();
const fail = (status, code, message, field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });
const matches = (re, v) => typeof v === 'string' && re.test(v);
const hostSpec = (host) => (host.includes(':') ? `[${host}]` : host);
const arg = (v) => (PLAIN_RE.test(v) ? v : shellQuote(v));
const flagArg = (name, value) => arg(`--${name}=${value}`);
const note = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
const serverTag = (name, host) => (host ? `${note(name)} (${note(host)})` : note(name));
const typeText = (site) => (site.type === 'static' ? 'static' : `${TYPE_NAME[site.type]} ${site.runtime}`);

function readFlag(name, value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ValidationError(`${name} must be true or false`, name);
  return value;
}

function serverNotReady(s) {
  if (s.status === 'pending') return `${s.name} is still being set up. Finish its connection check first.`;
  if (s.status === 'offline') return `${s.name} is offline, so it cannot take this site yet.`;
  return `${s.name} is not ready to take a site yet.`;
}

// Rebuilt from the source row: CloudPanel needs the same type, version, site user and domain.
function siteSpec(site) {
  const spec = { domain: site.domain, type: site.type, siteUser: site.siteUser };
  if (site.type === 'php') spec.vhostTemplate = 'Generic';
  if (RUNTIME_FIELD[site.type]) spec[RUNTIME_FIELD[site.type]] = site.runtime;
  return spec;
}

function build(ctx) {
  const { site, copyFiles, copyDatabase, dbStep, dbName, issueCertificate, srcName, tgtName, targetPort: port } = ctx;
  const copies = copyFiles || dbStep;

  const steps = [{
    key: 'prepare', label: `Create the new site on ${tgtName}`,
    detail: `Creates an empty ${typeText(site)} site for ${site.domain} on ${tgtName}. The old site is not touched.`,
    risk: 'low',
  }];
  if (dbStep) {
    steps.push({
      key: 'database', label: `Create the database on ${tgtName}`,
      detail: `Creates ${dbName} on ${tgtName} with a new password. The password is shown once, when the move finishes.`,
      risk: 'low',
    });
  }
  if (copyFiles) {
    steps.push({
      key: 'files', label: 'Copy the website files',
      detail: `Copies the site's files from ${srcName} to ${tgtName} while the old site stays live. Repeat after a short content freeze.`,
      risk: 'low',
    });
  }
  if (dbStep) {
    steps.push({
      key: 'dbcopy', label: 'Copy the database',
      detail: `Exports ${dbName} on ${srcName}, copies it across and imports it on ${tgtName}. Run it after the content freeze, so nothing is lost.`,
      risk: 'medium',
    });
  }
  steps.push({
    key: 'verify', label: 'Check the new site answers',
    detail: `Asks ${tgtName} for the site before anything is switched. Visitors are not affected.`,
    risk: 'low',
  });
  if (issueCertificate) {
    steps.push({
      key: 'ssl', label: 'Get the SSL certificate',
      detail: "Asks Let's Encrypt for a certificate on the new server. That only works once DNS points at it, so this step may be skipped and done after the switch.",
      risk: 'low',
    });
  }
  steps.push({
    key: 'cutover-ready', label: 'Ready to switch visitors',
    detail: `Everything is on ${tgtName}. Pointing DNS at it is the last step, and you do it yourself using the runbook.`,
    risk: 'high',
  });

  const warnings = [
    `Visitors keep seeing ${srcName} until you point DNS at ${tgtName}. Nothing changes for them before then.`,
    `Some visitors may keep using the old address for a while. Lower the DNS TTL for ${site.domain} a day before the switch.`,
  ];
  if (copies) {
    warnings.push(`The copies run from the old server over SSH, so the old server must be able to log in to ${tgtName} on port ${port}. Set that up before you start.`);
    warnings.push('Ask the client to pause edits to the old site during the final copy. Changes made after that copy will not reach the new site.');
  }
  if (!copyFiles) warnings.push('Files are not copied, so the new site will be empty. Copy them yourself before you switch.');
  if (site.database && !copyDatabase) warnings.push('The database is not copied, so the new site starts without it. Set it up yourself before you switch.');
  if (issueCertificate) {
    warnings.push('If the certificate cannot be issued yet, the move still completes. It is issued after the switch (see the runbook).');
  } else {
    warnings.push('No SSL certificate will be requested. Visitors may see a security warning on the new server until one is issued.');
  }
  if (DEFAULT_APP_PORT[site.type]) {
    warnings.push(`The app port is not stored with this site, so the new site uses port ${DEFAULT_APP_PORT[site.type]}. Check it matches the old site before you switch.`);
  }
  warnings.push(ctx.mock
    ? 'Demo mode: the copies are simulated, and nothing is moved between real servers.'
    : 'The new site, database and certificate are set up for you. The file and database copies are not automated, so run them from the runbook.');
  warnings.push('Keep the old site running for 7 days after the switch, in case you need to roll back.');

  const diskMb = Math.max(0, Math.round(Number(site.diskMb) || 0));
  const estimate = {
    filesMb: copyFiles ? diskMb : 0,
    dbMb: dbStep ? Math.round(diskMb * DB_SHARE) : 0,
    downtimeSec: copyFiles && (!site.database || copyDatabase) ? 0 : INCOMPLETE_DOWNTIME_SEC,
  };

  return { steps, warnings, runbook: buildRunbook(ctx), estimate };
}

function buildRunbook(ctx) {
  const { site, copyFiles, dbStep, dbName, issueCertificate, targetPort: port, targetUser: user, target } = ctx;
  const dir = `/home/${site.siteUser}/htdocs/${site.domain}`;
  const host = hostSpec(target.host);
  const dbFile = dbStep ? `/tmp/${dbName}.sql.gz` : '';
  const rsync = `rsync -azP --delete -e ${shellQuote(`ssh -p ${port}`)} ${arg(`${dir}/`)} ${arg(`${user}@${host}:${dir}/`)}`;
  const blocks = [];
  const block = (lines, commands = []) => blocks.push({ lines, commands });

  block([
    `A day before the switch, lower the DNS TTL for ${site.domain}.`,
    'TTL is how long other computers remember the old address. A short value, such as',
    '300 seconds, means the switch reaches visitors quickly. Change it in your DNS provider.',
  ]);
  if (copyFiles) {
    block([
      'On the OLD server: check the site files are where we expect them.',
      `CloudPanel keeps them in ${dir}/. Check this path on your server.`,
    ], [`ls -la ${arg(`${dir}/`)}`]);
    block([
      'On the OLD server: copy the files to the NEW server while the old site stays live.',
      'This only reads the old site, so visitors are not affected.',
    ], [rsync]);
  }
  if (copyFiles || dbStep) {
    block([
      'Content freeze: ask the client to stop making changes to the old site now.',
      'Keep it frozen until you have switched DNS (below), or later changes will be lost.',
    ]);
  }
  if (copyFiles) block(['On the OLD server: copy the files once more, now that nothing is changing.'], [rsync]);
  if (dbStep) {
    block(['On the OLD server: export the database to a file.'],
      [`sudo clpctl db:export ${flagArg('databaseName', dbName)} ${flagArg('file', dbFile)}`]);
    block(['On the OLD server: copy the export to the NEW server.'],
      [`scp -P ${port} ${arg(dbFile)} ${arg(`${user}@${host}:${dbFile}`)}`]);
    block(['On the NEW server, after logging in: import the export into the database the move created.'],
      [`sudo clpctl db:import ${flagArg('databaseName', dbName)} ${flagArg('file', dbFile)}`]);
  }
  block([
    'From any computer: check the new site answers at its server address.',
    'This does not touch DNS, so visitors are not affected. Expect 200, or a redirect to https.',
    'Anything else: stop and check before you switch.',
  ], [`curl -sS -o /dev/null -w '%{http_code}\\n' -H ${shellQuote(`Host: ${site.domain}`)} ${arg(`http://${host}/`)}`]);
  block([
    `The switch: point the DNS record for ${site.domain} at the NEW server (${note(ctx.tgtName)}, ${host}).`,
    'Visitors start reaching the new site as DNS catches up. From now on, make changes on the NEW site only.',
    'If this domain is served through a load balancer pool, move the traffic on the Traffic page instead.',
  ]);
  if (issueCertificate) {
    block([
      "On the NEW server: get the SSL certificate. Let's Encrypt only works once the domain points at the new server.",
      `Check first: dig +short ${site.domain} should show the new server's address.`,
      'If the command fails, wait for DNS to update, then run it again.',
    ], [`sudo clpctl lets-encrypt:install:certificate ${flagArg('domainName', site.domain)}`]);
  }
  if (dbStep) {
    block(['Clean up: delete the database export on both servers once the new site works. It holds customer data.'], [
      '# On the OLD server:', `rm -f ${arg(dbFile)}`,
      '# On the NEW server:', `rm -f ${arg(dbFile)}`,
    ]);
  }
  block([
    'Keep the old site running for 7 days after the switch, in case you need to roll back.',
    'To roll back, point the DNS record back at the old server. Only delete the old site',
    'after 7 days, and only once the new one is working.',
  ]);

  const header = [
    '#!/usr/bin/env bash',
    `# LRWeb site move runbook: ${note(site.domain)}`,
    `# Old server: ${serverTag(ctx.srcName, ctx.srcHost)}`,
    `# New server: ${serverTag(ctx.tgtName, target.host)}`,
    '#',
    '# Nothing here runs by itself. Run each step in order, and check it worked before the next.',
    '# The move never changes or deletes the old site.',
    '# Passwords are not written here. The site user password (<SITE_USER_PASSWORD>) and the',
    '# database password (<DB_PASSWORD>) were shown once when the move finished.',
  ];
  const body = blocks.flatMap((b, i) => [
    '',
    `# ${i + 1}. ${b.lines[0]}`,
    ...b.lines.slice(1).map((l) => `#    ${l}`),
    ...b.commands,
  ]);
  return [...header, ...body, ''].join('\n');
}

export function createMigrator({ store, cloudpanel, jobs, config }) {
  const isMock = () => config.cloudpanel.mode === 'mock';
  const simulated = (text) => (isMock() ? `${text} (simulated)` : text);
  const pause = () => {
    const ms = Math.max(0, Number(config.demoDelayMs) || 0);
    return ms ? new Promise((done) => setTimeout(done, ms)) : undefined;
  };

  /** Checks a move request and returns the context that build() and run() use. Throws plain-English errors. */
  function checkMove(siteId, opts) {
    const body = opts && typeof opts === 'object' ? opts : {};
    const site = typeof siteId === 'string' ? store.get('sites', siteId) : undefined;
    if (!site) throw fail(404, 'not_found', 'Site not found');
    if (site.status !== 'active') throw fail(409, 'site_not_active', NOT_ACTIVE[site.status] ?? 'Only active sites can be moved.');
    if (site.type === 'reverse-proxy') {
      throw fail(409, 'unsupported_type', 'Reverse proxy sites cannot be moved automatically yet, because their target address is not stored with the site.');
    }
    const copyFiles = readFlag('copyFiles', body.copyFiles, true);
    const copyDatabase = readFlag('copyDatabase', body.copyDatabase, true);
    const issueCertificate = readFlag('issueCertificate', body.issueCertificate, true);

    if (typeof body.toServerId !== 'string' || !body.toServerId) {
      throw new ValidationError('Choose the server to move this site to', 'toServerId');
    }
    const target = store.get('servers', body.toServerId);
    if (!target) throw fail(404, 'not_found', 'That server was not found', 'toServerId');
    if (target.id === site.serverId) {
      throw fail(409, 'same_server', 'Pick a different server from the one the site is already on', 'toServerId');
    }
    if (!READY_STATUSES.includes(target.status)) throw fail(409, 'server_not_ready', serverNotReady(target), 'toServerId');

    // Everything below ends up in shell commands or CloudPanel calls, so it must be valid first.
    const bad = (field, message) => new ValidationError(message, field);
    if (!isDomain(site.domain)) throw bad('domain', 'This site has a domain the console cannot move. Check it on the Sites page.');
    if (!OPTIONS.siteTypes.includes(site.type)) throw bad('type', 'This site has a type the console does not recognise.');
    if (!matches(SITE_USER_RE, site.siteUser)) throw bad('siteUser', 'This site has a site user the console cannot move. Check it on the Sites page.');
    if (site.database && !matches(IDENT_RE, site.database)) throw bad('database', 'This site has a database name the console cannot move.');
    if (RUNTIMES[site.type] && !RUNTIMES[site.type].includes(site.runtime)) {
      throw bad('runtime', `This site's version (${note(site.runtime)}) is not one the console can set up on a new server.`);
    }
    const port = target.sshPort ?? 22;
    const user = target.sshUser ?? 'lrweb';
    if (!isHost(target.host) || !Number.isInteger(port) || port < 1 || port > 65535 || !matches(SSH_USER_RE, user)) {
      throw bad('toServerId', `${note(target.name)} has connection details the console cannot use for a copy. Check them on the Servers page.`);
    }

    if (store.findOne('sites', (s) => s.migratedFrom === site.id && s.status === 'provisioning')) {
      throw fail(409, 'move_in_progress', 'A move of this site is already running. Wait for it to finish first.');
    }
    if (store.findOne('sites', (s) => s.domain === site.domain && s.serverId === target.id && s.status !== 'failed')) {
      throw fail(409, 'domain_taken', `${site.domain} already exists on ${target.name}. Remove it there first, or pick a different server.`, 'toServerId');
    }

    const source = store.get('servers', site.serverId);
    return {
      site,
      target,
      mock: isMock(),
      copyFiles,
      copyDatabase,
      issueCertificate,
      dbStep: Boolean(site.database) && copyDatabase,
      dbName: site.database,
      spec: siteSpec(site),
      srcName: source?.name ?? 'the old server',
      srcHost: source?.host ?? '',
      tgtName: target.name,
      targetPort: port,
      targetUser: user,
    };
  }

  async function copyStep(j, key, text) {
    if (!isMock()) {
      j.setStep(key, 'skipped', RUNBOOK_DETAIL);
      return;
    }
    await j.step(key, async () => {
      await pause();
      return `${text} (simulated)`;
    });
  }

  // A certificate that cannot be issued yet is expected before the DNS switch, so it skips the step rather than failing the move.
  async function issueSsl(j, serverId, domain) {
    j.setStep('ssl', 'running');
    try {
      const result = await cloudpanel.issueCertificate(serverId, domain);
      if (result?.issued) {
        j.setStep('ssl', 'done', simulated('Certificate issued'));
        return 'active';
      }
    } catch {
      // Falls through to the skipped step below.
    }
    j.setStep('ssl', 'skipped', SSL_LATER);
    return 'pending';
  }

  async function run(j, ctx, built, row) {
    const { site, target } = ctx;
    j.result({ runbook: built.runbook, targetSiteId: row.id, targetServerId: target.id });
    let ssl = 'none';
    try {
      await j.step('prepare', async () => {
        const creds = await cloudpanel.createSite(target.id, ctx.spec);
        if (creds?.siteUserPassword) j.secret('siteUserPassword', creds.siteUserPassword);
        return simulated(`Created on ${target.name}`);
      });
      if (ctx.dbStep) {
        await j.step('database', async () => {
          const db = await cloudpanel.createDatabase(target.id, { domain: site.domain, dbName: ctx.dbName, dbUser: ctx.dbName });
          if (db?.dbUser) j.secret('dbUser', db.dbUser);
          if (db?.dbPassword) j.secret('dbPassword', db.dbPassword);
          return simulated(`${ctx.dbName} created on ${target.name}`);
        });
      }
      if (ctx.copyFiles) await copyStep(j, 'files', 'Website files copied');
      if (ctx.dbStep) await copyStep(j, 'dbcopy', 'Database copied');
      await copyStep(j, 'verify', 'New site checked');
      if (ctx.issueCertificate) ssl = await issueSsl(j, target.id, site.domain);
      await j.step('cutover-ready', async () => 'Ready. The switch is the last step, and you do it yourself using the runbook.');
      store.update('sites', row.id, { status: 'active', ssl });
      store.insert('events', { ts: now(), kind: 'site', text: `Migrated ${site.domain} to ${target.name}, ready to switch` });
    } catch (e) {
      store.update('sites', row.id, { status: 'failed' });
      throw e;
    }
  }

  return {
    plan(siteId, opts) {
      return build(checkMove(siteId, opts));
    },

    start(siteId, opts) {
      const ctx = checkMove(siteId, opts);
      const built = build(ctx);
      // The target row goes in before the job starts, so a second request sees it straight away.
      const row = store.insert('sites', {
        domain: ctx.site.domain, serverId: ctx.target.id, clientId: ctx.site.clientId ?? '', type: ctx.site.type,
        runtime: ctx.site.runtime ?? '', siteUser: ctx.site.siteUser, status: 'provisioning', ssl: 'none',
        database: ctx.dbStep ? ctx.dbName : '', diskMb: ctx.site.diskMb ?? 0, createdAt: now(), migratedFrom: ctx.site.id,
      });
      return jobs.start(
        { kind: 'site.migrate', steps: built.steps.map(({ key, label }) => ({ key, label })) },
        (j) => run(j, ctx, built, row),
      );
    },
  };
}

export function migrateRoutes({ migrator }) {
  return [
    { method: 'POST', path: '/api/sites/:id/migrate/plan', auth: 'any', roles: undefined, handler: async ({ params, body }) => migrator.plan(params.id, body) },
    { method: 'POST', path: '/api/sites/:id/migrate', auth: 'any', roles: undefined, handler: async ({ params, body }) => migrator.start(params.id, body) },
  ];
}
