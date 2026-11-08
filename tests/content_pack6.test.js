// Content pack 6: the Frozen Deep (floes, icebergs, Icebound Hulks), village Bounty Boards for old worlds (retrofit), touch and gamepad access to
// the Quest Journal and a waypoint, and the Cartographer's Table.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TerrainGenerator } from '../src/world/generator.js';
import { B, BLOCKS, NUM_BLOCKS } from '../src/world/blocks.js';
import { BIOME, BIOMES } from '../src/world/biomes.js';
import { I } from '../src/world/items.js';
import { SEA_LEVEL, CHUNK_VOLUME, cidx } from '../src/world/constants.js';
import {
  floeAt, floeValue, FLOE_MIN, LEAD_MAX, icebergInRegion, icebergsNear, nearestIceberg, icebergBlock, icebergChests, bergRadius,
  hulksNear, nearestHulk, hulkBlock, hulkChests, hulkKeel, hulkWidth, HULK_CHESTS, FROZEN_LOOT, deepBiomeFor, DEEP_TOP, stampFrozenDeep,
} from '../src/world/frozenDeep.js';
import { claimedByOlder } from '../src/world/siteLite.js';
import { toWorld } from '../src/world/siteKit.js';
import { villageInRegion, boardSpot, stampVillageBoards } from '../src/world/villages.js';
import { FEATURES, CURRENT_FEATURE_VERSION, planChunkRetrofit } from '../src/world/retrofit.js';
import { LANDMARK_KINDS, LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';
import { ACTIONS, defaultTable, resolveBindings } from '../src/ui/bindings.js';
import { runCommand } from '../src/ui/commands.js';
import { Explored, CHART_RADIUS, MAX_CHUNKS, takeItems, drawExplored, tableOffers, surveyAtTable, copyHeldMap, SQUARE_CHUNKS } from '../src/player/cartographer.js';
import { Inventory } from '../src/player/inventory.js';
import { mapOrigin, newMap, MAP_SIZE } from '../src/world/maps.js';
import { craft } from '../src/player/crafting.js';
import { entriesOf } from '../src/player/fieldGuideEntries.js';
import { PROTOCOL_VERSION } from '../src/net/protocol.js';
import { TEX_NAMES } from '../src/world/textures.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const FORBIDDEN = /minecraft|nether|redstone/i;

// ---- a saved chunk as an older game would have written it: the generator's output with the newer passes taken back out ----------------
function legacyChunk(gen, cx, cz, keep = []) {
  const log = [];
  let sb, sm, sbio;
  gen.passHook = {
    before(name, b, m, bio) { sb = b.slice(); sm = m.slice(); sbio = bio.slice(); },
    after(name, b, m, bio) { log.push({ name, sb, sm, sbio, b: b.slice(), m: m.slice(), bio: bio.slice() }); }, // (copies: the live arrays are changed again by what runs after the pass)
  };
  const full = gen.generate(cx, cz);
  gen.passHook = null;
  for (const L of log.reverse()) {
    if (keep.includes(L.name)) continue;
    for (let i = 0; i < CHUNK_VOLUME; i++) if (L.b[i] !== L.sb[i] || L.m[i] !== L.sm[i]) { full.blocks[i] = L.sb[i]; full.meta[i] = L.sm[i]; }
    for (let c = 0; c < 256; c++) if (L.bio[c] !== L.sbio[c]) full.biomes[c] = L.sbio[c];
  }
  return { ...full, light: new Uint8Array(CHUNK_VOLUME), fv: 0, modified: true };
}

describe('content pack 6: ids and wiring', () => {
  it('appends the blocks and the biome at the end, with textures and no forbidden words', () => {
    expect(B.HAG_CAULDRON).toBe(1368);
    expect(B.PACKED_ICE).toBe(1369);
    expect(B.CARTOGRAPHERS_TABLE).toBe(1370);
    expect(NUM_BLOCKS).toBe(1371);
    expect(BLOCKS[B.PACKED_ICE].name).toBe('Packed Ice');
    expect(BLOCKS[B.CARTOGRAPHERS_TABLE].name).toBe("Cartographer's Table");
    for (const n of ['packed_ice', 'cartographers_table_top', 'cartographers_table_side']) expect(TEX_NAMES).toContain(n);
    expect(BIOME.FROZEN_DEEP).toBe(26);
    expect(BIOMES[26].key).toBe('frozen_deep');
    expect(BIOMES[26].temp).toBeLessThan(0.15); // snow falls there
    for (const f of ['src/world/frozenDeep.js', 'src/player/cartographer.js', 'src/ui/tableScreens.js', 'src/world/pack6Textures.js']) expect(src(f), f).not.toMatch(FORBIDDEN);
    expect(PROTOCOL_VERSION).toBe(2);
  });
  it('lists the new passes in the retrofit, last, in the generator order, as version 7', () => {
    const tail = FEATURES.slice(-4);
    expect(tail.map((f) => f.key)).toEqual(['frozenDeep', 'iceberg', 'frozenHulk', 'villageBoards']);
    for (const f of tail) expect(f.since).toBe(7);
    expect(CURRENT_FEATURE_VERSION).toBe(7);
    const calls = [...src('src/world/generator.js').matchAll(/this\.pass\('([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(calls.slice(-4)).toEqual(['frozenDeep', 'iceberg', 'frozenHulk', 'villageBoards']);
  });
  it('knows the new landmarks, /locate words, Field Guide notes and milestones', () => {
    for (const k of ['iceberg', 'hulk']) { expect(LANDMARK_BY_KEY[k]).toBeTruthy(); expect(LANDMARK_KINDS.filter((x) => x.key === k)).toHaveLength(1); }
    const cmd = src('src/ui/commands.js');
    expect(cmd).toMatch(/'Iceberg', null, nearestIceberg/); expect(cmd).toMatch(/'Icebound Hulk', null, nearestHulk/);
    const notes = entriesOf('structures');
    for (const k of ['iceberg', 'hulk']) expect(notes.find((e) => e.key === k).note.length).toBeGreaterThan(40);
    expect(entriesOf('biomes').find((e) => e.key === 'frozen_deep')).toBeTruthy();
    const items = entriesOf('items');
    expect(items.find((e) => e.id === B.PACKED_ICE)).toBeTruthy();
    expect(items.find((e) => e.id === B.CARTOGRAPHERS_TABLE)).toBeTruthy();
    expect(src('src/player/milestones.js')).toMatch(/id: 'iceberg'/);
  });
});

describe('Frozen Deep', () => {
  const gen = new TerrainGenerator(12345);
  const berg = nearestIceberg(gen, 0, 0, 40), hulk = nearestHulk(gen, 0, 0, 40);

  it('floes, leads and plain sheet follow one noise field', () => {
    let floe = 0, lead = 0, sheet = 0;
    for (let x = -400; x < 400; x += 5) for (let z = -400; z < 400; z += 5) {
      const f = floeAt(gen, x, z), v = floeValue(gen, x, z);
      if (f.kind === 'floe') { floe++; expect(v).toBeGreaterThan(FLOE_MIN); expect(f.thick).toBeGreaterThanOrEqual(1); expect(f.thick).toBeLessThanOrEqual(4); expect([1, 2]).toContain(f.rise); }
      else if (f.kind === 'lead') { lead++; expect(v).toBeLessThan(LEAD_MAX); } else { sheet++; expect(v).toBeGreaterThanOrEqual(LEAD_MAX); expect(v).toBeLessThanOrEqual(FLOE_MIN); }
    }
    expect(floe).toBeGreaterThan(300); expect(lead).toBeGreaterThan(30); expect(sheet).toBeGreaterThan(floe);
  });
  it('deepBiomeFor paints the deep part of a frozen ocean only', () => {
    expect(deepBiomeFor(gen, BIOME.FROZEN_OCEAN, DEEP_TOP, 0, 0)).toBe(BIOME.FROZEN_DEEP);
    expect(deepBiomeFor(gen, BIOME.FROZEN_OCEAN, DEEP_TOP + 1, 0, 0)).toBe(BIOME.FROZEN_OCEAN);
    expect(deepBiomeFor(gen, BIOME.OCEAN, DEEP_TOP, 0, 0)).toBe(BIOME.DEEP_OCEAN);
    expect(deepBiomeFor(gen, BIOME.PLAINS, 70, 0, 0)).toBe(BIOME.PLAINS);
  });
  it('the pass paints the biome, breaks the sheet into floes and leaves everything else alone', () => {
    // a synthetic chunk: a frozen ocean with a deep floor under an ice sheet
    const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME), biomes = new Uint8Array(256).fill(BIOME.FROZEN_OCEAN), heightmap = new Int16Array(256).fill(20);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { blocks[cidx(x, 20, z)] = B.GRAVEL; for (let y = 21; y < SEA_LEVEL; y++) blocks[cidx(x, y, z)] = B.WATER; blocks[cidx(x, SEA_LEVEL, z)] = B.ICE; }
    // find a chunk whose area has floes and leads
    let hit = null;
    for (let cx = -20; cx < 20 && !hit; cx++) for (let cz = -20; cz < 20 && !hit; cz++) {
      const kinds = new Set();
      for (let x = 0; x < 16; x += 3) for (let z = 0; z < 16; z += 3) kinds.add(floeAt(gen, cx * 16 + x, cz * 16 + z).kind);
      if (kinds.size === 3) hit = [cx, cz];
    }
    expect(hit).toBeTruthy();
    const before = blocks.slice();
    stampFrozenDeep(gen, blocks, meta, hit[0], hit[1], heightmap, biomes);
    const seen = new Set();
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      expect(biomes[x + z * 16]).toBe(BIOME.FROZEN_DEEP);
      const f = floeAt(gen, hit[0] * 16 + x, hit[1] * 16 + z);
      seen.add(f.kind);
      const cap = blocks[cidx(x, SEA_LEVEL, z)];
      if (f.kind === 'floe') { expect(cap).toBe(B.PACKED_ICE); expect(blocks[cidx(x, SEA_LEVEL - 1, z)]).toBe(B.PACKED_ICE); expect([B.PACKED_ICE, B.SNOW_BLOCK]).toContain(blocks[cidx(x, SEA_LEVEL + f.rise, z)]); expect(blocks[cidx(x, SEA_LEVEL + f.rise + 1, z)]).toBe(B.AIR); }
      else if (f.kind === 'lead') expect(cap).toBe(B.WATER);
      else expect(cap).toBe(B.ICE);
      for (let y = 0; y < 20; y++) expect(blocks[cidx(x, y, z)]).toBe(before[cidx(x, y, z)]); // the floor and below are untouched
    }
    expect(seen.size).toBe(3);
  });
  it('shallow frozen ocean and other biomes get no biome change', () => {
    const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME), heightmap = new Int16Array(256).fill(SEA_LEVEL - 10);
    const biomes = new Uint8Array(256).fill(BIOME.FROZEN_OCEAN);
    stampFrozenDeep(gen, blocks, meta, 0, 0, heightmap, biomes);
    expect(new Set(biomes)).toEqual(new Set([BIOME.FROZEN_OCEAN]));
    const land = new Uint8Array(256).fill(BIOME.PLAINS);
    stampFrozenDeep(gen, blocks, meta, 0, 0, new Int16Array(256).fill(20), land);
    expect(new Set(land)).toEqual(new Set([BIOME.PLAINS]));
    expect(blocks.every((b) => b === 0)).toBe(true);
  });

  it('plans icebergs and hulks from the seed alone, deterministically, clear of older structures and of each other', () => {
    expect(berg).toBeTruthy(); expect(hulk).toBeTruthy();
    const again = new TerrainGenerator(12345);
    expect(nearestIceberg(again, 0, 0, 40).cx).toBe(berg.cx);
    expect(icebergInRegion(gen, Math.floor(berg.cx / 144), Math.floor(berg.cz / 144))).toBeTruthy();
    for (const s of [berg, hulk]) {
      expect(s.y).toBe(SEA_LEVEL);
      expect(claimedByOlder(gen, s.x0 - 6, s.z0 - 6, s.x1 + 6, s.z1 + 6)).toBe(false);
      const col = gen.column(s.cx, s.cz);
      expect(gen.biomeFor(col, gen.surfaceAt(s.cx, s.cz, col))).toBe(BIOME.FROZEN_OCEAN);
      expect(SEA_LEVEL - gen.surfaceAt(s.cx, s.cz, col)).toBeGreaterThanOrEqual(10);
    }
    expect(icebergsNear(gen, berg.cx - 2, berg.cz - 2, berg.cx + 2, berg.cz + 2).map((s) => s.cx)).toContain(berg.cx);
    expect(hulksNear(gen, hulk.cx - 2, hulk.cz - 2, hulk.cx + 2, hulk.cz + 2).map((s) => s.cx)).toContain(hulk.cx);
    for (const seed of [777, 4242, 99]) { const g = new TerrainGenerator(seed); expect(nearestIceberg(g, 0, 0, 40)).toBeTruthy(); }
  });
  it('an iceberg is a tall uneven tower with a hollow: a tunnel, a pool, a dry ledge, a lantern and a chest', () => {
    const s = berg;
    expect(bergRadius(s, 0, 0)).toBeGreaterThan(5);
    expect(bergRadius(s, s.top + 1, 0)).toBe(0);
    expect(bergRadius(s, -s.draft - 1, 0)).toBe(0);
    const radii = new Set(); for (let a = 0; a < 6.28; a += 0.4) radii.add(Math.round(bergRadius(s, 2, a)));
    expect(radii.size).toBeGreaterThan(1); // not a perfect cone
    const at = (u, h, v) => icebergBlock(s, u, h, v);
    expect(at(-1, 2, 0)[0]).toBe(B.AIR);               // the chamber's air pocket
    expect(at(-1, -2, 0)[0]).toBe(B.WATER);            // flooded below the sheet
    expect(at(-5, 0, 0)).toEqual([B.PACKED_ICE, 0]);   // the dry ledge at the back
    expect(at(0, 0, 0)).toEqual([B.WATER, 0]);         // the pool in front
    expect(at(-1, 4, 0)).toEqual([B.TIDE_LANTERN, 0]);
    const chest = at(-4, 1, 0);
    expect(chest[0]).toBe(B.CHEST); expect(chest[1] & 8).toBe(8); expect(chest[1] >> 4).toBe(FROZEN_LOOT.berg);
    const [c] = icebergChests(s), [dx, dz] = toWorld(s.dir, -4, 0);
    expect([c.x, c.y, c.z]).toEqual([s.cx + dx, SEA_LEVEL + 1, s.cz + dz]);
    // the underwater tunnel runs from the chamber out through the wall on the +u side
    for (let u = 0; u <= 8; u++) expect(at(u, -2, 0)[0]).toBe(B.WATER);
    expect(at(-1, 6, 0)[0]).toBe(B.PACKED_ICE);        // solid above the chamber
    let snow = 0, packed = 0; for (let u = -6; u <= 6; u++) for (let v = -6; v <= 6; v++) { const b = at(u, s.top - 1, v); if (b && b[0] === B.SNOW_BLOCK) snow++; const q = at(u, 5, v); if (q && q[0] === B.PACKED_ICE) packed++; }
    expect(snow).toBeGreaterThan(0); expect(packed).toBeGreaterThan(0); // snow on the peak, packed ice below
  });
  it('generating the chunks of an iceberg puts the ice, the hollow and the chest into the world', () => {
    const cx = berg.cx >> 4, cz = berg.cz >> 4;
    let packed = 0, chests = 0, found = null;
    const [c] = icebergChests(berg);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const r = gen.generate(cx + ox, cz + oz);
      for (let i = 0; i < CHUNK_VOLUME; i++) if (r.blocks[i] === B.PACKED_ICE) packed++;
      const px = c.x - (cx + ox) * 16, pz = c.z - (cz + oz) * 16;
      if (px >= 0 && px < 16 && pz >= 0 && pz < 16) { found = r.blocks[cidx(px, c.y, pz)]; if (found === B.CHEST) chests++; }
    }
    expect(packed).toBeGreaterThan(800);
    expect(found).toBe(B.CHEST); expect(chests).toBe(1);
  });
  it('an Icebound Hulk has a stern in the water, a bow in the air, a hatch over the hold and two chests of existing loot tables', () => {
    expect(hulkKeel(-8)).toBeLessThan(hulkKeel(8));
    expect(hulkKeel(-8)).toBeLessThan(0); expect(hulkKeel(8)).toBeGreaterThan(0);
    expect(hulkWidth(0)).toBe(3); expect(hulkWidth(8)).toBe(0);
    const s = hulk;
    expect(HULK_CHESTS.map((c) => c.loot).sort()).toEqual([5, 8]);
    for (const c of HULK_CHESTS) {
      const b = hulkBlock(s, c.u, c.h, c.v);
      expect(b[0]).toBe(B.CHEST); expect(b[1] & 8).toBe(8); expect(b[1] >> 4).toBe(c.loot);
      expect(hulkBlock(s, c.u, c.h + 1, c.v)[0]).toBe(c.h + 1 > 0 ? B.AIR : B.WATER); // above it: air in the cabin, water in the hold
    }
    expect(hulkBlock(s, -3, 0, 0)).toEqual([B.WATER, 0]);           // the hatch in the sheet
    expect(hulkBlock(s, -2, 0, 0)).toEqual([B.ICE, 0]);             // the sheet over the rest of the hold
    expect([B.SPRUCE_PLANKS, B.SPRUCE_LOG]).toContain(hulkBlock(s, 0, hulkKeel(0), 0)[0]); // the keel
    expect(hulkBlock(s, 1, 4, 0)[0]).toBe(B.SPRUCE_LOG);            // the snapped mast
    const spots = hulkChests(s);
    expect(spots).toHaveLength(2);
    expect(spots.map((p) => p.kind).sort()).toEqual([5, 8]);
    // in the generated world
    for (const p of spots) {
      const r = gen.generate(p.x >> 4, p.z >> 4);
      expect(r.blocks[cidx(p.x & 15, p.y, p.z & 15)]).toBe(B.CHEST);
    }
  });
  it('generation is deterministic and the pass changes nothing outside frozen oceans', () => {
    const cx = hulk.cx >> 4, cz = hulk.cz >> 4;
    const a = gen.generate(cx, cz), b = new TerrainGenerator(12345).generate(cx, cz);
    expect(Buffer.from(a.blocks).equals(Buffer.from(b.blocks))).toBe(true);
    expect(Buffer.from(a.biomes).equals(Buffer.from(b.biomes))).toBe(true);
    expect([...a.biomes].some((x) => x === BIOME.FROZEN_DEEP)).toBe(true);
    const land = new TerrainGenerator(12345).generate(0, 0);
    expect(land.biomes.includes(BIOME.FROZEN_DEEP)).toBe(false);
    expect(land.blocks.includes(B.PACKED_ICE)).toBe(false);
  });
});

describe('retrofit: Bounty Boards and the frozen sea', () => {
  it('gives a village generated before the board existed one, only on the untouched cell beside the well', () => {
    const gen = new TerrainGenerator(4242);
    let v = null;
    for (let r = 0; r <= 4 && !v; r++) for (let rx = -r; rx <= r && !v; rx++) for (let rz = -r; rz <= r && !v; rz++) v = villageInRegion(gen, rx, rz);
    const [bx, bz] = boardSpot(v), cx = Math.floor(bx / 16), cz = Math.floor(bz / 16), lx = bx - cx * 16, lz = bz - cz * 16;
    const fresh = gen.generate(cx, cz);
    let by = -1; for (let y = 0; y < 256; y++) if (fresh.blocks[cidx(lx, y, lz)] === B.BOUNTY_BOARD) by = y;
    expect(by).toBeGreaterThan(0);
    const old = legacyChunk(gen, cx, cz);
    expect(old.blocks[cidx(lx, by, lz)]).not.toBe(B.BOUNTY_BOARD);
    const plan = planChunkRetrofit(gen, cx, cz, old, { materialize: true });
    const unit = plan.units.find((u) => u.pass === 'villageBoards');
    expect(unit.status).toBe('apply');
    expect(plan.result.blocks[cidx(lx, by, lz)]).toBe(B.BOUNTY_BOARD);
    // a chunk saved with the board already there has nothing to do
    const kept = legacyChunk(gen, cx, cz, ['villageBoards']);
    expect(planChunkRetrofit(gen, cx, cz, kept).units.find((u) => u.pass === 'villageBoards').status).toBe('present');
    // a block the player put on that cell is never replaced
    const built = legacyChunk(gen, cx, cz); built.blocks[cidx(lx, by, lz)] = B.COBBLESTONE;
    const p2 = planChunkRetrofit(gen, cx, cz, built, { materialize: true });
    expect(p2.units.find((u) => u.pass === 'villageBoards').status).not.toBe('apply');
    expect((p2.result ? p2.result.blocks : built.blocks)[cidx(lx, by, lz)]).toBe(B.COBBLESTONE);
  });
  it('places floes, an iceberg and a hulk into an old frozen chunk, over the ice sheet and the water, and the biome where nobody edited it', () => {
    const gen = new TerrainGenerator(12345);
    for (const s of [nearestIceberg(gen, 0, 0, 40), nearestHulk(gen, 0, 0, 40)]) {
      const cx = s.cx >> 4, cz = s.cz >> 4;
      const old = legacyChunk(gen, cx, cz);
      expect(old.blocks.includes(B.PACKED_ICE)).toBe(false);
      const plan = planChunkRetrofit(gen, cx, cz, old, { materialize: true });
      const kind = s === nearestHulk(gen, 0, 0, 40) ? 'frozenHulk' : 'iceberg';
      const units = plan.units.filter((u) => u.pass === kind);
      expect(units.length).toBeGreaterThan(0);
      expect(units.map((u) => u.status)).toEqual(units.map(() => 'apply'));
      expect(plan.result.blocks.includes(B.CHEST)).toBe(true);
      expect(plan.biomes).toBeGreaterThan(0);
      expect(plan.result.biomes.includes(BIOME.FROZEN_DEEP)).toBe(true);
    }
  });
});

describe('touch and gamepad buttons', () => {
  it('binds the journal and a waypoint to a key and a pad chord that nothing else uses', () => {
    const t = defaultTable();
    expect(t.journal).toEqual(['KeyK', null, 'PadBack+PadX']);
    expect(t.waypoint).toEqual(['KeyN', null, 'PadBack+PadLB']);
    const codes = ACTIONS.flatMap((a) => a.def).filter(Boolean);
    expect(new Set(codes).size).toBe(codes.length);
    expect(resolveBindings({}).waypoint).toEqual(t.waypoint);
    expect(ACTIONS.find((a) => a.id === 'waypoint').group).toBe('Interface');
  });
  it('has Quests and Mark buttons on the touch bar that press those actions, and the game answers the action', () => {
    const touch = src('src/ui/touch.js');
    expect(touch).toMatch(/id: 'journal', label: 'Quests', mode: 'tap', action: 'journal'/);
    expect(touch).toMatch(/id: 'waypoint', label: 'Mark', mode: 'tap', action: 'waypoint'/);
    expect(src('src/game.js')).toMatch(/wasPressed\('waypoint'\)[^\n]*markWaypoint/);
    expect(src('src/ui/style.css')).toMatch(/\.tc-top \{[^}]*flex-wrap: wrap/); // the longer bar wraps on a narrow phone
  });
  it('marking a waypoint alone sets the waymark through /waymark here', () => {
    let set = null;
    const game = { player: { x: 10.5, z: -4.5, waymark: null }, world: { dimension: 'overworld' }, setWaymark(w) { set = w; this.player.waymark = w; } };
    expect(runCommand(game, '/waymark here Mark1')).toMatch(/Waymark set/);
    expect(set).toMatchObject({ x: 10.5, z: -4.5, kind: 'place', label: 'Mark1' });
  });
});

describe("Cartographer's Table", () => {
  it('is crafted from a compass, a paper and four planks, and is a usable block', () => {
    const st = (id) => (id == null ? null : { id, count: 1, damage: 0 });
    expect(craft([I.COMPASS, I.PAPER, null, B.OAK_PLANKS, B.OAK_PLANKS, null, B.OAK_PLANKS, B.OAK_PLANKS, null].map(st), 3)).toEqual({ id: B.CARTOGRAPHERS_TABLE, count: 1 });
    expect(src('src/player/interaction.js')).toMatch(/B\.CARTOGRAPHERS_TABLE\) \{ g\.ui\.openCartographersTable/);
    expect(src('src/player/interaction.js')).toMatch(/USABLE_BLOCKS = new Set\(\[B\.CARTOGRAPHERS_TABLE/);
  });
  it('remembers the loaded chunks near the player, once, and saves them cleaned', () => {
    const e = new Explored();
    const loaded = (cx, cz) => Math.abs(cx) <= 2 && Math.abs(cz) <= 2; // like a render distance of 2
    const n = e.track('overworld', 8, 8, loaded);
    expect(n).toBe(25);
    expect(e.track('overworld', 8, 8, loaded)).toBe(0);
    expect(e.has('overworld', 2, -2)).toBe(true); expect(e.has('overworld', 3, 0)).toBe(false);
    expect(e.has('hollow', 0, 0)).toBe(false);
    e.track('overworld', 200, 8, loaded); // far away: nothing loaded there
    const d = JSON.parse(JSON.stringify(e.save())), f = new Explored();
    f.load({ ...d, evil: 'x', [`${'q'.repeat(30)}`]: [1, 2], hollow: [1.5, 2, 'a', 3, 4, 5, 70000, 0] });
    expect(f.count('overworld')).toBe(25); expect(f.has('overworld', -2, 1)).toBe(true);
    expect(f.has('hollow', 4, 5)).toBe(true); expect(f.count('hollow')).toBe(1); // only the one whole pair that makes sense
    expect(f.has('hollow', 70000, 0)).toBe(false);
    expect(CHART_RADIUS).toBe(3); expect(MAX_CHUNKS).toBeGreaterThan(5000);
    const g = new Explored(); g.load(null); g.load('x'); g.load([1, 2]); expect(g.count('overworld')).toBe(0);
  });
  it('counts the explored chunks of a map square', () => {
    const e = new Explored();
    for (let i = 0; i < 4; i++) e.note('overworld', -4 + i, -4); // chunks -4..-1 along z = -4: inside the square [-64, 63]
    e.note('overworld', 4, 4); // outside it
    expect(e.countIn('overworld', mapOrigin(0), mapOrigin(0))).toBe(4);
    expect(SQUARE_CHUNKS).toBe(8);
  });
  it('takes items across stacks, all or nothing', () => {
    const inv = new Inventory();
    inv.add({ id: I.PAPER, count: 3, damage: 0 }); inv.slots[5] = { id: I.PAPER, count: 2, damage: 0 };
    expect(takeItems(inv, I.PAPER, 6)).toBe(false); expect(inv.count(I.PAPER)).toBe(5);
    expect(takeItems(inv, I.PAPER, 4)).toBe(true); expect(inv.count(I.PAPER)).toBe(1);
  });

  const gen = new TerrainGenerator(4242);
  const plain = (loadedFn) => ({
    dimension: 'overworld', gen,
    getChunk: (cx, cz) => (loadedFn(cx, cz) ? {} : null),
    heightAt: () => 70, getBlock: (x, y) => (y === 70 ? B.GRASS : y < 70 ? B.STONE : 0), biomeAt: () => BIOME.PLAINS,
  });
  it('draws only the explored chunks: loaded ones exactly, left-behind ones from the generator, the rest blank', () => {
    const e = new Explored();
    e.note('overworld', -4, -4); e.note('overworld', -3, -4); e.note('overworld', 0, 0); // x0 = -64: chunks -4.. are columns 0..; chunk (0,0) is pixels 64..79
    const map = newMap(1, 0, 0);
    const world = plain((cx, cz) => cx === -4 && cz === -4); // only the first is still loaded
    const r = drawExplored(map, e, world);
    expect(r.chunks).toBe(3);
    const px = (x, z) => [...map.px.subarray((z * MAP_SIZE + x) * 3, (z * MAP_SIZE + x) * 3 + 3)];
    const filled = (x, z) => px(x, z).some((v) => v > 0);
    expect(filled(0, 0)).toBe(true); expect(filled(15, 15)).toBe(true);   // loaded chunk
    expect(filled(16, 0)).toBe(true); expect(filled(31, 15)).toBe(true); // charted from the generator
    expect(filled(64, 64)).toBe(true); expect(filled(79, 79)).toBe(true);
    expect(filled(32, 0)).toBe(false); expect(filled(100, 100)).toBe(false); expect(filled(63, 63)).toBe(false); // never visited
    expect(map.filled).toBe(3 * 256);
    // a chunk that is neither explored nor loaded stays blank even in generator terrain
    expect(filled(48, 48)).toBe(false);
  });
  it('marks the structures standing in explored chunks only', () => {
    const e = new Explored();
    const village = (() => { for (let r = 0; r <= 4; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) { const v = villageInRegion(gen, rx, rz); if (v) return v; } })();
    const map = newMap(2, village.cx, village.cz);
    const ours = (m) => (m.marks || []).filter((k) => k.kind === 'village');
    drawExplored(map, e, plain(() => false));
    expect(ours(map)).toHaveLength(0);
    e.note('overworld', village.cx >> 4, village.cz >> 4);
    drawExplored(map, e, plain(() => false));
    expect(ours(map).length).toBeGreaterThan(0);
  });

  function fakeGame({ paper = 2, compass = 1, creative = false } = {}) {
    const inv = new Inventory();
    if (paper) inv.add({ id: I.PAPER, count: paper, damage: 0 });
    if (compass) inv.add({ id: I.COMPASS, count: compass, damage: 0 });
    const dropped = [];
    const world = plain((cx, cz) => Math.abs(cx) <= 2 && Math.abs(cz) <= 2);
    const g = { player: { inventory: inv, x: 8, y: 71, z: 8, creative }, world, explored: new Explored(), maps: new Map(), entities: { spawnItem: (...a) => dropped.push(a) }, audio: { play() {} }, dropped };
    return g;
  }
  it('the table offers a survey only with Paper, a Compass and explored ground, and keeps the Compass', () => {
    const g = fakeGame({ paper: 0 });
    expect(tableOffers(g, 8, 8).survey).toMatch(/Paper/);
    const h = fakeGame({ compass: 0 }); h.explored.track('overworld', 8, 8, () => true);
    expect(tableOffers(h, 8, 8).survey).toMatch(/Compass/);
    const k = fakeGame();
    expect(tableOffers(k, 8, 8).survey).toMatch(/not explored/);
    k.explored.track('overworld', 8, 8, (cx, cz) => Math.abs(cx) <= 2 && Math.abs(cz) <= 2);
    expect(tableOffers(k, 8, 8).survey).toBe(null);
    expect(tableOffers(k, 8, 8).chunks).toBe(25);
    const r = surveyAtTable(k, 8, 8);
    expect(r.ok).toBe(true); expect(r.chunks).toBe(25);
    expect(k.player.inventory.count(I.PAPER)).toBe(1); expect(k.player.inventory.count(I.COMPASS)).toBe(1);
    const stack = k.player.inventory.slots.find((s) => s && s.id === I.FILLED_MAP);
    expect(stack).toBeTruthy();
    const map = k.maps.get(stack.map);
    expect(map.x0).toBe(mapOrigin(8)); expect(map.filled).toBe(25 * 256);
    expect(stack.mapX).toBe(Math.floor(map.x0 / 128));
    expect(surveyAtTable(fakeGame(), 8, 8).ok).toBe(false);
  });
  it('copies the held map for a Paper into the same picture', () => {
    const k = fakeGame({ paper: 3 });
    k.explored.track('overworld', 8, 8, () => true);
    expect(copyHeldMap(k, 8, 8).ok).toBe(false); // nothing in hand
    surveyAtTable(k, 8, 8);
    const slot = k.player.inventory.slots.findIndex((s) => s && s.id === I.FILLED_MAP);
    k.player.inventory.selected = slot;
    const before = k.player.inventory.count(I.PAPER);
    const r = copyHeldMap(k, 8, 8);
    expect(r.ok).toBe(true);
    expect(k.player.inventory.count(I.PAPER)).toBe(before - 1);
    const maps = k.player.inventory.slots.filter((s) => s && s.id === I.FILLED_MAP);
    expect(maps).toHaveLength(2); expect(maps[0].map).toBe(maps[1].map);
    expect(k.maps.size).toBe(1);
    // no paper, no copy
    const none = fakeGame({ paper: 0 }); none.player.inventory.slots[0] = { id: I.FILLED_MAP, count: 1, damage: 0, map: 5 }; none.player.inventory.selected = 0;
    expect(copyHeldMap(none, 8, 8).ok).toBe(false);
  });
  it('creative players need neither Paper nor Compass; the explored set is part of the save', () => {
    const k = fakeGame({ paper: 0, compass: 0, creative: true });
    k.explored.track('overworld', 8, 8, () => true);
    expect(surveyAtTable(k, 8, 8).ok).toBe(true);
    const save = src('src/world/save.js');
    expect(save).toMatch(/explored: game\.explored \? game\.explored\.save\(\)/);
    expect(save).toMatch(/game\.explored\.load\(data\.explored\)/);
    expect(src('src/game.js')).toMatch(/this\.explored\.track\(/);
  });
});
