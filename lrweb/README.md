# LRWeb: site redesign + example sites

A redesign of **lrweb.uk** that keeps LRWeb's brand: the LR logo, the night-navy / indigo / blue / green palette, Bricolage Grotesque + Instrument Sans, and all of the existing copy, prices and details. Alongside it are seven working example sites for the kinds of businesses LRWeb looks after.

```
lrweb/
├── index.html        Home
├── services.html     What we do
├── pricing.html      Care plans, builds, estimator, FAQ
├── about.html        Luke & Ralph, rules, where your site lives
├── work.html         Example sites
├── referrals.html    Referral scheme + terms
├── contact.html      Enquiry form (posts to /api/contact, falls back to email)
├── assets/
│   ├── css/fonts.css, css/site.css
│   ├── js/site.js
│   ├── fonts/        brand fonts (same files as the live site)
│   ├── img/          logos, favicon, OG image (from the live site)
│   └── work/         screenshots of the example sites
└── work/             the example sites
    ├── smith-and-sons/     plumbing & heating, West Berkshire (the "after" of the rescue slider)
    ├── crumb-and-kiln/     bakery & café
    ├── northside-barber/   barbershop
    ├── petal-and-stem/     florist
    ├── volt-strength/      independent gym
    ├── tidewater/          seafood restaurant
    └── form-and-field/     architecture practice
```

To preview, serve the folder (`python3 -m http.server` inside `lrweb/`) and open `http://localhost:8000`. The privacy and terms links point at the live pages on lrweb.uk, which are unchanged.

## What's new on the LRWeb site

- **The overnight hero.** The favicon's sunrise, brought to life. Scrolling fast-forwards one night of care from 23:00 to 08:00. The care log ticks off the nightly backup, plugin updates, malware scan, SSL renewal and uptime checks at their real times. The headline cycles through *monitored, backed up, updated, secured* and lands back on *handled*, while the brand-gradient sun rises over the horizon.
- **A month of care.** A live calendar for the current month showing backups, update days, security scans and edits. Next to it are running totals (backups so far this month, uptime checks at one per minute) and "0 things you had to do".
- **Two jobs.** The build work and the ongoing care, side by side.
- **The rescue slider.** The J. Smith & Sons "before" page against the real finished Smith & Sons example site. The slider is keyboard accessible and sweeps once by itself when it comes into view.
- **The £3 / £10k gap.** Shown on a price line with LRWeb's position marked.
- **Example sites.** Hovering a preview scrolls through it. A full gallery is on work.html.
- Pricing (£29 / £49 / £89, builds from £600), the ten-second estimator, Luke & Ralph, the three rules, referrals (£20 / £50), the FAQ and the company details, all carried over word for word from the live site.
- The "panic" easter egg is still there.

## Example sites

Every example site has an "Example site" badge that links back to work.html. The businesses, people and reviews on them are made up, and the bookings and baskets are demos. Adding `?shot` to an example site's URL hides the badge for clean screenshots.
