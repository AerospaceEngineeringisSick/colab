# LRWeb: "Websites, handled." (v4 showreel)

A 60-second LRWeb ad made as a motion-design showreel, built from the brand, copy, prices and example sites in [`../lrweb`](../lrweb):

| Output | Format | Length | For |
|---|---|---|---|
| `LRWeb-promo-landscape.mp4` | 2560×1440, 60 fps, motion blur | 60s | YouTube, the website, presentations |
| `LRWeb-promo-vertical.mp4` | 1440×2560, 60 fps, motion blur | 60s | TikTok, Reels, Shorts, Stories |

The videos are **rendered on your machine** (see [Render it](#render-it)). Everything they need is in this folder, plus the live Crumb & Kiln site in `../lrweb/work`. Both cuts share one timeline and one score; the vertical cut has its own layouts and bigger type.

## The story (120 BPM, 1 bar = 2s, every cut on the beat)

| Time | Scene | Technique | Music |
|---|---|---|---|
| 0–4s | A dot of light stretches into a line, becomes a cursor and types **Every website** | shape morph, variable-font weight on every letter, a scripted shooting star | silence, then each letter is a pizzicato note |
| 4–8s | **comes with *jobs.*** Then the camera flies through the *o* | iris zoom through a letter counter; the aurora wakes up | strings open, timpani, whoosh |
| 8–16s | *Updates. Backups. Security. Hosting. Fixes. Speed.* on the half-bar, over a wall of pop-ups. **Whose job is that?** Freeze. | split-flap, echo stack, decode, server-rack wipe, slice snap, speed streaks | spiccato ostinato, trailer slams, snare rush, one beat of silence |
| 16–20s | **Ours.** Shockwave, the LR mark snaps together from its two pieces, *Your website, handled.* | particle burst, rings, light sweep, wordmark reveal | the drop: full orchestra + hybrid drums |
| 20–22s | Split screen: **01 We build it. / 02 We look after it.** | divider draw, panel push | theme A |
| 22–32s | Crumb & Kiln's **2003** site in Internet Explorer (WordArt, marquee, hit counter, a crunchy digicam loaf), exploded into 3D layers, a blueprint wireframe, then the real site builds itself and the window peels off into a phone. *Same bakery. Brand new website.* | exploded axonometric view, wireframe draw, chrome morph, desktop→phone morph, tile-wipe transition | theme A, reveal hit |
| 32–40s | **Then we look after it.** A live dashboard (uptime, nightly backups, updates, security, SSL, 9.4s → 0.8s) while the night turns to dawn. *You run your business. We run your website.* | data-viz motion, 3D card grid, time-lapse clock | piano break, a pizzicato blip per card |
| 40–48s | Plan cards dealt with odometer prices, **£29 ÷ 30 days**, **About 95p a day.**, **Websites from £299.** | 3D card deal, rolling digits, 30-tile month | drop 2 |
| 48–52s | ~~No call centre.~~ ~~No chatbot.~~ **Just Luke & Ralph.** Everything collapses into a dot. | strike-throughs, particle implosion | |
| 52–60s | The dot becomes the dawn; the LR mark draws, *We build it. Then we look after it.*, **lrweb.uk** | stroke draw, sunrise | final hit, ring-out |

## How it's made

- **Sky:** a WebGL2 aurora shader (`js/aurora.js`): curtains and rays from a per-column simulation, scintillating stars with glints, shooting stars, ridged mountains, a lake reflection, a storm mood, the brand-gradient dawn and a camera. Each scene proposes a sky and they blend across the cuts.
- **Motion:** HTML/CSS/SVG and a 2D effects canvas (`js/promo.js`, `css/promo.css`). Every value is a pure function of time, so any frame renders on its own, in any order. Text never sits in clipping masks (so glows are never cut into boxes); soft round scrims keep it readable over the aurora.
- **The build scene** runs the real Crumb & Kiln site in iframes (desktop 1440 wide, mobile 390 wide), freezes its own animations and animates its elements piece by piece. The 2003 version uses bundled period fonts (`fonts/`, OFL/Apache) and generated assets (`assets/old/`).
- **Music:** a hybrid cinematic score at 120 BPM, D minor → D major (`music.py`), played by a small sampler on real CC0 orchestral samples (VSCO 2 CE strings and brass; VCSL Steinway grand, timpani, drums, cymbals) in a synthetic concert hall, with a sine kick and sub under the drums for punch. No bells, dings or triangles.
- **Sync:** one timeline (`timeline.js`, in bars) drives the scenes, the score and every sound effect.
- **Text QA:** `node render.mjs --edit landscape --qa` samples the whole cut and lists any text that is too small, cut off by the frame, or not on screen long enough to read.
- **Render:** Chromium renders at a device scale of 4/3 (1920×1080 layout → 2560×1440). Fast frames are built from up to 6 sub-frames with a 180° shutter for real motion blur. ffmpeg adds a light film grain and encodes H.264 (CRF 19) with 256k AAC.

## Render it

You need **Node.js 18+** (20 LTS recommended) and a GPU. ffmpeg is installed automatically through npm. Python is optional.

```bash
git pull
cd lrweb-promo
npm install          # playwright, sharp, ffmpeg-static
npm run setup        # optional: downloads Playwright's Chromium; skip it and Edge/Chrome is used instead
npm run gpu-check    # should name your GPU, not "SwiftShader"
npm run preview      # quick 1080p/30fps check of both cuts, no motion blur
npm run render       # the real thing: both cuts at 1440p60 with motion blur
```

That writes `LRWeb-promo-landscape.mp4` and `LRWeb-promo-vertical.mp4` in this folder. Use `npm run render:landscape` or `npm run render:vertical` for one cut.

Render time depends on the GPU and CPU. Frames render in parallel browser workers and a progress line shows the ETA. Run the preview first: if it looks right, the full render will too.

### Useful options

Pass these to `node render.mjs --edit landscape|vertical ...`:

| Option | What it does |
|---|---|
| `--workers N` | Parallel browsers (default: half your CPU cores, max 4). Raise it if your GPU and RAM have headroom. |
| `--keep-dir frames/landscape` | Keeps the frames there and makes the render **resumable**: run the same command again and finished chunks are skipped. `--force` re-renders them. |
| `--encode-only` | With `--keep-dir`, just re-encodes the frames already there. |
| `--from 16 --to 22` | Renders part of the timeline (seconds). |
| `--stills 17,35.5` | Saves PNG stills to `stills/` instead of a video. |
| `--no-blur` | Skips motion blur (much faster). |
| `--crf 16` | Higher quality, bigger file (default 19). |
| `--fps 30`, `--scale 1` | Lower frame rate or 1080p output. |

### If the GPU isn't used

`npm run gpu-check` prints the renderer Chromium picked.

- **Windows:** the default is `--angle d3d11`. On a laptop with two GPUs, open Windows Settings → Display → Graphics and set Node.js (`node.exe`) to *High performance*. You can also try `--angle vulkan` or `--angle gl`.
- **macOS:** the default is `--angle metal`.
- **Still SwiftShader?** Add `--headed`. Chromium opens real windows (don't minimise them), which almost always gets GPU acceleration.
- **No usable GPU:** `--cpu` renders in software. It works but is slow, and it drops the sky resolution to 0.66× (override with `--sky 1`).

## Regenerating things (optional)

You only need these if you change the timeline, music or example sites. They need Python 3.10+ (`pip install -r requirements.txt`).

- **Music:** `python tools/fetch_orchestra.py` downloads the orchestral samples once (about 1.2 GB, CC0, from GitHub). Then `npm run music` rewrites `events.json` and both `soundtrack-*.wav`.
- **Showcase stills:** `node tools/capture_sites.mjs [site ...]` re-captures `captures/<site>-hero.jpg` and `-mhero.jpg` from `../lrweb/work`.
- **Preview in a browser:** serve the repo root (e.g. `npx http-server ..` or `python -m http.server` from the repo root), open `/lrweb-promo/scene.html?edit=landscape&play`, and click to play it in real time with the soundtrack (it won't be as smooth as the render). Add `&t=35` for a still at 35 seconds.

## Files

```
lrweb-promo/
├── scene.html              the stage (sky canvas, DOM layer, effects canvas, flash)
├── timeline.js             the edit: scenes, cues, music sections, sound design (in bars)
├── js/promo.js             choreography for every scene
├── js/aurora.js            WebGL2 aurora, stars, shooting stars, mountains, lake, dawn
├── css/promo.css           type, pop-ups, browser chrome, the 2003 page, dashboard, plans
├── css/oldfonts.css, fonts/  period fonts for the 2003 page (Comic Neue, Tinos, Arimo)
├── assets/old/             the 2003 page's tile, digicam loaf photo and mail icon
├── music.py                the score: orchestral sampler + hall + mix → soundtrack-<edit>.wav
├── soundtrack-*.wav        the rendered soundtracks (committed, ready to use)
├── events.json             timeline → music (generated by `node timeline.js`)
├── render.mjs              frame renderer, motion blur, encoder, stills and text QA
└── tools/                  orchestra fetcher (+ file list), site capture, frame QA, sub-frame merge
```
