# LRWeb: promo videos (v3)

Two cuts of an LRWeb ad, built from the brand, copy, prices and example sites in [`../lrweb`](../lrweb):

| Output | Format | Length | For |
|---|---|---|---|
| `LRWeb-promo-landscape.mp4` | 2560×1440, 60 fps, motion blur | 58.5s | YouTube, the website, presentations |
| `LRWeb-promo-vertical.mp4` | 1440×2560, 60 fps, motion blur | 46.5s | TikTok, Reels, Shorts, Stories |

The videos are **rendered on your machine** (see [Render it](#render-it)). Everything they need is in this folder, plus the live Crumb & Kiln site in `../lrweb/work`.

The vertical cut is its own edit, not a crop. It uses bigger type, keeps text clear of the TikTok and Reels buttons, and moves faster.

## The story (landscape; 120 BPM, 1 bar = 2s)

| Time | Scene | Music |
|---|---|---|
| 0–8s | **Every website comes with jobs.** Notification banners pop up under a calm aurora: 14 updates, SSL expiring, last backup 94 days ago. Each ding is a note of the melody. | Intro: pads, plucks, the dings |
| 8–16s | **The pile-up.** *Updates. Backups. Security. Hosting. Fixes. Speed.* slam in on the beat. Banners and old Windows errors stack up in 3D as the sky turns magenta. **Whose job is that?** Then silence. | Build: kick, snare roll, riser, one beat of silence |
| 16–20s | **DROP.** A wave of aurora sweeps across and dissolves the mess into sparks. **Ours.** The LR mark draws itself, then LRWeb: *Your website, handled.* | Drop: supersaws, sidechain pump, the hook |
| 20–22s | **Two jobs. We do both.** 01 We build it · 02 We look after it | |
| 22–32s | **Build.** Crumb & Kiln's 2009 page (marquee, guestbook, tiled background) gets scanned by a light beam and the real site builds itself, desktop and a phone side by side. *Same bakery. Brand new website.* Then a strip of the other six sites. | Scan sweep, whooshes |
| 32–40s | **Care.** *Then we look after it.* Six system cards tick on the beat (uptime, backups, tested updates, security, SSL, speed). *You run your business. We run your website.* | Piano break, a check on each card |
| 40–50s | **Pricing.** *The gap.*: cheap and on your own, or brilliant at agency prices. **from £29/month** lands in the middle, then the three plans, **about 95p a day**, and **websites from £299**. | Drop 2 |
| 50–54s | ~~No call centre.~~ ~~No chatbot.~~ **Just Luke & Ralph.** A real support exchange. | Message pops |
| 54–58.5s | End card on the dawn: LR mark, *We build it. Then we look after it.*, **lrweb.uk** | Outro: bells, ring-out |

## How it's made

- **Sky:** a WebGL2 aurora shader (`js/aurora.js`) with curtains, folds and rays from a per-column simulation, plus stars, ridged mountains, a rippling lake reflection, a magenta storm mood, the brand-gradient dawn and a camera (pan, tilt, zoom, roll).
- **Motion:** HTML/CSS kinetic type and UI (`js/promo.js`, `css/promo.css`). Every value is a pure function of time, so any frame can be rendered on its own, in any order.
- **The build scene** runs the real Crumb & Kiln site in iframes (desktop 1440 wide and mobile 390 wide), freezes its own animations, then animates its elements piece by piece.
- **Music:** epic melodic EDM at 120 BPM in Ab major (Fm, Db, Ab, Eb), synthesised in numpy (`music.py`). It has 9-voice supersaws, a lead hook with delay, a piano break and FM bells, plus CC0 drum and FX one-shots from freesound (see [`samples/CREDITS.md`](samples/CREDITS.md)).
- **Sync:** one timeline (`timeline.js`, in bars) drives the scenes and the music, so every pop-up, slam, tick and whoosh is on the grid.
- **Render:** Chromium renders the scene at a device scale of 4/3 (1920×1080 layout → 2560×1440). Fast frames are built from up to 6 sub-frames with a 180° shutter for real motion blur. ffmpeg adds a light film grain and encodes H.264 (CRF 19) with 256k AAC.

## Render it

You need **Node.js 18+** (20 LTS recommended) and a GPU. ffmpeg is installed automatically through npm. Python is optional.

```bash
git pull
cd lrweb-promo
npm install          # playwright, sharp, ffmpeg-static
npm run setup        # downloads Playwright's Chromium (once)
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

- **Music:** `python tools/fetch_samples.py` downloads the CC0 samples once and checks each licence (it uses `imageio-ffmpeg` from requirements.txt). Then `npm run music` rewrites `events.json` and both `soundtrack-*.wav`.
- **Showcase stills:** `node tools/capture_sites.mjs [site ...]` re-captures `captures/<site>-hero.jpg` and `-mhero.jpg` from `../lrweb/work`.
- **Preview in a browser:** serve the repo root (e.g. `npx http-server ..` or `python -m http.server` from the repo root), open `/lrweb-promo/scene.html?edit=landscape&play`, and click to play it in real time with the soundtrack (it won't be as smooth as the render). Add `&t=35` for a still at 35 seconds.

## Files

```
lrweb-promo/
├── scene.html              the stage (sky canvas, DOM layer, particles, flash)
├── timeline.js             both edits: scenes, cues, music sections, SFX (in bars)
├── js/promo.js             choreography for every scene
├── js/aurora.js            WebGL2 aurora, mountains, lake, dawn
├── css/promo.css           type, notifications, dialogs, cards, plans
├── captures/               showcase stills of the six other example sites
├── music.py                soundtrack synth + mix → soundtrack-<edit>.wav
├── soundtrack-*.wav        the rendered soundtracks (committed, ready to use)
├── events.json             timeline → music (generated by `node timeline.js`)
├── render.mjs              frame renderer + motion blur + encoder
├── samples/CREDITS.md      CC0 sample credits (the WAVs aren't committed)
└── tools/                  sample fetcher, site capture, frame QA, sub-frame merge
```
