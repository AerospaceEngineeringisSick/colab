import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authRoutes, createAuth } from '../auth.mjs';
import { loadConfig } from '../config.mjs';
import { createStore } from '../store.mjs';

const PW = 'correct horse 42';
const NEW_PW = 'a brand new pass 9';
const WRONG = 'wrong one 123456';
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse('2026-10-10T09:00:00Z');

const hashOf = (token) => createHash('sha256').update(token).digest('hex');

function setup() {
  const clock = { t: T0 };
  const store = createStore({ memory: true });
  const auth = createAuth({ config: loadConfig({}), store, now: () => clock.t });
  return { auth, store, clock, advance: (ms) => { clock.t += ms; } };
}

// A fresh install with Luke as the owner.
function withOwner() {
  const env = setup();
  const { user, session } = env.auth.setupOwner({ username: 'luke.h', name: 'Luke Harris-Platt', password: PW });
  return { ...env, owner: user, ownerToken: session.token };
}

// Auth methods are synchronous, so the error can be read straight off the throw.
function errorOf(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail('expected the call to throw');
}

const badLogin = (auth, username) => errorOf(() => auth.login({ username, password: WRONG }));
const route = (routes, method, path) => routes.find((r) => r.method === method && r.path === path);

describe('setup', () => {
  test('the first setup creates the owner and a session, then refuses with 409', () => {
    const { auth } = setup();
    assert.equal(auth.hasUsers(), false);
    const r = auth.setupOwner({ username: ' Luke.H ', name: 'Luke Harris-Platt', password: PW });
    assert.equal(r.user.username, 'luke.h');
    assert.equal(r.user.role, 'owner');
    assert.equal(auth.authenticate(r.session.token)?.username, 'luke.h');
    assert.equal(auth.hasUsers(), true);
    const e = errorOf(() => auth.setupOwner({ username: 'ralph.o', name: 'Ralph Ogilvy', password: PW }));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'already_setup');
  });

  test('public user objects carry no secret fields', () => {
    const { owner } = withOwner();
    assert.equal('passwordHash' in owner, false);
    assert.equal(owner.mustChangePassword, false);
  });
});

describe('login', () => {
  test('wrong password and unknown username get the identical error', () => {
    const { auth } = withOwner();
    const ok = auth.login({ username: 'LUKE.H', password: PW });
    assert.equal(ok.user.username, 'luke.h');
    const wrong = badLogin(auth, 'luke.h');
    const unknown = errorOf(() => auth.login({ username: 'nobody.here', password: PW }));
    for (const e of [wrong, unknown]) {
      assert.equal(e.status, 401);
      assert.equal(e.code, 'invalid_credentials');
    }
    assert.equal(wrong.message, 'Wrong username or password');
    assert.equal(unknown.message, wrong.message);
  });

  test('five wrong passwords lock the name for 15 minutes, then it recovers', () => {
    const { auth, advance } = withOwner();
    for (let i = 0; i < 4; i++) assert.equal(badLogin(auth, 'luke.h').code, 'invalid_credentials');
    const locked = badLogin(auth, 'luke.h');
    assert.equal(locked.status, 429);
    assert.equal(locked.code, 'locked');
    assert.equal(locked.retryAfterSec, 900);
    assert.match(locked.message, /900 seconds/);
    assert.equal(errorOf(() => auth.login({ username: 'luke.h', password: PW })).code, 'locked');
    advance(15 * MIN - 1000);
    assert.equal(errorOf(() => auth.login({ username: 'luke.h', password: PW })).code, 'locked');
    advance(1000);
    assert.equal(auth.login({ username: 'luke.h', password: PW }).user.username, 'luke.h');
  });

  test('unknown usernames lock on the same schedule, so a lock reveals nothing', () => {
    const { auth } = withOwner();
    for (let i = 0; i < 4; i++) assert.equal(badLogin(auth, 'ghost.user').code, 'invalid_credentials');
    assert.equal(badLogin(auth, 'ghost.user').code, 'locked');
  });

  test('a successful sign-in resets the failure count', () => {
    const { auth } = withOwner();
    for (let i = 0; i < 4; i++) badLogin(auth, 'luke.h');
    auth.login({ username: 'luke.h', password: PW });
    for (let i = 0; i < 4; i++) assert.equal(badLogin(auth, 'luke.h').code, 'invalid_credentials');
  });

  test('a damaged password hash never matches', () => {
    const { auth, store } = withOwner();
    const row = store.findOne('users', (u) => u.username === 'luke.h');
    store.update('users', row.id, { passwordHash: 'scrypt$32768$8$1$AAAA$AAAA' });
    assert.equal(errorOf(() => auth.login({ username: 'luke.h', password: PW })).code, 'invalid_credentials');
  });
});

describe('sessions', () => {
  test('sliding idle expiry: 12 idle hours ends a session, but use keeps it alive', () => {
    const { auth, advance } = withOwner();
    const { token } = auth.login({ username: 'luke.h', password: PW }).session;
    advance(11 * HOUR);
    assert.equal(auth.authenticate(token)?.username, 'luke.h');
    advance(11 * HOUR);
    assert.equal(auth.authenticate(token)?.username, 'luke.h');
    advance(13 * HOUR);
    assert.equal(auth.authenticate(token), null);
  });

  test('absolute limit: seven days ends a session even while it is used', () => {
    const { auth, advance } = withOwner();
    const { token } = auth.login({ username: 'luke.h', password: PW }).session;
    for (let i = 0; i < 15; i++) {
      advance(11 * HOUR);
      assert.ok(auth.authenticate(token));
    }
    advance(11 * HOUR);
    assert.equal(auth.authenticate(token), null);
  });

  test('lastSeenAt is written at most once a minute', () => {
    const { auth, store, advance } = withOwner();
    const { token } = auth.login({ username: 'luke.h', password: PW }).session;
    const row = () => store.findOne('sessions', (s) => s.tokenHash === hashOf(token));
    const created = row().lastSeenAt;
    advance(30_000);
    auth.authenticate(token);
    assert.equal(row().lastSeenAt, created);
    advance(31_000);
    auth.authenticate(token);
    assert.notEqual(row().lastSeenAt, created);
  });

  test('expired sessions are deleted when they are checked', () => {
    const { auth, store, advance } = withOwner();
    const { token } = auth.login({ username: 'luke.h', password: PW }).session;
    advance(13 * HOUR);
    assert.equal(auth.authenticate(token), null);
    assert.equal(store.find('sessions', (s) => s.tokenHash === hashOf(token)).length, 0);
  });

  test('only a hash of each token is stored, and no password reaches users or audit', () => {
    const { auth, store } = withOwner();
    const { token } = auth.login({ username: 'luke.h', password: PW }).session;
    const sessions = JSON.stringify(store.all('sessions'));
    assert.equal(sessions.includes(token), false);
    assert.equal(sessions.includes(hashOf(token)), true);
    assert.equal(JSON.stringify(store.all('users')).includes('scrypt$'), true);
    assert.equal(JSON.stringify(store.all('users')).includes(PW), false);
    assert.equal(JSON.stringify(store.all('audit')).includes(PW), false);
  });

  test('logout ends that session only, and malformed tokens are refused', () => {
    const { auth } = withOwner();
    const a = auth.login({ username: 'luke.h', password: PW }).session.token;
    const b = auth.login({ username: 'luke.h', password: PW }).session.token;
    auth.logout(a);
    assert.equal(auth.authenticate(a), null);
    assert.equal(auth.authenticate(b)?.username, 'luke.h');
    assert.equal(auth.authenticate('short'), null);
    assert.equal(auth.authenticate(undefined), null);
  });
});

describe('team rules', () => {
  test('only owners and admins add people, and admins cannot add owners', () => {
    const { auth, owner } = withOwner();
    const { user: ada } = auth.createUser({ username: 'ada.l', name: 'Ada Lovelace', role: 'admin' }, owner);
    const { user: mo } = auth.createUser({ username: 'mo.m', name: 'Mo Morgan', role: 'member' }, ada);
    assert.equal(mo.role, 'member');
    assert.equal(errorOf(() => auth.createUser({ username: 'x.y', name: 'Xavier', role: 'member' }, mo)).status, 403);
    assert.equal(errorOf(() => auth.createUser({ username: 'boss.two', name: 'Boss', role: 'owner' }, ada)).status, 403);
    assert.equal(auth.createUser({ username: 'boss.two', name: 'Boss', role: 'owner' }, owner).user.role, 'owner');
  });

  test('admins cannot remove or reset an owner', () => {
    const { auth, owner } = withOwner();
    const { user: ada } = auth.createUser({ username: 'ada.l', name: 'Ada Lovelace', role: 'admin' }, owner);
    assert.equal(errorOf(() => auth.removeUser(owner.id, ada)).status, 403);
    assert.equal(errorOf(() => auth.resetPassword(owner.id, ada)).status, 403);
  });

  test('the last owner can never be removed, not even by themselves', () => {
    const { auth, owner } = withOwner();
    const e = errorOf(() => auth.removeUser(owner.id, owner));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'last_owner');
    const { user: second } = auth.createUser({ username: 'ralph.o', name: 'Ralph Ogilvy', role: 'owner' }, owner);
    auth.removeUser(owner.id, second);
    assert.equal(errorOf(() => auth.removeUser(second.id, second)).code, 'last_owner');
    assert.deepEqual(auth.listUsers().map((u) => u.username), ['ralph.o']);
  });

  test('usernames are unique', () => {
    const { auth, owner } = withOwner();
    const e = errorOf(() => auth.createUser({ username: 'luke.h', name: 'Copy', role: 'member' }, owner));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'username_taken');
    assert.equal(e.field, 'username');
  });

  test('removing someone signs them out everywhere', () => {
    const { auth, owner } = withOwner();
    const { user: mo, oneTimePassword } = auth.createUser({ username: 'mo.m', name: 'Mo Morgan', role: 'member' }, owner);
    const { token } = auth.login({ username: 'mo.m', password: oneTimePassword }).session;
    auth.removeUser(mo.id, owner);
    assert.equal(auth.authenticate(token), null);
    assert.equal(auth.getUser(mo.id), undefined);
    assert.equal(errorOf(() => auth.login({ username: 'mo.m', password: oneTimePassword })).code, 'invalid_credentials');
  });
});

describe('passwords', () => {
  test('changing the password keeps this session and signs out the others', () => {
    const { auth, owner, ownerToken } = withOwner();
    const here = auth.login({ username: 'luke.h', password: PW }).session.token;
    const elsewhere = auth.login({ username: 'luke.h', password: PW }).session.token;
    auth.changePassword(owner.id, { current: PW, next: NEW_PW }, { keepToken: here });
    assert.equal(auth.authenticate(here)?.username, 'luke.h');
    assert.equal(auth.authenticate(elsewhere), null);
    assert.equal(auth.authenticate(ownerToken), null);
    assert.equal(errorOf(() => auth.login({ username: 'luke.h', password: PW })).code, 'invalid_credentials');
    assert.equal(auth.login({ username: 'luke.h', password: NEW_PW }).user.username, 'luke.h');
  });

  test('a wrong current password is refused and counts toward the lockout', () => {
    const { auth, owner } = withOwner();
    for (let i = 0; i < 4; i++) {
      const e = errorOf(() => auth.changePassword(owner.id, { current: WRONG, next: NEW_PW }));
      assert.equal(e.status, 400);
      assert.equal(e.field, 'current');
    }
    assert.equal(errorOf(() => auth.changePassword(owner.id, { current: WRONG, next: NEW_PW })).code, 'locked');
    assert.equal(errorOf(() => auth.changePassword(owner.id, { current: PW, next: NEW_PW })).code, 'locked');
  });

  test('the new password must differ from the current one and be 12-128 characters', () => {
    const { auth, owner } = withOwner();
    let e = errorOf(() => auth.changePassword(owner.id, { current: PW, next: PW }));
    assert.equal(e.status, 400);
    assert.equal(e.field, 'next');
    e = errorOf(() => auth.changePassword(owner.id, { current: PW, next: 'x'.repeat(11) }));
    assert.equal(e.field, 'next');
    e = errorOf(() => auth.changePassword(owner.id, { current: PW, next: 'x'.repeat(129) }));
    assert.equal(e.field, 'next');
  });

  test('a new person gets a one-time password that must be changed on first use', () => {
    const { auth, owner, store } = withOwner();
    const { user, oneTimePassword } = auth.createUser({ username: 'mo.m', name: 'Mo Morgan', role: 'member' }, owner);
    assert.equal(oneTimePassword.length, 20);
    assert.equal(user.mustChangePassword, true);
    assert.equal(JSON.stringify(store.all('users')).includes(oneTimePassword), false);
    assert.equal(auth.login({ username: 'mo.m', password: oneTimePassword }).user.mustChangePassword, true);
    auth.changePassword(user.id, { current: oneTimePassword, next: NEW_PW });
    assert.equal(auth.getUser(user.id).mustChangePassword, false);
    assert.equal(auth.login({ username: 'mo.m', password: NEW_PW }).user.mustChangePassword, false);
  });

  test('an admin reset gives a new one-time password and signs the person out', () => {
    const { auth, owner } = withOwner();
    const { user: mo, oneTimePassword: first } = auth.createUser({ username: 'mo.m', name: 'Mo Morgan', role: 'member' }, owner);
    const { token } = auth.login({ username: 'mo.m', password: first }).session;
    const { oneTimePassword: second } = auth.resetPassword(mo.id, owner);
    assert.notEqual(second, first);
    assert.equal(auth.authenticate(token), null);
    assert.equal(errorOf(() => auth.login({ username: 'mo.m', password: first })).code, 'invalid_credentials');
    assert.equal(auth.login({ username: 'mo.m', password: second }).user.mustChangePassword, true);
    assert.equal(auth.getUser(mo.id).mustChangePassword, true);
  });
});

describe('validation', () => {
  test('usernames: 3-32 characters, starting with a letter, lower-cased', () => {
    const { auth, owner } = withOwner();
    for (const bad of ['', 'ab', 'a'.repeat(33), '9lives', 'bad name', 'x@y.com']) {
      const e = errorOf(() => auth.createUser({ username: bad, name: 'Test', role: 'member' }, owner));
      assert.equal(e.status, 400, bad);
      assert.equal(e.code, 'validation');
      assert.equal(e.field, 'username');
    }
    assert.equal(auth.createUser({ username: '  ABC  ', name: 'Test', role: 'member' }, owner).user.username, 'abc');
    assert.equal(auth.createUser({ username: 'a'.repeat(32), name: 'Long', role: 'member' }, owner).user.username, 'a'.repeat(32));
  });

  test('names: 1-80 characters with no control characters', () => {
    const { auth, owner } = withOwner();
    for (const bad of ['', '   ', 'x'.repeat(81), 'Bad\u0007Name']) {
      const e = errorOf(() => auth.createUser({ username: 'ok.name', name: bad, role: 'member' }, owner));
      assert.equal(e.status, 400);
      assert.equal(e.field, 'name');
    }
  });

  test('passwords: 12-128 characters', () => {
    const e = errorOf(() => setup().auth.setupOwner({ username: 'luke.h', name: 'Luke', password: 'x'.repeat(11) }));
    assert.equal(e.status, 400);
    assert.equal(e.field, 'password');
  });

  test('roles: only owner, admin or member', () => {
    const { auth, owner } = withOwner();
    const e = errorOf(() => auth.createUser({ username: 'mo.m', name: 'Mo', role: 'superuser' }, owner));
    assert.equal(e.status, 400);
    assert.equal(e.field, 'role');
  });
});

describe('audit', () => {
  test('records sign-ins, sign-outs, team and password events, newest first, never a password', () => {
    const { auth, store, owner } = withOwner();
    badLogin(auth, 'luke.h');
    const { session } = auth.login({ username: 'luke.h', password: PW, ip: '203.0.113.7' });
    auth.createUser({ username: 'mo.m', name: 'Mo Morgan', role: 'member' }, owner);
    auth.logout(session.token, { ip: '203.0.113.7' });
    assert.deepEqual(auth.recentAudit().map((e) => e.action), ['logout', 'user.created', 'login.success', 'login.failed', 'owner.setup']);
    assert.equal(auth.recentAudit()[2].ip, '203.0.113.7');
    const dump = JSON.stringify(store.all('audit'));
    assert.equal(dump.includes(PW), false);
    assert.equal(dump.includes(WRONG), false);
  });

  test('keeps only the newest 1000 rows', () => {
    const { auth, store } = withOwner();
    for (let i = 0; i < 1000; i++) auth.audit({ actor: 'test', action: `event ${i}` });
    const rows = store.all('audit');
    assert.equal(rows.length, 1000);
    assert.equal(rows[0].action, 'event 0');
    assert.equal(auth.recentAudit(1)[0].action, 'event 999');
  });
});

describe('routes', () => {
  test('lists the account routes with their auth levels and roles', () => {
    const routes = authRoutes({ auth: setup().auth });
    assert.deepEqual(routes.map((r) => [r.method, r.path, r.auth, r.roles ?? null]), [
      ['POST', '/api/auth/setup', 'public', null],
      ['POST', '/api/auth/login', 'public', null],
      ['POST', '/api/auth/logout', 'account', ['owner', 'admin', 'member']],
      ['GET', '/api/auth/me', 'any', null],
      ['POST', '/api/auth/password', 'account', ['owner', 'admin', 'member']],
      ['GET', '/api/team', 'account', ['owner', 'admin', 'member']],
      ['POST', '/api/team', 'account', ['owner', 'admin']],
      ['DELETE', '/api/team/:id', 'account', ['owner', 'admin']],
      ['POST', '/api/team/:id/reset-password', 'account', ['owner', 'admin']],
      ['GET', '/api/audit', 'account', ['owner', 'admin']],
    ]);
  });

  test('/api/auth/me reports token, local and account modes', async () => {
    const { auth, owner } = withOwner();
    const me = route(authRoutes({ auth }), 'GET', '/api/auth/me').handler;
    assert.deepEqual(await me({ user: { id: 'x', username: 'admin', role: 'owner', system: true } }), { user: null, mode: 'token' });
    assert.deepEqual(await me({ user: { id: 'local', role: 'owner', local: true } }), { user: null, mode: 'local' });
    const r = await me({ user: owner });
    assert.equal(r.mode, 'account');
    assert.equal(r.user.username, 'luke.h');
  });

  test('setup refuses once a user exists, and the routes pass the client address and caller token through', async () => {
    const { auth, owner } = withOwner();
    const routes = authRoutes({ auth });
    const req = { socket: { remoteAddress: '203.0.113.7' }, headers: {} };
    await assert.rejects(route(routes, 'POST', '/api/auth/setup').handler({ req, body: { username: 'ralph.o', name: 'Ralph', password: PW } }), { status: 409 });

    const { session } = await route(routes, 'POST', '/api/auth/login').handler({ req, body: { username: 'luke.h', password: PW } });
    assert.equal(auth.recentAudit(1)[0].ip, '203.0.113.7');

    const other = auth.login({ username: 'luke.h', password: PW }).session.token;
    const here = { ...req, headers: { authorization: `Bearer ${session.token}` } };
    const result = await route(routes, 'POST', '/api/auth/password').handler({ req: here, user: owner, body: { current: PW, next: NEW_PW } });
    assert.deepEqual(result, { ok: true });
    assert.equal(auth.authenticate(session.token)?.username, 'luke.h');
    assert.equal(auth.authenticate(other), null);
  });
});
