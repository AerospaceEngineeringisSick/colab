// LRChat client tests. Two real clients (Luke and Ralph) talk through an in-test fake relay that follows the
// section 3 contract. Everything runs on the real crypto.js and session.js; the clock is injected.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '../../web/js/chat/session.js';
import { memoryStorage } from '../../web/js/chat/storage.js';
import {
  assertEnvelopeShape, createBundle, deriveConvId, exportPublicJwk, fingerprint, generateEncKeyPair,
  generateSigningKeyPair, seal, verifyBundle, verifyEnvelopeSignature,
} from '../../web/js/chat/crypto.js';

const DAY = 86_400_000;
const LUKE = 'luke';
const RALPH = 'ralph';
const PASS = { luke: 'luke vault passphrase 2026', ralph: 'ralph vault passphrase 2026' };
const BACKUP_PASS = 'backup file passphrase 81';
const NEW_PASS = 'restored vault passphrase 42';
const WRONG_PASS = 'this is definitely not it';

const httpError = (status, code, message) => Object.assign(new Error(message), { status, code });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The fake relay. Holds what the server would hold: bundles, envelopes, per-user mailboxes. */
function createRelay(clock) {
  const bundles = new Map(); // userId -> bundle as published
  const served = new Map(); // userId -> bundle the directory serves instead (a malicious relay)
  const envelopes = new Map(); // messageId -> envelope
  const mailbox = new Map(); // userId -> [{ seq, messageId }]
  const seen = new Set();
  const names = { [LUKE]: 'Luke Harris-Platt', [RALPH]: 'Ralph Ogilvy' };
  let seqCounter = 0;
  let failNextPost = false;
  const clone = (v) => structuredClone(v);
  const box = (userId) => {
    if (!mailbox.has(userId)) mailbox.set(userId, []);
    return mailbox.get(userId);
  };

  function directory() {
    return [...bundles.keys()].sort().map((userId) => ({
      userId,
      username: userId,
      name: names[userId] ?? userId,
      role: 'member',
      bundle: clone(served.get(userId) ?? bundles.get(userId)),
      identityVersion: 1,
    }));
  }

  async function putBundle(userId, bundle) {
    if (bundle?.userId !== userId) throw httpError(403, 'forbidden', 'Not your bundle');
    await verifyBundle(bundle, { now: clock() });
    bundles.set(userId, clone(bundle));
    return { ok: true, identityVersion: 1, identityChanged: false };
  }

  async function send(userId, envelope) {
    if (failNextPost) {
      failNextPost = false;
      throw httpError(503, 'unavailable', 'Relay unavailable');
    }
    assertEnvelopeShape(envelope);
    const h = envelope.header;
    if (h.from !== userId) throw httpError(403, 'forbidden', 'from must be the authenticated account');
    const senderBundle = bundles.get(userId);
    if (!senderBundle) throw httpError(400, 'no_bundle', 'Publish a key bundle first');
    for (const to of h.to) if (!bundles.has(to)) throw httpError(400, 'unknown_recipient', 'Unknown recipient');
    if (Math.abs(h.ts - clock()) > 5 * 60_000) throw httpError(400, 'bad_ts', 'Timestamp outside the allowed skew');
    if (h.convId !== await deriveConvId(h.to)) throw httpError(400, 'bad_conv', 'Conversation id mismatch');
    if (seen.has(h.id)) throw httpError(409, 'duplicate', 'Duplicate message');
    if (!(await verifyEnvelopeSignature(envelope, senderBundle.signPub))) throw httpError(400, 'bad_signature', 'Bad signature');
    seen.add(h.id);
    envelopes.set(h.id, clone(envelope));
    let seq = 0;
    for (const to of h.to) {
      seq = ++seqCounter;
      box(to).push({ seq, messageId: h.id });
    }
    return { id: h.id, seq };
  }

  function inbox(userId, after, limit) {
    const items = box(userId)
      .filter((e) => e.seq > after)
      .slice(0, limit)
      .map((e) => ({ seq: e.seq, envelope: clone(envelopes.get(e.messageId)) }));
    return { items, next: items.length ? items[items.length - 1].seq : after };
  }

  function ack(userId, upTo) {
    const entries = box(userId);
    const removed = entries.filter((e) => e.seq <= upTo);
    mailbox.set(userId, entries.filter((e) => e.seq > upTo));
    for (const e of removed) {
      const referenced = [...mailbox.values()].some((list) => list.some((x) => x.messageId === e.messageId));
      if (!referenced) envelopes.delete(e.messageId);
    }
    return { removed: removed.length };
  }

  /** The api object for one signed-in account, with the core/api.js call shapes. */
  const apiFor = (userId) => ({
    async get(path, opts = {}) {
      const url = new URL(path, 'https://relay.test');
      if (url.pathname === '/api/chat/directory') return directory();
      if (url.pathname === '/api/chat/inbox') {
        return inbox(userId, Number(opts.params?.after ?? 0), Math.min(Number(opts.params?.limit ?? 100), 100));
      }
      throw httpError(404, 'not_found', 'No such route');
    },
    async put(path, body) {
      if (path !== '/api/chat/keys') throw httpError(404, 'not_found', 'No such route');
      return putBundle(userId, body.bundle);
    },
    async post(path, body) {
      if (path === '/api/chat/messages') return send(userId, body.envelope);
      if (path === '/api/chat/ack') return ack(userId, body.upTo);
      throw httpError(404, 'not_found', 'No such route');
    },
    async del() {
      throw httpError(404, 'not_found', 'No such route');
    },
  });

  return {
    apiFor,
    bundles,
    envelopes,
    swapBundle(userId, bundle) { served.set(userId, bundle); },
    inject(userId, envelope) {
      envelopes.set(envelope.header.id, clone(envelope));
      box(userId).push({ seq: ++seqCounter, messageId: envelope.header.id });
    },
    dropAt(userId, index) { box(userId).splice(index, 1); },
    tamper(messageId, fn) { fn(envelopes.get(messageId)); },
    failNextPost() { failNextPost = true; },
    pendingFor: (userId) => box(userId).length,
    envelopeCount: () => envelopes.size,
  };
}

const openClients = [];
function newClient(relay, userId, clock, storage = memoryStorage()) {
  const client = createChatClient({ api: relay.apiFor(userId), storage, user: { id: userId, name: userId }, now: clock });
  client.setAutoLock(0);
  openClients.push(client);
  return client;
}

/** Luke and Ralph, both set up, on a clock that only moves when a test moves it. */
async function world() {
  let t = Date.now();
  const clock = () => t;
  const relay = createRelay(clock);
  const storage = { luke: memoryStorage(), ralph: memoryStorage() };
  const luke = newClient(relay, LUKE, clock, storage.luke);
  const ralph = newClient(relay, RALPH, clock, storage.ralph);
  await luke.setup(PASS.luke);
  await ralph.setup(PASS.ralph);
  return {
    relay,
    storage,
    luke,
    ralph,
    now: () => t,
    advance(ms) { t += ms; },
  };
}

const view = (m) => ({ id: m.id, from: m.from, n: m.n, body: m.body });
async function convIdOf(client) {
  const [conv] = await client.conversations();
  return conv.convId;
}
async function attackerBundle(userId, now) {
  const sign = await generateSigningKeyPair(true);
  const enc = await generateEncKeyPair(true);
  return createBundle({
    userId,
    signPrivateKey: sign.privateKey,
    signPublicJwk: await exportPublicJwk(sign.publicKey),
    encPublicJwk: await exportPublicJwk(enc.publicKey),
    now,
  });
}

after(() => {
  for (const client of openClients) client.lock();
});

describe('LRChat client protocol', () => {
  test('setup, lock and unlock: the vault comes back with its history and identity', async () => {
    const w = await world();
    assert.equal(w.luke.status, 'unlocked');
    await w.luke.send([RALPH], 'before lock');
    const contacts = await w.luke.contacts();
    assert.equal(contacts.find((c) => c.userId === RALPH).hasChat, true);

    w.luke.lock();
    assert.equal(w.luke.status, 'locked');
    await assert.rejects(w.luke.contacts(), { code: 'locked' });
    await assert.rejects(w.luke.send([RALPH], 'x'), { code: 'locked' });
    assert.throws(() => w.luke.startPolling(), { code: 'locked' });

    await w.luke.unlock(PASS.luke);
    assert.equal(w.luke.status, 'unlocked');
    const convId = await convIdOf(w.luke);
    assert.deepEqual((await w.luke.messages(convId)).map((m) => m.body), ['before lock']);
    const safety = await w.luke.safety(RALPH);
    assert.match(safety.number, /^(\d{5} ){11}\d{5}$/);
    assert.equal(safety.yourFingerprint, await fingerprint(w.relay.bundles.get(LUKE).signPub));
  });

  test('a wrong passphrase is refused and the client stays locked', async () => {
    const w = await world();
    w.luke.lock();
    await assert.rejects(w.luke.unlock(WRONG_PASS), { name: 'CryptoError', code: 'bad_decrypt' });
    assert.equal(w.luke.status, 'locked');
    await w.luke.unlock(PASS.luke);
    assert.equal(w.luke.status, 'unlocked');
  });

  test('two clients exchange messages both ways, histories match, and acks clear the relay', async () => {
    const w = await world();
    await w.luke.send([RALPH], 'hello Ralph');
    w.advance(1000);
    assert.equal(await w.ralph.poll(), 1);
    await w.ralph.send([LUKE], 'hello Luke');
    w.advance(1000);
    assert.equal(await w.luke.poll(), 1); // Luke's own echo is a duplicate, Ralph's reply is new
    assert.equal(await w.ralph.poll(), 0); // Ralph's own echo

    const convId = await convIdOf(w.luke);
    const lukeView = (await w.luke.messages(convId)).map(view);
    const ralphView = (await w.ralph.messages(convId)).map(view);
    assert.deepEqual(lukeView, ralphView);
    assert.deepEqual(lukeView.map((m) => m.body), ['hello Ralph', 'hello Luke']);
    assert.equal(w.relay.pendingFor(LUKE), 0);
    assert.equal(w.relay.pendingFor(RALPH), 0);
    assert.equal(w.relay.envelopeCount(), 0);
  });

  test('a replayed envelope is ignored without an error', async () => {
    const w = await world();
    const errors = [];
    w.ralph.on('error', (e) => errors.push(e));
    await w.luke.send([RALPH], 'once only');
    const { items } = await w.relay.apiFor(RALPH).get('/api/chat/inbox', { params: { after: 0 } });
    assert.equal(await w.ralph.poll(), 1);
    w.relay.inject(RALPH, items[0].envelope);
    assert.equal(await w.ralph.poll(), 0);
    assert.deepEqual(errors, []);
    assert.equal((await w.ralph.messages(await convIdOf(w.ralph))).length, 1);
  });

  test('a message the relay drops shows up as a gap event', async () => {
    const w = await world();
    const gaps = [];
    w.ralph.on('gap', (g) => gaps.push(g));
    await w.luke.send([RALPH], 'one');
    w.advance(1000);
    await w.luke.send([RALPH], 'two');
    w.advance(1000);
    await w.luke.send([RALPH], 'three');
    w.relay.dropAt(RALPH, 1); // the relay silently loses 'two'
    assert.equal(await w.ralph.poll(), 2);
    assert.equal(gaps.length, 1);
    assert.deepEqual({ from: gaps[0].from, expected: gaps[0].expected, got: gaps[0].got }, { from: LUKE, expected: 1, got: 2 });
  });

  test('a malicious relay that swaps a contact key is flagged, sending is refused until accepted', async () => {
    const w = await world();
    const changed = [];
    w.luke.on('identity-changed', (e) => changed.push(e));
    await w.luke.contacts(); // pins Ralph

    w.relay.swapBundle(RALPH, await attackerBundle(RALPH, w.now()));
    w.advance(61_000); // past the 60 s directory cache
    const flagged = (await w.luke.contacts()).find((c) => c.userId === RALPH);
    assert.equal(flagged.identityChanged, true);
    assert.equal(flagged.hasChat, false);
    assert.equal(changed.length, 1);
    await assert.rejects(w.luke.send([RALPH], 'hi'), { code: 'identity_changed' });

    const safety = await w.luke.safety(RALPH);
    assert.notEqual(safety.pendingNumber, safety.number);

    await w.luke.acceptIdentityChange(RALPH);
    const accepted = (await w.luke.contacts()).find((c) => c.userId === RALPH);
    assert.equal(accepted.identityChanged, false);
    assert.equal(accepted.verified, false);
    assert.equal(accepted.hasChat, true);
    const sent = await w.luke.send([RALPH], 'after review');
    assert.equal(sent.body, 'after review');
  });

  test('a message signed by a key other than the pinned one is rejected', async () => {
    const w = await world();
    const errors = [];
    w.ralph.on('error', (e) => errors.push(e));
    await w.ralph.contacts(); // pins Luke
    const attacker = await generateSigningKeyPair(true);
    const lukeBundle = w.relay.bundles.get(LUKE);
    const ralphBundle = w.relay.bundles.get(RALPH);
    const forged = await seal({
      message: { type: 'text', body: 'forged by someone else' },
      from: LUKE,
      n: 0,
      ttl: 0,
      recipients: [
        { userId: LUKE, bundle: lukeBundle, pinnedSignFingerprint: await fingerprint(lukeBundle.signPub) },
        { userId: RALPH, bundle: ralphBundle, pinnedSignFingerprint: await fingerprint(ralphBundle.signPub) },
      ],
      signPrivateKey: attacker.privateKey,
      now: w.now(),
    });
    w.relay.inject(RALPH, forged);
    assert.equal(await w.ralph.poll(), 0);
    assert.deepEqual(errors.map((e) => e.code), ['bad_signature']);
    assert.deepEqual(await w.ralph.messages(forged.header.convId), []);
    assert.equal(w.relay.pendingFor(RALPH), 1, 'a rejected message is never acked');
  });

  test('tampered ciphertext is skipped and does not stall the inbox', async () => {
    const w = await world();
    const errors = [];
    w.ralph.on('error', (e) => errors.push(e));
    for (const body of ['first', 'second', 'third']) {
      await w.luke.send([RALPH], body);
      w.advance(1000);
    }
    const { items } = await w.relay.apiFor(RALPH).get('/api/chat/inbox', { params: { after: 0 } });
    w.relay.tamper(items[1].envelope.header.id, (env) => {
      env.ct = (env.ct[0] === 'A' ? 'B' : 'A') + env.ct.slice(1);
    });
    assert.equal(await w.ralph.poll(), 2);
    assert.deepEqual(errors.map((e) => e.code), ['bad_signature']);
    assert.deepEqual((await w.ralph.messages(await convIdOf(w.ralph))).map((m) => m.body), ['first', 'third']);
    assert.equal(w.relay.pendingFor(RALPH), 2, "'second' blocks the ack and 'third' waits behind it");
  });

  test('key rotation: a new key is published after 3 days, and a key is deleted after its retention window', async () => {
    const w = await world();
    const errors = [];
    w.ralph.on('error', (e) => errors.push(e));
    const firstKeyId = w.relay.bundles.get(RALPH).keyId;
    await w.luke.contacts();
    await w.luke.send([RALPH], 'sealed to the first key'); // Ralph has not read it yet

    // Ralph's client wakes 4 days later. Lock and unlock runs the rotation check without reading the inbox.
    w.advance(4 * DAY);
    w.ralph.lock();
    await w.ralph.unlock(PASS.ralph);
    const rotatedKeyId = w.relay.bundles.get(RALPH).keyId;
    assert.notEqual(rotatedKeyId, firstKeyId, 'a new encryption key was published');

    // 10 days in: the first key's retain-until (bundle expiry + 2 days) has passed.
    w.advance(6 * DAY);
    await w.luke.send([RALPH], 'sent later'); // sealed to the still-valid second key
    assert.equal(await w.ralph.poll(), 1);
    assert.deepEqual(errors.map((e) => e.code), ['no_key']);
    const meta = await w.storage.ralph.get('meta');
    assert.equal(meta.encKeys.some((k) => k.keyId === firstKeyId), false, 'the first private key was deleted');
    assert.deepEqual((await w.ralph.messages(await deriveConvId([LUKE, RALPH]))).map((m) => m.body), ['sent later']);
    assert.equal(w.relay.pendingFor(RALPH), 0, 'the undecryptable message was acked as discarded');
  });

  test('encrypted backup: restores identity and pins on a fresh device, rejects a wrong passphrase and another account', async () => {
    const w = await world();
    await w.luke.contacts(); // pins Ralph
    const before = await w.luke.safety(RALPH);
    const backup = await w.luke.exportBackup(BACKUP_PASS);
    assert.equal(backup.includes(BACKUP_PASS) || backup.includes(PASS.luke) || backup.includes('"d":'), false);

    const restored = newClient(w.relay, LUKE, w.now, memoryStorage());
    await assert.rejects(restored.importBackup(backup, WRONG_PASS, NEW_PASS), { code: 'bad_decrypt' });
    assert.equal(restored.status, 'uninitialized');
    const ralphBackup = await w.ralph.exportBackup(BACKUP_PASS);
    await assert.rejects(restored.importBackup(ralphBackup, BACKUP_PASS, NEW_PASS), { code: 'wrong_user' });
    assert.equal(restored.status, 'uninitialized');

    await restored.importBackup(backup, BACKUP_PASS, NEW_PASS);
    assert.equal(restored.status, 'unlocked');
    const after = await restored.safety(RALPH);
    assert.equal(after.number, before.number);
    assert.equal(after.yourFingerprint, before.yourFingerprint);

    await restored.send([RALPH], 'from the restored device');
    assert.equal(await w.ralph.poll(), 1);
    assert.equal((await w.ralph.messages(await deriveConvId([LUKE, RALPH])))[0].body, 'from the restored device');
  });

  test('auto-lock drops every key: later calls throw locked', async () => {
    const w = await world();
    await w.luke.contacts();
    w.luke.setAutoLock(60);
    await sleep(150);
    assert.equal(w.luke.status, 'locked');
    await assert.rejects(w.luke.contacts(), { code: 'locked' });
    await assert.rejects(w.luke.messages(await deriveConvId([LUKE, RALPH])), { code: 'locked' });
    assert.throws(() => w.luke.startPolling(), { code: 'locked' });
  });

  test('disappearing messages: the body leaves the vault once its time has passed', async () => {
    const w = await world();
    await w.luke.send([RALPH], 'gone in an hour', { ttl: 3600 });
    assert.equal(await w.ralph.poll(), 1);
    const convId = await deriveConvId([LUKE, RALPH]);
    assert.equal((await w.ralph.messages(convId))[0].body, 'gone in an hour');

    w.advance(2 * 3600_000);
    const [received] = await w.ralph.messages(convId);
    assert.equal(received.status, 'expired');
    assert.equal(received.body, undefined);
    const [sent] = await w.luke.messages(convId);
    assert.equal(sent.body, undefined, "Luke's own copy expires too");
    const [summary] = await w.ralph.conversations();
    assert.equal(JSON.stringify(summary).includes('gone in an hour'), false);
  });

  test('a failed POST leaves no phantom message on the sender side', async () => {
    const w = await world();
    w.relay.failNextPost();
    await assert.rejects(w.luke.send([RALPH], 'never arrived'), { code: 'unavailable' });
    assert.deepEqual(await w.luke.messages(await deriveConvId([LUKE, RALPH])), []);
    assert.equal(w.relay.pendingFor(RALPH), 0);
  });

  test('after chatting, no stored value holds a plaintext body, a passphrase or a private JWK member', async () => {
    const w = await world();
    const secret = 'SECRET-BODY-7f3a-do-not-store';
    await w.luke.send([RALPH], secret);
    w.advance(1000);
    await w.ralph.poll();
    await w.ralph.send([LUKE], `reply ${secret}`);
    await w.luke.poll();
    await w.luke.contacts();

    let scanned = 0;
    for (const [name, storage] of Object.entries(w.storage)) {
      for (const key of await storage.keys('')) {
        scanned += 1;
        const text = JSON.stringify(await storage.get(key)) ?? '';
        assert.equal(text.includes(secret), false, `${name} ${key} holds a plaintext body`);
        assert.equal(text.includes(PASS.luke) || text.includes(PASS.ralph), false, `${name} ${key} holds a passphrase`);
        assert.equal(text.includes('"d":'), false, `${name} ${key} holds a private JWK member`);
      }
    }
    assert.ok(scanned > 5, 'the scan covered the vault records');
  });
});
