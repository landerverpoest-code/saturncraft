// Dimension expansion: the Cinderdeep's three sub-biomes (Glowcap Thicket, Slagfall Delta, Dirgevale) with their
// floors, ores, trees, fog, soundscapes, spawn tables and mobs (Capwalker, Dirge Wailer), the Cinderforge
// (world/siteKit.js structure with /locate and landmark integration), three new craftables (Slagsteel Pickaxe, Dirgestep
// Boots, Spore Lantern) and the Hollow's Wyrm Ribs.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { B, BLOCKS, EXT_BASE } from '../src/world/blocks.js';
import { I, ITEMS, MATERIALS, ARMOR_MATERIALS } from '../src/world/items.js';
import { cidx } from '../src/world/constants.js';
import { CinderdeepGenerator, CINDER_LAVA } from '../src/world/dimensions/cinderdeep.js';
import { SUB, SUB_BIOMES, SUB_BY_KEY, pickSub, subFloor, growGlowcap } from '../src/world/dimensions/cinderBiomes.js';
import { forgeInRegion, forgesNear, nearestForge, inForge, stampForges, forgeParts, FORGE_REGION, FORGE_HALF, FORGE_CHESTS, FORGE_LOOT, CINDER_BRUTE_SPAWNER_META } from '../src/world/dimensions/cinderForge.js';
import { HollowGenerator } from '../src/world/dimensions/hollow.js';
import { wyrmRibsNear, nearestWyrmRibs, RIBS_LOOT, RIB_U } from '../src/world/dimensions/wyrmRibs.js';
import { toWorld } from '../src/world/siteKit.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { landmarksInBox, nearestLandmark } from '../src/world/landmarks.js';
import { LANDMARK_KINDS, LANDMARK_BY_KEY } from '../src/world/landmarkKinds.js';
import '../src/mobs/dimensionMobs.js';
import '../src/mobs/cinderMobs.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { DIM_SPAWN_TABLES, DIMENSION_MOBS } from '../src/mobs/dimensionMobs.js';
import { CAPWALKER, DIRGE_WAILER, WAIL_DAMAGE, WAIL_WINDUP, CAPWALKER_GRUDGE } from '../src/mobs/cinderMobs.js';
import { SPAWNER_TYPES, LOOT } from '../src/mobs/spawnerBlocks.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { pickSoundscape, emptyFacts, SOUNDSCAPES, bedFor, AmbientDirector, CINDER_SCAPES } from '../src/audio/ambience.js';
import { CAPTION_TEXT } from '../src/ui/accessibility.js';
import { DIM_TEX } from '../src/world/dimensions/dimTextures.js';
import { RECIPES, SMELTING, craft } from '../src/player/crafting.js';
import { repairMaterial, enchantability } from '../src/world/enchantments.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { MILESTONES } from '../src/player/milestones.js';
import { Body } from '../src/physics/body.js';
import { PHYS } from '../src/physics/constants.js';
import { MockWorld } from './helpers.js';
import '../src/world/dimensions/register.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const NEW_BLOCKS = ['SPORE_LOAM', 'GLOWCAP_STALK', 'GLOWCAP_CAP', 'SLAGSTONE', 'SLAG_ORE', 'DIRGE_STONE', 'DIRGE_CRYSTAL_ORE', 'WRAITHBONE', 'SPORE_LANTERN', 'WYRMBONE'];
const NEW_BLOCK_IDS = new Set(NEW_BLOCKS.map((k) => B[k]));

describe('append-only ids', () => {
  it('the new blocks follow the Starfall Core in order, inside the extended range', () => {
    NEW_BLOCKS.forEach((k, i) => expect(B[k]).toBe(B.STARFALL_CORE + 1 + i));
    for (const k of NEW_BLOCKS) { expect(B[k]).toBeGreaterThanOrEqual(EXT_BASE); expect(BLOCKS[B[k]].name.length).toBeGreaterThan(3); }
  });

  it('the new items follow the Sporehall Chart and keep clear of the extended block ids', () => {
    const keys = ['GLOWCAP_SPORES', 'SLAG_CHUNK', 'SLAGSTEEL_INGOT', 'DIRGE_CRYSTAL', 'SLAGSTEEL_PICKAXE', 'DIRGESTEP_BOOTS'];
    const chart = ITEMS.find((d) => d && d.key === 'chart_sporehall').id;
    keys.forEach((k, i) => expect(I[k]).toBe(chart + 1 + i));
    expect(I.DIRGESTEP_BOOTS).toBeLessThan(EXT_BASE);
  });

  it('every new block has a texture painter', () => {
    for (const k of NEW_BLOCKS) {
      const t = BLOCKS[B[k]].tex;
      for (const face of [t.top, t.bottom, t.side]) expect(typeof DIM_TEX[face], `${k}: ${face}`).toBe('function');
    }
  });
});

describe('sub-biome layout', () => {
  const gen = new CinderdeepGenerator(2024);

  it('is a pure function of the seed with the four biome kinds all present and the plain Cinderdeep still the largest', () => {
    const count = [0, 0, 0, 0];
    for (let x = -2400; x < 2400; x += 24) for (let z = -2400; z < 2400; z += 24) count[gen.subBiomeAt(x, z)]++;
    const total = count.reduce((a, b) => a + b, 0);
    for (let s = 1; s <= 3; s++) expect(count[s] / total, SUB_BIOMES[s].key).toBeGreaterThan(0.05);
    expect(count[0]).toBeGreaterThan(count[1]);
    expect(count[0]).toBeGreaterThan(count[2]);
    expect(new CinderdeepGenerator(2024).subBiomeAt(100, -300)).toBe(gen.subBiomeAt(100, -300));
    expect(new CinderdeepGenerator(2025).subBiomeAt(100, -300) === gen.subBiomeAt(100, -300) && new CinderdeepGenerator(2026).subBiomeAt(500, 70) === gen.subBiomeAt(500, 70) && new CinderdeepGenerator(2027).subBiomeAt(-900, 40) === gen.subBiomeAt(-900, 40)).toBe(false);
  });

  it('picks by noise value and gives each biome its own fog, soundscape, spawn table and floor', () => {
    expect(pickSub(0.9, 0)).toBe(SUB.THICKET);
    expect(pickSub(-0.9, 0.9)).toBe(SUB.DELTA);
    expect(pickSub(0, 0.9)).toBe(SUB.VALE);
    expect(pickSub(0, 0)).toBe(SUB.NONE);
    const fogs = new Set(Object.values(SUB_BIOMES).map((s) => s.fog.join()));
    expect(fogs.size).toBe(4);
    expect(new Set(Object.values(SUB_BIOMES).map((s) => s.soundscape)).size).toBe(4);
    expect(new Set(Object.values(SUB_BIOMES).map((s) => s.table)).size).toBe(4);
    expect(subFloor(SUB.THICKET, 0)).toBe(B.SPORE_LOAM);
    expect(subFloor(SUB.DELTA, 0)).toBe(B.SLAGSTONE);
    expect(subFloor(SUB.VALE, 0.5)).toBe(B.DIRGE_STONE);
    expect(subFloor(SUB.VALE, -0.5)).toBe(B.MOURNSAND);
    expect(subFloor(SUB.NONE, 0)).toBe(0);
    expect(SUB_BY_KEY.thicket).toBe(SUB.THICKET);
  });

  /** Chunks around a point that lies deep in the given sub-biome. */
  function findSub(s) {
    for (let x = -3000; x < 3000; x += 48) for (let z = -3000; z < 3000; z += 48) {
      let ok = true;
      for (const [dx, dz] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20]]) if (gen.subBiomeAt(x + dx, z + dz) !== s) ok = false;
      if (ok) return [Math.floor(x / 16), Math.floor(z / 16)];
    }
    return null;
  }

  it('lays each biome\'s floor, ores and features, and only there', () => {
    const want = {
      [SUB.THICKET]: [B.SPORE_LOAM, B.GLOWCAP_STALK, B.GLOWCAP_CAP],
      [SUB.DELTA]: [B.SLAGSTONE, B.SLAG_ORE],
      [SUB.VALE]: [B.DIRGE_STONE, B.DIRGE_CRYSTAL_ORE, B.WRAITHBONE],
    };
    for (const s of [SUB.THICKET, SUB.DELTA, SUB.VALE]) {
      const at = findSub(s);
      expect(at, SUB_BIOMES[s].key).toBeTruthy();
      const seen = new Set();
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const c = gen.generate(at[0] + dx, at[1] + dz);
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
          if (gen.subBiomeAt((at[0] + dx) * 16 + x, (at[1] + dz) * 16 + z) !== s) continue;
          for (let y = 0; y < 128; y++) { const id = c.blocks[cidx(x, y, z)]; if (NEW_BLOCK_IDS.has(id)) seen.add(id); }
        }
      }
      for (const id of want[s]) expect(seen.has(id), `${SUB_BIOMES[s].key}: ${BLOCKS[id].name}`).toBe(true);
    }
  });

  it('leaves the plain Cinderdeep exactly as it was away from the sub-biomes', () => {
    const legacy = new CinderdeepGenerator(2024);
    legacy.subBiomeAt = () => 0;
    let compared = 0;
    for (let cx = -60; cx < 60 && compared < 30; cx++) for (let cz = -60; cz < 60 && compared < 30; cz++) {
      const x0 = cx * 16, z0 = cz * 16;
      let clear = true;
      for (let dx = -10; dx <= 25 && clear; dx += 5) for (let dz = -10; dz <= 25; dz += 5) if (gen.subBiomeAt(x0 + dx, z0 + dz) !== 0) { clear = false; break; }
      if (!clear || forgesNear(gen, x0 - 20, z0 - 20, x0 + 36, z0 + 36).length) continue;
      const a = gen.generate(cx, cz), b = legacy.generate(cx, cz);
      expect(Buffer.from(a.blocks.buffer).equals(Buffer.from(b.blocks.buffer)), `chunk ${cx},${cz}`).toBe(true);
      expect(Buffer.from(a.meta.buffer).equals(Buffer.from(b.meta.buffer))).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
  });

  it('generates in about the time it did (the sub-biome pass is a few noise lookups and short scans)', () => {
    const t = (g) => { const t0 = performance.now(); for (let cx = 0; cx < 14; cx++) for (let cz = 0; cz < 14; cz++) g.generate(cx, cz); return performance.now() - t0; };
    const legacy = new CinderdeepGenerator(55);
    legacy.subBiomeAt = () => 0;
    const full = new CinderdeepGenerator(55);
    t(legacy); t(full); // warm up
    const a = Math.min(t(legacy), t(legacy)), b = Math.min(t(full), t(full));
    expect(b).toBeLessThan(a * 1.6 + 30);
  });

  it('grows a Glowcap tree: a pale stalk, a skirt, a dome and a crown of caps, only into air', () => {
    const blocks = new Uint16Array(16 * 16 * 128 * 4);
    const get = (x, y, z) => blocks[cidx(x, y, z)];
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) blocks[cidx(x, 40, z)] = B.SPORE_LOAM;
    blocks[cidx(8, 45, 8)] = B.CINDERSTONE; // the stalk's neighbour in its way stays
    const n = growGlowcap(blocks, 8, 40, 8, 6);
    expect(n).toBeGreaterThan(30);
    for (let y = 41; y <= 44; y++) expect(get(8, y, 8)).toBe(B.GLOWCAP_STALK);
    expect(get(8, 45, 8)).toBe(B.CINDERSTONE);
    expect(get(8, 47, 8)).toBe(B.GLOWCAP_CAP);
    expect(get(11, 47, 10)).toBe(0);                // the dome is a disc, not a square
    expect(get(11, 47, 9)).toBe(B.GLOWCAP_CAP);
  });
});

describe('ores, resources and gear', () => {
  it('Slag Ore, Dirge Crystal Ore and Glowcap Caps drop their resources', () => {
    expect(BLOCKS[B.SLAG_ORE].drops).toMatchObject({ item: 'SLAG_CHUNK' });
    expect(BLOCKS[B.DIRGE_CRYSTAL_ORE].drops).toMatchObject({ item: 'DIRGE_CRYSTAL' });
    expect(BLOCKS[B.GLOWCAP_CAP].drops).toMatchObject({ item: 'GLOWCAP_SPORES' });
    expect(BLOCKS[B.GLOWCAP_CAP].emit).toBeGreaterThanOrEqual(10);
    expect(BLOCKS[B.SPORE_LANTERN].emit).toBe(15);
    for (const k of ['SLAG_CHUNK', 'DIRGE_CRYSTAL', 'GLOWCAP_SPORES']) expect(I[k]).toBeTruthy();
  });

  it('smelts Slag Chunks (and the ore itself) into Slagsteel Ingots', () => {
    expect(SMELTING[I.SLAG_CHUNK]).toBe(I.SLAGSTEEL_INGOT);
    expect(SMELTING[B.SLAG_ORE]).toBe(I.SLAGSTEEL_INGOT);
  });

  it('crafts the Slagsteel Pickaxe, Dirgestep Boots and Spore Lanterns', () => {
    const pick = craft([{ id: I.SLAGSTEEL_INGOT, count: 1 }, { id: I.SLAGSTEEL_INGOT, count: 1 }, { id: I.SLAGSTEEL_INGOT, count: 1 }, null, { id: I.STICK, count: 1 }, null, null, { id: I.STICK, count: 1 }, null], 3);
    expect(pick && pick.id).toBe(I.SLAGSTEEL_PICKAXE);
    const c = { id: I.DIRGE_CRYSTAL, count: 1 };
    const boots = craft([c, null, c, c, null, c], 3);
    expect(boots && boots.id).toBe(I.DIRGESTEP_BOOTS);
    const s = { id: I.GLOWCAP_SPORES, count: 1 };
    const lamp = craft([s, s, s, s, { id: I.EMBER_ROD, count: 1 }, s, s, s, s], 3);
    expect(lamp && lamp.id).toBe(B.SPORE_LANTERN);
    expect(lamp.count).toBe(2);
    const bone = craft([{ id: I.BONE, count: 1 }, { id: I.BONE, count: 1 }, { id: I.BONE, count: 1 }, { id: I.BONE, count: 1 }], 2);
    expect(bone && bone.id).toBe(B.WYRMBONE);
    expect(RECIPES.filter((r) => r.result === I.SLAGSTEEL_PICKAXE)).toHaveLength(1);
  });

  it('the pickaxe is a little better than iron and the boots protect like diamond ones', () => {
    const pick = ITEMS[I.SLAGSTEEL_PICKAXE];
    expect(pick.tool.material).toBe('slagsteel');
    expect(MATERIALS.slagsteel.speed).toBeGreaterThan(MATERIALS.iron.speed);
    expect(pick.durability).toBeGreaterThan(ITEMS[I.IRON_PICKAXE].durability);
    expect(pick.tool.tier).toBe(ITEMS[I.IRON_PICKAXE].tool.tier);
    const boots = ITEMS[I.DIRGESTEP_BOOTS];
    expect(boots.armor.piece).toBe('boots');
    expect(boots.armor.slot).toBe(3);
    expect(boots.armor.defense).toBe(ITEMS[I.DIAMOND_BOOTS].armor.defense);
    expect(ARMOR_MATERIALS.dirge.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('mend at the anvil with their own material and can be enchanted', () => {
    expect(repairMaterial(I.SLAGSTEEL_PICKAXE)).toBe(I.SLAGSTEEL_INGOT);
    expect(repairMaterial(I.DIRGESTEP_BOOTS)).toBe(I.DIRGE_CRYSTAL);
    expect(enchantability(I.SLAGSTEEL_PICKAXE)).toBeGreaterThan(0);
    expect(enchantability(I.DIRGESTEP_BOOTS)).toBeGreaterThan(0);
  });

  it('Dirgestep Boots keep the wearer nearly at speed on Mournsand', () => {
    const run = (treadDeep, floor = B.MOURNSAND) => {
      const w = new MockWorld();
      for (let x = -4; x <= 4; x++) for (let z = -120; z <= 4; z++) w.set(x, 63, z, floor);
      const b = new Body(PHYS.PLAYER_WIDTH, PHYS.PLAYER_HEIGHT);
      b.setPos(0.5, 64, 0.5);
      for (let i = 0; i < 5; i++) b.travel(w, {});
      const z0 = b.z;
      for (let i = 0; i < 60; i++) b.travel(w, { yaw: 0, forward: 1, speed: PHYS.WALK_SPEED, treadDeep });
      return z0 - b.z;
    };
    const slow = run(false), booted = run(true), plain = run(false, B.STONE);
    expect(slow).toBeGreaterThan(0);
    expect(booted).toBeGreaterThan(slow * 1.3);
    expect(booted).toBeGreaterThan(plain * 0.7);
    const player = src('src/player/player.js');
    expect(player).toMatch(/treadDeep:[^\n]*dirgestep/);
  });
});

describe('the Capwalker and the Dirge Wailer', () => {
  it('are registered with original names, model, face, voice and drops', () => {
    for (const [k, d] of [['capwalker', CAPWALKER], ['dirge_wailer', DIRGE_WAILER]]) {
      expect(MOBS[k]).toBe(d);
      expect(MODELS[k] && MODELS[k].parts.length).toBeGreaterThan(4);
      expect(typeof FACES[k]).toBe('function');
      expect(d.drops.length).toBeGreaterThan(0);
      expect(CAPTION_TEXT[d.sound]).toBeTruthy();
      expect(src('src/audio/audio.js')).toContain(`case '${d.sound}':`);
    }
    expect(CAPWALKER.neutral).toBe(true);
    expect(DIRGE_WAILER.flying).toBe(true);
    expect(CAPWALKER.drops[0].id).toBe(I.GLOWCAP_SPORES);
    expect(DIRGE_WAILER.drops.map((d) => d.id)).toContain(I.DIRGE_CRYSTAL);
    for (const m of Object.values(MODELS.dirge_wailer.parts.concat(MODELS.capwalker.parts))) expect(m[1].length).toBe(3);
  });

  it('are in the spawn tables of their sub-biomes and the Field Guide shows where', () => {
    for (const s of [SUB.THICKET, SUB.DELTA, SUB.VALE]) {
      const table = DIM_SPAWN_TABLES[SUB_BIOMES[s].table];
      expect(table && table.length, SUB_BIOMES[s].key).toBeGreaterThan(1);
      for (const e of table) expect(MOBS[e.type] || DIMENSION_MOBS[e.type], e.type).toBeTruthy();
    }
    expect(DIM_SPAWN_TABLES.cinderThicket[0].type).toBe('capwalker');
    expect(DIM_SPAWN_TABLES.cinderVale[0].type).toBe('dirge_wailer');
    expect(DIM_SPAWN_TABLES.cinderForge.every((e) => MOBS[e.type])).toBe(true);
    resetGuideEntries();
    const by = (k) => entriesOf('creatures').find((e) => e.key === k);
    expect(by('capwalker').habitat.join(' ')).toMatch(/Glowcap Thickets/);
    expect(by('capwalker').traits).toContain('Neutral until provoked');
    expect(by('dirge_wailer').habitat.join(' ')).toMatch(/Dirgevale/);
    expect(by('dirge_wailer').drops).toContain(I.DIRGE_CRYSTAL);
  });

  it('a hurt Capwalker holds a grudge and rallies the kin within 12 blocks', () => {
    const kin = { type: 'capwalker', x: 5, z: 0, dead: false, provoked: 0 }, far = { type: 'capwalker', x: 40, z: 0, dead: false, provoked: 0 };
    const m = { type: 'capwalker', x: 0, z: 0, provoked: 0, _game: { entities: { list: [kin, far] }, audio: { play() {} } } };
    expect(CAPWALKER.onHurt(m, 3, 'player', { isPlayer: true })).toBe(3);
    expect(m.provoked).toBe(CAPWALKER_GRUDGE);
    expect(kin.provoked).toBeGreaterThan(0);
    expect(far.provoked).toBe(0);
    const calm = { type: 'capwalker', x: 0, z: 0, provoked: 0, _game: m._game };
    CAPWALKER.onHurt(calm, 1, 'lava', null); // burning in lava is not a provocation by anybody
    expect(calm.provoked).toBe(0);
  });

  it('a calm Capwalker only wanders; a provoked one chases and bites, and the grudge runs out', () => {
    const calls = [];
    const g = { ticks: 1, particles: { emit() {} }, audio: { play() {} } };
    const p = { dead: false, creative: false, x: 3, y: 0, z: 0 };
    const m = { id: 1, x: 0, y: 0, z: 0, provoked: 0, angry: false, wanderAI: () => calls.push('wander'), chase: () => calls.push('chase'), tryMelee: () => calls.push('bite') };
    CAPWALKER.customAI(m, g, p, 3);
    expect(calls).toEqual(['wander']);
    expect(m.angry).toBe(false);
    m.provoked = 2;
    calls.length = 0;
    CAPWALKER.customAI(m, g, p, 3);
    expect(calls).toEqual(['chase', 'bite']);
    expect(m.angry).toBe(true);
    CAPWALKER.customAI(m, g, p, 3);
    calls.length = 0;
    CAPWALKER.customAI(m, g, p, 3);
    expect(calls).toEqual(['wander']);
    expect(CAPWALKER.hitEffect[0]).toBe('poison');
  });

  it('a Dirge Wailer winds up and then wails: damage and slowness to a player it sees within 7 blocks', () => {
    const hits = [], fx = [];
    const p = { dead: false, creative: false, x: 5, y: 0, z: 0, eyeHeight: 1.6, hurt: (d, s) => { hits.push([d, s]); return true; }, addEffect: (t, ticks, amp) => fx.push([t, ticks, amp]) };
    const g = { ticks: 1, particles: { emit() {} }, audio: { play() {} } };
    const mk = () => ({ id: 2, x: 0, y: 0, z: 0, yaw: 0, charge: 30 + WAIL_WINDUP - 1, body: { vx: 0, vy: 0, vz: 0 }, acquire: () => true, canSee: () => true });
    const m = mk();
    DIRGE_WAILER.customAI(m, g, p, 5);
    expect(hits).toEqual([[WAIL_DAMAGE, 'mob:Dirge Wailer']]);
    expect(fx[0][0]).toBe('slowness');
    expect(m.charge).toBeLessThan(0);
    // out of range or out of sight: no harm
    hits.length = 0;
    const far = mk();
    p.x = 20;
    DIRGE_WAILER.customAI(far, g, p, 20);
    const hidden = mk();
    hidden.canSee = () => false; p.x = 5;
    DIRGE_WAILER.customAI(hidden, g, p, 5);
    expect(hits).toEqual([]);
    // rearing up before the wail
    const rear = mk(); rear.charge = 35;
    DIRGE_WAILER.customAI(rear, g, p, 5);
    expect(rear.angry).toBe(true);
  });
});

describe('soundscapes, captions and fog', () => {
  it('each sub-biome has its own soundscape with beds and events that audio.js can play and captions cover', () => {
    const audio = src('src/audio/audio.js');
    for (const s of [SUB.THICKET, SUB.DELTA, SUB.VALE]) {
      const key = SUB_BIOMES[s].soundscape;
      expect(CINDER_SCAPES[SUB_BIOMES[s].key]).toBe(key);
      const scape = SOUNDSCAPES[key];
      expect(scape, key).toBeTruthy();
      expect(scape.music).toBe(null);
      expect(Object.keys(bedFor(key, false)).length).toBeGreaterThan(0);
      expect(scape.events.length).toBeGreaterThan(1);
      for (const e of scape.events) {
        expect(audio, e.sound).toContain(`case '${e.sound}':`);
        expect(CAPTION_TEXT[e.sound], e.sound).toBeTruthy();
      }
    }
    expect(SOUNDSCAPES.cinder_thicket.events.map((e) => e.sound)).toContain('spore_puff');
    expect(SOUNDSCAPES.cinder_delta.events.map((e) => e.sound)).toContain('ash_hiss');
    expect(SOUNDSCAPES.cinder_vale.events.map((e) => e.sound)).toContain('dirge_wail');
  });

  it('picks them from the sub-biome under the player, the old Cinderdeep scape elsewhere', () => {
    const f = { ...emptyFacts(), dimension: 'cinderdeep' };
    expect(pickSoundscape(f)).toBe('cinderdeep');
    for (const k of ['thicket', 'delta', 'vale']) expect(pickSoundscape({ ...f, cinderBiome: k })).toBe(`cinder_${k}`);
    expect(pickSoundscape({ ...f, cinderBiome: 'cinders' })).toBe('cinderdeep');
    expect(pickSoundscape({ ...emptyFacts(), cinderBiome: 'delta' })).not.toBe('cinder_delta'); // (only in the Cinderdeep)
    const d = new AmbientDirector(() => 0.5);
    const out = []; for (let t = 0; t < 40; t++) out.push(...d.tick(1, 'cinder_vale', false));
    expect(out.some((e) => e.sound === 'dirge_wail')).toBe(true);
  });

  it('every sub-biome has a visibly different fog and hazes close in as designed', () => {
    for (const s of Object.values(SUB_BIOMES)) {
      expect(s.fog.every((v) => v >= 0 && v <= 1)).toBe(true);
      expect(s.fogNear).toBeLessThan(s.fogFar);
    }
    expect(SUB_BIOMES[SUB.THICKET].fog[1]).toBeGreaterThan(SUB_BIOMES[SUB.THICKET].fog[0]); // greener
    expect(SUB_BIOMES[SUB.VALE].fog[2]).toBeGreaterThan(SUB_BIOMES[SUB.VALE].fog[0]);       // bluer
    expect(SUB_BIOMES[SUB.NONE].fog[0]).toBeGreaterThan(SUB_BIOMES[SUB.NONE].fog[2]);       // the old red haze
  });
});

describe('the Cinderforge', () => {
  const gen = new CinderdeepGenerator(31337);
  let forge = null;
  for (let rx = -4; rx < 4 && !forge; rx++) for (let rz = -4; rz < 4 && !forge; rz++) forge = forgeInRegion(gen, rx, rz);

  /** A getter over the chunks around a forge. */
  function worldAround(f) {
    const chunks = new Map();
    for (let cx = Math.floor((f.x0 - 1) / 16); cx <= Math.floor((f.x1 + 1) / 16); cx++) for (let cz = Math.floor((f.z0 - 1) / 16); cz <= Math.floor((f.z1 + 1) / 16); cz++) chunks.set(`${cx},${cz}`, gen.generate(cx, cz));
    const get = (x, y, z, what = 'blocks') => { const c = chunks.get(`${x >> 4},${z >> 4}`); return c ? c[what][cidx(x & 15, y, z & 15)] : -1; };
    return { get };
  }

  it('is planned from the seed alone, one in about every second region, away from bastions', () => {
    expect(forge).toBeTruthy();
    expect(forgeInRegion(new CinderdeepGenerator(31337), Math.floor(forge.cx / FORGE_REGION), Math.floor(forge.cz / FORGE_REGION))).toEqual(forge);
    let n = 0, total = 0;
    for (let rx = -10; rx < 10; rx++) for (let rz = -10; rz < 10; rz++) { total++; if (forgeInRegion(gen, rx, rz)) n++; }
    expect(n / total).toBeGreaterThan(0.3);
    expect(n / total).toBeLessThan(0.75);
    expect(forge.y).toBeGreaterThan(CINDER_LAVA + 10);
    expect(forge.y).toBeLessThan(90);
    expect(forgesNear(gen, forge.cx, forge.cz, forge.cx, forge.cz)[0]).toEqual(forge);
    expect(nearestForge(gen, forge.cx + 40, forge.cz - 40).cx).toBe(forge.cx);
    expect(inForge(gen, forge.cx, forge.y + 2, forge.cz)).toBe(true);
    expect(inForge(gen, forge.cx + 60, forge.y, forge.cz)).toBe(false);
    expect(gen.zoneAt(forge.cx, forge.y + 2, forge.cz)).toBe('cinderForge');
  });

  it('stamps a walled courtyard: lava pit, gate, towers, furnaces, spawner and two loot chests', () => {
    const w = worldAround(forge), y = forge.y;
    const at = (u, v, dy = 0, what = 'blocks') => { const [dx, dz] = toWorld(forge.dir, u, v); return w.get(forge.cx + dx, y + dy, forge.cz + dz, what); };
    expect(at(0, 0)).toBe(B.LAVA);                                 // the pit
    expect(at(0, 0, -1)).toBe(B.SCORCHED_BRICKS);                  // its floor
    expect(at(0, 0, 1)).toBe(B.AIR);
    expect(at(5, 0)).toBe(B.SCORCHED_BRICKS);                      // the courtyard floor
    expect(at(3, 1, 1)).toBe(B.SCORCHED_BRICKS);                   // the pit's low rim
    expect(at(FORGE_HALF, 5, 1)).toBe(B.SCORCHED_BRICKS);          // the wall
    expect(at(0, FORGE_HALF, 1)).toBe(B.AIR);                      // the gate
    expect(at(0, FORGE_HALF, 4)).toBe(B.SCORCHED_BRICKS);          // its lintel
    expect(at(0, 18)).toBe(B.SCORCHED_BRICKS);                     // the causeway
    expect(at(FORGE_HALF, FORGE_HALF, 9)).toBe(B.GLOWSHARD);       // a corner tower's beacon
    expect(at(4, -11, 1)).toBe(B.FURNACE_LIT);
    expect(at(6, 5, 1)).toBe(B.ANVIL);
    expect(at(10, 10, 1)).toBe(B.SLAG_ORE);
    expect(at(0, -9, 1)).toBe(B.SPAWNER);
    expect(at(0, -9, 1, 'meta')).toBe(CINDER_BRUTE_SPAWNER_META);
    for (const c of FORGE_CHESTS) {
      expect(at(c.u, c.v, 1)).toBe(B.CHEST);
      expect((at(c.u, c.v, 1, 'meta') >> 4) & 15).toBe(FORGE_LOOT[c.kind]);
      expect(at(c.u, c.v, 1, 'meta') & 8).toBe(8);
    }
    const parts = forgeParts(forge);
    expect(parts.filter((p) => p.what === 'chest')).toHaveLength(2);
    expect(w.get(parts[0].x, parts[0].y, parts[0].z)).toBe(B.SPAWNER);
  });

  it('is the same whichever way the chunks are cut, and stands on pillars', () => {
    const [dx, dz] = toWorld(forge.dir, 6, 6);
    const px = forge.cx + dx, pz = forge.cz + dz; // a pillar column (u, v multiples of six)
    const chunk = gen.generate(px >> 4, pz >> 4);
    let below = 0;
    for (let y = forge.y - 2; y > forge.y - 14; y--) if (chunk.blocks[cidx(px & 15, y, pz & 15)] === B.SCORCHED_BRICKS) below++;
    expect(below).toBeGreaterThan(4);
    const a = new Uint16Array(65536 * 8), m = new Uint8Array(65536 * 8);
    stampForges(gen, a, m, Math.floor(forge.cx / 16), Math.floor(forge.cz / 16)); // stamping on its own matches generation inside the forge
    expect(a.some((v) => v === B.LAVA)).toBe(true);
  });

  it('spawns Cinder Brutes from its spawner: the type list and the stamped meta agree', () => {
    expect(SPAWNER_TYPES[CINDER_BRUTE_SPAWNER_META]).toBe('cinder_brute');
    expect(SPAWNER_TYPES[3]).toBe('ember_lord');
  });

  it('reuses chest loot tables that exist (all sixteen kinds are taken)', () => {
    const kinds = new Set(Object.values(LOOT));
    for (const k of Object.values(FORGE_LOOT)) expect(kinds.has(k)).toBe(true);
    expect(kinds.has(RIBS_LOOT)).toBe(true);
  });

  it('is a landmark: found by the landmark finders of the Cinderdeep, never in the overworld', () => {
    expect(LANDMARK_BY_KEY.cinderforge.dim).toBe('cinderdeep');
    expect(LANDMARK_BY_KEY.wyrmribs.dim).toBe('hollow');
    expect(LANDMARK_KINDS.filter((k) => !k.dim).length).toBeGreaterThanOrEqual(12);
    expect(landmarksInBox(gen, forge.cx - 5, forge.cz - 5, forge.cx + 5, forge.cz + 5)).toContainEqual({ kind: 'cinderforge', x: forge.cx, z: forge.cz });
    const near = nearestLandmark(gen, 'cinderforge', forge.cx + 100, forge.cz);
    expect(near.kind).toBe('cinderforge');
    expect(near.dist).toBeLessThan(FORGE_REGION * 3);
    const over = new TerrainGenerator(5);
    const hits = landmarksInBox(over, -300, -300, 300, 300);
    expect(hits.every((h) => !LANDMARK_BY_KEY[h.kind].dim)).toBe(true);
  });

  it('has a milestone and a /locate command', () => {
    for (const id of ['cinderforge', 'glowcap', 'slagsteel', 'dirgestep', 'wyrm_ribs']) expect(MILESTONES.some((m) => m.id === id), id).toBe(true);
    const cmd = src('src/ui/commands.js');
    expect(cmd).toContain("'forge'");
    expect(cmd).toContain('ribs>');
  });
});

describe('Wyrm Ribs in the Hollow', () => {
  const hollow = new HollowGenerator(99);
  let site = null, island = null;
  for (let ci = -12; ci <= 12 && !site; ci++) for (let cj = -12; cj <= 12 && !site; cj++) {
    const o = hollow.outerIsland(ci, cj);
    if (!o) continue;
    const p = hollow.islandPlan(ci, cj);
    if (p && p.ribs) { site = p.ribs; island = { ci, cj, ...p }; }
  }

  it('stand on some city-less outer islands, found by the finders', () => {
    expect(site).toBeTruthy();
    expect(island.city).toBe(null);
    expect(island.island.r).toBeGreaterThanOrEqual(12);
    expect(wyrmRibsNear(hollow, site.cx - 3, site.cz - 3, site.cx + 3, site.cz + 3)).toContainEqual(site);
    expect(nearestWyrmRibs(hollow, site.cx + 60, site.cz + 60).cx).toBe(site.cx);
    expect(landmarksInBox(hollow, site.cx - 3, site.cz - 3, site.cx + 3, site.cz + 3)).toContainEqual({ kind: 'wyrmribs', x: site.cx, z: site.cz });
    // none on the island the Far Gate leads to, none over a city
    const gw = hollow.gatewayExit();
    expect(island.ci === gw.ci && island.cj === gw.cj).toBe(false);
    let withCity = 0, withRibs = 0, both = 0;
    for (let ci = -14; ci <= 14; ci++) for (let cj = -14; cj <= 14; cj++) {
      if (!hollow.outerIsland(ci, cj)) continue;
      const p = hollow.islandPlan(ci, cj);
      if (p.city) withCity++;
      if (p.ribs) withRibs++;
      if (p.city && p.ribs) both++;
    }
    expect(withRibs).toBeGreaterThan(0);
    expect(both).toBe(0);
    expect(withCity).toBeGreaterThan(0);
  });

  it('are built of Wyrmbone with a skull and a chest, five arches high over the spine', () => {
    const chunks = new Map();
    const get = (x, y, z, what = 'blocks') => {
      const k = `${x >> 4},${z >> 4}`;
      if (!chunks.has(k)) chunks.set(k, hollow.generate(x >> 4, z >> 4));
      return chunks.get(k)[what][cidx(x & 15, y, z & 15)];
    };
    let bone = 0, head = 0, chest = 0, chestMeta = 0, top = 0;
    for (let x = site.x0; x <= site.x1; x++) for (let z = site.z0; z <= site.z1; z++) for (let y = site.y - 2; y <= site.y + 12; y++) {
      const id = get(x, y, z);
      if (id === B.WYRMBONE) { bone++; top = Math.max(top, y - site.y); }
      else if (id === B.WYRM_HEAD) head++;
      else if (id === B.CHEST) { chest++; chestMeta = get(x, y, z, 'meta'); }
    }
    expect(bone).toBeGreaterThan(60);
    expect(top).toBeGreaterThanOrEqual(6);
    expect(head).toBe(1);
    expect(chest).toBe(1);
    expect((chestMeta >> 4) & 15).toBe(RIBS_LOOT);
    expect(RIB_U).toHaveLength(5);
  });

  it('do not disturb the cities or Hushvine of other islands (a ribcage uses its own random stream)', () => {
    // two generators over the same seed agree on every island plan's city and the same plan hash
    const again = new HollowGenerator(99);
    for (let ci = -6; ci <= 6; ci++) for (let cj = -6; cj <= 6; cj++) {
      if (!hollow.outerIsland(ci, cj)) continue;
      const a = hollow.islandPlan(ci, cj), b = again.islandPlan(ci, cj);
      expect(!!a.city).toBe(!!b.city);
      expect(a.ribs).toEqual(b.ribs);
    }
  });
});
