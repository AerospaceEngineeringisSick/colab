# Improvements: what I would do next

Plain English, in the order I'd tackle them. **Effort**: S = an afternoon, M = a few days, L = a couple of weeks.
Nothing here is built yet unless it says so.

## Do these first

| # | Improvement | Why it matters | Effort |
|---|---|---|---|
| 1 | **Two-step sign-in** (authenticator app or passkey) for owners and admins | The console can create sites and move traffic. A stolen password should not be enough. | M |
| 2 | **Uptime alerts** to your phone and email, with a "who is on call, Luke or Ralph" switch | Ralph's side of the job is keeping things running. Right now the console shows health but does not tap anyone on the shoulder. | M |
| 3 | **Backup dashboard**: last good backup per site, plus a "test restore" button | "Nightly backups" is a promise to clients. This proves it. Check whether CloudPanel's own backups already cover the data before building anything. | M |
| 4 | **Full activity log** (who moved traffic, who deleted a site, who sent which invoice) | Today only sign-ins and account changes are logged. Two people sharing a console should be able to see who did what. | S |
| 5 | **Run it behind HTTPS properly** (reverse proxy or tunnel) with a short setup guide | Secure chat and sign-in assume HTTPS. The code is ready, the deployment recipe is not written. | S |
| 6 | **Tests on every change** (GitHub Actions running `npm test` and the style check) | 150+ checks already exist. Running them automatically stops regressions. | S |

## Keep clients happy

| # | Improvement | Why | Effort |
|---|---|---|---|
| 7 | **Client portal**: each client sees their invoices, site status and can ask for edits | Fits "two named humans, no ticket system": requests go straight to you both. | L |
| 8 | **Monthly site health report** emailed automatically | Plus and Pro plans mention reviews and reports. This produces them without manual work. | M |
| 9 | **Invoice PDFs and "pay now" links** | Ralph's invoices could go out in one click and get paid faster. | M |
| 10 | **A simple status page per client site** | Clients can see "all good" without ringing you. | M |

## Save time

| # | Improvement | Why | Effort |
|---|---|---|---|
| 11 | **DNS automation** (Cloudflare) for the final "switch visitors" step of a site move | Today the last step of a migration is a manual DNS change. Automating it makes moves nearly hands-free. | M |
| 12 | **Live updates from billing** (WHMCS or Stripe webhooks) | Invoice status changes appear instantly instead of on refresh. | S |
| 13 | **Site templates**: one-click WordPress or standard-site setups | Onboarding a new client becomes a few clicks end to end. | S |
| 14 | **Bulk actions**: update PHP across several sites, renew certificates, pause a client's sites | Useful once you have dozens of sites. | M |
| 15 | **Let the console apply load-balancer settings itself** once tested on a real server | Today it writes the server settings file for you to apply by hand, because CloudPanel has no remote API. | M |

## Make chat stronger (only if you need it)

| # | Improvement | Why | Effort |
|---|---|---|---|
| 16 | **Second device per person** (phone plus laptop) | Today each person has one device. A new browser looks like a new identity and shows a safety-number warning. | L |
| 17 | **Attachments** (screenshots, files), encrypted the same way | Chat is text only for now. | M |
| 18 | **Stronger key evolution** (a full ratchet, or the MLS standard) | Today old messages are protected by rotating and deleting keys every few days. A ratchet protects them message by message. | L |
| 19 | **Independent security review** of the chat code | It has been tested hard, but not audited by an outside expert. Worth it before relying on it for anything truly sensitive. | M |

## Housekeeping

- Move sign-in tokens from the browser's tab storage to secure cookies with request-forgery protection (M).
- Install as an app on phones with push notifications (S).
- A one-page "how to recover" guide: lost chat passphrase, lost admin access, restoring from a backup (S).

## Suggested next three

1. **Two-step sign-in** (#1), because the console now has real power.
2. **Uptime alerts** (#2), because nothing else protects clients as directly.
3. **HTTPS deployment guide** (#5), because it makes everything above safe to switch on for real.
