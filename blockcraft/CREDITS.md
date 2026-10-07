# Credits and licences

BlockCraft is an independent fan project inspired by Minecraft. It is not affiliated with or endorsed by Mojang or Microsoft.

## Game code

Everything in `src/` and `tools/` was written for BlockCraft.

## Textures

All textures in `assets/textures/` come from [Mineclonia](https://codeberg.org/mineclonia/mineclonia).

- Blocks, items, mobs and GUI art are based on the **Pixel Perfection** resource pack by XSSheep and **Pixel Perfection Legacy** by Nova Wostra, plus additions and modifications by Mineclonia/MineClone2 contributors (MysticTempest, kingoscargames, 22i and others). Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Some mob textures are CC0 or MIT; see `assets/licenses/mobs_mc-LICENSE-media.md`.
- Changes made by BlockCraft: files were renamed and re-encoded as RGBA PNG. At runtime some textures are converted to greyscale (so they can be tinted per biome), and chest, bed, heart and hunger images are cut up or recoloured to build block faces and HUD icons. These derived images are shared under the same CC BY-SA 4.0 licence.

## Sounds

All sounds in `assets/sounds/` come from Mineclonia and were trimmed and converted to mono MP3. Authors include Mito551, Benboncan, InspectorJ, AGFX, Sheyvan, lolamadeus, Erdie, dheming, worthahep88, Voxelands contributors, sonictechtonic, Adam_N, Under7dude, haratman, columbia23, Darsycho, Zozzy, Bird_man, Klaraschick, Blender Foundation, PilzAdam, Wuzzy, evsecrets, griffinjennings, kantouth, Baŝto, spookymodem, Cribbler, j1987, themightyglider, JoeDinesSound, tim.kahn, CGEffex, bennstir, inchadney, hantorio, juskiddink, IllusiaProductions, Jose Ortiz 'MindChamber', Ned Bouhalassa and tran5ient. The enchanting sounds are by Alecia Shepherd (CC BY-SA 4.0, from the SnowSong sound and music pack).

Licences used: CC0 1.0, CC BY 3.0, CC BY-SA 3.0, CC BY-SA 4.0, MIT and WTFPL. The exact author and licence of every file is listed in the original Mineclonia notices copied to `assets/licenses/`:

- `mcl_sounds-README.txt` (block, footstep and player sounds)
- `mobs_mc-LICENSE-media.md` (mob sounds and textures)
- `mcl_enchanting-sounds-attributions.txt` (enchanting table sounds)
- `mcl_tnt-README.md`, `mcl_hunger-README.md`, `mcl_bows-README.md`, `mcl_doors-README.md`, `mcl_weather-README.md`, `mcl_lightning-README.md`, `mcl_fire-README.md`, `mcl_throwing-README.md`, `mcl_fishing-README.md`
- `mineclonia-LEGAL.md` and `mineclonia-CREDITS.md` (general Mineclonia media licence: files without their own notice are CC BY-SA 3.0)

## Font

[Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) by Stefie Justprince, SIL Open Font License 1.1 (via `@fontsource/pixelify-sans`).

## Libraries

- [three.js](https://threejs.org) (MIT), bundled into `index.html`.
- [esbuild](https://esbuild.github.io) (MIT) and [pngjs](https://github.com/pngjs/pngjs) (MIT), build tools only.

## Music

The ambient piano music is generated live in the browser with the Web Audio API; there are no music files.
