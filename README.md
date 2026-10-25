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
    monuments.js sponge.js Tide Citadels (ocean monuments) and Soakmoss (sponge); monumentTextures.js
  physics/                 constants.js (vanilla values), body.js (AABB, step-up, fluids)
  player/                  player.js, survival.js (hunger), inventory.js, crafting.js, interaction.js
  mobs/                    mobTypes.js, mob.js (AI), models.js, pathfinding.js,
                           spawnRules.js, spawner.js, drops.js, oceanMobs.js (Deepeyes)
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
* **Block ids** are 16 bits: the original blocks use 1–255, item ids use 256–1023, and newer blocks start at 1024 (`EXT_BASE` in `src/world/blocks.js`, numbered in the order they are listed, so only ever append). Old saves with 8-bit chunks still load.
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
| Hexwife | witch | 26 | 0.25 | 0.6×1.95 | throws splash elixirs every 60 ticks within 10 blocks, drinks her own, 15 % magic damage |
| Dune Shambler | husk | 20 | 0.23 | 0.6×1.95 | melee 3 + Hunger, armour 2, no sun burn |
| Sodden Shambler | drowned | 20 | 0.23 | 0.6×1.95 | swims after targets in the water, burns in sunlight |
| Rime Rattler | stray | 20 | 0.25 | 0.6×1.99 | Rattler whose arrows cause 30 s of Slowness |
| Voidwalker | enderman | 40 | 0.30 (+0.15 angry) | 0.6×2.9 | angered by eye contact, teleports, hurt by water, dodges arrows |
| Deepeye | guardian | 30 | swims | 0.85×0.85 | 2 s beam (6), thorns 2 while still, Tide Citadels only |
| Elder Deepeye | elder guardian | 80 | swims | 1.99×1.99 | 1.5 s beam (8), Mining Fatigue III every minute, 3 per citadel |

Mob movement uses the same physics with vanilla's mob acceleration (speed²),
A* pathfinding over walkable cells, panic when hurt (passives), melee reach
`(2·width)² + target width`, the skeleton's bow logic and the fuse/swell logic.

**Drops** (no Looting): Bristleback 1–3 pork chops; Mooxen 0–2 leather + 1–3
beef; Fleecer 1 wool + 1–2 mutton; Cluckling 0–2 feathers + 1 raw fowl (meat
drops cooked if the mob was burning); Shambler 0–2 rotten flesh + 2.5 % rare
drop on player kills; Rattler 0–2 arrows + 0–2 bones; Fizzler 0–2 blast powder;
Skitterer 0–2 string + 1/3 chance of an eye on player kills; Voidwalker 0–1
void pearl; Hexwife 1–3 rolls of 0–2 glass vials, glowshard dust, blast powder,
cinnabar dust, skitterer eyes, sugar or sticks (sticks twice as likely); Dune
Shambler as the Shambler; Sodden Shambler 0–2 rotten flesh + 11 % copper ingot
on player kills; Rime Rattler as the Rattler.

**Spawning** follows the vanilla natural-spawn algorithm: each tick one attempt
per chunk within 8 chunks at a random height below the heightmap; packs of up
to 3 groups × up to 4 tries with ±5 jitter; at least 24 blocks from the
player; mob caps of 70 hostile / 10 passive scaled by chunk count / 289;
passive attempts only every 400 ticks plus 10 % chance of a herd when a chunk is
first generated; biome spawn weights (monsters: Skitterer 100, Shambler 100,
Rattler 100, Fizzler 100, Voidwalker 10, Hexwife 5; deserts Shambler 20 / Dune
Shambler 80, snowy plains Rattler 20 / Rime Rattler 80, oceans + Sodden Shambler 5; animals in grassy biomes: Fleecer 12,
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
* Cocoa pods grow on small jungle trees (three sizes, 1 in 5 per random tick) and on jungle logs you plant beans on; ripe pods give 2–3 beans (brown dye; wheat + beans + wheat = 8 cookies)
* Potatoes (2–5 per ripe plant, 2 % poisonous potato; bake them in a furnace) and beetroots (beetroot + seeds; 6 beetroots + bowl = beetroot soup, which gives the bowl back); both grow in village farms, are sold by farmers and feed pigs/chickens
* Fences (oak/spruce/birch) that connect to fences, gates and full blocks, with 1.5-block collision so nothing jumps over; oak fence gates that open and close
* Villages (one per 320 × 320-block region at most, in plains, desert, taiga and snowy plains): a well, four dirt-path roads and houses (log/plank, sandstone or spruce/cobblestone styles, with doors, windows, a bed and a workbench or chest), farms of wheat or carrots and lamp posts; `/locate village` finds the nearest
* Settlers raise children when the village has more beds than settlers (two adults by day, then a 5-minute pause); children grow up in 20 minutes and take up a random trade
* Settlers live in the village houses: farmer, librarian, smith, shepherd, butcher, fletcher (arrows, bows, crossbows, tipped arrows) or cleric (gilded apples, glowshard dust, vials) (robe colour); they flee Shamblers, stay near home and go inside at night; right-click to trade goods for beryl and beryl for goods (12 uses per offer, restocked every half day, XP for trading)
* Dungeons: mossy cobblestone rooms (5–7 × 4 × 5–7 inside, 14 attempts per chunk, 1–5 openings into caves) with a monster spawner (Shambler 50 %, Rattler/Skitterer 25 % each; active within 16 blocks, 4 spawn attempts every 10–40 s, at most 6 nearby, light ≤ 11) and up to two loot chests; mined spawners give 15–43 XP
* Sugar cane on shores (grows to 3 blocks next to water) → paper → books → bookshelves; clay → bricks; glass panes that connect
* 16 dye colours: bone meal (white), flowers (yellow/red), azurite (blue), cactus in a furnace (green), coal (black) and mixes; dyed wool; sheep come in natural colours (white, black, grays, brown, rare pink), can be dyed and drop/shear their colour
* Hay bales (9 wheat): landing on one takes 80 % off the fall damage
* Melon and pumpkin stems (seeds from slices and pumpkins) grow on farmland in 8 stages and then set a fruit on a free neighbouring block of soil, one at a time
* Pumpkin patches (plains, taiga) and melons (forests): pumpkin + torch = pumpkin lantern (light 15), melons drop 3–7 slices, pumpkin pie
* Howlers (wolves) in packs of 4 in forests and taiga: they hunt Fleecers and Clucklings and the whole pack turns on whoever hurts one; tame with bones (1 in 3), then they sit/stand on right-click, follow you (teleporting when over 12 blocks away), attack what hurts you or what you hit, heal and breed with meat (pups are tame), red collar
* Gallopers (horses) in plains and savannas, in five coats with their own health and jump strength: climb on with an empty hand; a wild one bucks you off after a few seconds but may accept you (the chance grows each time and with wheat or apples); saddle a tame one (3 leather + iron) to ride it with WASD, sprint and Space to jump; they step up whole blocks
* Maps: an Empty Map (8 paper around a compass) used in the air becomes a map of the 128 × 128-block square around you (reference grid); held in the hand it keeps drawing everything within 64 blocks from above — block colours with biome tints, brighter and darker slopes, water shaded by depth — with a white arrow for you (a dot when you are outside the square); maps are saved with the world
* Cragbucks (goats) on the stony and snowy peaks: they take big leaps, ignore fall damage, can be milked and bred with wheat, and every 30–300 s lower their head and ram a player who is not sneaking (or another animal) within 16 blocks, flinging it away; charging into stone, logs or ore can knock off one of their two horns — a Crag Horn that sounds far and wide when used
* Buzzlings (bees): wild Bee Nests hang on oaks and birches in plains, flower and birch forests (three bees each); bees fly to flowers within 22 blocks, gather nectar for a few seconds, dust crops they pass over (they grow a stage) and bring it home — each trip adds a level of honey until the nest drips (level 5). Shears cut 3 Honeycomb, a Glass Vial fills a Honey Bottle (6 food, cures Poison; 1 → 3 sugar); unless a campfire smokes up to 5 blocks below, the bees attack. Bees shelter at home at night and in the rain; hitting one or breaking their nest angers the swarm: each bee stings once (2 damage + Poison) and dies soon after. Beehives (6 planks + 3 honeycomb) work like nests
* Shellbacks (turtles) on beaches: slow on land, fast swimmers, each remembers its home beach; bred with sugar cane, the mother swims home and lays 1–4 eggs on the sand, which crack at night (rarely by day) and hatch after three cracks; a hatchling drops a Scute when it grows up, and 5 scutes make a Shellback Helmet (2 armour) that keeps 10 s of Water Breathing topped up while your head is above water
* Squawklets (parrots) in five plumages flutter through jungles and settle on the ground now and then; tamed with seeds (1 in 3) they follow their owner in flight or sit on command, and they mimic the voice of monsters within 20 blocks; they drop feathers
* Purrlings (cats) in six coats roam every village: they shy away from players, creep closer to someone standing still with raw fish, and are tamed with fish (1 in 3); tame ones sit on command, follow and teleport to their owner, breed with fish, and Fizzlers within 6 blocks back off from them and their fuse goes out
* Hoppers (rabbits) hop through plains, taiga, snow and desert and drop raw rabbit and hide (4 hides make leather); Frostbears roam the snowy plains, peaceful until one is hit, then the whole group fights back; Vixlings (foxes) doze in the daytime, run from players who do not sneak, and hunt Clucklings and Hoppers at night
* Sprint-swimming: sprint with your head under water to swim flat (0.6 high) in the direction you look at about 5.6 blocks/s, shown on the player model
* Compass (4 iron + cinnabar: its needle points at the world spawn, and spins in other dimensions) and clock (4 gold + cinnabar: shows the sky brightness and how many suns are up), both live in your hand
* Signs (6 planks + stick → 3): standing on a block or hung on a wall, four lines of up to 15 characters typed in a sign editor (right-click to edit again); saved with the world and shared in multiplayer
* Item frames (8 sticks + leather): hang on a wall, right-click to put the held item in and again to turn it in 45° steps, hit to take it out; saved and shared in multiplayer
* **Armor Stands** (six sticks around a stone or smooth stone slab, or smooth stone): placed on top of a block facing you (in 45° steps), a wooden figure on a stone plate. Right-click with armour to dress it (swapping with what it wore), with any other item to put that in its hand, and with an empty hand on its head, body, legs or feet to take that piece off; two quick hits (one in creative) knock it down, dropping the stand and everything on it; saved (per dimension) and shared in multiplayer
* Paintings (8 sticks + wool): eight original procedurally painted pictures from 1 × 1 to 4 × 3 (three suns, a ringed moon, dunes, a harbour, peaks, a forest, a shoreline, a city in the sky); right-click a wall to hang the largest that fits; breaking any part takes the whole picture down
* Campfires (3 sticks, coal, 3 logs: light 15, animated flames, rising smoke, burn whoever stands on them, drop 2 coal) and lanterns (iron + torch: light 15, standing, or hanging when placed under a block); torches smoke and lava throws embers
* **Candles** (string over honeycomb; dye them in any of sixteen colours): place up to four of the same colour in one block, light them with flint and steel (light 12, a little flame on each wick) and snuff them out with a click
* **Scaffolding** (six from six bamboo and a string): only its top is solid, so you stand on it, sneak to sink down through it and jump to climb up inside; click the side of a tower to build onto its top, or the top you stand on to reach out sideways; each block may stand at most 6 blocks out from a column on the ground, and taking out the footing brings the whole frame down (it breaks at once)
* **Flower Pots** (three bricks): right-click with a sapling, flower, mushroom, dead bush, cactus, azalea or bamboo to plant it, and with an empty hand to take it back. **Chains** (iron nugget, ingot, nugget; nuggets from an ingot and back) hang lanterns from the ceiling
* **Beacons** (glass, obsidian and a Suncore from Elder Deepeyes or the Void Wyrm) on 1–4 layer pyramids of iron/gold/diamond/beryl blocks shine a beam (tinted by stained glass) and give Speed, Haste, Resistance, Jump Boost or Strength (Regeneration or level II at level 4) within 10+10×level blocks; pay with an ingot, diamond or beryl.
* Shields (6 planks + iron ingot, 336 uses): hold right-click to raise one (after a quarter second); it stops melee hits and arrows from in front, wears with the damage it takes, pushes attackers back and slows you to a fifth
* Flitters (bats): up to 15 flutter about in dark caves near you (light ≤ 3), squeak, and hang upside down from ceilings until you come close
* Inklings (squid) in deep ocean water: they drift in pulses with sweeping tentacles, squirt ink and dart away when hit, and drop 1–3 ink sacs (black dye)
* Shipwrecks on the ocean floor (40 % of 160 × 160 regions): an oak or spruce hull with a broken deck, a snapped mast and two loot chests
* **Tide Citadels** (ocean monuments, `src/world/monuments.js`): at most one per 32 × 32-chunk region (the reference spacing: a chunk within the region's first 27 on each axis, the average of two rolls, so neighbours are at least 5 chunks apart), only where the ocean is deep (the centre and eight points round the footprint are ocean with the floor at y ≤ 43/48). A symmetric 58 × 58 temple from y 39 to 61, flooded with water and planned from the seed alone, stamped chunk by chunk: a lower hall of 7 × 7 rooms around a gallery that runs back from the entrance (doorways between rooms, lanterns in the ceilings and floor), one or two mirrored pairs of **sponge rooms** hung with Wet Soakmoss, two raised wings at the back, a terrace over the middle and the core on top, where a shell of Dark Tidestone holds **8 gold blocks**; a skirt and pillars reach down to the sea floor. `/locate monument` (or `citadel`)
* Tide Citadel blocks (reference names in brackets): **Tidestone** (prismarine; 4 Tide Shards), **Tidestone Bricks** (9 shards), **Dark Tidestone** (8 shards + ink sac), **Tide Lantern** (sea lantern: 4 shards + 5 Tide Crystals, light 15, drops 2–3 crystals, itself with Gentle Hand), **Soakmoss** / **Wet Soakmoss** (sponge): placed, or when water flows next to it, Soakmoss drinks up the water breadth-first up to 7 blocks away (taxicab), at most 65 blocks, and turns wet; Wet Soakmoss dries in a furnace (and at once in the Cinderdeep)
* **Deepeyes** (guardians: 30 HP, 0.85 blocks) swim the citadels — packs of 2–4 spawn in the citadel's water near you (up to 12 per citadel, within the monster cap, at any light). A Deepeye that sees a player or an Inkling 3–16 blocks away stops, turns to it and charges a beam (violet to white) for 2 s, then hurts it for 6; while it holds still its spikes stand out and melee attackers take 2 thorn damage. Out of water it flops about. Drops 0–2 Tide Shards plus raw Silverfin (40 %) or Tide Crystals (40 %), 10 XP. **Elder Deepeyes** (elder guardians: 80 HP, 2 blocks, three per citadel — one in each wing and one in the core, placed once and persistent) charge for 1.5 s and hit for 8, and every minute lay **Mining Fatigue III** for 5 minutes on every survival player within 50 blocks (renewed only if missing, weaker or under a minute left; a pale flicker and a cry); they drop a Wet Soakmoss on player kills. Beams are part of the host's mob snapshots (target point, charge and spikes), so guests see them; guests get the curse through an `eff` message
* **Mining Fatigue** (`/effect give mining_fatigue`): mining speed × 0.3^level (30 %, 9 %, 0.27 %, from level IV on 0.081 %), as in the reference
* Raider outposts (one 288 × 288 region in four, on plains, taiga, desert, savanna or snowy plains): a dark oak watchtower with a lookout and a loot chest, guarded by five Marauders (pillagers) — crossbow-like archers that strafe and shoot and do not burn in daylight; `/locate outpost`
* Every structure has its own chest loot (dungeons, mineshafts with rails, desert and jungle temples with gold and beryl, igloos with food, shipwrecks with paper, crops and a compass); `/locate shipwreck`
* Jungle temples (mossy cobblestone, two storeys, vines, a ladder down to a hidden chest) and igloos in snowy biomes (a snow dome with bed, workbench, furnace and chest), in the same regions as desert temples
* Desert temples (one 256 × 256 region in three, on level desert ground): a 21 × 21 sandstone hall with two towers, terracotta bands and a terracotta star on the floor; dig down through its red centre to a hidden chamber with four loot chests — above nine TNT; `/locate temple`
* TNT (5 blast powder + 4 sand): lit by flint and steel, fire or another explosion (chain reactions with a 10–30-tick fuse), it hops, swells and flashes for 4 s and explodes with power 4; works for guests in multiplayer too
* Abandoned mineshafts (one per four 192 × 192 regions, y −40..30): a dirt room with branching 3 × 3 corridors, oak fence-and-plank supports every 4 blocks, rails, cobwebs (slow you to a crawl; swords cut them for string), plank bridges over caves and loot chests; `/locate mineshaft`
* Rails and minecarts: rails (6 iron + stick → 16) join up automatically into straights, curves and slopes one block up or down; minecarts (5 iron) are placed on rails, ridden like boats (right-click, `Shift` to get out, W to push), coast with the reference drag (0.997 ridden), roll down slopes, top out at 8 blocks/s and derail at the end of the line; saved and shared in multiplayer
* Fishing: a rod (3 sticks + 2 string) casts a bobber with a sagging line; after 5–30 s (faster in rain) a fish bites, the bobber dips and splashes and reeling in lands a catch (85 % fish: Silverfin, Redfin, poisonous Spinefish, rare Glimmerfin; 10 % junk; 5 % treasure) plus 1–6 XP; fish can be cooked
* Wobblers (slimes): see-through green cubes in three sizes (health size², contact damage = size, the smallest is harmless) that hop towards you and split into 2–4 smaller ones on death; they spawn in swamps at night and below y 40 in one chunk out of ten; the smallest drop slimeballs
* Frostlings (snow golems): a pumpkin on two snow blocks; they pelt monsters within 10 blocks with snowballs, leave a trail of snow in cool biomes, melt in deserts and rain, and drop snowballs
* Ironguards (iron golems): one guards every village well; 100 health, they smash hostile mobs (not Fizzlers) within 16 blocks for 7–21 damage and fling them up, turn on players who hurt Settlers or them, drop 3–5 iron and redblooms; build your own from a T of four iron blocks with a pumpkin on top (it never turns on you)
* Throwable snowballs and eggs (right-click): they knock mobs back without damage and burst on impact; an egg hatches a baby Cluckling 1 in 8 (four of them 1 in 32); shared in multiplayer
* Cobblestone and mossy cobblestone walls (6 → 6; connect to walls, gates and full blocks, no post on straight runs, 1.5-high collision) and oak trapdoors (6 planks → 2; lie on the bottom or top half, open against their hinge side with right-click)
* Enchanting: the enchanting table (book + 2 diamonds + 4 obsidian; light 7, an open book floats above it and turns to face you) takes an item and Azurite and offers three enchantments whose level costs follow the reference formula (random 1–8 plus bookshelves in the 2-block ring with air in between, max 15 → top 30); picking one costs 1–3 levels and 1–3 Azurite and rolls enchantments with the reference enchantability (per material) and weighting; books become Enchanted Books. Enchantments (Saturncraft names): **Keen** (+damage), **Hallowed** (+damage to the undead), **Shove** (knockback), **Emberbrand** (sets targets alight), **Plunder** (more mob drops), **Swiftdig** (mining speed + level² + 1), **Gentle Hand** (blocks drop themselves), **Bounty** (more ore drops), **Steadfast** (durability chance), **Bulwark** (armour protection, 4 % per level, max 80 %), **Featherstep** (fall protection, boots), **Strongdraw** (bow damage) and **Endless** (arrows are not used up). Enchanted items glint purple in slots, on the ground and in the hand, list their enchantments in the tooltip, never stack with plain items and survive saves, chests and multiplayer. `/enchant <name> [level]` enchants the held item
* Anvil (3 iron blocks + 4 iron ingots; falls like sand): combine two of the same item to repair it (both durabilities + 12 %), repair with its material (a quarter per unit) and apply Enchanted Books (levels merge: equal levels go up by one); level costs follow the reference rarity multipliers plus the doubling prior-work penalty, "Too Expensive!" from 40 levels; the anvil wears out after a few uses
* Snow layers (1–8 layers of 2/16; a single layer has no collision): cold biomes are generated with a snow cover on ground and treetops, snowfall adds single layers and freezes still water, light above 11 melts snow and ice; shovels dig snowballs (4 → snow block, 3 snow blocks → 6 layers), placing snow on snow stacks it
* Grass and foliage tints blend smoothly across biome borders (blurred, world-aligned tint grid)
* Shamblers hunt Settlers when no player is around
* Bone meal grows crops 2–5 stages and sprouts grass and flowers
* Stairs form inner and outer corners next to perpendicular stairs (reference shape rules, also for collision)
* Slabs and stairs in oak, cobblestone, stone brick and sandstone: bottom/top/double slabs (merge by placing), stairs facing away from the player and upside down when placed high; walkable with the 0.6 step-up; they block light like full blocks
* Oak doors (two blocks, 3/16-thick collision box, open/close with right-click), ladders (climb 0.2/tick, fall capped at 0.15, sneak to hold on), torches on walls
* Chests (27 slots, shift-click transfer, contents drop when broken, saved with the world); furnaces and chests face the player when placed; two chests side by side facing the same way join into a 54-slot Large Chest (not while sneaking, never three in a row), also shared in multiplayer; barrels (6 planks + 2 oak slabs) hold 27 stacks like a chest but never join
* Bow and arrows (player and Rattler), arrow pick-up
* Crossbow (stick, iron ingot, string, flint): hold use for 1.25 s to load an arrow, then click to fire a fast, flat, always-critical shot; 465 uses, takes bow enchantments, found in outpost chests and dropped by Marauders (8.5 %)
* Tidespear: a strong melee weapon (9 damage, 250 uses); hold use for half a second and release to throw it (8 damage, flies straight through water); it lands as an item to pick back up, in multiplayer too. One Sodden Shambler in 16 carries a Tidespear (shown in its hand), hurls it at targets 4–20 blocks away every 3 s (8 damage) and drops it, worn, a quarter of the time when a player kills it
* Composter (seven oak slabs): plant matter raises the compost a layer with the reference chances (seeds and leaves 30 %, cactus and cane 50 %, crops and flowers 65 %, bread and baked potatoes 85 %, pumpkin pie always); seven layers settle a second later and the full composter gives Bone Meal
* Gilded Apple (eight gold ingots round an apple; also in dungeon, mineshaft, desert temple, igloo and ruined rift chests): always edible, Regeneration II for 5 s and **Absorption** for 2 minutes: a row of four golden hearts above the red ones that takes damage first
* **Charm of Undying** (reference: totem of undying; half of the Elder Deepeyes drop one, clerics sell them for 24 beryl): anywhere in the hotbar (the reference needs it in a hand) it saves you from a deadly hit once (not from the void or /kill): back to 1 HP with Regeneration II (45 s), Absorption II (5 s) and Fire Resistance (40 s), in a burst of green and gold
* Tipped arrows: eight arrows round a splash elixir make eight Arrows of Swiftness, Poison, Healing and so on; a bow shoots them like plain arrows (the first arrows in the inventory), the hit lays an eighth of the elixir's effect (instant ones in full), and they are picked back up as themselves
* Ambient particles: leaves drift down from tree canopies in the wind, fireflies glow over swamps, forests and jungles on dry nights, and dust hangs in the air of caves; sprinting kicks up dust of the ground under your feet and landing in water splashes
* Building blocks: slabs and stairs of every wood (spruce, birch, jungle, acacia, dark oak, blossom) and of bricks, mossy cobblestone, cobbled deepstone, granite, diorite, andesite, their polished forms, smooth stone and stone; fences of every wood; **Polished Granite / Diorite / Andesite** (4 raw → 4) and **Smooth Stone** (smelt stone); fence gates, **doors and trapdoors of every wood** (they open by hand and with cinnabar power like the oak ones; taiga and savanna villages now use spruce and acacia doors, stairs and slabs)
* Colours: **Stained Glass** in all sixteen dye colours (8 glass round a dye; see-through and tinted), **Concrete** (a dye, 4 sand and 4 gravel → 8) and **Terracotta** in every colour (8 terracotta round a dye), **Carpets** (2 wool → 3; a thin sheet you walk over) and **Stained Glass Panes** (6 stained glass → 16) in every colour; **Mossy Stone Bricks** (stone bricks + vines), **Cracked Stone Bricks** (smelt stone bricks) and **Chiseled Stone Bricks** (two stone brick slabs)
* **Sweet Berry Bushes** grow in taiga patches: they ripen over four stages in the light (bone meal speeds them up), right-click a ripe bush for 1–3 **Sweet Berries** (food; plant them to grow a new bush), and walking through a grown bush slows you and pricks for 1 damage
* **Bamboo** grows in groves in jungles: a section every few random ticks up to 12 tall (plant it on soil to farm it); 2 bamboo → a stick, 4 → **Bamboo Planks** (planks for every plank recipe)
* **Kelp** forests and **Seagrass** meadows on the sea floor (they stand in the water: you swim through them, the water's faces join round them and breaking one leaves water behind); kelp grows up towards the surface, smelts into **Dried Kelp** (a quick snack; 9 → a Dried Kelp Block, fuel for 20 items)
* **Coral reefs** in warm, shallow seas: lumps of Tube, Brain, Bubble, Fire and Horn **Coral Blocks** with corals growing on them. Underwater the view reaches further and is brighter by day (further still with Water Breathing or Night Vision)
* **Fish**: schools of **Silverfin** (and colourful **Reeffins** in warm seas) swim around you in the sea, keep together, dart away from players and flop about on land; they drop Raw Silverfin / Glimmerfin. Pods of **Dolphins** swim up to players (and alongside their boats) and leap out of the water at the surface
* **Croakers** (frogs) hop about swamps (a few in jungles and taiga) with long leaps, swim and croak; their colour follows the climate (amber in temperate lands, pearl in warm ones, moss-green in the cold), they breed with slimeballs and catch small Wobblers with their tongue, leaving an **Amber / Pearl / Moss Croaklight** (a light-15 block) behind
* Small features (`src/world/smallFeatures.js`): **desert wells** (a sandstone basin of water under a slab roof, 1 desert chunk in 150) and **fossils** (a spine, ribs and skull of **Bone Blocks** buried 15–30 blocks deep in deserts and swamps; 9 bone meal ↔ a Bone Block)
* **Lush caves** (about a tenth of the underground, `src/world/caveGen.js`): cave floors turn to **Moss Blocks** with **Moss Carpets**, grass and **(Flowering) Azaleas**, and **Cave Vines** hang from mossy ceilings, some carrying **Glow Berries** that light the cave (light 14); right-click a lit vine to pick the berries (food; plant them under a block to grow a new vine), vines grow down and grow new berries over time. Small clay-bottomed **pools** sink into the moss, home to **Gillnewts** (pink, wild brown, gold, pale cyan and a rare blue): they paddle about, hunt fish, Deepeyes and Sodden Shamblers near them, can waddle on land for a while and, when hurt, sometimes play dead and heal up
* **Smoker** (a furnace between four logs) cooks food and **Blast Furnace** (five iron, a furnace and three smooth stone) smelts ores and raw metal twice as fast, burning fuel twice as fast; both work with hoppers and in multiplayer like the furnace
* **Jukebox** (8 planks round a diamond) and eight **Music Discs** (found in dungeon chests): put a disc in to hear its own composed piece (the same every time: *Three Suns*, *Ringfall*, *Deepstone*, *Embers*, *Tidecall*, *Hollow*, *Blossom*, *Starlight*), fading out over 48 blocks; right-click again to take it out. In multiplayer everyone near the jukebox hears it
* **Blossom Grove** biome (reference: cherry grove; mild, hilly ground, about 1–2 % of the land): **Blossom trees** with a slim dark trunk splitting into leaning branches under wide pink crowns that hang petals from their rim, Blossom Logs, Planks and Saplings, pink and blue flowers, and pink petals drifting down all the time. `/locate biome blossom_grove` finds the nearest one (any biome key works). 
* Death screen, item drop on death, respawn; pause menu with settings
* Procedural sound effects with stereo panning; world saving
* Generative music: every 5–10 minutes a calm piano piece is composed on the spot (major by day, minor at night, low and sparse underground) with reverb; distant rumbles in dark caves; music volume in the pause menu
* Weather: rain spells (12 000–24 000 ticks) after clear spells (12 000–180 000), fading in/out at 0.01 per tick; rain or snow by biome (none in deserts), stopped by roofs; overcast sky, weaker sun light, grey clouds, splashes and rain sound; rain puts out burning players and mobs and undead do not catch fire in it
* Thunderstorms (their own 3 600–15 600-tick spells, only while it rains): darker sky and light, lightning bolts every ~20 s within 64 blocks that flash the sky, crack and rumble, set fire around the strike point and deal 5 damage + burning within 3 blocks; `/weather thunder`, `/summon lightning_bolt`
* Day/night cycle and hostile mobs can be switched off in the pause menu or with `/gamerule doDaylightCycle|doHostileSpawning true|false` (saved per world); at night Shamblers, Skitterers and Rattlers spawn on the surface (half the monster cap is reserved for surface packs so caves can't use it all up)
* Difficulty (pause menu or `/difficulty <peaceful|easy|normal|hard>`, saved per world, set by the host in multiplayer): Peaceful has no monsters and refills health and hunger by itself; monster damage is min(d/2 + 1, d) on Easy and ×1.5 on Hard; starving stops at 5 hearts on Easy and half a heart on Normal and kills on Hard
* Caves: winding worm tunnels that branch and open into rooms (the reference carver: clusters in about a third of the chunks, seamless across chunk borders), long tall ravines, plus the noise caves (big caverns that grow more common with depth, and spaghetti tunnels); deep tunnels may have a lava floor, a few higher ones a puddle of water, and everything below y −55 is lava. Deep underground the fog and the sky fade to black, so openings into unloaded land look like dark depths
* Ores are easier to find on cave walls (less air-exposure discarding for gold, azurite and diamonds), coal is more common underground, and a little Beryl (emerald) generates everywhere between y −32 and 48, not only in the mountains
* Ruined Rifts (ruined portals; one 192 × 192 region in three, `/locate ruin`): a broken obsidian frame, upright or toppled and sometimes half sunk, on a splash of Cinderstone and gravel with a little fire and lava, loose obsidian, sometimes a gold block, and a chest of gold gear, gilded food, flint and steel and obsidian
* Flowing water and lava look like the reference: every surface corner takes the average height of the four columns around it (sources count ten times), so fluid slopes down steps and thins out at the spreading edge, sides follow the slope and flowing surfaces use the flowing texture turned downhill; currents push players, mobs and items along the flow (and down falling water)
* A torch, lantern or any other light block held in the hand lights up the area around the player (terrain and mobs)
* Caves content (`src/world/caves.js`, `caveGen.js`): **Copper** blocks weather on random ticks (fresh → dulled → tarnished → verdigris, held back by less weathered copper nearby, as in the reference); honeycomb seals them, an axe scrapes a stage or the seal off. **Storm Rods** attract lightning within reach and the strike cleans the copper it lands on. **Violite geodes** (amethyst): rare hollow spheres of Smooth Basalt, Chalkstone and Violite with Budding Violite that grows small → medium → large buds → clusters (shards drop from clusters); **Shaded Glass** lets no light through; the **Farglass** (spyglass, 2 copper + a shard) zooms in while right-click is held. **Seepstone** spikes hang from cave ceilings and rise from floors; landing on an upward spike hurts more, and hanging ones fall when the block above goes
* Wind: grass, flowers and saplings sway at the top and leaves rustle in a breeze that rolls across the land (vertex shader), harder in rain and storms
* Shaders (on by default, toggle on the title screen or in the pause menu): the scene is drawn into a floating-point picture and finished with bloom around suns, torches, lava, lanterns and other light sources (their bright pixels glow above white), light shafts streaming from the brightest sun through leaves and clouds (the sky dome writes alpha 0 to mark open sky), a soft filmic tone curve, a little extra colour and contrast, a vignette and a ripple underwater (`src/render/postfx.js`). The frame-rate governor turns shaders off as its last step on slow machines. **F7** toggles shaders at any time, and the pause menu has a Shaders button and a **Low-lag graphics** button (shaders, sun shadows and high pixel density off, render distance at most 6)
* With shaders on, the clouds cast soft shadows that drift over the land, caustics (sunlight focused by the waves) dance over the sea floor and other blocks under water, torchlight flickers gently, sunlight glows through leaves and grass when looking towards the sun, open ground darkens and picks up a sheen of the sky in rain with little raindrop rings spreading over it, the picture warms at sunrise and sunset and cools to moonlight blue at night, and the screen edges redden when hurt or low on health
* Water surfaces reflect the sky (Fresnel: more mirror-like at grazing angles), heave gently with shaders on, ripple with travelling waves and glint where the brightest sun catches them; shadowed water stays dull
* Hoppers (5 iron + a chest; 5 slots): every 8 ticks one item goes out through the spout (down, or sideways towards the block you placed it against) into a chest, barrel, box, furnace (from above into the input, from the side into the fuel), Brewing Alembic or another hopper, and one item comes in from the container above (a furnace's output, an alembic's finished vials) or from items dropped into the bowl; a powered hopper stops; saved with the world and shared in multiplayer
* Dispensers (7 cobblestone around a bow, cinnabar dust at the bottom) and Droppers (the same without the bow): nine slots and a face that points back at you when placed (up and down too); a rising cinnabar signal fires one random item after 4 ticks. Droppers throw it out (or put it into a chest, hopper or other container in front); Dispensers shoot arrows (tipped ones too), shoot Fire Charges (blast powder + ember powder + coal, also light fires by hand) as small fireballs, pour water and lava buckets and scoop fluid up with empty ones, light fires and TNT with flint and steel, send out primed TNT, use bone meal on plants in front and put armour on a player standing in front, and drop anything else; hoppers fill and empty them; saved with the world and shared in multiplayer (reference: dispenser, dropper)
* Adventure and Spectator modes (`/gamemode adventure|spectator`, `/gm 2|3`): adventurers can use doors, chests, food, weapons and animals but cannot break or place blocks; spectators fly through blocks, cannot be hurt or seen by mobs or other players, and do not interact with anything
* Daybreak: once it is broad daylight, monsters out in the open (enough sky light, also in the shade of trees) vanish in a puff of smoke within a few seconds — Skitterers, Fizzlers, Wobblers and Hexwives too, not only the undead that burn; monsters in caves and structure guards (outpost Marauders, hut Hexwives, citadel Deepeyes) stay
* Multiplayer stays responsive: the host keeps simulating at full pace when its tab is in the background (the beat comes from a worker, which browsers don't throttle the way they slow background-tab timers to once a minute); a guest whose connection can't keep up skips entity snapshots instead of building a growing queue; snapshots only carry the entities that changed (a full list every 2 s)
* Creative mode: flight, instant breaking without drops, no damage (except the void) or hunger, unlimited blocks, item catalogue with search; hostile mobs ignore creative players
* Chat with commands (see Controls)
* Fire: flint and steel (iron ingot + flint, 64 uses) lights fires that animate, crackle and give light 15; fire ages, burns up flammable blocks (planks, logs, leaves, wool, bookshelves, plants with the reference encouragement/flammability odds), spreads through the air up to 4 blocks up, dies out without fuel and is put out by rain; lava sets fire to nearby flammable blocks; standing in fire sets you alight; punch it to put it out
* Saplings (oak, birch, spruce): leaves drop them 1 in 20; planted on grass or dirt they grow in two steps (1 in 7 per random tick in light ≥ 9; bone meal 45 %) into the same trees as world generation, if there is room; natural leaves with no log within 4 blocks decay and drop saplings/sticks/apples, placed leaves stay
* Oak boats (5 planks): placed on water, bob on the surface, accelerate to about 8 blocks/s, steer with A/D, break after three hits and drop themselves; saved with the world
* 20+ milestones (the reference game's advancements, with Saturncraft's own names) with a toast when reached and an overview in the pause menu, saved per world
* Third-person cameras (F5, behind and in front, pulled in by walls) with an animated player model holding the selected item and wearing its armour (also on other players in multiplayer)
* Animated title screen (stars, ringed giant, three suns, scrolling landscape) with splash texts
* Blocky cloud layer (12×12 cells, 4 thick, y=192, drifting 0.03 blocks/tick), coloured by the suns
* Three dimensions (see "Other dimensions" below): the overworld, **the Cinderdeep** (fiery underworld, 1:8 scale, reached through obsidian Rift portals) and **the Hollow** (void islands with the Void Wyrm boss, reached through a Hollow Gate in an underground Hollow Sanctum); each has its own chunks, saves, containers and mobs, and the save remembers which dimension you are in

* Brewing and status effects (Saturncraft names in brackets): the **Brewing Alembic** (brewing stand: 1 Ember Rod over 3 cobblestone) brews three vials at once in 400 ticks, fuelled by Ember Powder (20 brews each); **Glass Vials** (3 glass → 3) fill at any water. The reference tree: Water Vial + **Cinderroot** (nether wart; grows in four stages on Mournsand in the Cinderdeep, wild patches and bastion planters) = **Murky Elixir** (awkward; other ingredients give Bland, Glowshard Dust Thick); Murky + Sugar = Swiftness, + **Gilded Melon Slice** = Healing, + Skitterer Eye = Poison, + **Ember Cream** (slimeball + ember powder) = Fire Resistance, + **Gilded Carrot** = Night Vision, + Spinefish = Water Breathing, + Ember Powder = Strength, + **Wraith Tear** (Ashwraith drop) = Regeneration, + Slimeball = Leaping, + Feather = Slow Falling; **Fermented Skitterer Eye** corrupts (Swiftness/Leaping → Slowness, Healing/Poison → Harming, Night Vision → Invisibility, water → Weakness); Cinnabar Dust extends, Glowshard Dust strengthens (II, Slowness IV), Blast Powder makes splash elixirs. Durations and levels are the reference ones; tooltips list effect and time; vial icons are tinted with the effect colour. Drinking takes 32 ticks and gives the vial back; splash elixirs are thrown (0.5 blocks/tick, 20° up), break on impact with coloured droplets and affect everything within 4 blocks (1 − distance/4, direct hits full; instant ones scaled too; undead are hurt by Healing and healed by Harming). Gold nuggets (ingot ↔ 9), sugar (sugar cane), milk (bucket on a Mooxen; clears all effects)
* Status effects with reference stacking (stronger replaces, weaker but longer resumes later): Speed/Slowness (±20 %/15 % per level), Haste (mining +20 %/level), Strength/Weakness (+3/−4 melee), Instant Health/Damage (4/6 × 2^amp, magic damage ignores armour), Regeneration (1 HP per 50 >> amp ticks), Poison (1 HP per 25 >> amp, never below 1), Jump Boost (+0.1 jump velocity and −1 fall damage per level), Fire Resistance, Water Breathing, Night Vision (brightens the terrain and mobs, flickers in the last 10 s), Invisibility (mobs only notice you at 7 % of their range, more with armour; hides you from other players), Slow Falling, Hunger; effects also work on mobs hit by splashes. Effect badges with time left under the sky widget, an Effects panel beside the inventory, colour swirls around the player (third person), saved with the player and the host-authoritative alembic in multiplayer (splashes reach guests too); `/effect give <effect> [seconds] [level]`, `/effect clear`
* Cinnabar circuitry (`src/world/circuits.js`): power levels 0–15. **Cinnabar Dust** is laid as wire that loses one level per block, joins neighbouring wire (also one step up or down a block unless something sits on top) and is drawn as dots, lines, corners and crosses, from dark red (0) to bright red (15). Sources: **Lever** (stick + cobblestone; floor, wall or ceiling, toggles), **Stone Button** (stone; a 20-tick pulse), **Wooden Pressure Plate** (2 planks; players, mobs and items keep it down), **Cinnabar Block** (9 dust; always on). Components: **Cinnabar Torch** (dust + stick; an inverter that turns off 2 ticks after its block is powered, burns out when toggled 8 times within 3 s), **Repeater** (2 torches, dust, 3 stone; 1–4 delay steps of 2 ticks set by right-click, one-way, restores level 15 and stretches short pulses), **Cinnabar Lamp** (4 dust + Glowshard; light 15 while powered, off 4 ticks later), **Piston** (3 planks, 4 cobblestone, iron, dust; pushes up to 12 blocks, breaks plants/torches/wire in the way, cannot move obsidian, containers or extended pistons) and **Sticky Piston** (+ slimeball; pulls the block back). Pistons move blocks at once (no sliding animation) and shove entities. Power also opens doors, trapdoors and fence gates (only on changes, so hands still work), sets off TNT and rings the **Chime Block** (8 planks + dust; right-click picks one of 25 pitches). Strong/weak power follows the reference: a lever, button, plate, repeater or torch strongly powers one block, which then powers wire next to it; a block only powered by wire running into it powers components but not other wire. Wire networks are recomputed as a whole (breadth first from the strongest source) and the update queue is capped per tick, so long lines and clocks do not cause update storms. Only the single player world or the multiplayer host simulates; guests apply its block edits (their lever flips go to the host like any edit). Pending ticks are not saved, so circuit blocks re-evaluate when their chunk loads and on random ticks
* **Comparators**, **Observers** and **Daylight Sensors** (`src/world/comparators.js`, `src/world/circuits.js`). The **Comparator** (3 cinnabar torches around Ember Quartz on 3 stone) is a flat part like the repeater: it reads the power behind it and the strongest of its sides (wire, repeaters, comparators, cinnabar blocks); in compare mode it passes the rear level on while it is at least the side, in subtract mode (right-click; the front torch lights) it outputs rear − side, both 2 ticks later. With a container behind it (or behind one solid block) it reads how full it is with the reference formula, 1 + ⌊14 × Σ(count / max stack) / slots⌋ (0 when empty): chests (54 slots when doubled), barrels, Gloomshell Boxes, hoppers, furnaces, dispensers, droppers and Brewing Alembics; a composter gives its level (0–8) and a jukebox 1 + the disc's number while it plays. Comparators re-read their containers every 2 ticks. The **Observer** (6 cobblestone, 2 cinnabar dust, Ember Quartz; reference: the observer) is placed with its face looking away from you (up and down too, like pistons) and, when the block in front of its face changes (id or meta), sends a 2-tick pulse of 15 out of its back (strongly powering the block there) 2 ticks later. The **Daylight Sensor** (3 glass, 3 Ember Quartz, 3 wooden slabs) is slab-high and gives the sky light above it times the brightness of the three suns (rain dims it, no suns in the Cinderdeep or the Hollow), checked once a second; right-click inverts it (15 minus that). All three keep their state in the block meta, so they are saved and shared in multiplayer like other edits

* Hostile variants and the **Hexwife** (`src/mobs/hostileVariants.js`): the Hexwife (witch) throws splash elixirs of Slowness (target 8+ blocks away), Poison (target at 8+ HP), Weakness (25 % up close) or Harming, and drinks Water Breathing (eyes underwater), Fire Resistance (burning), Healing (hurt) or Swiftness (target over 11 blocks away) — 32 ticks during which she stands still; she lives in **swamp huts** (spruce cabins on oak stilts, `/locate hut`), where only Hexwives spawn. **Dune Shamblers** (husk) roam deserts under open sky, never burn and cause Hunger; **Rime Rattlers** (stray) shoot Slowness arrows on snowy plains; a Shambler that keeps its head underwater for 30 s shakes for 15 s and becomes a **Sodden Shambler** (drowned; Dune Shamblers become Shamblers the same way), which also spawn in deep ocean water at night and swim after their prey. 5 % of all Shambler-kin are **babies**: half size, 50 % faster, never grow up, 12 XP. Undead mobs no longer drown. All synced to guests like other mobs

**Not yet implemented**

* Lingering elixirs, Turtle Master / Decay / Luck elixirs, beacons (Haste only comes from `/effect`), Wither effect; Mining Fatigue's slower attack speed and the Elder Deepeye's ghost face; prismarine-style slabs/stairs/walls and the animated tidestone texture; effect particles of other players in multiplayer
* Taming of animals other than Howlers, Purrlings, Squawklets and Gallopers
* Large structures beyond villages, temples, wrecks, Tide Citadels, outposts, ruined rifts, dungeons, sanctums, bastions and Hollow Cities; job-site blocks
* Dyed Gloomshell Boxes; comparators reading cakes, lecterns, item frames and other non-container blocks; target blocks and vibration sensors
* Mob equipment (held weapons and armour, apart from the Sodden Shambler's Tidespear), baby mobs other than Shambler-kin and passive animals, Shambler jockeys, tipped-arrow drops, swamp hut cats
* Crawling pose; firework stars (Sky Rockets always burst in one random colour and never hurt)

## Other dimensions

### The Cinderdeep (fiery underworld)

* **Getting there:** build an obsidian frame (interior 2–21 wide, 3–21 tall, corners optional; the smallest is 4×5 outside) standing in the x or z plane and light its inside with flint and steel: it fills with violet **Rift** blocks. Stand in the Rift for 4 s (instantly in creative). One block in the Cinderdeep is 8 in the overworld; on arrival the nearest Rift within 16 blocks (Cinderdeep) / 128 blocks (overworld, loaded chunks) is used, otherwise a new 4×5 portal is built on a suitable floor near the target (or on an obsidian ledge carved into the rock). Portals you travel through are linked, so going back returns you to the portal you came from. Breaking the frame collapses the Rift.
* **World:** caverns between a bedrock floor (y 0–4) and ceiling (y 123–127), a lava sea up to y 31, soft red **Cinderstone**, **Mournsand** (slows you to 40 %) and gravel shores, **Glowshard** clusters hanging from the ceilings (light 15, drop Glowshard Dust; 4 dust = 1 block), **Emberquartz Ore** (Ember Quartz), ever-burning fires (fire on Cinderstone never goes out) and **Ember Bastions**: 97-block bridges of **Scorched Bricks** on pillars with a central hub holding an Ember Lord spawner and a loot chest (`/locate bastion`).
* **Rules:** red-orange haze instead of sky, no suns, no weather; water boils away when poured, ice does not melt into water; beds explode (power 5, with fire) when used — in the Hollow too.
* **Mobs:** **Ashwraith** (huge drifting shroud with trailing tendrils; spits exploding fireballs at players it sees within 64 blocks; drops blast powder), **Cinder Brute** (fire-immune melee brawler, 24 HP; gold ingots), **Ember Lord** (hovering, fire-immune, fires volleys of three small fireballs; drops **Ember Rods**, more of them around bastions). All have original box models.

### The Hollow (void dimension)

* **Getting there:** craft an **Eye of the Void** (Void Pearl from Voidwalkers + Ember Powder; 1 Ember Rod = 2 powder). Right-click into the air to throw one: it flies ~12 blocks towards the nearest **Hollow Sanctum** (one per 640×640 region, 75 %; buried at y 10–31; `/locate sanctum`) and usually drops back (1 in 5 shatters). The sanctum is a stone-brick vault with a corridor, a Skitterer spawner, bookshelves, a loot chest and a ring of 12 **Hollow Frames** on a dais over lava (each frame has a 10 % chance to hold an eye already). Right-click every frame with an eye: the 3×3 centre turns into a starry **Hollow Gate**; fall in.
* **World:** a central island of pale **Hollowstone** (~100 blocks radius) floating in a black-violet starry void, outer islands beyond 800 blocks, ten obsidian pillars around the centre each crowned with a **Mending Crystal**, and the bedrock exit fountain in the middle. You arrive on a 5×5 obsidian platform at x 100. Many Voidwalkers.
* **The Void Wyrm:** a flying boss (200 HP, boss bar) that circles the pillars, swoops at the player (10 damage from its head, 5 from its body, plus a fling) and pulls up again; crystals within 48 blocks heal it (2 HP/s, shown as a beam) until they are shot or hit (they explode). Killing it opens the exit gate in the fountain, drops 12 000 XP and a **Wyrm Egg**, and unlocks the *Wyrmslayer* milestone. The exit gate takes you to your overworld spawn point (bed or world spawn).
* **The Far Gate** (reference: the void-island gateway): once the Wyrm is dead a small gate of two starry **Far Gate** blocks between bedrock opens on the main island's rim (80 blocks out, in a direction fixed by the seed; `/locate gate`). Walk into it to be thrown ~1000 blocks out to an outer island, where a matching gate leads back. The void between the main island and the outer islands is empty out to 800 blocks.
* **Outer islands** (one at most per 112×112 cell beyond 800 blocks, radius 8–27) carry **Hushvine** and, on the larger ones (60 % of islands of radius ≥ 15), **Hollow Cities** (`/locate city`).
* **Hollow Cities** (reference: the void-island cities; `src/world/dimensions/hollowCity.js`), planned from the seed and the island alone so every chunk stamps its share: a house of **Hollowbrick** (violet bricks; also **Hollowbrick Pillar**, **Slab** and **Stairs**) on a **Hollowstone Bricks** footing, a 12–19 block tower out of its roof with a ladder inside, a wide top room with two loot chests and **Wisp Rods** (light 14; reference: the light rods) on the roof; often (70 %) a railed bridge to a second tower with its own chest; sometimes (50 %) a **ship** moored at roof height (walkway from the roof) with a purple sail, a **Wyrm Head** trophy on the bow and two chests in the hold, one always holding a **Voidwing**. City chests roll 2–6 stacks of the reference table: diamonds (2–7), iron (4–8), gold (2–7), beryl, beetroot seeds, saddles, Drift Membranes, Sky Rockets and diamond/iron gear enchanted at level 20–39.
* **Gloomshells** (reference: shulkers; `src/mobs/gloomshell.js`) spawn inside cities (up to 6 per city). A violet box (30 HP) that peeks now and then and, closed, counts as 20 armour; with a player in sight within 16 blocks it opens and every 1–5.5 s fires a slow homing **Drift Spark** (4 damage + **Levitation** for 10 s). Below half health it may blink away. Drops a **Gloomshell Husk** (50 %).
* **Levitation** (status effect): instead of gravity the vertical speed eases towards 0.05 × level blocks/tick (≈ 0.9 blocks/s at level I); falling after it ends hurts as usual. `/effect give levitation 10`.
* **Gloomshell Box** (2 husks above and below a chest; reference: shulker box): a 27-slot container that keeps its contents when broken: the dropped box item carries them (`stack.contents`, kept in saves, on the network and when picked up), its tooltip lists what is inside, and placing it unpacks them. Boxes do not fit in boxes. Host-authoritative in multiplayer like chests (a guest placing a full box sends its contents to the host).
* **Voidwing** (reference: elytra): worn in the chest slot (two membrane wings on the player model). Press jump in mid-air to glide with the reference flight step: gravity is cancelled in proportion to cos²(pitch), descending turns height into speed, pulling up turns speed into height, the path swings towards the view and drag is 0.99/0.98/0.99 — a level glide covers about 8 blocks per block of height. Flying into a wall hurts (10 × speed lost − 3). It wears 1 use per second of flight (432 uses) and stops working at 1 use left; mend it with **Drift Membrane** (a quarter per membrane) or another Voidwing at the anvil.
* **Sky Rockets** (paper + blast powder → 3; reference: firework rockets): used while gliding they push you towards 1.5 blocks/tick along the view for 20–31 ticks; used on a block they shoot up and burst into a ball of coloured sparks.
* **Hushvine** (reference: chorus plant; `src/world/dimensions/hushvine.js`): knotty stalks branching up to four levels from Hollowstone, with **Hushvine Flowers** at the tips; planted flowers grow, branch and wither on random ticks; breaking a stalk brings down what it holds. Stalks drop **Hushfruit** (0–1): always edible (4 hunger), it teleports you to a random standing spot within 8 blocks. Smelted it pops (**Popped Hushfruit**); 4 popped fruit → 4 Hollowbrick; an Ember Rod over a popped fruit → 4 Wisp Rods.
* Milestones: *Tear in the World*, *Into the Cinderdeep*, *Ember Hunter*, *Eye in the Dark*, *The Hollow*, *Wyrmslayer*, *Beyond the Rim*, *The City at the Edge*, *Lighter than Air*, *Wings of the Void*.

### Testing

`/dimension <overworld|cinderdeep|hollow>` travels at once (to a safe spot; into the Hollow on the arrival platform). Dying away from the overworld respawns you at home.

`/locate city` and `/locate gate` find Hollow Cities and the Far Gate in the Hollow.

Code: `src/world/dimensions/` (registry and scaling, generators, portal logic, sanctums, Hollow Cities, Hushvine, the outer islands' textures, the game-side `DimensionManager`), `src/sky/dimensionSky.js`, `src/mobs/dimensionMobs.js`, `src/mobs/voidWyrm.js`, `src/mobs/gloomshell.js`, `src/player/glider.js`, `src/entities/fireball.js`, `src/entities/voidEye.js`, `src/entities/skyRocket.js`. Tests: `tests/hollow_outer.test.js` (Far Gate, island layout, city plans and loot, Levitation, glider physics and a full glide, Gloomshell Boxes, Hushvine).

## Deliberate deviations

* **Original names and art** for every mob, item and block that is
  distinctive to the reference game (e.g. Deepstone, Cinnabar, Azurite, Beryl,
  Workbench, Blast Powder, Void Pearl). The zombie villager's spawn weight is
  merged into the Shambler (default 95 + 5, desert 19 + 1). There are no
  river biomes, so Sodden Shamblers only spawn in oceans (and from conversions);
  swamp huts are tried at several spots of each 320-block region so they
  appear more often than the reference's sparse grid would in this world's small swamps.
* **Three suns instead of one sun + moon**: day/night is irregular. Sky
  darkening is derived from the combined light of the suns (see above) instead
  of the fixed 24 000-tick cycle; there are no moon phases (the gas giant
  shows phases instead) and no sleeping.
* **Hostile mobs can spawn under twilight skies only if the combined light is
  low enough**; with only the dim suns up, the surface stays at light 9–10,
  which is too bright for spawning but not "day" for burning — a state that has
  no vanilla equivalent.
* **Rare Shambler drop**: vanilla picks one of iron ingot / carrot / potato; only
  the ingot exists here, so it drops with 2.5 % × 1/3.
* **Dyes**: black dye comes from coal (the reference uses ink sacs) and brown dye is mixed from red + green (the reference uses cocoa beans), since neither source exists here; lambs take one parent's colour instead of blending.
* **Lighting**: sky light is stored per block and darkened in the shader by the
  combined sun light; the light curve blends vanilla's brightness formula with
  its default gamma. Fog is spherical. Leaves cast full shadows only where
  their texture is opaque. Sun shadows only come from terrain up to 140 blocks
  sunward of the player, so very long twilight shadows of distant hills end
  there.
* **Mob AI** is a simplified goal system (no goal priority selectors; a
  bounded A* of 250 nodes; panicking animals steer directly). Mobs do not seek
  shade from the suns, and there are no doors, wolves or cats to react to.
* **Water physics**: no bubble columns.
* **Explosions** do not set fire and do not knock items back.
* **The Hollow's late game**: there is a single Far Gate (the reference opens a new gateway per boss kill, up to 20) and it stands on the island's rim instead of floating at y 75; its far end is generated with the island rather than built on first use. Gloomshells spawn naturally inside a city's bounds (up to 6) instead of being placed with it, they sit on floors only, and Drift Sparks cannot be shot down. The ship's Voidwing lies in a chest rather than an item frame. Hollow Cities are a fixed house-tower-bridge-ship layout rather than the reference's random piece grammar.
* **Furnace** state is stored by block position rather than as a block entity;
  breaking a furnace drops its contents.
* **Render/entity distance**: entities render up to 64 blocks away and only
  cast shadows within 24 blocks; three shadow maps update round-robin.
* **Dropped items**: blocks drop as small turning 3-D cubes (two or three for stacks); other items drop as sprites rather than extruded 3-D models.
* **Step-up** (0.6 blocks) is implemented, but without slabs or stairs in the
  block set it rarely comes into play; full blocks always need a jump.
* **Saving** keeps modified chunks, the player, time, furnaces and animals;
  hostile mobs, dropped items and in-flight fluids are not saved.

## Performance

* Target: stable 60 fps at render distance 8 on a mid-range laptop GPU.
* Terrain at render distance 8 is ~1.9 M triangles in total. **Occlusion
  culling** (`src/world/visibility.js`) brings what is drawn down to ~0.3 M from
  the surface and a few thousand inside a sealed cave: every 16³ section records
  which of its faces connect through non-opaque blocks, and a flood fill from the
  camera (which never turns back against a direction it took) trims each
  chunk's draw range and bounding sphere to the sections it reached. A/B renders
  with and without culling are pixel-identical.
* Solid blocks, alpha-tested blocks (leaves, plants, glass, torches) and water
  are three separate meshes per chunk, so the solid pass has no `discard` and
  the GPU can reject hidden fragments before shading them.
* Generation (~15 ms/chunk) and meshing (~1.5 ms/section) run in a worker pool
  (`hardwareConcurrency − 1`, 2–6 workers); main-thread chunk work is budgeted to
  ~6 ms per frame; the simulation tick costs ~0.1–1 ms.
* Shadows: three 1024² maps over a ±44-block area. The brightest sun's map is
  redrawn every 3rd frame and the others every 6th (the suns move ~0.3°/s;
  all three are redrawn right after a block edit). The shadow pass only draws
  sections that contain sky light and lie inside the light's frustum, which
  reaches 140 blocks sunward. The 17-tap shadow lookup is skipped for suns
  below the horizon, faces turned away from a sun, and surfaces without sky
  light (sunlight is scaled by sky light, so none of these change the image).
* The sky dome, rings and ice particles are drawn after the terrain with depth
  testing, so the gas-giant shader only runs on pixels where sky is visible.
* Turn shadows off in the pause menu on weak GPUs; lower the render distance
  for integrated graphics.
* Pixel ratio is capped at 1.25 (`pixelRatioCap` in the settings).

## Tests

`npm test` runs 132 unit tests:

* **physics** — constants, walk/sprint/sneak speeds, jump apex and duration,
  sprint-jump, terminal velocity, fall damage, collision, step-up, ledge
  sneaking, swimming
* **suns** — distinct periods/phases/azimuths, periodicity, rise points,
  daylight fractions, day/twilight/night classification, combined light and
  darkening, colour blending
* **spawning** — table weights and weighted picks, group sizes, caps, spawn and
  despawn radii, monster/animal light tests (Monte-Carlo vs analytic),
  three-sun night/day spawning, sunlight burning probability
* **drops** — mob drop ranges and distributions, player-kill conditions,
  cooked meat, block drops by tool tier, ore count ranges, flint chance
* **visibility** — section face connectivity (air, rock, tunnels, sealed
  pockets, see-through leaves), cut-out mesh layer, camera flood fill
* **mining / survival / crafting / world** — break times against the
  documented table, tool stats, hunger/regeneration/starvation, recipes and
  smelting, deterministic generation, bedrock/water/ore placement, canopy
  continuity across chunk borders, lighting and cross-chunk light, water and
  lava spread distances, infinite sources, obsidian, falling sand, explosion
  damage, save encoding
* **enchanting** — table level costs (reference formula, bookshelf ring and
  cap), enchantability and weighted selection, exclusive enchantments, offers,
  Swiftdig/Keen/Hallowed/Steadfast/Bounty/Gentle Hand/Bulwark/Strongdraw/Plunder
  effects, stack merging and network round trips, anvil repair/book costs
* **monuments** — Tide Citadel determinism, reference spacing/separation, deep-ocean
  placement, symmetry, 8 gold blocks, seamless chunk stamping, coordinate
  rotations, sponge absorption (reach 7, max 65), recipes, Mining Fatigue
  factors, elder curse renewal, beam range and Deepeye drops

## Build history (vertical slices)

1. **Playable slice** — worker terrain generation, lighting and meshing,
   vanilla physics, mining/placing, the three-sun sky with shadows and the
   ringed gas giant.
2. **Mobs** — models, AI, pathfinding, spawning rules, drops, combat, explosions.
3. **Remaining mechanics** — hunger and damage sources, inventory, crafting,
   furnace, fluids and gravity blocks, audio, saving, tests and polish.
