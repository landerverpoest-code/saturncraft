// Mounts and vehicles round: boats with a second seat, Chest Boats, Minecarts with Chest and Furnace, Horse Armour, the rideable
// Thistlehorn and its harness, the ride speed model, stamina and following, fall damage, safe dismounting and the multiplayer snapshot.
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { Mob } from '../src/mobs/mob.js';
import { MOBS } from '../src/mobs/mobTypes.js';
import { Boat, Minecart, EntityManager } from '../src/entities/entities.js';
import { Body } from '../src/physics/body.js';
import { PHYS, fallDamage } from '../src/physics/constants.js';
import { B, SOLID } from '../src/world/blocks.js';
import { I, ITEMS, HORSE_ARMOR } from '../src/world/items.js';
import { craft } from '../src/player/crafting.js';
import { packMob, unpackMob, packEntity, unpackEntity, containerState, containerSlots, applySlotChanges } from '../src/net/protocol.js';
import { equipFromIds, equipmentDrops, equipArmor, mobDamageTaken, equipIds } from '../src/mobs/equipment.js';
import { MODELS } from '../src/mobs/models.js';
import { modelRects } from '../src/ui/guideArt.js';
import { CAPTION_TEXT } from '../src/ui/accessibility.js';
import { Game } from '../src/game.js';
import { Interaction } from '../src/player/interaction.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import * as M from '../src/mobs/mounts.js';
import { MockWorld } from './helpers.js';

const noop = () => {};
const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------
// fakes

class Flat extends MockWorld {
  constructor() { super(63); this.dimension = 'overworld'; }
  isLoaded() { return true; }
  setBlock(x, y, z, id) { this.set(x, y, z, id); }
  heightAt() { return 62; }
}

function fakePlayer(x = 0, y = 63, z = 0, over = {}) {
  const slots = [null, null, null, null];
  const inv = {
    selected: 0, slots,
    get selectedStack() { return this.slots[this.selected]; },
    removeFromSlot(i, n = 1) { const s = this.slots[i]; if (!s) return null; s.count -= n; if (s.count <= 0) this.slots[i] = null; return s; },
    add(st) { for (let i = 0; i < this.slots.length; i++) if (!this.slots[i]) { this.slots[i] = st; return 0; } return st.count; },
    changed: noop,
  };
  const body = { x, y, z, vx: 0, vy: 0, vz: 0, fallDistance: 0, setPos(a, b, c) { this.x = a; this.y = b; this.z = c; } };
  return { x, y, z, body, yaw: 0, dead: false, creative: false, sneaking: false, isPlayer: true, inventory: inv, hurt: vi.fn(), riding: null, seat: 0, setPosition(a, b, c) { this.body.setPos(a, b, c); }, eyePos() { return [this.x, this.y + 1.62, this.z]; }, ...over };
}
function fakeGame(over = {}) {
  const items = [], played = [], toasts = [];
  const g = {
    world: new Flat(), ticks: 100, items, played, toasts, boatInput: null,
    audio: { play: (n) => played.push(n) },
    particles: { emit: noop, smoke: noop },
    hud: { toast: (t) => toasts.push(t) },
    entities: { list: [], spawnItem: (x, y, z, st) => items.push(st) },
    player: fakePlayer(),
    mount: vi.fn(() => true), dismount: vi.fn(),
    ...over,
  };
  return g;
}
const mob = (type, x = 0, y = 63, z = 0) => { const m = new Mob(type, x, y, z); if (m.def.onSpawn) m.def.onSpawn(m); return m; };
const stack = (id, count = 1) => ({ id, count, damage: 0 });

// ---------------------------------------------------------------------------------------------
describe('items, recipes and tables', () => {
  const NEW = ['oak_chest_boat', 'minecart_chest', 'minecart_furnace', 'iron_horse_armor', 'gold_horse_armor', 'diamond_horse_armor', 'thistle_harness'];

  it('adds its items at the end of the table, so no id shifts', () => {
    const ids = NEW.map((k) => I[k.toUpperCase()]);
    expect(ids.every(Number.isInteger)).toBe(true);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(Math.min(...ids)).toBeGreaterThan(Math.max(I.SURVEYOR_WAND, I.TARNLING_BUCKET, I.RAW_VENISON));
    expect(Object.values(HORSE_ARMOR)).toEqual([I.IRON_HORSE_ARMOR, I.GOLD_HORSE_ARMOR, I.DIAMOND_HORSE_ARMOR]);
  });

  it('horse armour is no player armour and has three tiers that stack up', () => {
    const tiers = Object.values(HORSE_ARMOR).map((id) => ITEMS[id]);
    for (const d of tiers) { expect(d.armor).toBeUndefined(); expect(d.stack).toBe(1); expect(d.horseArmor.defense).toBeGreaterThan(0); }
    expect(tiers.map((d) => d.horseArmor.tier)).toEqual(['iron', 'gold', 'diamond']);
    expect(tiers[2].horseArmor.defense).toBeGreaterThan(tiers[1].horseArmor.defense);
    expect(tiers[1].horseArmor.defense).toBeGreaterThan(tiers[0].horseArmor.defense);
    // heavier plate tires its wearer sooner than none at all
    for (const d of tiers) expect(d.horseArmor.tiring).toBeGreaterThan(1);
  });

  it('is craftable', () => {
    const s = (id) => (id == null ? null : { id, count: 1 });
    const grid = (ids) => ids.map(s);
    expect(craft(grid([B.CHEST, I.OAK_BOAT, null, null]), 2)).toEqual({ id: I.OAK_CHEST_BOAT, count: 1 });
    expect(craft(grid([I.MINECART, B.CHEST, null, null]), 2)).toEqual({ id: I.MINECART_CHEST, count: 1 });
    expect(craft(grid([B.FURNACE, I.MINECART, null, null]), 2)).toEqual({ id: I.MINECART_FURNACE, count: 1 });
    const X = I.IRON_INGOT, L = I.LEATHER;
    expect(craft(grid([null, null, X, X, L, X, X, X, X]), 3)).toEqual({ id: I.IRON_HORSE_ARMOR, count: 1 });
    expect(craft(grid([null, null, I.GOLD_INGOT, I.GOLD_INGOT, L, I.GOLD_INGOT, I.GOLD_INGOT, I.GOLD_INGOT, I.GOLD_INGOT]), 3)).toEqual({ id: I.GOLD_HORSE_ARMOR, count: 1 });
    expect(craft(grid([null, null, I.DIAMOND, I.DIAMOND, L, I.DIAMOND, I.DIAMOND, I.DIAMOND, I.DIAMOND]), 3)).toEqual({ id: I.DIAMOND_HORSE_ARMOR, count: 1 });
    expect(craft(grid([L, I.STRING, L, L, I.GOLD_NUGGET, L, L, null, L]), 3)).toEqual({ id: I.THISTLE_HARNESS, count: 1 });
  });

  it('the Field Guide lists the Thistlehorn as ridable and tamed with its food, from the tables', () => {
    resetGuideEntries();
    const e = entriesOf('creatures').find((x) => x.key === 'thistlehorn');
    expect(e.traits).toContain('Can be ridden');
    expect(e.tames.length).toBeGreaterThan(0);
  });

  it('every new sound has a caption', () => {
    for (const n of ['paddle', 'mount_pant', 'harness', 'cart_fuel']) { expect(CAPTION_TEXT[n], n).toBeTruthy(); expect(src('src/audio/audio.js')).toContain(`case '${n}'`); }
  });

  it('keeps clear of the words the project does not use', () => {
    const words = new RegExp(['mine' + 'craft', 'neth' + 'er', 'red' + 'stone'].join('|'), 'i'), dimension = new RegExp('\\b' + 'En' + 'd\\b');
    for (const f of ['src/mobs/mounts.js', 'src/world/items.js', 'src/entities/entities.js', 'src/mobs/fauna.js', 'tests/mounts_vehicles.test.js', 'README.md']) {
      expect(src(f), f).not.toMatch(words);
      expect(src(f), f).not.toMatch(dimension);
    }
  });
});

// ---------------------------------------------------------------------------------------------
describe('ride speed model', () => {
  /** Blocks per second a ridden mob reaches on flat ground (a real Body, the same `travel` the mob tick calls). */
  function ridden(m, input, ticks = 120) {
    const w = new Flat(), b = new Body(m.def.width, m.def.height);
    b.setPos(0.5, 63, 0.5);
    m.body = b;
    for (let i = 0; i < 5; i++) b.travel(w, {});
    let z0 = b.z;
    for (let i = 0; i < ticks; i++) {
      if (i === ticks - 20) z0 = b.z;
      const mv = M.rideMove(m, input);
      b.travel(w, { forward: mv.forward, strafe: mv.strafe, yaw: 0, jump: false, speed: m.speed() * (mv.mod || 1) });
    }
    return z0 - b.z; // the last 20 ticks = one second, towards -z
  }

  it('a ridden Galloper outruns a walking player, a sprinting one outruns a walking Galloper, and nothing tops the cap', () => {
    const m = mob('galloper');
    const walk = ridden(m, { forward: 1 }), sprint = ridden(m, { forward: 1, sprint: true });
    expect(walk).toBeGreaterThan(4.317 * 1.5); // a player's walk is 4.3 blocks/s
    expect(walk).toBeCloseTo(m.def.speed * 36, 0); // 8.1 blocks/s
    expect(sprint).toBeGreaterThan(walk);
    expect(sprint).toBeLessThanOrEqual(M.MOUNT.MAX_BPS + 0.05);
  });

  it('is the old crawl no more: the walking push used to be applied twice', () => {
    // forward = speed and travel speed = speed gave speed^2 (a Galloper: 2.2 blocks/s, slower than walking)
    const w = new Flat(), b = new Body(1.4, 1.6);
    b.setPos(0.5, 63, 0.5);
    for (let i = 0; i < 5; i++) b.travel(w, {});
    for (let i = 0; i < 120; i++) b.travel(w, { forward: 0.225, yaw: 0, speed: 0.225 });
    const z = b.z; for (let i = 0; i < 20; i++) b.travel(w, { forward: 0.225, yaw: 0, speed: 0.225 });
    expect(z - b.z).toBeLessThan(3);
  });

  it('every mount type tops out under the cap and over a walking player, backwards is slow, strafing does not add speed', () => {
    for (const type of ['galloper', 'thistlehorn', 'dune_strider']) {
      const m = mob(type);
      const fwd = ridden(m, { forward: 1 }), sp = ridden(m, { forward: 1, sprint: true }), back = ridden(m, { forward: -1 }), diag = ridden(m, { forward: 1, strafe: 1 });
      expect(fwd, type).toBeGreaterThan(4.317);
      expect(sp, type).toBeLessThanOrEqual(M.MOUNT.MAX_BPS + 0.05);
      expect(back, type).toBeLessThan(fwd / 2);
      expect(diag, type).toBeLessThanOrEqual(fwd + 0.01);
    }
  });

  it('wades slower than it walks: the body takes over in the water, and a mount in water is as slow as a wading player', () => {
    const m = mob('galloper');
    const w = new Flat();
    for (let x = -3; x <= 3; x++) for (let z = -30; z <= 3; z++) for (let y = 63; y <= 65; y++) w.set(x, y, z, B.WATER);
    const b = new Body(1.4, 1.6);
    b.setPos(0.5, 63, 0.5);
    m.body = b;
    for (let i = 0; i < 100; i++) { b.updateFluidState(w, 1.3); const mv = M.rideMove(m, { forward: 1 }); b.travel(w, { forward: mv.forward, yaw: 0, jump: false, speed: m.speed() * mv.mod }); }
    const z0 = b.z;
    for (let i = 0; i < 20; i++) { b.updateFluidState(w, 1.3); const mv = M.rideMove(m, { forward: 1 }); b.travel(w, { forward: mv.forward, yaw: 0, jump: false, speed: m.speed() * mv.mod }); }
    const swim = z0 - b.z;
    expect(swim).toBeGreaterThan(0.5);
    expect(swim).toBeLessThan(3.5);
    expect(swim).toBeLessThan(4.317);
  });

  it('boats and carts keep their own speeds under the mounts (8 blocks/s at most)', () => {
    expect(0.04 / (1 - 0.9) * 20).toBeCloseTo(8, 5); // a boat's thrust over its drag
    expect(0.4 * 20).toBe(8); // a cart's top speed
    expect(M.FURNACE_CART.TOP * 20).toBeLessThan(M.MOUNT.MAX_BPS);
  });

  it('a tired mount is slower, a hurt one too, and neither goes below the floor', () => {
    const m = mob('galloper');
    m.health = m.maxHealth;
    const fresh = M.mountTopSpeed(m);
    m.fatigue = M.MOUNT.TIRE_AT + (M.MOUNT.EXHAUST_AT - M.MOUNT.TIRE_AT) / 2;
    const tired = M.mountTopSpeed(m);
    m.fatigue = M.MOUNT.EXHAUST_AT * 2;
    const worn = M.mountTopSpeed(m);
    expect(tired).toBeLessThan(fresh); expect(worn).toBeLessThan(tired);
    expect(worn).toBeCloseTo(fresh * M.MOUNT.TIRED_SPEED, 6);
    expect(M.mountTopSpeed(m, { sprint: true })).toBe(worn); // a worn out mount cannot sprint
    m.fatigue = 0; m.health = 1;
    expect(M.mountTopSpeed(m)).toBeLessThan(fresh);
    expect(M.mountTopSpeed(m)).toBeGreaterThanOrEqual(fresh * 0.7 - 1e-9);
    expect(M.healthFactor(30, 22)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
describe('stamina, feeding and health', () => {
  it('a ridden mount tires, once told, and recovers at rest', () => {
    const g = fakeGame();
    const m = mob('galloper'); m.tamed = true; m.rider = g.player;
    g.boatInput = { forward: 1, sprint: false };
    m.body.vx = 0.4;
    let n = 0;
    while (M.fatigueState(m.fatigue || 0) === 'fresh' && n++ < 20000) { g.ticks++; M.mountTick(m, g); }
    expect(M.fatigueState(m.fatigue)).toBe('tired');
    expect(n).toBeCloseTo(M.MOUNT.TIRE_AT, -1); // about four minutes of riding
    expect(g.toasts.length).toBe(1);
    expect(g.played).toContain('mount_pant');
    for (let k = 0; k < 5000; k++) { g.ticks++; M.mountTick(m, g); }
    expect(g.toasts.length).toBe(2); // worn out: told once more
    m.rider = null;
    for (let k = 0; k < 20000; k++) { g.ticks++; M.mountTick(m, g); }
    expect(m.fatigue).toBe(0);
  });

  it('sprinting and heavy plate tire a mount faster', () => {
    const m = mob('galloper');
    const walk = M.tireStep(m, true, false), sprint = M.tireStep(m, true, true), still = M.tireStep(m, false, false);
    expect(sprint).toBeGreaterThan(walk); expect(walk).toBeGreaterThan(still);
    M.setMountGear(m, 'armor', stack(I.DIAMOND_HORSE_ARMOR));
    expect(M.tireStep(m, true, false)).toBeGreaterThan(walk);
  });

  it('exhaustion costs a mount health, but never the last hearts', () => {
    const g = fakeGame();
    const m = mob('galloper'); m.rider = g.player; m.fatigue = M.MOUNT.EXHAUST_AT + 10; m.health = 10;
    g.boatInput = { forward: 1 }; m.body.vx = 0.3;
    for (let k = 0; k < 6000; k++) { g.ticks++; M.mountTick(m, g); }
    expect(m.health).toBe(M.MOUNT.WEARY_HEALTH);
    expect(m.health).toBeGreaterThan(0);
  });

  it('a rested, tamed mount heals by itself; a wild one does not', () => {
    const g = fakeGame();
    const tame = mob('galloper'), wild = mob('galloper');
    tame.tamed = true; tame.health = 5; wild.health = 5;
    for (let k = 0; k < 600; k++) { g.ticks++; M.mountTick(tame, g); M.mountTick(wild, g); }
    expect(tame.health).toBeGreaterThan(5);
    expect(wild.health).toBe(5);
  });

  it('feeding a tired mount heals it and brings its fatigue down; a fed fresh one breeds', () => {
    const g = fakeGame();
    const p = g.player; p.inventory.slots[0] = stack(I.WHEAT, 5);
    const m = mob('galloper'); m.tamed = true; m.health = 10; m.fatigue = M.MOUNT.EXHAUST_AT;
    const use = vi.fn();
    expect(M.interactMount(g, m, p, p.inventory.selectedStack, use)).toBe(true);
    expect(m.fatigue).toBe(M.MOUNT.EXHAUST_AT - M.MOUNT.FEED_RELIEF);
    expect(m.health).toBe(12);
    expect(use).toHaveBeenCalled();
    expect(M.fatigueState(m.fatigue)).toBe('tired');
    // nothing to relieve, full health: the click is left to breeding
    m.fatigue = 0; m.health = m.maxHealth;
    expect(M.interactMount(g, m, p, p.inventory.selectedStack, use)).toBe(false);
  });

  it('a Dune Strider tires and eats cactus back to strength', async () => {
    const { interactStrider } = await import('../src/mobs/duneStrider.js');
    const g = fakeGame();
    const m = mob('dune_strider'); m.fatigue = M.MOUNT.EXHAUST_AT; m.health = 20;
    const use = vi.fn();
    expect(interactStrider(g, m, g.player, stack(B.CACTUS), use)).toBe(true);
    expect(m.fatigue).toBeLessThan(M.MOUNT.EXHAUST_AT);
    expect(m.health).toBe(22);
  });

  it('the stamina gauge runs from full to empty', () => {
    expect(M.staminaGauge({ fatigue: 0 }).stamina).toBe(1);
    expect(M.staminaGauge({ fatigue: M.MOUNT.EXHAUST_AT }).stamina).toBe(0);
    expect(M.staminaGauge({ fatigue: M.MOUNT.EXHAUST_AT }).state).toBe('exhausted');
  });
});

// ---------------------------------------------------------------------------------------------
describe('Horse Armour for Gallopers', () => {
  it('is put on a tamed Galloper, one piece at a time, swapping what it wore', () => {
    const g = fakeGame();
    const p = g.player;
    const m = mob('galloper');
    const use = vi.fn();
    // a wild one does not trust you
    expect(M.interactMount(g, m, p, stack(I.IRON_HORSE_ARMOR), use)).toBe(true);
    expect(use).not.toHaveBeenCalled(); expect(g.toasts.length).toBe(1);
    expect(m.equip).toBeFalsy();
    m.tamed = true;
    expect(M.interactMount(g, m, p, stack(I.IRON_HORSE_ARMOR), use)).toBe(true);
    expect(M.mountGear(m).armor.id).toBe(I.IRON_HORSE_ARMOR);
    expect(use).toHaveBeenCalledTimes(1);
    expect(g.played).toContain('equip');
    // diamond swaps the iron out and hands it back
    expect(M.interactMount(g, m, p, stack(I.DIAMOND_HORSE_ARMOR), use)).toBe(true);
    expect(M.mountGear(m).armor.id).toBe(I.DIAMOND_HORSE_ARMOR);
    expect(p.inventory.slots.some((s) => s && s.id === I.IRON_HORSE_ARMOR)).toBe(true);
    // the same tier again changes nothing
    const n = use.mock.calls.length;
    M.interactMount(g, m, p, stack(I.DIAMOND_HORSE_ARMOR), use);
    expect(use.mock.calls.length).toBe(n);
  });

  it('only Gallopers wear it', () => {
    const g = fakeGame();
    const t = mob('thistlehorn'); t.tamed = true;
    expect(M.interactMount(g, t, g.player, stack(I.IRON_HORSE_ARMOR), vi.fn())).toBe(false);
    expect(M.mountGear(t).armor).toBeNull();
  });

  it('stops damage by its tier: more plate, less damage, and no player armour is involved', () => {
    const m = mob('galloper');
    const take = (id) => { M.setMountGear(m, 'armor', id ? stack(id) : null); return mobDamageTaken(8, 0, m.equip, 'mob:Shambler'); };
    const none = take(null), iron = take(I.IRON_HORSE_ARMOR), gold = take(I.GOLD_HORSE_ARMOR), diamond = take(I.DIAMOND_HORSE_ARMOR);
    expect(none).toBe(8);
    expect(iron).toBeLessThan(none); expect(gold).toBeLessThan(iron); expect(diamond).toBeLessThan(gold);
    expect(equipArmor(m.equip).points).toBe(ITEMS[I.DIAMOND_HORSE_ARMOR].horseArmor.defense);
    // and through Mob.hurt
    const g = fakeGame(); m._game = g; m.health = 22; m.maxHp = 22;
    m.hurt(8, 'mob:Shambler');
    expect(22 - m.health).toBeCloseTo(diamond, 6);
  });

  it('shows on the model, tinted by tier, and hides without it', () => {
    const parts = ['bardingBody', 'bardingNeck', 'bardingHead'];
    for (const k of parts) expect(MODELS.galloper.parts.some((p) => p[0] === k && p[5] && p[5].gear)).toBe(true);
    const mk = () => ({ visible: true, rotation: { x: 0 }, children: [{ material: { userData: { base: new THREE.Color('#a8aeb6') } } }] });
    const pa = { bardingBody: mk(), bardingNeck: mk(), bardingHead: mk(), neck: { rotation: { x: 0.3 } }, head: { rotation: { x: 0.2 } } };
    pa.bardingNeck.children = pa.bardingHead.children = pa.bardingBody.children; // one shared material
    const model = { userData: { parts: pa } };
    const m = mob('galloper');
    M.mountGearRender(m, model);
    expect(parts.every((k) => pa[k].visible === false)).toBe(true);
    M.setMountGear(m, 'armor', stack(I.GOLD_HORSE_ARMOR));
    M.mountGearRender(m, model);
    expect(parts.every((k) => pa[k].visible)).toBe(true);
    expect(pa.bardingBody.children[0].material.userData.base.getHexString()).toBe(M.HORSE_ARMOR_COLORS.gold.slice(1));
    expect(pa.bardingHead.rotation.x).toBe(0.2);
    expect(MOBS.galloper.customRender).toBe(M.mountGearRender);
    // the gear boxes are invisible in the Field Guide picture and the picture stays a unit square
    const rects = modelRects(MODELS.galloper);
    expect(rects.length).toBe(MODELS.galloper.parts.length);
    MODELS.galloper.parts.forEach((p, i) => { if (p[5] && p[5].gear) expect(rects[i].alpha).toBe(0); });
    for (const r of rects) { expect(r.x).toBeGreaterThanOrEqual(-1e-9); expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9); }
  });

  it('reaches guests through the equipment ids already in the mob snapshot (field 20), with no layout change', () => {
    const m = mob('galloper');
    const before = packMob(m);
    expect(before[20]).toBe(0);
    M.setMountGear(m, 'armor', stack(I.DIAMOND_HORSE_ARMOR));
    M.setMountGear(m, 'harness', stack(I.THISTLE_HARNESS));
    m.saddled = true;
    const a = packMob(m);
    expect(a.length).toBe(before.length); // same layout
    expect(a[20]).toEqual([0, I.THISTLE_HARNESS, I.DIAMOND_HORSE_ARMOR, 0, 0]);
    const s = unpackMob(JSON.parse(JSON.stringify(a)));
    expect(s.equip).toEqual([0, I.THISTLE_HARNESS, I.DIAMOND_HORSE_ARMOR, 0, 0]);
    expect(s.saddled).toBe(true);
    // a guest's copy rebuilds the display gear and the same helpers read it
    const copy = mob('galloper');
    copy.equip = equipFromIds(s.equip);
    expect(M.mountGear(copy).armor.id).toBe(I.DIAMOND_HORSE_ARMOR);
    expect(M.mountGear(copy).harness.id).toBe(I.THISTLE_HARNESS);
    expect(equipIds(copy.equip)).toEqual(s.equip);
  });

  it('is kept in a save and always dropped with the Galloper (and its saddle)', () => {
    const g = fakeGame();
    const m = mob('galloper'); m.tamed = true; m.saddled = true; m.fatigue = 1234;
    M.setMountGear(m, 'armor', stack(I.IRON_HORSE_ARMOR));
    const data = JSON.parse(JSON.stringify(m.saveData()));
    const back = new Mob('galloper', 0, 63, 0); back.loadData(data);
    expect(M.mountGear(back).armor.id).toBe(I.IRON_HORSE_ARMOR);
    expect(back.saddled).toBe(true); expect(back.tamed).toBe(true); expect(back.fatigue).toBe(1234);
    // killed by something other than a player: gear a player put on still drops, undamaged
    expect(equipmentDrops(m.equip, { killedByPlayer: false, picked: m.equipPicked }).map((s) => s.id)).toEqual([I.IRON_HORSE_ARMOR]);
    m._game = g; g.entities.spawnXp = noop;
    MOBS.galloper.onDeath(m, g, false);
    expect(g.items.map((s) => s.id)).toContain(I.SADDLE);
  });
});

// ---------------------------------------------------------------------------------------------
describe('Thistlehorn mount', () => {
  const tame = (g, m, p) => { const spy = vi.spyOn(Math, 'random').mockReturnValue(0); const use = vi.fn(); M.interactMount(g, m, p, stack(I.BEETROOT), use); spy.mockRestore(); return use; };

  it('is ridable with a harness and a saddle, tamed with its food', () => {
    const d = MOBS.thistlehorn;
    expect(d.rideable).toBe(true);
    expect(d.mount.tack).toBe(true);
    expect(d.tameFood).toEqual(d.food);
    const g = fakeGame(), p = g.player, m = mob('thistlehorn');
    expect(m.saddled).toBe(false); expect(m.jumpPower).toBeGreaterThan(0.4); expect(m.maxHealth).toBe(14);
    const use = vi.fn();
    // wild: no harness, no saddle, no climbing on
    expect(M.interactMount(g, m, p, stack(I.THISTLE_HARNESS), use)).toBe(true);
    expect(M.interactMount(g, m, p, stack(I.SADDLE), use)).toBe(true);
    expect(M.mountGear(m).harness).toBeNull(); expect(m.saddled).toBe(false);
    expect(M.interactMount(g, m, p, null, use)).toBe(false);
    expect(g.mount).not.toHaveBeenCalled();
    // food: a chance each time, certain with a lucky roll; the food is used up
    const u = tame(g, m, p);
    expect(m.tamed).toBe(true); expect(m.persistent).toBe(true); expect(u).toHaveBeenCalled();
    expect(m.maxHealth).toBe(20);
    // saddle first: it needs the harness
    expect(M.interactMount(g, m, p, stack(I.SADDLE), use)).toBe(true);
    expect(m.saddled).toBe(false);
    expect(g.toasts.some((t) => /Harness/.test(t))).toBe(true);
    // harness, then saddle: ready
    expect(M.mountReady(m)).toBe(false);
    expect(M.interactMount(g, m, p, stack(I.THISTLE_HARNESS), use)).toBe(true);
    expect(M.mountGear(m).harness.id).toBe(I.THISTLE_HARNESS);
    expect(M.mountReady(m)).toBe(false);
    expect(M.interactMount(g, m, p, stack(I.SADDLE), use)).toBe(true);
    expect(m.saddled).toBe(true);
    expect(M.mountReady(m)).toBe(true);
    // an empty hand climbs on; sneaking tells it to stay instead
    expect(M.interactMount(g, m, p, null, use)).toBe(true);
    expect(g.mount).toHaveBeenCalledWith(m);
    p.sneaking = true;
    expect(M.interactMount(g, m, p, null, use)).toBe(true);
    expect(m.sitting).toBe(true);
    expect(M.interactMount(g, m, p, null, use)).toBe(true);
    expect(m.sitting).toBe(false);
  });

  it('a Thistlehorn that is not won over stays wild: the food only builds trust', () => {
    const g = fakeGame(), p = g.player, m = mob('thistlehorn');
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    M.interactMount(g, m, p, stack(I.SWEET_BERRIES), vi.fn());
    expect(m.tamed).toBeFalsy();
    expect(m.temper).toBeGreaterThan(0);
  });

  it('the ridden steering is the Galloper way: harness and saddle, then rideMove', () => {
    const g = fakeGame();
    const m = mob('thistlehorn'); m.tamed = true;
    m.rider = g.player; g.boatInput = { forward: 1, sprint: false };
    m.riddenAI(g);
    expect(m.move).toBeNull(); // not tacked up: it does not carry
    m.saddled = true; M.setMountGear(m, 'harness', stack(I.THISTLE_HARNESS));
    m.riddenAI(g);
    expect(m.move.forward).toBe(1);
    expect(m.move.mod).toBeGreaterThan(0.5);
  });

  it('shows its tack on the model, for guests too (the harness rides in the equipment ids)', async () => {
    const { THISTLEHORN } = await import('../src/mobs/fauna.js');
    for (const k of ['harness', 'chestStrap', 'headstall', 'seat']) expect(MODELS.thistlehorn.parts.some((p) => p[0] === k && p[5] && p[5].gear), k).toBe(true);
    const mk = () => ({ visible: true, rotation: { x: 0 }, children: [{ material: { userData: { base: new THREE.Color() } } }] });
    const names = ['body', 'neck', 'head', 'snout', 'earL', 'earR', 'antlerL', 'antlerR', 'tineL', 'tineR', 'legFL', 'legFR', 'legBL', 'legBR', 'harness', 'chestStrap', 'headstall', 'seat'];
    const pa = Object.fromEntries(names.map((k) => [k, mk()]));
    const model = { userData: { parts: pa } };
    const m = mob('thistlehorn');
    THISTLEHORN.customRender(m, model);
    expect([pa.harness, pa.chestStrap, pa.headstall, pa.seat].some((x) => x.visible)).toBe(false);
    const guest = mob('thistlehorn');
    guest.equip = equipFromIds([0, I.THISTLE_HARNESS, 0, 0, 0]); guest.saddled = true;
    THISTLEHORN.customRender(guest, model);
    expect(pa.harness.visible && pa.chestStrap.visible && pa.headstall.visible && pa.seat.visible).toBe(true);
    guest.saddled = false;
    THISTLEHORN.customRender(guest, model);
    expect(pa.seat.visible).toBe(false); expect(pa.harness.visible).toBe(true);
    // a saddle without a harness shows nothing
    const odd = mob('thistlehorn'); odd.saddled = true;
    THISTLEHORN.customRender(odd, model);
    expect(pa.seat.visible).toBe(false);
  });

  it('is saved with its tack, trust and fatigue', () => {
    const m = mob('thistlehorn'); m.tamed = true; m.ownerName = 'Ada'; m.saddled = true; m.temper = 12; m.fatigue = 777;
    M.setMountGear(m, 'harness', stack(I.THISTLE_HARNESS));
    const data = JSON.parse(JSON.stringify(m.saveData()));
    const back = new Mob('thistlehorn', 0, 63, 0); back.loadData(data);
    expect(back.tamed).toBe(true); expect(back.ownerName).toBe('Ada'); expect(back.saddled).toBe(true);
    expect(back.temper).toBe(12); expect(back.fatigue).toBe(777);
    expect(M.mountReady(back)).toBe(true);
    expect(back.jumpPower).toBeCloseTo(m.jumpPower, 6);
  });

  it('drops its saddle and harness when it dies', () => {
    const g = fakeGame();
    const m = mob('thistlehorn'); m._game = g; m.saddled = true;
    M.setMountGear(m, 'harness', stack(I.THISTLE_HARNESS));
    expect(equipmentDrops(m.equip, { killedByPlayer: false, picked: m.equipPicked }).map((s) => s.id)).toEqual([I.THISTLE_HARNESS]);
    MOBS.thistlehorn.onDeath(m, g, false);
    expect(g.items.map((s) => s.id)).toContain(I.SADDLE);
  });
});

// ---------------------------------------------------------------------------------------------
describe('tamed mounts follow', () => {
  function chased() {
    const g = fakeGame();
    const m = mob('galloper'); m.tamed = true; m._game = g;
    m.chase = vi.fn();
    return { g, m };
  }
  it('trots after an owner who has walked off, and stays near when close', () => {
    const { g, m } = chased();
    const p = fakePlayer(12, 63, 0);
    expect(M.mountFollowStep(m, g, p, 12)).toBe(true);
    expect(m.chase).toHaveBeenCalledWith(g, p, 1.2);
    m.chase.mockClear();
    expect(M.mountFollowStep(m, g, p, 3)).toBe(false);
    expect(m.chase).not.toHaveBeenCalled();
  });
  it('not while told to stay, ridden, young, scared, in love, on a lead, or for somebody else', () => {
    const { g, m } = chased();
    const p = fakePlayer(12, 63, 0);
    for (const set of [(x) => { x.sitting = true; }, (x) => { x.rider = {}; }, (x) => { x.age = -100; }, (x) => { x.panicTicks = 5; }, (x) => { x.loveTicks = 5; }, (x) => { x.leashHolder = {}; }]) {
      const o = mob('galloper'); o.tamed = true; o.chase = vi.fn(); set(o);
      expect(M.mountFollowStep(o, g, p, 12)).toBe(false);
    }
    m.ownerName = 'Ada'; p.netName = 'Bea';
    expect(M.mountFollowStep(m, g, p, 12)).toBe(false);
    const wild = mob('galloper'); wild.chase = vi.fn();
    expect(M.mountFollowStep(wild, g, p, 12)).toBe(false);
  });
  it('teleports to the owner when left far behind', () => {
    const { g, m } = chased();
    g.ticks = m.id; // (its turn within the 20 tick cycle)
    m.teleportTo = vi.fn(() => true);
    const p = fakePlayer(60, 63, 0);
    expect(M.mountFollowStep(m, g, p, 60)).toBe(true);
    expect(m.teleportTo).toHaveBeenCalled();
  });
  it('Mob.ai makes a tamed mount follow, and hold still when told to stay', () => {
    const { g, m } = chased();
    const p = fakePlayer(15, 63, 0);
    g.player = p;
    m.ai(g, p, 15);
    expect(m.chase).toHaveBeenCalled();
    m.chase.mockClear();
    m.sitting = true; m.move = { forward: 1 };
    m.ai(g, p, 15);
    expect(m.chase).not.toHaveBeenCalled();
    expect(m.move).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
describe('boats: two seats, a chest, creatures aboard', () => {
  it('seat counts and spots', () => {
    expect(M.seatCountOf(false, null)).toBe(2);
    expect(M.seatCountOf(false, 'chest')).toBe(1);
    expect(M.seatCountOf(true, null)).toBe(1);
    expect(M.seatCountOf(true, 'chest')).toBe(0);
    expect(M.seatCountOf(true, 'furnace')).toBe(0);
    const a = M.boatSeatOffset(0, 0), b = M.boatSeatOffset(0, 1);
    expect(a[1]).toBeLessThan(0); expect(b[1]).toBeGreaterThan(0); // the driver in front (-z), the passenger behind
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(0.6); // far enough apart not to overlap
    // turned a quarter, the same spots turn with the boat
    const c = M.boatSeatOffset(Math.PI / 2, 0);
    expect(c[0]).toBeCloseTo(-0.2, 6); expect(c[1]).toBeCloseTo(0, 6);
  });

  it('pickSeat gives the wanted seat if free, else the first free one', () => {
    expect(M.pickSeat(2, [false, false])).toBe(0);
    expect(M.pickSeat(2, [true, false])).toBe(1);
    expect(M.pickSeat(2, [false, false], 1)).toBe(1);
    expect(M.pickSeat(2, [true, false], 0)).toBe(1);
    expect(M.pickSeat(2, [true, true])).toBe(-1);
    expect(M.pickSeat(1, [true, false])).toBe(-1); // a one seater has no second seat
    expect(M.pickSeat(0, [false, false])).toBe(-1);
  });

  it('carries a second passenger: Game.mount takes the free seat, dismount frees it', () => {
    const boat = new Boat(0.5, 63.4, 0.5, 0);
    const a = fakePlayer(), b = fakePlayer();
    const g = (p) => ({ player: p, net: null, world: new Flat(), seatPlayer: Game.prototype.seatPlayer, dismount: Game.prototype.dismount });
    const ga = g(a), gb = g(b);
    expect(Game.prototype.mount.call(ga, boat)).toBe(true);
    expect(a.seat).toBe(0); expect(boat.rider).toBe(a);
    expect(Game.prototype.mount.call(gb, boat)).toBe(true);
    expect(b.seat).toBe(1); expect(boat.rider2).toBe(b);
    expect(boat.freeSeat()).toBe(-1);
    // a third does not fit
    const c = fakePlayer(); expect(Game.prototype.mount.call(g(c), boat)).toBe(false); expect(c.riding).toBeNull();
    gb.dismount();
    expect(boat.rider2).toBeNull(); expect(b.riding).toBeNull(); expect(b.seat).toBe(0);
    expect(boat.freeSeat()).toBe(1);
    expect(boat.rider).toBe(a); // the driver still drives
  });

  it('a Chest Boat has one seat and a 27 slot chest; a plain boat has none', () => {
    const plain = new Boat(0, 63, 0), chest = new Boat(0, 63, 0, 0, 'chest');
    expect(plain.hasCargo).toBe(false); expect(plain.seatCount).toBe(2);
    expect(chest.hasCargo).toBe(true); expect(chest.cargo.slots.length).toBe(27); expect(chest.seatCount).toBe(1);
    expect(chest.dropId).toBe(I.OAK_CHEST_BOAT); expect(plain.dropId).toBe(I.OAK_BOAT);
    chest.rider = {}; expect(chest.freeSeat()).toBe(-1);
  });

  it('a creature on a lead goes aboard as the second passenger, rides along and is let off safely', () => {
    const g = fakeGame();
    const boat = new Boat(0.5, 63.4, 0.5, 0);
    const sheep = mob('fleecer', 2, 63, 2);
    expect(M.canSeatMob(sheep)).toBe(true);
    expect(M.canSeatMob(mob('galloper'))).toBe(false); // too big, and a mount
    expect(M.canSeatMob(mob('shambler'))).toBe(false); // hostile
    expect(M.canSeatMob(mob('dolphin'))).toBe(false);
    boat.boardMob(sheep);
    expect(boat.mobPassenger).toBe(sheep); expect(sheep.boatSeat).toBe(boat);
    expect(boat.seatTaken(1)).toBe(true); expect(boat.freeSeat()).toBe(0);
    // sits at the second seat and moves with the boat
    const [dx, dz] = M.boatSeatOffset(0, 1);
    expect(sheep.x).toBeCloseTo(boat.x + dx, 6); expect(sheep.z).toBeCloseTo(boat.z + dz, 6);
    boat.body.setPos(10.5, 63.4, 8.5);
    boat.tick(g, null);
    expect(sheep.x).toBeCloseTo(boat.x + dx, 1); expect(sheep.z).toBeCloseTo(boat.z + dz, 1);
    // its own tick leaves it alone (no wandering off the boat)
    sheep._game = g; sheep.path = [[0, 0, 0]];
    const px = sheep.x, pz = sheep.z;
    sheep.tick(g);
    expect(sheep.x).toBe(px); expect(sheep.z).toBe(pz); expect(sheep.path).toBeNull();
    // let off: on solid ground beside the boat
    boat.unloadMob(g);
    expect(boat.mobPassenger).toBeNull(); expect(sheep.boatSeat).toBeNull();
    expect(SOLID[g.world.getBlock(Math.floor(sheep.x), Math.floor(sheep.y) - 1, Math.floor(sheep.z))]).toBeTruthy();
    expect(SOLID[g.world.getBlock(Math.floor(sheep.x), Math.floor(sheep.y), Math.floor(sheep.z))]).toBeFalsy();
  });

  it('breaking a boat lets everybody off and spills the cargo', () => {
    const g = fakeGame();
    const boat = new Boat(0.5, 63.4, 0.5, 0, 'chest');
    boat.cargo.slots[0] = stack(B.COBBLESTONE, 12); boat.cargo.slots[5] = stack(I.DIAMOND, 2);
    const em = new EntityManager({ scene: { add: noop, remove: noop }, ticks: 1, net: null, player: g.player, world: g.world });
    em.game.dismount = vi.fn();
    em.game.player.riding = boat; boat.rider = g.player;
    const sheep = mob('fleecer'); sheep.boatSeat = boat; boat.mobPassenger = sheep;
    sheep._game = g;
    const spawned = [];
    em.spawnItem = (x, y, z, st) => spawned.push(st);
    em.breakBoat(boat, true);
    expect(boat.dead).toBe(true);
    expect(em.game.dismount).toHaveBeenCalled();
    expect(boat.rider).toBeNull(); expect(sheep.boatSeat).toBeNull();
    expect(spawned.map((s) => s.id).sort()).toEqual([B.COBBLESTONE, I.DIAMOND, I.OAK_CHEST_BOAT].sort());
    expect(boat.cargo.slots.every((s) => !s)).toBe(true);
    // creative: the boat itself does not drop, the cargo still does
    const b2 = new Boat(0, 63, 0, 0, 'chest'); b2.cargo.slots[1] = stack(I.COAL, 3);
    spawned.length = 0; em.game.player.riding = null; em.breakBoat(b2, false);
    expect(spawned.map((s) => s.id)).toEqual([I.COAL]);
  });

  it('a boat landing hard on land shakes its riders by the fall damage; on water it does not', () => {
    const g = fakeGame();
    const boat = new Boat(0.5, 75, 0.5, 0);
    const a = fakePlayer(), b = fakePlayer();
    boat.rider = a; boat.rider2 = b;
    for (let k = 0; k < 80 && !boat.body.onGround; k++) { g.ticks++; boat.tick(g, null); }
    expect(boat.body.onGround).toBe(true);
    expect(a.hurt).toHaveBeenCalledTimes(1);
    expect(a.hurt.mock.calls[0][0]).toBeGreaterThan(5);
    expect(a.hurt.mock.calls[0][1]).toBe('fall');
    expect(b.hurt).toHaveBeenCalledTimes(1);
    // into a pond: nobody is hurt
    const w = new Flat();
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 58; y <= 66; y++) w.set(x, y, z, B.WATER);
    const g2 = fakeGame({ world: w });
    const boat2 = new Boat(0.5, 70, 0.5, 0); const c = fakePlayer(); boat2.rider = c;
    for (let k = 0; k < 80; k++) { g2.ticks++; boat2.tick(g2, null); }
    expect(c.hurt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
describe('Minecart with Chest and Minecart with Furnace', () => {
  it('a cargo cart has a chest and no seat; its drop is its own item', () => {
    const cart = new Minecart(0.5, 64 + 1 / 16, 0.5, 0, 'chest');
    expect(cart.cart).toBe(true); expect(cart.hasCargo).toBe(true); expect(cart.seatCount).toBe(0);
    expect(cart.freeSeat()).toBe(-1);
    expect(cart.dropId).toBe(I.MINECART_CHEST);
    const furnace = new Minecart(0, 64, 0, 0, 'furnace');
    expect(furnace.furnace).toBe(true); expect(furnace.dropId).toBe(I.MINECART_FURNACE); expect(furnace.seatCount).toBe(0); expect(furnace.hasCargo).toBe(false);
    const plain = new Minecart(0, 64, 0);
    expect(plain.seatCount).toBe(1); expect(plain.dropId).toBe(I.MINECART);
  });

  /** A straight east-west line of rails from x = 0 to 30 on a flat world, a game with the pieces the cart tick touches. */
  function track() {
    const w = new Flat();
    for (let x = -2; x <= 40; x++) { w.set(x, 63, 0, B.STONE); w.set(x, 64, 0, B.RAIL, 1); }
    const g = fakeGame({ world: w });
    g.entities = { list: [], spawnItem: noop };
    return g;
  }

  it('burns fuel to pull itself along the rails the way it was fuelled, then coasts to a stop', () => {
    const g = track();
    const cart = new Minecart(2.5, 64 + 1 / 16, 0.5, 0, 'furnace');
    g.entities.list.push(cart);
    expect(cart.lit).toBe(false);
    for (let k = 0; k < 30; k++) { g.ticks++; cart.tick(g, null); }
    expect(Math.abs(cart.x - 2.5)).toBeLessThan(0.01); // no fuel, no motion
    expect(cart.addFuel(M.cartFuelTicks(I.COAL), -Math.PI / 2)).toBe(true); // yaw -90 degrees: looking along +x
    expect(cart.lit).toBe(true);
    let top = 0;
    for (let k = 0; k < 120; k++) { g.ticks++; cart.tick(g, null); top = Math.max(top, Math.abs(cart.body.vx)); }
    expect(cart.x).toBeGreaterThan(8);
    expect(cart.body.vx).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(M.FURNACE_CART.TOP + 0.03);
    expect(cart.fuel).toBeLessThan(M.cartFuelTicks(I.COAL));
    // out of fuel: it slows to a halt
    cart.fuel = 0;
    for (let k = 0; k < 400; k++) { g.ticks++; cart.tick(g, null); }
    expect(Math.abs(cart.body.vx)).toBeLessThan(0.01);
    expect(cart.lit).toBe(false);
  });

  it('pushes off the other way when fuelled facing the other way', () => {
    const g = track();
    const cart = new Minecart(20.5, 64 + 1 / 16, 0.5, 0, 'furnace');
    g.entities.list.push(cart);
    cart.addFuel(2000, Math.PI / 2); // looking along -x
    for (let k = 0; k < 60; k++) { g.ticks++; cart.tick(g, null); }
    expect(cart.body.vx).toBeLessThan(0);
    expect(cart.x).toBeLessThan(20);
  });

  it('shoves the carts ahead of it along', () => {
    const g = track();
    const furnace = new Minecart(2.5, 64 + 1 / 16, 0.5, 0, 'furnace');
    const other = new Minecart(4.0, 64 + 1 / 16, 0.5, 0);
    g.entities.list.push(furnace, other);
    furnace.addFuel(3000, -Math.PI / 2);
    for (let k = 0; k < 140; k++) { g.ticks++; furnace.tick(g, null); other.tick(g, null); }
    expect(other.x).toBeGreaterThan(8); // it did not stay put
    expect(furnace.x).toBeGreaterThan(5);
    expect(other.x - furnace.x).toBeGreaterThan(0); // and is still ahead of the one pushing it
    // a cart behind it is left alone
    const g2 = track();
    const f2 = new Minecart(10.5, 64 + 1 / 16, 0.5, 0, 'furnace'), behind = new Minecart(8.5, 64 + 1 / 16, 0.5, 0);
    g2.entities.list.push(f2, behind);
    f2.addFuel(3000, -Math.PI / 2);
    for (let k = 0; k < 40; k++) { g2.ticks++; f2.tick(g2, null); behind.tick(g2, null); }
    expect(behind.body.vx).toBeLessThan(0.01);
  });

  it('pure pieces: fuel ticks, direction and push', () => {
    expect(M.cartFuelTicks(I.COAL)).toBeGreaterThan(ITEMS[I.COAL].fuel);
    expect(M.cartFuelTicks(I.STONE_PICKAXE)).toBe(0);
    expect(M.furnaceWant(0.1, -1)).toBe(1); expect(M.furnaceWant(-0.1, 1)).toBe(-1);
    expect(M.furnaceWant(0, -3)).toBe(-1); expect(M.furnaceWant(0, 0)).toBe(1);
    expect(M.furnaceSpeed(0, 0, 1)).toBe(0);
    expect(M.furnaceSpeed(0.1, 10, 1)).toBeCloseTo(0.1 + M.FURNACE_CART.ACCEL, 9);
    expect(M.furnaceSpeed(M.FURNACE_CART.TOP, 10, 1)).toBe(M.FURNACE_CART.TOP);
    expect(M.furnaceSpeed(0.3, 10, 1)).toBe(0.3); // never slows a faster cart down
    expect(M.cartPush(0.2, 0, { vx: 0, vz: 0 })).toEqual([0.2, 0]);
    expect(M.cartPush(0.2, 0, { vx: 0.3, vz: 0 })).toBeNull();
    expect(M.cartPush(0.01, 0, { vx: 0, vz: 0 })).toBeNull();
  });

  it('is fuelled by right-click: coal is used up, a lava bucket leaves its bucket, a full firebox takes nothing', () => {
    const g = fakeGame();
    const p = g.player; g.player = p;
    const ia = { game: g, swing: 0, useDelay: 0 };
    const cart = new Minecart(0, 64, 0, 0, 'furnace');
    p.inventory.slots[0] = stack(I.COAL, 3);
    expect(Interaction.prototype.useBoat.call(ia, cart, {})).toBe(true);
    expect(p.inventory.slots[0].count).toBe(2);
    expect(cart.lit).toBe(true);
    expect(g.played).toContain('cart_fuel');
    // something that is no fuel does nothing
    p.inventory.slots[0] = stack(I.DIAMOND, 1);
    expect(Interaction.prototype.useBoat.call(ia, cart, {})).toBe(false);
    // lava bucket
    p.inventory.slots[0] = stack(I.LAVA_BUCKET, 1);
    cart.fuel = 0;
    Interaction.prototype.useBoat.call(ia, cart, {});
    expect(p.inventory.slots[0].id).toBe(I.BUCKET);
    // full
    cart.fuel = M.FURNACE_CART.MAX_FUEL;
    p.inventory.slots[0] = stack(I.COAL, 3);
    expect(Interaction.prototype.useBoat.call(ia, cart, {})).toBe(true);
    expect(p.inventory.slots[0].count).toBe(3);
  });
});

// ---------------------------------------------------------------------------------------------
describe('storage', () => {
  it('opens the chest of a Chest Boat when sneaking, and a cart with a chest at any click', () => {
    const g = fakeGame({ ui: { openCargo: vi.fn() } });
    const p = g.player;
    const ia = { game: g, swing: 0, useDelay: 0 };
    const boat = new Boat(0, 64, 0, 0, 'chest');
    p.sneaking = true;
    expect(Interaction.prototype.useBoat.call(ia, boat, {})).toBe(true);
    expect(g.ui.openCargo).toHaveBeenCalledWith(boat);
    // not sneaking: it climbs in instead
    g.ui.openCargo.mockClear(); p.sneaking = false;
    expect(Interaction.prototype.useBoat.call(ia, boat, {})).toBe(true);
    expect(g.ui.openCargo).not.toHaveBeenCalled();
    expect(g.mount).toHaveBeenCalledWith(boat);
    const cart = new Minecart(0, 64, 0, 0, 'chest');
    expect(Interaction.prototype.useBoat.call(ia, cart, {})).toBe(true);
    expect(g.ui.openCargo).toHaveBeenCalledWith(cart);
  });

  it('is a container the multiplayer protocol already knows: slots, state and guarded changes', () => {
    const boat = new Boat(0, 64, 0, 0, 'chest');
    boat.cargo.slots[3] = stack(B.COBBLESTONE, 10);
    expect(containerSlots('cargo', boat.cargo).length).toBe(27);
    const state = containerState('cargo', boat.cargo);
    expect(state.slots[3].id).toBe(B.COBBLESTONE);
    // a guest takes five; the host applies it only when the slot still holds what the guest saw
    const ch = [[3, stack(B.COBBLESTONE, 10), stack(B.COBBLESTONE, 5)]];
    expect(applySlotChanges('cargo', boat.cargo, ch)).toBe(true);
    expect(boat.cargo.slots[3].count).toBe(5);
    expect(applySlotChanges('cargo', boat.cargo, ch)).toBe(false); // someone else got there first
  });

  it('the host resolves the container of a boat by its id and measures reach to the boat', async () => {
    const { HostSession } = await import('../src/net/session.js');
    const boat = new Boat(5.5, 64, 7.5, 0, 'chest');
    const host = { entity: (id) => (id === boat.id ? boat : null), game: { world: new Flat() } };
    expect(HostSession.prototype.container.call(host, 'cargo', boat.id, 0, 0)).toBe(boat.cargo);
    expect(HostSession.prototype.container.call(host, 'cargo', 999, 0, 0)).toBeNull();
    expect(HostSession.prototype.contPos.call(host, { k: 'cargo', x: boat.id })).toEqual([5.5, 64.5, 7.5]);
    expect(HostSession.prototype.contPos.call(host, { k: 'chest', x: 1, y: 2, z: 3 })).toEqual([1.5, 2.5, 3.5]);
    expect(HostSession.prototype.contPos.call(host, { k: 'cargo', x: 999 }).every(Number.isNaN)).toBe(true);
  });

  it('is kept in a save and in its own item when broken', () => {
    const boat = new Boat(1, 64, 2, 0.5, 'chest');
    boat.cargo.slots[0] = stack(I.DIAMOND, 4);
    const back = M.cargoFromSave(JSON.parse(JSON.stringify({ slots: boat.cargo.slots })));
    expect(back.slots[0]).toMatchObject({ id: I.DIAMOND, count: 4 });
    expect(back.slots.length).toBe(27);
    expect(M.cargoFromSave({ slots: [{ id: 99999, count: 1 }, { id: I.COAL, count: -3 }, { id: I.COAL, count: 500 }] }).slots.filter(Boolean)).toEqual([{ id: I.COAL, count: 64 }]);
    expect(M.cargoFromSave(null).slots.every((s) => s === null)).toBe(true);
    const save = src('src/world/save.js');
    expect(save).toMatch(/cargo: e\.cargo \? e\.cargo\.slots/);
    expect(save).toMatch(/cargoFromSave/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('multiplayer: second passenger and variants on the wire', () => {
  const pk = (e, over = {}) => JSON.parse(JSON.stringify(packEntity(e, over.riderOf)));

  it('carries a boat, its variant, the lit furnace and the second seat in one snapshot', () => {
    const boat = new Boat(1, 64, 2, 0.5);
    let a = pk(boat);
    expect(a.length).toBe(11);
    let s = unpackEntity(a);
    expect(s).toMatchObject({ kind: 'boat', cart: false, variant: null, lit: false, passenger: -1 });
    boat.remoteRider2 = 4;
    expect(unpackEntity(pk(boat)).passenger).toBe(4);
    boat.remoteRider2 = null; boat.rider2 = {};
    expect(unpackEntity(pk(boat)).passenger).toBe(0); // the host's own seat
    boat.rider2 = null; boat.mobPassenger = {};
    expect(unpackEntity(pk(boat)).passenger).toBe(-2); // a creature aboard
    const chest = new Boat(0, 0, 0, 0, 'chest');
    expect(unpackEntity(pk(chest))).toMatchObject({ cart: false, variant: 'chest' });
    const cc = new Minecart(0, 0, 0, 0, 'chest');
    expect(unpackEntity(pk(cc))).toMatchObject({ cart: true, variant: 'chest', lit: false });
    const fc = new Minecart(0, 0, 0, 0, 'furnace');
    expect(unpackEntity(pk(fc))).toMatchObject({ cart: true, variant: 'furnace', lit: false });
    fc.fuel = 100;
    expect(unpackEntity(pk(fc))).toMatchObject({ cart: true, variant: 'furnace', lit: true });
    const plain = new Minecart(0, 0, 0, 0);
    expect(unpackEntity(pk(plain))).toMatchObject({ cart: true, variant: null });
  });

  it('a guest copy shows who is where, from the snapshot', async () => {
    const { EntityMirror } = await import('../src/net/entityMirror.js');
    const me = fakePlayer();
    const mirror = { game: { player: me, dismount: vi.fn() }, session: { id: 7 } };
    const copy = new Boat(0, 64, 0, 0);
    EntityMirror.prototype.update.call(mirror, copy, { kind: 'boat', hitTime: 0, rider: 3, passenger: -1, cart: false });
    expect(copy.remoteRider).toBe(3); expect(copy.remoteRider2).toBeNull();
    expect(copy.freeSeat()).toBe(1); // the driver's seat is taken: a guest would sit behind
    EntityMirror.prototype.update.call(mirror, copy, { kind: 'boat', hitTime: 0, rider: 3, passenger: -2, cart: false });
    expect(copy.mobSeen).toBe(true); expect(copy.freeSeat()).toBe(-1);
    // we sit in seat 1: the snapshot saying so is our confirmation; without it we get out after a while
    me.riding = copy; me.seat = 1; copy.netState = { rider: 3, passenger: 7 };
    EntityMirror.prototype.update.call(mirror, copy, { kind: 'boat', hitTime: 0, rider: 3, passenger: 7, cart: false });
    expect(copy.remoteRider2).toBeNull(); // (that one is us)
    for (let k = 0; k < 100; k++) EntityMirror.prototype.checkBoatSeat.call(mirror, copy);
    expect(mirror.game.dismount).not.toHaveBeenCalled();
    copy.netState = { rider: 3, passenger: 9 }; // somebody else got it
    for (let k = 0; k < 41; k++) EntityMirror.prototype.checkBoatSeat.call(mirror, copy);
    expect(mirror.game.dismount).toHaveBeenCalledTimes(1);
  });

  it('the host gives each guest a seat (the driver\'s, then the second) and clears them when they leave', () => {
    const boat = new Boat(0, 64, 0, 0);
    // the rule the 'ride' message applies: Boat.freeSeat picks the seat, the session records the guest's id
    const give = (id, want) => { const seat = boat.freeSeat(want); if (seat === 0) boat.remoteRider = id; else if (seat === 1) boat.remoteRider2 = id; return seat; };
    expect(give(1, 0)).toBe(0); expect(give(2, 0)).toBe(1); expect(give(3, 0)).toBe(-1);
    expect(boat.remoteRider).toBe(1); expect(boat.remoteRider2).toBe(2);
    const code = src('src/net/session.js');
    expect(code).toMatch(/b\.freeSeat\(m\.seat === 1 \? 1 : 0\)/);
    expect(code).toMatch(/e\.remoteRider2 === c\.id/);
    expect(code).toMatch(/case 'fuel'/);
    expect(code).toMatch(/variant: d\.variant \|\| undefined/); // guests' placed carts keep their variant (and being carts)
    expect(code).toMatch(/cart: d\.cart \|\| undefined/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('falls and dismounting', () => {
  it('the rider takes the fall damage of the mount that lands', () => {
    expect(M.riderFallDamage(8)).toBe(fallDamage(8));
    expect(M.riderFallDamage(3)).toBe(0);
    expect(M.riderFallDamage(8, { noFallDamage: true })).toBe(0);
    const g = fakeGame();
    const m = mob('galloper'); m._game = g; m.health = m.maxHp = 22;
    m.rider = g.player;
    m.body.onGround = true; m.body.fallDistance = 8;
    m.environment(g);
    expect(g.player.hurt).toHaveBeenCalledWith(5, 'fall');
    expect(m.health).toBeLessThan(22); // the mount takes its own
    // a short drop hurts nobody
    g.player.hurt.mockClear(); m.body.fallDistance = 2; m.environment(g);
    expect(g.player.hurt).not.toHaveBeenCalled();
    // nobody aboard: nobody to hurt
    const lone = mob('galloper'); lone._game = g; lone.body.onGround = true; lone.body.fallDistance = 8; lone.environment(g);
    expect(g.player.hurt).not.toHaveBeenCalled();
  });

  function room() {
    const w = new Flat();
    return w;
  }
  const feetOk = (w, s) => !SOLID[w.getBlock(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))] && !SOLID[w.getBlock(Math.floor(s.x), Math.floor(s.y) + 1, Math.floor(s.z))];

  it('puts the rider on free ground beside the mount, never in a block', () => {
    const w = room();
    const s = M.safeDismountSpot(w, 0.5, 63, 0.5);
    expect(feetOk(w, s)).toBe(true);
    expect(SOLID[w.getBlock(Math.floor(s.x), Math.floor(s.y) - 1, Math.floor(s.z))]).toBeTruthy();
    expect(s.y).toBe(63);
  });

  it('steps round walls and under ceilings', () => {
    const w = room();
    // a one block wide corridor under a ceiling: the spot is in the corridor, not in the stone
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { w.set(x, 63, z, B.STONE); w.set(x, 64, z, B.STONE); w.set(x, 65, z, B.STONE); w.set(x, 66, z, B.STONE); }
    for (let x = -4; x <= 4; x++) { w.set(x, 64, 0, B.AIR); w.set(x, 65, 0, B.AIR); }
    const s = M.safeDismountSpot(w, 0.5, 64, 0.5);
    expect(feetOk(w, s)).toBe(true);
    expect(Math.floor(s.z)).toBe(0);
    expect(s.y).toBe(64);
  });

  it('prefers dry land to water, avoids lava, fire and cactus, and uses the column when nothing is near', () => {
    const w = room();
    // a boat in a pond: the shore is two blocks away
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { w.set(x, 62, z, B.DIRT); w.set(x, 63, z, B.WATER); }
    const shore = M.safeDismountSpot(w, 0.5, 63, 0.5);
    expect(w.getBlock(Math.floor(shore.x), Math.floor(shore.y), Math.floor(shore.z))).not.toBe(B.WATER);
    expect(feetOk(w, shore)).toBe(true);
    // hazards are not stood on or in
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) w.set(x, 63, z, B.LAVA);
    w.set(0, 63, 0, B.STONE); w.set(0, 64, 0, B.STONE); // (the boat's own column is blocked too)
    const s = M.safeDismountSpot(w, 0.5, 64, 0.5, 1);
    expect(w.getBlock(Math.floor(s.x), Math.floor(s.y), Math.floor(s.z))).not.toBe(B.LAVA);
    expect(feetOk(w, s)).toBe(true);
    // a rider sealed in a stone pocket with no neighbours is lifted up the column
    const sealed = room();
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 63; y <= 68; y++) sealed.set(x, y, z, B.STONE);
    sealed.set(0, 64, 0, B.AIR);
    const up = M.safeDismountSpot(sealed, 0.5, 64, 0.5, 1);
    expect(feetOk(sealed, up)).toBe(true);
    expect(up.y).toBeGreaterThanOrEqual(64);
  });

  it('Game.dismount uses it: the rider ends on the spot, loses the seat and the fall', () => {
    const w = room();
    const boat = new Boat(0.5, 63.4, 0.5, 0);
    const p = fakePlayer();
    p.setPosition = vi.fn(); p.body.fallDistance = 9;
    p.riding = boat; boat.rider = p;
    const game = { player: p, net: null, world: w };
    Game.prototype.dismount.call(game);
    expect(p.riding).toBeNull(); expect(boat.rider).toBeNull();
    const [x, y, z] = p.setPosition.mock.calls[0];
    expect(feetOk(w, { x, y, z })).toBe(true);
    expect(p.body.fallDistance).toBe(0);
    // from a Galloper too, and the second seat of a boat
    const m = mob('galloper', 3.5, 63, 3.5); p.riding = m; m.rider = p;
    Game.prototype.dismount.call(game);
    expect(m.rider).toBeNull();
    const boat2 = new Boat(0.5, 63.4, 0.5, 0); p.riding = boat2; p.seat = 1; boat2.rider2 = p; boat2.rider = {};
    Game.prototype.dismount.call(game);
    expect(boat2.rider2).toBeNull(); expect(boat2.rider).toEqual({});
  });

  it('a dying or removed mount drops its rider (the game tick checks for it)', () => {
    const code = src('src/game.js');
    expect(code).toMatch(/p\.riding\.removed \|\| p\.riding\.deathTime > 0/);
  });
});

// ---------------------------------------------------------------------------------------------
describe('sounds and wiring', () => {
  it('the new sounds are played where they belong', () => {
    expect(src('src/entities/entities.js')).toMatch(/play\('paddle'/);
    expect(src('src/mobs/mounts.js')).toMatch(/play\('mount_pant'/);
    expect(src('src/mobs/mounts.js')).toMatch(/play\('harness'/);
    expect(src('src/player/interaction.js')).toMatch(/play\('cart_fuel'/);
  });
  it('a boat paddles while thrust is held in the water', () => {
    const w = new Flat();
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 60; y <= 63; y++) w.set(x, y, z, B.WATER);
    const g = fakeGame({ world: w });
    const boat = new Boat(0.5, 63.4, 0.5, 0); boat.rider = g.player;
    for (let k = 0; k < 30; k++) { g.ticks = 100 + k; boat.tick(g, { forward: 1, strafe: 0 }); }
    expect(g.played).toContain('paddle');
  });
  it('Gallopers keep their taming-by-riding and gain stamina, gear and following from the mount definition', () => {
    expect(MOBS.galloper.rideable).toBe(true);
    expect(MOBS.galloper.mount.armor).toBe(true);
    expect(MOBS.dune_strider.mount).toBeTruthy();
    expect(MOBS.packhorn.rideable).toBeFalsy(); // (a pack animal: led, not ridden)
    const w = new Flat(), g = fakeGame({ world: w });
    const wild = mob('galloper'); wild.rider = g.player; wild._game = g;
    wild.buck = 5;
    for (let k = 0; k < 5; k++) wild.riddenAI(g);
    expect(g.dismount).toHaveBeenCalledTimes(1); // a wild one still bucks its rider off (and has a chance to be tamed each time)
    expect(wild.temper).toBe(5);
  });
});
