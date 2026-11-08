// Existing-save retrofit (world/retrofit.js, /retrofit), the accessibility round (shape cues, UI scale, larger subtitles, reduced
// particles, remappable keys, focus rings) and the performance round (frame graph, sleeping items, grid merging, remesh budget).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TerrainGenerator } from '../src/world/generator.js';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { CHUNK_VOLUME } from '../src/world/constants.js';
import { chunkKey } from '../src/world/world.js';
import { packChunk, unpackChunk } from '../src/world/save.js';
import {
  FEATURES, CURRENT_FEATURE_VERSION, cleanFeatureVersion, featuresSince, planChunkRetrofit, retrofitSaved, describeReport, groupCells, unkey,
} from '../src/world/retrofit.js';
import { runRetrofitCommand } from '../src/world/retrofitCommand.js';
import { runCommand, CHEAT_COMMANDS, HELP } from '../src/ui/commands.js';
import {
  ACCESS_DEFAULTS, ACCESS_CLASSES, accessClasses, motionScales, hudPalette, bossBarLabel, raidBarLabel, cleanUiScale, screenZoom,
  applyAccessToRoot, UI_SCALE_MIN, UI_SCALE_MAX,
} from '../src/ui/accessibility.js';
import { buildIcons } from '../src/ui/hud.js';
import { ACTIONS, ACTION_IDS, FIXED, defaultTable, resolveBindings } from '../src/ui/bindings.js';
import { FrameGraph, FRAME_SAMPLES } from '../src/ui/frameGraph.js';
import { Particles } from '../src/render/particles.js';
import { ItemEntity, mergeItems, MAX_LOOSE_ITEMS, ITEM_SLEEP_AFTER } from '../src/entities/entities.js';
import { ChunkRenderer, URGENT_MIN } from '../src/render/chunkRenderer.js';
import { canStack } from '../src/world/enchantments.js';
import { MockWorld } from './helpers.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const GEN = src('src/world/generator.js');
const CSS = src('src/ui/style.css');

// ---- a saved chunk as an older game would have written it: the generator's output with the newer passes taken back out --------
function revertingHook(log) {
  let sb, sm, sbio;
  return {
    before(name, b, m, bio) { sb = b.slice(); sm = m.slice(); sbio = bio.slice(); },
    after(name, b, m, bio) { log.push({ sb, sm, sbio, b, m, bio }); },
  };
}
function legacyChunk(gen, cx, cz, fv = 0) {
  const log = [];
  gen.passHook = revertingHook(log);
  const full = gen.generate(cx, cz);
  gen.passHook = null;
  for (const L of log.reverse()) { // newest pass first
    for (let i = 0; i < CHUNK_VOLUME; i++) if (L.b[i] !== L.sb[i] || L.m[i] !== L.sm[i]) { full.blocks[i] = L.sb[i]; full.meta[i] = L.sm[i]; }
    for (let c = 0; c < 256; c++) if (L.bio[c] !== L.sbio[c]) full.biomes[c] = L.sbio[c];
  }
  return { ...full, light: new Uint8Array(CHUNK_VOLUME), fv, modified: true };
}

const SEED = 12345;
let gen, fresh, found;
function setup() {
  if (found) return;
  gen = new TerrainGenerator(SEED);
  found = [];
  for (let cx = -4; cx < 4 && found.length < 3; cx++) for (let cz = -4; cz < 4 && found.length < 3; cz++) {
    const old = legacyChunk(gen, cx, cz);
    const plan = planChunkRetrofit(gen, cx, cz, old);
    if (plan.units.some((u) => u.status === 'apply')) found.push({ cx, cz, old, plan });
  }
  fresh = (cx, cz) => gen.generate(cx, cz);
}

describe('feature versions', () => {
  it('lists every later pass the generator runs, once, with a version', () => {
    const calls = [...GEN.matchAll(/this\.pass\('([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(calls.sort()).toEqual(FEATURES.map((f) => f.key).sort());
    expect(new Set(calls).size).toBe(calls.length);
    for (const f of FEATURES) { expect(f.since).toBeGreaterThanOrEqual(1); expect(f.link).toBeGreaterThanOrEqual(1); expect(f.label.length).toBeGreaterThan(3); }
    expect(CURRENT_FEATURE_VERSION).toBe(Math.max(...FEATURES.map((f) => f.since)));
    expect(featuresSince(CURRENT_FEATURE_VERSION)).toEqual([]);
    expect(featuresSince(0).length).toBe(FEATURES.length);
  });
  it('lists the passes in the order the generator runs them', () => {
    const order = [...GEN.matchAll(/this\.pass\('([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(order).toEqual(FEATURES.map((f) => f.key));
  });
  it('cleans stored versions', () => {
    expect(cleanFeatureVersion(2)).toBe(2);
    expect(cleanFeatureVersion(999)).toBe(CURRENT_FEATURE_VERSION);
    for (const bad of [-1, 1.5, '3', null, undefined, NaN]) expect(cleanFeatureVersion(bad, 0)).toBe(0);
    expect(cleanFeatureVersion(undefined, CURRENT_FEATURE_VERSION)).toBe(CURRENT_FEATURE_VERSION);
  });
  it('a pass hook changes nothing about what the generator makes', () => {
    const g = new TerrainGenerator(SEED);
    for (const [cx, cz] of [[0, 0], [-3, 2]]) {
      const a = g.generate(cx, cz);
      g.passHook = { before() {}, after() {} };
      const b = g.generate(cx, cz);
      g.passHook = null;
      expect(Buffer.from(b.blocks.buffer).equals(Buffer.from(a.blocks.buffer))).toBe(true);
      expect(Buffer.from(b.meta).equals(Buffer.from(a.meta))).toBe(true);
      expect(Buffer.from(b.biomes).equals(Buffer.from(a.biomes))).toBe(true);
    }
  });
  it('leaves the carver reference digest in perf_pass2 as it was', () => {
    expect(src('tests/perf_pass2.test.js')).toContain("hash: '9420d8710a417724c66c96c305c27134085f06dcd88b6db5fac6e310ccb8d64a', carved: 54258");
  });
  it('a chunk generated now is at the current version; saved chunks carry theirs, and an old record reads as 0', () => {
    const w = new World(1);
    const d = new TerrainGenerator(1).generate(0, 0);
    const c = w.addChunk(0, 0, { ...d, light: new Uint8Array(CHUNK_VOLUME) });
    expect(c.fv).toBe(CURRENT_FEATURE_VERSION);
    c.modified = true;
    const packed = packChunk(c);
    expect(packed.fv).toBe(CURRENT_FEATURE_VERSION);
    expect(unpackChunk(packed).fv).toBe(CURRENT_FEATURE_VERSION);
    const legacy = { ...packed }; delete legacy.fv;
    expect(unpackChunk(legacy).fv).toBe(0);
    // an unloaded chunk keeps it
    w.removeChunk(0, 0);
    expect(w.saved.get(chunkKey(0, 0)).fv).toBe(CURRENT_FEATURE_VERSION);
    const back = new World(1);
    back.saved.set(chunkKey(5, 5), { ...unpackChunk(legacy) });
    expect(back.addChunk(5, 5, null).fv).toBe(0);
  });
  it('groups cells that touch and keeps distant ones apart', () => {
    const at = (x, y, z) => x | (z << 4) | (y << 8);
    const groups = groupCells([at(1, 5, 1), at(2, 5, 1), at(2, 6, 2), at(12, 5, 12), at(13, 5, 12)], 1);
    expect(groups.map((g) => g.length).sort()).toEqual([2, 3]);
    expect(groupCells([at(1, 5, 1), at(4, 5, 1)], 1).length).toBe(2);
    expect(groupCells([at(1, 5, 1), at(4, 5, 1)], 3).length).toBe(1);
  });
  it('turns chunk keys back into coordinates', () => {
    for (const [cx, cz] of [[0, 0], [-3, 7], [100, -250]]) expect(unkey(chunkKey(cx, cz))).toEqual([cx, cz]);
  });
});

describe('retrofitting an untouched old chunk', () => {
  it('finds chunks with placeable features to test on', () => { setup(); expect(found.length).toBeGreaterThan(1); }, 120000);

  it('restores exactly what the generator makes, on the cells it places, and nothing else', () => {
    setup();
    for (const { cx, cz, old } of found) {
      const snap = Buffer.from(old.blocks.buffer.slice(0));
      const plan = planChunkRetrofit(gen, cx, cz, old, { materialize: true });
      expect(plan.placed).toBeGreaterThan(0);
      const out = plan.result, full = fresh(cx, cz);
      let changed = 0;
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        if (out.blocks[i] !== old.blocks[i] || out.meta[i] !== old.meta[i]) {
          changed++;
          expect(out.blocks[i]).toBe(full.blocks[i]); expect(out.meta[i]).toBe(full.meta[i]); // never anything the generator would not have made
          expect([B.AIR, B.WATER]).toContain(old.blocks[i]);                                    // and only into air or water
        }
      }
      expect(changed).toBe(plan.placed);
      expect(out.heightmap.length).toBe(256);
      expect(out.light.length).toBe(CHUNK_VOLUME);
      expect(Buffer.from(old.blocks.buffer).equals(snap)).toBe(true); // (the input was not written to)
    }
  }, 120000);

  it('never replaces a block a player changed, and skips the whole unit instead of placing half of it', () => {
    setup();
    const { cx, cz, old, plan } = found[0];
    const unit = plan.units.find((u) => u.status === 'apply');
    const edited = { ...old, blocks: new Uint16Array(old.blocks) };
    edited.blocks[unit.first] = B.COBBLESTONE; // somebody built here
    const again = planChunkRetrofit(gen, cx, cz, edited, { materialize: true });
    expect(again.units.find((u) => u.first === unit.first && u.pass === unit.pass).status).toBe('edited');
    const out = again.result ? again.result.blocks : edited.blocks;
    expect(out[unit.first]).toBe(B.COBBLESTONE);
    // none of the other cells of that unit were touched either: the count placed fell by the unit's size
    expect(again.placed).toBe(plan.placed - unit.cells);
  }, 120000);

  it('leaves cells alone that sit below the ground, and cells a player built over', () => {
    setup();
    const { cx, cz, old, plan } = found[0];
    const unit = plan.units.find((u) => u.status === 'apply');
    const roofed = { ...old, blocks: new Uint16Array(old.blocks) };
    // a stone roof high above the unit's first cell (in its column): the unit is no longer above the surface
    const col = unit.first & 255;
    for (let y = (unit.first >> 8) + 1; y < 380; y++) roofed.blocks[col | (y << 8)] = B.STONE;
    const r = planChunkRetrofit(gen, cx, cz, roofed);
    const status = r.units.find((u) => u.first === unit.first && u.pass === unit.pass).status;
    expect(status).not.toBe('apply');
    expect(['underground', 'edited']).toContain(status); // (edited when the roof ran through more cells of the same unit)
  }, 120000);

  it('is idempotent: a second look finds everything it placed "already there"', () => {
    setup();
    const { cx, cz, old } = found[0];
    const first = planChunkRetrofit(gen, cx, cz, old, { materialize: true });
    const done = { ...old, ...first.result, fv: 0 };
    const second = planChunkRetrofit(gen, cx, cz, done);
    expect(second.placed).toBe(0);
    expect(second.units.filter((u) => u.status === 'present').length).toBe(first.units.filter((u) => u.status === 'apply').length);
    // and at the current version there is nothing to look at
    expect(planChunkRetrofit(gen, cx, cz, { ...done, fv: CURRENT_FEATURE_VERSION }).units).toEqual([]);
  }, 120000);

  it('only looks at passes newer than the chunk', () => {
    setup();
    const { cx, cz, old } = found[0];
    const all = planChunkRetrofit(gen, cx, cz, old);
    const some = planChunkRetrofit(gen, cx, cz, { ...old, fv: 3 });
    const passes = new Set(some.units.map((u) => u.pass));
    for (const p of passes) expect(FEATURES.find((f) => f.key === p).since).toBeGreaterThan(3);
    expect(some.units.length).toBeLessThanOrEqual(all.units.length);
  }, 120000);
});

describe('retrofitting a world', () => {
  const savedWorld = () => {
    setup();
    const w = new World(SEED);
    w.gen = gen;
    for (const { cx, cz, old } of found) w.saved.set(chunkKey(cx, cz), { ...old, rev: 3, packRev: 3, packCache: { stale: true } });
    return w;
  };

  it('a dry run counts and changes nothing', () => {
    const w = savedWorld();
    const before = [...w.saved].map(([k, c]) => [k, c.blocks, Buffer.from(c.blocks.buffer).toString('base64').length, c.fv]);
    const r = retrofitSaved(w, { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.scanned).toBe(found.length);
    expect(r.cells).toBeGreaterThan(0);
    expect(r.changedChunks).toBeGreaterThan(0);
    for (const [k, blocks, len, fv] of before) {
      const c = w.saved.get(k);
      expect(c.blocks).toBe(blocks); expect(Buffer.from(c.blocks.buffer).toString('base64').length).toBe(len); expect(c.fv).toBe(fv);
    }
    expect(describeReport(r).join('\n')).toMatch(/Dry run/);
    expect(describeReport(r).join('\n')).toMatch(/Nothing was changed/);
  }, 120000);

  it('the real run places what the dry run counted, brings chunks to the current version and drops the stale pack', () => {
    const w = savedWorld();
    const dry = retrofitSaved(w, { dryRun: true });
    const real = retrofitSaved(w, { dryRun: false });
    expect(real.cells).toBe(dry.cells);
    expect(real.byFeature).toEqual(dry.byFeature);
    for (const c of w.saved.values()) {
      expect(c.fv).toBe(CURRENT_FEATURE_VERSION);
      expect(c.modified).toBe(true);
    }
    // every chunk visited drops its remembered pack (it still names the old version), changed or not
    const all = [...w.saved.values()];
    expect(all.every((c) => c.packCache === null)).toBe(true);
    for (const c of all) { expect(c.rev).toBe(4); expect(c.packRev).toBe(-1); }
    expect(all.length).toBeGreaterThanOrEqual(real.changedChunks);
    // a second run has nothing to do
    const again = retrofitSaved(w, { dryRun: false });
    expect(again.scanned).toBe(0); expect(again.current).toBe(found.length);
  }, 120000);

  it('works through a limited number of chunks per run and says how many are left', () => {
    const w = savedWorld();
    const r = retrofitSaved(w, { dryRun: false, limit: 1 });
    expect(r.scanned).toBe(1);
    expect(r.remaining).toBe(found.length - 1);
    expect(describeReport(r).join('\n')).toMatch(/to go: run the command again/);
    const r2 = retrofitSaved(w, { dryRun: false, limit: 50 });
    expect(r2.scanned).toBe(found.length - 1);
  }, 120000);

  it('never touches a loaded chunk, and says so', () => {
    setup();
    const w = new World(SEED);
    w.gen = gen;
    const { cx, cz, old } = found[0];
    w.addChunk(cx, cz, { ...old, modified: true });
    const r = retrofitSaved(w, { dryRun: false });
    expect(r.scanned).toBe(0);
    expect(r.loadedSkipped).toBe(1);
    expect(describeReport(r).join('\n')).toMatch(/loaded right now/);
  }, 120000);
});

describe('/retrofit', () => {
  const fakeGame = (over = {}) => ({ world: { dimension: 'overworld', saved: new Map(), chunks: new Map(), gen: null }, featureVersion: 0, net: null, cmdActor: null, allowCheats: true, ...over });
  it('is a cheat command listed in /help', () => {
    expect(CHEAT_COMMANDS.has('retrofit')).toBe(true);
    expect(HELP.join('\n')).toMatch(/\/retrofit/);
    expect(runCommand({ ...fakeGame(), allowCheats: false }, '/retrofit dry')).toBe('Cheats are turned off in this world');
  });
  it('reports the status, validates its arguments and is for the host in the overworld', () => {
    const g = fakeGame();
    expect(runRetrofitCommand(g, []).join(' ')).toMatch(/Feature version 0 of/);
    expect(runRetrofitCommand(g, ['bogus'])).toMatch(/Usage/);
    expect(runRetrofitCommand(g, ['dry', 'x'])).toMatch(/Usage/);
    expect(runRetrofitCommand(g, ['apply', '0'])).toMatch(/Usage/);
    expect(runRetrofitCommand({ ...g, net: { isHost: false } }, ['dry'])).toMatch(/Only the host/);
    expect(runRetrofitCommand({ ...g, net: { isHost: true }, cmdActor: { host: false } }, ['dry'])).toMatch(/Only the host/);
    expect(runRetrofitCommand({ ...g, world: { ...g.world, dimension: 'hollow' } }, ['dry'])).toMatch(/overworld/);
  });
  it('an empty world is brought to the current version by apply (and not by dry)', () => {
    const g = fakeGame();
    runRetrofitCommand(g, ['dry']);
    expect(g.featureVersion).toBe(0);
    const out = runRetrofitCommand(g, ['apply']);
    expect(g.featureVersion).toBe(CURRENT_FEATURE_VERSION);
    expect(out.join(' ')).toMatch(/feature version/);
  });
  it('does not claim the version while chunks are left or loaded', () => {
    setup();
    const w = new World(SEED); w.gen = gen;
    for (const { cx, cz, old } of found) w.saved.set(chunkKey(cx, cz), { ...old });
    const g = fakeGame({ world: w });
    runRetrofitCommand(g, ['apply', '1']);
    expect(g.featureVersion).toBe(0);
    runRetrofitCommand(g, ['apply']);
    expect(g.featureVersion).toBe(CURRENT_FEATURE_VERSION);
  }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------------
describe('accessibility: shape cues, UI scale, larger subtitles', () => {
  it('has the new settings off by default', () => {
    expect(ACCESS_DEFAULTS.shapeCues).toBe(false);
    expect(ACCESS_DEFAULTS.largeCaptions).toBe(false);
    expect(ACCESS_DEFAULTS.uiScale).toBe(1);
    expect(accessClasses({})).toEqual([]);
  });
  it('maps them to root classes that all exist in ACCESS_CLASSES and in the stylesheet', () => {
    const on = accessClasses({ shapeCues: true, largeCaptions: true, uiScale: 1.25 });
    expect(on).toEqual(['cue-shapes', 'large-captions', 'ui-scaled']);
    for (const c of ['cue-shapes', 'large-captions', 'ui-scaled']) { expect(ACCESS_CLASSES).toContain(c); expect(CSS).toContain('html.' + c); }
    expect(accessClasses({ colorBlind: 'blueyellow' })).toContain('cue-shapes');
  });
  it('cleans the UI scale to 75-150 % in 5 % steps', () => {
    expect(cleanUiScale(1)).toBe(1);
    expect(cleanUiScale(0.1)).toBe(UI_SCALE_MIN);
    expect(cleanUiScale(9)).toBe(UI_SCALE_MAX);
    expect(cleanUiScale(1.23)).toBe(1.25);
    expect(cleanUiScale('1.1')).toBe(1.1);
    for (const bad of ['', 'x', null, undefined, NaN, Infinity, {}]) expect(cleanUiScale(bad)).toBe(1);
    expect(screenZoom({ uiScale: 1.5, largeText: true })).toBeCloseTo(1.95);
    expect(screenZoom({})).toBe(1);
  });
  it('puts the classes and the scale variables on the page root', () => {
    const classes = new Set(), vars = new Map();
    const root = { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }, style: { setProperty: (k, v) => vars.set(k, v), removeProperty: (k) => vars.delete(k) } };
    applyAccessToRoot(root, { uiScale: 1.5, largeCaptions: true });
    expect(classes.has('ui-scaled')).toBe(true); expect(classes.has('large-captions')).toBe(true);
    expect(vars.get('--ui-scale')).toBe('1.5'); expect(vars.get('--tz')).toBe('1.5');
    applyAccessToRoot(root, {});
    expect(classes.size).toBe(0); expect(vars.has('--tz')).toBe(false); expect(vars.get('--ui-scale')).toBe('1');
    applyAccessToRoot(root, { uiScale: 'garbage' });
    expect(vars.get('--ui-scale')).toBe('1');
  });
  it('offers the controls on the Accessibility screen and wires them in game.js', () => {
    const scr = src('src/ui/screens.js'), game = src('src/game.js');
    expect(scr).toMatch(/data-k="shapeCues"/); expect(scr).toMatch(/data-k="largeCaptions"/);
    expect(scr).toMatch(/id="ui-scale"/); expect(scr).toMatch(/type="range"[^>]*min="\$\{Math\.round\(UI_SCALE_MIN \* 100\)\}"/);
    expect(game).toMatch(/'shapeCues', 'uiScale', 'largeCaptions'/);
    expect(src('src/main.js')).toMatch(/applyAccessToRoot/);
  });
  it('adds shapes to the status icons and labels to the boss and raid bars, without relying on colour', () => {
    expect(hudPalette('off').marks).toBe(false);
    expect(hudPalette('off', true).marks).toBe(true);
    expect(hudPalette('off', true).heart).toBe(hudPalette('off').heart); // same colours, more shapes
    const plain = buildIcons(hudPalette('off')), cued = buildIcons(hudPalette('off', true));
    expect(cued.heartPoison).not.toBe(plain.heartPoison); // the cross
    expect(cued.foodHunger).not.toBe(plain.foodHunger);
    expect(cued.heartGold).not.toBe(plain.heartGold);     // the diamond on bonus hearts
    expect(cued.heartGoldHalf).not.toBe(plain.heartGoldHalf);
    const boss = { name: 'Slag Colossus', frac: 0.4, phase: 2, phases: [0.66, 0.33], shielded: true };
    expect(bossBarLabel(boss)).toBe('Slag Colossus, phase 2 of 3');
    expect(bossBarLabel(boss, true)).toMatch(/40%/); expect(bossBarLabel(boss, true)).toMatch(/SHIELDED/);
    expect(bossBarLabel({ ...boss, shielded: false }, true)).not.toMatch(/SHIELDED/);
    expect(raidBarLabel({ label: 'Raid', state: 'won' }, true)).toMatch(/^✓/);
    expect(raidBarLabel({ label: 'Raid', state: 'won' }, false)).toBe('Raid');
    expect(CSS).toMatch(/html\.cue-shapes #bossbar\.shielded \.bb-fill \{[^}]*repeating-linear-gradient/);
  });
  it('bigger captions are a rule of their own, not just large text', () => {
    expect(CSS).toMatch(/html\.large-captions #captions \.caption \{[^}]*font-size: 24px/);
  });
});

describe('accessibility: reduced motion covers particles and shaking', () => {
  it('scales particles and shake with Reduce motion only', () => {
    expect(motionScales({}).particles).toBe(1); expect(motionScales({}).shake).toBe(1);
    expect(motionScales({ reduceMotion: true }).particles).toBeLessThan(0.5);
    expect(motionScales({ reduceMotion: true }).particles).toBeGreaterThan(0);
    expect(motionScales({ reduceMotion: true }).shake).toBe(0);
    expect(motionScales({ reduceFlashing: true }).particles).toBe(1);
  });
  it('the particle system keeps only its share of what is emitted', () => {
    const p = new Particles({ add() {} });
    const fire = () => { for (let i = 0; i < 1000; i++) p.emit(0, 0, 0, 0, 0, 0, 1, 1, 1, 10); return p.n; };
    expect(fire()).toBe(1000);
    p.n = 0; p.density = 0.3;
    const kept = fire();
    expect(kept).toBeGreaterThan(200); expect(kept).toBeLessThan(400);
    p.n = 0; p.density = 0;
    expect(fire()).toBe(0);
  });
  it('the held item no longer trembles and the hurt flinch uses the scales', () => {
    expect(src('src/render/overlays.js')).toMatch(/fxOf\(g\)\.shake/);
    expect(src('src/game.js')).toMatch(/fxScale\.tilt/);
    expect(src('src/game.js')).toMatch(/particles\.density = /);
  });
});

describe('accessibility: keys and focus', () => {
  it('every action the game reads is in the rebindable table (nothing recent is hard-wired)', () => {
    const used = new Set();
    for (const f of ['src/game.js', 'src/ui/screens.js', 'src/ui/hud.js', 'src/player/interaction.js', 'src/net/session.js', 'src/ui/touch.js', 'src/ui/input.js', 'src/ui/menuNav.js']) {
      const text = src(f);
      for (const m of text.matchAll(/(?:wasPressed|isDown|matches|held|pressAction|releaseAction)\('([A-Za-z0-9]+)'/g)) used.add(m[1]);
      for (const m of text.matchAll(/\.keys\.([A-Za-z0-9]+)\b/g)) used.add(m[1]);
    }
    used.delete('slot'); // (built as 'slot' + n)
    const known = new Set([...ACTION_IDS, ...Object.keys(FIXED)]);
    expect([...used].filter((id) => !known.has(id))).toEqual([]);
    expect(used.size).toBeGreaterThan(8);
  });
  it('no gameplay key is a literal key code outside the bindings table', () => {
    for (const f of ['src/game.js', 'src/player/interaction.js', 'src/net/session.js', 'src/ui/hud.js']) {
      expect(src(f), f).not.toMatch(/(?:codePressed|\.has)\('(?:Key[A-Z]|Digit\d|F\d+)'\)/);
    }
    expect(src('src/game.js')).not.toMatch(/codePressed\('Digit/); // the emote wheel follows the hotbar slot keys now
    expect(src('src/game.js')).toMatch(/wasPressed\('slot' \+ \(i \+ 1\)\)/);
  });
  it('the recently added actions are listed with a label, a group and a default, and defaults never collide', () => {
    for (const id of ['crawl', 'ping', 'emote', 'players', 'dismissHint', 'guide', 'help', 'shaders', 'debug']) {
      const a = ACTIONS.find((x) => x.id === id);
      expect(a, id).toBeTruthy(); expect(a.label.length).toBeGreaterThan(3); expect(a.def.some(Boolean)).toBe(true);
    }
    const codes = ACTIONS.flatMap((a) => a.def).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
    const t = resolveBindings(null);
    expect(t).toEqual(defaultTable());
  });
  it('the F3 key (and so the frame graph) is rebindable', () => {
    expect(ACTIONS.find((a) => a.id === 'debug').def[0]).toBe('F3');
    expect(src('src/game.js')).toMatch(/wasPressed\('debug'\)/);
  });
  it('focus is visible on every control, and no rule hides it without putting a ring back', () => {
    expect(CSS).toMatch(/button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, \[tabindex\]:focus-visible/);
    // every rule that sets outline: none must have a :focus-visible rule for the same element that sets a visible outline
    const rules = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
    const hiding = rules.filter(([sel, body]) => /outline:\s*(none|0)\b/.test(body) && !/:focus-visible/.test(sel));
    expect(hiding.length).toBeGreaterThan(0); // (the audit does look at something)
    for (const [sel] of hiding) {
      for (const one of sel.split(',').map((x) => x.trim().replace(/:hover$/, ''))) {
        const ring = rules.some(([s2, b2]) => s2.split(',').some((x) => x.trim() === one + ':focus-visible') && /outline:\s*\d+px solid/.test(b2));
        expect(ring, `${one} loses its focus ring`).toBe(true);
      }
    }
    // the only :focus-visible rule that says "outline: none" is gone
    expect(CSS).not.toMatch(/#steps \.st-skip:hover, #steps \.st-skip:focus-visible \{[^}]*outline: none/);
  });
});

describe('F3 frame-time graph', () => {
  it('keeps the last N frames in a ring and summarises them', () => {
    const g = new FrameGraph(10);
    expect(g.stats().n).toBe(0);
    expect(g.line()).toBe('Frame -');
    for (let i = 1; i <= 25; i++) g.push(i, i / 2, i / 4);
    const s = g.stats();
    expect(s.n).toBe(10);
    expect(s.worst).toBe(25);
    expect(s.avg).toBeCloseTo((16 + 25) * 10 / 2 / 10);
    expect(s.tick).toBeCloseTo(s.avg / 2);
    expect(s.p95).toBe(25);
    expect(s.slow).toBe(0);
  });
  it('counts only frames over 33 ms as slow', () => {
    const g = new FrameGraph(8);
    for (const ms of [10, 16, 20, 34, 40, 12, 90, 8]) g.push(ms, 1, 1);
    expect(g.stats().slow).toBe(3);
    expect(g.stats().worst).toBe(90);
  });
  it('ignores bad samples, clears, and reports the average in one line', () => {
    const g = new FrameGraph();
    g.push(NaN); g.push(-4); g.push(Infinity);
    expect(g.count).toBe(0);
    g.push(16.7, 2, 9);
    expect(g.line()).toMatch(/^Frame 16\.7 ms/);
    g.clear(); expect(g.stats().n).toBe(0);
    expect(FRAME_SAMPLES).toBe(120);
  });
  it('draws one bar per frame plus the 60 and 30 fps lines into any 2D context', () => {
    const g = new FrameGraph(20);
    for (let i = 0; i < 20; i++) g.push(10 + i * 3, 2, 6);
    const calls = { fillRect: 0, text: 0, clear: 0 };
    const ctx = { fillRect: () => calls.fillRect++, clearRect: () => calls.clear++, fillText: () => calls.text++, set fillStyle(v) {} };
    g.draw(ctx, 240, 64);
    expect(calls.clear).toBe(1); expect(calls.text).toBe(2);
    expect(calls.fillRect).toBeGreaterThanOrEqual(1 + 20 * 2 + 2);
  });
  it('is on the debug screen: a canvas under F3, a text line, and a sample every frame', () => {
    expect(src('src/ui/hud.js')).toMatch(/id="framegraph"/);
    expect(src('src/ui/hud.js')).toMatch(/drawFrameGraph\(g\.frameGraph\)/);
    expect(src('src/game.js')).toMatch(/this\.frameGraph\.push\(dt,/);
    expect(src('src/game.js')).toMatch(/this\.frameGraph\.line\(\)/);
    expect(CSS).toMatch(/#framegraph\.hidden \{ display: none; \}/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('performance: items', () => {
  const item = (x, y, z, id = 1, count = 1, age = 0) => {
    const e = new ItemEntity(x, y, z, { id, count, damage: 0 });
    e.body.vx = e.body.vy = e.body.vz = 0; e.age = age; e.pickupDelay = 0;
    return e;
  };
  // the old behaviour, kept here as the specification
  function naive(items) {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.dead || b.dead || Math.abs(a.x - b.x) >= 0.5 || Math.abs(a.y - b.y) >= 0.5 || Math.abs(a.z - b.z) >= 0.5 || !canStack(a.stack, b.stack)) continue;
      if (a.stack.count + b.stack.count <= 64) { a.stack.count += b.stack.count; b.dead = true; }
    }
  }
  it('merges the same stacks, in the same order, as comparing every pair', () => {
    let s = 7; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let round = 0; round < 6; round++) {
      const mk = () => { s = 100 + round; return Array.from({ length: 220 }, (_, i) => item(rnd() * 6, 64 + rnd() * 2, rnd() * 6, 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 20))); };
      const a = mk(), b = mk();
      naive(a); mergeItems(b, 1e9);
      expect(b.map((e) => [e.dead, e.stack.count])).toEqual(a.map((e) => [e.dead, e.stack.count]));
    }
  });
  it('compares far fewer pairs on a big pile than every pair', () => {
    const items = Array.from({ length: 2000 }, (_, i) => item((i % 50) * 3, 64, Math.floor(i / 50) * 3, 1 + (i % 7)));
    let reads = 0;
    for (const e of items) { const b = e.body; Object.defineProperty(e, 'x', { get() { reads++; return b.x; } }); }
    mergeItems(items, 1e9);
    expect(reads).toBeLessThan(40000); // (every pair would read x about 4 million times)
    expect(items.some((e) => e.dead)).toBe(false);
  });
  it('keeps at most MAX_LOOSE_ITEMS items: the oldest vanish first', () => {
    const items = Array.from({ length: MAX_LOOSE_ITEMS + 50 }, (_, i) => item(i * 3, 64, 0, 1 + (i % 9), 1, i));
    const cut = mergeItems(items);
    expect(cut).toBe(50);
    const dead = items.filter((e) => e.dead);
    expect(dead.length).toBe(50);
    expect(Math.min(...dead.map((e) => e.age))).toBeGreaterThanOrEqual(MAX_LOOSE_ITEMS); // ages 800..849: the oldest 50
  });
  it('the cap takes the oldest', () => {
    const items = Array.from({ length: MAX_LOOSE_ITEMS + 5 }, (_, i) => item(i * 3, 64, 0, 1 + (i % 9), 1, 1000 - i));
    mergeItems(items);
    const ages = items.filter((e) => e.dead).map((e) => e.age).sort((a, b) => b - a);
    expect(ages[0]).toBe(1000); // the oldest of all is among them
    expect(Math.max(...items.filter((e) => !e.dead).map((e) => e.age))).toBeLessThan(Math.min(...ages) + 1);
  });
  it('nothing is cut below the cap', () => {
    const items = Array.from({ length: 100 }, (_, i) => item(i * 3, 64, 0, 1 + (i % 9)));
    expect(mergeItems(items)).toBe(0);
    expect(items.some((e) => e.dead)).toBe(false);
  });
  it('an item lying still goes to sleep, and wakes within 4 ticks when its floor goes', () => {
    const world = new MockWorld(64);
    const game = { world };
    const e = new ItemEntity(5.5, 64.2, 5.5, { id: 1, count: 1, damage: 0 });
    for (let i = 0; i < 40; i++) e.tick(game);
    expect(e.rest).toBeGreaterThanOrEqual(ITEM_SLEEP_AFTER);
    const y = e.body.y;
    // asleep: three of every four ticks only count the age
    const ageBefore = e.age;
    let physics = 0; const orig = e.body.move.bind(e.body); e.body.move = (...a) => { physics++; return orig(...a); };
    for (let i = 0; i < 40; i++) e.tick(game);
    expect(physics).toBeLessThanOrEqual(11);
    expect(e.age).toBe(ageBefore + 40);
    expect(e.body.y).toBeCloseTo(y, 5);
    // the floor is mined away: it falls again within four ticks and the sleep ends
    world.floorY = 40;
    for (let i = 0; i < 4; i++) e.tick(game);
    expect(e.body.y).toBeLessThan(y);
    expect(e.rest).toBe(0);
  });
  it('a sleeping item still grows old and despawns on time', () => {
    const world = new MockWorld(64), game = { world };
    const e = new ItemEntity(5.5, 64.01, 5.5, { id: 1, count: 1, damage: 0 });
    for (let i = 0; i < 30; i++) e.tick(game);
    e.age = 5995;
    for (let i = 0; i < 6; i++) e.tick(game);
    expect(e.dead).toBe(true);
  });
  it('a fresh drop is not put to sleep before its pickup delay is over', () => {
    const world = new MockWorld(64), game = { world };
    const e = new ItemEntity(5.5, 64, 5.5, { id: 1, count: 1, damage: 0 });
    e.rest = 99; e.pickupDelay = 5;
    const before = e.pickupDelay;
    e.tick(game);
    expect(e.pickupDelay).toBe(before - 1);
  });
});

describe('performance: remeshing after edits', () => {
  function rendererWith(chunks, meshTime) {
    const r = Object.create(ChunkRenderer.prototype);
    const world = { chunks: new Map(chunks.map((c, i) => [i, c])) };
    Object.assign(r, { world, center: [0, 0], renderDistance: 8, pendingMesh: new Map(), edited: false, built: 0 });
    r.neighboursLoaded = () => true;
    r.meshed = [];
    r.meshUrgent = (c, sy) => { r.meshed.push([c.cx, sy]); const t = performance.now(); while (performance.now() - t < meshTime); };
    r.buildChunkGeometry = () => { r.built++; };
    return r;
  }
  const chunk = (cx, secs) => ({ cx, cz: 0, urgent: new Set(secs), dirty: new Set(secs) });
  it('always meshes the first few sections at once, and leaves the rest of a big edit for the next frame', () => {
    const cs = [chunk(0, [3, 4, 5, 6, 7, 8]), chunk(1, [3, 4, 5, 6, 7, 8])];
    const r = rendererWith(cs, 4);
    const done = r.flushUrgent(6);
    expect(done).toBeGreaterThanOrEqual(URGENT_MIN);
    expect(done).toBeLessThan(12);
    expect(r.urgentLeft).toBe(12 - done);
    expect(r.built).toBeGreaterThan(0);
    // the leftovers are still marked, and a later frame finishes them
    let guard = 0;
    while (r.countUrgent() > 0 && guard++ < 20) r.flushUrgent(6);
    expect(r.countUrgent()).toBe(0);
    expect(r.meshed.length).toBe(12);
    expect(new Set(r.meshed.map((m) => m.join(','))).size).toBe(12); // each exactly once
    for (const c of cs) expect(c.dirty.size).toBe(0);
  });
  it('a small edit is meshed at once however slow the sections are', () => {
    const r = rendererWith([chunk(0, [5, 6])], 12);
    expect(r.flushUrgent(1)).toBe(2);
    expect(r.countUrgent()).toBe(0);
  });
  it('still drops edits in chunks that are out of view', () => {
    const far = chunk(40, [5]);
    const r = rendererWith([far], 0);
    expect(r.flushUrgent()).toBe(0);
    expect(far.urgent.size).toBe(0);
  });
});
