# LRChat: security design

Private, end-to-end encrypted chat between members of your LRWeb team (e.g. you and Ralph).
Implementation: `web/js/chat/crypto.js` (primitives + protocol), `web/js/chat/session.js` (client), `server/chat.mjs` (relay).

## The one-paragraph version

Keys are generated **in the browser** and never leave it. The server is a **dumb relay** that stores only
public key bundles and ciphertext. Every message is encrypted with a fresh random key (AES-256-GCM), that key is
wrapped separately for each participant using a fresh ephemeral ECDH exchange, and the whole envelope is **signed**
with the sender's identity key. Clients pin each other's identity and show a **safety number** so a malicious server
cannot silently swap keys. Private keys at rest are encrypted by a **passphrase** (PBKDF2, 600k iterations).

## Primitives (WebCrypto only, zero dependencies)

| Purpose | Algorithm |
|---|---|
| Identity signatures (bundles, envelopes) | ECDSA P-256 / SHA-256 |
| Key agreement (per-message, per-recipient) | ECDH P-256 with a fresh ephemeral key per box |
| Key derivation | HKDF-SHA-256 (salt = hash of ephemeral key; info binds message id, recipient, key id) |
| Content + key wrapping | AES-256-GCM, 96-bit random IV, header bound as AAD |
| Passphrase → vault key | PBKDF2-SHA-256, 600,000 iterations, 128-bit salt |

## Keys

- **Identity key** (ECDSA): long-lived; signs bundles and messages. Its SHA-256 fingerprint *is* the identity.
- **Encryption key** (ECDH): **rotates** (default every 3 days; each bundle is valid 7 days). The previous private key is kept only until `expiresAt + 2 days`, then **deleted**: after that, old ciphertext can no longer be decrypted even with the device and passphrase (forward secrecy for anything already read and moved into the local vault).
- **Bundle**: `{ userId, keyId, signPub, encPub, createdAt, expiresAt, sig }`, signed by the identity key. Senders encrypt only to bundles that verify, are unexpired and match the **pinned** identity fingerprint.
- **Vault**: private keys + message history are encrypted under keys derived from the passphrase. While unlocked, private keys are **non-extractable** `CryptoKey`s: page scripts can use them but not read them. Auto-lock after inactivity drops them from memory.

## Message flow

1. Sender fetches the recipient's bundle from the directory, verifies signature, expiry, pin.
2. Plaintext JSON is padded to a power-of-two bucket (≥ 256 bytes) to hide length, then encrypted with a random 256-bit content key.
3. For each participant (including the sender) a **box** wraps the content key via `ECDH(ephemeral, recipient.encPub)` → HKDF → AES-GCM.
4. The envelope (`header`, `boxes`, `iv`, `ct`) is signed with the identity key. The header (`convId`, message `id`, `from`, `to`, per-conversation counter `n`, `ts`, `ttl`) is authenticated as AAD and by the signature.
5. The relay checks structure, size, rate, that `from` = the authenticated account, and the signature; stores one copy per participant mailbox.
6. Recipient verifies the signature against the **pinned** identity of `header.from` (never a key taken from the envelope), unwraps, decrypts, checks for replay (`id` seen before) and gaps in `n`.

## Threat model

| Adversary / attack | Outcome |
|---|---|
| Passive network observer | TLS protects transport; even without it only ciphertext is visible |
| **Honest-but-curious or compromised relay/server/database** | Sees metadata (who talks to whom, when, padded size bucket) but **not content**. Cannot read, forge or modify messages |
| Server drops / reorders / replays messages | Replays are ignored (seen-`id` set). Drops show up as a gap in `n` once a later message arrives. Reordering is shown by `n` |
| **Server swaps a contact's key (MITM)** | Detected by identity pinning: a changed fingerprint blocks sending until you review and accept it. Verify the **safety number** out-of-band to close the first-contact gap |
| Replaying an old (still-valid) key bundle | Bundles expire (≤ 14 days max, 7 by default) and senders reject expired ones |
| Stolen database / backup of the server | Only ciphertext + public keys |
| Stolen laptop, browser profile copied | Keys and history are encrypted by the passphrase; PBKDF2 slows guessing. Use a strong passphrase. Lock the vault when away |
| Stolen *unlocked* session / malware / malicious extension | **Out of scope**: an attacker who can run code in your unlocked browser can use your keys. Non-extractable keys prevent *copying* them, not *using* them |
| XSS in the console | Mitigated, not eliminated: strict CSP (`script-src 'self'`), no `innerHTML` with data, messages rendered as text. A successful XSS would be as bad as the line above, so keep the CSP |
| Weak passphrase | The weakest link of the at-rest protection. Minimum 12 chars enforced; a few random words is better |

## Honest limitations (v1)

- **One device per person.** A second browser creates a new identity, which others will see as a safety-number change. Use the encrypted key backup export/import to move an identity.
- **No full Double Ratchet.** Forward secrecy comes from *rotating encryption keys and deleting old ones*, not per-message ratcheting. A key compromise exposes undeleted-window messages (≤ ~9 days of already-undeleted keys). Post-compromise security is limited to the next rotation.
- **Metadata is visible to the server** (participants, timing, size bucket, the per-conversation counter's existence). No sealed sender.
- **First contact is trust-on-first-use** until you compare safety numbers. Do it once, in person or by phone.
- Text only (≤ 16 KB). No attachments, no calls, no read receipts or typing indicators (they leak metadata).
- The server **can** see who is a member, who has set up chat, and when keys rotate.
- Not independently audited. Do not treat it as a substitute for a reviewed protocol (Signal, MLS) if your threat model includes well-resourced adversaries.

## Operational guidance

- Serve the console **only over HTTPS**; keep `LRWEB_ADMIN_TOKEN` secret and set per-person accounts (Team page).
- Compare safety numbers with Ralph the first time and after any "identity changed" warning.
- Use a unique passphrase for the chat vault (it is separate from your login password and never sent to the server).
- Back up your identity (Chat → Security → Export encrypted backup) and store the file offline.
