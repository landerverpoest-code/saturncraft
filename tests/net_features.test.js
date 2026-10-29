// Multiplayer messages for leads, name tags, the Deep Hush, raids and armour stands (no network needed).
import { describe, it, expect } from 'vitest';
import { MockWorld } from './helpers.js';
import { packMob, unpackMob, packEntity, unpackEntity, packLeash, unpackLeash, StandRequests } from '../src/net/protocol.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { EntityMirror } from '../src/net/entityMirror.js';
import { LeashKnot, knotAt, isHolder, heldBy, leash } from '../src/entities/leash.js';
import { HushSystem, remoteVibration, REMOTE_STEP_EVERY } from '../src/world/hushSystem.js';
import { DARKNESS_TICKS, SHRIEKER_CAN_SUMMON } from '../src/world/deepHush.js';
import { RaidState, RAID, Raids, raidStatus, raidBarFor, championsOf, RAID_RADIUS, RAID_BAR_DIST, CHAMPION_TICKS } from '../src/mobs/raids.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';

const wire = (x) => JSON.parse(JSON.stringify(x));
const baseMob = (o = {}) => ({ kind: 'mob', id: 1000005, type: 'fleecer', x: 1, y: 64, z: 2, yaw: 0, headPitch: 0, health: 8, hurtTime: 0, deathTime: 0, body: { onGround: true }, woolColor: 0, fuse: 0, age: 0, ...o });

/** A guest seen from the host: its connection and stand-in. */
function guest(id, name, state) {
  const sent = [];
  const rp = { id, name, state, target: null };
  rp.target = { isPlayer: true, isRemotePlayer: true, remote: rp, netName: name, get x() { return rp.state.x; }, get y() { return rp.state.y; }, get z() { return rp.state.z; }, get dead() { return !!rp.state.dead; }, effects: [], addEffect(t, d, a) { this.effects.push([t, d, a]); return true; } };
  return { id, name, joined: true, rp, ch: { send: (m) => sent.push(wire(m)), conn: { send() {} } }, sent };
}

describe('mob snapshots: names, leads and the Hushkeeper', () => {
  it('round-trip a name, who holds the lead and the rising / sinking state', () => {
    const host = { isPlayer: true }, rp = { id: 3 }, guestT = { isPlayer: true, remote: rp };
    const idOf = (h) => (h === host ? 0 : h.remote ? h.remote.id : -1);
    const a = unpackMob(wire(packMob(baseMob({ customName: 'Woolly', leashHolder: guestT }), idOf)));
    expect(a).toMatchObject({ name: 'Woolly', leash: { player: 3 }, emerging: 0, digging: 0 });
    expect(unpackMob(wire(packMob(baseMob({ leashHolder: host }), idOf))).leash).toEqual({ player: 0 });
    const knot = new LeashKnot(4, 65, -7);
    expect(unpackMob(wire(packMob(baseMob({ leashHolder: knot }), idOf))).leash).toEqual({ knot: [4, 65, -7] });
    const keeper = unpackMob(wire(packMob(baseMob({ type: 'hushkeeper', emerging: 120 }))));
    expect(keeper).toMatchObject({ emerging: 120, digging: 0, name: null, leash: null });
    expect(unpackMob(wire(packMob(baseMob({ type: 'hushkeeper', digging: 40 })))).digging).toBe(40);
    // through the entity wrapper too
    expect(unpackEntity(wire(packEntity(baseMob({ customName: 'Bo', leashHolder: host }), undefined, idOf)))).toMatchObject({ kind: 'mob', name: 'Bo', leash: { player: 0 } });
  });
  it('drop unknown holders and garbage', () => {
    expect(packLeash({ isPlayer: true })).toBe(0); // a player without an id
    expect(packLeash(null)).toBe(0);
    expect(unpackLeash(['p', -1])).toBe(null);
    expect(unpackLeash(['k', 1, 'x', 3])).toBe(null);
    expect(unpackLeash(['q', 1])).toBe(null);
    expect(unpackLeash(0)).toBe(null);
    const old = packMob(baseMob()).slice(0, 16); // a snapshot from before these fields
    expect(unpackMob(old)).toMatchObject({ name: null, leash: null, emerging: 0, digging: 0 });
    const long = packMob(baseMob({ customName: 'x'.repeat(80) }));
    expect(unpackMob(wire(long)).name.length).toBe(32);
  });
});

describe('guest mirror of leads and names', () => {
  function mirror() {
    const list = [];
    const me = { isPlayer: true, x: 0, y: 64, z: 0 };
    const g = { player: me, ticks: 0, entities: { list, add: (e) => { list.push(e); return e; } }, world: { isLoaded: () => true } };
    const remote = { anchor: { isPlayer: true, x: 5, y: 64, z: 5 } };
    const session = { id: 2, remotes: new Map([[0, remote]]) };
    return { g, me, remote, m: new EntityMirror(g, session) };
  }
  it('resolves holders to us, another player or a local fence knot', () => {
    const { g, me, remote, m } = mirror();
    expect(m.leashHolder({ player: 2 })).toBe(me);
    expect(m.leashHolder({ player: 0 })).toBe(remote.anchor);
    expect(m.leashHolder({ player: 9 })).toBe(null);
    const k = m.leashHolder({ knot: [3, 65, 3] });
    expect(k.kind).toBe('knot');
    expect(k.mirrored).toBe(true);
    expect(m.leashHolder({ knot: [3, 65, 3] })).toBe(k); // one knot per post
    // a mirrored knot never drops leads itself; it goes when nothing is tied to it
    g.world.getBlock = () => B.AIR;
    k.tick(g);
    expect(k.dead).toBe(true);
    expect(g.entities.list.filter((e) => e.kind === 'item')).toEqual([]);
  });
  it('applies the name and lead of a snapshot to the proxy mob', () => {
    const { me, m } = mirror();
    const e = { kind: 'mob', age: 0, body: {}, setBaby() {} };
    m.update(e, unpackMob(wire(packMob(baseMob({ customName: 'Puff', leashHolder: me }), (h) => (h === me ? 2 : -1)))));
    expect(e.customName).toBe('Puff');
    expect(e.leashHolder).toBe(me);
    m.update(e, unpackMob(wire(packMob(baseMob()))));
    expect(e.customName).toBe(undefined);
    expect(e.leashHolder).toBe(null);
  });
});

describe('host: leads for guests', () => {
  function hostWith(c) {
    const h = new HostSession('Host', null, 'ABCDEF');
    const knots = [];
    const g = {
      player: { isPlayer: true, x: 0, y: 64, z: 0 }, ticks: 0, audio: { play() {} },
      world: { getBlock: (x, y, z) => (x === 2 && y === 64 && z === 2 ? B.OAK_FENCE : B.AIR) },
      entities: { list: knots, add: (e) => { knots.push(e); return e; }, spawnItem: (x, y, z, st) => knots.push({ kind: 'item', st }) },
    };
    g.localPlayer = g.player;
    h.game = g;
    h.clients.set(c.id, c);
    return { h, g };
  }
  it('ties the animals a guest leads to a fence post and takes them back', () => {
    const c = guest(4, 'Ann', { x: 2, y: 64, z: 3 });
    const { h, g } = hostWith(c);
    const sheep = { kind: 'mob', x: 3, y: 64, z: 3, dead: false };
    g.entities.list.push(sheep);
    leash(sheep, c.rp.target);
    expect(isHolder(sheep.leashHolder, Object.create(c.rp.target))).toBe(true); // the interaction's one-off actor counts as the guest
    expect(isHolder(sheep.leashHolder, g.player)).toBe(false);
    h.onMessage(c, { t: 'fence', x: 2, y: 64, z: 2 });
    expect(sheep.leashHolder).toBe(knotAt(g, 2, 64, 2));
    h.onMessage(c, { t: 'fence', x: 2, y: 64, z: 2 });
    expect(sheep.leashHolder).toBe(c.rp.target);
    // too far away: nothing
    c.rp.state = { x: 40, y: 64, z: 40 };
    h.onMessage(c, { t: 'fence', x: 2, y: 64, z: 2 });
    expect(sheep.leashHolder).toBe(c.rp.target);
    expect(heldBy(g, c.rp.target)).toEqual([sheep]);
  });
});

describe('armour stands: no duplication', () => {
  const inv = (st) => ({ selected: 0, slots: [st, null, null], add(s) { const i = this.slots.indexOf(null); if (i < 0) return s.count; this.slots[i] = s; return 0; } });
  const addStack = (iv, st) => iv.add(st);

  it('takes the item out of the hand at once and hands back what came off the stand', () => {
    const r = new StandRequests(), v = inv({ id: I.STICK, count: 3, damage: 0 });
    const { rid, st } = r.begin(v, 0);
    expect(st).toEqual({ id: I.STICK, count: 3, damage: 0 });
    expect(v.slots[0]).toBe(null); // gone from the hand before the host has answered
    expect(r.finish(v, wire({ rid, ok: 1, give: { id: I.BONE, count: 1, damage: 0 } }), addStack)).toEqual([]);
    expect(v.slots[0]).toEqual({ id: I.BONE, count: 1, damage: 0 });
    expect(r.pending.size).toBe(0);
  });
  it('gives the item back when the host refuses, into another slot if the hand is busy', () => {
    const r = new StandRequests(), v = inv({ id: I.STICK, count: 1, damage: 0 });
    const { rid } = r.begin(v, 0);
    v.slots[0] = { id: I.BONE, count: 1, damage: 0 }; // picked something up meanwhile
    r.finish(v, { rid, ok: 0 }, addStack);
    expect(v.slots).toEqual([{ id: I.BONE, count: 1, damage: 0 }, { id: I.STICK, count: 1, damage: 0 }, null]);
  });
  it('never doubles an item when the answer is lost', () => {
    const r = new StandRequests(), v = inv({ id: I.STICK, count: 2, damage: 0 });
    r.begin(v, 0, 0);
    r.expire(60000);
    expect(r.pending.size).toBe(0);
    expect(v.slots.filter(Boolean)).toEqual([]); // the host's stand has it; the guest no longer does
  });
  it('host always answers with the request id (ok or refused)', () => {
    const c = guest(5, 'Bea', { x: 0, y: 64, z: 0 });
    const h = new HostSession('Host', null, 'ABCDEF');
    const stand = { id: 77, kind: 'stand', x: 1, y: 64, z: 0, armor: [null, null, null, null], hand: { id: I.BONE, count: 1, damage: 0 }, dead: false };
    h.game = { entities: { list: [stand] }, audio: { play() {} } };
    h.clients.set(c.id, c);
    h.onMessage(c, { t: 'stuse', id: 77, st: { id: I.STICK, count: 2, damage: 0 }, y: 1, rid: 9 });
    expect(c.sent.at(-1)).toEqual({ t: 'stgot', rid: 9, ok: 1, give: { id: I.BONE, count: 1, damage: 0 } });
    expect(stand.hand).toEqual({ id: I.STICK, count: 2, damage: 0 });
    h.onMessage(c, { t: 'stuse', id: 999, st: { id: I.STICK, count: 1, damage: 0 }, y: 1, rid: 10 }); // no such stand
    expect(c.sent.at(-1)).toMatchObject({ t: 'stgot', rid: 10, ok: 0 });
    h.onMessage(c, { t: 'stuse', id: 77, st: { id: I.STICK, count: 999 }, y: 1, rid: 11 }); // nonsense stack
    expect(c.sent.at(-1)).toMatchObject({ t: 'stgot', rid: 11, ok: 0 });
  });
  it('guest handles the answer', () => {
    const cs = new ClientSession('Bea');
    const spawned = [];
    const v = inv({ id: I.STICK, count: 1, damage: 0 });
    v.changed = () => {};
    Object.defineProperty(v, 'selectedStack', { get() { return this.slots[this.selected]; } });
    cs.game = { player: { x: 0, y: 64, z: 0, inventory: v }, audio: { play() {} } };
    cs.ch = { send: (m) => spawned.push(wire(m)) };
    cs.useStand({ netId: 77 }, v.selectedStack, 1.2);
    const req = spawned.at(-1);
    expect(req).toMatchObject({ t: 'stuse', id: 77, st: { id: I.STICK, count: 1 }, rid: 1 });
    expect(v.slots[0]).toBe(null);
    cs.handle({ t: 'stgot', rid: 1, ok: 1, give: null });
    expect(v.slots[0]).toBe(null); // the stand had nothing to give back
    cs.useStand({ netId: 77 }, null, 1.2);
    cs.handle({ t: 'stgot', rid: 2, ok: 1, give: { id: I.STICK, count: 1, damage: 0 } });
    expect(v.slots[0]).toEqual({ id: I.STICK, count: 1, damage: 0 });
  });
});

describe('the Deep Hush hears guests', () => {
  it('works out footsteps and landings from the states a guest sends', () => {
    const t = {};
    expect(remoteVibration(t, { x: 0, y: 60, z: 0 }, 0, B.STONE)).toBe(null); // first state
    expect(remoteVibration(t, { x: 0.4, y: 60, z: 0 }, 2, B.STONE)).toBe('step');
    expect(remoteVibration(t, { x: 0.8, y: 60, z: 0 }, 4, B.STONE)).toBe(null); // too soon after the last
    expect(remoteVibration(t, { x: 1.2, y: 60, z: 0 }, 2 + REMOTE_STEP_EVERY, B.STONE)).toBe('step');
    expect(remoteVibration(t, { x: 1.6, y: 60, z: 0, sneaking: true }, 40, B.STONE)).toBe(null); // sneaking
    expect(remoteVibration(t, { x: 2, y: 60, z: 0 }, 60, B.WOOL)).toBe(null); // on wool
    expect(remoteVibration(t, { x: 2.4, y: 60, z: 0 }, 80, B.AIR)).toBe(null); // in the air (flying)
    // a fall of two blocks, then standing on the ground
    remoteVibration(t, { x: 2.4, y: 59, z: 0 }, 82, B.AIR);
    remoteVibration(t, { x: 2.4, y: 58, z: 0 }, 84, B.AIR);
    expect(remoteVibration(t, { x: 2.4, y: 58, z: 0 }, 86, B.STONE)).toBe('land');
    expect(remoteVibration(t, { x: 2.4, y: 58, z: 0 }, 88, B.STONE)).toBe(null); // standing still
  });

  function hushGame() {
    const world = new MockWorld(60);
    world.setBlock = (x, y, z, id, meta = 0) => { world.set(x, y, z, id, meta); return true; };
    const c = guest(3, 'Guest', { x: 20.5, y: 60, z: 0.5 });
    const host = { x: 0.5, y: 60, z: 0.5, netName: 'Host', effects: {}, dead: false, body: { x: 0.5, y: 60, z: 0.5, vx: 0, vz: 0, onGround: true }, addEffect(t, d) { this.effects[t] = d; return true; } };
    const g = { ticks: 1000, world, player: host, entities: { list: [] }, spawner: { spawnMob: () => null } };
    g.net = { isHost: true, isClient: false, players: () => [{ id: 0, name: 'Host', obj: host }, { id: 3, name: 'Guest', obj: c.rp.target, c }] };
    g.hush = new HushSystem(g);
    g.hush.travel = 0; // sensors hear at once (travel time is tested in calibrated_sensors.test.js)
    return { g, world, c, host };
  }
  it('raises the warning of the guest who walked by a sensor, not the host', () => {
    const { g, world, c } = hushGame();
    world.set(23, 60, 0, B.HUSH_SENSOR, 0);
    world.set(22, 60, 3, B.HUSH_SHRIEKER, SHRIEKER_CAN_SUMMON); // (a world-grown shrieker raises the warning)
    g.hush.tick(); // first state seen
    g.ticks++;
    c.rp.state = { x: 21, y: 60, z: 0.5 };
    g.hush.tick();
    expect(world.getMeta(23, 60, 0)).toBeGreaterThan(0);
    expect(g.hush.warnings.entry('Guest').level).toBe(1);
    expect(g.hush.warnings.entry('Host').level).toBe(0);
    g.ticks++;
    g.hush.tick(); // the same state again: no second step
    expect(g.hush.noises.filter((n) => n.kind === 'step').length).toBe(1);
  });
  it('a shriek darkens guests near it through an effect', () => {
    const { g, c, host } = hushGame();
    g.hush.shriek({ x: 10, y: 59, z: 0 }, host, true);
    expect(host.effects.darkness).toBe(DARKNESS_TICKS);
    expect(c.rp.target.effects).toEqual([['darkness', DARKNESS_TICKS, 0]]);
    c.rp.target.effects.length = 0;
    c.rp.state = { x: 200, y: 60, z: 0 };
    g.hush.shriek({ x: 10, y: 59, z: 0 }, host, true);
    expect(c.rp.target.effects).toEqual([]); // too far away
  });
  it('host turns a guest breaking or placing a block into a vibration', () => {
    const c = guest(3, 'Guest', { x: 0, y: 64, z: 0 });
    const h = new HostSession('Host', null, 'ABCDEF');
    const calls = [];
    const blocks = new Map([['1,64,0', B.STONE]]);
    h.game = { world: { getBlock: (x, y, z) => blocks.get(`${x},${y},${z}`) || 0, getMeta: () => 0, isLoaded: () => true, dimension: 'overworld' }, hush: { blockEvent: (...a) => calls.push(a) }, onBlockBroken() {} };
    h.edits = { apply: (flat, accept) => { for (let i = 0; i < flat.length; i += 5) accept(flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4]); return []; } };
    h.applyGuestEdits(c, [1, 64, 0, 0, 0, 0, 65, 1, B.DIRT, 0, 1, 64, 0, B.DIRT, 0]);
    expect(calls).toEqual([[1, 64, 0, 'break', c.rp.target], [0, 65, 1, 'place', c.rp.target]]); // (stone -> dirt is neither)
  });
});

describe('raids for guests', () => {
  it('sends a status the guest shows near the village only', () => {
    const r = new RaidState({ cx: 100, cz: -50, omenLevel: 2 });
    r.step(400, { raiders: 0, settlers: 5 });
    const st = wire(raidStatus(r));
    expect(st).toMatchObject({ id: r.id, cx: 100, cz: -50, state: RAID.WAVE, label: r.label() });
    expect(raidBarFor(st, 110, -40)).toEqual({ label: r.label(), progress: r.progress(), state: RAID.WAVE });
    expect(raidBarFor(st, 100 + RAID_BAR_DIST + 1, -50)).toBe(null);
    expect(raidBarFor(null, 0, 0)).toBe(null);
    expect(raidBarFor({ cx: 'x' }, 0, 0)).toBe(null);
    expect(raidStatus(null)).toBe(null);
  });
  it('makes guests in the village champions when it is won', () => {
    const r = new RaidState({ cx: 0, cz: 0, omenLevel: 3 });
    const inside = guest(2, 'In', { x: 10, y: 64, z: 10 }), outside = guest(3, 'Out', { x: RAID_RADIUS + 5, y: 64, z: 0 });
    expect(championsOf([inside.rp.target, outside.rp.target], r)).toEqual([inside.rp.target]);
    const host = { x: 0, y: 64, z: 0, effects: {}, addEffect(t, d, a) { this.effects[t] = { d, a }; } };
    const orbs = [];
    const g = { player: host, hud: null, entities: { list: [], spawnXp: (x, y, z, v) => orbs.push(v) }, net: { isHost: true, players: () => [{ obj: host }, { obj: inside.rp.target }, { obj: outside.rp.target }] } };
    new Raids(g).won(r);
    expect(host.effects.village_champion).toEqual({ d: CHAMPION_TICKS, a: 2 });
    expect(inside.rp.target.effects).toEqual([['village_champion', CHAMPION_TICKS, 2]]);
    expect(outside.rp.target.effects).toEqual([]);
    expect(orbs.length).toBe(2);
  });
  it('guest shows the bar and a toast when the raid ends', () => {
    const cs = new ClientSession('G');
    const bars = [], toasts = [];
    cs.game = { player: { x: 0, z: 0 }, hud: { raidBar: (b) => bars.push(b), toast: (t) => toasts.push(t) } };
    const base = { id: 'r1', cx: 5, cz: 5, label: 'Raid', progress: 0.5 };
    cs.onRaidStatus({ ...base, state: 'wave' });
    cs.onRaidStatus({ ...base, state: 'wave' });
    cs.onRaidStatus({ ...base, state: 'won', progress: 1 });
    cs.onRaidStatus(null);
    expect(bars.map((b) => b && b.state)).toEqual(['wave', 'wave', 'won', null]);
    expect(toasts).toEqual(['A raid is coming! Defend the village', 'Victory! The village is saved']);
  });
});
