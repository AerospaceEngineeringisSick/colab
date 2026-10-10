# LRWeb Console v2: build contract

Extends `CONTRACT.md` (read it first; every rule there still applies: zero dependencies, `h()` not `innerHTML`, integer
cents, ISO timestamps, `node --check` + tests before you report, no git commands, edit only files you own).

New in v2: **team accounts**, **secure chat (LRChat)**, **load balancing & traffic switching**, **site migration**,
**LRWeb branding**, an offline **HTML mockup**. Security design for chat: `docs/CHAT-SECURITY.md` (read it if you touch chat).

## 0. LRWeb house rules (from the LRWeb website's own CLAUDE.md; they apply to everything you write)

LRWeb (lrweb.uk) is a two-person UK web studio: **Luke Harris-Platt** (design, development, day-to-day care) and **Ralph Ogilvy** (operations: hosting, backups, invoices). Luke is not a developer. Readers include older, non-technical business owners.

- **Never use em dashes** (the long dash, U+2014) anywhere: UI copy, code comments, docs, test names, commit messages. Use a comma, colon, full stop or brackets. `node tools/check-style.mjs` fails if one exists. Run it before you report.
- **Plain English.** Say "spare server", not "standby upstream". If a technical word is unavoidable, wrap it with `Term('load balancer')` from `web/js/ui/glossary.js` (hover/tap tooltip; add missing terms to `GLOSSARY`, which you may append to). Button labels say what happens ("Move visitors to this server"), not what the code does.
- **Don't invent facts about LRWeb**: no made-up prices, promises, response times or policies in UI copy. Demo data must read as demo data ("Demo data", `.example` domains, the made-up example businesses below).
- **Motion must be safe**: honour `prefers-reduced-motion` and `document.documentElement.dataset.fx === 'lite'` (no animation loops when either applies); nothing may block scrolling.
- **Phones are first-class**: check 360px and 412px widths as well as desktop.
- Never say or imply sites are hand-coded.

## Demo data identity (mock mode seed; ids are stable and tests rely on them)

Servers: `srv_ldn1` ldn-web-01 (London, online), `srv_man1` man-web-01 (Manchester, online), `srv_dub1` dub-web-01 (Dublin, degraded), `srv_stg1` staging-01 (London, pending). Provider shown as "Example Cloud".
Clients are LRWeb's seven **made-up example businesses**: `cli_smith` Smith & Sons (plumber), `cli_crumb` Crumb & Kiln (bakery), `cli_north` Northside Barber (suspended, overdue), `cli_petal` Petal & Stem (florist), `cli_volt` VOLT Strength (gym), `cli_tide` Tidewater (seafood restaurant), `cli_form` Form & Field (architects, trial). Domains are `smithandsons.example`, `crumbandkiln.example`, `northsidebarber.example`, `petalandstem.example`, `voltstrength.example`, `tidewater.example`, `formandfield.example` plus sub-domains.
**Care plans** (real LRWeb prices, GBP, monthly): `plan_essential` Essential 2900, `plan_plus` Plus 4900 (most popular), `plan_pro` Pro 8900. Currency default `GBP`. Plans have **no** hosting limits: do not invent any (`Plan.limits` is optional; show `features` instead).

## 1. Server route modules

Each new server module exports a **route factory** that `server/index.mjs` mounts (the orchestrator wires it; you don't edit index.mjs):

```js
export function xxxRoutes(deps) {
  return [{ method: 'GET', path: '/api/thing/:id', auth: 'any', roles: undefined, handler: async ({ req, params, query, body, user }) => data }];
}
```

- `path` uses `:param` segments, exactly like index.mjs. `query` is a `URLSearchParams`. `body` is the parsed JSON object.
- Return the `data` payload (index.mjs wraps it in `{ ok: true, data }`). Throw `Error` with `.status`, `.code` and optionally `.field` for expected failures (`ValidationError` from `validate.mjs` works).
- `auth`: `'public'` (no credentials), `'any'` (default: any authenticated principal, including the legacy admin token), `'account'` (a real signed-in team member; the admin token and open/local mode are rejected with 403).
- `roles`: optional array of allowed roles, e.g. `['owner','admin','member']`. **Default when omitted: `GET` routes allow every role; any other method requires `owner` or `admin`.** Routes that ordinary members must be able to call (all chat routes, `POST /api/auth/logout`, `POST /api/auth/password`) set `roles: ['owner','admin','member']` explicitly. The legacy admin token and local/open mode count as `owner`.
- `user` is `{ id, username, name, role: 'owner'|'admin'|'member', system?: true, local?: true }`.
- Helpers for jobs: `deps.jobs.start({ kind, steps }, async (j) => {...})` as in index.mjs (`j.step(key, fn)`, `j.setStep`, `j.secret`, `j.result`).
- Store collections available: `users sessions pools chatKeys chatMessages chatMailbox audit` (+ the v1 ones). `store.insert/get/find/update/remove/all`.

## 2. Team accounts (`server/auth.mjs`)

```js
export function createAuth({ config, store, now = () => Date.now() }) // → object below
  hasUsers(): boolean
  setupOwner({ username, name, password }): { user, session }        // only while !hasUsers(); else 409 'already_setup'
  login({ username, password, ip }): { user, session }              // 401 'invalid_credentials' (identical for unknown user), 429 'locked'
  authenticate(token): PublicUser | null                            // sliding idle expiry (config.auth.sessionHours) + absolute max (sessionMaxDays)
  logout(token): void
  listUsers(): PublicUser[]    getUser(id): PublicUser | undefined
  createUser({ username, name, role }, actor): { user, oneTimePassword }   // actor must be admin/owner; only an owner may create an owner
  removeUser(id, actor): void                                       // never the last owner; revokes that user's sessions
  changePassword(userId, { current, next }): void                   // revokes the user's other sessions
  resetPassword(userId, actor): { oneTimePassword }                 // sets mustChangePassword; revokes sessions
  audit(entry): void   recentAudit(limit = 200): AuditEvent[]
export function authRoutes({ auth }) // routes below
PublicUser = { id, username, name, role, createdAt, lastLoginAt?, mustChangePassword? }
session   = { token, expiresAt }
AuditEvent = { id, ts, actor, action, target?, ip?, detail? }
```

Rules: usernames `^[a-z][a-z0-9._-]{2,31}$`; passwords 12–128 chars; hash with `crypto.scrypt` (N=32768, r=8, p=1, 16-byte random salt, stored as `scrypt$N$r$p$salt$hash`) and compare with `timingSafeEqual`; on an unknown username still burn a dummy scrypt so timing doesn't reveal accounts; session tokens are 32 random bytes (base64url), **only their SHA-256 is stored**; lock a username for 15 minutes after 5 consecutive failures; one-time passwords are random 16+ chars, returned once, never stored in plain text; audit-log logins (success/failure), user create/remove, password changes/resets.

| Method + path | auth | body → data |
|---|---|---|
| `POST /api/auth/setup` | public | `{ username, name, password }` → `{ user, session }` (only while no users exist) |
| `POST /api/auth/login` | public | `{ username, password }` → `{ user, session }` |
| `POST /api/auth/logout` | any | `{}` → `{ ok: true }` |
| `GET /api/auth/me` | any | → `{ user: PublicUser | null, mode: 'account'|'token'|'local' }` |
| `POST /api/auth/password` | account | `{ current, next }` → `{ ok: true }` |
| `GET /api/team` | account | → `PublicUser[]` |
| `POST /api/team` | account, roles owner/admin | `{ username, name, role }` → `{ user, oneTimePassword }` |
| `DELETE /api/team/:id` | account, owner/admin | → `{ removed: true }` |
| `POST /api/team/:id/reset-password` | account, owner/admin | → `{ oneTimePassword }` |
| `GET /api/audit` | account, owner/admin | → `AuditEvent[]` |

`/api/health` additionally returns `accounts: { enabled: boolean }` (whether any user exists).

## 3. LRChat relay (`server/chat.mjs`)

The relay never sees plaintext. It uses `web/js/chat/crypto.js` (`assertEnvelopeShape`, `verifyBundle`, `verifyEnvelopeSignature`). **Read that file**; do not change it.

```js
export function createChat({ store, config, auth, now = () => Date.now() })
  directory(): { userId, username, name, role, bundle: Bundle|null, identityVersion: number }[]
  putBundle(user, bundle): { ok: true, identityVersion, identityChanged }   // verifyBundle(bundle); bundle.userId === user.id; first identity => version 1; a different signPub fingerprint => version+1
  send(user, envelope): { id, seq }                                           // see validation below
  inbox(user, { after = 0, limit = 100 }): { items: { seq, envelope }[], next }  // next = highest seq returned (or `after`)
  wait(user, after, timeoutMs, signal): Promise<inbox result>                 // long-poll; resolves early when a new item arrives or on abort/timeout
  ack(user, upTo): { removed }                                                // deletes this user's mailbox entries with seq <= upTo; envelope removed when no mailbox entry references it
  unsend(user, messageId): { removed }                                        // sender only; deletes envelope + all mailbox entries
  wipe(user): void                                                            // deletes the user's mailbox + bundle
  purgeExpired(): number                                                      // older than config.chat.ttlDays, or past header.ts+ttl
export function chatRoutes({ chat })
```

`send` validation, in this order: structure via `assertEnvelopeShape`; serialized size ≤ `config.chat.maxEnvelopeBytes`; `header.from === user.id`; every `header.to` id is an existing team member who has published a bundle; per-user rate limit `config.chat.ratePerMinute` (sliding window, 429 `rate_limited`); `header.ts` within ±10 minutes of server time; message `id` not already stored (409 `duplicate`); `verifyEnvelopeSignature(envelope, senderBundle.signPub)` must be true (400 `bad_signature`). Then store the envelope once (`chatMessages`) and one mailbox entry per `header.to` (`chatMailbox`: `{ seq, userId, messageId }`, `seq` from a monotonic counter in `store.meta`). The server **never logs or returns** anything derived from plaintext.

| Method + path | → data |
|---|---|
| `GET /api/chat/directory` | `directory()` |
| `PUT /api/chat/keys` `{ bundle }` | `putBundle` result |
| `POST /api/chat/messages` `{ envelope }` | `{ id, seq }` |
| `GET /api/chat/inbox?after=&limit=&wait=` | inbox result; `wait` seconds (0–25) enables long-poll |
| `POST /api/chat/ack` `{ upTo }` | `{ removed }` |
| `DELETE /api/chat/messages/:id` | `{ removed }` |
| `DELETE /api/chat/me` | `{ wiped: true }` |

All chat routes are `auth: 'account'`.

## 4. LRChat client (`web/js/chat/session.js`, `web/js/chat/storage.js`)

Browser-side protocol client on top of `crypto.js`. **Storage is injected** so the exact same code is tested in Node with an in-memory store.

```js
// storage.js
export function memoryStorage(): Storage
export function idbStorage(dbName = 'lrchat'): Storage          // IndexedDB key/value; structured-cloneable values
// Storage = { get(key): Promise<any|undefined>, set(key, value): Promise<void>, delete(key): Promise<void>, keys(prefix = ''): Promise<string[]> }

// session.js
export function createChatClient({ api, storage, user, now = Date.now })  // api = { get, post, put, del } with the same shape as core/api.js (put = api.put(path, body, opts))
  status: 'uninitialized' | 'locked' | 'unlocked'                  // getter
  init(): Promise<status>
  setup(passphrase): Promise<void>                                  // checkPassphrase(); identity key + enc key + vault key; publish bundle; status → unlocked
  unlock(passphrase): Promise<void>                                 // CryptoError('bad_decrypt') on a wrong passphrase; rotates the enc key if due; republishes
  lock(): void                                                      // drops every in-memory secret, stops polling
  wipe(): Promise<void>                                             // deletes all local chat data (does NOT delete server mailbox; call api.del('/api/chat/me') too if asked)
  on(event, fn): () => void                                         // 'status' | 'message' | 'conversations' | 'identity-changed' | 'gap' | 'error'
  contacts(): Promise<{ userId, username, name, hasChat, verified, identityChanged }[]>
  conversations(): Promise<{ convId, peerIds, title, lastMessage?: { preview, ts, from }, unread }[]>
  messages(convId, { limit = 100 } = {}): Promise<{ id, from, ts, n, body, ttl, status: 'sent'|'received'|'expired' }[]>
  send(peerIds, body, { ttl = 0 } = {}): Promise<message>           // refuses (CryptoError) if any peer's identity changed and wasn't accepted
  markRead(convId): Promise<void>
  safety(userId): Promise<{ number, fingerprint, yourFingerprint, verified }>
  verify(userId): Promise<void>                                     // user confirms the number matches
  acceptIdentityChange(userId): Promise<void>                       // re-pin after review
  rotateKeys(): Promise<void>
  exportBackup(backupPassphrase): Promise<string>                   // JSON text; identity keys encrypted under a PBKDF2 key from backupPassphrase
  importBackup(text, backupPassphrase, newPassphrase): Promise<void>
  poll(): Promise<number>                                           // one inbox pass; returns messages processed
  startPolling() / stopPolling()                                    // long-poll loop (wait=25) with backoff on errors
  setAutoLock(ms): void                                             // idle auto-lock; every public call resets the timer
```

Requirements (security-critical, follow exactly):

1. Private keys exist at rest **only** as AES-GCM blobs under a PBKDF2 key (`deriveKek`, 600k iterations, random 16-byte salt, iteration count stored and re-checked ≥ `LIMITS.minKdfIterations`). The vault key (random AES-256) is stored wrapped by the KEK. Every message/contact/conversation record is `encryptJson(vaultKey, …, label)` with a unique label such as `msg:<id>` / `contact:<userId>` / `conv:<convId>`.
2. While unlocked, private keys are re-imported **non-extractable** (`importSignPrivate`, `importEncPrivate`). Never keep a JWK private key in a variable longer than needed; never log keys, passphrases or plaintext.
3. Pin identity on first sight: store `{ signPubJwk, fingerprint, verified:false }` per contact (vault-encrypted). Every received bundle/message is verified against the pin; a different fingerprint sets `identityChanged`, **blocks sending** to that contact and emits `identity-changed` until `acceptIdentityChange`.
4. `open()` is always called with the **pinned** sender identity key, never one taken from the envelope or directory response without pinning.
5. Replay/gap handling: remember seen message ids per conversation (bounded, e.g. 5000) and ignore duplicates; track the highest `n` per sender per conversation and emit `gap` when `n` jumps; our own `n` is a persisted per-conversation counter.
6. Key rotation: rotate the encryption key when the current one is older than 3 days (bundle validity 7 days). Keep the previous private key until `expiresAt + 2 days`, then delete it. Always republish after rotation.
7. After a message is decrypted and stored in the vault, `ack` it to the relay. Process a batch before acking; never ack something that failed to store.
8. Auto-lock must zero references to all keys. Decrypt failures of one message must not stop the inbox loop.
9. Message bodies are text only (≤ 4000 chars); render them with `textContent` only.

## 5. Load balancing & traffic switching

### Shapes

```ts
Pool = { id, name, domain, serverId /* the entry server running nginx */, algorithm: 'round_robin'|'weighted'|'least_conn'|'ip_hash'|'random_two',
         sticky: boolean, healthCheck: { path, intervalSec, timeoutSec, unhealthyThreshold, healthyThreshold, expectStatus },
         members: Member[], activeMemberId?: string /* set when mode === 'failover' */, mode: 'balanced'|'failover',
         status: 'healthy'|'degraded'|'down', createdAt, updatedAt }
Member = { id, serverId, name, address /* host:port */, weight /* 1-100 */, role: 'active'|'standby'|'drain',
           status: 'healthy'|'unhealthy'|'draining'|'unknown', connections, rps, p95ms, failCount, lastCheckAt }
Traffic = { labels: string[] /* 60 ISO minutes */, series: { memberId, name, rps: number[] }[],
            totals: { rps, p95ms, errorRate /* 0-1 */ }, distribution: { memberId, name, share /* 0-1 */ }[] }
```

### `web/js/lib/lb-algorithms.js` (pure ES module, **no imports**, shared by server, UI and the mockup)

```js
export const ALGORITHMS: { id, label, description, hint }[]
export function eligibleMembers(members): Member-like[]        // healthy `active`; if none, healthy `standby`; never `drain`
export function createBalancer({ algorithm, members, sticky = false, rng = Math.random })
  // members: [{ id, weight, role, healthy: boolean }]
  // → { pick({ ip?, key? } = {}): memberId | null, done(memberId): void, setMembers(members): void, stats(): { [id]: { picked, active } } }
  // round_robin: strict rotation. weighted: smooth weighted round robin (nginx style). least_conn: lowest active/weight, ties by order.
  // ip_hash: FNV-1a(ip) over the eligible list (stable per ip while the member set is unchanged). random_two: power of two choices on least active.
  // sticky + key: same key → same member while that member stays eligible.
export function simulateTraffic({ algorithm, members, requests = 1000, clients = 50, seed = 1 }): { distribution: { memberId, picked, share }[], maxSkew: number }
export function nginxConfig({ name, domain, algorithm, members, sticky, healthCheck, serverName }): string   // `upstream` + `server` block (see below)
export function validateWeights(members): string[]              // human-readable problems
```

`nginxConfig` must emit valid nginx: `upstream lrweb_<slug> { least_conn;|ip_hash;|(none) ; server host:port weight=N max_fails=M fail_timeout=Ns [backup|down]; keepalive 32; }` plus a `server { listen 80; server_name <domain>; location / { proxy_pass http://lrweb_<slug>; proxy_set_header Host $host; X-Real-IP; X-Forwarded-For; X-Forwarded-Proto; proxy_http_version 1.1; proxy_set_header Connection ""; proxy_next_upstream error timeout http_502 http_503 http_504; } }` and, when `sticky`, `hash $cookie_lrweb_route consistent;` semantics via `ip_hash` fallback with a comment (open-source nginx has no cookie sticky). Never interpolate unvalidated text: slug = `[a-z0-9_]` only, addresses validated as `host:port`.

### `server/lb.mjs`

```js
export function createLoadBalancer({ config, store, cloudpanel, jobs, now })
  listPools(): Pool[]   getPool(id): Pool | undefined   // members carry live stats
  createPool(input): Pool   updatePool(id, patch): Pool   deletePool(id): void
  traffic(id): Traffic                                   // mock: deterministic-looking time series driven by the algorithm + member health
  config(id): { nginx: string, notes: string[] }
  drain(id, memberId): Pool
  switchTo(id, memberId, { mode: 'instant'|'gradual' }, j): void   // runs inside a job
export function lbRoutes({ lb, jobs })
```

| Method + path | → data |
|---|---|
| `GET /api/lb/pools` | `Pool[]` |
| `POST /api/lb/pools` | `Pool` (`{ name, domain, serverId, algorithm, sticky, members: [{ serverId, address, weight, role }] }`) |
| `GET /api/lb/pools/:id` | `Pool` |
| `PUT /api/lb/pools/:id` | `Pool` (`algorithm`, `sticky`, `healthCheck`, `members` weights/roles/addresses) |
| `DELETE /api/lb/pools/:id` | `{ removed: true }` |
| `GET /api/lb/pools/:id/traffic` | `Traffic` |
| `GET /api/lb/pools/:id/config` | `{ nginx, notes }` |
| `POST /api/lb/pools/:id/members/:mid/drain` | `Pool` |
| `POST /api/lb/pools/:id/switch` `{ toMemberId, mode }` | `Job` kind `lb.switch`: steps `preflight` (target healthy?) → `warmup` → `shift` (gradual: 10/25/50/100) → `verify` → `finalize`; on a failed preflight/verify the job fails **and traffic stays on the old member** |
| `POST /api/lb/pools/:id/drill` | `Job` kind `lb.drill`: simulated failover drill (kills the active member in the simulation, proves standby takes over, restores) |

**Honesty rule:** CloudPanel has no REST API and nginx upstreams need a custom vhost template, so live mode does **not** push config to servers: it generates the nginx config for the operator to apply (`config(id)`), and `notes` must say so plainly. Mock mode simulates health, traffic and switching so the UI can be explored. Every mock-only behaviour must be labelled "simulated" in API `notes`/UI copy.

Seed (mock mode): one pool `lbp_main` for `tidewater.example` with members on `srv_ldn1`, `srv_man1` (active, weights 3 and 2) and `srv_dub1` (standby), algorithm `weighted`. Export `seedPools(store, now)` from `lb.mjs`; index.mjs calls it after `seedIfEmpty`.

### Site migration (`server/migrate.mjs`)

```js
export function createMigrator({ store, cloudpanel, jobs, config })
  plan(siteId, { toServerId, copyFiles = true, copyDatabase = true, issueCertificate = true }): { steps: { key, label, detail, risk: 'low'|'medium'|'high' }[], warnings: string[], runbook: string, estimate: { filesMb, dbMb, downtimeSec } }
  start(siteId, opts): Job   // kind 'site.migrate'
export function migrateRoutes({ migrator })
```

| Method + path | → data |
|---|---|
| `POST /api/sites/:id/migrate/plan` `{ toServerId, copyFiles?, copyDatabase?, issueCertificate? }` | plan |
| `POST /api/sites/:id/migrate` same body | `Job`; steps: `prepare` (create the site on the target via `cloudpanel.createSite`), `database` (`createDatabase`), `files`, `dbcopy`, `verify`, `ssl`, `cutover-ready`. Mock simulates every step. **Live mode only automates `prepare`/`database`/`ssl`** (verified `clpctl` commands); the data copy and DNS/traffic cutover are returned as a ready-to-run **runbook** (rsync over SSH, `clpctl db:export` / `db:import`) in `job.result.runbook`, never executed automatically |

The source site is never modified or deleted by a migration. The target is recorded as a new `sites` row for the same domain with `migratedFrom: <source site id>` (status `provisioning` until the job reaches `cutover-ready`, then `active`); `index.mjs` exempts rows that have `migratedFrom` from the domain-uniqueness check, and the Sites table shows them with a "Migration target" badge.

## 6. UI modules and routes

| Route | Module | Notes |
|---|---|---|
| `#/traffic`, `#/traffic/:id` | `views/traffic.js` | pools list / pool detail (same module, `ctx.params.id`) |
| `#/migrate` | `views/migrate.js` | `?siteId=` preselects |
| `#/chat` | `views/chat.js` | built on `js/chat/session.js` |
| `#/team` | `views/team.js` | accounts, roles, audit log |
| `#/brand` | `views/brand.js` | brand kit |

Server-side shared helper available to views: `ctx` as in v1. The chat client singleton is created in `js/chat/instance.js` by the orchestrator: `import { getChat } from '../chat/instance.js'` → the `createChatClient` object for the signed-in user (or `null` when there is no personal account).

## 7. Branding (real LRWeb brand, imported from the LRWeb website)

Already applied by the orchestrator; **use it, don't restyle it**.

- Palette (CSS variables in `css/brand.css`): night `#070824`, navy `#12018D`, indigo `#3F4DE6`, blue `#0B86EA`, green `#3DB88D`, green-dark `#1F7A5C`, off-white `#F5F8FA`; signature gradient `var(--grad)` (green, blue, indigo). Semantic tokens (`--accent`, `--primary`, `--ok`, `--ink`...) in `css/tokens.css` map onto it.
- Type: **Bricolage Grotesque** for headings (`var(--head)`, weight 700 to 800, tight tracking), **Instrument Sans** for body, **IBM Plex Mono** for code and small data (`var(--mono)`). Self-hosted in `assets/fonts/`.
- Primary buttons are brand green (`.btn--primary`), links and focus use brand blue, status colours come from tokens.
- Logos: `assets/brand/logo-light.png` (for dark backgrounds) and `logo-dark.png` (for light). Favicon: the gradient sun over a horizon (`assets/favicon.svg`). Do not redraw the logo.
- Voice: friendly, direct, plain English ("Your website, handled."). Two named humans, no ticket system.
