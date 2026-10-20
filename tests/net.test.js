import { describe, it, expect } from 'vitest';
import {
  makeRoomCode, normalizeRoomCode, peerIdFor, defaultPlayerName, cleanName,
  encodeMessage, Reassembler, encodeTyped, decodeTyped, encodePackedChunk, decodePackedChunk,
  EditBuffer, iterEdits, packPlayerState, unpackPlayerState, packMob, unpackMob,
} from '../src/net/protocol.js';
import { EditSync, validEdit } from '../src/net/editSync.js';
import { memoryPair } from '../src/net/transport.js';
import { World, chunkKey } from '../src/world/world.js';
import { B } from '../src/world/blocks.js';
import { CHUNK_VOLUME, cidx } from '../src/world/constants.js';
import { packChunk, unpackChunk } from '../src/world/save.js';
import { rng } from './helpers.js';

function flatChunk() {
  const blocks = new Uint8Array(CHUNK_VOLUME), light = new Uint8Array(CHUNK_VOLUME), heightmap = new Int16Array(256).fill(63);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
    for (let y = -64; y < 63; y++) blocks[cidx(x, y, z)] = B.STONE;
    blocks[cidx(x, 63, z)] = B.GRASS;
    for (let y = 64; y < 320; y++) light[cidx(x, y, z)] = 0xf0;
  }
  return { blocks, meta: new Uint8Array(CHUNK_VOLUME), light, biomes: new Uint8Array(256).fill(3), colors: new Uint8Array(256 * 6), heightmap };
}
function flatWorld(r = 1) {
  const w = new World(1);
  for (let cx = -r; cx <= r; cx++) for (let cz = -r; cz <= r; cz++) w.addChunk(cx, cz, flatChunk());
  return w;
}

describe('room codes and names', () => {
  it('makes six-character codes without look-alike characters', () => {
    const r = rng(3);
    for (let i = 0; i < 50; i++) expect(makeRoomCode(r)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
  it('normalises typed codes, prefixed ids and join links', () => {
    expect(normalizeRoomCode(' abc234 ')).toBe('ABC234');
    expect(normalizeRoomCode('saturncraft-XYZ789')).toBe('XYZ789');
    expect(normalizeRoomCode('https://example.org/game/?join=QWE456&net=local')).toBe('QWE456');
    expect(normalizeRoomCode('')).toBe(null);
    expect(normalizeRoomCode('ab')).toBe(null);
    expect(peerIdFor('ABC234')).toBe('saturncraft-ABC234');
  });
  it('defaults names to Player-XXXX and cleans what is typed', () => {
    expect(defaultPlayerName(rng(1))).toMatch(/^Player-\d{4}$/);
    expect(cleanName('  <b>Ann</b>  ')).toBe('bAnnb');
    expect(cleanName('')).toBe('Player');
    expect(cleanName('x'.repeat(40)).length).toBe(16);
  });
});

describe('message framing', () => {
  it('sends small messages as one JSON string', () => {
    const parts = encodeMessage({ t: 'chat', m: 'hi' });
    expect(parts).toHaveLength(1);
    expect(new Reassembler().push(parts[0])).toEqual({ t: 'chat', m: 'hi' });
  });
  it('splits large messages into fragments and rebuilds them', () => {
    const big = { t: 'ck', data: 'x'.repeat(1000), list: Array.from({ length: 300 }, (_, i) => i) };
    const parts = encodeMessage(big, 100);
    expect(parts.length).toBeGreaterThan(10);
    const re = new Reassembler();
    let out = null;
    for (const p of parts) { const m = re.push(p); if (m) { expect(out).toBe(null); out = m; } }
    expect(out).toEqual(big);
  });
  it('keeps messages of different fragment streams apart', () => {
    const a = encodeMessage({ t: 'a', s: 'a'.repeat(500) }, 64), b = encodeMessage({ t: 'b', s: 'b'.repeat(500) }, 64);
    const re = new Reassembler(), got = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) for (const p of [a[i], b[i]]) if (p) { const m = re.push(p); if (m) got.push(m.t); }
    expect(got.sort()).toEqual(['a', 'b']);
  });
  it('ignores garbage', () => {
    const re = new Reassembler();
    expect(re.push('{not json')).toBe(null);
    expect(re.push(42)).toBe(null);
  });
  it('round-trips through an in-memory connection pair', async () => {
    const [a, b] = memoryPair();
    const re = new Reassembler(), got = [];
    b.onData = (s) => { const m = re.push(s); if (m) got.push(m); };
    const msg = { t: 'ed', e: Array.from({ length: 5000 }, (_, i) => i % 300) };
    for (const s of encodeMessage(msg, 1000)) a.send(s);
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toEqual([msg]);
    let closed = false;
    b.onClose = () => { closed = true; };
    a.close();
    expect(closed).toBe(true);
  });
});

describe('binary data', () => {
  it('round-trips typed arrays through base64', () => {
    const u8 = Uint8Array.from([0, 1, 2, 255, 128]);
    const i16 = Int16Array.from([-64, 0, 319, -1]);
    expect(Array.from(decodeTyped(encodeTyped(u8)))).toEqual(Array.from(u8));
    const back = decodeTyped(JSON.parse(JSON.stringify(encodeTyped(i16))));
    expect(back).toBeInstanceOf(Int16Array);
    expect(Array.from(back)).toEqual(Array.from(i16));
  });
  it('sends an edited chunk the way the save file stores it', () => {
    const c = flatChunk();
    c.blocks[cidx(3, 70, 4)] = B.OAK_PLANKS;
    c.meta[cidx(3, 70, 4)] = 2;
    const wire = JSON.parse(JSON.stringify(encodePackedChunk(packChunk(c))));
    const back = unpackChunk(decodePackedChunk(wire));
    expect(back.modified).toBe(true);
    expect(back.blocks[cidx(3, 70, 4)]).toBe(B.OAK_PLANKS);
    expect(back.meta[cidx(3, 70, 4)]).toBe(2);
    expect(Array.from(back.heightmap)).toEqual(Array.from(c.heightmap));
    expect(back.light.length).toBe(CHUNK_VOLUME);
  });
});

describe('snapshots', () => {
  it('packs and unpacks player state', () => {
    const p = { x: 1.234, y: 64, z: -5.5, yaw: 3.14159, pitch: -0.5, sneaking: true, dead: false, sleeping: false, creative: true, hurtTime: 3, riding: null };
    const s = unpackPlayerState(JSON.parse(JSON.stringify(packPlayerState(p, 276, 7))));
    expect(s).toMatchObject({ x: 1.23, y: 64, z: -5.5, yaw: 3.14, pitch: -0.5, held: 276, sneaking: true, creative: true, hurt: true, dead: false, swing: 7 });
    expect(unpackPlayerState(packPlayerState(p, null, 0)).held).toBe(null);
    expect(unpackPlayerState(['x'])).toBe(null);
  });
  it('packs and unpacks mobs', () => {
    const m = { id: 1000005, type: 'fleecer', x: 10.5, y: 70, z: 3.333, yaw: 1, headPitch: 0, health: 6, hurtTime: 4, deathTime: 0, body: { onGround: true }, target: null, angry: false, age: -100, sheared: true, tamed: false, sitting: false, enemy: null, woolColor: 5, fuse: 0, profession: null };
    const s = unpackMob(JSON.parse(JSON.stringify(packMob(m))));
    expect(s).toMatchObject({ id: 1000005, type: 'fleecer', x: 10.5, z: 3.33, health: 6, hurtTime: 4, onGround: true, baby: true, sheared: true, woolColor: 5, profession: null });
  });
});

describe('block edit sync', () => {
  it('collects edits once per position, last one wins', () => {
    const b = new EditBuffer();
    b.add(1, 2, 3, B.STONE, 0); b.add(1, 2, 3, B.AIR, 0); b.add(4, 5, 6, B.DIRT, 1);
    expect(b.size).toBe(2);
    expect([...iterEdits(b.take())]).toEqual([[1, 2, 3, B.AIR, 0], [4, 5, 6, B.DIRT, 1]]);
    expect(b.take()).toEqual([]);
  });

  it('validates edits', () => {
    expect(validEdit(1, 64, 1, B.STONE, 0)).toBe(true);
    expect(validEdit(1, 400, 1, B.STONE, 0)).toBe(false);
    expect(validEdit(1, 64, 1, 9999, 0)).toBe(false);
    expect(validEdit(1.5, 64, 1, B.STONE, 0)).toBe(false);
  });

  it('a client sends only its player edits, and never echoes the host', () => {
    const w = flatWorld(0), sync = new EditSync(w, { host: false });
    w.setBlockUrgent(2, 64, 2, B.OAK_PLANKS);       // placed by the player
    w.setBlock(5, 64, 5, B.WATER);                   // world simulation: not sent
    const sent = [...iterEdits(sync.take())];
    expect(sent).toContainEqual([2, 64, 2, B.OAK_PLANKS, 0]);
    expect(sent).toContainEqual([2, 63, 2, B.DIRT, 0]);   // its consequence (grass under a block), also the player's doing
    expect(sent.some((e) => e[0] === 5)).toBe(false);
    sync.apply([7, 64, 7, B.COBBLESTONE, 0]);        // from the host
    expect(w.getBlock(7, 64, 7)).toBe(B.COBBLESTONE);
    expect(sync.take()).toEqual([]);
  });

  it('the host applies client edits (with their consequences) and rebroadcasts everything', () => {
    const host = flatWorld(0), client = flatWorld(0);
    const hs = new EditSync(host, { host: true }), cs = new EditSync(client, { host: false });
    host.setBlock(3, 64, 3, B.TALL_GRASS); client.setBlock(3, 64, 3, B.TALL_GRASS);
    hs.take(); cs.take();
    // the client digs out the grass block under the plant
    client.setBlockUrgent(3, 63, 3, B.AIR);
    const sent = cs.take();
    expect(client.getBlock(3, 64, 3)).toBe(B.AIR);   // the plant lost its support locally
    hs.apply(sent);
    expect(host.getBlock(3, 63, 3)).toBe(B.AIR);
    expect(host.getBlock(3, 64, 3)).toBe(B.AIR);
    const back = hs.take();
    const pos = [...iterEdits(back)].map((e) => e.slice(0, 3).join(','));
    expect(pos).toContain('3,63,3');
    // applying the broadcast on the client changes nothing and sends nothing
    cs.apply(back);
    expect(cs.take()).toEqual([]);
  });

  it('the host can veto edits (out of reach) and reports them', () => {
    const w = flatWorld(0), hs = new EditSync(w, { host: true });
    const bad = hs.apply([1, 64, 1, B.STONE, 0, 2, 64, 2, B.DIRT, 0], (x) => x === 1);
    expect(bad).toEqual([[2, 64, 2]]);
    expect(w.getBlock(1, 64, 1)).toBe(B.STONE);
    expect(w.getBlock(2, 64, 2)).toBe(B.AIR);
  });

  it('clients keep edits for chunks they have not loaded until they load', () => {
    const w = flatWorld(0), cs = new EditSync(w, { host: false });
    cs.apply([40, 64, 40, B.GLASS, 0]);
    expect(cs.pending.size).toBe(1);
    w.addChunk(2, 2, flatChunk());
    cs.onChunkLoaded(2, 2);
    expect(w.getBlock(40, 64, 40)).toBe(B.GLASS);
    expect(cs.pending.size).toBe(0);
    expect(cs.take()).toEqual([]);
  });

  it('the host writes edits in unloaded chunks into the stored chunk data', () => {
    const w = flatWorld(0), hs = new EditSync(w, { host: true });
    w.saved.set(chunkKey(3, 0), { ...flatChunk(), modified: true });
    hs.apply([50, 64, 5, B.GLASS, 0]);
    const d = w.saved.get(chunkKey(3, 0));
    expect(d.blocks[cidx(50 & 15, 64, 5)]).toBe(B.GLASS);
    expect(d.heightmap[(50 & 15) + 5 * 16]).toBe(64);
    expect([...iterEdits(hs.take())]).toEqual([[50, 64, 5, B.GLASS, 0]]); // still broadcast to the others
    w.addChunk(3, 0, null);
    expect(w.getBlock(50, 64, 5)).toBe(B.GLASS);
  });

  it('detaches from the world', () => {
    const w = flatWorld(0), cs = new EditSync(w, { host: false });
    cs.detach();
    w.setBlockUrgent(1, 64, 1, B.STONE);
    expect(cs.take()).toEqual([]);
  });
});
