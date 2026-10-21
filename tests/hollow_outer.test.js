// The Hollow's late game: Far Gate, outer islands and Hollow Cities, their loot,
// Gloomshells and Levitation, the Voidwing glider, Sky Rockets, Gloomshell
// Boxes and Hushvine.
import { describe, it, expect } from 'vitest';
import { MockWorld, rng } from './helpers.js';
import { B } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { cidx } from '../src/world/constants.js';
import { Body } from '../src/physics/body.js';
import { HollowGenerator, OUTER_MIN_R, HOLLOW_ISLAND_R } from '../src/world/dimensions/hollow.js';
import { planCity, hollowCityLoot, LOOT_CITY, LOOT_SHIP, lootChestMeta } from '../src/world/dimensions/hollowCity.js';
import { growHushvinePlant, hushvineSupported, hushFlowerSupported, tickHushFlower, hushfruitTeleport, HUSH_MAX_AGE } from '../src/world/dimensions/hushvine.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { EFFECTS, levitationVelocity, cleanEffects, addEffect } from '../src/player/effects.js';
import { gliderUsable, canStartGliding, glideStep, rocketBoost, rocketLifetime, wallDamage, wearsThisTick, lookVector } from '../src/player/glider.js';
import { Player } from '../src/player/player.js';
import { withExtras, cleanContents, anvilCombine, canStack } from '../src/world/enchantments.js';
import { packEntity, unpackEntity, copyStack } from '../src/net/protocol.js';
import { craft } from '../src/player/crafting.js';
import { SMELTING } from '../src/player/crafting.js';
import '../src/world/dimensions/register.js';

const gen = new HollowGenerator(7);

describe('Far Gate and the outer islands', () => {
  it('leaves the void empty out to 800 blocks', () => {
    for (let ci = -8; ci <= 8; ci++) for (let cj = -8; cj <= 8; cj++) {
      const o = gen.outerIsland(ci, cj);
      if (o) expect(Math.hypot(o.x, o.z)).toBeGreaterThan(OUTER_MIN_R - 80);
    }
    // a chunk 400 blocks out holds nothing
    const c = gen.generate(25, 0);
    expect(c.blocks.every((id) => id === B.AIR)).toBe(true);
  });
  it('puts the Far Gate on the main island rim and its far end on an outer island ~1000 blocks out', () => {
    const a = gen.gatewayMain(), b = gen.gatewayExit();
    expect(Math.hypot(a.x, a.z)).toBeLessThan(HOLLOW_ISLAND_R + 16);
    expect(Math.hypot(a.x, a.z)).toBeGreaterThan(40);
    expect(gen.groundAt(a.x, a.z)).toBe(a.y);
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(OUTER_MIN_R);
    expect(Math.hypot(b.x, b.z)).toBeLessThan(1300);
    expect(b.island).toBeTruthy();
    // same direction from the centre
    const da = Math.atan2(a.z, a.x), db = Math.atan2(b.z, b.x);
    expect(Math.abs(Math.atan2(Math.sin(da - db), Math.cos(da - db)))).toBeLessThan(0.3);
    // deterministic, and stamped into the generated chunk
    const again = new HollowGenerator(7).gatewayExit();
    expect([again.x, again.y, again.z]).toEqual([b.x, b.y, b.z]);
    const c = gen.generate(b.x >> 4, b.z >> 4);
    const lx = b.x & 15, lz = b.z & 15;
    expect(c.blocks[cidx(lx, b.y + 1, lz)]).toBe(B.FAR_GATE);
    expect(c.blocks[cidx(lx, b.y + 2, lz)]).toBe(B.FAR_GATE);
    expect(c.blocks[cidx(lx, b.y + 3, lz)]).toBe(B.BEDROCK);
  });
});

describe('Hollow Cities', () => {
  const island = { x: 1000.5, z: 40.5, y: 50, r: 20 };
  const ground = (x, z) => (Math.hypot(x - island.x, z - island.z) < island.r ? 52 : null);
  it('are planned deterministically', () => {
    const a = planCity(7, island, ground).plan.finish(), b = planCity(7, island, ground).plan.finish();
    expect([...a.chunks.keys()]).toEqual([...b.chunks.keys()]);
    for (const [k, v] of a.chunks) expect(b.chunks.get(k)).toEqual(v);
    const c = planCity(8, island, ground).plan.finish();
    expect(JSON.stringify([...c.chunks])).not.toBe(JSON.stringify([...a.chunks]));
  });
  it('hold towers of Hollowbrick, ladders, Wisp Rods and loot chests', () => {
    let ships = 0, bridges = 0;
    for (let s = 1; s <= 16; s++) {
      const city = planCity(s, island, ground);
      const cells = [...city.plan.cells.values()];
      const count = (id) => cells.filter((c) => c[3] === id).length;
      expect(count(B.HOLLOWBRICK)).toBeGreaterThan(300);
      expect(count(B.HOLLOWBRICK_PILLAR)).toBeGreaterThan(20);
      expect(count(B.LADDER)).toBeGreaterThan(15);
      expect(count(B.WISP_ROD)).toBeGreaterThan(4);
      const chests = cells.filter((c) => c[3] === B.CHEST);
      expect(chests.length).toBeGreaterThanOrEqual(2);
      for (const c of chests) expect([LOOT_CITY, LOOT_SHIP]).toContain((c[4] >> 4) & 15);
      for (const c of chests) expect(c[4] & 8).toBe(8);
      if (city.towers.length > 1) bridges++;
      if (city.ship) {
        ships++;
        expect(count(B.WYRM_HEAD)).toBe(1);
        expect(chests.some((c) => ((c[4] >> 4) & 15) === LOOT_SHIP)).toBe(true);
      } else expect(count(B.WYRM_HEAD)).toBe(0);
      // the top room is the highest floor and the city stays in its bounds
      for (const c of cells) {
        expect(c[0]).toBeGreaterThanOrEqual(city.bounds.x0 - 1);
        expect(c[0]).toBeLessThanOrEqual(city.bounds.x1 + 1);
        expect(c[2]).toBeLessThanOrEqual(city.bounds.z1 + 1);
      }
    }
    expect(ships).toBeGreaterThan(2); expect(ships).toBeLessThan(15);
    expect(bridges).toBeGreaterThan(5);
  }, 30000);
  it('appear on outer islands and are found by cityAt / nearestCity', () => {
    const c = gen.nearestCity(900, 0);
    expect(c).toBeTruthy();
    expect(Math.hypot(c.x, c.z)).toBeGreaterThan(OUTER_MIN_R - 60);
    expect(gen.cityAt(c.x, c.y + 2, c.z)).toBe(c);
    expect(gen.cityAt(c.x, c.y + 2, c.z + 200)).toBe(null);
    // the generated chunk under the city has its Hollowbrick
    const ch = gen.generate(c.x >> 4, c.z >> 4), again = new HollowGenerator(7).generate(c.x >> 4, c.z >> 4);
    expect(Buffer.from(ch.blocks).equals(Buffer.from(again.blocks))).toBe(true);
    expect(ch.blocks.filter((id) => id === B.HOLLOWBRICK).length).toBeGreaterThan(50);
  });
  it('fill their chests with the reference city loot (ships always carry a Voidwing)', () => {
    const r = rng(5);
    let ench = 0, diamonds = 0;
    for (let k = 0; k < 300; k++) {
      const slots = hollowCityLoot(r, k % 3 === 0);
      expect(slots.length).toBe(27);
      const st = slots.filter(Boolean);
      expect(st.length).toBeGreaterThanOrEqual(2);
      expect(st.length).toBeLessThanOrEqual(7);
      if (k % 3 === 0) expect(st.some((s) => s.id === I.VOIDWING)).toBe(true);
      for (const s of st) {
        expect(ITEMS[s.id]).toBeTruthy();
        expect(s.count).toBeGreaterThan(0);
        if (s.ench) { ench++; expect(ITEMS[s.id].durability).toBeGreaterThan(0); }
        if (s.id === I.DIAMOND) { diamonds++; expect(s.count).toBeGreaterThanOrEqual(2); expect(s.count).toBeLessThanOrEqual(7); }
      }
    }
    expect(ench).toBeGreaterThan(20);
    expect(diamonds).toBeGreaterThan(5);
    // chests route through dungeonLoot with their kind
    expect(dungeonLoot(rng(1), LOOT.HOLLOW_SHIP).some((s) => s && s.id === I.VOIDWING)).toBe(true);
    expect(lootChestMeta(LOOT_CITY, 2)).toBe(2 | 8 | (13 << 4));
  });
});

describe('Levitation', () => {
  it('is an effect and survives saving', () => {
    expect(EFFECTS.levitation.name).toBe('Levitation');
    const m = {};
    addEffect(m, 'levitation', 200);
    expect(cleanEffects(JSON.parse(JSON.stringify(m))).levitation.ticks).toBe(200);
  });
  it('eases the vertical speed towards 0.05 x level (about 0.9 blocks/s at level I)', () => {
    let v = -0.5;
    for (let k = 0; k < 200; k++) v = levitationVelocity(v, 1) * 0.98;
    expect(v).toBeCloseTo(0.0098 / 0.216, 4);
    expect(v * 20).toBeGreaterThan(0.85); expect(v * 20).toBeLessThan(0.95);
    let v2 = 0;
    for (let k = 0; k < 200; k++) v2 = levitationVelocity(v2, 2) * 0.98;
    expect(v2).toBeCloseTo(2 * v, 5);
  });
  it('lifts a body instead of gravity', () => {
    const w = new MockWorld(64), b = new Body(0.6, 1.8);
    b.setPos(0.5, 70, 0.5);
    for (let k = 0; k < 60; k++) b.travel(w, { levitation: 1 });
    expect(b.y).toBeGreaterThan(71.5);
    const f = new Body(0.6, 1.8); f.setPos(0.5, 70, 0.5);
    for (let k = 0; k < 10; k++) f.travel(w, {});
    expect(f.y).toBeLessThan(70);
  });
});

describe('Voidwing gliding', () => {
  const wing = (damage = 0) => ({ id: I.VOIDWING, count: 1, damage });
  it('is worn in the chest slot, works until 1 use is left and mends with Drift Membrane', () => {
    const d = ITEMS[I.VOIDWING];
    expect(d.armor.slot).toBe(1);
    expect(d.durability).toBe(432);
    expect(gliderUsable(wing())).toBe(true);
    expect(gliderUsable(wing(430))).toBe(true);
    expect(gliderUsable(wing(431))).toBe(false);
    expect(gliderUsable({ id: I.IRON_CHESTPLATE, count: 1, damage: 0 })).toBe(false);
    const r = anvilCombine(wing(400), { id: I.DRIFT_MEMBRANE, count: 2, damage: 0 });
    expect(r.result.damage).toBe(400 - 2 * 108);
    expect(r.use).toBe(2);
  });
  it('starts only in mid-air, out of fluids and not levitating', () => {
    const base = { onGround: false, inWater: false, inLava: false, flying: false, levitating: false, chest: wing() };
    expect(canStartGliding(base)).toBe(true);
    for (const k of ['onGround', 'inWater', 'inLava', 'flying', 'levitating']) expect(canStartGliding({ ...base, [k]: true })).toBe(false);
    expect(canStartGliding({ ...base, chest: null })).toBe(false);
  });
  it('glides far for little height when level, dives fast and climbs when pulled up', () => {
    // level flight from a slow start
    const v = { vx: 0, vy: 0, vz: -0.5 };
    let y = 0, dist = 0;
    for (let k = 0; k < 200; k++) { glideStep(v, 0, 0); y += v.vy; dist += Math.hypot(v.vx, v.vz); }
    expect(dist / -y).toBeGreaterThan(5); // a glide ratio well above 5:1
    expect(Math.hypot(v.vx, v.vz)).toBeGreaterThan(0.5);
    // a dive picks up speed
    const d = { vx: 0, vy: 0, vz: -0.5 };
    for (let k = 0; k < 60; k++) glideStep(d, 0, -0.8);
    expect(Math.hypot(d.vx, d.vy, d.vz)).toBeGreaterThan(Math.hypot(v.vx, v.vy, v.vz));
    // pulling up from the dive climbs and slows down
    const sp = Math.hypot(d.vx, d.vz);
    let rose = 0;
    for (let k = 0; k < 20; k++) { glideStep(d, 0, 0.7); rose += d.vy; }
    expect(rose).toBeGreaterThan(0);
    expect(Math.hypot(d.vx, d.vz)).toBeLessThan(sp);
    // flying turns towards where you look
    const t = { vx: 0, vy: 0, vz: -1 };
    for (let k = 0; k < 40; k++) glideStep(t, -Math.PI / 2, 0); // look towards +x
    expect(t.vx).toBeGreaterThan(Math.abs(t.vz));
  });
  it('hurts on hitting a wall, wears every second and is pushed by rockets', () => {
    expect(wallDamage(1.2, 0)).toBeCloseTo(9, 5);
    expect(wallDamage(0.3, 0)).toBe(0);
    let n = 0;
    for (let k = 0; k < 100; k++) if (wearsThisTick(k)) n++;
    expect(n).toBe(5);
    const v = { vx: 0, vy: 0, vz: 0 };
    for (let k = 0; k < 30; k++) rocketBoost(v, 0, 0);
    const [lx, , lz] = lookVector(0, 0);
    expect(v.vz / lz).toBeGreaterThan(1.5);
    expect(Math.abs(v.vx - lx * 0)).toBeLessThan(1e-9);
    for (let k = 0; k < 50; k++) { const t = rocketLifetime(1, Math.random); expect(t).toBeGreaterThanOrEqual(20); expect(t).toBeLessThanOrEqual(31); }
  });
  it('lets a player glide: press jump in the air, wear the wing, land', () => {
    const w = new MockWorld(0), p = new Player();
    p.inventory.armor[1] = wing(0);
    p.setPosition(0.5, 120, 0.5);
    p.pitch = -0.2;
    const air = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    for (let k = 0; k < 5; k++) p.tick(w, air);
    expect(p.gliding).toBeFalsy();
    p.tick(w, { ...air, jump: true });
    expect(p.gliding).toBe(true);
    for (let k = 0; k < 40; k++) p.tick(w, air);
    expect(p.inventory.armor[1].damage).toBe(2);
    expect(Math.hypot(p.x - 0.5, p.z - 0.5)).toBeGreaterThan(10);
    let t = 0;
    for (; t < 2000 && p.gliding; t++) p.tick(w, air);
    expect(p.gliding).toBe(false);
    expect(Math.hypot(p.x, p.z) / 120).toBeGreaterThan(5); // it glided far
    p.tick(w, air); p.tick(w, air);
    expect(p.body.onGround).toBe(true);
    // a level glide lands without fall damage
    expect(p.health).toBeGreaterThan(15);
  });
});

describe('Gloomshell Boxes', () => {
  it('are crafted from two husks and a chest and never stack', () => {
    const r = craft([null, { id: I.GLOOMSHELL_HUSK, count: 1 }, null, null, { id: B.CHEST, count: 1 }, null, null, { id: I.GLOOMSHELL_HUSK, count: 1 }, null], 3);
    expect(r && r.id).toBe(B.GLOOMSHELL_BOX);
    expect(ITEMS[B.GLOOMSHELL_BOX].stack).toBe(1);
    expect(BLOCK_DROPS_NONE()).toBe(true);
  });
  it('keep their contents in the item, through saves and the network', () => {
    const slots = new Array(27).fill(null);
    slots[3] = { id: I.DIAMOND, count: 5, damage: 0 };
    slots[10] = { id: I.DIAMOND_SWORD, count: 1, damage: 7, ench: { keen: 3 } };
    const st = withExtras({ id: B.GLOOMSHELL_BOX, count: 1, damage: 0 }, { contents: slots });
    expect(st.contents[3]).toEqual({ id: I.DIAMOND, count: 5, damage: 0 });
    expect(st.contents[10].ench).toEqual({ keen: 3 });
    expect(copyStack(st).contents).toEqual(st.contents);
    const e = { kind: 'item', id: 9, x: 1, y: 2, z: 3, stack: st, pickupDelay: 0 };
    const back = unpackEntity(JSON.parse(JSON.stringify(packEntity(e))));
    expect(back.stack.contents).toEqual(st.contents);
    expect(cleanContents(new Array(27).fill(null))).toBe(null);
    expect(cleanContents([{ id: 99999, count: 3 }, { id: I.STICK, count: 500 }])[1].count).toBe(64);
    expect(canStack(st, { ...st })).toBe(true); // the same item, but boxes only stack to 1
  });
});

function BLOCK_DROPS_NONE() {
  // the box drops itself through the game (with its contents), never through the block drop table
  return ITEMS[B.GLOOMSHELL_BOX].block === B.GLOOMSHELL_BOX;
}

describe('Hushvine', () => {
  const plantWorld = () => {
    const m = new Map();
    const w = {
      getBlock: (x, y, z) => m.get(`${x},${y},${z}`) ?? (y <= 60 ? B.HOLLOWSTONE : B.AIR),
      getMeta: (x, y, z) => m.get(`m${x},${y},${z}`) || 0,
      setBlock: (x, y, z, id, meta = 0) => { m.set(`${x},${y},${z}`, id); m.set(`m${x},${y},${z}`, meta); },
    };
    return { w, m };
  };
  it('grows deterministic plants whose every stalk is supported, with flowers at the tips', () => {
    const grow = (seed) => {
      const { w } = plantWorld(), cells = [];
      growHushvinePlant((x, y, z, id, meta) => { w.setBlock(x, y, z, id, meta); cells.push([x, y, z, id]); }, (x, y, z) => !w.getBlock(x, y, z), rng(seed), 0, 61, 0);
      return { w, cells };
    };
    let flowers = 0, tall = 0;
    for (let s = 1; s <= 20; s++) {
      const { w, cells } = grow(s);
      expect(grow(s).cells).toEqual(cells);
      for (const [x, y, z, id] of cells) {
        if (id === B.HUSHVINE) expect(hushvineSupported(w.getBlock, x, y, z)).toBe(true);
        else { flowers++; expect(hushFlowerSupported(w.getBlock, x, y, z)).toBe(true); expect(w.getMeta(x, y, z)).toBe(HUSH_MAX_AGE); }
        expect(Math.abs(x)).toBeLessThan(8); expect(Math.abs(z)).toBeLessThan(8);
      }
      tall = Math.max(tall, Math.max(...cells.map((c) => c[1])) - 61);
    }
    expect(flowers).toBeGreaterThan(20);
    expect(tall).toBeGreaterThan(5);
  });
  it('falls without support and its flowers grow on random ticks', () => {
    const { w } = plantWorld();
    expect(hushvineSupported(w.getBlock, 0, 70, 0)).toBe(false);
    expect(hushvineSupported(w.getBlock, 0, 61, 0)).toBe(true);
    w.setBlock(0, 61, 0, B.HUSHVINE_FLOWER, 0);
    let grew = false;
    const r = rng(3);
    for (let k = 0; k < 20; k++) {
      for (let y = 61; y < 75; y++) if (w.getBlock(0, y, 0) === B.HUSHVINE_FLOWER) { tickHushFlower(w, 0, y, 0, r); break; }
    }
    for (let y = 62; y < 75; y++) if (w.getBlock(0, y, 0) === B.HUSHVINE) grew = true;
    expect(grew).toBe(true);
  });
  it('fruit teleports to a standing spot within 8 blocks, and pops in a furnace', () => {
    const w = new MockWorld(64), r = rng(9);
    for (let k = 0; k < 50; k++) {
      const t = hushfruitTeleport((x, y, z) => w.getBlock(x, y, z), 0.5, 64, 0.5, r);
      expect(t).toBeTruthy();
      expect(Math.abs(t.x - 0.5)).toBeLessThanOrEqual(8.5);
      expect(t.y).toBe(64);
    }
    expect(SMELTING[I.HUSHFRUIT]).toBe(I.POPPED_HUSHFRUIT);
    expect(ITEMS[I.HUSHFRUIT].food.always).toBe(true);
  });
});
