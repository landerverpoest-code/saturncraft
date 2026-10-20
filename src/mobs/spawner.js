// Natural mob spawning around the player, chunk-generation animal herds,
// passive-mob persistence across chunk unloads and mob caps.
import { villagesNear, houseHome } from '../world/villages.js';
import { makeTrades } from './trades.js';
import { Mob } from './mob.js';
import { MOBS, CATEGORY } from './mobTypes.js';
import {
  spawnTable, weightedPick, scaledCap, isDarkEnoughToSpawn, isBrightEnoughForAnimal,
  SPAWN_MIN_DIST, DESPAWN_FAR, CREATURE_SPAWN_INTERVAL, CHUNK_GEN_CREATURE_CHANCE,
} from './spawnRules.js';
import { B, SOLID, OPAQUE, isFluid } from '../world/blocks.js';
import { LEAVES } from '../world/trees.js';
import { MIN_Y } from '../world/constants.js';
import { chunkKey } from '../world/world.js';

const NO_MONSTER_FLOOR = new Set([B.BEDROCK, B.GLASS, ...LEAVES, B.ICE, B.CACTUS]);
const MAX_PER_CHUNK = 4;

export class MobSpawner {
  constructor(game) {
    this.game = game;
    this.savedMobs = new Map();
    this.generated = new Set();
    this.enabled = true;
  }

  /** Hostile mobs can be switched off in the settings (/gamerule doHostileSpawning). */
  hostileEnabled() {
    const s = this.game.settings;
    return !s || s.hostileMobs !== false;
  }

  counts() {
    let m = 0, c = 0;
    for (const e of this.game.entities.list) if (e.kind === 'mob' && !e.dead) { if (e.def.category === CATEGORY.MONSTER) m++; else c++; }
    return `hostile ${m}  passive ${c}`;
  }

  spawnMob(type, x, y, z) {
    const m = new Mob(type, x, y, z);
    m._game = this.game;
    this.game.entities.add(m);
    return m;
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
    const below = w.getBlock(x, y - 1, z);
    if (!SOLID[below] || !OPAQUE[below] && below !== B.ICE) return false;
    if (!this.canFit(type, x, y, z)) return false;
    const raw = w.skyLight(x, y, z), blk = w.blockLight(x, y, z);
    if (category === CATEGORY.MONSTER) {
      if (NO_MONSTER_FLOOR.has(below)) return false;
      return isDarkEnoughToSpawn(raw, blk, this.game.sky.state.skyDarken);
    }
    return (below === B.GRASS || below === B.MYCELIUM) && isBrightEnoughForAnimal(raw, blk);
  }

  /** One spawn attempt in a chunk; `surface` starts the pack on top of the terrain instead of a random height. */
  attempt(cx, cz, category, surface = false) {
    const g = this.game, w = g.world, p = g.player;
    const x0 = cx * 16 + Math.floor(Math.random() * 16), z0 = cz * 16 + Math.floor(Math.random() * 16);
    const top = w.heightAt(x0, z0);
    const y = surface ? top + 1 : MIN_Y + Math.floor(Math.random() * (top + 2 - MIN_Y));
    if (SOLID[w.getBlock(x0, y, z0)]) return 0;
    const biome = w.biomeAt(x0, z0);
    const table = spawnTable(category, biome);
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
    if (!this.enabled || p.dead) return;
    const R = Math.min(8, g.chunks.renderDistance);
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    const chunks = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) if (w.isChunkLoaded(pcx + dx, pcz + dz)) chunks.push([pcx + dx, pcz + dz]);
    let monsters = 0, creatures = 0, surface = 0;
    for (const e of g.entities.list) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (e.def.category !== CATEGORY.MONSTER) { creatures++; continue; }
      monsters++;
      if (e.y >= w.heightAt(Math.floor(e.x), Math.floor(e.z)) - 1) surface++;
    }
    const cap = scaledCap(CATEGORY.MONSTER, chunks.length);
    if (this.hostileEnabled()) {
      if (monsters < cap) {
        for (const [cx, cz] of chunks) monsters += this.attempt(cx, cz, CATEGORY.MONSTER);
      }
      // Monsters in caves fill the cap quickly in this deep world, which would leave the
      // surface empty at night. Half the cap is reserved for packs on the open surface;
      // in daylight the light test rejects these attempts.
      if (surface < Math.ceil(cap / 2)) {
        for (const [cx, cz] of chunks) surface += this.attempt(cx, cz, CATEGORY.MONSTER, true);
      }
    }
    if (g.ticks % CREATURE_SPAWN_INTERVAL === 0 && creatures < scaledCap(CATEGORY.CREATURE, chunks.length)) {
      for (const [cx, cz] of chunks) creatures += this.attempt(cx, cz, CATEGORY.CREATURE);
    }
  }

  onChunkLoaded(cx, cz) {
    const k = chunkKey(cx, cz);
    const saved = this.savedMobs.get(k);
    if (saved) {
      for (const s of saved) this.spawnMob(s.type, s.x, s.y, s.z).loadData(s);
      this.savedMobs.delete(k);
    }
    if (this.generated.has(k)) return;
    this.generated.add(k);
    // settlers of village houses in this chunk
    for (const v of villagesNear(this.game.world.gen, cx * 16, cz * 16, cx * 16 + 15, cz * 16 + 15)) {
      for (const p of v.pieces) {
        if (p.type !== 'house') continue;
        const h = houseHome(p);
        if (Math.floor(h.x / 16) !== cx || Math.floor(h.z / 16) !== cz) continue;
        const m = this.spawnMob('settler', h.x, h.y, h.z);
        m.profession = p.profession; m.home = h; m.trades = makeTrades(p.profession); m.lastRestock = this.game.time;
      }
    }
    // Herds placed at chunk generation time
    const w = this.game.world;
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
        if ((ground !== B.GRASS && ground !== B.MYCELIUM) || !this.canFit(entry.type, x, y, z)) continue;
        this.spawnMob(entry.type, x + 0.5, y, z + 0.5);
      }
    }
  }

  onChunkUnloaded(cx, cz) {
    const k = chunkKey(cx, cz);
    const list = [];
    for (const e of this.game.entities.list) {
      if (e.kind !== 'mob' || e.dead) continue;
      if (Math.floor(e.x / 16) !== cx || Math.floor(e.z / 16) !== cz) continue;
      if (e.persistent && e.deathTime === 0) list.push(e.saveData());
      e.removed = true; e.dead = true;
    }
    if (list.length) this.savedMobs.set(k, list);
  }
}
