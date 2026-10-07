# ⛏ BlockCraft

A Minecraft-style voxel survival game that runs entirely in **one offline HTML file**: `index.html`. No server, no install, no network. Open it in a modern browser (desktop or phone) and play.

▶ **Play:** open `blockcraft/index.html` (works from `file://`). Worlds save to your browser automatically.

## What's in it

**Three dimensions**
- **The Overworld**: infinite seeded terrain with 19 biomes (plains, forests, dark forest, taiga, snowy plains and taiga, desert, savanna, jungle, swamp, mountains, beaches, rivers, oceans) blended with per-biome grass, foliage and water colours. Caves, overhangs, ore veins, lava lakes, dungeons with loot, six kinds of trees, flowers, cacti, sugar cane and pumpkins.
- **Villages** in plains, taiga, snowy, savanna and desert styles: houses, a library, a smithy, a church, farms, wells, lamp posts and roads, with villagers who work, go home at night and trade, guarded by iron golems.
- **The Nether**: build an obsidian frame, light it, and step through. Caverns over a lava sea, nether wastes, crimson and warped forests with huge fungi, soul sand valleys with basalt pillars and fossils, glowstone, quartz and nether gold ore, and nether brick **fortresses** with blaze spawners, wart gardens and loot. Portals link both ways (1 Nether block = 8 Overworld blocks).
- **The End**: throw eyes of ender to find one of three **strongholds** buried around spawn, fill the twelve portal frames, and drop into a floating island ringed by obsidian spikes and end crystals. Defeat the **Ender Dragon** (it circles, strafes with breath fireballs, charges, perches and heals from crystals) to open the exit portal, claim the egg and roll the credits.
- Smooth lighting with ambient occlusion, day/night with sunrise glow, moon phases, stars and clouds, rain, snow and thunderstorms; a red-fogged Nether and a dusk-lit End.

**Survival and progression**
- Health, hunger, saturation, armour, XP and levels; fall, drowning, lava, fire, magma and void damage; vanilla movement (20 ticks/second), mining speeds and tool tiers.
- **221 blocks, 366 items and 188 crafting recipes** (2×2 and 3×3 with a recipe book), 30 furnace recipes, chests, farming (wheat, carrots, potatoes, nether wart), beds, bows, TNT, fishing rods with vanilla's loot tables.
- **Enchanting** (25 enchantments, vanilla's offer algorithm and bookshelf power) and **anvils** (combining, repairs, renaming, level costs).
- **Brewing**: brewing stands fuelled by blaze powder, water bottles, nether wart, every vanilla ingredient, redstone and glowstone upgrades, fermented spider eye corruption and gunpowder splash potions (36 potions).
- **16 status effects** (speed, strength, regeneration, fire resistance, night vision, invisibility, poison, wither and more) for players and mobs, with HUD icons, timers, tinted and golden hearts.
- **Trading** with villagers of 13 professions across five levels, restocking daily.
- **Redstone**: dust, torches, repeaters, levers, buttons, pressure plates, lamps, pistons and sticky pistons, powered and detector rails, doors and TNT.
- **Boats and minecarts** on water and rails.
- **48 advancements**, from "Getting Wood" through "We Need to Go Deeper" to "Free the End".

**Creatures** (real box models, animations and pathfinding)
- Overworld: zombie, skeleton, creeper, spider, enderman, witch (throws and drinks potions), slime; pig, cow, sheep, chicken, wolf (tameable), villager, iron golem (buildable), silverfish.
- Nether: ghast (bat its fireballs back!), blaze, magma cube, zombified piglin (angers as a pack), wither skeleton.
- End: endermen, end crystals and the Ender Dragon with a boss bar.

**Modes and settings**
- Survival, Creative (fly, full catalogue including every potion and enchanted book) and Spectator; Peaceful to Hard.
- Multiple save slots (each dimension saved separately), render distance, FOV, sensitivity, brightness, fancy/fast leaves, GUI scale, volume, particles, keep inventory.
- Touch controls appear automatically on phones and tablets.

## Controls

| Action | Keys |
|---|---|
| Move | W A S D |
| Jump / swim up (double-tap to fly in Creative) | Space |
| Sneak / fly down | Shift |
| Sprint | Ctrl (or double-tap W) |
| Mine / attack | Left click |
| Place / use | Right click |
| Pick block | Middle click |
| Hotbar | 1–9 or mouse wheel |
| Inventory | E |
| Drop item | Q |
| Chat / command | T or / |
| Third person | F5 |
| Debug screen | F3 |
| Hide HUD | F1 |
| Screenshot | F2 |
| Pause | Esc |

### Commands

`/help`, `/gamemode <survival|creative|spectator>`, `/time set <day|night|ticks>`, `/weather <clear|rain|thunder>`, `/give <item> [count]`, `/tp <x> <y> <z>`, `/summon <mob>`, `/setblock <x> <y> <z> <block>`, `/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>`, `/enchant <enchantment> [level]`, `/effect <give|clear> [effect] [seconds] [level]`, `/dimension <overworld|nether|end>`, `/locate <village|fortress|stronghold>`, `/difficulty`, `/kill`, `/seed`, `/spawnpoint`, `/clear`, `/heal`, `/xp <amount>`, `/biome`. Coordinates accept `~` for relative positions.

## Building

The game is plain ES modules bundled into one file. You only need to rebuild after changing `src/`.

```bash
cd blockcraft
npm install
npm run build     # writes index.html
npm run watch     # rebuilds on change
```

`tools/import-assets.mjs` refreshes textures and sounds from a Mineclonia checkout; the results are already committed in `assets/`.

### Layout

| Path | What |
|---|---|
| `src/shared/` | Blocks, items, biomes, potions, enchantments, noise, the Overworld/Nether/End generators, villages, strongholds, lighting and meshing (shared by the main thread and workers) |
| `src/worker/` | Web worker that generates, lights and meshes chunks off the main thread |
| `src/engine/` | three.js renderer, shaders, textures, sky, weather, particles, mob models, audio |
| `src/world/` | Chunk streaming, block updates, fluids, random ticks |
| `src/game/` | Player, physics, input, inventory, crafting, mobs and the dragon, trading, fishing, vehicles, portals, projectiles, spawning, commands, saving |
| `src/ui/` | HUD, inventory screens, menus, touch controls |
| `assets/` | Textures, sounds and their licence notices |

## Credits

BlockCraft is an independent fan project inspired by Minecraft and is not affiliated with Mojang or Microsoft. Textures and sounds come from [Mineclonia](https://codeberg.org/mineclonia/mineclonia) (Pixel Perfection textures, CC BY-SA 4.0, plus various sound licences). Full attribution is in [CREDITS.md](CREDITS.md).
