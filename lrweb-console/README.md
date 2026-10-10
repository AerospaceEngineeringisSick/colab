# LRWeb Console

A liquid-glass control room for hosting operators: onboard **Linux servers** (CloudPanel) and **clients**, provision **sites**, and keep an eye on **billing**, from one fast, dependency-free UI.

- **Zero dependencies.** Node 22 + vanilla ES modules + CSS. No build step, no framework, no CDN.
- **Demo mode out of the box.** Realistic seed data, simulated provisioning with live progress. Go live by setting env vars.
- **Secrets stay on the server.** The browser only ever holds an optional admin token.

```bash
cd lrweb-console
node server/index.mjs        # → http://127.0.0.1:8787   (npm start / npm run dev also work)
npm test                     # node:test suites for adapters and the HTTP API
```

## What's inside

| Area | What it does |
|---|---|
| **Dashboard** | MRR, clients, servers, sites; 12-month revenue chart; server health; activity feed; quick actions |
| **Onboard client** | 4-step wizard: client → plan → hosting → launch. Creates the client, billing customer, subscription + first invoice, and (optionally) the site, database and SSL as one tracked job with live progress |
| **Servers** | Fleet cards with CPU/RAM/disk, detail view with gauges and 1-hour charts, connection check, link into CloudPanel |
| **Add server** | 4-step wizard for a fresh VPS: details → generated, reviewable bootstrap script (installs CloudPanel, creates a locked-down `lrweb` automation user) → live SSH/clpctl/panel verification → done |
| **Clients / Sites / Billing** | Searchable lists and detail pages, site provisioning modal, invoice send / mark paid |
| **Command palette** | `Ctrl/Cmd + K` (or `/`) to jump anywhere |

## Integrations

### CloudPanel: via `clpctl` over SSH

CloudPanel has **no REST API**; it is automated with its `clpctl` CLI. LRWeb therefore runs `sudo clpctl …` on the target server over SSH (`execFile`, never a local shell; every argument is validated and shell-quoted). Commands used (verified against the CloudPanel v2 docs): `site:add:{php,nodejs,python,static,reverse-proxy}`, `site:delete`, `db:add`, `lets-encrypt:install:certificate`.

There is no `site:list`, so LRWeb's own store is the inventory of what it provisioned.

| Variable | Purpose |
|---|---|
| `LRWEB_CLOUDPANEL_MODE` | `mock` (default) or `ssh` |
| `LRWEB_SSH_KEY` | Private key LRWeb uses to reach servers (`<key>.pub` is embedded in bootstrap scripts) |
| `LRWEB_SSH_KNOWN_HOSTS` | Pinned `known_hosts` file (recommended; otherwise first-contact trust via `accept-new`) |
| `LRWEB_SSH_TIMEOUT` | Connect timeout in seconds (default 10) |
| `LRWEB_CLPCTL_SUDO` | `0` if you connect as root and don't want `sudo` |

### Billing: WHMCS or Stripe

| Variable | Purpose |
|---|---|
| `LRWEB_BILLING_MODE` | `mock` (default), `whmcs`, or `stripe` |
| `LRWEB_CURRENCY` | ISO code, default `USD` |
| `WHMCS_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, `WHMCS_PAYMENT_METHOD` | WHMCS API credentials (use a restricted API role) |
| `STRIPE_SECRET_KEY` | Stripe key (use a **restricted** key: customers, subscriptions, invoices) |

Adding another provider means implementing the ~8 methods in `CONTRACT.md` → *Billing adapter*.

### Server settings

| Variable | Purpose |
|---|---|
| `LRWEB_ADMIN_TOKEN` | Bearer token for the API (≥ 16 chars). **Required** when any live integration is on or `LRWEB_HOST` isn't loopback |
| `LRWEB_HOST` / `PORT` | Bind address (default `127.0.0.1`) and port (default `8787`) |
| `LRWEB_DATA_DIR` | Where `state.json` lives (default `./data`, git-ignored) |
| `LRWEB_DEMO_DELAY_MS` | Simulated per-step latency in mock mode (default 700) |

Example live setup:

```bash
export LRWEB_ADMIN_TOKEN="$(openssl rand -hex 24)"
export LRWEB_CLOUDPANEL_MODE=ssh LRWEB_SSH_KEY=~/.ssh/lrweb_ed25519 LRWEB_SSH_KNOWN_HOSTS=~/.ssh/lrweb_known_hosts
export LRWEB_BILLING_MODE=whmcs WHMCS_URL=https://billing.example.com WHMCS_API_IDENTIFIER=… WHMCS_API_SECRET=…
node server/index.mjs
```

## Security model

- Binds to loopback by default; refuses to start on another interface without `LRWEB_ADMIN_TOKEN`. Put it behind TLS (reverse proxy) before exposing it.
- Constant-time token check, failed-attempt rate limiting, same-origin enforcement + JSON-only bodies on mutations, strict CSP, `nosniff`, no `innerHTML` with data anywhere in the client.
- All input is validated server-side before it can reach SSH or an upstream API (`server/validate.mjs`). Generated site/database passwords are held **in memory only** and shown to the operator **once**; they are never written to `state.json`.
- Known limits: clpctl takes passwords as flags, so they are briefly visible in the *target* server's process list. The `lrweb` automation user can run `clpctl` as root, which is powerful; guard the SSH key accordingly and consider restricting port 8443 to your IP.

## Honest caveats

- **Live adapters are untested against real services.** The mock adapters and the WHMCS/Stripe request building are covered by unit tests with fake `fetch`/`exec`; the live paths have not been run against a real CloudPanel server, WHMCS, or Stripe account. Try them on a throwaway server and a Stripe test key first.
- The live connection check uses `clpctl list --raw` as an "is clpctl installed" probe; confirm on your CloudPanel version.
- Supported-version lists (PHP / Node / Python / vhost templates / DB engines) live in `server/validate.mjs` → `OPTIONS`. Mirror what your CloudPanel version offers.

## Design notes: the liquid glass

- **Layers, not blur alone:** translucent gradient fill → `backdrop-filter: blur() saturate()` → 1px masked gradient rim light → top specular inset → pointer-tracking sheen. Chromium additionally gets an SVG displacement filter that gently refracts what's behind the nav, top bar and dialogs.
- **Fast by construction:** compositor-only background animation (transforms), one delegated `pointermove` listener throttled with `rAF`, lazy-loaded views (`import()`), brotli/gzip + ETag/304 for assets, `content-visibility`-friendly list rendering, no framework runtime.
- **Adaptive:** the first 1.5 s of frame times decide between *Full* and *Lite* (no blur, no motion); override in Settings. Honours `prefers-reduced-motion` and `prefers-reduced-transparency`, and has a solid fallback where `backdrop-filter` is missing.
- **Accessible:** skip link, focus-visible rings, labelled controls, ARIA for dialogs / tabs / meters / live regions, keyboard-operable everything, light and dark themes.

## Layout

```
lrweb-console/
  CONTRACT.md            API + module contract the pieces were built against
  server/
    index.mjs            HTTP server: static (brotli/gzip/ETag), auth, router, all API routes
    jobs.mjs             background jobs with live steps; secrets released once
    adapters/            cloudpanel.mjs (mock + ssh/clpctl) · billing.mjs (mock + WHMCS + Stripe)
    validate.mjs         strict validation + shell quoting · config.mjs · store.mjs · seed.mjs
    test/                node:test suites
  web/
    index.html           shell
    css/                 tokens · glass · layout · components (+ per-view files)
    js/core/             dom (hyperscript) · router · api · store · toast · fmt
    js/ui/               components · charts · icons · palette · site-form
    js/views/            one module per route
```
