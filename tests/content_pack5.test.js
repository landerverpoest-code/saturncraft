// Content pack 5: Painted Mesas (Strata), Slot Canyons, the buried Sandvault with its cinnabar-fed Dart Traps, Hag Huts with bog bridges and the
// Hag's Cauldron puzzle, the Sandsnapper / Peat Lurker / Cliffkite, the Farscope and Waymark Compass, and the fishing rework (Lure / Haul,
// Bogcarp / Dunefin / Gilded Perch, Fish Pie).
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { TerrainGenerator } from '../src/world/generator.js';
import { World } from '../src/world/world.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { B, BLOCKS, EMIT, SHAPE } from '../src/world/blocks.js';
import { I, ITEMS, POTION_ITEM, SPLASH_ITEM, LINGERING_ITEM, TIPPED_ARROW } from '../src/world/items.js';
import { POTIONS, brewKind } from '../src/world/potions.js';
import { brewItem, isIngredient } from '../src/world/brewing.js';
import { BIOME } from '../src/world/biomes.js';
import { cidx, SEA_LEVEL } from '../src/world/constants.js';
import { craft, SMELTING } from '../src/player/crafting.js';
import { texId, texturePixels, TEX_NAMES, FACE_TILE, FRONT_TILE } from '../src/world/textures.js';
import { toLocal, claimedByOthers } from '../src/world/siteKit.js';
import { claimedByOlder } from '../src/world/siteLite.js';
import {
  STRATA_OF, STRATA_IDS, paintedMesa, canyonInRegion, canyonsNear, canyonBlock, canyonAxis, canyonChests, inCanyonPool, CANYON_HALF, CANYON_DEPTH, CANYON_CLEAR, CANYON_BRIDGES, CANYON_LENGTH,
} from '../src/world/mesaPack.js';
import {
  sandvaultInRegion, sandvaultsNear, nearestSandvault, vaultBlock, vaultRoom, VAULT_HALF, TRAP_ROWS, sandvaultTraps, sandvaultChests, sandvaultGuards, sandvaultLid,
} from '../src/world/sandvault.js';
import { hagHutInRegion, hagHutsNear, hagBlock, hagChests, hagCauldronPos, hagGuards, HAG_HALF, HAG_BRIDGE_LEN } from '../src/world/hagHut.js';
import { mireShrinesNear } from '../src/world/mireShrine.js';
import { fireDart, dartFacing, DART } from '../src/world/dartTrap.js';
import { FACING6 } from '../src/world/circuitShapes.js';
import {
  cauldronRecipe, cauldronFeed, cauldronIndex, recipePages, CAULDRON_ITEMS, CAULDRON_STEPS, CAULDRON_YIELD, RIDDLES,
} from '../src/world/hagCauldron.js';
import { LORE, loreBook, addLore, loreKeyAt } from '../src/world/packLore.js';
import { landmarksInBox, nearestLandmark } from '../src/world/landmarks.js';
import { LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';
import { MILESTONES } from '../src/player/milestones.js';
import { runCommand, HELP } from '../src/ui/commands.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { Mob } from '../src/mobs/mob.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import {
  SNAP, LURK, KITE, SANDSNAPPER, PEAT_LURKER, CLIFFKITE, snapperAmbushes, snapperRetreats, lurkerNotice, lurkerLunges, kiteRingPoint, snapperGround, DUNE_HABITATS,
  snapperSpot, lurkerSpot,
} from '../src/mobs/duneMobs.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { modelRects } from '../src/ui/guideArt.js';
import { CAPTION_TEXT, captionText } from '../src/ui/accessibility.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { resolveBindings } from '../src/ui/bindings.js';
import { ENCHANTS, canApply, enchName, enchantability, categories } from '../src/world/enchantments.js';
import { rollCatch, biteWait, haulExtra, rodEnchants, Bobber, LOCAL_FISH_SHARE } from '../src/entities/bobber.js';
import { RECIPES as POT_RECIPES, recipeFor, KIND_BIT } from '../src/world/cookingPot.js';
import { DISHES, kindOfItem } from '../src/world/cooking.js';
import { canCampCook } from '../src/world/campfireCooking.js';
import {
  SCOPE_LEVELS, FARGLASS_FACTOR, zoomFactor, stepLevel, clampLevel, scopeSensitivity, magnification, rangeLabel, readoutText, aimedAt, isFarscope,
} from '../src/player/farscope.js';
import { cleanWaymark, waymarkNeedle, waymarkDistance, waymarkBearing, describeWaymark } from '../src/player/waymark.js';
import { playerSaveData } from '../src/world/save.js';
import { MockWorld, rng } from './helpers.js';
import { ON } from '../src/world/circuitShapes.js';
import { CHUNK_VOLUME } from '../src/world/constants.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const st = (id) => (id == null ? null : { id, count: 1 });
const SEED = 4242;
const gen = new TerrainGenerator(SEED);

function collect(find, g, n, R = 8) {
  const out = [];
  for (let r = 0; r <= R && out.length < n; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const s = find(g, rx, rz);
    if (s) out.push(s);
  }
  return out;
}
const vaults = collect(sandvaultInRegion, gen, 3);
const huts = collect(hagHutInRegion, gen, 3);
const canyons = collect(canyonInRegion, gen, 2, 14);

function reader(g) {
  const chunks = new Map();
  const chunk = (cx, cz) => { const k = `${cx},${cz}`; if (!chunks.has(k)) chunks.set(k, g.generate(cx, cz)); return chunks.get(k); };
  const get = (x, y, z) => { const cx = Math.floor(x / 16), cz = Math.floor(z / 16), c = chunk(cx, cz), i = cidx(x - cx * 16, y, z - cz * 16); return [c.blocks[i], c.meta[i]]; };
  return { get, chunk, count: () => chunks.size };
}
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
const toW = (s, u, v) => [[u, v], [-v, u], [-u, -v], [v, -u]][s.dir];
const at = (rd, s, u, h, v) => { const [dx, dz] = toW(s, u, v); return rd.get(s.cx + dx, s.y + h, s.cz + dz); };

// ---------------------------------------------------------------------------------------------
describe('the new blocks and items', () => {
  const NEW = ['STRATA_ROSE', 'STRATA_RUST', 'STRATA_CRIMSON', 'STRATA_SAFFRON', 'STRATA_BONE', 'STRATA_UMBER', 'STRATA_ASH', 'SANDVAULT_BRICKS', 'SUN_GLYPH', 'DART_TRAP', 'BOG_PLANKS', 'HAG_CAULDRON'];

  it('are appended after the Bounty Board, in order, without shifting any id', () => {
    expect(B.BOUNTY_BOARD).toBe(1356);
    NEW.forEach((k, i) => expect(B[k], k).toBe(1357 + i));
    expect(B.CHEST).toBe(62);
    expect(B.PULSE_GATE).toBe(1341);
    for (const k of NEW) { expect(BLOCKS[B[k]], k).toBeTruthy(); expect(ITEMS[B[k]], k).toBeTruthy(); }
  });

  it('items are appended after the Skybean and every older id is where it was', () => {
    expect(I.PEAT_CLOT).toBeGreaterThan(I.EMBER_BAND); // the gear round's items were appended first; every older id is where it was
    expect(I.PEAT_CLOT).toBeGreaterThan(I.SKYBEAN);
    const keys = ['PEAT_CLOT', 'SNAPPER_FANG', 'BOG_ESSENCE', 'FARSCOPE', 'WAYMARK_COMPASS', 'RAW_BOGCARP', 'COOKED_BOGCARP', 'RAW_DUNEFIN', 'COOKED_DUNEFIN', 'GILDED_PERCH', 'COOKED_GILDED_PERCH', 'FISH_PIE'];
    keys.forEach((k, i) => expect(I[k], k).toBe(I.PEAT_CLOT + i));
    expect(I.COMPASS).toBeLessThan(I.PEAT_CLOT);
    expect(I.FARGLASS).toBeLessThan(I.PEAT_CLOT);
    expect(POTION_ITEM.marsh).toBeGreaterThan(I.FISH_PIE);
    expect(POTION_ITEM.long_marsh).toBeGreaterThan(POTION_ITEM.marsh);
  });

  it('Strata replace the seven terracottas one for one, and are blocks like them', () => {
    expect(STRATA_OF.size).toBe(7);
    expect(STRATA_OF.get(B.RED_TERRACOTTA)).toBe(B.STRATA_CRIMSON);
    expect(new Set(STRATA_IDS).size).toBe(7);
    for (const id of STRATA_IDS) { expect(BLOCKS[id].name).toMatch(/^Strata /); expect(BLOCKS[id].hardness).toBeGreaterThan(1); }
  });

  it('the Dart Trap looks along its face like a dispenser and the Hag\'s Cauldron is a boxed shape', () => {
    expect(BLOCKS[B.DART_TRAP].tex.front).toBe('dart_trap_front');
    expect(FRONT_TILE[B.DART_TRAP]).toBe(texId('dart_trap_front'));
    expect(BLOCKS[B.HAG_CAULDRON].shape).toBe(SHAPE.BOXES);
    expect(src('src/world/mesher.js')).toContain('id === B.DART_TRAP');
    expect(src('src/player/interaction.js')).toMatch(/placeId === B\.DART_TRAP/);
  });

  it('draw their own textures: every face is painted and the strata differ', () => {
    for (const k of NEW) {
      const b = BLOCKS[B[k]];
      for (const face of new Set([b.tex.top, b.tex.bottom, b.tex.side, b.tex.front].filter(Boolean))) {
        expect(texId(face), `${k} ${face}`).toBeGreaterThanOrEqual(0);
        let seen = 0;
        const px = texturePixels(face);
        for (let i = 3; i < px.length; i += 4) if (px[i] > 0) seen++;
        expect(seen, `${k} ${face}`).toBeGreaterThan(200);
      }
    }
    const ps = STRATA_IDS.map((id) => Buffer.from(texturePixels(BLOCKS[id].tex.top)).toString('hex'));
    expect(new Set(ps).size).toBe(7);
    // banded: the rows are not all one colour
    const px = texturePixels('strata_rust');
    const rows = new Set();
    for (let y = 0; y < 16; y++) rows.add(px[(y * 16 + 3) * 4] + ',' + px[(y * 16 + 3) * 4 + 1]);
    expect(rows.size).toBeGreaterThan(3);
    expect(TEX_NAMES).toContain('hag_cauldron_top');
    expect(FACE_TILE[B.STRATA_ROSE * 6]).toBe(texId('strata_rose'));
  });

  it('have recipes that work from the base game', () => {
    expect(craft([I.FARGLASS, I.GOLD_INGOT, B.GLASS].map(st), 3)).toEqual({ id: I.FARSCOPE, count: 1 });
    expect(craft([I.COMPASS, I.PAPER, I.GOLD_NUGGET].map(st), 3)).toEqual({ id: I.WAYMARK_COMPASS, count: 1 });
    const C = B.COBBLESTONE;
    expect(craft([C, C, C, C, I.ARROW, C, C, I.CINNABAR, C].map(st), 3)).toEqual({ id: B.DART_TRAP, count: 1 });
    expect(craft([B.OAK_PLANKS, B.OAK_PLANKS, B.MUD].map(st), 3)).toEqual({ id: B.BOG_PLANKS, count: 2 });
    const X = I.IRON_INGOT;
    expect(craft([X, null, X, X, I.SLIMEBALL, X, X, X, X].map(st), 3)).toEqual({ id: B.HAG_CAULDRON, count: 1 });
  });

  it('use none of the forbidden names', () => {
    const text = ['src/world/mesaPack.js', 'src/world/sandvault.js', 'src/world/hagHut.js', 'src/world/hagCauldron.js', 'src/world/dartTrap.js', 'src/world/pack5Textures.js', 'src/mobs/duneMobs.js', 'src/player/farscope.js', 'src/player/waymark.js'].map(src).join('\n');
    for (const w of ['Minecraft', 'Nether', 'redstone']) expect(text).not.toContain(w);
    expect(text).not.toMatch(/\bEnd\b/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Painted Mesas', () => {
  it('paint the badlands cliffs with Strata only where the patch is, and leave other biomes alone', () => {
    const s = canyons[0];
    expect(s).toBeTruthy();
    const rd = reader(gen);
    let strata = 0, terra = 0, paintedCols = 0, plainCols = 0;
    for (let cx = Math.floor(s.cx / 16) - 3; cx <= Math.floor(s.cx / 16) + 3; cx++) for (let cz = Math.floor(s.cz / 16) - 3; cz <= Math.floor(s.cz / 16) + 3; cz++) {
      const c = rd.chunk(cx, cz);
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        if (c.biomes[x + z * 16] !== BIOME.BADLANDS) continue;
        const painted = paintedMesa(gen, cx * 16 + x, cz * 16 + z);
        painted ? paintedCols++ : plainCols++;
        for (let y = c.heightmap[x + z * 16]; y > c.heightmap[x + z * 16] - 40; y--) {
          const id = c.blocks[cidx(x, y, z)];
          if (STRATA_IDS.includes(id)) { if (painted) strata++; else return expect.fail('strata outside a Painted Mesa'); }
          else if ([...STRATA_OF.keys()].includes(id)) { if (painted) terra++; }
        }
      }
    }
    expect(paintedCols).toBeGreaterThan(50);
    expect(strata).toBeGreaterThan(500);
    expect(terra).toBe(0); // every terracotta band of a painted column was repainted
    expect(plainCols + paintedCols).toBeGreaterThan(0);
  });

  it('the patch noise is a pure function of the seed', () => {
    const other = new TerrainGenerator(SEED);
    for (let i = 0; i < 40; i++) expect(paintedMesa(other, i * 37 - 500, i * 91)).toBe(paintedMesa(gen, i * 37 - 500, i * 91));
    let n = 0;
    for (let i = 0; i < 400; i++) if (paintedMesa(gen, i * 53 - 9000, i * 71 - 4000)) n++;
    expect(n).toBeGreaterThan(60);
    expect(n).toBeLessThan(340);
  });

  it('keeps the carver path cache hash and the generator itself otherwise deterministic', () => {
    const a = gen.generate(Math.floor(canyons[0].cx / 16), Math.floor(canyons[0].cz / 16)), b = new TerrainGenerator(SEED).generate(Math.floor(canyons[0].cx / 16), Math.floor(canyons[0].cz / 16));
    expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer))).toBe(true);
    expect(src('tests/perf_pass2.test.js')).toContain('9420d8710a417724c66c96c305c27134085f06dcd88b6db5fac6e310ccb8d64a');
    expect(src('src/world/mesaPack.js')).not.toMatch(/carveChunk/);
  });
});

describe('Slot Canyons', () => {
  it('are found in badlands plateaus, clear of the older structures and of Sandvaults', () => {
    expect(canyons.length).toBeGreaterThanOrEqual(1);
    for (const s of canyons) {
      const col = gen.column(s.cx, s.cz), top = gen.surfaceAt(s.cx, s.cz, col);
      expect(gen.biomeFor(col, top)).toBe(BIOME.BADLANDS);
      expect(s.y).toBe(top);
      expect(claimedByOlder(gen, s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6)).toBe(false);
      expect(sandvaultsNear(gen, s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6).length).toBe(0);
      expect(canyonsNear(gen, s.cx - 2, s.cz - 2, s.cx + 2, s.cz + 2).map((x) => x.cx)).toContain(s.cx);
    }
  });

  it('wind, swell and taper shut at both ends, with a pool on the floor and bridges across', () => {
    const s = canyons[0];
    const centres = new Set();
    for (let v = -20; v <= 20; v++) { const a = canyonAxis(s, v); centres.add(a.c); expect(a.w).toBeGreaterThan(0.5); }
    expect(centres.size).toBeGreaterThan(5);
    expect(canyonAxis(s, CANYON_LENGTH).w).toBe(0);
    const c0 = canyonAxis(s, 0).c;
    expect(inCanyonPool(s, c0, 0)).toBe(true);
    expect(inCanyonPool(s, c0, 9)).toBe(false);
    expect(canyonBlock(s, c0, -CANYON_DEPTH, 0)).toEqual([B.WATER, 0]);
    expect(canyonBlock(s, c0, -CANYON_DEPTH - 1, 0)).toEqual([B.RED_SAND, 0]);
    expect(canyonBlock(s, c0, 5, 0)).toEqual([B.AIR, 0]);
    expect(canyonBlock(s, c0 + 12, 5, 0)).toBeNull(); // the rock beside the slot is left alone
    for (const v of CANYON_BRIDGES) { const a = canyonAxis(s, v); expect(canyonBlock(s, a.c, 0, v)).toEqual([B.OAK_PLANKS, 0]); }
    expect(canyonBlock(s, 0, CANYON_CLEAR + 1, 0)).toBeNull();
  });

  it('are stamped identically over every chunk they cross, and hold a chest at the far end', () => {
    const s = canyons[0], rd = reader(gen);
    const res = matchesWorld(s, canyonBlock, CANYON_HALF, -CANYON_DEPTH - 1, CANYON_CLEAR, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(5000);
    const [c] = canyonChests(s);
    const [id, meta] = rd.get(c.x, c.y, c.z);
    expect(id).toBe(B.CHEST);
    expect(meta & 8).toBe(8);
    expect((meta >> 4) & 15).toBe(c.kind);
    expect(rd.get(c.x, c.y - 1, c.z)[0]).toBe(B.RED_SAND);
  });

  it('/locate, maps and the milestone know them', () => {
    const s = canyons[0];
    expect(LANDMARK_BY_KEY.canyon).toBeTruthy();
    expect(landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5)).toContainEqual({ kind: 'canyon', x: s.cx, z: s.cz });
    expect(nearestLandmark(gen, 'canyon', s.cx + 30, s.cz - 30).kind).toBe('canyon');
    const game = { seed: SEED, world: { dimension: 'overworld', gen }, player: { x: s.cx + 20, z: s.cz - 20 } };
    expect(runCommand(game, '/locate canyon')).toMatch(/^The nearest Slot Canyon is at -?\d+, -?\d+, -?\d+ \(\d+ blocks away\)$/);
    expect(MILESTONES.map((m) => m.id)).toEqual(expect.arrayContaining(['sandvault', 'canyon', 'haghut']));
  });
});

// ---------------------------------------------------------------------------------------------
describe('the Sandvault', () => {
  const s = vaults[0];

  it('is found under desert or badlands sand on level ground, deterministic and clear of older structures', () => {
    expect(vaults.length).toBeGreaterThanOrEqual(2);
    for (const v of vaults) {
      const col = gen.column(v.cx, v.cz), top = gen.surfaceAt(v.cx, v.cz, col);
      expect([BIOME.DESERT, BIOME.BADLANDS]).toContain(gen.biomeFor(col, top));
      expect(v.y).toBe(top);
      expect(claimedByOlder(gen, v.x0 - 6, v.z0 - 6, v.x1 + 6, v.z1 + 6)).toBe(false);
      expect(claimedByOthers(gen, v.x0 - 6, v.z0 - 6, v.x1 + 6, v.z1 + 6)).toBe(false);
    }
    const other = new TerrainGenerator(SEED);
    for (let rx = -4; rx <= 4; rx++) for (let rz = -4; rz <= 4; rz++) expect(sandvaultInRegion(other, rx, rz)).toEqual(sandvaultInRegion(gen, rx, rz));
    expect(nearestSandvault(gen, s.cx + 20, s.cz - 20)).toBeTruthy();
  });

  it('is stamped identically over every chunk it crosses', () => {
    const rd = reader(gen), res = matchesWorld(s, vaultBlock, VAULT_HALF, -9, 0, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(500);
  });

  it('shows nothing but the Sun Glyph, laid flush in the sand, over a shaft with a rope ladder', () => {
    const rd = reader(gen), lid = sandvaultLid(s);
    expect(rd.get(lid.x, lid.y, lid.z)[0]).toBe(B.SUN_GLYPH);
    expect([B.SAND, B.RED_SAND, B.AIR]).toContain(rd.get(lid.x, lid.y - 6, lid.z)[0] === B.ROPE_LADDER ? B.AIR : rd.get(lid.x, lid.y - 6, lid.z)[0]);
    for (let h = -1; h >= -8; h--) expect(at(rd, s, 0, h, 6)[0], `ladder ${h}`).toBe(B.ROPE_LADDER);
    // nothing of the vault (no bricks, plates, traps) is in the top layers
    for (let u = -VAULT_HALF; u <= VAULT_HALF; u++) for (let v = -VAULT_HALF; v <= VAULT_HALF; v++) {
      if (u === 0 && v === 6) continue;
      expect([B.SANDVAULT_BRICKS, B.DART_TRAP, B.STONE_PRESSURE_PLATE, B.SUN_GLYPH]).not.toContain(at(rd, s, u, 0, v)[0]);
    }
  });

  it('has three trap rows: a plate and wires on the floor, a Dart Trap in each wall looking across', () => {
    const rd = reader(gen);
    expect(TRAP_ROWS.length).toBe(3);
    for (const r of TRAP_ROWS) {
      for (const u of r.plates) expect(at(rd, s, u, -8, r.v)[0], `plate ${u},${r.v}`).toBe(B.STONE_PRESSURE_PLATE);
      for (const u of r.wires) expect(at(rd, s, u, -8, r.v)[0], `wire ${u},${r.v}`).toBe(B.CINNABAR_WIRE);
      for (const side of [-2, 2]) {
        const [id, m] = at(rd, s, side, -8, r.v);
        expect(id).toBe(B.DART_TRAP);
        // it looks across the corridor
        const [dx, , dz] = dartFacing(m), [wx, wz] = toW(s, -Math.sign(side), 0);
        expect([dx || 0, dz || 0]).toEqual([Math.sign(wx) || 0, Math.sign(wz) || 0]);
      }
      // a way past each row that touches no plate (on the other columns)
      const free = [-1, 0, 1].filter((u) => !r.plates.includes(u));
      expect(free.length).toBeGreaterThan(0);
    }
    expect(sandvaultTraps(s).length).toBe(6);
  });

  it('a pressure plate fires the traps through the real cinnabar simulation, and cutting the wire disarms a row', () => {
    // build a real world over the vault
    const w = new World(SEED);
    const rd = reader(gen);
    for (let cx = Math.floor((s.cx - 12) / 16); cx <= Math.floor((s.cx + 12) / 16); cx++) for (let cz = Math.floor((s.cz - 12) / 16); cz <= Math.floor((s.cz + 12) / 16); cz++) {
      const c = rd.chunk(cx, cz), light = new Uint8Array(CHUNK_VOLUME);
      computeChunkLight(c.blocks, light);
      w.addChunk(cx, cz, { blocks: new Uint16Array(c.blocks), meta: new Uint8Array(c.meta), light, biomes: c.biomes, colors: c.colors, heightmap: c.heightmap });
    }
    w.tick();
    const fired = [];
    w.circuits.onDispense = (x, y, z, id) => fired.push([x, y, z, id]);
    const row = TRAP_ROWS[0];
    const [px, pz] = toW(s, row.plates[0], row.v);
    const plate = [s.cx + px, s.y - 8, s.cz + pz];
    expect(w.getBlock(...plate)).toBe(B.STONE_PRESSURE_PLATE);
    w.setBlock(plate[0], plate[1], plate[2], B.STONE_PRESSURE_PLATE, 1); // stepped on
    for (let i = 0; i < 12; i++) w.tick();
    expect(fired.filter((f) => f[3] === B.DART_TRAP).length).toBe(2); // both walls of the row
    const traps = sandvaultTraps(s).filter((t) => fired.some((f) => f[0] === t.x && f[2] === t.z));
    expect(traps.length).toBe(2);
    // the other rows stay quiet
    const other = sandvaultTraps(s).filter((t) => !traps.some((x) => x.x === t.x && x.z === t.z));
    for (const t of other) expect(fired.some((f) => f[0] === t.x && f[2] === t.z)).toBe(false);
    // release, cut the wires of the row, step again: nothing fires
    w.setBlock(plate[0], plate[1], plate[2], B.STONE_PRESSURE_PLATE, 0);
    for (let i = 0; i < 12; i++) w.tick();
    fired.length = 0;
    for (const u of row.wires) { const [wx, wz] = toW(s, u, row.v); w.setBlock(s.cx + wx, s.y - 8, s.cz + wz, B.AIR); }
    w.setBlock(plate[0], plate[1], plate[2], B.STONE_PRESSURE_PLATE, 1);
    for (let i = 0; i < 12; i++) w.tick();
    expect(fired.length).toBe(0);
  }, 30000);

  it('has a burial hall with three chests (one holds the ledger), shambler guards and a golden sun on the wall', () => {
    const rd = reader(gen), chests = sandvaultChests(s);
    expect(chests.length).toBe(3);
    for (const c of chests) { const [id, m] = rd.get(c.x, c.y, c.z); expect(id).toBe(B.CHEST); expect(m & 8).toBe(8); expect(rd.get(c.x, c.y - 1, c.z)[0]).toBe(B.SANDVAULT_BRICKS); }
    expect(chests.filter((c) => c.lore).length).toBe(1);
    for (const g of sandvaultGuards(s)) { expect(g.type).toBe('dune_shambler'); expect(rd.get(g.x, g.y, g.z)[0]).toBe(B.AIR); expect(rd.get(g.x, g.y - 1, g.z)[0]).toBe(B.SANDVAULT_BRICKS); }
    expect(at(rd, s, 0, -7, -8)[0]).toBe(B.SUN_GLYPH);
    expect(vaultRoom(0, -8, -6)).toBe('hall');
    expect(vaultRoom(0, -8, 0)).toBe('corr');
    expect(vaultRoom(5, -8, 0)).toBeNull();
    expect(src('src/mobs/spawner.js')).toContain('sandvaultGuards');
  });

  it('keeps its book in the chest marked for it, and /locate and the map find it', () => {
    const c = sandvaultChests(s).find((x) => x.lore);
    expect(loreKeyAt(gen, c.x, c.y, c.z)).toBe('sandvault');
    const slots = new Array(27).fill(null);
    expect(addLore(gen, c.x, c.y, c.z, slots)).toBe('sandvault');
    expect(slots.find(Boolean).title).toBe(LORE.sandvault.title);
    expect(landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5)).toContainEqual({ kind: 'sandvault', x: s.cx, z: s.cz });
    const game = { seed: SEED, world: { dimension: 'overworld', gen }, player: { x: s.cx + 20, z: s.cz - 20 } };
    expect(runCommand(game, '/locate sandvault')).toMatch(/^The nearest Sandvault is at/);
    for (const p of LORE.sandvault.pages) expect(p.length).toBeLessThanOrEqual(256);
  });
});

describe('Dart Traps', () => {
  it('fire one arrow along their face and not into a wall', () => {
    const w = new MockWorld(60);
    w.set(0, 64, 0, B.DART_TRAP, 5); // facing +x (FACING6 index 5)
    const arrows = [];
    const g = { world: w, entities: { spawnArrow: (...a) => { const o = { args: a }; arrows.push(o); return o; } }, audio: { play: vi.fn() } };
    expect(fireDart(g, 0, 64, 0, () => 0.5)).toBe('dart');
    expect(arrows.length).toBe(1);
    const a = arrows[0];
    expect(a.args[3]).toBeCloseTo(DART.SPEED, 1);
    expect(a.args[5]).toBeCloseTo(0, 1);
    expect(a.pickup).toBe(false);
    expect(a.dart).toBe(true);
    w.set(1, 64, 0, B.STONE);
    expect(fireDart(g, 0, 64, 0)).toBe('blocked');
    expect(arrows.length).toBe(1);
    expect(fireDart(g, 5, 64, 5)).toBe('fail');
    expect(FACING6[5]).toEqual([1, 0, 0]);
  });

  it('are wired into the circuits and the game (a rising edge fires, the host only)', () => {
    expect(src('src/world/circuits.js').match(/B\.DART_TRAP/g).length).toBeGreaterThanOrEqual(4);
    expect(src('src/game.js')).toMatch(/B\.DART_TRAP\) fireDart/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Hag Huts and bog bridges', () => {
  const s = huts[0];

  it('stand in swamps at the water line, clear of swamp huts and Mire Shrines', () => {
    expect(huts.length).toBeGreaterThanOrEqual(2);
    for (const h of huts) {
      const col = gen.column(h.cx, h.cz), top = gen.surfaceAt(h.cx, h.cz, col);
      expect([BIOME.SWAMP, BIOME.MANGROVE_SWAMP]).toContain(gen.biomeFor(col, top));
      expect(h.y).toBe(SEA_LEVEL);
      expect(claimedByOlder(gen, h.x0 - 6, h.z0 - 6, h.x1 + 6, h.z1 + 6)).toBe(false);
      expect(mireShrinesNear(gen, h.x0 - 6, h.z0 - 6, h.x1 + 6, h.z1 + 6).length).toBe(0);
    }
    expect(hagHutsNear(gen, s.cx - 2, s.cz - 2, s.cx + 2, s.cz + 2).length).toBe(1);
  });

  it('are stamped identically over every chunk they cross', () => {
    const rd = reader(gen), res = matchesWorld(s, hagBlock, HAG_HALF, 0, 10, rd);
    expect(typeof res).toBe('number');
    expect(res).toBeGreaterThan(500);
  });

  it('have a room on stilts with a doorway, a Hag\'s Cauldron, a chest with a book and shelves', () => {
    const rd = reader(gen);
    expect(at(rd, s, 0, 2, 0)[0]).toBe(B.BOG_PLANKS); // floor
    expect(at(rd, s, 3, 4, 3)[0]).toBe(B.OAK_LOG);    // a corner post
    expect(at(rd, s, 0, 3, 3)[0]).toBe(B.AIR);       // the doorway
    expect(at(rd, s, 0, 4, 3)[0]).toBe(B.AIR);
    const cp = hagCauldronPos(s);
    expect(rd.get(cp.x, cp.y, cp.z)[0]).toBe(B.HAG_CAULDRON);
    const [c] = hagChests(s);
    const [id, m] = rd.get(c.x, c.y, c.z);
    expect(id).toBe(B.CHEST);
    expect(m & 8).toBe(8);
    expect(c.lore).toBe('hag');
    expect(at(rd, s, 2, 3, 0)[0]).toBe(B.BOOKSHELF);
    for (const g of hagGuards(s)) { expect(g.type).toBe('wickling'); expect(rd.get(g.x, g.y, g.z)[0]).toBe(B.AIR); expect(rd.get(g.x, g.y - 1, g.z)[0]).toBe(B.BOG_PLANKS); }
    // the roof closes it
    expect(at(rd, s, 0, 6, 0)[0]).toBe(B.BOG_PLANKS);
  });

  it('send two bog bridges out of the hut: a deck at the hut\'s floor level on posts with lanterns', () => {
    const rd = reader(gen);
    for (let k = 4; k <= 3 + HAG_BRIDGE_LEN; k++) {
      for (const u of [-1, 0, 1]) expect([B.BOG_PLANKS, B.MOSSY_COBBLESTONE], `A ${u},${k}`).toContain(at(rd, s, u, 2, k)[0]);
      expect([B.BOG_PLANKS, B.MOSSY_COBBLESTONE], `B ${k}`).toContain(at(rd, s, k, 2, 0)[0]);
      for (const h of [3, 4]) { expect(at(rd, s, 0, h, k)[0]).toBe(B.AIR); expect(at(rd, s, k, h, 0)[0]).toBe(B.AIR); }
    }
    // a post with a fence and a lantern
    expect(at(rd, s, 2, 2, 6)[0]).toBe(B.OAK_LOG);
    expect(at(rd, s, 2, 3, 6)[0]).toBe(B.OAK_FENCE);
    expect(at(rd, s, 2, 4, 6)[0]).toBe(B.LANTERN);
    // posts go down: the cell under the deck post is a log
    expect(at(rd, s, 2, 1, 6)[0]).toBe(B.OAK_LOG);
  });

  it('keep the lore book and the world recipe together', () => {
    const [c] = hagChests(s);
    expect(loreKeyAt(gen, c.x, c.y, c.z)).toBe('hag');
    const slots = new Array(27).fill(null);
    addLore(gen, c.x, c.y, c.z, slots);
    const book = slots.find(Boolean);
    expect(book.title).toBe("The Hag's Receipt");
    expect(book.pages).toEqual(recipePages(SEED));
    expect(loreBook('hag', 1).pages).not.toEqual(loreBook('hag', 2).pages); // the recipe depends on the world
  });
});

describe('the Hag\'s Cauldron', () => {
  it('has a recipe of three different things in an order the seed decides', () => {
    for (const seed of [1, 2, 3, 4242, 99999]) {
      const r = cauldronRecipe(seed);
      expect(r.length).toBe(CAULDRON_STEPS);
      expect(new Set(r).size).toBe(3);
      for (const i of r) expect(i).toBeGreaterThanOrEqual(0), expect(i).toBeLessThan(CAULDRON_ITEMS.length);
      expect(cauldronRecipe(seed)).toEqual(r);
    }
    const orders = new Set(Array.from({ length: 60 }, (_, k) => cauldronRecipe(k).join('')));
    expect(orders.size).toBeGreaterThan(8);
  });

  it('takes the right thing at the right time, curdles on a wrong one, and ignores other items', () => {
    const seed = 7, r = cauldronRecipe(seed), id = (i) => I[CAULDRON_ITEMS[i]];
    let p = 0;
    for (let k = 0; k < 2; k++) { const o = cauldronFeed(seed, p, id(r[k])); expect(o.result).toBe('step'); p = o.progress; expect(p).toBe(k + 1); }
    expect(cauldronFeed(seed, p, id(r[2]))).toEqual({ result: 'done', progress: 0 });
    // the right thing too early (or twice) curdles
    expect(cauldronFeed(seed, 0, id(r[1]))).toEqual({ result: 'curdle', progress: 0 });
    expect(cauldronFeed(seed, 1, id(r[0]))).toEqual({ result: 'curdle', progress: 0 });
    const unused = [0, 1, 2, 3].find((i) => !r.includes(i));
    expect(cauldronFeed(seed, 2, id(unused)).result).toBe('curdle');
    for (const x of [I.STICK, B.DIRT, I.DIAMOND]) expect(cauldronFeed(seed, 1, x)).toEqual({ result: 'ignore', progress: 1 });
    expect(cauldronIndex(I.PEAT_CLOT)).toBe(0);
    expect(CAULDRON_YIELD).toEqual({ key: 'BOG_ESSENCE', count: 2 });
  });

  it('is solved with the riddles: every thing has one and the pages name them in recipe order', () => {
    for (const k of CAULDRON_ITEMS) expect(RIDDLES[k].length).toBeGreaterThan(10);
    const pages = recipePages(SEED), r = cauldronRecipe(SEED);
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(256);
    r.forEach((i, k) => expect(pages[1 + k]).toContain(RIDDLES[CAULDRON_ITEMS[i]]));
    expect(pages[1]).toMatch(/^First:/);
    expect(pages[3]).toMatch(/^Last:/);
  });

  it('the interaction keeps its state in the block meta (shared and saved) and works from the guest side through setBlockUrgent', () => {
    const t = src('src/player/interaction.js');
    expect(t).toContain('useHagCauldron');
    expect(t).toMatch(/setBlockUrgent\(t\.x, t\.y, t\.z, B\.HAG_CAULDRON/);
    expect(t).toMatch(/B\.HAG_CAULDRON, \.\.\.BOX_COLORS|B\.BOUNTY_BOARD, B\.HAG_CAULDRON/);
  });

  it('Bog Essence brews an Elixir of the Marsh on a Murky Elixir, long with Cinnabar, splash with Blast Powder', () => {
    expect(isIngredient(I.BOG_ESSENCE)).toBe(true);
    expect(brewKind('murky', 'bog_essence')).toBe('marsh');
    expect(brewKind('water', 'bog_essence')).toBe('bland');
    expect(brewKind('marsh', 'cinnabar')).toBe('long_marsh');
    expect(brewItem(POTION_ITEM.murky, I.BOG_ESSENCE)).toBe(POTION_ITEM.marsh);
    expect(brewItem(POTION_ITEM.marsh, I.CINNABAR)).toBe(POTION_ITEM.long_marsh);
    expect(brewItem(POTION_ITEM.marsh, I.GUNPOWDER)).toBe(SPLASH_ITEM.marsh);
    expect(POTIONS.marsh.effects.map((e) => e[0])).toEqual(['water_breathing', 'regeneration']);
    expect(ITEMS[POTION_ITEM.marsh].drink).toBe(true);
    expect(LINGERING_ITEM.marsh).toBeTruthy();
    expect(ITEMS[TIPPED_ARROW.marsh].tipped).toBe('marsh');
  });
});

// ---------------------------------------------------------------------------------------------
describe('the three new mobs', () => {
  const fakePlayer = (x = 0, y = 64, z = 0) => ({ x, y, z, dead: false, creative: false, sneaking: false, sprinting: false, eyeHeight: 1.62, effects: {}, applyEffect: vi.fn(), hurt: vi.fn(() => true) });
  const sandWorld = () => {
    const w = new MockWorld(63);
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) w.set(x, 63, z, B.SAND);
    w.raycast = () => null; w.heightAt = () => 63; w.isLoaded = () => true; w.biomeAt = () => BIOME.DESERT;
    return w;
  };
  const fakeGame = (w) => ({ world: w, ticks: 0, audio: { play: vi.fn() }, particles: { emit: vi.fn(), smoke: vi.fn() }, entities: { list: [] }, sky: { state: {} } });
  const put = (g, type, x, y, z) => { const m = new Mob(type, x, y, z); m._game = g; m.body.onGround = true; m.def.onSpawn && m.def.onSpawn(m); return m; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  it('are registered with models, faces, drops, voices and a custom render', () => {
    for (const [k, snd] of [['sandsnapper', 'snap'], ['peat_lurker', 'gurgle'], ['cliffkite', 'kite']]) {
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
      expect(typeof d.ownAI).toBe('function');
      expect(d.sound).toBe(snd);
      expect(src('src/audio/audio.js')).toContain(`case '${snd}':`);
      expect(captionText(snd)).toMatch(/[a-z]/);
      expect(CAPTION_TEXT[snd]).toBeTruthy();
    }
    expect(MOBS.sandsnapper).toBe(SANDSNAPPER); expect(MOBS.peat_lurker).toBe(PEAT_LURKER); expect(MOBS.cliffkite).toBe(CLIFFKITE);
    expect(MOBS.sandsnapper.category).toBe(CATEGORY.MONSTER);
    expect(MOBS.peat_lurker.category).toBe(CATEGORY.MONSTER);
    expect(MOBS.cliffkite.category).toBe(CATEGORY.CREATURE);
    expect(MOBS.cliffkite.flying).toBe(true);
    expect(MOBS.sandsnapper.burrower).toBe(true);
    expect(MOBS.peat_lurker.drops.some((d) => d.id === I.PEAT_CLOT)).toBe(true);
    expect(MOBS.sandsnapper.drops.some((d) => d.id === I.SNAPPER_FANG)).toBe(true);
  });

  it('keep the mob snapshot at 25 fields and the protocol version, carrying their state in the flags it has', () => {
    const g = fakeGame(sandWorld());
    const m = put(g, 'sandsnapper', 0, 64, 0);
    m.special = true; m.emerging = 7; m.digging = 0; m.angry = false;
    const a = packMob(m);
    expect(a.length).toBe(25);
    const u = unpackMob(a);
    expect(u.type).toBe('sandsnapper');
    expect(u.special).toBe(true);
    expect(u.emerging).toBe(7);
    m.special = false; m.emerging = 0; m.digging = 9; m.angry = true;
    const u2 = unpackMob(packMob(m));
    expect([u2.special, u2.digging, u2.angry]).toEqual([false, 9, true]);
    expect(unpackMob(packMob(put(g, 'peat_lurker', 0, 64, 0))).type).toBe('peat_lurker');
    expect(unpackMob(packMob(put(g, 'cliffkite', 0, 64, 0))).type).toBe('cliffkite');
    expect(src('src/net/protocol.js')).toMatch(/PROTOCOL_VERSION\s*=\s*\d+/);
  });

  it('a Sandsnapper ambushes inside 3.4 blocks (1.7 when sneaking), only when rested and buried', () => {
    expect(snapperAmbushes({ pdist: 3 })).toBe(true);
    expect(snapperAmbushes({ pdist: 4 })).toBe(false);
    expect(snapperAmbushes({ pdist: 3, sneaking: true })).toBe(false);
    expect(snapperAmbushes({ pdist: 1.5, sneaking: true })).toBe(true);
    expect(snapperAmbushes({ pdist: 2, cooldown: 5 })).toBe(false);
    expect(snapperAmbushes({ pdist: 2, buried: false })).toBe(false);
    expect(snapperRetreats({ pdist: 3, up: 10, bitten: true })).toBe(true);
    expect(snapperRetreats({ pdist: 3, up: 10, bitten: false })).toBe(false);
    expect(snapperRetreats({ pdist: 12, up: 10, bitten: false })).toBe(true);
    expect(snapperRetreats({ pdist: 3, up: SNAP.UP_MAX + 1, bitten: false })).toBe(true);
    expect(snapperGround(B.SAND, 0, 0)).toBe(true);
    expect(snapperGround(B.GRASS, 0, 0)).toBe(false);
    expect(snapperGround(B.SAND, B.STONE, 0)).toBe(false);
  });

  it('a buried Sandsnapper cannot be hurt, bursts out of the sand at a player, bites with Slowness and digs back in', () => {
    const w = sandWorld(), g = fakeGame(w), p = fakePlayer(2.5, 64, 0);
    const m = put(g, 'sandsnapper', 0, 64, 0);
    expect(m.special).toBe(true);
    expect(SANDSNAPPER.onHurt(m, 6)).toBe(0);
    const ai = () => { g.ticks++; m.def.ownAI(m, g, p, dist(m, p)); };
    ai();
    expect(m.emerging).toBe(SNAP.EMERGE);
    expect(SANDSNAPPER.onHurt(m, 6)).toBe(0); // still out of reach while coming up
    for (let i = 0; i < SNAP.EMERGE; i++) ai();
    expect(m.special).toBe(false);
    expect(m.angry).toBe(true);
    expect(SANDSNAPPER.onHurt(m, 6)).toBe(6);
    // a bite: slowness, then it lets go
    m.attackCooldown = 0; m.tryMelee = (gg, pl) => { m.attackCooldown = 20; };
    m.chase = () => {};
    ai();
    expect(p.applyEffect).toHaveBeenCalledWith('slowness', SNAP.BITE_SLOW, 1);
    expect(m.bitten).toBe(true);
    ai();
    expect(m.digging).toBe(SNAP.DIG);
    for (let i = 0; i < SNAP.DIG; i++) ai();
    expect(m.special).toBe(true);
    expect(m.cooldown).toBeGreaterThan(0);
  });

  it('a player who sneaks past a buried Sandsnapper is not ambushed, and a creative player never is', () => {
    const w = sandWorld(), g = fakeGame(w), p = fakePlayer(2.5, 64, 0);
    const m = put(g, 'sandsnapper', 0, 64, 0);
    p.sneaking = true;
    m.def.ownAI(m, g, p, 2.5);
    expect(m.emerging).toBe(0);
    p.sneaking = false; p.creative = true;
    m.def.ownAI(m, g, p, 2.5);
    expect(m.emerging).toBe(0);
  });

  it('a Peat Lurker lies submerged, notices a walker within 6 blocks (2.4 sneaking), surges, bites and goes home', () => {
    expect(lurkerNotice(false)).toBe(LURK.NOTICE);
    expect(lurkerNotice(true)).toBe(LURK.NOTICE_SNEAK);
    expect(lurkerLunges({ pdist: 5 })).toBe(true);
    expect(lurkerLunges({ pdist: 7 })).toBe(false);
    expect(lurkerLunges({ pdist: 5, sneaking: true })).toBe(false);
    const w = sandWorld(), g = fakeGame(w), p = fakePlayer(9, 64, 0);
    const m = put(g, 'peat_lurker', 0, 64, 0);
    m.body.inWater = true;
    const ai = (d) => { g.ticks++; m.def.ownAI(m, g, p, d); };
    ai(9);
    expect(m.special).toBe(true); // submerged: only the eyes show
    expect(m.angry).toBe(false);
    p.x = 4; ai(4);
    expect(m.angry).toBe(true);
    expect(m.special).toBe(false);
    m.chase = () => {}; m.attackCooldown = 0; m.tryMelee = () => { m.attackCooldown = 20; };
    ai(2);
    expect(p.applyEffect).toHaveBeenCalledWith('slowness', LURK.BITE_SLOW, 1);
    ai(LURK.GIVE_UP + 3);
    expect(m.angry).toBe(false); // gave up
    // out of the water it is not hidden
    m.body.inWater = false; m.angry = false; ai(30);
    expect(m.special).toBe(false);
  });

  it('a Cliffkite circles over a ring that rises and falls, keeps clear of people and stoops on whoever struck it', () => {
    const home = { x: 0, y: 70, z: 0 };
    const pts = [0, 1, 2, 3].map((k) => kiteRingPoint(home, k, 12, k * 5));
    for (const p of pts) { expect(Math.hypot(p.x, p.z)).toBeCloseTo(12, 5); expect(p.y).toBeGreaterThan(home.y + KITE.CLIMB - 4); expect(p.y).toBeLessThan(home.y + KITE.CLIMB + 4); }
    expect(new Set(pts.map((p) => p.y.toFixed(2))).size).toBeGreaterThan(1);
    const w = sandWorld(), g = fakeGame(w), p = fakePlayer(30, 64, 0);
    const m = put(g, 'cliffkite', 0, 90, 0);
    m.home = { x: 0, y: 76, z: 0 };
    m.def.ownAI(m, g, p, 30);
    expect(m.angry).toBe(false);
    expect(CLIFFKITE.onHurt(m, 3, 'player', p)).toBe(3);
    expect(m.grudge).toBe(KITE.GRUDGE);
    m.def.ownAI(m, g, p, 30);
    expect(m.angry).toBe(true);
    expect(m.body.vx).toBeGreaterThan(0); // stooping towards the attacker
    CLIFFKITE.onHurt(m, 3, 'fall', null);
    expect(m.grudge).toBeGreaterThan(0);
  });

  it('spawn on the right ground in the right biomes and the Field Guide knows where', () => {
    const w = sandWorld();
    expect(snapperSpot(w, 0, 0)).toEqual({ x: 0, y: 64, z: 0 });
    w.set(0, 63, 0, B.GRASS);
    expect(snapperSpot(w, 0, 0)).toBeNull();
    w.biomeAt = () => BIOME.PLAINS;
    expect(snapperSpot(w, 5, 5)).toBeNull();
    const bog = new MockWorld(63); bog.isLoaded = () => true; bog.biomeAt = () => BIOME.SWAMP; bog.heightAt = () => 64;
    for (const y of [64, 63, 62]) bog.set(0, y, 0, B.WATER);
    bog.set(0, 61, 0, B.MUD);
    expect(lurkerSpot(bog, 0, 0)).toBeTruthy();
    bog.biomeAt = () => BIOME.OCEAN;
    expect(lurkerSpot(bog, 0, 0)).toBeNull();
    expect(DUNE_HABITATS.cliffkite).toEqual(['badlands']);
    resetGuideEntries();
    const creatures = entriesOf('creatures');
    for (const [k, place] of [['sandsnapper', 'Desert'], ['peat_lurker', 'Swamp'], ['cliffkite', 'Badlands']]) {
      const e = creatures.find((c) => c.key === k);
      expect(e, k).toBeTruthy();
      expect(e.habitat.join(' ')).toContain(place);
    }
    expect(src('src/mobs/spawner.js')).toContain('duneTick(this)');
    expect(src('src/mobs/spawner.js')).toContain('duneChunkSpawn(this, cx, cz)');
    expect(src('src/mobs/mob.js')).toContain("import './duneMobs.js'");
  });
});

// ---------------------------------------------------------------------------------------------
describe('the Farscope', () => {
  it('has three zoom steps that narrow the view more than the Farglass at the top, stepped by the wheel', () => {
    expect(SCOPE_LEVELS.length).toBe(3);
    for (let i = 1; i < 3; i++) expect(SCOPE_LEVELS[i]).toBeLessThan(SCOPE_LEVELS[i - 1]);
    expect(SCOPE_LEVELS[2]).toBeLessThan(FARGLASS_FACTOR);
    expect(zoomFactor(I.FARSCOPE, 0)).toBe(SCOPE_LEVELS[0]);
    expect(zoomFactor(I.FARSCOPE, 2)).toBe(SCOPE_LEVELS[2]);
    expect(zoomFactor(I.FARGLASS, 2)).toBe(FARGLASS_FACTOR);
    expect(zoomFactor(I.STICK, 1)).toBe(1);
    expect(isFarscope(I.FARSCOPE)).toBe(true);
    expect(isFarscope(I.FARGLASS)).toBe(false);
    expect(ITEMS[I.FARSCOPE].spyglass).toBe(true); // the old look-through rules apply
    expect(stepLevel(0, -1)).toBe(1); // wheel up zooms in
    expect(stepLevel(0, 1)).toBe(0);  // and stops at the ends
    expect(stepLevel(2, -1)).toBe(2);
    expect(stepLevel(2, 1)).toBe(1);
    expect(clampLevel(9)).toBe(2);
    expect(clampLevel(-3)).toBe(0);
    expect(scopeSensitivity(I.FARSCOPE, 2)).toBeLessThan(scopeSensitivity(I.FARSCOPE, 0));
    expect(scopeSensitivity(I.FARGLASS)).toBe(0.15);
    expect(src('src/game.js')).toMatch(/zoomFactor\(scopeId, p\.scopeLevel\)/);
    expect(src('src/game.js')).toMatch(/stepLevel\(p\.scopeLevel, m\.wheel\)/);
  });

  it('reads out the magnification, what the cross-hairs rest on and the range', () => {
    expect(magnification(I.FARSCOPE, 0)).toBe('x3.1');
    expect(rangeLabel(42.4)).toBe('42 m');
    expect(rangeLabel(1500)).toBe('1.5 km');
    expect(readoutText(I.FARSCOPE, 1, 'Cliffkite', 88)).toBe('x6.3 · Cliffkite · 88 m');
    expect(readoutText(I.FARSCOPE, 1, null, null)).toBe('x6.3');
    // aimedAt: a creature on the line, a hidden burrower is not named, and a block is named when nothing is in front of it
    const world = { raycast: () => ({ dist: 60, id: B.SANDSTONE }) };
    const mob = (x, over = {}) => ({ kind: 'mob', x, y: 64, z: 0, height: 1, width: 0.8, dead: false, deathTime: 0, def: { name: 'Sandsnapper' }, ...over });
    const look = [1, 0, 0], eye = [0, 64.5, 0];
    expect(aimedAt(world, eye, look, [mob(30)], () => 'Sandstone')).toEqual({ what: 'Sandsnapper', dist: 30 });
    expect(aimedAt(world, eye, look, [mob(30, { special: true, def: { name: 'Sandsnapper', burrower: true } })], () => 'Sandstone')).toEqual({ what: 'Sandstone', dist: 60 });
    expect(aimedAt(world, eye, look, [mob(30, { z: 6 })], () => 'Sandstone').what).toBe('Sandstone'); // off to the side
    expect(aimedAt(world, eye, look, [mob(70)], () => 'Sandstone').what).toBe('Sandstone');         // behind the rock
    expect(aimedAt({ raycast: () => null }, eye, look, [], () => 'x')).toEqual({ what: null, dist: null });
    expect(aimedAt(world, eye, look, [mob(30, { customName: 'Rex' })]).what).toBe('Rex');
  });

  it('the HUD draws the read-out under the ring', () => {
    expect(src('src/ui/hud.js')).toContain('scope-text');
    expect(src('src/ui/style.css')).toContain('.scope-text');
    expect(src('src/game.js')).toContain('scopeReadout');
  });
});

describe('the Waymark Compass', () => {
  const wm = { x: 100, z: 0, dim: 'overworld', kind: 'board', label: 'Oakhaven Bounty Board' };

  it('is a dial item and its needle points at the waymark relative to the way you face', () => {
    expect(ITEMS[I.WAYMARK_COMPASS].dial).toBe('waymark');
    expect(waymarkNeedle(wm, 0, 0, 0)).toBeCloseTo(-(Math.atan2(-100, -0) - 0), 5);
    // facing the waymark head on puts the needle straight up
    expect(Math.abs(waymarkNeedle(wm, 0, 0, Math.atan2(-100, -0)))).toBeLessThan(1e-9);
    // turning right (yaw changes) turns the needle the other way
    const a = waymarkNeedle(wm, 0, 0, 0.3), b = waymarkNeedle(wm, 0, 0, 0);
    expect(a).not.toBeCloseTo(b, 3);
    expect(waymarkNeedle(null, 0, 0, 0)).toBeNull();
    expect(waymarkNeedle(wm, 0, 0, 0, 'hollow')).toBeNull();
    expect(waymarkNeedle(wm, 99.5, 0, 0)).toBeNull(); // standing on it
    expect(src('src/render/overlays.js')).toContain("'waymark'");
    expect(src('src/ui/icons.js')).toContain("kind === 'waymark'");
  });

  it('describes the target with a distance and a compass point', () => {
    expect(waymarkDistance(wm, 0, 0)).toBe(100);
    expect(waymarkDistance(wm, 0, 0, 'hollow')).toBeNull();
    expect(waymarkBearing(wm, 0, 0)).toBe('east');
    expect(waymarkBearing({ x: 0, z: -50 }, 0, 0)).toBe('north');
    expect(waymarkBearing({ x: 0, z: 50 }, 0, 0)).toBe('south');
    expect(waymarkBearing({ x: -30, z: 30 }, 0, 0)).toBe('south-west');
    expect(describeWaymark(wm, 0, 0)).toBe('Oakhaven Bounty Board, 100 m east');
    expect(describeWaymark(wm, 100, 0)).toBe('Oakhaven Bounty Board, right here');
    expect(describeWaymark(null, 0, 0)).toMatch(/No waymark/);
    expect(describeWaymark(wm, 0, 0, 'hollow')).toMatch(/another dimension/);
  });

  it('cleans waymarks from saves and travels with the player save', () => {
    expect(cleanWaymark(wm)).toEqual({ x: 100, z: 0, dim: 'overworld', kind: 'board', label: 'Oakhaven Bounty Board' });
    expect(cleanWaymark({ x: 'a', z: 0 })).toBeNull();
    expect(cleanWaymark(null)).toBeNull();
    expect(cleanWaymark({ x: 1e12, z: 0 })).toBeNull();
    expect(cleanWaymark({ x: 1, z: 2, kind: 'nonsense', label: '  hi\u0000  ' })).toEqual({ x: 1, z: 2, dim: 'overworld', kind: 'place', label: 'hi' });
    const p = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, health: 20, hunger: { food: 20, saturation: 5, exhaustion: 0 }, air: 300, spawn: { x: 0, y: 64, z: 0 }, inventory: { slots: [], armor: [], selected: 0 }, xp: {}, gamemode: 'survival', effects: {}, waymark: wm };
    expect(playerSaveData(p).waymark).toEqual(wm);
    expect(playerSaveData({ ...p, waymark: undefined }).waymark).toBeNull();
    expect(src('src/world/save.js')).toContain('p.waymark = cleanWaymark(d.waymark)');
  });

  it('opening a Bounty Board sets it, and /waymark here and /wp add do too', () => {
    expect(src('src/ui/questScreens.js')).toContain("kind: 'board'");
    const set = vi.fn(), p = { x: 12, z: -4, waymark: null };
    const game = { seed: 1, world: { dimension: 'overworld' }, player: p, setWaymark: (w) => { set(w); p.waymark = { ...w, dim: 'overworld' }; } };
    expect(runCommand(game, '/waymark here Camp')).toBe('Waymark set: Camp');
    expect(set).toHaveBeenCalledWith({ x: 12, z: -4, kind: 'place', label: 'Camp' });
    expect(runCommand(game, '/waymark')).toMatch(/^Camp, 0 m|^Camp, right here/);
    expect(runCommand(game, '/waymark clear')).toBe('Waymark cleared');
    expect(p.waymark).toBeNull();
    expect(runCommand(game, '/waymark')).toMatch(/No waymark/);
    expect(HELP.join('\n')).toContain('/waymark');
  });
});

// ---------------------------------------------------------------------------------------------
describe('fishing', () => {
  const FISH = new Set([I.RAW_SILVERFIN, I.RAW_REDFIN, I.SPINEFISH, I.GLIMMERFIN, I.RAW_BOGCARP, I.RAW_DUNEFIN, I.GILDED_PERCH, I.RAW_LANTERNFIN]);
  const frac = (n, f) => { let c = 0; for (let k = 0; k < n; k++) if (f()) c++; return c / n; };

  it('keeps the reference split everywhere without a local fish (85 % fish, mostly silverfin)', () => {
    const r = rng(11);
    expect(frac(20000, () => FISH.has(rollCatch(r).id))).toBeCloseTo(0.85, 1);
    expect(frac(20000, () => rollCatch(r, 0, 'plains').id === I.RAW_SILVERFIN)).toBeCloseTo(0.85 * 0.6, 1);
  });

  it('bogs give Bogcarp, dry lands Dunefin, and neither turns up elsewhere', () => {
    const r = rng(5);
    const share = (biome, id) => frac(20000, () => rollCatch(r, 0, biome).id === id);
    expect(share('swamp', I.RAW_BOGCARP)).toBeGreaterThan(0.85 * LOCAL_FISH_SHARE * 0.85);
    expect(share('swamp', I.RAW_BOGCARP)).toBeLessThan(0.85 * LOCAL_FISH_SHARE * 1.15);
    expect(share('mangrove_swamp', I.RAW_BOGCARP)).toBeGreaterThan(0.2);
    for (const b of ['desert', 'badlands', 'savanna', 'beach']) expect(share(b, I.RAW_DUNEFIN), b).toBeGreaterThan(0.2);
    expect(share('plains', I.RAW_BOGCARP)).toBe(0);
    expect(share('swamp', I.RAW_DUNEFIN)).toBe(0);
    expect(share('desert', I.RAW_BOGCARP)).toBe(0);
    expect(share('deep_ocean', I.RAW_BOGCARP)).toBe(0);
  });

  it('a Gilded Perch only comes up with Haul, more with each level', () => {
    const r = rng(9);
    const perch = (haul) => frac(30000, () => rollCatch(r, 0, 'plains', haul).id === I.GILDED_PERCH);
    expect(perch(0)).toBe(0);
    const p1 = perch(1), p3 = perch(3);
    expect(p1).toBeGreaterThan(0.02);
    expect(p3).toBeGreaterThan(p1 * 2);
    // Haul also tips towards treasure (a level of luck each)
    const treasure = (haul) => frac(30000, () => [I.BOW, I.FISHING_ROD, I.DIAMOND, I.IRON_INGOT, I.BOOK].includes(rollCatch(r, 0, 'plains', haul).id));
    expect(treasure(3)).toBeGreaterThan(treasure(0));
  });

  it('Lure shortens the wait by five seconds a level (never under two) and Haul sometimes brings a second fish', () => {
    expect(biteWait(() => 0.5, false, 0)).toBe(350);
    expect(biteWait(() => 0.5, false, 1)).toBe(250);
    expect(biteWait(() => 0.5, true, 0)).toBe(280);
    expect(biteWait(() => 0, false, 3)).toBe(40);
    expect(biteWait(() => 0.9, false, 3)).toBeLessThan(biteWait(() => 0.9, false, 0));
    expect(haulExtra(() => 0.0, 0)).toBe(false);
    expect(haulExtra(() => 0.1, 1)).toBe(true);
    expect(haulExtra(() => 0.3, 1)).toBe(false);
    expect(haulExtra(() => 0.5, 3)).toBe(true);
    const r = rng(2);
    expect(frac(20000, () => haulExtra(r, 2))).toBeCloseTo(0.4, 1);
    const owner = { inventory: { selectedStack: { id: I.FISHING_ROD, count: 1, ench: { lure: 2, haul: 1 } } } };
    expect(rodEnchants(owner.inventory.selectedStack)).toEqual({ lure: 2, haul: 1 });
    const b = new Bobber(0, 64, 0, 0, 0, 0, owner);
    expect([b.lure, b.haul]).toEqual([2, 1]);
    expect(new Bobber(0, 64, 0, 0, 0, 0, { inventory: { selectedStack: null } }).lure).toBe(0);
  });

  it('rods take Lure and Haul at the enchanting table and the anvil, and nothing else of the table is lost', () => {
    expect(ENCHANTS.lure.max).toBe(3);
    expect(ENCHANTS.haul.max).toBe(3);
    expect(canApply('lure', I.FISHING_ROD)).toBe(true);
    expect(canApply('haul', I.FISHING_ROD)).toBe(true);
    expect(canApply('lure', I.DIAMOND_SWORD)).toBe(false);
    expect(canApply('keen', I.FISHING_ROD)).toBe(false);
    expect(canApply('steadfast', I.FISHING_ROD, true)).toBe(true); // unbreaking by book
    expect(categories(I.FISHING_ROD)).toContain('rod');
    expect(enchantability(I.FISHING_ROD)).toBeGreaterThan(0);
    expect(enchName('lure', 2)).toBe('Lure II');
    expect(enchName('haul', 3)).toBe('Haul III');
  });

  it('the new fish are food, roast on a fire or in a furnace, and are fish for the Cooking Pot', () => {
    for (const [raw, cooked] of [[I.RAW_BOGCARP, I.COOKED_BOGCARP], [I.RAW_DUNEFIN, I.COOKED_DUNEFIN], [I.GILDED_PERCH, I.COOKED_GILDED_PERCH]]) {
      expect(ITEMS[raw].food).toBeTruthy();
      expect(SMELTING[raw]).toBe(cooked);
      expect(ITEMS[cooked].food.hunger).toBeGreaterThan(ITEMS[raw].food.hunger);
      expect(ITEMS[cooked].food.saturation).toBeLessThanOrEqual(ITEMS[cooked].food.hunger * 2.4);
      expect(canCampCook(raw)).toBe(true);
      expect(kindOfItem(raw)).toBe('fish');
    }
    expect(ITEMS[I.COOKED_GILDED_PERCH].food.effects[0][0]).toBe('regeneration');
  });

  it('a Fish Pie is cooked from any fish and wheat in the Cooking Pot, by hand, three servings', () => {
    const i = recipeFor(KIND_BIT.fish | KIND_BIT.grain);
    expect(i).toBe(8);
    expect(POT_RECIPES[i].key).toBe('fish_pie');
    expect(POT_RECIPES[i].bowl).toBe(false);
    expect(POT_RECIPES[i].servings).toBe(3);
    const d = DISHES[i];
    expect(d.id).toBe(I.FISH_PIE);
    expect(d.name).toBe('Fish Pie');
    expect(ITEMS[I.FISH_PIE].stack).toBe(64);
    expect(ITEMS[I.FISH_PIE].food.effects[0][0]).toBe('water_breathing');
    expect(POT_RECIPES.length).toBeLessThanOrEqual(16);
    expect(new Set(POT_RECIPES.map((r) => r.mask)).size).toBe(POT_RECIPES.length);
    expect(recipeFor(KIND_BIT.fish | KIND_BIT.root)).toBe(1); // Fisher's Chowder is still there
  });
});

// ---------------------------------------------------------------------------------------------
describe('help, Field Guide, README', () => {
  it('has a help topic naming the new places, tools and fish', () => {
    const topics = buildTopics({ table: resolveBindings({}) });
    const t = topics.find((x) => x.id === 'dunebog');
    expect(t).toBeTruthy();
    const text = JSON.stringify(t.sections || t).toLowerCase();
    for (const w of ['sandvault', 'hag', 'farscope', 'waymark', 'lure', 'haul', 'fish pie', 'dart trap']) expect(text, w).toContain(w);
  });

  it('the Field Guide lists the new places, items and blocks', () => {
    resetGuideEntries();
    const structures = entriesOf('structures').map((e) => e.key);
    for (const k of ['sandvault', 'canyon', 'haghut']) expect(structures).toContain(k);
    const items = entriesOf('items').map((e) => e.name);
    for (const n of ['Farscope', 'Waymark Compass', 'Bog Essence', 'Raw Bogcarp', 'Raw Dunefin', 'Gilded Perch', 'Fish Pie', 'Dart Trap', "Hag's Cauldron", 'Peat Clot', 'Snapper Fang']) expect(items, n).toContain(n);
  });

  it('the README has a bullet and the mob table rows', () => {
    const readme = src('README.md');
    expect(readme).toContain('Desert, badlands and swamp depth');
    for (const n of ['| Sandsnapper |', '| Peat Lurker |', '| Cliffkite |']) expect(readme).toContain(n);
    expect(readme).not.toMatch(/Minecraft|Nether|redstone/);
  });

  it('every /locate word is documented in the help line', () => {
    expect(HELP.join('\n')).toMatch(/sandvault\|canyon\|haghut/);
    const game = { seed: SEED, world: { dimension: 'overworld', gen }, player: { x: huts[0].cx + 20, z: huts[0].cz - 20 } };
    expect(runCommand(game, '/locate haghut')).toMatch(/^The nearest Hag Hut is at/);
    expect(runCommand({ seed: SEED, world: { dimension: 'hollow', gen }, player: { x: 0, z: 0 } }, '/locate sandvault')).toMatch(/overworld/);
  });
});
