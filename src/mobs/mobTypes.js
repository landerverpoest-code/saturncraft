// Mob definitions. Stats mirror the documented values of the vanilla mob
// each one stands in for (listed in `role`), under Saturncraft's own names.
import { I } from '../world/items.js';
import { B } from '../world/blocks.js';

export const CATEGORY = { CREATURE: 'creature', MONSTER: 'monster', AMBIENT: 'ambient' };

export const MOBS = {
  bristleback: {
    name: 'Bristleback', role: 'pig', category: CATEGORY.CREATURE,
    health: 10, speed: 0.25, width: 0.9, height: 0.9, panicSpeed: 1.25, sound: 'oink',
    drops: [{ id: I.RAW_PORK, min: 1, max: 3, cooked: I.COOKED_PORK }], food: [I.CARROT, I.POTATO, I.BEETROOT],
  },
  mooxen: {
    name: 'Mooxen', role: 'cow', category: CATEGORY.CREATURE,
    health: 10, speed: 0.2, width: 0.9, height: 1.4, panicSpeed: 2.0, sound: 'moo',
    drops: [{ id: I.LEATHER, min: 0, max: 2 }, { id: I.RAW_BEEF, min: 1, max: 3, cooked: I.STEAK }], food: [I.WHEAT],
  },
  fleecer: {
    name: 'Fleecer', role: 'sheep', category: CATEGORY.CREATURE,
    health: 8, speed: 0.23, width: 0.9, height: 1.3, panicSpeed: 1.25, sound: 'baa',
    drops: [{ id: B.WOOL, min: 1, max: 1, notSheared: true }, { id: I.RAW_MUTTON, min: 1, max: 2, cooked: I.COOKED_MUTTON }], food: [I.WHEAT],
  },
  cluckling: {
    name: 'Cluckling', role: 'chicken', category: CATEGORY.CREATURE,
    health: 4, speed: 0.25, width: 0.4, height: 0.7, panicSpeed: 1.4, sound: 'cluck', noFallDamage: true,
    drops: [{ id: I.FEATHER, min: 0, max: 2 }, { id: I.RAW_CHICKEN, min: 1, max: 1, cooked: I.COOKED_CHICKEN }], food: [I.WHEAT_SEEDS, I.BEETROOT_SEEDS],
  },
  shambler: {
    name: 'Shambler', role: 'zombie', category: CATEGORY.MONSTER,
    health: 20, speed: 0.23, width: 0.6, height: 1.95, attack: 3, followRange: 35, armor: 2,
    burnsInSun: true, sound: 'grunt',
    drops: [{ id: I.ROTTEN_FLESH, min: 0, max: 2 }],
    // rare player-kill drop (2.5%): iron ingot, carrot or potato (no potatoes here)
    rare: { chance: 0.025, ids: [I.IRON_INGOT, I.CARROT, I.POTATO] },
  },
  rattler: {
    name: 'Rattler', role: 'skeleton', category: CATEGORY.MONSTER,
    health: 20, speed: 0.25, width: 0.6, height: 1.99, followRange: 16, ranged: true,
    burnsInSun: true, sound: 'rattle',
    drops: [{ id: I.ARROW, min: 0, max: 2 }, { id: I.BONE, min: 0, max: 2 }],
  },
  fizzler: {
    name: 'Fizzler', role: 'creeper', category: CATEGORY.MONSTER,
    health: 20, speed: 0.25, width: 0.6, height: 1.7, followRange: 16, explosive: true, sound: 'hiss',
    fuse: 30, explosionPower: 3,
    drops: [{ id: I.GUNPOWDER, min: 0, max: 2 }],
  },
  skitterer: {
    name: 'Skitterer', role: 'spider', category: CATEGORY.MONSTER,
    health: 16, speed: 0.3, width: 1.4, height: 0.9, attack: 2, followRange: 16, climbs: true, sound: 'skitter',
    drops: [{ id: I.STRING, min: 0, max: 2 }, { id: I.SPIDER_EYE, min: -1, max: 1, playerOnly: true }],
  },
  wobbler: {
    name: 'Wobbler', role: 'slime', category: CATEGORY.MONSTER, sound: 'squish', followRange: 16, noFallDamage: true,
    // size 1, 2 or 4 (set per mob): health size², attack = size (the small ones are harmless), 0.51 blocks per size
    health: 1, speed: 0.3, width: 0.51, height: 0.51, attack: 1,
    drops: [{ id: I.SLIMEBALL, min: 0, max: 2 }],
  },
  marauder: {
    name: 'Marauder', role: 'pillager', category: CATEGORY.MONSTER, raider: true,
    health: 24, speed: 0.35, width: 0.6, height: 1.95, followRange: 32, ranged: true, sound: 'hmm',
    drops: [{ id: I.ARROW, min: 0, max: 2 }, { id: I.BERYL, min: 0, max: 1, playerOnly: true }],
  },
  voidwalker: {
    name: 'Voidwalker', role: 'enderman', category: CATEGORY.MONSTER,
    health: 40, speed: 0.3, width: 0.6, height: 2.9, attack: 7, followRange: 64, neutral: true, sound: 'warble',
    drops: [{ id: I.VOID_PEARL, min: 0, max: 1 }],
  },
  howler: {
    name: 'Howler', role: 'wolf', category: CATEGORY.CREATURE, tameable: true,
    health: 8, tamedHealth: 20, speed: 0.3, width: 0.6, height: 0.85, attack: 2, tamedAttack: 4, sound: 'howl',
    drops: [], food: [I.RAW_PORK, I.COOKED_PORK, I.RAW_BEEF, I.STEAK, I.RAW_CHICKEN, I.COOKED_CHICKEN, I.RAW_MUTTON, I.COOKED_MUTTON, I.ROTTEN_FLESH],
  },
  purrling: {
    name: 'Purrling', role: 'cat', category: CATEGORY.CREATURE, tameable: true, feline: true, noFallDamage: true,
    health: 10, tamedHealth: 10, speed: 0.3, width: 0.6, height: 0.7, attack: 0, tamedAttack: 0, sound: 'mew', panicSpeed: 1.6,
    drops: [{ id: I.STRING, min: 0, max: 2 }], food: [I.RAW_SILVERFIN, I.RAW_REDFIN], tameFood: [I.RAW_SILVERFIN, I.RAW_REDFIN],
  },
  ironguard: {
    name: 'Ironguard', role: 'iron golem', category: CATEGORY.CREATURE, guard: true,
    health: 100, speed: 0.25, width: 1.4, height: 2.7, attack: 7, sound: 'clank', noFallDamage: true, knockbackResist: true,
    drops: [{ id: I.IRON_INGOT, min: 3, max: 5 }, { id: B.REDBLOOM, min: 0, max: 2 }],
  },
  galloper: {
    name: 'Galloper', role: 'horse', category: CATEGORY.CREATURE, rideable: true, sound: 'neigh',
    health: 22, speed: 0.225, width: 1.4, height: 1.6, panicSpeed: 1.4,
    drops: [{ id: I.LEATHER, min: 0, max: 2 }], food: [I.WHEAT, I.APPLE],
  },
  inkling: {
    name: 'Inkling', role: 'squid', category: CATEGORY.CREATURE, aquatic: true, sound: 'squish',
    health: 10, speed: 0.1, width: 0.8, height: 0.8, noFallDamage: true,
    drops: [{ id: I.INK_SAC, min: 1, max: 3 }],
  },
  flitter: {
    name: 'Flitter', role: 'bat', category: CATEGORY.AMBIENT, flying: true, noFallDamage: true, sound: 'squeak',
    health: 6, speed: 0.3, width: 0.5, height: 0.9, drops: [],
  },
  frostling: {
    name: 'Frostling', role: 'snow golem', category: CATEGORY.CREATURE, guard: true, snowGolem: true, sound: 'squish',
    health: 4, speed: 0.2, width: 0.7, height: 1.9, attack: 0, noFallDamage: true,
    drops: [{ id: I.SNOWBALL, min: 0, max: 15 }],
  },
  hopper: {
    name: 'Hopper', role: 'rabbit', category: CATEGORY.CREATURE, hops: true, sound: 'squeak',
    health: 3, speed: 0.3, width: 0.4, height: 0.5, panicSpeed: 2.2, noFallDamage: true,
    drops: [{ id: I.RAW_RABBIT, min: 0, max: 1, cooked: I.COOKED_RABBIT }, { id: I.RABBIT_HIDE, min: 0, max: 1 }], food: [I.CARROT, B.SUNPETAL],
  },
  frostbear: {
    name: 'Frostbear', role: 'polar bear', category: CATEGORY.CREATURE, neutralBeast: true, sound: 'grunt',
    health: 30, speed: 0.25, width: 1.4, height: 1.4, attack: 6,
    drops: [{ id: I.RAW_SALMON_BEAR, min: 0, max: 2 }],
  },
  vixling: {
    name: 'Vixling', role: 'fox', category: CATEGORY.CREATURE, fox: true, sound: 'squeak',
    health: 10, speed: 0.3, width: 0.6, height: 0.7, attack: 2, panicSpeed: 1.8,
    drops: [], food: [I.APPLE],
  },
  settler: {
    name: 'Settler', role: 'villager', category: CATEGORY.CREATURE, villager: true,
    health: 20, speed: 0.3, width: 0.6, height: 1.95, panicSpeed: 1.6, sound: 'hmm',
    drops: [],
  },
};

export const MOB_KEYS = Object.keys(MOBS);
