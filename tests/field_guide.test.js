import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../src/mobs/dimensionMobs.js'; import '../src/mobs/oceanMobs.js'; import '../src/mobs/duneStrider.js'; import '../src/mobs/hoverling.js';
import '../src/mobs/gloomshell.js'; import '../src/mobs/hushkeeper.js'; import '../src/mobs/hostileVariants.js'; import '../src/mobs/gustling.js'; import '../src/mobs/peddler.js';
import { newGuide, loadGuide, saveGuide, discover, onDiscover, recordOf, guideOf, countFound, saveGuestGuide, loadGuestGuide, LEVEL, TABS } from '../src/player/fieldGuide.js';
import { entriesOf, keysOf, guideProgress, tabComplete, guideRows, entryName, isNotableItem, dropIds, climateOf, itemName } from '../src/player/fieldGuideEntries.js';
import { GuideTracker, canSee, lineClear, SEE_RANGE } from '../src/player/fieldGuideTracker.js';
import { newStats, loadStats, saveStats, recordKill } from '../src/player/stats.js';
import { MILESTONES } from '../src/player/milestones.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { BIOMES, BIOME } from '../src/world/biomes.js';
import { LANDMARK_KINDS } from '../src/world/landmarkKinds.js';
import { landmarksInBox } from '../src/world/landmarks.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { ACTIONS, resolveBindings, keyLists } from '../src/ui/bindings.js';
import { modelRects } from '../src/ui/guideArt.js';
import { MODELS } from '../src/mobs/models.js';
import { MockWorld } from './helpers.js';

beforeEach(() => onDiscover(null));

describe('guide state', () => {
  it('starts empty and discovers each entry once, raising its level only upward', () => {
    const g = newGuide();
    expect(TABS.every((t) => Object.keys(g[t]).length === 0)).toBe(true);
    expect(discover(g, 'creatures', 'shambler', LEVEL.SEEN, 100)).toBe(true);
    expect(discover(g, 'creatures', 'shambler', LEVEL.SEEN, 200)).toBe(false);
    expect(discover(g, 'creatures', 'shambler', LEVEL.KILLED, 300)).toBe(true);
    expect(discover(g, 'creatures', 'shambler', LEVEL.SEEN, 400)).toBe(false);
    expect(recordOf(g, 'creatures', 'shambler')).toEqual({ l: 2, t: 100 }); // the first time is kept
    expect(discover(g, 'nope', 'x')).toBe(false);
    expect(discover(g, 'items', '')).toBe(false);
  });

  it('tells a listener of every new discovery', () => {
    const fn = vi.fn(); onDiscover(fn);
    const g = newGuide();
    discover(g, 'biomes', 'plains'); discover(g, 'biomes', 'plains');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(g, 'biomes', 'plains', 1);
  });

  it('round-trips through JSON, keeping a structure site, and survives damaged saves', () => {
    const g = newGuide();
    discover(g, 'structures', 'village', LEVEL.FOUND, 50, { x: 10.4, z: -20.6 });
    discover(g, 'items', '300', 1, 9);
    const back = loadGuide(JSON.parse(JSON.stringify(saveGuide(g))));
    expect(back).toEqual(g);
    expect(back.structures.village).toEqual({ l: 2, t: 50, x: 10, z: -21 });
    for (const bad of [undefined, null, 'junk', 7, { creatures: 5, biomes: [], items: { a: null, b: { l: 'x' }, c: { l: -1 }, [' '.repeat(60)]: { l: 1 } } }]) {
      expect(loadGuide(bad)).toEqual(newGuide());
    }
    const copy = loadGuide(g); discover(g, 'biomes', 'taiga');
    expect(copy.biomes.taiga).toBeUndefined(); // (loading copies)
  });

  it('guideOf makes the guide on a stats object that lacks one', () => {
    const s = { kills: 0 };
    expect(guideOf(s).creatures).toEqual({});
    s.guide.items = null;
    expect(guideOf(s).items).toEqual({});
  });

  it('is saved and loaded with the statistics, and a kill defeats the creature in the guide', () => {
    const s = newStats();
    s.ticks = 777;
    recordKill(s, 'rattler');
    expect(recordOf(s.guide, 'creatures', 'rattler')).toEqual({ l: LEVEL.KILLED, t: 777 });
    const back = loadStats(JSON.parse(JSON.stringify(saveStats(s))));
    expect(back.guide).toEqual(s.guide);
    expect(loadStats({ blocksMined: 3 }).guide).toEqual(newGuide()); // an older save has none
    const lacks = { kills: 0 }; recordKill(lacks, 'wobbler');
    expect(lacks.guide.creatures.wobbler.l).toBe(LEVEL.KILLED);
  });

  it('a guest keeps its guide in local storage, and a broken store is harmless', () => {
    const store = new Map();
    const storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) ?? null };
    const g = newGuide(); discover(g, 'biomes', 'desert', 1, 5);
    expect(saveGuestGuide(g, storage)).toBe(true);
    expect(loadGuestGuide(storage)).toEqual(g);
    expect(loadGuestGuide({ getItem: () => 'not json' })).toEqual(newGuide());
    expect(saveGuestGuide(g, { setItem: () => { throw new Error('full'); } })).toBe(false);
    expect(loadGuestGuide(null)).toEqual(newGuide());
  });
});

describe('entries come from the data tables', () => {
  it('has one creature per mob, one biome per biome, one structure per landmark kind', () => {
    expect(entriesOf('creatures').map((e) => e.key)).toEqual(Object.keys(MOBS));
    expect(entriesOf('biomes').map((e) => e.key)).toEqual(BIOMES.map((b) => b.key));
    expect(entriesOf('structures').map((e) => e.key)).toEqual(LANDMARK_KINDS.map((k) => k.key));
    expect(entriesOf('items').length).toBeGreaterThan(20);
    expect(entriesOf('nope')).toEqual([]);
    expect(entriesOf('creatures')).toBe(entriesOf('creatures')); // built once
  });

  it('keeps entry keys unique and names non-empty', () => {
    for (const tab of TABS) {
      const es = entriesOf(tab);
      expect(new Set(es.map((e) => e.key)).size, tab).toBe(es.length);
      for (const e of es) expect(e.name && e.name !== '?', `${tab}:${e.key}`).toBeTruthy();
    }
  });

  it('gives every creature a habitat and reads its drops and foods from the definition', () => {
    for (const e of entriesOf('creatures')) expect(e.habitat.length, e.key).toBeGreaterThan(0);
    const by = (k) => entriesOf('creatures').find((e) => e.key === k);
    expect(by('fleecer').habitat).toContain('Plains');
    expect(by('shambler').habitat[0]).toMatch(/dark/i);
    expect(by('dune_shambler').habitat).toContain('Desert');
    expect(by('ember_lord').habitat).toContain('The Cinderdeep');
    expect(by('mooxen').feeds).toEqual([I.WHEAT]);
    expect(by('howler').tames).toEqual([I.BONE]);
    expect(by('vixling').tames).toEqual([I.SWEET_BERRIES, I.GLOW_BERRIES]);
    expect(by('bristleback').tames).toEqual([I.BAKED_POTATO]);
    expect(by('shambler').drops).toEqual([I.ROTTEN_FLESH, I.IRON_INGOT, I.CARROT, I.POTATO].filter((id) => dropIds(MOBS.shambler).includes(id)));
    expect(by('mooxen').drops).toContain(I.STEAK); // the cooked drop is listed too
    expect(by('void_wyrm').traits).toContain('Boss');
  });

  it('describes biomes by climate, with the wildlife of their spawn tables', () => {
    const by = (k) => entriesOf('biomes').find((e) => e.key === k);
    expect(climateOf(-0.7)).toBe('Frozen');
    expect(by('desert').climate).toBe('Hot');
    expect(by('desert').features).toContain('Dry: no rain');
    expect(by('snowy_plains').features).toContain('Snow falls instead of rain');
    expect(by('taiga').wildlife).toContain('Howler');
    expect(by('swamp').features).toContain('Its own grass and leaf colour');
  });

  it('links structures to the Explorer Chart that finds them', () => {
    const by = (k) => entriesOf('structures').find((e) => e.key === k);
    expect(by('tomb').chart).toBe('Sun Tomb Chart');
    expect(by('village').chart).toBeNull();
    for (const e of entriesOf('structures')) expect(e.note.length, e.key).toBeGreaterThan(5);
  });

  it('lists mob drops, charts and rare finds as items of note', () => {
    expect(isNotableItem(I.ROTTEN_FLESH)).toBe(true);
    expect(isNotableItem(I.DIAMOND)).toBe(true);
    expect(isNotableItem(B.DIRT)).toBe(false);
    expect(entryName('items', I.GUNPOWDER)).toBe(itemName(I.GUNPOWDER));
    expect(entriesOf('items').find((e) => e.id === I.GUNPOWDER).from).toContain('Fizzler');
    expect(entryName('creatures', 'nobody')).toBeNull();
  });

  it('says nothing of the reference game by name', () => {
    const text = TABS.flatMap((t) => entriesOf(t)).map((e) => JSON.stringify(e)).join(' ');
    expect(text).not.toMatch(/minecraft|nether|redstone|\bend\b/i);
  });
});

describe('progress and the tab milestones', () => {
  it('counts what is found per tab and completes a tab only when every entry is', () => {
    const g = newGuide();
    expect(guideProgress(g).map((p) => p.found)).toEqual([0, 0, 0, 0]);
    expect(guideProgress(g).map((p) => p.total)).toEqual(TABS.map((t) => keysOf(t).size));
    for (const b of BIOMES.slice(1)) discover(g, 'biomes', b.key);
    expect(tabComplete(g, 'biomes')).toBe(false);
    discover(g, 'biomes', BIOMES[0].key);
    expect(tabComplete(g, 'biomes')).toBe(true);
    expect(tabComplete(g, 'creatures')).toBe(false);
    discover(g, 'biomes', 'not_a_biome'); // (unknown keys do not count)
    expect(countFound(g, 'biomes', keysOf('biomes'))).toBe(BIOMES.length);
    expect(guideRows(g)[1]).toEqual(['Field Guide: Biomes', `${BIOMES.length} / ${BIOMES.length}`]);
    expect(tabComplete(null, 'biomes')).toBe(false);
  });

  it('has a milestone for each tab that unlocks when the tab is complete', () => {
    for (const [id, tab] of [['guide_creatures', 'creatures'], ['guide_biomes', 'biomes'], ['guide_structures', 'structures'], ['guide_items', 'items']]) {
      const m = MILESTONES.find((x) => x.id === id);
      expect(m, id).toBeTruthy();
      expect(m.icon).toBeGreaterThan(0);
      expect(`${m.title} ${m.desc}`).not.toMatch(/minecraft|nether|redstone|\bend\b/i);
      const stats = newStats();
      const game = { player: { stats } };
      expect(m.tick(game)).toBe(false);
      for (const k of keysOf(tab)) discover(stats.guide, tab, k);
      expect(m.tick(game)).toBe(true);
      expect(m.tick({ player: {} })).toBe(false); // (a player without statistics)
    }
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('seeing creatures', () => {
  const eye = [0, 65.6, 0], look = [0, 0, -1];
  const mob = (over = {}) => ({ kind: 'mob', type: 'fleecer', x: 0, y: 64, z: -10, def: MOBS.fleecer, ...over });

  it('sees what is in front, in range and in the open', () => {
    const w = new MockWorld(60);
    expect(canSee(w, eye, look, mob())).toBe(true);
    expect(canSee(w, eye, look, mob({ z: 10 }))).toBe(false); // behind
    expect(canSee(w, eye, look, mob({ z: 3 }))).toBe(true); // close by counts all round
    expect(canSee(w, eye, look, mob({ z: -(SEE_RANGE + 5) }))).toBe(false); // too far
    expect(canSee(w, eye, look, mob({ y: 64 - 40 }))).toBe(false); // far below
  });

  it('does not see through a wall', () => {
    const w = new MockWorld(60);
    for (let y = 60; y < 70; y++) w.set(0, y, -5, B.STONE);
    expect(lineClear(w, eye, [0, 65, -10])).toBe(false);
    expect(canSee(w, eye, look, mob())).toBe(false);
    expect(lineClear(w, eye, [3, 65, -2])).toBe(true);
  });
});

describe('the tracker', () => {
  const SEED = 12345;
  const gen = new TerrainGenerator(SEED);

  function fakeGame(over = {}) {
    const stats = newStats();
    const slots = new Array(36).fill(null);
    return {
      ticks: 0,
      player: {
        x: 0, y: 70, z: 0, dead: false, stats, inventory: { slots, armor: [null, null, null, null] },
        eyePos: () => [0, 71.6, 0], lookDir: () => [0, 0, -1], ...over.player,
      },
      world: { dimension: 'overworld', gen, biomeAt: () => BIOME.PLAINS, getBlock: () => 0, ...over.world },
      entities: { list: [], ...over.entities },
      hud: { toast: vi.fn() },
      net: over.net,
    };
  }

  it('notes a creature once it is seen, and only the first time', () => {
    const g = fakeGame();
    g.entities.list.push({ kind: 'mob', type: 'fleecer', x: 0, y: 70, z: -8, def: MOBS.fleecer }, { kind: 'item', type: 'x', x: 0, y: 70, z: -3 });
    g.entities.list.push({ kind: 'mob', type: 'rattler', x: 0, y: 70, z: 20, def: MOBS.rattler }); // behind
    const t = new GuideTracker(g);
    g.ticks = 10; t.tick();
    expect(Object.keys(g.player.stats.guide.creatures)).toEqual(['fleecer']);
    expect(g.player.stats.guide.creatures.fleecer.l).toBe(LEVEL.SEEN);
    g.entities.list[2].z = -6; g.ticks = 20; t.tick();
    expect(recordOf(g.player.stats.guide, 'creatures', 'rattler')).toBeTruthy();
  });

  it('notes the biome underfoot, only in the overworld', () => {
    const g = fakeGame({ world: { biomeAt: () => BIOME.DESERT } });
    const t = new GuideTracker(g);
    g.ticks = 3; t.tick();
    expect(recordOf(g.player.stats.guide, 'biomes', 'desert')).toBeTruthy();
    const h = fakeGame({ world: { dimension: 'cinderdeep', biomeAt: () => BIOME.FOREST } });
    const u = new GuideTracker(h);
    h.ticks = 3; u.tick();
    expect(h.player.stats.guide.biomes).toEqual({});
  });

  it('notes a structure within sight, with where it stands, and a chart locates one', () => {
    let site = null;
    for (let x = -1500; x <= 1500 && !site; x += 250) for (let z = -1500; z <= 1500 && !site; z += 250) site = landmarksInBox(gen, x - 125, z - 125, x + 125, z + 125)[0] || null;
    expect(site).toBeTruthy();
    const g = fakeGame({ player: { x: site.x, z: site.z } });
    const t = new GuideTracker(g);
    g.ticks = 11; t.tick();
    const r = recordOf(g.player.stats.guide, 'structures', site.kind);
    expect(r.l).toBe(LEVEL.FOUND);
    expect(r.x).toBe(site.x);
    const h = fakeGame();
    new GuideTracker(h).located('tomb', { x: 400, z: -80 });
    expect(recordOf(h.player.stats.guide, 'structures', 'tomb')).toMatchObject({ l: LEVEL.LOCATED, x: 400, z: -80 });
    expect(discover(h.player.stats.guide, 'structures', 'tomb', LEVEL.FOUND)).toBe(true); // visiting raises it
    expect(recordOf(h.player.stats.guide, 'structures', 'tomb')).toMatchObject({ l: LEVEL.FOUND, x: 400, z: -80 }); // and keeps the site
  });

  it('notes items of note in the inventory (and armour), not plain blocks', () => {
    const g = fakeGame();
    g.player.inventory.slots[0] = { id: I.GUNPOWDER, count: 2 };
    g.player.inventory.slots[1] = { id: B.DIRT, count: 5 };
    g.player.inventory.armor[0] = { id: I.DIAMOND, count: 1 };
    const t = new GuideTracker(g);
    g.player.stats.ticks = 1234;
    t.checkInventory();
    expect(Object.keys(g.player.stats.guide.items).sort()).toEqual([String(I.GUNPOWDER), String(I.DIAMOND)].sort());
    expect(g.player.stats.guide.items[I.GUNPOWDER].t).toBe(1234);
  });

  it('raises one coalesced toast, and does nothing while dead', () => {
    const g = fakeGame();
    const t = new GuideTracker(g);
    discover(g.player.stats.guide, 'biomes', 'plains');
    g.ticks = 40; t.tick();
    expect(g.hud.toast).toHaveBeenCalledWith('Field Guide: Plains');
    discover(g.player.stats.guide, 'biomes', 'forest'); discover(g.player.stats.guide, 'biomes', 'taiga');
    g.ticks = 80; t.tick();
    expect(g.hud.toast).toHaveBeenLastCalledWith('Field Guide: 2 new entries');
    g.ticks = 120; t.tick();
    expect(g.hud.toast).toHaveBeenCalledTimes(2);
    const d = fakeGame({ player: { dead: true } });
    d.entities.list.push({ kind: 'mob', type: 'fleecer', x: 0, y: 70, z: -8, def: MOBS.fleecer });
    d.ticks = 10; new GuideTracker(d).tick();
    expect(d.player.stats.guide.creatures).toEqual({});
  });
});

describe('model pictures and controls', () => {
  it('paints every mob from its box model, normalised to a unit square', () => {
    for (const k of Object.keys(MOBS)) {
      const rects = modelRects(MODELS[k]);
      expect(rects.length, k).toBeGreaterThan(0);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(-1e-9); expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9); expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    expect(modelRects(undefined)).toEqual([]);
  });

  it('binds the Field Guide to a key and a gamepad button nothing else uses', () => {
    const a = ACTIONS.find((x) => x.id === 'guide');
    expect(a.label).toBe('Field Guide');
    const t = resolveBindings();
    expect(t.guide).toEqual(['KeyJ', null, 'PadX']);
    expect(keyLists(t).guide).toEqual(['KeyJ', 'PadX']);
    expect(resolveBindings({ guide: [null, null, null] }).guide).toEqual([null, null, null]);
    const codes = ACTIONS.filter((x) => x.id !== 'guide').flatMap((x) => x.def.filter(Boolean));
    expect(codes).not.toContain('KeyJ'); expect(codes).not.toContain('PadX');
  });
});
