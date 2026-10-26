// The Cinderdeep: a cavern world between a bedrock floor (y 0) and a bedrock
// ceiling (y 127). Open caverns of Cinderstone over a lava sea (y <= 31),
// Mournsand and gravel shores, Glowshard clusters hanging from the ceiling,
// Emberquartz veins, ever-burning fires and the occasional Ember Bastion: a
// long bridge of Scorched Bricks on pillars with an Ember Lord spawner.
import { B } from '../blocks.js';
import { Simplex, hash4, hashf, mulberry32 } from '../noise.js';
import { CHUNK_VOLUME, cidx } from '../constants.js';

export const CINDER_FLOOR = 0, CINDER_CEILING = 127, CINDER_LAVA = 31;
const GH = 4, GV = 8, NY = 128 / GV + 1; // density grid spacing (horizontal, vertical)
export const BASTION_REGION = 256;
const BASTION_HALF = 48;
export const EMBER_LORD_SPAWNER_META = 3; // index into SPAWNER_TYPES (see mobs/dimensionMobs.js)

export class CinderdeepGenerator {
  constructor(seed) {
    this.seed = seed | 0;
    this.dimension = 'cinderdeep';
    const s = (k) => new Simplex(hash4(this.seed, k, 6661, 13));
    this.nCave = s(1); this.nDetail = s(2); this.nPatch = s(3); this.nPatch2 = s(4);
  }

  /** Solid when > 0. Caverns in the middle, solid towards floor and ceiling. */
  density(x, y, z) {
    let d = this.nCave.fbm3(x / 72, y / 44, z / 72, 3) * 1.1 + this.nDetail.noise3(x / 22, y / 14, z / 22) * 0.28;
    if (y < 34) d += ((34 - y) / 22) ** 1.5 * 0.9;
    if (y > 92) d += ((y - 92) / 30) ** 1.4 * 1.3;
    return d - 0.12;
  }

  generate(cx, cz) {
    const blocks = new Uint16Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(256).fill(8);
    const colors = new Uint8Array(256 * 6);
    for (let i = 0; i < 256; i++) colors.set([110, 160, 70, 80, 140, 50], i * 6);
    const heightmap = new Int16Array(256);
    const x0 = cx * 16, z0 = cz * 16;

    // 1. density grid + trilinear interpolation
    const grid = new Float32Array(5 * 5 * NY);
    for (let i = 0; i < 5; i++) for (let k = 0; k < 5; k++) for (let j = 0; j < NY; j++) {
      grid[(i * 5 + k) * NY + j] = this.density(x0 + i * GH, j * GV, z0 + k * GH);
    }
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const ix = x >> 2, iz = z >> 2, tx = (x & 3) / 4, tz = (z & 3) / 4;
      const b00 = (ix * 5 + iz) * NY, b10 = ((ix + 1) * 5 + iz) * NY, b01 = (ix * 5 + iz + 1) * NY, b11 = ((ix + 1) * 5 + iz + 1) * NY;
      for (let y = CINDER_FLOOR; y <= CINDER_CEILING; y++) {
        const fy = y / GV, j = Math.min(NY - 2, Math.floor(fy)), ty = fy - j;
        const n0 = (grid[b00 + j] * (1 - tx) + grid[b10 + j] * tx) * (1 - tz) + (grid[b01 + j] * (1 - tx) + grid[b11 + j] * tx) * tz;
        const n1 = (grid[b00 + j + 1] * (1 - tx) + grid[b10 + j + 1] * tx) * (1 - tz) + (grid[b01 + j + 1] * (1 - tx) + grid[b11 + j + 1] * tx) * tz;
        const v = n0 + (n1 - n0) * ty;
        blocks[cidx(x, y, z)] = v > 0 ? B.CINDERSTONE : y <= CINDER_LAVA ? B.LAVA : B.AIR;
      }
    }

    // 2. surfaces: Mournsand / gravel shores and valleys
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z;
      const p = this.nPatch.noise2(wx / 28, wz / 28), q = this.nPatch2.noise2(wx / 13, wz / 13);
      for (let y = CINDER_LAVA - 3; y < CINDER_CEILING - 6; y++) {
        const i = cidx(x, y, z);
        if (blocks[i] !== B.CINDERSTONE) continue;
        const above = blocks[cidx(x, y + 1, z)];
        if (above !== B.AIR && above !== B.LAVA) continue;
        const shore = y <= CINDER_LAVA + 4;
        let mat = 0;
        if (p > 0.45 || (shore && p > 0.1)) mat = B.MOURNSAND;
        else if (q > 0.55 && shore) mat = B.GRAVEL;
        if (!mat) continue;
        const depth = 1 + Math.floor(hashf(this.seed, wx, y, wz) * 3);
        for (let d = 0; d < depth; d++) if (blocks[cidx(x, y - d, z)] === B.CINDERSTONE) blocks[cidx(x, y - d, z)] = mat;
      }
    }

    // 3. bedrock floor and ceiling
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const wx = x0 + x, wz = z0 + z;
      for (let y = 0; y <= 4; y++) if (y === 0 || hashf(this.seed, wx, y, wz) < (5 - y) / 5) blocks[cidx(x, y, z)] = B.BEDROCK;
      for (let y = 123; y <= 127; y++) if (y === 127 || hashf(this.seed, wx, y + 1000, wz) < (y - 122) / 5) blocks[cidx(x, y, z)] = B.BEDROCK;
    }

    const rng = mulberry32(hash4(this.seed, cx, cz, 77));
    // 4. Emberquartz veins (16 per chunk, about 14 blocks each)
    for (let k = 0; k < 16; k++) {
      let x = Math.floor(rng() * 16), y = 10 + Math.floor(rng() * 108), z = Math.floor(rng() * 16);
      for (let n = 0; n < 10; n++) {
        if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 4 && y < 123 && blocks[cidx(x, y, z)] === B.CINDERSTONE) blocks[cidx(x, y, z)] = B.EMBERQUARTZ_ORE;
        const r = rng();
        if (r < 0.33) x += rng() < 0.5 ? 1 : -1; else if (r < 0.66) z += rng() < 0.5 ? 1 : -1; else y += rng() < 0.5 ? 1 : -1;
      }
    }

    // 5. Glowshard clusters hanging from ceilings
    const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let k = 0; k < 4; k++) {
      const sx = 1 + Math.floor(rng() * 14), sz = 1 + Math.floor(rng() * 14);
      // find the cave roof below a random height
      let sy = 60 + Math.floor(rng() * 62);
      while (sy > 40 && !(blocks[cidx(sx, sy, sz)] === B.AIR && blocks[cidx(sx, sy + 1, sz)] === B.CINDERSTONE)) sy--;
      if (sy <= 40) continue;
      blocks[cidx(sx, sy, sz)] = B.GLOWSHARD;
      for (let n = 0; n < 600; n++) {
        const x = sx + Math.floor(rng() * 7) - 3, y = sy - Math.floor(rng() * 9), z = sz + Math.floor(rng() * 7) - 3;
        if (x < 0 || x > 15 || z < 0 || z > 15 || y < 1 || blocks[cidx(x, y, z)] !== B.AIR) continue;
        let touching = 0;
        for (const [dx, dy, dz] of N6) {
          const xx = x + dx, zz = z + dz;
          if (xx >= 0 && xx < 16 && zz >= 0 && zz < 16 && blocks[cidx(xx, y + dy, zz)] === B.GLOWSHARD) touching++;
        }
        if (touching === 1) blocks[cidx(x, y, z)] = B.GLOWSHARD;
      }
    }

    // 6. ever-burning fires on Cinderstone
    for (let k = 0; k < 5; k++) {
      const x = Math.floor(rng() * 16), z = Math.floor(rng() * 16);
      for (let y = 32 + Math.floor(rng() * 80); y > CINDER_LAVA; y--) {
        if (blocks[cidx(x, y, z)] === B.AIR && blocks[cidx(x, y - 1, z)] === B.CINDERSTONE) { blocks[cidx(x, y, z)] = B.FIRE; break; }
      }
    }

    // 7. Ember Bastions
    this.stampBastions(blocks, meta, cx, cz);

    // 8. wild Cinderroot patches on open Mournsand (own random stream, so the rest of the terrain is unchanged)
    const rr = mulberry32(hash4(this.seed, cx, cz, 9173));
    if (rr() < 0.3) {
      const px = 2 + Math.floor(rr() * 12), pz = 2 + Math.floor(rr() * 12);
      for (let n = 0; n < 14; n++) {
        const x = px + Math.floor(rr() * 5) - 2, z = pz + Math.floor(rr() * 5) - 2;
        for (let y = CINDER_LAVA + 1; y < 110; y++) {
          if (blocks[cidx(x, y, z)] !== B.MOURNSAND || blocks[cidx(x, y + 1, z)] !== B.AIR) continue;
          if (rr() < 0.6) { blocks[cidx(x, y + 1, z)] = B.CINDERROOT; meta[cidx(x, y + 1, z)] = Math.floor(rr() * 4); }
          break;
        }
      }
    }

    // 9. scattered Blight Roses on open Cinderstone and Mournsand floors (own random stream too)
    const rb = mulberry32(hash4(this.seed, cx, cz, 6133));
    if (rb() < 0.18) {
      const px = 2 + Math.floor(rb() * 12), pz = 2 + Math.floor(rb() * 12);
      for (let n = 0; n < 8; n++) {
        const x = px + Math.floor(rb() * 5) - 2, z = pz + Math.floor(rb() * 5) - 2;
        for (let y = CINDER_LAVA + 1; y < 110; y++) {
          const floor = blocks[cidx(x, y, z)];
          if ((floor !== B.CINDERSTONE && floor !== B.MOURNSAND) || blocks[cidx(x, y + 1, z)] !== B.AIR) continue;
          if (rb() < 0.5) blocks[cidx(x, y + 1, z)] = B.BLIGHT_ROSE;
          break;
        }
      }
    }

    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      let y = CINDER_CEILING;
      while (y > 0 && !blocks[cidx(x, y, z)]) y--;
      heightmap[x + z * 16] = y;
    }
    return { blocks, meta, biomes, colors, heightmap };
  }

  /** The bastion of a 256x256 region, or null. Pure (seed only). */
  bastionInRegion(rx, rz) {
    const r = mulberry32(hash4(this.seed, rx, rz, 4711));
    if (r() > 0.6) return null;
    const axis = r() < 0.5 ? 'x' : 'z';
    const cx = rx * BASTION_REGION + 64 + Math.floor(r() * (BASTION_REGION - 128));
    const cz = rz * BASTION_REGION + 64 + Math.floor(r() * (BASTION_REGION - 128));
    const y = 58 + Math.floor(r() * 18);
    return { axis, cx, cz, y, half: BASTION_HALF };
  }

  /** Bastions whose bounding box touches the block area [x0,x1]x[z0,z1]. */
  bastionsNear(x0, z0, x1, z1) {
    const out = [];
    const R = BASTION_REGION;
    for (let rx = Math.floor((x0 - 64) / R); rx <= Math.floor((x1 + 64) / R); rx++)
      for (let rz = Math.floor((z0 - 64) / R); rz <= Math.floor((z1 + 64) / R); rz++) {
        const b = this.bastionInRegion(rx, rz);
        if (!b) continue;
        const bx0 = b.cx - (b.axis === 'x' ? b.half : 6), bx1 = b.cx + (b.axis === 'x' ? b.half : 6);
        const bz0 = b.cz - (b.axis === 'z' ? b.half : 6), bz1 = b.cz + (b.axis === 'z' ? b.half : 6);
        if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) continue;
        out.push(b);
      }
    return out;
  }

  stampBastions(blocks, meta, cx, cz) {
    const x0 = cx * 16, z0 = cz * 16;
    for (const b of this.bastionsNear(x0, z0, x0 + 15, z0 + 15)) {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const wx = x0 + x, wz = z0 + z;
        // along = distance along the bridge, across = offset from its centre line
        const along = b.axis === 'x' ? wx - b.cx : wz - b.cz, across = b.axis === 'x' ? wz - b.cz : wx - b.cx;
        if (Math.abs(along) > b.half) continue;
        const hub = Math.abs(along) <= 5 && Math.abs(across) <= 5;
        const w = hub ? 5 : 2;
        if (Math.abs(across) > w) continue;
        const y = b.y;
        const edge = Math.abs(across) === w;
        blocks[cidx(x, y, z)] = B.SCORCHED_BRICKS;
        for (let h = 1; h <= 5; h++) {
          if (blocks[cidx(x, y + h, z)] === B.BEDROCK) break;
          blocks[cidx(x, y + h, z)] = edge && h === 1 ? B.SCORCHED_BRICKS : B.AIR;
        }
        if (hub && edge && Math.abs(along) % 3 === 0) blocks[cidx(x, y + 2, z)] = B.SCORCHED_BRICKS;
        // pillars every 12 blocks (and under the hub) down to the ground or the lava
        if ((Math.abs(along) % 12 === 0 && Math.abs(across) <= 1) || (hub && Math.abs(across) <= 1 && Math.abs(along) <= 1)) {
          for (let yy = y - 1; yy > 0; yy--) {
            const id = blocks[cidx(x, yy, z)];
            if (id !== B.AIR && id !== B.LAVA) break;
            blocks[cidx(x, yy, z)] = B.SCORCHED_BRICKS;
          }
        }
        if (hub && along === 0 && across === 0) {
          blocks[cidx(x, y + 1, z)] = B.SPAWNER; meta[cidx(x, y + 1, z)] = EMBER_LORD_SPAWNER_META;
        }
        if (hub && along <= -2 && along >= -4 && across <= -2 && across >= -4) {
          // a planter of ripe Cinderroot in the hub
          blocks[cidx(x, y, z)] = B.MOURNSAND;
          blocks[cidx(x, y + 1, z)] = B.CINDERROOT; meta[cidx(x, y + 1, z)] = 3;
        }
        if (hub && along === 3 && across === 3) { blocks[cidx(x, y + 1, z)] = B.CHEST; meta[cidx(x, y + 1, z)] = 8; } // loot chest
      }
    }
  }

  /** Is (x, z) on or next to an Ember Bastion (for spawning)? */
  inBastion(x, y, z) {
    for (const b of this.bastionsNear(x, z, x, z)) {
      const along = b.axis === 'x' ? x - b.cx : z - b.cz, across = b.axis === 'x' ? z - b.cz : x - b.cx;
      if (Math.abs(along) <= b.half + 4 && Math.abs(across) <= 9 && Math.abs(y - b.y) < 12) return true;
    }
    return false;
  }
}
