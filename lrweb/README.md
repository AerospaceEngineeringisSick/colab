# LRWeb — site redesign + client concept sites

A ground-up redesign of **LRWeb.uk** plus six fully working client concept sites that act as the portfolio. Everything is hand-written HTML, CSS and vanilla JavaScript: no frameworks, no build step, no dependencies apart from Google Fonts.

```
lrweb/
├── index.html                  ← the new LRWeb.uk
├── assets/work/*.jpg           ← portfolio previews (real screenshots of the concept sites)
└── work/
    ├── crumb-and-kiln/         ← sourdough bakery, Bristol
    ├── northside-barber/       ← barbershop, Manchester
    ├── volt-strength/          ← independent gym, Leeds
    ├── tidewater/              ← seafood restaurant, St Ives
    ├── form-and-field/         ← architecture studio, Edinburgh
    └── petal-and-stem/         ← florist, Hackney
```

Open `lrweb/index.html` in a browser, or serve the folder (`python3 -m http.server` inside `lrweb/`) and go to `http://localhost:8000`. You can drop the whole `lrweb/` folder onto any static host (Netlify, Cloudflare Pages, GitHub Pages, cPanel).

## LRWeb.uk: what's in it

| Section | Detail |
|---|---|
| Preloader | Counter and wordmark, then a clip-path curtain reveal. Plays once per session. |
| Hero | Custom **WebGL2 shader**: live topographic "ink" contour lines that bend around your cursor. The headline uses the variable **Archivo** font, and each letter stretches (`wdth`/`wght`) as the cursor gets near. On touch devices it plays a breathing wave instead. |
| Marquee | Two rows that speed up and skew with your scroll velocity. |
| Why LRWeb | A statement that fades in word by word as you scroll, with a strike-through drawn across "forgettable". |
| Work | Six **sticky stacking cards**, one per concept site in its own brand colours. Hovering a card scrolls its real screenshot inside a browser frame. Clicking plays an orange page wipe that carries over into the client site. |
| Services | An accordion with animated line-art icons and a stretch effect on hover. |
| Process | A pinned **horizontal scroll** through four steps, with animated SVG art and a progress bar. |
| Numbers, Pricing, FAQ | Counters, cursor-spotlight pricing cards and smooth accordions. |
| Contact | A rotating "Start a project" badge. The enquiry form checks its fields and fills in an email in the visitor's email app. |
| Footer | A giant wordmark where each letter also reacts to the cursor. |
| Everywhere | Custom cursor, magnetic buttons, a nav that recolours for light and dark sections, a scroll-progress bar and a film-grain overlay. Also schema.org markup, `prefers-reduced-motion` support and keyboard focus states. |

## The concept sites

Each one has its own brand, fonts and signature interactions. None of them uses a template.

- **Crumb & Kiln** has a live "out of the oven" bake board driven by the real UK time, an opening-hours "open now" check, flour particles you can push around with the cursor, a basket drawer with fly-to-cart animation, and a pinned scroll story where the dough rises, bubbles and then bakes. The shopfront illustration has an animated awning and an OPEN/CLOSED sign.
- **Northside Barber Co.** has a torchlight brick-wall hero, a CSS barber pole, a letterboard price list with tabs, and a scroll scene where **scissors snip "Boring haircuts" in half**. Barber cards flip to reveal each barber, there is a four-step booking flow ending in a printed ticket, and a live "chairs busy" widget.
- **VOLT Strength Club** has an **ECG heartbeat hero** whose BPM rises the faster you scroll. It also has a filterable class timetable (live/finished states from the real time), a plan-finder quiz, monthly/annual pricing, an interactive gym floor plan and a "hold to claim" free pass button.
- **Tidewater** has a **generative seascape** where the sun sets, stars appear and the lighthouse beam starts sweeping as you scroll. The page also has indicative tide times with a live chart, a hand-drawn menu with tab illustrations, a boat-to-plate route animated by scroll, and a table booking form with a reveal confirmation.
- **Form & Field** has blueprint elevations that **draw themselves**, a crosshair cursor with coordinates, a layout grid you can toggle with `G`, a horizontal project gallery and an **isometric building that assembles** as you scroll.
- **Petal & Stem** has **generative SVG flowers** that grow and sway towards your cursor, and falling petals. Its **bouquet builder** composes your bouquet live and prices it as you go. There is also a subscription toggle, a seasonal flower wheel and a bike-delivery postcode checker.

Every concept site shows a small "Concept by LRWeb" badge that links back to the portfolio. All bookings, baskets and forms on the concept sites are demos and are labelled as such.

## ⚠️ Placeholders to swap before going live

The build environment couldn't reach lrweb.uk (the network policy blocked it), so these parts of `index.html` are sensible placeholders rather than your real details:

- **Email**: `hello@lrweb.uk`, used in the contact section, menu, footer, form handler and JSON-LD
- **Pricing**: Launch £495 / Business £1,250 / Bespoke £2,500 / Care plan £35 a month (marked with an HTML comment)
- **Claims**: "reply within 24 hours", "3–5 weeks" timelines, "UK-wide, remote-first" and "Booking new projects"
- **Testimonials**: none on purpose. Add real client quotes if you have them.
- **Contact form**: opens the visitor's email app (`mailto:`). Swap in Formspree, Netlify Forms or similar if you'd rather receive submissions directly.

The concept sites use fictional businesses, people, addresses and reviews.

## Regenerating the portfolio previews

The images in `assets/work/` are real 1440×900 screenshots of the concept sites (three viewport frames stitched and scaled to 1200px wide). If you change a concept site, take new screenshots at the same size and keep the filenames. Adding `?shot` to a concept site's URL hides the LRWeb badge and the intro wipe for clean captures.
