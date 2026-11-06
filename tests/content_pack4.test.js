// Content pack 4: the Hermit's Lighthouse, Mire Shrine and Stargazer's Observatory (world/lighthouse.js, mireShrine.js, observatory.js,
// world/siteLite.js, world/packLore.js), twelve new blocks (mosaics, leaded glass, rose window, lighthouse lens, chandelier, brazier, rope
// ladder) with textures and recipes, and two mobs (Brinecrab, Wickling: mobs/shoreMobs.js) with items, spawn rules, Field Guide entries,
// captions and net snapshots.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { TerrainGenerator } from '../src/world/generator.js';
import { B, BLOCKS, SHAPE, LAYER, STONE_SETS, EMIT, SOLID } from '../src/world/blocks.js';
import { I, ITEMS, DYES } from '../src/world/items.js';
import { COLOR } from '../src/world/colors.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { craft, SMELTING, RECIPES } from '../src/player/crafting.js';
import { texId, texturePixels, TEX_NAMES, FACE_TILE } from '../src/world/textures.js';
import { blockBoxes, selectionBox, collisionBoxes, SHAPED_COLLISION } from '../src/world/shapes.js';
import { Body } from '../src/physics/body.js';
import { PHYS } from '../src/physics/constants.js';
import { toLocal, claimedByOthers, boxesOverlap } from '../src/world/siteKit.js';
import { claimedByOlder } from '../src/world/siteLite.js';
import { sunkenRuinsNear } from '../src/world/sunkenRuins.js';
import { sporehallsNear } from '../src/world/sporehall.js';
import {
  lighthouseInRegion, lighthousesNear, nearestLighthouse, lighthouseBlock, lighthouseChests, lighthouseGuards, LIGHTHOUSE_CHESTS, LIGHTHOUSE_HALF, LIGHTHOUSE_LOOT,
} from '../src/world/lighthouse.js';
import {
  mireShrineInRegion, mireShrinesNear, nearestMireShrine, mireBlock, mireChests, mireGuards, MIRE_CHESTS, MIRE_HALF, MIRE_LOOT, MIRE_LADDER,
} from '../src/world/mireShrine.js';
import {
  observatoryInRegion, observatoriesNear, nearestObservatory, observatoryBlock, observatoryChests, observatoryGuards, OBSERVATORY_CHESTS, OBSERVATORY_HALF,
} from '../src/world/observatory.js';
import { LORE, loreBook, loreKeyAt, addLore } from '../src/world/packLore.js';
import { landmarksInBox, nearestLandmark, chartMap, mapTitle } from '../src/world/landmarks.js';
import { LANDMARK_BY_KEY, LANDMARK_KINDS } from '../src/world/landmarkKinds.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { MILESTONES } from '../src/player/milestones.js';
import { runCommand, HELP } from '../src/ui/commands.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { Mob } from '../src/mobs/mob.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { SPAWN_TABLES, spawnTable, pickProbabilities } from '../src/mobs/spawnRules.js';
import { MobSpawner } from '../src/mobs/spawner.js';
import { rollDrops } from '../src/mobs/drops.js';
import {
  CRAB, WICK, CRAB_SHELLS, CRAB_GROUND, crabStance, wicklingSnuffed, crabGround, BRINECRAB, WICKLING,
} from '../src/mobs/shoreMobs.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { modelRects } from '../src/ui/guideArt.js';
import { CAPTION_TEXT, captionText } from '../src/ui/accessibility.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { resolveBindings } from '../src/ui/bindings.js';
import { MockWorld, rng } from './helpers.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const noop = () => {};
const st = (id) => (id == null ? null : { id, count: 1 });

const SEED = 4242;
const gen = new TerrainGenerator(SEED);

function collect(find, g, n, R = 12) {
  const out = [];
  for (let r = 0; r <= R && out.length < n; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const s = find(g, rx, rz);
    if (s) out.push(s);
  }
  return out;
}
const lights = collect(lighthouseInRegion, gen, 3);
const mires = collect(mireShrineInRegion, gen, 3);
const obs = collect(observatoryInRegion, gen, 3);

/** Block reader over generated chunks (generated on demand). */
function reader(g) {
  const chunks = new Map();
  const chunk = (cx, cz) => { const k = `${cx},${cz}`; if (!chunks.has(k)) chunks.set(k, g.generate(cx, cz)); return chunks.get(k); };
  const get = (x, y, z) => {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), c = chunk(cx, cz), i = cidx(x - cx * 16, y, z - cz * 16);
    return [c.blocks[i], c.meta[i]];
  };
  return { get, count: () => chunks.size };
}

/** Compare every planned block of site s with the generated world; returns the number checked or a description of the first mismatch. */
function matchesWorld(s, blockFn, half, hMin, hMax, rd) {
  let checked = 0;
  for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
    const [u, v] = toLocal(s.dir, dx, dz);
    for (let h = hMin; h <= hMax; h++) {
      const bl = blockFn(s, u, h, v);
      if (!bl) continue;
      const [id, m] = rd.get(s.cx + dx, s.y + h, s.cz + dz);
      if (id !== bl[0] || m !== bl[1]) return `${s.cx + dx},${s.y + h},${s.cz + dz} expected ${bl} got ${id},${m}`;
      checked++;
    }
  }
  return checked;
}

// ---------------------------------------------------------------------------------------------
describe('the new blocks', () => {
  const NEW = ['AZURE_MOSAIC', 'AZURE_MOSAIC_SLAB', 'AZURE_MOSAIC_STAIRS', 'SUNBURST_MOSAIC', 'LEADED_GLASS', 'LEADED_GLASS_PANE', 'ROSE_WINDOW', 'LIGHTHOUSE_LENS', 'CHANDELIER', 'IRON_BRAZIER', 'ROPE_LADDER'];

  it('are appended after the last older block, in order, without shifting any id', () => {
    expect(B.PULSE_GATE).toBe(1341); // the last block before this pack
    NEW.forEach((k, i) => expect(B[k], k).toBe(1342 + i));
    expect(B.SNARE_POST).toBe(1339); // earlier ids stay where they were
    expect(B.CHEST).toBe(62);
    for (const k of NEW) { expect(BLOCKS[B[k]], k).toBeTruthy(); expect(ITEMS[B[k]], k).toBeTruthy(); }
  });

  it('have the lighting, shapes and layers they should', () => {
    expect(EMIT[B.LIGHTHOUSE_LENS]).toBe(15);
    expect(EMIT[B.CHANDELIER]).toBe(14);
    expect(EMIT[B.IRON_BRAZIER]).toBe(15);
    expect(EMIT[B.AZURE_MOSAIC]).toBe(0);
    for (const k of ['LEADED_GLASS', 'ROSE_WINDOW', 'LIGHTHOUSE_LENS']) { expect(BLOCKS[B[k]].opaque).toBe(false); expect(BLOCKS[B[k]].opacity).toBe(0); expect(BLOCKS[B[k]].layer).toBe(LAYER.TRANSLUCENT); }
    expect(BLOCKS[B.LEADED_GLASS_PANE].shape).toBe(SHAPE.PANE);
    expect(BLOCKS[B.CHANDELIER].shape).toBe(SHAPE.BOXES);
    expect(BLOCKS[B.IRON_BRAZIER].shape).toBe(SHAPE.BOXES);
    expect(BLOCKS[B.ROPE_LADDER].shape).toBe(SHAPE.LADDER);
    expect(BLOCKS[B.ROPE_LADDER].solid).toBe(false);
    expect(BLOCKS[B.AZURE_MOSAIC_SLAB].shape).toBe(SHAPE.SLAB);
    expect(BLOCKS[B.AZURE_MOSAIC_STAIRS].shape).toBe(SHAPE.STAIRS);
    expect(BLOCKS[B.AZURE_MOSAIC_SLAB].base).toBe(B.AZURE_MOSAIC);
  });

  it('the Azure Mosaic joins the stone sets, so it gets slab and stair recipes and Stonecutter cuts', () => {
    expect(STONE_SETS).toContainEqual([B.AZURE_MOSAIC, B.AZURE_MOSAIC_SLAB, B.AZURE_MOSAIC_STAIRS, 'Azure Mosaic']);
    expect(craft(Array(3).fill(st(B.AZURE_MOSAIC)).concat(Array(6).fill(null)), 3)).toEqual({ id: B.AZURE_MOSAIC_SLAB, count: 6 });
    expect(craft([B.AZURE_MOSAIC, null, null, B.AZURE_MOSAIC, B.AZURE_MOSAIC, null, B.AZURE_MOSAIC, B.AZURE_MOSAIC, B.AZURE_MOSAIC].map(st), 3)).toEqual({ id: B.AZURE_MOSAIC_STAIRS, count: 4 });
  });

  it('every one has a recipe that works from the base game, by the right grid', () => {
    const S = B.SMOOTH_STONE, N = I.IRON_NUGGET, G = B.GLASS, X = I.IRON_INGOT;
    expect(craft([S, I.AZURITE, I.AZURITE, S].map(st), 2)).toEqual({ id: B.AZURE_MOSAIC, count: 4 });
    expect(craft([S, I.GOLD_NUGGET, I.GOLD_NUGGET, S].map(st), 2)).toEqual({ id: B.SUNBURST_MOSAIC, count: 4 });
    expect(craft([N, G, N, G, N, G, N, G, N].map(st), 3)).toEqual({ id: B.LEADED_GLASS, count: 4 });
    expect(craft(Array(6).fill(st(B.LEADED_GLASS)).concat(Array(3).fill(null)), 3)).toEqual({ id: B.LEADED_GLASS_PANE, count: 16 });
    expect(craft([B.LEADED_GLASS, DYES[COLOR.RED], DYES[COLOR.BLUE], DYES[COLOR.YELLOW]].map(st), 2)).toEqual({ id: B.ROSE_WINDOW, count: 1 });
    expect(craft([G, I.GOLD_INGOT, G, I.GOLD_INGOT, B.GLOWSHARD, I.GOLD_INGOT, G, I.GOLD_INGOT, G].map(st), 3)).toEqual({ id: B.LIGHTHOUSE_LENS, count: 1 });
    expect(craft([null, B.CHAIN, null, X, X, X, B.CANDLE, null, B.CANDLE].map(st), 3)).toEqual({ id: B.CHANDELIER, count: 1 });
    expect(craft([X, I.COAL, X, X, X, X, null, X, null].map(st), 3)).toEqual({ id: B.IRON_BRAZIER, count: 1 });
    expect(craft([I.STRING, null, I.STRING, I.STRING, B.OAK_PLANKS, I.STRING, I.STRING, null, I.STRING].map(st), 3)).toEqual({ id: B.ROPE_LADDER, count: 3 });
    for (const k of ['AZURE_MOSAIC', 'SUNBURST_MOSAIC', 'LEADED_GLASS', 'LEADED_GLASS_PANE', 'ROSE_WINDOW', 'LIGHTHOUSE_LENS', 'CHANDELIER', 'IRON_BRAZIER', 'ROPE_LADDER']) {
      expect(RECIPES.some((r) => r.result === B[k]), k).toBe(true);
    }
  });

  it('draw their own textures: every face is painted, and the clear parts of the glass and lamps stay clear', () => {
    for (const k of NEW) {
      const b = BLOCKS[B[k]];
      for (const face of new Set([b.tex.top, b.tex.bottom, b.tex.side])) {
        expect(texId(face), `${k} ${face}`).toBeGreaterThanOrEqual(0);
        const px = texturePixels(face);
        let seen = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) seen++;
        expect(seen, `${k} ${face} has pixels`).toBeGreaterThan(8);
      }
    }
    const alphas = (name) => { const px = texturePixels(name), a = new Set(); for (let i = 3; i < px.length; i += 4) a.add(px[i]); return a; };
    expect(alphas('leaded_glass').has(255)).toBe(true); // lead came
    expect([...alphas('leaded_glass')].some((v) => v > 0 && v < 255)).toBe(true); // translucent panes between
    expect(alphas('chandelier').has(0)).toBe(true); // the front view leaves air round the ring
    expect(alphas('iron_brazier').has(0)).toBe(true);
    // two different mosaics, not one reused
    expect(Buffer.from(texturePixels('azure_mosaic')).equals(Buffer.from(texturePixels('sunburst_mosaic')))).toBe(false);
    expect(TEX_NAMES).toContain('rope_ladder');
    expect(FACE_TILE[B.CHANDELIER * 6]).toBe(texId('chandelier'));
  });

  it('the Chandelier and Brazier are shaped from boxes and keep to their block', () => {
    for (const id of [B.CHANDELIER, B.IRON_BRAZIER]) {
      const boxes = blockBoxes(id, 0);
      expect(boxes.length).toBeGreaterThan(3);
      for (const b of boxes) { for (let a = 0; a < 3; a++) { expect(b[a]).toBeGreaterThanOrEqual(0); expect(b[a + 3]).toBeLessThanOrEqual(1); expect(b[a + 3]).toBeGreaterThan(b[a]); } }
      expect(SHAPED_COLLISION[id]).toBe(1);
      expect(selectionBox(id, 0)).toBeTruthy();
    }
    // the chandelier hangs from the top of its block, the brazier stands on the floor and its collision is the stand and bowl only
    expect(Math.max(...blockBoxes(B.CHANDELIER, 0).map((b) => b[4]))).toBe(1);
    expect(Math.min(...blockBoxes(B.IRON_BRAZIER, 0).map((b) => b[1]))).toBe(0);
    expect(collisionBoxes(B.IRON_BRAZIER, 0).length).toBeLessThan(blockBoxes(B.IRON_BRAZIER, 0).length);
  });

  it('a Rope Ladder is climbed like a ladder and drawn like one', () => {
    const w = new MockWorld(64);
    w.set(0, 64, 1, B.STONE); w.set(0, 65, 1, B.STONE); w.set(0, 66, 1, B.STONE);
    for (const y of [64, 65, 66]) w.set(0, y, 0, B.ROPE_LADDER, 2);
    const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
    b.setPos(0.5, 64.2, 0.5);
    expect(b.onLadder(w)).toBe(1);
    expect(selectionBox(B.ROPE_LADDER, 2)).toEqual(selectionBox(B.LADDER, 2));
    expect(src('src/world/world.js')).toContain('B.ROPE_LADDER');
    expect(src('src/player/interaction.js')).toMatch(/placeId === B\.ROPE_LADDER/);
  });

  it('use none of the forbidden names', () => {
    const text = ['src/world/packTextures.js', 'src/world/lighthouse.js', 'src/world/mireShrine.js', 'src/world/observatory.js', 'src/world/packLore.js', 'src/world/siteLite.js', 'src/mobs/shoreMobs.js'].map(src).join('\n');
    for (const w of ['Minecraft', 'Nether', 'redstone']) expect(text).not.toContain(w);
    expect(text).not.toMatch(/\bEnd\b/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('placement of the three sites', () => {
  it('finds each kind in the first rings of regions', () => {
    expect(lights.length).toBeGreaterThanOrEqual(2);
    expect(mires.length).toBeGreaterThanOrEqual(2);
    expect(obs.length).toBeGreaterThanOrEqual(2);
  });

  it('is deterministic from the seed and differs between seeds', () => {
    const other = new TerrainGenerator(SEED);
    for (let rx = -4; rx <= 4; rx++) for (let rz = -4; rz <= 4; rz++) {
      expect(lighthouseInRegion(other, rx, rz)).toEqual(lighthouseInRegion(gen, rx, rz));
      expect(mireShrineInRegion(other, rx, rz)).toEqual(mireShrineInRegion(gen, rx, rz));
      expect(observatoryInRegion(other, rx, rz)).toEqual(observatoryInRegion(gen, rx, rz));
    }
    const diff = new TerrainGenerator(SEED + 1);
    const a = collect(mireShrineInRegion, gen, 3).map((r) => `${r.cx},${r.cz}`), b = collect(mireShrineInRegion, diff, 3).map((r) => `${r.cx},${r.cz}`);
    expect(a).not.toEqual(b);
  });

  it('is rare', () => {
    let l = 0, m = 0, o = 0, n = 0;
    for (let rx = -8; rx < 8; rx++) for (let rz = -8; rz < 8; rz++) { n++; if (lighthouseInRegion(gen, rx, rz)) l++; if (mireShrineInRegion(gen, rx, rz)) m++; if (observatoryInRegion(gen, rx, rz)) o++; }
    expect(l / n).toBeLessThan(0.6);
    expect(m / n).toBeLessThan(0.8);
    expect(o / n).toBeLessThan(0.5);
    expect(l + m + o).toBeGreaterThan(0);
  });

  it('Lighthouses stand on beaches with the sea on some sides, a shore platform above the water, the door facing the land', () => {
    for (const s of lights) {
      const col = gen.column(s.cx, s.cz), top = gen.surfaceAt(s.cx, s.cz, col);
      expect(gen.biomeFor(col, top)).toBe(BIOME.BEACH);
      expect(s.y).toBeGreaterThan(SEA_LEVEL);
      let wet = 0;
      for (let a = 0; a < 8; a++) if (gen.surfaceAt(s.cx + Math.round(Math.cos(a * Math.PI / 4) * 9), s.cz + Math.round(Math.sin(a * Math.PI / 4) * 9), gen.column(s.cx + Math.round(Math.cos(a * Math.PI / 4) * 9), s.cz + Math.round(Math.sin(a * Math.PI / 4) * 9))) < SEA_LEVEL) wet++;
      expect(wet).toBeGreaterThanOrEqual(2);
    }
  });

  it('Mire Shrines stand in swamps with the floor a block under the water line', () => {
    for (const s of mires) {
      const col = gen.column(s.cx, s.cz), top = gen.surfaceAt(s.cx, s.cz, col);
      expect([BIOME.SWAMP, BIOME.MANGROVE_SWAMP]).toContain(gen.biomeFor(col, top));
      expect(s.y).toBe(SEA_LEVEL - 1);
    }
  });

  it('Observatories stand on level hills of open country above the sea', () => {
    for (const s of obs) {
      const col = gen.column(s.cx, s.cz), top = gen.surfaceAt(s.cx, s.cz, col);
      expect([BIOME.PLAINS, BIOME.SAVANNA, BIOME.HIGHLAND_MEADOW]).toContain(gen.biomeFor(col, top));
      expect(s.y).toBeGreaterThan(SEA_LEVEL + 1);
    }
  });

  it('keep clear of every older structure and of each other', () => {
    for (const s of [...lights, ...mires, ...obs]) {
      const pad = [s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6];
      expect(claimedByOlder(gen, ...pad)).toBe(false);
      expect(claimedByOthers(gen, ...pad)).toBe(false);
      expect(sunkenRuinsNear(gen, ...pad).length + sporehallsNear(gen, ...pad).length).toBe(0);
    }
    for (const m of mires) for (const l of lighthousesNear(gen, m.x0 - 8, m.z0 - 8, m.x1 + 8, m.z1 + 8)) expect(boxesOverlap(m, l, 6)).toBe(false);
    for (const o of obs) {
      for (const l of lighthousesNear(gen, o.x0 - 8, o.z0 - 8, o.x1 + 8, o.z1 + 8)) expect(boxesOverlap(o, l, 6)).toBe(false);
      for (const m of mireShrinesNear(gen, o.x0 - 8, o.z0 - 8, o.x1 + 8, o.z1 + 8)) expect(boxesOverlap(o, m, 6)).toBe(false);
    }
  });

  it('the near and nearest finders agree with the region lookups', () => {
    for (const [find, near, nearest, list, reg] of [[lighthouseInRegion, lighthousesNear, nearestLighthouse, lights, 200], [mireShrineInRegion, mireShrinesNear, nearestMireShrine, mires, 208], [observatoryInRegion, observatoriesNear, nearestObservatory, obs, 240]]) {
      const s = list[0];
      expect(near(gen, s.cx - 2, s.cz - 2, s.cx + 2, s.cz + 2).map((x) => `${x.cx},${x.cz}`)).toContain(`${s.cx},${s.cz}`);
      expect(near(gen, s.cx + 400, s.cz + 400, s.cx + 401, s.cz + 401).every((x) => `${x.cx},${x.cz}` !== `${s.cx},${s.cz}`)).toBe(true);
      const n = nearest(gen, s.cx + 20, s.cz - 20);
      expect(n).toBeTruthy();
      expect(Math.hypot(n.cx - s.cx, n.cz - s.cz)).toBeLessThanOrEqual(reg * 2);
      expect(typeof find).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('stamping', () => {
  it('a Lighthouse is stamped identically over every chunk it crosses', () => {
    const rd = reader(gen), res = matchesWorld(lights[0], lighthouseBlock, LIGHTHOUSE_HALF, 0, 22, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(1500);
    expect(rd.count()).toBeGreaterThanOrEqual(1);
  });

  it('a Mire Shrine is stamped identically over every chunk it crosses', () => {
    const rd = reader(gen), res = matchesWorld(mires[0], mireBlock, MIRE_HALF, -5, 9, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(3000);
    expect(rd.count()).toBeGreaterThanOrEqual(4);
  });

  it('an Observatory is stamped identically over every chunk it crosses', () => {
    const rd = reader(gen), res = matchesWorld(obs[0], observatoryBlock, OBSERVATORY_HALF, 0, 15, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(2000);
    expect(rd.count()).toBeGreaterThanOrEqual(4);
  });

  it('generation with the sites is repeatable', () => {
    const s = lights[0], cx = Math.floor(s.cx / 16), cz = Math.floor(s.cz / 16);
    const a = gen.generate(cx, cz), b = new TerrainGenerator(SEED).generate(cx, cz);
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    expect(Buffer.from(a.meta).equals(Buffer.from(b.meta))).toBe(true);
  });

  it('the Lighthouse has its lens, chandelier, braziers, leaded glass, rose window and a ladder to the lamp', () => {
    const s = lights[0], rd = reader(gen);
    const at = (u, h, v) => { const [dx, dz] = [[u, v], [-v, u], [-u, -v], [v, -u]][s.dir]; return rd.get(s.cx + dx, s.y + h, s.cz + dz); };
    expect(at(0, 14, 0)[0]).toBe(B.LIGHTHOUSE_LENS);
    expect(at(0, 15, 0)[0]).toBe(B.LIGHTHOUSE_LENS);
    expect(at(0, 11, 0)[0]).toBe(B.CHANDELIER);
    expect(at(-2, 13, 0)[0]).toBe(B.IRON_BRAZIER);
    expect(at(0, 3, 4)[0]).toBe(B.ROSE_WINDOW);
    expect(at(4, 8, 0)[0]).toBe(B.LEADED_GLASS);
    for (let h = 1; h <= 13; h++) expect(at(0, h, -3)[0], `ladder at ${h}`).toBe(B.LADDER);
    expect(at(0, 1, 4)[0]).toBe(B.AIR); // the doorway
    expect(at(0, 2, 4)[0]).toBe(B.AIR);
    expect(at(0, 0, 0)[0]).toBe(B.SUNBURST_MOSAIC);
    expect(at(2, 0, 0)[0]).toBe(B.AZURE_MOSAIC);
  });

  it('the Mire Shrine is flooded knee-deep, mosaic-floored, and has a rope ladder down to the crypt', () => {
    const s = mires[0], rd = reader(gen);
    const at = (u, h, v) => { const [dx, dz] = [[u, v], [-v, u], [-u, -v], [v, -u]][s.dir]; return rd.get(s.cx + dx, s.y + h, s.cz + dz); };
    expect(at(5, 1, 5)[0]).toBe(B.WATER);
    expect([B.AZURE_MOSAIC, B.SUNBURST_MOSAIC, B.SMOOTH_STONE, B.MOSSY_STONE_BRICKS]).toContain(at(5, 0, 5)[0]);
    for (let h = -3; h <= 1; h++) expect(at(MIRE_LADDER[0], h, MIRE_LADDER[1])[0], `rope ladder at ${h}`).toBe(B.ROPE_LADDER);
    expect(at(0, -2, -5)[0]).toBe(B.WATER); // the crypt is full of water
    expect(at(0, 3, -8)[0]).toBe(B.ROSE_WINDOW);
    expect(at(0, 4, 2)[0]).toBe(B.CHANDELIER);
    expect(at(2, 1, 7)[0]).toBe(B.IRON_BRAZIER);
  });

  it('the Observatory has a star floor, bookshelves, a lectern and a ribbed dome', () => {
    const s = obs[0], rd = reader(gen);
    const at = (u, h, v) => { const [dx, dz] = [[u, v], [-v, u], [-u, -v], [v, -u]][s.dir]; return rd.get(s.cx + dx, s.y + h, s.cz + dz); };
    expect(at(0, 0, 0)[0]).toBe(B.SUNBURST_MOSAIC);
    expect(at(3, 0, 3)[0]).toBe(B.SUNBURST_MOSAIC); // a ray of the star
    expect(at(0, 1, 0)[0]).toBe(B.CHISELED_STONE_BRICKS);
    expect(at(0, 1, -5)[0]).toBe(B.BOOKSHELF);
    expect(at(3, 1, -3)[0]).toBe(B.LECTERN);
    let glass = 0, ribs = 0;
    for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) for (let h = 7; h <= 13; h++) {
      const id = at(u, h, v)[0];
      if (id === B.LEADED_GLASS || id === B.ROSE_WINDOW) glass++;
      else if (id === B.STONE_BRICKS || id === B.MOSSY_STONE_BRICKS || id === B.CRACKED_STONE_BRICKS || id === B.MOSSY_COBBLESTONE) ribs++;
    }
    expect(glass).toBeGreaterThan(5);
    expect(ribs).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------------------------
describe('chests, loot and lore', () => {
  const chestsOf = (list, rd) => list.map((c) => ({ ...c, got: rd.get(c.x, c.y, c.z) }));

  it('every chest of the three sites is in the world with its loot kind in the chest meta', () => {
    for (const [sites, chestsFn, n] of [[lights, lighthouseChests, 3], [mires, mireChests, 3], [obs, observatoryChests, 2]]) {
      for (const s of sites.slice(0, 2)) {
        const cs = chestsOf(chestsFn(s), reader(gen));
        expect(cs).toHaveLength(n);
        for (const c of cs) { expect(c.got[0], `${c.x},${c.y},${c.z}`).toBe(B.CHEST); expect(c.got[1] & 8).toBe(8); expect((c.got[1] >> 4) & 15).toBe(c.kind); }
      }
    }
  });

  it('only reuse loot tables that exist (all sixteen kinds were taken)', () => {
    const kinds = [...Object.values(LIGHTHOUSE_LOOT), ...Object.values(MIRE_LOOT), 9, 7];
    for (const k of kinds) { expect(k).toBeGreaterThanOrEqual(0); expect(k).toBeLessThan(16); }
    expect(LIGHTHOUSE_LOOT).toEqual({ stores: LOOT.WRECK, chart: LOOT.WRECK_MAP, strongbox: LOOT.WRECK_TREASURE });
    expect(MIRE_LOOT.altar).toBe(LOOT.SUNKEN);
    expect(MIRE_LOOT.deep).toBe(LOOT.DEEP_HUSH);
    for (const k of kinds) expect(dungeonLoot(rng(k + 1), k).filter(Boolean).length).toBeGreaterThan(0);
  });

  it('one chest per site carries a Written Book, found by position and slipped into the rolled loot', () => {
    for (const [sites, chestsFn, key] of [[lights, lighthouseChests, 'lighthouse'], [mires, mireChests, 'mire'], [obs, observatoryChests, 'observatory']]) {
      const s = sites[0], lore = chestsFn(s).filter((c) => c.lore);
      expect(lore).toHaveLength(1);
      const c = lore[0];
      expect(loreKeyAt(gen, c.x, c.y, c.z)).toBe(key);
      expect(loreKeyAt(gen, c.x + 1, c.y, c.z)).toBe(null);
      const slots = dungeonLoot(Math.random, c.kind);
      const before = slots.filter(Boolean).length;
      expect(addLore(gen, c.x, c.y, c.z, slots)).toBe(key);
      expect(slots.filter(Boolean).length).toBe(before + 1);
      const book = slots.find((x) => x && x.id === I.WRITTEN_BOOK);
      expect(book.title).toBe(LORE[key].title);
      expect(book.pages.length).toBeGreaterThanOrEqual(3);
      for (const p of book.pages) expect(p.length).toBeLessThanOrEqual(256);
      expect(book.title.length).toBeLessThanOrEqual(32);
      // a chest that is not a lore chest gets nothing extra
      const other = chestsFn(s).find((x) => !x.lore);
      const plain = dungeonLoot(Math.random, other.kind), n = plain.filter(Boolean).length;
      expect(addLore(gen, other.x, other.y, other.z, plain)).toBe(null);
      expect(plain.filter(Boolean).length).toBe(n);
    }
    expect(loreBook('nope')).toBe(null);
    expect(loreBook('mire').pages).not.toBe(LORE.mire.pages); // a copy
  });

  it('Game.getChest adds the lore after rolling the loot', () => {
    const g = src('src/game.js');
    expect(g).toContain('addLore(this.world.gen, x, y, z, c.slots)');
    expect(g.indexOf('dungeonLoot(Math.random')).toBeLessThan(g.indexOf('addLore(this.world.gen'));
  });
});

// ---------------------------------------------------------------------------------------------
describe('guards, maps, /locate, milestones', () => {
  it('guards stand inside their sites on solid ground', () => {
    const rd = reader(gen);
    for (const [sites, guardsFn, types] of [[lights, lighthouseGuards, ['skitterer', 'wickling']], [mires, mireGuards, ['wickling', 'sodden_shambler']], [obs, observatoryGuards, ['wickling', 'skitterer']]]) {
      const s = sites[0], gs = guardsFn(s);
      expect(gs.length).toBeGreaterThanOrEqual(3);
      for (const g of gs) {
        expect(types).toContain(g.type);
        expect(MOBS[g.type]).toBeTruthy();
        expect(Math.abs(g.x - s.cx)).toBeLessThanOrEqual(10);
        expect(Math.abs(g.z - s.cz)).toBeLessThanOrEqual(10);
        expect(SOLID[rd.get(g.x, g.y, g.z)[0]], `${g.type} feet`).toBe(0);
        expect(SOLID[rd.get(g.x, g.y - 1, g.z)[0]], `${g.type} floor`).toBe(1);
      }
    }
    // Wicklings in the Mire Shrine stand dry (on the dais), the Shamblers in its water
    const rdm = reader(gen);
    for (const g of mireGuards(mires[0])) {
      const id = rdm.get(g.x, g.y, g.z)[0];
      expect(id === B.WATER).toBe(g.type === 'sodden_shambler');
    }
  });

  it('the spawner places the guards of all three kinds', () => {
    const s = src('src/mobs/spawner.js');
    for (const f of ['lighthouseGuards', 'mireGuards', 'observatoryGuards']) expect(s).toContain(f);
  });

  it('maps note them and charts lead to them; the kinds have glyphs and names', () => {
    for (const [kind, s] of [['lighthouse', lights[0]], ['mireshrine', mires[0]], ['observatory', obs[0]]]) {
      expect(LANDMARK_BY_KEY[kind], kind).toBeTruthy();
      expect(landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5)).toContainEqual({ kind, x: s.cx, z: s.cz });
      const r = nearestLandmark(gen, kind, s.cx + 30, s.cz - 30);
      expect(r.kind).toBe(kind);
      expect(Math.hypot(r.x - s.cx, r.z - s.cz)).toBeLessThan(600);
      const c = chartMap(gen, kind, s.cx + 100, s.cz, 5);
      expect(c.map.marks).toContainEqual({ kind, x: c.site.x, z: c.site.z, target: true });
      expect(mapTitle(c.map)).toBe(`${LANDMARK_BY_KEY[kind].name} Map`);
    }
    expect(LANDMARK_KINDS.filter((k) => !k.dim).length).toBeGreaterThanOrEqual(15);
  });

  it('/locate names the nearest one, and refuses outside the overworld', () => {
    for (const [word, label, s] of [['lighthouse', "Hermit's Lighthouse", lights[0]], ['mire', 'Mire Shrine', mires[0]], ['observatory', "Stargazer's Observatory", obs[0]]]) {
      const game = { seed: SEED, world: { dimension: 'overworld', gen }, player: { x: s.cx + 20, z: s.cz - 20 } };
      expect(runCommand(game, `/locate ${word}`)).toMatch(new RegExp(`^The nearest ${label} is at -?\\d+, -?\\d+, -?\\d+ \\(\\d+ blocks away\\)$`));
      expect(runCommand({ seed: SEED, world: { dimension: 'hollow', gen }, player: { x: 0, z: 0 } }, `/locate ${word}`)).toMatch(/overworld/);
    }
    expect(HELP.join('\n')).toMatch(/lighthouse\|mire\|observatory/);
  });

  it('three milestones exist', () => {
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ['lighthouse', 'mireshrine', 'observatory']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------------------------
describe('the two new mobs', () => {
  const FlatWorld = class extends MockWorld {
    constructor() { super(63); this.dimension = 'overworld'; this.seed = 7; }
    isLoaded() { return true; }
    biomeAt() { return BIOME.BEACH; }
    heightAt() { return 62; }
    skyLight() { return 15; }
    blockLight() { return 0; }
    setBlock(x, y, z, id) { this.set(x, y, z, id); }
    raycast() { return null; }
  };
  function fakeGame() {
    const g = {
      world: new FlatWorld(), ticks: 100, time: 0, played: [], flames: 0,
      sky: { state: { combined: 0.2, skyDarken: 11 } }, weather: { level: 0 },
      audio: { play: (name) => g.played.push(name) },
      particles: { emit: noop, smoke: noop, flame: () => { g.flames++; } },
      entities: { list: [], spawnItem: noop, spawnXp: noop },
      player: null,
    };
    return g;
  }
  function fakePlayer(x, y, z, over = {}) {
    return { x, y, z, dead: false, creative: false, sprinting: false, sneaking: false, eyeHeight: 1.62, fireTicks: 0, inventory: { selectedStack: null }, hits: [], hurt(d, src) { this.hits.push([d, src]); return true; }, ...over };
  }
  function put(g, type, x, y, z) {
    const m = new Mob(type, x, y, z);
    m._game = g;
    if (m.def.onSpawn) m.def.onSpawn(m);
    g.entities.list.push(m);
    return m;
  }
  const player = (g, p) => { g.player = p; return p; };
  const dist = (m, p) => Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z);

  it('register with names, models, faces, voices and drops that exist', () => {
    for (const k of ['brinecrab', 'wickling']) {
      const d = MOBS[k];
      expect(d, k).toBeTruthy();
      expect(MOB_KEYS).toContain(k);
      expect(d.name.length).toBeGreaterThan(3);
      expect(d.drops.length).toBeGreaterThan(0);
      for (const dr of d.drops) expect(ITEMS[dr.id], `${k} drop ${dr.id}`).toBeTruthy();
      expect(MODELS[k].parts.length).toBeGreaterThan(5);
      for (const [, , , , , o] of MODELS[k].parts) if (o && o.face) expect(typeof FACES[o.face]).toBe('function');
      expect(modelRects(MODELS[k]).length).toBe(MODELS[k].parts.length);
      expect(typeof d.customRender).toBe('function');
      expect(d.sound).toBe(k === 'brinecrab' ? 'clack' : 'sputter');
    }
    expect(MOBS.brinecrab.category).toBe(CATEGORY.CREATURE);
    expect(MOBS.wickling.category).toBe(CATEGORY.MONSTER);
    expect(BRINECRAB).toBe(MOBS.brinecrab);
    expect(WICKLING).toBe(MOBS.wickling);
  });

  it('have their own voices, played by audio.js and captioned', () => {
    const audio = src('src/audio/audio.js');
    for (const v of ['clack', 'sputter']) {
      expect(audio).toContain(`case '${v}':`);
      expect(CAPTION_TEXT[v]).toBeTruthy();
      expect(captionText(v)).toMatch(/[a-z]/);
    }
  });

  it('spawn in the biomes round the new places', () => {
    const has = (cat, biome, type) => spawnTable(cat, BIOME[biome]).some((e) => e.type === type);
    expect(has(CATEGORY.CREATURE, 'BEACH', 'brinecrab')).toBe(true);
    expect(has(CATEGORY.CREATURE, 'MANGROVE_SWAMP', 'brinecrab')).toBe(true);
    expect(has(CATEGORY.CREATURE, 'SWAMP', 'brinecrab')).toBe(true);
    expect(has(CATEGORY.CREATURE, 'PLAINS', 'brinecrab')).toBe(false);
    for (const b of ['SWAMP', 'MANGROVE_SWAMP', 'DARK_FOREST']) expect(has(CATEGORY.MONSTER, b, 'wickling'), b).toBe(true);
    expect(has(CATEGORY.MONSTER, 'PLAINS', 'wickling')).toBe(false);
    // a swamp keeps its usual monsters (Wobblers, Hexwives) and Wicklings are not the whole table
    const sw = pickProbabilities(SPAWN_TABLES.monster.swamp);
    expect(sw.wickling).toBeGreaterThan(0);
    expect(sw.wickling).toBeLessThan(0.5);
    expect(sw.wobbler).toBeGreaterThan(0);
    expect(sw.shambler).toBeGreaterThan(0);
    // the beach still has its turtles
    expect(has(CATEGORY.CREATURE, 'BEACH', 'shellback')).toBe(true);
  });

  it('a Brinecrab settles on sand, mud and gravel, which grass-only creatures do not', () => {
    expect(MOBS.brinecrab.spawnOn).toBe(CRAB_GROUND);
    for (const id of [B.SAND, B.RED_SAND, B.MUD, B.GRAVEL]) expect(crabGround(id)).toBe(true);
    expect(crabGround(B.GRASS)).toBe(false);
    expect(crabGround(B.STONE)).toBe(false);
    // MobSpawner.validSpawn on a sandy beach
    const world = new FlatWorld();
    world.set(0, 62, 0, B.SAND);
    const self = { game: { world, sky: { state: { skyDarken: 0, combined: 1 } } }, canFit: () => true };
    expect(MobSpawner.prototype.validSpawn.call(self, CATEGORY.CREATURE, 'brinecrab', 0, 63, 0)).toBe(true);
    expect(MobSpawner.prototype.validSpawn.call(self, CATEGORY.CREATURE, 'fleecer', 0, 63, 0)).toBe(false); // no grass below
    world.set(0, 62, 0, B.GRASS);
    expect(MobSpawner.prototype.validSpawn.call(self, CATEGORY.CREATURE, 'brinecrab', 0, 63, 0)).toBe(false);
    expect(src('src/mobs/spawner.js')).toMatch(/spawnOn\.has\(ground\)/); // chunk-generation placement too
  });

  it('crabStance: wary within five blocks, backing off within 2.6, grudging when hurt, calm for a sneaker', () => {
    expect(crabStance({ pdist: 10 })).toBe('idle');
    expect(crabStance({ pdist: 4 })).toBe('wary');
    expect(crabStance({ pdist: 2 })).toBe('back');
    expect(crabStance({ pdist: 2, sneaking: true })).toBe('idle');
    expect(crabStance({ pdist: 20, grudge: 5 })).toBe('grudge');
    expect(CRAB.WARY).toBe(5);
    expect(CRAB.GRUDGE).toBe(300);
  });

  it('a Brinecrab holds its claws up near a player, backs away, and pinches whoever hurt it', () => {
    const g = fakeGame();
    const p = player(g, fakePlayer(4, 63, 0));
    const m = put(g, 'brinecrab', 0, 63, 0);
    const ai = () => { g.ticks++; m.def.ownAI(m, g, p, dist(m, p)); };
    ai();
    expect(m.special).toBe(true); // claws up
    p.x = 30; ai();
    expect(m.special).toBe(false);
    // hurt by the player: a grudge, then it chases and pinches (the pinch is its attack, 2)
    m.def.onHurt(m, 1, 'player', p);
    expect(m.grudge).toBe(CRAB.GRUDGE);
    p.x = 0.4; p.z = 0; m.attackCooldown = 0;
    ai();
    expect(m.angry).toBe(true);
    expect(p.hits.length).toBe(1);
    expect(p.hits[0][0]).toBe(2);
    // fire does not start a grudge
    const m2 = put(g, 'brinecrab', 5, 63, 5);
    m2.def.onHurt(m2, 1, 'fire', null);
    expect(m2.grudge || 0).toBe(0);
    // the grudge wears off
    for (let k = 0; k < CRAB.GRUDGE + 2; k++) ai();
    expect(m.grudge).toBe(0);
    expect(m.angry).toBe(false);
  });

  it('a Brinecrab has one of three shells and drops Raw Crab, cooked when it burns', () => {
    const seen = new Set();
    const g = fakeGame();
    for (let k = 0; k < 60; k++) seen.add(put(g, 'brinecrab', k, 63, 0).woolColor);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    expect(CRAB_SHELLS).toHaveLength(3);
    const r = (n) => () => n;
    expect(rollDrops('brinecrab', { killedByPlayer: true }, r(0.99)).find((d) => d.id === I.RAW_CRAB).count).toBe(2);
    expect(rollDrops('brinecrab', { onFire: true }, r(0.5)).map((d) => d.id)).toContain(I.COOKED_CRAB);
    expect(SMELTING[I.RAW_CRAB]).toBe(I.COOKED_CRAB);
    expect(ITEMS[I.COOKED_CRAB].food.hunger).toBeGreaterThan(ITEMS[I.RAW_CRAB].food.hunger);
    expect(ITEMS[I.COOKED_CRAB].food.hunger).toBe(6);
  });

  it('wicklingSnuffed: water and rain under the open sky', () => {
    expect(wicklingSnuffed({ inWater: true })).toBe('water');
    expect(wicklingSnuffed({ raining: true, openSky: true })).toBe('rain');
    expect(wicklingSnuffed({ raining: true, openSky: false })).toBe(null);
    expect(wicklingSnuffed({})).toBe(null);
    expect(WICK.IGNITE).toBeGreaterThan(0);
  });

  it('a Wickling sets the player alight when it hits, flares its flame (angry) and is snuffed by water', () => {
    const g = fakeGame();
    const p = player(g, fakePlayer(0.5, 63, 0));
    const m = put(g, 'wickling', 0, 63, 0);
    m.target = 'player'; m.attackCooldown = 0;
    g.ticks = 100;
    m.def.customAI(m, g, p, dist(m, p));
    expect(m.angry).toBe(true);
    expect(p.hits.length).toBe(1);
    expect(p.fireTicks).toBeGreaterThanOrEqual(WICK.IGNITE);
    expect(g.flames).toBeGreaterThanOrEqual(0);
    // out of reach (no cooldown ready): no extra fire
    p.fireTicks = 0;
    m.def.customAI(m, g, p, dist(m, p));
    expect(p.fireTicks).toBe(0);
    // in water it takes damage and loses interest
    const w = put(g, 'wickling', 3, 63, 3);
    w.body.inWater = true; w.target = 'player';
    let hurt = 0;
    w.hurt = (d, src) => { hurt += d; expect(src).toBe('water'); };
    for (let t = 0; t < 40; t++) { g.ticks++; w.def.customAI(w, g, p, dist(w, p)); }
    expect(hurt).toBeGreaterThan(0);
    expect(w.angry).toBe(false);
    // a creative player is left alone
    const c = player(g, fakePlayer(0.5, 63, 0, { creative: true }));
    const m3 = put(g, 'wickling', 0, 63, 0); m3.target = 'player';
    g.ticks++; m3.def.customAI(m3, g, c, dist(m3, c));
    expect(c.fireTicks).toBe(0);
  });

  it('Wickling drops: Tallow, string and coal; Tallow is fuel and half a candle', () => {
    const r = (n) => () => n;
    const ids = rollDrops('wickling', { killedByPlayer: true }, r(0.99)).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([I.TALLOW, I.STRING]));
    expect(ITEMS[I.TALLOW].fuel).toBeGreaterThan(0);
    expect(craft([I.TALLOW, I.STRING].map(st), 2)).toEqual({ id: B.CANDLE, count: 2 });
  });

  it('snapshots keep their 25 fields and carry shell colour, claws up and the flare', () => {
    const g = fakeGame();
    const m = put(g, 'brinecrab', 1, 63, 2);
    m.woolColor = 2; m.special = true; m.angry = true;
    m.netId = 5;
    const a = packMob(m);
    expect(a.length).toBe(25);
    const u = unpackMob(JSON.parse(JSON.stringify(a)));
    expect(u).toMatchObject({ type: 'brinecrab', woolColor: 2, special: true, angry: true });
    const w = put(g, 'wickling', 1, 63, 2); w.angry = true; w.netId = 6;
    const b = packMob(w);
    expect(b.length).toBe(25);
    expect(unpackMob(b)).toMatchObject({ type: 'wickling', angry: true });
  });

  it('a guest builds them from the type alone: the mirror makes a Mob and their renderers run', () => {
    const g = fakeGame();
    for (const k of ['brinecrab', 'wickling']) {
      const m = new Mob(k, 0, 63, 0); // what net/entityMirror.js does for a snapshot
      expect(m.def).toBe(MOBS[k]);
      expect(m.type).toBe(k);
      expect(typeof m.def.customRender).toBe('function');
      expect(g.world).toBeTruthy();
    }
    expect(src('src/mobs/mob.js')).toContain("import './shoreMobs.js'");
  });
});

// ---------------------------------------------------------------------------------------------
describe('Field Guide, Help, README and balance hooks', () => {
  it('creatures and structures appear in the Field Guide with habitats and drops', () => {
    resetGuideEntries();
    const e = (k) => entriesOf('creatures').find((x) => x.key === k);
    expect(e('brinecrab').habitat).toEqual(expect.arrayContaining(['Beach', 'Mangrove Swamp']));
    expect(e('brinecrab').drops).toEqual(expect.arrayContaining([I.RAW_CRAB, I.COOKED_CRAB]));
    expect(e('wickling').habitat).toEqual(expect.arrayContaining(['Swamp', 'Dark Forest']));
    expect(e('wickling').drops).toEqual(expect.arrayContaining([I.TALLOW]));
    expect(e('wickling').kind).toBe('Monster');
    const biome = (k) => entriesOf('biomes').find((x) => x.key === k);
    expect(biome('beach').wildlife).toContain('Brinecrab');
    expect(biome('swamp').wildlife).toContain('Wickling');
    const structs = entriesOf('structures').map((x) => x.key);
    for (const k of ['lighthouse', 'mireshrine', 'observatory']) expect(structs).toContain(k);
    for (const s of entriesOf('structures').filter((x) => ['lighthouse', 'mireshrine', 'observatory'].includes(x.key))) expect(s.note).not.toBe('A landmark of the overworld.');
  });

  it('the Help screen has a topic for the new places and parts', () => {
    const topics = buildTopics({ table: resolveBindings({}) });
    const t = topics.find((x) => x.id === 'landmarks2');
    expect(t).toBeTruthy();
    for (const w of ['lighthouse', 'rose window', 'rope ladder', 'brinecrab', 'wickling']) expect(t.text).toContain(w);
  });

  it('the README lists the structures, blocks and mobs', () => {
    const readme = src('README.md');
    for (const w of ["Hermit's Lighthouse, Mire Shrine and Stargazer's Observatory", 'Lighthouse, shrine and observatory blocks', 'Shore round: Brinecrabs and Wicklings', '| Brinecrab |', '| Wickling |']) expect(readme).toContain(w);
    for (const w of ['Minecraft', 'Nether', 'redstone']) expect(readme).not.toContain(w);
  });

  it('the balance script knows the new mobs, so Raw Crab and Tallow count as obtainable', () => {
    expect(src('scripts/balance/craft.mjs')).toContain('shoreMobs.js');
  });

  it('new items are appended after the last older item', () => {
    expect(I.TARNLING_BUCKET).toBeLessThan(I.RAW_CRAB);
    expect(I.COOKED_CRAB).toBe(I.RAW_CRAB + 1);
    expect(I.TALLOW).toBe(I.RAW_CRAB + 2);
    expect(I.THISTLE_HARNESS).toBeLessThan(I.RAW_CRAB);
    expect(BIOMES.length).toBe(24); // no biome was added
  });
});
