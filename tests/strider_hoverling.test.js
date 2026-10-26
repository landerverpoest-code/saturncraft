import { describe, it, expect, vi } from 'vitest';
import {
  DASH_COOLDOWN, DASH_MAX_CHARGE, DASH_MIN_CHARGE, STRIDER_STEP, SEAT, newDash, dashStep, dashPower, dashGauge,
  seatOffset, outOfMeleeReach, claimSeat, interactStrider, guestWantsSeat, desertChunkSpawn, DESERT_CHUNK_CHANCE,
} from '../src/mobs/duneStrider.js';
import {
  COLLECT_RANGE, CHIME_MEMORY, HEAR_RANGE, PICKUP_COOLDOWN, matchesHeld, roomLeft, findWanted, absorb, deliveryTarget,
  chimeRang, hearChime, findJukebox, interactHoverling, CAGE,
} from '../src/mobs/hoverling.js';
import { Mob } from '../src/mobs/mob.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { I, maxStack } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { CHIME_POWERED } from '../src/world/circuitShapes.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { outpostsNear, stampOutposts } from '../src/world/temples.js';
import { CHUNK_VOLUME, cidx } from '../src/world/constants.js';
import { MockWorld } from './helpers.js';

const TICK_S = 0.05;

describe('Dune Strider', () => {
  it('is a tall, cactus-eating creature that steps up 1.5 blocks', () => {
    const d = MOBS.dune_strider;
    expect(d.height).toBeCloseTo(2.4, 5);
    expect(d.food).toEqual([B.CACTUS]);
    expect(d.rideable && d.strider).toBe(true);
    const m = new Mob('dune_strider', 0, 64, 0);
    d.onSpawn(m);
    expect(m.body.stepHeight).toBe(STRIDER_STEP);
    expect(STRIDER_STEP).toBe(1.5);
  });

  it('charges a dash while jump is held and leaps on release, then waits 2.75 s', () => {
    expect(DASH_COOLDOWN * TICK_S).toBeCloseTo(2.75, 9);
    const s = newDash();
    for (let k = 0; k < 10; k++) expect(dashStep(s, true, true)).toBeNull();
    expect(s.charge).toBe(10);
    const p = dashStep(s, false, true);
    expect(p).toEqual(dashPower(10));
    expect(p.forward).toBeGreaterThan(0.5);
    expect(s.cooldown).toBe(DASH_COOLDOWN);
    // during the cooldown holding jump charges nothing and no dash comes out
    let fired = 0;
    for (let k = 0; k < DASH_COOLDOWN; k++) { if (dashStep(s, true, true)) fired++; }
    expect(fired).toBe(0);
    expect(s.cooldown).toBe(0); expect(s.charge).toBe(0);
    // ready again
    for (let k = 0; k < DASH_MAX_CHARGE + 10; k++) dashStep(s, true, true);
    expect(s.charge).toBe(DASH_MAX_CHARGE); // capped
    expect(dashStep(s, false, true)).toEqual(dashPower(DASH_MAX_CHARGE));
  });

  it('a longer charge leaps further; a tap is no dash and costs no cooldown', () => {
    expect(dashPower(DASH_MAX_CHARGE).forward).toBeGreaterThan(dashPower(DASH_MIN_CHARGE).forward);
    expect(dashPower(DASH_MAX_CHARGE * 3)).toEqual(dashPower(DASH_MAX_CHARGE));
    const s = newDash();
    dashStep(s, true, true);
    expect(dashStep(s, false, true)).toBeNull();
    expect(s.cooldown).toBe(0);
    // in the air the charge holds but does not grow
    const a = newDash();
    dashStep(a, true, true); dashStep(a, true, true); dashStep(a, true, true);
    dashStep(a, true, false);
    expect(a.charge).toBe(3);
  });

  it('the HUD gauge shows the charge, then the cooldown filling up', () => {
    const s = newDash();
    expect(dashGauge(s)).toMatchObject({ charging: false, ready: 1 });
    for (let k = 0; k < DASH_MAX_CHARGE / 2; k++) dashStep(s, true, true);
    expect(dashGauge(s)).toMatchObject({ charging: true, charge: 0.5 });
    dashStep(s, false, true);
    expect(dashGauge(s).ready).toBe(0);
    for (let k = 0; k < DASH_COOLDOWN / 5; k++) dashStep(s, false, true);
    expect(dashGauge(s).ready).toBeCloseTo(0.2, 5);
  });

  it('seats two: the driver in front, the passenger behind', () => {
    const m = { yaw: 0, age: 0 };
    const [fx, fy, fz] = seatOffset(m, false), [bx, by, bz] = seatOffset(m, true);
    expect(fy).toBe(SEAT.y); expect(by).toBe(SEAT.passengerY);
    expect(fz).toBeLessThan(0); // yaw 0 faces -Z: in front
    expect(bz).toBeGreaterThan(fz);
    expect(fx).toBeCloseTo(0, 9); expect(bx).toBeCloseTo(0, 9);
  });

  it('keeps its riders out of reach of Shamblers, not of taller mobs', () => {
    expect(outOfMeleeReach(MOBS.shambler.height, SEAT.y, true)).toBe(true);
    expect(outOfMeleeReach(MOBS.shambler.height, SEAT.passengerY, true)).toBe(true);
    expect(outOfMeleeReach(MOBS.voidwalker.height, SEAT.y, true)).toBe(false);
    expect(outOfMeleeReach(MOBS.shambler.height, 0.85, true)).toBe(false); // a Galloper's seat is low
    expect(outOfMeleeReach(MOBS.shambler.height, SEAT.y, false)).toBe(false);
    // a Shambler next to a rider up on a Strider does not hit; on foot at the same height it would
    const z = new Mob('shambler', 0, 64, 0);
    const target = (riding) => ({ x: 0.5, y: 64 + SEAT.y, z: 0, width: 0.6, riding, hurt: vi.fn(() => true) });
    const up = target({ def: MOBS.dune_strider });
    z.tryMelee({}, up);
    expect(up.hurt).not.toHaveBeenCalled();
    const ledge = target(null);
    z.tryMelee({}, ledge);
    expect(ledge.hurt).toHaveBeenCalled();
  });

  it('gives its back seat to one guest, only when grown and saddled', () => {
    const m = new Mob('dune_strider', 0, 64, 0);
    expect(claimSeat(m, 3, true)).toBe(false); // no saddle
    m.saddled = true;
    expect(claimSeat(m, 3, true)).toBe(true);
    expect(m.passengerId).toBe(3);
    expect(claimSeat(m, 4, true)).toBe(false); // taken
    claimSeat(m, 4, false);
    expect(m.passengerId).toBe(3);
    claimSeat(m, 3, false);
    expect(m.passengerId).toBeNull();
    m.setBaby(true);
    expect(claimSeat(m, 4, true)).toBe(false);
  });

  it('a guest asks for the seat only with a free, saddled Strider and no saddle or cactus in hand', () => {
    const m = new Mob('dune_strider', 0, 64, 0);
    const p = { riding: null, sneaking: false };
    expect(guestWantsSeat(m, p, null)).toBe(false);
    m.saddled = true;
    expect(guestWantsSeat(m, p, null)).toBe(true);
    expect(guestWantsSeat(m, p, { id: B.CACTUS, count: 1 })).toBe(false);
    m.passengerId = 2;
    expect(guestWantsSeat(m, p, null)).toBe(false);
  });

  it('is saddled, fed cactus and climbed onto with right-clicks', () => {
    const fx = { emit() {}, smoke() {} };
    const g = { audio: { play() {} }, particles: fx, mount: vi.fn() };
    const m = new Mob('dune_strider', 0, 64, 0);
    const p = { riding: null, sneaking: false };
    const use = vi.fn();
    expect(interactStrider(g, m, p, null, use)).toBe(false); // nothing to sit on yet
    expect(interactStrider(g, m, p, { id: I.SADDLE, count: 1 }, use)).toBe(true);
    expect(m.saddled).toBe(true); expect(use).toHaveBeenCalledTimes(1);
    expect(interactStrider(g, m, p, { id: B.CACTUS, count: 1 }, use)).toBe(true); // full health: it falls in love
    expect(m.loveTicks).toBeGreaterThan(0);
    m.sitting = true;
    expect(interactStrider(g, m, p, null, use)).toBe(true);
    expect(g.mount).toHaveBeenCalledWith(m);
    expect(m.sitting).toBe(false);
    // a guest's click played on the host never seats the guest in the host's game
    const g2 = { ...g, mount: vi.fn() };
    expect(interactStrider(g2, m, { isRemotePlayer: true }, null, use)).toBe(false);
    expect(g2.mount).not.toHaveBeenCalled();
  });

  it('keeps its saddle in the save', () => {
    const m = new Mob('dune_strider', 0, 64, 0);
    m.saddled = true;
    const s = JSON.parse(JSON.stringify(m.saveData()));
    const n = new Mob('dune_strider', 0, 64, 0);
    n.loadData(s);
    expect(n.saddled).toBe(true);
  });

  it('turns up now and then on desert sand when a chunk is made', () => {
    const spawned = [];
    const world = { biomeAt: () => 8, heightAt: () => 70, getBlock: () => B.SAND };
    const spawner = { game: { world }, canFit: () => true, spawnMob: (t, x, y, z) => spawned.push([t, y]) };
    let k = 0; const seq = [DESERT_CHUNK_CHANCE / 2, 0.5, 0.5, 0.9];
    expect(desertChunkSpawn(spawner, 0, 0, () => seq[k++ % seq.length])).toBe(1);
    expect(spawned).toEqual([['dune_strider', 71]]);
    expect(desertChunkSpawn(spawner, 0, 0, () => 0.99)).toBe(0);
  });
});

describe('Hoverling', () => {
  const item = (id, x, z, count = 1, extra = {}) => ({ kind: 'item', id: Math.random(), x, y: 64, z, dead: false, stack: { id, count, damage: 0 }, ...extra });

  it('is a small flying spirit that drops nothing of its own', () => {
    const d = MOBS.hoverling;
    expect(d.flying).toBe(true);
    expect(d.drops).toEqual([]);
    expect(d.width).toBeLessThan(0.5);
  });

  it('matches dropped items of the kind it holds', () => {
    const held = { id: I.EGG, count: 1 };
    expect(matchesHeld(held, { id: I.EGG, count: 3 })).toBe(true);
    expect(matchesHeld(held, { id: I.BONE, count: 3 })).toBe(false);
    expect(matchesHeld(null, { id: I.EGG, count: 3 })).toBe(false);
    expect(roomLeft(held, { id: I.EGG, count: 10 })).toBe(maxStack(I.EGG) - 10);
  });

  it('goes for the nearest matching item within 32 blocks, never what it threw itself', () => {
    const m = { id: 7, x: 0, y: 64, z: 0, held: { id: I.BONE, count: 1 }, carried: null };
    const far = item(I.BONE, COLLECT_RANGE + 2, 0), near = item(I.BONE, 10, 0), nearer = item(I.BONE, 6, 0, 1, { thrownBy: 7 });
    const other = item(I.EGG, 1, 0);
    expect(findWanted(m, [far, near, nearer, other])).toBe(near);
    expect(findWanted(m, [far, other])).toBeNull();
    expect(findWanted({ ...m, held: null }, [near])).toBeNull();
  });

  it('gathers up to one full stack', () => {
    const m = { id: 1, x: 0, y: 64, z: 0, held: { id: I.EGG, count: 1 }, carried: null };
    const a = item(I.EGG, 1, 0, 10), b = item(I.EGG, 1, 0, 10);
    expect(absorb(m, a)).toBe(10);
    expect(a.dead).toBe(true);
    expect(absorb(m, b)).toBe(maxStack(I.EGG) - 10);
    expect(m.carried.count).toBe(maxStack(I.EGG));
    expect(b.dead).toBe(false); expect(b.stack.count).toBe(20 - maxStack(I.EGG));
    expect(findWanted(m, [b])).toBeNull(); // full
  });

  it('brings items to a Chime Block heard in the last 30 s, else to the giver', () => {
    expect(CHIME_MEMORY * TICK_S).toBe(30);
    const giver = { x: 5, y: 64, z: 5, dead: false };
    const m = { chime: { x: 10, y: 63, z: 10, t: 1000 } };
    expect(deliveryTarget(m, 1000 + CHIME_MEMORY, giver)).toMatchObject({ kind: 'chime', x: 10.5, z: 10.5 });
    expect(deliveryTarget(m, 1001 + CHIME_MEMORY, giver)).toMatchObject({ kind: 'player', x: 5, z: 5 });
    expect(deliveryTarget({}, 0, giver).kind).toBe('player');
    expect(deliveryTarget({}, 0, { ...giver, dead: true })).toBeNull();
    expect(deliveryTarget({}, 0, null)).toBeNull();
  });

  it('hears a Chime Block ring within 16 blocks (a new pitch or a fresh signal, not switching off)', () => {
    expect(chimeRang(undefined, 3)).toBe(true);
    expect(chimeRang(3, 4)).toBe(true);
    expect(chimeRang(3, 3 | CHIME_POWERED)).toBe(true);
    expect(chimeRang(3 | CHIME_POWERED, 3)).toBe(false);
    const close = { type: 'hoverling', x: 5, y: 64, z: 0 }, far = { type: 'hoverling', x: HEAR_RANGE + 5, y: 64, z: 0 };
    expect(hearChime([close, far, { type: 'fleecer', x: 0, y: 64, z: 0 }], 0, 64, 0, 77)).toBe(1);
    expect(close.chime).toEqual({ x: 0, y: 64, z: 0, t: 77 });
    expect(far.chime).toBeUndefined();
  });

  it('finds a playing jukebox to dance by', () => {
    const w = new MockWorld(60);
    expect(findJukebox(w, 0, 64, 0)).toBeNull();
    w.set(4, 63, -3, B.JUKEBOX, 0);
    expect(findJukebox(w, 0, 64, 0)).toBeNull(); // silent
    w.set(4, 63, -3, B.JUKEBOX, 2);
    expect(findJukebox(w, 0, 64, 0)).toEqual({ x: 4, y: 63, z: -3 });
    expect(findJukebox(w, 30, 64, 0)).toBeNull();
  });

  it('takes an item from the hand and gives it back (with what it gathered) to an empty hand', () => {
    const g = { audio: { play() {} }, particles: { emit() {} }, entities: { spawnItem: vi.fn() } };
    const m = new Mob('hoverling', 0, 64, 0);
    const added = [];
    const p = { netName: 'Ana', x: 0, y: 64, z: 0, inventory: { add: (s) => { added.push(s); return 0; }, changed() {} } };
    const use = vi.fn();
    expect(interactHoverling(g, m, p, null, use)).toBe(false);
    expect(interactHoverling(g, m, p, { id: I.BONE, count: 5 }, use)).toBe(true);
    expect(m.held).toMatchObject({ id: I.BONE, count: 1 });
    expect(m.giverName).toBe('Ana');
    expect(use).toHaveBeenCalledTimes(1);
    expect(interactHoverling(g, m, p, { id: I.EGG, count: 1 }, use)).toBe(false); // already holds something
    m.carried = { id: I.BONE, count: 12, damage: 0 };
    // saved and loaded
    const n = new Mob('hoverling', 0, 64, 0);
    n.loadData(JSON.parse(JSON.stringify(m.saveData())));
    expect(n.held).toMatchObject({ id: I.BONE, count: 1 }); expect(n.carried.count).toBe(12); expect(n.giverName).toBe('Ana');
    expect(interactHoverling(g, m, p, null, use)).toBe(true);
    expect(added.map((s) => s.count)).toEqual([1, 12]);
    expect(m.held).toBeNull(); expect(m.carried).toBeNull();
    // a guest (played on the host) gets it thrown at their feet
    interactHoverling(g, m, p, { id: I.BONE, count: 1 }, use);
    interactHoverling(g, m, { ...p, isRemotePlayer: true }, null, use);
    expect(g.entities.spawnItem).toHaveBeenCalled();
    expect(PICKUP_COOLDOWN).toBeGreaterThan(0);
  });

  it('sends its held item, dance and a Strider seat in the mob snapshot', () => {
    const m = { id: 5, type: 'hoverling', x: 1, y: 2, z: 3, yaw: 0, health: 20, held: { id: I.BONE, count: 1 }, dancing: true, body: { onGround: false } };
    const s = unpackMob(JSON.parse(JSON.stringify(packMob(m))));
    expect(s).toMatchObject({ heldItem: I.BONE, dancing: true, saddled: false, passenger: -1 });
    const st = unpackMob(packMob({ id: 6, type: 'dune_strider', x: 0, y: 0, z: 0, yaw: 0, health: 32, saddled: true, passengerId: 2, body: { onGround: true } }));
    expect(st).toMatchObject({ saddled: true, passenger: 2, heldItem: 0, dancing: false });
  });

  it('waits in a dark oak cage beside each Marauder outpost', () => {
    const gen = new TerrainGenerator(12345);
    const o = outpostsNear(gen, -3000, -3000, 3000, 3000)[0];
    expect(o).toBeTruthy();
    const kx = o.cx + CAGE.dx, kz = o.cz + CAGE.dz, cx = Math.floor(kx / 16), cz = Math.floor(kz / 16);
    const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME);
    stampOutposts(gen, blocks, meta, cx, cz);
    const at = (x, y, z) => (Math.floor(x / 16) === cx && Math.floor(z / 16) === cz ? blocks[cidx(x - cx * 16, y, z - cz * 16)] : null);
    expect(at(kx, o.y, kz)).toBe(B.AIR);
    expect(at(kx, o.y + 1, kz)).toBe(B.AIR);
    expect(at(kx, o.y + 2, kz)).toBe(B.DARK_OAK_SLAB);
    expect(at(kx, o.y - 1, kz)).toBe(B.COBBLESTONE);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const id = at(kx + dx, o.y, kz + dz);
      if (id !== null) expect(id).toBe(B.DARK_OAK_FENCE);
    }
  });
});
