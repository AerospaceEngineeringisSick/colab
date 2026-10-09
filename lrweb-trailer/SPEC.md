# LRWeb trailer: scene contract (read fully before writing code)

**Product**: LRWeb (lrweb.uk), a UK managed-website service by Luke & Ralph. They build small-business sites, then look after them (updates, backups, security, hosting, fixes, speed). Care plans from **£29/mo**, new websites from **£299**. Tagline: **"Websites, handled."** Tone: cinematic movie-trailer. Confident, dry, human. Big type, few words, huge contrast, slow camera moves.

**Brand**: night #070824, night-2 #0B0D30, navy #12018D, indigo #3F4DE6, blue #0B86EA, green #3DB88D, green-bright #6FE0B4, paper #F5F8FA. Gradient green→blue→indigo. Fonts (already loaded by `common/brand.css`): `var(--display)` Bricolage Grotesque (use weights 700/800 for headlines, tight negative letter-spacing), `var(--body)` Instrument Sans, `var(--mono)` IBM Plex Mono. The mark is a half sun on a horizon line (see `assets/img/favicon.svg`, and `scenes/s6.html` which draws it in SVG).

**Quality bar**: open `scenes/s6.html` first. Match that polish: layered canvas backdrop (K.stars + K.aurora or your own), staggered easing (K.ease.out5 for soft landings), blur-in text, glows, never anything static for more than a beat, never clipped or tiny text (min 34px for anything meant to be read, headlines 120-260px), generous margins (keep important content inside x 160..1760, y 140..940 because the compositor adds 2.39:1 letterbox bars ~68px top and bottom and a vignette). No emoji. No lorem ipsum. No real company names other than LRWeb. No invented testimonials, stats about real clients or claims about named clients. Example-site screenshots are demos: show as texture/cards, never captioned with a business name.

**File**: `scenes/<id>.html`, standalone, 1920×1080. Template:
```html
<!doctype html><html><head><meta charset="utf-8"><title>sN</title>
<link rel="stylesheet" href="../common/brand.css"></head><body><div id="stage">...</div>
<script src="../common/kit.js"></script>
<script>
window.DURATION = <slot seconds + 0.5>;      // see timeline below; the renderer needs frames up to this
K.ready(()=>{ /* build DOM / load images once here */ });
window.render = function(t){ /* t in seconds from scene start; set every visual from t only */ };
</script></body></html>
```
**Hard rules (the renderer screenshots frames in arbitrary order)**: `render(t)` must be a **pure function of t**: no Date, no Math.random (use `K.rng(seed)`), no CSS transitions/animations, no requestAnimationFrame, no state that accumulates between calls (recompute from t; canvases must be fully cleared/redrawn each call). Use `K.ready` so fonts and images are loaded before frame 0. Images: `../assets/work/*.jpg` (7 real example-site hero screenshots: crumb-and-kiln, form-and-field, northside-barber, petal-and-stem, smith-and-sons, tidewater, volt-strength, files named `<name>-hero.jpg`), `../assets/img/*`. Do not use network resources. Do not add letterbox bars, film grain or global vignette (compositor does it). Do not add a scene-wide fade-in/out: the compositor dissolves between scenes during the first 0.5s and last 0.5s, so keep key text out of those windows (start your story at ~0.4s, finish by slot end).

**Dev loop**: `cd lrweb-trailer && node render.mjs --still sN:3.2` writes `out/still-sN-3.2.png`; view it with the Read tool (it is an image). Check several times through the scene (early, mid, late, and right at hits). Console errors print to your terminal. Fix anything clipped, overlapping, off-brand, ugly or empty. Frames take ~1s each, so sample ~8-12 stills, don't render the whole scene. Do NOT run the full video render, do NOT edit files other than your own scene file (and your own new asset files named `assets/<id>-*`), do NOT run git commands.

**Music sync**: 120 BPM, 1 beat = 0.5s, 1 bar = 2s. Land your big moments (hits, text slams, cuts) on beats. The score has: a low drone, risers building into scene ends, a deep impact + taiko hit at each scene start (t=0 of the slot, i.e. t=0.5 into scenes after s1... rule of thumb: land your first big moment at t=0.5), and the largest hit at the title card. Beat grid per scene is in your brief.

## Story (50s)
| id | slot | purpose |
|---|---|---|
| s1 | 0-8s | Cold open: near-darkness, a single point of light. Trailer-voice text cards: "Every website you love." / "comes with jobs." then the list lands one by one on beats: Updates. Backups. Security. Hosting. Fixes. Speed. |
| s2 | 8-16s | Chaos: the jobs pile up: cascading error windows, red alerts, 404, "Your site is down", expired padlock/SSL warning, spinning loader, rising urgency; then everything freezes and one line: "Whose job is that?" |
| s3 | 16-26s | The reveal: silence-then-sunrise. Aurora blooms, the LR sun rises, "Your website," / "handled." with a light sweep. Subtext: "Built by people. Looked after by people." |
| s4 | 26-34s | Worlds: slow 3D camera push through floating screenshots of example sites (CSS 3D, perspective), parallax depth, then a care dashboard materialises: uptime, nightly backups, updates, SSL, speed. Line: "We build it. Then we look after it." |
| s5 | 34-42s | Price and people: "From £29 a month." giant; "Websites from £299." Then paper-warm moment: "No call centre. No chatbot." struck through, "Just Luke & Ralph." |
| s6 | 42-50s | Title card (DONE, reference): LRWeb, Websites, handled., lrweb.uk |
