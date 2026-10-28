import { describe, it, expect, vi } from 'vitest';
import {
  JOB_SITES, isJobSite, jobSiteProfession, jobSiteBlock, findJobSite, claimedSites, takeJobSite, releaseJobSite, checkJobSite, cleanJobSite, siteKey, CLAIM_RADIUS,
} from '../src/mobs/jobSites.js';
import { Mob } from '../src/mobs/mob.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { craft } from '../src/player/crafting.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I, DYES, WOOL_ITEMS, ITEMS } from '../src/world/items.js';
import { COLOR_BLOCKS } from '../src/world/blocks.js';
import { CHUNK_VOLUME, cidx } from '../src/world/constants.js';
import { TerrainGenerator } from '../src/world/generator.js';
import { villageInRegion, houseJobSite, PROFESSIONS } from '../src/world/villages.js';
import { loomResult, loomAcceptsCloth, loomAcceptsDye, loomDyeColor } from '../src/world/workstations.js';
import { JOBSITE_TEX } from '../src/world/jobSiteTextures.js';

/** A world of empty chunks [cx0..cx1] x [cz0..cz1] with getChunk / getBlock / setBlock. */
class ChunkWorld {
  constructor(cx0 = -4, cz0 = -4, cx1 = 4, cz1 = 4) {
    this.chunks = new Map();
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) this.chunks.set(`${cx},${cz}`, { blocks: new Uint16Array(CHUNK_VOLUME) });
  }
  getChunk(cx, cz) { return this.chunks.get(`${cx},${cz}`); }
  getBlock(x, y, z) { const c = this.getChunk(x >> 4, z >> 4); return c ? c.blocks[cidx(x & 15, y, z & 15)] : 0; }
  setBlock(x, y, z, id) { this.getChunk(x >> 4, z >> 4).blocks[cidx(x & 15, y, z & 15)] = id; }
}

const settler = (x = 0.5, y = 64, z = 0.5) => new Mob('settler', x, y, z);
const fakeGame = (world, list = []) => ({ ticks: 0, time: 1000, world, entities: { list }, particles: { emit: vi.fn() } });

describe('job-site blocks', () => {
  it('every settler trade has a job-site block, and every block one trade', () => {
    expect(Object.keys(JOB_SITES).sort()).toEqual([...PROFESSIONS].sort());
    for (const p of PROFESSIONS) {
      expect(jobSiteBlock(p)).toBeGreaterThan(0);
      for (const id of JOB_SITES[p]) { expect(isJobSite(id)).toBe(true); expect(jobSiteProfession(id)).toBe(p); }
    }
    expect(jobSiteProfession(B.SMOKER_LIT)).toBe('butcher'); // a lit smoker is still the butcher's
    expect(jobSiteProfession(B.BLAST_FURNACE_LIT)).toBe('smith');
    expect(isJobSite(B.STONE)).toBe(false);
    expect(jobSiteBlock('nobody')).toBe(0);
  });

  it('the Loom and the Fletching Table are wooden blocks with textures and recipes', () => {
    for (const id of [B.LOOM, B.FLETCHING_TABLE]) {
      expect(BLOCKS[id]).toBeTruthy();
      expect(ITEMS[id]).toBeTruthy();
      for (const t of [BLOCKS[id].tex.top, BLOCKS[id].tex.side, BLOCKS[id].tex.front]) expect(JOBSITE_TEX[t]).toBeTypeOf('function');
    }
    const s = (id) => (id == null ? null : { id, count: 1 });
    const P = B.OAK_PLANKS;
    expect(craft([I.STRING, I.STRING, P, P].map(s), 2)).toEqual({ id: B.LOOM, count: 1 });
    expect(craft([I.FLINT, I.FLINT, null, P, P, null, P, P, null].map(s), 3)).toEqual({ id: B.FLETCHING_TABLE, count: 1 });
  });

  it('finds the nearest unclaimed job site within 48 blocks', () => {
    const w = new ChunkWorld();
    w.setBlock(10, 64, 0, B.LECTERN);
    w.setBlock(4, 65, 3, B.COMPOSTER);
    w.setBlock(50, 64, 0, B.LOOM); // too far
    const near = findJobSite(w, 0.5, 64, 0.5);
    expect(near).toEqual({ x: 4, y: 65, z: 3, profession: 'farmer' });
    expect(findJobSite(w, 0.5, 64, 0.5, new Set([siteKey(near)]))).toMatchObject({ x: 10, profession: 'librarian' });
    expect(findJobSite(w, 0.5, 64, 0.5, new Set(), { profession: 'librarian' })).toMatchObject({ x: 10 });
    expect(findJobSite(w, 0.5, 64, 0.5, new Set(), { profession: 'shepherd' })).toBe(null);
    expect(findJobSite(w, 30.5, 64, 0.5, new Set(), { profession: 'shepherd' })).toMatchObject({ x: 50, profession: 'shepherd' });
    expect(CLAIM_RADIUS).toBe(48);
    // far above or below is not looked at; blocks in chunks that are not loaded neither
    const w2 = new ChunkWorld(0, 0, 0, 0);
    w2.setBlock(2, 100, 2, B.LOOM);
    expect(findJobSite(w2, 0.5, 64, 0.5)).toBe(null);
    expect(findJobSite(w2, -20, 64, 0.5)).toBe(null);
  });

  it('claims: taking up a trade, losing it when the block goes unless traded with', () => {
    const m = settler();
    expect(m.profession).toBe(null);
    expect(takeJobSite(m, { x: 3, y: 64, z: 3, profession: 'fletcher' }, 500)).toBe(true);
    expect(m.profession).toBe('fletcher');
    expect(m.trades.length).toBeGreaterThanOrEqual(3);
    expect(m.jobSite).toEqual({ x: 3, y: 64, z: 3 });
    expect(m.lastRestock).toBe(500);
    // claiming another block of its own trade keeps its offers
    const offers = m.trades;
    expect(takeJobSite(m, { x: 5, y: 64, z: 3, profession: 'fletcher' })).toBe(false);
    expect(m.trades).toBe(offers);
    expect(releaseJobSite(m)).toBe('lost');
    expect(m.profession).toBe(null); expect(m.trades).toEqual([]); expect(m.jobSite).toBe(null);
    takeJobSite(m, { x: 3, y: 64, z: 3, profession: 'cleric' });
    m.traded = true;
    expect(releaseJobSite(m)).toBe('kept');
    expect(m.profession).toBe('cleric'); expect(m.jobSite).toBe(null);
  });

  it('checks the claimed block: still there, broken, or out of reach', () => {
    const w = new ChunkWorld(0, 0, 0, 0);
    w.setBlock(3, 64, 3, B.SMOKER);
    const m = settler();
    takeJobSite(m, { x: 3, y: 64, z: 3, profession: 'butcher' });
    expect(checkJobSite(m, w)).toBe(null);
    w.setBlock(3, 64, 3, B.SMOKER_LIT); // lighting it changes nothing
    expect(checkJobSite(m, w)).toBe(null);
    w.setBlock(3, 64, 3, B.AIR);
    expect(checkJobSite(m, w)).toBe('lost');
    expect(m.profession).toBe(null);
    // a block of another trade in its place does not count either
    takeJobSite(m, { x: 3, y: 64, z: 3, profession: 'butcher' });
    w.setBlock(3, 64, 3, B.LOOM);
    m.traded = true;
    expect(checkJobSite(m, w)).toBe('kept');
    expect(m.profession).toBe('butcher');
    // a claim in a chunk that is not loaded is left alone
    m.jobSite = { x: 40, y: 64, z: 40 };
    expect(checkJobSite(m, w)).toBe(null);
    expect(m.jobSite).toEqual({ x: 40, y: 64, z: 40 });
  });

  it('claimed sites skip the asker and dead settlers', () => {
    const a = settler(), b = settler(), c = settler();
    a.jobSite = { x: 1, y: 2, z: 3 }; b.jobSite = { x: 4, y: 5, z: 6 }; c.jobSite = { x: 7, y: 8, z: 9 }; c.dead = true;
    expect([...claimedSites([a, b, c], a)]).toEqual(['4,5,6']);
  });

  it('a jobless settler claims the nearest free block with a green burst; a second one takes the next', () => {
    const w = new ChunkWorld();
    w.setBlock(6, 64, 0, B.LOOM);
    w.setBlock(-8, 64, 0, B.BREWING_STAND);
    const a = settler(), b = settler();
    const g = fakeGame(w, [a, b]);
    a.tickJobSite(g);
    expect(a.profession).toBe('shepherd');
    expect(a.jobSite).toEqual({ x: 6, y: 64, z: 0 });
    expect(g.particles.emit).toHaveBeenCalled();
    const [, , , , , , r, gr, bl] = g.particles.emit.mock.calls[0];
    expect(gr).toBeGreaterThan(r); expect(gr).toBeGreaterThan(bl); // green
    b.tickJobSite(g);
    expect(b.profession).toBe('cleric');
    // nothing left for a third, which stays jobless and looks again later
    const c = settler(); g.entities.list.push(c);
    c.tickJobSite(g);
    expect(c.profession).toBe(null);
    expect(c.jobSearchAt).toBeGreaterThan(g.ticks);
    // the shepherd's loom is broken before anyone traded with it: it loses the trade
    w.setBlock(6, 64, 0, B.AIR);
    for (g.ticks = 0; g.ticks < 40; g.ticks++) a.tickJobSite(g);
    expect(a.profession).toBe(null);
    // a new loom: the first jobless settler to look takes it
    w.setBlock(2, 64, 2, B.LOOM);
    g.ticks = 1e6;
    c.tickJobSite(g);
    expect(c.profession).toBe('shepherd');
  });

  it('a settler that keeps its trade only claims blocks of that trade', () => {
    const w = new ChunkWorld();
    w.setBlock(2, 64, 0, B.COMPOSTER);
    const m = settler();
    m.profession = 'cleric'; m.traded = true;
    const g = fakeGame(w, [m]);
    m.tickJobSite(g);
    expect(m.jobSite).toBe(null);
    w.setBlock(-3, 64, 0, B.BREWING_STAND);
    g.ticks = 1e6;
    m.tickJobSite(g);
    expect(m.jobSite).toEqual({ x: -3, y: 64, z: 0 });
    expect(g.particles.emit).not.toHaveBeenCalled(); // no new trade, no burst
  });

  it('children grow up jobless and then look for work', () => {
    const m = settler();
    m.setBaby(true);
    m.age = -1;
    const g = { ...fakeGame(new ChunkWorld()), sky: { state: { aboveCount: 1 } }, raids: null };
    m.growUp(g);
    expect(m.profession).toBe(null);
    expect(m.jobSearchAt).toBe(0);
  });

  it('the claim and the traded flag are saved with the settler', () => {
    const m = settler();
    takeJobSite(m, { x: 12, y: 70, z: -5, profession: 'librarian' });
    m.traded = true;
    m.home = { x: 1, y: 2, z: 3 };
    const saved = JSON.parse(JSON.stringify(m.saveData()));
    const n = settler(); n.loadData(saved);
    expect(n.profession).toBe('librarian');
    expect(n.jobSite).toEqual({ x: 12, y: 70, z: -5 });
    expect(n.traded).toBe(true);
    expect(n.trades.length).toBe(m.trades.length);
    // a jobless settler keeps its home and no claim
    const j = settler(); j.home = { x: 4, y: 5, z: 6 };
    const k = settler(); k.loadData(JSON.parse(JSON.stringify(j.saveData())));
    expect(k.profession).toBe(null); expect(k.jobSite).toBe(null); expect(k.home).toEqual({ x: 4, y: 5, z: 6 }); expect(k.traded).toBe(false);
    expect(cleanJobSite({ x: 1.5, y: 2, z: 3 })).toBe(null);
    expect(cleanJobSite('x')).toBe(null);
  });

  it('the profession reaches guests in the mob snapshot, and losing it too', () => {
    const m = settler();
    m.id = 7;
    takeJobSite(m, { x: 0, y: 0, z: 0, profession: 'smith' });
    expect(unpackMob(JSON.parse(JSON.stringify(packMob(m)))).profession).toBe('smith');
    releaseJobSite(m);
    expect(unpackMob(JSON.parse(JSON.stringify(packMob(m)))).profession).toBe(null);
    const bad = packMob(m); bad[13] = '<b>nope';
    expect(unpackMob(bad).profession).toBe(null);
  });

  it('village houses get the job-site block of their settler beside the door', () => {
    const gen = new TerrainGenerator(4242);
    let houses = 0;
    const seen = new Set();
    for (let rx = -2; rx <= 2; rx++) for (let rz = -2; rz <= 2; rz++) {
      const v = villageInRegion(gen, rx, rz);
      if (!v) continue;
      for (const p of v.pieces) {
        if (p.type !== 'house') continue;
        const js = houseJobSite(p);
        // inside the walls
        expect(js.x).toBeGreaterThan(p.x0); expect(js.x).toBeLessThan(p.x1);
        expect(js.z).toBeGreaterThan(p.z0); expect(js.z).toBeLessThan(p.z1);
        if (houses >= 8) continue;
        const cx = js.x >> 4, cz = js.z >> 4;
        const c = gen.generate(cx, cz);
        expect(c.blocks[cidx(js.x - cx * 16, js.y, js.z - cz * 16)]).toBe(jobSiteBlock(p.profession));
        seen.add(p.profession);
        houses++;
      }
    }
    expect(houses).toBeGreaterThan(5);
    expect(seen.size).toBeGreaterThan(2);
  }, 60000);
});

describe('loom', () => {
  it('recolours up to eight wool or carpets with one dye', () => {
    const red = DYES.findIndex((d, c) => d && ITEMS[d].name === 'Red Dye');
    expect(red).toBeGreaterThan(0);
    expect(loomDyeColor(DYES[red])).toBe(red);
    expect(loomDyeColor(I.BONE_MEAL)).toBe(0);
    expect(loomDyeColor(I.STICK)).toBe(-1);
    expect(loomAcceptsCloth({ id: B.WOOL, count: 1 })).toBe(true);
    expect(loomAcceptsCloth({ id: COLOR_BLOCKS.carpet[3], count: 1 })).toBe(true);
    expect(loomAcceptsCloth({ id: B.STONE, count: 1 })).toBe(false);
    expect(loomAcceptsDye({ id: DYES[red], count: 1 })).toBe(true);
    expect(loomResult({ id: B.WOOL, count: 20 }, { id: DYES[red], count: 1 })).toEqual({ result: { id: WOOL_ITEMS[red], count: 8, damage: 0 }, cloth: 8 });
    expect(loomResult({ id: WOOL_ITEMS[5], count: 3 }, { id: DYES[red], count: 2 })).toEqual({ result: { id: WOOL_ITEMS[red], count: 3, damage: 0 }, cloth: 3 });
    expect(loomResult({ id: COLOR_BLOCKS.carpet[2], count: 4 }, { id: I.BONE_MEAL, count: 1 }).result).toEqual({ id: COLOR_BLOCKS.carpet[0], count: 4, damage: 0 });
    expect(loomResult({ id: WOOL_ITEMS[red], count: 4 }, { id: DYES[red], count: 1 })).toBe(null); // already red
    expect(loomResult({ id: B.WOOL, count: 4 }, null)).toBe(null);
    expect(loomResult(null, { id: DYES[red], count: 1 })).toBe(null);
  });
});
