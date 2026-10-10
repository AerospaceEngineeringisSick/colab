// Team accounts: per-person sign-in, roles, sessions, lockout and an audit trail. Zero dependencies.
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ValidationError, randomPassword } from './validate.mjs';

const ROLES = ['owner', 'admin', 'member'];
const MANAGERS = ['owner', 'admin'];
const USERNAME_RE = /^[a-z][a-z0-9._-]{2,31}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url, unpadded
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }; // 32 MiB working set
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const MAX_LOCKS = 10_000;
const TOUCH_MS = 60_000; // lastSeenAt is written at most this often
const AUDIT_MAX = 1000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const iso = (ms) => new Date(ms).toISOString();
const clip = (v, max = 200) => String(v ?? '').slice(0, max);
const obj = (v) => (v && typeof v === 'object' ? v : {});
const fail = (message, status, code, field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });
const forbidden = (message) => fail(message, 403, 'forbidden');
const notFound = (what) => fail(`${what} not found`, 404, 'not_found');
const invalidCredentials = () => fail('Wrong username or password', 401, 'invalid_credentials');
function lockedError(ms) {
  const retryAfterSec = Math.ceil(ms / 1000);
  return Object.assign(new Error(`Too many wrong attempts. Please wait ${retryAfterSec} seconds, then try again.`), { status: 429, code: 'locked', retryAfterSec });
}

// Hashes are "scrypt$N$r$p$saltB64$keyB64". Anything that does not parse strictly is treated as no match.
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function parseHash(stored) {
  if (typeof stored !== 'string') return null;
  const f = stored.split('$');
  if (f.length !== 6 || f[0] !== 'scrypt') return null;
  const [N, r, p] = f.slice(1, 4).map((x) => (/^\d{1,9}$/.test(x) ? Number(x) : NaN));
  if (!(N >= 2 && N <= 2 ** 20 && (N & (N - 1)) === 0) || !(r >= 1 && r <= 32) || !(p >= 1 && p <= 8)) return null;
  if (!B64_RE.test(f[4]) || !B64_RE.test(f[5])) return null;
  const salt = Buffer.from(f[4], 'base64');
  const hash = Buffer.from(f[5], 'base64');
  if (salt.length !== 16 || hash.length !== 32) return null;
  if (salt.toString('base64') !== f[4] || hash.toString('base64') !== f[5]) return null;
  return { N, r, p, salt, hash };
}

const DUMMY = parseHash(hashPassword(randomBytes(24).toString('base64url')));

// Always runs one scrypt, so an unknown account or a damaged hash takes as long as a real check.
function verifyPassword(stored, password) {
  const real = parseHash(stored);
  const p = real ?? DUMMY;
  let key;
  try {
    key = scryptSync(password, p.salt, p.hash.length, { N: p.N, r: p.r, p: p.p, maxmem: SCRYPT.maxmem });
  } catch {
    return false;
  }
  return real !== null && timingSafeEqual(key, p.hash);
}

function cleanUsername(raw) {
  const u = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!u) throw new ValidationError('Username is required', 'username');
  if (!USERNAME_RE.test(u)) throw new ValidationError('Username must be 3-32 characters: start with a letter, then use letters, numbers, dots, dashes or underscores', 'username');
  return u;
}

function cleanName(raw) {
  const n = typeof raw === 'string' ? raw.trim() : '';
  if (!n) throw new ValidationError('Name is required', 'name');
  if (Array.from(n).length > 80) throw new ValidationError('Name must be at most 80 characters', 'name');
  if (/\p{Cc}/u.test(n)) throw new ValidationError('Name contains invalid characters', 'name');
  return n;
}

function cleanPassword(raw, field = 'password', label = 'Password') {
  if (typeof raw !== 'string' || !raw) throw new ValidationError(`${label} is required`, field);
  const len = Array.from(raw).length;
  if (len < 12 || len > 128) throw new ValidationError(`${label} must be 12-128 characters`, field);
  return raw;
}

function cleanRole(raw) {
  if (!ROLES.includes(raw)) throw new ValidationError('Role must be owner, admin or member', 'role');
  return raw;
}

// The only user shape that leaves this module. Never add hashes or tokens to it.
const toPublic = (u) => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  createdAt: u.createdAt,
  ...(u.lastLoginAt ? { lastLoginAt: u.lastLoginAt } : {}),
  mustChangePassword: Boolean(u.mustChangePassword),
});
const actorName = (actor) => actor?.username || (actor?.local ? 'local mode' : 'admin token');
const canManage = (actor) => MANAGERS.includes(actor?.role);
const bearerOf = (req) => /^Bearer\s+(\S+)$/i.exec(req?.headers?.authorization ?? '')?.[1];
const ipOf = (req) => req?.socket?.remoteAddress ?? '';

export function createAuth({ config, store, now = () => Date.now() }) {
  const IDLE_MS = config.auth.sessionHours * 3_600_000;
  const MAX_MS = config.auth.sessionMaxDays * 86_400_000;
  const expiryOf = (createdMs, lastMs) => Math.min(lastMs + IDLE_MS, createdMs + MAX_MS);

  // Failed-login state keyed by username, whether or not the account exists, so a lock reveals nothing.
  // Kept in memory: a restart clears it.
  const locks = new Map();
  function lockLeft(name) {
    const s = locks.get(name);
    if (!s?.lockedUntil) return 0;
    const left = s.lockedUntil - now();
    if (left > 0) return left;
    locks.delete(name);
    return 0;
  }
  // Returns the lock length when this failure is the one that locks the name, else 0.
  function recordFailure(name) {
    let s = locks.get(name);
    if (!s) {
      if (locks.size >= MAX_LOCKS) evictLock();
      s = { failures: 0, lockedUntil: 0 };
      locks.set(name, s);
    }
    s.failures += 1;
    if (s.failures < MAX_FAILURES) return 0;
    s.failures = 0;
    s.lockedUntil = now() + LOCK_MS;
    return LOCK_MS;
  }
  // Drop an unlocked name first, so a flood of made-up usernames cannot clear a real lock.
  function evictLock() {
    for (const [k, s] of locks) {
      if (s.lockedUntil <= now()) {
        locks.delete(k);
        return;
      }
    }
    locks.delete(locks.keys().next().value);
  }

  const hasUsers = () => store.findOne('users', () => true) !== undefined;
  const userByName = (name) => store.findOne('users', (u) => u.username === name);
  const ownerCount = () => store.find('users', (u) => u.role === 'owner').length;

  function audit({ actor, action, target, ip, detail } = {}) {
    store.insert('audit', {
      ts: iso(now()),
      actor: clip(actor || 'system', 64),
      action: clip(action, 64),
      ...(target !== undefined ? { target: clip(target, 64) } : {}),
      ...(ip ? { ip: clip(ip, 64) } : {}),
      ...(detail ? { detail: clip(detail) } : {}),
    });
    const rows = store.all('audit');
    for (const r of rows.slice(0, Math.max(0, rows.length - AUDIT_MAX))) store.remove('audit', r.id);
  }

  function issueSession(userId) {
    const t = now();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = iso(expiryOf(t, t));
    store.insert('sessions', { tokenHash: sha256(token), userId, createdAt: iso(t), lastSeenAt: iso(t), expiresAt });
    return { token, expiresAt };
  }

  // keepHash (optional) is the one session that survives.
  function revokeSessions(userId, keepHash) {
    for (const s of store.find('sessions', (x) => x.userId === userId && x.tokenHash !== keepHash)) store.remove('sessions', s.id);
  }

  function pruneSessions() {
    const t = now();
    for (const s of store.all('sessions')) {
      if (t >= expiryOf(Date.parse(s.createdAt), Date.parse(s.lastSeenAt))) store.remove('sessions', s.id);
    }
  }

  function setupOwner({ username, name, password, ip } = {}) {
    if (hasUsers()) throw fail('Setup is already done. Sign in instead.', 409, 'already_setup');
    const u = cleanUsername(username);
    const n = cleanName(name);
    const p = cleanPassword(password);
    const row = store.insert('users', { username: u, name: n, role: 'owner', passwordHash: hashPassword(p), createdAt: iso(now()), mustChangePassword: false });
    audit({ actor: u, action: 'owner.setup', target: u, ip });
    return { user: toPublic(row), session: issueSession(row.id) };
  }

  function login({ username, password, ip } = {}) {
    if (typeof username !== 'string' || !username.trim()) throw new ValidationError('Enter your username', 'username');
    if (typeof password !== 'string' || !password) throw new ValidationError('Enter your password', 'password');
    const name = username.trim().toLowerCase();
    // Only well-formed names can be accounts, so only those are looked up and locked.
    const tracked = USERNAME_RE.test(name);
    if (tracked) {
      const left = lockLeft(name);
      if (left) throw lockedError(left);
    }
    const row = tracked ? userByName(name) : undefined;
    const ok = verifyPassword(row?.passwordHash, password);
    if (!row || !ok) {
      audit({ actor: name, action: 'login.failed', ip, detail: row ? 'wrong password' : 'no such account' });
      if (tracked && recordFailure(name)) {
        audit({ actor: name, action: 'login.locked', ip, detail: 'locked for 15 minutes' });
        throw lockedError(LOCK_MS);
      }
      throw invalidCredentials();
    }
    locks.delete(name);
    const t = iso(now());
    store.update('users', row.id, { lastLoginAt: t });
    pruneSessions();
    audit({ actor: row.username, action: 'login.success', ip });
    return { user: toPublic({ ...row, lastLoginAt: t }), session: issueSession(row.id) };
  }

  function authenticate(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
    const h = sha256(token);
    const row = store.findOne('sessions', (s) => s.tokenHash === h);
    if (!row) return null;
    const t = now();
    const created = Date.parse(row.createdAt);
    const last = Date.parse(row.lastSeenAt);
    const user = t < expiryOf(created, last) ? store.get('users', row.userId) : undefined;
    if (!user) {
      store.remove('sessions', row.id);
      return null;
    }
    if (t - last >= TOUCH_MS) store.update('sessions', row.id, { lastSeenAt: iso(t), expiresAt: iso(expiryOf(created, t)) });
    return toPublic(user);
  }

  function logout(token, { ip } = {}) {
    if (typeof token !== 'string') return;
    const h = sha256(token);
    const row = store.findOne('sessions', (s) => s.tokenHash === h);
    if (!row) return;
    store.remove('sessions', row.id);
    audit({ actor: store.get('users', row.userId)?.username ?? 'unknown', action: 'logout', ip });
  }

  function createUser(input = {}, actor, { ip } = {}) {
    if (!canManage(actor)) throw forbidden('Only an owner or admin can add people');
    const username = cleanUsername(input.username);
    const name = cleanName(input.name);
    const role = cleanRole(input.role);
    if (role === 'owner' && actor.role !== 'owner') throw forbidden('Only an owner can add another owner');
    if (userByName(username)) throw fail('That username is already taken', 409, 'username_taken', 'username');
    const oneTimePassword = randomPassword(20);
    const row = store.insert('users', { username, name, role, passwordHash: hashPassword(oneTimePassword), createdAt: iso(now()), mustChangePassword: true });
    audit({ actor: actorName(actor), action: 'user.created', target: username, ip, detail: `role: ${role}` });
    return { user: toPublic(row), oneTimePassword };
  }

  function removeUser(id, actor, { ip } = {}) {
    if (!canManage(actor)) throw forbidden('Only an owner or admin can remove people');
    const target = store.get('users', id);
    if (!target) throw notFound('User');
    if (target.role === 'owner') {
      if (actor.role !== 'owner') throw forbidden('Only an owner can remove an owner');
      if (ownerCount() <= 1) throw fail('This is the only owner, so it cannot be removed. Add another owner first.', 409, 'last_owner');
    }
    revokeSessions(target.id);
    store.remove('users', target.id);
    audit({ actor: actorName(actor), action: 'user.removed', target: target.username, ip });
  }

  function changePassword(userId, { current, next } = {}, { keepToken, ip } = {}) {
    const row = store.get('users', userId);
    if (!row) throw notFound('User');
    if (typeof current !== 'string' || !current) throw new ValidationError('Enter your current password', 'current');
    const pw = cleanPassword(next, 'next', 'New password');
    if (pw === current) throw new ValidationError('Choose a new password that is different from your current one', 'next');
    const left = lockLeft(row.username);
    if (left) throw lockedError(left);
    if (!verifyPassword(row.passwordHash, current)) {
      audit({ actor: row.username, action: 'password.failed', ip, detail: 'wrong current password' });
      if (recordFailure(row.username)) throw lockedError(LOCK_MS);
      throw new ValidationError('Your current password is wrong', 'current');
    }
    locks.delete(row.username);
    store.update('users', row.id, { passwordHash: hashPassword(pw), mustChangePassword: false });
    revokeSessions(row.id, typeof keepToken === 'string' ? sha256(keepToken) : undefined);
    audit({ actor: row.username, action: 'password.changed', ip });
  }

  function resetPassword(userId, actor, { ip } = {}) {
    if (!canManage(actor)) throw forbidden('Only an owner or admin can reset passwords');
    const target = store.get('users', userId);
    if (!target) throw notFound('User');
    if (target.role === 'owner' && actor.role !== 'owner') throw forbidden('Only an owner can reset the password of an owner');
    const oneTimePassword = randomPassword(20);
    store.update('users', target.id, { passwordHash: hashPassword(oneTimePassword), mustChangePassword: true });
    revokeSessions(target.id);
    locks.delete(target.username);
    audit({ actor: actorName(actor), action: 'password.reset', target: target.username, ip });
    return { oneTimePassword };
  }

  function recentAudit(limit = 200) {
    const n = Math.min(Math.max(Math.trunc(Number(limit)) || 200, 1), AUDIT_MAX);
    return store.all('audit').slice(-n).reverse();
  }

  return {
    hasUsers,
    setupOwner,
    login,
    authenticate,
    logout,
    listUsers: () => store.all('users').map(toPublic),
    getUser: (id) => {
      const u = store.get('users', id);
      return u ? toPublic(u) : undefined;
    },
    createUser,
    removeUser,
    changePassword,
    resetPassword,
    audit,
    recentAudit,
  };
}

// Route table from section 2 of docs/CONTRACT-v2.md. index.mjs enforces `auth` and `roles`.
export function authRoutes({ auth }) {
  return [
    {
      method: 'POST', path: '/api/auth/setup', auth: 'public', roles: undefined,
      handler: async ({ req, body }) => {
        const b = obj(body);
        return auth.setupOwner({ username: b.username, name: b.name, password: b.password, ip: ipOf(req) });
      },
    },
    {
      method: 'POST', path: '/api/auth/login', auth: 'public', roles: undefined,
      handler: async ({ req, body }) => {
        const b = obj(body);
        return auth.login({ username: b.username, password: b.password, ip: ipOf(req) });
      },
    },
    {
      method: 'POST', path: '/api/auth/logout', auth: 'account', roles: [...ROLES],
      handler: async ({ req }) => {
        auth.logout(bearerOf(req), { ip: ipOf(req) });
        return { ok: true };
      },
    },
    {
      method: 'GET', path: '/api/auth/me', auth: 'any', roles: undefined,
      handler: async ({ user }) => {
        if (user?.system) return { user: null, mode: 'token' };
        if (user?.local) return { user: null, mode: 'local' };
        return { user: auth.getUser(user?.id) ?? null, mode: 'account' };
      },
    },
    {
      method: 'POST', path: '/api/auth/password', auth: 'account', roles: [...ROLES],
      handler: async ({ req, user, body }) => {
        const b = obj(body);
        auth.changePassword(user.id, { current: b.current, next: b.next }, { keepToken: bearerOf(req), ip: ipOf(req) });
        return { ok: true };
      },
    },
    {
      method: 'GET', path: '/api/team', auth: 'account', roles: [...ROLES],
      handler: async () => auth.listUsers(),
    },
    {
      method: 'POST', path: '/api/team', auth: 'account', roles: [...MANAGERS],
      handler: async ({ req, user, body }) => {
        const b = obj(body);
        return auth.createUser({ username: b.username, name: b.name, role: b.role }, user, { ip: ipOf(req) });
      },
    },
    {
      method: 'DELETE', path: '/api/team/:id', auth: 'account', roles: [...MANAGERS],
      handler: async ({ req, params, user }) => {
        auth.removeUser(params.id, user, { ip: ipOf(req) });
        return { removed: true };
      },
    },
    {
      method: 'POST', path: '/api/team/:id/reset-password', auth: 'account', roles: [...MANAGERS],
      handler: async ({ req, params, user }) => auth.resetPassword(params.id, user, { ip: ipOf(req) }),
    },
    {
      method: 'GET', path: '/api/audit', auth: 'account', roles: [...MANAGERS],
      handler: async () => auth.recentAudit(),
    },
  ];
}
