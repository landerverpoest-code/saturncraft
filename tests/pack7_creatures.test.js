// Pack 7 creatures: the Rootsnout (roots up Dawnfern Seeds), the Dawnfern crop, the Plateback (curls up, sheds Plate Scales) and the
// Howler Barding made from the scales (mobs/pack7Mobs.js).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { spawnTable } from '../src/mobs/spawnRules.js';
import {
  ROOT, CURL, SCALE, BARDING, rootDelay, canRoot, rootStep, shouldCurl, curlDamage, canBrush, shedDelay, bardingAbsorb, canWearBarding,
  brushPlateback, equipBarding, removeBarding, bardingSave,
} from '../src/mobs/pack7Mobs.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { B, BLOCKS, CROPS, POTTED, SHAPE } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { blockDrops } from '../src/world/mining.js';
import { randomTickBlock } from '../src/world/randomTicks.js';
import { craft } from '../src/player/crafting.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { eggCatalog } from '../src/mobs/creatureEggs.js';
import { CAPTION_TEXT } from '../src/ui/accessibility.js';
import { MockWorld } from './helpers.js';

const noop = () => {};
const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

class FarmWorld extends MockWorld {
  constructor() { super(60); this.light = 0xf0; }
  getLight() { return this.light; }
  setBlock(x, y, z, id, meta = 0) { this.set(x, y, z, id, meta); return true; }
}

function fakeGame(over = {}) {
  const items = [], played = [];
  const g = {
    ticks: 100, items, played, puffs: 0,
    world: { getBlock: () => B.GRASS },
    audio: { play: (n) => played.push(n) },
    particles: { emit: () => { g.puffs++; }, smoke: noop },
    entities: { list: [], spawnItem: (x, y, z, st) => items.push(st), spawnXp: noop },
    ...over,
  };
  return g;
}
function fakePlayer(over = {}) {
  const inv = {
    selected: 0, slots: [null],
    get selectedStack() { return this.slots[this.selected]; },
    removeFromSlot(i, n = 1) { const s = this.slots[i]; if (!s) return null; s.count -= n; if (s.count <= 0) this.slots[i] = null; return s; },
    damaged: 0, damageSelected(n) { this.damaged += n; },
    changed: noop,
  };
  return { x: 0, y: 64, z: 0, dead: false, creative: false, sprinting: false, inventory: inv, ...over };
}
const put = (g, type, x = 0, y = 64, z = 0) => { const m = new Mob(type, x, y, z); m._game = g; if (m.def.onSpawn) m.def.onSpawn(m); g.entities.list.push(m); return m; };
const hold = (p, st) => { p.inventory.slots[0] = st; return st; };
const think = (m, g, p, n = 1) => { g.player = p; for (let k = 0; k < n; k++) { g.ticks++; m.def.ownAI(m, g, p, Math.hypot(p.x - m.x, p.z - m.z)); } };
const tamedHowler = (g) => { const h = put(g, 'howler'); h.tamed = true; h.health = h.def.tamedHealth; return h; };

describe('earlier ids did not shift', () => {
  it('keeps the block and item ids of earlier content', () => {
    expect(B.FROSTROOTS).toBe(1335);
    expect(B.DRIFTSNOW).toBe(1371);
    expect(B.TIDE_HEART).toBe(1375);
    expect(B.EMBER_HEARTH).toBe(1376);
    expect(B.GLIMMERMOSS).toBe(1377);
    expect(I.BEETROOT_SEEDS).toBe(304);
    expect(I.BRUSH).toBe(587);
    expect(I.TARNLING_BUCKET).toBe(747);
    expect(I.CREATURE_EGG).toBe(821);
  });
  it('appends the new blocks and items after them', () => {
    expect(B.DAWNFERN).toBe(B.GLIMMERMOSS + 1);
    expect(B.DAWNFERN_PLANT).toBe(B.GLIMMERMOSS + 2);
    expect(I.DAWNFERN_SEEDS).toBe(I.CREATURE_EGG + 1);
    expect(I.PLATE_SCALE).toBe(I.CREATURE_EGG + 2);
    expect(I.HOWLER_BARDING).toBe(I.CREATURE_EGG + 3);
  });
  it('uses no forbidden names', () => {
    const text = ['src/mobs/pack7Mobs.js', 'src/world/pack7Textures.js', 'tests/pack7_creatures.test.js'].map(src).join('\n').toLowerCase();
    for (const w of ['mine' + 'craft', 'net' + 'her', 'red' + 'stone', 'trip' + 'wire']) expect(text).not.toContain(w);
  });
});

describe('definitions and habitats', () => {
  it('registers both as passive creatures with models, voices and drops', () => {
    for (const k of ['rootsnout', 'plateback']) {
      const d = MOBS[k];
      expect(d, k).toBeTruthy();
      expect(MOB_KEYS).toContain(k);
      expect(d.category).toBe(CATEGORY.CREATURE);
      expect(typeof d.ownAI).toBe('function');
      expect(MODELS[k].parts.length).toBeGreaterThan(6);
      for (const [, , , , , o] of MODELS[k].parts) if (o && o.face) expect(typeof FACES[o.face]).toBe('function');
      expect(src('src/audio/audio.js')).toContain(`case '${d.sound}':`);
      expect(CAPTION_TEXT[d.sound]).toBeTruthy();
      for (const dr of d.drops) expect(ITEMS[dr.id], `${k} drop`).toBeTruthy();
    }
    expect(MOBS.rootsnout.health).toBe(14);
    expect(MOBS.plateback.health).toBe(12);
  });
  it('breed with Dawnfern Seeds and Sweet Berries', () => {
    expect(MOBS.rootsnout.food).toEqual([I.DAWNFERN_SEEDS]);
    expect(MOBS.plateback.food).toEqual([I.SWEET_BERRIES]);
  });
  it('spawn rarely in forests and flower forests (groups of 1-2), and in savannas and badlands (groups of 2-3)', () => {
    const entry = (biome, type) => spawnTable(CATEGORY.CREATURE, BIOME[biome]).find((e) => e.type === type);
    for (const b of ['FOREST', 'FLOWER_FOREST']) {
      const e = entry(b, 'rootsnout');
      expect(e, b).toBeTruthy();
      expect([e.min, e.max]).toEqual([1, 2]);
      expect(e.weight).toBeLessThanOrEqual(3);
    }
    for (const b of ['SAVANNA', 'BADLANDS']) {
      const e = entry(b, 'plateback');
      expect(e, b).toBeTruthy();
      expect([e.min, e.max]).toEqual([2, 3]);
    }
    expect(entry('DESERT', 'plateback')).toBeUndefined();
    expect(entry('PLAINS', 'rootsnout')).toBeUndefined();
    expect(BIOMES.some((b) => b.key === 'badlands')).toBe(true);
  });
  it('appear in the Field Guide with their habitats, and as Creature Eggs', () => {
    resetGuideEntries();
    const rs = entriesOf('creatures').find((e) => e.key === 'rootsnout'), pb = entriesOf('creatures').find((e) => e.key === 'plateback');
    expect(rs).toBeTruthy(); expect(pb).toBeTruthy();
    expect(JSON.stringify(rs)).toMatch(/Forest/);
    expect(JSON.stringify(pb)).toMatch(/Savanna/);
    const eggs = eggCatalog().map((e) => e.key);
    expect(eggs).toContain('rootsnout'); expect(eggs).toContain('plateback');
  });
  it('has a help sentence for each and the new items in the Field Guide', () => {
    const help = src('src/ui/helpTopics.js');
    expect(help).toContain('Rootsnouts'); expect(help).toContain('Platebacks');
    const items = entriesOf('items').map((e) => e.id);
    for (const id of [I.DAWNFERN_SEEDS, I.PLATE_SCALE, I.HOWLER_BARDING, B.DAWNFERN_PLANT]) expect(items).toContain(id);
  });
});

describe('Rootsnout rooting', () => {
  it('waits 2 to 4 minutes between rootings', () => {
    expect(rootDelay(() => 0)).toBe(2400);
    expect(rootDelay(() => 0.999999)).toBe(4800);
  });
  it('roots only on grass or dirt', () => {
    expect(canRoot(B.GRASS)).toBe(true); expect(canRoot(B.DIRT)).toBe(true);
    expect(canRoot(B.STONE)).toBe(false); expect(canRoot(B.SAND)).toBe(false);
  });
  it('counts down, roots for three seconds, then drops once and starts again', () => {
    const m = { rootTimer: 3 };
    const r = () => 0;
    expect([rootStep(m, true, r), rootStep(m, true, r), rootStep(m, true, r)]).toEqual([null, null, 'start']);
    expect(m.rooting).toBe(ROOT.TICKS);
    expect(ROOT.TICKS).toBe(60);
    const acts = [];
    for (let k = 0; k < ROOT.TICKS; k++) acts.push(rootStep(m, true, r));
    expect(acts.filter((a) => a === 'drop')).toHaveLength(1);
    expect(acts[acts.length - 1]).toBe('drop');
    expect(m.rootTimer).toBe(2400);
  });
  it('keeps waiting while it is not on soil', () => {
    const m = { rootTimer: 1 };
    for (let k = 0; k < 50; k++) expect(rootStep(m, false)).toBe(null);
    expect(m.rooting || 0).toBe(0);
    expect(rootStep(m, true)).toBe('start');
  });
  it('the AI stops, puts its head down, throws dirt and leaves one Dawnfern Seeds', () => {
    const g = fakeGame(), p = fakePlayer({ x: 30, z: 30 });
    const m = put(g, 'rootsnout');
    m.rootTimer = 1;
    think(m, g, p);
    expect(m.rooting).toBeGreaterThan(0);
    for (let k = 0; k < 30; k++) { think(m, g, p); expect(m.move).toBe(null); }
    expect(m.headPitch).toBeGreaterThan(1);
    expect(g.puffs).toBeGreaterThan(0);
    expect(g.items).toHaveLength(0);
    think(m, g, p, ROOT.TICKS);
    expect(g.items).toEqual([{ id: I.DAWNFERN_SEEDS, count: 1 }]);
    expect(m.headPitch).toBe(0);
    expect(m.rootTimer).toBeGreaterThanOrEqual(ROOT.MIN_DELAY - 40);
  });
  it('does not root on stone, and a hit breaks it off', () => {
    const g = fakeGame({ world: { getBlock: () => B.STONE } }), p = fakePlayer({ x: 30, z: 30 });
    const m = put(g, 'rootsnout');
    m.rootTimer = 1;
    think(m, g, p, 10);
    expect(m.rooting).toBe(0);
    const g2 = fakeGame(), m2 = put(g2, 'rootsnout');
    m2.rootTimer = 1; think(m2, g2, p);
    expect(m2.rooting).toBeGreaterThan(0);
    expect(m2.def.onHurt(m2, 3)).toBe(3);
    expect(m2.rooting).toBe(0);
  });
});

describe('Dawnfern crop', () => {
  it('seeds plant a crop block on farmland; the crop glows and the plant is a cross that fits a Flower Pot', () => {
    expect(ITEMS[I.DAWNFERN_SEEDS].places).toBe(B.DAWNFERN);
    expect(CROPS.has(B.DAWNFERN)).toBe(true);
    expect(BLOCKS[B.DAWNFERN].emit).toBe(5);
    expect(BLOCKS[B.DAWNFERN_PLANT].emit).toBe(5);
    expect(BLOCKS[B.DAWNFERN_PLANT].shape).toBe(SHAPE.CROSS);
    expect(POTTED).toContain(B.DAWNFERN_PLANT);
    expect(POTTED.length).toBeLessThan(63);
  });
  it('grows by random ticks over eight stages and stops when ripe', () => {
    const w = new FarmWorld();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) w.set(dx, 63, dz, B.FARMLAND, 7);
    w.set(0, 64, 0, B.DAWNFERN, 0);
    for (let k = 0; k < 800; k++) randomTickBlock(w, 0, 64, 0, B.DAWNFERN, () => 0);
    expect(w.getBlock(0, 64, 0)).toBe(B.DAWNFERN);
    expect(w.getMeta(0, 64, 0)).toBe(7);
    // too dark: nothing grows
    const d = new FarmWorld(); d.light = 0;
    d.set(0, 63, 0, B.FARMLAND, 7); d.set(0, 64, 0, B.DAWNFERN, 0);
    for (let k = 0; k < 50; k++) randomTickBlock(d, 0, 64, 0, B.DAWNFERN, () => 0);
    expect(d.getMeta(0, 64, 0)).toBe(0);
  });
  it('a sprout gives its seed back; a ripe fern gives the plant and 0-1 seeds', () => {
    expect(blockDrops(B.DAWNFERN, undefined, () => 0, 3)).toEqual([{ id: I.DAWNFERN_SEEDS, count: 1 }]);
    expect(blockDrops(B.DAWNFERN, undefined, () => 0.9, 7)).toEqual([{ id: B.DAWNFERN_PLANT, count: 1 }]);
    expect(blockDrops(B.DAWNFERN, undefined, () => 0.1, 7)).toEqual([{ id: B.DAWNFERN_PLANT, count: 1 }, { id: I.DAWNFERN_SEEDS, count: 1 }]);
    expect(blockDrops(B.DAWNFERN_PLANT, undefined, () => 0, 0).map((d) => d.id)).toEqual([B.DAWNFERN_PLANT]);
  });
});

describe('Plateback curling', () => {
  it('curls for a sprinter within 6 blocks, or when hurt', () => {
    expect(CURL.RANGE).toBe(6);
    expect(shouldCurl({ pdist: 5, sprinting: true })).toBe(true);
    expect(shouldCurl({ pdist: 7, sprinting: true })).toBe(false);
    expect(shouldCurl({ pdist: 3, sprinting: false })).toBe(false);
    expect(shouldCurl({ pdist: 30, hurt: true })).toBe(true);
  });
  it('takes 70 percent less damage while curled', () => {
    expect(curlDamage(10, true)).toBeCloseTo(3);
    expect(curlDamage(10, false)).toBe(10);
  });
  it('the AI stops and holds the ball for four seconds', () => {
    const g = fakeGame(), p = fakePlayer({ x: 4, z: 0, sprinting: true });
    const m = put(g, 'plateback');
    think(m, g, p);
    expect(m.curl).toBe(CURL.TICKS);
    expect(CURL.TICKS).toBe(80);
    p.sprinting = false;
    for (let k = 0; k < CURL.TICKS - 1; k++) { think(m, g, p); expect(m.move).toBe(null); expect(m.headPitch).toBe(CURL.PITCH); }
    think(m, g, p);
    expect(m.curl).toBe(0);
    think(m, g, p);
    expect(m.headPitch).toBeLessThan(CURL.PITCH);
  });
  it('a hit lands in full, curls it, and the next ones are reduced', () => {
    const g = fakeGame(), m = put(g, 'plateback');
    expect(m.def.onHurt(m, 5)).toBe(5);
    expect(m.curl).toBe(CURL.TICKS);
    expect(m.def.onHurt(m, 5)).toBeCloseTo(1.5);
    const m2 = put(g, 'plateback'); m2.curl = 10;
    const before = m2.health;
    m2.hurt(10, 'mob:test');
    expect(before - m2.health).toBeCloseTo(3);
  });
});

describe('brushing a Plateback', () => {
  it('drops a Plate Scale, wears the Brush, and then makes the animal wait five minutes', () => {
    const g = fakeGame(), p = fakePlayer();
    const m = put(g, 'plateback');
    const brush = hold(p, { id: I.BRUSH, count: 1, damage: 0 });
    expect(SCALE.COOLDOWN).toBe(6000);
    expect(brushPlateback(g, m, p, brush, 1000)).toBe(true);
    expect(g.items).toEqual([{ id: I.PLATE_SCALE, count: 1 }]);
    expect(p.inventory.damaged).toBe(1);
    expect(brushPlateback(g, m, p, brush, 1000 + SCALE.COOLDOWN - 1)).toBe(false);
    expect(g.items).toHaveLength(1);
    expect(brushPlateback(g, m, p, brush, 1000 + SCALE.COOLDOWN)).toBe(true);
    expect(g.items).toHaveLength(2);
    // another animal has its own clock
    expect(brushPlateback(g, put(g, 'plateback'), p, brush, 1001)).toBe(true);
  });
  it('needs a Brush, a Plateback and a grown animal', () => {
    const g = fakeGame(), p = fakePlayer(), m = put(g, 'plateback');
    expect(brushPlateback(g, m, p, { id: I.STICK, count: 1 }, 5000)).toBe(false);
    expect(brushPlateback(g, put(g, 'fleecer'), p, { id: I.BRUSH, count: 1 }, 5000)).toBe(false);
    m.age = -1000;
    expect(canBrush(m, 99999)).toBe(false);
    expect(g.items).toHaveLength(0);
  });
  it('creative players do not wear the Brush', () => {
    const g = fakeGame(), p = fakePlayer({ creative: true }), m = put(g, 'plateback');
    expect(brushPlateback(g, m, p, { id: I.BRUSH, count: 1 }, 5000)).toBe(true);
    expect(p.inventory.damaged).toBe(0);
  });
  it('sheds a scale by itself every 5 to 10 minutes', () => {
    expect(shedDelay(() => 0)).toBe(6000);
    expect(shedDelay(() => 0.999999)).toBe(12000);
    const g = fakeGame(), p = fakePlayer({ x: 40, z: 40 }), m = put(g, 'plateback');
    m.shedTimer = 3;
    think(m, g, p, 2);
    expect(g.items).toHaveLength(0);
    think(m, g, p, 1);
    expect(g.items).toEqual([{ id: I.PLATE_SCALE, count: 1 }]);
    expect(m.shedTimer).toBeGreaterThanOrEqual(6000);
  });
});

describe('Howler Barding', () => {
  it('is crafted from six Plate Scales', () => {
    const s = () => ({ id: I.PLATE_SCALE, count: 1 });
    expect(craft([s(), s(), s(), s(), s(), s(), null, null, null], 3)).toEqual({ id: I.HOWLER_BARDING, count: 1 });
    expect(craft([s(), s(), s(), s(), s(), null, null, null, null], 3)).toBeNull();
    expect(ITEMS[I.HOWLER_BARDING].stack).toBe(1);
  });
  it('goes on a tamed Howler only', () => {
    const g = fakeGame(), p = fakePlayer();
    const wild = put(g, 'howler'), pet = tamedHowler(g);
    const st = hold(p, { id: I.HOWLER_BARDING, count: 1, damage: 0 });
    expect(canWearBarding(wild)).toBe(false);
    expect(equipBarding(g, wild, p, st)).toBe(false);
    expect(equipBarding(g, put(g, 'fleecer'), p, st)).toBe(false);
    expect(equipBarding(g, pet, p, st)).toBe(true);
    expect(pet.barding).toEqual({ absorbed: 0 });
    expect(p.inventory.slots[0]).toBeNull();
    expect(canWearBarding(pet)).toBe(false);
  });
  it('halves damage until it has absorbed 64, then breaks', () => {
    const g = fakeGame(), pet = tamedHowler(g);
    pet.barding = { absorbed: 0 };
    expect(pet.def.onHurt(pet, 10)).toBe(5);
    expect(pet.barding.absorbed).toBe(5);
    for (let k = 0; k < 58; k++) expect(pet.def.onHurt(pet, 2)).toBe(1);
    expect(pet.barding.absorbed).toBeCloseTo(63);
    // the last point is stopped, the rest of that blow is not
    expect(pet.def.onHurt(pet, 10)).toBe(9);
    expect(pet.barding).toBeNull();
    expect(g.played).toContain('shield_break');
    expect(pet.def.onHurt(pet, 10)).toBe(10);
    expect(bardingAbsorb(null, 4)).toEqual({ dmg: 4, worn: null, broke: false });
    expect(BARDING.CAPACITY).toBe(64);
  });
  it('reduces damage that goes through Mob.hurt', () => {
    const g = fakeGame(), pet = tamedHowler(g), bare = tamedHowler(g);
    pet.barding = { absorbed: 0 };
    const a = pet.health, b = bare.health;
    pet.hurt(6, 'mob:test'); bare.hurt(6, 'mob:test');
    expect(b - bare.health).toBeCloseTo(6);
    expect(a - pet.health).toBeCloseTo(3);
  });
  it('Shears take it off and it drops with its wear; worn barding goes back on as worn', () => {
    const g = fakeGame(), p = fakePlayer(), pet = tamedHowler(g);
    pet.barding = { absorbed: 20.5 };
    const shears = hold(p, { id: I.SHEARS, count: 1, damage: 0 });
    expect(removeBarding(g, pet, p, { id: I.STICK, count: 1 })).toBe(false);
    expect(removeBarding(g, pet, p, shears)).toBe(true);
    expect(pet.barding).toBeNull();
    expect(g.items).toEqual([{ id: I.HOWLER_BARDING, count: 1, damage: 21 }]);
    expect(removeBarding(g, pet, p, shears)).toBe(false);
    const again = hold(p, { ...g.items[0] });
    expect(equipBarding(g, pet, p, again)).toBe(true);
    expect(pet.barding.absorbed).toBe(21);
  });
  it('is saved with the Howler and read back', () => {
    const g = fakeGame(), pet = tamedHowler(g);
    pet.barding = { absorbed: 12.25 };
    const data = JSON.parse(JSON.stringify(pet.saveData()));
    expect(data.barding).toBe(12.25);
    const back = new Mob('howler', 0, 64, 0); back.loadData(data);
    expect(back.barding).toEqual({ absorbed: 12.25 });
    expect(back.tamed).toBe(true);
    const bare = tamedHowler(g);
    expect(JSON.parse(JSON.stringify(bare.saveData())).barding).toBeUndefined();
    const none = new Mob('howler', 0, 64, 0); none.loadData(JSON.parse(JSON.stringify(bare.saveData())));
    expect(none.barding).toBeUndefined();
    expect(bardingSave(back)).toEqual({ barding: 12.25 });
    // a corrupt or spent value is ignored
    const bad = new Mob('howler', 0, 64, 0); bad.loadData({ ...data, barding: 500 });
    expect(bad.barding).toBeUndefined();
  });
  it('shows as a plate on the Howler model', () => {
    expect(MODELS.howler.parts.some((q) => q[0] === 'bardingPlate' && q[5] && q[5].gear)).toBe(true);
  });
});
