// Campfire cooking (world/campfireCooking.js, Game.tickCampfires / setCampfire, Interaction.useCampfire) and the wild crops
// (world/wildCrops.js, village farm variety in world/villages.js).
import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { BIOME } from '../src/world/biomes.js';
import { cidx, CHUNK_VOLUME, MIN_Y } from '../src/world/constants.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { villageInRegion, stampVillages } from '../src/world/villages.js';
import { SMELTING } from '../src/player/crafting.js';
import { Game } from '../src/game.js';
import { Interaction } from '../src/player/interaction.js';
import { Inventory } from '../src/player/inventory.js';
import { aimTip } from '../src/world/aimTips.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { resolveBindings } from '../src/ui/bindings.js';
import { stampWildCrops, WILD_SALT } from '../src/world/wildCrops.js';
import {
  CAMP_SLOTS, CAMP_COOK_TICKS, campCooked, canCampCook, cleanCamp, campAdd, campTick, campCount,
} from '../src/world/campfireCooking.js';
import { MockWorld } from './helpers.js';

// ---- campfire cooking, pure rules ----------------------------------------------------------------

describe('campfire cooking rules', () => {
  it('cooks the foods the furnace cooks, nothing else', () => {
    for (const id of [I.RAW_BEEF, I.RAW_PORK, I.RAW_CHICKEN, I.RAW_MUTTON, I.RAW_RABBIT, I.RAW_VENISON, I.RAW_SILVERFIN, I.RAW_REDFIN, I.POTATO, I.FROSTROOT]) {
      expect(canCampCook(id), ITEMS[id].name).toBe(true);
      expect(campCooked(id)).toBe(SMELTING[id]);
      expect(ITEMS[campCooked(id)].food).toBeTruthy();
    }
    for (const id of [I.RAW_IRON, B.SAND, B.OAK_LOG, B.COBBLESTONE, I.COAL, I.STICK, I.CARROT, I.WHEAT]) expect(canCampCook(id), String(id)).toBe(false);
  });
  it('takes four items, each cooking for 30 s', () => {
    expect(CAMP_SLOTS).toBe(4);
    expect(CAMP_COOK_TICKS).toBe(600);
    let c = null;
    for (let i = 0; i < CAMP_SLOTS; i++) { c = campAdd(c, I.RAW_BEEF); expect(campCount(c)).toBe(i + 1); }
    expect(campAdd(c, I.POTATO)).toBeNull(); // full
    expect(campAdd(null, B.SAND)).toBeNull(); // not food
    const before = JSON.stringify(c);
    campAdd(c, I.POTATO);
    expect(JSON.stringify(c)).toBe(before); // campAdd never edits its input
  });
  it('pops items out cooked when they are done, one tick at a time', () => {
    let c = campAdd(null, I.RAW_BEEF);
    for (let t = 0; t < 300; t++) campTick(c);
    c = campAdd(c, I.POTATO); // laid on half way through
    let done = [];
    for (let t = 300; t < 599; t++) done.push(...campTick(c));
    expect(done).toEqual([]);
    expect(campTick(c)).toEqual([I.STEAK]);
    expect(campCount(c)).toBe(1);
    for (let t = 0; t < 299; t++) expect(campTick(c)).toEqual([]);
    expect(campTick(c)).toEqual([I.BAKED_POTATO]);
    expect(campCount(c)).toBe(0);
  });
  it('cleans saved and network state', () => {
    expect(cleanCamp(null)).toBeNull();
    expect(cleanCamp({ slots: [] })).toBeNull();
    expect(cleanCamp({ slots: [null, null, null, null] })).toBeNull();
    expect(cleanCamp({ slots: [{ id: B.SAND, t: 3 }, { id: 'x', t: 1 }] })).toBeNull(); // nothing cookable
    const c = cleanCamp({ slots: [{ id: I.RAW_PORK, t: 123.9 }, null, { id: I.POTATO, t: -5 }, { id: I.RAW_BEEF, t: 99999 }, { id: I.RAW_BEEF, t: 1 }] });
    expect(c.slots).toHaveLength(4);
    expect(c.slots[0]).toEqual({ id: I.RAW_PORK, t: 123 });
    expect(c.slots[2].t).toBe(0);
    expect(c.slots[3].t).toBe(CAMP_COOK_TICKS - 1);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c); // survives a save and the wire
  });
});

// ---- the game side, on a stub -------------------------------------------------------------------------

class FireWorld extends MockWorld {
  constructor() { super(60); this.loaded = true; }
  isLoaded() { return this.loaded; }
}
function stub() {
  const g = {
    campfires: new Map(), chests: new Map(), furnaces: new Map(), brewingStands: new Map(), hoppers: new Map(), dispensers: new Map(), world: new FireWorld(), ticks: 0, net: null, sent: [], spawned: [], sounds: [],
    entities: { spawnItem: (x, y, z, st) => g.spawned.push(st) },
    audio: { play: (n) => g.sounds.push(n) },
    particles: { smoke: () => {} },
    ui: {}, player: { creative: false },
  };
  g.setCampfire = Game.prototype.setCampfire;
  return g;
}
const withNet = (g) => { g.net = { sendCampfire: (x, y, z, s) => g.sent.push([x, y, z, s]) }; return g; };

describe('campfire state in the game', () => {
  it('shares changes on the net, but not what comes from it', () => {
    const g = withNet(stub());
    Game.prototype.setCampfire.call(g, 1, 70, 2, campAdd(null, I.RAW_BEEF));
    expect(g.sent).toHaveLength(1);
    expect(g.campfires.get('1,70,2').slots[0].id).toBe(I.RAW_BEEF);
    Game.prototype.setCampfire.call(g, 1, 70, 2, { slots: [{ id: I.POTATO, t: 5 }] }, true);
    expect(g.sent).toHaveLength(1);
    expect(g.campfires.get('1,70,2').slots[0].id).toBe(I.POTATO);
    Game.prototype.setCampfire.call(g, 1, 70, 2, null, true);
    expect(g.campfires.has('1,70,2')).toBe(false);
  });
  it('cooks over time, spawns the cooked food above the fire and tells the guests only when something finishes', () => {
    const g = withNet(stub());
    g.world.set(3, 70, 3, B.CAMPFIRE);
    Game.prototype.setCampfire.call(g, 3, 70, 3, campAdd(campAdd(null, I.RAW_BEEF), I.RAW_SILVERFIN));
    g.sent.length = 0;
    for (let t = 0; t < CAMP_COOK_TICKS - 1; t++) { g.ticks++; Game.prototype.tickCampfires.call(g); }
    expect(g.spawned).toHaveLength(0);
    expect(g.sent).toHaveLength(0); // progress alone is not sent
    Game.prototype.tickCampfires.call(g);
    expect(g.spawned.map((s) => s.id).sort()).toEqual([I.STEAK, I.COOKED_SILVERFIN].sort());
    expect(g.campfires.size).toBe(0);
    expect(g.sent).toHaveLength(1);
    expect(g.sent[0][3]).toBeNull();
  });
  it('does not cook in unloaded chunks and drops the food of a fire that is gone', () => {
    const g = stub();
    g.world.set(0, 70, 0, B.CAMPFIRE);
    Game.prototype.setCampfire.call(g, 0, 70, 0, campAdd(null, I.POTATO));
    g.world.loaded = false;
    for (let t = 0; t < 1000; t++) Game.prototype.tickCampfires.call(g);
    expect(g.campfires.get('0,70,0').slots[0].t).toBe(0);
    g.world.loaded = true;
    g.world.set(0, 70, 0, B.AIR);
    Game.prototype.tickCampfires.call(g);
    expect(g.spawned.map((s) => s.id)).toEqual([I.POTATO]);
    expect(g.campfires.size).toBe(0);
  });
  it('costs nothing while no campfire holds food', () => {
    const g = stub();
    g.world.isLoaded = () => { throw new Error('looked at the world'); };
    expect(() => Game.prototype.tickCampfires.call(g)).not.toThrow();
  });
  it('drops its contents when broken (a guest leaves that to the host)', () => {
    const g = stub();
    Game.prototype.setCampfire.call(g, 5, 70, 5, campAdd(campAdd(null, I.RAW_BEEF), I.POTATO));
    Game.prototype.onBlockBroken.call(g, 5, 70, 5, B.CAMPFIRE, 0);
    expect(g.spawned.map((s) => s.id).sort()).toEqual([I.RAW_BEEF, I.POTATO].sort());
    expect(g.campfires.size).toBe(0);
    const guest = withNet(stub());
    guest.net.isClient = true;
    Game.prototype.setCampfire.call(guest, 5, 70, 5, campAdd(null, I.RAW_BEEF), true);
    Game.prototype.onBlockBroken.call(guest, 5, 70, 5, B.CAMPFIRE, 0);
    expect(guest.spawned).toHaveLength(0);
    expect(guest.campfires.size).toBe(0);
    expect(guest.sent).toHaveLength(0);
  });
});

// ---- right-clicking a campfire -------------------------------------------------------------------------

function interactor({ held = null, sneaking = false, creative = false } = {}) {
  const inv = new Inventory();
  if (held) inv.slots[0] = { ...held };
  inv.selected = 0;
  const g = stub();
  Object.assign(g.player, { inventory: inv, sneaking, creative });
  g.toasts = [];
  g.hud = { toast: (m) => g.toasts.push(m) };
  const it = Object.create(Interaction.prototype);
  it.game = g;
  return { g, it, inv, t: { x: 2, y: 70, z: 2, id: B.CAMPFIRE } };
}

describe('right-clicking a campfire', () => {
  it('lays raw food on it, one piece at a time, up to four', () => {
    const { g, it, inv, t } = interactor({ held: { id: I.RAW_BEEF, count: 6, damage: 0 } });
    for (let i = 0; i < 4; i++) expect(it.useCampfire(t, inv.slots[0])).toBe(true);
    expect(campCount(g.campfires.get('2,70,2'))).toBe(4);
    expect(inv.slots[0].count).toBe(2);
    expect(it.useCampfire(t, inv.slots[0])).toBe(true); // full: handled, nothing taken
    expect(inv.slots[0].count).toBe(2);
    expect(g.toasts.at(-1)).toMatch(/full/);
  });
  it('leaves other items and blocks alone (and sneaking places as usual)', () => {
    for (const held of [{ id: B.COBBLESTONE, count: 3, damage: 0 }, { id: I.STICK, count: 1, damage: 0 }, { id: I.CARROT, count: 1, damage: 0 }]) {
      const { g, it, inv, t } = interactor({ held });
      expect(it.useCampfire(t, inv.slots[0])).toBe(false);
      expect(g.campfires.size).toBe(0);
    }
    const s = interactor({ held: { id: I.RAW_BEEF, count: 1, damage: 0 }, sneaking: true });
    expect(s.it.useCampfire(s.t, s.inv.slots[0])).toBe(false);
    const e = interactor(); // empty hand, empty fire
    expect(e.it.useCampfire(e.t, null)).toBe(false);
  });
  it('gives the food back to an empty hand', () => {
    const { g, it, inv, t } = interactor({ held: { id: I.POTATO, count: 2, damage: 0 } });
    it.useCampfire(t, inv.slots[0]); it.useCampfire(t, inv.slots[0]);
    inv.slots[0] = null;
    expect(it.useCampfire(t, null)).toBe(true);
    expect(g.campfires.size).toBe(0);
    const have = inv.slots.filter(Boolean).reduce((n, s) => n + (s.id === I.POTATO ? s.count : 0), 0);
    expect(have).toBe(2);
  });
  it('costs nothing in creative', () => {
    const { it, inv, t } = interactor({ held: { id: I.RAW_BEEF, count: 1, damage: 0 }, creative: true });
    it.useCampfire(t, inv.slots[0]);
    expect(inv.slots[0].count).toBe(1);
  });
});

describe('campfire hints', () => {
  it('the hover tip tells what to do and how many are cooking', () => {
    const w = new FireWorld();
    const t = { x: 0, y: 70, z: 0, id: B.CAMPFIRE };
    expect(aimTip(w, t, new Map())).toMatch(/right-click/i);
    expect(aimTip(w, t, new Map([['0,70,0', campAdd(null, I.RAW_BEEF)]]))).toMatch(/1\/4 cooking.*30 s/);
  });
  it('Help lists what a campfire cooks and where the wild crops grow', () => {
    const topics = buildTopics({ table: resolveBindings({}) });
    const text = JSON.stringify(topics.find((x) => x.id === 'cooking'));
    expect(text).toMatch(/Campfire cooking/);
    expect(text).toMatch(/Raw Beef/);
    expect(JSON.stringify(topics.find((x) => x.id === 'farming'))).toMatch(/Wild crops/);
  });
});

// ---- wild crops ---------------------------------------------------------------------------------------

/** A flat chunk of `ground` on stone at y = 70 in one biome, as the ordinary passes leave it. */
function flat(biome, ground = B.GRASS) {
  const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
  const heightmap = new Int16Array(256).fill(70), biomes = new Uint8Array(256).fill(biome);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { for (let y = MIN_Y; y < 70; y++) blocks[cidx(x, y, z)] = B.STONE; blocks[cidx(x, 70, z)] = ground; }
  return { blocks, meta, heightmap, biomes };
}
const gen = { seed: 42 };
const KEYS = [B.FROSTROOTS, B.DEWBERRY_BRAMBLE, B.SUNGOURD, 'farmland'];
function total(biome, ground, chunks = 80, prep) {
  const sum = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (let k = 0; k < chunks; k++) {
    const c = flat(biome, ground);
    if (prep) prep(c);
    stampWildCrops(gen, c.blocks, c.meta, (k % 9) - 4, Math.floor(k / 9) - 4, c.heightmap, c.biomes);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const a = c.blocks[cidx(x, 71, z)];
      if (a in sum) sum[a]++;
      if (c.blocks[cidx(x, 70, z)] === B.FARMLAND) sum.farmland++;
    }
  }
  return sum;
}

describe('wild crops', () => {
  it('Frostroots grow on small farmland plots in the cold biomes only', () => {
    for (const b of [BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA, BIOME.TAIGA]) {
      const s = total(b, b === BIOME.TAIGA ? B.GRASS : B.SNOWY_GRASS);
      expect(s[B.FROSTROOTS], String(b)).toBeGreaterThan(5);
      expect(s.farmland).toBe(s[B.FROSTROOTS]); // every crop has its soil, and no soil without one
      expect(s[B.SUNGOURD] + s[B.DEWBERRY_BRAMBLE]).toBe(0);
    }
    for (const b of [BIOME.DESERT, BIOME.SAVANNA, BIOME.FOREST, BIOME.JUNGLE, BIOME.SWAMP]) expect(total(b, B.GRASS, 40)[B.FROSTROOTS], String(b)).toBe(0);
  });
  it('Frostroots stand at stages 3 to 7 on dry farmland and replace a snow layer', () => {
    let n = 0;
    for (let k = 0; k < 60; k++) {
      const d = flat(BIOME.SNOWY_PLAINS, B.SNOWY_GRASS);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) d.blocks[cidx(x, 71, z)] = B.SNOW_LAYER;
      stampWildCrops(gen, d.blocks, d.meta, k, 3, d.heightmap, d.biomes);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        if (d.blocks[cidx(x, 71, z)] !== B.FROSTROOTS) continue;
        n++;
        expect(d.blocks[cidx(x, 70, z)]).toBe(B.FARMLAND);
        expect(d.meta[cidx(x, 70, z)]).toBe(0);
        expect(d.meta[cidx(x, 71, z)]).toBeGreaterThanOrEqual(3);
        expect(d.meta[cidx(x, 71, z)]).toBeLessThanOrEqual(7);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
  it('Dewberry Brambles grow in forests and meadows, mostly ripe', () => {
    for (const b of [BIOME.FOREST, BIOME.BIRCH_FOREST, BIOME.FLOWER_FOREST, BIOME.HIGHLAND_MEADOW, BIOME.BLOSSOM_GROVE]) {
      const s = total(b, B.GRASS);
      expect(s[B.DEWBERRY_BRAMBLE], String(b)).toBeGreaterThan(5);
      expect(s[B.FROSTROOTS] + s[B.SUNGOURD]).toBe(0);
    }
    let ripe = 0, all = 0;
    for (let k = 0; k < 80; k++) {
      const d = flat(BIOME.FOREST);
      stampWildCrops(gen, d.blocks, d.meta, k, -7, d.heightmap, d.biomes);
      for (let i = 0; i < 256; i++) {
        const j = cidx(i & 15, 71, i >> 4);
        if (d.blocks[j] === B.DEWBERRY_BRAMBLE) { all++; if (d.meta[j] === 3) ripe++; }
      }
    }
    expect(all).toBeGreaterThan(0);
    expect(ripe / all).toBeGreaterThan(0.4);
  });
  it('Dewberry Brambles stay out of cold, hot and wet biomes; plains get them only beside trees', () => {
    for (const b of [BIOME.DESERT, BIOME.SAVANNA, BIOME.SNOWY_PLAINS, BIOME.JUNGLE, BIOME.SWAMP, BIOME.PLAINS]) expect(total(b, B.GRASS, 40)[B.DEWBERRY_BRAMBLE], String(b)).toBe(0);
    const grove = (c) => { for (let z = 0; z < 16; z += 3) for (let x = 0; x < 16; x += 3) for (let y = 71; y < 75; y++) c.blocks[cidx(x, y, z)] = B.OAK_LOG; };
    expect(total(BIOME.PLAINS, B.GRASS, 120, grove)[B.DEWBERRY_BRAMBLE]).toBeGreaterThan(0);
  });
  it('Sungourds lie in patches on warm grassland, most of all on savanna', () => {
    const sav = total(BIOME.SAVANNA, B.GRASS), jun = total(BIOME.JUNGLE, B.GRASS), pl = total(BIOME.PLAINS, B.GRASS);
    expect(sav[B.SUNGOURD]).toBeGreaterThan(10);
    expect(jun[B.SUNGOURD]).toBeGreaterThan(0);
    expect(sav[B.SUNGOURD]).toBeGreaterThan(pl[B.SUNGOURD]);
    for (const b of [BIOME.SNOWY_PLAINS, BIOME.TAIGA, BIOME.DESERT, BIOME.FOREST]) expect(total(b, B.GRASS, 40)[B.SUNGOURD], String(b)).toBe(0);
  });
  it('only changes the ground block and the free block above it, never trunks, never other layers', () => {
    for (const [biome, ground] of [[BIOME.SNOWY_TAIGA, B.SNOWY_GRASS], [BIOME.FOREST, B.GRASS], [BIOME.SAVANNA, B.GRASS], [BIOME.PLAINS, B.DIRT]]) {
      for (let k = 0; k < 30; k++) {
        const a = flat(biome, ground), b = flat(biome, ground);
        for (const c of [a, b]) {
          for (let i = 0; i < 256; i += 3) c.blocks[cidx(i & 15, 71, i >> 4)] = B.TALL_GRASS;
          for (let i = 1; i < 256; i += 7) c.blocks[cidx(i & 15, 71, i >> 4)] = B.OAK_LOG; // taken by a tree
        }
        stampWildCrops(gen, b.blocks, b.meta, k, k * 3, b.heightmap, b.biomes);
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = MIN_Y; y < 90; y++) {
          const i = cidx(x, y, z);
          if (a.blocks[i] === b.blocks[i] && a.meta[i] === b.meta[i]) continue;
          expect([70, 71], `${x},${y},${z}`).toContain(y);
          if (y === 71) expect([B.AIR, B.TALL_GRASS, B.SNOW_LAYER]).toContain(a.blocks[i]);
        }
      }
    }
  });
  it('is deterministic; nothing grows under water or on stone, sand, gravel or mycelium', () => {
    const a = flat(BIOME.FOREST), b = flat(BIOME.FOREST);
    stampWildCrops(gen, a.blocks, a.meta, 4, 9, a.heightmap, a.biomes);
    stampWildCrops({ seed: 42 }, b.blocks, b.meta, 4, 9, b.heightmap, b.biomes);
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    for (const ground of [B.SAND, B.STONE, B.GRAVEL, B.MYCELIUM]) for (const biome of [BIOME.SAVANNA, BIOME.FOREST, BIOME.SNOWY_PLAINS]) {
      const s = total(biome, ground, 30);
      expect(s[B.SUNGOURD] + s[B.DEWBERRY_BRAMBLE] + s[B.FROSTROOTS] + s.farmland, `${biome} ${ground}`).toBe(0);
    }
    const lake = flat(BIOME.FOREST);
    lake.heightmap.fill(55); // below sea level
    for (let k = 0; k < 40; k++) stampWildCrops(gen, lake.blocks, lake.meta, k, 0, lake.heightmap, lake.biomes);
    let crops = 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (lake.blocks[cidx(x, 71, z)]) crops++;
    expect(crops).toBe(0);
  });
  it('differs between seeds and uses its own hash salts', () => {
    const run = (seed) => { const c = flat(BIOME.SAVANNA); stampWildCrops({ seed }, c.blocks, c.meta, 2, 2, c.heightmap, c.biomes); return Buffer.from(c.blocks.buffer).toString('base64'); };
    expect(run(1)).not.toBe(run(2));
    expect(Math.min(...Object.values(WILD_SALT))).toBeGreaterThanOrEqual(9000);
  });
});

describe('wild crops in generated worlds', () => {
  it('a generated chunk keeps wild Frostroots on farmland and generation stays deterministic', () => {
    const g1 = new TerrainGenerator(42), g2 = new TerrainGenerator(42);
    for (const [cx, cz] of [[0, 0], [-3, 5], [7, -2]]) {
      const a = g1.generate(cx, cz), b = g2.generate(cx, cz);
      expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const top = a.heightmap[x + z * 16];
        if (a.blocks[cidx(x, top, z)] === B.FROSTROOTS) expect(a.blocks[cidx(x, top - 1, z)]).toBe(B.FARMLAND);
      }
    }
  });
  it('village farms sometimes grow Frostroots (cold) or Sungourd stems (warm) beside the old crops', () => {
    const OLD = [B.WHEAT, B.CARROTS, B.POTATOES, B.BEETROOTS];
    const out = { taiga: { frost: 0, gourd: 0, old: 0 }, plains: { frost: 0, gourd: 0, old: 0 }, savanna: { frost: 0, gourd: 0, old: 0 }, desert: { frost: 0, gourd: 0, old: 0 } };
    for (let seed = 1; seed <= 60; seed++) {
      const g = new TerrainGenerator(seed);
      for (let rx = 0; rx <= 1; rx++) for (let rz = 0; rz <= 1; rz++) {
        const v = villageInRegion(g, rx, rz);
        if (!v) continue;
        for (const farm of v.pieces.filter((p) => p.type === 'farm')) {
          // stamp only the village pieces on empty ground: cheap and enough to read the crops
          const cx = Math.floor(farm.x0 / 16), cz = Math.floor(farm.z0 / 16);
          const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
          for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = MIN_Y; y <= v.y; y++) blocks[cidx(x, y, z)] = B.DIRT;
          stampVillages(g, blocks, meta, cx, cz);
          for (let x = Math.max(farm.x0, cx * 16); x <= Math.min(farm.x1, cx * 16 + 15); x++) for (let z = Math.max(farm.z0, cz * 16); z <= Math.min(farm.z1, cz * 16 + 15); z++) {
            const id = blocks[cidx(x - cx * 16, farm.y, z - cz * 16)], o = out[v.style];
            if (id === B.FROSTROOTS) o.frost++; else if (id === B.SUNGOURD_STEM) o.gourd++; else if (OLD.includes(id)) o.old++;
          }
        }
      }
    }
    expect(out.taiga.frost).toBeGreaterThan(0);
    expect(out.taiga.gourd + out.plains.frost + out.savanna.frost + out.desert.frost).toBe(0);
    expect(out.plains.gourd + out.savanna.gourd + out.desert.gourd).toBeGreaterThan(0);
    expect(out.taiga.old + out.plains.old + out.savanna.old).toBeGreaterThan(out.taiga.frost); // the old crops still dominate
  }, 120000);
});
