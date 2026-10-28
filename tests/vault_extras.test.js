import { describe, it, expect, vi } from 'vitest';
import { rng } from './helpers.js';
import { B, BLOCKS, EXT_BASE } from '../src/world/blocks.js';
import { I, ITEMS } from '../src/world/items.js';
import { CHUNK_VOLUME, cidx, MIN_Y } from '../src/world/constants.js';
import { World } from '../src/world/world.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { texId } from '../src/world/textures.js';
import {
  PROVING_MOBS, OMINOUS_CHANCE, WAVE_RULES, MAX_ALIVE, SPAWN_INTERVAL, COOLDOWN_TICKS, SPAWNER_STATE,
  isProver, planVaults, waveSize, waveRules, newSpawnerState, spawnerStep, spawnerSpawned, spawnerMeta, spawnerKind, spawnerShown, stampProvingVaults,
} from '../src/world/provingVaults.js';
import { ProvingSystem, OMINOUS_ARMOR_CHANCE } from '../src/world/provingSystem.js';
import { spawnerRewards, OMINOUS_REWARDS, SPAWNER_REWARDS, rollStack } from '../src/world/provingLoot.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { rollDrops } from '../src/mobs/drops.js';
import {
  GUSTLING, Gust, gustImpulse, gustBurst, gustCooldown, deflects, galeLeap,
  GUST_DAMAGE, GUST_RADIUS, GUST_SPEED, WINDUP_TICKS, DEFLECTED,
} from '../src/mobs/gustling.js';
import { Mob } from '../src/mobs/mob.js';
import { hasEnch } from '../src/world/enchantments.js';

// ---- the Gustling ---------------------------------------------------------------------------

describe('Gustling and Gale Rod definitions', () => {
  it('is a flying hostile mob that a Proving Spawner can call', () => {
    expect(MOBS.gustling).toBe(GUSTLING);
    expect(MOB_KEYS).toContain('gustling');
    expect(GUSTLING).toMatchObject({ name: 'Gustling', category: CATEGORY.MONSTER, flying: true, noFallDamage: true });
    expect(GUSTLING.width).toBeLessThan(0.7);
    expect(GUSTLING.height).toBeLessThan(1.2); // a small mob
    expect(PROVING_MOBS).toContain('gustling');
    expect(PROVING_MOBS.length).toBeLessThanOrEqual(16); // the kind is kept in 4 meta bits
    expect(spawnerKind(spawnerMeta(PROVING_MOBS.indexOf('gustling'), SPAWNER_STATE.ACTIVE))).toBe('gustling');
    expect(MODELS.gustling.parts.length).toBeGreaterThan(5);
    expect(typeof FACES.gustling).toBe('function');
    expect(new Mob('gustling', 0, 64, 0).def).toBe(GUSTLING);
  });
  it('drops 1 or 2 Gale Rods for a player, none otherwise', () => {
    expect(ITEMS[I.GALE_ROD].name).toBe('Gale Rod');
    const r = rng(3), counts = new Set();
    for (let k = 0; k < 200; k++) {
      const d = rollDrops('gustling', { killedByPlayer: true }, r).filter((x) => x.id === I.GALE_ROD);
      expect(d.length).toBe(1);
      counts.add(d[0].count);
    }
    expect([...counts].sort()).toEqual([1, 2]);
    expect(rollDrops('gustling', { killedByPlayer: false }, r).some((x) => x.id === I.GALE_ROD)).toBe(false);
  });
});

describe('Gust physics', () => {
  it('throws away from the centre, up, and less the further it is', () => {
    const [vx, vy, vz] = gustImpulse(1, 0, 1);
    expect(vx).toBeGreaterThan(0); expect(vz).toBe(0);
    expect(vy).toBeGreaterThanOrEqual(0.4);
    const near = gustImpulse(0.5, 0, 0.5), far = gustImpulse(2, 0, 2);
    expect(near[0]).toBeGreaterThan(far[0]);
    expect(gustImpulse(1, 0, GUST_RADIUS)).toEqual([0, 0, 0]);
    expect(gustImpulse(5, 0, 5)).toEqual([0, 0, 0]);
    // a direct hit is full strength whatever the distance, along the flight
    const [dx, dy, dz] = gustImpulse(0, -1, 0, GUST_RADIUS, true);
    expect(dz).toBeCloseTo(-1.1); expect(dx).toBeCloseTo(0); expect(dy).toBeCloseTo(0.7);
    expect(gustImpulse(0, 0, 0)[0]).toBe(0); // no offset: no horizontal push
  });
  it('turns arrows, spears and fireballs aside and nothing else', () => {
    for (const s of ['arrow', 'spear', 'fireball']) expect(deflects(s)).toBe(true);
    for (const s of ['player', 'fall', 'fire', 'magic', 'thrown', 'explosion']) expect(deflects(s)).toBe(false);
    expect(DEFLECTED.size).toBe(3);
    const m = new Mob('gustling', 0, 64, 0);
    expect(m.hurt(6, 'arrow')).toBe(false);
    expect(m.hurt(6, 'fireball')).toBe(false);
    expect(m.health).toBe(20);
    expect(m.hurt(6, 'player')).not.toBe(false);
    expect(m.health).toBe(14);
  });
  it('spaces its Gusts 45 to 69 ticks apart', () => {
    const r = rng(2), seen = new Set();
    for (let k = 0; k < 500; k++) seen.add(gustCooldown(r));
    expect(Math.min(...seen)).toBe(45); expect(Math.max(...seen)).toBe(69);
  });
});

/** A stand-in game: nothing in the way, one player, a log of what the Gust does. */
function windGame(extra = {}) {
  const player = { x: 0, y: 64, z: 0, dead: false, creative: false, eyeHeight: 1.62, body: { vx: 0, vy: 0, vz: 0, onGround: true, fallDistance: 5, height: 1.8 } };
  const g = {
    ticks: 0, player,
    world: { raycast: () => null, getBlock: () => 0 },
    audio: { play: vi.fn() }, particles: { emit: vi.fn() },
    entities: { list: [], add(e) { this.list.push(e); return e; }, sweepHit: () => null },
    ...extra,
  };
  return g;
}

describe('the Gust', () => {
  it('flies straight and fast, and burns out', () => {
    const g = windGame(), gust = new Gust(0, 65, 0, 0, 0, -GUST_SPEED, null);
    for (let k = 0; k < 10; k++) gust.tick(g);
    expect(gust.z).toBeCloseTo(-9);
    expect(gust.dead).toBe(false);
    for (let k = 0; k < 100; k++) gust.tick(g);
    expect(gust.dead).toBe(true);
  });
  it('hurts a player for a point and throws them along its flight, cancelling their fall', () => {
    const g = windGame(), shooter = {};
    g.player.z = -5; // the player is the one hit
    const target = { isPlayer: true, x: 0, y: 64, z: -5, width: 0.6, height: 1.8, hurt: vi.fn(() => true) };
    g.entities.sweepHit = () => target;
    const gust = new Gust(0, 65, 0, 0, 0, -GUST_SPEED, shooter);
    gust.tick(g);
    expect(gust.dead).toBe(true);
    expect(target.hurt).toHaveBeenCalledTimes(1);
    expect(target.hurt.mock.calls[0].slice(0, 3)).toEqual([GUST_DAMAGE, 'mob:Gustling', shooter]);
    expect(GUST_DAMAGE).toBe(1);
    const b = g.player.body;
    expect(b.vz).toBeCloseTo(-1.1);  // away from the Gustling (the burst does not throw them a second time)
    expect(b.vy).toBeGreaterThanOrEqual(0.4);
    expect(b.onGround).toBe(false);
    expect(b.fallDistance).toBe(0);
    expect(g.audio.play).toHaveBeenCalledWith('gust', expect.anything(), expect.anything());
  });
  it('does not throw a player it missed, a guest\'s stand-in, or another Gustling', () => {
    const g = windGame();
    g.player.x = 50; // far from the burst: only the guest's stand-in is in the way
    g.entities.sweepHit = () => ({ isPlayer: true, remote: {}, x: 0, y: 64, z: -5, width: 0.6, height: 1.8, hurt: () => true });
    new Gust(0, 65, 0, 0, 0, -GUST_SPEED, null).tick(g);
    expect(g.player.body.vz).toBe(0); // the guest's own game applies the shove; the host's player is untouched
    const other = windGame();
    other.entities.sweepHit = () => ({ type: 'gustling', x: 0, y: 64, z: -2, width: 0.5, height: 0.9, hurt: vi.fn() });
    const gust = new Gust(0, 65, 0, 0, 0, -GUST_SPEED, null);
    gust.tick(other);
    expect(gust.dead).toBe(false); // flies on through its own kind
  });
  it('bursts on a wall and shoves everything within 2.5 blocks', () => {
    const g = windGame();
    const mob = { kind: 'mob', type: 'shambler', x: 1.5, y: 64, z: -4, height: 1.95, dead: false, deathTime: 0, body: { vx: 0, vy: 0, vz: 0, onGround: true, fallDistance: 0 } };
    const far = { kind: 'mob', type: 'shambler', x: 8, y: 64, z: -4, height: 1.95, dead: false, deathTime: 0, body: { vx: 0, vy: 0, vz: 0, onGround: true, fallDistance: 0 } };
    const own = { kind: 'mob', type: 'gustling', x: 1, y: 64, z: -4, height: 0.9, dead: false, deathTime: 0, body: { vx: 0, vy: 0, vz: 0, onGround: true, fallDistance: 0 } };
    g.entities.list.push(mob, far, own);
    g.world.raycast = () => ({ dist: 4, id: B.STONE });
    g.player.z = -4.5; g.player.x = 0.5;
    const gust = new Gust(0, 65, 0, 0, 0, -GUST_SPEED, null);
    gust.y = 64.5;
    // fly until it meets the wall four blocks ahead (the stub always reports one)
    gust.tick(g);
    expect(gust.dead).toBe(true);
    expect(mob.body.vx).toBeGreaterThan(0);  // east of the burst: pushed east
    expect(mob.body.vy).toBeGreaterThanOrEqual(0.4);
    expect(far.body.vx).toBe(0);
    expect(own.body.vx).toBe(0);
    expect(g.player.body.vy).toBeGreaterThan(0); // the player stood within the radius
    expect(g.particles.emit).toHaveBeenCalled();
  });
  it('gustBurst spares players in creative and the dead', () => {
    const g = windGame();
    g.player.creative = true;
    gustBurst(g, 0, 64, 0);
    expect(g.player.body.vy).toBe(0);
  });
});

describe('Gustling behaviour', () => {
  function setup(distance = 6) {
    const g = windGame();
    const m = new Mob('gustling', 0, 64, 0);
    m._game = g;
    g.player.x = 0; g.player.z = -distance; g.player.y = 64;
    m.target = 'player';
    return { g, m };
  }
  it('winds up, then hurls one Gust at the player, and waits before the next', () => {
    const { g, m } = setup();
    m.gustTimer = 0;
    const shots = () => g.entities.list.filter((e) => e instanceof Gust);
    let wound = 0;
    for (let t = 0; t < WINDUP_TICKS - 1; t++) { g.ticks++; GUSTLING.customAI(m, g, g.player, 6); if (m.angry) wound++; expect(shots().length).toBe(0); }
    expect(wound).toBe(WINDUP_TICKS - 1);                   // the windup shows (guests see "angry")
    g.ticks++; GUSTLING.customAI(m, g, g.player, 6);
    expect(shots().length).toBe(1);
    expect(m.angry).toBe(false);
    expect(m.gustTimer).toBeGreaterThanOrEqual(45);
    const gust = shots()[0];
    expect(gust.vz).toBeLessThan(0);                        // towards the player at z = -6
    expect(Math.hypot(gust.vx, gust.vy, gust.vz)).toBeCloseTo(GUST_SPEED);
    for (let t = 0; t < 40; t++) { g.ticks++; GUSTLING.customAI(m, g, g.player, 6); }
    expect(shots().length).toBe(1);                          // still resting
  });
  it('does not wind up without a line of sight or beyond its range, and hovers about the player', () => {
    const { g, m } = setup(30);
    m.gustTimer = 0;
    for (let t = 0; t < 60; t++) { g.ticks++; GUSTLING.customAI(m, g, g.player, 30); }
    expect(g.entities.list.length).toBe(0);
    expect(m.angry).toBe(false);
    const { g: g2, m: m2 } = setup(8);
    m2.gustTimer = 0;
    g2.world.raycast = () => ({ dist: 1 }); // a wall in the way
    for (let t = 0; t < 60; t++) { g2.ticks++; GUSTLING.customAI(m2, g2, g2.player, 8); }
    expect(g2.entities.list.length).toBe(0);
  });
  it('flies to head height near its target instead of walking', () => {
    const { g, m } = setup(5);
    g.player.y = 70;
    for (let t = 0; t < 60; t++) { g.ticks++; GUSTLING.customAI(m, g, g.player, 5); m.flyMove(g); }
    expect(m.body.vy).toBeDefined();
    expect(m.y).toBeGreaterThan(65);
  });
  it('idles near the floor when nobody is about', () => {
    const { g, m } = setup(6);
    m.target = null; g.player.dead = true;
    g.world.getBlock = (x, y) => (y < 60 ? B.STONE : 0);
    m.body.setPos(0, 70, 0);
    for (let t = 0; t < 200; t++) { g.ticks++; GUSTLING.customAI(m, g, g.player, 6); m.flyMove(g); }
    expect(m.y).toBeLessThan(66);
    expect(g.entities.list.length).toBe(0);
  });
});

describe('Gale Rod', () => {
  it('bursts upwards and softens the landing', () => {
    const addEffect = vi.fn();
    const g = windGame();
    g.player.addEffect = addEffect;
    galeLeap(g);
    expect(g.player.body.vy).toBeGreaterThanOrEqual(1);
    expect(g.player.body.onGround).toBe(false);
    expect(g.player.body.fallDistance).toBe(0);
    expect(addEffect).toHaveBeenCalledWith('slow_falling', expect.any(Number), 0);
    expect(g.audio.play).toHaveBeenCalled();
    expect(ITEMS[I.GALE_ROD].galeRod).toBe(true);
  });
});

// ---- the ominous Proving Spawner ----------------------------------------------------------------

describe('Ominous Proving Spawner: block', () => {
  it('is a new block appended at the end of the extended list, with its own textures', () => {
    expect(BLOCKS[B.OMINOUS_SPAWNER].name).toBe('Ominous Proving Spawner');
    expect(B.OMINOUS_SPAWNER).toBeGreaterThanOrEqual(EXT_BASE);
    expect(B.OMINOUS_SPAWNER).toBe(B.FLETCHING_TABLE + 1); // appended: no earlier id moved
    for (const k of ['PROVING_SPAWNER', 'VAULT', 'LOOM', 'FLETCHING_TABLE']) expect(B[k]).toBeLessThan(B.OMINOUS_SPAWNER);
    const d = BLOCKS[B.OMINOUS_SPAWNER], base = BLOCKS[B.PROVING_SPAWNER];
    expect(d.hardness).toBe(base.hardness); expect(d.opaque).toBe(false); expect(d.drops).toBe(null);
    expect(d.tex.top).toBe('ominous_spawner_top');
    for (const n of ['top', 'side_0', 'side_1', 'side_2']) expect(texId('ominous_spawner_' + n)).toBeGreaterThanOrEqual(0);
    expect(isProver(B.PROVING_SPAWNER)).toBe(true);
    expect(isProver(B.OMINOUS_SPAWNER)).toBe(true);
    expect(isProver(B.VAULT)).toBe(false);
  });

  it('is tracked as a spawner by its chunk like the ordinary one', () => {
    const w = new World(1);
    const blocks = new Uint16Array(CHUNK_VOLUME), light = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < 64; y++) blocks[cidx(x, y, z)] = B.STONE;
    computeChunkLight(blocks, light);
    w.addChunk(0, 0, { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) });
    w.setBlock(3, 64, 4, B.OMINOUS_SPAWNER, 0);
    w.setBlock(5, 64, 6, B.PROVING_SPAWNER, 0);
    expect([...w.getChunk(0, 0).provers].sort()).toEqual(['3,64,4', '5,64,6']);
    w.setBlock(3, 64, 4, B.AIR, 0);
    expect([...w.getChunk(0, 0).provers]).toEqual(['5,64,6']);
    // turning one into the other keeps it listed
    w.setBlock(5, 64, 6, B.OMINOUS_SPAWNER, 0);
    expect([...w.getChunk(0, 0).provers]).toEqual(['5,64,6']);
  });
});

describe('Ominous Proving Spawner: waves and rewards', () => {
  it('calls 10 mobs for one player and 3 more for each other, 5 about at once, one every 28 ticks', () => {
    expect(waveRules(false)).toBe(WAVE_RULES.normal);
    expect(waveRules(true)).toBe(WAVE_RULES.ominous);
    expect(waveSize(1)).toBe(6);
    expect(waveSize(1, true)).toBe(10);
    expect(waveSize(3, true)).toBe(16);
    expect(WAVE_RULES.ominous.maxAlive).toBeGreaterThan(MAX_ALIVE);
    expect(WAVE_RULES.ominous.interval).toBeLessThan(SPAWN_INTERVAL);
  });
  function run(ominous, players = 1) {
    const s = newSpawnerState();
    let alive = 0, spawned = 0, maxAlive = 0, ejected = 0, firstSpawns = [];
    for (let t = 0; t < 8000; t++) {
      if (alive > 0 && t % 60 === 0) alive--;
      const r = spawnerStep(s, players, alive, ominous);
      if (r.spawn) { spawnerSpawned(s); alive++; spawned++; firstSpawns.push(t); }
      maxAlive = Math.max(maxAlive, alive);
      if (r.eject) { ejected = r.eject; break; }
    }
    return { s, spawned, maxAlive, ejected, firstSpawns };
  }
  it('runs a whole ominous wave and rests 30 minutes afterwards like the other', () => {
    const o = run(true), n = run(false);
    expect(o.spawned).toBe(10);
    expect(o.maxAlive).toBe(5);
    expect(o.ejected).toBe(1);
    expect(o.s.state).toBe(SPAWNER_STATE.COOLDOWN);
    expect(o.s.cooldown).toBe(COOLDOWN_TICKS);
    expect(n.spawned).toBe(6);
    expect(n.maxAlive).toBe(3);
    // the first mobs come quicker
    expect(o.firstSpawns[1] - o.firstSpawns[0]).toBe(WAVE_RULES.ominous.interval);
    expect(n.firstSpawns[1] - n.firstSpawns[0]).toBe(SPAWN_INTERVAL);
    expect(run(true, 2).spawned).toBe(13);
  });
  it('defaults to the ordinary rules', () => {
    const a = newSpawnerState(), b = newSpawnerState();
    for (let t = 0; t < 200; t++) expect(spawnerStep(a, 1, 0)).toEqual(spawnerStep(b, 1, 0, false));
  });
  it('throws out two reward rolls per player, from a richer table with more keys', () => {
    const r = rng(8);
    expect(spawnerRewards(1, r).length).toBe(1);
    expect(spawnerRewards(1, r, true).length).toBe(2);
    expect(spawnerRewards(3, r, true).length).toBe(6);
    expect(spawnerRewards(0, r, true).length).toBe(2); // a wave always pays someone
    for (let k = 0; k < 300; k++) for (const st of spawnerRewards(2, r, true)) { expect(ITEMS[st.id]).toBeTruthy(); expect(st.count).toBeGreaterThan(0); }
    let keysO = 0, keysN = 0, dia = 0, diaN = 0;
    for (let k = 0; k < 4000; k++) {
      const a = rollStack(OMINOUS_REWARDS, r), b = rollStack(SPAWNER_REWARDS, r);
      if (a.id === I.PROVING_KEY) keysO += a.count;
      if (b.id === I.PROVING_KEY) keysN += b.count;
      if (a.id === I.DIAMOND) dia++;
      if (b.id === I.DIAMOND) diaN++;
    }
    expect(keysO).toBeGreaterThan(keysN * 1.5);
    expect(dia).toBeGreaterThan(0);
    expect(diaN).toBe(0);
  });
});

describe('Ominous Proving Spawner: in the halls', () => {
  it('some of the hall\'s spawners are ominous, chosen from their position alone', () => {
    const seed = 2024;
    let plain = 0, omin = 0, found = 0;
    for (let rx = -6; rx < 6 && found < 14; rx++) for (let rz = -6; rz < 6 && found < 14; rz++) {
      const v = planVaults(seed, rx, rz);
      if (!v) continue;
      found++;
      expect(JSON.stringify(planVaults(seed, rx, rz))).toBe(JSON.stringify(v)); // still the same plan every time
      for (const p of v.pieces) for (const [, , , id, m] of p.decor) {
        if (id === B.PROVING_SPAWNER) { plain++; expect(PROVING_MOBS).toContain(spawnerKind(m)); }
        if (id === B.OMINOUS_SPAWNER) { omin++; expect(PROVING_MOBS).toContain(spawnerKind(m)); expect(spawnerShown(m)).toBe(0); }
      }
    }
    expect(omin).toBeGreaterThan(0);
    expect(plain).toBeGreaterThan(omin);
    expect(omin / (omin + plain)).toBeGreaterThan(OMINOUS_CHANCE / 3);
    expect(omin / (omin + plain)).toBeLessThan(OMINOUS_CHANCE * 3);
    // stamped into a chunk they appear as the block
    const seen = new Set();
    for (let rx = -6; rx < 6; rx++) for (let rz = -6; rz < 6; rz++) {
      const v = planVaults(seed, rx, rz);
      if (!v) continue;
      const cx = Math.floor(v.cx / 16), cz = Math.floor(v.cz / 16);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const blocks = new Uint16Array(CHUNK_VOLUME).fill(B.STONE), meta = new Uint8Array(CHUNK_VOLUME);
        stampProvingVaults(seed, blocks, meta, cx + dx, cz + dz);
        for (const id of blocks) if (id === B.OMINOUS_SPAWNER || id === B.PROVING_SPAWNER) seen.add(id);
      }
      if (seen.size === 2) break;
    }
    expect(seen.has(B.OMINOUS_SPAWNER)).toBe(true);
  });
});

/** A small stand-in game for the run-time system (spawner at `at`, of block `id`). */
function fakeGame(at, id = B.OMINOUS_SPAWNER, kind = 0) {
  const blocks = new Map(), meta = new Map(), k = (x, y, z) => `${x},${y},${z}`;
  blocks.set(k(...at), id);
  meta.set(k(...at), spawnerMeta(kind));
  const chunk = { provers: new Set([k(...at)]) };
  const g = {
    ticks: 0, settings: {}, difficulty: 'normal', items: [], mobs: [],
    world: {
      dimension: 'overworld',
      getChunk: (cx, cz) => (cx === 0 && cz === 0 ? chunk : null),
      getBlock: (x, y, z) => blocks.get(k(x, y, z)) ?? (y < 0 ? B.STONE : B.AIR),
      getMeta: (x, y, z) => meta.get(k(x, y, z)) || 0,
      setBlock: (x, y, z, bid, m) => { blocks.set(k(x, y, z), bid); meta.set(k(x, y, z), m); return true; },
    },
    spawner: {
      canFit: () => true,
      spawnMob: (type, x, y, z) => { const m = { type, x, y, z, dead: false, removed: false, deathTime: 0, equip: null, canPickUp: true }; g.mobs.push(m); return m; },
    },
    entities: { spawnItem: (x, y, z, st) => { g.items.push(st); } },
    particles: { emit: vi.fn(), smoke: vi.fn(), flame: vi.fn() },
    audio: { play: vi.fn() },
    hud: { toast() {} },
    player: { x: 3, y: 0, z: 3, dead: false, creative: false, netName: null, effects: {}, listeners: {} },
  };
  return g;
}
const killOne = (g) => { const live = g.mobs.find((m) => !m.dead); if (live) live.dead = true; };

describe('Ominous Proving Spawner: running', () => {
  it('calls its bigger wave of armed mobs, five at a time, and pays two rolls', () => {
    const g = fakeGame([5, 0, 5], B.OMINOUS_SPAWNER, PROVING_MOBS.indexOf('shambler')), ps = new ProvingSystem(g);
    let maxAlive = 0;
    for (let t = 0; t < 6000 && !g.items.length; t++) {
      ps.tick();
      maxAlive = Math.max(maxAlive, g.mobs.filter((m) => !m.dead).length);
      if (t % 40 === 0) killOne(g);
    }
    expect(g.mobs.length).toBe(10);
    expect(maxAlive).toBeLessThanOrEqual(5);
    expect(maxAlive).toBeGreaterThan(3);
    expect(g.items.length).toBe(2);
    // it stays the ominous block while it fights and rests, showing its state in the meta
    expect(g.world.getBlock(5, 0, 5)).toBe(B.OMINOUS_SPAWNER);
    expect(spawnerShown(g.world.getMeta(5, 0, 5))).toBe(SPAWNER_STATE.COOLDOWN);
    expect(spawnerKind(g.world.getMeta(5, 0, 5))).toBe('shambler');
    // the mobs wear gear; most carry armour, none pick things up
    expect(g.mobs.every((m) => m.equip && !m.canPickUp)).toBe(true);
    expect(g.mobs.filter((m) => m.equip.armor.some(Boolean)).length).toBeGreaterThanOrEqual(3);
    expect(OMINOUS_ARMOR_CHANCE).toBeGreaterThan(0.5);
  });

  it('archers come with a bow, sometimes enchanted, and Gustlings with nothing', () => {
    const g = fakeGame([5, 0, 5], B.OMINOUS_SPAWNER, PROVING_MOBS.indexOf('rattler')), ps = new ProvingSystem(g);
    for (let t = 0; t < 8000 && g.mobs.length < 10; t++) { ps.tick(); if (t % 40 === 0) killOne(g); }
    expect(g.mobs.length).toBe(10);
    for (const m of g.mobs) expect(m.equip.hand.id).toBe(I.BOW);
    const gl = fakeGame([5, 0, 5], B.OMINOUS_SPAWNER, PROVING_MOBS.indexOf('gustling')), ps2 = new ProvingSystem(gl);
    for (let t = 0; t < 8000 && gl.mobs.length < 10; t++) { ps2.tick(); if (t % 40 === 0) killOne(gl); }
    expect(gl.mobs.length).toBe(10);
    expect(gl.mobs.every((m) => m.type === 'gustling' && !m.equip)).toBe(true);
    // gear of the ominous kind: some of it enchanted over many mobs
    let enchanted = 0;
    for (let n = 0; n < 6; n++) {
      const x = fakeGame([5, 0, 5], B.OMINOUS_SPAWNER, 0), p3 = new ProvingSystem(x);
      for (let t = 0; t < 8000 && x.mobs.length < 10; t++) { p3.tick(); if (t % 40 === 0) killOne(x); }
      enchanted += x.mobs.filter((m) => [m.equip.hand, ...m.equip.armor].some(hasEnch)).length;
    }
    expect(enchanted).toBeGreaterThan(0);
  });

  it('an ordinary spawner is turned ominous by a player with Dark Omen, who loses the omen', () => {
    const g = fakeGame([5, 0, 5], B.PROVING_SPAWNER, PROVING_MOBS.indexOf('skitterer')), ps = new ProvingSystem(g);
    const heard = vi.fn();
    g.player.listeners = { effect: [heard] };
    g.player.effects = { dark_omen: { amp: 0, ticks: 5000 } };
    ps.tick();
    expect(g.world.getBlock(5, 0, 5)).toBe(B.OMINOUS_SPAWNER);
    expect(spawnerKind(g.world.getMeta(5, 0, 5))).toBe('skitterer'); // keeps its mob
    expect(g.player.effects.dark_omen).toBeUndefined();
    expect(heard).toHaveBeenCalled();
    // its wave is the ominous one, and the state survived the change of block
    for (let t = 0; t < 6000 && !g.items.length; t++) { ps.tick(); if (t % 40 === 0) killOne(g); }
    expect(g.mobs.length).toBe(10);
    expect(g.items.length).toBe(2);
    expect(ps.spawners.get('5,0,5').state).toBe(SPAWNER_STATE.COOLDOWN);
  });

  it('without Dark Omen, in creative, or mid-wave an ordinary spawner stays ordinary', () => {
    const g = fakeGame([5, 0, 5], B.PROVING_SPAWNER), ps = new ProvingSystem(g);
    for (let t = 0; t < 400; t++) { ps.tick(); if (t % 25 === 0) killOne(g); }
    expect(g.world.getBlock(5, 0, 5)).toBe(B.PROVING_SPAWNER);
    expect(g.mobs.length).toBeGreaterThan(0);
    g.player.effects = { dark_omen: { amp: 0, ticks: 5000 } }; // the omen arrives during the fight: too late
    for (let t = 0; t < 50; t++) ps.tick();
    expect(g.world.getBlock(5, 0, 5)).toBe(B.PROVING_SPAWNER);
    expect(g.player.effects.dark_omen).toBeDefined();
    const c = fakeGame([5, 0, 5], B.PROVING_SPAWNER), pc = new ProvingSystem(c);
    c.player.creative = true; c.player.effects = { dark_omen: { amp: 0, ticks: 5000 } };
    for (let t = 0; t < 20; t++) pc.tick();
    expect(c.world.getBlock(5, 0, 5)).toBe(B.PROVING_SPAWNER);
    // and with the player too far away
    const f = fakeGame([5, 0, 5], B.PROVING_SPAWNER), pf = new ProvingSystem(f);
    f.player.x = 40; f.player.effects = { dark_omen: { amp: 0, ticks: 5000 } };
    for (let t = 0; t < 20; t++) pf.tick();
    expect(f.world.getBlock(5, 0, 5)).toBe(B.PROVING_SPAWNER);
  });

  it('turning ominous keeps the spawner\'s state, but breaking either forgets it', () => {
    const g = fakeGame([5, 0, 5], B.PROVING_SPAWNER), ps = new ProvingSystem(g);
    ps.spawners.set('5,0,5', { ...newSpawnerState(), state: SPAWNER_STATE.COOLDOWN, cooldown: 900 });
    ps.blockChanged(5, 0, 5, B.PROVING_SPAWNER, B.OMINOUS_SPAWNER);
    expect(ps.spawners.get('5,0,5').cooldown).toBe(900);
    ps.blockChanged(5, 0, 5, B.OMINOUS_SPAWNER, B.AIR);
    expect(ps.spawners.has('5,0,5')).toBe(false);
    ps.spawners.set('5,0,5', newSpawnerState());
    ps.blockChanged(5, 0, 5, B.PROVING_SPAWNER, B.AIR);
    expect(ps.spawners.has('5,0,5')).toBe(false);
  });

  it('saves the rest of an ominous spawner like any other', () => {
    const g = fakeGame([5, 0, 5], B.OMINOUS_SPAWNER), ps = new ProvingSystem(g);
    for (let t = 0; t < 6000 && !g.items.length; t++) { ps.tick(); if (t % 40 === 0) killOne(g); }
    const saved = JSON.parse(JSON.stringify(ps.save()));
    expect(saved.spawners.length).toBe(1);
    const ps2 = new ProvingSystem(g);
    ps2.load(saved);
    expect(ps2.spawners.get('5,0,5').state).toBe(SPAWNER_STATE.COOLDOWN);
  });
});
