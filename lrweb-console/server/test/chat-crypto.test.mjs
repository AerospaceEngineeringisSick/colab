// LRChat crypto red team. Attacks web/js/chat/crypto.js the way a malicious server, a team member or a network
// attacker would: forged, mutated, replayed, re-signed and malformed input. Each `todo` test asserts the secure
// behaviour and fails until crypto.js is fixed (node:test reports it as TODO, so the suite stays green).
// Tests whose name starts with "documents" pin down a design choice that callers must handle.
// Run: node --test server/test/chat-crypto.test.mjs
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../web/js/chat/crypto.js';

const {
  PROTOCOL, LIMITS, KDF, CryptoError, b64, canonical, seal, open, createBundle, verifyBundle,
  verifyEnvelopeSignature, assertEnvelopeShape, generateSigningKeyPair, generateEncKeyPair,
  exportPublicJwk, fingerprint, safetyNumber, deriveConvId, deriveKek, encryptJson, decryptJson,
  newSalt, checkPassphrase,
} = C;

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();
const MIN = 60_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0); // every call below passes this clock explicitly
const CONV = 'conv-alice-bob';
const ITER = 200_000; // the iteration floor: the cheapest count the vault accepts, keeps PBKDF2 fast in tests
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/* ---------------- helpers ---------------- */

/** mulberry32: a seeded PRNG so every fuzz run is reproducible. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolves to the CryptoError code, 'resolved' if nothing was thrown, or a description of a non-CryptoError. */
async function codeOf(promise) {
  try {
    await promise;
    return 'resolved';
  } catch (e) {
    return e instanceof CryptoError ? e.code : `NOT CryptoError: ${e?.name}: ${e?.message}`;
  }
}

/** Passes only when the promise rejects with a CryptoError (any code). Returns the code. */
async function expectCryptoError(promise, label) {
  const code = await codeOf(promise);
  assert.ok(code !== 'resolved' && !code.startsWith('NOT CryptoError'), `${label}: expected a CryptoError, got ${code}`);
  return code;
}

const clone = (v) => structuredClone(v);
const bodyOf = (signed) => { const { sig, ...body } = signed; return body; };
const flipMiddle = (s) => { const i = Math.floor(s.length / 2); return s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1); };
const rand12 = () => globalThis.crypto.getRandomValues(new Uint8Array(12));
const boxFor = (env, userId) => env.boxes.findIndex((b) => b.to === userId);
const deep = (depth) => { let v = 1; for (let i = 0; i < depth; i++) v = { a: v }; return v; };

/** Creates an identity (signing key), an encryption key, and a 7-day bundle, all at T0. */
async function person(userId) {
  const sign = await generateSigningKeyPair();
  const enc = await generateEncKeyPair();
  const signJwk = await exportPublicJwk(sign.publicKey);
  const encJwk = await exportPublicJwk(enc.publicKey);
  const bundle = await createBundle({ userId, signPrivateKey: sign.privateKey, signPublicJwk: signJwk, encPublicJwk: encJwk, now: T0 });
  return { userId, sign, enc, signJwk, encJwk, bundle, fp: await fingerprint(signJwk), encKeys: new Map([[bundle.keyId, enc.privateKey]]) };
}

/** Publishes a fresh encryption key for `p`. The previous private key is dropped unless keepOld is set. */
async function rotate(p, { keepOld = false } = {}) {
  const enc = await generateEncKeyPair();
  const encJwk = await exportPublicJwk(enc.publicKey);
  const bundle = await createBundle({ userId: p.userId, signPrivateKey: p.sign.privateKey, signPublicJwk: p.signJwk, encPublicJwk: encJwk, now: T0 });
  const encKeys = new Map(keepOld ? p.encKeys : []);
  encKeys.set(bundle.keyId, enc.privateKey);
  return { ...p, enc, encJwk, bundle, encKeys };
}

const [alice, bob, carol, mallory] = await Promise.all(['alice', 'bob', 'carol', 'mallory'].map(person));

const recipientsOf = (people) => people.map((p) => ({ userId: p.userId, bundle: p.bundle, pinnedSignFingerprint: p.fp }));

/** Seals as `sender` to `people` (which must include the sender), pinning every recipient. */
const sealAs = (sender, people, { message = { text: 'hello' }, convId = CONV, n = 0, ttl = 0, now = T0 } = {}) =>
  seal({ message, convId, from: sender.userId, n, ttl, now, recipients: recipientsOf(people), signPrivateKey: sender.sign.privateKey });

/** Opens `env` as `reader`, verifying against the key `sender` has pinned. */
const openAs = (reader, env, sender, { now = T0, encKeys = reader.encKeys } = {}) =>
  open({ envelope: env, myUserId: reader.userId, encKeys, senderSignPublicJwk: sender.signJwk, now });

const signWith = async (privateKey, domain, payload) =>
  b64.enc(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, te.encode(`${PROTOCOL}/${domain}\n${payload}`)));

/** Re-signs an envelope as `sender`, so a tampered body still carries a valid signature. */
async function resign(env, sender) {
  const { sig, ...unsigned } = env;
  return { ...unsigned, sig: await signWith(sender.sign.privateKey, 'envelope', canonical(unsigned)) };
}

/** Signs a raw bundle body as `signer`, bypassing createBundle's own checks. */
async function signBundle(body, signer) {
  const { sig, ...unsigned } = body;
  return { ...unsigned, sig: await signWith(signer.sign.privateKey, 'bundle', canonical(unsigned)) };
}

/** White box: unwraps the content key that `reader` can recover from `env` (mirrors the documented wrap construction). */
async function contentKeyFor(env, reader) {
  const box = env.boxes.find((b) => b.to === reader.userId);
  const ecdhPub = await subtle.importKey('jwk', box.eph, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: ecdhPub }, reader.enc.privateKey, 256);
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(await subtle.digest('SHA-256', te.encode(`${PROTOCOL}/salt|${canonical(box.eph)}`)));
  const info = te.encode(`${PROTOCOL}/wrap|${env.header.id}|${reader.userId}|${box.keyId}`);
  const kek = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const aad = te.encode(`${PROTOCOL}/wrap\n${canonical({ header: env.header, to: reader.userId, keyId: box.keyId, eph: box.eph })}`);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(box.iv), additionalData: aad, tagLength: 128 }, kek, b64.dec(box.wrapped)));
}

/** White box: decrypts the content with a recovered content key, returning the message (checks the oracle itself). */
async function decryptWithContentKey(env, contentRaw) {
  const key = await subtle.importKey('raw', contentRaw, 'AES-GCM', false, ['decrypt']);
  const aad = te.encode(`${PROTOCOL}/msg\n${canonical(env.header)}`);
  const framed = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(env.iv), additionalData: aad, tagLength: 128 }, key, b64.dec(env.ct)));
  const len = new DataView(framed.buffer).getUint32(0);
  return JSON.parse(td.decode(framed.subarray(4, 4 + len)));
}

/** Every leaf of a value as a path, e.g. ['boxes', 1, 'eph', 'x']. */
const isLeaf = (v) => v === null || typeof v !== 'object';
function leafPaths(v, path = []) {
  if (isLeaf(v)) return [path];
  return Object.keys(v).flatMap((k) => leafPaths(v[k], [...path, Array.isArray(v) ? Number(k) : k]));
}
const getAt = (root, path) => path.reduce((o, k) => o[k], root);
const parentOf = (root, path) => getAt(root, path.slice(0, -1));
const setAt = (root, path, value) => { parentOf(root, path)[path.at(-1)] = value; };
const delAt = (root, path) => { delete parentOf(root, path)[path.at(-1)]; };

/** Hostile replacement values for one leaf. Only values that differ from the original are kept. */
function variantsOf(value) {
  if (typeof value === 'string') {
    return [
      ['middle character changed', value.length ? flipMiddle(value) : value],
      ['last character dropped', value.slice(0, -1)],
      ['character appended', `${value}A`],
      ['four characters dropped', value.slice(0, -4)],
      ['four characters appended', `${value}AAAA`],
      ['emptied', ''],
      ['replaced by a number', 1],
      ['replaced by null', null],
      ['replaced by an object', {}],
      ['replaced by an array', []],
    ].filter(([, v]) => v !== value);
  }
  if (typeof value === 'number') {
    return [
      ['plus one', value + 1],
      ['minus one', value - 1],
      ['fraction', value + 0.5],
      ['numeric string', String(value)],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['beyond the safe integer range', 2 ** 53],
    ].filter(([, v]) => v !== value);
  }
  return [];
}

/** Structural attacks on a whole envelope (the envelope is sealed to alice and bob, in that box order). */
const STRUCTURAL = {
  'unexpected top-level field': (e) => { e.extra = 1; },
  'unexpected header field': (e) => { e.header.extra = 'x'; },
  'unexpected box field': (e) => { e.boxes[0].extra = 'x'; },
  'unexpected eph field': (e) => { e.boxes[0].eph.extra = 'x'; },
  'header replaced by an array': (e) => { e.header = []; },
  'header replaced by null': (e) => { e.header = null; },
  'boxes replaced by an object': (e) => { e.boxes = {}; },
  'boxes replaced by null': (e) => { e.boxes = null; },
  'recipients as a string': (e) => { e.header.to = 'bob'; },
  'recipients reversed': (e) => { e.header.to.reverse(); },
  'boxes reversed only': (e) => { e.boxes.reverse(); },
  'duplicate recipient': (e) => { e.header.to = ['alice', 'alice']; },
  'duplicated box': (e) => { e.boxes = [e.boxes[0], clone(e.boxes[0])]; },
  'one box too many': (e) => { e.boxes.push(clone(e.boxes[0])); },
  'one box too few': (e) => { e.boxes.pop(); },
  'box addressed to a non-recipient': (e) => { e.boxes[1].to = 'carol'; },
  'sender not among recipients': (e) => { e.header.from = 'carol'; },
  'unsupported version': (e) => { e.header.v = 2; },
};

/** Every single-field mutation of `root`, plus the structural attacks. Yields [label, mutatedCopy]. */
function* mutants(root) {
  for (const path of leafPaths(root)) {
    const where = path.join('.');
    for (const [label, value] of variantsOf(getAt(root, path))) {
      const m = clone(root);
      setAt(m, path, value);
      yield [`${where}: ${label}`, m];
    }
    if (typeof path.at(-1) === 'string') {
      const m = clone(root);
      delAt(m, path);
      yield [`${where}: deleted`, m];
    }
  }
  for (const [label, edit] of Object.entries(STRUCTURAL)) {
    const m = clone(root);
    edit(m);
    yield [label, m];
  }
}

/* ---------------- 1. correctness ---------------- */

describe('1. correctness', () => {
  test('1:1 roundtrip for ASCII, emoji, multi-script and awkward text, and the sender can re-read it', async () => {
    const samples = [
      '', 'hello', 'Café déjà vu, naïve façade', '日本語のテキスト、ひらがなとカタカナ', 'مرحبا بالعالم',
      'Привет, мир', 'emoji 👩🏽‍🚀 🇬🇧 👍🏿 with a zero-width joiner', 'line one\nline two\ttabbed "quoted" back\\slash',
      '\u0000\u001f control characters', 'lone surrogate \ud800 survives',
    ];
    for (const text of samples) {
      const env = await sealAs(alice, [alice, bob], { message: { text } });
      const got = await openAs(bob, env, alice);
      assert.deepEqual(got.message, { text });
      assert.equal(got.header.from, 'alice');
      assert.equal(got.expired, false);
      assert.deepEqual((await openAs(alice, env, alice)).message, { text });
    }
  });

  test('non-object JSON messages roundtrip (string, number, null, array)', async () => {
    for (const message of ['just a string', 42, null, [1, 'two', { three: 3 }]]) {
      const env = await sealAs(alice, [alice, bob], { message });
      assert.deepEqual((await openAs(bob, env, alice)).message, message);
    }
  });

  test('3-person group: every member, including the sender, reads the message; boxes match header.to', async () => {
    const env = await sealAs(alice, [alice, bob, carol], { message: { text: 'group hello' } });
    for (const reader of [alice, bob, carol]) {
      assert.deepEqual((await openAs(reader, env, alice)).message, { text: 'group hello' }, reader.userId);
    }
    assert.deepEqual(env.header.to, ['alice', 'bob', 'carol']);
    assert.deepEqual(env.boxes.map((b) => b.to).sort(), env.header.to);
    assert.equal(new Set(env.boxes.map((b) => b.to)).size, 3);
  });

  test('a member outside the recipient list cannot open a message, even with a valid key', async () => {
    const env = await sealAs(alice, [alice, bob], { message: { text: 'private' } });
    assert.equal(await codeOf(openAs(carol, env, alice)), 'not_recipient');
  });

  test('header carries exactly the sealed metadata, with recipients sorted', async () => {
    const env = await sealAs(bob, [bob, alice], { n: 7, ttl: 120, now: T0 + 1000 });
    assert.deepEqual(Object.keys(env.header).sort(), ['convId', 'from', 'id', 'n', 'to', 'ts', 'ttl', 'v']);
    assert.equal(env.header.v, 1);
    assert.equal(env.header.convId, CONV);
    assert.equal(env.header.from, 'bob');
    assert.deepEqual(env.header.to, ['alice', 'bob']);
    assert.deepEqual([env.header.n, env.header.ts, env.header.ttl], [7, T0 + 1000, 120]);
    assert.match(env.header.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal((await openAs(alice, env, bob, { now: T0 + 1000 })).expired, false);
  });

  test('maximum size: 16000 bytes of JSON seals and opens; one byte more is too_large', async () => {
    const max = 'a'.repeat(LIMITS.maxMessageBytes - 2); // canonical JSON adds two quote characters
    assert.equal(te.encode(canonical(max)).length, LIMITS.maxMessageBytes);
    const env = await sealAs(alice, [alice, bob], { message: max });
    assert.equal((await openAs(bob, env, alice)).message, max);
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { message: 'a'.repeat(LIMITS.maxMessageBytes - 1) })), 'too_large');
  });

  test('size is counted in UTF-8 bytes, not characters', async () => {
    const fits = 'é'.repeat(7999); // two bytes each in UTF-8, plus two quotes = exactly 16000 bytes
    assert.equal(te.encode(canonical(fits)).length, LIMITS.maxMessageBytes);
    const env = await sealAs(alice, [alice, bob], { message: fits });
    assert.equal((await openAs(bob, env, alice)).message, fits);
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { message: 'é'.repeat(8000) })), 'too_large');
  });

  test('padding hides length: short messages share one 256-byte bucket, longer ones step to the next power of two', async () => {
    const ctBytes = (env) => b64.dec(env.ct).length;
    const short = await sealAs(alice, [alice, bob], { message: 'yes' });
    const longer = await sealAs(alice, [alice, bob], { message: 'a considerably longer but still short message body' });
    assert.equal(ctBytes(short), 256 + 16); // frame + 128-bit GCM tag
    assert.equal(ctBytes(longer), ctBytes(short));
    assert.equal(ctBytes(await sealAs(alice, [alice, bob], { message: 'x'.repeat(300) })), 512 + 16);
  });

  test('padding bucket follows the power-of-two rule at every boundary', async () => {
    for (const len of [0, 1, 250, 251, 506, 507, 1000, 4000, 9000]) {
      let bucket = 256;
      while (bucket < len + 6) bucket *= 2; // canonical JSON of 'x'.repeat(len) is len + 2 bytes, plus a 4-byte length prefix
      const env = await sealAs(alice, [alice, bob], { message: 'x'.repeat(len) });
      assert.equal(b64.dec(env.ct).length - 16, bucket, `length ${len}`);
    }
  });

  test('every seal draws a fresh content key, iv, ephemeral keys and message id', async () => {
    const msg = { text: 'same text every time' };
    const a = await sealAs(alice, [alice, bob, carol], { message: msg });
    const b = await sealAs(alice, [alice, bob, carol], { message: msg });
    assert.notEqual(a.header.id, b.header.id);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
    assert.notEqual(a.sig, b.sig);
    const boxValues = (env) => env.boxes.flatMap((x) => [x.eph.x, x.iv, x.wrapped]);
    assert.equal(new Set([...boxValues(a), ...boxValues(b)]).size, boxValues(a).length * 2, 'ephemerals and ivs are unique');
    const ka = await contentKeyFor(a, bob);
    const kb = await contentKeyFor(b, bob);
    assert.equal(ka.length, 32);
    assert.notDeepEqual(ka, kb, 'content key reused across seals');
    assert.deepEqual(await contentKeyFor(a, carol), ka, 'every box of one message wraps the same content key');
    assert.deepEqual(await decryptWithContentKey(a, ka), msg, 'oracle sanity check');
    assert.deepEqual(await decryptWithContentKey(b, kb), msg, 'oracle sanity check');
  });

  test('seal refuses bad recipient lists', async () => {
    assert.equal(await codeOf(sealAs(alice, [])), 'bad_recipients');
    assert.equal(await codeOf(sealAs(alice, [bob])), 'bad_recipients', 'sender missing');
    assert.equal(await codeOf(sealAs(alice, [alice, alice, bob])), 'bad_recipients', 'duplicate');
    const crowd = [alice, ...(await Promise.all(Array.from({ length: LIMITS.maxRecipients - 1 }, (_, i) => person(`member${i}`))))];
    assert.equal(crowd.length, LIMITS.maxRecipients);
    assert.equal((await openAs(crowd[7], await sealAs(alice, crowd), alice)).message.text, 'hello', 'the maximum group opens');
    assert.equal(await codeOf(sealAs(alice, [...crowd, await person('member99')])), 'bad_recipients', 'one over the maximum');
  });

  test('seal validates header numbers, ttl and convId', async () => {
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { n: -1 })), 'bad_header');
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { n: 1.5 })), 'bad_header');
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { ttl: LIMITS.maxTtlSeconds + 1 })), 'bad_header');
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { convId: '' })), 'bad_header');
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { ttl: LIMITS.maxTtlSeconds })), 'resolved', 'the maximum ttl is allowed');
  });
});

/* ---------------- 2. integrity: every field of a valid envelope ---------------- */

describe('2. integrity: every field of a valid envelope', () => {
  let base;
  before(async () => {
    base = await sealAs(alice, [alice, bob], { message: { text: 'integrity' } });
  });

  test('the untouched envelope opens, and the relay-facing helpers agree with open', async () => {
    assert.doesNotThrow(() => assertEnvelopeShape(base));
    assert.equal((await openAs(bob, base, alice)).message.text, 'integrity');
    assert.equal(await verifyEnvelopeSignature(base, alice.signJwk), true);
    const tampered = { ...clone(base), ct: flipMiddle(base.ct) };
    assert.equal(await verifyEnvelopeSignature(tampered, alice.signJwk), false, 'returns false rather than throwing');
    assert.equal(await codeOf(verifyEnvelopeSignature({ ...base, extra: 1 }, alice.signJwk)), 'bad_envelope');
  });

  test('every mutation of a signed envelope is rejected with CryptoError (no re-signing)', async () => {
    const escaped = [];
    let count = 0;
    for (const [label, m] of mutants(base)) {
      count++;
      const code = await codeOf(openAs(bob, m, alice));
      if (code === 'resolved' || code.startsWith('NOT CryptoError')) escaped.push(`${label} -> ${code}`);
    }
    assert.ok(count > 250, `only ${count} mutants generated`);
    assert.deepEqual(escaped, []);
  });

  test('every mutation re-signed by the real sender is still rejected (shape and AAD checks, not only the signature)', async () => {
    const escaped = [];
    for (const [label, m] of mutants(base)) {
      // sig mutations are replaced by resign, so they test nothing here. Boxes[0] belongs to alice: bob never
      // unwraps it, so a corrupted alice box with a valid signature is covered by a documents test in section 4.
      // Extra eph fields are covered by a todo below. Reordering boxes is harmless and accepted by design.
      if (label.startsWith('sig:') || label.startsWith('boxes.0.') || label === 'unexpected eph field' || label === 'boxes reversed only') continue;
      let resigned;
      try {
        resigned = await resign(m, alice);
      } catch {
        continue; // not signable at all (NaN or Infinity), so the unsigned sweep above covers it
      }
      const code = await codeOf(openAs(bob, resigned, alice));
      if (code === 'resolved' || code.startsWith('NOT CryptoError')) escaped.push(`${label} -> ${code}`);
    }
    assert.deepEqual(escaped, []);
  });

  test('a box re-labelled to another recipient is caught by shape checks, even when re-signed', async () => {
    const e = clone(base);
    e.boxes[boxFor(e, 'bob')].to = 'carol';
    assert.equal(await codeOf(openAs(bob, await resign(e, alice), alice)), 'bad_envelope');
  });

  test('todo: a sender-signed box.eph with an unexpected field is rejected', {
    todo: 'normalizeJwk tolerates extra JWK members, so signed junk inside box.eph is accepted',
  }, async () => {
    const e = clone(base);
    e.boxes[boxFor(e, 'bob')].eph.extra = 'x';
    await expectCryptoError(openAs(bob, await resign(e, alice), alice), 'extra eph field');
  });

  test('todo: deeply nested junk inside box.eph fails with a CryptoError, not a RangeError', {
    todo: 'eph accepts extra members and canonical() recurses without a limit, so a RangeError escapes open()',
  }, async () => {
    const e = clone(base);
    e.boxes[boxFor(e, 'bob')].eph.junk = deep(3000); // unsigned: canonical() runs before the signature check
    await expectCryptoError(openAs(bob, e, alice), 'deep eph junk');
  });
});

/* ---------------- 3. property fuzz ---------------- */

describe('3. property fuzz of the serialised envelope', () => {
  let fuzzEnv;
  let original;
  before(async () => {
    fuzzEnv = await sealAs(alice, [alice, bob], { message: { text: 'fuzz me' } });
    original = JSON.stringify(fuzzEnv);
  });
  const ALPHABET = `${B64URL}+/=.,:;"\\{}[] |*`;

  test('500 seeded single-character mutations: CryptoError, or the same message back', async () => {
    const rnd = prng(20261010);
    const tally = { unparsable: 0, rejected: 0, accepted: 0, sigRespelled: 0 };
    const problems = [];
    for (let i = 0; i < 500; i++) {
      const pos = Math.floor(rnd() * original.length);
      const next = rnd() < 0.5
        ? ALPHABET[Math.floor(rnd() * ALPHABET.length)]
        : String.fromCharCode(original.charCodeAt(pos) ^ (1 << Math.floor(rnd() * 7)));
      const text = original.slice(0, pos) + next + original.slice(pos + 1);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        tally.unparsable++;
        continue;
      }
      try {
        const got = await openAs(bob, parsed, alice);
        tally.accepted++;
        // A surviving mutation must be harmless: same signed content, same message. The only such
        // re-encoding the code allows today is a different spelling of the signature (see section 4 todos).
        const { sig: _mutatedSig, ...mutatedRest } = parsed;
        const { sig: _originalSig, ...originalRest } = fuzzEnv;
        if (canonical(mutatedRest) !== canonical(originalRest) || canonical(got.message) !== canonical({ text: 'fuzz me' })) {
          problems.push(`#${i} at ${pos}: accepted with changed content`);
        } else if (parsed.sig !== fuzzEnv.sig) {
          tally.sigRespelled++;
        }
      } catch (e) {
        if (e instanceof CryptoError) tally.rejected++;
        else problems.push(`#${i} at ${pos}: ${e?.name}: ${e?.message}`);
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(tally.rejected >= 350, `too few rejections to be meaningful: ${JSON.stringify(tally)}`);
  });
});

/* ---------------- 4. authenticity and recipient binding ---------------- */

describe('4. authenticity and recipient binding', () => {
  test('forged sender key: verifying against an attacker key gives bad_signature', async () => {
    const env = await sealAs(alice, [alice, bob]);
    const code = await codeOf(open({ envelope: env, myUserId: 'bob', encKeys: bob.encKeys, senderSignPublicJwk: mallory.signJwk, now: T0 }));
    assert.equal(code, 'bad_signature');
  });

  test('a signature made by another identity over the same bytes is rejected', async () => {
    const env = await sealAs(alice, [alice, bob]);
    assert.equal(await codeOf(openAs(bob, await resign(env, mallory), alice)), 'bad_signature');
  });

  test('an attacker who seals with from set to alice is rejected by alice pinned key', async () => {
    const forged = await seal({
      message: { text: 'I am alice' }, convId: CONV, from: 'alice', n: 0, ttl: 0, now: T0,
      recipients: recipientsOf([alice, bob]), signPrivateKey: mallory.sign.privateKey,
    });
    assert.equal(await codeOf(openAs(bob, forged, alice)), 'bad_signature');
  });

  test('documents: open verifies against the key it is handed, so callers must look up the pinned key of header.from', async () => {
    const forged = await seal({
      message: { text: 'I am alice' }, convId: CONV, from: 'alice', n: 0, ttl: 0, now: T0,
      recipients: recipientsOf([alice, bob]), signPrivateKey: mallory.sign.privateKey,
    });
    assert.equal((await openAs(bob, forged, mallory)).message.text, 'I am alice');
  });

  test('box from message A spliced into message B, re-signed by the sender: unwrap fails (bad_decrypt)', async () => {
    const a = await sealAs(alice, [alice, bob], { message: { text: 'A' }, n: 0 });
    const b = await sealAs(alice, [alice, bob], { message: { text: 'B' }, n: 1 });
    const spliced = clone(b);
    spliced.boxes[boxFor(b, 'bob')] = clone(a.boxes[boxFor(a, 'bob')]);
    assert.equal(await codeOf(openAs(bob, await resign(spliced, alice), alice)), 'bad_decrypt');
  });

  test('replaying message A box with message B header, re-signed by the sender: bad_decrypt', async () => {
    const a = await sealAs(alice, [alice, bob], { message: { text: 'A' }, n: 0 });
    const b = await sealAs(alice, [alice, bob], { message: { text: 'B' }, n: 1 });
    const replay = clone(b);
    replay.boxes[boxFor(b, 'bob')] = clone(a.boxes[boxFor(a, 'bob')]);
    assert.equal(await codeOf(openAs(bob, await resign(replay, alice), alice)), 'bad_decrypt');
  });

  test('the same box splice without re-signing is rejected by the signature', async () => {
    const a = await sealAs(alice, [alice, bob], { message: { text: 'A' } });
    const b = await sealAs(alice, [alice, bob], { message: { text: 'B' }, n: 1 });
    const spliced = clone(b);
    spliced.boxes[boxFor(b, 'bob')] = clone(a.boxes[boxFor(a, 'bob')]);
    assert.equal(await codeOf(openAs(bob, spliced, alice)), 'bad_signature');
  });

  test('a box addressed to someone else: carol cannot open it, and a box relabelled to carol is rejected by shape checks', async () => {
    const env = await sealAs(alice, [alice, bob]);
    assert.equal(await codeOf(openAs(carol, env, alice)), 'not_recipient');
    const relabelled = clone(env);
    relabelled.boxes[boxFor(env, 'bob')].to = 'carol';
    assert.equal(await codeOf(openAs(bob, await resign(relabelled, alice), alice)), 'bad_envelope');
  });

  test('wrong private key for the box keyId: bad_decrypt', async () => {
    const env = await sealAs(alice, [alice, bob]);
    const wrongKey = new Map([[bob.bundle.keyId, carol.enc.privateKey]]);
    assert.equal(await codeOf(openAs(bob, env, alice, { encKeys: wrongKey })), 'bad_decrypt');
  });

  test('missing key: no_key', async () => {
    const env = await sealAs(alice, [alice, bob]);
    assert.equal(await codeOf(openAs(bob, env, alice, { encKeys: new Map() })), 'no_key');
  });

  test('old key after rotation: a message sealed to the old bundle needs the old private key', async () => {
    const oldEnvelope = await sealAs(alice, [alice, bob]);
    const rotatedOnly = await rotate(bob);
    assert.notEqual(rotatedOnly.bundle.keyId, bob.bundle.keyId);
    assert.equal(await codeOf(openAs(rotatedOnly, oldEnvelope, alice)), 'no_key');
    const rotatedKeepingOld = await rotate(bob, { keepOld: true });
    assert.equal((await openAs(rotatedKeepingOld, oldEnvelope, alice)).message.text, 'hello');
    const fresh = await sealAs(alice, [alice, rotatedOnly]);
    assert.equal((await openAs(rotatedOnly, fresh, alice)).message.text, 'hello', 'the new bundle works with the new key');
  });

  test('documents: a reader unwraps only its own box, so a corrupted box for another recipient does not stop bob reading', async () => {
    const env = await sealAs(alice, [alice, bob], { message: { text: 'still readable' } });
    const corrupted = clone(env);
    corrupted.boxes[boxFor(env, 'alice')].wrapped = flipMiddle(corrupted.boxes[boxFor(env, 'alice')].wrapped);
    assert.equal((await openAs(bob, await resign(corrupted, alice), alice)).message.text, 'still readable');
  });
});

/* ---------------- 5. key bundles and the directory ---------------- */

describe('5. key bundles and the directory', () => {
  const raw = (overrides, signer = alice) => signBundle({ ...bodyOf(alice.bundle), ...overrides }, signer);

  test('a valid bundle verifies and reports its identity fingerprint', async () => {
    assert.deepEqual(await verifyBundle(alice.bundle, { now: T0, pinnedSignFingerprint: alice.fp }),
      { userId: 'alice', keyId: alice.bundle.keyId, signFingerprint: alice.fp });
  });

  test('tampered bundle fields break the signature: encPub, userId, keyId, signPub, expiresAt, createdAt, sig', async () => {
    const cases = {
      'encPub swapped': { ...alice.bundle, encPub: carol.encJwk },
      'userId changed': { ...alice.bundle, userId: 'bob' },
      'keyId changed': { ...alice.bundle, keyId: 'AAAAAAAAAAAAAAAA' },
      'expiry extended': { ...alice.bundle, expiresAt: alice.bundle.expiresAt + DAY },
      'createdAt backdated': { ...alice.bundle, createdAt: T0 - DAY },
      'signPub swapped for an attacker key': { ...alice.bundle, signPub: mallory.signJwk },
      'signature from another identity': { ...alice.bundle, sig: bob.bundle.sig },
    };
    for (const [label, bundle] of Object.entries(cases)) {
      assert.equal(await codeOf(verifyBundle(bundle, { now: T0 })), 'bad_signature', label);
    }
  });

  test('signed future createdAt: rejected beyond 5 minutes, accepted exactly at 5 minutes', async () => {
    assert.equal(await codeOf(verifyBundle(await raw({ createdAt: T0 + 5 * MIN + 1 }), { now: T0 })), 'bundle_from_future');
    assert.equal((await verifyBundle(await raw({ createdAt: T0 + 5 * MIN }), { now: T0 })).userId, 'alice');
  });

  test('validity above the 14 day limit is rejected, exactly 14 days is accepted', async () => {
    assert.equal(await codeOf(verifyBundle(await raw({ expiresAt: T0 + 14 * DAY + 1 }), { now: T0 })), 'bad_bundle');
    assert.equal((await verifyBundle(await raw({ expiresAt: T0 + 14 * DAY }), { now: T0 })).userId, 'alice');
    await assert.rejects(
      createBundle({ userId: 'x', signPrivateKey: alice.sign.privateKey, signPublicJwk: alice.signJwk, encPublicJwk: alice.encJwk, now: T0, validForMs: 14 * DAY + 1 }),
      (e) => e instanceof CryptoError && e.code === 'bad_bundle',
    );
  });

  test('expired at expiresAt (boundary inclusive), valid one millisecond earlier', async () => {
    assert.equal(await codeOf(verifyBundle(alice.bundle, { now: alice.bundle.expiresAt })), 'bundle_expired');
    assert.equal((await verifyBundle(alice.bundle, { now: alice.bundle.expiresAt - 1 })).userId, 'alice');
  });

  test('wrong pinned fingerprint: identity_changed', async () => {
    assert.equal(await codeOf(verifyBundle(alice.bundle, { now: T0, pinnedSignFingerprint: bob.fp })), 'identity_changed');
  });

  test('extra top-level fields are rejected, signed or not', async () => {
    assert.equal(await codeOf(verifyBundle(await raw({ note: 'x' }), { now: T0 })), 'bad_bundle', 'signed');
    assert.equal(await codeOf(verifyBundle({ ...alice.bundle, note: 'x' }, { now: T0 })), 'bad_bundle', 'unsigned');
  });

  test('malformed identity or encryption JWKs are rejected with bad_key, even when signed', async () => {
    const p384 = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign', 'verify']);
    const zeros = (n) => b64.enc(new Uint8Array(n));
    const { y: _omitted, ...missingY } = alice.signJwk;
    const malformed = {
      'P-384 curve': await subtle.exportKey('jwk', p384.publicKey),
      'x of 31 bytes': { ...alice.signJwk, x: zeros(31) },
      'y of 33 bytes': { ...alice.signJwk, y: zeros(33) },
      'missing y': missingY,
      'kty OKP': { ...alice.signJwk, kty: 'OKP' },
      'x as a number': { ...alice.signJwk, x: 5 },
      'x with a non-base64url character': { ...alice.signJwk, x: `+${alice.signJwk.x.slice(1)}` },
      'empty object': {},
    };
    const wrong = [];
    for (const [label, jwk] of Object.entries(malformed)) {
      for (const field of ['signPub', 'encPub']) {
        const code = await codeOf(verifyBundle(await raw({ [field]: jwk }), { now: T0 }));
        if (code !== 'bad_key') wrong.push(`${field} ${label}: ${code}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  test('off-curve and all-zero identity keys are rejected (any error)', async () => {
    const offCurve = { kty: 'EC', crv: 'P-256', x: b64.enc(new Uint8Array(32).fill(1)), y: b64.enc(new Uint8Array(32).fill(1)) };
    const zero = { kty: 'EC', crv: 'P-256', x: b64.enc(new Uint8Array(32)), y: b64.enc(new Uint8Array(32)) };
    // P-256 has cofactor 1, so its only small-order point is the identity, which a JWK cannot express: all-zero is the stand-in.
    for (const point of [offCurve, zero]) {
      assert.notEqual(await codeOf(verifyBundle(await raw({ signPub: point }), { now: T0 })), 'resolved');
    }
  });

  test('todo: an off-curve identity key is rejected with a CryptoError', {
    todo: 'verifyBundle imports signPub with WebCrypto, which throws a DOMException (not CryptoError)',
  }, async () => {
    const offCurve = { kty: 'EC', crv: 'P-256', x: b64.enc(new Uint8Array(32).fill(1)), y: b64.enc(new Uint8Array(32).fill(1)) };
    await expectCryptoError(verifyBundle(await raw({ signPub: offCurve }), { now: T0 }), 'off-curve signPub');
  });

  test('todo: a signed off-curve encryption key is rejected by verifyBundle', {
    todo: 'encPub is only length checked; the point is first imported when someone seals to it, which throws a DOMException',
  }, async () => {
    const offCurve = { kty: 'EC', crv: 'P-256', x: b64.enc(new Uint8Array(32).fill(1)), y: b64.enc(new Uint8Array(32).fill(1)) };
    await expectCryptoError(verifyBundle(await raw({ encPub: offCurve }), { now: T0 }), 'off-curve encPub');
  });

  test('sealing refuses a recipient whose bundle fails verification', async () => {
    const tampered = { ...bob.bundle, encPub: carol.encJwk };
    const code = await codeOf(seal({
      message: 'x', convId: CONV, from: 'alice', n: 0, now: T0,
      recipients: [{ userId: 'alice', bundle: alice.bundle }, { userId: 'bob', bundle: tampered }],
      signPrivateKey: alice.sign.privateKey,
    }));
    assert.equal(code, 'bad_signature');
  });

  test('sealing refuses a recipient whose identity does not match the pin: identity_changed', async () => {
    const impostor = await person('bob');
    assert.equal(await codeOf(sealAs(alice, [alice, { ...impostor, fp: bob.fp }])), 'identity_changed');
  });

  test('sealing refuses a bundle that belongs to a different user, and an expired bundle', async () => {
    const mislabelled = await codeOf(seal({
      message: 'x', convId: CONV, from: 'alice', n: 0, now: T0,
      recipients: [{ userId: 'alice', bundle: alice.bundle }, { userId: 'carol', bundle: bob.bundle, pinnedSignFingerprint: bob.fp }],
      signPrivateKey: alice.sign.privateKey,
    }));
    assert.equal(mislabelled, 'bad_bundle');
    assert.equal(await codeOf(sealAs(alice, [alice, bob], { now: bob.bundle.expiresAt })), 'bundle_expired');
  });

  test('documents: seal without a pin trusts the bundle it is handed, so callers must always pin', async () => {
    const impostor = await person('bob');
    const env = await seal({
      message: 'x', convId: CONV, from: 'alice', n: 0, now: T0,
      recipients: [{ userId: 'alice', bundle: alice.bundle }, { userId: 'bob', bundle: impostor.bundle }],
      signPrivateKey: alice.sign.privateKey,
    });
    assert.ok(env.boxes.some((b) => b.to === 'bob'));
  });

  test('documents: pinning is skipped when no pin is passed, and a non-empty wrong pin is caught', async () => {
    assert.equal((await verifyBundle(bob.bundle, { now: T0 })).userId, 'bob');
    assert.equal(await codeOf(verifyBundle(bob.bundle, { now: T0, pinnedSignFingerprint: 'a'.repeat(64) })), 'identity_changed');
  });

  test('todo: an empty or null pin still enforces identity pinning', {
    todo: 'verifyBundle checks `if (pinnedSignFingerprint)`, so a falsy pin silently disables the check (fails open)',
  }, async () => {
    const impostor = await person('bob');
    await expectCryptoError(verifyBundle(impostor.bundle, { now: T0, pinnedSignFingerprint: '' }), 'empty pin');
    await expectCryptoError(verifyBundle(impostor.bundle, { now: T0, pinnedSignFingerprint: null }), 'null pin');
  });

  test('todo: a signed bundle with expiresAt before createdAt is rejected', {
    todo: 'only the upper validity bound is checked, so a negative validity window is accepted',
  }, async () => {
    await expectCryptoError(verifyBundle(await raw({ createdAt: T0 + MIN, expiresAt: T0 + 1 }), { now: T0 }), 'expiresAt before createdAt');
  });

  test('todo: a bundle with deeply nested junk inside signPub fails with a CryptoError', {
    todo: 'normalizeJwk accepts extra members and canonical() recurses without a limit, so this throws a RangeError',
  }, async () => {
    const junk = { ...bodyOf(alice.bundle), signPub: { ...alice.signJwk, junk: deep(3000) }, sig: alice.bundle.sig };
    await expectCryptoError(verifyBundle(junk, { now: T0 }), 'deep signPub junk');
  });
});

/* ---------------- 6. key separation, replay surface and clock rules ---------------- */

describe('6. key separation, replay surface and clock rules', () => {
  test('a bundle signature cannot be reused as an envelope signature', async () => {
    const env = await sealAs(alice, [alice, bob]);
    assert.equal(await codeOf(openAs(bob, { ...env, sig: alice.bundle.sig }, alice)), 'bad_signature');
  });

  test('an envelope signature cannot be reused as a bundle signature', async () => {
    const env = await sealAs(alice, [alice, bob]);
    assert.equal(await codeOf(verifyBundle({ ...alice.bundle, sig: env.sig }, { now: T0 })), 'bad_signature');
  });

  test('bytes signed under the bundle tag are not an envelope signature, and vice versa', async () => {
    const env = await sealAs(alice, [alice, bob]);
    const { sig, ...unsigned } = env;
    const bundleTagged = await signWith(alice.sign.privateKey, 'bundle', canonical(unsigned));
    assert.equal(await codeOf(openAs(bob, { ...env, sig: bundleTagged }, alice)), 'bad_signature');
    const envelopeTagged = await signWith(alice.sign.privateKey, 'envelope', canonical(bodyOf(alice.bundle)));
    assert.equal(await codeOf(verifyBundle({ ...bodyOf(alice.bundle), sig: envelopeTagged }, { now: T0 })), 'bad_signature');
  });

  test('documents: open is stateless, so the same envelope opens identically twice (replay defence is the session seen-id set)', async () => {
    const env = await sealAs(alice, [alice, bob], { message: { text: 'once' } });
    const first = await openAs(bob, env, alice);
    assert.deepEqual(await openAs(bob, env, alice), first);
  });

  test('envelope timestamps: accepted up to exactly 5 minutes ahead, rejected 1 ms beyond', async () => {
    const atEdge = await sealAs(alice, [alice, bob], { now: T0 + 5 * MIN });
    assert.equal((await openAs(bob, atEdge, alice, { now: T0 })).message.text, 'hello');
    const beyond = await sealAs(alice, [alice, bob], { now: T0 + 5 * MIN + 1 });
    assert.equal(await codeOf(openAs(bob, beyond, alice, { now: T0 })), 'from_future');
  });

  test('bundle timestamps: accepted up to exactly 5 minutes ahead, rejected 1 ms beyond', async () => {
    assert.equal((await verifyBundle(await signBundle({ ...bodyOf(alice.bundle), createdAt: T0 + 5 * MIN }, alice), { now: T0 })).userId, 'alice');
    assert.equal(await codeOf(verifyBundle(await signBundle({ ...bodyOf(alice.bundle), createdAt: T0 + 5 * MIN + 1 }, alice), { now: T0 })), 'bundle_from_future');
  });

  test('expired follows ttl strictly: the message is still returned, with expired = true', async () => {
    const env = await sealAs(alice, [alice, bob], { ttl: 60, now: T0 });
    assert.equal((await openAs(bob, env, alice, { now: T0 + 60 * 1000 })).expired, false);
    const late = await openAs(bob, env, alice, { now: T0 + 60 * 1000 + 1 });
    assert.equal(late.expired, true);
    assert.equal(late.message.text, 'hello');
  });

  test('documents: ttl 0 never expires, and there is no lower bound on the timestamp, so freshness is the session job', async () => {
    const env = await sealAs(alice, [alice, bob]);
    assert.equal((await openAs(bob, env, alice, { now: T0 + 400 * DAY })).expired, false);
  });

  test('documents: a message can claim a conversation it was not sent to, only the caller deriveConvId check stops it', async () => {
    const convAB = await deriveConvId(['alice', 'bob']);
    const injected = await sealAs(mallory, [alice, bob, mallory], { convId: convAB, message: { text: 'from mallory' } });
    const got = await openAs(bob, injected, mallory);
    assert.equal(got.header.convId, convAB);
    assert.notEqual(await deriveConvId(got.header.to), got.header.convId);
  });
});

/* ---------------- 7. canonical JSON ---------------- */

describe('7. canonical JSON', () => {
  test('key order does not change the canonical form, array order does', () => {
    assert.equal(canonical({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } }), canonical({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }));
    assert.notEqual(canonical([1, 2]), canonical([2, 1]));
  });

  test('nested objects, arrays and scalars produce the exact expected output', () => {
    assert.equal(canonical({ x: [{}, [], null, true, false, 'é', -0, 12] }), '{"x":[{},[],null,true,false,"é",0,12]}');
  });

  test('JSON escapes and literal characters canonicalise the same; no Unicode normalisation is applied', () => {
    assert.equal(canonical(JSON.parse('"\\u00e9"')), canonical('é'));
    assert.notEqual(canonical('é'), canonical('é'));
  });

  test('rejects floats, NaN, infinities, unsafe integers, undefined, functions, symbols and bigints with CryptoError', () => {
    for (const v of [1.5, NaN, Infinity, -Infinity, 2 ** 53, undefined, () => 1, Symbol('s'), 10n, [undefined], { f: () => 1 }]) {
      assert.throws(() => canonical(v), (e) => e instanceof CryptoError, String(v));
    }
  });

  test('documents: undefined object properties are dropped, as JSON.stringify does', () => {
    assert.equal(canonical({ a: undefined, b: 1 }), '{"b":1}');
  });

  test('__proto__ and constructor keys are data, not prototype pollution', () => {
    const v = JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted2":"yes"}},"b":1}');
    assert.equal(canonical(v), '{"__proto__":{"polluted":"yes"},"b":1,"constructor":{"prototype":{"polluted2":"yes"}}}');
    assert.equal(({}).polluted, undefined);
    assert.equal(({}).polluted2, undefined);
    assert.equal(Object.prototype.polluted, undefined);
  });

  test('a message with __proto__ and constructor keys seals, opens and keeps its data', async () => {
    const message = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":"x","t":"y"}');
    const got = await openAs(bob, await sealAs(alice, [alice, bob], { message }), alice);
    assert.equal(canonical(got.message), canonical(message));
    assert.equal(({}).isAdmin, undefined);
  });

  test('-0 and 0 canonicalise the same', () => {
    assert.equal(canonical(-0), canonical(0));
  });

  test('todo: canonical refuses Date and Map instead of silently writing {}', {
    todo: 'canonical() walks own enumerable keys, so a Date or Map is signed as an empty object',
  }, () => {
    assert.throws(() => canonical(new Date(0)), (e) => e instanceof CryptoError);
    assert.throws(() => canonical(new Map([['a', 1]])), (e) => e instanceof CryptoError);
  });
});

/* ---------------- 8. base64url ---------------- */

describe('8. base64url encoding', () => {
  test('dec rejects characters outside the alphabet, padding and impossible lengths', () => {
    for (const s of ['AA+A', 'AA/A', 'AA==', 'AAA=', 'AA A', 'AAé', 'A.AA', 'A', 'AAAAA', 'AAAAAAAAA', 42, null, undefined, {}]) {
      assert.throws(() => b64.dec(s), (e) => e instanceof CryptoError && e.code === 'bad_base64', String(s));
    }
  });

  test('random bytes of every length 0 to 70 round-trip, unpadded and in the url-safe alphabet', () => {
    assert.deepEqual(b64.dec(''), new Uint8Array(0));
    const rnd = prng(7);
    for (let n = 0; n <= 70; n++) {
      const bytes = Uint8Array.from({ length: n }, () => Math.floor(rnd() * 256));
      const s = b64.enc(bytes);
      assert.match(s, /^[A-Za-z0-9_-]*$/);
      assert.equal(s.length, Math.ceil((n * 4) / 3), `length ${n}`);
      assert.deepEqual(b64.dec(s), bytes, `length ${n}`);
      assert.equal(b64.enc(bytes.buffer), s);
    }
  });

  test('a 64-byte signature encodes to 86 characters, so its last character has four unused bits', () => {
    assert.equal(b64.enc(new Uint8Array(64)).length, 86);
  });

  test('todo: dec rejects non-canonical trailing bits (only one spelling per byte string)', {
    todo: 'b64.dec("AB") and b64.dec("AA") both give one zero byte; this is the root of the signature respelling below',
  }, () => {
    assert.throws(() => b64.dec('AB'), (e) => e instanceof CryptoError);
  });

  test('todo: a re-spelled envelope signature (same bytes, other unused bits) is rejected', {
    todo: 'the sig field is outside the signed bytes and b64.dec accepts any spelling, so an envelope has several valid encodings',
  }, async () => {
    const env = await sealAs(alice, [alice, bob]);
    const last = B64URL.indexOf(env.sig.at(-1));
    const respelled = env.sig.slice(0, -1) + B64URL[(last & 0x30) | ((last & 0x0f) ^ 0x01)];
    assert.deepEqual(b64.dec(respelled), b64.dec(env.sig), 'same bytes');
    await expectCryptoError(openAs(bob, { ...env, sig: respelled }, alice), 're-spelled signature');
  });

  test('todo: a high-s ECDSA signature (r, n-s) is rejected: one signature, one encoding', {
    todo: 'WebCrypto ECDSA verify accepts both s and n-s, so every signature has a second valid form',
  }, async () => {
    const env = await sealAs(alice, [alice, bob]);
    const raw = b64.dec(env.sig);
    const n = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
    const s = BigInt(`0x${[...raw.slice(32)].map((x) => x.toString(16).padStart(2, '0')).join('')}`);
    const lowS = s > n / 2n ? n - s : s;
    const highS = (n - lowS).toString(16).padStart(64, '0');
    const alt = new Uint8Array(64);
    alt.set(raw.slice(0, 32));
    alt.set(Uint8Array.from(highS.match(/../g), (h) => parseInt(h, 16)), 32);
    await expectCryptoError(openAs(bob, { ...env, sig: b64.enc(alt) }, alice), 'high-s signature');
  });
});

/* ---------------- 9. passphrase vault primitives ---------------- */

describe('9. passphrase vault primitives', () => {
  const PASS = 'correct horse battery staple';
  let salt;
  let kek;
  let kekWrong;
  let kekComposed;
  let kekDecomposed;
  let kekOtherSalt;

  before(async () => {
    salt = newSalt();
    kek = await deriveKek(PASS, salt, ITER);
    kekWrong = await deriveKek('correct horse battery stapler', salt, ITER);
    kekComposed = await deriveKek('café vault passphrase', salt, ITER);
    kekDecomposed = await deriveKek('café vault passphrase', salt, ITER);
    kekOtherSalt = await deriveKek(PASS, newSalt(), ITER);
  });

  test('deriveKek returns a non-extractable AES-GCM 256 key', () => {
    assert.equal(kek.extractable, false);
    assert.equal(kek.algorithm.name, 'AES-GCM');
    assert.equal(kek.algorithm.length, 256);
    assert.deepEqual([...kek.usages].sort(), ['decrypt', 'encrypt']);
  });

  test('encryptJson and decryptJson roundtrip under the same label', async () => {
    const blob = await encryptJson(kek, { x: 1, t: 'é' }, 'contact:bob');
    assert.deepEqual(await decryptJson(kek, blob, 'contact:bob'), { x: 1, t: 'é' });
  });

  test('wrong passphrase: bad_decrypt', async () => {
    const blob = await encryptJson(kek, { secret: true }, 'vault:key');
    assert.equal(await codeOf(decryptJson(kekWrong, blob, 'vault:key')), 'bad_decrypt');
  });

  test('label swap: a blob encrypted for one label does not open under another', async () => {
    const blob = await encryptJson(kek, { secret: true }, 'msg:1');
    assert.equal(await codeOf(decryptJson(kek, blob, 'msg:2')), 'bad_decrypt');
    assert.equal(await codeOf(decryptJson(kek, blob, 'contact:bob')), 'bad_decrypt');
  });

  test('tampered blobs (flipped bit, new iv, truncated, bad base64, missing field) all give bad_decrypt', async () => {
    const blob = await encryptJson(kek, { t: 'secret' }, 'msg:1');
    const ct = b64.dec(blob.ct);
    const cases = {
      'flipped ciphertext bit': { ...blob, ct: b64.enc(Uint8Array.from(ct, (x, i) => (i === 3 ? x ^ 0x40 : x))) },
      'replaced iv': { ...blob, iv: b64.enc(rand12()) },
      'truncated ciphertext': { ...blob, ct: blob.ct.slice(0, -2) },
      'invalid base64': { ...blob, ct: `${blob.ct.slice(0, -1)}*` },
      'missing ciphertext': { iv: blob.iv },
    };
    for (const [label, bad] of Object.entries(cases)) {
      assert.equal(await codeOf(decryptJson(kek, bad, 'msg:1')), 'bad_decrypt', label);
    }
  });

  test('the same passphrase under another salt gives a different key: bad_decrypt', async () => {
    const blob = await encryptJson(kek, { secret: true }, 'vault:key');
    assert.equal(await codeOf(decryptJson(kekOtherSalt, blob, 'vault:key')), 'bad_decrypt');
  });

  test('NFKC: composed and decomposed passphrases derive the same key', async () => {
    const blob = await encryptJson(kekComposed, { ok: true }, 'vault:key');
    assert.deepEqual(await decryptJson(kekDecomposed, blob, 'vault:key'), { ok: true });
  });

  test('deriveKek enforces the iteration floor before doing any work', async () => {
    for (const iterations of [ITER - 1, 1, 0, 200_000.5, NaN, '200000', null]) {
      assert.equal(await codeOf(deriveKek(PASS, salt, iterations)), 'weak_kdf', String(iterations));
    }
  });

  test('deriveKek rejects an empty or non-string passphrase', async () => {
    assert.equal(await codeOf(deriveKek('', salt, ITER)), 'bad_passphrase');
    assert.equal(await codeOf(deriveKek(null, salt, ITER)), 'bad_passphrase');
  });

  test('documents: the default KDF is 600000 iterations, floored at 200000', () => {
    assert.equal(KDF.iterations, 600_000);
    assert.equal(LIMITS.minKdfIterations, 200_000);
  });

  test('checkPassphrase accepts a varied passphrase of at least 12 characters', () => {
    assert.equal(checkPassphrase('correct horse battery staple').ok, true);
    assert.equal(checkPassphrase('abcdefghijkl').ok, true, 'exactly 12');
    assert.equal(checkPassphrase('ünïcödé-pässwörd').ok, true);
  });

  test('checkPassphrase rejects short, empty and non-string input', () => {
    for (const p of ['', 'abcdefghijk', 'short', null, undefined, 123456789012345]) {
      assert.equal(checkPassphrase(p).ok, false, String(p));
    }
  });

  test('checkPassphrase rejects common, repeated and low-variety passphrases', () => {
    for (const p of ['password1234', 'PASSWORD1234', 'iloveyou1234', 'passwordpassword', 'aaaaaaaaaaaa', 'AAAAAAAAAAAAAAAAAAAA', '\n'.repeat(12), 'abababababab']) {
      assert.equal(checkPassphrase(p).ok, false, JSON.stringify(p));
    }
  });

  test('checkPassphrase enforces the 256 character maximum', () => {
    assert.equal(checkPassphrase(`${'abcdefghij'.repeat(25)}abcdef`).ok, true, 'exactly 256');
    assert.equal(checkPassphrase('abcdefghij'.repeat(26)).ok, false, '260 characters');
  });

  test('todo: checkPassphrase judges the NFKC-normalised passphrase, not the raw input', {
    todo: 'the policy inspects the raw string, but the KDF uses NFKC, so full-width "password1234" passes as a non-common string',
  }, () => {
    assert.equal(checkPassphrase('ｐａｓｓｗｏｒｄ１２３４').ok, false);
  });
});

/* ---------------- 10. safety numbers and fingerprints ---------------- */

describe('10. safety numbers and fingerprints', () => {
  test('symmetric: both parties compute the same number whichever order they list the keys', async () => {
    assert.equal(await safetyNumber(alice.signJwk, bob.signJwk), await safetyNumber(bob.signJwk, alice.signJwk));
  });

  test('12 groups of 5 digits, separated by single spaces', async () => {
    assert.match(await safetyNumber(alice.signJwk, bob.signJwk), /^(\d{5} ){11}\d{5}$/);
  });

  test('changes when either identity key changes', async () => {
    const base = await safetyNumber(alice.signJwk, bob.signJwk);
    assert.notEqual(await safetyNumber(alice.signJwk, carol.signJwk), base);
    assert.notEqual(await safetyNumber(carol.signJwk, bob.signJwk), base);
  });

  test('deterministic, and rejects a malformed key', async () => {
    assert.equal(await safetyNumber(alice.signJwk, bob.signJwk), await safetyNumber(alice.signJwk, bob.signJwk));
    assert.equal(await codeOf(safetyNumber(alice.signJwk, { kty: 'EC', crv: 'P-256' })), 'bad_key');
  });

  test('fingerprints are 64 lowercase hex characters', () => {
    assert.match(alice.fp, /^[0-9a-f]{64}$/);
  });
});
