// Monster spawner blocks (dungeons): active while a player is within 16
// blocks; every 200-800 ticks they try 4 spawns within 4 blocks, unless 6 of
// their kind are already close. Mobs need light 11 or lower and room to stand.
// Also rolls the loot of dungeon chests.
import { SOLID } from '../world/blocks.js';
import { I } from '../world/items.js';

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
  [I.CINNABAR, 1, 4, 15], [I.BUCKET, 1, 1, 10], [I.CARROT, 1, 3, 10], [I.DIAMOND, 1, 2, 3], [I.IRON_CHESTPLATE, 1, 1, 2],
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
export function dungeonLoot(rng = Math.random) {
  const items = [];
  const rollsA = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < rollsA; k++) items.push(pick(LOOT_A, rng));
  for (let k = 0; k < 3; k++) items.push(pick(LOOT_B, rng));
  const slots = new Array(27).fill(null);
  for (const [id, min, max] of items) {
    let s;
    do s = Math.floor(rng() * 27); while (slots[s]);
    slots[s] = { id, count: min + Math.floor(rng() * (max - min + 1)), damage: 0 };
  }
  return slots;
}

