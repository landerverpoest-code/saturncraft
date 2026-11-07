// Ocean and sky round: the deep sea (Deep Ocean and Kelp Forest biomes, trenches, Gleamkelp, Abyssal Grottos, Lanternfin and Trenchmaw,
// the Diver's Lamp and Helm, fishing) and the Cloud Isles (Cirrusstone, the Beanstalk, Skybeans, Skyrays).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { TerrainGenerator } from '../src/world/generator.js';
import { B, BLOCKS, SOLID, isWaterish, NUM_BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS, heldLightLevel } from '../src/world/items.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { toWorld } from '../src/world/siteKit.js';
import {
  DEEP_TOP, TRENCH_MAX, TRENCH_FLOOR, trenchCut, seaBiomeFor, grottoInRegion, grottosNear, grottoBlock, grottoChests, grottoGuardSpots,
  GROTTO_CHESTS, GROTTO_LOOT, GROTTO_R, kelpForestNoise, FOREST_THRESHOLD,
} from '../src/world/deepSea.js';
import { isleInRegion, isleNear, isleBlock, isleSolid, isleChests, plotStalks, anchorLocal, ISLE_DEPTH, ISLE_LOOT, nearestIsle, isleRaySpots } from '../src/world/skyIsles.js';
import { depthDarkness, underwaterView, helmUsable, helmWears, lampLevel, HELM_LIGHT, HELM_WEAR_TICKS } from '../src/player/diving.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { Mob } from '../src/mobs/mob.js';
import { lampScareRange, mawMayLunge, MAW, rayRingPoint, RAY, OCEAN_SKY_HABITATS } from '../src/mobs/oceanSky.js';
import { MODELS } from '../src/mobs/models.js';
import { rollDrops } from '../src/mobs/drops.js';
import { rollCatch, DEEP_CATCH } from '../src/entities/bobber.js';
import { blockDrops } from '../src/world/mining.js';
import { randomTickBlock, BEANSTALK_MAX, RANDOM_TICKS } from '../src/world/randomTicks.js';
import { SMELTING, RECIPES } from '../src/player/crafting.js';
import { STRUCTURE_LOOT, LOOT } from '../src/mobs/spawnerBlocks.js';
import { LANDMARK_KINDS } from '../src/world/landmarkKinds.js';
import { landmarksInBox } from '../src/world/landmarks.js';
import { MILESTONES } from '../src/player/milestones.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { CAPTION_TEXT } from '../src/ui/accessibility.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { MockWorld } from './helpers.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SEED = 42;
const gen = new TerrainGenerator(SEED);
const chunkCache = new Map();
const chunkAt = (cx, cz, g = gen) => { const k = `${g.seed},${cx},${cz}`; if (!chunkCache.has(k)) chunkCache.set(k, g.generate(cx, cz)); return chunkCache.get(k); };
const blockAt = (x, y, z, g = gen) => chunkAt(x >> 4, z >> 4, g).blocks[cidx(x & 15, y, z & 15)];
const metaAt = (x, y, z, g = gen) => chunkAt(x >> 4, z >> 4, g).meta[cidx(x & 15, y, z & 15)];
const firstSite = (fn, g = gen, n = 14) => { for (let rx = -n; rx < n; rx++) for (let rz = -n; rz < n; rz++) { const s = fn(g, rx, rz); if (s) return s; } return null; };
const allSites = (fn, g = gen, n = 12) => { const o = []; for (let rx = -n; rx < n; rx++) for (let rz = -n; rz < n; rz++) { const s = fn(g, rx, rz); if (s) o.push(s); } return o; };

describe('append-only ids', () => {
  it('adds biomes 24 and 25 after the Highland Meadow', () => {
    expect(BIOME.HIGHLAND_MEADOW).toBe(23);
    expect(BIOME.DEEP_OCEAN).toBe(24); expect(BIOME.KELP_FOREST).toBe(25);
    BIOMES.forEach((b, i) => expect(b.id).toBe(i));
    expect(BIOMES[24].key).toBe('deep_ocean'); expect(BIOMES[25].key).toBe('kelp_forest');
  });
  it('appends the three blocks and six items without shifting anything', () => {
    expect(B.SNARE_POST).toBeLessThan(B.CIRRUSSTONE);
    expect(B.BEANSTALK).toBe(B.CIRRUSSTONE + 1); expect(B.GLEAMKELP).toBe(B.CIRRUSSTONE + 2);
    expect(B.GLEAMKELP).toBeLessThan(NUM_BLOCKS);
    expect(I.COLOSSUS_CORE).toBeLessThan(I.RAW_LANTERNFIN);
    const keys = ['RAW_LANTERNFIN', 'COOKED_LANTERNFIN', 'LANTERN_GLAND', 'DIVERS_LAMP', 'DIVERS_HELM', 'SKYBEAN'];
    keys.forEach((k, i) => { expect(I[k]).toBe(I.RAW_LANTERNFIN + i); });
  });
  it('keeps the mob snapshot at 25 fields', () => {
    const m = new Mob('lanternfin', 0, 40, 0);
    expect(packMob(m)).toHaveLength(25);
    expect(unpackMob(JSON.parse(JSON.stringify(packMob(m)))).type).toBe('lanternfin');
    for (const t of ['trenchmaw', 'skyray']) expect(unpackMob(packMob(new Mob(t, 0, 40, 0))).type).toBe(t);
    expect(MOB_KEYS.indexOf('lanternfin')).toBeGreaterThan(MOB_KEYS.indexOf('tarnling'));
  });
});

describe('Deep Ocean, Kelp Forest and trenches', () => {
  it('names the biome from the floor depth and the kelp noise', () => {
    expect(seaBiomeFor(gen, BIOME.OCEAN, DEEP_TOP, 0, 0)).toBe(BIOME.DEEP_OCEAN);
    expect(seaBiomeFor(gen, BIOME.OCEAN, DEEP_TOP + 1, 5, 5)).not.toBe(BIOME.DEEP_OCEAN);
    expect(seaBiomeFor(gen, BIOME.FROZEN_OCEAN, 20, 0, 0)).toBe(BIOME.FROZEN_OCEAN); // (only the plain ocean is painted)
    expect(seaBiomeFor(gen, BIOME.BEACH, 20, 0, 0)).toBe(BIOME.BEACH);
    let forest = 0;
    for (let x = -300; x < 300; x += 7) for (let z = -300; z < 300; z += 7) if (seaBiomeFor(gen, BIOME.OCEAN, SEA_LEVEL - 12, x, z) === BIOME.KELP_FOREST) { forest++; expect(kelpForestNoise(gen, x, z)).toBeGreaterThan(FOREST_THRESHOLD); }
    expect(forest).toBeGreaterThan(100);
  });
  it('cuts trenches that are continuous, bounded and the same wherever they are asked', () => {
    let cut = 0, deepest = 0;
    for (let x = -1500; x < 1500; x += 5) for (let z = -1500; z < 1500; z += 5) { const c = trenchCut(gen, x, z); if (c > 0) { cut++; deepest = Math.max(deepest, c); } expect(c).toBeLessThanOrEqual(TRENCH_MAX); }
    expect(cut).toBeGreaterThan(500); expect(deepest).toBeGreaterThanOrEqual(8);
    expect(trenchCut(gen, 123, -456)).toBe(trenchCut(new TerrainGenerator(SEED), 123, -456));
    // neighbouring blocks never differ by more than a few blocks of cut (no sheer needles)
    for (let x = -400; x < 400; x += 3) for (let z = -400; z < 400; z += 3) expect(Math.abs(trenchCut(gen, x, z) - trenchCut(gen, x + 1, z))).toBeLessThanOrEqual(9);
  });
  it('paints the biomes into generated chunks, cuts trenches under the water and puts Gleamkelp and kelp on the floor', () => {
    // find a stretch of deep ocean in this seed
    let found = null;
    for (let x = -3000; x < 3000 && !found; x += 32) for (let z = -3000; z < 3000 && !found; z += 32) {
      const col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (gen.biomeFor(col, top) === BIOME.OCEAN && top <= DEEP_TOP - 2) found = [x >> 4, z >> 4];
    }
    expect(found).not.toBeNull();
    let deep = 0, gleam = 0, kelp = 0, forests = 0;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      const r = chunkAt(found[0] + dx, found[1] + dz);
      for (let i = 0; i < 256; i++) { if (r.biomes[i] === BIOME.DEEP_OCEAN) deep++; if (r.biomes[i] === BIOME.KELP_FOREST) forests++; }
      for (let i = 0; i < r.blocks.length; i++) { if (r.blocks[i] === B.GLEAMKELP) gleam++; else if (r.blocks[i] === B.KELP) kelp++; }
    }
    expect(deep).toBeGreaterThan(500); expect(gleam).toBeGreaterThan(5);
    expect(kelp + forests).toBeGreaterThan(0);
  });
  it('digs a trench whose floor is under water, water-filled to the sea and never below the floor limit', () => {
    let x0 = null;
    for (let x = -2500; x < 2500 && x0 === null; x += 4) for (let z = -2500; z < 2500; z += 4) {
      const col = gen.column(x, z), top = gen.surfaceAt(x, z, col);
      if (trenchCut(gen, x, z) >= 8 && gen.biomeFor(col, top) === BIOME.OCEAN && top <= DEEP_TOP) { x0 = [x, z, top]; break; }
    }
    expect(x0).not.toBeNull();
    const [x, z, top] = x0;
    const r = chunkAt(x >> 4, z >> 4), ci = (x & 15) + (z & 15) * 16;
    if (r.heightmap[ci] < top) { // (unless a structure kept the pass out of this chunk)
      const floor = r.heightmap[ci];
      expect(floor).toBeGreaterThanOrEqual(TRENCH_FLOOR);
      for (let y = floor + 1; y <= SEA_LEVEL - 1; y++) expect(isWaterish(blockAt(x, y, z))).toBe(true);
      expect(SOLID[blockAt(x, floor, z)]).toBe(1);
    }
  });
  it('is deterministic: a chunk generates the same twice and the pass leaves land columns alone', () => {
    const a = gen.generate(-93, -55), b = new TerrainGenerator(SEED).generate(-93, -55);
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    expect(Array.from(a.biomes)).toEqual(Array.from(b.biomes));
  });
});

describe('Abyssal Grottos', () => {
  const grottos = allSites(grottoInRegion, gen, 14);
  it('are planned on deep, level ocean floor, away from other structures, the same on every machine', () => {
    expect(grottos.length).toBeGreaterThan(5);
    for (const g of grottos) {
      const col = gen.column(g.cx, g.cz), top = gen.surfaceAt(g.cx, g.cz, col);
      expect([BIOME.OCEAN, BIOME.FROZEN_OCEAN]).toContain(gen.biomeFor(col, top));
      expect(g.y).toBeLessThanOrEqual(DEEP_TOP + 4);
      expect(trenchCut(gen, g.cx, g.cz)).toBe(0);
      expect(grottosNear(gen, g.cx, g.cz, g.cx, g.cz)).toContainEqual(g);
    }
    const other = new TerrainGenerator(SEED);
    const g = grottos[0];
    expect(grottoInRegion(other, Math.floor(g.cx / 160), Math.floor(g.cz / 160))).toEqual(g);
  });
  it('is a rock dome with a flooded hall, an open mouth, Gleamkelp and three chests of existing loot tables', () => {
    const g = grottos[0];
    const kinds = new Set();
    let water = 0, shell = 0, gleam = 0, lantern = 0, planks = 0;
    for (let u = -13; u <= 13; u++) for (let v = -13; v <= 13; v++) for (let dy = -4; dy <= 11; dy++) {
      const bl = grottoBlock(g, u, dy, v);
      if (!bl) continue;
      if (bl[0] === B.WATER) water++; else if (bl[0] === B.GLEAMKELP) gleam++; else if (bl[0] === B.TIDE_LANTERN) lantern++; else if (bl[0] === B.OAK_PLANKS || bl[0] === B.DARK_OAK_PLANKS) planks++;
      else if (bl[0] === B.CHEST) { kinds.add(bl[1] >> 4); expect(bl[1] & 8).toBe(8); } else shell++;
    }
    expect(water).toBeGreaterThan(300); expect(shell).toBeGreaterThan(300); expect(gleam).toBeGreaterThan(3); expect(lantern).toBeGreaterThan(0); expect(planks).toBeGreaterThan(3);
    expect([...kinds].sort((a, b) => a - b)).toEqual([GROTTO_LOOT.hull, GROTTO_LOOT.dais, GROTTO_LOOT.side].sort((a, b) => a - b));
    for (const k of kinds) expect(STRUCTURE_LOOT[k]).toBeDefined();
    expect(GROTTO_CHESTS).toHaveLength(3);
    // the mouth is open at the foot of the +u wall, and the hall is closed at the back
    expect(grottoBlock(g, 10, 2, 0)[0]).toBe(B.WATER);
    expect(grottoBlock(g, -10, 3, 0)[0]).not.toBe(B.WATER);
    // nothing beyond the dome
    expect(grottoBlock(g, 14, 2, 0)).toBeNull(); expect(grottoBlock(g, 0, 12, 0)).toBeNull();
  });
  it('stamps its chests into the world where the planner says, with Trenchmaw spots in the hall', () => {
    const g = grottos[0];
    const cells = grottoChests(g);
    expect(cells).toHaveLength(3);
    let chests = 0;
    for (const c of cells) if (blockAt(c.x, c.y, c.z) === B.CHEST) { chests++; expect(metaAt(c.x, c.y, c.z) & 8).toBe(8); }
    expect(chests).toBe(3);
    const spots = grottoGuardSpots(g);
    expect(spots.length).toBe(2);
    for (const [x, y, z] of spots) expect(isWaterish(blockAt(x, y, z))).toBe(true);
  });
});

describe('Cloud Isles', () => {
  const isles = allSites(isleInRegion, gen, 12);
  it('are planned over low, dry ground, clear of mountains, in about half the regions', () => {
    expect(isles.length).toBeGreaterThan(40);
    for (const s of isles.slice(0, 30)) {
      expect(s.ground).toBeGreaterThan(SEA_LEVEL + 1); expect(s.ground).toBeLessThanOrEqual(100);
      expect(s.y).toBeGreaterThanOrEqual(130);
      expect(s.y - ISLE_DEPTH - 12).toBeGreaterThan(gen.surfaceAt(s.cx, s.cz));
      expect(isleNear(gen, s.cx, s.cz, s.cx, s.cz)).toContainEqual(s);
    }
    expect(nearestIsle(gen, 0, 0)).not.toBeNull();
  });
  it('has grass over dirt over Cirrusstone with ore, an Aerie with two chests and a bean plot', () => {
    const s = isles[0];
    const kinds = new Set(); let grass = 0, cirrus = 0, ore = 0, brick = 0, bean = 0, water = 0;
    for (let u = -20; u <= 20; u++) for (let v = -20; v <= 20; v++) for (let dy = -ISLE_DEPTH; dy <= 6; dy++) {
      const bl = isleBlock(s, u, dy, v);
      if (!bl) continue;
      const id = bl[0];
      if (id === B.GRASS) grass++; else if (id === B.CIRRUSSTONE) cirrus++; else if (id === B.IRON_ORE || id === B.COAL_ORE || id === B.GOLD_ORE || id === B.DIAMOND_ORE) ore++;
      else if (id === B.STONE_BRICKS || id === B.MOSSY_STONE_BRICKS || id === B.CRACKED_STONE_BRICKS) brick++; else if (id === B.BEANSTALK) bean++; else if (id === B.WATER) water++;
      else if (id === B.CHEST) kinds.add(bl[1] >> 4);
    }
    expect(grass).toBeGreaterThan(100); expect(cirrus).toBeGreaterThan(200); expect(ore).toBeGreaterThan(5); expect(brick).toBeGreaterThan(30); expect(bean).toBeGreaterThan(5); expect(water).toBeGreaterThan(5);
    expect([...kinds].sort((a, b) => a - b)).toEqual([ISLE_LOOT.hoard, ISLE_LOOT.library].sort((a, b) => a - b));
    for (const k of kinds) expect(STRUCTURE_LOOT[k]).toBeDefined();
    expect(plotStalks(s)).toHaveLength(3);
    // the rock hangs under the grass and narrows to nothing
    expect(isleSolid(s, 0, 0, 0)).toBe(true); expect(isleSolid(s, 0, -ISLE_DEPTH, 0)).toBe(false); expect(isleSolid(s, 0, 1, 0)).toBe(false);
  });
  it('is stamped into the world with its chests, and the wild Beanstalk is one unbroken climb from the ground to the top', () => {
    const s = isles.find((i) => i.ground < 90) || isles[0];
    for (const c of isleChests(s)) expect(blockAt(c.x, c.y, c.z)).toBe(B.CHEST);
    expect(blockAt(s.cx, s.y, s.cz)).toBe(B.GRASS);
    for (let y = s.ground + 1; y <= s.y + 1; y++) expect(blockAt(s.ax, y, s.az)).toBe(B.BEANSTALK);
    expect(blockAt(s.ax, s.y + 2, s.az)).not.toBe(B.BEANSTALK);
    expect(SOLID[blockAt(s.ax, s.ground, s.az)]).toBe(1);
    const [wu, wv] = anchorLocal(s);
    expect(Math.hypot(wu, wv)).toBeLessThan(3);
  });
  it('leaves the terrain below alone and does not touch chunks away from the isle', () => {
    const s = isles[0];
    const far = gen.generate((s.cx >> 4) + 40, (s.cz >> 4) + 40);
    const again = new TerrainGenerator(SEED).generate((s.cx >> 4) + 40, (s.cz >> 4) + 40);
    expect(Buffer.from(far.blocks.buffer).equals(Buffer.from(again.blocks.buffer))).toBe(true);
  });
});

describe('Beanstalk', () => {
  it('is a thin, climbable, non-solid plant that stands on ground or on itself and grows from random ticks', () => {
    const d = BLOCKS[B.BEANSTALK];
    expect(d.solid).toBe(false); expect(d.climbable).toBe(true);
    expect(RANDOM_TICKS[B.BEANSTALK]).toBe(1);
    const w = new MockWorld(60);
    w.setBlock = (x, y, z, id, meta = 0) => w.set(x, y, z, id, meta);
    w.set(0, 60, 0, B.BEANSTALK);
    randomTickBlock(w, 0, 60, 0, B.BEANSTALK, () => 0);
    expect(w.getBlock(0, 61, 0)).toBe(B.BEANSTALK);
    randomTickBlock(w, 0, 61, 0, B.BEANSTALK, () => 0);
    expect(w.getBlock(0, 62, 0)).toBe(B.BEANSTALK);
    // it will not grow into a block, nor on a roll that fails, nor past its limit
    w.set(5, 60, 0, B.BEANSTALK); w.set(5, 61, 0, B.STONE);
    randomTickBlock(w, 5, 60, 0, B.BEANSTALK, () => 0);
    expect(w.getBlock(5, 61, 0)).toBe(B.STONE);
    w.set(8, 60, 0, B.BEANSTALK);
    randomTickBlock(w, 8, 60, 0, B.BEANSTALK, () => 0.99);
    expect(w.getBlock(8, 61, 0)).toBe(B.AIR);
    for (let y = 60; y < 60 + BEANSTALK_MAX; y++) w.set(12, y, 0, B.BEANSTALK);
    randomTickBlock(w, 12, 60 + BEANSTALK_MAX - 1, 0, B.BEANSTALK, () => 0);
    expect(w.getBlock(12, 60 + BEANSTALK_MAX, 0)).toBe(B.AIR);
  });
  it('is climbed like a ladder and a Skybean plants it', () => {
    expect(src('src/physics/body.js')).toContain('B.BEANSTALK');
    expect(ITEMS[I.SKYBEAN].places).toBe(B.BEANSTALK);
    const hasSupport = src('src/world/world.js');
    expect(hasSupport).toContain('id === B.BEANSTALK');
  });
  it('drops a Skybean now and then, not one for each segment', () => {
    let beans = 0;
    for (let k = 0; k < 2000; k++) beans += blockDrops(B.BEANSTALK, undefined, Math.random).filter((d) => d.id === I.SKYBEAN).length;
    expect(beans).toBeGreaterThan(40); expect(beans).toBeLessThan(250);
  });
});

describe('Diver\'s gear', () => {
  const stack = (id, damage = 0) => ({ id, count: 1, damage });
  const inv = (held, helm) => ({ selectedStack: held, armor: [helm || null] });
  it('the lamp is a hand light and the helm has a brow lamp that scares less', () => {
    expect(heldLightLevel(I.DIVERS_LAMP)).toBe(13);
    expect(lampLevel(inv(stack(I.DIVERS_LAMP)))).toBe(13);
    expect(lampLevel(inv(null, stack(I.DIVERS_HELM)))).toBe(HELM_LIGHT);
    expect(lampLevel(inv(stack(I.DIAMOND)))).toBe(0);
    expect(lampLevel(inv(stack(B.LANTERN)))).toBe(15);
    expect(lampLevel(inv(null, stack(I.DIVERS_HELM, ITEMS[I.DIVERS_HELM].durability - 1)))).toBe(0); // worn out
  });
  it('the helm works until it is down to its last point and wears every three seconds', () => {
    expect(helmUsable(stack(I.DIVERS_HELM))).toBe(true);
    expect(helmUsable(stack(I.DIVERS_HELM, ITEMS[I.DIVERS_HELM].durability - 1))).toBe(false);
    expect(helmUsable(stack(I.IRON_HELMET))).toBe(false); expect(helmUsable(null)).toBe(false);
    expect(helmWears(HELM_WEAR_TICKS)).toBe(true); expect(helmWears(HELM_WEAR_TICKS + 1)).toBe(false); expect(helmWears(0)).toBe(false);
    expect(ITEMS[I.DIVERS_HELM].armor.diver).toBe(true); expect(ITEMS[I.DIVERS_HELM].armor.slot).toBe(0);
    expect(ITEMS[I.DIVERS_HELM].repairWith).toBe('LANTERN_GLAND');
  });
  it('is made from a Lantern Gland, glass pane and iron', () => {
    for (const out of [I.DIVERS_LAMP, I.DIVERS_HELM]) {
      const r = RECIPES.find((x) => x.result === out);
      expect(r).toBeTruthy();
      expect(Object.values(r.key)).toEqual(expect.arrayContaining([I.LANTERN_GLAND, B.GLASS_PANE, I.IRON_INGOT]));
    }
    expect(SMELTING[I.RAW_LANTERNFIN]).toBe(I.COOKED_LANTERNFIN);
  });
  it('the sea darkens with depth and a lamp or night vision wins some of it back', () => {
    expect(depthDarkness(SEA_LEVEL - 4)).toBe(0); expect(depthDarkness(SEA_LEVEL - 13)).toBeGreaterThan(0); expect(depthDarkness(10)).toBe(1);
    let last = -1;
    for (let y = SEA_LEVEL; y > 0; y -= 5) { const d = depthDarkness(y); expect(d).toBeGreaterThanOrEqual(last); last = d; }
    const dark = underwaterView(15, {}), lamp = underwaterView(15, { lamp: 13 }), nv = underwaterView(15, { nightVision: 1 }), shallow = underwaterView(SEA_LEVEL - 2, {});
    expect(shallow.dim).toBe(0); expect(dark.dim).toBeGreaterThan(0.7); expect(lamp.dim).toBeLessThan(dark.dim); expect(nv.dim).toBeLessThan(lamp.dim);
    expect(lamp.far).toBeGreaterThan(dark.far); expect(underwaterView(15, { breathing: true }).far).toBeGreaterThan(dark.far);
  });
});

describe('Lanternfin, Trenchmaw and Skyray', () => {
  it('are registered with models, voices and drops', () => {
    for (const k of ['lanternfin', 'trenchmaw', 'skyray']) {
      expect(MOBS[k]).toBeDefined(); expect(MODELS[k].parts.length).toBeGreaterThan(4);
      expect(CAPTION_TEXT[MOBS[k].sound]).toBeTruthy();
      expect(src('src/audio/audio.js')).toContain(`case '${MOBS[k].sound}'`);
    }
    expect(MOBS.lanternfin.fish).toBe(true); expect(MOBS.trenchmaw.category).toBe(CATEGORY.MONSTER); expect(MOBS.skyray.flying).toBe(true);
    expect(MODELS.lanternfin.parts.some((p) => p[5] && p[5].emissive)).toBe(true); // the glowing lure
    const drops = rollDrops('lanternfin', { onFire: true }, () => 0);
    expect(drops.map((d) => d.id)).toContain(I.COOKED_LANTERNFIN);
    expect(rollDrops('skyray', {}, () => 0.99).length).toBeGreaterThan(0);
  });
  it('a Trenchmaw lunges only inside its range and outside a lamp\'s scare range', () => {
    expect(lampScareRange(0)).toBe(0); expect(lampScareRange(HELM_LIGHT)).toBe(5); expect(lampScareRange(13)).toBe(10); expect(lampScareRange(15)).toBe(10);
    expect(mawMayLunge(4, 0, 0)).toBe(true);
    expect(mawMayLunge(MAW.LUNGE_RANGE + 1, 0, 0)).toBe(false);
    expect(mawMayLunge(4, 0, 10)).toBe(false);
    expect(mawMayLunge(4, 13, 0)).toBe(false); // a Diver's Lamp keeps it off
    expect(mawMayLunge(5.5, HELM_LIGHT, 0)).toBe(true); expect(mawMayLunge(4, HELM_LIGHT, 0)).toBe(false);
  });
  it('a Trenchmaw bites a swimmer in the dark and backs off from a lamp (ownAI)', () => {
    class Sea extends MockWorld {
      getBlock(x, y, z) { const k = this.key(x, y, z); if (this.blocks.has(k)) return this.blocks.get(k); return y < 10 ? B.STONE : y < 50 ? B.WATER : B.AIR; }
      raycast() { return null; } isLoaded() { return true; } heightAt() { return 9; }
    }
    const w = new Sea(10);
    const calls = [];
    const g = { world: w, ticks: 100, audio: { play: () => {} }, entities: { list: [] }, particles: { emit() {}, smoke() {} } };
    const mk = (lampItem) => {
      const hurts = [];
      const p = { x: 3, y: 30, z: 0, dead: false, creative: false, effects: {}, isPlayer: true, body: { inWater: true, eyeInWater: true }, hurt: (d, s) => { hurts.push([d, s]); return true; }, inventory: { selectedStack: lampItem ? { id: lampItem, count: 1 } : null, armor: [null] } };
      const m = new Mob('trenchmaw', 0, 30, 0); m._game = g; m.def.onSpawn(m); m.body.inWater = true; g.entities.list.push(m);
      return { p, m, hurts };
    };
    const dark = mk(null);
    for (let k = 0; k < 120; k++) { g.ticks++; dark.m.def.ownAI(dark.m, g, dark.p, Math.hypot(dark.p.x - dark.m.x, dark.p.y - dark.m.y, dark.p.z - dark.m.z)); dark.m.body.x += dark.m.body.vx; dark.m.body.y += dark.m.body.vy; dark.m.body.z += dark.m.body.vz; dark.m.body.vx *= 0.8; dark.m.body.vy *= 0.8; dark.m.body.vz *= 0.8; }
    expect(dark.hurts.length).toBeGreaterThan(0); expect(dark.hurts[0][0]).toBe(MAW.DAMAGE); expect(dark.hurts[0][1]).toBe('mob:Trenchmaw');
    const lit = mk(I.DIVERS_LAMP);
    for (let k = 0; k < 120; k++) { g.ticks++; lit.m.def.ownAI(lit.m, g, lit.p, Math.hypot(lit.p.x - lit.m.x, lit.p.y - lit.m.y, lit.p.z - lit.m.z)); lit.m.body.x += lit.m.body.vx; lit.m.body.y += lit.m.body.vy; lit.m.body.z += lit.m.body.vz; lit.m.body.vx *= 0.8; lit.m.body.vy *= 0.8; lit.m.body.vz *= 0.8; }
    expect(lit.hurts).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
  it('a Skyray circles its isle on a rising and falling ring', () => {
    const home = { x: 100, y: 140, z: -50 };
    for (let a = 0; a < 6.3; a += 0.5) {
      const pt = rayRingPoint(home, a, 15, 3);
      expect(Math.hypot(pt.x - home.x, pt.z - home.z)).toBeCloseTo(15, 5);
      expect(pt.y).toBeGreaterThan(home.y + RAY.CLIMB - 4); expect(pt.y).toBeLessThan(home.y + RAY.CLIMB + 4);
    }
    const s = isleInRegion(gen, ...(() => { for (let rx = -9; rx < 9; rx++) for (let rz = -9; rz < 9; rz++) if (isleInRegion(gen, rx, rz)) return [rx, rz]; })());
    const spots = isleRaySpots(s);
    expect(spots).toHaveLength(2);
    for (const sp of spots) { expect(sp.y).toBeGreaterThan(s.y + 5); expect(Math.hypot(sp.x - s.cx, sp.z - s.cz)).toBeLessThan(15); }
  });
  it('has habitat notes, a Field Guide entry each and counts apart from the fish and ambient caps', () => {
    resetGuideEntries();
    const creatures = entriesOf('creatures');
    for (const k of ['lanternfin', 'trenchmaw', 'skyray']) {
      const e = creatures.find((c) => c.key === k);
      expect(e).toBeTruthy(); expect(e.habitat.length).toBeGreaterThan(0);
    }
    expect(OCEAN_SKY_HABITATS.lanternfin).toContain('deep_ocean');
    const biomes = entriesOf('biomes');
    expect(biomes.find((b) => b.key === 'deep_ocean').wildlife).toContain('Lanternfin');
    expect(biomes.find((b) => b.key === 'kelp_forest')).toBeTruthy();
    const structures = entriesOf('structures').map((s) => s.key);
    expect(structures).toContain('grotto'); expect(structures).toContain('isle');
    expect(src('src/mobs/spawner.js')).toContain('e.def.deepSea || e.def.glider');
  });
});

describe('fishing, landmarks and progress', () => {
  it('deep water adds Lanternfins, Gleamkelp and treasure to the catch; shallow water does not', () => {
    const N = 20000;
    let r = 1; const rng = () => { r = (r * 1664525 + 1013904223) >>> 0; return r / 4294967296; };
    const tally = (biome) => { const c = {}; for (let k = 0; k < N; k++) { const x = rollCatch(rng, 0, biome); c[x.id] = (c[x.id] || 0) + 1; } return c; };
    const deep = tally('deep_ocean'), plain = tally('ocean');
    expect(deep[I.RAW_LANTERNFIN]).toBeGreaterThan(N * 0.25);
    expect(plain[I.RAW_LANTERNFIN] || 0).toBe(0);
    expect((deep[B.GLEAMKELP] || 0) + (deep[I.LANTERN_GLAND] || 0)).toBeGreaterThan(50);
    expect(DEEP_CATCH.deep_ocean.fish).toBeGreaterThan(DEEP_CATCH.kelp_forest.fish);
    expect(plain[B.GLEAMKELP] || 0).toBe(0);
  });
  it('marks both structures on maps, in /locate and in milestones', () => {
    expect(LANDMARK_KINDS.map((k) => k.key)).toEqual(expect.arrayContaining(['grotto', 'isle']));
    const s = firstSite(isleInRegion), gr = firstSite(grottoInRegion);
    const found = landmarksInBox(gen, s.cx - 30, s.cz - 30, s.cx + 30, s.cz + 30);
    expect(found).toContainEqual({ kind: 'isle', x: s.cx, z: s.cz });
    expect(landmarksInBox(gen, gr.cx - 30, gr.cz - 30, gr.cx + 30, gr.cz + 30)).toContainEqual({ kind: 'grotto', x: gr.cx, z: gr.cz });
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ['grotto', 'diver', 'kelp_forest', 'isle']) expect(ids).toContain(id);
    expect(src('src/ui/commands.js')).toContain('grotto|isle');
  });
  it('is in the README, the Help screen and uses no forbidden words', () => {
    expect(src('README.md')).toContain('Ocean and sky round');
    expect(src('src/ui/helpTopics.js')).toContain("add('depths'");
    const files = ['src/world/deepSea.js', 'src/world/skyIsles.js', 'src/mobs/oceanSky.js', 'src/player/diving.js', 'src/world/oceanSkyTextures.js', 'tests/ocean_sky.test.js'];
    for (const f of files) {
      const text = src(f);
      for (const w of [['mine', 'craft'], ['red', 'stone']]) expect(text.toLowerCase()).not.toContain(w.join(''));
      expect(text).not.toMatch(new RegExp('\\b' + ['Neth', 'er'].join('') + '\\b', 'i'));
    }
  });
});
