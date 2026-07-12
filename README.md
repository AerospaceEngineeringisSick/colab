# 🔮 Relic Run

A **3D endless runner** for mobile (and desktop) that lives entirely in **one HTML file** — `index.html`. No build step, no server, no network needed: the three.js engine and all real photographic textures are embedded right in the file. Open it in any modern browser, or host it anywhere as a static page.

▶ **Play:** open `index.html` (works from `file://`, offline, and on phones — add it to your home screen for fullscreen play).

## How to play

Guide a magical relic orb down a three-lane causeway. Speed keeps climbing — how far can you roll?

| Action | Touch | Keyboard |
|---|---|---|
| Change lane | swipe ⬅ / ➡ | ← / → or A / D |
| Jump | swipe ⬆ or tap | ↑ / W / Space |
| Slam down | swipe ⬇ | ↓ / S |
| Pause | ❚❚ button | Esc / P |

Dodge brick walls, crate stacks, sweeping barriers and floating bars, jump the molten pits, and grab power-ups: 🧲 coin magnet, 🛡 shield, ✖2 coin doubler, 🚀 invincible boost (smash through everything).

## Progression (hours of it)

- **XP & levels** — every run earns XP; level-ups pay coin bonuses.
- **4 worlds to unlock**: Emerald Meadow → Ancient Temple (lv 5) → Molten Core (lv 10) → Frozen Passage (lv 16), each with its own look, hazards, speed, and coin multiplier (up to ×3).
- **8 upgrades × 5 tiers** — magnet/shield/doubler/boost duration, head start, coin value, XP boost, cheaper revives.
- **6 relic skins** made from real textures — Opal, Timber, Arcade, Phantom, Magma, Prism.
- **Rotating missions** (3 at a time, escalating tiers) and **20 achievements**, all paying coin rewards.
- **Revive** once per run to keep a great streak alive.
- Progress **auto-saves** to your browser (localStorage).

## Tech

- Single self-contained HTML file (~1.5 MB): three.js r160 + game code + all assets inlined.
- Real photo textures (grass, brick, hardwood, lava, water, ice, crates…) from the [three.js examples](https://github.com/mrdoob/three.js) (MIT license), embedded as data URIs.
- All sound is synthesized live with WebAudio — no audio files.
- Object pooling, capped pixel ratio, and a shadow-quality toggle keep it smooth on phones.
