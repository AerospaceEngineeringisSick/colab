# LRWeb Console

The control room for LRWeb (lrweb.uk), built for Luke and Ralph. Onboard Linux servers and clients, set up and move websites, share visitors across servers, keep an eye on billing, and talk to each other privately, all in one fast, dependency-free app that wears the LRWeb brand.

- **No dependencies.** Node 22, plain JavaScript modules and CSS. No build step (apart from the optional practice mockup), no framework, no CDN.
- **Practice mode out of the box.** Realistic demo data (LRWeb's seven example businesses and the three real care plans in pounds) and simulated server work with live progress. Go live by setting environment variables.
- **Secrets stay on the server.** The browser holds only a short-lived sign-in token. Private chat keys never leave your device.
- **Plain English.** Jargon gets a tap-or-hover explanation (the same idea as the jargon tips on the LRWeb site).

```bash
cd lrweb-console
node server/index.mjs        # open http://127.0.0.1:8787
npm test                     # 300+ automated checks
npm run check                # house style: no em dashes anywhere
npm run mockup               # rebuild the offline practice file
```

## Try it without any setup: the practice mockup

Open **`mockup/lrweb-console-mockup.html`** by double-clicking it. One file, works offline, nothing to install. It is a safe practice copy that runs the *real* load-balancing and encryption code:

- **Traffic lab:** watch visitors flow through a load balancer, switch the sharing method, pretend a server dies and watch the spare take over, move visitors gradually, and run a safety drill.
- **Secure chat practice:** Luke and Ralph on one page, with real encryption. See exactly what the server can and cannot see, compare safety numbers, then try five attacks (a tampered message, a replay, a swapped key and more) and see why each fails.
- **Move a website**, **Dashboard teaser**, and a **missions** checklist that ticks as you go.

## What's inside

| Area | What it does |
|---|---|
| **Dashboard** | Income from care plans, clients, servers, sites, 12-month chart, server health, activity |
| **New client** | A 4-step flow: client, care plan, hosting, launch. Creates the client, the billing account, the first invoice and (optionally) the site, database and padlock as one tracked job |
| **Servers / Add server** | Fleet health, charts, connection test. The wizard generates a reviewable setup script that installs CloudPanel and creates a locked-down `lrweb` helper user |
| **Traffic** | Load balancing and switching: how visitors are shared (take turns, weighted, least busy, same visitor same server, two random picks), a live traffic map, health checks, **switch visitors to another server** (all at once or gradually, refused if the target is unhealthy), a **safety drill**, and the generated server setup file |
| **Move a website** | Copy a client's site to another server, check it, then switch visitors. Gives a step-by-step command list for the parts that need server access (this matches the free-migration promise on the LRWeb site) |
| **Clients / Sites / Billing** | Searchable lists and detail pages, site setup, invoices (send, mark paid) |
| **Secure chat** | End-to-end encrypted chat between team members (see below) |
| **Team** | Personal sign-ins with roles, one-time passwords, and an account activity log |
| **Command palette** | `Ctrl/Cmd + K` (or `/`) to jump anywhere |

## First run

1. Open the console. Go to **Team** and **Create your own sign-in**. From then on everyone must sign in.
2. **Add a person** (Ralph). You get a one-time password to give him privately. He must choose his own at first sign-in.
3. Each of you opens **Secure chat**, chooses a passphrase (it never leaves your device and cannot be reset), and the vault is created.
4. Compare the **safety number** on the phone once. That closes the one gap the server could otherwise exploit.

## Secure chat: how private is it?

Messages are scrambled on your device and only unscrambled on the other person's. The server stores only scrambled text and public keys. Every message is signed, so it cannot be forged or silently altered; contacts are pinned, so a swapped key is detected and blocks sending; encryption keys rotate every few days and old ones are deleted. Your keys sit on your device locked by your passphrase and auto-lock when idle.

The server can still see **who** talks to whom, **when**, and roughly how long a message is. It is one device per person, text only, and not independently audited. Read **[docs/CHAT-SECURITY.md](docs/CHAT-SECURITY.md)** for the design, the threat table and the honest limits. The crypto was attacked by a separate adversarial test suite (96 tests plus fuzzing) and several real weaknesses it found were fixed before release.

## Roles

| Role | Can do |
|---|---|
| **Owner** | Everything, including adding admins |
| **Admin** | Servers, sites, clients, billing and people (not owners) |
| **Member** | Look around and use secure chat, but change nothing |

## Integrations

### CloudPanel: via `clpctl` over SSH

CloudPanel has **no REST API**; it is automated with its `clpctl` command line tool. The console runs `sudo clpctl ...` on the target server over SSH (never through a local shell; every value is checked and quoted first). Commands used: `site:add:{php,nodejs,python,static,reverse-proxy}`, `site:delete`, `db:add`, `lets-encrypt:install:certificate`. The Move-a-website command list also uses `db:export` and `db:import`.

There is no `site:list`, so the console's own record is the list of sites it set up.

| Variable | Purpose |
|---|---|
| `LRWEB_CLOUDPANEL_MODE` | `mock` (default) or `ssh` |
| `LRWEB_SSH_KEY` | Private key the console uses to reach servers (`<key>.pub` goes into setup scripts) |
| `LRWEB_SSH_KNOWN_HOSTS` | Pinned `known_hosts` file (recommended) |
| `LRWEB_SSH_TIMEOUT` | Connect timeout in seconds (default 10) |
| `LRWEB_CLPCTL_SUDO` | `0` if you connect as root |

### Billing: WHMCS or Stripe

| Variable | Purpose |
|---|---|
| `LRWEB_BILLING_MODE` | `mock` (default), `whmcs`, or `stripe` |
| `LRWEB_CURRENCY` | ISO code, default `GBP` |
| `WHMCS_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, `WHMCS_PAYMENT_METHOD` | WHMCS API (use a restricted API role) |
| `STRIPE_SECRET_KEY` | Stripe (use a **restricted** key) |

### Load balancing is "generate, don't push"

Open-source nginx needs a custom CloudPanel vhost template for load balancing, and CloudPanel has no API to push one. So Traffic **generates the nginx setup file** for whoever has server access to review and apply. Traffic numbers and health on that screen are simulated in practice mode. Run `nginx -t` before applying any generated file: it has been unit-tested but not run against a real nginx here.

### Server settings

| Variable | Purpose |
|---|---|
| `LRWEB_ADMIN_TOKEN` | Break-glass token (16+ characters). **Required** with any live integration or a non-loopback `LRWEB_HOST`. Personal sign-ins are the everyday way in |
| `LRWEB_HOST` / `PORT` | Bind address (default `127.0.0.1`) and port (default `8787`) |
| `LRWEB_DATA_DIR` | Where `state.json` lives (default `./data`, git-ignored) |
| `LRWEB_SESSION_HOURS` / `LRWEB_SESSION_MAX_DAYS` | Sign-in idle timeout (12 h) and absolute limit (7 days) |
| `LRWEB_CHAT_TTL_DAYS` / `LRWEB_CHAT_RATE` | How long undelivered scrambled messages are kept (14) and messages per minute per person (30) |
| `LRWEB_DEMO_DELAY_MS` | Simulated step delay in practice mode (default 700) |

```bash
export LRWEB_ADMIN_TOKEN="$(openssl rand -hex 24)"
export LRWEB_CLOUDPANEL_MODE=ssh LRWEB_SSH_KEY=~/.ssh/lrweb_ed25519 LRWEB_SSH_KNOWN_HOSTS=~/.ssh/lrweb_known_hosts
export LRWEB_BILLING_MODE=whmcs WHMCS_URL=https://billing.example.com WHMCS_API_IDENTIFIER=... WHMCS_API_SECRET=...
node server/index.mjs
```

## Security model

- Binds to loopback by default and refuses to start on another address without `LRWEB_ADMIN_TOKEN`. **Put it behind HTTPS before exposing it.**
- Personal accounts: scrypt password hashes, session tokens stored only as hashes, lock-out after repeated failures, address throttling that refuses guesses even when correct, forced password change for one-time passwords, roles enforced on every route, and an audit log of sign-ins and account changes.
- Strict content security policy, no `innerHTML` with data anywhere, same-origin and JSON-only checks on every change, constant-time token comparison.
- Everything that can reach SSH or an upstream service is validated server-side first (`server/validate.mjs`). Generated site and database passwords are held in memory only and shown once; they are never written to `state.json`.
- Known limits: `clpctl` takes passwords as command flags, so they are briefly visible in the *target* server's process list. The `lrweb` helper user can run `clpctl` as root, which is powerful: guard its SSH key and consider restricting CloudPanel's port to your IP.

## Honest caveats

- **Live adapters are untested against real services.** The practice versions and the WHMCS/Stripe request building are covered by tests with fake network and fake SSH. The live paths have not run against a real CloudPanel server, WHMCS or Stripe. Try them on a throwaway server and a Stripe test key first.
- The live connection test uses `clpctl list --raw` as an "is clpctl installed" probe. Confirm it on your CloudPanel version.
- The version lists (PHP, Node, Python, site starter styles, database engines) live in `server/validate.mjs`. Match them to your CloudPanel.
- Demo data uses `.example` domains, documentation IP addresses and the made-up example businesses from the LRWeb site.

## Brand and house style

The look is the LRWeb brand, taken from the LRWeb website: the logo, the night/navy/indigo/blue/green palette, Bricolage Grotesque, Instrument Sans and IBM Plex Mono (all self-hosted). Change colours in `web/css/brand.css`. House rules from the LRWeb site apply to everything here: no em dashes (checked by `npm run check`), plain English, no invented facts, motion that respects reduced-motion, and phones as first-class (checked at 360 and 412 px).

## Where to read more

| File | What it is |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | Improvements, in the order I would do them |
| [docs/CHAT-SECURITY.md](docs/CHAT-SECURITY.md) | Chat design, threat model and limits |
| [CONTRACT.md](CONTRACT.md), [docs/CONTRACT-v2.md](docs/CONTRACT-v2.md) | The API and module contracts the pieces were built against |
| `mockup/README.md` | How to open and use the practice file |

## Layout

```
lrweb-console/
  server/
    index.mjs          web server, sign-in, roles, all routes
    auth.mjs           personal accounts, sessions, audit log
    chat.mjs           encrypted-chat relay (never sees plain text)
    lb.mjs, migrate.mjs  traffic switching, website moves
    adapters/          cloudpanel.mjs (practice + ssh), billing.mjs (practice + WHMCS + Stripe)
    validate.mjs, config.mjs, store.mjs, seed.mjs, jobs.mjs
    test/              nine test suites
  web/
    index.html, css/, assets/ (brand logos, fonts)
    js/core/           dom, router, api, store, toast, fmt
    js/ui/             components, charts, icons, palette, sign-in, glossary, site form
    js/lib/            lb-algorithms.js (shared with the mockup)
    js/chat/           crypto.js (shared with the mockup), session.js, storage.js
    js/views/          one module per screen
  mockup/              the offline practice file (+ its source)
  tools/               check-style.mjs, build-mockup.mjs
```
