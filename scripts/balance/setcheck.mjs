// Armour set bonuses against the protection cap: the strongest case (a full diamond set with Bulwark IV on every piece).
import { protectionReduce } from '../../src/world/enchantments.js';
import { bonusFor } from '../../src/player/setBonuses.js';

/** Fraction of a blow still taken in a four-piece set of `set` with `bulwark` Bulwark points (4 pieces of IV = 16). */
export function setBonusProtect(set, bulwark = 0) {
  const b = bonusFor(set, 4);
  return protectionReduce(1, bulwark + (b.protect || 0));
}
