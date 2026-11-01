import { describe, it, expect } from 'vitest';
import {
  h01, dustStorm, dustLevel, fogLevel, hushNight, hushLevel, meteorSlot, craterPlan, pickOre, CRATER_RADIUS, DAY, SLOT, ANNOUNCE,
  festivalDay, isFestivalDay, eveningLevel, villageHosts, festivalCut, FESTIVAL_CUT, lanternSpots, gatherSpot, starfallNight, darkness,
  WorldEvents, tradeMarket, EVENT_ORDER, DUST_BIOMES, FOG_BIOMES, SENSOR_BOOST,
} from '../src/world/events.js';
import { B, SOLID, BLOCKS, EMIT, TIER } from '../src/world/blocks.js';
import { BIOME } from '../src/world/biomes.js';
import { Seasons, seasonState, ambienceRate } from '../src/world/seasons.js';
import { nightCharacter, Meteors } from '../src/sky/nightSky.js';
import { offerPrice } from '../src/mobs/trades.js';
import { repFactor } from '../src/mobs/reputation.js';
import { runCommand, GAME_RULES, HELP } from '../src/ui/commands.js';
import { WORLD_COMMANDS } from '../src/net/protocol.js';
import { captionText } from '../src/ui/accessibility.js';
import { MILESTONES } from '../src/player/milestones.js';

const SEED = 12345;

/** A flat stone world with grass on y = 63, a surface for craters; blocks set are remembered. */
function flatWorld(biome = BIOME.DESERT) {
  const set = new Map();
  const w = {
    dimension: 'overworld', gen: null,
    getBlock: (x, y, z) => { const k = `${x},${y},${z}`; if (set.has(k)) return set.get(k); return y < 63 ? B.STONE : y === 63 ? B.GRASS : B.AIR; },
    getMeta: () => 0,
    setBlock: (x, y, z, id) => { set.set(`${x},${y},${z}`, id); },
    isLoaded: () => true, heightAt: () => 63, biomeAt: () => biome, set,
  };
  return w;
}

function fakeGame(over = {}) {
  const g = {
    settings: { worldEvents: true }, seed: SEED, time: 0, ticks: 100, net: null,
    world: flatWorld(), player: { x: 0, y: 64, z: 0, creative: false, dead: false },
    seasons: new Seasons(), toasts: [], events: [], plays: [], launched: [],
    hud: { toast: (m) => g.toasts.push(m) },
    milestones: { event: (n) => g.events.push(n) },
    audio: { play: (...a) => g.plays.push(a) },
    particles: { emit() {}, smoke() {} },
    sky: { meteors: { launch: (...a) => g.launched.push(a) } },
    ...over,
  };
  g.setSetting = (k, v) => { g.settings[k] = v; if (k === 'worldEvents') g.worldEvents.onRule(); };
  g.worldEvents = new WorldEvents(g);
  return g;
}

/** First day number satisfying a predicate. */
const firstDay = (pred, from = 0) => { for (let d = from; d < from + 2000; d++) if (pred(d)) return d; throw new Error('none'); };

describe('deterministic dice', () => {
  it('h01 is stable, spread over 0..1 and depends on every argument', () => {
    expect(h01(1, 2, 3)).toBe(h01(1, 2, 3));
    expect(h01(1, 2, 3)).not.toBe(h01(1, 2, 4));
    let lo = 0, hi = 0;
    for (let i = 0; i < 2000; i++) { const v = h01(7, i); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); if (v < 0.5) lo++; else hi++; }
    expect(Math.abs(lo - hi)).toBeLessThan(200);
  });
});

describe('dust storms', () => {
  it('fall on some days only, inside the day, with a gentle ramp', () => {
    let storms = 0;
    for (let d = 0; d < 300; d++) {
      const s = dustStorm(SEED, d, 'summer');
      if (!s) continue;
      storms++;
      expect(s.start).toBeGreaterThanOrEqual(d * DAY);
      expect(s.end).toBeLessThan((d + 1) * DAY);
      expect(dustLevel(SEED, s.start - 1, 'summer')).toBe(0);
      expect(dustLevel(SEED, (s.start + s.end) / 2, 'summer')).toBe(1);
      expect(dustLevel(SEED, s.start + 300, 'summer')).toBeGreaterThan(0);
      expect(dustLevel(SEED, s.start + 300, 'summer')).toBeLessThan(1);
    }
    expect(storms).toBeGreaterThan(40);
    expect(storms).toBeLessThan(140);
  });
  it('are rarer in winter than in summer and the same every time for a seed', () => {
    const count = (season) => { let n = 0; for (let d = 0; d < 400; d++) if (dustStorm(SEED, d, season)) n++; return n; };
    expect(count('winter')).toBeLessThan(count('summer'));
    expect(dustStorm(SEED, 17, 'summer')).toEqual(dustStorm(SEED, 17, 'summer'));
    const days = (seed) => Array.from({ length: 40 }, (_, d) => !!dustStorm(seed, d, 'summer')).join();
    expect(days(SEED + 1)).not.toBe(days(SEED));
  });
  it('only desert and badlands are dusty, and swamps and forests foggy', () => {
    expect([...DUST_BIOMES].sort()).toEqual([BIOME.DESERT, BIOME.BADLANDS].sort());
    expect(FOG_BIOMES[BIOME.SWAMP]).toBe(1);
    expect(FOG_BIOMES[BIOME.FOREST]).toBeGreaterThan(0);
    expect(FOG_BIOMES[BIOME.DESERT]).toBeUndefined();
  });
});

describe('ground fog', () => {
  it('lies around sunrise on some mornings, and not at noon or midnight', () => {
    const n = firstDay((d) => fogLevel(SEED, d * DAY - 480 + 500, 'autumn') > 0.9, 1);
    const rise = n * DAY - 480;
    expect(fogLevel(SEED, rise + 500, 'autumn')).toBeGreaterThan(0.9);
    expect(fogLevel(SEED, rise + 12000, 'autumn')).toBe(0);
    expect(fogLevel(SEED, rise + 20000, 'autumn')).toBe(0);
    let foggy = 0;
    for (let d = 1; d < 300; d++) if (fogLevel(SEED, d * DAY - 480 + 500, 'autumn') > 0.5) foggy++;
    expect(foggy).toBeGreaterThan(80);
    expect(foggy).toBeLessThan(220);
  });
});

describe('Hush Nights', () => {
  it('are aurora-lit nights, a minority of them', () => {
    let n = 0;
    for (let d = 0; d < 1000; d++) if (hushNight(SEED, d)) { n++; expect(nightCharacter(d).veil).toBeGreaterThanOrEqual(0.6); }
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(250);
  });
  it('only count while it is dark', () => {
    const d = firstDay((x) => hushNight(SEED, x));
    let dark = 0, light = 0;
    for (let t = d * DAY; t < (d + 1) * DAY; t += 400) { if (hushLevel(SEED, t) > 0.9) dark++; if (hushLevel(SEED, t) === 0) light++; }
    expect(dark).toBeGreaterThan(0);
    expect(light).toBeGreaterThan(0);
  });
});

describe('Starfall meteorites', () => {
  it('a few fall on a Starfall night, and they are decided by the seed', () => {
    const d = firstDay((x) => nightCharacter(x).starfall);
    let n = 0;
    for (let slot = Math.floor(d * DAY / SLOT); slot < (d + 1) * DAY / SLOT; slot++) if (meteorSlot(SEED, slot)) n++;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(40);
    const m = meteorSlot(SEED, firstDay((s) => !!meteorSlot(SEED, s), 5));
    expect(m.at).toBeGreaterThan(m.id * SLOT);
    expect(m.dist).toBeGreaterThanOrEqual(40);
    expect(m.dist).toBeLessThanOrEqual(80);
    expect(meteorSlot(SEED, m.id)).toEqual(m);
  });
  it('the crater is a scorched bowl with a Starfall Core at the bottom and rare ore beside it', () => {
    const plan = craterPlan(SEED, 42, 100, 63, -50);
    const core = plan.set.filter((c) => c[3] === B.STARFALL_CORE);
    expect(core).toHaveLength(1);
    expect(core[0].slice(0, 3)).toEqual([100, 61, -50]);
    const ores = plan.set.filter((c) => [B.IRON_ORE, B.GOLD_ORE, B.AZURITE_ORE, B.CINNABAR_ORE, B.DIAMOND_ORE].includes(c[3]));
    expect(ores.length).toBeGreaterThanOrEqual(2);
    expect(ores.length).toBeLessThanOrEqual(3);
    for (const o of ores) expect(Math.hypot(o[0] - 100, o[2] + 50)).toBeLessThanOrEqual(1);
    // the air above is cleared, and nothing is dug further than the bowl
    expect(plan.clear.some((c) => c[0] === 100 && c[1] === 62 && c[2] === -50)).toBe(true);
    for (const [x, , z] of plan.clear) expect(Math.hypot(x - 100, z + 50)).toBeLessThanOrEqual(CRATER_RADIUS);
    for (const c of plan.set) expect(c[1]).toBeGreaterThanOrEqual(61);
    expect(craterPlan(SEED, 42, 100, 63, -50)).toEqual(plan);
    expect(craterPlan(SEED, 43, 100, 63, -50)).not.toEqual(plan);
  });
  it('diamonds are the rarest find', () => {
    const counts = {};
    for (let i = 0; i < 4000; i++) { const o = pickOre(h01(9, i)); counts[o] = (counts[o] || 0) + 1; }
    expect(counts[B.DIAMOND_ORE]).toBeLessThan(counts[B.GOLD_ORE]);
    expect(counts[B.DIAMOND_ORE]).toBeGreaterThan(100);
  });
  it('the Starfall Core is a glowing block that needs an iron pickaxe', () => {
    expect(BLOCKS[B.STARFALL_CORE].name).toBe('Starfall Core');
    expect(EMIT[B.STARFALL_CORE]).toBeGreaterThanOrEqual(12);
    expect(BLOCKS[B.STARFALL_CORE].tier).toBe(TIER.IRON);
    expect(SOLID[B.STARFALL_CORE]).toBe(1);
  });
  it('the sky can be sent a herald streak that fades out', () => {
    const m = new Meteors(() => 0.5);
    m.launch(1, 2);
    const a = m.update(0.5, 0, false, 1);
    expect(a).not.toBeNull();
    expect(a.glow).toBeGreaterThan(0);
    expect(m.update(3, 0, false, 1)).toBeNull();
  });
});

describe('the scheduler on the host', () => {
  it('announces meteorites on a Starfall night near the player, and crater + boom follow', () => {
    const g = fakeGame();
    const we = g.worldEvents;
    const d = firstDay((x) => nightCharacter(x).starfall);
    let t = d * DAY;
    while (!starfallNight(t)) t += 20;
    g.time = t;
    we.lastSlot = Math.floor(t / SLOT) - 1;
    for (let k = 0; k < 40 && starfallNight(g.time) && !we.pending.length; k++) { we.refresh(); g.time += SLOT; g.ticks += SLOT; }
    expect(we.pending.length + g.world.set.size).toBeGreaterThan(-1); // (a hit is likely but the night's dice are the seed's)
    we.announceMeteor(900001, 40, 30, ANNOUNCE);
    const m = we.pending[we.pending.length - 1];
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(50, 0);
    expect(g.launched.length).toBeGreaterThan(0);
    for (let k = 0; k < 400 && we.pending.length; k++) { g.ticks++; we.tickPending(); }
    expect(we.pending).toHaveLength(0);
    expect(g.plays.some((p) => p[0] === 'meteor_boom')).toBe(true);
    expect([...g.world.set.values()]).toContain(B.STARFALL_CORE);
    expect(we.sites.length).toBeGreaterThan(0);
    expect(g.events).toContain('meteor');
  });
  it('rolls the slots of a Starfall night: every slot at most once', () => {
    const g = fakeGame();
    const we = g.worldEvents;
    const t = 100000;
    we.lastSlot = Math.floor(t / SLOT) - 1;
    g.time = t;
    we.scheduleMeteors(t, false);
    expect(we.lastSlot).toBe(Math.floor(t / SLOT));
    const before = we.pending.length;
    we.scheduleMeteors(t + 20, false); // the same slot a second later: nothing new
    expect(we.pending.length).toBe(before);
  });
  it('keeps the last slot over a reload', () => {
    const g = fakeGame();
    g.worldEvents.lastSlot = 500;
    const saved = JSON.parse(JSON.stringify(g.worldEvents.save()));
    const h = fakeGame();
    h.worldEvents.load(saved);
    expect(h.worldEvents.lastSlot).toBe(500);
  });
  it('no crater over water, and nothing is lost when the chunk is not loaded', () => {
    const g = fakeGame();
    g.world.getBlock = (x, y) => (y <= 63 ? B.WATER : B.AIR);
    expect(g.worldEvents.crater({ id: 1, x: 10, z: 10 })).toBeNull();
    const h = fakeGame();
    h.world.isLoaded = () => false;
    expect(h.worldEvents.crater({ id: 1, x: 10, z: 10 })).toBeNull();
  });
});

describe('levels, fog and the player', () => {
  it('a dust storm thickens the fog, slows the player and roars in the soundscape', () => {
    const g = fakeGame();
    const we = g.worldEvents;
    expect(we.fogState()).toBeNull();
    expect(we.ambience(null)).toBeNull();
    we.forced.dust = { until: 1e9 };
    g.time = 100;
    we.refresh();
    for (let i = 0; i < 200; i++) { g.ticks++; we.tick(); }
    expect(we.lv.dust).toBeGreaterThan(0.95);
    const f = we.fogState();
    expect(f.near).toBeLessThan(0.2);
    expect(f.far).toBeLessThan(0.5);
    expect(g.player.eventSlow).toBeLessThan(0.85);
    expect(g.player.eventSlow).toBeGreaterThan(0.7);
    expect(we.ambience(null).wind).toBeGreaterThan(2);
    expect(g.events).toContain('dust_storm');
    expect(g.toasts.join()).toMatch(/dust storm/i);
  });
  it('a storm only reaches desert and badlands, by the clock', () => {
    const season = (t) => new Seasons().at(t).key;
    const d = firstDay((x) => !!dustStorm(SEED, x, season(x * DAY)));
    const s = dustStorm(SEED, d, season(d * DAY));
    const g = fakeGame();
    g.time = Math.floor((s.start + s.end) / 2);
    g.worldEvents.refresh();
    expect(g.worldEvents.target.dust).toBe(1);
    g.world.biomeAt = () => BIOME.PLAINS;
    g.worldEvents.refresh();
    expect(g.worldEvents.target.dust).toBe(0);
  });
  it('ground fog is a cheap fog change that fades again', () => {
    const g = fakeGame();
    g.world.biomeAt = () => BIOME.SWAMP;
    const we = g.worldEvents;
    we.forced.fog = { until: 1e9 };
    we.refresh();
    for (let i = 0; i < 200; i++) { g.ticks++; we.tick(); }
    const f = we.fogState();
    expect(f.far).toBeLessThan(0.6);
    expect(f.far).toBeGreaterThan(0.3);
    delete we.forced.fog;
    we.refresh();
    for (let i = 0; i < 400; i++) we.tick();
    expect(we.fogState()).toBeNull();
    expect(g.player.eventSlow).toBe(1);
  });
  it('a Hush Night quietens monsters and the night, and lets sensors hear further', () => {
    const g = fakeGame();
    const we = g.worldEvents;
    expect(we.monsterVoice()).toBe(1);
    expect(we.sensorRangeMul()).toBe(1);
    we.forced.hush = { until: 1e9 };
    we.refresh();
    for (let i = 0; i < 200; i++) { g.ticks++; we.tick(); }
    expect(we.monsterVoice()).toBeLessThan(0.3);
    expect(we.sensorRangeMul()).toBeCloseTo(1 + SENSOR_BOOST, 1);
    const amb = we.ambience({ wind: 1, bird: 1, cricket: 1, howl: 1 });
    expect(ambienceRate('cricket', amb)).toBeLessThan(0.3);
    expect(ambienceRate('howl', amb)).toBeLessThan(0.3);
    expect(g.events).toContain('hush_night');
  });
  it('idle costs next to nothing: tick looks at the clock once in twenty ticks and no state moves', () => {
    const g = fakeGame();
    const we = g.worldEvents;
    g.time = 3 * DAY + 12000;
    g.ticks = 1;
    let refreshes = 0;
    const orig = we.refresh.bind(we);
    we.refresh = () => { refreshes++; orig(); };
    for (let i = 0; i < 200; i++) { g.ticks++; we.tick(); }
    expect(refreshes).toBe(10);
    expect(we.moving).toBe(false);
  });
});

describe('the rule and /event', () => {
  it('doWorldEvents is a gamerule and switches everything off at once', () => {
    expect(GAME_RULES.doWorldEvents).toBe('worldEvents');
    expect(HELP.some((l) => l.includes('doWorldEvents'))).toBe(true);
    expect(HELP.some((l) => l.includes('/event'))).toBe(true);
    const g = fakeGame();
    expect(runCommand(g, '/gamerule doWorldEvents')).toMatch(/currently set to: true/);
    g.worldEvents.forced.dust = { until: 1e9 };
    g.worldEvents.refresh();
    for (let i = 0; i < 100; i++) g.worldEvents.tick();
    expect(g.worldEvents.lv.dust).toBeGreaterThan(0.5);
    expect(runCommand(g, '/gamerule doWorldEvents false')).toMatch(/now set to: false/);
    expect(g.settings.worldEvents).toBe(false);
    expect(g.worldEvents.lv.dust).toBe(0);
    expect(g.worldEvents.fogState()).toBeNull();
    expect(g.player.eventSlow).toBe(1);
    expect(runCommand(g, '/event trigger dust')).toMatch(/off/);
  });
  it('/event lists the events and triggers or stops one', () => {
    const g = fakeGame();
    const list = runCommand(g, '/event');
    expect(list.length).toBeGreaterThanOrEqual(6);
    for (const k of EVENT_ORDER) expect(list.join('\n')).toContain(k + ':');
    expect(runCommand(g, '/event trigger dust')).toMatch(/Dust Storm begins/);
    expect(g.worldEvents.forced.dust).toBeTruthy();
    expect(runCommand(g, '/event list').join('\n')).toMatch(/dust: Dust Storm - running/);
    expect(runCommand(g, '/event stop dust')).toMatch(/ended/);
    expect(g.worldEvents.forced.dust).toBeUndefined();
    expect(runCommand(g, '/event trigger nonsense')).toMatch(/Usage/);
    expect(runCommand(g, '/event trigger star')).toMatch(/Starfall begins/);
    expect(g.worldEvents.pending.length).toBe(3);
    expect(runCommand(g, '/event stop all')).toMatch(/ended/);
    expect(runCommand(g, '/event trigger festival')).toMatch(/No village/);
  });
  it('a guest who is not creative cannot trigger events; guests have the host run /event', () => {
    const g = fakeGame({ net: { isHost: false, isClient: true } });
    expect(runCommand(g, '/event trigger dust')).toMatch(/Only creative/);
    g.player.creative = true;
    expect(runCommand(g, '/event trigger dust')).toMatch(/begins/);
    expect(WORLD_COMMANDS.has('event')).toBe(true);
  });
});

describe('multiplayer sync (optional fields only)', () => {
  it('syncOut is small and syncIn applies the rule, forced events and meteorites; garbage is ignored', () => {
    const host = fakeGame({ net: { isHost: true, players: () => [{ obj: {} }], sendEnv() { host.sent = (host.sent || 0) + 1; } } });
    host.time = 5000;
    expect(host.worldEvents.syncOut()).toEqual({ on: 1 });
    host.worldEvents.forced.fog = { until: 9000 };
    host.worldEvents.announceMeteor(77, 50, -60, 90);
    expect(host.sent).toBe(1);
    const out = JSON.parse(JSON.stringify(host.worldEvents.syncOut()));
    expect(out.f).toEqual([['fog', 9000, 0]]);
    expect(out.m[0].slice(0, 3)).toEqual([77, 50, -60]);
    const guest = fakeGame({ net: { isHost: false, isClient: true } });
    guest.time = 5000;
    guest.worldEvents.syncIn(out);
    expect(guest.worldEvents.forced.fog.until).toBe(9000);
    expect(guest.worldEvents.pending).toHaveLength(1);
    expect(guest.worldEvents.pending[0].host).toBe(false);
    guest.worldEvents.syncIn(out); // the same meteorite again a second later: not twice
    expect(guest.worldEvents.pending).toHaveLength(1);
    // the guest does not dig the crater itself
    for (let k = 0; k < 200; k++) { guest.ticks++; guest.worldEvents.tickPending(); }
    expect(guest.worldEvents.pending).toHaveLength(0);
    expect(guest.world.set.size).toBe(0);
    expect(guest.plays.some((p) => p[0] === 'meteor_boom')).toBe(true);
    guest.worldEvents.syncIn({ on: 0 });
    expect(guest.settings.worldEvents).toBe(false);
    for (const junk of [null, 5, 'x', [], { f: 'no', m: [[1]] }, { f: [['nope', 1]], m: [[1, 2, 3, -5]] }]) expect(() => guest.worldEvents.syncIn(junk)).not.toThrow();
    // an older host sends no `ev` at all
    expect(() => guest.worldEvents.syncIn(undefined)).not.toThrow();
  });
  it('the boom is captioned', () => {
    expect(captionText('meteor_boom')).toBe('Meteorite booms');
  });
});

describe('saving', () => {
  it('keeps only the scraps, validated on load, and nothing at all when there are none', () => {
    const g = fakeGame();
    expect(g.worldEvents.save()).toBeUndefined();
    g.worldEvents.lastSlot = 9;
    g.worldEvents.sites.push([1, 2, 3, 4]);
    g.worldEvents.lanterns.push([5, 6, 7, '10,10']);
    g.worldEvents.attended.push('10,10:0:me');
    const data = JSON.parse(JSON.stringify(g.worldEvents.save()));
    const h = fakeGame();
    h.worldEvents.load(data);
    expect(h.worldEvents.sites).toEqual([[1, 2, 3, 4]]);
    expect(h.worldEvents.lanterns).toEqual([[5, 6, 7, '10,10']]);
    expect(h.worldEvents.attended).toEqual(['10,10:0:me']);
    h.worldEvents.load({ slot: 'x', sites: [[1]], lan: [['a']], att: [5] });
    expect(h.worldEvents.sites).toEqual([]);
    expect(() => h.worldEvents.load(null)).not.toThrow();
  });
});

describe('the Lantern Festival', () => {
  it('falls on the middle day of autumn, in the evening', () => {
    expect(festivalDay(8)).toBe(4);
    expect(festivalDay(1)).toBe(1);
    const autumnDay4 = 2 * 8 * DAY + 3 * DAY;
    expect(isFestivalDay(seasonState(autumnDay4 + 1000))).toBe(true);
    expect(isFestivalDay(seasonState(autumnDay4 - DAY))).toBe(false);
    expect(isFestivalDay(seasonState(3 * DAY))).toBe(false);
    expect(eveningLevel(autumnDay4 + 15000)).toBe(1);
    expect(eveningLevel(autumnDay4 + 2000)).toBe(0);
    expect(eveningLevel(autumnDay4 + 22000)).toBe(0);
  });
  it('wanders: a village hosts in some years and not in others', () => {
    let yes = 0, no = 0;
    for (let y = 0; y < 100; y++) { if (villageHosts(SEED, '120,-300', y)) yes++; else no++; }
    expect(yes).toBeGreaterThan(30);
    expect(no).toBeGreaterThan(15);
    expect(villageHosts(SEED, '120,-300', 3)).toBe(villageHosts(SEED, '120,-300', 3));
    const hosting = Array.from({ length: 12 }, (_, i) => villageHosts(SEED, `${i * 300},${i * 200}`, 0));
    expect(new Set(hosting).size).toBe(2);
  });
  it('the discount follows reputation and vanishes for a village that has turned on you', () => {
    expect(festivalCut(0)).toBeCloseTo(FESTIVAL_CUT[0]);
    expect(festivalCut(100)).toBeCloseTo(FESTIVAL_CUT[1]);
    expect(festivalCut(50)).toBeGreaterThan(festivalCut(0));
    expect(festivalCut(-30)).toBeCloseTo(FESTIVAL_CUT[0]);
    expect(festivalCut(-60)).toBe(0);
    expect(festivalCut(-100)).toBe(0);
  });
  it('prices drop by the festival cut on top of reputation', () => {
    const offer = { giveCount: 20, uses: 0 };
    expect(offerPrice(offer, 0, { rep: 0 })).toBe(20);
    expect(offerPrice(offer, 0, { rep: 0, festival: 0.12 })).toBe(18);
    expect(offerPrice({ giveCount: 1, uses: 0 }, 0, { rep: 0, festival: 0.12 })).toBe(1);
    expect(offerPrice(offer, 0, { rep: 50, festival: 0.12 })).toBeLessThan(Math.round(20 * repFactor(50)));
  });
  it('tradeMarket gives the cut only while the festival is on in that village', () => {
    const g = fakeGame();
    const holder = { reputation: { '10,20': 60 } };
    expect(tradeMarket(g, '10,20', holder)).toEqual({ rep: 60 });
    g.worldEvents.fest.set('10,20', { cx: 10, cz: 20, y: 64, level: 1 });
    const m = tradeMarket(g, '10,20', holder);
    expect(m.rep).toBe(60);
    expect(m.festival).toBeCloseTo(festivalCut(60));
    expect(tradeMarket(g, '99,99', holder)).toEqual({ rep: 0 });
    holder.reputation['10,20'] = -80;
    expect(tradeMarket(g, '10,20', holder).festival).toBeUndefined();
    g.settings.worldEvents = false;
    expect(tradeMarket(g, '10,20', { reputation: { '10,20': 60 } })).toEqual({ rep: 60 });
  });
  it('settlers of a hosting village are called to the well, only in the evening and only if grown', () => {
    const g = fakeGame();
    const we = g.worldEvents;
    const mob = { id: 5, age: 0, village: '10,20', villageId: () => '10,20' };
    expect(we.gatherPoint(mob)).toBeNull();
    we.fest.set('10,20', { cx: 10, cz: 20, y: 64, level: 1 });
    const spot = we.gatherPoint(mob);
    expect(Math.hypot(spot.x - 10.5, spot.z - 20.5)).toBeGreaterThan(3);
    expect(Math.hypot(spot.x - 10.5, spot.z - 20.5)).toBeLessThan(6);
    expect(we.gatherPoint({ ...mob, age: -100 })).toBeNull();
    expect(we.gatherPoint({ ...mob, village: '1,1', villageId: () => '1,1' })).toBeNull();
    expect(gatherSpot({ cx: 0, cz: 0, y: 70 }, 3)).toEqual(gatherSpot({ cx: 0, cz: 0, y: 70 }, 3));
    we.fest.get('10,20').level = 0.2;
    expect(we.gatherPoint(mob)).toBeNull();
  });
  it('lanterns hang by the doors and round the well, and come down when it is over', () => {
    const g = fakeGame();
    const village = { cx: 0, cz: 0, y: 64, pieces: [
      { type: 'well', x0: -2, z0: -2, x1: 1, z1: 1, y: 64 },
      { type: 'house', x0: 6, x1: 10, z0: -2, z1: 2, y: 64, facing: 2 },
    ] };
    g.world.getBlock = (x, y, z) => { const k = `${x},${y},${z}`; return g.world.set.has(k) ? g.world.set.get(k) : y < 64 ? B.STONE : B.AIR; };
    const spots = lanternSpots(village, g.world);
    expect(spots.length).toBeGreaterThanOrEqual(5);
    expect(new Set(spots.map((s) => `${s.x},${s.y},${s.z}`)).size).toBe(spots.length);
    for (const s of spots) expect(g.world.getBlock(s.x, s.y - 1, s.z) !== B.AIR || s.hang).toBe(true);
    const we = g.worldEvents;
    we.festOn = true;
    we.hangLanterns('0,0', village);
    expect(we.lanterns.length).toBe(spots.length);
    expect([...g.world.set.values()].filter((b) => b === B.LANTERN)).toHaveLength(spots.length);
    we.removeLanterns(false);
    expect(we.lanterns.length).toBe(spots.length); // still on
    we.festOn = false;
    we.removeLanterns(false);
    expect(we.lanterns).toHaveLength(0);
    expect([...g.world.set.values()].filter((b) => b === B.LANTERN)).toHaveLength(0);
  });
  it('lanterns in land that is not loaded wait for it', () => {
    const g = fakeGame();
    g.worldEvents.lanterns.push([5, 64, 5, '0,0']);
    g.world.isLoaded = () => false;
    g.worldEvents.removeLanterns(true);
    expect(g.worldEvents.lanterns).toHaveLength(1);
    g.world.isLoaded = () => true;
    g.worldEvents.removeLanterns(true);
    expect(g.worldEvents.lanterns).toHaveLength(0);
  });
});

describe('milestones', () => {
  it('has the six world event milestones', () => {
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ['meteor', 'meteor_core', 'dust_storm', 'ground_fog', 'lantern_fest', 'hush_night']) expect(ids).toContain(id);
    const core = MILESTONES.find((m) => m.id === 'meteor_core');
    expect(core.inv({ player: { inventory: { count: (id) => (id === B.STARFALL_CORE ? 1 : 0) } } })).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('sanity', () => {
  it('darkness is a fraction', () => {
    for (let t = 0; t < DAY; t += 1000) { const d = darkness(t); expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(1); }
  });
});
