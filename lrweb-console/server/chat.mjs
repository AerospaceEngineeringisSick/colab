// LRChat relay: stores public key bundles and sealed envelopes, never plaintext.
// Design and threat model: docs/CHAT-SECURITY.md. The crypto lives in web/js/chat/crypto.js.
import {
  CryptoError, assertEnvelopeShape, fingerprint, verifyBundle, verifyEnvelopeSignature,
} from '../web/js/chat/crypto.js';

const DAY_MS = 86_400_000;
const CLOCK_SKEW_MS = 10 * 60_000;
const RATE_WINDOW_MS = 60_000;
const PURGE_EVERY_MS = 60_000;
const MAX_WAIT_MS = 25_000;
const ROLES = ['owner', 'admin', 'member'];

const fail = (status, code, message, field) => Object.assign(new Error(message), { status, code, ...(field ? { field } : {}) });
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const cursor = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const limitOf = (v) => { const n = Math.trunc(Number(v)); return clamp(Number.isFinite(n) ? n : 100, 1, 200); };
const iso = (ms) => new Date(ms).toISOString();

export function createChat({ store, config, auth, now = () => Date.now() }) {
  const waiters = new Map(); // userId -> Set of wake callbacks, one per open long-poll
  const sendLog = new Map(); // userId -> timestamps of recent sends (sliding window)
  let lastPurge = -Infinity;

  const keyRow = (userId) => store.findOne('chatKeys', (k) => k.userId === userId);
  const nextSeq = () => {
    const seq = (store.meta.get('chatSeq') ?? 0) + 1;
    store.meta.set('chatSeq', seq);
    return seq;
  };

  /* ---------- directory and key bundles ---------- */

  function directory() {
    const keys = new Map(store.all('chatKeys').map((k) => [k.userId, k]));
    return auth.listUsers().map((u) => {
      const k = keys.get(u.id);
      return {
        userId: u.id, username: u.username, name: u.name, role: u.role,
        bundle: k?.bundle ?? null, identityVersion: k?.identityVersion ?? 0,
      };
    });
  }

  async function putBundle(user, bundle) {
    let signFp;
    try {
      await verifyBundle(bundle, { now: now() });
      signFp = await fingerprint(bundle.signPub);
    } catch (e) {
      throw fail(400, 'bad_bundle', `Key bundle rejected (${e instanceof CryptoError ? e.code : 'bad_bundle'})`);
    }
    if (bundle.userId !== user.id) throw fail(403, 'forbidden', 'You can only publish your own key bundle');
    // Read after the awaits above, so the checks and the write below cannot interleave with another put.
    const existing = keyRow(user.id);
    if (existing && bundle.createdAt < existing.bundle.createdAt) throw fail(409, 'stale_bundle', 'A newer key bundle is already published');
    const identityChanged = Boolean(existing) && existing.signFingerprint !== signFp;
    const identityVersion = existing ? existing.identityVersion + (identityChanged ? 1 : 0) : 1;
    const patch = { bundle: structuredClone(bundle), identityVersion, signFingerprint: signFp, updatedAt: iso(now()) };
    if (existing) store.update('chatKeys', existing.id, patch);
    else store.insert('chatKeys', { id: store.newId('chatKeys'), userId: user.id, ...patch });
    return { ok: true, identityVersion, identityChanged };
  }

  /* ---------- sending ---------- */

  /** Sliding window: only sends that get past this check count, so 429s do not extend the wait. */
  function takeSendSlot(userId) {
    const t = now();
    const recent = (sendLog.get(userId) ?? []).filter((ts) => ts > t - RATE_WINDOW_MS);
    const allowed = recent.length < config.chat.ratePerMinute;
    if (allowed) recent.push(t);
    if (recent.length) sendLog.set(userId, recent);
    else sendLog.delete(userId);
    return allowed;
  }

  async function send(user, envelope) {
    maybePurge();
    try { assertEnvelopeShape(envelope); } catch { throw fail(400, 'bad_envelope', 'Malformed message envelope'); }
    if (Buffer.byteLength(JSON.stringify(envelope)) > config.chat.maxEnvelopeBytes) throw fail(413, 'too_large', 'Message is too large');
    const { header } = envelope;
    if (header.from !== user.id) throw fail(403, 'forbidden', 'Messages must be sent from your own account');
    for (const id of header.to) {
      if (!auth.getUser(id) || !keyRow(id)) throw fail(400, 'unknown_recipient', 'A recipient is not on the team or has not set up chat');
    }
    if (!takeSendSlot(user.id)) throw fail(429, 'rate_limited', 'Too many messages. Wait a minute and try again.');
    if (Math.abs(header.ts - now()) > CLOCK_SKEW_MS) throw fail(400, 'bad_timestamp', 'The message time is more than ten minutes from the server clock');
    if (store.get('chatMessages', header.id)) throw fail(409, 'duplicate', 'This message was already sent');

    const sender = keyRow(user.id);
    let valid = false;
    try { valid = await verifyEnvelopeSignature(envelope, sender.bundle.signPub); } catch { valid = false; }
    if (!valid) throw fail(400, 'bad_signature', 'Message signature is invalid');
    // Checked again after the await. Everything below is synchronous, so a concurrent duplicate cannot slip in.
    if (store.get('chatMessages', header.id)) throw fail(409, 'duplicate', 'This message was already sent');

    const t = now();
    const ttlEnd = header.ttl > 0 ? header.ts + header.ttl * 1000 : Infinity;
    store.insert('chatMessages', {
      id: header.id, envelope: structuredClone(envelope), from: user.id, createdAt: iso(t),
      expiresAt: iso(Math.min(t + config.chat.ttlDays * DAY_MS, ttlEnd)),
    });
    let own = 0;
    for (const to of header.to) {
      const seq = nextSeq();
      store.insert('chatMailbox', { id: store.newId('chatMailbox'), seq, userId: to, messageId: header.id });
      if (to === user.id) own = seq;
    }
    for (const to of header.to) wake(to);
    return { id: header.id, seq: own };
  }

  /* ---------- reading ---------- */

  function readInbox(userId, after, limit) {
    const rows = store.find('chatMailbox', (r) => r.userId === userId && r.seq > after)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit);
    const wanted = new Set(rows.map((r) => r.messageId));
    const envelopes = new Map(store.find('chatMessages', (m) => wanted.has(m.id)).map((m) => [m.id, m.envelope]));
    const items = rows.filter((r) => envelopes.has(r.messageId)).map((r) => ({ seq: r.seq, envelope: envelopes.get(r.messageId) }));
    return { items, next: rows.length ? rows[rows.length - 1].seq : after };
  }

  function inbox(user, { after = 0, limit = 100 } = {}) {
    maybePurge();
    return readInbox(user.id, cursor(after), limitOf(limit));
  }

  /** Long-poll. Resolves at once if items are waiting, else on the next send to this user, the timeout (max 25 s) or abort. */
  async function wait(user, after = 0, timeoutMs = 0, signal, limit = 100) {
    maybePurge();
    const from = cursor(after);
    const max = limitOf(limit);
    const ready = readInbox(user.id, from, max);
    if (ready.items.length) return ready;
    const ms = clamp(Number(timeoutMs) || 0, 0, MAX_WAIT_MS);
    if (ms <= 0 || signal?.aborted) return { items: [], next: from };
    return new Promise((resolve) => {
      if (!waiters.has(user.id)) waiters.set(user.id, new Set());
      const open = waiters.get(user.id);
      let timer = null;
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        open.delete(onWake);
        if (!open.size && waiters.get(user.id) === open) waiters.delete(user.id);
        signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onWake = () => {
        const r = readInbox(user.id, from, max);
        if (r.items.length) finish(r);
      };
      const onAbort = () => finish({ items: [], next: from });
      timer = setTimeout(onAbort, ms);
      open.add(onWake);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function wake(userId) {
    for (const fn of [...(waiters.get(userId) ?? [])]) fn();
  }

  const waiterCount = () => [...waiters.values()].reduce((n, set) => n + set.size, 0);

  /* ---------- acknowledging, unsending, wiping ---------- */

  /** Deletes envelopes that no mailbox row references any more. */
  function dropOrphans(messageIds) {
    for (const id of new Set(messageIds)) {
      if (!store.findOne('chatMailbox', (r) => r.messageId === id)) store.remove('chatMessages', id);
    }
  }

  function ack(user, upTo) {
    if (!Number.isSafeInteger(upTo) || upTo < 0) throw fail(400, 'validation', 'upTo must be a sequence number', 'upTo');
    const rows = store.find('chatMailbox', (r) => r.userId === user.id && r.seq <= upTo);
    for (const r of rows) store.remove('chatMailbox', r.id);
    dropOrphans(rows.map((r) => r.messageId));
    return { removed: rows.length };
  }

  function unsend(user, messageId) {
    const msg = store.get('chatMessages', messageId);
    if (!msg) return { removed: false };
    if (msg.from !== user.id) throw fail(403, 'forbidden', 'Only the sender can unsend a message');
    for (const r of store.find('chatMailbox', (m) => m.messageId === messageId)) store.remove('chatMailbox', r.id);
    store.remove('chatMessages', messageId);
    return { removed: true };
  }

  function wipe(user) {
    const rows = store.find('chatMailbox', (r) => r.userId === user.id);
    for (const r of rows) store.remove('chatMailbox', r.id);
    const key = keyRow(user.id);
    if (key) store.remove('chatKeys', key.id);
    dropOrphans(rows.map((r) => r.messageId));
    sendLog.delete(user.id);
  }

  /* ---------- expiry ---------- */

  function purgeExpired() {
    const t = now();
    lastPurge = t;
    const dead = new Set(store.find('chatMessages', (m) => Date.parse(m.expiresAt) <= t).map((m) => m.id));
    if (!dead.size) return 0;
    for (const r of store.find('chatMailbox', (m) => dead.has(m.messageId))) store.remove('chatMailbox', r.id);
    for (const id of dead) store.remove('chatMessages', id);
    return dead.size;
  }

  /** Lazy: no timer, so the process can exit. Runs at most once a minute from the message paths. */
  function maybePurge() {
    if (now() - lastPurge >= PURGE_EVERY_MS) purgeExpired();
  }

  return { directory, putBundle, send, inbox, wait, ack, unsend, wipe, purgeExpired, waiterCount };
}

export function chatRoutes({ chat }) {
  const route = (method, path, handler) => ({ method, path, auth: 'account', roles: ROLES, handler });
  return [
    route('GET', '/api/chat/directory', () => chat.directory()),
    route('PUT', '/api/chat/keys', ({ user, body }) => chat.putBundle(user, body?.bundle)),
    route('POST', '/api/chat/messages', ({ user, body }) => chat.send(user, body?.envelope)),
    route('GET', '/api/chat/inbox', ({ req, user, query }) => {
      const after = Number(query.get('after') ?? 0);
      const limit = query.has('limit') ? Number(query.get('limit')) : 100;
      const wait = clamp(Number(query.get('wait') ?? 0) || 0, 0, MAX_WAIT_MS / 1000);
      if (!wait) return chat.inbox(user, { after, limit });
      const abort = new AbortController();
      req?.on('close', () => abort.abort());
      return chat.wait(user, after, wait * 1000, abort.signal, limit);
    }),
    route('POST', '/api/chat/ack', ({ user, body }) => chat.ack(user, body?.upTo)),
    route('DELETE', '/api/chat/messages/:id', ({ user, params }) => chat.unsend(user, params.id)),
    route('DELETE', '/api/chat/me', ({ user }) => {
      chat.wipe(user);
      return { wiped: true };
    }),
  ];
}
