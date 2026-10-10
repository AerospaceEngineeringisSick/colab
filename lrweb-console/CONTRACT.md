# LRWeb Console: build contract

Zero-dependency stack: Node 22 (ES modules, `node:test`) on the server, vanilla ES modules + CSS on the client.
**No npm packages, no build step, no frameworks, no CDN scripts.**
Run: `node lrweb-console/server/index.mjs` then open http://127.0.0.1:8787

## Ground rules (all agents)

- Edit **only the files you own**. Do not run any `git` commands.
- Never use `innerHTML`/`insertAdjacentHTML` with data. Build DOM with `h()` (it uses `textContent`).
- Money is **integer cents** everywhere. Timestamps are **ISO-8601 strings**.
- Match the style of the existing code. Short comments only where the *why* isn't obvious.
- Verify before you report: server files with `node --check` + `node --test`, client files with `node --check`.

## HTTP API (all JSON)

Envelope: success `{ "ok": true, "data": ... }` · failure `{ "ok": false, "error": { "code": "validation", "message": "...", "field": "domain" } }`.
Auth: when `LRWEB_ADMIN_TOKEN` is set, every `/api/*` route except `GET /api/health` needs `Authorization: Bearer <token>` (401 otherwise).

| Method + path | Body / query | `data` |
|---|---|---|
| `GET /api/health` | | `{ version, authRequired, integrations: { cloudpanel: Integration, billing: Integration } }` |
| `GET /api/meta` | | `OPTIONS` object from `server/validate.mjs` |
| `GET /api/overview` | | `Overview` |
| `GET /api/servers` | | `Server[]` (each with `metrics` snapshot + `siteCount`) |
| `GET /api/servers/bootstrap-script` | `?os=&dbEngine=&name=&installCloudpanel=1` | `{ script, publicKey, notes: string[] }` |
| `POST /api/servers` | `{ name, host, sshPort?, sshUser?, os, provider?, region? }` | `Server` (status `pending`) |
| `GET /api/servers/:id` | | `Server` + `sites: Site[]` |
| `GET /api/servers/:id/metrics` | | `Metrics` |
| `POST /api/servers/:id/check` | | `Job` (kind `server.check`) |
| `DELETE /api/servers/:id` | | `{ removed: true }` (409 if it still has sites) |
| `GET /api/clients` | `?status=` | `Client[]` (with `siteCount`, `mrrCents`, `balanceCents`) |
| `POST /api/clients` | `{ name, email, company?, phone?, planId }` | `Client` |
| `GET /api/clients/:id` | | `Client` + `sites: Site[]`, `invoices: Invoice[]` |
| `GET /api/sites` | `?serverId=&clientId=` | `Site[]` |
| `POST /api/sites` | `SiteSpec` | `Job` (kind `site.create`) |
| `DELETE /api/sites/:id` | | `{ removed: true }` |
| `POST /api/onboard/client` | `{ client: {name,email,company?,phone?}, planId, site?: SiteSpec }` | `Job` (kind `client.onboard`) |
| `GET /api/jobs/:id` | | `Job` (`secrets` included **once**, then dropped) |
| `GET /api/billing/plans` | | `Plan[]` |
| `GET /api/billing/summary` | | `BillingSummary` |
| `GET /api/billing/invoices` | `?clientId=&status=&limit=` | `Invoice[]` newest first |
| `POST /api/billing/invoices/:id/send` | | `{ sent: true }` |
| `POST /api/billing/invoices/:id/pay` | | `Invoice` (now `paid`) |

## Shapes

```ts
Integration = { mode: 'mock'|'ssh'|'whmcs'|'stripe', label: string, ready: boolean, details: Record<string,string> }

Server  = { id, name, host, sshPort, sshUser, os, provider, region,
            status: 'online'|'degraded'|'offline'|'pending', panelVersion: string,
            panelUrl: string /* https://host:8443 */, createdAt,
            siteCount: number,
            metrics?: { cpu: number, mem: number, disk: number /* percent 0-100 */, load: [number,number,number], uptimeSec: number } }

Metrics = { cpu: number[], mem: number[], net: number[] /* Mbit/s */, labels: string[] /* 60 ISO minutes, oldest first */,
            current: { cpu, mem, disk, load: [n,n,n], uptimeSec } }

Client  = { id, name, company, email, phone, planId, status: 'active'|'trial'|'suspended'|'pending',
            billingCustomerId, createdAt, siteCount, mrrCents, balanceCents }

Site    = { id, domain, serverId, serverName?: string, clientId, clientName?: string,
            type: 'php'|'nodejs'|'static'|'python'|'reverse-proxy', runtime: string /* "8.3" or "" */,
            siteUser, status: 'active'|'provisioning'|'failed'|'suspended', ssl: 'none'|'pending'|'active',
            database: string, diskMb: number, createdAt }

SiteSpec = { serverId, clientId?, domain, type, siteUser?, phpVersion?, vhostTemplate?, nodejsVersion?, pythonVersion?,
             appPort?, reverseProxyUrl?, createDatabase?: boolean, issueCertificate?: boolean /* default true */ }

Plan    = { id, name, priceCents, interval: 'month'|'year', currency, popular?: boolean, features: string[],
            limits: { sites: number, diskGb: number, bandwidthGb: number } }

Invoice = { id, number, clientId, clientName, amountCents, currency,
            status: 'paid'|'open'|'overdue'|'draft'|'void', issuedAt, dueAt, paidAt?: string, description }

BillingSummary = { currency, mrrCents, arrCents, outstandingCents, overdueCents, paidThisMonthCents,
                   activeSubscriptions: number, revenue: { month: 'YYYY-MM', cents: number }[] /* last 12, oldest first */ }

Job     = { id, kind: 'server.check'|'site.create'|'client.onboard', status: 'queued'|'running'|'done'|'failed',
            steps: { key, label, status: 'pending'|'running'|'done'|'failed'|'skipped', detail?: string }[],
            result?: object, secrets?: Record<string,string> /* e.g. siteUserPassword, dbPassword: shown once */,
            error?: string, createdAt, updatedAt }

Overview = { kpis: { servers: {total, online}, sites: {total, sslActive}, clients: {total, active},
                     mrrCents, outstandingCents, currency },
             revenue: BillingSummary['revenue'],
             servers: { id, name, status, cpu, mem, disk }[],
             activity: { id, ts, kind: 'client'|'site'|'billing'|'server', text }[] /* newest first, max 8 */,
             integrations: { cloudpanel: Integration, billing: Integration } }
```

## Adapter interfaces (server side)

`server/adapters/cloudpanel.mjs` → `export function createCloudPanel({ config, store })`
`server/adapters/billing.mjs`    → `export function createBilling({ config, store })`

Both are factories returning plain objects. `config` is from `server/config.mjs`, `store` from `server/store.mjs`.
Every method is `async` unless noted. Throw `Error` with `.status` (HTTP code) and `.code` for expected failures.

### CloudPanel adapter

CloudPanel has **no REST API**; it is automated with the `clpctl` CLI (must run as root). Live mode (`mode: 'ssh'`) runs
`ssh … sudo clpctl <command>` via `child_process.execFile` (**never `exec`, never a local shell**). Mock mode simulates everything.

```
mode: 'mock' | 'ssh'
describe(): Integration                                      // sync
bootstrapScript({ os, dbEngine, name, installCloudpanel }): { script, publicKey, notes }   // sync
listServers(): Server[]                                      // from store 'servers' + live/mock metrics snapshot + siteCount
getServer(id): Server | undefined
registerServer(parsedInput): Server                          // inserts into store, status 'pending', fills panelUrl
checkServer(id, onStep): { ok, os?, clpctlVersion?, error? } // onStep({key,status,detail?}) for keys ssh|clpctl|panel|os; on success sets status 'online'
removeServer(id): void
metrics(id): Metrics
createSite(serverId, spec, onStep?): { siteUser, siteUserPassword }   // clpctl site:add:{php|nodejs|static|python|reverse-proxy}
createDatabase(serverId, { domain, dbName, dbUser }): { dbName, dbUser, dbPassword }          // clpctl db:add
issueCertificate(serverId, domain): { issued: boolean, detail? }                             // clpctl lets-encrypt:install:certificate
deleteSite(serverId, domain): void                                                           // clpctl site:delete --force
```

clpctl flags (verified against the CloudPanel v2 docs):
- `site:add:php` `--domainName --phpVersion --vhostTemplate --siteUser --siteUserPassword`
- `site:add:nodejs` `--domainName --nodejsVersion --appPort --siteUser --siteUserPassword`
- `site:add:python` `--domainName --pythonVersion --appPort --siteUser --siteUserPassword`
- `site:add:static` `--domainName --siteUser --siteUserPassword`
- `site:add:reverse-proxy` `--domainName --reverseProxyUrl --siteUser --siteUserPassword`
- `site:delete` `--domainName --force`
- `db:add` `--domainName --databaseName --databaseUserName --databaseUserPassword`
- `lets-encrypt:install:certificate` `--domainName`
- Flags are written `--flag=value`. There is **no** `site:list`: LRWeb's own store is the inventory of what it provisioned.

### Billing adapter

```
mode: 'mock' | 'whmcs' | 'stripe'
describe(): Integration                                      // sync
listPlans(): Plan[]
createCustomer({ name, email, company }): { customerId }
subscribe({ customerId, planId }): { subscriptionId, invoice: Invoice }
listInvoices({ clientId?, status?, limit? }): Invoice[]      // newest first; clientId resolved via store 'clients'.billingCustomerId
summary(): BillingSummary
sendInvoice(invoiceId): { sent: true }
markPaid(invoiceId): Invoice
```
Mock plan ids: `plan_starter` (1500c, 1 site, 10 GB), `plan_business` (3900c, 5 sites, 50 GB, popular), `plan_agency` (9900c, 25 sites, 200 GB).
Live adapters take `config.fetch` (injectable) and must be unit-tested with a fake fetch.

## Client architecture (`lrweb-console/web/`)

Hash-routed SPA. Routes → view modules (lazy `import()`):

| Route | Module |
|---|---|
| `#/` | `views/dashboard.js` |
| `#/onboard` | `views/onboard-client.js` |
| `#/clients`, `#/clients/:id` | `views/clients.js` (same module; list when `ctx.params.id` is unset, detail when set) |
| `#/servers`, `#/servers/:id` | `views/servers.js` (list / detail with charts) |
| `#/servers/new` | `views/server-onboard.js` |
| `#/sites` | `views/sites.js` |
| `#/billing` | `views/billing.js` |
| `#/settings` | `views/settings.js` |

**View contract**

```js
export default async function mount(root, ctx) { /* build DOM into root */ return cleanup; }   // cleanup optional
// root: empty <div class="view stack">     ctx: { params, query, navigate(path), signal }
// ctx.signal aborts on route change: pass it to api calls: api.get('/api/x', { signal: ctx.signal })
```

Shared modules (already written, **import, do not re-implement**):

- `core/dom.js` → `h(tag, props?, ...children)`, `svg(...)`, `clear(el)`, `debounce(fn, ms)`. `props`: `class` (string | array, falsy ignored), `style` (object | string; `--vars` ok), `dataset`, `ref(el)`, `onclick`-style handlers, anything else is an attribute; `value/checked/disabled/selected/hidden` are set as properties. Children: strings, numbers, Nodes, arrays (flattened), null/false skipped.
- `core/api.js` → `api.get(path, { params, signal })`, `api.post(path, body, { signal })`, `api.del(path, { signal })`: return `data`, throw `ApiError {status, code, message, field}`. `pollJob(id, onUpdate, { signal })` resolves with the final Job.
- `core/fmt.js` → `money(cents, currency='USD')`, `num(n)`, `bytes(n)`, `pct(n)`, `ago(iso)`, `date(iso)`, `uptime(sec)`, `initials(name)`.
- `core/toast.js` → `toast({ title, message, kind: 'ok'|'warn'|'bad'|'info' })`.
- `core/store.js` → `state.get(k)`, `state.set(k, v)`, `state.on(k, fn)` → unsubscribe. Keys in use: `health`, `theme`, `fx`.
- `ui/icons.js` → `icon(name, { size = 20, class })`. Names: dashboard rocket users user server globe card settings search plus check x copy terminal shield lock cpu memory disk bolt refresh arrow-right arrow-up-right chevron-right chevron-left chevron-down database sun moon bell link mail alert receipt sparkle cloud trash external play key activity command info clock.
- `ui/components.js` → `PageHeader, Card, Button, setLoading, Badge, StatusBadge, Avatar, Sparkline, Stat, Meter, Ring, Table, Tabs, Field, Input, Textarea, Select, Switch, Segmented, Skeleton, Empty, ErrorState, loadInto, Modal, Confirm, Stepper, JobProgress, CopyBlock`. **Read the file for exact signatures.**
- `ui/site-form.js` → `SiteForm({ meta, servers, clients?, initial?, showClient? })` → `{ el, value(), validate(), setError(field, msg) }`: the shared "provision a site" form (domain, server, client, type-specific options, database/SSL switches).
- `ui/charts.js` → `AreaChart({ series: [{name, values, color?}], labels?, height?, format?, yMax?, labelFormat? })`, `Donut({ segments: [{label,value,color}], size?, thickness?, center?: {value,label} })`, `BarChart({ data: [{label,value}], height?, format? })`.
- CSS utility classes (see `css/layout.css` and `css/components.css`): `.stack` (vertical gap), `.row` (horizontal flex gap, wraps), `.spread` (space-between), `.grow`, `.grid` `.grid--2` `.grid--3` `.grid--4` (responsive auto-fit), `.split` (2:1 columns, stacks < 1100px), `.form-grid` (+ `.span-all` child), `.list` / `.list__item`, `.chip`, `.callout` (`--warn`, `--bad`), `.kv` (definition grid: `<dl class="kv"><dt/><dd/>`), `.cell-user` (avatar + name cell in tables), `.divider`, `.link`, `.muted`, `.mono`, `.num` (tabular numbers), `.ta-right`, `.sr-only`.

**Design language: "liquid glass".** Surfaces are `.glass` (translucent, backdrop-blurred, specular rim). Never hard-code colours: use CSS variables (`--accent`, `--ok`, `--warn`, `--bad`, `--ink`, `--ink-2`, `--ink-3`). Add view-specific CSS to **a `<style>`-free approach**: put new classes in your own file `css/view-<name>.css` only if needed and load it from your view with `ensureCss('css/view-<name>.css')` (exported by `core/dom.js`). Prefer existing classes first.

**Quality bar.** Every view needs: skeleton while loading (`loadInto`), a friendly error state with retry, an empty state, keyboard-accessible controls, labelled inputs, and works at 360px width. Mutating actions show a loading button state and a toast on success or failure.
