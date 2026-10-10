// LRChat crypto core, protocol v1. See docs/CHAT-SECURITY.md for the design and threat model.
//
// Isomorphic on purpose: WebCrypto only, no imports, no side effects. The same file runs in the browser,
// in Node 22 tests (globalThis.crypto) and inlined into the offline HTML mockup.
//
// Primitives: ECDSA P-256/SHA-256 (identity signatures), ECDH P-256 (key agreement), HKDF-SHA-256,
// AES-256-GCM (content + key wrapping), PBKDF2-SHA-256 (passphrase vault).

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

export const PROTOCOL = 'LRChat/v1';
export const LIMITS = Object.freeze({
  maxMessageBytes: 16_000, // serialized plaintext JSON
  maxRecipients: 16,
  clockSkewMs: 5 * 60 * 1000, // tolerated sender clock error
  bundleMaxValidMs: 14 * 86_400_000, // a published key bundle may never claim more than this
  maxTtlSeconds: 30 * 86_400,
  minKdfIterations: 200_000,
});
export const KDF = Object.freeze({ iterations: 600_000 });

export class CryptoError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}
const fail = (code, msg) => { throw new CryptoError(code, msg); };

/* ---------------- encoding ---------------- */

export const b64 = {
  enc(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  },
  dec(str) {
    if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) fail('bad_base64', 'Malformed base64url');
    const bin = atob(str.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (str.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const randomId = (bytes = 16) => b64.enc(rand(bytes));

/** Deterministic JSON (sorted keys, integers only). Everything that is signed or used as AAD goes through this. */
export function canonical(v) {
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) fail('canonical', 'Only safe integers are allowed in signed data');
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return fail('canonical', 'Unsupported type');
}

/* ---------------- keys ---------------- */

const SIGN = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };

/** Long-term identity key (signs bundles and messages). Generate extractable so a keystore can wrap it, then re-import non-extractable. */
export const generateSigningKeyPair = (extractable = true) => subtle.generateKey(SIGN, extractable, ['sign', 'verify']);
/** Rotating encryption key (receives messages). */
export const generateEncKeyPair = (extractable = true) => subtle.generateKey(ECDH, extractable, ['deriveBits']);

const isB64Len = (s, n) => { try { return b64.dec(s).length === n; } catch { return false; } };
/** Validates and normalises an EC P-256 public JWK to exactly {kty,crv,x,y}. */
export function normalizeJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !isB64Len(jwk.x, 32) || !isB64Len(jwk.y, 32)) fail('bad_key', 'Invalid P-256 public key');
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}
export async function exportPublicJwk(publicKey) {
  return normalizeJwk(await subtle.exportKey('jwk', publicKey));
}
/** Private key -> JWK (only possible if it was generated extractable). Used by the keystore to wrap at rest. */
export const exportPrivateJwk = (privateKey) => subtle.exportKey('jwk', privateKey);
export function importSignPublic(jwk) {
  return subtle.importKey('jwk', normalizeJwk(jwk), SIGN, true, ['verify']);
}
export function importEncPublic(jwk) {
  return subtle.importKey('jwk', normalizeJwk(jwk), ECDH, true, []);
}
/** Re-import a private JWK as NON-extractable so scripts can use but never read it again. */
export function importSignPrivate(jwk) {
  return subtle.importKey('jwk', jwk, SIGN, false, ['sign']);
}
export function importEncPrivate(jwk) {
  return subtle.importKey('jwk', jwk, ECDH, false, ['deriveBits']);
}

/** Hex SHA-256 of the canonical public key: the identity's stable fingerprint. */
export async function fingerprint(jwk) {
  return hex(await subtle.digest('SHA-256', te.encode(canonical(normalizeJwk(jwk)))));
}

/**
 * 60-digit safety number (12 groups of 5) both parties compute identically from the two identity
 * fingerprints. Compare it over a channel the server doesn't control (in person, phone call).
 */
export async function safetyNumber(jwkA, jwkB) {
  const [fa, fb] = (await Promise.all([fingerprint(jwkA), fingerprint(jwkB)])).sort();
  const d = new Uint8Array(await subtle.digest('SHA-512', te.encode(`${PROTOCOL}/safety|${fa}|${fb}`)));
  const groups = [];
  for (let g = 0; g < 12; g++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = (n * 256 + d[g * 5 + j]) % 100_000;
    groups.push(String(n).padStart(5, '0'));
  }
  return groups.join(' ');
}

export async function deriveConvId(userIds) {
  const ids = [...new Set(userIds)].sort();
  return hex(await subtle.digest('SHA-256', te.encode(`${PROTOCOL}/conv|${ids.join('|')}`))).slice(0, 32);
}

/* ---------------- key bundles (the public directory entry) ---------------- */

const sign = async (privateKey, domain, payload) => b64.enc(await subtle.sign(SIGN_ALG, privateKey, te.encode(`${PROTOCOL}/${domain}\n${payload}`)));
const verify = async (publicKey, domain, payload, sigB64) => {
  let sig;
  try { sig = b64.dec(sigB64); } catch { return false; }
  return sig.length === 64 && subtle.verify(SIGN_ALG, publicKey, sig, te.encode(`${PROTOCOL}/${domain}\n${payload}`));
};

/**
 * A bundle binds a user's identity signing key to their current encryption key, with a validity window,
 * signed by the identity key. Senders only encrypt to bundles that verify, are unexpired and match the pinned identity.
 */
export async function createBundle({ userId, signPrivateKey, signPublicJwk, encPublicJwk, now = Date.now(), validForMs = 7 * 86_400_000 }) {
  if (!userId || typeof userId !== 'string') fail('bad_bundle', 'userId required');
  if (validForMs > LIMITS.bundleMaxValidMs) fail('bad_bundle', 'Validity window too long');
  const body = {
    v: 1, userId, keyId: randomId(12),
    signPub: normalizeJwk(signPublicJwk), encPub: normalizeJwk(encPublicJwk),
    createdAt: now, expiresAt: now + validForMs,
  };
  return { ...body, sig: await sign(signPrivateKey, 'bundle', canonical(body)) };
}

/** Throws CryptoError on any problem. Returns { userId, keyId, signFingerprint }. */
export async function verifyBundle(bundle, { now = Date.now(), pinnedSignFingerprint } = {}) {
  if (!bundle || bundle.v !== 1 || typeof bundle.userId !== 'string' || typeof bundle.keyId !== 'string' || typeof bundle.sig !== 'string') fail('bad_bundle', 'Malformed key bundle');
  const { sig, ...body } = bundle;
  if (!Number.isSafeInteger(body.createdAt) || !Number.isSafeInteger(body.expiresAt)) fail('bad_bundle', 'Malformed key bundle');
  const signPub = normalizeJwk(body.signPub);
  normalizeJwk(body.encPub);
  const allowedKeys = ['v', 'userId', 'keyId', 'signPub', 'encPub', 'createdAt', 'expiresAt'];
  if (Object.keys(body).some((k) => !allowedKeys.includes(k))) fail('bad_bundle', 'Unexpected fields in key bundle');
  if (body.createdAt > now + LIMITS.clockSkewMs) fail('bundle_from_future', 'Key bundle is dated in the future');
  if (body.expiresAt <= now) fail('bundle_expired', 'Key bundle has expired');
  if (body.expiresAt - body.createdAt > LIMITS.bundleMaxValidMs) fail('bad_bundle', 'Key bundle validity too long');
  if (!(await verify(await importSignPublic(signPub), 'bundle', canonical(body), sig))) fail('bad_signature', 'Key bundle signature is invalid');
  const signFingerprint = await fingerprint(signPub);
  if (pinnedSignFingerprint && signFingerprint !== pinnedSignFingerprint) fail('identity_changed', 'This contact\'s identity key changed');
  return { userId: body.userId, keyId: body.keyId, signFingerprint };
}

/* ---------------- padding ---------------- */

/** Frame = u32 length || bytes || zero padding, to a power-of-two bucket (>= 256) so ciphertext length leaks little. */
function pad(bytes) {
  const need = bytes.length + 4;
  let size = 256;
  while (size < need) size *= 2;
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}
function unpad(framed) {
  if (framed.length < 4) fail('bad_padding');
  const len = new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getUint32(0);
  if (len > framed.length - 4) fail('bad_padding');
  return framed.subarray(4, 4 + len);
}

/* ---------------- messages ---------------- */

const aesKey = (raw, usages) => subtle.importKey('raw', raw, 'AES-GCM', false, usages);
async function hkdfKey(sharedBits, salt, info) {
  const ikm = await subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const gcm = (iv, aad) => ({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 });

const headerAad = (header) => te.encode(`${PROTOCOL}/msg\n${canonical(header)}`);
const wrapAad = (header, to, keyId, eph) => te.encode(`${PROTOCOL}/wrap\n${canonical({ header, to, keyId, eph })}`);
// The recipient is bound through the ECDH secret itself and through keyId/userId in `info` and the AAD.
async function wrapSalt(eph) {
  return new Uint8Array(await subtle.digest('SHA-256', te.encode(`${PROTOCOL}/salt|${canonical(eph)}`)));
}
const wrapInfo = (header, to, keyId) => te.encode(`${PROTOCOL}/wrap|${header.id}|${to}|${keyId}`);

/**
 * Encrypts `message` (a JSON-serialisable object) for every recipient and signs the envelope.
 * recipients: [{ userId, bundle, pinnedSignFingerprint? }]. MUST include the sender (so they can re-read their own
 * history); each bundle is re-verified here, including the pin if one is given.
 */
export async function seal({ message, convId, from, n, ttl = 0, recipients, signPrivateKey, now = Date.now() }) {
  if (!Array.isArray(recipients) || !recipients.length || recipients.length > LIMITS.maxRecipients) fail('bad_recipients');
  const ids = recipients.map((r) => r.userId);
  if (new Set(ids).size !== ids.length) fail('bad_recipients', 'Duplicate recipient');
  if (!ids.includes(from)) fail('bad_recipients', 'The sender must be one of the recipients');
  if (!Number.isSafeInteger(n) || n < 0) fail('bad_header', 'n must be a non-negative integer');
  if (!Number.isSafeInteger(ttl) || ttl < 0 || ttl > LIMITS.maxTtlSeconds) fail('bad_header', 'Invalid ttl');
  if (typeof convId !== 'string' || !convId) fail('bad_header', 'convId required');

  const plain = te.encode(canonical(message));
  if (plain.length > LIMITS.maxMessageBytes) fail('too_large', 'Message too large');

  const header = { v: 1, convId, id: randomId(16), from, to: [...ids].sort(), n, ts: now, ttl };
  const contentRaw = rand(32);
  const iv = rand(12);
  const ct = await subtle.encrypt(gcm(iv, headerAad(header)), await aesKey(contentRaw, ['encrypt']), pad(plain));

  const boxes = [];
  for (const r of recipients) {
    const info = await verifyBundle(r.bundle, { now, pinnedSignFingerprint: r.pinnedSignFingerprint });
    if (info.userId !== r.userId) fail('bad_bundle', 'Bundle belongs to a different user');
    const eph = await generateEncKeyPair(false);
    const ephJwk = await exportPublicJwk(eph.publicKey);
    const shared = await subtle.deriveBits({ name: 'ECDH', public: await importEncPublic(r.bundle.encPub) }, eph.privateKey, 256);
    const kek = await hkdfKey(shared, await wrapSalt(ephJwk), wrapInfo(header, r.userId, r.bundle.keyId));
    const wIv = rand(12);
    const wrapped = await subtle.encrypt(gcm(wIv, wrapAad(header, r.userId, r.bundle.keyId, ephJwk)), kek, contentRaw);
    boxes.push({ to: r.userId, keyId: r.bundle.keyId, eph: ephJwk, iv: b64.enc(wIv), wrapped: b64.enc(wrapped) });
  }
  contentRaw.fill(0);

  const unsigned = { header, boxes, iv: b64.enc(iv), ct: b64.enc(ct) };
  return { ...unsigned, sig: await sign(signPrivateKey, 'envelope', canonical(unsigned)) };
}

const isStr = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
/** Structural validation only (no crypto). The relay uses this too. Throws CryptoError('bad_envelope'). */
export function assertEnvelopeShape(env) {
  const bad = (m) => fail('bad_envelope', m);
  if (!env || typeof env !== 'object') bad('not an object');
  const { header: h, boxes, iv, ct, sig, ...extra } = env;
  if (Object.keys(extra).length) bad('unexpected fields');
  if (!h || h.v !== 1) bad('unsupported version');
  const hk = Object.keys(h).sort().join(',');
  if (hk !== 'convId,from,id,n,to,ts,ttl,v') bad('unexpected header fields');
  if (!isStr(h.convId, 64) || !isStr(h.id, 64) || !isStr(h.from, 64)) bad('bad header');
  if (!Array.isArray(h.to) || !h.to.length || h.to.length > LIMITS.maxRecipients || !h.to.every((x) => isStr(x, 64))) bad('bad recipients');
  if (new Set(h.to).size !== h.to.length || h.to.some((x, i) => i && h.to[i - 1] >= x)) bad('recipients must be sorted and unique');
  if (!h.to.includes(h.from)) bad('sender not among recipients');
  if (![h.n, h.ts, h.ttl].every(Number.isSafeInteger) || h.n < 0 || h.ts < 0 || h.ttl < 0 || h.ttl > LIMITS.maxTtlSeconds) bad('bad header numbers');
  if (!Array.isArray(boxes) || boxes.length !== h.to.length) bad('one box per recipient required');
  boxes.forEach((b) => {
    if (!b || Object.keys(b).sort().join(',') !== 'eph,iv,keyId,to,wrapped') bad('bad box');
    if (!h.to.includes(b.to)) bad('box for unknown recipient');
    if (!isStr(b.keyId, 64) || !isStr(b.iv, 32) || !isStr(b.wrapped, 128)) bad('bad box fields');
    normalizeJwk(b.eph);
  });
  if (new Set(boxes.map((b) => b.to)).size !== boxes.length) bad('duplicate box');
  if (!isStr(iv, 32) || !isStr(ct, 40_000) || !isStr(sig, 128)) bad('bad payload fields');
}

/** Verifies the sender's signature without decrypting. The relay may call this; clients ALWAYS verify themselves. */
export async function verifyEnvelopeSignature(envelope, senderSignPublicJwk) {
  assertEnvelopeShape(envelope);
  const { sig, ...unsigned } = envelope;
  return verify(await importSignPublic(senderSignPublicJwk), 'envelope', canonical(unsigned), sig);
}

/**
 * Verifies and decrypts an envelope addressed to `myUserId`.
 * encKeys: Map<keyId, ECDH private CryptoKey> (current and still-retained old keys).
 * senderSignPublicJwk: the sender's identity key AS PINNED/VERIFIED by the caller. Never take it from the envelope.
 * Returns { header, message, expired }. Throws CryptoError (bad_signature, no_key, bad_decrypt, ...).
 */
export async function open({ envelope, myUserId, encKeys, senderSignPublicJwk, now = Date.now() }) {
  assertEnvelopeShape(envelope);
  const { header, boxes, iv, ct } = envelope;
  if (!(await verifyEnvelopeSignature(envelope, senderSignPublicJwk))) fail('bad_signature', 'Message signature is invalid');
  if (header.ts > now + LIMITS.clockSkewMs) fail('from_future', 'Message is dated in the future');
  const box = boxes.find((b) => b.to === myUserId);
  if (!box) fail('not_recipient', 'This message was not addressed to you');
  const priv = encKeys.get(box.keyId);
  if (!priv) fail('no_key', 'The key this message was encrypted to is no longer available');

  const eph = normalizeJwk(box.eph);
  let contentRaw;
  try {
    const shared = await subtle.deriveBits({ name: 'ECDH', public: await importEncPublic(eph) }, priv, 256);
    const kek = await hkdfKey(shared, await wrapSalt(eph), wrapInfo(header, myUserId, box.keyId));
    contentRaw = new Uint8Array(await subtle.decrypt(gcm(b64.dec(box.iv), wrapAad(header, myUserId, box.keyId, eph)), kek, b64.dec(box.wrapped)));
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    fail('bad_decrypt', 'Could not unwrap the message key');
  }
  let plain;
  try {
    plain = unpad(new Uint8Array(await subtle.decrypt(gcm(b64.dec(iv), headerAad(header)), await aesKey(contentRaw, ['decrypt']), b64.dec(ct))));
  } catch (e) {
    if (e instanceof CryptoError) throw e;
    fail('bad_decrypt', 'Message failed authentication');
  } finally {
    contentRaw.fill(0);
  }
  let message;
  try { message = JSON.parse(td.decode(plain)); } catch { fail('bad_message', 'Message is not valid JSON'); }
  const expired = header.ttl > 0 && now > header.ts + header.ttl * 1000;
  return { header, message, expired };
}

/* ---------------- passphrase vault primitives ---------------- */

/** Passphrase -> AES-256-GCM key-encryption key (non-extractable). */
export async function deriveKek(passphrase, salt, iterations = KDF.iterations) {
  if (typeof passphrase !== 'string' || !passphrase) fail('bad_passphrase');
  if (!Number.isInteger(iterations) || iterations < LIMITS.minKdfIterations) fail('weak_kdf', 'KDF iteration count too low');
  const base = await subtle.importKey('raw', te.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const newSalt = () => rand(16);

/** AES-GCM encrypt bytes with a label bound as AAD (prevents swapping blobs between slots). */
export async function encryptBlob(key, bytes, label) {
  const iv = rand(12);
  return { iv: b64.enc(iv), ct: b64.enc(await subtle.encrypt(gcm(iv, te.encode(`${PROTOCOL}/blob|${label}`)), key, bytes)) };
}
export async function decryptBlob(key, blob, label) {
  try {
    return new Uint8Array(await subtle.decrypt(gcm(b64.dec(blob.iv), te.encode(`${PROTOCOL}/blob|${label}`)), key, b64.dec(blob.ct)));
  } catch {
    return fail('bad_decrypt', 'Wrong passphrase or corrupted data');
  }
}
export const encryptJson = (key, obj, label) => encryptBlob(key, te.encode(JSON.stringify(obj)), label);
export async function decryptJson(key, blob, label) {
  return JSON.parse(td.decode(await decryptBlob(key, blob, label)));
}
export const newAesKey = (extractable = true) => subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
export const importAesKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
export const exportAesKey = async (key) => new Uint8Array(await subtle.exportKey('raw', key));

const COMMON = new Set(['password1234', 'passwordpassword', 'qwertyuiopas', '123456789012', 'letmeinletmein', 'iloveyou1234']);
/** Minimal passphrase policy: length first. >= 12 chars and not a trivially common/repeated string. */
export function checkPassphrase(p) {
  if (typeof p !== 'string' || p.length < 12) return { ok: false, reason: 'Use at least 12 characters. A few random words works well.' };
  if (p.length > 256) return { ok: false, reason: 'Too long (max 256).' };
  if (COMMON.has(p.toLowerCase()) || /^(.)\1+$/.test(p)) return { ok: false, reason: 'That passphrase is too easy to guess.' };
  if (new Set(p).size < 5) return { ok: false, reason: 'Use more varied characters.' };
  return { ok: true };
}
