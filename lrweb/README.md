# LRWeb: site redesign + example sites

A redesign of **lrweb.uk** that keeps LRWeb's brand: the LR logo, the night-navy / indigo / blue / green palette, Bricolage Grotesque + Instrument Sans, and the real copy, prices and details. Alongside it are seven working example sites for the kinds of businesses LRWeb looks after.

```
lrweb/
├── index.html        Home
├── services.html     What we do (the "control room" of care-plan services)
├── pricing.html      Care plans, the itemised receipt, builds, estimator, FAQ
├── about.html        Luke & Ralph, the Berkshire map, rules, where your site lives
├── work.html         Example sites
├── referrals.html    Referral ticket, how it works, scheme terms
├── contact.html      Enquiry form (posts to /api/contact, falls back to email)
├── privacy.html      Privacy policy (same wording as lrweb.uk)
├── terms.html        Terms of service (same wording as lrweb.uk)
├── 404.html          Not-found page (absolute links, so it works at any path)
├── robots.txt, sitemap.xml, site.webmanifest
├── _src/             build.py (generates the pages above) + legal/ source text
├── tools/            local preview server, site checks, screenshot generator (Node)
├── CLAUDE.md         project notes and house rules for Claude
├── assets/
│   ├── css/fonts.css, css/site.css
│   ├── js/site.js, js/sky.js (WebGL sky), js/vendor/ (GSAP, ScrollTrigger, Lenis)
│   ├── fonts/        brand fonts (same files as the live site)
│   ├── img/          logos, favicon, OG image (from the live site)
│   └── work/         screenshots of the example sites (thumb/ = lighter 800px versions)
└── work/             the example sites
    ├── smith-and-sons/     plumbing & heating, West Berkshire (the "after" of the rescue slider)
    ├── crumb-and-kiln/     bakery & café
    ├── northside-barber/   barbershop
    ├── petal-and-stem/     florist
    ├── volt-strength/      independent gym
    ├── tidewater/          seafood restaurant
    └── form-and-field/     architecture practice
```

## Working locally

You need Python 3 and Node.js 18 or newer.

```bash
python3 _src/build.py                       # rebuild the LRWeb pages (Windows: py _src/build.py)
cd tools && npm install && npm run setup    # one-time: installs Playwright and Chromium
npm run serve                               # preview at http://localhost:8000
npm run check                               # errors, broken links, phone layout, blank screens, em dashes
npm run previews                            # refresh example-site screenshots after editing one
```

The LRWeb pages are generated: edit `_src/build.py` (shared content, prices, page sections), not the `.html` files. CSS, JS and the example sites are edited directly. `CLAUDE.md` has the full map and house rules.

## What's on the LRWeb site

- **The overnight hero.** Scrolling fast-forwards one night of care from 23:00 to 08:00 under a WebGL aurora that turns into an LRWeb sunrise. The care log ticks off backups, updates, security scans and the padlock renewal in plain English.
- **The laptop story.** A laptop opens, boots, builds a site and then gets looked after, in four steps.
- **Two jobs.** A build that assembles itself (and tries three designs) next to a site with its care services in orbit.
- **A month of care.** A live calendar for the current month plus running totals. Tap any day to see what happened.
- **The rescue slider** and **the gap chart** (where LRWeb sits between £3 hosting and £10k agencies).
- **Pricing that reads like a good deal:** "about 95p a day", everything each plan includes, an itemised receipt, and a Launch site from £299 with any care plan.
- **Plain-English tips.** Dotted words (hosting, SSL, uptime and more) explain themselves on hover or tap.
- **Where we are.** Luke in Wokingham, Ralph in Hungerford & Kintbury, and clients across the UK.
- **The referral ticket** with a £20 / £50 toggle and a four-step route.
- **The four-colour page transition** from lrweb.uk, between every page and into the example sites.
- Every page starts at the top, works on phones, and respects reduced-motion settings. The "panic" easter egg is still there.

## Example sites

Every example site has an "Example site" badge that links back to work.html. The businesses, people and reviews on them are made up, and the bookings and baskets are demos. Adding `?shot` to an example site's URL hides the badge for clean screenshots.
