// Multiplayer round 6: ghost records for dropped guests, the host leaving (and keeping a local copy of the world), lag
// compensation for melee and arrows, the dead player's follow-cam, typed pings, the thrown Returning Disc seen by the others,
// and the guest-side checks of the newest features (Bounty Board hand-overs, weapons, trinkets, /retrofit being the host's).
// No network: pure logic is tested directly, the host with a fake game, as in tests/social.test.js.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../src/net/remotePlayer.js', () => ({
  heldLights: () => [],
  RemotePlayer: class {
    constructor(scene, id, name, session) {
      this.id = id; this.name = name; this.session = session; this.state = null; this.emotes = [];
      const rp = this;
      this.target = {
        isPlayer: true, isRemotePlayer: true, remote: rp, netName: name, reputation: {}, width: 0.6, height: 1.8,
        get x() { return rp.state ? rp.state.x : 0; }, get y() { return rp.state ? rp.state.y : 0; }, get z() { return rp.state ? rp.state.z : 0; },
        get dead() { return !rp.state || !!rp.state.dead; },
        eyePos() { const s = rp.state || { x: 0, y: 0, z: 0 }; return [s.x, s.y + 1.62, s.z]; },
        lookDir() { return [1, 0, 0]; }, hurt: () => true,
        inventory: { selectedStack: null }, stats: { kills: 0 },
      };
    }
    setState(s) { this.state = s; }
    playEmote(k) { this.emotes.push(k); }
    dispose() {}
  },
}));

import { PROTOCOL_VERSION, packMob } from '../src/net/protocol.js';
import { Mob } from '../src/mobs/mob.js';
import {
  REWIND_MAX_MS, HISTORY_MS, rewindMs, PositionHistory, distToMobBox, meleeHitOk, MELEE_SLACK,
} from '../src/net/lagcomp.js';
import { GhostBook, GHOST_TTL_MS } from '../src/net/ghosts.js';
import {
  PING_KINDS, cleanPingKind, pingKindFor, PingBoard, routePing, SocialState, PING_TTL_MS, pickDeathCamTarget, killerOf, RESPAWN_WAIT_S,
} from '../src/net/social.js';
import { RemoteDiscs, discAlive, DISC_STALE_MS } from '../src/render/remoteDiscs.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { EntityManager } from '../src/entities/entities.js';
import { MemoryStorage, setStorage } from '../src/world/storage.js';
import { saveGuestCopy, listWorlds, loadWorld } from '../src/world/save.js';
import { mockGame } from './fixtures/mockGame.js';
import { Quests } from '../src/player/questSystem.js';
import { WEAPONS, I } from '../src/world/items.js';
import { stunFor, backstabFactor, weaponOf, reachOf } from '../src/player/weapons.js';
import { gearTotals } from '../src/player/gear.js';
import { cleanTrinkets } from '../src/player/trinkets.js';
import { runRetrofitCommand } from '../src/world/retrofitCommand.js';
import { ACTIONS } from '../src/ui/bindings.js';
import { KIND_OF } from '../src/net/guard.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

// ---- a host wired to a fake game (as in tests/social.test.js) ------------------------------------------------------------
const wire = (x) => JSON.parse(JSON.stringify(x));
function fakeGame() {
  const chat = [];
  const g = {
    seed: 7, time: 100, weather: { save: () => ({}) }, daylightCycle: true, difficulty: 'normal', seasons: { save: () => ({}) }, worldEvents: null,
    worldSpawn: { x: 0, y: 64, z: 0 }, signs: new Map(), frames: new Map(), pots: new Map(), lecterns: new Map(), proving: null, netPlayers: {},
    scene: { add() {}, remove() {} }, ticks: 0, audio: { play() {} }, hud: { toast: vi.fn() }, running: false, lastTime: 0,
    chat: { add: (t, c) => chat.push([t, c || null]) }, chatLog: chat,
    player: { isPlayer: true, netName: 'Host', x: 0, y: 64, z: 0, yaw: 0, pitch: 0, gamemode: 'survival', hurt: vi.fn(() => true), eyePos: () => [0, 65.6, 0], lookDir: () => [0, 0, -1], setGamemode(m) { this.gamemode = m; }, setPosition(x, y, z) { Object.assign(this, { x, y, z }); } },
    world: { dimension: 'overworld', saved: new Map(), chunks: new Map(), listeners: { blockChanged: [] }, on(ev, f) { this.listeners[ev].push(f); }, raycast: () => ({ x: 3, y: 64, z: -5, id: 1 }) },
    entities: { list: [] }, chunks: { extraCenters: [] }, strikeLightning() {},
  };
  g.localPlayer = g.player;
  return g;
}
function hostWith(g = fakeGame()) {
  const h = new HostSession('Host', null, 'ABCDEF');
  h.attach(g);
  clearInterval(h.bgTimer);
  return { h, g };
}
function conn(h, id) {
  const sent = [];
  const c = { id, name: null, joined: false, lastSeen: performance.now(), minEp: 0, ch: { send: (m) => sent.push(wire(m)), conn: { send: (str) => sent.push(JSON.parse(str)), peer: 'peer-' + id }, close() {}, backlog: () => 0 }, sent };
  h.clients.set(id, c);
  return c;
}
const hello = (h, c, name, tok) => h.onMessage(c, { t: 'hello', v: PROTOCOL_VERSION, name, tok });
const sentOf = (c, t) => c.sent.filter((m) => m.t === t);
const stand = (c, x, y, z) => c.rp.setState({ x, y, z, yaw: 0, pitch: 0, held: null });

describe('wire compatibility is untouched', () => {
  it('stays at protocol 2 and the mob snapshot keeps its 25 fields', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(packMob(new Mob('galloper', 1, 64, 2), () => -1, () => -1).length).toBe(25);
  });
});

// ---- lag compensation ------------------------------------------------------------------------------------------------------
describe('lag compensation: rewinding mobs by the attacker\'s ping', () => {
  it('rewinds by the ping, never by more than 200 ms, and not at all for an unknown ping', () => {
    expect(REWIND_MAX_MS).toBe(200);
    expect(rewindMs(80)).toBe(80);
    expect(rewindMs(199.6)).toBe(200);
    expect(rewindMs(950)).toBe(200);
    expect(rewindMs(-1)).toBe(0);
    expect(rewindMs(null)).toBe(0);
    expect(rewindMs(undefined)).toBe(0);
    expect(rewindMs(NaN)).toBe(0);
  });

  it('remembers positions and interpolates between samples', () => {
    const h = new PositionHistory();
    h.record(1000, [{ id: 1, x: 0, y: 64, z: 0 }]);
    h.record(1050, [{ id: 1, x: 1, y: 64, z: 0 }]);
    h.record(1100, [{ id: 1, x: 2, y: 64, z: 0 }]);
    expect(h.at(1, 1100, 0)).toEqual({ x: 2, y: 64, z: 0 });
    expect(h.at(1, 1100, 50).x).toBeCloseTo(1, 6);
    expect(h.at(1, 1100, 75).x).toBeCloseTo(0.5, 6); // between two samples
    expect(h.at(1, 1100, 100).x).toBeCloseTo(0, 6);
    expect(h.at(1, 1100, 5000).x).toBeCloseTo(0, 6); // older than anything kept: the oldest sample
    expect(h.at(2, 1100, 50)).toBeNull();
  });

  it('forgets what is too old and the creatures that are gone', () => {
    const h = new PositionHistory();
    for (let t = 0; t <= 2000; t += 50) h.record(t, [{ id: 1, x: t / 50, y: 0, z: 0 }, ...(t < 500 ? [{ id: 2, x: 0, y: 0, z: 0 }] : [])]);
    expect(h.map.get(1).length).toBeLessThanOrEqual(HISTORY_MS / 50 + 2);
    expect(h.size).toBe(1); // mob 2 left the world
    h.clear();
    expect(h.size).toBe(0);
  });

  it('measures the reach to the mob\'s box and accepts either where it is or where it was', () => {
    const mob = { x: 10, y: 64, z: 0, width: 0.6, height: 1.8 };
    expect(distToMobBox(7, 64.5, 0, 10, 64, 0, 0.6, 1.8)).toBeCloseTo(2.7, 6);
    expect(distToMobBox(10, 65, 0, 10, 64, 0, 0.6, 1.8)).toBe(0); // inside the box
    const eye = [5, 65.6, 0];
    expect(meleeHitOk(eye, mob, null, 3)).toBe(false); // 4.7 away: out of reach 3 + slack
    expect(meleeHitOk(eye, mob, { x: 8, y: 64, z: 0 }, 3)).toBe(true); // it was in reach 200 ms ago
    expect(meleeHitOk(eye, { ...mob, x: 8 }, null, 3)).toBe(true);
    expect(meleeHitOk(eye, mob, { x: 30, y: 64, z: 0 }, 3)).toBe(false);
    // the weapon's own reach counts: a Glaive (4.5) gets the same grace on top
    expect(meleeHitOk([2, 65.6, 0], mob, null, 4.5)).toBe(false);
    expect(meleeHitOk([3.8, 65.6, 0], mob, null, 4.5)).toBe(true);
    expect(MELEE_SLACK).toBeGreaterThan(0);
  });

  function melee(mobAt, ping, now = 10_000) {
    const { h, g } = hostWith();
    vi.spyOn(performance, 'now').mockReturnValue(now);
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    stand(c, 0, 64, 0);
    c.ping = ping;
    const mob = { id: 500, kind: 'mob', deathTime: 0, x: mobAt, y: 64, z: 0, width: 0.6, height: 1.8, hurt: vi.fn(() => true) };
    g.entities.list.push(mob);
    return { h, g, c, mob };
  }

  it('a blow that lands where the mob was 100 ms ago counts, one at a mob that was never near does not', () => {
    const { h, c, mob } = melee(9, 100);
    // 100 ms ago the mob stood 4 blocks nearer; its history says so
    h.history.record(9_900, [{ id: 500, x: 4.5, y: 64, z: 0 }]);
    h.history.record(10_000, [{ id: 500, x: 9, y: 64, z: 0 }]);
    h.onMessage(c, { t: 'hit', id: 500, d: 5, k: 0.4, p: 0 });
    expect(mob.hurt).toHaveBeenCalledTimes(1);
    expect(mob.hurt.mock.calls[0][0]).toBe(5);
    // the same blow from a guest with no ping (nothing to rewind by) is out of reach
    mob.hurt.mockClear(); c.ping = -1;
    h.onMessage(c, { t: 'hit', id: 500, d: 5, k: 0.4, p: 0 });
    expect(mob.hurt).not.toHaveBeenCalled();
  });

  it('never rewinds further than 200 ms whatever the ping says', () => {
    const { h, c, mob } = melee(9, 5000);
    h.history.record(9_500, [{ id: 500, x: 3, y: 64, z: 0 }]); // 500 ms ago it was in reach, but that is out of the window
    h.history.record(9_800, [{ id: 500, x: 8.9, y: 64, z: 0 }]);
    h.history.record(10_000, [{ id: 500, x: 9, y: 64, z: 0 }]);
    h.onMessage(c, { t: 'hit', id: 500, d: 5, k: 0.4, p: 0 });
    expect(mob.hurt).not.toHaveBeenCalled();
  });

  it('a mob in plain reach is hit as before, and a thrown Returning Disc keeps its long reach', () => {
    const { h, c, mob } = melee(2.5, -1);
    h.onMessage(c, { t: 'hit', id: 500, d: 4, k: 0.4, p: 0 });
    expect(mob.hurt).toHaveBeenCalledTimes(1);
    mob.hurt.mockClear(); mob.x = 60;
    h.onMessage(c, { t: 'hit', id: 500, d: 4, k: 0.4, p: 1 }); // the disc was flown on the guest's side
    expect(mob.hurt).toHaveBeenCalledTimes(1);
    mob.hurt.mockClear(); mob.x = 200;
    h.onMessage(c, { t: 'hit', id: 500, d: 4, k: 0.4, p: 1 });
    expect(mob.hurt).not.toHaveBeenCalled();
  });

  it('a guest\'s arrow is checked against the mob where the guest saw it; others\' arrows against where it is', () => {
    const { h, g, c } = melee(9, 150);
    const mob = { id: 500, kind: 'mob', dead: false, deathTime: 0, x: 9, y: 64, z: 0, width: 0.6, height: 1.8 };
    g.entities.list = [mob];
    h.history.record(9_850, [{ id: 500, x: 4, y: 64, z: 0 }]);
    h.history.record(10_000, [{ id: 500, x: 9, y: 64, z: 0 }]);
    g.net = h; g.player = { dead: true };
    const em = new EntityManager(g);
    em.list = [mob];
    const shooter = c.rp.target;
    // an arrow flying along +x at height 64.9 that stops at x = 6: it only reaches where the mob was
    const proj = { shooter, age: 10 };
    expect(em.sweepHit(proj, 1, 64.9, 0, 1, 0, 0, 5)).toBe(mob); // the mob stood at x 4 for the guest (box x 3.55..4.45 + margin)
    // the same arrow from a shooter with no ping misses what is no longer there
    c.ping = -1;
    expect(em.sweepHit(proj, 1, 64.9, 0, 1, 0, 0, 5)).toBe(null);
    // and a mob arrow (not a guest's) is never rewound
    c.ping = 150; stand(c, 0, 64, 30); // (out of the line of fire)
    expect(em.sweepHit({ shooter: { isPlayer: false }, age: 10 }, 1, 64.9, 0, 1, 0, 0, 5)).toBe(null);
  });

  it('records only while a guest is connected', () => {
    const { h, g } = hostWith();
    g.entities.list.push({ id: 7, kind: 'mob', dead: false, x: 1, y: 2, z: 3 });
    g.interaction = { swing: 0 };
    g.player.inventory = { selectedStack: null };
    h.edits = { take: () => [] };
    h.simulateGuests = () => {}; h.tickSleep = () => {}; h.syncContainers = () => {};
    h.tick();
    expect(h.history.size).toBe(0);
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    h.tick();
    expect(h.history.size).toBe(1);
  });
});

// ---- ghost records ---------------------------------------------------------------------------------------------------------
describe('ghost records: a dropped guest can come back within a minute', () => {
  it('keeps a record for 60 s, only for the browser that left', () => {
    expect(GHOST_TTL_MS).toBe(60000);
    const b = new GhostBook();
    b.add('Ann', 'annannann1', { x: 5, y: 70, z: 6, slots: [] }, 1000);
    expect(b.get('ann', 30000).rec.x).toBe(5); // names are not case sensitive
    expect(b.left('Ann', 31000)).toBe(30);
    expect(b.claim('Ann', 'mallory999', 31000)).toBeNull(); // another browser gets nothing of it
    expect(b.claim('Ann', 'annannann1', 31000).rec.z).toBe(6);
    expect(b.claim('Ann', 'annannann1', 32000)).toBeNull(); // used once
    b.add('Bob', null, null, 0);
    expect(b.claim('Bob', 'whatever1', 59_999)).not.toBeNull(); // an untokened ghost answers to the name
    b.add('Cy', 'cycycycyc1', null, 0);
    expect(b.get('Cy', 60_000)).toBeNull(); // gone after the minute
  });

  it('holds the seat: a stranger cannot fill the world meanwhile, the guest itself can come back', () => {
    const b = new GhostBook();
    b.add('Ann', 'annannann1', null, 0);
    // 2 players allowed: the host plus one seat; Ann is a ghost, nobody else is here
    expect(b.canJoin('Bob', 'bobbobbob1', 1, 2, 1000)).toBe(false);
    expect(b.canJoin('Ann', 'annannann1', 1, 2, 1000)).toBe(true);
    expect(b.canJoin('Ann', 'mallory999', 1, 2, 1000)).toBe(false); // someone else using her name
    expect(b.seats(1000).map((g) => g.name)).toEqual(['Ann']);
    expect(b.canJoin('Bob', 'bobbobbob1', 1, 2, 61_000)).toBe(true); // the seat is free again
  });

  function drops(h, c, how = {}) { h.drop(c, how.why || 'left the game', how.graceful); }

  it('the host gives the returning guest its place and belongings back, and says so', () => {
    const { h, g } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    stand(a, 12, 70, -3);
    a.raw = [12, 70, -3, 1.5, 0, -1, 0];
    h.onMessage(a, { t: 'ps', p: { slots: [{ id: 5, count: 3, damage: 0 }], x: 0, y: 0, z: 0 } });
    drops(h, a);
    expect(g.chatLog.map((l) => l[0]).join('|')).toMatch(/Ann left the game \(their place is kept for 60 s\)/);
    expect(h.ghosts.get('Ann', performance.now()).rec.x).toBe(12);
    const b = conn(h, 2); hello(h, b, 'Ann', 'annannann1');
    const w = sentOf(b, 'welcome')[0];
    expect(w.back).toBe(1);
    expect(w.player).toMatchObject({ x: 12, y: 70, z: -3 });
    expect(w.player.slots[0].count).toBe(3);
    expect(g.chatLog.map((l) => l[0])).toContain('Ann is back');
    expect(h.ghosts.get('Ann', performance.now())).toBeNull();
  });

  it('a guest who said goodbye (or was kicked) leaves no ghost; a stranger cannot use a ghost\'s name', () => {
    const { h } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    h.onMessage(a, { t: 'bye' });
    expect(h.ghosts.get('Ann', performance.now())).toBeNull();
    const b = conn(h, 2); hello(h, b, 'Bob', 'bobbobbob1');
    drops(h, b, { why: 'timed out' });
    expect(h.ghosts.get('Bob', performance.now())).not.toBeNull();
    const m = conn(h, 3); hello(h, m, 'Bob', 'mallory999');
    expect(sentOf(m, 'welcome')[0].name).toBe('Bob-2');
    expect(sentOf(m, 'welcome')[0].back).toBeUndefined();
    expect(h.ghosts.get('Bob', performance.now())).not.toBeNull(); // still waiting for the real Bob
  });

  it('a full world keeps the seat for the guest who dropped, until the minute is up', () => {
    const t = { now: 5000 };
    vi.spyOn(performance, 'now').mockImplementation(() => t.now);
    const { h } = hostWith();
    h.maxPlayers = 2;
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    drops(h, a, { why: 'timed out' });
    const b = conn(h, 2); hello(h, b, 'Bob', 'bobbobbob1');
    expect(sentOf(b, 'reject')[0].reason).toMatch(/full/);
    t.now += 61_000;
    const c = conn(h, 3); hello(h, c, 'Bob', 'bobbobbob1');
    expect(sentOf(c, 'welcome')).toHaveLength(1);
  });

  it('the ghost gives the seat up (and the host hears of it) after the minute', () => {
    const t = { now: 1000 };
    vi.spyOn(performance, 'now').mockImplementation(() => t.now);
    const { h, g } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    drops(h, a, { why: 'timed out' });
    h.expireGhosts(t.now); // the once-a-second pass sees the ghost
    t.now += 30_000;
    h.expireGhosts(t.now);
    expect(g.chatLog.map((l) => l[0])).not.toContain("Ann's place was given up");
    t.now += 31_000;
    h.expireGhosts(t.now);
    expect(g.chatLog.map((l) => l[0])).toContain("Ann's place was given up");
  });
});

// ---- the host leaves ----------------------------------------------------------------------------------------------------------
describe('the host leaves: a copy of the world the guest has', () => {
  beforeEach(() => { setStorage(new MemoryStorage()); });

  it('probes whether the host is still there', async () => {
    const s = new ClientSession('Ann');
    s.code = 'ABCDEF';
    const close = vi.fn();
    expect(await s.probeHost({ join: async () => ({ close }) })).toBe('alive');
    expect(close).toHaveBeenCalled();
    expect(await s.probeHost({ join: async () => { throw new Error('No world is open with that code'); } })).toBe('gone');
    expect(await s.probeHost({ join: async () => { throw new Error('Could not reach the signalling server (network)'); } })).toBe('unknown');
    expect(await s.probeHost({ join: async () => { throw new Error('Timed out connecting to the host'); } })).toBe('unknown');
  });

  it('keeps the chunks, player and rules, leaves the host\'s chests, creatures and accounts behind', async () => {
    const g = mockGame({ name: 'Original' });
    g.net = { isClient: true, isHost: false };
    g.world.saved.set(1, { blocks: new Uint16Array(16 * 16 * 384), meta: new Uint8Array(16 * 16 * 384), light: new Uint8Array(16 * 16 * 384), biomes: new Uint8Array(256), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256), modified: true, fv: 0 });
    g.netPlayers = { Other: { x: 1 } };
    g.chests.set('1,2,3', { x: 1, y: 2, z: 3, slots: [{ id: 5, count: 1 }] });
    const r = await saveGuestCopy(g, 'Hosty');
    expect(r).toMatchObject({ slot: 1, name: "Hosty's world (copy)" });
    const back = await loadWorld(1);
    expect(back.status).toBe('ok');
    const d = back.data;
    expect(d.name).toBe("Hosty's world (copy)");
    expect(Object.keys(d.chunks).length).toBeGreaterThanOrEqual(1);
    expect(d.netPlayers).toEqual({});
    expect(d.chests).toEqual([]);
    expect(d.liveMobs).toEqual([]);
    expect(d.player).toBeTruthy();
    expect(d.seed).toBe(g.seed);
  });

  it('goes into the first free slot and says so when every slot is used', async () => {
    const g = mockGame({ name: 'Original' });
    g.net = { isClient: true, isHost: false };
    const a = await saveGuestCopy(g, 'Hosty'), b = await saveGuestCopy(g, 'Hosty');
    expect([a.slot, b.slot]).toEqual([1, 2]);
    for (let i = 0; i < 8; i++) await saveGuestCopy(g, 'Hosty');
    expect((await listWorlds()).filter(Boolean)).toHaveLength(10);
    expect(await saveGuestCopy(g, 'Hosty')).toBeNull();
  });

  it('the host tells its guests before the tab goes', () => {
    const { h } = hostWith();
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    c.sent.length = 0;
    h._pagehide();
    expect(sentOf(c, 'bye')[0].reason).toMatch(/closed the world/);
    h.closed = true; h._pagehide();
    expect(sentOf(c, 'bye')).toHaveLength(1); // (only once, and not after close())
  });
});

// ---- the dead player's follow-cam --------------------------------------------------------------------------------------------
describe('follow-cam for a dead guest', () => {
  it('follows the killer first, then a team mate, then the first friend', () => {
    expect(pickDeathCamTarget(['Ann', 'Bob', 'Cy'], 'bob', ['Cy'])).toBe('Bob');
    expect(pickDeathCamTarget(['Ann', 'Bob', 'Cy'], 'Zed', ['Cy'])).toBe('Cy');
    expect(pickDeathCamTarget(['Ann', 'Bob'], null, null)).toBe('Ann');
    expect(pickDeathCamTarget([], 'Bob', null)).toBeNull();
    expect(killerOf('player:Bob')).toBe('Bob');
    expect(killerOf('mob:shambler')).toBeNull();
    expect(killerOf(undefined)).toBeNull();
    expect(RESPAWN_WAIT_S).toBeGreaterThan(0);
  });

  function guestWithFriends() {
    const s = new ClientSession('Ann');
    s.game = { player: { dead: true }, scene: { add() {}, remove() {} } };
    s.id = 5;
    for (const [id, name, dead] of [[0, 'Hosty', false], [2, 'Bob', false], [3, 'Cy', false]]) { const rp = s.addRemote(id, name); rp.setState({ x: id * 10, y: 64, z: 0, yaw: 1, pitch: 0.2, dead }); }
    return s;
  }

  it('shows the friend\'s view while dead, moves on when they die, ends when we respawn', () => {
    const s = guestWithFriends();
    s.social = new SocialState();
    expect(s.beginDeathCam('player:Bob')).toBe('Bob');
    expect(s.deathCamView()).toMatchObject({ name: 'Bob', x: 20, yaw: 1 });
    expect(s.cycleDeathCam(1)).toBe('Cy');
    expect(s.cycleDeathCam(-1)).toBe('Bob');
    s.remotes.get(2).setState({ x: 20, y: 64, z: 0, yaw: 1, pitch: 0, dead: true }); // Bob dies too
    s.tickDeathCam();
    expect(s.deathCam.target).not.toBe('Bob');
    expect(s.deathCamView()).not.toBeNull();
    s.game.player.dead = false;
    expect(s.deathCamView()).toBeNull(); // alive again: the camera is ours
    s.tickDeathCam();
    expect(s.deathCam).toBeNull();
  });

  it('has nothing to show when nobody else is there', () => {
    const s = new ClientSession('Ann');
    s.game = { player: { dead: true } };
    s.social = new SocialState();
    expect(s.beginDeathCam('fall')).toBeNull();
    expect(s.deathCamView()).toBeNull();
  });
});

// ---- typed pings -------------------------------------------------------------------------------------------------------------
describe('pings: a spot, danger, loot or a call for help', () => {
  it('knows its kinds and cleans unknown ones to a plain spot', () => {
    expect(Object.keys(PING_KINDS)).toEqual(['go', 'danger', 'loot', 'help']);
    expect(cleanPingKind('danger')).toBe('danger');
    expect(cleanPingKind('toString')).toBe('go');
    expect(cleanPingKind('nonsense')).toBe('go');
    expect(cleanPingKind(5)).toBe('go');
    expect(cleanPingKind(undefined)).toBe('go');
  });

  it('chooses the kind from what the crosshair points at', () => {
    expect(pingKindFor({})).toBe('go');
    expect(pingKindFor({ entity: { kind: 'mob', enemy: true } })).toBe('danger');
    expect(pingKindFor({ entity: { kind: 'mob', monster: true } })).toBe('danger');
    expect(pingKindFor({ entity: { kind: 'mob', enemy: false } })).toBe('go');
    expect(pingKindFor({ entity: { kind: 'item' } })).toBe('loot');
    expect(pingKindFor({ container: true })).toBe('loot');
    expect(pingKindFor({ sneaking: true, entity: { kind: 'mob', enemy: true } })).toBe('help');
  });

  it('a danger marker is short-lived, a plain spot lasts its 20 s, a call for help 15 s', () => {
    const b = new PingBoard();
    b.add({ from: 'Ann', x: 1, y: 2, z: 3, k: 'danger' }, 0);
    b.add({ from: 'Bob', x: 1, y: 2, z: 3 }, 0);
    b.add({ from: 'Cy', x: 1, y: 2, z: 3, k: 'help' }, 0);
    expect(b.active(5000, 'overworld').map((p) => p.from)).toEqual(['Ann', 'Bob', 'Cy']);
    expect(b.active(11000, 'overworld').map((p) => p.from)).toEqual(['Bob', 'Cy']);
    expect(b.active(16000, 'overworld').map((p) => p.from)).toEqual(['Bob']);
    expect(b.active(PING_TTL_MS + 1, 'overworld')).toEqual([]);
    b.add({ from: 'Ann', x: 1, y: 2, z: 3, k: 'danger' }, 20000);
    expect(b.active(25000, 'overworld')[0].life).toBeCloseTo(0.5, 5);
  });

  it('the host passes the kind on to the team and old guests\' plain pings stay plain', () => {
    const soc = new SocialState(), board = new PingBoard();
    const r = routePing(soc, board, 'Ann', { x: 1, y: 2, z: 3, k: 'loot' }, { x: 0, y: 2, z: 0 }, ['Host', 'Ann'], 1000, 'overworld');
    expect(r.ok).toBe(true);
    expect(r.ping.k).toBe('loot');
    const r2 = routePing(soc, board, 'Bob', { x: 1, y: 2, z: 3 }, null, ['Host', 'Bob'], 1000, 'overworld');
    expect(r2.ping.k).toBe('go');
    const r3 = routePing(soc, board, 'Cy', { x: 1, y: 2, z: 3, k: '__proto__' }, null, ['Host', 'Cy'], 1000, 'overworld');
    expect(r3.ping.k).toBe('go');
  });

  it('a guest\'s danger ping reaches the host and its team mates with the kind', () => {
    const { h } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1'); stand(a, 0, 64, 0);
    const b = conn(h, 2); hello(h, b, 'Bob', 'bobbobbob1'); stand(b, 0, 64, 0);
    h.onMessage(a, { t: 'ping', x: 4, y: 64, z: 4, k: 'danger' });
    expect(h.pings.active(performance.now(), 'overworld')[0]).toMatchObject({ from: 'Ann', k: 'danger' });
    expect(sentOf(b, 'ping')[0]).toMatchObject({ from: 'Ann', k: 'danger' });
    expect(sentOf(a, 'ping')).toHaveLength(0); // not echoed to the sender
  });

  it('the host\'s own crosshair: a hostile mob is danger, an item is loot, sneaking asks for help', () => {
    const { h, g } = hostWith();
    g.player.sneaking = false;
    g.world.raycast = () => ({ x: 3, y: 64, z: -9, id: 1, dist: 9 });
    g.entities.list = [{ kind: 'mob', enemy: true, x: 0, y: 64, z: -3, width: 0.6, height: 1.8, def: {} }];
    expect(h.pingAtCrosshair()).toBe(true);
    expect(h.pings.list.pop().k).toBe('danger');
    h.pings.clear();
    g.entities.list = [{ kind: 'item', x: 0, y: 65.4, z: -2, stack: { id: 1, count: 1 } }];
    expect(h.pingAtCrosshair()).toBe(true);
    expect(h.pings.list.pop().k).toBe('loot');
    h.pings.clear();
    g.entities.list = [];
    g.player.sneaking = true;
    expect(h.pingAtCrosshair()).toBe(true);
    expect(h.pings.list.pop().k).toBe('help');
  });

  it('the ping key is bound and says what it does', () => {
    const a = ACTIONS.find((x) => x.id === 'ping');
    expect(a.def[0]).toBe('KeyB');
    expect(a.label).toMatch(/help/i);
  });
});

// ---- the thrown Returning Disc seen by the others ------------------------------------------------------------------------------
describe('a thrown Returning Disc is seen by the other players', () => {
  it('draws a disc from position messages and drops it when the flight ends or goes quiet', () => {
    const scene = { added: 0, removed: 0, add() { this.added++; }, remove() { this.removed++; } };
    const d = new RemoteDiscs(scene);
    d.set(3, true, 1, 64, 2, 'iron', 1000);
    expect(d.map.size).toBe(1);
    d.set(3, true, 2, 64, 2, 'iron', 1100);
    expect(scene.added).toBe(1); // the same mesh moves on
    d.update(0.05, 1150);
    expect(d.map.get(3).x).toBe(2);
    d.set(3, false, 0, 0, 0, 'iron', 1200); // landed
    expect(d.map.size).toBe(0);
    d.set(4, true, 0, 0, 0, 'gold', 2000);
    d.update(0.05, 2000 + DISC_STALE_MS + 1);
    expect(d.map.size).toBe(0); // not heard of for too long
    expect(scene.removed).toBe(2);
    expect(discAlive(1000, 1000 + DISC_STALE_MS - 1)).toBe(true);
    expect(discAlive(1000, 1000 + DISC_STALE_MS)).toBe(false);
  });

  it('a guest\'s disc goes to the host and on to the other guests, not back to the thrower', () => {
    const { h } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1'); stand(a, 0, 64, 0);
    const b = conn(h, 2); hello(h, b, 'Bob', 'bobbobbob1'); stand(b, 0, 64, 0);
    b.sent.length = 0; a.sent.length = 0;
    h.onMessage(a, { t: 'disc', on: 1, x: 3.2, y: 65, z: 1, tier: 'iron', d: 'overworld' });
    expect(h.discs.map.has(1)).toBe(true); // the host sees it
    expect(sentOf(b, 'disc')[0]).toMatchObject({ id: 1, on: 1, x: 3.2, y: 65, z: 1, tier: 'iron' });
    expect(sentOf(a, 'disc')).toHaveLength(0);
    h.onMessage(a, { t: 'disc', on: 0, x: 3.2, y: 65, z: 1, d: 'overworld' });
    expect(h.discs.map.has(1)).toBe(false);
    expect(sentOf(b, 'disc')[1].on).toBe(0);
  });

  it('refuses a disc far from its thrower and nonsense positions', () => {
    const { h } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1'); stand(a, 0, 64, 0);
    const b = conn(h, 2); hello(h, b, 'Bob', 'bobbobbob1');
    b.sent.length = 0;
    h.onMessage(a, { t: 'disc', on: 1, x: 500, y: 65, z: 1, tier: 'iron' });
    h.onMessage(a, { t: 'disc', on: 1, x: 'a', y: 65, z: 1, tier: 'iron' });
    h.onMessage(a, { t: 'disc', on: 1, x: NaN, y: 65, z: 1 });
    expect(sentOf(b, 'disc')).toHaveLength(0);
    expect(h.discs).toBeNull();
  });

  it('the host\'s own disc is broadcast with id 0, and guests draw it only in their dimension', () => {
    const { h, g } = hostWith();
    const a = conn(h, 1); hello(h, a, 'Ann', 'annannann1');
    a.sent.length = 0;
    h.sendDisc({ x: 1.04, y: 2, z: 3, tier: 'gold' }, true);
    expect(sentOf(a, 'disc')[0]).toMatchObject({ id: 0, on: 1, x: 1, tier: 'gold', d: 'overworld' });
    const s = new ClientSession('Ann');
    s.game = { world: { dimension: 'overworld' }, scene: { add() {}, remove() {} }, chat: { add() {} }, player: {} };
    s.id = 5;
    s.handle({ t: 'disc', id: 0, on: 1, x: 1, y: 2, z: 3, tier: 'gold', d: 'overworld' });
    expect(s.discs.map.has(0)).toBe(true);
    s.handle({ t: 'disc', id: 0, on: 1, x: 1, y: 2, z: 3, tier: 'gold', d: 'cinderdeep' }); // another dimension: ignored
    s.handle({ t: 'disc', id: 5, on: 1, x: 1, y: 2, z: 3 }); // (our own, never drawn)
    expect(s.discs.map.has(5)).toBe(false);
    s.handle({ t: 'leave', id: 0, name: 'Hosty' });
    expect(s.discs.map.has(0)).toBe(false);
    void g;
  });

  it('is metered like the other small messages', () => {
    expect(KIND_OF.disc).toBe('misc');
  });
});

// ---- the newest features, guest side ---------------------------------------------------------------------------------------------
describe('weapons, trinkets and retrofit for guests', () => {
  it('the host staggers and backstabs from the guest\'s held item alone (the stand-in carries just the item id)', () => {
    const held = { id: WEAPONS.warhammer.iron, count: 1 };
    const w = weaponOf(held);
    expect(stunFor(held, w.damage)).toBeGreaterThan(0);
    expect(stunFor(held, 1)).toBe(0); // a quick tap does not stagger
    const dagger = { id: WEAPONS.dagger.iron, count: 1 };
    const mob = { x: 0, z: 0, yaw: 0 }; // facing -z
    expect(backstabFactor(dagger, mob, 0, 5)).toBeGreaterThan(1); // from behind (+z)
    expect(backstabFactor(dagger, mob, 0, -5)).toBe(1);
    expect(reachOf({ id: WEAPONS.glaive.iron })).toBeGreaterThan(reachOf(dagger));
  });

  it('a guest\'s blow with a Glaive is within reach for the host\'s lag-compensated check', () => {
    const { h, g } = hostWith();
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    c.rp.setState({ x: 0, y: 64, z: 0, yaw: 0, pitch: 0, held: WEAPONS.glaive.iron });
    const mob = { id: 9, kind: 'mob', deathTime: 0, x: 5.5, y: 64, z: 0, width: 0.6, height: 1.8, hurt: vi.fn(() => true) };
    g.entities.list.push(mob);
    h.onMessage(c, { t: 'hit', id: 9, d: 8, k: 0.4, p: 0 });
    expect(mob.hurt).toHaveBeenCalledTimes(1); // 5.2 blocks eye to box: inside the Glaive's 4.5 + slack
    mob.hurt.mockClear();
    c.rp.setState({ x: 0, y: 64, z: 0, yaw: 0, pitch: 0, held: WEAPONS.dagger.iron });
    h.onMessage(c, { t: 'hit', id: 9, d: 8, k: 0.4, p: 0 });
    expect(mob.hurt).not.toHaveBeenCalled(); // the same blow with a Dagger's short arm is not
  });

  it('trinkets travel in the guest\'s record and add up for the guest\'s own game', () => {
    const worn = cleanTrinkets([{ id: I.LODESTONE_CHARM, count: 1, damage: 0 }, { id: I.WARDING_AMULET, count: 1, damage: 0 }]);
    expect(gearTotals([], worn).pull).toBe(6);
    expect(gearTotals([], worn).ward).toBeCloseTo(0.15, 6);
    const { h, g } = hostWith();
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    h.onMessage(c, { t: 'ps', p: { slots: [], trinkets: worn, x: 1, y: 2, z: 3 } });
    expect(g.netPlayers.Ann.trinkets.map((t) => t.id)).toEqual([I.LODESTONE_CHARM, I.WARDING_AMULET]);
    h.drop(c, 'timed out');
    const d = conn(h, 2); hello(h, d, 'Ann', 'annannann1');
    expect(sentOf(d, 'welcome')[0].player.trinkets).toHaveLength(2); // back with them
  });

  it('/retrofit is the host\'s alone, also when a guest\'s command is run by the host', () => {
    const g = mockGame({ name: 'W' });
    g.world.dimension = 'overworld';
    g.net = { isHost: false, isClient: true };
    expect(runRetrofitCommand(g, ['apply'])).toBe('Only the host can retrofit the world');
    g.net = { isHost: true, isClient: false };
    g.cmdActor = { host: false, name: 'Ann' };
    expect(runRetrofitCommand(g, ['apply'])).toBe('Only the host can retrofit the world');
    g.cmdActor = null;
    expect(Array.isArray(runRetrofitCommand(g, ['status']))).toBe(true);
  });

  it('a guest\'s /retrofit sent straight to the host is refused there too', () => {
    const { h, g } = hostWith();
    g.chat.add = vi.fn();
    const c = conn(h, 1); hello(h, c, 'Ann', 'annannann1');
    c.sent.length = 0;
    // (the guest sends it as a command; the host runs it with the guest as the actor)
    g.cmdActor = null;
    h.guestCommands = true;
    // commands need the full game; the rule itself is what matters and is tested above through cmdActor
    expect(runRetrofitCommand({ ...g, net: h, cmdActor: h.buildActor(c), world: { dimension: 'overworld' } }, ['apply'])).toBe('Only the host can retrofit the world');
  });
});

describe('Bounty Board hand-overs and a turn-in with two guests', () => {
  function questHost() {
    const g = mockGame({ name: 'Q' });
    const q = new Quests(g);
    q.bus.on('bountyDone', () => {});
    const clients = new Map();
    const mk = (id, name) => {
      const sent = [];
      const inv = { slots: new Array(36).fill(null), count(id2) { return this.slots.reduce((n, s) => n + (s && s.id === id2 ? s.count : 0), 0); }, changed() {}, add(st) { this.slots[this.slots.findIndex((s) => !s)] = { ...st }; return 0; } };
      const rp = { target: { isPlayer: true, netName: name, remote: { id }, inventory: inv, creative: false }, state: { x: 0, y: 64, z: 0 } };
      rp.target.remote.target = rp.target;
      const c = { id, name, joined: true, rp, ch: { send: (m) => sent.push(m) }, sent, inv };
      clients.set(id, c);
      return c;
    };
    const ann = mk(1, 'Ann'), bob = mk(2, 'Bob');
    g.net = { isHost: true, isClient: false, name: 'Host', clients, players: () => [{ name: 'Host', obj: g.player }, ...[...clients.values()].map((c) => ({ name: c.name, obj: c.rp.target }))], near: () => true };
    g.world.getBlock = () => 1356; // (a Bounty Board anywhere)
    g.world.dimension = 'overworld';
    g.audio = { play() {} }; g.hud = { toast() {} };
    g.entities.spawnXp = () => {};
    return { g, q, ann, bob };
  }

  it('every guest\'s hand-over is counted once and what is not needed goes back', () => {
    const { q, ann, bob } = questHost();
    const pos = { x: 10, y: 64, z: 10 };
    const site = q.siteAt(10.5, 10.5);
    q.log.accept('*', { id: 'r6|deliver', vk: '9,9', day: 0, slot: 0, kind: 'deliver', target: I.IRON_INGOT, n: 5, to: site.key, toName: 'Here', tier: 1, reward: { beryl: 4, rep: 0, items: [] } }, 0);
    const r1 = q.handle(ann.rp.target, 'Ann', 'hand', pos, { id: 'r6|deliver', n: 3, iid: I.IRON_INGOT }, false);
    expect(r1.ok).toBe(true);
    expect(q.log.group('*').active[0].progress).toBe(3);
    const r2 = q.handle(bob.rp.target, 'Bob', 'hand', pos, { id: 'r6|deliver', n: 4, iid: I.IRON_INGOT }, false);
    expect(r2.ok).toBe(true);
    expect(q.log.group('*').active).toHaveLength(0); // finished: paid and gone
    // Bob handed over 4 but only 2 were needed: the other 2 went back to him
    const back = bob.sent.filter((m) => m.t === 'got' && m.st.id === I.IRON_INGOT).map((m) => m.st);
    expect(back).toEqual([{ id: I.IRON_INGOT, count: 2, damage: 0 }]);
    // both are paid
    const beryl = (c) => c.sent.filter((m) => m.t === 'got' && m.st.id === I.BERYL).reduce((n, m) => n + m.st.count, 0);
    expect(beryl(ann)).toBe(4);
    expect(beryl(bob)).toBe(4);
    // a hand-over for a bounty that is not there gives everything back
    bob.sent.length = 0;
    q.handle(bob.rp.target, 'Bob', 'hand', pos, { id: 'nope', n: 5, iid: I.IRON_INGOT }, false);
    expect(bob.sent.filter((m) => m.t === 'got' && m.st.id === I.IRON_INGOT).map((m) => m.st.count)).toEqual([5]);
  });

  it('a shared bounty two guests worked on is turned in once and both are paid', () => {
    const { q, ann, bob } = questHost();
    const pos = { x: 10, y: 64, z: 10 };
    const site = q.siteAt(10.5, 10.5);
    q.log.accept('*', { id: 'r6|trade', vk: site.key, day: 0, slot: 0, kind: 'trade', target: null, n: 4, tier: 1, reward: { beryl: 6, rep: 0, items: [] } }, 0);
    q.bus.emit('trade', { n: 2, actor: ann.rp.target });
    q.bus.emit('trade', { n: 2, actor: bob.rp.target });
    expect(q.log.group('*').active[0].contrib).toEqual({ Ann: 2, Bob: 2 });
    q.handle(bob.rp.target, 'Bob', 'turn', pos, { id: 'r6|trade' }, false);
    const beryl = (c) => c.sent.filter((m) => m.t === 'got' && m.st.id === I.BERYL).reduce((n, m) => n + m.st.count, 0);
    expect(beryl(ann)).toBe(6);
    expect(beryl(bob)).toBe(6);
    ann.sent.length = 0;
    q.handle(ann.rp.target, 'Ann', 'turn', pos, { id: 'r6|trade' }, false); // a second turn-in pays nothing
    expect(beryl(ann)).toBe(0);
  });
});
