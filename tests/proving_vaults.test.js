import { describe, it, expect } from 'vitest';
import { rng } from './helpers.js';
import { B, BLOCKS, EMIT } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { World } from '../src/world/world.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { ON } from '../src/world/circuitShapes.js';
import { TerrainGenerator } from '../src/world/generator.js';
import {
  VAULTS_REGION, VAULTS_MIN_FLOOR, VAULTS_MAX_FLOOR, VAULTS_LOOT, PROVING_MOBS, ROOM_TEMPLATES,
  planVaults, vaultsInRegion, vaultsNear, boxesOverlap, corridorFloor, stampProvingVaults,
  SPAWNER_STATE, WAVE_BASE, WAVE_PER_PLAYER, MAX_ALIVE, COOLDOWN_TICKS, GIVE_UP_TICKS, waveSize, newSpawnerState, spawnerStep, spawnerSpawned,
  spawnerMeta, spawnerKind, spawnerShown, saveSpawnerStates, loadSpawnerStates, VaultLedger,
} from '../src/world/provingVaults.js';
import { ProvingSystem } from '../src/world/provingSystem.js';
import { rollStack, spawnerRewards, vaultRoll, SPAWNER_REWARDS, VAULT_LOOT } from '../src/world/provingLoot.js';
import { dungeonLoot } from '../src/mobs/spawnerBlocks.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import '../src/mobs/hostileVariants.js';
import '../src/mobs/gustling.js';
import { craft } from '../src/player/crafting.js';
import { stonecutterOutputs } from '../src/world/workstations.js';

/** The first few structures of a seed. */
function plans(seed, n = 12) {
  const out = [];
  for (let r = 0; out.length < n && r < 12; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const v = planVaults(seed, rx, rz);
    if (v) out.push({ v, rx, rz });
  }
  return out;
}

/** Stamp every chunk of a structure into solid stone; returns a block getter over the result. */
function stampAll(seed, v) {
  const chunks = new Map();
  for (let cx = Math.floor(v.x0 / 16) - 1; cx <= Math.floor(v.x1 / 16) + 1; cx++) for (let cz = Math.floor(v.z0 / 16) - 1; cz <= Math.floor(v.z1 / 16) + 1; cz++) {
    const blocks = new Uint16Array(CHUNK_VOLUME).fill(B.STONE), meta = new Uint8Array(CHUNK_VOLUME);
    stampProvingVaults(seed, blocks, meta, cx, cz);
    chunks.set(`${cx},${cz}`, { blocks, meta });
  }
  const at = (x, y, z) => { const c = chunks.get(`${x >> 4},${z >> 4}`); return c ? c.blocks[cidx(x & 15, y, z & 15)] : B.STONE; };
  const metaAt = (x, y, z) => { const c = chunks.get(`${x >> 4},${z >> 4}`); return c ? c.meta[cidx(x & 15, y, z & 15)] : 0; };
  return { at, metaAt, chunks };
}

describe('Proving Vaults layout', () => {
  const seed = 2024, list = plans(seed);
  it('turns up in about half the regions', () => {
    let n = 0, found = 0;
    for (let rx = -8; rx < 8; rx++) for (let rz = -8; rz < 8; rz++) { n++; if (planVaults(seed, rx, rz)) found++; }
    expect(found / n).toBeGreaterThan(0.25);
    expect(found / n).toBeLessThan(0.7);
    expect(list.length).toBeGreaterThan(5);
  });
  it('is the same every time for a seed', () => {
    for (const { v, rx, rz } of list) {
      const again = planVaults(seed, rx, rz);
      expect(JSON.stringify(again)).toBe(JSON.stringify(v));
      expect(vaultsInRegion(seed, rx, rz)).toEqual(v);
    }
    expect(JSON.stringify(planVaults(seed + 1, list[0].rx, list[0].rz))).not.toBe(JSON.stringify(list[0].v));
  });
  it('has an atrium and 6 to 10 rooms (mostly), joined by corridors, none overlapping', () => {
    let full = 0;
    for (const { v, rx, rz } of list) {
      expect(v.pieces[0].kind).toBe('atrium');
      expect(v.rooms.length).toBeGreaterThanOrEqual(3);
      expect(v.rooms.length).toBeLessThanOrEqual(10);
      if (v.rooms.length >= 6) full++;
      const corridors = v.pieces.filter((p) => p.kind === 'corridor');
      expect(corridors.length).toBe(v.rooms.length);
      for (let i = 0; i < v.pieces.length; i++) for (let j = i + 1; j < v.pieces.length; j++) expect(boxesOverlap(v.pieces[i], v.pieces[j])).toBe(false);
      // inside its region, deep underground
      for (const p of v.pieces) {
        expect(p.x0).toBeGreaterThanOrEqual(rx * VAULTS_REGION);
        expect(p.x1).toBeLessThan((rx + 1) * VAULTS_REGION);
        expect(p.z0).toBeGreaterThanOrEqual(rz * VAULTS_REGION);
        expect(p.z1).toBeLessThan((rz + 1) * VAULTS_REGION);
        expect(p.y0).toBeGreaterThan(MIN_Y + 5);
        if (p.kind !== 'corridor') { expect(p.f).toBeGreaterThanOrEqual(VAULTS_MIN_FLOOR); expect(p.f).toBeLessThanOrEqual(VAULTS_MAX_FLOOR); }
      }
      for (const r of v.rooms) expect(ROOM_TEMPLATES[r.kind]).toBeTruthy();
    }
    expect(full / list.length).toBeGreaterThan(0.75);
  });
  it('climbs and falls one block per step along a corridor', () => {
    let sloped = 0;
    for (const { v } of list) for (const c of v.pieces.filter((p) => p.kind === 'corridor')) {
      expect(corridorFloor(c, 0)).toBe(c.yA);
      expect(corridorFloor(c, c.len - 1)).toBe(c.yB);
      for (let k = 1; k < c.len; k++) expect(Math.abs(corridorFloor(c, k) - corridorFloor(c, k - 1))).toBeLessThanOrEqual(1);
      if (c.yA !== c.yB) sloped++;
    }
    expect(sloped).toBeGreaterThan(0);
  });
  it('furnishes rooms with spawners, vaults, chests, pots and bulbs', () => {
    const count = {};
    for (const { v } of list) for (const p of v.pieces) for (const [, , , id, m] of p.decor) {
      count[id] = (count[id] || 0) + 1;
      if (id === B.PROVING_SPAWNER || id === B.OMINOUS_SPAWNER) expect(PROVING_MOBS).toContain(spawnerKind(m));
      if (id === B.CHEST) expect(m >> 4).toBe(VAULTS_LOOT);
    }
    for (const id of [B.PROVING_SPAWNER, B.VAULT, B.CHEST, B.DECORATED_POT, B.COPPER_BULB_LIT, B.COPPER_GRATE, B.ASHSTONE_BRICK_STAIRS]) expect(count[id] || 0).toBeGreaterThan(list.length);
    for (const k of PROVING_MOBS) expect(MOBS[k]).toBeTruthy();
  });
  it('/locate finds them', () => {
    const { v } = list[0];
    expect(vaultsNear(seed, v.cx - 10, v.cz - 10, v.cx + 10, v.cz + 10)).toContainEqual(v);
  });
});

describe('Proving Vaults stamping', () => {
  const seed = 77, { v } = plans(seed, 1)[0];
  const S = stampAll(seed, v);
  it('hollows the atrium and rooms and puts the furnishings in', () => {
    const a = v.pieces[0];
    expect(S.at(a.cx + 4, a.f + 2, a.cz + 3)).toBe(B.AIR);
    expect(S.at(a.cx, a.f + 4, a.cz)).toBe(B.VAULT_BRICKS); // the central column
    const last = new Map(); // later furnishings win where two share a cell (stairs over a balcony)
    for (const p of v.pieces) for (const [x, y, z, id, m] of p.decor) last.set(`${x},${y},${z}`, [x, y, z, id, m]);
    for (const [x, y, z, id, m] of last.values()) {
      expect(S.at(x, y, z)).toBe(id);
      expect(S.metaAt(x, y, z)).toBe(m);
    }
    for (const r of v.rooms) expect(S.at(r.cx + 1, r.f + 1, r.cz + 1)).toBe(B.AIR);
  });
  it('walls every piece in (nothing open to the rock outside but air within)', () => {
    for (const p of v.pieces) for (let x = p.x0; x <= p.x1; x++) for (let z = p.z0; z <= p.z1; z++) {
      expect(S.at(x, p.y0, z)).not.toBe(B.STONE);
      expect(S.at(x, p.y1, z)).not.toBe(B.STONE);
    }
  });
  it('cuts open doorways at both ends of every corridor', () => {
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const c of v.pieces.filter((p) => p.kind === 'corridor')) {
      const [dx, dz] = DIRS[c.dir];
      for (const [k, f] of [[-1, c.yA], [c.len, c.yB]]) {
        const x = c.x + dx * k, z = c.z + dz * k;
        expect(S.at(x, f + 1, z)).toBe(B.AIR);
        expect(S.at(x, f + 2, z)).toBe(B.AIR);
      }
    }
  });
  it('gives the same blocks whichever chunk is generated first', () => {
    const [k] = [...S.chunks.keys()].filter((key) => S.chunks.get(key).blocks.some((b) => b === B.VAULT_BRICKS));
    const [cx, cz] = k.split(',').map(Number);
    const blocks = new Uint16Array(CHUNK_VOLUME).fill(B.STONE), meta = new Uint8Array(CHUNK_VOLUME);
    stampProvingVaults(seed, blocks, meta, cx, cz);
    expect(blocks).toEqual(S.chunks.get(k).blocks);
  });
  it('appears in the real terrain', () => {
    const a = v.pieces[0];
    const c = new TerrainGenerator(seed).generate(Math.floor(a.cx / 16), Math.floor(a.cz / 16));
    const lx = a.cx & 15, lz = a.cz & 15;
    expect(c.blocks[cidx(lx, a.f + 4, lz)]).toBe(B.VAULT_BRICKS);
  });
});

describe('Proving Spawner waves', () => {
  it('wave sizes grow with the players', () => {
    expect(waveSize(1)).toBe(WAVE_BASE);
    expect(waveSize(1)).toBe(6);
    expect(waveSize(3)).toBe(WAVE_BASE + 2 * WAVE_PER_PLAYER);
  });
  /** Run a spawner: kills whenever `kill` says so; returns what came out. */
  function run(players, ticks, killEvery = 30) {
    const s = newSpawnerState();
    let alive = 0, maxAlive = 0, spawned = 0, ejected = 0, t = 0;
    for (; t < ticks; t++) {
      if (alive > 0 && t % killEvery === 0) alive--;
      const r = spawnerStep(s, players, alive);
      if (r.spawn) { spawnerSpawned(s); alive++; spawned++; }
      if (r.eject) { ejected = r.eject; break; }
      maxAlive = Math.max(maxAlive, alive);
    }
    return { s, maxAlive, spawned, ejected, t };
  }
  it('wakes for a player, keeps at most 3 about, and rewards when the wave is beaten', () => {
    const r = run(1, 5000, 100);
    expect(r.spawned).toBe(6);
    expect(r.maxAlive).toBeLessThanOrEqual(MAX_ALIVE);
    expect(r.maxAlive).toBe(MAX_ALIVE);
    expect(r.ejected).toBe(1);
    expect(r.s.state).toBe(SPAWNER_STATE.COOLDOWN);
    expect(r.s.cooldown).toBe(COOLDOWN_TICKS);
    const two = run(2, 5000);
    expect(two.spawned).toBe(8);
    expect(two.ejected).toBe(2);
  });
  it('rests 30 minutes before it wakes again', () => {
    const s = { ...newSpawnerState(), state: SPAWNER_STATE.COOLDOWN, cooldown: COOLDOWN_TICKS };
    expect(COOLDOWN_TICKS).toBe(36000);
    for (let t = 0; t < COOLDOWN_TICKS - 1; t++) expect(spawnerStep(s, 1, 0).spawn).toBe(false);
    expect(s.state).toBe(SPAWNER_STATE.COOLDOWN);
    expect(spawnerStep(s, 1, 0).changed).toBe(true);
    expect(s.state).toBe(SPAWNER_STATE.IDLE);
    expect(spawnerStep(s, 1, 0).changed).toBe(true);
    expect(s.state).toBe(SPAWNER_STATE.ACTIVE);
  });
  it('stays asleep with nobody near and calls a wave off when everyone leaves', () => {
    const s = newSpawnerState();
    for (let t = 0; t < 100; t++) spawnerStep(s, 0, 0);
    expect(s.state).toBe(SPAWNER_STATE.IDLE);
    spawnerStep(s, 1, 0);
    for (let t = 0; t < GIVE_UP_TICKS; t++) spawnerStep(s, 0, 0);
    expect(s.state).toBe(SPAWNER_STATE.IDLE);
  });
  it('keeps its kind and shown state in the meta, and saves its rest', () => {
    const m = spawnerMeta(PROVING_MOBS.indexOf('skitterer'), SPAWNER_STATE.COOLDOWN);
    expect(spawnerKind(m)).toBe('skitterer');
    expect(spawnerShown(m)).toBe(SPAWNER_STATE.COOLDOWN);
    const map = new Map([['1,-30,2', { ...newSpawnerState(), state: SPAWNER_STATE.COOLDOWN, cooldown: 500 }], ['5,5,5', newSpawnerState()]]);
    const saved = JSON.parse(JSON.stringify(saveSpawnerStates(map)));
    expect(saved.length).toBe(1);
    const back = loadSpawnerStates(saved);
    expect(back.get('1,-30,2').cooldown).toBe(500);
    expect(loadSpawnerStates([['bad', 2, 5], null, ['1,2,3', 2, 1e9]]).get('1,2,3').cooldown).toBe(COOLDOWN_TICKS);
  });
});

describe('Vaults and loot', () => {
  it('lets each player open a vault once', () => {
    const l = new VaultLedger();
    expect(l.unlock('1,2,3', 'Ann')).toBe(true);
    expect(l.unlock('1,2,3', 'Ann')).toBe(false);
    expect(l.unlock('1,2,3', 'Bob')).toBe(true);
    expect(l.unlock('4,5,6', 'Ann')).toBe(true);
    expect(l.has('1,2,3', 'Ann')).toBe(true);
    expect(l.has('1,2,3', 'Cid')).toBe(false);
    expect(l.unlock('1,2,3', '')).toBe(false);
    const back = new VaultLedger();
    back.load(JSON.parse(JSON.stringify(l.save())));
    expect(back.names('1,2,3')).toEqual(['Ann', 'Bob']);
    back.load([['x', ['Ann']], ['7,8,9', 'nope'], 5]);
    expect(back.map.size).toBe(0);
  });
  it('rolls real items', () => {
    const r = rng(5);
    for (let k = 0; k < 200; k++) {
      for (const st of [rollStack(SPAWNER_REWARDS, r), ...vaultRoll(r), ...spawnerRewards(2, r)]) {
        expect(ITEMS[st.id]).toBeTruthy();
        expect(st.count).toBeGreaterThan(0);
      }
    }
    expect(spawnerRewards(3, r).length).toBe(3);
    // keys turn up often enough from spawners
    let keys = 0;
    for (let k = 0; k < 500; k++) if (rollStack(SPAWNER_REWARDS, r).id === I.PROVING_KEY) keys++;
    expect(keys).toBeGreaterThan(100);
    const chest = dungeonLoot(r, VAULTS_LOOT).filter(Boolean);
    expect(chest.length).toBeGreaterThanOrEqual(2);
    expect(VAULT_LOOT.length).toBeGreaterThan(5);
  });
});

/** A small stand-in game for the run-time system. */
function fakeGame(spawnerAt, players = 1) {
  const blocks = new Map(), meta = new Map(), k = (x, y, z) => `${x},${y},${z}`;
  blocks.set(k(...spawnerAt), B.PROVING_SPAWNER);
  meta.set(k(...spawnerAt), spawnerMeta(0));
  blocks.set(k(10, 0, 10), B.VAULT);
  const chunk = { provers: new Set([k(...spawnerAt)]) };
  const g = {
    ticks: 0, settings: {}, difficulty: 'normal', items: [], mobs: [],
    world: {
      dimension: 'overworld',
      getChunk: (cx, cz) => (cx === 0 && cz === 0 ? chunk : null),
      getBlock: (x, y, z) => blocks.get(k(x, y, z)) ?? (y < 0 ? B.STONE : B.AIR),
      getMeta: (x, y, z) => meta.get(k(x, y, z)) || 0,
      setBlock: (x, y, z, id, m) => { blocks.set(k(x, y, z), id); meta.set(k(x, y, z), m); return true; },
    },
    spawner: {
      canFit: () => true,
      spawnMob: (type, x, y, z) => { const m = { type, x, y, z, dead: false, removed: false, deathTime: 0 }; g.mobs.push(m); return m; },
    },
    entities: { spawnItem: (x, y, z, st) => { g.items.push(st); } },
    hud: { toasts: [], toast(m) { this.toasts.push(m); } },
    player: { x: 3, y: 0, z: 3, dead: false, creative: false, netName: null, inventory: null },
  };
  if (players > 1) {
    g.net = { isHost: true, players: () => [{ name: 'host', obj: g.player }, ...Array.from({ length: players - 1 }, (_, i) => ({ name: 'guest' + i, obj: { x: 4, y: 0, z: 4, dead: false, creative: false } }))], broadcast: (m) => { g.sent = m; } };
  }
  return g;
}

describe('Proving system in a game', () => {
  it('runs a whole wave: spawns, waits for kills, ejects rewards and rests', () => {
    const g = fakeGame([5, 0, 5]), ps = new ProvingSystem(g);
    for (let t = 0; t < 4000; t++) {
      ps.tick();
      if (t % 25 === 0) { const live = g.mobs.find((m) => !m.dead); if (live) live.dead = true; }
      if (g.items.length) break;
      expect(g.mobs.filter((m) => !m.dead).length).toBeLessThanOrEqual(MAX_ALIVE);
    }
    expect(g.mobs.length).toBe(6);
    expect(g.mobs.every((m) => m.type === 'shambler')).toBe(true);
    expect(g.items.length).toBe(1);
    expect(spawnerShown(g.world.getMeta(5, 0, 5))).toBe(SPAWNER_STATE.COOLDOWN);
    // resting: nothing more comes
    for (let t = 0; t < 200; t++) ps.tick();
    expect(g.mobs.length).toBe(6);
    const saved = ps.save();
    expect(saved.spawners.length).toBe(1);
    const ps2 = new ProvingSystem(g);
    ps2.load(JSON.parse(JSON.stringify(saved)));
    expect(ps2.spawners.get('5,0,5').state).toBe(SPAWNER_STATE.COOLDOWN);
  });
  it('calls a bigger wave for two players and rewards both', () => {
    const g = fakeGame([5, 0, 5], 2), ps = new ProvingSystem(g);
    for (let t = 0; t < 6000 && !g.items.length; t++) {
      ps.tick();
      if (t % 25 === 0) { const live = g.mobs.find((m) => !m.dead); if (live) live.dead = true; }
    }
    expect(g.mobs.length).toBe(8);
    expect(g.items.length).toBe(2);
  });
  it('ignores players who are too far away or in creative', () => {
    const g = fakeGame([5, 0, 5]), ps = new ProvingSystem(g);
    g.player.x = 30;
    for (let t = 0; t < 200; t++) ps.tick();
    expect(g.mobs.length).toBe(0);
    g.player.x = 3; g.player.creative = true;
    for (let t = 0; t < 200; t++) ps.tick();
    expect(g.mobs.length).toBe(0);
  });
  it('opens a vault once per player for a Proving Key', () => {
    const g = fakeGame([5, 0, 5], 2), ps = new ProvingSystem(g);
    expect(ps.openVault(10, 0, 10, 'Ann', null).ok).toBe(false);
    expect(ps.openVault(10, 0, 10, 'Ann', { id: I.BREAD, count: 1 }).ok).toBe(false);
    expect(ps.openVault(10, 0, 10, 'Ann', { id: I.PROVING_KEY, count: 1 }).ok).toBe(true);
    expect(g.items.length).toBeGreaterThanOrEqual(1);
    expect(g.sent).toEqual({ t: 'vaultset', k: '10,0,10', n: ['Ann'] });
    const r = ps.openVault(10, 0, 10, 'Ann', { id: I.PROVING_KEY, count: 1 });
    expect(r.ok).toBe(false);
    expect(r.msg).toMatch(/already/);
    expect(ps.openVault(10, 0, 10, 'Bob', { id: I.PROVING_KEY, count: 1 }).ok).toBe(true);
    // single player: the key is used up
    const sp = fakeGame([5, 0, 5]), ps1 = new ProvingSystem(sp);
    const slots = [{ id: I.PROVING_KEY, count: 2 }];
    sp.player.inventory = { selected: 0, get selectedStack() { return slots[0]; }, removeFromSlot(i, n) { slots[0].count -= n; } };
    ps1.useVault(10, 0, 10);
    expect(slots[0].count).toBe(1);
    ps1.useVault(10, 0, 10);
    expect(slots[0].count).toBe(1);
    expect(sp.hud.toasts[0]).toMatch(/already/);
    // breaking the vault forgets it
    ps1.blockChanged(10, 0, 10, B.VAULT, B.AIR);
    expect(ps1.vaults.has('10,0,10', 'player')).toBe(false);
  });
});

describe('Proving Vault blocks', () => {
  it('defines the new blocks and the key', () => {
    for (const id of [B.VAULT_BRICKS, B.ASHSTONE_BRICKS, B.ASHSTONE_TILES, B.POLISHED_ASHSTONE, B.ASHSTONE_BRICK_SLAB, B.ASHSTONE_BRICK_STAIRS, B.COPPER_GRATE, B.COPPER_BULB, B.COPPER_BULB_LIT, B.PROVING_SPAWNER, B.VAULT]) expect(BLOCKS[id]).toBeTruthy();
    expect(EMIT[B.COPPER_BULB_LIT]).toBe(15);
    expect(EMIT[B.COPPER_BULB]).toBe(0);
    expect(BLOCKS[B.COPPER_GRATE].opaque).toBe(false);
    expect(ITEMS[I.PROVING_KEY].name).toBe('Proving Key');
  });
  it('crafts and cuts Ashstone from Tuff, and copper grates and bulbs', () => {
    const g = (rows) => rows.flat().map((id) => (id ? { id, count: 1 } : null));
    expect(craft(g([[B.TUFF, B.TUFF], [B.TUFF, B.TUFF]]), 2)).toMatchObject({ id: B.POLISHED_ASHSTONE, count: 4 });
    expect(craft(g([[null, B.COPPER_BLOCK, null], [B.COPPER_BLOCK, null, B.COPPER_BLOCK], [null, B.COPPER_BLOCK, null]]), 3)).toMatchObject({ id: B.COPPER_GRATE });
    expect(craft(g([[null, B.COPPER_BLOCK, null], [B.COPPER_BLOCK, B.TORCH, B.COPPER_BLOCK], [null, I.CINNABAR, null]]), 3)).toMatchObject({ id: B.COPPER_BULB });
    const cut = stonecutterOutputs(B.TUFF).map((o) => o.id);
    for (const id of [B.POLISHED_ASHSTONE, B.ASHSTONE_BRICKS, B.ASHSTONE_TILES, B.ASHSTONE_BRICK_STAIRS]) expect(cut).toContain(id);
  });
  it('a Copper Bulb switches on each rising edge of a cinnabar signal', () => {
    const chunk = () => {
      const blocks = new Uint16Array(CHUNK_VOLUME);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
      const light = new Uint8Array(CHUNK_VOLUME);
      computeChunkLight(blocks, light);
      return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
    };
    const w = new World(1);
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.addChunk(cx, cz, chunk());
    w.tick();
    w.setBlock(0, 64, 0, B.COPPER_BULB, 0);
    w.setBlock(1, 64, 0, B.LEVER, 0);
    for (let i = 0; i < 3; i++) w.tick();
    expect(w.getBlock(0, 64, 0)).toBe(B.COPPER_BULB);
    const flip = () => { w.setBlock(1, 64, 0, B.LEVER, w.getMeta(1, 64, 0) ^ ON); for (let i = 0; i < 3; i++) w.tick(); };
    flip();
    expect(w.getBlock(0, 64, 0)).toBe(B.COPPER_BULB_LIT);
    flip(); // the signal goes: it stays lit
    expect(w.getBlock(0, 64, 0)).toBe(B.COPPER_BULB_LIT);
    flip(); // the next rising edge puts it out
    expect(w.getBlock(0, 64, 0)).toBe(B.COPPER_BULB);
  });
});

describe('Vaults in multiplayer', () => {
  const wire = (x) => JSON.parse(JSON.stringify(x));
  it('the host checks a guest\'s key against its ledger, answers and shares the ledger', async () => {
    const { HostSession, ClientSession } = await import('../src/net/session.js');
    const h = new HostSession('Host', null, 'ABCDEF');
    const sent = [], broadcast = [];
    const rp = { id: 4, name: 'Ann', state: { x: 10, y: -1, z: 12 }, target: null };
    const c = { id: 4, name: 'Ann', joined: true, rp, ch: { send: (m) => sent.push(wire(m)), conn: { send() {} } } };
    const g = fakeGame([5, 0, 5]);
    g.net = h;
    g.proving = new ProvingSystem(g);
    h.game = g;
    h.broadcast = (m) => broadcast.push(wire(m));
    h.clients.set(c.id, c);
    h.onMessage(c, { t: 'vault', x: 10, y: 0, z: 10, st: { id: I.BREAD, count: 1 } });
    expect(sent.pop()).toMatchObject({ t: 'vaultno' });
    h.onMessage(c, { t: 'vault', x: 10, y: 0, z: 10, st: { id: I.PROVING_KEY, count: 1 } });
    expect(sent.pop()).toMatchObject({ t: 'used', item: I.PROVING_KEY, consume: 1 });
    expect(g.items.length).toBeGreaterThan(0);
    expect(broadcast.pop()).toEqual({ t: 'vaultset', k: '10,0,10', n: ['Ann'] });
    h.onMessage(c, { t: 'vault', x: 10, y: 0, z: 10, st: { id: I.PROVING_KEY, count: 1 } });
    expect(sent.pop().m).toMatch(/already/);
    // too far away, or not a vault: no answer
    rp.state = { x: 60, y: 0, z: 60 };
    h.onMessage(c, { t: 'vault', x: 10, y: 0, z: 10, st: { id: I.PROVING_KEY, count: 1 } });
    expect(sent.length).toBe(0);
    // a guest takes the ledger in and refuses locally once it has opened a vault
    const cl = new ClientSession('Ann');
    const cg = fakeGame([5, 0, 5]);
    cg.proving = new ProvingSystem(cg);
    cl.game = cg;
    cl.handle({ t: 'vaultset', k: '10,0,10', n: ['Ann'] });
    expect(cg.proving.vaults.has('10,0,10', 'Ann')).toBe(true);
    cl.handle({ t: 'vaultset', k: 'bad', n: ['Ann'] });
    expect(cg.proving.vaults.map.size).toBe(1);
  });
});
