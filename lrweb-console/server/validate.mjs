// Strict input validation + shell-safety helpers. Every value that can reach a shell or an
// upstream API must pass through here first.
import { randomInt } from 'node:crypto';

// Mirror what your CloudPanel version actually offers (Admin > Vhost Templates, site wizard).
export const OPTIONS = {
  siteTypes: ['php', 'nodejs', 'static', 'python', 'reverse-proxy'],
  phpVersions: ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
  nodejsVersions: ['22', '20', '18'],
  pythonVersions: ['3.13', '3.12', '3.11', '3.10', '3.9'],
  vhostTemplates: ['Generic', 'WordPress'],
  osOptions: [
    { value: 'ubuntu-24.04', label: 'Ubuntu 24.04 LTS' },
    { value: 'ubuntu-22.04', label: 'Ubuntu 22.04 LTS' },
    { value: 'debian-12', label: 'Debian 12' },
    { value: 'debian-11', label: 'Debian 11' },
  ],
  // Values for the installer's DB_ENGINE variable. Verify against the current CloudPanel docs.
  dbEngines: [
    { value: 'MYSQL_8.4', label: 'MySQL 8.4' },
    { value: 'MYSQL_8.0', label: 'MySQL 8.0' },
    { value: 'MARIADB_11.4', label: 'MariaDB 11.4' },
    { value: 'MARIADB_10.11', label: 'MariaDB 10.11' },
  ],
};

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'validation';
    this.status = 400;
    this.field = field;
  }
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_RE = /^[0-9a-f:]{2,39}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const SITE_USER_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const IDENT_RE = /^[a-z][a-z0-9_]{2,31}$/;

export const isDomain = (s) => typeof s === 'string' && DOMAIN_RE.test(s);
export const isHost = (s) => typeof s === 'string' && (isDomain(s) || IPV4_RE.test(s) || (s.includes(':') && IPV6_RE.test(s)));
export const isEmail = (s) => typeof s === 'string' && s.length <= 320 && EMAIL_RE.test(s);

/** POSIX single-quote escaping: safe to splice into a remote shell command line. */
export const shellQuote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

const pick = (v, list, field, label) => {
  if (!list.includes(v)) throw new ValidationError(`${label} must be one of: ${list.join(', ')}`, field);
  return v;
};
const str = (v, field, { min = 1, max = 200, label = field } = {}) => {
  if (typeof v !== 'string') throw new ValidationError(`${label} is required`, field);
  const t = v.trim();
  if (t.length < min) throw new ValidationError(`${label} is required`, field);
  if (t.length > max) throw new ValidationError(`${label} must be at most ${max} characters`, field);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) throw new ValidationError(`${label} contains invalid characters`, field);
  return t;
};

/** Derive a valid CloudPanel site user from a domain ("shop.acme-roasters.com" -> "shopacmeroasters"). */
export function deriveSiteUser(domain) {
  let u = domain.split('.').slice(0, -1).join('').replace(/[^a-z0-9]/g, '').slice(0, 24);
  if (!/^[a-z]/.test(u)) u = `u${u}`;
  while (u.length < 3) u += 'x';
  return u;
}
export const deriveDbName = (siteUser) => `${siteUser}_db`.slice(0, 32);

export function parseServerInput(input = {}) {
  const host = str(input.host, 'host', { label: 'Host' }).toLowerCase();
  if (!isHost(host)) throw new ValidationError('Host must be a hostname or IP address', 'host');
  const sshPort = input.sshPort == null || input.sshPort === '' ? 22 : Number(input.sshPort);
  if (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535) throw new ValidationError('SSH port must be 1-65535', 'sshPort');
  const sshUser = input.sshUser == null || input.sshUser === '' ? 'lrweb' : str(input.sshUser, 'sshUser', { label: 'SSH user', max: 32 });
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(sshUser)) throw new ValidationError('SSH user must be a valid Linux username', 'sshUser');
  return {
    name: str(input.name, 'name', { label: 'Name', max: 60 }),
    host,
    sshPort,
    sshUser,
    os: pick(input.os ?? 'ubuntu-24.04', OPTIONS.osOptions.map((o) => o.value), 'os', 'OS'),
    provider: input.provider ? str(input.provider, 'provider', { max: 40 }) : '',
    region: input.region ? str(input.region, 'region', { max: 40 }) : '',
  };
}

export function parseClientInput(input = {}) {
  const email = str(input.email, 'email', { label: 'Email', max: 320 }).toLowerCase();
  if (!isEmail(email)) throw new ValidationError('Enter a valid email address', 'email');
  return {
    name: str(input.name, 'name', { label: 'Name', max: 120 }),
    email,
    company: input.company ? str(input.company, 'company', { max: 120 }) : '',
    phone: input.phone ? str(input.phone, 'phone', { max: 40 }) : '',
  };
}

/** Validates + normalises a "create site" request. */
export function parseSiteSpec(input = {}) {
  const domain = str(input.domain, 'domain', { label: 'Domain' }).toLowerCase();
  if (!isDomain(domain)) throw new ValidationError('Enter a valid domain such as example.com', 'domain');
  const type = pick(input.type ?? 'php', OPTIONS.siteTypes, 'type', 'Site type');
  const spec = {
    serverId: str(input.serverId, 'serverId', { label: 'Server', max: 40 }),
    clientId: input.clientId ? str(input.clientId, 'clientId', { max: 40 }) : '',
    domain,
    type,
    siteUser: input.siteUser ? str(input.siteUser, 'siteUser', { max: 32 }) : deriveSiteUser(domain),
    createDatabase: Boolean(input.createDatabase),
    issueCertificate: input.issueCertificate !== false,
  };
  if (!SITE_USER_RE.test(spec.siteUser)) throw new ValidationError('Site user must be 3-32 chars: a-z, 0-9, _ or -, starting with a letter', 'siteUser');
  if (type === 'php') {
    spec.phpVersion = pick(input.phpVersion ?? OPTIONS.phpVersions[1], OPTIONS.phpVersions, 'phpVersion', 'PHP version');
    spec.vhostTemplate = pick(input.vhostTemplate ?? 'Generic', OPTIONS.vhostTemplates, 'vhostTemplate', 'Vhost template');
  } else if (type === 'nodejs') {
    spec.nodejsVersion = pick(input.nodejsVersion ?? OPTIONS.nodejsVersions[0], OPTIONS.nodejsVersions, 'nodejsVersion', 'Node.js version');
    spec.appPort = parsePort(input.appPort ?? 3000, 'appPort');
  } else if (type === 'python') {
    spec.pythonVersion = pick(input.pythonVersion ?? OPTIONS.pythonVersions[1], OPTIONS.pythonVersions, 'pythonVersion', 'Python version');
    spec.appPort = parsePort(input.appPort ?? 8080, 'appPort');
  } else if (type === 'reverse-proxy') {
    const url = str(input.reverseProxyUrl, 'reverseProxyUrl', { label: 'Reverse proxy URL', max: 300 });
    let u;
    try { u = new URL(url); } catch { throw new ValidationError('Reverse proxy URL must be a valid http(s) URL', 'reverseProxyUrl'); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new ValidationError('Reverse proxy URL must be http or https', 'reverseProxyUrl');
    spec.reverseProxyUrl = u.href;
  }
  if (spec.createDatabase) {
    spec.dbName = deriveDbName(spec.siteUser);
    spec.dbUser = spec.dbName;
    if (!IDENT_RE.test(spec.dbName)) throw new ValidationError('Could not derive a valid database name; choose a different site user', 'siteUser');
  }
  return spec;
}

function parsePort(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new ValidationError('App port must be between 1024 and 65535', field);
  return n;
}

const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** Cryptographically random, shell-safe (alphanumeric) password containing upper, lower and digit. */
export function randomPassword(len = 22) {
  for (;;) {
    let p = '';
    for (let i = 0; i < len; i++) p += PW_ALPHABET[randomInt(PW_ALPHABET.length)];
    if (/[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p)) return p;
  }
}
