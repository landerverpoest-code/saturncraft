// A minimal stand-in for Game with just what saveGame() reads, so the tests (and the fixture saves) go through the real
// save code. Chunks follow the live layout: flat arrays with a revision counter for the pack cache.
import { CHUNK_VOLUME, cidx, MIN_Y } from '../../src/world/constants.js';
import { B } from '../../src/world/blocks.js';
import { chunkKey } from '../../src/world/world.js';
import { Seasons } from '../../src/world/seasons.js';
import { newStats } from '../../src/player/stats.js';

/** A small hilly chunk: stone, dirt, grass, a few ore blocks and a built wall, so the run-length data is not trivial. */
export function makeChunk(cx, cz, { rev = 1 } = {}) {
  const blocks = new Uint16Array(CHUNK_VOLUME), meta = new Uint8Array(CHUNK_VOLUME), light = new Uint8Array(CHUNK_VOLUME);
  const heightmap = new Int16Array(256);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    const h = 60 + ((x * 3 + z * 5 + cx * 7 + cz * 11) % 5);
    heightmap[x + z * 16] = h;
    for (let y = MIN_Y; y <= h; y++) {
      blocks[cidx(x, y, z)] = y === h ? B.GRASS : y > h - 3 ? B.DIRT : (x + y + z) % 29 === 0 ? B.COAL_ORE : B.STONE;
    }
    for (let y = h + 1; y < MIN_Y + 384; y++) light[cidx(x, y, z)] = 15;
  }
  for (let y = 61; y < 66; y++) blocks[cidx(3, y, 3)] = B.COBBLESTONE; // something a player built
  meta[cidx(3, 62, 3)] = 2;
  const colors = new Uint8Array(256 * 6).fill(120);
  return { cx, cz, blocks, meta, light, biomes: new Uint8Array(256).fill(1), colors, heightmap, modified: true, rev };
}

/** A game-like object saveGame(game) accepts. */
export function mockGame({ slot = 1, name = 'Fixture World', seed = 1234, ticks = 72000, chunkCoords = [[0, 0], [1, 0]], time = 6000 } = {}) {
  const chunks = new Map();
  for (const [cx, cz] of chunkCoords) chunks.set(chunkKey(cx, cz), makeChunk(cx, cz));
  const stats = { ...newStats(), ticks, blocksMined: 120, blocksPlaced: 80, kills: 7 };
  const player = {
    x: 8.5, y: 66, z: 8.5, yaw: 0.5, pitch: 0.1, health: 20, air: 300, spawn: { x: 8.5, y: 66, z: 8.5 }, bed: null,
    hunger: { food: 18, saturation: 4, exhaustion: 0.5 },
    inventory: { slots: Object.assign(new Array(36).fill(null), { 0: { id: B.COBBLESTONE, count: 12 } }), armor: [null, null, null, null], selected: 0 },
    xp: { level: 3, progress: 0.25, total: 30 }, gamemode: 'survival', flying: false, enchSeed: 12345, effects: [], reputation: {}, stats,
  };
  const furnaces = new Map([['5,61,5', { x: 5, y: 61, z: 5, input: null, fuel: null, output: null, burn: 0, cook: 0 }]]);
  const chests = new Map([['6,61,6', { x: 6, y: 61, z: 6, slots: new Array(27).fill(null) }]]);
  return {
    world: { saved: new Map(), chunks },
    player, saveSlot: slot, worldName: name, seed, time,
    settings: { daylightCycle: true, seasons: true, hostileMobs: true, fireworksHurtPlayers: false, worldEvents: true, difficulty: 'normal' },
    get difficulty() { return this.settings.difficulty; },
    spawner: { savedMobs: new Map(), generated: new Set([chunkKey(0, 0), chunkKey(1, 0)]), inhabited: new Map(), peddlerState: null },
    entities: { list: [] },
    furnaces, chests, signs: new Map([['4,62,4', ['Hello', '', '', '']]]), frames: new Map(), pots: new Map(), lecterns: new Map(), maps: new Map(),
    brewingStands: new Map(), hoppers: new Map(), dispensers: new Map(), proving: null,
    worldSpawn: { x: 8.5, y: 66, z: 8.5 }, worldEvents: null, seasons: new Seasons(), raids: null,
    weather: { save: () => ({ kind: 'clear', timer: 6000 }) }, milestones: { save: () => [] },
    dims: null, netPlayers: {}, social: null,
    allowCheats: true, worldType: 'normal', seedText: null, createdAt: 1700000000000, thumbnail: null,
  };
}
