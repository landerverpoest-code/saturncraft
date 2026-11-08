// Combat analysis: damage against the armour tiers, and how long the big fights are for the gear you can have by then.
import { I, ITEMS, ARMOR_MATERIALS } from '../../src/world/items.js';
import { armorReduce } from '../../src/player/armor.js';
import { protectionReduce } from '../../src/world/enchantments.js';
import { arrowDamage, meleeBonus } from '../../src/world/enchantments.js';
import { MOBS } from '../../src/mobs/mobTypes.js';
import '../../src/mobs/dimensionMobs.js';
import '../../src/mobs/hostileVariants.js';
import '../../src/mobs/hushkeeper.js';
import '../../src/mobs/slagColossus.js';
import { COLOSSUS } from '../../src/mobs/slagColossus.js';
import { HUSHKEEPER } from '../../src/mobs/hushkeeper.js';
import { RIMEKEEP_WARDEN } from '../../src/world/rimekeep.js';
import { mobDamageTaken } from '../../src/mobs/equipment.js';

/** Armour sets as { points, toughness }: none, then each material (all four pieces). */
export function armorSets() {
  const sets = { none: { points: 0, toughness: 0 } };
  for (const [mat, m] of Object.entries(ARMOR_MATERIALS)) {
    if (!['leather', 'gold', 'iron', 'diamond'].includes(mat)) continue;
    sets[mat] = { points: m.defense.reduce((a, b) => a + b, 0), toughness: m.toughness * 4 };
  }
  return sets;
}

/** What a hit of `damage` costs the player in a set, with `epf` Bulwark points (4 pieces of Bulwark IV = 16; the cap is 20). */
export const damageAfter = (damage, set, epf = 0) => {
  let d = set.points > 0 ? armorReduce(damage, set.points, set.toughness) : damage;
  if (epf > 0) d = protectionReduce(d, epf);
  return d;
};

/** Melee hits per attack of mobs that bite: { key, name, hp, attack }. */
export function meleeMobs() {
  return Object.entries(MOBS).filter(([, m]) => m.attack > 0 && m.category === 'monster').map(([key, m]) => ({ key, name: m.name, hp: m.health, attack: m.attack }));
}

/** Hits (at full swing) to kill a target with `hp` and armour {points, toughness} using a weapon item with Keen `keen`. */
export function hitsToKill(hp, armor, weaponId, keen = 0) {
  const t = ITEMS[weaponId].tool;
  const raw = t.damage + (keen ? 0.5 * keen + 0.5 : 0);
  const taken = mobDamageTaken(raw, 0, { armor: armorPieces(armor) }, 'player');
  return Math.ceil(hp / taken);
}

/** Stacks of a full armour set of one material (for mobDamageTaken). */
function armorPieces(set) {
  if (typeof set === 'string') return ['helmet', 'chestplate', 'leggings', 'boots'].map((p) => ({ id: I[`${set}_${p}`.toUpperCase()], count: 1, damage: 0 }));
  return set;
}

/** Hits for a fully drawn Strongdraw `power` arrow against an armour material. */
export function arrowHitsToKill(hp, material, power = 0, speed = 3) {
  const taken = mobDamageTaken(arrowDamage(speed, power), 0, { armor: armorPieces(material) }, 'player');
  return Math.ceil(hp / taken);
}

/** The fights the brief names: Rimekeep Warden, the Hushkeeper and the Slag Colossus (400 HP with 6 points of natural armour). */
export function bossTable() {
  const weapons = [['iron sword', I.IRON_SWORD, 0], ['diamond sword', I.DIAMOND_SWORD, 0], ['diamond sword Keen V', I.DIAMOND_SWORD, 5], ['diamond axe', I.DIAMOND_AXE, 0]];
  const rows = [];
  for (const [label, id, keen] of weapons) rows.push({
    weapon: label,
    warden: hitsToKill(RIMEKEEP_WARDEN.hp, 'diamond', id, keen),
    hushkeeper: Math.ceil(HUSHKEEPER.HEALTH / (ITEMS[id].tool.damage + (keen ? 0.5 * keen + 0.5 : 0))),
    colossus: Math.ceil(COLOSSUS.HEALTH / mobDamageTaken(ITEMS[id].tool.damage + (keen ? 0.5 * keen + 0.5 : 0), COLOSSUS.ARMOR, null, 'player')),
  });
  rows.push({ weapon: 'bow, Strongdraw V', warden: arrowHitsToKill(RIMEKEEP_WARDEN.hp, 'diamond', 5), hushkeeper: Math.ceil(HUSHKEEPER.HEALTH / arrowDamage(3, 5)), colossus: Math.ceil(COLOSSUS.HEALTH / mobDamageTaken(arrowDamage(3, 5), COLOSSUS.ARMOR, null, 'player')) });
  return rows;
}

export { meleeBonus };

// ---- Weapons (gear round) -------------------------------------------------------------------------------------
import * as W from '../../src/world/weaponStats.js';
import { setBonusProtect } from './setcheck.mjs';

/** Targets for time-to-kill: a 20 hp monster in the open, and the Rimekeep Warden's armour class (diamond) at its health. */
export const TTK_TARGETS = { open20: { hp: 20, armor: 'none' }, armoured20: { hp: 20, armor: 'diamond' }, warden: { hp: RIMEKEEP_WARDEN.hp, armor: 'diamond' } };
/** A thrown disc's cycle: out, back and the rest after a catch (ticks), and the blows it lands on a target standing in its path. */
export const DISC_CYCLE_TICKS = Math.ceil(W.DISC_RANGE / W.DISC_SPEED) + Math.ceil(W.DISC_RANGE / (W.DISC_SPEED * 1.15)) + 12 + 4;
export const DISC_BLOWS = 2;

/** Everything the balance checks want to know about one melee or thrown weapon item. */
export function weaponProfile(id) {
  const d = ITEMS[id], t = d.tool || d.weapon;
  const disc = !!(d.weapon && d.weapon.type === 'disc');
  const damage = disc ? t.throwDamage : t.damage;
  const blowsPerSec = disc ? DISC_BLOWS / (DISC_CYCLE_TICKS / 20) : t.attackSpeed;
  const dagger = t.type === 'dagger', glaive = t.type === 'glaive';
  const burst = damage * (dagger ? W.BACKSTAB_MULT : 1);                 // the biggest single blow with its trick
  const reach = disc ? W.DISC_RANGE : (t.reach || 3.0);
  const group = damage * blowsPerSec * (glaive ? 1 + W.SWEEP_MAX * W.SWEEP_FRACTION : 1); // dps on three mobs bunched in front of you
  const control = t.type === 'warhammer' ? 2 : t.type === 'axe' ? 1 : 0;  // stagger + shield break, or shield break alone
  return { id, key: d.key, name: d.name, type: t.type, damage, blowsPerSec, burst, reach, group, control, durability: d.durability };
}

/** Seconds to kill a target with a weapon id (first blow on contact, the rest at the weapon's pace), or Infinity. `special`: 'backstab'. */
export function timeToKill(id, target, special = null) {
  const p = weaponProfile(id), set = target.armor === 'none' ? [] : armorPieces(target.armor);
  const raw = p.damage * (special === 'backstab' && p.type === 'dagger' ? W.BACKSTAB_MULT : 1);
  const taken = mobDamageTaken(raw, 0, { armor: set }, 'player');
  if (!(taken > 0)) return Infinity;
  return (Math.ceil(target.hp / taken) - 1) / p.blowsPerSec;
}

/** Damage per second of a weapon against a target's armour (full swings). */
export function dpsAgainst(id, armor) {
  const p = weaponProfile(id), set = armor === 'none' ? [] : armorPieces(armor);
  return mobDamageTaken(p.damage, 0, { armor: set }, 'player') * p.blowsPerSec;
}

/** The weapons compared in one tier: the vanilla-style sword and axe next to the new four. */
export function tierWeapons(tier) {
  const ids = [I[`${tier}_SWORD`.toUpperCase()], I[`${tier}_AXE`.toUpperCase()], ...['warhammer', 'dagger', 'glaive', 'disc'].map((k) => I[`${tier}_${k}`.toUpperCase()])];
  return ids.filter((x) => x !== undefined);
}
/** The axes the dominance check compares: [dps, dps against armour, biggest blow, reach, dps on a group, control]. */
export function weaponVector(id) {
  const p = weaponProfile(id);
  return [p.damage * p.blowsPerSec, dpsAgainst(id, 'diamond'), p.burst, p.reach, p.group, p.control];
}
/** Does a beat b: at least as good on every axis and better on one? */
export function dominates(a, b) {
  let better = false;
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i] - 1e-9) return false; if (a[i] > b[i] + 1e-9) better = true; }
  return better;
}

export { setBonusProtect };
