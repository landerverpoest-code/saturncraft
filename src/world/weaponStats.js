// Stats of the melee weapons and Returning Discs added by the gear round. Pure data (no imports), read by
// world/items.js to register the items and by player/weapons.js for the rules, so the two cannot drift.
//
//  * Warhammer: slow and heavy. A full swing staggers the mob for STUN_TICKS and splinters a raised shield.
//  * Dagger:    fast and short. A blow from behind a mob (BACKSTAB_ARC) lands BACKSTAB_MULT times as hard.
//  * Glaive:    a long reach and a sweep: the arc round the target takes SWEEP_FRACTION of the blow, up to SWEEP_MAX more.
//  * Disc:      thrown; flies out, turns, flies back and is caught (see entities/disc.js). One in the air at a time.
// Per tier: damage at a full swing, attacks per second, durability. Tiers are stone / iron / diamond.
export const WEAPON_KINDS = {
  warhammer: {
    name: 'Warhammer', reach: 3.0, wear: 2, breaksShield: true,
    tiers: { stone: { damage: 8, attackSpeed: 0.6, durability: 180 }, iron: { damage: 10, attackSpeed: 0.65, durability: 320 }, diamond: { damage: 12, attackSpeed: 0.7, durability: 1500 } },
  },
  dagger: {
    name: 'Dagger', reach: 2.5, wear: 1,
    tiers: { stone: { damage: 2.8, attackSpeed: 2.8, durability: 110 }, iron: { damage: 3, attackSpeed: 3.0, durability: 220 }, diamond: { damage: 3.5, attackSpeed: 3.0, durability: 1300 } },
  },
  glaive: {
    name: 'Glaive', reach: 4.5, wear: 1,
    tiers: { stone: { damage: 5, attackSpeed: 0.95, durability: 150 }, iron: { damage: 6, attackSpeed: 1.0, durability: 270 }, diamond: { damage: 7.5, attackSpeed: 1.0, durability: 1400 } },
  },
  disc: {
    name: 'Returning Disc', reach: 3.0, wear: 1,
    tiers: { stone: { damage: 4, attackSpeed: 1, durability: 120 }, iron: { damage: 5, attackSpeed: 1, durability: 240 }, diamond: { damage: 7, attackSpeed: 1, durability: 1100 } },
  },
};
export const WEAPON_TIERS = ['stone', 'iron', 'diamond'];
export const TIER_NAMES = { stone: 'Stone', iron: 'Iron', diamond: 'Diamond' };

export const STUN_TICKS = 24;          // a Warhammer's full swing staggers a mob for 1.2 s
export const STUN_MIN_FRACTION = 0.85; // ... when the blow is at least this much of the weapon's full damage (a full swing)
export const BACKSTAB_MULT = 2.5;      // a Dagger from behind
export const BACKSTAB_ARC = 0.5;       // cosine between the mob's facing and the direction to the attacker: behind = below -BACKSTAB_ARC
export const SWEEP_FRACTION = 0.6;     // a Glaive's sweep: share of the blow the other mobs in the arc take
export const SWEEP_MAX = 3;            // ... and how many others at most
export const SWEEP_ARC = 0.55;         // cosine of the half-angle of the sweep cone round the look direction
export const SHIELD_BREAK_TICKS = 100; // a Warhammer knocks a player's shield down as long as an axe does

// Returning Disc flight (blocks per tick, blocks)
export const DISC_SPEED = 0.85;
export const DISC_RANGE = 12;
export const DISC_RANGE_PER_FARFLIGHT = 3;
export const DISC_CATCH_DIST = 1.6;
export const DISC_HIT_RADIUS = 0.9;
export const DISC_MAX_TICKS = 160;
