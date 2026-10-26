// Monster spawner blocks (dungeons): active while a player is within 16
// blocks; every 200-800 ticks they try 4 spawns within 4 blocks, unless 6 of
// their kind are already close. Mobs need light 11 or lower and room to stand.
// Also rolls the loot of dungeon chests.
import { B, SOLID } from '../world/blocks.js';
import { I, DISCS } from '../world/items.js';
import { hollowCityLoot, LOOT_CITY, LOOT_SHIP } from '../world/dimensions/hollowCity.js';
import { VAULTS_CHEST } from '../world/provingLoot.js';
import { VAULTS_LOOT } from '../world/provingVaults.js';

export const SPAWNER_TYPES = ['shambler', 'rattler', 'skitterer'];
export const SPAWNER_RANGE = 16, SPAWN_COUNT = 4, MAX_NEARBY = 6;
export const SPAWN_DELAY = [200, 800];

export class SpawnerBlocks {
  constructor(game) {
    this.game = game;
    this.state = new Map(); // "x,y,z" -> ticks until the next spawn
  }

  tick() {
    const g = this.game, p = g.player;
    if (p.dead || !g.spawner.enabled) return;
    const pcx = Math.floor(p.x / 16), pcz = Math.floor(p.z / 16);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = g.world.getChunk(pcx + dx, pcz + dz);
      if (!c || !c.spawners || !c.spawners.size) continue;
      for (const k of c.spawners) {
        const [x, y, z] = k.split(',').map(Number);
        if ((x + 0.5 - p.x) ** 2 + (y + 0.5 - p.y) ** 2 + (z + 0.5 - p.z) ** 2 > SPAWNER_RANGE * SPAWNER_RANGE) continue;
        this.tickOne(x, y, z, k);
      }
    }
  }

  tickOne(x, y, z, k) {
    const g = this.game, w = g.world;
    if (Math.random() < 0.3) g.particles.flame(x + Math.random(), y + Math.random(), z + Math.random());
    let delay = this.state.get(k);
    if (delay === undefined) delay = 20;
    if (--delay > 0) { this.state.set(k, delay); return; }
    this.state.set(k, SPAWN_DELAY[0] + Math.floor(Math.random() * (SPAWN_DELAY[1] - SPAWN_DELAY[0])));
    if (g.settings && g.settings.hostileMobs === false) return;
    const type = SPAWNER_TYPES[w.getMeta(x, y, z) % SPAWNER_TYPES.length];
    let nearby = 0;
    for (const e of g.entities.list) {
      if (e.kind === 'mob' && e.type === type && !e.dead && Math.abs(e.x - x - 0.5) < 4.5 && Math.abs(e.y - y) < 4 && Math.abs(e.z - z - 0.5) < 4.5) nearby++;
    }
    for (let n = 0; n < SPAWN_COUNT && nearby < MAX_NEARBY; n++) {
      const sx = Math.floor(x + (Math.random() - Math.random()) * 4), sy = y + Math.floor(Math.random() * 3) - 1, sz = Math.floor(z + (Math.random() - Math.random()) * 4);
      if (!SOLID[w.getBlock(sx, sy - 1, sz)] || !g.spawner.canFit(type, sx, sy, sz)) continue;
      const l = w.getLight(sx, sy, sz);
      if (Math.max((l >> 4) - g.sky.state.skyDarken, l & 15) > 11) continue;
      g.spawner.spawnMob(type, sx + 0.5, sy, sz + 0.5);
      g.particles.smoke(sx + 0.5, sy + 0.5, sz + 0.5, 12, 1);
      nearby++;
    }
  }
}

// Dungeon chest loot: a few valuable rolls and three rolls of mob junk.
const LOOT_A = [
  [I.IRON_INGOT, 1, 4, 10], [I.GOLD_INGOT, 1, 4, 5], [I.BREAD, 1, 1, 20], [I.WHEAT, 1, 4, 20], [I.COAL, 1, 4, 15],
  [I.CINNABAR, 1, 4, 15], [I.BUCKET, 1, 1, 10], [I.CARROT, 1, 3, 10], [I.DIAMOND, 1, 2, 3], [I.IRON_CHESTPLATE, 1, 1, 2], [I.GILDED_APPLE, 1, 1, 15], [I.NAME_TAG, 1, 1, 20], [I.LEAD, 1, 1, 10], ...DISCS.map((id) => [id, 1, 1, 2]),
];
const LOOT_B = [[I.BONE, 1, 8, 10], [I.GUNPOWDER, 1, 8, 10], [I.ROTTEN_FLESH, 1, 8, 10], [I.STRING, 1, 8, 10]];

function pick(table, rng) {
  let total = 0;
  for (const e of table) total += e[3];
  let r = rng() * total;
  for (const e of table) { if ((r -= e[3]) < 0) return e; }
  return table[table.length - 1];
}

/** 27 chest slots filled with dungeon loot at random positions. */
// Structure loot (chest meta bits 4-7): [table, rolls min, rolls max, always?] per structure
// (`always`: [id, min, max] stacks every such chest holds besides its rolls)
export const LOOT = { DEEP_HUSH: 12, DUNGEON: 0, MINESHAFT: 1, DESERT: 2, JUNGLE: 3, IGLOO: 4, WRECK: 5, OUTPOST: 6, RUIN: 7, WRECK_TREASURE: 8, WRECK_MAP: 9, HOLLOW_CITY: LOOT_CITY, HOLLOW_SHIP: LOOT_SHIP };
const STRUCTURE_LOOT = {
  [LOOT.MINESHAFT]: [[[I.GILDED_APPLE, 1, 1, 20], [I.IRON_INGOT, 1, 5, 10], [I.GOLD_INGOT, 1, 3, 5], [I.CINNABAR, 4, 9, 5], [I.AZURITE, 4, 9, 5], [I.DIAMOND, 1, 2, 3], [I.COAL, 3, 8, 10], [I.BREAD, 1, 3, 15], [B.RAIL, 4, 8, 20], [I.MELON_SLICE, 2, 4, 10], [I.PUMPKIN_PIE, 1, 2, 5], [I.IRON_PICKAXE, 1, 1, 2]], 3, 6],
  [LOOT.DESERT]: [[[I.GILDED_APPLE, 1, 1, 20], [I.DIAMOND, 1, 3, 5], [I.IRON_INGOT, 1, 5, 15], [I.GOLD_INGOT, 2, 7, 15], [I.BERYL, 1, 3, 15], [I.BONE, 4, 6, 25], [I.SPIDER_EYE, 1, 3, 25], [I.ROTTEN_FLESH, 3, 7, 25], [I.SADDLE, 1, 1, 20], [I.GOLD_CHESTPLATE, 1, 1, 3]], 2, 5],
  [LOOT.JUNGLE]: [[[I.DIAMOND, 1, 3, 3], [I.IRON_INGOT, 1, 5, 10], [I.GOLD_INGOT, 2, 7, 15], [I.BERYL, 1, 3, 2], [I.BONE, 4, 6, 20], [I.ROTTEN_FLESH, 3, 7, 16], [I.SADDLE, 1, 1, 3], [I.COCOA_BEANS, 2, 5, 10]], 2, 6],
  [LOOT.IGLOO]: [[[I.GILDED_APPLE, 1, 1, 1], [I.APPLE, 1, 3, 15], [I.COAL, 1, 4, 15], [I.GOLD_INGOT, 1, 1, 1], [I.STONE_AXE, 1, 1, 2], [I.ROTTEN_FLESH, 1, 1, 10], [I.WHEAT, 2, 3, 10], [I.BERYL, 1, 1, 1], [I.GLASS_VIAL, 1, 2, 4]], 2, 8, [[I.GILDED_APPLE, 1, 1]]],
  [LOOT.OUTPOST]: [[[I.WHEAT, 3, 5, 7], [I.POTATO, 2, 5, 5], [I.CARROT, 3, 5, 5], [I.ARROW, 2, 7, 4], [I.IRON_INGOT, 1, 3, 3], [I.STRING, 1, 6, 4], [I.BOW, 1, 1, 2], [I.CROSSBOW, 1, 1, 2], [B.DARK_OAK_LOG, 2, 3, 10]], 2, 4],
  [LOOT.RUIN]: [[[I.GILDED_APPLE, 1, 1, 15], [B.OBSIDIAN, 1, 2, 40], [I.FLINT, 1, 4, 40], [I.GOLD_NUGGET, 4, 24, 15], [I.FLINT_AND_STEEL, 1, 1, 40], [I.GOLD_INGOT, 2, 8, 15], [I.GILDED_CARROT, 4, 12, 15], [I.GILDED_MELON_SLICE, 4, 12, 5], [I.GOLD_SWORD, 1, 1, 15], [I.GOLD_PICKAXE, 1, 1, 15], [I.GOLD_HELMET, 1, 1, 15], [I.GOLD_CHESTPLATE, 1, 1, 15], [I.GOLD_BOOTS, 1, 1, 15], [B.GOLD_BLOCK, 1, 2, 1]], 4, 8],
  // shipwreck holds: supplies in the bow, treasure under the stern, charts in the stern cabin
  [LOOT.WRECK]: [[[I.PAPER, 1, 12, 8], [I.COAL, 2, 8, 6], [I.WHEAT, 8, 21, 7], [I.CARROT, 4, 8, 7], [I.POTATO, 2, 6, 7], [I.BREAD, 1, 4, 7], [I.DRIED_KELP, 2, 8, 5], [I.PUMPKIN_PIE, 1, 2, 3], [I.ROTTEN_FLESH, 5, 24, 5], [I.LEATHER_HELMET, 1, 1, 3], [I.LEATHER_CHESTPLATE, 1, 1, 3], [B.TNT, 1, 2, 1], [I.NAME_TAG, 1, 1, 3]], 3, 8],
  [LOOT.WRECK_TREASURE]: [[[I.IRON_INGOT, 1, 5, 90], [I.GOLD_INGOT, 1, 5, 10], [I.IRON_NUGGET, 1, 10, 50], [I.GOLD_NUGGET, 1, 10, 50], [I.BERYL, 1, 5, 40], [I.DIAMOND, 1, 1, 5], [I.AZURITE, 1, 10, 20]], 3, 6, [[I.BERYL, 1, 3]]],
  [LOOT.WRECK_MAP]: [[[I.PAPER, 1, 10, 20], [I.FEATHER, 1, 5, 10], [I.BOOK, 1, 5, 5], [I.CLOCK, 1, 1, 1], [I.COMPASS, 1, 1, 1], [I.EMPTY_MAP, 1, 1, 10]], 3, 6, [[I.EMPTY_MAP, 1, 1]]],
  // the ruins of the Deep Hush (world/deepHush.js HUSH_LOOT)
  [LOOT.DEEP_HUSH]: [[[I.HUSH_SHARD, 1, 3, 12], [B.CANDLE, 1, 4, 15], [I.BONE, 2, 6, 15], [I.IRON_INGOT, 1, 4, 10], [I.AZURITE, 2, 6, 8], [I.DIAMOND, 1, 2, 4], [I.GILDED_APPLE, 1, 1, 3], [I.GOLD_INGOT, 1, 3, 6], [B.HUSHMOSS, 4, 10, 8], [I.DISC_HOLLOW, 1, 1, 2]], 3, 7],
};

// the store rooms and galleries of the Proving Vaults (world/provingVaults.js)
LOOT.PROVING_VAULTS = VAULTS_LOOT;
STRUCTURE_LOOT[VAULTS_LOOT] = VAULTS_CHEST;

export function dungeonLoot(rng = Math.random, kind = LOOT.DUNGEON) {
  if (kind === LOOT.HOLLOW_CITY || kind === LOOT.HOLLOW_SHIP) return hollowCityLoot(rng, kind === LOOT.HOLLOW_SHIP); // enchanted gear, Voidwing
  const items = [];
  const t = STRUCTURE_LOOT[kind];
  if (t) {
    const [table, a, b, always = []] = t;
    for (const e of always) if (e[0] !== undefined) items.push(e);
    for (let k = 0, n = a + Math.floor(rng() * (b - a + 1)); k < n; k++) items.push(pick(table.filter((e) => e[0] !== undefined), rng));
  } else {
    const rollsA = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < rollsA; k++) items.push(pick(LOOT_A, rng));
    for (let k = 0; k < 3; k++) items.push(pick(LOOT_B, rng));
  }
  const slots = new Array(27).fill(null);
  for (const [id, min, max] of items) {
    let s;
    do s = Math.floor(rng() * 27); while (slots[s]);
    slots[s] = { id, count: min + Math.floor(rng() * (max - min + 1)), damage: 0 };
  }
  return slots;
}

