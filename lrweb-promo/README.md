# LRWeb: promo video

A 42-second, 1080p60 promo for LRWeb, built from the brand, copy, prices and example sites in [`../lrweb`](../lrweb).

**Watch:** [`LRWeb-promo.mp4`](LRWeb-promo.mp4) (1920×1080, 60 fps, H.264 + AAC)

Nothing here is stock. Every frame is rendered from HTML/CSS/canvas, and every sound (drums, bass, supersaws, chimes, the tape stop, the 8-bit bit) is synthesised from scratch in numpy. Both are driven by the same timeline, so each cut lands on a beat.

## The cut (120 BPM, one chord per bar: Fm, Db, Ab, Eb)

| Time | Scene | Music |
|---|---|---|
| 0–4s | **It's 11pm.** Night sky, aurora, typed-out question | Pad fades in, arp enters, key clicks |
| 4–8s | **Who's looking after it?** Warnings pile up on the beat (expiring SSL, no backups, 9.4s load time), then a glitch | Filtered kick, snare roll, noise riser, error blips |
| 8–12s | The **four-colour curtain** from lrweb.uk opens on the logo. *Your website, handled. monitored. backed up. updated. secured.* | **Drop.** Sub boom, crash, the hook |
| 12–16s | **One night of care.** The clock runs 23:00 to 08:00, the care log ticks off, the LRWeb sun rises. *You slept. We didn't.* | A chime on each tick |
| 16–21.5s | **Example sites** spin past in a 3D carousel on the beat: bakery, barber, florist, gym, restaurant, architects | Whoosh on each spin |
| 21.5–24s | CRT switch-off, then **"Still stuck in 2009?"** (a Smith & Sons site from the IE6 era) and the rescue slider drags across | **Tape stop**, then an 8-bit chiptune version of the hook |
| 24–26s | The rescued site in a browser and on a phone. *Same family business.* | Drop 2 |
| 26–32s | **£29/month** slot-machine price, the **≈95p a day** sticker, a printed receipt, **Websites from £299** | Stamp hits, printer ticks |
| 32–36s | **No call centre. No chatbot. Just Luke & Ralph.** Map of Hungerford and Wokingham, a real support exchange | Breakdown and build |
| 36–42s | Curtain, then the end card: logo, *We build it. Then we look after it.*, **lrweb.uk** | Final Ab-major chord, sparkle run, ring-out |

## Files

```
lrweb-promo/
├── LRWeb-promo.mp4   the finished video
├── poster.jpg        a still for thumbnails and link previews
├── timeline.js       single source of timing (scene + music both read it)
├── events.json       generated from timeline.js for music.py
├── music.py          the soundtrack synth → soundtrack.wav
├── soundtrack.wav    the rendered soundtrack
├── scene.html        the animation: window.seek(t) draws any moment deterministically
└── render.mjs        headless Chromium → frames → ffmpeg (H.264 + AAC)
```

## Rebuild it

Needs Node with Playwright (Chromium) and Python 3 with numpy, scipy and imageio-ffmpeg (for an ffmpeg binary).

```bash
cd lrweb-promo
node timeline.js                 # timeline → events.json
python3 music.py                 # events.json → soundtrack.wav
node render.mjs --workers 3      # scene.html + soundtrack.wav → LRWeb-promo.mp4
```

Useful while editing:

- `node render.mjs --stills 8.5,15.2,30` saves PNGs of those moments to `stills/`
- `node render.mjs --fps 30 --from 16 --to 22 --out draft.mp4` renders a quick section draft
- Serve the repo root (`python3 -m http.server`) and open `/lrweb-promo/scene.html?play`, then click, to watch it live in the browser with sound. `?t=12.5` freezes on one moment.

To change a line or a timing, edit `timeline.js` (or the copy in `scene.html`), then rerun the three commands. The music follows the new timings automatically.
