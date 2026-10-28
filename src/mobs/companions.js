// Companion animals: tameable animals other than Howlers, Purrlings, Squawklets and Gallopers.
// A mob type opts in with `companion: { tameFood: [item ids], perk }` (plus `tamedHealth` and
// `tamedAttack`) on its definition:
//   * Vixling (fox):     sneak up and offer sweet or glow berries (1 in 3). Perk 'forager': now and
//                        then, while it trots along by its owner, it digs up a small gift.
//   * Cragbuck (goat):   offer bread (1 in 3). Perk 'guard': it rams monsters that come within
//                        reach of its owner (3 damage and a good shove).
// A tame companion sits and stands on a right-click (empty hand, owner only), follows its owner
// (teleporting when over 12 blocks behind), fights what hurt the owner or what the owner hit, heals
// and breeds with its usual food (young of tame parents are tame and keep the owner), and is saved
// with its chunk (tamed, sitting, ownerName and the gift timer). Mobs are simulated by the host, so
// in multiplayer the host runs all of this; guests see the tamed / sitting / baby flags in the mob
// snapshot, tame by right-clicking (the host decides) and become the owner. Pure rules are exported
// for the tests.
import { CATEGORY } from './mobTypes.js';
import { I } from '../world/items.js';

export const TAME_CHANCE = 1 / 3;        // per offered item
export const FOLLOW_DISTANCE = 6;        // walk to the owner beyond this
export const TELEPORT_DISTANCE = 12;     // jump to the owner beyond this
export const GUARD_RADIUS = 10;          // guard perk: monsters this close to the owner draw a Cragbuck
export const GUARD_LEASH = 16;           // ... and this close to the Cragbuck itself
export const RAM_COOLDOWN = 40;
export const GIFT_DELAY = [6000, 6000];  // forager perk: 5-10 minutes between gifts [base, spread]
export const GIFT_RANGE = 8;             // the owner must be this close for a gift

/** Is this a mob type that can be tamed as a companion? */
export const isCompanion = (def) => !!(def && def.companion);

/** Can this item win over a wild animal of this definition? */
export const canTameWith = (def, itemId) => !!(def && def.companion && def.companion.tameFood.includes(itemId));

/** Items that heal or please a tame companion: its usual food and its taming food. */
export function companionFoods(def) {
  return [...(def.food || []), ...(def.companion ? def.companion.tameFood : [])];
}

/** Ticks until the next gift (a fresh Vixling gets its first one after the same delay). */
export const nextGiftDelay = (rng = Math.random) => GIFT_DELAY[0] + Math.floor(rng() * GIFT_DELAY[1]);

/** What a forager digs up: [item id, weight]. */
export const GIFTS = [
  [I.SWEET_BERRIES, 3], [I.FEATHER, 3], [I.RABBIT_HIDE, 3], [I.BONE, 2], [I.APPLE, 2], [I.GLOW_BERRIES, 1], [I.RAW_RABBIT, 1],
];

/** One gift stack (weighted pick). */
export function pickGift(rng = Math.random) {
  const total = GIFTS.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of GIFTS) { r -= w; if (r < 0) return { id, count: 1 }; }
  return { id: GIFTS[0][0], count: 1 };
}

/**
 * May a companion fight this mob-like thing? Never other pets, guards, settlers, bosses, mobs that
 * cannot be reached, Fizzlers (they blow up) or neutral mobs that are best left alone.
 */
export function canFight(self, e) {
  if (!e || e === self || e.isPlayer || e.dead || e.removed || (e.deathTime | 0) > 0) return false;
  const d = e.def;
  if (!d || e.tamed || e.kind !== 'mob') return false;
  if (d.villager || d.guard || d.snowGolem || d.boss || d.explosive || d.neutral || d.noclip || d.flying) return false;
  return true;
}

/**
 * Should a Cragbuck's guard perk go for this mob? Hostile, close to both the owner and the goat.
 * `owner` and `self` are positions with x, y, z.
 */
export function guardWants(self, owner, e) {
  if (!canFight(self, e) || e.def.category !== CATEGORY.MONSTER) return false;
  const near = (a, b, r) => Math.hypot(a.x - b.x, a.z - b.z) <= r && Math.abs(a.y - b.y) <= 4;
  return near(e, owner, GUARD_RADIUS) && near(e, self, GUARD_LEASH);
}

/** Pick what to fight: whatever hurt the owner, then whatever the owner hit, then (guard perk) the nearest monster. */
export function pickFoe(self, owner, entities, alive = () => true) {
  for (const e of [owner.lastHurtBy, owner.lastAttacked]) if (canFight(self, e) && alive(e)) return e;
  if (self.def.companion && self.def.companion.perk === 'guard') {
    let best = null, bd = Infinity;
    for (const e of entities) {
      if (!guardWants(self, owner, e) || !alive(e)) continue;
      const d = (e.x - self.x) ** 2 + (e.z - self.z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  return null;
}

/** An owner of a tame companion: the player it follows. In multiplayer `p` is already the owner (see net/session.js tickNear). */
export function ownerAlive(p) { return !!p && !p.dead; }

/** Can this player command the pet (sit / stand)? Only its owner; pets of the single-player game answer to everyone. */
export function mayCommand(mob, player) {
  return !(mob.ownerName && player.netName && mob.ownerName !== player.netName);
}

/** A bite or ram: the companion's damage to the thing it fights. Returns true if it landed. */
export function companionStrike(m, g, t) {
  const dx = t.x - m.x, dz = t.z - m.z;
  const reach = (m.width + (t.width || 0.6)) ** 2 + 0.6;
  if (dx * dx + dz * dz > reach || Math.abs(t.y - m.y) >= 1.5 || m.attackCooldown > 0) return false;
  const guard = m.def.companion.perk === 'guard';
  m.attackCooldown = guard ? RAM_COOLDOWN : 20;
  const dmg = (m.baby ? 0.5 : 1) * m.def.tamedAttack;
  t.hurt(dmg, 'mob:' + m.def.name, m, guard ? 1.1 : 0.4);
  if (guard) g.audio.play('ram', [m.x, m.y + 1, m.z]);
  else if (m.body.onGround) m.body.vy = 0.3; // the pounce
  return true;
}

const faceTowards = (m, x, z) => { m.yaw = Math.atan2(-(x - m.x), -(z - m.z)); };

/** The AI of a tame companion (Mob.ai calls it for `def.companion` mobs once they are tamed). */
export function companionAI(m, g, p, pdist) {
  const cfg = m.def.companion;
  if (m.age < 0) { if (++m.age === 0) m.setBaby(false); } else if (m.age > 0) m.age--;
  m.sleeping = false; m.panicTicks = 0; m.ram = null;
  m.headPitch = 0;
  const alive = (e) => e && !e.dead && !e.removed && e.deathTime === 0 && Math.hypot(e.x - m.x, e.z - m.z) < 24;
  if (m.enemy && (typeof m.enemy === 'string' || !alive(m.enemy))) m.enemy = null;
  if (ownerAlive(p) && !m.sitting && !m.enemy && g.ticks % 10 === m.id % 10) {
    m.enemy = pickFoe(m, p, g.entities.list, alive);
  }
  if (p.lastHurtBy && !alive(p.lastHurtBy)) p.lastHurtBy = null;
  if (m.sitting) { m.enemy = null; m.move = null; m.headPitch = pdist < 8 ? -0.2 : 0; return; }
  if (m.enemy) {
    m.chase(g, m.enemy, cfg.perk === 'guard' ? 1.7 : 1.3);
    if (cfg.perk === 'guard') m.headPitch = 0.5; // head down for the charge
    companionStrike(m, g, m.enemy);
    return;
  }
  if (m.loveTicks > 0) {
    m.loveTicks--;
    if (g.ticks % 10 === 0) m.hearts(g, 1);
    const mate = m.findMate(g);
    if (mate) {
      const d = Math.hypot(mate.x - m.x, mate.z - m.z);
      if (d > 1.2) m.steer(mate.x, mate.z, 1);
      if (d < 3 && ++m.breedTime >= 60 && m.id < mate.id) m.breed(g, mate);
      return;
    }
  }
  if (!ownerAlive(p)) { m.wanderAI(g, 0.8); return; }
  if (pdist > TELEPORT_DISTANCE) { if (m.teleportTo(g, p.x + (Math.random() - 0.5) * 3, p.z + (Math.random() - 0.5) * 3, p.y + 2)) return; }
  if (cfg.perk === 'forager') forage(m, g, p, pdist);
  if (pdist > FOLLOW_DISTANCE) { m.chase(g, p, 1.3); return; }
  if (m.tempted(g)) { faceTowards(m, p.x, p.z); m.headPitch = -0.3; return; }
  if (pdist < 2.5) { m.wander = null; m.path = null; return; }
  m.wanderAI(g, 0.8);
}

/** The forager perk: a gift now and then, laid at the owner's feet. */
function forage(m, g, p, pdist) {
  if (m.baby || pdist > GIFT_RANGE || !m.body.onGround) return;
  if (m.giftIn === undefined) m.giftIn = nextGiftDelay();
  if (--m.giftIn > 0) return;
  m.giftIn = nextGiftDelay();
  const d = Math.hypot(p.x - m.x, p.z - m.z) || 1;
  g.entities.spawnItem(m.x, m.y + 0.5, m.z, pickGift(), [(p.x - m.x) / d * 0.12, 0.18, (p.z - m.z) / d * 0.12]);
  m.hearts(g, 3, true);
  g.audio.play(m.def.sound, [m.x, m.y + 0.5, m.z], 0.6);
}

/** Hooks for the mob definitions: the gift timer survives a save. */
export const companionSave = (m) => (m.giftIn !== undefined && m.def.companion.perk === 'forager' ? { giftIn: m.giftIn | 0 } : {});
export const companionLoad = (m, s) => { if (Number.isFinite(s.giftIn)) m.giftIn = Math.max(1, Math.min(GIFT_DELAY[0] + GIFT_DELAY[1], s.giftIn | 0)); };
