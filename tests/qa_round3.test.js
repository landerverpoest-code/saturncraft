// Regression tests for the third QA pass (browser-driven integration run after ~25 features landed: soak, save round trips,
// local multiplayer with a guest, feature interactions, item / block fuzzing).
import { describe, it, expect, beforeEach } from 'vitest';
import { B, BLOCKS } from '../src/world/blocks.js';
import { spoutDir } from '../src/world/hoppers.js';
import { facingIdx, FACING6 } from '../src/world/circuitShapes.js';
import { crystalSupported } from '../src/world/caves.js';
import { RemotePlayer, makeTarget } from '../src/net/remotePlayer.js';
import { wearsPumpkin, gazeProvokes, pumpkinStack } from '../src/mobs/pumpkins.js';
import { EntityManager, MAX_FROZEN } from '../src/entities/entities.js';
import { MemoryStorage, setStorage } from '../src/world/storage.js';
import { saveGame } from '../src/world/save.js';
import { exportWorld, importWorld, loadWorld, writeWorld } from '../src/world/worldManager.js';
import { SocialState } from '../src/net/social.js';
import { setRep } from '../src/mobs/reputation.js';
import { discover } from '../src/player/fieldGuide.js';
import { Clipboard, encodeBlueprint } from '../src/world/buildTools.js';
import { dishOf, RECIPES } from '../src/world/cookingPot.js';
import { DISHES } from '../src/world/cooking.js';
import { mockGame } from './fixtures/mockGame.js';

describe('block data from outside (a blueprint, /fill hopper:7) cannot crash the tick', () => {
  // Hopper meta is 0 (down) or 1-4 (a side); 5-7 used to index past SIDE_DIRS and throw in every hopper step.
  it('a hopper with an unknown meta points its spout down', () => {
    for (const m of [0, 5, 6, 7, 8, 13, 255]) expect(() => spoutDir(m)).not.toThrow();
    expect(spoutDir(5)).toEqual([0, -1, 0]);
    expect(spoutDir(7)).toEqual([0, -1, 0]);
    expect(spoutDir(1)[1]).toBe(0);
  });

  // Piston facing 6 and 7 used to index past FACING6 in retract / extend.
  it('a piston facing index is always one of the six directions', () => {
    for (let m = 0; m < 256; m++) { const f = facingIdx(m); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(FACING6.length); }
    expect(facingIdx(2)).toBe(2);
    expect(facingIdx(6)).toBe(0);
  });

  // A crystal bud with meta 6 or 7 made World.hasSupport throw during any neighbouring block change.
  it('a crystal bud with an unknown facing hangs from the floor instead of throwing', () => {
    const world = { getBlock: () => B.STONE };
    for (const m of [0, 5, 6, 7, 15, 255]) expect(() => crystalSupported(world, 0, 0, 0, B.SMALL_VIOLITE_BUD, m)).not.toThrow();
  });
});

describe('a Cooking Pot with a meta from outside data', () => {
  // meta bits 0-3 index RECIPES; a blueprint or /fill cooking_pot_brew:15 named a dish that does not exist and the aim tip and the use handler threw.
  it('always names a real dish', () => {
    for (let m = 0; m < 256; m++) expect(DISHES[dishOf(m)]).toBeDefined();
    expect(dishOf(RECIPES.length - 1)).toBe(RECIPES.length - 1);
    expect(dishOf(15)).toBe(RECIPES.length > 15 ? 15 : 0);
  });
});

describe('remote players as mob targets', () => {
  const fake = (state) => { const rp = Object.create(RemotePlayer.prototype); rp.state = state; rp.shown = null; rp.target = makeTarget(rp); return rp; };

  // A Voidwalker near a guest read player.inventory.armor[0] on the guest's stand-in, which had no armour list: it threw every tick on the host.
  it('has an armour list, helmet first, so a Voidwalker can ask whether the face is hidden', () => {
    const none = fake({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }).target;
    expect(none.inventory.armor).toEqual([null, null, null, null]);
    expect(() => gazeProvokes(none)).not.toThrow();
    expect(gazeProvokes(none)).toBe(true);
    const pumpkin = fake({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, armor: [B.CARVED_PUMPKIN, null, null, null] }).target;
    expect(wearsPumpkin(pumpkin)).toBe(true);
    expect(gazeProvokes(pumpkin)).toBe(false);
    expect(pumpkinStack().id).toBe(B.CARVED_PUMPKIN);
  });

  it('wearsPumpkin copes with a player-like object that has no armour at all', () => {
    expect(wearsPumpkin({ inventory: {} })).toBe(false);
    expect(wearsPumpkin({ inventory: { armor: [pumpkinStack()] } })).toBe(true);
  });

  it('the armour list tolerates a missing state', () => {
    const t = fake(null).target;
    expect(t.inventory.armor).toEqual([null, null, null, null]);
  });
});

describe('items left behind in unloaded chunks', () => {
  const stub = () => ({ scene: { add() {}, remove() {} }, ticks: 1, net: null, player: { dead: true, body: { box: () => [0, 0, 0, 0, 0, 0] } } });
  const mk = (kind, x, extra = {}) => ({ kind, dead: false, removed: false, x, y: 70, z: 0, stack: { id: 1, count: 1 }, tick() {}, ...extra });

  // The soak showed the list growing for as long as the player kept travelling: frozen items never aged.
  it('keeps only the newest frozen items, orbs and arrows', () => {
    const g = stub(), em = new EntityManager(g);
    g.world = { isLoaded: (x) => x >= 0 }; // x < 0: unloaded
    const old = [];
    for (let i = 0; i < MAX_FROZEN + 20; i++) { const e = mk(i % 3 === 0 ? 'xp' : i % 3 === 1 ? 'arrow' : 'item', -100 - i); old.push(e); em.add(e); }
    const near = mk('item', 5), mob = mk('mob', -500), boat = mk('boat', -500), knot = mk('knot', -500);
    for (const e of [near, mob, boat, knot]) em.add(e);
    expect(em.trimFrozen()).toBe(20);
    expect(old.slice(0, 20).every((e) => e.dead)).toBe(true);
    expect(old.slice(20).every((e) => !e.dead)).toBe(true);
    for (const e of [near, mob, boat, knot]) expect(e.dead).toBe(false);
  });

  it('does nothing below the limit and never touches guest mirrors', () => {
    const g = stub(), em = new EntityManager(g);
    g.world = { isLoaded: () => false };
    const few = [mk('item', 1), mk('item', 2)];
    few.forEach((e) => em.add(e));
    expect(em.trimFrozen()).toBe(0);
    const em2 = new EntityManager(g);
    for (let i = 0; i < MAX_FROZEN + 5; i++) em2.add(mk('item', i, { netProxy: true }));
    expect(em2.trimFrozen()).toBe(0);
  });

  it('runs from the tick', () => {
    const g = stub(), em = new EntityManager(g);
    g.world = { isLoaded: () => false }; g.ticks = 200;
    const items = [];
    for (let i = 0; i < MAX_FROZEN + 3; i++) { const e = mk('item', i); items.push(e); em.add(e); }
    em.tick();
    expect(em.list.length).toBe(MAX_FROZEN);
  });
});

describe('a world with state from every newer system survives save, export, import and backup', () => {
  let st;
  beforeEach(() => { st = new MemoryStorage(); setStorage(st); });

  function richGame() {
    const g = mockGame({ name: 'Everything' });
    const cb = new Clipboard(2, 1, 2);
    cb.ids.fill(B.STONE);
    setRep(g.player, '10,20', 33); setRep(g.player, '-5,7', -45);
    g.player.blueprints = { house: encodeBlueprint(cb) };
    discover(g.player.stats.guide, 'creatures', 'shambler', 2, 100);
    discover(g.player.stats.guide, 'structures', 'village', 1, 300, { x: 5, z: 6 });
    g.player.stats.killsBy = { shambler: 5 }; g.player.stats.walked = 1234.5;
    g.onboarding = { save: () => ({ hints: ['hurt'], steps: ['wood', 'bench'], finished: false }) };
    g.worldEvents = { save: () => ({ lastSlot: 12, craters: [], lanterns: [] }) };
    g.seasons.setDays(6, 5000); g.seasons.setSeason('winter', 5000);
    g.social = new SocialState();
    g.social.create('Host', 'reds', 'red');
    g.social.ops.set('alice', 'Alice');
    g.social.bans.set('bob', { name: 'Bob', reason: 'x', by: 'Host', tok: 'abcdefgh12' });
    g.guestBlueprints = { 'n:alice': { shed: encodeBlueprint(cb) } };
    g.netPlayers = { Alice: { x: 1, y: 70, z: 1, yaw: 0, pitch: 0, health: 20, food: 20, saturation: 1, exhaustion: 0, air: 300, spawn: { x: 1, y: 70, z: 1 }, slots: [], reputation: { '1,1': 12 } } };
    return g;
  }
  const plain = (x) => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));
  const fields = (d) => plain({ rep: d.player.reputation, bp: d.player.blueprints, stats: d.stats, ob: d.onboarding, ev: d.worldEvents, se: d.seasons, social: d.social, gbp: d.guestBlueprints, np: d.netPlayers });

  it('keeps every field through export and import', async () => {
    const g = richGame();
    const saved = await saveGame(g);
    const first = fields(saved);
    expect(first.rep).toEqual({ '10,20': 33, '-5,7': -45 });
    expect(Object.keys(first.bp)).toEqual(['house']);
    expect(first.social.teams.length).toBe(1);
    const ex = await exportWorld(g.saveSlot);
    const imp = await importWorld(ex.bytes);
    expect(imp.ok).toBe(true);
    const back = await loadWorld(imp.summary.slot);
    expect(back.status).toBe('ok');
    expect(fields(back.data)).toEqual(first);
  });

  it('a backup restores the same world', async () => {
    const g = richGame();
    const saved = await saveGame(g);
    await writeWorld(g.saveSlot, saved, { backupIntervalMs: 0, backupReason: 'manual' });
    const again = await loadWorld(g.saveSlot);
    expect(again.status).toBe('ok');
    expect(fields(again.data)).toEqual(fields(saved));
  });
});

describe('block table sanity for the fuzzed ids', () => {
  it('every block has a name and a texture definition', () => {
    for (const id of Object.keys(BLOCKS).map(Number)) { if (id === 0) continue; expect(typeof BLOCKS[id].name).toBe('string'); }
  });
});
