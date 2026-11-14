// Dropped items and nearby hostile mobs survive a save (world/saveEntities.js through saveGame / applySave).
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorage, setStorage } from '../src/world/storage.js';
import { saveGame, applySave, buildSaveData } from '../src/world/save.js';
import { migrateSave } from '../src/world/saveFormat.js';
import { ItemEntity } from '../src/entities/entities.js';
import { Mob } from '../src/mobs/mob.js';
import '../src/mobs/spawner.js'; // registers every mob type
import { chunkKey } from '../src/world/world.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { mockGame } from './fixtures/mockGame.js';

beforeEach(() => setStorage(new MemoryStorage()));

const clone = (x) => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));

function withEntities(g) {
  g.entities = {
    list: [],
    spawnItem(x, y, z, st, vel) {
      const e = new ItemEntity(x, y, z, st);
      if (vel) { e.body.vx = vel[0]; e.body.vy = vel[1]; e.body.vz = vel[2]; }
      this.list.push(e);
      return e;
    },
  };
  g.weather.load = () => {}; g.milestones.load = () => {}; // (what applySave calls on a real game)
  g.maps = new Map(); g.explored = null; g.game = g;
  return g;
}
const dropItem = (g, x, y, z, st, extra = {}) => { const e = g.entities.spawnItem(x, y, z, st, [0.1, 0.2, -0.1]); Object.assign(e, extra); return e; };
const mob = (g, type, x, y, z) => { const m = new Mob(type, x, y, z); g.entities.list.push(m); return m; };
const queued = (g) => [...g.spawner.savedMobs.values()].flat();
const items = (g) => g.entities.list.filter((e) => e.kind === 'item');
const bare = () => clone(buildSaveData(mockGame()));
async function reload(g) {
  const data = clone(await saveGame(g));
  const g2 = withEntities(mockGame());
  applySave(g2, data);
  return { data, g2 };
}

describe('dropped items', () => {
  it('round trip with extras, velocity, age and pickup delay', async () => {
    const g = withEntities(mockGame());
    const sword = { id: I.IRON_SWORD, count: 1, damage: 7, ench: { forgebite: 2 }, rw: 2, label: 'Biter' };
    dropItem(g, 9.5, 66, 9.5, sword, { age: 1234, pickupDelay: 17 });
    dropItem(g, 10.5, 66, 9.5, { id: B.COBBLESTONE, count: 33 });
    const { g2 } = await reload(g);
    const list = items(g2);
    expect(list).toHaveLength(2);
    const s = list.find((e) => e.stack.id === I.IRON_SWORD);
    expect(s.stack).toMatchObject({ id: I.IRON_SWORD, count: 1, damage: 7, rw: 2, label: 'Biter' });
    expect(s.stack.ench).toEqual(sword.ench);
    expect(s.age).toBe(1234);
    expect(s.pickupDelay).toBe(17);
    expect(s.x).toBeCloseTo(9.5); expect(s.body.vy).toBeCloseTo(0.2);
    expect(list.find((e) => e.stack.id === B.COBBLESTONE).stack.count).toBe(33);
  });

  it('keeps the nearest 400, nearest first', async () => {
    const g = withEntities(mockGame());
    for (let i = 449; i >= 0; i--) dropItem(g, 8.5 + i * 0.5, 66, 8.5, { id: B.DIRT, count: 1 }); // (farthest added first)
    const data = clone(await saveGame(g));
    expect(data.items).toHaveLength(400);
    const xs = data.items.map((i) => i.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(Math.max(...xs)).toBeLessThan(8.5 + 400 * 0.5);
  });

  it('skips junk without throwing', () => {
    const g = withEntities(mockGame());
    const good = { x: 1, y: 70, z: 1, v: [0, 0, 0], age: 5, pd: 0, st: { id: B.DIRT, count: 3 } };
    const junk = [null, 5, 'x', {}, { ...good, x: NaN }, { ...good, y: Infinity }, { ...good, st: { id: 999999, count: 1 } }, { ...good, st: { id: B.DIRT, count: 0 } },
      { ...good, st: { id: B.DIRT, count: 1e9 } }, { ...good, st: { id: 'dirt', count: 1 } }, { ...good, st: null }, { ...good, y: 5000 }];
    expect(() => applySave(g, { ...bare(), items: [...junk, good] })).not.toThrow();
    expect(items(g)).toHaveLength(1);
    expect(items(g)[0].age).toBe(5);
  });

  it('clamps a silly age and delay', () => {
    const g = withEntities(mockGame());
    applySave(g, { ...bare(), items: [{ x: 1, y: 70, z: 1, age: 1e9, pd: -5, st: { id: B.DIRT, count: 1 } }] });
    expect(items(g)[0].age).toBe(5999);
    expect(items(g)[0].pickupDelay).toBe(0);
  });

  it('a guest saves none', async () => {
    const g = withEntities(mockGame());
    g.net = { isClient: true };
    dropItem(g, 9, 66, 9, { id: B.DIRT, count: 1 });
    mob(g, 'shambler', 12, 61, 12);
    const data = await saveGame(g);
    expect(data.items).toEqual([]);
    expect(data.hostiles).toEqual([]);
  });
});

describe('hostile mobs', () => {
  it('restores health, gear and name near the player', async () => {
    const g = withEntities(mockGame());
    const m = mob(g, 'shambler', 12.5, 61, 12.5);
    m.health = 7; m.equip = { hand: { id: I.IRON_SWORD, count: 1, damage: 0 }, armor: [null, null, null, null] };
    m.customName = 'Grim';
    const { data, g2 } = await reload(g);
    expect(data.hostiles).toHaveLength(1);
    expect(g2.spawner.savedMobs.get(chunkKey(0, 0))).toHaveLength(1);
    const q = queued(g2)[0];
    const r = new Mob('shambler', q.x, q.y, q.z);
    r.loadData(q);
    expect(r.health).toBe(7);
    expect(r.customName).toBe('Grim');
    expect(r.equip && r.equip.hand && r.equip.hand.id).toBe(I.IRON_SWORD);
  });

  it('only saves living, nearby, despawnable monsters', async () => {
    const g = withEntities(mockGame());
    mob(g, 'shambler', 10, 61, 10);
    mob(g, 'shambler', 500, 61, 500); // far
    const dead = mob(g, 'shambler', 11, 61, 11); dead.deathTime = 5;
    const pers = mob(g, 'shambler', 12, 61, 12); pers.persistent = true; // keeps its own path (liveMobs)
    const raider = mob(g, 'shambler', 13, 61, 13); raider.raider = true; raider.persistent = true;
    mob(g, 'fleecer', 14, 61, 14); // an animal
    const data = await saveGame(g);
    expect(data.hostiles).toHaveLength(1);
    expect(data.liveMobs.filter((m) => m.type === 'fleecer')).toHaveLength(1);
    expect(data.liveMobs.filter((m) => m.type === 'shambler')).toHaveLength(2); // (saved once, there)
  });

  it('caps at 80, nearest first', async () => {
    const g = withEntities(mockGame());
    for (let i = 99; i >= 0; i--) mob(g, 'shambler', 8.5 + i * 0.5, 61, 8.5);
    const data = await saveGame(g);
    expect(data.hostiles).toHaveLength(80);
    expect(data.hostiles.map((m) => m.x)).toEqual([...data.hostiles.map((m) => m.x)].sort((a, b) => a - b));
    expect(Math.max(...data.hostiles.map((m) => m.x))).toBeLessThan(8.5 + 80 * 0.5);
  });

  it('does not come back on peaceful or with hostile spawning off; junk is rejected', async () => {
    const g = withEntities(mockGame());
    mob(g, 'shambler', 12, 61, 12);
    const data = clone(await saveGame(g));
    for (const rules of [{ difficulty: 'peaceful' }, { doHostileSpawning: false }]) {
      const g2 = withEntities(mockGame());
      applySave(g2, { ...data, gameRules: { ...data.gameRules, ...rules } });
      expect(queued(g2)).toHaveLength(0);
    }
    const g3 = withEntities(mockGame());
    const ok = data.hostiles[0];
    const bad = [null, 3, {}, { ...ok, type: 'nope' }, { ...ok, type: 'fleecer' }, { ...ok, x: NaN }, { ...ok, health: -1 }, { ...ok, raider: true }];
    expect(() => applySave(g3, { ...data, hostiles: [...bad, ok] })).not.toThrow();
    expect(queued(g3)).toHaveLength(1);
  });
});

describe('older saves', () => {
  it('load without items or hostiles', async () => {
    const g = withEntities(mockGame());
    const data = clone(await saveGame(g));
    delete data.items; delete data.hostiles;
    const g2 = withEntities(mockGame());
    expect(() => applySave(g2, migrateSave(data).data)).not.toThrow();
    expect(items(g2)).toHaveLength(0);
    expect(queued(g2)).toHaveLength(0);
  });
});
