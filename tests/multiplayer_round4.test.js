// Multiplayer round 4: flood meters, interpolation, distance-tiered snapshots, guests riding mounts,
// shared waypoints, host settings and the stand-in a guest leaves for mob AI (no network needed).
import { describe, it, expect } from 'vitest';
import { TokenBucket, GuestMeter, allowedEdits, updateEvery, sendsNow, Rate, STRIKES_WARN, STRIKES_KICK } from '../src/net/guard.js';
import { SnapshotBuffer, JitterEstimator, deadReckon, velocityBetween, EXTRAPOLATE_MAX_MS } from '../src/net/interp.js';
import { packPlayerState, unpackPlayerState, packMob, unpackMob, PF, driverBits, MAX_PLAYERS, packEntity } from '../src/net/protocol.js';
import { riderInput, cleanSteer, driverRefusal, guestWantsMount, STEER_TTL } from '../src/mobs/mounts.js';
import { guestSeatFor, guestWantsSeat } from '../src/mobs/duneStrider.js';
import { SocialState, runSocial, pingBars, cleanWaypointName, MAX_WAYPOINTS } from '../src/net/social.js';
import { makeTarget } from '../src/net/remotePlayer.js';
import { gazeProvokes } from '../src/mobs/pumpkins.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { Mob } from '../src/mobs/mob.js';
import { I, ITEMS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';

const wire = (x) => JSON.parse(JSON.stringify(x));

describe('flood meters', () => {
  it('a token bucket refills with time and never holds more than its burst', () => {
    const b = new TokenBucket(10, 5, 0);
    for (let i = 0; i < 5; i++) expect(b.take(1, 0)).toBe(true);
    expect(b.take(1, 0)).toBe(false);
    expect(b.take(1, 100)).toBe(true); // 100 ms = 1 token
    expect(b.take(1, 100)).toBe(false);
    b.take(0, 60000);
    expect(b.tokens).toBeLessThanOrEqual(5);
  });
  it('a human pace passes, a script is cut off', () => {
    const m = new GuestMeter(0);
    let ok = 0;
    for (let i = 0; i < 50; i++) if (m.allow('hit', i * 100)) ok++; // 10 hits a second for 5 s
    expect(ok).toBe(50);
    const s = new GuestMeter(0);
    ok = 0;
    for (let i = 0; i < 500; i++) if (s.allow('hit', 1000 + i)) ok++; // 1000 a second
    expect(ok).toBeLessThan(60);
    expect(s.dropped).toBeGreaterThan(400);
  });
  it('kinds are metered apart and unknown messages are never dropped', () => {
    const m = new GuestMeter(0);
    for (let i = 0; i < 100; i++) m.allow('chat', 0);
    expect(m.allow('chat', 0)).toBe(false);
    expect(m.allow('take', 0)).toBe(true);
    expect(m.allow('st', 0)).toBe(true);
    expect(m.allow('ka', 0)).toBe(true);
  });
  it('a guest that keeps flooding is warned about once and finally kicked', () => {
    const m = new GuestMeter(0);
    expect(m.verdict()).toBe('ok');
    for (let i = 0; i < STRIKES_WARN + 10; i++) m.allow('chat', 5000 + i);
    expect(m.verdict()).toBe('warn');
    m.warned = true;
    expect(m.verdict()).toBe('ok');
    for (let i = 0; i < STRIKES_KICK; i++) m.allow('chat', 5000 + i);
    expect(m.verdict()).toBe('kick');
  });
  it('a long quiet spell wipes the strikes', () => {
    const m = new GuestMeter(0);
    for (let i = 0; i < 200; i++) m.allow('chat', 100);
    expect(m.strikes).toBeGreaterThan(0);
    m.allow('chat', 100 + 60000);
    expect(m.strikes).toBe(0);
  });
  it('an edit batch lets a legal prefix land', () => {
    const m = new GuestMeter(0);
    expect(allowedEdits(m, 10, 0)).toBe(10);
    expect(allowedEdits(m, 1000, 0)).toBeLessThan(400);
    expect(allowedEdits(m, 1000, 0)).toBe(0);
  });
  it('the host drops flooded messages and tells the host once, then kicks', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    const chat = [];
    h.game = { chat: { add: (l) => chat.push(l) } };
    const kicked = [];
    h.kickPlayer = (n, why) => kicked.push([n, why]);
    const c = { name: 'Bob', meter: new GuestMeter(0) };
    let passed = 0;
    for (let i = 0; i < 20000; i++) if (h.meter(c, { t: 'chat', m: 'x' }, 1000)) passed++;
    expect(passed).toBeLessThan(20);
    expect(chat.filter((l) => /too fast/.test(l)).length).toBe(1);
    expect(kicked[0][0]).toBe('Bob');
    expect(h.meter(c, { t: 'st' }, 5)).toBe(true);
  });
});

describe('distance-tiered snapshots', () => {
  it('near things are sent every time, far mobs thin out, fast things never do', () => {
    expect(updateEvery('mob', 10)).toBe(1);
    expect(updateEvery('mob', 40)).toBe(2);
    expect(updateEvery('mob', 70)).toBe(4);
    expect(updateEvery('item', 70)).toBe(4);
    expect(updateEvery('arrow', 70)).toBe(1);
    expect(updateEvery('boat', 70)).toBe(1);
  });
  it('a backed-up link pulls the rings in', () => {
    expect(updateEvery('mob', 20, 0)).toBe(1);
    expect(updateEvery('mob', 20, 1)).toBe(2);
    expect(updateEvery('mob', 40, 2)).toBe(4);
  });
  it('the phase differs per entity, so every entity is sent once per period', () => {
    for (const every of [2, 4]) {
      for (const id of [1000001, 1000002, 1000007]) {
        let n = 0;
        for (let k = 0; k < every * 5; k++) if (sendsNow(every, id, k)) n++;
        expect(n).toBe(5);
      }
    }
    expect(sendsNow(1, 5, 3)).toBe(true);
  });
  it('a bandwidth readout settles on the bytes per second', () => {
    const r = new Rate();
    r.tick(0);
    for (let s = 1; s <= 10; s++) { r.add(5000); r.tick(s * 1000); }
    expect(r.bps).toBeGreaterThan(4500);
    expect(r.bps).toBeLessThanOrEqual(5000);
  });
});

describe('interpolation of remote movement', () => {
  const snap = (x, yaw = 0) => ({ x, y: 64, z: 0, yaw, pitch: 0 });
  function feed(buf, n, dt = 100, speed = 0.5) { for (let i = 0; i < n; i++) buf.push(snap(i * speed), i * dt); }
  it('shows the middle of the two snapshots around a moment a little in the past', () => {
    const b = new SnapshotBuffer();
    feed(b, 20);
    const s = b.sample(1900); // newest arrived at 1900; shown ~delay ms back
    const exp = (1900 - b.delay) / 100 * 0.5;
    expect(s.extrapolated).toBe(false);
    expect(s.x).toBeCloseTo(exp, 1);
  });
  it('a late snapshot is covered by the last speed, but only for a moment', () => {
    const b = new SnapshotBuffer();
    feed(b, 20);
    const newest = 19 * 0.5;
    const s1 = b.sample(1900 + b.delay + 120);
    expect(s1.extrapolated).toBe(true);
    expect(s1.x).toBeGreaterThan(newest);
    const s2 = b.sample(1900 + 60000);
    expect(s2.x - newest).toBeLessThanOrEqual(0.5 / 100 * EXTRAPOLATE_MAX_MS + 1e-6);
  });
  it('a teleport is not glided through', () => {
    const b = new SnapshotBuffer();
    feed(b, 5);
    b.push(snap(500), 600);
    expect(b.snaps.length).toBe(1);
    expect(b.sample(700).x).toBe(500);
  });
  it('angles turn the short way round', () => {
    const b = new SnapshotBuffer();
    b.push(snap(0, 3.0), 0); b.push(snap(0, -3.0), 100);
    b.est.interval = 100; b.est.jitter = 0;
    const s = b.sample(100 + b.delay - 50);
    expect(Math.abs(s.yaw)).toBeGreaterThan(2.9); // through pi, not through 0
  });
  it('the render delay follows the jitter, within bounds', () => {
    const calm = new JitterEstimator(), rough = new JitterEstimator();
    let t = 0, u = 0;
    for (let i = 0; i < 100; i++) { calm.push(t += 100); rough.push(u += i % 2 ? 40 : 190); }
    expect(rough.delay).toBeGreaterThan(calm.delay);
    expect(calm.delay).toBeGreaterThanOrEqual(90);
    expect(rough.delay).toBeLessThanOrEqual(400);
  });
  it('mobs: dead reckoning is capped and velocity ignores jumps', () => {
    const v = velocityBetween({ x: 0, z: 0 }, { x: 1, z: 0 }, 100);
    expect(v.x).toBeCloseTo(0.01);
    expect(deadReckon({ x: 1, y: 2, z: 3 }, v, 100)).toEqual([2, 2, 3]);
    expect(deadReckon({ x: 1, y: 2, z: 3 }, v, 5000)[0]).toBeCloseTo(1 + 0.01 * EXTRAPOLATE_MAX_MS);
    expect(deadReckon({ x: 1, y: 2, z: 3 }, null, 100)).toEqual([1, 2, 3]);
    expect(velocityBetween({ x: 0, z: 0 }, { x: 50, z: 0 }, 100)).toBe(null);
    expect(velocityBetween(null, { x: 0, z: 0 }, 100)).toBe(null);
  });
});

describe('what a guest sends of itself', () => {
  it('sprinting travels as a flag older peers ignore', () => {
    const a = packPlayerState({ x: 1, y: 2, z: 3, yaw: 0, pitch: 0, sprinting: true, inventory: { armor: [null, null, null, null] } }, null, 0);
    expect(a[6] & PF.SPRINT).toBe(PF.SPRINT);
    expect(unpackPlayerState(wire(a)).sprinting).toBe(true);
    expect(unpackPlayerState(wire(packPlayerState({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, inventory: {} }, null, 0))).sprinting).toBe(false);
  });
  it('the mob snapshot keeps its 25 fields and names the driver in the high bits of flags2', () => {
    const base = { kind: 'mob', id: 9, type: 'galloper', x: 1, y: 64, z: 2, yaw: 0, headPitch: 0, health: 8, hurtTime: 0, deathTime: 0, body: { onGround: true }, woolColor: 0, fuse: 0, age: 0, saddled: true };
    const host = { isPlayer: true }, rp = { id: 3 }, guest = { isPlayer: true, remote: rp };
    const idOf = (h) => (h === host ? 0 : h.remote ? h.remote.id : -1);
    expect(packMob(base, idOf).length).toBe(25);
    expect(unpackMob(wire(packMob(base, idOf)))).toMatchObject({ saddled: true, driver: -1 });
    expect(unpackMob(wire(packMob({ ...base, rider: guest }, idOf)))).toMatchObject({ saddled: true, driver: 3 });
    expect(unpackMob(wire(packMob({ ...base, rider: host }, idOf)))).toMatchObject({ saddled: true, driver: 0 });
    // an older peer reads only the low bits: still saddled, not dancing
    const f2 = packMob({ ...base, rider: guest }, idOf)[21];
    expect(f2 & 1).toBe(1);
    expect(f2 & 2).toBe(0);
    expect(driverBits(-1)).toBe(0);
    expect(unpackEntity0(packEntity({ ...base, rider: guest }, undefined, idOf)).driver).toBe(3);
  });
  it('the stand-in carries what mob AI reads: worn armour, sprinting, a bag that can be asked for armour', () => {
    const rp = { id: 1, name: 'Bo', session: null, state: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, armor: [B.CARVED_PUMPKIN, 0, 0, 0], sprinting: true, held: null } };
    const t = makeTarget(rp);
    expect(t.inventory.armor[0].id).toBe(B.CARVED_PUMPKIN);
    expect(t.inventory.armor[1]).toBe(null);
    expect(t.sprinting).toBe(true);
    expect(gazeProvokes(t)).toBe(false); // a Voidwalker does not take a pumpkin-faced guest's gaze as a challenge
    rp.state.armor = [null, null, null, null];
    expect(gazeProvokes(t)).toBe(true);
    expect(() => t.inventory.changed()).not.toThrow();
  });
  it('one entity that throws is isolated; a creature that keeps failing is removed', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    h.game = {};
    const bad = { kind: 'mob', type: 'x', tick() { throw new Error('boom'); } };
    for (let i = 0; i < 19; i++) h.guardTick(bad);
    expect(bad.dead).toBeUndefined();
    h.guardTick(bad);
    expect(bad.dead).toBe(true);
    expect(bad.removed).toBe(true);
    let n = 0;
    const flaky = { kind: 'mob', tick() { if (n++ % 2) throw new Error('x'); } };
    for (let i = 0; i < 100; i++) h.guardTick(flaky);
    expect(flaky.dead).toBeUndefined(); // failures that are not in a row never add up
  });
});
function unpackEntity0(a) { return unpackMob(wire(a).slice(1)); }

describe('guests riding mounts', () => {
  const g = (ticks = 100) => ({ ticks, boatInput: { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false } });
  const gallop = () => { const m = new Mob('galloper', 0, 64, 0); m.tamed = true; m.saddled = true; return m; };
  it('the reins are the host keys, or the last fresh steer of the guest in the saddle', () => {
    const m = gallop();
    m.rider = { isPlayer: true };
    expect(riderInput(m, g()).forward).toBe(1);
    m.rider = { isPlayer: true, isRemotePlayer: true };
    expect(riderInput(m, g()).forward).toBe(0); // nothing heard yet
    m.remoteInput = cleanSteer({ f: 1, s: -1, j: 1, sp: 1 }, 100);
    expect(riderInput(m, g(100 + STEER_TTL))).toMatchObject({ forward: 1, strafe: -1, jump: true, sprint: true });
    expect(riderInput(m, g(100 + STEER_TTL + 1)).forward).toBe(0); // a lost message must not leave it running
  });
  it('steering is clamped and cleaned', () => {
    expect(cleanSteer({ f: 50, s: 'x', j: 0 }, 5)).toMatchObject({ forward: 1, strafe: 0, jump: false, at: 5 });
    expect(cleanSteer({ f: -9, s: -9 }, 5)).toMatchObject({ forward: -1, strafe: -1 });
  });
  it('the host refuses wild, untacked, taken, young or dying mounts and rides for a tacked-up one', () => {
    const m = gallop();
    expect(driverRefusal(m)).toBe(null);
    m.tamed = false; expect(driverRefusal(m)).toBe('wild'); m.tamed = true;
    m.saddled = false; expect(driverRefusal(m)).toBe('needs tack'); m.saddled = true;
    m.rider = {}; expect(driverRefusal(m)).toBe('taken'); m.rider = null;
    m.age = -100; expect(driverRefusal(m)).toBe('cannot be ridden now'); m.age = 0;
    m.deathTime = 3; expect(driverRefusal(m)).toBe('cannot be ridden now');
    expect(driverRefusal(new Mob('fleecer', 0, 64, 0))).toBe('not rideable');
    // a Thistlehorn also needs its harness
    const t = new Mob('thistlehorn', 0, 64, 0);
    t.tamed = true; t.saddled = true;
    expect(driverRefusal(t)).toBe('needs tack');
    t.equip = { hand: null, armor: [{ id: I.THISTLE_HARNESS, count: 1, damage: 0 }, null, null, null] };
    expect(driverRefusal(t)).toBe(null);
  });
  it('a guest climbs on a free tame saddled Galloper with an empty hand, not with food or tack in it', () => {
    const m = gallop(), p = { riding: null, sneaking: false };
    m.netDriver = -1;
    expect(guestWantsMount(m, p, null)).toBe(true);
    expect(guestWantsMount(m, p, { id: I.SADDLE, count: 1 })).toBe(false);
    expect(guestWantsMount(m, p, { id: m.def.food.find((id) => ITEMS[id].food), count: 1 })).toBe(false);
    expect(guestWantsMount(m, { riding: {}, sneaking: false }, null)).toBe(false);
    expect(guestWantsMount(m, { riding: null, sneaking: true }, null)).toBe(false);
    m.netDriver = 2; expect(guestWantsMount(m, p, null)).toBe(false); // somebody else holds the reins
    m.netDriver = -1; m.tamed = false; expect(guestWantsMount(m, p, null)).toBe(false);
  });
  it('a Strider seats a guest in front when nobody steers it, behind when somebody does', () => {
    const m = new Mob('dune_strider', 0, 64, 0), p = { riding: null, sneaking: false };
    m.saddled = true;
    expect(guestSeatFor(m, p, null)).toBe(0);
    m.netDriver = 0;
    expect(guestSeatFor(m, p, null)).toBe(1);
    m.passengerId = 4;
    expect(guestSeatFor(m, p, null)).toBe(-1);
    expect(guestWantsSeat(m, p, null)).toBe(false);
  });
  it('the host seats the guest, takes its steering, and frees the saddle when it goes', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    const sent = [];
    const target = { isPlayer: true, isRemotePlayer: true, x: 0, y: 64, z: 0, dead: false, remote: { id: 2 } };
    const c = { id: 2, name: 'Bo', rp: { state: { x: 0, y: 64, z: 0 }, target }, ch: { send: (m) => sent.push(m) } };
    h.game = { ticks: 10 };
    const m = gallop();
    m.kind = 'mob';
    h.remoteMobSeat(c, m, { on: 1, seat: 0 });
    expect(m.rider).toBe(target);
    h.remoteMobSeat(c, m, { on: 1, seat: 0 }); // asking twice changes nothing
    expect(m.rider).toBe(target);
    const other = { ...c, id: 3, rp: { ...c.rp, target: { ...target, remote: { id: 3 } } } };
    h.remoteMobSeat(other, m, { on: 1, seat: 0 });
    expect(sent.pop()).toEqual({ t: 'rno', id: m.id }); // the seat is taken: they get off at once
    h.remoteMobSeat(c, m, { on: 0 });
    expect(m.rider).toBe(null);
    // a guest too far away is refused
    c.rp.state.x = 40;
    h.remoteMobSeat(c, m, { on: 1, seat: 0 });
    expect(m.rider).toBe(null);
    expect(sent.pop()).toEqual({ t: 'rno', id: m.id });
  });
});

describe('shared waypoints', () => {
  const env = (social, at = { x: 10, y: 64, z: -5, dim: 'overworld' }) => ({ social, hostName: 'Host', online: () => ['Host', 'Ann', 'Bo'], posOf: () => at, waypointsChanged() { env.changed++; }, teamChanged() {} });
  env.changed = 0;
  it('/wp add marks where the sender stands; everybody sees it unless it belongs to a team', () => {
    const s = new SocialState();
    expect(runSocial(env(s), 'Ann', '/wp add Base')[0]).toMatch(/Marked waypoint Base for everybody/);
    expect(s.waypointsFor('Bo').map((w) => w.name)).toEqual(['Base']);
    s.create('Ann', 'Red');
    runSocial(env(s), 'Ann', '/wp add Mine');
    expect(s.waypointsFor('Bo').map((w) => w.name)).toEqual(['Base']); // Bo is not in Red
    s.join('Bo', 'Red');
    expect(s.waypointsFor('Bo').map((w) => w.name).sort()).toEqual(['Base', 'Mine']);
    expect(s.waypointsFor('Host').map((w) => w.name)).toEqual(['Base']);
  });
  it('only the maker or an op removes one; the list shows the distance', () => {
    const s = new SocialState();
    runSocial(env(s), 'Ann', '/wp add Base');
    expect(runSocial(env(s), 'Bo', '/wp del Base')[0]).toMatch(/Only Ann/);
    expect(runSocial(env(s, { x: 10, y: 64, z: 5, dim: 'overworld' }), 'Bo', '/wp list')[0]).toMatch(/Base: 10, 64, -5 - 10 m/);
    expect(runSocial(env(s), 'Host', '/wp del Base')[0]).not.toMatch(/Only/);
    expect(s.waypoints.size).toBe(0);
    expect(runSocial(env(s), 'Ann', '/wp list')[0]).toMatch(/No waypoints/);
  });
  it('another guest cannot take over a name, and there is a cap', () => {
    const s = new SocialState();
    runSocial(env(s), 'Ann', '/wp add Base');
    expect(runSocial(env(s), 'Bo', '/wp add base')[0]).toMatch(/already marks/);
    expect(runSocial(env(s), 'Ann', '/wp add Base')[0]).toMatch(/Moved/);
    for (let i = 0; i < MAX_WAYPOINTS + 5; i++) s.addWaypoint('Ann', 'w' + i, { x: 0, y: 0, z: 0 });
    expect(s.waypoints.size).toBe(MAX_WAYPOINTS);
    expect(s.addWaypoint('Ann', '', { x: 0, y: 0, z: 0 }).ok).toBe(false);
    expect(s.addWaypoint('Ann', 'nan', { x: NaN, y: 0, z: 0 }).ok).toBe(false);
    expect(cleanWaypointName('a b<c>d'.repeat(5)).length).toBeLessThanOrEqual(16);
  });
  it('they are saved with the world and survive the wire', () => {
    const s = new SocialState();
    s.create('Ann', 'Red');
    s.addWaypoint('Ann', 'Mine', { x: 1.26, y: 2, z: 3, dim: 'cinderdeep' });
    const back = SocialState.from(JSON.parse(JSON.stringify(s.save())));
    expect(back.waypoints.get('mine')).toMatchObject({ name: 'Mine', x: 1.3, dim: 'cinderdeep', by: 'Ann', team: 'Red' });
    expect(SocialState.waypointsFromWire(wire(s.waypointsToWire('Ann')))).toEqual([{ name: 'Mine', x: 1.3, y: 2, z: 3, dim: 'cinderdeep', by: 'Ann' }]);
    expect(SocialState.waypointsFromWire([['x', 'bad', 1, 2], 5, null])).toEqual([]);
    expect(SocialState.from({ waypoints: [{ name: 'a', x: 'q' }, null] }).waypoints.size).toBe(0);
  });
});

describe('player list and host settings', () => {
  it('latency bars: unknown is none, quick is four', () => {
    expect(pingBars(-1)).toBe(0);
    expect(pingBars(NaN)).toBe(0);
    expect(pingBars(20)).toBe(4);
    expect(pingBars(100)).toBe(3);
    expect(pingBars(180)).toBe(2);
    expect(pingBars(900)).toBe(1);
  });
  it('max players is clamped to 2..8 and a full world turns the next guest away', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    h.setOptions = ClientSession.prototype.setOptions;
    h.sendEnv = () => {};
    HostSession.prototype.setOptions.call(h, { mp: 1 });
    expect(h.maxPlayers).toBe(2);
    HostSession.prototype.setOptions.call(h, { mp: 50 });
    expect(h.maxPlayers).toBe(MAX_PLAYERS);
    HostSession.prototype.setOptions.call(h, { mp: 3, ffa: true, pvp: false });
    expect(h.maxPlayers).toBe(3);
    expect(h.friendlyFireAll).toBe(true);
    expect(h.pvp).toBe(false);
    // a guest cannot change the host's limit
    const c = new ClientSession('Bo');
    c.setOptions({ mp: 2, ffa: true });
    expect(c.maxPlayers).toBeUndefined();
    expect(c.friendlyFireAll).toBe(true);
  });
  it('friendly fire for all overrides a team that has it off', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    h.social.create('Ann', 'Red');
    h.social.join('Bo', 'Red');
    const a = { isPlayer: true, netName: 'Ann' }, b = { isPlayer: true, netName: 'Bo' };
    expect(h.blocksPvp(a, b)).toBe(true);
    h.friendlyFireAll = true;
    expect(h.blocksPvp(a, b)).toBe(false);
  });
  it('the connection warning shows after a silence and goes when the host is heard again', () => {
    const c = new ClientSession('Bo');
    const made = [];
    const fake = () => { const el = { id: '', textContent: '', classList: { s: new Set(), toggle(k, on) { if (on) this.s.add(k); else this.s.delete(k); }, contains(k) { return this.s.has(k); } }, setAttribute() {}, remove() {} }; made.push(el); return el; };
    globalThis.document = { createElement: fake, body: { appendChild() {} }, getElementById: (id) => made.find((e) => e.id === id) || null };
    c.lastSeen = 0;
    c.updateWarning(1000);
    expect(document.getElementById('netwarn')).toBe(null);
    c.updateWarning(6000);
    const el = document.getElementById('netwarn');
    expect(el.textContent).toMatch(/No news from the host for 6 s/);
    expect(el.classList.contains('hidden')).toBe(false);
    c.lastSeen = 6000;
    c.updateWarning(6100);
    expect(el.classList.contains('hidden')).toBe(true);
    delete globalThis.document;
  });
});

describe('content pack on a guest', () => {
  it('a Wickling sets a guest alight through one message, at most once a second', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    const sent = [];
    const target = { dead: false, creative: false };
    const rp = { id: 2, target };
    h.clients.set(2, { id: 2, ch: { send: (m) => sent.push(m) } });
    h.burnRemote(rp, 100);
    h.burnRemote(rp, 100);
    expect(sent).toEqual([{ t: 'burn', d: 100 }]);
    target.creative = true;
    h.clients.get(2).burnAt = -1e9;
    h.burnRemote(rp, 100);
    expect(sent.length).toBe(1);
    h.clients.get(2).burnAt = -1e9;
    target.creative = false;
    const t = makeTarget({ id: 2, name: 'Bo', state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, session: h, target });
    t.fireTicks = 160;
    expect(sent.length).toBe(2);
    expect(typeof t.fireTicks).toBe('number');
  });
});
