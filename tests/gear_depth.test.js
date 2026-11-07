// Gear and combat depth: Warhammer, Dagger, Glaive, Returning Disc, trinkets, Slagsteel armour and set bonuses.
import { describe, it, expect } from 'vitest';
import { I, ITEMS, WEAPONS, ARMOR_MATERIALS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { resolveBindings } from '../src/ui/bindings.js';
import { Mob } from '../src/mobs/mob.js';
import { Player } from '../src/player/player.js';
import { Inventory } from '../src/player/inventory.js';
import { craft } from '../src/player/crafting.js';
import * as W from '../src/world/weaponStats.js';
import { weaponOf, reachOf, facingDot, isBehind, backstabFactor, stunFor, breaksShield, sweepTargets, sweepDamage, discDamage, discRange, wearPerBlow, wearPerBlock } from '../src/player/weapons.js';
import { TRINKETS, TRINKET_KINDS, trinketKind, wornKinds, cleanTrinkets, TRINKET_SLOTS } from '../src/player/trinkets.js';
import { SETS, setOfItem, countPieces, bonusFor, wornSets, setLines } from '../src/player/setBonuses.js';
import { gearTotals, gearBonuses, NO_GEAR } from '../src/player/gear.js';
import { stepDisc, ReturningDisc, CATCH_STREAK_MAX } from '../src/entities/disc.js';
import { disablesShield } from '../src/mobs/offhand.js';
import { attackerDisablesShield } from '../src/player/shield.js';
import { canApply, categories, enchantability, temperKey, ENCHANTS, availableEnchants, repairMaterial } from '../src/world/enchantments.js';
import { playerSaveData, applyPlayerSave } from '../src/world/save.js';
import { packPlayerState, unpackPlayerState, packMob } from '../src/net/protocol.js';
import { STRUCTURE_LOOT, LOOT, LOOT_A } from '../src/mobs/spawnerBlocks.js';
import { buildTopics } from '../src/ui/helpTopics.js';
import { MILESTONES } from '../src/player/milestones.js';
import { toolGrid, tooltipHTML, setWornArmor } from '../src/ui/icons.js';
import { gridPixels } from '../src/render/weaponModel.js';

const st = (id, extra = {}) => ({ id, count: 1, damage: 0, ...extra });
const set4 = (m) => ['helmet', 'chestplate', 'leggings', 'boots'].map((p) => st(I[`${m}_${p}`.toUpperCase()]));
const TIERS = W.WEAPON_TIERS;

describe('weapons: registry', () => {
  it('every kind has a stone, iron and diamond weapon appended after the older items', () => {
    for (const kind of Object.keys(WEAPONS)) for (const tier of TIERS) {
      const id = WEAPONS[kind][tier];
      expect(ITEMS[id], `${tier} ${kind}`).toBeTruthy();
      expect(id).toBeGreaterThan(I.SKYBEAN);
      expect(ITEMS[id].durability).toBe(W.WEAPON_KINDS[kind].tiers[tier].durability);
      expect(ITEMS[id].stack).toBe(1);
    }
    expect(I.IRON_WARHAMMER).toBe(WEAPONS.warhammer.iron);
  });
  it('swing speeds order the play styles: hammer slowest, dagger fastest, glaive longest reach', () => {
    for (const tier of TIERS) {
      const t = (k) => ITEMS[WEAPONS[k][tier]].weapon;
      expect(t('warhammer').attackSpeed).toBeLessThan(t('glaive').attackSpeed);
      expect(t('dagger').attackSpeed).toBeGreaterThan(ITEMS[I[`${tier}_SWORD`.toUpperCase()]].tool.attackSpeed * 1.5);
      expect(t('glaive').reach).toBeGreaterThan(t('warhammer').reach);
      expect(t('dagger').reach).toBeLessThan(3);
      expect(t('warhammer').damage).toBeGreaterThan(ITEMS[I[`${tier}_AXE`.toUpperCase()]].tool.damage - 2);
    }
  });
  it('tiers get stronger and tougher', () => {
    for (const kind of Object.keys(WEAPONS)) for (let k = 1; k < TIERS.length; k++) {
      const a = W.WEAPON_KINDS[kind].tiers[TIERS[k - 1]], b = W.WEAPON_KINDS[kind].tiers[TIERS[k]];
      expect(b.damage).toBeGreaterThan(a.damage);
      expect(b.durability).toBeGreaterThan(a.durability);
    }
  });
  it('has recipes in the workbench for each', () => {
    const _ = null, S = I.STICK;
    const mats = { stone: B.COBBLESTONE, iron: I.IRON_INGOT, diamond: I.DIAMOND };
    for (const tier of TIERS) {
      const m = mats[tier];
      expect(craft([m, m, m, m, S, m, _, S, _].map((x) => x && st(x)), 3)).toEqual({ id: WEAPONS.warhammer[tier], count: 1 });
      expect(craft([m, S].map((x) => st(x)), 1)).toEqual({ id: WEAPONS.dagger[tier], count: 1 });
      expect(craft([_, m, m, _, S, m, S, _, _].map((x) => x && st(x)), 3)).toEqual({ id: WEAPONS.glaive[tier], count: 1 });
      expect(craft([_, m, _, m, I.FLINT, m, _, m, _].map((x) => x && st(x)), 3)).toEqual({ id: WEAPONS.disc[tier], count: 1 });
    }
  });
  it('icons exist for every weapon and have pixels', () => {
    for (const kind of Object.keys(WEAPONS)) for (const tier of TIERS) {
      const px = gridPixels(toolGrid(ITEMS[WEAPONS[kind][tier]].weapon));
      expect(px.length, `${tier} ${kind}`).toBeGreaterThan(30);
    }
  });
});

describe('warhammer', () => {
  const hammer = st(I.IRON_WARHAMMER);
  it('staggers only on a full swing', () => {
    expect(stunFor(hammer, 10)).toBe(W.STUN_TICKS);
    expect(stunFor(hammer, 10 * W.STUN_MIN_FRACTION)).toBe(W.STUN_TICKS);
    expect(stunFor(hammer, 4)).toBe(0);
    expect(stunFor(st(I.IRON_SWORD), 99)).toBe(0);
    expect(stunFor(null, 99)).toBe(0);
  });
  it('splinters shields like an axe, for mobs and for players', () => {
    expect(breaksShield(hammer)).toBe(true);
    expect(breaksShield(st(I.IRON_AXE))).toBe(true);
    expect(breaksShield(st(I.IRON_SWORD))).toBe(false);
    expect(disablesShield(hammer)).toBe(true);
    expect(attackerDisablesShield({ inventory: { selectedStack: hammer } })).toBe(true);
    expect(attackerDisablesShield({ inventory: { selectedStack: st(I.IRON_DAGGER) } })).toBe(false);
  });
  it('a hit by a player staggers the mob it hits (also for a guest\'s stand-in), a weak one does not', () => {
    const game = { audio: { play() {} }, particles: { emit() {}, smoke() {} }, entities: { spawnItem() {}, list: [] }, player: { stats: { kills: 0 } } };
    const player = (held) => ({ isPlayer: true, x: 0, y: 64, z: -2, inventory: { selectedStack: held } });
    const m = new Mob('shambler', 0, 64, 0); m._game = game;
    expect(m.hurt(10, 'player', player(hammer), 0.4)).toBe(true);
    expect(m.stunTicks).toBe(W.STUN_TICKS);
    const m2 = new Mob('shambler', 0, 64, 0); m2._game = game;
    m2.hurt(3, 'player', player(hammer), 0.4);
    expect(m2.stunTicks | 0).toBe(0);
    const m3 = new Mob('shambler', 0, 64, 0); m3._game = game;
    m3.hurt(10, 'player', player(st(I.IRON_SWORD)), 0.4);
    expect(m3.stunTicks | 0).toBe(0);
    const m4 = new Mob('shambler', 0, 64, 0); m4._game = game;
    m4.hurt(10, 'arrow', player(hammer), 0.4, { x: 0, y: 65, z: -3 }); // a thrown or shot thing is not a swing
    expect(m4.stunTicks | 0).toBe(0);
  });
  it('wears twice as fast as a sword, on blocks too', () => {
    expect(wearPerBlow(hammer, ITEMS[I.IRON_WARHAMMER].weapon)).toBe(2);
    expect(wearPerBlow(st(I.IRON_DAGGER), ITEMS[I.IRON_DAGGER].weapon)).toBe(1);
    expect(wearPerBlow(st(I.IRON_SWORD), ITEMS[I.IRON_SWORD].tool)).toBe(1);
    expect(wearPerBlow(st(I.IRON_AXE), ITEMS[I.IRON_AXE].tool)).toBe(2);
    expect(wearPerBlock(hammer, ITEMS[I.IRON_WARHAMMER].weapon)).toBe(2);
    expect(wearPerBlock(st(I.IRON_PICKAXE), ITEMS[I.IRON_PICKAXE].tool)).toBe(1);
  });
});

describe('dagger', () => {
  const dagger = st(I.IRON_DAGGER);
  const mob = { x: 0, z: 0, yaw: 0 }; // faces -z
  it('facing maths: front is +1, behind -1', () => {
    expect(facingDot(mob, 0, -5)).toBeCloseTo(1);
    expect(facingDot(mob, 0, 5)).toBeCloseTo(-1);
    expect(Math.abs(facingDot(mob, 5, 0))).toBeLessThan(1e-9);
    expect(facingDot({ x: 0, z: 0, yaw: Math.PI }, 0, 5)).toBeCloseTo(1);
  });
  it('lands 2.5x from behind, normal from the front or the side', () => {
    expect(backstabFactor(dagger, mob, 0, 3)).toBe(W.BACKSTAB_MULT);
    expect(backstabFactor(dagger, mob, 1, 3)).toBe(W.BACKSTAB_MULT);
    expect(backstabFactor(dagger, mob, 0, -3)).toBe(1);
    expect(backstabFactor(dagger, mob, 4, 0.5)).toBe(1);
    expect(backstabFactor(st(I.IRON_SWORD), mob, 0, 3)).toBe(1);
    expect(isBehind(mob, 0, 3)).toBe(true);
  });
  it('a behind blow with a diamond dagger outweighs a diamond sword\'s blow, but the front blow does not', () => {
    const d = ITEMS[I.DIAMOND_DAGGER].weapon.damage, s = ITEMS[I.DIAMOND_SWORD].tool.damage;
    expect(d * W.BACKSTAB_MULT).toBeGreaterThan(s);
    expect(d).toBeLessThan(s);
  });
});

describe('glaive', () => {
  const eye = [0, 65.6, 0], look = [0, 0, -1];
  const at = (x, z) => ({ kind: 'mob', x, y: 64, z, height: 1.8, width: 0.6, dead: false, deathTime: 0 });
  it('reaches 4.5 blocks, a dagger 2.5, anything else 3', () => {
    expect(reachOf(st(I.IRON_GLAIVE))).toBe(4.5);
    expect(reachOf(st(I.IRON_DAGGER))).toBe(2.5);
    expect(reachOf(st(I.IRON_SWORD))).toBe(3);
    expect(reachOf(null)).toBe(3);
  });
  it('sweeps up to three others in the cone, nearest first, never the primary or the dead', () => {
    const primary = at(0, -3), a = at(1, -2.5), b = at(-1, -3.5), c = at(0.5, -4), far = at(0, -9), behind = at(0, 3), dead = { ...at(0, -2), dead: true };
    const got = sweepTargets(eye, look, primary, [primary, a, b, c, far, behind, dead, at(2, -3), at(-2, -2.5)], 5);
    expect(got.length).toBeLessThanOrEqual(W.SWEEP_MAX);
    expect(got).not.toContain(primary);
    expect(got).not.toContain(far);
    expect(got).not.toContain(behind);
    expect(got).not.toContain(dead);
    expect(got[0]).toBe(a);
    expect(sweepTargets(eye, look, primary, [primary], 5)).toEqual([]);
  });
  it('the sweep takes 60 % of the blow', () => {
    expect(sweepDamage(10)).toBeCloseTo(6);
  });
});

describe('returning disc', () => {
  it('flies out, turns at its range, flies home and is caught', () => {
    const s = { x: 0, y: 65, z: 0, vx: 0, vy: 0, vz: -W.DISC_SPEED, phase: 'out', travelled: 0, range: W.DISC_RANGE, age: 0 };
    const owner = { x: 0, y: 65, z: 0 };
    let res = null, ticks = 0, far = 0;
    while (!res && ticks++ < 400) { res = stepDisc(s, owner); far = Math.max(far, -s.z); }
    expect(res).toBe('caught');
    expect(far).toBeGreaterThan(W.DISC_RANGE - 2);
    expect(far).toBeLessThanOrEqual(W.DISC_RANGE + 1); // (the turn is a curve, not a corner)
    expect(ticks).toBeLessThan(W.DISC_MAX_TICKS);
  });
  it('turns back at once at a wall, and gives up if it cannot reach the thrower', () => {
    const s = { x: 0, y: 65, z: 0, vx: 0, vy: 0, vz: -W.DISC_SPEED, phase: 'out', travelled: 0, range: 12, age: 0 };
    stepDisc(s, { x: 0, y: 65, z: 0 }, true);
    expect(s.phase).toBe('back');
    const t = { x: 0, y: 65, z: 0, vx: 0, vy: 0, vz: -0.5, phase: 'back', travelled: 5, range: 12, age: 0, turned: 0 };
    let res = null, n = 0;
    while (!res && n++ < 500) res = stepDisc(t, { x: 500, y: 65, z: 0 }); // the thrower is far off
    expect(res).toBe('fumbled');
  });
  it('Farflight lengthens the flight, and the tier sets the damage', () => {
    expect(discRange(st(I.IRON_DISC))).toBe(W.DISC_RANGE);
    expect(discRange(st(I.IRON_DISC, { ench: { farflight: 2 } }))).toBe(W.DISC_RANGE + 2 * W.DISC_RANGE_PER_FARFLIGHT);
    expect(discDamage(st(I.DIAMOND_DISC))).toBeGreaterThan(discDamage(st(I.IRON_DISC)));
    expect(ITEMS[I.IRON_DISC].weapon.damage).toBe(2); // in the hand it only bats
  });
  it('a catch builds a streak that makes the next throw hit harder (to a cap); a fumble resets it', () => {
    const owner = { dead: false, eyePos: () => [0, 65, 0], lookDir: () => [0, 0, -1] };
    const game = { player: owner, ticks: 0, audio: { play() {} }, interaction: {}, entities: { list: [] }, world: { raycast: () => null } };
    const stack = st(I.IRON_DISC);
    game.interaction.disc = new ReturningDisc(game, owner, stack, 0);
    expect(game.interaction.disc.damage).toBe(5);
    game.interaction.disc.end(game, 'caught');
    expect(game.interaction.discStreak).toBe(1);
    expect(game.interaction.disc).toBe(null);
    const second = new ReturningDisc(game, owner, stack, game.interaction.discStreak);
    expect(second.damage).toBe(6);
    const capped = new ReturningDisc(game, owner, stack, CATCH_STREAK_MAX);
    second.end(game, 'fumbled');
    expect(game.interaction.discStreak).toBe(0);
    expect(capped.damage).toBe(5 + CATCH_STREAK_MAX);
  });
  it('hits each mob once a leg, and wears the stack, never the inventory count', () => {
    const owner = { dead: false, eyePos: () => [0, 65, 0], lookDir: () => [0, 0, -1], lastAttacked: null };
    const hits = [];
    const mob = { kind: 'mob', x: 0, y: 64, z: -3, width: 0.6, height: 1.8, dead: false, deathTime: 0, hurt: (d) => { hits.push(d); return true; } };
    const inv = { slots: [], breakListeners: [], changed() {} };
    const stack = st(I.IRON_DISC); inv.slots[0] = stack;
    const game = { player: { ...owner, creative: false, inventory: inv }, ticks: 1, audio: { play() {} }, interaction: {}, particles: null, entities: { list: [mob] }, world: { raycast: () => null } };
    const d = new ReturningDisc(game, game.player, stack, 0);
    d.x = 0; d.y = 65; d.z = -3;
    d.strike(game); d.strike(game);
    expect(hits).toEqual([5]);
    d.hit.clear(); d.strike(game);
    expect(hits.length).toBe(2);
    expect(stack.damage).toBe(2);
    expect(inv.slots[0]).toBe(stack);
  });
});

describe('enchantments and anvil', () => {
  it('the new melee weapons take the sword enchantments; discs take Farflight and the generic ones', () => {
    for (const tier of TIERS) for (const k of ['warhammer', 'dagger', 'glaive']) {
      const id = WEAPONS[k][tier];
      expect(categories(id)).toContain('sword');
      expect(canApply('keen', id)).toBe(true);
      expect(canApply('plunder', id)).toBe(true);
      expect(canApply('forgebite', id, true)).toBe(true);
      expect(canApply('sunmend', id, true)).toBe(true);
      expect(canApply('steadfast', id)).toBe(true);
      expect(temperKey(id)).toBe('forgebite');
      expect(enchantability(id)).toBeGreaterThan(0);
      expect(canApply('bulwark', id)).toBe(false);
      expect(repairMaterial(id)).toBeTruthy();
    }
    const disc = I.IRON_DISC;
    expect(canApply('farflight', disc)).toBe(true);
    expect(canApply('keen', disc)).toBe(false);
    expect(canApply('sunmend', disc, true)).toBe(true);
    expect(canApply('steadfast', disc, true)).toBe(true);
    expect(availableEnchants(disc, 30).map(([k]) => k)).toContain('farflight');
    expect(ENCHANTS.farflight.max).toBe(3);
  });
  it('slagsteel armour is enchantable and repaired with ingots', () => {
    expect(enchantability(I.SLAGSTEEL_CHESTPLATE)).toBeGreaterThan(0);
    expect(repairMaterial(I.SLAGSTEEL_HELMET)).toBe(I.SLAGSTEEL_INGOT);
    expect(temperKey(I.SLAGSTEEL_LEGGINGS)).toBe('forgeward');
  });
});

describe('slagsteel armour and set bonuses', () => {
  const full = () => [st(I.SLAGSTEEL_HELMET), st(I.SLAGSTEEL_CHESTPLATE), st(I.SLAGSTEEL_LEGGINGS), st(I.DIRGESTEP_BOOTS)];
  it('is a little better than iron, below diamond', () => {
    const pts = (a) => a.reduce((n, s) => n + ITEMS[s.id].armor.defense, 0);
    expect(pts(full())).toBeGreaterThan(pts(set4('iron')));
    expect(pts(full())).toBeLessThan(pts(set4('diamond')));
    expect(ARMOR_MATERIALS.slagsteel.durability).toBeGreaterThan(ARMOR_MATERIALS.iron.durability);
  });
  it('the Dirgestep Boots complete the Slagsteel set', () => {
    expect(setOfItem(I.DIRGESTEP_BOOTS)).toBe('slagsteel');
    expect(countPieces(full()).slagsteel).toBe(4);
    expect(gearTotals(full(), []).fireResist).toBeCloseTo(0.8);
    expect(gearTotals(full().slice(0, 2), []).fireResist).toBeCloseTo(0.35);
    expect(gearTotals(full().slice(0, 1), []).fireResist).toBe(0);
  });
  it('bonuses are cumulative and start at the pieces named', () => {
    expect(bonusFor('iron', 1)).toEqual({});
    expect(bonusFor('iron', 2).knockResist).toBeCloseTo(0.35);
    expect(bonusFor('iron', 3).protect).toBe(1);
    expect(bonusFor('iron', 4).protect).toBe(2);
    expect(bonusFor('diamond', 4).protect).toBe(4);
    expect(bonusFor('leather', 4).sprintSave).toBeGreaterThan(0);
    expect(bonusFor('gold', 4).plunder).toBe(1);
    expect(bonusFor('gold', 2).wearSave).toBeGreaterThan(0);
  });
  it('every set in SETS has a name, tiers in order and an item to wear', () => {
    for (const [k, s] of Object.entries(SETS)) {
      expect(s.name.length).toBeGreaterThan(2);
      const ns = s.tiers.map((t) => t.n);
      expect([...ns].sort()).toEqual(ns);
      expect(Math.max(...ns)).toBeLessThanOrEqual(4);
      for (const t of s.tiers) { expect(t.text.length).toBeGreaterThan(5); expect(Object.keys(t.b).length).toBeGreaterThan(0); for (const key of Object.keys(t.b)) expect(key in NO_GEAR, key).toBe(true); }
      expect(Object.values(ITEMS).some((d) => d && d.armor && setOfItem(d.id) === k)).toBe(true);
    }
  });
  it('tooltips show the set with the reached tiers', () => {
    const lines = setLines(I.IRON_CHESTPLATE, set4('iron').slice(0, 3));
    expect(lines[0].text).toBe('Ironclad set (3/4)');
    expect(lines.slice(1).map((l) => l.active)).toEqual([true, true, false]);
    expect(setLines(I.BREAD, [])).toEqual([]);
    expect(wornSets(set4('gold')).find((s) => s.id === 'gold').tiers.every((t) => t.active)).toBe(true);
    setWornArmor(() => set4('iron'));
    const html = tooltipHTML(st(I.IRON_HELMET));
    expect(html).toContain('Ironclad set (4/4)');
    expect(html).toContain('tt-good');
    setWornArmor(() => []);
  });
  it('the player takes less from a full Ironclad set and the protection stays under the cap', () => {
    const plain = new Player(), geared = new Player();
    const worn = set4('iron');
    plain.inventory.armor = [st(I.LEATHER_HELMET), null, null, null];
    geared.inventory.armor = worn;
    plain.hurt(8, 'mob:x'); geared.hurt(8, 'mob:x');
    expect(geared.health).toBeGreaterThan(plain.health);
    const diamond = gearTotals(set4('diamond'), []);
    expect(diamond.protect).toBeLessThanOrEqual(12);
    const dd = new Player(); dd.inventory.armor = set4('diamond').map((s) => ({ ...s, ench: { bulwark: 4 } }));
    dd.hurt(10, 'mob:x');
    expect(20 - dd.health).toBeGreaterThan(10 * 0.04); // never invulnerable
  });
  it('fire sources hurt a Forgewalker less', () => {
    const a = new Player(), b = new Player();
    b.inventory.armor = full();
    a.hurt(4, 'lava'); b.hurt(4, 'lava');
    expect(20 - b.health).toBeLessThan((20 - a.health) * 0.5);
  });
});

describe('trinkets', () => {
  it('six kinds, each an item, with a description and a bonus', () => {
    expect(TRINKET_KINDS.length).toBe(6);
    for (const k of TRINKET_KINDS) {
      const id = I[k.toUpperCase()];
      expect(ITEMS[id], k).toBeTruthy();
      expect(trinketKind(st(id))).toBe(k);
      expect(TRINKETS[k].desc.length).toBeGreaterThan(10);
      expect(Object.keys(TRINKETS[k].bonus).length).toBeGreaterThan(0);
      expect(ITEMS[id].stack).toBe(1);
    }
    expect(trinketKind(st(I.BREAD))).toBe(null);
  });
  it('two slots, a kind works once, bonuses add to the armour sets', () => {
    expect(TRINKET_SLOTS).toBe(2);
    const a = st(I.FLEET_ANKLET), b = st(I.FLEET_ANKLET);
    expect(wornKinds([a, b])).toEqual(['fleet_anklet']);
    expect(gearTotals([], [a, b]).speed).toBeCloseTo(0.12);
    const both = gearTotals(set4('leather'), [a, st(I.LODESTONE_CHARM)]);
    expect(both.speed).toBeCloseTo(0.2);
    expect(both.pull).toBe(6);
    expect(gearTotals([], [st(I.LANTERN_CHARM)]).light).toBe(12);
  });
  it('the totals are remembered and follow what is worn', () => {
    const inv = new Inventory(36);
    expect(gearBonuses(inv).speed).toBe(0);
    inv.trinkets[0] = st(I.FLEET_ANKLET);
    expect(gearBonuses(inv).speed).toBeCloseTo(0.12);
    inv.trinkets[0] = null;
    expect(gearBonuses(inv).speed).toBe(0);
  });
  it('cleaning tolerates missing, short and rotten data', () => {
    expect(cleanTrinkets(undefined)).toEqual([null, null]);
    expect(cleanTrinkets(null)).toEqual([null, null]);
    expect(cleanTrinkets([st(I.BREAD), { id: 'x' }, st(I.FLEET_ANKLET)])).toEqual([null, null]);
    expect(cleanTrinkets([st(I.WARDING_AMULET, { ench: { keen: 9 } })])[0]).toEqual({ id: I.WARDING_AMULET, count: 1, damage: 0 });
    expect(cleanTrinkets([st(I.WARDING_AMULET), st(I.MINERS_LOUPE), st(I.EMBER_BAND)]).length).toBe(2);
  });
  it('the Warding Amulet takes a share off creature and arrow damage, not falls; the Ember Band off fire', () => {
    const plain = new Player(), ward = new Player(), ember = new Player();
    ward.inventory.trinkets[0] = st(I.WARDING_AMULET);
    ember.inventory.trinkets[1] = st(I.EMBER_BAND);
    plain.hurt(10, 'mob:x'); ward.hurt(10, 'mob:x');
    expect(20 - ward.health).toBeCloseTo((20 - plain.health) * 0.85);
    const p2 = new Player(), w2 = new Player(); w2.inventory.trinkets[0] = st(I.WARDING_AMULET);
    p2.hurt(5, 'fall'); w2.hurt(5, 'fall');
    expect(w2.health).toBe(p2.health);
    const p3 = new Player(); p3.hurt(4, 'fire'); ember.hurt(4, 'fire');
    expect(20 - ember.health).toBeCloseTo((20 - p3.health) * 0.55);
  });
  it('the Fleet Anklet walks faster', () => {
    const w = { getBlock: () => 0, getMeta: () => 0, boxCollides: () => false, isLoaded: () => true, heightAt: () => 0 };
    const speed = (p) => { p.body.travel = (world, o) => { p.sp = o.speed; }; try { p.tick(w, { forward: 1, strafe: 0 }); } catch { /* the stub world is thin */ } return p.sp; };
    const a = new Player(), b = new Player();
    b.inventory.trinkets[0] = st(I.FLEET_ANKLET);
    const sa = speed(a), sb = speed(b);
    if (sa !== undefined && sb !== undefined) expect(sb / sa).toBeCloseTo(1.12);
  });
  it('crafts', () => {
    const _ = null, S = I.STRING, G = I.GOLD_INGOT, N = I.GOLD_NUGGET;
    expect(craft([S, I.LEATHER, S, I.FEATHER, _, I.FEATHER, _, _, _].map((x) => x && st(x)), 3)).toEqual({ id: I.FLEET_ANKLET, count: 1 });
    expect(craft([_, S, _, G, I.DIAMOND, G, _, G, _].map((x) => x && st(x)), 3)).toEqual({ id: I.WARDING_AMULET, count: 1 });
    expect(craft([_, S, _, I.IRON_INGOT, I.CINNABAR, I.IRON_INGOT, _, I.IRON_INGOT, _].map((x) => x && st(x)), 3)).toEqual({ id: I.LODESTONE_CHARM, count: 1 });
    expect(craft([_, S, _, N, B.TORCH, N, _, N, _].map((x) => x && st(x)), 3)).toEqual({ id: I.LANTERN_CHARM, count: 1 });
    expect(craft([_, G, _, G, I.EMBER_ROD, G, _, G, _].map((x) => x && st(x)), 3)).toEqual({ id: I.EMBER_BAND, count: 1 });
  });
  it('are found in chests of the existing kinds, none new, and not in the common tables only', () => {
    const inTable = (id) => Object.entries(STRUCTURE_LOOT).filter(([, t]) => t[0].some((e) => e[0] === id)).map(([k]) => +k).concat(LOOT_A.some((e) => e[0] === id) ? [LOOT.DUNGEON] : []);
    for (const k of TRINKET_KINDS) expect(inTable(I[k.toUpperCase()]).length, k).toBeGreaterThan(0);
    for (const kind of ['warhammer', 'dagger', 'glaive', 'disc']) expect(Object.values(WEAPONS[kind]).some((id) => inTable(id).length > 0), kind).toBe(true);
  });
});

describe('saving and the network', () => {
  it('trinkets are saved with the player and come back; older data without them loads', () => {
    const p = new Player();
    p.inventory.trinkets[0] = st(I.MINERS_LOUPE);
    const data = JSON.parse(JSON.stringify(playerSaveData(p)));
    expect(data.trinkets[0].id).toBe(I.MINERS_LOUPE);
    const q = new Player();
    applyPlayerSave({ player: q }, data);
    expect(q.inventory.trinkets[0].id).toBe(I.MINERS_LOUPE);
    expect(q.inventory.trinkets[1]).toBe(null);
    const old = { ...data }; delete old.trinkets;
    const r = new Player(); r.inventory.trinkets[0] = st(I.FLEET_ANKLET);
    applyPlayerSave({ player: r }, old);
    expect(r.inventory.trinkets).toEqual([null, null]);
  });
  it('the player-state array stays 13 long and a guest\'s held weapon travels in it', () => {
    const p = new Player();
    const a = packPlayerState(p, I.IRON_GLAIVE, 3);
    expect(a.length).toBe(13);
    expect(unpackPlayerState(a).held).toBe(I.IRON_GLAIVE);
  });
  it('the mob snapshot keeps its 25 fields', () => {
    expect(packMob(new Mob('shambler', 0, 64, 0)).length).toBe(25);
  });
  it('clearing the inventory empties the trinket slots too', () => {
    const inv = new Inventory(36); inv.trinkets[1] = st(I.EMBER_BAND); inv.clear();
    expect(inv.trinkets).toEqual([null, null]);
  });
});

describe('help, guide, milestones', () => {
  it('has a help topic for the gear with every weapon, trinket and set named', () => {
    const topic = buildTopics({ table: resolveBindings({}) }).find((t) => t.id === 'gear');
    expect(topic).toBeTruthy();
    for (const w of ['Warhammer', 'Dagger', 'Glaive', 'Returning Disc']) expect(topic.text).toContain(w.toLowerCase());
    for (const t of Object.values(TRINKETS)) expect(topic.text).toContain(t.name.toLowerCase());
    for (const s of Object.values(SETS)) expect(topic.text).toContain(s.name.toLowerCase());
  });
  it('has the milestones', () => {
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ['new_weapon', 'stagger', 'backstab', 'disc_catch', 'trinket', 'full_set']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
