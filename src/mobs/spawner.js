// Natural mob spawning around the player, chunk-generation animal herds,
// passive-mob persistence across chunk unloads and mob caps.
import { villagesNear, houseHome, houseJobSite } from '../world/villages.js';
import { makeTrades } from './trades.js';
import { Mob, HUT_CAT_COAT } from './mob.js';
import { MOBS, CATEGORY } from './mobTypes.js';
import {
  spawnTable, weightedPick, scaledCap, isDarkEnoughToSpawn, isBrightEnoughForAnimal, isSlimeChunk,
  SPAWN_MIN_DIST, DESPAWN_FAR, CREATURE_SPAWN_INTERVAL, CHUNK_GEN_CREATURE_CHANCE,
} from './spawnRules.js';
import { B, SOLID, OPAQUE, isFluid } from '../world/blocks.js';
import { LEAVES } from '../world/trees.js';
import { MIN_Y } from '../world/constants.js';
import { chunkKey } from '../world/world.js';
import { attemptDimensionSpawn } from './dimensionMobs.js';
import { BIOMES } from '../world/biomes.js';
import { outpostsNear } from '../world/temples.js';
import { hutsNear, hutAt } from '../world/swampHuts.js';
import { igloosNear, basementLayout } from '../world/igloos.js';
import { sunkenRuinsNear, sunkenGuardSpots } from '../world/sunkenRuins.js';
import { sunTombsNear, tombGuardSpots } from '../world/sunTombs.js';
import { skywatchesNear, skywatchGuards } from '../world/skywatch.js';
import { HUT_MONSTERS, isNewtPoolFloor } from './spawnRules.js';
import { soddenSpawnChance } from './hostileVariants.js';
import { babyHealth } from './babies.js';
import { SEA_LEVEL } from '../world/constants.js';
import { tickMonumentSpawns, spawnElders } from './oceanMobs.js';
import { spawnVillageStrider, desertChunkSpawn } from './duneStrider.js';
import { CAGE, forestChunkSpawn, hollowSpawnTick } from './hoverling.js';
import { addPumpkinHead } from './pumpkins.js';
import { rollOffhand, OFFHAND_KINDS } from './offhand.js';
import { EQUIP_KINDS, spawnGear, rollCanPickUp, localDifficulty, clampedDifficulty, jockeyRoll } from './equipment.js';

const INHABITED_MAX = 3600000; // the local difficulty stops growing after 50 hours

const NO_MONSTER_FLOOR = new Set([B.BEDROCK, B.GLASS, ...LEAVES, B.ICE, B.CACTUS]);
const MAX_PER_CHUNK = 4;
// Chunk sweeps that keep finding nothing (every attempt of a daylight surface pass fails the light test)
// back off: after BACKOFF_AFTER fruitless sweeps only every BACKOFF_STRIDE-th chunk is tried per tick,
// each chunk therefore once every BACKOFF_STRIDE ticks. One success returns the pass to full speed,
// so the spawn rate while anything can spawn is the same as before.
export const BACKOFF_AFTER = 40;
export const BACKOFF_STRIDE = 4;
const CHUNK_LIST_REFRESH = 20; // ticks

export class MobSpawner {
  constructor(game) {
    this.game = game;
    this.savedMobs = new Map();
    this.generated = new Set();
    this.inhabited = new Map(); // chunk key -> ticks a player spent nearby (local difficulty)
    this.enabled = true;
    this.sweeps = 0; // number of monster sweeps made (rotates the throttled slices)
    this.pass = { monster: { idle: 0 }, surface: { idle: 0 } };
    this._near = null; // cached list of loaded chunks around the player
  }

  /** Loaded chunks within `R` of chunk (pcx, pcz); rebuilt when the player or the loaded set changes, else every second. */
  nearbyChunks(pcx, pcz, R) {
    const g = this.game, w = g.world;
    const size = w.chunks ? w.chunks.size : -1;
    const c = this._near;
    if (c && c.pcx === pcx && c.pcz === pcz && c.R === R && c.size === size && c.dim === w.dimension && g.ticks - c.tick < CHUNK_LIST_REFRESH && g.ticks >= c.tick) return c.list;
    const list = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (w.isChunkLoaded(pcx + dx, pcz + dz)) list.push([pcx + dx, pcz + dz]);
    this._near = { pcx, pcz, R, size, dim: w.dimension, tick: g.ticks, list };
    return list;
  }

  /** One spawn sweep over the chunks; throttled to a rotating slice while `state` has been fruitless for a while. */
  sweep(state, chunks, category, surface) {
    const stride = state.idle >= BACKOFF_AFTER ? BACKOFF_STRIDE : 1;
    let n = 0;
    for (let i = stride === 1 ? 0 : (this.sweeps + (surface ? 1 : 0)) % stride; i < chunks.length; i += stride) n += this.attempt(chunks[i][0], chunks[i][1], category, surface);
    state.idle = n ? 0 : state.idle + 1;
    return n;
  }

  /** Hostile mobs can be switched off in the settings (/gamerule doHostileSpawning). */
  hostileEnabled() {
    const s = this.game.settings;
    return !s || (s.hostileMobs !== false && s.difficulty !== 'peaceful');
  }

  counts() {
    let m = 0, c = 0;
    for (const e of this.game.entities.list) if (e.kind === 'mob' && !e.dead) { if (e.def.category === CATEGORY.MONSTER) m++; else c++; }
    return `hostile ${m}  passive ${c}`;
  }

  /** Spawn a mob; `fresh: false` (loading a saved mob, a conversion) skips the baby, gear and jockey rolls. */
  spawnMob(type, x, y, z, { fresh = true } = {}) {
    const m = new Mob(type, x, y, z);
    m._game = this.game;
    if (fresh && m.def.babyChance && Math.random() < m.def.babyChance) { m.setBaby(true); if (m.def.babyStats) m.health = babyHealth(m.def); } // 5 % of Shamblers are babies (for good); so are some spiderlings, Fizzlets and Brute cubs
    if (m.def.onSpawn) m.def.onSpawn(m);
    if (fresh && EQUIP_KINDS[type]) {
      // armour and weapons, likelier the longer the world has run and players have stayed here (mobs/equipment.js)
      const clamped = clampedDifficulty(this.localDifficulty(x, z));
      m.equip = addPumpkinHead(spawnGear(type, clamped, this.game.difficulty)); // armour, weapons and, rarely, enchantments; now and then a pumpkin on the head (mobs/pumpkins.js)
      m.canPickUp = rollCanPickUp(clamped);
    }
    if (fresh && OFFHAND_KINDS[type]) m.offhand = rollOffhand(type, clampedDifficulty(this.localDifficulty(x, z)), { tamed: m.tamed }); // a shield, a charm or loot in the off-hand (mobs/offhand.js)
    this.game.entities.add(m);
    if (fresh && m.age < 0 && m.def.shamblerKin && !m.def.aquaticSpawn) this.tryJockey(m);
    return m;
  }

  /** Regional difficulty at (x, z): the game's difficulty, the world's age and the chunk's inhabited time. */
  localDifficulty(x, z) {
    const g = this.game;
    return localDifficulty({ difficulty: g.difficulty, worldTicks: g.time || 0, inhabitedTicks: this.inhabited.get(chunkKey(Math.floor(x) >> 4, Math.floor(z) >> 4)) || 0 });
  }

  /** Chicken jockeys: a fresh baby Shambler may climb on a free Cluckling nearby, or bring its own. */
  tryJockey(m) {
    const free = this.game.entities.list.find((e) => e.kind === 'mob' && e.type === 'cluckling' && !e.dead && e.deathTime === 0 && !e.passenger && e.age >= 0 &&
      Math.abs(e.x - m.x) <= 5 && Math.abs(e.y - m.y) <= 3 && Math.abs(e.z - m.z) <= 5);
    const r = jockeyRoll(!!free);
    if (r === 'existing') m.mountOn(free);
    else if (r === 'new') { const c = this.spawnMob('cluckling', m.x, m.y, m.z); c.yaw = m.yaw; m.mountOn(c); }
  }

  /** Inhabited time (reference): every chunk within 4 of the player counts the ticks spent near it. */
  tickInhabited() {
    const g = this.game, p = g.player;
    if (g.ticks % 20 !== 0 || !p || (g.world.dimension && g.world.dimension !== 'overworld')) return;
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const k = chunkKey(pcx + dx, pcz + dz);
      this.inhabited.set(k, Math.min(INHABITED_MAX, (this.inhabited.get(k) || 0) + 20));
    }
  }

  /** Can a mob of `type` stand at block (x,y,z)? */
  canFit(type, x, y, z) {
    const w = this.game.world, d = MOBS[type];
    const hw = d.width / 2;
    const cx = x + 0.5, cz = z + 0.5;
    for (let bx = Math.floor(cx - hw); bx <= Math.floor(cx + hw - 1e-6); bx++)
      for (let bz = Math.floor(cz - hw); bz <= Math.floor(cz + hw - 1e-6); bz++)
        for (let by = y; by < y + Math.ceil(d.height); by++) {
          const id = w.getBlock(bx, by, bz);
          if (SOLID[id] || isFluid(id)) return false;
        }
    return true;
  }

  validSpawn(category, type, x, y, z) {
    const w = this.game.world;
    if (MOBS[type].aquaticSpawn) {
      // Sodden Shamblers spawn in the water itself (deep ocean water, 1 attempt in 40)
      if (w.getBlock(x, y, z) !== B.WATER || w.getBlock(x, y + 1, z) !== B.WATER) return false;
      const biome = BIOMES[w.biomeAt(x, z)];
      if (!soddenSpawnChance(biome ? biome.key : '', y, SEA_LEVEL)) return false;
      return isDarkEnoughToSpawn(w.skyLight(x, y, z), w.blockLight(x, y, z), this.game.sky.state.skyDarken);
    }
    const below = w.getBlock(x, y - 1, z);
    if (!SOLID[below] || !OPAQUE[below] && below !== B.ICE) return false;
    if (!this.canFit(type, x, y, z)) return false;
    const raw = w.skyLight(x, y, z), blk = w.blockLight(x, y, z);
    if (category === CATEGORY.MONSTER) {
      if (NO_MONSTER_FLOOR.has(below)) return false;
      // Dune Shamblers and Rime Rattlers need open sky above them
      if (MOBS[type].needsSky && (raw < 15 || w.heightAt(x, z) >= y)) return false;
      if (type === 'wobbler') {
        // swamp surface at night, or anywhere below y 40 in one chunk out of ten (fixed per world)
        const swamp = BIOMES[w.biomeAt(x, z)] && BIOMES[w.biomeAt(x, z)].key === 'swamp' && y > 50 && y < 70;
        if (!swamp && !(y < 40 && isSlimeChunk(w.seed, x >> 4, z >> 4))) return false;
        if (!swamp) return true; // slime chunks ignore light, as in the reference game
      }
      return isDarkEnoughToSpawn(raw, blk, this.game.sky.state.skyDarken);
    }
    return (below === B.GRASS || below === B.MYCELIUM || below === B.MUD) && isBrightEnoughForAnimal(raw, blk); // (Croakers on mangrove mud)
  }

  /** One spawn attempt in a chunk; `surface` starts the pack on top of the terrain instead of a random height. */
  attempt(cx, cz, category, surface = false) {
    const g = this.game, w = g.world, p = g.player;
    if (w.dimension && w.dimension !== 'overworld') return attemptDimensionSpawn(this, cx, cz, category);
    const x0 = cx * 16 + Math.floor(Math.random() * 16), z0 = cz * 16 + Math.floor(Math.random() * 16);
    const top = w.heightAt(x0, z0);
    const y = surface ? top + 1 : MIN_Y + Math.floor(Math.random() * (top + 2 - MIN_Y));
    if (SOLID[w.getBlock(x0, y, z0)]) return 0;
    const biome = w.biomeAt(x0, z0);
    // inside a swamp hut only Hexwives spawn
    const table = category === CATEGORY.MONSTER && w.gen && hutAt(w.gen, x0, y, z0) ? HUT_MONSTERS : spawnTable(category, biome);
    if (!table.length) return 0;
    let count = 0;
    for (let group = 0; group < 3; group++) {
      let x = x0, z = z0, entry = null, groupSize = 0, inGroup = 0;
      const tries = Math.ceil(Math.random() * 4);
      for (let l = 0; l < tries; l++) {
        x += Math.floor(Math.random() * 6) - Math.floor(Math.random() * 6);
        z += Math.floor(Math.random() * 6) - Math.floor(Math.random() * 6);
        const dx = x + 0.5 - p.x, dy = y - p.y, dz = z + 0.5 - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < SPAWN_MIN_DIST * SPAWN_MIN_DIST || d2 > DESPAWN_FAR * DESPAWN_FAR) continue;
        if (!w.isLoaded(x, z)) continue;
        if (!entry) {
          entry = weightedPick(table);
          if (!entry) return count;
          groupSize = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
        }
        if (!this.validSpawn(category, entry.type, x, y, z)) continue;
        const m = this.spawnMob(entry.type, x + 0.5, y, z + 0.5);
        m.yaw = Math.random() * Math.PI * 2;
        count++;
        if (count >= MAX_PER_CHUNK) return count;
        if (++inGroup >= groupSize) break;
      }
    }
    return count;
  }

  tick() {
    const g = this.game, w = g.world, p = g.player;
    if (!p.dead) this.tickInhabited();
    if (!this.enabled || p.dead) return;
    const R = Math.min(8, g.chunks.renderDistance);
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    const chunks = this.nearbyChunks(pcx, pcz, R);
    let monsters = 0, creatures = 0, surface = 0, ambient = 0, fish = 0;
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.def.fish) { if (!e.def.newt) fish++; continue; }
      if (e.def.category === CATEGORY.AMBIENT) { ambient++; continue; }
      if (e.def.category !== CATEGORY.MONSTER) { creatures++; continue; }
      monsters++;
      if (e.y >= w.heightAt(Math.floor(e.x), Math.floor(e.z)) - 1) surface++;
    }
    const cap = scaledCap(CATEGORY.MONSTER, chunks.length);
    // schools of fish in the sea around the player (Reeffins in warm water), at most 24
    if (g.ticks % 40 === 0 && fish < 24 && w.dimension === 'overworld') {
      const a = Math.random() * Math.PI * 2, r = 16 + Math.random() * 24;
      const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
      if (w.isLoaded(x, z)) {
        // rivers are only a few blocks deep: small schools of Silverfins just under the surface
        const river = BIOMES[w.biomeAt(x, z)]?.key === 'river';
        const y = SEA_LEVEL - 2 - Math.floor(Math.random() * (river ? 2 : 6));
        if (w.getBlock(x, y, z) === B.WATER && w.getBlock(x, y + 1, z) === B.WATER && w.getBlock(x, y - 1, z) === B.WATER) {
          const warm = w.gen && w.gen.column ? w.gen.column(x, z).temp > 0.95 : false;
          const type = river ? 'silverfin' : Math.random() < 0.12 ? 'dolphin' : warm && Math.random() < 0.7 ? 'reeffin' : 'silverfin';
          for (let i = 0, n = type === 'dolphin' ? 2 + Math.floor(Math.random() * 2) : 3 + Math.floor(Math.random() * 4); i < n; i++) this.spawnMob(type, x + 0.5 + (Math.random() - 0.5) * 2, y, z + 0.5 + (Math.random() - 0.5) * 2);
        }
      }
    }
    // Gillnewts in the clay-bottomed pools of lush caves, and in the shallow mud-bottomed water of
    // mangrove swamps; at most 6 around the player
    const mangrove = w.dimension === 'overworld' && p.y >= SEA_LEVEL - 10 && BIOMES[w.biomeAt(Math.floor(p.x), Math.floor(p.z))]?.key === 'mangrove_swamp';
    if (g.ticks % 40 === 20 && w.dimension === 'overworld' && (p.y < SEA_LEVEL - 10 || mangrove)) {
      let newts = 0;
      for (const e of g.entities.list) if (e.type === 'gillnewt' && !e.dead) newts++;
      if (newts < 6) {
        const x = Math.floor(p.x + (Math.random() - 0.5) * 40), z = Math.floor(p.z + (Math.random() - 0.5) * 40);
        if (w.isLoaded(x, z) && Math.hypot(x - p.x, z - p.z) > 6) {
          for (let y = Math.floor(p.y) - 10; y <= Math.floor(p.y) + 10; y++) {
            if (w.getBlock(x, y, z) === B.WATER && isNewtPoolFloor(w.getBlock(x, y - 1, z), mangrove) && w.getBlock(x, y + 1, z) !== B.WATER) {
              for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) this.spawnMob('gillnewt', x + 0.5, y + 0.05, z + 0.5);
              break;
            }
          }
        }
      }
    }
    // Flitters (bats) in dark caves near the player, at most 15 (reference ambient cap)
    if (g.ticks % 20 === 0 && ambient < 15 && w.dimension !== 'cinderdeep' && w.dimension !== 'hollow') {
      const x = Math.floor(p.x + (Math.random() - 0.5) * 48), z = Math.floor(p.z + (Math.random() - 0.5) * 48);
      const y = Math.floor(Math.min(62, p.y + (Math.random() - 0.5) * 32));
      if (w.isLoaded(x, z) && !w.getBlock(x, y, z) && !w.getBlock(x, y - 1, z) && Math.hypot(x - p.x, z - p.z) > 12 && Math.max(w.skyLight(x, y, z), w.blockLight(x, y, z)) <= 3) this.spawnMob('flitter', x + 0.5, y - 0.5, z + 0.5);
    }
    if (this.hostileEnabled()) {
      if (monsters < cap) {
        monsters += this.sweep(this.pass.monster, chunks, CATEGORY.MONSTER, false);
      }
      monsters += tickMonumentSpawns(this, monsters, cap); // Deepeyes in Tide Citadels
      // Monsters in caves fill the cap quickly in this deep world, which would leave the
      // surface empty at night. Half the cap is reserved for packs on the open surface;
      // in daylight the light test rejects these attempts. (The Cinderdeep and the Hollow have
      // no open surface to count: under the Cinderdeep's roof no monster ever counted as
      // "on the surface", so this pass used to spawn without limit there.)
      const overworld = !w.dimension || w.dimension === 'overworld';
      if (overworld && surface < Math.ceil(cap / 2) && monsters < cap * 2) {
        surface += this.sweep(this.pass.surface, chunks, CATEGORY.MONSTER, true);
      }
      this.sweeps++;
    }
    hollowSpawnTick(this); // Hoverlings drifting through Hollow Cities
    if (g.ticks % CREATURE_SPAWN_INTERVAL === 0 && creatures < scaledCap(CATEGORY.CREATURE, chunks.length)) {
      for (const [cx, cz] of chunks) creatures += this.attempt(cx, cz, CATEGORY.CREATURE);
    }
  }

  onChunkLoaded(cx, cz) {
    const k = chunkKey(cx, cz);
    const saved = this.savedMobs.get(k);
    if (saved) {
      for (const s of saved) this.spawnMob(s.type, s.x, s.y, s.z, { fresh: false }).loadData(s);
      this.savedMobs.delete(k);
    }
    if (this.generated.has(k)) return;
    this.generated.add(k);
    if (this.game.world.dimension && this.game.world.dimension !== 'overworld') return; // no villages or herds in the Cinderdeep / Hollow
    // settlers of village houses in this chunk
    for (const v of villagesNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      for (const p of v.pieces) {
        if (p.type !== 'house') continue;
        const h = houseHome(p);
        if (Math.floor(h.x / 16) !== cx || Math.floor(h.z / 16) !== cz) continue;
        const m = this.spawnMob('settler', h.x, h.y, h.z);
        m.profession = p.profession; m.home = h; m.trades = makeTrades(p.profession); m.lastRestock = this.game.time;
        m.jobSite = houseJobSite(p); // bound to the job-site block built beside the door (mobs/jobSites.js)
      }
    }
    // Marauders guard their outposts
    for (const o of outpostsNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      if (Math.floor(o.cx / 16) !== cx || Math.floor(o.cz / 16) !== cz || !this.hostileEnabled()) continue;
      for (const [dx, dy, dz] of [[0, 13, 0], [-2, 13, 2], [5, 0, 5], [-5, 0, 4], [6, 0, -5]]) {
        const m = this.spawnMob('marauder', o.cx + dx + 0.5, dy ? o.y + dy : this.game.world.heightAt(o.cx + dx, o.cz + dz) + 1, o.cz + dz + 0.5);
        if (m) m.persistent = true;
      }
    }
    // a Hoverling waits in the cage beside each outpost (world/temples.js)
    for (const o of outpostsNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      if (Math.floor((o.cx + CAGE.dx) / 16) !== cx || Math.floor((o.cz + CAGE.dz) / 16) !== cz) continue;
      const m = this.spawnMob('hoverling', o.cx + CAGE.dx + 0.5, o.y + 0.3, o.cz + CAGE.dz + 0.5);
      if (m) m.persistent = true;
    }
    // a Hexwife lives in each swamp hut
    for (const h of hutsNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      if (Math.floor(h.cx / 16) !== cx || Math.floor(h.cz / 16) !== cz || !this.hostileEnabled()) continue;
      const m = this.spawnMob('hexwife', h.cx + 0.5, h.y, h.cz + 2.5);
      if (m) m.persistent = true;
    }
    // and a black Purrling (once, when the hut's chunk is first made; tame it as usual)
    for (const h of hutsNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      if (Math.floor(h.cx / 16) !== cx || Math.floor(h.cz / 16) !== cz) continue;
      const cat = this.spawnMob('purrling', h.cx - 1.5, h.y, h.cz + 0.5);
      if (cat) { cat.woolColor = HUT_CAT_COAT; cat.persistent = true; }
    }
    // a settler is kept in the cell of every igloo basement
    for (const g of igloosNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      if (!g.basement) continue;
      const c = basementLayout(g).cell;
      if (Math.floor(c.x / 16) !== cx || Math.floor(c.z / 16) !== cz) continue;
      const m = this.spawnMob('settler', c.x + 0.5, c.y, c.z + 0.5);
      if (m) { m.profession = 'cleric'; m.home = { x: c.x + 0.5, y: c.y, z: c.z + 0.5 }; m.trades = makeTrades('cleric'); m.lastRestock = this.game.time; m.persistent = true; }
    }
    // guards of the large structures (world/sunkenRuins.js, sunTombs.js, skywatch.js), placed once with the chunk that holds their spot
    if (this.hostileEnabled()) {
      const gen = this.game.world.gen, X0 = cx * 16, Z0 = cz * 16, inChunk = (x, z) => Math.floor(x / 16) === cx && Math.floor(z / 16) === cz;
      const guard = (type, x, y, z) => { if (!inChunk(x, z)) return; const m = this.spawnMob(type, x + 0.5, y, z + 0.5); if (m) m.persistent = true; };
      for (const r of sunkenRuinsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) for (const [x, y, z] of sunkenGuardSpots(r)) guard('sodden_shambler', x, y, z);
      for (const t of sunTombsNear(gen, X0, Z0, X0 + 15, Z0 + 15)) for (const [x, y, z] of tombGuardSpots(t)) guard('dune_shambler', x, y, z);
      for (const t of skywatchesNear(gen, X0, Z0, X0 + 15, Z0 + 15)) for (const g of skywatchGuards(t)) guard(g.type, g.x, g.y, g.z);
    }
    // three Elder Deepeyes in every Tide Citadel
    if (this.hostileEnabled()) spawnElders(this, cx, cz);
    // one Ironguard keeps watch by each village well
    for (const v of villagesNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      if (Math.floor((v.cx + 3) / 16) !== cx || Math.floor(v.cz / 16) !== cz) continue;
      this.spawnMob('ironguard', v.cx + 3.5, this.game.world.heightAt(v.cx + 3, v.cz) + 1, v.cz + 0.5);
      if (v.style === 'desert') spawnVillageStrider(this, v); // and a Dune Strider by the well of a desert village
      // and a few stray Purrlings roam the village
      for (let k = 0; k < 2; k++) {
        const x = v.cx + Math.floor(Math.random() * 13) - 6, z = v.cz + Math.floor(Math.random() * 13) - 6;
        this.spawnMob('purrling', x + 0.5, this.game.world.heightAt(x, z) + 1, z + 0.5);
      }
    }
    // three Buzzlings live in every wild bee nest
    {
      const w = this.game.world;
      for (let z = cz * 16; z < cz * 16 + 16; z++) for (let x = cx * 16; x < cx * 16 + 16; x++) {
        const top = w.heightAt(x, z);
        for (let y = top - 9; y <= top; y++) {
          if (w.getBlock(x, y, z) !== B.BEE_NEST) continue;
          const [fx, fz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][w.getMeta(x, y, z) & 3];
          for (let k = 0; k < 3; k++) {
            const m = this.spawnMob('buzzling', x + 0.5 + fx, y + 0.2, z + 0.5 + fz);
            if (m) { m.hive = { x, y, z }; m.persistent = true; }
          }
        }
      }
    }
    // Herds placed at chunk generation time
    const w = this.game.world;
    // rare finds: a Dune Strider in the open desert, a Hoverling in a forest
    desertChunkSpawn(this, cx, cz);
    forestChunkSpawn(this, cx, cz);
    // Inklings in deep ocean water
    if (Math.random() < 0.15) {
      const bx = cx * 16 + 2 + Math.floor(Math.random() * 12), bz = cz * 16 + 2 + Math.floor(Math.random() * 12);
      const key = BIOMES[w.biomeAt(bx, bz)] && BIOMES[w.biomeAt(bx, bz)].key;
      if (key === 'ocean' || key === 'frozen_ocean') {
        for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) {
          const x = bx + Math.floor(Math.random() * 3) - 1, z = bz + Math.floor(Math.random() * 3) - 1, y = 56 + Math.floor(Math.random() * 5);
          if (w.getBlock(x, y, z) === B.WATER && w.getBlock(x, y + 1, z) === B.WATER) this.spawnMob('inkling', x + 0.5, y, z + 0.5);
        }
      }
    }
    while (Math.random() < CHUNK_GEN_CREATURE_CHANCE) {
      const bx = cx * 16 + Math.floor(Math.random() * 16), bz = cz * 16 + Math.floor(Math.random() * 16);
      const entry = weightedPick(spawnTable(CATEGORY.CREATURE, w.biomeAt(bx, bz)));
      if (!entry) break;
      const n = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
      for (let i = 0; i < n; i++) {
        const x = Math.max(cx * 16, Math.min(cx * 16 + 15, bx + Math.floor(Math.random() * 5) - 2));
        const z = Math.max(cz * 16, Math.min(cz * 16 + 15, bz + Math.floor(Math.random() * 5) - 2));
        const y = w.heightAt(x, z) + 1;
        const ground = w.getBlock(x, y - 1, z);
        const soil = ground === B.GRASS || ground === B.MYCELIUM || ground === B.SNOWY_GRASS || ground === B.SNOW_LAYER || (ground === B.SAND && (entry.type === 'hopper' || entry.type === 'shellback')) || (entry.type === 'cragbuck' && SOLID[ground]);
        if (!soil || !this.canFit(entry.type, x, y, z)) continue;
        this.spawnMob(entry.type, x + 0.5, y, z + 0.5);
      }
    }
  }

  onChunkUnloaded(cx, cz) {
    const k = chunkKey(cx, cz);
    const list = [];
    for (const e of this.game.entities.list) {
      if (e.kind !== 'mob' || e.dead || e.noFreeze) continue;
      if (Math.floor(e.x / 16) !== cx || Math.floor(e.z / 16) !== cz) continue;
      if (e.persistent && e.deathTime === 0) list.push(e.saveData());
      e.removed = true; e.dead = true;
    }
    if (list.length) this.savedMobs.set(k, list);
  }
}
