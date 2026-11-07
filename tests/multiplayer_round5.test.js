// Multiplayer round 5: the host-side item ledger, guests that no longer simulate what the host sends, the Cooking Pot and
// Composter finishing on the host when a guest starts them, campfire merging, the mount stamina message, fuel that comes
// back when the host refuses it, saved host options and the bandwidth readout (no network needed).
import { describe, it, expect } from 'vitest';
import { World } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { I, ITEMS, maxStack } from '../src/world/items.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { GuestLedger, plausibleStack, tally, countIn, LEDGER_WINDOW_MS, ALLOW_PER_KIND, ALLOW_SMALL, ALLOW_TOTAL } from '../src/net/ledger.js';
import { mergeCamp, sameCampLayout, cleanCamp, CAMP_SLOTS } from '../src/world/campfireCooking.js';
import { startBrew, takeServing, potTick, brewMeta, readyMeta, BREW_STAGE_TICKS, BREW_STAGES, KIND_BIT } from '../src/world/cookingPot.js';
import { SETTLE_TICKS } from '../src/world/composter.js';
import { cleanHostSettings, DEFAULT_HOST_SETTINGS } from '../src/net/social.js';
import { rateText, Rate } from '../src/net/guard.js';
import { HostSession, ClientSession } from '../src/net/session.js';
import { Mob } from '../src/mobs/mob.js';
import { staminaGauge, fatigueState, tiredText, MOUNT, cartFuelTicks, FURNACE_CART } from '../src/mobs/mounts.js';
import { PROTOCOL_VERSION, packMob } from '../src/net/protocol.js';

// ---- a small flat world --------------------------------------------------------------------------
function flatChunk() {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}
function flatWorld() {
  const w = new World(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.addChunk(cx, cz, flatChunk());
  w.tick();
  return w;
}
const run = (w, n = 1) => { for (let i = 0; i < n; i++) w.tick(); };
const Y = 64;

describe('protocol compatibility is untouched', () => {
  it('stays at version 2 and the mob snapshot keeps its 25 fields', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    const m = new Mob('galloper', 1, 64, 2);
    const a = packMob(m, () => -1, () => -1);
    expect(a.length).toBe(25); // the layout of round 4
  });
});

describe('the drop ledger', () => {
  it('knows which stacks can exist at all', () => {
    expect(plausibleStack({ id: I.DIAMOND, count: 64, damage: 0 })).toBe(true);
    expect(plausibleStack({ id: I.DIAMOND_SWORD, count: 1, damage: 10 })).toBe(true);
    expect(plausibleStack({ id: I.DIAMOND_SWORD, count: 2, damage: 0 })).toBe(false); // tools do not stack
    expect(plausibleStack({ id: I.DIAMOND_SWORD, count: 1, damage: 99999 })).toBe(false); // worn past the end
    expect(plausibleStack({ id: I.DIAMOND, count: 65, damage: 0 })).toBe(false);
    expect(plausibleStack({ id: I.DIAMOND, count: 0, damage: 0 })).toBe(false);
    expect(plausibleStack({ id: 99999, count: 1 })).toBe(false);
    expect(plausibleStack({ id: I.DIAMOND, count: 1.5 })).toBe(false);
    expect(plausibleStack(null)).toBe(false);
    const sixteen = Object.keys(ITEMS).map(Number).find((id) => maxStack(id) === 16);
    if (sixteen !== undefined) expect(plausibleStack({ id: sixteen, count: 17, damage: 0 })).toBe(false);
  });

  it('counts what boxes hold, three levels deep at most', () => {
    const inner = { id: B.GLOOMSHELL_BOX, count: 1, contents: [{ id: I.DIAMOND, count: 5 }] };
    const outer = { id: B.GLOOMSHELL_BOX, count: 1, contents: [inner, { id: I.DIAMOND, count: 3 }] };
    expect(countIn([outer, { id: I.DIAMOND, count: 2 }], I.DIAMOND)).toBe(10);
    expect(countIn([outer], B.GLOOMSHELL_BOX)).toBe(2);
    expect(tally(null).size).toBe(0);
    let deep = { id: I.DIAMOND, count: 1 };
    for (let i = 0; i < 6; i++) deep = { id: B.GLOOMSHELL_BOX, count: 1, contents: [deep] };
    expect(countIn([deep], I.DIAMOND)).toBe(0); // far too deep to be real
  });

  it('a person emptying a full inventory is never refused', () => {
    const l = new GuestLedger();
    l.setHeld(Array.from({ length: 36 }, () => ({ id: B.DIRT, count: 64 }))); // 2304 dirt in hand
    let t = 0;
    for (let i = 0; i < 36; i++) expect(l.allowDrop(B.DIRT, 64, (t += 120))).toBe(true); // a click every 120 ms
    expect(l.denied).toBe(0);
  });

  it('mining and throwing away within the allowance passes, a script that makes stacks from nothing does not', () => {
    const l = new GuestLedger();
    let ok = 0;
    for (let i = 0; i < 40; i++) if (l.allowDrop(I.DIAMOND, 64, 1000 + i * 10)) ok++;
    expect(ok).toBe(ALLOW_PER_KIND / 64); // three stacks, then nothing
    expect(l.denied).toBe(37);
    // a different kind has its own allowance
    expect(l.allowDrop(I.EMERALD || I.IRON_INGOT, 64, 1500)).toBe(true);
  });

  it('what the host handed the guest raises what it may drop, and old events fall out of the window', () => {
    const l = new GuestLedger();
    l.grant(I.DIAMOND, 640, 0);
    for (let i = 0; i < 13; i++) expect(l.allowDrop(I.DIAMOND, 64, 100 + i)).toBe(true); // 832 = 640 + 192
    expect(l.allowDrop(I.DIAMOND, 64, 200)).toBe(false);
    // six seconds on, both the grant and the drops are forgotten
    expect(l.allowDrop(I.DIAMOND, 64, 200 + LEDGER_WINDOW_MS + 1)).toBe(true);
    expect(l.events.length).toBe(1);
  });

  it('a fresh inventory copy replaces the old one; boxes in it count', () => {
    const l = new GuestLedger();
    l.setHeld([{ id: B.GLOOMSHELL_BOX, count: 1, contents: [{ id: I.DIAMOND, count: 64 }, { id: I.DIAMOND, count: 64 }] }]);
    expect(l.held.get(I.DIAMOND)).toBe(128);
    l.setHeld([]);
    expect(l.held.size).toBe(0);
    l.setHeld('garbage');
    expect(l.held.size).toBe(0);
  });

  it('a whole box is judged as one: all or nothing', () => {
    const l = new GuestLedger();
    const box = { id: B.GLOOMSHELL_BOX, count: 1, contents: [{ id: I.DIAMOND, count: 64 }, { id: I.DIAMOND, count: 64 }, { id: I.DIAMOND, count: 64 }, { id: I.DIAMOND, count: 64 }] };
    expect(l.allowMany([box], 0)).toBe(false); // 256 diamonds nobody carried
    expect(l.events.length).toBe(0); // nothing was recorded
    l.setHeld([box]);
    expect(l.allowMany([box], 10)).toBe(true); // the same box, now in the guest's inventory copy
  });

  it('creative guests are never refused; the total across kinds is capped for the rest', () => {
    const l = new GuestLedger();
    for (let i = 0; i < 100; i++) expect(l.allowDrop(I.DIAMOND, 64, i, true)).toBe(true);
    const m = new GuestLedger();
    const ids = Object.keys(ITEMS).map(Number).filter((id) => maxStack(id) === 64).slice(0, 40);
    m.setHeld(ids.map((id) => ({ id, count: 64 })));
    let total = 0;
    for (const id of ids) for (let k = 0; k < 3; k++) if (m.allowDrop(id, 64, 5)) total += 64;
    expect(total).toBeLessThanOrEqual(ALLOW_TOTAL);
    expect(m.denied).toBeGreaterThan(0);
  });

  it('single items laid on frames and fires have a small allowance of their own', () => {
    const l = new GuestLedger();
    let ok = 0;
    for (let i = 0; i < 20; i++) if (l.allowDrop(I.DIAMOND, 1, i, false, ALLOW_SMALL)) ok++;
    expect(ok).toBe(ALLOW_SMALL);
  });
});

// ---- the host's side of the ledger -------------------------------------------------------------------
function hostWith(extra = {}) {
  const h = new HostSession('Host', null, 'ABCDEF');
  const spawned = [], chat = [], sent = [];
  h.game = {
    entities: { spawnItem: (x, y, z, st) => { const e = { x, y, z, stack: st }; spawned.push(e); return e; } },
    chat: { add: (l) => chat.push(l) },
    world: { getBlock: () => B.CAMPFIRE, dimension: 'overworld' },
    frames: new Map(), campfires: new Map(), chests: new Map(),
    setCampfire(x, y, z, s) { const k = `${x},${y},${z}`; if (s) this.campfires.set(k, s); else this.campfires.delete(k); },
    setFrameItem(x, y, z, st) { const k = `${x},${y},${z}`; if (st) this.frames.set(k, st); else this.frames.delete(k); },
    ...extra,
  };
  const c = { id: 1, name: 'Bo', joined: true, rp: { state: { x: 0, y: 64, z: 0, creative: false } }, ch: { send: (m) => sent.push(m) } };
  h.clients.set(1, c);
  return { h, c, spawned, chat, sent };
}

describe('guest drops on the host', () => {
  it('stacks that cannot exist are ignored; a person dropping what they hold is spawned', () => {
    const { h, c, spawned } = hostWith();
    c.ledger = new GuestLedger();
    c.ledger.setHeld([{ id: B.DIRT, count: 64 }]);
    h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: B.DIRT, count: 64, damage: 0 } });
    h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: I.DIAMOND_SWORD, count: 64, damage: 0 } });
    h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: 424242, count: 1, damage: 0 } });
    expect(spawned.length).toBe(1);
    expect(spawned[0].stack.id).toBe(B.DIRT);
    expect(spawned[0].droppedBy).toBe(1);
  });

  it('a guest that drops stack after stack of what it never held is cut off after the allowance and told once', () => {
    const { h, c, spawned, chat, sent } = hostWith();
    for (let i = 0; i < 20; i++) h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: I.DIAMOND, count: 64, damage: 0 } });
    expect(spawned.length).toBe(ALLOW_PER_KIND / 64);
    expect(chat.filter((l) => /dropped far more/.test(l)).length).toBe(1);
    expect(sent.filter((m) => m.t === 'cmdout').length).toBe(1);
    expect(c.ledger.denied).toBe(17);
  });

  it('what the guest picked up is credited, what it took from a chest too', () => {
    const { h, c, spawned } = hostWith();
    const ent = { id: 7, kind: 'item', x: 0, y: 64.9, z: 0, stack: { id: I.IRON_INGOT, count: 64, damage: 0 }, pickupDelay: 0 };
    h.entity = () => ent;
    for (let i = 0; i < 6; i++) { ent.stack.count = 64; h.remoteTake(c, { id: 7, n: 64 }); }
    expect(c.ledger.sum(I.IRON_INGOT, 'grant')).toBe(384);
    let n = 0;
    for (let i = 0; i < 9; i++) { h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: I.IRON_INGOT, count: 64, damage: 0 } }); n = spawned.length; }
    expect(n).toBe(9); // 384 + 192 = 576 = nine stacks
    h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: I.IRON_INGOT, count: 64, damage: 0 } });
    expect(spawned.length).toBe(9);
  });

  it('a creative guest can drop anything', () => {
    const { h, c, spawned } = hostWith();
    c.rp.state.creative = true;
    for (let i = 0; i < 30; i++) h.remoteSpawn(c, { k: 'item', x: 1, y: 64, z: 1, st: { id: I.DIAMOND, count: 64, damage: 0 } });
    expect(spawned.length).toBe(30);
  });

  it('a Gloomshell Box is only unpacked with items the guest could carry', () => {
    const placed = [];
    const { h, c } = hostWith({ onBoxPlaced: (...a) => placed.push(a) });
    const rich = Array.from({ length: 27 }, () => ({ id: I.DIAMOND, count: 64, damage: 0 }));
    h.onMessage(c, { t: 'boxput', x: 0, y: 64, z: 0, s: rich });
    expect(placed.length).toBe(0);
    c.ledger.setHeld([{ id: I.DIAMOND, count: 64 }, { id: I.IRON_INGOT, count: 10 }]);
    h.onMessage(c, { t: 'boxput', x: 0, y: 64, z: 0, s: [{ id: I.IRON_INGOT, count: 10, damage: 0 }, { id: I.DIAMOND, count: 3, damage: 0 }] });
    expect(placed.length).toBe(1);
  });

  it('items laid in a frame must be plausible; the guest is shown what is really there otherwise', () => {
    const { h, c, sent } = hostWith();
    c.ledger = new GuestLedger();
    for (let i = 0; i < ALLOW_SMALL; i++) h.onMessage(c, { t: 'frame', x: i, y: 64, z: 0, st: { id: I.DIAMOND, count: 1 } });
    expect(h.game.frames.size).toBe(ALLOW_SMALL);
    h.onMessage(c, { t: 'frame', x: 9, y: 64, z: 0, st: { id: I.DIAMOND, count: 1 } });
    expect(h.game.frames.size).toBe(ALLOW_SMALL);
    expect(sent.some((m) => m.t === 'frame' && m.x === 9 && m.st === null)).toBe(true);
  });
});

describe('campfires: the guest sees the layout, the host keeps the cooking', () => {
  const food = (id, t = 0) => ({ id, t });
  it('keeps the host\'s food and progress, adds fresh food, removes what the guest took', () => {
    const host = { slots: [food(I.RAW_BEEF, 400), food(I.RAW_PORK, 100), null, null] };
    const theirs = { slots: [food(I.RAW_BEEF, 0), null, food(I.RAW_CHICKEN, 599), null] }; // took the pork, laid a chicken, stale progress
    const next = mergeCamp(host, theirs);
    expect(next.slots[0]).toEqual(food(I.RAW_BEEF, 400));
    expect(next.slots[1]).toBe(null);
    expect(next.slots[2]).toEqual(food(I.RAW_CHICKEN, 0)); // they cannot hand it a finished meal
    expect(next.slots[3]).toBe(null);
    expect(mergeCamp(host, null)).toBe(null);
    expect(mergeCamp(null, { slots: [food(I.RAW_BEEF, 5), null, null, null] }).slots[0]).toEqual(food(I.RAW_BEEF, 0));
  });
  it('a place where the two disagree about the food stays as the host has it', () => {
    const next = mergeCamp({ slots: [food(I.RAW_BEEF, 300), null, null, null] }, { slots: [food(I.RAW_PORK, 0), null, null, null] });
    expect(next.slots[0]).toEqual(food(I.RAW_BEEF, 300));
    expect(sameCampLayout({ slots: [food(I.RAW_BEEF, 300), null, null, null] }, { slots: [food(I.RAW_PORK, 0), null, null, null] })).toBe(false);
    expect(sameCampLayout({ slots: [food(I.RAW_BEEF, 300), null, null, null] }, { slots: [food(I.RAW_BEEF, 0), null, null, null] })).toBe(true);
    expect(sameCampLayout(null, null)).toBe(true);
    expect(CAMP_SLOTS).toBe(4);
  });
  it('the host handler applies the merge and tells the others (and the guest when its picture was off)', () => {
    const { h, c } = hostWith();
    const bc = [];
    h.broadcast = (m, except) => bc.push([m, except]);
    h.game.campfires.set('0,64,0', cleanCamp({ slots: [food(I.RAW_BEEF, 500)] }));
    h.onMessage(c, { t: 'camp', x: 0, y: 64, z: 0, s: { slots: [food(I.RAW_BEEF, 0), food(I.RAW_PORK, 0)] } });
    const cur = h.game.campfires.get('0,64,0');
    expect(cur.slots[0].t).toBe(500);
    expect(cur.slots[1]).toEqual(food(I.RAW_PORK, 0));
    expect(bc[0][1]).toBe(c); // same layout: the sender does not need it back
    h.onMessage(c, { t: 'camp', x: 0, y: 64, z: 0, s: { slots: [food(I.RAW_PORK, 0), null, null, null] } }); // disagrees about slot 0
    expect(bc[1][1]).toBe(null);
    expect(h.game.campfires.get('0,64,0').slots[0].id).toBe(I.RAW_BEEF);
  });
});

// ---- guests do not run what the host sends ---------------------------------------------------------------
describe('a guest\'s world is passive', () => {
  it('scheduled ticks (fluids...) do not run and the queue stays empty; the host\'s copy still flows', () => {
    const host = flatWorld(), guest = flatWorld();
    guest.passive = true;
    for (const w of [host, guest]) { w.setBlock(0, Y, 0, B.WATER, 0); run(w, 40); }
    let hostWater = 0, guestWater = 0;
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { if (host.getBlock(x, Y, z) === B.WATER) hostWater++; if (guest.getBlock(x, Y, z) === B.WATER) guestWater++; }
    expect(hostWater).toBeGreaterThan(1);
    expect(guestWater).toBe(1);
    expect(guest.scheduled.size).toBe(0);
  });
  it('fire does not spread on a guest', () => {
    const w = flatWorld();
    w.passive = true;
    w.setBlock(0, Y, 0, B.OAK_PLANKS); w.setBlock(1, Y, 0, B.OAK_PLANKS); w.setBlock(0, Y + 1, 0, B.FIRE);
    run(w, 200);
    expect(w.getBlock(0, Y + 1, 0)).toBe(B.FIRE); // neither burns out nor spreads: only the host's edits change it
    expect(w.getBlock(1, Y, 0)).toBe(B.OAK_PLANKS);
  });
  it('a normal (single-player or host) world is not passive', () => {
    expect(flatWorld().passive).toBe(false);
  });
});

describe('Cooking Pot and Composter on a shared world', () => {
  const mask = KIND_BIT.meat | KIND_BIT.root;
  it('a player stirring the pot makes an urgent (shared) edit', () => {
    const w = flatWorld();
    w.setBlock(0, Y - 1, 0, B.CAMPFIRE); w.setBlock(0, Y, 0, B.COOKING_POT, mask);
    const calls = [];
    const orig = w.setBlockUrgent.bind(w);
    w.setBlockUrgent = (...a) => { calls.push(a); return orig(...a); };
    expect(startBrew(w, 0, Y, 0, true)).toBe('started');
    expect(calls.length).toBe(1);
    expect(calls[0][3]).toBe(B.COOKING_POT_BREW);
    // ... and a ladle too
    w.setBlock(0, Y, 0, B.COOKING_POT_BREW, readyMeta(0, 2));
    calls.length = 0;
    expect(takeServing(w, 0, Y, 0, true)).toBe(0);
    expect(calls.length).toBe(1);
    // the simmer's own stages are not player edits
    w.setBlock(0, Y, 0, B.COOKING_POT_BREW, brewMeta(0, 0));
    calls.length = 0;
    potTick(w, 0, Y, 0);
    expect(calls.length).toBe(0);
  });

  it('the host cooks a pot that arrives from a guest as a plain edit, stage by stage', () => {
    const host = flatWorld();
    host.setBlock(0, Y - 1, 0, B.CAMPFIRE);
    host.setBlock(0, Y, 0, B.COOKING_POT_BREW, brewMeta(0, 0)); // what the guest's edit sets (no scheduled tick came with it)
    expect(host.scheduled.size).toBe(1);
    run(host, BREW_STAGE_TICKS * BREW_STAGES + 20);
    expect(host.getBlock(0, Y, 0)).toBe(B.COOKING_POT_BREW);
    expect(host.getMeta(0, Y, 0) & 128).toBe(128); // ready
  });

  it('a ready pot is not started again by a neighbour', () => {
    const w = flatWorld();
    w.setBlock(0, Y, 0, B.COOKING_POT_BREW, readyMeta(0, 3));
    w.scheduled.clear();
    w.setBlock(1, Y, 0, B.STONE);
    expect(w.scheduled.size).toBe(0);
  });

  it('a guest\'s own world does not cook (the host\'s stages arrive as edits)', () => {
    const guest = flatWorld();
    guest.passive = true;
    guest.setBlock(0, Y - 1, 0, B.CAMPFIRE);
    guest.setBlock(0, Y, 0, B.COOKING_POT_BREW, brewMeta(0, 0));
    run(guest, BREW_STAGE_TICKS * BREW_STAGES + 20);
    expect(guest.getMeta(0, Y, 0)).toBe(brewMeta(0, 0));
  });

  it('a composter a guest fills to 7 settles to ready on the host', () => {
    const host = flatWorld();
    host.setBlock(0, Y, 0, B.COMPOSTER, 7);
    expect(host.scheduled.size).toBe(1);
    run(host, SETTLE_TICKS + 2);
    expect(host.getMeta(0, Y, 0) & 15).toBe(8);
    // lower levels start nothing
    host.setBlock(1, Y, 0, B.COMPOSTER, 3);
    host.scheduled.clear();
    host.setBlock(1, Y, 0, B.COMPOSTER, 4);
    expect(host.scheduled.size).toBe(0);
  });
});

// ---- mount stamina for guests ------------------------------------------------------------------------------
describe('the stamina of a mount a guest rides', () => {
  it('the host sends the fatigue of the mount under each remote rider, about twice a second', () => {
    const { h, c, sent } = hostWith();
    const rider = { isRemotePlayer: true, remote: { id: 1 }, dead: false, x: 0, z: 0 };
    const mob = new Mob('galloper', 0, 64, 0);
    mob.rider = rider; mob.fatigue = 123.46;
    const free = new Mob('galloper', 3, 64, 3); free.fatigue = 9;
    h.game.entities = { list: [mob, free] };
    h.remotes.set(1, {});
    h.checkSaddles();
    const m = sent.find((x) => x.t === 'stam');
    expect(m).toEqual({ t: 'stam', id: mob.id, f: 123.5 });
    expect(sent.filter((x) => x.t === 'stam').length).toBe(1);
  });
  it('the guest keeps it on the mount it sits on, warns once when the mount tires, and the gauge reads it', () => {
    const c = new ClientSession('Bo');
    const toasts = [];
    const mob = new Mob('galloper', 0, 64, 0);
    c.game = { player: { riding: mob }, hud: { toast: (t) => toasts.push(t) } };
    c.ents = { byNetId: (id) => (id === 5 ? mob : null) };
    expect(mob.fatigue).toBeUndefined(); // nothing yet: the HUD shows no gauge until the host's first message
    c.handle({ t: 'stam', id: 5, f: 10 });
    expect(mob.fatigue).toBe(10);
    expect(staminaGauge(mob).state).toBe('fresh');
    expect(toasts.length).toBe(0);
    c.handle({ t: 'stam', id: 5, f: MOUNT.TIRE_AT + 1 });
    expect(toasts).toEqual([tiredText('tired')]);
    c.handle({ t: 'stam', id: 5, f: MOUNT.TIRE_AT + 5 });
    expect(toasts.length).toBe(1);
    expect(fatigueState(mob.fatigue)).toBe('tired');
    c.handle({ t: 'stam', id: 5, f: 'x' }); c.handle({ t: 'stam', id: 6, f: 3 });
    expect(mob.fatigue).toBe(MOUNT.TIRE_AT + 5);
    // a mount somebody else rides is none of our business
    c.game.player.riding = null;
    c.handle({ t: 'stam', id: 5, f: 1 });
    expect(mob.fatigue).toBe(MOUNT.TIRE_AT + 5);
  });
});

// ---- fuel that comes back --------------------------------------------------------------------------------------
describe('fuel put in a shared Minecart with Furnace', () => {
  const cart = (full = false) => ({ kind: 'boat', furnace: true, x: 0, y: 64, z: 0, fuel: 0, addFuel(t) { if (full) return false; this.fuel += t; return true; } });
  it('is taken when the cart can use it', () => {
    const { h, c, sent } = hostWith();
    const k = cart(); h.entity = () => k;
    h.remoteFuel(c, { id: 1, n: cartFuelTicks(I.COAL), y: 0.5, it: I.COAL });
    expect(k.fuel).toBe(cartFuelTicks(I.COAL));
    expect(sent.length).toBe(0);
  });
  it('comes back when the cart is full, gone, far away or the burn time is not the item\'s', () => {
    const { h, c, sent } = hostWith();
    h.entity = () => cart(true);
    h.remoteFuel(c, { id: 1, n: cartFuelTicks(I.COAL), y: 0, it: I.COAL });
    h.entity = () => undefined;
    h.remoteFuel(c, { id: 1, n: cartFuelTicks(I.COAL), y: 0, it: I.COAL });
    const far = cart(); far.x = 50; h.entity = () => far;
    h.remoteFuel(c, { id: 1, n: cartFuelTicks(I.COAL), y: 0, it: I.COAL });
    const k = cart(); h.entity = () => k;
    h.remoteFuel(c, { id: 1, n: FURNACE_CART.MAX_FUEL, y: 0, it: I.COAL }); // claims far more than a lump of coal burns
    h.remoteFuel(c, { id: 1, n: 5, y: 0, it: I.STICK });                     // not a fuel for a cart at all
    expect(sent.map((m) => m.t)).toEqual(['fuelno', 'fuelno', 'fuelno', 'fuelno', 'fuelno']);
    expect(k.fuel).toBe(0);
  });
  it('an older guest (no item in the message) is handled as before', () => {
    const { h, c, sent } = hostWith();
    const k = cart(); h.entity = () => k;
    h.remoteFuel(c, { id: 1, n: 800, y: 0 });
    expect(k.fuel).toBe(800);
    h.remoteFuel(c, { id: 1, n: 999999, y: 0 });
    expect(k.fuel).toBe(800 + FURNACE_CART.MAX_FUEL);
    expect(sent.length).toBe(0);
  });
  it('the guest gets the item back (the lava bucket in place of the empty one)', () => {
    const c = new ClientSession('Bo');
    const inv = { slots: new Array(36).fill(null), selected: 0, changed() {}, get selectedStack() { return this.slots[this.selected]; }, add(st) { const i = this.slots.findIndex((s) => !s); if (i < 0) return st.count; this.slots[i] = { ...st }; return 0; } };
    const toasts = [];
    c.game = { player: { inventory: inv, creative: false, x: 0, y: 64, z: 0 }, hud: { toast: (t) => toasts.push(t) } };
    c.onFuelRefused({ it: I.COAL });
    expect(inv.slots.filter(Boolean).map((s) => s.id)).toEqual([I.COAL]);
    inv.slots.fill(null); inv.slots[0] = { id: I.BUCKET, count: 1, damage: 0 };
    c.onFuelRefused({ it: I.LAVA_BUCKET });
    expect(inv.slots[0].id).toBe(I.LAVA_BUCKET);
    expect(inv.slots.filter(Boolean).length).toBe(1);
    // creative guests spent nothing; things that are no fuel are not handed out
    inv.slots.fill(null);
    c.game.player.creative = true; c.onFuelRefused({ it: I.COAL });
    c.game.player.creative = false; c.onFuelRefused({ it: I.DIAMOND });
    expect(inv.slots.filter(Boolean).length).toBe(0);
    expect(toasts.length).toBe(2); // one per item handed back
  });
  it('the client names the fuel item in its message', () => {
    const c = new ClientSession('Bo');
    const sent = [];
    c.send = (m) => sent.push(m);
    c.fuelCart({ netId: 9 }, 1600, 1.234, I.COAL);
    expect(sent[0]).toEqual({ t: 'fuel', id: 9, n: 1600, y: 1.23, it: I.COAL });
  });
});

// ---- saved host options and the bandwidth readout ----------------------------------------------------------------
describe('host options are saved with the world', () => {
  it('clean values only: booleans stay booleans, the player limit is 2 to 8', () => {
    expect(cleanHostSettings(null)).toEqual(DEFAULT_HOST_SETTINGS);
    expect(cleanHostSettings({ pvp: false, gc: false, ffa: true, mp: 3 })).toEqual({ pvp: false, gc: false, ffa: true, mp: 3 });
    expect(cleanHostSettings({ pvp: 'no', gc: 0, ffa: 1, mp: 99 })).toEqual({ ...DEFAULT_HOST_SETTINGS, mp: 8 });
    expect(cleanHostSettings({ mp: 1 }).mp).toBe(2);
    expect(cleanHostSettings({ mp: 2.5 }).mp).toBe(8);
  });
  it('changing an option updates what the game saves; a reopened world brings them back', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    h.game = { hostSettings: null };
    h.sendEnv = () => {};
    h.setOptions({ mp: 4, ffa: true, pvp: false });
    expect(h.game.hostSettings).toEqual({ pvp: false, gc: true, ffa: true, mp: 4 });
    const again = new HostSession('Host', null, 'ABCDEF');
    again.loadSettings(JSON.parse(JSON.stringify(h.game.hostSettings)));
    expect(again.settingsSave()).toEqual({ pvp: false, gc: true, ffa: true, mp: 4 });
    again.loadSettings({ mp: -5, pvp: 'x' });
    expect(again.settingsSave().mp).toBe(2);
    expect(again.pvp).toBe(true);
  });
  it('a guest never writes them', () => {
    const c = new ClientSession('Bo');
    c.game = { hostSettings: null };
    c.setOptions({ mp: 2, pvp: false });
    expect(c.game.hostSettings).toBe(null);
  });
});

describe('bandwidth readout', () => {
  it('formats bytes and kilobytes a second', () => {
    expect(rateText(0)).toBe('0 B/s');
    expect(rateText(920)).toBe('920 B/s');
    expect(rateText(1536)).toBe('1.5 KB/s');
    expect(rateText(21 * 1024)).toBe('21 KB/s');
    expect(rateText(undefined)).toBe('0 B/s');
  });
  it('the host lists every guest with its traffic, backlog and refused drops', () => {
    const h = new HostSession('Host', null, 'ABCDEF');
    const r1 = new Rate(), r2 = new Rate(); r1.bps = 4096; r2.bps = 512;
    const led = new GuestLedger(); led.denied = 3;
    h.clients.set(1, { id: 1, name: 'Bo', joined: true, ping: 80, skipped: 2, ledger: led, ch: { rate: r1, rateIn: r2, backlog: () => 2048 } });
    const lines = h.debugLines();
    expect(lines[0]).toContain('ABCDEF');
    expect(lines[0]).toContain('2/8 players');
    expect(lines[0]).toContain('out 4.0 KB/s');
    expect(lines[1]).toContain('Bo');
    expect(lines[1]).toContain('80 ms');
    expect(lines[1]).toContain('backlog 2 KB');
    expect(lines[1]).toContain('drops refused 3');
  });
  it('the guest shows its ping and rates', () => {
    const c = new ClientSession('Bo');
    c.welcome = { hostName: 'Hosty' };
    const a = new Rate(), b = new Rate(); a.bps = 100; b.bps = 20000;
    c.ch = { rate: a, rateIn: b };
    c.rtt = 64;
    expect(c.debugLines()[0]).toBe('Net guest of Hosty  ping 64 ms  in 20 KB/s  out 100 B/s  1 players');
  });
  it('the channel counts what comes in', () => {
    // (Channel is internal; the Rate it uses is the same class the guard tests cover: it settles on bytes per second)
    const r = new Rate();
    r.tick(1); r.add(2000); r.tick(1001);
    expect(r.bps).toBe(1000);
  });
});
