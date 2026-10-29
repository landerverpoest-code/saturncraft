// Shield rules (reference: shield blocking, the parry window and axe disabling).
// A raised shield stops hits from the front (see Player.hurt); what each block
// does lives here as pure functions so it can be tested:
//  * a block in the first PARRY_TICKS after the shield came up is a parry: it
//    costs no durability, throws the attacker back hard and staggers it,
//  * an ordinary block wears the shield with the damage taken,
//  * an attacker swinging an axe knocks the shield down for DISABLE_TICKS
//    (5 s): it cannot be raised until that has run out,
//  * a shield that wears out breaks (Inventory.damageSelected removes it).
import { ITEMS } from '../world/items.js';

export const PARRY_TICKS = 6;        // blocks within this long of the raise are parries
export const DISABLE_TICKS = 100;    // 5 s a disabled shield stays down
export const PARRY_STUN = 30;        // ticks a parried mob stands staggered
export const MIN_WEAR_DAMAGE = 3;    // lighter hits do not wear the shield
export const KNOCK = { block: 0.5, parry: 1.1 };

/** A fresh shield state, kept on the player: cooldown (ticks left of a disabled shield) and age (ticks raised). */
export const newShield = () => ({ cooldown: 0, age: 0 });

/** One tick: the cooldown runs down, `age` counts how long the shield has been up. */
export function shieldTick(s, blocking) {
  if (s.cooldown > 0) s.cooldown--;
  s.age = blocking && s.cooldown === 0 ? s.age + 1 : 0;
}

/** Can the shield be raised (it is not knocked down)? */
export const canRaise = (s) => !s || s.cooldown <= 0;

/** Is a block made now a parry (the shield has only just come up)? */
export const isParry = (s) => !!s && s.age <= PARRY_TICKS;

/** Knock the shield down (an axe blow). */
export function disableShield(s, ticks = DISABLE_TICKS) {
  s.cooldown = Math.max(s.cooldown, ticks);
  s.age = 0;
}

/** Does this attacker's blow knock a shield down? Axes do (in a mob's hand or a player's), as does a mob built for it. */
export function attackerDisablesShield(attacker) {
  if (!attacker) return false;
  if (attacker.def && attacker.def.axeBlows) return true;
  const hand = attacker.equip && attacker.equip.hand
    ? attacker.equip.hand
    : attacker.inventory && attacker.inventory.selectedStack ? attacker.inventory.selectedStack : null;
  const t = hand && ITEMS[hand.id] && ITEMS[hand.id].tool;
  return !!t && t.type === 'axe';
}

/** Durability the shield loses for a blocked hit of `amount` damage (a parry costs nothing). */
export function shieldWear(amount, parry) {
  if (parry || amount < MIN_WEAR_DAMAGE) return 0;
  return 1 + Math.floor(amount);
}

/**
 * Everything a blocked hit does: wear, whether the shield is knocked down,
 * whether it was a parry, and how hard the attacker is thrown back and staggered.
 * `s` is the shield state (it is updated: an axe blow starts the cooldown).
 */
export function resolveBlock(s, amount, attacker) {
  const parry = isParry(s);
  const disabled = attackerDisablesShield(attacker);
  if (disabled) disableShield(s);
  return {
    parry, disabled,
    wear: disabled ? 0 : shieldWear(amount, parry),
    knock: parry ? KNOCK.parry : KNOCK.block,
    stun: parry && !disabled ? PARRY_STUN : 0,
  };
}

/** HUD gauge for a knocked-down shield: null when it is up, else how far it has recovered (0..1). */
export function shieldGauge(s) {
  return s && s.cooldown > 0 ? 1 - s.cooldown / DISABLE_TICKS : null;
}
