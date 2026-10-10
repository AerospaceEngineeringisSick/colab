import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, test } from 'node:test';
import { chatRoutes, createChat } from '../chat.mjs';
import { loadConfig } from '../config.mjs';
import { createStore } from '../store.mjs';
import {
  createBundle, deriveConvId, exportPublicJwk, fingerprint, generateEncKeyPair, generateSigningKeyPair, seal,
} from '../../web/js/chat/crypto.js';

const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 10, 9, 0, 0);
const CANARY = 'PLAINTEXT-CANARY-4f9d2b: the north gate code is 0042';
const COLLECTIONS = ['servers', 'clients', 'sites', 'jobs', 'invoices', 'subscriptions', 'events', 'users', 'sessions', 'pools', 'chatKeys', 'chatMessages', 'chatMailbox', 'audit', 'meta'];

const TEAM = [
  { id: 'usr_alice', username: 'alice', name: 'Alice Example', role: 'owner', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'usr_bob', username: 'bob', name: 'Bob Example', role: 'admin', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'usr_carol', username: 'carol', name: 'Carol Example', role: 'member', createdAt: '2026-01-03T00:00:00.000Z' },
];

/* ---------- helpers ---------- */

// Stand-in for server/auth.mjs: only the two reads the relay makes.
function fakeAuth(users) {
  return {
    listUsers: () => users.map((u) => ({ ...u })),
    getUser: (id) => {
      const u = users.find((x) => x.id === id);
      return u && { ...u };
    },
  };
}

function setup({ ratePerMinute } = {}) {
  const clock = { t: T0 };
  const config = loadConfig(ratePerMinute ? { LRWEB_CHAT_RATE: String(ratePerMinute) } : {});
  const store = createStore({ memory: true });
  const users = TEAM.map((u) => ({ ...u }));
  const chat = createChat({ store, config, auth: fakeAuth(users), now: () => clock.t });
  return { chat, store, config, clock };
}

// Real identity keys. The bundle is signed by the identity key and carries a fresh encryption key.
async function bundleFor(who, createdAt = T0 - 60 * MIN, validForMs) {
  const enc = await generateEncKeyPair(true);
  return createBundle({
    userId: who.userId, signPrivateKey: who.signPrivateKey, signPublicJwk: who.signPublicJwk,
    encPublicJwk: await exportPublicJwk(enc.publicKey), now: createdAt, validForMs,
  });
}

async function identity(userId, createdAt) {
  const sign = await generateSigningKeyPair(true);
  const who = { userId, signPrivateKey: sign.privateKey, signPublicJwk: await exportPublicJwk(sign.publicKey) };
  return { ...who, bundle: await bundleFor(who, createdAt) };
}

async function cast() {
  return { alice: await identity('usr_alice'), bob: await identity('usr_bob'), carol: await identity('usr_carol') };
}

// Seals a real envelope. The sender is always among the recipients, as the protocol requires.
async function compose(clock, from, to, text, { n = 1, ttl = 0, ts } = {}) {
  const people = [from, ...to.filter((p) => p.userId !== from.userId)];
  return seal({
    message: { text }, from: from.userId, n, ttl,
    recipients: await Promise.all(people.map(async (p) => ({ userId: p.userId, bundle: p.bundle, pinnedSignFingerprint: await fingerprint(p.signPublicJwk) }))),
    signPrivateKey: from.signPrivateKey, now: ts ?? clock.t,
  });
}

const user = (id) => ({ id, role: 'member' });
const publish = (chat, who, bundle = who.bundle) => chat.putBundle(user(who.userId), bundle);
const sendAs = (chat, who, env) => chat.send(user(who.userId), env);

// Accepts a promise or a thunk, so synchronous throws (unsend, ack, ...) are caught too.
async function fails(call) {
  try {
    await (typeof call === 'function' ? call() : call);
  } catch (e) {
    return e;
  }
  assert.fail('expected the call to be rejected');
}

/* ---------- keys and directory ---------- */

describe('chat relay: keys and directory', () => {
  test('directory lists every team member, with a bundle only where one is published', async () => {
    const { chat } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const dir = chat.directory();
    assert.deepEqual(dir.map((d) => d.userId), ['usr_alice', 'usr_bob', 'usr_carol']);
    assert.deepEqual(Object.keys(dir[0]).sort(), ['bundle', 'identityVersion', 'name', 'role', 'userId', 'username']);
    assert.deepEqual(dir[0].bundle, alice.bundle);
    assert.equal(dir[0].identityVersion, 1);
    assert.equal(dir[2].bundle, null);
    assert.equal(dir[2].identityVersion, 0);
  });

  test('directory keeps a bundle that has since expired, leaving the decision to clients', async () => {
    const { chat, clock } = setup();
    const alice = await identity('usr_alice');
    await publish(chat, alice);
    clock.t = T0 + 8 * DAY;
    assert.deepEqual(chat.directory()[0].bundle, alice.bundle);
  });

  test('first publish is version 1; same identity keeps it; a new identity bumps it and flags the change', async () => {
    const { chat } = setup();
    const alice = await identity('usr_alice', T0 - 60 * MIN);
    assert.deepEqual(await publish(chat, alice), { ok: true, identityVersion: 1, identityChanged: false });

    const rotated = await bundleFor(alice, T0 - 30 * MIN);
    assert.deepEqual(await publish(chat, alice, rotated), { ok: true, identityVersion: 1, identityChanged: false });

    const newDevice = await identity('usr_alice', T0 - 20 * MIN);
    assert.deepEqual(await publish(chat, newDevice), { ok: true, identityVersion: 2, identityChanged: true });
    const alicePublic = chat.directory()[0];
    assert.equal(alicePublic.identityVersion, 2);
    assert.deepEqual(alicePublic.bundle, newDevice.bundle);
  });

  test('a bundle older than the stored one is rejected as stale', async () => {
    const { chat } = setup();
    const older = await identity('usr_alice', T0 - 60 * MIN);
    const newer = await bundleFor(older, T0 - 30 * MIN);
    await publish(chat, older, newer);
    const e = await fails(publish(chat, older));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'stale_bundle');
    // Re-sending the same bundle (equal createdAt) is harmless and accepted.
    assert.deepEqual(await publish(chat, older, newer), { ok: true, identityVersion: 1, identityChanged: false });
  });

  test('an expired bundle is rejected with the crypto code in the message', async () => {
    const { chat } = setup();
    const old = await identity('usr_alice', T0 - 8 * DAY);
    const e = await fails(publish(chat, old));
    assert.equal(e.status, 400);
    assert.equal(e.code, 'bad_bundle');
    assert.match(e.message, /bundle_expired/);
    assert.equal(chat.directory()[0].bundle, null);
  });

  test('a forged bundle is rejected', async () => {
    const { chat } = setup();
    const alice = await identity('usr_alice');
    const forged = await fails(publish(chat, alice, { ...alice.bundle, createdAt: alice.bundle.createdAt + 1000 }));
    assert.equal(forged.status, 400);
    assert.equal(forged.code, 'bad_bundle');
    assert.match(forged.message, /bad_signature/);
    const missing = await fails(publish(chat, alice, null));
    assert.equal(missing.code, 'bad_bundle');
  });

  test('a bundle can only be published for your own account', async () => {
    const { chat } = setup();
    const alice = await identity('usr_alice');
    const e = await fails(chat.putBundle(user('usr_bob'), alice.bundle));
    assert.equal(e.status, 403);
    assert.equal(e.code, 'forbidden');
  });
});

/* ---------- sending and reading ---------- */

describe('chat relay: sending and reading', () => {
  test('send stores one envelope and one mailbox row per recipient, the sender included', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob, carol } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    await publish(chat, carol);
    const env = await compose(clock, alice, [bob, carol], 'hello');
    const sent = await sendAs(chat, alice, env);
    assert.equal(sent.id, env.header.id);

    const messages = store.all('chatMessages');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].from, 'usr_alice');
    const rows = store.all('chatMailbox');
    assert.deepEqual(rows.map((r) => r.userId).sort(), ['usr_alice', 'usr_bob', 'usr_carol']);
    assert.ok(rows.every((r) => r.messageId === env.header.id));
    assert.equal(rows.find((r) => r.userId === 'usr_alice').seq, sent.seq);
  });

  test('recipients read their own copy in order, and the cursor skips what was already read', async () => {
    const { chat, clock } = setup();
    const { alice, bob, carol } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    await publish(chat, carol);
    const first = await compose(clock, alice, [bob], 'one', { n: 1 });
    const second = await compose(clock, alice, [bob, carol], 'two', { n: 2 });
    const a = await sendAs(chat, alice, first);
    const b = await sendAs(chat, alice, second);

    // Each recipient's seq is their own mailbox position, so read them from their inbox, not from the sender's result.
    const bobInbox = chat.inbox(user('usr_bob'));
    assert.deepEqual(bobInbox.items.map((i) => i.envelope), [first, second]);
    assert.ok(bobInbox.items[0].seq < bobInbox.items[1].seq);
    assert.equal(bobInbox.next, bobInbox.items[1].seq);
    assert.deepEqual(chat.inbox(user('usr_bob'), { after: bobInbox.items[0].seq }).items.map((i) => i.envelope), [second]);
    assert.deepEqual(chat.inbox(user('usr_bob'), { after: bobInbox.next }), { items: [], next: bobInbox.next });
    assert.deepEqual(chat.inbox(user('usr_carol')).items.map((i) => i.envelope), [second]);
    assert.ok(a.seq > 0 && b.seq > a.seq);
  });

  test('the sender cannot be spoofed', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env = await compose(clock, alice, [bob], 'hi');
    const e = await fails(sendAs(chat, bob, env));
    assert.equal(e.status, 403);
    assert.equal(e.code, 'forbidden');
    assert.equal(store.all('chatMessages').length, 0);
  });

  test('a tampered envelope fails the signature check', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env = await compose(clock, alice, [bob], 'hi');

    const retimed = structuredClone(env);
    retimed.header.ts += 1;
    const e1 = await fails(sendAs(chat, alice, retimed));
    assert.equal(e1.status, 400);
    assert.equal(e1.code, 'bad_signature');

    const flipped = structuredClone(env);
    flipped.ct = (env.ct[0] === 'A' ? 'B' : 'A') + env.ct.slice(1);
    const e2 = await fails(sendAs(chat, alice, flipped));
    assert.equal(e2.code, 'bad_signature');
    assert.equal(store.all('chatMessages').length, 0);
  });

  test('recipients must be team members who have published a key, and errors name nobody', async () => {
    const { chat, clock } = setup();
    const { alice, bob, carol } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const ghost = await identity('usr_ghost');
    for (const to of [[bob, ghost], [bob, carol]]) {
      const env = await compose(clock, alice, to, 'hi');
      const e = await fails(sendAs(chat, alice, env));
      assert.equal(e.status, 400);
      assert.equal(e.code, 'unknown_recipient');
      assert.ok(!e.message.includes('usr_'), 'the error must not name a user');
    }
  });

  test('a repeated message id is a conflict', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env = await compose(clock, alice, [bob], 'once');
    await sendAs(chat, alice, env);
    const e = await fails(sendAs(chat, alice, env));
    assert.equal(e.status, 409);
    assert.equal(e.code, 'duplicate');
    assert.equal(store.all('chatMailbox').length, 2);
  });

  test('an envelope over the size limit is rejected with 413', async () => {
    const { chat, config, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env = await compose(clock, alice, [bob], 'big');
    const size = Buffer.byteLength(JSON.stringify(env));
    config.chat.maxEnvelopeBytes = size - 1;
    const e = await fails(sendAs(chat, alice, env));
    assert.equal(e.status, 413);
    assert.equal(e.code, 'too_large');
    config.chat.maxEnvelopeBytes = size;
    assert.ok((await sendAs(chat, alice, env)).seq > 0);
  });

  test('a message dated more than five minutes from the server clock is rejected', async () => {
    const { chat, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const late = await compose(clock, alice, [bob], 'late', { ts: T0 - 6 * MIN });
    const e = await fails(sendAs(chat, alice, late));
    assert.equal(e.status, 400);
    assert.equal(e.code, 'bad_timestamp');
  });

  test('a message cannot claim a conversation its participants are not part of', async () => {
    const { chat, clock } = setup();
    const { alice, bob, carol } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    await publish(chat, carol);
    const env = await compose(clock, carol, [alice], 'sneaking into the alice and bob chat');
    env.header.convId = await deriveConvId(['usr_alice', 'usr_bob']);
    const e = await fails(sendAs(chat, carol, env));
    assert.equal(e.status, 400);
    assert.equal(e.code, 'bad_envelope');
  });

  test('the rate limit returns 429 and recovers after a minute', async () => {
    const { chat, clock } = setup({ ratePerMinute: 5 });
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    for (let i = 1; i <= 5; i++) await sendAs(chat, alice, await compose(clock, alice, [bob], `m${i}`, { n: i }));
    const e = await fails(sendAs(chat, alice, await compose(clock, alice, [bob], 'm6', { n: 6 })));
    assert.equal(e.status, 429);
    assert.equal(e.code, 'rate_limited');

    clock.t += MIN;
    await sendAs(chat, alice, await compose(clock, alice, [bob], 'm7', { n: 7 }));
    assert.equal(chat.inbox(user('usr_bob')).items.length, 6);
  });

  test('sequence numbers are never reused, even after everyone has acked', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const a = await sendAs(chat, alice, await compose(clock, alice, [bob], 'a', { n: 1 }));
    chat.ack(user('usr_alice'), a.seq);
    chat.ack(user('usr_bob'), chat.inbox(user('usr_bob')).items[0].seq);
    assert.equal(store.all('chatMailbox').length, 0);
    const b = await sendAs(chat, alice, await compose(clock, alice, [bob], 'b', { n: 2 }));
    assert.ok(b.seq > a.seq);
  });
});

/* ---------- long-poll ---------- */

describe('chat relay: long-poll', () => {
  test('wait returns at once when messages are already waiting', async () => {
    const { chat, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    await sendAs(chat, alice, await compose(clock, alice, [bob], 'ready'));
    const r = await chat.wait(user('usr_bob'), 0, 25_000);
    assert.equal(r.items.length, 1);
    assert.equal(chat.waiterCount(), 0);
  });

  test('wait resolves when a message arrives, and leaves no waiter behind', async () => {
    const { chat, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const pending = chat.wait(user('usr_bob'), 0, 25_000);
    assert.equal(chat.waiterCount(), 1);
    const env = await compose(clock, alice, [bob], 'wake up');
    await sendAs(chat, alice, env);
    const r = await pending;
    assert.equal(r.items.length, 1);
    assert.deepEqual(r.items[0].envelope, env);
    assert.equal(chat.waiterCount(), 0);
  });

  test('wait resolves empty on timeout, and leaves no waiter behind', async () => {
    const { chat } = setup();
    const r = await chat.wait(user('usr_bob'), 0, 20);
    assert.deepEqual(r, { items: [], next: 0 });
    assert.equal(chat.waiterCount(), 0);
  });

  test('wait resolves empty on abort, and a later message does not reach the dead waiter', async () => {
    const { chat, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const ac = new AbortController();
    const pending = chat.wait(user('usr_bob'), 0, 25_000, ac.signal);
    assert.equal(chat.waiterCount(), 1);
    ac.abort();
    assert.deepEqual(await pending, { items: [], next: 0 });
    assert.equal(chat.waiterCount(), 0);
    await sendAs(chat, alice, await compose(clock, alice, [bob], 'after the abort'));
    assert.equal(chat.waiterCount(), 0);
  });

  test('the long-poll timeout is capped at 25 seconds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { chat } = setup();
    let settled = false;
    const pending = chat.wait(user('usr_bob'), 0, 60_000).then((r) => {
      settled = true;
      return r;
    });
    t.mock.timers.tick(24_999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    t.mock.timers.tick(1);
    assert.deepEqual(await pending, { items: [], next: 0 });
  });

  test('the long-poll route ends when the request closes', async () => {
    const { chat } = setup();
    const inbox = chatRoutes({ chat }).find((r) => r.method === 'GET' && r.path === '/api/chat/inbox');
    const req = new EventEmitter();
    const pending = inbox.handler({ req, user: user('usr_bob'), params: {}, query: new URLSearchParams('wait=25'), body: {} });
    assert.equal(chat.waiterCount(), 1);
    req.emit('close');
    assert.deepEqual(await pending, { items: [], next: 0 });
    assert.equal(chat.waiterCount(), 0);
  });

  test('chat routes are account-only and name all three roles', () => {
    const routes = chatRoutes({ chat: {} });
    assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), [
      'GET /api/chat/directory', 'PUT /api/chat/keys', 'POST /api/chat/messages', 'GET /api/chat/inbox',
      'POST /api/chat/ack', 'DELETE /api/chat/messages/:id', 'DELETE /api/chat/me',
    ]);
    for (const r of routes) {
      assert.equal(r.auth, 'account');
      assert.deepEqual(r.roles, ['owner', 'admin', 'member']);
    }
  });
});

/* ---------- ack, unsend, wipe, purge ---------- */

describe('chat relay: ack, unsend, wipe and purge', () => {
  test('ack removes only the caller\'s rows, and the envelope goes once everyone has acked', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env1 = await compose(clock, alice, [bob], 'one', { n: 1 });
    const env2 = await compose(clock, alice, [bob], 'two', { n: 2 });
    const s1 = await sendAs(chat, alice, env1);
    const s2 = await sendAs(chat, alice, env2);

    assert.deepEqual(chat.ack(user('usr_alice'), s1.seq), { removed: 1 });
    assert.deepEqual(chat.inbox(user('usr_alice')).items.map((i) => i.seq), [s2.seq]);
    assert.equal(chat.inbox(user('usr_bob')).items.length, 2, 'bob keeps both copies');
    assert.ok(store.get('chatMessages', env1.header.id), 'bob still holds the first envelope');

    const bobFirst = chat.inbox(user('usr_bob')).items[0].seq;
    assert.deepEqual(chat.ack(user('usr_bob'), bobFirst), { removed: 1 });
    assert.equal(store.get('chatMessages', env1.header.id), undefined);
    assert.ok(store.get('chatMessages', env2.header.id));
    assert.equal(chat.inbox(user('usr_bob')).items.length, 1);
  });

  test('unsend is sender-only and removes every copy', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env = await compose(clock, alice, [bob], 'oops');
    await sendAs(chat, alice, env);

    const e = await fails(() => chat.unsend(user('usr_bob'), env.header.id));
    assert.equal(e.status, 403);
    assert.equal(e.code, 'forbidden');
    assert.deepEqual(chat.unsend(user('usr_alice'), env.header.id), { removed: true });
    assert.equal(store.all('chatMessages').length, 0);
    assert.equal(store.all('chatMailbox').length, 0);
    assert.deepEqual(chat.inbox(user('usr_bob')).items, []);
    assert.deepEqual(chat.unsend(user('usr_alice'), 'msg_missing'), { removed: false });
  });

  test('wipe removes the caller\'s rows and key, but keeps envelopes others still hold', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const env = await compose(clock, alice, [bob], 'kept');
    await sendAs(chat, alice, env);

    chat.wipe(user('usr_bob'));
    assert.equal(chat.directory().find((d) => d.userId === 'usr_bob').bundle, null);
    assert.deepEqual(chat.inbox(user('usr_bob')).items, []);
    assert.ok(store.get('chatMessages', env.header.id), 'alice still holds a copy');
  });

  test('wipe drops envelopes that nobody else holds any more', async () => {
    const { chat, store, clock } = setup();
    const { alice, carol } = await cast();
    await publish(chat, alice);
    await publish(chat, carol);
    const env = await compose(clock, alice, [carol], 'gone soon');
    await sendAs(chat, alice, env);
    chat.ack(user('usr_carol'), chat.inbox(user('usr_carol')).items[0].seq);
    assert.ok(store.get('chatMessages', env.header.id), 'alice still holds a copy');

    chat.wipe(user('usr_alice'));
    assert.equal(store.get('chatMessages', env.header.id), undefined);
    assert.equal(store.all('chatMailbox').length, 0);
  });

  test('purgeExpired honours the per-message ttl and the server ttlDays', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    const short = await compose(clock, alice, [bob], 'short', { n: 1, ttl: 30 });
    const long = await compose(clock, alice, [bob], 'long', { n: 2 });
    await sendAs(chat, alice, short);
    await sendAs(chat, alice, long);

    clock.t = T0 + 31_000;
    assert.equal(chat.purgeExpired(), 1, 'the 30 second message is gone');
    assert.deepEqual(chat.inbox(user('usr_bob')).items.map((i) => i.envelope.header.id), [long.header.id]);

    clock.t = T0 + 14 * DAY - 1;
    assert.equal(chat.purgeExpired(), 0, 'the default 14 day life has not ended yet');

    clock.t = T0 + 14 * DAY;
    assert.equal(chat.purgeExpired(), 1);
    assert.equal(store.all('chatMessages').length, 0);
    assert.equal(store.all('chatMailbox').length, 0);
  });

  test('expired envelopes are purged lazily, at most once a minute', async () => {
    const { chat, store, clock } = setup();
    const { alice, bob } = await cast();
    await publish(chat, alice);
    await publish(chat, bob);
    await sendAs(chat, alice, await compose(clock, alice, [bob], 'brief', { ttl: 1 }));
    clock.t = T0 + 10_000;
    chat.inbox(user('usr_bob'));
    assert.equal(store.all('chatMessages').length, 1, 'no purge within a minute of the last one');
    clock.t = T0 + 61_000;
    chat.inbox(user('usr_bob'));
    assert.equal(store.all('chatMessages').length, 0);
  });
});

/* ---------- plaintext ---------- */

describe('chat relay: plaintext', () => {
  test('no plaintext reaches the store, the logs or an error message', async () => {
    const logged = [];
    const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    for (const k of Object.keys(saved)) console[k] = (...args) => logged.push(args.map(String).join(' '));
    const errors = [];
    try {
      const { chat, store, clock } = setup();
      const { alice, bob, carol } = await cast();
      await publish(chat, alice);
      await publish(chat, bob);
      await publish(chat, carol);
      const env = await compose(clock, alice, [bob, carol], CANARY);
      await sendAs(chat, alice, env);
      const flipped = structuredClone(env);
      flipped.ct = (env.ct[0] === 'A' ? 'B' : 'A') + env.ct.slice(1);
      errors.push(await fails(sendAs(chat, alice, flipped)));
      errors.push(await fails(sendAs(chat, bob, env)));
      chat.inbox(user('usr_bob'));
      chat.ack(user('usr_bob'), chat.inbox(user('usr_bob')).items[0].seq);
      chat.wipe(user('usr_carol'));

      const dump = JSON.stringify(COLLECTIONS.map((c) => store.all(c)));
      assert.ok(dump.includes('usr_alice'), 'the scan sees real metadata, so it is reading the store');
      assert.ok(!dump.includes('PLAINTEXT-CANARY'), 'the store holds ciphertext only');
      assert.ok(!JSON.stringify(env).includes('PLAINTEXT-CANARY'), 'the envelope on the wire holds ciphertext only');
      assert.ok(!logged.some((l) => l.includes('PLAINTEXT-CANARY')), 'nothing was logged');
      assert.ok(!errors.some((e) => e.message.includes('PLAINTEXT-CANARY')), 'no error echoes the message');
    } finally {
      Object.assign(console, saved);
    }
  });
});
