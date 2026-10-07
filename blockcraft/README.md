# ⛏ BlockCraft

A Minecraft-style voxel survival game that runs entirely in **one offline HTML file**: `index.html`. No server, no install, no network. Open it in a modern browser (desktop or phone) and play.

▶ **Play:** open `blockcraft/index.html` (works from `file://`). Worlds save to your browser automatically.

## What's in it

**World**
- Infinite, seeded terrain with **19 biomes**: plains, forest, birch forest, dark forest, taiga, snowy taiga, snowy plains, desert, savanna, jungle, swamp, mountains, snowy mountains, beaches, rivers and (frozen) oceans, blended smoothly with per-biome grass, foliage and water colours.
- Spaghetti and cheese caves, overhanging mountains, ore veins (coal, iron, gold, redstone, lapis, diamond), lava pools deep underground, dungeons with loot chests, trees of six wood types, flowers, cacti, sugar cane, pumpkins.
- **151 blocks** including stairs, slabs, fences, doors, ladders, beds, torches, glass, TNT, crops, wool, enchanting tables and anvils.
- Smooth lighting with ambient occlusion, warm torch light, day/night cycle with sunrise glow, moon phases, stars, 3D clouds, fog, rain, snow and thunderstorms.
- Flowing water and lava (infinite water sources, lava + water makes obsidian, cobblestone or stone).

**Survival**
- Health, hunger, saturation, fall/drowning/lava/fire damage, armour, XP and levels.
- Vanilla-accurate movement (20 ticks/second physics), mining speeds and tool tiers: wood → stone → iron → diamond.
- **272 items** and **135 crafting recipes** with a 2×2/3×3 grid, recipe book, furnace smelting with fuels, chests.
- Farming (wheat, carrots, potatoes, bone meal), sleeping in beds, bows and arrows, TNT.
- **Enchanting**: spend XP levels and lapis at an enchanting table (bookshelves unlock stronger offers) using vanilla's offer algorithm. 23 enchantments, all working: Protection (and its fire, blast and projectile variants), Feather Falling, Respiration, Aqua Affinity, Thorns, Sharpness, Smite, Bane of Arthropods, Knockback, Fire Aspect, Looting, Efficiency, Silk Touch, Fortune, Unbreaking, Power, Punch, Flame, Infinity and Mending (dungeon loot only). Enchanted items shimmer in the inventory, in your hand and on the ground.
- **Anvils**: combine enchanted books and items, repair tools and armour with their material or a second copy, and rename items, with vanilla's level costs and "Too Expensive!" limit.
- **32 advancements** from "Getting Wood" to "Enchanter".

**Mobs** (with real box models, animations and pathfinding)
- Hostile: zombie, skeleton (shoots arrows), creeper (explodes), spider, enderman.
- Passive: pig, cow, sheep (shear for coloured wool), chicken (lays eggs), wolf (tame with bones). Animals breed.
- Night and darkness spawn monsters; zombies and skeletons burn at dawn.

**Modes and settings**
- Survival, Creative (fly, full item catalogue) and Spectator; Peaceful to Hard difficulty.
- Multiple save slots, render distance, FOV, sensitivity, brightness, fancy/fast leaves, GUI scale, volume, particles and keep inventory.
- Touch controls (joystick, look-drag, tap to place/hit, hold to mine) appear automatically on phones and tablets.

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

`/help`, `/gamemode <survival|creative|spectator>`, `/time set <day|night|ticks>`, `/weather <clear|rain|thunder>`, `/give <item> [count]`, `/tp <x> <y> <z>`, `/summon <mob>`, `/setblock <x> <y> <z> <block>`, `/fill <x1> <y1> <z1> <x2> <y2> <z2> <block>`, `/enchant <enchantment> [level]`, `/difficulty`, `/kill`, `/seed`, `/spawnpoint`, `/clear`, `/heal`, `/xp <amount>`, `/biome`. Coordinates accept `~` for relative positions.

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
| `src/shared/` | Blocks, items, biomes, noise, world generation, lighting and meshing (used by the main thread and workers) |
| `src/worker/` | Web worker that generates, lights and meshes chunks off the main thread |
| `src/engine/` | three.js renderer, shaders, textures, sky, weather, particles, mob models, audio |
| `src/world/` | Chunk streaming, block updates, fluids, random ticks |
| `src/game/` | Player, physics, input, inventory, crafting, mobs, AI, spawning, commands, saving |
| `src/ui/` | HUD, inventory screens, menus, touch controls |
| `assets/` | Textures, sounds and their licence notices |

## Credits

BlockCraft is an independent fan project inspired by Minecraft and is not affiliated with Mojang or Microsoft. Textures and sounds come from [Mineclonia](https://codeberg.org/mineclonia/mineclonia) (Pixel Perfection textures, CC BY-SA 4.0, plus various sound licences). Full attribution is in [CREDITS.md](CREDITS.md).
