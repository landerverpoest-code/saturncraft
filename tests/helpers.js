// Minimal block world for physics and fluid tests.
import { B, SOLID } from '../src/world/blocks.js';

export class MockWorld {
  constructor(floorY = 64) {
    this.floorY = floorY;
    this.blocks = new Map();
    this.meta = new Map();
  }
  key(x, y, z) { return `${x},${y},${z}`; }
  set(x, y, z, id, meta = 0) { this.blocks.set(this.key(x, y, z), id); this.meta.set(this.key(x, y, z), meta); }
  getBlock(x, y, z) {
    const k = this.key(x, y, z);
    if (this.blocks.has(k)) return this.blocks.get(k);
    return y < this.floorY ? B.STONE : B.AIR;
  }
  getMeta(x, y, z) { return this.meta.get(this.key(x, y, z)) || 0; }
  boxCollides(minX, minY, minZ, maxX, maxY, maxZ) {
    for (let x = Math.floor(minX); x <= Math.floor(maxX - 1e-7); x++)
      for (let y = Math.floor(minY); y <= Math.floor(maxY - 1e-7); y++)
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ - 1e-7); z++)
          if (SOLID[this.getBlock(x, y, z)]) return true;
    return false;
  }
}

/** Seeded RNG for statistical tests. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
