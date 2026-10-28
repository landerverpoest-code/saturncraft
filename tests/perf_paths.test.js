// The fast paths of the performance pass: chunk loading scans, light stitching on direct
// arrays, the reusable visibility walk and the renderer waiting for a chunk's whole mesh.
import { describe, it, expect } from 'vitest';
import { World, Chunk, chunkKey } from '../src/world/world.js';
import { computeChunkLight } from '../src/world/lighting.js';
import { floodVisible, ALL_OPEN } from '../src/world/visibility.js';
import { ChunkRenderer } from '../src/render/chunkRenderer.js';
import { B } from '../src/world/blocks.js';
import { CIRCUIT_SETTLE } from '../src/world/circuits.js';
import { CHUNK_VOLUME, SECTION_COUNT, cidx, MIN_Y } from '../src/world/constants.js';
import { rng } from './helpers.js';

function chunkData(fill) {
  const blocks = new Uint16Array(CHUNK_VOLUME);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = MIN_Y; y < MIN_Y + 384; y++) blocks[cidx(x, y, z)] = fill(x, y, z);
  const light = new Uint8Array(CHUNK_VOLUME);
  computeChunkLight(blocks, light);
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap: new Int16Array(256).fill(63) };
}

describe('chunk loading scan', () => {
  it('counts each section and finds spawners, beacons, proving spawners and circuit parts like a plain scan', () => {
    const r = rng(7);
    const circuit = [B.CINNABAR_WIRE, B.REPEATER, B.LEVER, B.PISTON].find((id) => id !== undefined && CIRCUIT_SETTLE[id]);
    const pick = [B.STONE, B.DIRT, B.SPAWNER, B.BEACON, B.PROVING_SPAWNER, circuit];
    const d = chunkData((x, y) => (y < 0 ? B.STONE : y < 40 && r() < 0.02 ? pick[Math.floor(r() * pick.length)] : y < 10 ? B.DIRT : 0));
    const c = new Chunk(2, -3, d);
    // reference: the straightforward two-pass scan
    const nonAir = new Uint16Array(SECTION_COUNT), spawners = new Set(), beacons = new Set(), provers = new Set(), circuits = new Set();
    const pos = (i) => `${2 * 16 + (i & 15)},${MIN_Y + (i >> 8)},${-3 * 16 + ((i >> 4) & 15)}`;
    for (let i = 0; i < CHUNK_VOLUME; i++) {
      const b = d.blocks[i];
      if (b) nonAir[i >> 12]++;
      if (b === B.SPAWNER) spawners.add(pos(i));
      else if (b === B.BEACON) beacons.add(pos(i));
      else if (b === B.PROVING_SPAWNER) provers.add(pos(i));
      else if (CIRCUIT_SETTLE[b]) circuits.add(i);
    }
    expect([...c.sectionNonAir]).toEqual([...nonAir]);
    expect(spawners.size).toBeGreaterThan(0);
    expect(circuits.size).toBeGreaterThan(0);
    expect([...c.spawners].sort()).toEqual([...spawners].sort());
    expect([...c.beacons].sort()).toEqual([...beacons].sort());
    expect([...c.provers].sort()).toEqual([...provers].sort());
    expect([...c.circuits]).toEqual([...circuits]);
    expect(c.dirty.size).toBe(SECTION_COUNT);
  });
});

describe('light stitching between chunks', () => {
  const ground = (x, y) => (y < 64 ? B.STONE : 0);
  it('a torch by the border lights the chunk loaded next to it as if both had been there', () => {
    // torch first, neighbour loaded afterwards (stitchChunk does the work)
    const a = new World(1);
    const withTorch = chunkData((x, y, z) => (x === 15 && y === 64 && z === 8 ? B.TORCH : ground(x, y)));
    a.addChunk(0, 0, withTorch);
    a.addChunk(1, 0, chunkData(ground));
    // both chunks first, then the torch placed normally
    const b = new World(1);
    b.addChunk(0, 0, chunkData(ground));
    b.addChunk(1, 0, chunkData(ground));
    b.setBlock(15, 64, 8, B.TORCH);
    expect(a.blockLight(16, 64, 8)).toBe(13);
    expect(a.blockLight(18, 64, 8)).toBe(11);
    for (let x = 10; x < 28; x++) for (let z = 0; z < 16; z++) for (let y = 62; y < 70; y++) expect(a.getLight(x, y, z)).toBe(b.getLight(x, y, z));
  });
});

describe('visibility walk', () => {
  it('gives the same answer when its buffers are reused with other radii', () => {
    const getVis = (cx, sy, cz) => (Math.abs(cx) + Math.abs(cz) > 5 ? -1 : sy < 8 ? 0 : ALL_OPEN);
    const walk = (r) => { const s = []; floodVisible(0, 12, 0, r, getVis, (x, y, z) => s.push(`${x},${y},${z}`)); return s.sort().join(' '); };
    const small = walk(2), big = walk(6);
    expect(walk(2)).toBe(small);
    expect(walk(6)).toBe(big);
    expect(walk(1).length).toBeLessThan(small.length);
  });
});

describe('chunk renderer', () => {
  it('waits for every section of a chunk before rebuilding it', () => {
    const r = { pendingMesh: new Map() }, c = { cx: 3, cz: -2 };
    const pending = (x) => ChunkRenderer.prototype.meshPending.call(r, x);
    expect(pending(c)).toBe(false);
    r.pendingMesh.set(chunkKey(4, -2) * 32 + 5, 1); // another chunk's job
    expect(pending(c)).toBe(false);
    r.pendingMesh.set(chunkKey(3, -2) * 32 + 23, 2);
    expect(pending(c)).toBe(true);
  });
});
