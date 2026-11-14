// The Ember Hearth (world/emberHearth.js) and Glimmermoss (world/glimmermoss.js).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MockWorld } from './helpers.js';
import { B, BLOCKS, SOLID, OPAQUE, EMIT, SHAPE, TIER, NUM_BLOCKS } from '../src/world/blocks.js';
import { I } from '../src/world/items.js';
import { TEX_NAMES } from '../src/world/textures.js';
import { craft } from '../src/player/crafting.js';
import { blockDrops } from '../src/world/mining.js';
import { Player } from '../src/player/player.js';
import { playerSaveData } from '../src/world/save.js';
import { entriesOf } from '../src/player/fieldGuideEntries.js';
import {
  HEARTH_MAX_CHARGES, hearthCharges, canCharge, chargeUp, spendCharge, canSet, cleanHearth, hearthSpot, canStandAt,
} from '../src/world/emberHearth.js';
import { mossSupported, spreadSpots, pickSpread } from '../src/world/glimmermoss.js';
import { SIDE_DIRS } from '../src/world/shapes.js';
import { Body } from '../src/physics/body.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c ? { id: c, count: 1 } : null; }); return g; };
const get = (w) => (x, y, z) => w.getBlock(x, y, z);

describe('Ember Hearth: block and rules', () => {
  it('is hard like obsidian, glowing, with a texture', () => {
    const d = BLOCKS[B.EMBER_HEARTH];
    expect(d.name).toBe('Ember Hearth');
    expect(d.hardness).toBe(50);
    expect(d.resistance).toBe(1200);
    expect(d.tier).toBe(TIER.DIAMOND);
    expect(d.tool).toBe(BLOCKS[B.OBSIDIAN].tool);
    expect(EMIT[B.EMBER_HEARTH]).toBeGreaterThan(0);
    expect(SOLID[B.EMBER_HEARTH]).toBe(1);
    expect(B.EMBER_HEARTH).toBeLessThan(NUM_BLOCKS);
    expect(TEX_NAMES).toContain('ember_hearth');
  });
  it('charges up to four and spends one at a time', () => {
    let c = 0;
    expect(canSet(c, 'cinderdeep')).toBe(false);
    for (let i = 0; i < 6; i++) c = chargeUp(c);
    expect(c).toBe(HEARTH_MAX_CHARGES);
    expect(canCharge(c)).toBe(false);
    expect(canCharge(3)).toBe(true);
    expect(spendCharge(c)).toBe(3);
    expect(spendCharge(0)).toBe(0);
    expect(hearthCharges(99)).toBe(4);
    expect(hearthCharges(-3)).toBe(0);
  });
  it('can be set only in the Cinderdeep and only with a charge', () => {
    expect(canSet(1, 'cinderdeep')).toBe(true);
    expect(canSet(0, 'cinderdeep')).toBe(false);
    expect(canSet(4, 'overworld')).toBe(false);
    expect(canSet(4, 'hollow')).toBe(false);
  });
  it('is crafted from six Obsidian and three Glowshard blocks', () => {
    const O = B.OBSIDIAN, G = B.GLOWSHARD;
    const r = craft(grid(O, O, O, G, G, G, O, O, O), 3);
    expect(r && r.id).toBe(B.EMBER_HEARTH);
    expect(craft(grid(O, O, O, G, G, null, O, O, O), 3)).toBeFalsy();
  });
  it('finds a free standing spot beside the hearth, or none when walled in', () => {
    const w = new MockWorld(64);
    w.set(0, 64, 0, B.EMBER_HEARTH, 2);
    const s = hearthSpot(get(w), 0, 64, 0);
    expect(s).not.toBeNull();
    expect(Math.abs(s.x - 0.5) + Math.abs(s.z - 0.5)).toBeGreaterThan(0);
    expect(canStandAt(get(w), Math.floor(s.x), s.y, Math.floor(s.z))).toBe(true);
    // lava on the floor does not count
    const lava = new MockWorld(64);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) lava.set(x, 63, z, B.LAVA);
    lava.set(0, 64, 0, B.EMBER_HEARTH);
    expect(hearthSpot(get(lava), 0, 64, 0)).toBeNull();
    // a low ceiling is skipped
    const low = new MockWorld(64);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x || z) low.set(x, 65, z, B.STONE);
    low.set(0, 64, 0, B.EMBER_HEARTH);
    expect(hearthSpot(get(low), 0, 64, 0)).toBeNull();
  });
  it('validates the saved position: three finite numbers or null', () => {
    expect(cleanHearth({ x: 3, y: 40, z: -9 })).toEqual({ x: 3, y: 40, z: -9 });
    expect(cleanHearth(null)).toBeNull();
    expect(cleanHearth(undefined)).toBeNull();
    expect(cleanHearth({ x: 1, y: 2 })).toBeNull();
    expect(cleanHearth({ x: NaN, y: 2, z: 3 })).toBeNull();
    expect(cleanHearth({ x: 1, y: Infinity, z: 3 })).toBeNull();
    expect(cleanHearth({ x: '1', y: 2, z: 3 })).toBeNull();
    expect(cleanHearth(5)).toBeNull();
  });
  it('round-trips through the player save', () => {
    const p = new Player();
    expect(playerSaveData(p).hearth).toBeNull();
    p.hearth = { x: 10, y: 33, z: -4 };
    const d = JSON.parse(JSON.stringify(playerSaveData(p)));
    expect(cleanHearth(d.hearth)).toEqual({ x: 10, y: 33, z: -4 });
    expect(src('src/world/save.js')).toContain('p.hearth = cleanHearth(d.hearth)');
  });
  it('is wired into use, respawn and the guide', () => {
    expect(src('src/player/interaction.js')).toMatch(/B\.EMBER_HEARTH/);
    expect(src('src/game.js')).toContain('respawnAtHearth');
    const usable = src('src/player/interaction.js').match(/USABLE_BLOCKS = new Set\(\[(\w+\.\w+)/);
    expect(usable[1]).toBe('B.CARTOGRAPHERS_TABLE');
    expect(entriesOf('items').some((e) => e.id === B.EMBER_HEARTH)).toBe(true);
  });
});

describe('Glimmermoss', () => {
  it('is a glowing, non-solid, instantly broken wall plant that cannot be climbed', () => {
    const d = BLOCKS[B.GLIMMERMOSS];
    expect(d.name).toBe('Glimmermoss');
    expect(SOLID[B.GLIMMERMOSS]).toBe(0);
    expect(OPAQUE[B.GLIMMERMOSS]).toBe(0);
    expect(EMIT[B.GLIMMERMOSS]).toBe(7);
    expect(d.hardness).toBe(0);
    expect(d.shape).toBe(BLOCKS[B.VINES].shape);
    expect(d.shape).toBe(SHAPE.LADDER);
    expect(TEX_NAMES).toContain('glimmermoss');
    const w = new MockWorld(0);
    w.set(0, 5, 0, B.GLIMMERMOSS, 1);
    const b = new Body(0.6, 1.8); b.x = 0.5; b.y = 5; b.z = 0.5;
    expect(b.onLadder(w)).toBe(0);
    w.set(0, 5, 0, B.VINES, 1);
    expect(b.onLadder(w)).toBe(1); // (vines do climb)
  });
  it('drops itself only with Shears', () => {
    const shears = { shears: true, type: 'shears' };
    expect(blockDrops(B.GLIMMERMOSS, shears, Math.random, 0)).toEqual([{ id: B.GLIMMERMOSS, count: 1 }]);
    expect(blockDrops(B.GLIMMERMOSS, undefined, Math.random, 0)).toEqual([]);
  });
  it('is crafted from Moss Carpet and Glowshard Dust, two at a time', () => {
    const r = craft(grid(B.MOSS_CARPET, I.GLOWSHARD_DUST), 3);
    expect(r && r.id).toBe(B.GLIMMERMOSS);
    expect(r.count).toBe(2);
    const r2 = craft(grid(I.GLOWSHARD_DUST, null, B.MOSS_CARPET), 3);
    expect(r2 && r2.id).toBe(B.GLIMMERMOSS);
  });
  it('needs a solid opaque wall on its side', () => {
    const w = new MockWorld(0);
    const [dx, , dz] = SIDE_DIRS[2];
    w.set(5 + dx, 5, 5 + dz, B.STONE);
    expect(mossSupported(get(w), 5, 5, 5, 2)).toBe(true);
    expect(mossSupported(get(w), 5, 5, 5, 0)).toBe(false);
    w.set(5 + dx, 5, 5 + dz, B.GLASS);
    expect(mossSupported(get(w), 5, 5, 5, 2)).toBe(false);
  });
  it('spreads to free wall spots with the right side, and nowhere else', () => {
    const w = new MockWorld(0);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) w.set(x, y, 6, B.STONE); // a wall at z = 6 (side 2 from z = 5)
    w.set(2, 5, 5, B.GLIMMERMOSS, 2);
    const spots = spreadSpots(get(w), 2, 5, 5);
    expect(spots.length).toBeGreaterThanOrEqual(3);
    for (const s of spots) {
      expect(mossSupported(get(w), s.x, s.y, s.z, s.meta)).toBe(true);
      expect(Math.abs(s.x - 2) + Math.abs(s.y - 5) + Math.abs(s.z - 5)).toBe(1);
    }
    expect(pickSpread(spots, 0)).toEqual(spots[0]);
    expect(pickSpread(spots, 0.999)).toEqual(spots[spots.length - 1]);
    expect(pickSpread([], 0.5)).toBeNull();
    const lone = new MockWorld(0);
    lone.set(0, 5, 0, B.GLIMMERMOSS, 2);
    expect(spreadSpots(get(lone), 0, 5, 0)).toEqual([]);
  });
  it('is in the guide', () => {
    expect(entriesOf('items').some((e) => e.id === B.GLIMMERMOSS)).toBe(true);
  });
});

describe('Ember Hearth and Glimmermoss: text', () => {
  it('uses no forbidden words in the new files', () => {
    for (const f of ['src/world/emberHearth.js', 'src/world/glimmermoss.js', 'src/world/pack7Textures.js', 'src/ui/helpTopics.js']) {
      expect(src(f)).not.toMatch(/minecraft|nether|redstone|tripwire/i);
    }
  });
  it('is described in the help', () => {
    const h = src('src/ui/helpTopics.js');
    expect(h).toContain('Ember Hearth');
    expect(h).toContain('Glimmermoss');
  });
});
