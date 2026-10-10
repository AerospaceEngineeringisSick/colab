// LRChat client: the browser-side protocol for one signed-in team member. Primitives live in crypto.js and
// storage is injected (storage.js in the browser, memoryStorage in tests). See docs/CHAT-SECURITY.md.
//
// At rest every secret is an AES-GCM blob under the vault key, which is itself wrapped by a PBKDF2 key derived
// from the passphrase. While unlocked, private keys are non-extractable CryptoKeys. lock() drops every reference.
import {
  CryptoError, KDF, LIMITS, assertEnvelopeShape, b64, checkPassphrase, createBundle, decryptBlob, decryptJson,
  deriveConvId, deriveKek, encryptBlob, encryptJson, exportAesKey, exportPrivateJwk, exportPublicJwk, fingerprint,
  generateEncKeyPair, generateSigningKeyPair, importAesKey, importEncPrivate, importSignPrivate, newAesKey, newSalt,
  normalizeJwk, open, safetyNumber, seal, verifyBundle,
} from './crypto.js';

const DAY = 86_400_000;
const AUTO_LOCK_DEFAULT_MS = 15 * 60_000;
const ENC_ROTATE_MS = 3 * DAY;
const ENC_RETAIN_AFTER_EXPIRY_MS = 2 * DAY;
const DIR_CACHE_MS = 60_000;
const SEEN_MAX = 5000;
const BODY_MAX = 4000;
const PREVIEW_MAX = 80;
const TTLS = new Set([0, 3600, 86400, 604800]);
const POLL_WAIT_S = 25;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const CONTACT_PREFIX = 'contact:';
const CONV_PREFIX = 'conv:';

const bad = (code, msg) => new CryptoError(code, msg);
const isId = (x) => typeof x === 'string' && x.length > 0 && x.length <= 64;
const isB64Len = (s, n) => { try { return b64.dec(s).length === n; } catch { return false; } };
const pad16 = (ts) => String(ts).padStart(16, '0');
const previewOf = (body, ttl) => (ttl > 0 ? 'Disappearing message' : body.slice(0, PREVIEW_MAX));
/** Exact key-set check for strict validation of untrusted (backup) data. */
const exact = (obj, required, optional = []) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
};
const sleepMs = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
});

const K = {
  meta: 'meta',
  cursor: 'cursor',
  contact: (userId) => `${CONTACT_PREFIX}${userId}`,
  conv: (convId) => `${CONV_PREFIX}${convId}`,
  msgPrefix: (convId) => `msg:${convId}:`,
  msg: (convId, ts, id) => `msg:${convId}:${pad16(ts)}:${id}`,
};

/**
 * The chat client for one account. `api` has the core/api.js shape: get(path, { params, signal }),
 * post(path, body), put(path, body), del(path). `user` is { id }. `now` is injectable for tests.
 */
export function createChatClient({ api, storage, user, now = Date.now }) {
  if (!api || !storage || !user || !isId(user.id)) throw bad('bad_config', 'api, storage and user.id are required');
  const me = { id: user.id };
  const clock = () => now();

  const S = {
    status: 'uninitialized',
    hasVault: false,
    meta: null, // encrypted vault metadata, only while unlocked
    vaultKey: null, // non-extractable AES-GCM key, only while unlocked
    ident: null, // { signPriv, signPubJwk, fingerprint }
    encKeys: new Map(), // keyId -> non-extractable ECDH private key (retained keys only)
    dir: null, // { at, statuses: Map userId -> { status, name, username, entry }, mine }
    publishPending: false,
    cursor: 0, // last acked seq
    readAfter: 0, // in-memory read position for inbox fetches
    pollAbort: null,
    idleTimer: null,
    autoLockMs: AUTO_LOCK_DEFAULT_MS,
    chain: Promise.resolve(), // serialises conversation, message and vault writes
    pinChain: Promise.resolve(), // serialises contact pin writes
  };
  const listeners = new Map();

  const emit = (event, payload) => {
    for (const fn of listeners.get(event) ?? []) {
      try { fn(payload); } catch { /* a listener must never break the protocol */ }
    }
  };
  const reportError = (code, message, seq) => emit('error', seq === undefined ? { code, message } : { code, message, seq });
  const setStatus = (status) => {
    if (S.status === status) return;
    S.status = status;
    emit('status', status);
  };
  const serialIn = (key, fn) => {
    const run = S[key].then(fn);
    S[key] = run.catch(() => {});
    return run;
  };
  const serial = (fn) => serialIn('chain', fn);
  const pinSerial = (fn) => serialIn('pinChain', fn);

  function touch() {
    clearTimeout(S.idleTimer);
    S.idleTimer = null;
    if (S.status === 'unlocked' && S.autoLockMs > 0) {
      S.idleTimer = setTimeout(() => lock(), S.autoLockMs);
      S.idleTimer?.unref?.();
    }
  }
  const assertUnlocked = () => {
    if (S.status !== 'unlocked' || !S.vaultKey || !S.meta) throw bad('locked', 'Chat is locked');
  };
  /** Public methods that need the vault: check, reset the idle timer, then run. */
  const guard = (fn) => async (...args) => {
    assertUnlocked();
    touch();
    return fn(...args);
  };

  /* ---------------- storage helpers (call only while unlocked) ---------------- */

  const saveMeta = () => storage.set(K.meta, S.meta);
  const newest = () => S.meta.encKeys.reduce((a, b) => (!a || b.createdAt > a.createdAt ? b : a), null);
  const rotationDue = () => {
    const n = newest();
    return !n || n.createdAt + ENC_ROTATE_MS <= clock();
  };

  async function readContact(userId) {
    const blob = await storage.get(K.contact(userId));
    return blob ? decryptJson(S.vaultKey, blob, K.contact(userId)) : null;
  }
  async function writeContact(userId, rec) {
    await storage.set(K.contact(userId), await encryptJson(S.vaultKey, rec, K.contact(userId)));
  }
  async function readConv(convId) {
    const blob = await storage.get(K.conv(convId));
    return blob ? decryptJson(S.vaultKey, blob, K.conv(convId)) : null;
  }
  async function writeConv(convId, rec) {
    await storage.set(K.conv(convId), await encryptJson(S.vaultKey, rec, K.conv(convId)));
  }
  const newConv = (peerIds, title) => ({ peerIds, title, nOut: 0, lastN: {}, seen: [], unread: 0, last: null });
  const remember = (seen, id) => {
    const next = [...seen, id];
    return next.length > SEEN_MAX ? next.slice(-SEEN_MAX) : next;
  };
  async function titleFor(peerIds) {
    const names = [];
    for (const id of peerIds) names.push((await readContact(id))?.name || id);
    return names.join(', ');
  }
  async function readMsg(key) {
    const blob = await storage.get(key);
    if (!blob) return null;
    const id = key.slice(key.lastIndexOf(':') + 1);
    return decryptJson(S.vaultKey, blob, `msg:${id}`);
  }
  async function putMsg(key, rec) {
    await storage.set(key, await encryptJson(S.vaultKey, rec, `msg:${rec.id}`));
  }
  const publicMsg = (rec) => ({ id: rec.id, from: rec.from, ts: rec.ts, n: rec.n, body: rec.body, ttl: rec.ttl, status: rec.status });

  /* ---------------- status, setup, unlock, lock ---------------- */

  async function init() {
    if (S.status === 'unlocked' || S.status === 'locked') return S.status;
    const stored = await storage.get(K.meta);
    if (stored) {
      if (stored.v !== 1 || stored.userId !== me.id) throw bad('wrong_vault', 'This chat data belongs to another account or version');
      S.hasVault = true;
      setStatus('locked');
    } else {
      S.hasVault = false;
      setStatus('uninitialized');
    }
    return S.status;
  }

  async function publishNewest() {
    const rec = newest();
    if (!rec?.bundle) throw bad('no_bundle', 'No key bundle to publish');
    try {
      await api.put('/api/chat/keys', { bundle: rec.bundle });
      S.publishPending = false;
    } catch (e) {
      S.publishPending = true;
      throw e;
    }
  }

  /** The vault record for one encryption key. Its keyId is the bundle's keyId, which is what envelopes reference. */
  async function encRecordFor(bundle, privJwk) {
    return {
      keyId: bundle.keyId,
      createdAt: bundle.createdAt,
      expiresAt: bundle.expiresAt,
      retainUntil: bundle.expiresAt + ENC_RETAIN_AFTER_EXPIRY_MS,
      pubJwk: normalizeJwk(bundle.encPub),
      priv: await encryptJson(S.vaultKey, privJwk, `enc:${bundle.keyId}`),
      bundle,
    };
  }

  /** New encryption key, stored wrapped, bundle published. Call inside serial() or during setup/restore. */
  async function rotateInternal() {
    assertUnlocked();
    const pair = await generateEncKeyPair(true);
    let privJwk = await exportPrivateJwk(pair.privateKey);
    const pubJwk = await exportPublicJwk(pair.publicKey);
    const bundle = await createBundle({
      userId: me.id, signPrivateKey: S.ident.signPriv, signPublicJwk: S.ident.signPubJwk,
      encPublicJwk: pubJwk, now: clock(),
    });
    S.meta.encKeys.push(await encRecordFor(bundle, privJwk));
    S.encKeys.set(bundle.keyId, await importEncPrivate(privJwk));
    privJwk = null;
    await saveMeta();
    S.publishPending = true;
    await publishNewest();
  }

  /** Drops retired keys, rotates when due, retries a pending publish. Call inside serial(). Never throws. */
  async function maintain() {
    assertUnlocked();
    const t = clock();
    const keep = [];
    for (const rec of S.meta.encKeys) {
      if (rec.retainUntil > t) keep.push(rec);
      else S.encKeys.delete(rec.keyId);
    }
    if (keep.length !== S.meta.encKeys.length) {
      S.meta.encKeys = keep;
      await saveMeta();
    }
    if (rotationDue()) return rotateInternal();
    if (S.publishPending) await publishNewest();
  }
  async function maintainSafely() {
    try {
      await maintain();
    } catch {
      reportError('sync_failed', 'Could not update your chat keys yet. Will retry.');
    }
  }

  /** Is the server's copy of our bundle the one we hold? Missing or different means publish again. */
  async function checkServerCopy() {
    const dir = await refreshDirectory({ force: true });
    const n = newest();
    if (!dir.mine?.bundle || dir.mine.bundle.keyId !== n?.keyId) S.publishPending = true;
  }

  async function setup(passphrase) {
    await init();
    if (S.hasVault) throw bad('already_setup', 'Chat is already set up on this device');
    const check = checkPassphrase(passphrase);
    if (!check.ok) throw bad('weak_passphrase', check.reason);

    const iterations = KDF.iterations;
    const salt = newSalt();
    const kek = await deriveKek(passphrase, salt, iterations);
    const vaultRaw = await exportAesKey(await newAesKey(true));
    const wrappedVault = await encryptBlob(kek, vaultRaw, 'vault');
    const vaultKey = await importAesKey(vaultRaw);
    vaultRaw.fill(0);
    S.vaultKey = vaultKey;

    // Extractable only long enough to export JWKs, then re-imported non-extractable for use.
    const sign = await generateSigningKeyPair(true);
    let signPrivJwk = await exportPrivateJwk(sign.privateKey);
    const signPubJwk = await exportPublicJwk(sign.publicKey);
    const identityBlob = await encryptJson(vaultKey, { priv: signPrivJwk, pub: signPubJwk }, 'identity');
    const signPriv = await importSignPrivate(signPrivJwk);
    signPrivJwk = null;

    const enc = await generateEncKeyPair(true);
    let encPrivJwk = await exportPrivateJwk(enc.privateKey);
    const encPubJwk = await exportPublicJwk(enc.publicKey);
    const bundle = await createBundle({
      userId: me.id, signPrivateKey: signPriv, signPublicJwk: signPubJwk, encPublicJwk: encPubJwk, now: clock(),
    });
    S.meta = {
      v: 1,
      userId: me.id,
      kdf: { iterations, salt: b64.enc(salt) },
      vault: wrappedVault,
      identity: identityBlob,
      encKeys: [await encRecordFor(bundle, encPrivJwk)],
    };
    S.ident = { signPriv, signPubJwk, fingerprint: await fingerprint(signPubJwk) };
    S.encKeys = new Map([[bundle.keyId, await importEncPrivate(encPrivJwk)]]);
    encPrivJwk = null;
    S.hasVault = true;
    S.cursor = 0;
    S.readAfter = 0;
    S.publishPending = true;
    await saveMeta();
    setStatus('unlocked');
    touch();
    try {
      await publishNewest();
    } catch {
      reportError('publish_failed', 'Could not publish your chat keys yet. Will retry.');
    }
  }

  async function unlock(passphrase) {
    await init();
    if (S.status === 'unlocked') return;
    if (!S.hasVault) throw bad('not_setup', 'Chat is not set up on this device yet');
    const stored = await storage.get(K.meta);
    if (!stored || stored.v !== 1 || stored.userId !== me.id) throw bad('wrong_vault', 'This chat data belongs to another account or version');
    const iterations = stored.kdf?.iterations;
    if (!Number.isInteger(iterations) || iterations < LIMITS.minKdfIterations) throw bad('weak_kdf', 'Vault iteration count is too low');

    const kek = await deriveKek(passphrase, b64.dec(stored.kdf?.salt), iterations);
    // A wrong passphrase fails here with CryptoError('bad_decrypt'); nothing below runs and we stay locked.
    const vaultRaw = await decryptBlob(kek, stored.vault, 'vault');
    const vaultKey = await importAesKey(vaultRaw);
    vaultRaw.fill(0);

    const idJson = await decryptJson(vaultKey, stored.identity, 'identity');
    const signPubJwk = normalizeJwk(idJson.pub);
    if (idJson.priv?.x !== signPubJwk.x || idJson.priv?.y !== signPubJwk.y) throw bad('bad_vault', 'Vault identity is inconsistent');
    const signPriv = await importSignPrivate(idJson.priv);

    const encKeys = new Map();
    for (const rec of stored.encKeys) {
      const privJwk = await decryptJson(vaultKey, rec.priv, `enc:${rec.keyId}`);
      encKeys.set(rec.keyId, await importEncPrivate(privJwk));
    }

    S.meta = stored;
    S.vaultKey = vaultKey;
    S.ident = { signPriv, signPubJwk, fingerprint: await fingerprint(signPubJwk) };
    S.encKeys = encKeys;
    S.cursor = (await storage.get(K.cursor)) ?? 0;
    S.readAfter = S.cursor;
    S.publishPending = false;
    setStatus('unlocked');
    touch();
    await serial(async () => {
      try {
        await checkServerCopy();
      } catch {
        reportError('sync_failed', 'Could not check your chat keys with the server yet.');
      }
      await maintainSafely();
    });
  }

  /** Drops every in-memory secret and stops polling. Safe to call at any time. */
  function lock() {
    clearTimeout(S.idleTimer);
    S.idleTimer = null;
    stopPolling();
    S.vaultKey = null;
    S.ident = null;
    S.encKeys = new Map();
    S.meta = null;
    S.dir = null;
    S.readAfter = 0;
    S.publishPending = false;
    if (S.status === 'unlocked') setStatus('locked');
  }

  async function clearAll() {
    for (const key of await storage.keys('')) await storage.delete(key);
  }

  /** Deletes all local chat data. The server mailbox is not touched (call api.del('/api/chat/me') for that). */
  async function wipe() {
    lock();
    await clearAll();
    S.hasVault = false;
    S.cursor = 0;
    setStatus('uninitialized');
  }

  function on(event, fn) {
    if (typeof fn !== 'function') throw bad('bad_config', 'Listener must be a function');
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => { listeners.get(event)?.delete(fn); };
  }

  function setAutoLock(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw bad('bad_config', 'Auto-lock must be a non-negative number of milliseconds');
    S.autoLockMs = ms;
    touch();
  }

  async function rotateKeysImpl() {
    await serial(rotateInternal);
  }

  /* ---------------- directory and identity pinning ---------------- */

  /**
   * Classifies one directory entry and pins first sight. Status: 'none' (no bundle), 'bad' (expired, forged or
   * inconsistent: never sent to), 'changed' (identity differs from the pin: blocked until accepted), 'ok'.
   */
  async function assessPeer(e) {
    const base = {
      userId: e.userId,
      username: typeof e.username === 'string' ? e.username : '',
      name: typeof e.name === 'string' ? e.name : '',
    };
    if (!e.bundle) return { ...base, status: 'none' };
    const known = await readContact(e.userId);
    let info;
    try {
      // undefined (not null) when there is no pin yet: verifyBundle rejects an empty or null pin.
      info = await verifyBundle(e.bundle, { now: clock(), pinnedSignFingerprint: known?.fingerprint });
    } catch (err) {
      if (!(err instanceof CryptoError) || err.code !== 'identity_changed') return { ...base, status: 'bad' };
      return pinSerial(async () => {
        const pin = await readContact(e.userId);
        if (!pin) return { ...base, status: 'bad' };
        const wasChanged = pin.identityChanged;
        pin.identityChanged = true;
        pin.pendingJwk = normalizeJwk(e.bundle.signPub); // shown for review only, never trusted
        await writeContact(e.userId, pin);
        if (!wasChanged) emit('identity-changed', { userId: e.userId, name: pin.name || base.name });
        return { ...base, status: 'changed' };
      });
    }
    return pinSerial(async () => {
      let pin = await readContact(e.userId);
      if (!pin) {
        // Trust on first use. Stays unverified until the safety number has been compared.
        pin = {
          signPubJwk: normalizeJwk(e.bundle.signPub),
          fingerprint: info.signFingerprint,
          verified: false,
          name: base.name,
          identityChanged: false,
        };
        await writeContact(e.userId, pin);
      }
      if (pin.fingerprint !== info.signFingerprint) return { ...base, status: pin.identityChanged ? 'changed' : 'bad' };
      return { ...base, status: pin.identityChanged ? 'changed' : 'ok' };
    });
  }

  async function refreshDirectory({ force = false } = {}) {
    assertUnlocked();
    if (!force && S.dir && clock() - S.dir.at < DIR_CACHE_MS) return S.dir;
    const entries = await api.get('/api/chat/directory');
    if (!Array.isArray(entries)) throw bad('bad_directory', 'Unexpected directory response');
    const statuses = new Map();
    let mine = null;
    for (const e of entries) {
      if (!e || !isId(e.userId)) continue;
      if (e.userId === me.id) {
        mine = e;
        continue;
      }
      const peer = await assessPeer(e);
      statuses.set(e.userId, { ...peer, entry: e });
    }
    const dir = { at: clock(), statuses, mine };
    if (S.status === 'unlocked') S.dir = dir;
    return dir;
  }

  async function contactsImpl() {
    const dir = await refreshDirectory();
    const out = [];
    for (const st of dir.statuses.values()) {
      const pin = await readContact(st.userId);
      out.push({
        userId: st.userId,
        username: st.username,
        name: st.name,
        hasChat: st.status === 'ok',
        verified: !!pin?.verified,
        identityChanged: !!pin?.identityChanged,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
  }

  /** Safety number for the pinned key. If the key has changed, also reports the new key so it can be compared. */
  async function safetyImpl(userId) {
    const pin = await readContact(userId);
    if (!pin) throw bad('unknown_contact', 'Unknown contact');
    const out = {
      number: await safetyNumber(S.ident.signPubJwk, pin.signPubJwk),
      fingerprint: pin.fingerprint,
      yourFingerprint: S.ident.fingerprint,
      verified: !!pin.verified,
    };
    if (pin.identityChanged && pin.pendingJwk) {
      out.pendingFingerprint = await fingerprint(pin.pendingJwk);
      out.pendingNumber = await safetyNumber(S.ident.signPubJwk, pin.pendingJwk);
    }
    return out;
  }

  async function verifyImpl(userId) {
    await pinSerial(async () => {
      const pin = await readContact(userId);
      if (!pin) throw bad('unknown_contact', 'Unknown contact');
      if (pin.identityChanged) throw bad('identity_changed', 'Accept their new identity before verifying it');
      pin.verified = true;
      await writeContact(userId, pin);
    });
  }

  /**
   * Re-pins a contact after a key change has been reviewed. `reviewed` (optional) is the fingerprint the user
   * compared; if given, acceptance is refused unless the current key matches it.
   */
  async function acceptImpl(userId, { fingerprint: reviewed } = {}) {
    const dir = await refreshDirectory({ force: true });
    await pinSerial(async () => {
      const pin = await readContact(userId);
      if (!pin || !pin.identityChanged || !pin.pendingJwk) throw bad('no_pending_change', 'Nothing to accept for this contact');
      const st = dir.statuses.get(userId);
      if (!st?.entry?.bundle) throw bad('unreachable', 'This contact has no current key');
      const info = await verifyBundle(st.entry.bundle, { now: clock() });
      if (info.signFingerprint !== (await fingerprint(pin.pendingJwk))) {
        throw bad('identity_changed', 'Their key changed again. Review it before accepting.');
      }
      if (reviewed !== undefined && reviewed !== info.signFingerprint) {
        throw bad('identity_changed', 'That is not the key you reviewed');
      }
      pin.signPubJwk = normalizeJwk(pin.pendingJwk);
      pin.fingerprint = info.signFingerprint;
      pin.verified = false;
      pin.identityChanged = false;
      delete pin.pendingJwk;
      await writeContact(userId, pin);
      st.status = 'ok';
    });
  }

  /* ---------------- sending and reading ---------------- */

  async function sendImpl(peerIds, body, { ttl = 0 } = {}) {
    if (
      !Array.isArray(peerIds) || !peerIds.length || peerIds.length > LIMITS.maxRecipients - 1 ||
      !peerIds.every((id) => isId(id) && id !== me.id) || new Set(peerIds).size !== peerIds.length
    ) {
      throw bad('bad_recipients', 'Choose one or more contacts');
    }
    if (typeof body !== 'string' || body.length < 1 || body.length > BODY_MAX) throw bad('bad_body', 'Messages must be 1 to 4000 characters');
    if (!TTLS.has(ttl)) throw bad('bad_ttl', 'Choose a valid disappearing time');

    const peers = [...peerIds].sort();
    const dir = await refreshDirectory();
    const peerRecipients = [];
    for (const id of peers) {
      const st = dir.statuses.get(id);
      if (!st) throw bad('unknown_contact', 'That person is not on this team');
      if (st.status === 'changed') throw bad('identity_changed', "This contact's identity changed. Review it before sending.");
      if (st.status !== 'ok') throw bad('unreachable', 'This contact cannot receive messages right now');
      const pin = await readContact(id);
      if (!pin) throw bad('unknown_contact', 'That person is not on this team');
      peerRecipients.push({ userId: id, bundle: st.entry.bundle, pinnedSignFingerprint: pin.fingerprint });
    }

    await serial(maintainSafely);
    assertUnlocked();
    const mine = newest();
    // seal() fails closed: every recipient, including us, needs a pinned fingerprint.
    const recipients = [...peerRecipients, { userId: me.id, bundle: mine.bundle, pinnedSignFingerprint: S.ident.fingerprint }];
    const convId = await deriveConvId([me.id, ...peers]);

    // Reserve our per-conversation counter before anything leaves the device.
    const n = await serial(async () => {
      const conv = (await readConv(convId)) ?? newConv(peers, await titleFor(peers));
      const reserved = conv.nOut;
      conv.nOut = reserved + 1;
      await writeConv(convId, conv);
      return reserved;
    });

    const envelope = await seal({
      message: { type: 'text', body },
      from: me.id,
      n,
      ttl,
      recipients,
      signPrivateKey: S.ident.signPriv,
      now: clock(),
    });
    if (envelope.header.convId !== convId) throw bad('bad_conv', 'Conversation id mismatch');
    // A failed POST stores nothing. The reserved counter stays used, so peers may see a gap.
    await api.post('/api/chat/messages', { envelope });

    const record = {
      id: envelope.header.id,
      convId,
      from: me.id,
      to: envelope.header.to,
      n,
      ts: envelope.header.ts,
      ttl,
      status: 'sent',
      body,
    };
    await serial(async () => {
      const conv = (await readConv(convId)) ?? newConv(peers, await titleFor(peers));
      if (conv.seen.includes(record.id)) return; // poll() already stored the relay copy
      await putMsg(K.msg(convId, record.ts, record.id), record);
      conv.seen = remember(conv.seen, record.id);
      if (!conv.last || record.ts >= conv.last.ts) conv.last = { preview: previewOf(body, ttl), ts: record.ts, from: me.id };
      await writeConv(convId, conv);
    });
    emit('message', { convId, ...publicMsg(record) });
    emit('conversations');
    return publicMsg(record);
  }

  async function conversationsImpl() {
    const out = [];
    for (const key of await storage.keys(CONV_PREFIX)) {
      const convId = key.slice(CONV_PREFIX.length);
      const conv = await readConv(convId);
      if (!conv) continue;
      out.push({ convId, peerIds: conv.peerIds, title: conv.title, lastMessage: conv.last ?? undefined, unread: conv.unread });
    }
    return out.sort((a, b) => (b.lastMessage?.ts ?? 0) - (a.lastMessage?.ts ?? 0));
  }

  /** Most recent messages, oldest first. Expired bodies are erased from the vault here and never returned. */
  async function messagesImpl(convId, { limit = 100 } = {}) {
    if (!isId(convId)) throw bad('bad_conv', 'Unknown conversation');
    const max = Math.min(Math.max(Math.trunc(limit) || 1, 1), 1000);
    return serial(async () => {
      const keys = (await storage.keys(K.msgPrefix(convId))).slice(-max);
      const t = clock();
      const out = [];
      for (const key of keys) {
        const rec = await readMsg(key);
        if (!rec) continue;
        if (rec.body !== undefined && rec.ttl > 0 && rec.ts + rec.ttl * 1000 < t) {
          delete rec.body;
          rec.status = 'expired';
          await putMsg(key, rec);
        }
        out.push(publicMsg(rec));
      }
      return out;
    });
  }

  async function markReadImpl(convId) {
    await serial(async () => {
      const conv = await readConv(convId);
      if (conv && conv.unread) {
        conv.unread = 0;
        await writeConv(convId, conv);
      }
    });
    emit('conversations');
  }

  /* ---------------- receiving ---------------- */

  /** Pinned signing key for a sender. An unknown sender triggers one directory refresh, which pins first sight. */
  async function pinnedSenderKey(userId) {
    let pin = await readContact(userId);
    if (!pin) {
      await refreshDirectory({ force: true });
      pin = await readContact(userId);
    }
    if (!pin) throw bad('unknown_sender', 'Message from a sender that is not pinned');
    return pin.signPubJwk;
  }

  const lastNOf = (conv, userId) => (Object.prototype.hasOwnProperty.call(conv.lastN, userId) ? conv.lastN[userId] : -1);

  /** Stores one verified, decrypted envelope. Returns 'stored' or 'dup'. Throws on a bad body or storage failure. */
  async function storeReceived({ header, message, expired }) {
    const from = header.from;
    const mine = from === me.id;
    let conv = await readConv(header.convId);
    if (!conv) {
      const peerIds = header.to.filter((id) => id !== me.id);
      conv = newConv(peerIds, await titleFor(peerIds));
    }
    if (conv.seen.includes(header.id)) return 'dup';
    if (!expired && (message?.type !== 'text' || typeof message.body !== 'string' || message.body.length < 1 || message.body.length > BODY_MAX)) {
      throw bad('bad_message', 'Message content is not valid');
    }

    if (!mine) {
      const expectedN = lastNOf(conv, from) + 1;
      if (header.n > expectedN) emit('gap', { convId: header.convId, from, expected: expectedN, got: header.n });
      conv.lastN[from] = Math.max(lastNOf(conv, from), header.n);
    }

    const status = expired ? 'expired' : mine ? 'sent' : 'received';
    const record = { id: header.id, convId: header.convId, from, to: header.to, n: header.n, ts: header.ts, ttl: header.ttl, status };
    if (!expired) record.body = message.body;
    await putMsg(K.msg(header.convId, header.ts, header.id), record);

    conv.seen = remember(conv.seen, header.id);
    if (!mine && !expired) conv.unread += 1;
    if (!conv.last || header.ts >= conv.last.ts) {
      conv.last = { preview: expired ? '' : previewOf(message.body, header.ttl), ts: header.ts, from };
    }
    await writeConv(header.convId, conv);
    emit('message', { convId: header.convId, ...publicMsg(record) });
    return 'stored';
  }

  /**
   * One inbox item. Returns 'stored' | 'dup' (both ackable), 'discard' (key deleted after retention, ackable) or
   * 'poison' (never acked, reported once). Never throws, so one bad item cannot stall the loop.
   */
  async function processItem(item) {
    const seq = item?.seq;
    let opened;
    try {
      assertEnvelopeShape(item?.envelope);
      const from = item.envelope.header.from;
      const senderJwk = from === me.id ? S.ident.signPubJwk : await pinnedSenderKey(from);
      // open() verifies the signature against the pinned key and rejects convId mismatches (bad_conv).
      opened = await open({ envelope: item.envelope, myUserId: me.id, encKeys: S.encKeys, senderSignPublicJwk: senderJwk, now: clock() });
    } catch (e) {
      if (e instanceof CryptoError && e.code === 'no_key') {
        reportError('no_key', 'A message used a key that has been deleted and cannot be read.', seq);
        return 'discard';
      }
      reportError(e?.code ?? 'bad_message', e instanceof CryptoError ? e.message : 'A message could not be read and was skipped.', seq);
      return 'poison';
    }
    try {
      return await storeReceived(opened);
    } catch (e) {
      reportError(e?.code ?? 'store_failed', e instanceof CryptoError ? e.message : 'A message could not be saved and was skipped.', seq);
      return 'poison';
    }
  }

  /**
   * One inbox fetch and processing pass. The ack watermark stops before the first poison item, so a bad message
   * is never acked. The in-memory read position still moves past it, so the loop never stalls.
   */
  async function pollPass({ wait = 0, signal } = {}) {
    await serial(maintainSafely);
    const params = { after: S.readAfter, limit: 100 };
    if (wait) params.wait = wait;
    const res = await api.get('/api/chat/inbox', { params, signal });
    const items = Array.isArray(res?.items) ? res.items : [];
    if (!items.length) return 0;

    return serial(async () => {
      let stored = 0;
      let blocked = false;
      let ackUpTo = 0;
      let lastSeen = S.readAfter;
      for (const item of items) {
        if (S.status !== 'unlocked') break;
        if (!Number.isSafeInteger(item?.seq) || item.seq <= 0) {
          blocked = true;
          reportError('bad_item', 'The server sent a malformed inbox item.');
          continue;
        }
        const outcome = await processItem(item);
        if (outcome === 'stored') stored += 1;
        if (outcome === 'poison') blocked = true;
        else if (!blocked) ackUpTo = item.seq;
        if (item.seq > lastSeen) lastSeen = item.seq;
      }
      S.readAfter = Math.max(S.readAfter, lastSeen);
      if (ackUpTo > S.cursor) {
        await api.post('/api/chat/ack', { upTo: ackUpTo });
        S.cursor = ackUpTo;
        await storage.set(K.cursor, ackUpTo);
      }
      if (stored) emit('conversations');
      return stored;
    });
  }

  function beginPolling() {
    if (S.pollAbort) return;
    const ac = new AbortController();
    S.pollAbort = ac;
    (async () => {
      let delay = BACKOFF_MIN_MS;
      while (!ac.signal.aborted) {
        try {
          await pollPass({ wait: POLL_WAIT_S, signal: ac.signal });
          delay = BACKOFF_MIN_MS;
        } catch (e) {
          if (ac.signal.aborted || e?.name === 'AbortError') break;
          reportError('poll_failed', 'Could not check for new messages. Retrying.');
          try {
            await sleepMs(delay, ac.signal);
          } catch {
            break;
          }
          delay = Math.min(delay * 2, BACKOFF_MAX_MS);
        }
      }
    })();
  }

  function stopPolling() {
    S.pollAbort?.abort();
    S.pollAbort = null;
  }

  /* ---------------- encrypted key backup (identity, encryption keys, pins; no message history) ---------------- */

  async function exportBackupImpl(backupPassphrase) {
    const check = checkPassphrase(backupPassphrase);
    if (!check.ok) throw bad('weak_passphrase', check.reason);
    const idJson = await decryptJson(S.vaultKey, S.meta.identity, 'identity');
    const encKeys = [];
    for (const rec of S.meta.encKeys) {
      encKeys.push({
        keyId: rec.keyId,
        createdAt: rec.createdAt,
        expiresAt: rec.expiresAt,
        retainUntil: rec.retainUntil,
        pubJwk: rec.pubJwk,
        priv: await decryptJson(S.vaultKey, rec.priv, `enc:${rec.keyId}`),
      });
    }
    const contacts = [];
    for (const storageKey of await storage.keys(CONTACT_PREFIX)) {
      const userId = storageKey.slice(CONTACT_PREFIX.length);
      const pin = await readContact(userId);
      if (!pin) continue;
      const c = {
        userId,
        signPubJwk: pin.signPubJwk,
        fingerprint: pin.fingerprint,
        verified: pin.verified,
        name: pin.name,
        identityChanged: pin.identityChanged,
      };
      if (pin.pendingJwk) c.pendingJwk = pin.pendingJwk;
      contacts.push(c);
    }
    const payload = { userId: me.id, identity: { priv: idJson.priv, pub: idJson.pub }, encKeys, contacts };
    const iterations = KDF.iterations;
    const salt = newSalt();
    const backupKek = await deriveKek(backupPassphrase, salt, iterations);
    const blob = await encryptJson(backupKek, payload, 'backup');
    return JSON.stringify({ v: 1, kdf: { iterations, salt: b64.enc(salt) }, blob });
  }

  function checkPrivateJwk(priv, pub) {
    if (
      !priv || typeof priv !== 'object' || priv.kty !== 'EC' || priv.crv !== 'P-256' ||
      priv.x !== pub.x || priv.y !== pub.y || typeof priv.d !== 'string' || !isB64Len(priv.d, 32)
    ) {
      throw bad('bad_backup', 'Backup key material is not valid');
    }
  }

  function parseBackupFile(text) {
    let file;
    try {
      file = JSON.parse(text);
    } catch {
      throw bad('bad_backup', 'Not a LRChat backup file');
    }
    const shapeError = () => bad('bad_backup', 'Unsupported backup format');
    if (!exact(file, ['v', 'kdf', 'blob']) || file.v !== 1) throw shapeError();
    if (!exact(file.kdf, ['iterations', 'salt'])) throw shapeError();
    if (!Number.isInteger(file.kdf.iterations) || file.kdf.iterations < LIMITS.minKdfIterations || file.kdf.iterations > 10_000_000) {
      throw bad('weak_kdf', 'Backup iteration count is out of range');
    }
    if (typeof file.kdf.salt !== 'string' || !isB64Len(file.kdf.salt, 16)) throw shapeError();
    if (!exact(file.blob, ['iv', 'ct']) || typeof file.blob.iv !== 'string' || typeof file.blob.ct !== 'string') throw shapeError();
    return file;
  }

  /** Strict shape check of decrypted backup contents. Returns normalised copies. Throws CryptoError only. */
  async function validateBackupPayload(p) {
    const shapeError = () => bad('bad_backup', 'Backup contents are not valid');
    if (!exact(p, ['userId', 'identity', 'encKeys', 'contacts'])) throw shapeError();
    if (p.userId !== me.id) throw bad('wrong_user', 'This backup belongs to a different account');
    if (!exact(p.identity, ['priv', 'pub'])) throw shapeError();
    const pub = normalizeJwk(p.identity.pub);
    checkPrivateJwk(p.identity.priv, pub);
    if (!Array.isArray(p.encKeys) || p.encKeys.length > 500 || !Array.isArray(p.contacts) || p.contacts.length > 10_000) throw shapeError();

    const keyIds = new Set();
    const encKeys = p.encKeys.map((k) => {
      if (!exact(k, ['keyId', 'createdAt', 'expiresAt', 'retainUntil', 'pubJwk', 'priv']) || !isId(k.keyId) || keyIds.has(k.keyId)) throw shapeError();
      keyIds.add(k.keyId);
      if (![k.createdAt, k.expiresAt, k.retainUntil].every(Number.isSafeInteger)) throw shapeError();
      const pubJwk = normalizeJwk(k.pubJwk);
      checkPrivateJwk(k.priv, pubJwk);
      return { keyId: k.keyId, createdAt: k.createdAt, expiresAt: k.expiresAt, retainUntil: k.retainUntil, pubJwk, priv: k.priv };
    });

    const seenIds = new Set();
    const contacts = [];
    for (const c of p.contacts) {
      if (!exact(c, ['userId', 'signPubJwk', 'fingerprint', 'verified', 'name', 'identityChanged'], ['pendingJwk'])) throw shapeError();
      if (!isId(c.userId) || c.userId === me.id || seenIds.has(c.userId)) throw shapeError();
      seenIds.add(c.userId);
      const signPubJwk = normalizeJwk(c.signPubJwk);
      if (c.fingerprint !== (await fingerprint(signPubJwk))) throw shapeError();
      if (typeof c.verified !== 'boolean' || typeof c.identityChanged !== 'boolean' || typeof c.name !== 'string' || c.name.length > 200) throw shapeError();
      const rec = { signPubJwk, fingerprint: c.fingerprint, verified: c.verified, name: c.name, identityChanged: c.identityChanged };
      if (c.pendingJwk !== undefined) rec.pendingJwk = normalizeJwk(c.pendingJwk);
      contacts.push({ userId: c.userId, rec });
    }
    return { identity: { pub, priv: p.identity.priv }, encKeys, contacts };
  }

  /** Builds a new vault under newPassphrase, clears local data first, writes it (meta last), then publishes a fresh key. */
  async function restoreVault(data, newPassphrase) {
    const iterations = KDF.iterations;
    const salt = newSalt();
    const kek = await deriveKek(newPassphrase, salt, iterations);
    const vaultRaw = await exportAesKey(await newAesKey(true));
    const wrappedVault = await encryptBlob(kek, vaultRaw, 'vault');
    const vaultKey = await importAesKey(vaultRaw);
    vaultRaw.fill(0);
    S.vaultKey = vaultKey;

    const signPriv = await importSignPrivate(data.identity.priv);
    const identityBlob = await encryptJson(vaultKey, { priv: data.identity.priv, pub: data.identity.pub }, 'identity');
    const t = clock();
    const encKeys = [];
    const privKeys = new Map();
    for (const k of data.encKeys) {
      if (k.retainUntil <= t) continue;
      privKeys.set(k.keyId, await importEncPrivate(k.priv));
      encKeys.push({
        keyId: k.keyId,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
        retainUntil: k.retainUntil,
        pubJwk: k.pubJwk,
        priv: await encryptJson(vaultKey, k.priv, `enc:${k.keyId}`),
      });
    }

    await clearAll();
    for (const c of data.contacts) await writeContact(c.userId, c.rec);
    S.meta = { v: 1, userId: me.id, kdf: { iterations, salt: b64.enc(salt) }, vault: wrappedVault, identity: identityBlob, encKeys };
    S.ident = { signPriv, signPubJwk: data.identity.pub, fingerprint: await fingerprint(data.identity.pub) };
    S.encKeys = privKeys;
    S.hasVault = true;
    S.cursor = 0;
    S.readAfter = 0;
    S.publishPending = true;
    await saveMeta();
    setStatus('unlocked');
    touch();
    try {
      await serial(rotateInternal);
    } catch {
      reportError('publish_failed', 'Could not publish your chat keys yet. Will retry.');
    }
  }

  /** Restores a backup into an empty device. Refused if this device already has a vault (wipe first). */
  async function importBackupImpl(text, backupPassphrase, newPassphrase) {
    await init();
    if (S.status !== 'uninitialized') throw bad('already_setup', 'Wipe this device before restoring a backup');
    if (typeof text !== 'string' || text.length > 5_000_000) throw bad('bad_backup', 'Not a LRChat backup file');
    const file = parseBackupFile(text);
    const check = checkPassphrase(newPassphrase);
    if (!check.ok) throw bad('weak_passphrase', check.reason);

    const backupKek = await deriveKek(backupPassphrase, b64.dec(file.kdf.salt), file.kdf.iterations);
    let payload;
    try {
      payload = await decryptJson(backupKek, file.blob, 'backup'); // wrong passphrase: CryptoError bad_decrypt
    } catch (e) {
      if (e instanceof CryptoError) throw e;
      throw bad('bad_backup', 'Backup could not be read');
    }
    const data = await validateBackupPayload(payload);
    try {
      await restoreVault(data, newPassphrase);
    } catch (e) {
      lock();
      if (e instanceof CryptoError) throw e;
      throw bad('bad_backup', 'Backup key material could not be imported');
    }
  }

  return {
    get status() {
      return S.status;
    },
    init,
    setup,
    unlock,
    lock,
    wipe,
    on,
    setAutoLock,
    startPolling() {
      assertUnlocked();
      touch();
      beginPolling();
    },
    stopPolling,
    contacts: guard(contactsImpl),
    conversations: guard(conversationsImpl),
    messages: guard(messagesImpl),
    send: guard(sendImpl),
    markRead: guard(markReadImpl),
    safety: guard(safetyImpl),
    verify: guard(verifyImpl),
    acceptIdentityChange: guard(acceptImpl),
    rotateKeys: guard(rotateKeysImpl),
    exportBackup: guard(exportBackupImpl),
    importBackup: importBackupImpl,
    poll: guard(() => pollPass({})),
  };
}
