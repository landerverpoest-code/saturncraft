// Ambient fauna (butterflies, fireflies, leaves, skimmers, bird flocks) and the four new overworld mobs
// (Thistlehorn, Dustmole, Gloamlynx, Tarnling).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { SPAWN_TABLES, spawnTable, pickProbabilities } from '../src/mobs/spawnRules.js';
import { MobSpawner } from '../src/mobs/spawner.js';
import { rollDrops } from '../src/mobs/drops.js';
import {
  THISTLE, MOLE, LYNX, TARN, SPECIAL_HABITATS, TARN_COLORS, THISTLE_COATS, watchedBy, lynxScared, lynxMaySpawn, stalkMove, orbitPoint,
  moleSurfaces, moleSpooked, moleDepth, tarnDepth, tarnSpot, moleSpot, alarm, catchTarnling, releaseTarnling, tarnlingBucket, faunaTick,
  sandPuff,
} from '../src/mobs/fauna.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { BIOMES, BIOME } from '../src/world/biomes.js';
import { B, SOLID } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { SMELTING } from '../src/player/crafting.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { modelRects } from '../src/ui/guideArt.js';
import { CAPTION_TEXT, captionText, motionScales, FULL_FX } from '../src/ui/accessibility.js';
import { EntityManager } from '../src/entities/entities.js';
import { LEAVES } from '../src/world/trees.js';
import {
  fillCell, KINDS, CAPS, CELL, VIEW, DENSITY, BIRD_RANGE, BIRD_HEIGHT, FLOCK_MAX, kindFactors, critterScales, seedNumber, hash01, newPools, rebuild,
  critterPos, birdPos, wrapAround, flockCount, flockSize,
} from '../src/world/critterRules.js';
import { Critters } from '../src/render/critters.js';
import { climate, neutralClimate, applyValues, SEASON_DATA, resetClimate } from '../src/world/seasons.js';
import { MockWorld } from './helpers.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const noop = () => {};

// ---------------------------------------------------------------------------------------------
// fakes

/** A flat world with a surface at y 63 (block 63 is the top), plus the lookups the fauna code uses. */
class FlatWorld extends MockWorld {
  constructor(biome = BIOME.PLAINS, surface = B.GRASS) {
    super(60);
    this.biome = biome; this.surface = surface; this.dimension = 'overworld'; this.seed = 7;
    this.blightless = true;
  }
  getBlock(x, y, z) {
    const k = this.key(x, y, z);
    if (this.blocks.has(k)) return this.blocks.get(k);
    if (y < 63) return B.STONE;
    return y === 63 ? this.surface : B.AIR;
  }
  isLoaded() { return true; }
  biomeAt(x, z) { return typeof this.biome === 'function' ? this.biome(x, z) : this.biome; }
  heightAt(x, z) {
    for (let y = 120; y > 0; y--) if (this.getBlock(x, y, z) !== B.AIR) return y;
    return 0;
  }
  skyLight() { return 15; }
  blockLight(x, y, z) { return this.lights ? this.lights(x, y, z) : 0; }
  setBlock(x, y, z, id) { this.set(x, y, z, id); }
  raycast() { return null; }
}

function fakeGame(world = new FlatWorld(), over = {}) {
  const items = [];
  const g = {
    world, ticks: 100, time: 0, items, played: [], puffs: 0,
    sky: { state: { combined: 0.2, skyDarken: 11 } },
    weather: { level: 0 },
    seasons: { state: { key: 'summer' } },
    fx: FULL_FX,
    audio: { play: (name) => g.played.push(name) },
    particles: { emit: () => { g.puffs++; }, smoke: noop },
    entities: { list: [], spawnItem: (x, y, z, st) => items.push(st), spawnXp: noop },
    player: null,
    ...over,
  };
  g.spawner = { game: g, canFit: () => true, spawnMob: (type, x, y, z) => { const m = new Mob(type, x, y, z); m._game = g; if (m.def.onSpawn) m.def.onSpawn(m); g.entities.list.push(m); return m; } };
  return g;
}

function fakePlayer(x, y, z, over = {}) {
  const slots = [null];
  const inv = {
    selected: 0, slots, armor: [],
    get selectedStack() { return this.slots[this.selected]; },
    removeFromSlot(i, n = 1) { const s = this.slots[i]; if (!s) return null; s.count -= n; if (s.count <= 0) this.slots[i] = null; return s; },
    add(st) { for (let i = 0; i < this.slots.length; i++) if (!this.slots[i]) { this.slots[i] = st; return 0; } return st.count; },
    changed: noop,
  };
  return {
    x, y, z, dead: false, creative: false, sprinting: false, sneaking: false, yaw: 0, pitch: 0, inventory: inv, isPlayer: true,
    eyePos() { return [this.x, this.y + 1.62, this.z]; },
    lookDir() { return this.look || [0, 0, -1]; },
    hurt: noop, ...over,
  };
}

/** A Mob of `type` standing at x,y,z in the fake game, ticking its own AI by hand. */
function put(g, type, x, y, z) {
  const m = new Mob(type, x, y, z);
  m._game = g;
  if (m.def.onSpawn) m.def.onSpawn(m);
  g.entities.list.push(m);
  return m;
}
const think = (m, g, n = 1) => { for (let k = 0; k < n; k++) { g.ticks++; const p = g.player; m.def.ownAI(m, g, p, Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z)); } };

// ---------------------------------------------------------------------------------------------

describe('the four new mobs are in the tables', () => {
  it('register with names, voices and drops that exist', () => {
    for (const k of ['thistlehorn', 'dustmole', 'gloamlynx', 'tarnling']) {
      const d = MOBS[k];
      expect(d, k).toBeTruthy();
      expect(MOB_KEYS).toContain(k);
      expect(d.name.length).toBeGreaterThan(3);
      expect(d.category).toBe(CATEGORY.CREATURE);
      expect(typeof d.ownAI).toBe('function');
      expect(d.drops.length).toBeGreaterThan(0);
      for (const dr of d.drops) expect(ITEMS[dr.id] || dr.id === B.SAND, `${k} drop ${dr.id}`).toBeTruthy();
      expect(MODELS[k].parts.length).toBeGreaterThan(5);
      for (const [, , , , , o] of MODELS[k].parts) if (o && o.face) expect(typeof FACES[o.face]).toBe('function');
      expect(modelRects(MODELS[k]).length).toBe(MODELS[k].parts.length);
    }
  });

  it('use no forbidden names', () => {
    const text = src('src/mobs/fauna.js') + src('src/render/critters.js') + src('src/world/critterRules.js');
    for (const w of ['Minecraft', 'Nether', 'redstone']) expect(text).not.toContain(w);
  });

  it('have their own voices, played by audio.js and captioned', () => {
    const audio = src('src/audio/audio.js');
    for (const [k, v] of [['thistlehorn', 'thistle'], ['dustmole', 'burrow'], ['gloamlynx', 'yowl'], ['tarnling', 'plip']]) {
      expect(MOBS[k].sound).toBe(v);
      expect(audio).toContain(`case '${v}':`);
      expect(CAPTION_TEXT[v]).toBeTruthy();
      expect(captionText(v)).toMatch(/[a-z]/);
    }
    expect(CAPTION_TEXT.thistle).toMatch(/Thistlehorn/);
  });

  it('spawn in the biomes that had few: meadows, savannas, taiga and snow (tables) and desert / badlands / ponds (faunaTick)', () => {
    const has = (biome, type) => spawnTable(CATEGORY.CREATURE, BIOME[biome]).some((e) => e.type === type);
    expect(has('HIGHLAND_MEADOW', 'thistlehorn')).toBe(true);
    expect(has('SAVANNA', 'thistlehorn')).toBe(true);
    expect(has('TAIGA', 'gloamlynx')).toBe(true);
    expect(has('SNOWY_TAIGA', 'gloamlynx')).toBe(true);
    expect(has('SNOWY_PLAINS', 'gloamlynx')).toBe(true);
    expect(has('PLAINS', 'thistlehorn')).toBe(false);
    // the lynx is a rare sight next to the wolves and foxes
    const taiga = pickProbabilities(SPAWN_TABLES.creature.taiga);
    expect(taiga.gloamlynx).toBeGreaterThan(0);
    expect(taiga.gloamlynx).toBeLessThan(taiga.howler);
    expect(SPECIAL_HABITATS.dustmole).toEqual(['desert', 'badlands']);
    expect(SPECIAL_HABITATS.tarnling).toEqual(expect.arrayContaining(['savanna', 'highland_meadow', 'taiga']));
    for (const keys of Object.values(SPECIAL_HABITATS)) for (const k of keys) expect(BIOMES.some((b) => b.key === k), k).toBe(true);
  });

  it('show up in the Field Guide with habitats, drops and traits made from the tables', () => {
    resetGuideEntries();
    const e = (k) => entriesOf('creatures').find((x) => x.key === k);
    expect(e('thistlehorn').habitat).toEqual(expect.arrayContaining(['Highland Meadow', 'Savanna']));
    expect(e('gloamlynx').habitat).toEqual(expect.arrayContaining(['Taiga', 'Snowy Taiga']));
    expect(e('dustmole').habitat).toEqual(expect.arrayContaining(['Desert', 'Badlands']));
    expect(e('tarnling').habitat).toEqual(expect.arrayContaining(['Savanna', 'Highland Meadow']));
    expect(e('thistlehorn').feeds.length).toBe(2);
    expect(e('thistlehorn').drops).toEqual(expect.arrayContaining([I.RAW_VENISON, I.COOKED_VENISON, I.LEATHER]));
    expect(e('dustmole').traits).toContain('Burrows in sand');
    expect(e('gloamlynx').traits).toEqual(expect.arrayContaining(['Shy: flees from light', 'Out at dusk and by night']));
    expect(e('tarnling').traits).toContain('Can be caught in a bucket');
    const biome = (k) => entriesOf('biomes').find((x) => x.key === k);
    expect(biome('badlands').wildlife).toContain('Dustmole');
    expect(biome('highland_meadow').wildlife).toEqual(expect.arrayContaining(['Thistlehorn', 'Tarnling']));
    expect(entriesOf('items').some((x) => x.id === I.RAW_VENISON)).toBe(true);
  });
});

describe('venison and the bucket', () => {
  it('Raw Venison cooks to Roast Venison, which feeds well', () => {
    expect(SMELTING[I.RAW_VENISON]).toBe(I.COOKED_VENISON);
    expect(ITEMS[I.COOKED_VENISON].food.hunger).toBeGreaterThan(ITEMS[I.RAW_VENISON].food.hunger);
    expect(ITEMS[I.COOKED_VENISON].food.hunger).toBe(8);
  });

  it('a Thistlehorn drops leather and venison, cooked when it dies burning', () => {
    const r = (n) => () => n;
    const drops = rollDrops('thistlehorn', { killedByPlayer: true }, r(0.99));
    expect(drops.find((d) => d.id === I.RAW_VENISON).count).toBe(3);
    expect(drops.find((d) => d.id === I.LEATHER).count).toBe(2);
    expect(rollDrops('thistlehorn', { onFire: true }, r(0.5)).map((d) => d.id)).toContain(I.COOKED_VENISON);
  });

  it('the Bucket of Tarnling is a one-off bucket that pours water out', () => {
    const d = ITEMS[I.TARNLING_BUCKET];
    expect(d.stack).toBe(1);
    expect(d.places).toBe(B.WATER);
    expect(d.releases).toBe('tarnling');
    expect(d.name).toBe('Bucket of Tarnling');
    // appended: no earlier item id moved
    expect(I.TARNLING_BUCKET).toBeGreaterThan(I.DIRGESTEP_BOOTS);
    expect(I.COOKED_VENISON).toBe(I.RAW_VENISON + 1);
  });
});

describe('Thistlehorn: a grazing herd animal that breeds', () => {
  it('is a deer-sized creature with beetroot and sweet berries as breeding food', () => {
    const d = MOBS.thistlehorn;
    expect(d.food).toEqual([I.BEETROOT, I.SWEET_BERRIES]);
    expect(d.height).toBeGreaterThan(1.4);
    expect(d.drops.map((x) => x.id)).toContain(I.RAW_VENISON);
  });

  it('two fed adults have a fawn (the farm-animal breeding), which is half size and follows the grown-ups', () => {
    const g = fakeGame();
    g.player = fakePlayer(40, 64, 40);
    const a = put(g, 'thistlehorn', 0, 64, 0), b = put(g, 'thistlehorn', 1, 64, 0);
    expect(a.feed(g)).toBe(true); expect(b.feed(g)).toBe(true);
    expect(a.loveTicks).toBe(600);
    g.spawner.spawnMob = (type, x, y, z) => put(g, type, x, y, z);
    g.entities.spawnXp = noop; g.milestones = null;
    for (let k = 0; k < 90 && g.entities.list.length < 3; k++) { think(a, g); think(b, g); }
    const fawn = g.entities.list[2];
    expect(fawn && fawn.type).toBe('thistlehorn');
    expect(fawn.baby).toBe(true);
    expect(fawn.width).toBeCloseTo(MOBS.thistlehorn.width / 2, 5);
    // the fawn trots towards a grown one that is far off
    fawn.body.setPos(10, 64, 0);
    g.ticks = 20 * 5 + fawn.id % 20 - 1; // makes the parent lookup tick on the next thought
    const before = Math.hypot(a.x - fawn.x, a.z - fawn.z);
    think(fawn, g, 1);
    expect(fawn.move).toBeTruthy();
    expect(before).toBeGreaterThan(4);
  });

  it('grazes with its head down, then lifts it; babies graze more often', () => {
    const g = fakeGame();
    g.player = fakePlayer(60, 64, 60);
    const m = put(g, 'thistlehorn', 0.5, 64, 0.5);
    m.body.onGround = true;
    m.eatTimer = THISTLE.GRAZE_TICKS;
    think(m, g);
    expect(m.headPitch).toBeGreaterThan(0.5);
    for (let k = 0; k < THISTLE.GRAZE_TICKS - 1; k++) think(m, g);
    expect(m.eatTimer).toBe(0);
    expect(m.headPitch).toBe(0);
  });

  it('when one is hurt the whole herd bolts; others far away stay calm', () => {
    const g = fakeGame();
    g.player = fakePlayer(60, 64, 60);
    const a = put(g, 'thistlehorn', 0, 64, 0), near = put(g, 'thistlehorn', 5, 64, 3), far = put(g, 'thistlehorn', 40, 64, 0), other = put(g, 'fleecer', 2, 64, 2);
    expect(a.hurt(1, 'player', null, 0)).toBe(true);
    expect(near.panicTicks).toBeGreaterThanOrEqual(THISTLE.ALARM_TICKS);
    expect(far.panicTicks).toBe(0);
    expect(other.panicTicks).toBe(0);
    alarm(far, g);
    expect(far.panicTicks).toBe(THISTLE.ALARM_TICKS);
  });

  it('a player sprinting at the herd startles it', () => {
    const g = fakeGame();
    g.player = fakePlayer(3, 64, 0, { sprinting: true });
    const a = put(g, 'thistlehorn', 0, 64, 0), b = put(g, 'thistlehorn', 4, 64, 4);
    think(a, g);
    expect(a.panicTicks).toBeGreaterThan(0);
    expect(b.panicTicks).toBeGreaterThan(0);
  });

  it('wears one of three coats, and antlers only when grown', () => {
    const coats = new Set();
    for (let k = 0; k < 60; k++) { const m = new Mob('thistlehorn', 0, 64, 0); MOBS.thistlehorn.onSpawn(m); coats.add(m.woolColor); }
    expect([...coats].sort()).toEqual([0, 1, 2]);
    expect(THISTLE_COATS.length).toBe(3);
    expect(MODELS.thistlehorn.parts.map((p) => p[0])).toEqual(expect.arrayContaining(['antlerL', 'antlerR', 'tineL', 'tineR', 'rump']));
  });
});

describe('Dustmole: digs out of the sand', () => {
  const sandWorld = () => new FlatWorld(BIOME.DESERT, B.SAND);

  it('lives hidden under the sand, comes up to look at a quiet player and goes back down when rushed', () => {
    const g = fakeGame(sandWorld());
    g.player = fakePlayer(8, 64, 0);
    const m = put(g, 'dustmole', 0.5, 64, 0.5);
    m.special = true; m.until = 0;
    // while it is hidden, nothing can hit or aim at it
    expect(m.hurt(5, 'player')).toBe(false);
    expect(m.health).toBe(MOBS.dustmole.health);
    let up = false;
    for (let k = 0; k < 400 && !up; k++) { think(m, g); up = m.emerging > 0; }
    expect(up).toBe(true);
    expect(m.special).toBe(true); // still under until it has risen
    for (let k = 0; k < MOLE.EMERGE + 2; k++) think(m, g);
    expect(m.special).toBe(false);
    expect(m.emerging).toBe(0);
    expect(g.played).toContain('burrow');
    expect(m.hurt(1, 'player')).toBe(true); // out in the open it can be hit
    m.panicTicks = 0; m.health = 6; m.invulnerable = 0;
    // the player rushes at it: it digs in
    g.player.x = 1.5; g.player.sprinting = true;
    m.body.onGround = true;
    think(m, g);
    expect(m.digging).toBe(MOLE.DIG);
    for (let k = 0; k < MOLE.DIG + 1; k++) think(m, g);
    expect(m.special).toBe(true);
    expect(g.puffs).toBeGreaterThan(0);
  });

  it('stays down for a sprinting player, a far one and one right on top of it', () => {
    const base = { hidden: true, now: 1000, until: 0 };
    const always = () => 0;
    expect(moleSurfaces({ ...base, pdist: 8, sprinting: false }, always)).toBe(true);
    expect(moleSurfaces({ ...base, pdist: 8, sprinting: true }, always)).toBe(false);
    expect(moleSurfaces({ ...base, pdist: 30, sprinting: false }, always)).toBe(false);
    expect(moleSurfaces({ ...base, pdist: 1.5, sprinting: false }, always)).toBe(false);
    expect(moleSurfaces({ ...base, pdist: 8, sprinting: false, now: 10, until: 50 }, always)).toBe(false);
    expect(moleSurfaces({ ...base, pdist: 8, sprinting: false }, () => 0.9)).toBe(false);
    expect(moleSpooked({ pdist: 2, sprinting: false, panic: 0, up: 0 })).toBe(true);
    expect(moleSpooked({ pdist: 5, sprinting: true, panic: 0, up: 0 })).toBe(true);
    expect(moleSpooked({ pdist: 5, sprinting: false, panic: 0, up: 0 })).toBe(false);
    expect(moleSpooked({ pdist: 9, sprinting: false, panic: 30, up: 0 })).toBe(true);
    expect(moleSpooked({ pdist: 9, sprinting: false, panic: 0, up: MOLE.UP_MAX + 1 })).toBe(true);
  });

  it('rises and sinks by its own height, shown with the counters the snapshot already carries', () => {
    expect(moleDepth(MOLE.EMERGE, 0)).toBe(1);
    expect(moleDepth(0, 0)).toBe(0);
    expect(moleDepth(MOLE.EMERGE / 2, 0)).toBeCloseTo(0.5, 5);
    expect(moleDepth(0, MOLE.DIG)).toBe(0);
    expect(moleDepth(0, 1, 0)).toBeGreaterThan(0.9);
    const g = fakeGame(sandWorld());
    const m = put(g, 'dustmole', 2, 64, 2);
    m.special = true; m.emerging = 0; m.digging = 0;
    const a = packMob(m);
    expect(a.length).toBe(25); // no layout change
    expect(unpackMob(JSON.parse(JSON.stringify(a)))).toMatchObject({ type: 'dustmole', special: true, emerging: 0, digging: 0 });
    m.special = false; m.emerging = 12;
    expect(unpackMob(packMob(m))).toMatchObject({ special: false, emerging: 12 });
    m.emerging = 0; m.digging = 7;
    expect(unpackMob(packMob(m))).toMatchObject({ digging: 7 });
  });

  it('cannot be aimed at under the sand (rays and arrows skip it)', () => {
    const g = fakeGame(sandWorld());
    g.player = fakePlayer(0, 64, 3);
    const em = new EntityManager({ scene: { add: noop, remove: noop }, ticks: 1, net: null, player: g.player, world: g.world });
    const m = put(g, 'dustmole', 0, 64, 0);
    em.list.push(m);
    m.special = true;
    expect(em.raycastMob(0, 64.2, 3, 0, 0, -1, 5)).toBeNull();
    m.special = false;
    expect(em.raycastMob(0, 64.2, 3, 0, 0, -1, 5)).toBeTruthy();
    m.special = true; g.player.dead = true; // (arrows: only the mobs are candidates)
    expect(em.sweepHit({ shooter: null, age: 10 }, 0, 64.2, 3, 0, 0, -1, 5)).toBeFalsy();
    m.special = false;
    expect(em.sweepHit({ shooter: null, age: 10 }, 0, 64.2, 3, 0, 0, -1, 5)).toBe(m);
  });

  it('is placed under sand in deserts and badlands only', () => {
    const w = sandWorld();
    expect(moleSpot(w, 5, 5)).toEqual({ x: 5, y: 64, z: 5 });
    expect(moleSpot(new FlatWorld(BIOME.PLAINS, B.SAND), 5, 5)).toBeNull();
    expect(moleSpot(new FlatWorld(BIOME.DESERT, B.GRASS), 5, 5)).toBeNull();
    expect(moleSpot(new FlatWorld(BIOME.BADLANDS, B.RED_SAND), 5, 5)).toBeTruthy();
    w.set(5, 65, 5, B.STONE);
    expect(moleSpot(w, 5, 5)).toBeNull();
  });

  it('faunaTick places hidden Dustmoles under sand, never past its cap', () => {
    const g = fakeGame(sandWorld());
    g.player = fakePlayer(0, 64, 0);
    const spawner = g.spawner;
    let n = 0;
    for (let k = 0; k < 400; k++) { g.ticks = 60 * k + 17; faunaTick(spawner, () => 0.3); }
    for (const e of g.entities.list) if (e.type === 'dustmole') { n++; expect(e.special).toBe(true); expect(e.persistent).toBe(false); }
    expect(n).toBe(MOLE.MAX);
    // nothing off the 17th tick of each three seconds, in daytime or at night alike
    g.entities.list.length = 0; g.ticks = 5; faunaTick(spawner, () => 0.3);
    expect(g.entities.list.length).toBe(0);
  });

  it('throws sand while it digs, red sand over badlands', () => {
    const g = fakeGame(new FlatWorld(BIOME.BADLANDS, B.RED_SAND));
    const seen = [];
    g.particles.emit = (x, y, z, vx, vy, vz, r, gg, b) => seen.push([r, gg, b]);
    sandPuff({ x: 0, y: 64, z: 0 }, g);
    expect(seen.length).toBe(5);
    expect(seen[0][0]).toBeGreaterThan(seen[0][2]); // reddish
  });
});

describe('Gloamlynx: shy at dusk, gone from light', () => {
  const dusk = (g) => { g.sky.state.combined = 0.25; };

  it('only spawns when the sun is low, on grass or snowy grass', () => {
    expect(lynxMaySpawn(0.2)).toBe(true);
    expect(lynxMaySpawn(0.5)).toBe(false);
    expect(lynxMaySpawn(1)).toBe(false);
    const g = fakeGame(new FlatWorld(BIOME.TAIGA, B.GRASS));
    g.player = fakePlayer(0, 64, 0);
    const sp = new MobSpawner(g);
    g.sky.state.combined = 1;
    expect(sp.validSpawn(CATEGORY.CREATURE, 'gloamlynx', 40, 64, 40)).toBe(false);
    expect(sp.validSpawn(CATEGORY.CREATURE, 'hopper', 40, 64, 40)).toBe(true); // other animals are fine by day
    dusk(g);
    expect(sp.validSpawn(CATEGORY.CREATURE, 'gloamlynx', 40, 64, 40)).toBe(true);
    const snow = fakeGame(new FlatWorld(BIOME.SNOWY_TAIGA, B.SNOWY_GRASS));
    snow.player = fakePlayer(0, 64, 0); dusk(snow);
    expect(new MobSpawner(snow).validSpawn(CATEGORY.CREATURE, 'gloamlynx', 40, 64, 40)).toBe(true);
    const sand = fakeGame(new FlatWorld(BIOME.TAIGA, B.SAND));
    sand.player = fakePlayer(0, 64, 0); dusk(sand);
    expect(new MobSpawner(sand).validSpawn(CATEGORY.CREATURE, 'gloamlynx', 40, 64, 40)).toBe(false);
  });

  it('is scared by a torch in hand, a lit camp beside the player, a lit spot of its own, and daylight', () => {
    expect(lynxScared({ combined: 0.2 })).toBeNull();
    expect(lynxScared({ combined: 0.2, held: 14 })).toBe('light');
    expect(lynxScared({ combined: 0.2, held: 7 })).toBeNull();
    expect(lynxScared({ combined: 0.2, playerLight: 12 })).toBe('light');
    expect(lynxScared({ combined: 0.2, lynxLight: 10 })).toBe('light');
    expect(lynxScared({ combined: 0.9, held: 0 })).toBe('day');
    expect(ITEMS[I.COAL] && B.TORCH).toBeTruthy();
  });

  it('flees from a held torch and keeps going for a while', () => {
    const g = fakeGame(new FlatWorld(BIOME.TAIGA, B.GRASS));
    dusk(g);
    g.player = fakePlayer(0, 64, 0);
    g.player.inventory.slots[0] = { id: B.TORCH, count: 1, damage: 0 };
    const m = put(g, 'gloamlynx', 0, 64, 12);
    m.yaw = Math.PI; // already facing +z, away from the player
    think(m, g);
    expect(m.fleeTicks).toBe(LYNX.FLEE_TICKS);
    expect(g.played).toContain('yowl');
    // fleeing away from the player: moving to +z
    g.player.inventory.slots[0] = null;
    think(m, g);
    expect(m.fleeTicks).toBe(LYNX.FLEE_TICKS - 1);
    expect(m.move && m.move.forward).toBeGreaterThan(0);
    expect(Math.cos(m.yaw)).toBeLessThan(0); // facing +z: yaw 0 faces -z, so cos(yaw) < 0 means a heading towards +z
  });

  it('stalks: freezes crouched when watched, creeps nearer when not, never closes in, and does not attack', () => {
    const g = fakeGame(new FlatWorld(BIOME.TAIGA, B.GRASS));
    dusk(g);
    g.player = fakePlayer(0, 64, 0); g.player.look = [0, 0, -1];
    const m = put(g, 'gloamlynx', 0, 64, -20);
    m.canSee = () => true;
    let hurt = 0; g.player.hurt = () => { hurt++; };
    // the player faces it: it freezes
    think(m, g);
    expect(m.special).toBe(true);
    expect(m.move).toBeNull();
    // the player looks away: it creeps closer
    g.player.look = [0, 0, 1];
    think(m, g);
    expect(m.special).toBe(false);
    expect(m.move && m.move.forward).toBeGreaterThan(0);
    // too close: it backs off instead
    const near = put(g, 'gloamlynx', 0, 64, -4);
    near.canSee = () => true; near.yaw = 0; // facing -z, away from the player at the origin
    think(near, g);
    expect(near.move.forward).toBeGreaterThan(0);
    expect(Math.cos(near.yaw)).toBeGreaterThan(0.9);
    expect(hurt).toBe(0);
    expect(stalkMove(LYNX.STALK_MIN - 1, false)).toBe('retreat');
    expect(stalkMove(20, true)).toBe('freeze');
    expect(stalkMove(20, false)).toBe('approach');
    expect(stalkMove(LYNX.ORBIT, false)).toBe('orbit');
    const [ox, oz] = orbitPoint(0, 0, 10, 0, 1);
    expect(Math.hypot(ox, oz)).toBeCloseTo(LYNX.ORBIT, 5);
    expect(oz).not.toBeCloseTo(0, 1);
  });

  it('sees the view cone the way the player does', () => {
    expect(watchedBy([0, 0, -1], [0, 1.6, 0], [0, 1.6, -10])).toBe(true);
    expect(watchedBy([0, 0, -1], [0, 1.6, 0], [10, 1.6, 0])).toBe(false);
    expect(watchedBy([0, 0, -1], [0, 1.6, 0], [0, 1.6, 10])).toBe(false);
    expect(watchedBy([0, 0, -1], [0, 1.6, 0], [3, 1.6, -10])).toBe(true);
  });

  it('slinks off at daybreak and is gone once it is away from the player', () => {
    const g = fakeGame(new FlatWorld(BIOME.TAIGA, B.GRASS));
    g.sky.state.combined = 1;
    g.player = fakePlayer(0, 64, 0);
    const m = put(g, 'gloamlynx', 0, 64, -10);
    think(m, g);
    expect(m.move.forward).toBeGreaterThan(0);
    expect(m.removed).toBe(false); // too close to vanish
    const far = put(g, 'gloamlynx', 0, 64, -26);
    for (let k = 0; k < 4000 && !far.removed; k++) think(far, g);
    expect(far.removed).toBe(true);
  });

  it('hunts Hoppers when the player is not near', () => {
    const g = fakeGame(new FlatWorld(BIOME.TAIGA, B.GRASS));
    dusk(g);
    g.player = fakePlayer(0, 64, 0);
    const m = put(g, 'gloamlynx', 30, 64, 0);
    const prey = put(g, 'hopper', 36, 64, 0);
    m.id = 40; g.ticks = 39;
    think(m, g);
    expect(m.enemy).toBe(prey);
  });

  it('is not tameable and not persistent', () => {
    expect(MOBS.gloamlynx.tameable).toBeFalsy();
    expect(MOBS.gloamlynx.companion).toBeUndefined();
    expect(new Mob('gloamlynx', 0, 64, 0).persistent).toBe(true);
    const m = new Mob('gloamlynx', 0, 64, 0); MOBS.gloamlynx.onSpawn(m);
    expect(m.persistent).toBe(false);
  });
});

describe('Tarnling: caught in a bucket', () => {
  it('catches into a Bucket of Tarnling and takes the empty bucket away', () => {
    const g = fakeGame();
    const p = fakePlayer(0, 64, 0);
    g.player = p;
    const m = put(g, 'tarnling', 1, 64, 1);
    m.woolColor = 2;
    p.inventory.slots[0] = { id: I.BUCKET, count: 1, damage: 0 };
    let swung = 0;
    expect(catchTarnling(g, m, p, p.inventory.selectedStack, () => { swung++; })).toBe(true);
    expect(p.inventory.slots[0]).toEqual({ id: I.TARNLING_BUCKET, count: 1, damage: 2 });
    expect(m.removed && m.dead).toBe(true);
    expect(swung).toBe(1);
    expect(g.played).toEqual(expect.arrayContaining(['bucket_fill', 'plip']));
  });

  it('needs an empty bucket, a live adult Tarnling; a full pack drops the filled bucket at the feet', () => {
    const g = fakeGame();
    const p = fakePlayer(0, 64, 0);
    g.player = p;
    const m = put(g, 'tarnling', 1, 64, 1);
    expect(catchTarnling(g, m, p, { id: I.WATER_BUCKET, count: 1 })).toBe(false);
    expect(catchTarnling(g, m, p, null)).toBe(false);
    expect(catchTarnling(g, put(g, 'fleecer', 0, 64, 0), p, { id: I.BUCKET, count: 1 })).toBe(false);
    m.deathTime = 3;
    expect(catchTarnling(g, m, p, { id: I.BUCKET, count: 1 })).toBe(false);
    m.deathTime = 0;
    // two buckets in hand, no free slot: the full one lands on the ground
    p.inventory.slots = [{ id: I.BUCKET, count: 2, damage: 0 }];
    expect(catchTarnling(g, m, p, p.inventory.selectedStack)).toBe(true);
    expect(g.items.map((s) => s.id)).toEqual([I.TARNLING_BUCKET]);
    expect(p.inventory.slots[0].count).toBe(1);
  });

  it('a guest\'s catch on the host drops the bucket for the guest instead of losing it', () => {
    const g = fakeGame();
    const p = fakePlayer(0, 64, 0, { isRemotePlayer: true });
    p.inventory.add = () => 0; // the host\'s stand-in inventory swallows anything
    const m = put(g, 'tarnling', 1, 64, 1);
    p.inventory.slots = [{ id: I.BUCKET, count: 2, damage: 0 }];
    expect(catchTarnling(g, m, p, p.inventory.selectedStack)).toBe(true);
    expect(g.items.length).toBe(1);
  });

  it('lets one go from the poured bucket, in its colour, and it stays', () => {
    const g = fakeGame();
    const m = releaseTarnling(g, 3, 62, 4, 3);
    expect(m.type).toBe('tarnling');
    expect(m.woolColor).toBe(3);
    expect(m.persistent).toBe(true);
    expect(m.x).toBeCloseTo(3.5, 5);
    expect(releaseTarnling(g, 3, 62, 4, 99).woolColor).toBeLessThan(TARN_COLORS.length);
    expect(tarnlingBucket({ woolColor: 1 }).damage).toBe(1);
    // the colour and the 'let go' state survive a save
    const s = MOBS.tarnling.saveExtra(m);
    const fresh = new Mob('tarnling', 0, 64, 0); MOBS.tarnling.onSpawn(fresh);
    expect(fresh.persistent).toBe(false);
    MOBS.tarnling.loadExtra(fresh, s);
    expect(fresh.persistent).toBe(true);
  });

  it('the game wires the bucket and the pour into right-click, the host and guests', () => {
    const inter = src('src/player/interaction.js');
    expect(inter).toContain('catchTarnling(g, mob, p, st');
    expect(inter).toContain("d.releases === 'tarnling'");
    expect(inter).toContain("requestSpawn('critter'");
    const net = src('src/net/session.js');
    expect(net).toContain("m.k === 'critter'");
    expect(net).toContain('col: d.col');
  });

  it('swims about its pond, keeps to it, darts from a player who is not creeping, and flops and dries on land', () => {
    const w = new FlatWorld(BIOME.PLAINS, B.GRASS);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { w.set(x, 63, z, B.WATER); w.set(x, 62, z, B.WATER); w.set(x, 61, z, B.CLAY); }
    const g = fakeGame(w);
    g.player = fakePlayer(30, 64, 30);
    const m = put(g, 'tarnling', 0.5, 62.2, 0.5);
    m.body.inWater = true;
    const realRandom = Math.random;
    Math.random = () => 0.5; // no random turns, no voice
    try {
      think(m, g);
      expect(m.home).toBeTruthy();
      expect(m.swimDir).toBeTruthy();
      // far from home it heads back
      m.body.setPos(m.home.x + TARN.HOME_RADIUS + 3, 62.2, m.home.z);
      m.swimDir = [1, 0, 0];
      think(m, g);
      expect(m.swimDir[0]).toBeLessThan(0);
      // back in its pond with a player close by who is splashing about: it darts away from them
      m.body.setPos(m.home.x + 1, 62.2, m.home.z);
      g.player.x = m.x + 1; g.player.z = m.z; g.player.y = 63;
      think(m, g);
      expect(m.swimDir[0]).toBeLessThan(0);
      // a sneaking one can creep up: it keeps its own course
      m.swimDir = [0.6, 0, 0.8];
      g.player.sneaking = true;
      think(m, g);
      expect(m.swimDir[0]).toBe(0.6);
    } finally { Math.random = realRandom; }
    // out of the water it dries out
    m.body.inWater = false;
    for (let k = 0; k < TARN.DRY_TICKS + 40; k++) think(m, g);
    expect(m.health).toBeLessThan(MOBS.tarnling.health);
  });

  it('is placed in shallow ponds of tarn biomes, not the open sea or dry land', () => {
    const w = new FlatWorld(BIOME.PLAINS, B.GRASS);
    expect(tarnSpot(w, 0, 0)).toBeNull(); // dry
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { w.set(x, 63, z, B.WATER); w.set(x, 62, z, B.WATER); w.set(x, 61, z, B.CLAY); }
    expect(tarnDepth(w, 0, 63, 0, (id) => SOLID[id])).toBe(2);
    const s = tarnSpot(w, 0, 0);
    expect(s).toBeTruthy();
    expect(s.depth).toBe(2);
    // deep water (the sea) is no pond
    const deep = new FlatWorld(BIOME.PLAINS, B.GRASS);
    for (let y = 56; y <= 63; y++) deep.set(0, y, 0, B.WATER);
    expect(tarnDepth(deep, 0, 63, 0, (id) => SOLID[id])).toBe(0);
    const ocean = new FlatWorld(BIOME.OCEAN, B.WATER);
    expect(tarnSpot(ocean, 0, 0)).toBeNull();
    const desert = new FlatWorld(BIOME.DESERT, B.WATER);
    expect(tarnSpot(desert, 0, 0)).toBeNull();
  });

  it('faunaTick fills ponds up to the cap and no more', () => {
    const w = new FlatWorld(BIOME.SAVANNA, B.WATER); // every cell of this world is a one-block-deep pond over stone
    const g = fakeGame(w);
    w.getBlock = (x, y) => (y < 63 ? B.STONE : y === 63 ? B.WATER : B.AIR);
    g.player = fakePlayer(0, 64, 0);
    for (let k = 0; k < 600; k++) { g.ticks = 60 * k + 17; faunaTick(g.spawner, () => 0.2); }
    const n = g.entities.list.filter((e) => e.type === 'tarnling').length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(TARN.MAX + 2); // a pack of up to three joins at once
  });

  it('Dustmoles and Tarnlings do not use up the animal cap of the farm animals', () => {
    const sp = src('src/mobs/spawner.js');
    expect(sp).toContain('e.def.burrower || e.def.bucketable');
    expect(sp).toContain('faunaTick(this)');
  });
});

describe('snapshots and the guide are untouched by the new mobs', () => {
  it('packs the same 25 fields and keeps the older indices', () => {
    for (const k of ['thistlehorn', 'dustmole', 'gloamlynx', 'tarnling']) {
      const m = new Mob(k, 1, 64, 2);
      const a = packMob(m);
      expect(a.length).toBe(25);
      expect(a.slice(0, 5)).toEqual([m.id, k, 1, 64, 2]);
      expect(unpackMob(JSON.parse(JSON.stringify(a)))).toMatchObject({ type: k, x: 1, z: 2 });
    }
    // a Thistlehorn's coat and a Tarnling's colour ride in the woolColor field; a lynx's crouch in the special flag
    const t = new Mob('thistlehorn', 0, 64, 0); t.woolColor = 2;
    expect(unpackMob(packMob(t)).woolColor).toBe(2);
    const l = new Mob('gloamlynx', 0, 64, 0); l.special = true;
    expect(unpackMob(packMob(l)).special).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// ambient critters

/** A world of columns whose biome and top block the tests choose. */
function critterWorld(biome, over = {}) {
  const w = new FlatWorld(biome, B.GRASS);
  return Object.assign(w, over);
}
const warmCtx = { day: 1, rain: 0, season: 'summer', scale: 1 };
const nightCtx = { day: 0.05, rain: 0, season: 'summer', scale: 1 };
const count = (pools, k) => pools[k].n;

describe('ambient critters: when and where', () => {
  it('butterflies by day in flowery biomes, fireflies at night in swamps and forests, nothing the wrong way round', () => {
    const f = (c) => kindFactors({ ...warmCtx, ...c });
    expect(f({}).butterfly).toBeGreaterThan(0.9);
    expect(f({}).firefly).toBe(0);
    expect(f({ day: 0.05 }).butterfly).toBe(0);
    expect(f({ day: 0.05 }).firefly).toBeGreaterThan(0.9);
    expect(f({ day: 0.5 }).butterfly).toBe(0);
    expect(DENSITY.butterfly.flower_forest).toBeGreaterThan(DENSITY.butterfly.forest);
    expect(DENSITY.butterfly.swamp).toBeUndefined();
    expect(DENSITY.firefly.swamp).toBeGreaterThan(0);
    expect(DENSITY.firefly.plains).toBeUndefined();
    expect(DENSITY.firefly.desert).toBeUndefined();
    expect(DENSITY.skimmer.swamp).toBeGreaterThan(0);
    expect(DENSITY.leaf.forest).toBeGreaterThan(0);
    expect(DENSITY.leaf.desert).toBeUndefined();
  });

  it('rain puts the butterflies and skimmers away and dims the fireflies', () => {
    const dry = kindFactors(warmCtx), wet = kindFactors({ ...warmCtx, rain: 1 });
    expect(wet.butterfly).toBe(0);
    expect(wet.skimmer).toBe(0);
    const n = kindFactors(nightCtx), nw = kindFactors({ ...nightCtx, rain: 1 });
    expect(nw.firefly).toBeLessThan(n.firefly);
    expect(nw.firefly).toBeGreaterThan(0);
    expect(wet.bird).toBeLessThan(dry.bird);
  });

  it('follows the seasons: leaves only fall in autumn, winter has no butterflies, flies or skimmers, birds thin out', () => {
    const f = (season) => kindFactors({ ...warmCtx, season });
    expect(f('autumn').leaf).toBeGreaterThan(0.5);
    for (const s of ['spring', 'summer', 'winter']) expect(f(s).leaf).toBe(0);
    expect(kindFactors({ ...warmCtx, season: null }).leaf).toBe(0); // seasons off: no autumn
    expect(f('winter').butterfly).toBe(0);
    expect(f('winter').skimmer).toBe(0);
    expect(kindFactors({ ...nightCtx, season: 'winter' }).firefly).toBe(0);
    expect(f('spring').butterfly).toBeGreaterThan(f('summer').butterfly);
    expect(f('winter').bird).toBeLessThan(f('summer').bird);
    expect(f('winter').bird).toBeGreaterThan(0);
    expect(f('summer').butterfly).toBeGreaterThan(f('autumn').butterfly);
  });

  it('falling leaves come off real canopies and drop to the first non-foliage block', () => {
    const w = critterWorld(BIOME.FOREST);
    const leaf = [...LEAVES][0];
    // a forest of trees: trunk at y 63..66 and a crown of leaves at 67..68 on every column near the player
    for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) { w.set(x, 67, z, leaf); w.set(x, 68, z, leaf); }
    const pools = newPools();
    const f = kindFactors({ day: 1, rain: 0, season: 'autumn', scale: 1 });
    rebuild(pools, w, seedNumber(7), 0, 0, f);
    expect(count(pools, 'leaf')).toBeGreaterThan(0);
    for (let i = 0; i < pools.leaf.n; i++) {
      const s = pools.leaf.list[i];
      expect(s.fall).toBeGreaterThanOrEqual(3);
      expect(s.hy).toBeCloseTo(64, 5); // lands on the grass (block 63)
      const o = [0, 0, 0, 0];
      critterPos('leaf', s, 3.3, o);
      expect(o[1]).toBeGreaterThanOrEqual(s.hy - 1e-6);
      expect(o[1]).toBeLessThanOrEqual(s.hy + s.fall + 1e-6);
    }
    // no canopy, no leaves
    const bare = critterWorld(BIOME.FOREST), p2 = newPools();
    rebuild(p2, bare, seedNumber(7), 0, 0, f);
    expect(count(p2, 'leaf')).toBe(0);
  });

  it('skimmers only hover over water', () => {
    const w = critterWorld(BIOME.SWAMP);
    for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) if ((Math.floor(x / 8) + Math.floor(z / 8)) % 2 === 0) w.set(x, 63, z, B.WATER);
    const pools = newPools();
    rebuild(pools, w, seedNumber(7), 0, 0, kindFactors(warmCtx));
    expect(count(pools, 'skimmer')).toBeGreaterThan(0);
    for (let i = 0; i < pools.skimmer.n; i++) {
      const s = pools.skimmer.list[i];
      expect(w.getBlock(Math.floor(s.hx), 63, Math.floor(s.hz))).toBe(B.WATER);
      expect(s.hy).toBeGreaterThan(64);
    }
  });

  it('butterflies and fireflies sit over their own biomes only', () => {
    const meadow = critterWorld(BIOME.FLOWER_FOREST), desert = critterWorld(BIOME.DESERT), swamp = critterWorld(BIOME.SWAMP);
    const day = newPools(), night = newPools(), none = newPools();
    rebuild(day, meadow, 1, 0, 0, kindFactors(warmCtx));
    expect(count(day, 'butterfly')).toBeGreaterThan(5);
    expect(count(day, 'firefly')).toBe(0);
    rebuild(none, desert, 1, 0, 0, kindFactors(warmCtx));
    expect(count(none, 'butterfly') + count(none, 'skimmer') + count(none, 'leaf')).toBe(0);
    rebuild(night, swamp, 1, 0, 0, kindFactors(nightCtx));
    expect(count(night, 'firefly')).toBeGreaterThan(5);
    expect(count(night, 'butterfly')).toBe(0);
  });
});

describe('ambient critters: hard caps and determinism', () => {
  it('never exceed the caps, however good the conditions', () => {
    const w = critterWorld(BIOME.FLOWER_FOREST);
    const leaf = [...LEAVES][0];
    for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) { w.set(x, 67, z, leaf); if (x % 3 === 0) w.set(x, 63, z, B.WATER); }
    const all = { butterfly: 9, firefly: 9, leaf: 9, skimmer: 9, bird: 9 };
    const pools = newPools();
    rebuild(pools, w, 5, 0, 0, all);
    for (const k of KINDS) {
      expect(pools[k].n).toBeLessThanOrEqual(CAPS[k]);
      expect(pools[k].list.length).toBe(CAPS[k]);
    }
    expect(CAPS.butterfly + CAPS.firefly + CAPS.leaf + CAPS.skimmer + CAPS.bird).toBeLessThanOrEqual(160);
    expect(flockCount(all)).toBeLessThanOrEqual(FLOCK_MAX);
    let birds = 0;
    for (let f = 0; f < FLOCK_MAX; f++) birds += flockSize(5, f);
    expect(birds).toBeLessThanOrEqual(CAPS.bird);
  });

  it('are the same for the same seed and world, different for another seed, and independent of any RNG', () => {
    const w = critterWorld(BIOME.FLOWER_FOREST);
    const a = newPools(), b = newPools(), c = newPools();
    const f = kindFactors(warmCtx);
    const realRandom = Math.random;
    Math.random = () => { throw new Error('critters must not use Math.random'); };
    try {
      rebuild(a, w, seedNumber('alpha'), 10, 10, f);
      rebuild(b, w, seedNumber('alpha'), 10, 10, f);
      rebuild(c, w, seedNumber('beta'), 10, 10, f);
    } finally { Math.random = realRandom; }
    const snap = (p) => p.butterfly.list.slice(0, p.butterfly.n).map((s) => [s.hx, s.hz, s.ph]);
    expect(snap(a)).toEqual(snap(b));
    expect(snap(a)).not.toEqual(snap(c));
    expect(hash01(1, 2, 3, 4, 5)).toBe(hash01(1, 2, 3, 4, 5));
    for (let i = 0; i < 200; i++) { const h = hash01(9, i, -i, i * 7, 3); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
    expect(seedNumber(42)).toBe(seedNumber('42'));
  });

  it('a critter fades in as the weather improves rather than popping in', () => {
    const w = critterWorld(BIOME.FLOWER_FOREST);
    const lo = newPools(), hi = newPools();
    fillCell(lo, w, 3, 0, 0, { ...kindFactors(warmCtx), butterfly: 0.3 });
    fillCell(hi, w, 3, 0, 0, { ...kindFactors(warmCtx), butterfly: 0.9 });
    expect(lo.butterfly.n).toBeGreaterThan(0);
    expect(hi.butterfly.n).toBeGreaterThanOrEqual(lo.butterfly.n);
    // every critter of the sparse set is also in the fuller set, at the same place
    const places = new Set(hi.butterfly.list.slice(0, hi.butterfly.n).map((s) => s.hx + ',' + s.hz));
    for (let i = 0; i < lo.butterfly.n; i++) expect(places.has(lo.butterfly.list[i].hx + ',' + lo.butterfly.list[i].hz)).toBe(true);
    for (let i = 0; i < hi.butterfly.n; i++) { const p = hi.butterfly.list[i].presence; expect(p).toBeGreaterThan(0); expect(p).toBeLessThanOrEqual(1); }
  });

  it('move on closed-form paths: finite, bounded round their home, the same at the same time', () => {
    const w = critterWorld(BIOME.FLOWER_FOREST);
    const pools = newPools();
    rebuild(pools, w, 3, 0, 0, kindFactors(warmCtx));
    const o = [0, 0, 0, 0], o2 = [0, 0, 0, 0];
    for (let i = 0; i < pools.butterfly.n; i++) {
      const s = pools.butterfly.list[i];
      for (let t = 0; t < 120; t += 7.3) {
        critterPos('butterfly', s, t, o); critterPos('butterfly', s, t, o2);
        expect(o).toEqual(o2);
        for (const v of o) expect(Number.isFinite(v)).toBe(true);
        expect(Math.hypot(o[0] - s.hx, o[2] - s.hz)).toBeLessThan(9);
        expect(o[1]).toBeGreaterThan(s.hy);
        expect(o[3]).toBeGreaterThan(0.1);
      }
    }
  });

  it('bird flocks fly high, stay in a V of 5-7, and wrap round the player so they keep coming', () => {
    const o = [0, 0, 0, 0];
    for (let f = 0; f < FLOCK_MAX; f++) {
      const n = flockSize(11, f);
      expect(n).toBeGreaterThanOrEqual(5); expect(n).toBeLessThanOrEqual(7);
      for (let i = 0; i < n; i++) for (const t of [0, 50, 500, 5000]) {
        birdPos(11, f, i, t, 100, -50, o);
        expect(o[1]).toBeGreaterThan(BIRD_HEIGHT[0] - 2);
        expect(o[1]).toBeLessThan(BIRD_HEIGHT[1] + 4);
        expect(Math.abs(o[0] - 100)).toBeLessThanOrEqual(BIRD_RANGE + 12);
        expect(Math.abs(o[2] + 50)).toBeLessThanOrEqual(BIRD_RANGE + 12);
      }
    }
    expect(wrapAround(250, 0, 100)).toBe(50);
    expect(wrapAround(-150, 0, 100)).toBe(50);
    expect(wrapAround(30, 0, 100)).toBe(30);
    // a flock keeps its shape: the leader's followers are behind it, side to side
    birdPos(11, 0, 0, 10, 0, 0, o); const lead = o.slice();
    birdPos(11, 0, 1, 10, 0, 0, o); const a = o.slice();
    birdPos(11, 0, 2, 10, 0, 0, o); const b = o.slice();
    const side = (p) => (p[0] - lead[0]) * (b[2] - lead[2]) - (p[2] - lead[2]) * (b[0] - lead[0]);
    expect(Math.hypot(a[0] - lead[0], a[2] - lead[2])).toBeGreaterThan(1);
    expect(side(a) * 1).not.toBe(0);
  });

  it('with no birds when it is dark or stormy', () => {
    expect(flockCount(kindFactors({ ...warmCtx, day: 0.05 }))).toBe(0);
    expect(flockCount(kindFactors(warmCtx))).toBeGreaterThan(0);
    expect(flockCount(kindFactors({ ...warmCtx, scale: 0 }))).toBe(0);
  });
});

describe('ambient critters: reduced motion', () => {
  it('motionScales has critter scales: full by default, fewer and slower with reduce motion, flashing leaves them', () => {
    const full = motionScales({});
    expect(full.critters).toBe(1); expect(full.critterSpeed).toBe(1);
    expect(FULL_FX).toEqual(full);
    const calm = motionScales({ reduceMotion: true });
    expect(calm.critters).toBeLessThan(0.5); expect(calm.critters).toBeGreaterThan(0);
    expect(calm.critterSpeed).toBeLessThan(0.5);
    expect(motionScales({ reduceFlashing: true }).critters).toBe(1);
    expect(motionScales({ reduceFlashing: true }).twinkle).toBe(0); // fireflies stop blinking
    expect(critterScales(calm)).toEqual([calm.critters, calm.critterSpeed]);
    expect(critterScales(null)).toEqual([1, 1]);
  });

  it('cuts every count (the sparser pool is a subset of the fuller)', () => {
    const w = critterWorld(BIOME.FLOWER_FOREST);
    const lo = newPools(), hi = newPools();
    rebuild(hi, w, 3, 0, 0, kindFactors(warmCtx));
    rebuild(lo, w, 3, 0, 0, kindFactors({ ...warmCtx, scale: motionScales({ reduceMotion: true }).critters }));
    expect(lo.butterfly.n).toBeLessThan(hi.butterfly.n);
    expect(lo.butterfly.n).toBeGreaterThan(0);
  });
});

describe('the critter renderer', () => {
  function gameFor(world, settings = {}, over = {}) {
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 65.6, 0); cam.updateMatrixWorld();
    const g = fakeGame(world, { camera: cam, fx: motionScales(settings), ...over });
    g.player = fakePlayer(0, 64, 0);
    g.sky.state.combined = over.day ?? 1;
    return g;
  }

  it('draws butterflies by day within the caps, hides them in another dimension, and costs five meshes', () => {
    const scene = new THREE.Scene();
    const c = new Critters(scene);
    expect(scene.children.length).toBe(KINDS.length);
    const g = gameFor(critterWorld(BIOME.FLOWER_FOREST));
    c.update(g, g.camera, 0);
    c.update(g, g.camera, 0.016);
    expect(c.shown.butterfly).toBeGreaterThan(3);
    expect(c.meshes.butterfly.count).toBe(c.shown.butterfly);
    for (const k of KINDS) expect(c.shown[k]).toBeLessThanOrEqual(CAPS[k]);
    expect(c.total).toBeLessThanOrEqual(160);
    // the matrices are finite and near the player
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    for (let i = 0; i < c.shown.butterfly; i++) {
      c.meshes.butterfly.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
      expect(v.distanceTo(g.camera.position)).toBeLessThanOrEqual(VIEW + 1);
    }
    g.world.dimension = 'cinderdeep';
    c.update(g, g.camera, 0.05);
    expect(c.total).toBe(0);
    expect(c.meshes.butterfly.visible).toBe(false);
    c.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('shows fireflies at night in a swamp, leaves in an autumn forest, and nothing in winter', () => {
    const c = new Critters(new THREE.Scene());
    const swamp = gameFor(critterWorld(BIOME.SWAMP), {}, { day: 0.05 });
    c.update(swamp, swamp.camera, 0); c.update(swamp, swamp.camera, 0.02);
    expect(c.shown.firefly).toBeGreaterThan(5);
    expect(c.shown.butterfly).toBe(0);
    swamp.seasons.state.key = 'winter'; climate.on = true;
    c.update(swamp, swamp.camera, 1);
    expect(c.shown.firefly).toBe(0);
    climate.on = false;
    // autumn forest with canopy
    const w = critterWorld(BIOME.FOREST); const leaf = [...LEAVES][0];
    for (let x = -40; x < 40; x++) for (let z = -40; z < 40; z++) w.set(x, 67, z, leaf);
    const forest = gameFor(w);
    forest.seasons.state.key = 'autumn'; climate.on = true;
    const c2 = new Critters(new THREE.Scene());
    c2.update(forest, forest.camera, 0); c2.update(forest, forest.camera, 0.02);
    expect(c2.shown.leaf).toBeGreaterThan(3);
    forest.seasons.state.key = 'summer';
    c2.lastRefresh = -1e9;
    c2.update(forest, forest.camera, 1);
    expect(c2.shown.leaf).toBe(0);
    climate.on = false;
    // seasons off altogether: no leaves either
    c2.lastRefresh = -1e9; forest.seasons.state.key = 'autumn';
    c2.update(forest, forest.camera, 2);
    expect(c2.shown.leaf).toBe(0);
  });

  it('flocks fly overhead by day and respect the reduced-motion setting', () => {
    const w = critterWorld(BIOME.PLAINS);
    const full = new Critters(new THREE.Scene()), calm = new Critters(new THREE.Scene());
    const a = gameFor(w), b = gameFor(w, { reduceMotion: true });
    full.update(a, a.camera, 0); full.update(a, a.camera, 0.02);
    calm.update(b, b.camera, 0); calm.update(b, b.camera, 0.02);
    expect(full.shown.bird).toBeGreaterThanOrEqual(5);
    expect(calm.shown.bird).toBeLessThan(full.shown.bird);
    expect(calm.total).toBeLessThanOrEqual(full.total);
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    full.meshes.bird.getMatrixAt(0, m); v.setFromMatrixPosition(m);
    expect(v.y).toBeGreaterThan(BIRD_HEIGHT[0] - 3);
    // the clock runs slower with reduced motion
    const dt = (c, g) => { const t0 = c.clock; c.update(g, g.camera, 10); c.update(g, g.camera, 10.1); return c.clock - t0; };
    expect(dt(calm, b)).toBeLessThan(dt(full, a));
  });

  it('does nothing for a dead player or with the count scale at zero', () => {
    const c = new Critters(new THREE.Scene());
    const g = gameFor(critterWorld(BIOME.FLOWER_FOREST));
    g.fx = { ...g.fx, critters: 0 };
    c.update(g, g.camera, 0);
    expect(c.total).toBe(0);
    g.fx = FULL_FX; g.player.dead = true;
    c.update(g, g.camera, 0.1);
    expect(c.total).toBe(0);
  });

  it('is wired into the game: built once, updated each frame, and the old per-tick firefly particles are gone', () => {
    const game = src('src/game.js');
    expect(game).toContain("import { Critters } from './render/critters.js'");
    expect(game).toContain('this.critters = new Critters(this.scene)');
    expect(game).toContain('this.critters.update(this, this.camera, sec)');
    expect(game).not.toContain('FIREFLY_BIOMES');
    const crit = src('src/render/critters.js');
    expect(crit).not.toContain('Math.random');
    const body = crit.slice(crit.indexOf('  update(game, camera, sec) {'), crit.indexOf('  finish(kind, n) {'));
    expect(body.length).toBeGreaterThan(500);
    expect(body).not.toMatch(/\bnew \w/); // a frame allocates nothing: the scratch objects are made in the constructor
  });
});

describe('README', () => {
  it('describes the fauna', () => {
    const readme = src('README.md');
    for (const w of ['Thistlehorn', 'Dustmole', 'Gloamlynx', 'Tarnling', 'butterflies']) expect(readme).toContain(w);
    for (const w of ['Minecraft', 'Nether', 'redstone']) expect(readme).not.toContain(w);
  });
});

// keep the imports used when the file is trimmed
void [neutralClimate, applyValues, SEASON_DATA, resetClimate, BIOMES];
