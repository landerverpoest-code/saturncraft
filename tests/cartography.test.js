import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/generator.js';
import { sunkenRuinInRegion } from '../src/world/sunkenRuins.js';
import { sunTombInRegion } from '../src/world/sunTombs.js';
import { skywatchInRegion } from '../src/world/skywatch.js';
import { LANDMARK_KINDS, LANDMARK_BY_KEY, isLandmarkKind } from '../src/world/landmarkKinds.js';
import {
  landmarksInBox, nearestLandmark, addMark, noteLandmarks, surveyMap, chartMap, mapTitle, SIGHT, MAX_MARKS,
} from '../src/world/landmarks.js';
import { newMap, encodeMap, decodeMap, MAP_SIZE } from '../src/world/maps.js';
import { makeTrades, offerPrice } from '../src/mobs/trades.js';
import { JOB_SITES, jobSiteProfession, takeJobSite } from '../src/mobs/jobSites.js';
import { Mob } from '../src/mobs/mob.js';
import { packMob, unpackMob } from '../src/net/protocol.js';
import { craft } from '../src/player/crafting.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { I, ITEMS, CHARTS } from '../src/world/items.js';
import { TRADE_PROFESSIONS, PROFESSIONS } from '../src/world/villages.js';
import { JOBSITE_TEX } from '../src/world/jobSiteTextures.js';
import { dungeonLoot, LOOT } from '../src/mobs/spawnerBlocks.js';
import { rng } from './helpers.js';

const gen = new TerrainGenerator(12345);

function first(find, R = 10) {
  for (let r = 0; r <= R; r++) for (let rx = -r; rx <= r; rx++) for (let rz = -r; rz <= r; rz++) {
    if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
    const s = find(gen, rx, rz);
    if (s) return s;
  }
  return null;
}
const ruin = first(sunkenRuinInRegion, 8);
const tomb = first(sunTombInRegion, 10);
const tower = first(skywatchInRegion, 10);

describe('landmark kinds', () => {
  it('have unique keys, names, colours and glyphs', () => {
    expect(new Set(LANDMARK_KINDS.map((k) => k.key)).size).toBe(LANDMARK_KINDS.length);
    for (const k of LANDMARK_KINDS) {
      expect(k.name.length).toBeGreaterThan(2);
      expect(k.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(k.shape).toBeTruthy();
      expect(LANDMARK_BY_KEY[k.key]).toBe(k);
    }
    for (const k of ['sunken', 'tomb', 'skywatch', 'village', 'citadel']) expect(isLandmarkKind(k)).toBe(true);
    expect(isLandmarkKind('toString')).toBe(false);
    expect(isLandmarkKind(5)).toBe(false);
  });
});

describe('marks on a map', () => {
  it('only land inside the map square, once, destinations kept longest', () => {
    const m = newMap(1, 0, 0); // square -64..63
    expect(addMark(m, 'village', 10, 10)).toBe(true);
    expect(addMark(m, 'village', 10, 10)).toBe(false);
    expect(addMark(m, 'village', 64, 10)).toBe(false);
    expect(addMark(m, 'village', -65, 0)).toBe(false);
    expect(addMark(m, 'nonsense', 0, 0)).toBe(false);
    expect(addMark(m, 'village', 10, 10, true)).toBe(true); // the same place becomes a destination
    expect(m.marks).toEqual([{ kind: 'village', x: 10, z: 10, target: true }]);
    addMark(m, 'tomb', 0, 0, true);
    for (let i = 0; i < MAX_MARKS + 10; i++) addMark(m, 'hut', -60 + (i % 100), -60 + Math.floor(i / 100) * 3);
    expect(m.marks.length).toBeLessThanOrEqual(MAX_MARKS);
    expect(m.marks.filter((k) => k.target).length).toBe(2);
  });

  it('survive the save format, and bad saved marks are dropped', () => {
    const m = newMap(9, 0, 0);
    addMark(m, 'tomb', 5, -7, true);
    addMark(m, 'igloo', -30, 20);
    const d = decodeMap(JSON.parse(JSON.stringify(encodeMap(m))));
    expect(d.marks).toEqual(m.marks);
    const enc = encodeMap(m);
    enc.marks = [['tomb', 1, 1], ['bogus', 1, 1], ['tomb', 500, 1], ['tomb', 'x', 1], 'junk', ['skywatch', 3, 4, 1]];
    expect(decodeMap(enc).marks).toEqual([{ kind: 'tomb', x: 1, z: 1 }, { kind: 'skywatch', x: 3, z: 4, target: true }]);
    delete enc.marks;
    expect(decodeMap(enc).marks).toBeUndefined(); // old saves have none
  });
});

describe('noting structures in sight', () => {
  it('finds the three large structures by their centres', () => {
    expect(ruin && tomb && tower).toBeTruthy();
    for (const [kind, s] of [['sunken', ruin], ['tomb', tomb], ['skywatch', tower]]) {
      const list = landmarksInBox(gen, s.cx - 5, s.cz - 5, s.cx + 5, s.cz + 5);
      expect(list).toContainEqual({ kind, x: s.cx, z: s.cz });
    }
  });

  it('marks a structure only when the holder comes within sight, inside the map square', () => {
    const m = newMap(2, tomb.cx, tomb.cz);
    expect(noteLandmarks(m, gen, tomb.cx + SIGHT + 20, tomb.cz)).toBe(0);
    expect(m.marks).toBeUndefined();
    expect(noteLandmarks(m, gen, tomb.cx + SIGHT - 5, tomb.cz)).toBeGreaterThanOrEqual(1);
    expect(m.marks).toContainEqual({ kind: 'tomb', x: tomb.cx, z: tomb.cz });
    expect(noteLandmarks(m, gen, tomb.cx, tomb.cz)).toBe(0); // already known
    const elsewhere = newMap(3, tomb.cx + 1000, tomb.cz + 1000);
    expect(noteLandmarks(elsewhere, gen, tomb.cx, tomb.cz)).toBe(0); // the structure is outside this map's square
  });
});

describe('Explorer Charts', () => {
  it('find the nearest structure of their kind, as /locate does', () => {
    const near = (kind, s) => {
      const r = nearestLandmark(gen, kind, s.cx + 30, s.cz - 30);
      expect(r.kind).toBe(kind);
      expect(Math.hypot(r.x - s.cx, r.z - s.cz)).toBeLessThan(400);
      expect(r.dist).toBeGreaterThan(0);
    };
    near('sunken', ruin); near('tomb', tomb); near('skywatch', tower);
    expect(nearestLandmark(gen, 'nonsense', 0, 0)).toBe(null);
    expect(nearestLandmark(gen, 'tomb', 0, 0, 1)).toBe(null); // out of range
  });

  it('survey the whole square from the terrain, water darker than land', () => {
    const m = newMap(4, ruin.cx, ruin.cz);
    surveyMap(m, gen);
    expect(m.filled).toBe(MAP_SIZE * MAP_SIZE);
    // a Sunken Ruin lies on the floor of deep ocean: the middle of its map is blue
    const o = (64 * MAP_SIZE + 64) * 3;
    const px = m.px, rgb = [px[o], px[o + 1], px[o + 2]];
    expect(rgb[2]).toBeGreaterThan(rgb[0]);
  });

  it('become a map round the structure with it marked as the destination', () => {
    const r = chartMap(gen, 'tomb', tomb.cx + 200, tomb.cz, 77);
    expect(r).not.toBe(null);
    const { map, site } = r;
    expect(map.id).toBe(77);
    expect(site.kind).toBe('tomb');
    expect(site.x).toBeGreaterThanOrEqual(map.x0);
    expect(site.x).toBeLessThan(map.x0 + MAP_SIZE);
    expect(map.marks).toContainEqual({ kind: 'tomb', x: site.x, z: site.z, target: true });
    expect(mapTitle(map)).toBe('Sun Tomb Map');
    expect(mapTitle(newMap(1, 0, 0))).toBe(null);
    expect(chartMap(gen, 'bogus', 0, 0, 79)).toBe(null);
  });

  it('exist for five kinds, as new items after the old ones', () => {
    expect(Object.keys(CHARTS).sort()).toEqual(['citadel', 'outpost', 'sunken', 'skywatch', 'tomb'].sort());
    for (const [kind, id] of Object.entries(CHARTS)) {
      expect(ITEMS[id].chart).toBe(kind);
      expect(isLandmarkKind(kind)).toBe(true);
      expect(id).toBeGreaterThan(I.GALE_ROD);
      expect(ITEMS[id].stack).toBe(16);
    }
    expect(I.CHART_TOMB).toBe(CHARTS.tomb);
  });
});

describe('Cartography Desk and Cartographers', () => {
  it('is the job-site block of the cartographer, crafted from paper over planks', () => {
    expect(BLOCKS[B.CARTOGRAPHY_DESK].name).toBe('Cartography Desk');
    expect(JOB_SITES.cartographer).toEqual([B.CARTOGRAPHY_DESK]);
    expect(jobSiteProfession(B.CARTOGRAPHY_DESK)).toBe('cartographer');
    const P = { id: B.OAK_PLANKS, count: 1 }, A = { id: I.PAPER, count: 1 };
    expect(craft([A, A, P, P, P, P], 2)).toEqual({ id: B.CARTOGRAPHY_DESK, count: 1 });
    for (const n of ['cartography_desk_top', 'cartography_desk_side', 'cartography_desk_front']) expect(typeof JOBSITE_TEX[n]).toBe('function');
  });

  it('is not planned into villages, but is a trade guests can see', () => {
    expect(PROFESSIONS).not.toContain('cartographer');
    expect(TRADE_PROFESSIONS).toContain('cartographer');
    const m = new Mob('settler', 0.5, 64, 0.5);
    m.id = 3;
    expect(takeJobSite(m, { x: 1, y: 64, z: 1, profession: 'cartographer' })).toBe(true);
    expect(m.trades.length).toBeGreaterThanOrEqual(3);
    expect(unpackMob(JSON.parse(JSON.stringify(packMob(m)))).profession).toBe('cartographer');
  });

  it('always stocks a chart, buys paper-trade goods for beryl and sells for beryl', () => {
    const r = rng(11);
    const chartIds = new Set(Object.values(CHARTS));
    const seen = new Set();
    for (let k = 0; k < 200; k++) {
      const t = makeTrades('cartographer', r);
      expect(t[0].get).toBe(I.BERYL);
      expect([I.PAPER, I.INK_SAC, I.COMPASS]).toContain(t[0].give);
      expect(t.length).toBeGreaterThanOrEqual(3);
      expect(t.length).toBeLessThanOrEqual(4);
      expect(t.some((o) => chartIds.has(o.get))).toBe(true);
      expect(new Set(t.map((o) => o.get)).size).toBe(t.length); // no offer twice
      for (const o of t.slice(1)) { expect(o.give).toBe(I.BERYL); seen.add(o.get); }
    }
    for (const id of chartIds) expect(seen.has(id)).toBe(true); // every chart is for sale somewhere
    const tomb = makeTrades('cartographer', () => 0.99).find((o) => o.get === CHARTS.citadel);
    expect(tomb.giveCount).toBe(14);
    expect(offerPrice(tomb, 0.3)).toBeLessThan(14); // Village Champion prices apply as usual
  });

  it('other trades are unchanged', () => {
    for (const p of PROFESSIONS) {
      const t = makeTrades(p, rng(5));
      expect(t[0].get).toBe(I.BERYL);
      expect(t.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('charts also turn up in shipwreck map chests', () => {
    const chartIds = new Set(Object.values(CHARTS));
    let found = 0;
    const r = rng(21);
    for (let k = 0; k < 300; k++) for (const s of dungeonLoot(r, LOOT.WRECK_MAP)) if (s && chartIds.has(s.id)) found++;
    expect(found).toBeGreaterThan(5);
  });
});
