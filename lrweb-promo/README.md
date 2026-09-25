# LRWeb: promo videos (v2)

Two cuts of an LRWeb ad, built from the brand, copy, prices and example sites in [`../lrweb`](../lrweb):

| File | Format | Length | For |
|---|---|---|---|
| [`LRWeb-promo-landscape.mp4`](LRWeb-promo-landscape.mp4) | 1920×1080, 60 fps | 40s | YouTube, the website, presentations |
| [`LRWeb-promo-vertical.mp4`](LRWeb-promo-vertical.mp4) | 1080×1920, 60 fps | 30.4s | TikTok, Reels, Shorts, Stories |

The vertical cut is its own edit, not a crop. It opens on a hook in the first second, uses bigger type (every line works as a caption with the sound off) and keeps text clear of the TikTok/Reels buttons.

## How it's made

- **Visuals:** a real-time WebGL layer (three.js) plus HTML/CSS kinetic type, rendered frame by frame in headless Chromium. It includes a glossy extruded 3D LR mark that assembles from 16,000 particles, a liquid brand-gradient shader, the LRWeb sunrise, 3D laptops and a phone showing the example sites, bloom, chromatic aberration, block-glitch and datamosh passes, a CRT switch-off, VHS tracking, and warp-speed streaks.
- **Music:** hard trap/phonk at 150 BPM in C minor (Cm, Ab, Fm, G). It uses real CC0 one-shots from freesound (drums, the phonk bell, impacts, braams, whooshes and glitches) and a synthesised distorted 808 with slides, pads and risers. The mix chain has sidechain ducking, bus compression, saturation, a clipper and a look-ahead limiter. See [`samples/CREDITS.md`](samples/CREDITS.md).
- **Sync:** one timeline (`timeline.js`, in bars) drives both the scenes and the music, so every slam, error pop-up, word cut and drop lands on a hit.

## The landscape cut (1 bar = 1.6s)

| Bars | Scene | Music |
|---|---|---|
| 0–2 | **IT'S 11PM.** A lone laptop under a spotlight shows the 2009 site. *Your website is HOME ALONE.* | Impact + braam, filtered phonk bell, vinyl |
| 2–4 | **Error avalanche.** Classic Windows warnings pile up (SSL expiring, no backups, 9.4s load) as the sky turns red. **WHO'S LOOKING AFTER IT?** Glitch, then silence | Hats, filtered 808, snare roll, riser, reverse crash |
| 4–5 | **DROP.** Particles assemble into the 3D LR mark, with a shockwave and the LRWeb wordmark | Full beat, sub drop, crash |
| 5–7 | Beat-cut montage: HOSTED. UPDATED. BACKED UP. SECURED. MONITORED. SPEEDY. SUPPORTED. HANDLED. | Shutter snaps |
| 7–9 | **One night of care.** The clock rolls 23:00→08:00, care-log tickets fly in, the LRWeb sun rises. *YOU SLEPT. WE DIDN'T.* | Ticks on each check |
| 9–12 | 3D fly-through of the six example sites, one per beat, then a CRT switch-off | Whip whooshes, then a **tape stop** |
| 12–14 | VHS **"Still stuck in 2009?"** that datamoshes into the new Smith & Sons site | Lo-fi bitcrushed beat, glitch, riser |
| 14–15.5 | **DROP 2.** The camera pulls back from the full-screen site into a 3D laptop and phone. *Same business. Brand new website.* | Impact, sub drop |
| 15.5–18.5 | **£29/month** slot-machine price, **≈95p a day** stamp, receipt, **Websites from £299** | Cash register, stamps, ticks |
| 18.5–20 | ~~NO CALL CENTRE.~~ ~~NO CHATBOT.~~ **JUST LUKE & RALPH.** A real support exchange | Message pops |
| 20–21 | Warp speed: **TWO HUMANS. ZERO DRAMA.** | Snare build, riser, gap |
| 21–25 | End card: 3D logo on the sunrise, *We build it. Then we look after it.*, **lrweb.uk** | Final impact, bell run, ring-out |

## Files

```
lrweb-promo/
├── LRWeb-promo-landscape.mp4, LRWeb-promo-vertical.mp4
├── poster-landscape.jpg, poster-vertical.jpg
├── timeline.js          both edits: scenes, cues and music sections (in bars) + sound-effect events
├── music.py             trap/phonk engine → soundtrack-<edit>.wav
├── scene.html           page shell; ?edit=landscape|vertical, window.seek(t) renders any moment
├── js/gl.js             WebGL: shaders, 3D mark, particles, devices, bloom/glitch/datamosh
├── js/promo.js          choreography and kinetic type for every scene
├── css/promo.css
├── render.mjs           Chromium → frames (parallel workers) → ffmpeg (H.264 + AAC)
├── assets/              stills of the 2009 page (made by render.mjs, used by the datamosh)
├── samples/CREDITS.md   every CC0 sample, with links
├── tools/               fetch_samples.py (downloads + license-checks the samples), fs_search.py
└── vendor/three/        three.js r170 (MIT)
```

## Rebuild it

Needs Node with Playwright (Chromium) and Python 3 with numpy, scipy and imageio-ffmpeg.

```bash
cd lrweb-promo
python3 tools/fetch_samples.py                 # CC0 samples → samples/*.wav (not committed)
node timeline.js                               # timeline → events.json
python3 music.py landscape && python3 music.py vertical
node render.mjs --edit landscape --workers 3   # → LRWeb-promo-landscape.mp4 (~40 min on 4 CPU cores)
node render.mjs --edit vertical --workers 3    # → LRWeb-promo-vertical.mp4
```

Useful while editing:

- `node render.mjs --edit vertical --stills 4.9,12.3` saves PNGs of those moments to `stills/`
- `node render.mjs --edit landscape --fps 30 --from 14 --to 22 --out x.draft.mp4` renders a quick section
- Serve the repo root (`python3 -m http.server`) and open `/lrweb-promo/scene.html?edit=vertical&play`, then click, to watch it live with sound (it's heavy, so expect it to drop frames in a browser)
- Change copy in `timeline.js` (errors, words, care log, sites, receipt) or `js/promo.js`, then rerun `node timeline.js` and `music.py` if any timing changed
