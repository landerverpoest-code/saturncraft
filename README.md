# Saturncraft

A single-player, browser-based voxel survival sandbox written from scratch in
JavaScript + WebGL ([three.js](https://threejs.org)). It reproduces the
observable mechanics of the classic block-survival genre's reference game
(version 1.21) — block behaviour, physics, survival, mobs, drops, spawn rules,
crafting progression — but on a moon with **three suns** and a **ringed gas
giant** hanging in the sky.

Every name, texture, model, sound and UI element is original and generated
procedurally at runtime: there are no image or audio files in the project.
Documented numbers (hardness, tool multipliers, drop chances, spawn weights,
light levels, damage, hunger values, movement speeds) come from the reference
game's public community wiki. In this document **"vanilla"** means that
reference game.

| Day under two suns | Night with the gas giant |
|---|---|
| ![day](docs/screenshots/day.png) | ![night](docs/screenshots/night.png) |
| **Twin sunset (Hearth + Ember)** | **The mob roster** |
| ![sunset](docs/screenshots/sunset.png) | ![mobs](docs/screenshots/mobs.png) |

## Quick start

**Play online:** https://landerverpoest-code.github.io/saturncraft/ (deployed
by `.github/workflows/pages.yml` on every push to `main`).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # production build in dist/
```

Requires a WebGL2 browser (any current Chrome, Edge, Firefox or Safari).
Click the canvas to capture the mouse. The world is saved to IndexedDB every
minute and on *Save & Quit*; *Continue World* on the title screen resumes it.

Handy URL parameters for development: `?autostart=1&seed=123&rd=8`
(`&continue=1` to resume the save). `window.__game` exposes the running game
in the console.

## Controls

| Action | Keys / mouse |
|---|---|
| Move | `W` `A` `S` `D` (or arrow keys) |
| Jump / swim up | `Space` |
| Sneak (stops at ledges) | `Shift` |
| Sprint | `Ctrl` or `R`, or double-tap `W` |
| Look | Mouse |
| Mine / attack | Left mouse button (hold to mine) |
| Place block / use item / eat / draw bow | Right mouse button (hold to eat or draw) |
| Open workbench / furnace / chest, open doors, sleep in a bed | Right-click the block (sneak to place against it instead) |
| Till soil | Right-click grass or dirt with a hoe |
| Put on armour | Right-click with it, or `Shift`+click it in the inventory |
| Pick block into hand | Middle mouse button |
| Select hotbar slot | `1`–`9` or mouse wheel |
| Inventory (2×2 crafting); item catalogue in creative mode | `E` |
| Chat / commands (`/help` lists them) | `T`, or `/` to start a command |
| Fly (creative mode) | Double-tap `Space`; `Space` up, `Shift` down |
| Drop item (stack with `Ctrl`) | `Q` |
| Pause menu / close screen | `Esc` |
| Debug overlay (fps, position, light, suns) | `F3` |
| Camera: first person / behind / in front | `F5` |
| Hide HUD | `F1` |
| Boat: board / steer / get out / break | Right-click it / `W` `S` `A` `D` / `Shift` / three hits |

Inventory screens: left-click picks up / places a stack, right-click splits a
stack or places one item, `Shift`+click moves a stack between sections,
`Shift`+click on a crafting result crafts as many as possible. The recipe book
beside every crafting grid lists the recipes (green = craftable with what you carry);
clicking one lays its ingredients into the grid (`Shift`+click: as many sets as possible).

Commands: `/gamemode survival|creative` (`/gm 0|1`), `/time set day|night|noon|midnight|<ticks>`,
`/time add <ticks>`, `/weather clear|rain|thunder`, `/tp x y z` (`~` = relative), `/give <item> [count]`
(e.g. `/give diamond_sword`, `/give oak planks 64`), `/summon <mob>` (Saturncraft names or the role,
e.g. `zombie`), `/xp <n> [levels]`, `/kill`, `/heal`, `/clear`, `/spawnpoint`, `/seed`.

## Multiplayer

Play with up to **8 friends** in one world, peer-to-peer over WebRTC — there is
no game server, so it works on the static GitHub Pages build. The free public
[PeerJS](https://peerjs.com) signalling server only introduces the browsers;
after that all traffic goes directly between them.

**Host:** start or continue a world, press **Esc** and choose **Open to Friends
(host)**. The pause menu then shows a short room code (e.g. `K7QX2M`) and a join
link (`…/?join=K7QX2M`) with a copy button. Your world keeps running while the
pause menu is open; the host's world is the one that is saved (including
everything guests build).

**Join:** on the title screen enter the code next to **Join a Friend** (or just
open the join link). Your name comes from the **Your name** field (remembered in
the browser, `Player-1234` by default). The world downloads, the terrain is
generated locally from the host's seed, and you appear next to the host.

Every player can do everything; the host's game decides what happens.

| | How |
|---|---|
| World | seed + every edited chunk on join (the save format's RLE chunks); then block edits both ways. The host validates guest edits (reach), applies them with their consequences (supports, fluids) and rebroadcasts every change in its world — fluids, fire, crops, explosions — to everyone. The host keeps the chunks around every guest loaded, so crops grow, leaves decay, sand falls and mobs spawn there too. |
| Players | position, look, held item, sneaking, swinging, sleeping, riding at 10 Hz; drawn with the third-person player model and a name tag |
| Mobs | simulated by the host around every player; they chase the nearest player. Guests see 10 Hz copies and their hits (melee, arrows) are applied by the host. Guests feed and breed animals, shear and dye fleecers, tame Howlers (the guest becomes the owner: the pet follows, defends and sits for that player only) and trade with settlers (the host counts the uses) |
| Items, orbs, arrows, boats, falling blocks | shared entities owned by the host: block drops, death drops, thrown items (Q), arrows and boats of any player appear for everyone; picking up asks the host, which hands each item to exactly one player. Boats can be ridden by anyone (the rider steers) |
| Chests & furnaces | owned by the host: opening one on a guest shows the host's contents, every click is checked against the host's copy (if someone else took the stack first, the click is undone), furnaces smelt on the host, and several players can use the same chest at once. Dungeon loot is rolled once, by the host |
| PvP | on by default (**PvP: On/Off** in the host's pause menu); the victim's own game applies the damage with its armour; death drops become shared items, guests respawn at their own bed |
| Sleeping | the night is skipped once every player is in bed |
| Commands | `/time`, `/weather`, `/gamerule`, `/summon` and `/dimension` typed by a guest are run by the host for the whole world (**Guest commands: On/Off**, default On); player commands (`/give`, `/tp`, `/gamemode`…) act on the guest |
| Dimensions | the group travels together: when the host (or a guest, by stepping through a portal or with `/dimension`) goes to the Cinderdeep or the Hollow, everyone follows and arrives next to the host |
| Time & weather | from the host, once a second |
| Chat | `T`, messages go to everyone with the sender's name; join / leave notices |
| Guest inventories | kept in the host's save by player name, restored on rejoin |

Disconnects: a guest who leaves is removed for everyone; if the host quits or
the connection drops, guests see a message and go back to the title screen.
Single-player is unchanged when no session is open (the networking code in
`src/net/` is only loaded when hosting or joining).

Limits:

* All players are always in the same dimension (no split parties across dimensions).
* The Void Wyrm boss bar is only shown to the host; guests fight the same boss.
* The host's tab should stay open (background tabs keep simulating, throttled);
  everything depends on the host's machine and connection.

For development, `?net=local` swaps WebRTC for a `BroadcastChannel` loopback
between two tabs of the same browser, and `?peerhost=…&peerport=…&peerpath=…&peersecure=0`
selects a self-hosted PeerJS server.

## Project layout

```
src/
  main.js                  title screen, settings, start/continue
  game.js                  20 TPS fixed-step loop, interpolated rendering, furnaces, autosave
  world/                   ── voxel world ──
    blocks.js items.js     block & item registries (hardness, tools, food, fuel…)
    generator.js           noise terrain, biomes, caves, ores, trees (runs in workers)
    worker.js              Web Worker: generation + initial light, section meshing
    world.js lighting.js   chunk storage, block edits, flood-fill sky/block light
    mesher.js              face-culled section mesher with smooth light + AO
    fluids.js              water / lava flow; gravity blocks live in world.js
    mining.js              break times and block drops
    enchantments.js        enchantments: table offers, anvil combining, effects
    textures.js            procedural pixel art for every block face
    save.js                IndexedDB persistence (RLE-compressed chunks)
  physics/                 constants.js (vanilla values), body.js (AABB, step-up, fluids)
  player/                  player.js, survival.js (hunger), inventory.js, crafting.js, interaction.js
  mobs/                    mobTypes.js, mob.js (AI), models.js, pathfinding.js,
                           spawnRules.js, spawner.js, drops.js
  entities/                items, falling blocks, arrows, explosions
  sky/                     suns.js (pure orbital model), sky.js (lights, shadows, colours),
                           skyShader.js (atmosphere, suns, planet), gasGiant.js (ring mesh + particles)
  render/                  chunkRenderer.js, terrainMaterial.js, overlays.js, particles.js, enchantBooks.js
  ui/                      hud.js, screens.js, icons.js, input.js, style.css
  audio/                   audio.js (procedural Web Audio effects)
  net/                     multiplayer: protocol.js (wire format), transport.js (PeerJS / loopback),
                           editSync.js (block edits), session.js (host & client), remotePlayer.js,
                           entityMirror.js (guest copies of the host's entities)
tests/                     vitest suites (95 tests)
```

## The world

* **Chunks** are 16×16 columns, 384 blocks tall (y = −64 … 319), sea level 63.
  Generation and initial lighting run in a pool of Web Workers; light is then
  stitched across chunk borders on the main thread.
* **Meshing** is face-culled per 16³ section (in workers), with vanilla-style
  smooth lighting and ambient occlusion, then merged into two draw calls per
  chunk (opaque + translucent). Player edits are re-meshed synchronously so
  there is no flicker. Textures live in a mip-mapped texture array.
* **Terrain**: continentalness / erosion / ridge noise splines for height,
  3-D density noise for overhangs, temperature and humidity for 11 biomes
  (ocean, frozen ocean, beach, plains, forest, birch forest, taiga, snowy
  plains, desert, stony peaks, snowy peaks), smooth grass/foliage tinting,
  bare rock on steep slopes.
* **Caves**: "cheese" caverns and "spaghetti" tunnels from interpolated 3-D
  noise; lava fills cave air below y = −55; deepstone below y = 0 with a
  dithered transition; bedrock floor.
* **Ores** use the vanilla per-chunk feature table (counts, uniform/triangle
  height distributions, vein sizes, air-exposure discard) — e.g. diamonds peak
  near y = −59, iron has its mountain band, beryl only in mountains.
* **Blocks** break with vanilla hardness, tool multipliers, harvest tiers,
  the ×5 penalties for mining in water or while airborne, and the 5-tick delay
  between breaks. While mining, ten crack stages spread over the block
  (multiplied into its texture, so they follow its lighting), chips fly off
  the hit face and the arm chops continuously. Sand and gravel fall; plants, torches and cacti pop off when
  unsupported. Water spreads 7 blocks every 5 ticks, lava 3 blocks every 30
  ticks, with downhill seeking, infinite sources and lava/water hardening
  (obsidian / cobblestone / stone).

## Physics

The player and every mob run the vanilla movement integration at 20 ticks per
second: acceleration → swept AABB collision (Y first, then the larger
horizontal axis) → gravity 0.08 and drag 0.98 → friction (block slipperiness ×
0.91 on ground, 0.91 in air). Rendering interpolates between ticks.

| Quantity | Value | Measured in tests |
|---|---|---|
| Walk / sprint / sneak speed | 0.1 attribute, ×1.3, ×0.3 | 4.317 / 5.612 / 1.295 m/s |
| Jump | 0.42 b/t initial velocity | apex 1.2522 blocks, 12 ticks airtime |
| Sprint-jump boost | +0.2 in facing direction | |
| Terminal velocity | | 3.92 b/t |
| Step-up height | 0.6 | |
| Player box / eye | 0.6 × 1.8, eye 1.62 (sneak 1.5 / 1.27) | |
| Fall damage | ⌈distance − 3⌉ | 10-block fall = 7 |
| Water / lava | 0.02 accel, ×0.8 / ×0.5 drag, buoyant jumping | |

Survival: 20 health, 20 food, 5 initial saturation; exhaustion from sprinting,
jumping, swimming, attacking, mining and taking damage; regeneration every 80
ticks at ≥ 18 food or every 10 ticks with saturation at full food; starvation
down to half a heart (Normal difficulty). Drowning after 15 s of air (2 damage
per second), lava 4 damage + 15 s of fire, fire 1 damage per second, cactus
contact damage, the 10-tick invulnerability window with damage replacement,
knockback, the attack-cooldown damage curve and critical hits.

## Three suns

The sky has three suns, each defined by its own orbital period, starting phase,
rise azimuth, orbital tilt, declination offset, colour temperature, intensity
and apparent size (`src/sky/suns.js`):

| Sun | Period (ticks) | Phase | Rises at | Tilt | Colour | Intensity |
|---|---|---|---|---|---|---|
| **Hearth** | 24 000 | 0.02 | 90° (east) | 20° | 5600 K, yellow-white | 1.00 |
| **Pale Warden** | 37 200 | 0.60 | 62° | 38° | 11 000 K, blue-white | 0.55 |
| **Ember** | 15 400 | 0.33 | 128° | 52° | 2700 K, red-orange (large disc) | 0.45 |

* **Day** = at least one sun above the horizon; **twilight** = exactly one sun
  up; **night** = all three below. Because the periods are incommensurable the
  pattern never repeats exactly: nights last roughly 1–7 minutes and occupy
  ~15 % of the time.
* **Combined light**: each sun contributes `intensity × smoothstep(elevation)`;
  the combination `1 − Π(1 − fᵢ)` drives the 0…11 sky-darkening value, exactly
  where vanilla uses its single sun. Effective sky light = raw sky light −
  darkening, so a lone Ember or Pale Warden gives a dim (light 9–10) "twilight
  day" where surface monsters still cannot spawn, while a fully dark sky gives
  light 4 like a vanilla night.
* **Mobs use the combined light**: hostile spawning uses the vanilla light test
  with the combined darkening, undead burn only when the combined sunlight
  counts as "day" (darkening < 4) and the brightness at their head exceeds 0.5,
  spiders turn neutral in bright combined light, voidwalkers flee daylight.
* **Rendering**: each sun has its own disc, glare and horizon scattering; where
  suns appear together their glows add and the scene light colour is the
  intensity-weighted blend of the visible suns. Each sun owns one
  shadow-casting directional light (three shadow maps in total); shadow maps
  are refreshed round-robin (brightest sun every 3rd frame, the others every
  6th) and lights below the horizon are switched off.

## Ringed gas giant

The world is a tidally locked moon, so the gas giant hangs almost fixed in the
southern sky with a slow libration.

* Ray-traced sphere in the sky shader with a **banded, animated atmosphere**
  (fbm noise with latitude-dependent differential rotation, polar hoods and a
  drifting storm oval), **soft limb glow** and a **subtle aurora** on the polar
  night side.
* **Rings** are a real mesh (`RingGeometry`) with a procedural density shader
  — broad bands, fine ringlets, a division gap — where **each radius rotates at
  its own Keplerian speed** (ω ∝ r^−1.5), plus 6 000 orbiting ice particles that
  follow the same law. Rings are **translucent** (back-lit side dimmer),
  show **specular glints**, receive the **planet's shadow** and cast their own
  shadow onto the cloud tops; the planet occludes the far side of the rings.
* **Lighting follows the actual sun directions**, so the planet shows phases,
  can be lit by suns that are below your horizon, and fades into the daytime sky.

## Survival content

### Mobs

| Mob | Vanilla role | Health | Speed | Size | Notes |
|---|---|---|---|---|---|
| Bristleback | pig | 10 | 0.25 | 0.9×0.9 | |
| Mooxen | cow | 10 | 0.20 | 0.9×1.4 | |
| Fleecer | sheep | 8 | 0.23 | 0.9×1.3 | |
| Cluckling | chicken | 4 | 0.25 | 0.4×0.7 | slow fall, lays eggs every 5–10 min |
| Shambler | zombie | 20 | 0.23 | 0.6×1.95 | melee 3, armour 2, burns in sunlight |
| Rattler | skeleton | 20 | 0.25 | 0.6×1.99 | bow every 40 ticks, strafes, burns in sunlight |
| Fizzler | creeper | 20 | 0.25 | 0.6×1.7 | 30-tick fuse within 3 blocks, power-3 explosion |
| Skitterer | spider | 16 | 0.30 | 1.4×0.9 | climbs walls, leaps, neutral in bright light |
| Voidwalker | enderman | 40 | 0.30 (+0.15 angry) | 0.6×2.9 | angered by eye contact, teleports, hurt by water, dodges arrows |

Mob movement uses the same physics with vanilla's mob acceleration (speed²),
A* pathfinding over walkable cells, panic when hurt (passives), melee reach
`(2·width)² + target width`, the skeleton's bow logic and the fuse/swell logic.

**Drops** (no Looting): Bristleback 1–3 pork chops; Mooxen 0–2 leather + 1–3
beef; Fleecer 1 wool + 1–2 mutton; Cluckling 0–2 feathers + 1 raw fowl (meat
drops cooked if the mob was burning); Shambler 0–2 rotten flesh + 2.5 % rare
drop on player kills; Rattler 0–2 arrows + 0–2 bones; Fizzler 0–2 blast powder;
Skitterer 0–2 string + 1/3 chance of an eye on player kills; Voidwalker 0–1
void pearl.

**Spawning** follows the vanilla natural-spawn algorithm: each tick one attempt
per chunk within 8 chunks at a random height below the heightmap; packs of up
to 3 groups × up to 4 tries with ±5 jitter; at least 24 blocks from the
player; mob caps of 70 hostile / 10 passive scaled by chunk count / 289;
passive attempts only every 400 ticks plus 10 % chance of a herd when a chunk is
first generated; biome spawn weights (monsters: Skitterer 100, Shambler 100,
Rattler 100, Fizzler 100, Voidwalker 10; animals in grassy biomes: Fleecer 12,
Bristleback 10, Cluckling 10, Mooxen 8). Monsters need block light 0, raw
sky light ≤ rand(32) and combined light ≤ rand(0…7); animals need grass and
light > 8. Hostiles despawn instantly beyond 128 blocks and with 1/800 chance
per tick beyond 32 blocks after 30 s without interaction; animals persist (also
across chunk unloads and saves).

### Items and progression

Logs → planks → sticks / workbench → wooden, stone, iron, golden and diamond
pickaxes, axes, shovels and swords (vanilla speeds, damage, attack speed and
durability) → furnace (200-tick smelting, vanilla fuel values) → ingots, glass,
stone, cooked food; torches, buckets (water/lava pick-up and placement),
bow and arrows, storage blocks, wool, sandstone, stone bricks. Food values
(hunger/saturation) and side effects (hunger from rotten flesh and raw fowl,
poison from eyes) follow the documented table.

## Implemented vs. not yet implemented

**Implemented** (vanilla features)

* Chunked 384-high world, worker generation, biomes, caves, ore distribution, trees, plants
* More biomes: swamp (flat pools, lily pads, vine-hung oaks, clay), jungle (giant 2x2 trees, bushes, vines, melons), savanna (acacia), badlands (red sand, striped terracotta mesas), dark forest (dark oak canopy, huge mushrooms), mushroom fields, snowy taiga and flower forest, with their own tints, wood types, saplings, recipes and spawns; mountains rise gradually out of rolling foothills
* Mining with hardness/tool tiers/durability, block drops, placing, pick-block
* Sky light + block light with smooth lighting and AO; torches, lava, lit furnace glow
* Gravity blocks, water and lava flow, source creation, obsidian/cobblestone/stone formation
* Player physics, sprinting, sneaking (ledge stop), swimming, step-up, fall damage
* Health, hunger, saturation, exhaustion, regeneration, starvation, drowning, fire, lava, cactus
* Attack cooldown, critical hits, knockback, armour formula for mobs, invulnerability frames
* 9 mobs with AI, pathfinding, drops, natural spawning, caps and despawning
* Explosions (ray-based block destruction with blast resistance, exposure-scaled damage, 1/power drop survival)
* Inventory, hotbar, 2×2 and 3×3 shaped/shapeless crafting with a recipe book, furnace smelting
* Farming: hoes till grass/dirt; tall grass drops seeds (1/8); wheat grows through 8 stages on random ticks (3 per section per tick) with the reference growth-speed formula, needs light ≥ 9; farmland is moistened by water within 4 blocks, dries out, reverts to dirt and can be trampled; bread from 3 wheat
* Grass spreads to nearby dirt in light ≥ 9
* Armour: leather/golden/iron/diamond helmets, chestplates, leggings and boots with the reference defence points, toughness, durability and damage formula (falls, drowning, burning, starvation and poison bypass it); armour slots in the inventory, right-click or shift-click to wear; armour bar
* Experience: orbs from player kills (monsters 5, animals 1–3) and ores (coal 0–2, azurite 2–5, cinnabar 1–5, diamond/beryl 3–7) that drift to the player within 8 blocks; reference level curve, XP bar and level, 7 × level (max 100) dropped on death
* Beds (3 wool + 3 planks): sleeping only when all three suns are down and no monster within 8 blocks; 5 s of sleep skips to the first sunrise; sets the respawn point (lost if the bed is gone)
* Animals follow a player holding their food (cows/sheep wheat, chickens seeds, pigs carrots); feeding two adults makes them breed (a baby that grows up in 20 minutes, 5-minute cooldown, 1–7 XP); feeding babies speeds up growth
* Shears (2 iron) shear sheep for 1–3 wool; sheep regrow it by eating grass
* Carrots: a crop planted on farmland (2–5 per ripe plant), food, and part of the Shambler's rare drop
* Potatoes (2–5 per ripe plant, 2 % poisonous potato; bake them in a furnace) and beetroots (beetroot + seeds; 6 beetroots + bowl = beetroot soup, which gives the bowl back); both grow in village farms, are sold by farmers and feed pigs/chickens
* Fences (oak/spruce/birch) that connect to fences, gates and full blocks, with 1.5-block collision so nothing jumps over; oak fence gates that open and close
* Villages (one per 320 × 320-block region at most, in plains, desert, taiga and snowy plains): a well, four dirt-path roads and houses (log/plank, sandstone or spruce/cobblestone styles, with doors, windows, a bed and a workbench or chest), farms of wheat or carrots and lamp posts; `/locate village` finds the nearest
* Settlers live in the village houses: farmer, librarian, smith, shepherd or butcher (robe colour); they flee Shamblers, stay near home and go inside at night; right-click to trade goods for beryl and beryl for goods (12 uses per offer, restocked every half day, XP for trading)
* Dungeons: mossy cobblestone rooms (5–7 × 4 × 5–7 inside, 14 attempts per chunk, 1–5 openings into caves) with a monster spawner (Shambler 50 %, Rattler/Skitterer 25 % each; active within 16 blocks, 4 spawn attempts every 10–40 s, at most 6 nearby, light ≤ 11) and up to two loot chests; mined spawners give 15–43 XP
* Sugar cane on shores (grows to 3 blocks next to water) → paper → books → bookshelves; clay → bricks; glass panes that connect
* 16 dye colours: bone meal (white), flowers (yellow/red), azurite (blue), cactus in a furnace (green), coal (black) and mixes; dyed wool; sheep come in natural colours (white, black, grays, brown, rare pink), can be dyed and drop/shear their colour
* Pumpkin patches (plains, taiga) and melons (forests): pumpkin + torch = pumpkin lantern (light 15), melons drop 3–7 slices, pumpkin pie
* Howlers (wolves) in packs of 4 in forests and taiga: they hunt Fleecers and Clucklings and the whole pack turns on whoever hurts one; tame with bones (1 in 3), then they sit/stand on right-click, follow you (teleporting when over 12 blocks away), attack what hurts you or what you hit, heal and breed with meat (pups are tame), red collar
* Gallopers (horses) in plains and savannas, in five coats with their own health and jump strength: climb on with an empty hand; a wild one bucks you off after a few seconds but may accept you (the chance grows each time and with wheat or apples); saddle a tame one (3 leather + iron) to ride it with WASD, sprint and Space to jump; they step up whole blocks
* Compass (4 iron + cinnabar: its needle points at the world spawn, and spins in other dimensions) and clock (4 gold + cinnabar: shows the sky brightness and how many suns are up), both live in your hand
* Signs (6 planks + stick → 3): standing on a block or hung on a wall, four lines of up to 15 characters typed in a sign editor (right-click to edit again); saved with the world and shared in multiplayer
* Paintings (8 sticks + wool): eight original procedurally painted pictures from 1 × 1 to 4 × 3 (three suns, a ringed moon, dunes, a harbour, peaks, a forest, a shoreline, a city in the sky); right-click a wall to hang the largest that fits; breaking any part takes the whole picture down
* Campfires (3 sticks, coal, 3 logs: light 15, animated flames, rising smoke, burn whoever stands on them, drop 2 coal) and lanterns (iron + torch: light 15, standing, or hanging when placed under a block); torches smoke and lava throws embers
* Shields (6 planks + iron ingot, 336 uses): hold right-click to raise one (after a quarter second); it stops melee hits and arrows from in front, wears with the damage it takes, pushes attackers back and slows you to a fifth
* Jungle temples (mossy cobblestone, two storeys, vines, a ladder down to a hidden chest) and igloos in snowy biomes (a snow dome with bed, workbench, furnace and chest), in the same regions as desert temples
* Desert temples (one 256 × 256 region in three, on level desert ground): a 21 × 21 sandstone hall with two towers, terracotta bands and a terracotta star on the floor; dig down through its red centre to a hidden chamber with four loot chests — above nine TNT; `/locate temple`
* TNT (5 blast powder + 4 sand): lit by flint and steel, fire or another explosion (chain reactions with a 10–30-tick fuse), it hops, swells and flashes for 4 s and explodes with power 4; works for guests in multiplayer too
* Abandoned mineshafts (one per four 192 × 192 regions, y −40..30): a dirt room with branching 3 × 3 corridors, oak fence-and-plank supports every 4 blocks, rails, cobwebs (slow you to a crawl; swords cut them for string), plank bridges over caves and loot chests; `/locate mineshaft`
* Rails and minecarts: rails (6 iron + stick → 16) join up automatically into straights, curves and slopes one block up or down; minecarts (5 iron) are placed on rails, ridden like boats (right-click, `Shift` to get out, W to push), coast with the reference drag (0.997 ridden), roll down slopes, top out at 8 blocks/s and derail at the end of the line; saved and shared in multiplayer
* Cinnabar circuitry (`src/world/circuits.js`): power levels 0–15. **Cinnabar Dust** is laid as wire that loses one level per block, joins neighbouring wire (also one step up or down a block unless something sits on top) and is drawn as dots, lines, corners and crosses, from dark red (0) to bright red (15). Sources: **Lever** (stick + cobblestone; floor, wall or ceiling, toggles), **Stone Button** (stone; a 20-tick pulse), **Wooden Pressure Plate** (2 planks; players, mobs and items keep it down), **Cinnabar Block** (9 dust; always on). Components: **Cinnabar Torch** (dust + stick; an inverter that turns off 2 ticks after its block is powered, burns out when toggled 8 times within 3 s), **Repeater** (2 torches, dust, 3 stone; 1–4 delay steps of 2 ticks set by right-click, one-way, restores level 15 and stretches short pulses), **Cinnabar Lamp** (4 dust + Glowshard; light 15 while powered, off 4 ticks later), **Piston** (3 planks, 4 cobblestone, iron, dust; pushes up to 12 blocks, breaks plants/torches/wire in the way, cannot move obsidian, containers or extended pistons) and **Sticky Piston** (+ slimeball; pulls the block back). Pistons move blocks at once (no sliding animation) and shove entities. Power also opens doors, trapdoors and fence gates (only on changes, so hands still work), sets off TNT and rings the **Chime Block** (8 planks + dust; right-click picks one of 25 pitches). Strong/weak power follows the reference: a lever, button, plate, repeater or torch strongly powers one block, which then powers wire next to it; a block only powered by wire running into it powers components but not other wire. Wire networks are recomputed as a whole (breadth first from the strongest source) and the update queue is capped per tick, so long lines and clocks do not cause update storms. Only the single player world or the multiplayer host simulates; guests apply its block edits (their lever flips go to the host like any edit). Pending ticks are not saved, so circuit blocks re-evaluate when their chunk loads and on random ticks
