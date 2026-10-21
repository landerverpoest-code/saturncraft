// Main-thread authoritative world: chunk storage, block/light access,
// edits with light updates, scheduled block ticks and raycasting.
import { B, BLOCKS, SOLID, OPAQUE, isFluid, CROPS } from './blocks.js';
import { LightEngine } from './lighting.js';
import { MIN_Y, MAX_Y, WORLD_HEIGHT, SECTION_COUNT, cidx } from './constants.js';
import { TerrainGenerator } from './generator.js';
import { tickFluid, fluidDelay } from './fluids.js';
import { tickFire, fireCanStay } from './fire.js';
import { riftCanStay } from './dimensions/portal.js';
import { createGenerator } from './dimensions/dims.js';
import { LEAVES as LEAVES_SET } from './trees.js';
import { railSupported } from './rails.js';
import { paintingIntact } from './paintings.js';
import { SIDE_DIRS, selectionBox, collisionBoxes, SHAPED_COLLISION, DOOR_UPPER, BED_HEAD } from './shapes.js';

export function chunkKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

export class Chunk {
  constructor(cx, cz, d) {
    this.cx = cx; this.cz = cz;
    this.blocks = d.blocks; this.meta = d.meta; this.light = d.light;
    this.biomes = d.biomes; this.colors = d.colors; this.heightmap = d.heightmap;
    this.modified = !!d.modified;
    this.sectionNonAir = new Uint16Array(SECTION_COUNT);
    for (let s = 0; s < SECTION_COUNT; s++) {
      let n = 0;
      const base = s * 4096;
      for (let i = 0; i < 4096; i++) if (this.blocks[base + i]) n++;
      this.sectionNonAir[s] = n;
    }
    // monster spawner positions (for the spawner logic)
    this.spawners = new Set();
    for (let i = 0; i < this.blocks.length; i++) if (this.blocks[i] === B.SPAWNER) {
      this.spawners.add(`${cx * 16 + (i & 15)},${MIN_Y + (i >> 8)},${cz * 16 + ((i >> 4) & 15)}`);
    }
    this.dirty = new Set();
    for (let s = 0; s < SECTION_COUNT; s++) this.dirty.add(s);
    this.meshed = false;
    this.render = null; // owned by ChunkRenderer
  }
}

export class World {
  constructor(seed, dimension = 'overworld') {
    this.seed = seed;
    this.dimension = dimension; // 'overworld' | 'cinderdeep' | 'hollow' (see dimensions/dims.js)
    this.chunks = new Map();
    this.saved = new Map();      // modified chunks that were unloaded
    this.light = new LightEngine(this);
    this.gen = new TerrainGenerator(seed); // main-thread copy for spawn search
    this.scheduled = new Map();  // posKey -> {x,y,z,tick}
    this.tickCount = 0;
    this.listeners = { blockChanged: [], fallingBlock: [], dropItems: [], fireCrackle: [] };
    this._lastKey = -1; this._lastChunk = null;
  }

  /** Terrain generator of the current dimension (the overworld one stays in `gen`). */
  get dimGenerator() { return createGenerator(this.dimension, this.seed); }

  /** Switch to another dimension (call after unloading every chunk): new chunk store, no pending ticks. */
  setDimension(dimension, saved = new Map()) {
    this.dimension = dimension;
    this.chunks = new Map();
    this.saved = saved;
    this.scheduled = new Map();
    this._lastKey = -1; this._lastChunk = null;
  }

  on(evt, fn) { this.listeners[evt].push(fn); }
  emit(evt, ...a) { for (const f of this.listeners[evt]) f(...a); }

  getChunk(cx, cz) {
    const k = chunkKey(cx, cz);
    if (k === this._lastKey) return this._lastChunk;
    const c = this.chunks.get(k);
    if (c) { this._lastKey = k; this._lastChunk = c; }
    return c;
  }
  isChunkLoaded(cx, cz) { return this.chunks.has(chunkKey(cx, cz)); }
  isLoaded(x, z) { return !!this.getChunk(x >> 4, z >> 4); }

  getBlock(x, y, z) {
    if (y < MIN_Y || y > MAX_Y) return B.AIR;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return y < 0 ? B.STONE : B.AIR;
    return c.blocks[cidx(x & 15, y, z & 15)];
  }
  getMeta(x, y, z) {
    if (y < MIN_Y || y > MAX_Y) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.meta[cidx(x & 15, y, z & 15)] : 0;
  }
  getLight(x, y, z) {
    if (y > MAX_Y) return 0xf0;
    if (y < MIN_Y) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.light[cidx(x & 15, y, z & 15)] : 0xf0;
  }
  setLight(x, y, z, v) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    const i = cidx(x & 15, y, z & 15);
    if (c.light[i] === v) return;
    c.light[i] = v;
    this.markDirty(x, y, z);
  }
  skyLight(x, y, z) { return this.getLight(x, y, z) >> 4; }
  blockLight(x, y, z) { return this.getLight(x, y, z) & 15; }
  biomeAt(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.biomes[(x & 15) + (z & 15) * 16] : 3;
  }
  heightAt(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return c ? c.heightmap[(x & 15) + (z & 15) * 16] : 64;
  }

  /** Mark the section containing (x,y,z) and touching neighbour sections for remeshing. */
  markDirty(x, y, z) {
    const lx = x & 15, lz = z & 15, ly = (y - MIN_Y) & 15;
    const s = (y - MIN_Y) >> 4;
    this._dirty(x >> 4, z >> 4, s);
    if (lx === 0) this._dirty((x >> 4) - 1, z >> 4, s);
    if (lx === 15) this._dirty((x >> 4) + 1, z >> 4, s);
    if (lz === 0) this._dirty(x >> 4, (z >> 4) - 1, s);
    if (lz === 15) this._dirty(x >> 4, (z >> 4) + 1, s);
    if (ly === 0 && s > 0) this._dirty(x >> 4, z >> 4, s - 1);
    if (ly === 15 && s < SECTION_COUNT - 1) this._dirty(x >> 4, z >> 4, s + 1);
    // corners (AO / smooth light sample diagonals)
    if ((lx === 0 || lx === 15) && (lz === 0 || lz === 15)) this._dirty((x >> 4) + (lx ? 1 : -1), (z >> 4) + (lz ? 1 : -1), s);
  }
  _dirty(cx, cz, s) {
    const c = this.getChunk(cx, cz);
    if (!c) return;
    c.dirty.add(s);
    if (this.urgentEdits) (c.urgent || (c.urgent = new Set())).add(s);
  }

  /** Player edit: mesh affected sections immediately rather than via workers. */
  setBlockUrgent(x, y, z, id, meta = 0, notify = true) {
    this.urgentEdits = true;
    try { return this.setBlock(x, y, z, id, meta, notify); } finally { this.urgentEdits = false; }
  }

  /**
   * Change a block. Updates lighting, heightmap, neighbour notifications.
   */
  setBlock(x, y, z, id, meta = 0, notify = true) {
    if (y < MIN_Y || y > MAX_Y) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return false;
    const i = cidx(x & 15, y, z & 15);
    const old = c.blocks[i];
    if (old === id && c.meta[i] === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    if (old === B.SPAWNER) c.spawners.delete(`${x},${y},${z}`);
    if (id === B.SPAWNER) c.spawners.add(`${x},${y},${z}`);
    c.modified = true;
    const s = (y - MIN_Y) >> 4;
    if (!old && id) c.sectionNonAir[s]++;
    else if (old && !id) c.sectionNonAir[s]--;
    // heightmap
    const hi = (x & 15) + (z & 15) * 16;
    if (id && y > c.heightmap[hi]) c.heightmap[hi] = y;
    else if (!id && y === c.heightmap[hi]) {
      let yy = y - 1;
      while (yy > MIN_Y && !c.blocks[cidx(x & 15, yy, z & 15)]) yy--;
      c.heightmap[hi] = yy;
    }
    this.markDirty(x, y, z);
    if (old !== id) this.light.onBlockChanged(x, y, z, old, id);
    this.emit('blockChanged', x, y, z, old, id);
    if (notify) {
      this.onNeighborChanged(x, y, z);
      this.onNeighborChanged(x + 1, y, z); this.onNeighborChanged(x - 1, y, z);
      this.onNeighborChanged(x, y + 1, z); this.onNeighborChanged(x, y - 1, z);
      this.onNeighborChanged(x, y, z + 1); this.onNeighborChanged(x, y, z - 1);
    }
    return true;
  }

  scheduleTick(x, y, z, delay) {
    const k = `${x},${y},${z}`;
    const t = this.tickCount + delay;
    const cur = this.scheduled.get(k);
    if (cur && cur.tick <= t) return;
    this.scheduled.set(k, { x, y, z, tick: t });
  }

  onNeighborChanged(x, y, z) {
    const id = this.getBlock(x, y, z);
    if (!id) return;
    const d = BLOCKS[id];
    if (d.fluid) this.scheduleTick(x, y, z, fluidDelay(id));
    else if (id === B.FIRE) {
      if (!fireCanStay(this, x, y, z)) this.setBlock(x, y, z, B.AIR);
    } else if (id === B.RIFT) {
      if (!riftCanStay(this, x, y, z)) this.setBlock(x, y, z, B.AIR); // portal sheet collapses with its frame
    } else if (d.gravity) {
      const below = this.getBlock(x, y - 1, z);
      if (!SOLID[below] || isFluid(below)) this.scheduleTick(x, y, z, 2);
    } else if (d.needsSupport) {
      if (!this.hasSupport(x, y, z, id)) this.breakBlock(x, y, z, true);
    } else if (id === B.GRASS && OPAQUE[this.getBlock(x, y + 1, z)]) {
      this.setBlock(x, y, z, B.DIRT, 0, false);
    } else if (id === B.FARMLAND && SOLID[this.getBlock(x, y + 1, z)]) {
      this.setBlock(x, y, z, B.DIRT, 0);
    }
  }

  hasSupport(x, y, z, id, metaIn) {
    const below = this.getBlock(x, y - 1, z);
    if (id === B.CACTUS) {
      if (below !== B.CACTUS && below !== B.SAND && below !== B.RED_SAND) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (SOLID[this.getBlock(x + dx, y, z + dz)]) return false;
      return true;
    }
    if (id === B.VINES) {
      // on the side of a solid block or leaves, or hanging from the vine above
      const meta = metaIn ?? this.getMeta(x, y, z);
      if (this.getBlock(x, y + 1, z) === B.VINES) return true;
      const [dx, , dz] = SIDE_DIRS[meta & 3];
      const wall = this.getBlock(x + dx, y, z + dz);
      return !!(SOLID[wall] && (OPAQUE[wall] || BLOCKS[wall].tint === 'foliage' || BLOCKS[wall].tint === 'birch' || BLOCKS[wall].tint === 'spruce'));
    }
    if (id === B.LILY_PAD) return below === B.WATER || below === B.ICE;
    if (id === B.BROWN_MUSHROOM || id === B.RED_MUSHROOM) return !!(SOLID[below] && OPAQUE[below]);
    if (id === B.TORCH || id === B.LADDER) {
      const meta = metaIn ?? this.getMeta(x, y, z);
      const side = id === B.TORCH ? meta - 1 : meta & 3;
      if (id === B.TORCH && !meta) return SOLID[below] && OPAQUE[below];
      const [dx, , dz] = SIDE_DIRS[side & 3];
      const wall = this.getBlock(x + dx, y, z + dz);
      return !!(SOLID[wall] && OPAQUE[wall]);
    }
    if (id === B.BED) {
      // each half needs its partner: the head lies towards side (meta & 3) of the foot
      const meta = metaIn ?? this.getMeta(x, y, z);
      const [dx, , dz] = SIDE_DIRS[meta & 3];
      const head = meta & BED_HEAD, s = head ? -1 : 1;
      const other = this.getBlock(x + dx * s, y, z + dz * s), om = this.getMeta(x + dx * s, y, z + dz * s);
      return other === B.BED && (om & BED_HEAD) !== head && (om & 3) === (meta & 3);
    }
    if (id === B.DOOR) {
      // the lower half stands on a solid block with its upper half above; the upper half sits on the lower
      if ((metaIn ?? this.getMeta(x, y, z)) & DOOR_UPPER) return below === B.DOOR;
      return !!SOLID[below] && below !== B.DOOR && this.getBlock(x, y + 1, z) === B.DOOR;
    }
    if (id === B.RAIL) return railSupported(this, x, y, z);
    if (id === B.COCOA) { const [dx, , dz] = SIDE_DIRS[(metaIn ?? this.getMeta(x, y, z)) & 3]; return this.getBlock(x + dx, y, z + dz) === B.JUNGLE_LOG; }
    if (id === B.ITEM_FRAME) { const [dx, , dz] = SIDE_DIRS[(metaIn ?? this.getMeta(x, y, z)) & 3]; return !!SOLID[this.getBlock(x + dx, y, z + dz)]; }
    if (id === B.OAK_WALL_SIGN) { const [dx, , dz] = SIDE_DIRS[(metaIn ?? this.getMeta(x, y, z)) & 3]; return !!SOLID[this.getBlock(x + dx, y, z + dz)]; }
    if (id === B.OAK_SIGN) return !!SOLID[below];
    if (id === B.PAINTING || id === B.PAINTING_B) return paintingIntact(this, x, y, z, id, metaIn ?? this.getMeta(x, y, z));
    if (id === B.SNOW_LAYER) return (!!SOLID[below] && !!OPAQUE[below]) || LEAVES_SET.has(below) || (below === B.SNOW_LAYER && (this.getMeta(x, y - 1, z) & 7) === 7);
    if (id === B.DEAD_BUSH) return below === B.SAND || below === B.RED_SAND || below === B.DIRT || below === B.GRASS || (below >= B.TERRACOTTA && below <= B.LIGHT_GRAY_TERRACOTTA);
    if (CROPS.has(id)) return below === B.FARMLAND;
    if (id === B.CINDERROOT) return below === B.MOURNSAND;
    if (id === B.SUGAR_CANE) {
      if (below === B.SUGAR_CANE) return true;
      if (below !== B.GRASS && below !== B.DIRT && below !== B.SAND && below !== B.RED_SAND) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.getBlock(x + dx, y - 1, z + dz); if (n === B.WATER || n === B.ICE) return true; }
      return false;
    }
    return below === B.GRASS || below === B.DIRT || below === B.SNOWY_GRASS || below === B.MYCELIUM;
  }

  /** Remove a block, optionally dropping it as items (used for support loss, fluids). */
  breakBlock(x, y, z, drop) {
    const id = this.getBlock(x, y, z);
    if (!id) return;
    const meta = this.getMeta(x, y, z);
    this.setBlock(x, y, z, B.AIR);
    if (drop) this.emit('dropItems', x, y, z, id, meta);
  }

  /** Run scheduled block ticks that are due. */
  tick() {
    this.tickCount++;
    if (!this.scheduled.size) return;
    const due = [];
    for (const [k, t] of this.scheduled) if (t.tick <= this.tickCount) { due.push(t); this.scheduled.delete(k); }
    // cap work per tick
    for (let n = 0; n < due.length; n++) {
      const t = due[n];
      if (n > 4000) { this.scheduleTick(t.x, t.y, t.z, 1); continue; }
      if (!this.isLoaded(t.x, t.z)) continue;
      const id = this.getBlock(t.x, t.y, t.z);
      const d = BLOCKS[id];
      if (d.fluid) tickFluid(this, t.x, t.y, t.z, id);
      else if (id === B.FIRE) { tickFire(this, t.x, t.y, t.z); if (Math.random() < 0.3) this.emit('fireCrackle', t.x, t.y, t.z); }
      else if (d.gravity) {
        const below = this.getBlock(t.x, t.y - 1, t.z);
        if ((!SOLID[below] || isFluid(below)) && t.y > MIN_Y) {
          this.setBlock(t.x, t.y, t.z, B.AIR);
          this.emit('fallingBlock', t.x, t.y, t.z, id);
        }
      }
    }
  }

  /** Voxel DDA raycast. Returns {x,y,z,id,face:[nx,ny,nz],dist} or null. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, hitFluids = false) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
    let tmx = dx > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx;
    let tmy = dy > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy;
    let tmz = dz > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz;
    let face = [0, 0, 0], t = 0;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      if (id && (hitFluids ? true : !isFluid(id))) {
        const sh = BLOCKS[id];
        const sel = selectionBox(id, this.getMeta(x, y, z)) || (sh.shape === 2 ? PLANT_BOX : null);
        if (sel) {
          // small shapes: test against reduced box
          const box = sel;
          const hit = rayBox(ox, oy, oz, dx, dy, dz, x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]);
          if (hit !== null && hit <= maxDist) return { x, y, z, id, face, dist: hit };
        } else return { x, y, z, id, face, dist: t };
      }
      if (tmx < tmy && tmx < tmz) { x += stepX; t = tmx; tmx += tdx; face = [-stepX, 0, 0]; }
      else if (tmy < tmz) { y += stepY; t = tmy; tmy += tdy; face = [0, -stepY, 0]; }
      else { z += stepZ; t = tmz; tmz += tdz; face = [0, 0, -stepZ]; }
    }
    return null;
  }

  addChunk(cx, cz, data) {
    const k = chunkKey(cx, cz);
    const saved = this.saved.get(k);
    const c = new Chunk(cx, cz, saved || data);
    if (saved) this.saved.delete(k);
    this.chunks.set(k, c);
    this._lastKey = -1;
    this.light.stitchChunk(cx, cz);
    // resume pending fluid ticks for saved chunks is not needed: fluids settle before unload
    return c;
  }

  removeChunk(cx, cz) {
    const k = chunkKey(cx, cz);
    const c = this.chunks.get(k);
    if (!c) return null;
    if (c.modified) this.saved.set(k, { blocks: c.blocks, meta: c.meta, light: c.light, biomes: c.biomes, colors: c.colors, heightmap: c.heightmap, modified: true });
    this.chunks.delete(k);
    this._lastKey = -1;
    return c;
  }

  /** Is the AABB colliding with any solid block? */
  boxCollides(minX, minY, minZ, maxX, maxY, maxZ) {
    for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-7); x++)
      for (let y = Math.floor(minY); y <= Math.floor(maxY - 1e-7); y++)
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-7); z++)
          if (SOLID[this.getBlock(x, y, z)]) {
            const id = this.getBlock(x, y, z);
            const shaped = SHAPED_COLLISION[id] ? collisionBoxes(id, this.getMeta(x, y, z), this, x, y, z) : null;
            if (!shaped) return true;
            for (const s of shaped) {
              if (maxX > x + s[0] && minX < x + s[3] && maxY > y + s[1] && minY < y + s[4] && maxZ > z + s[2] && minZ < z + s[5]) return true;
            }
          }
    return false;
  }
}

const PLANT_BOX = [0.15, 0, 0.15, 0.85, 0.8, 0.85];

function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz], mn = [x0, y0, z0], mx = [x1, y1, z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return null; continue; }
    let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
  }
  if (tmax < Math.max(0, tmin)) return null;
  return Math.max(0, tmin);
}

export { WORLD_HEIGHT };
