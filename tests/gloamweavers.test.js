// Gloamweaver: the raiders' hooded spellcaster (mobs/gloamweavers.js): spell choice, Thornsnap cells, Mantle targets, cooldowns, raid and patrol makeup.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { Mob } from '../src/mobs/mob.js';
import { MOBS, MOB_KEYS, CATEGORY } from '../src/mobs/mobTypes.js';
import { MODELS, FACES } from '../src/mobs/models.js';
import { rollDrops } from '../src/mobs/drops.js';
import { waveSize, raidWaves } from '../src/mobs/raids.js';
import { entriesOf, resetGuideEntries } from '../src/player/fieldGuideEntries.js';
import { I } from '../src/world/items.js';
import {
  CAST, KEEP, THORN, MANTLE, HAUNT, SPELLS, chooseSpell, canCast, castStep, beginCast, thornCells, spikeHits, mantleTargets, shouldMantle,
  needsMantle, hauntAvailable, hauntCount, waveCasters, waveMemberType, patrolCasterIndex, isRaider,
} from '../src/mobs/gloamweavers.js';
import { MockWorld, rng } from './helpers.js';

const src = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const raider = (x, z, over = {}) => ({ kind: 'mob', type: 'marauder', raider: true, x, y: 64, z, health: 24, maxHealth: 24, effects: {}, deathTime: 0, ...over });

describe('definition', () => {
  it('is a 24 HP hostile raider with a hooded robe model and a painted face', () => {
    const d = MOBS.gloamweaver;
    expect(d).toBeTruthy();
    expect(MOB_KEYS).toContain('gloamweaver');
    expect(d.category).toBe(CATEGORY.MONSTER);
    expect(d.health).toBe(24);
    expect(d.raider).toBe(true);
    expect(MODELS.gloamweaver.parts.length).toBeGreaterThan(8);
    for (const [, , , , , o] of MODELS.gloamweaver.parts) if (o && o.face) expect(typeof FACES[o.face]).toBe('function');
    expect(src('src/audio/audio.js')).toContain(`case '${d.sound}':`);
  });
  it('drops 0-2 Beryl and a Charm of Undying about one time in twenty', () => {
    const r = rng(11);
    let charms = 0, maxBeryl = 0, minBeryl = 9;
    const n = 6000;
    for (let k = 0; k < n; k++) {
      const out = rollDrops('gloamweaver', { killedByPlayer: true }, r);
      if (out.some((d) => d.id === I.CHARM_OF_UNDYING)) charms++;
      const b = out.filter((d) => d.id === I.BERYL).reduce((a, d) => a + d.count, 0);
      maxBeryl = Math.max(maxBeryl, b); minBeryl = Math.min(minBeryl, b);
    }
    expect(charms / n).toBeGreaterThan(0.03);
    expect(charms / n).toBeLessThan(0.07);
    expect(minBeryl).toBe(0); expect(maxBeryl).toBe(2);
    expect(rollDrops('gloamweaver', { killedByPlayer: false }, r)).toEqual([]);
  });
  it('shows up in the Field Guide with where it is found', () => {
    resetGuideEntries();
    const e = entriesOf('creatures').find((x) => x.key === 'gloamweaver');
    expect(e).toBeTruthy();
    expect(e.habitat.join(' ')).toMatch(/raid/i);
    expect(e.drops).toContain(I.BERYL);
  });
  it('uses no forbidden names', () => {
    const text = ['src/mobs/gloamweavers.js', 'tests/gloamweavers.test.js'].map(src).join('\n').toLowerCase();
    for (const w of ['mine' + 'craft', 'net' + 'her', 'red' + 'stone', 'trip' + 'wire']) expect(text).not.toContain(w);
  });
});

describe('spell choice', () => {
  it('casts Mantle first when a nearby raider is hurt or fighting', () => {
    expect(chooseSpell({ dist: 10, mantle: true })).toBe('mantle');
    expect(chooseSpell({ dist: 99, sight: false, mantle: true })).toBe('mantle');
  });
  it('casts Thornsnap at a seen target in range, nothing at one out of range or out of sight', () => {
    expect(chooseSpell({ dist: 10 }, () => 0.9)).toBe('thornsnap');
    expect(chooseSpell({ dist: 15 })).toBe(null);
    expect(chooseSpell({ dist: 10, sight: false })).toBe(null);
  });
  it('answers a target that has closed in with bats, and sometimes uses them at range', () => {
    expect(chooseSpell({ dist: KEEP.FLEE - 1 }, () => 0.9)).toBe('haunt');
    expect(chooseSpell({ dist: 10 }, () => 0.1)).toBe('haunt');
  });
  it('skips Haunt without a suitable mob, or with its bats still about', () => {
    expect(chooseSpell({ dist: 2, hauntOk: false }, () => 0)).toBe('thornsnap');
    expect(chooseSpell({ dist: 2, haunting: HAUNT.CAP }, () => 0)).toBe('thornsnap');
    expect(hauntAvailable()).toBe(true);
    expect(hauntAvailable({})).toBe(false);
    expect(hauntAvailable({ flitter: { flying: false } })).toBe(false);
  });
  it('only ever picks one of the three spells', () => {
    const r = rng(3);
    for (let k = 0; k < 300; k++) {
      const s = chooseSpell({ dist: r() * 20, sight: r() < 0.8, mantle: r() < 0.2, haunting: Math.floor(r() * 4), hauntOk: r() < 0.9 }, r);
      expect(s === null || SPELLS.includes(s)).toBe(true);
    }
  });
});

describe('casting clock and cooldown', () => {
  it('has a 1.2 second windup then a 6 second cooldown', () => {
    expect(CAST.WINDUP).toBe(24);
    expect(CAST.COOLDOWN).toBe(120);
    const m = { castTicks: 0, castCd: 0, castSpell: null };
    expect(canCast(m)).toBe(true);
    expect(beginCast(m, 'mantle')).toBe(true);
    expect(beginCast(m, 'haunt')).toBe(false); // already winding up
    let released = null, windup = 0;
    for (let t = 1; t <= CAST.WINDUP; t++) {
      const r = castStep(m);
      if (r === 'windup') windup++; else released = { r, t };
    }
    expect(windup).toBe(CAST.WINDUP - 1);
    expect(released).toEqual({ r: 'mantle', t: CAST.WINDUP });
    expect(m.castCd).toBe(CAST.COOLDOWN);
    expect(canCast(m)).toBe(false);
    expect(beginCast(m, 'thornsnap')).toBe(false);
    for (let t = 0; t < CAST.COOLDOWN; t++) { expect(canCast(m)).toBe(false); expect(castStep(m)).toBe(null); }
    expect(canCast(m)).toBe(true);
    expect(beginCast(m, 'thornsnap')).toBe(true);
  });
  it('refuses an unknown spell', () => {
    expect(beginCast({ castTicks: 0, castCd: 0 }, 'fireball')).toBe(false);
  });
});

describe('Thornsnap', () => {
  it('lays one spike every 3 ticks along the line toward the target, starting a block out', () => {
    const cells = thornCells({ x: 0.5, z: 0.5 }, { x: 8.5, z: 0.5 });
    expect(cells[0]).toEqual({ x: 1, z: 0, delay: 0 });
    cells.forEach((c, i) => { expect(c.delay).toBe(i * THORN.STEP); expect(c.z).toBe(0); if (i) expect(c.x).toBe(cells[i - 1].x + 1); });
    expect(cells.map((c) => c.x)).toContain(8); // reaches the target's cell
    expect(cells.length).toBe(9);
  });
  it('never runs past 12 blocks and never repeats a cell', () => {
    const far = thornCells({ x: 0.5, z: 0.5 }, { x: 40.5, z: 17.5 });
    expect(far.length).toBeLessThanOrEqual(THORN.MAX_LEN);
    expect(far.length).toBeGreaterThanOrEqual(11);
    expect(new Set(far.map((c) => c.x + ',' + c.z)).size).toBe(far.length);
    for (const c of far) expect(Math.hypot(c.x - 0.5, c.z - 0.5)).toBeLessThanOrEqual(THORN.MAX_LEN + 1.5);
    expect(thornCells({ x: 0, z: 0 }, { x: 0.1, z: 0.1 })).toEqual([]);
  });
  it('runs diagonally and backwards too', () => {
    const d = thornCells({ x: 0.5, z: 0.5 }, { x: -5.5, z: -5.5 });
    expect(d.length).toBeGreaterThan(5);
    expect(d[0].x).toBeLessThanOrEqual(0); expect(d[0].z).toBeLessThanOrEqual(0);
  });
  it('hits for 5 anything standing in the cell except raiders and summoned bats', () => {
    expect(THORN.DAMAGE).toBe(5);
    const cell = { x: 3, z: 3 };
    expect(spikeHits(cell, 64, { x: 3.5, y: 64, z: 3.5, health: 20 })).toBe(true);
    expect(spikeHits(cell, 64, { x: 3.2, y: 64.4, z: 3.9 })).toBe(true);
    expect(spikeHits(cell, 64, { x: 6.5, y: 64, z: 3.5 })).toBe(false);   // next cell
    expect(spikeHits(cell, 64, { x: 3.5, y: 70, z: 3.5 })).toBe(false);   // above it
    expect(spikeHits(cell, 64, raider(3.5, 3.5))).toBe(false);
    expect(spikeHits(cell, 64, { x: 3.5, y: 64, z: 3.5, type: 'gloamweaver' })).toBe(false);
    expect(spikeHits(cell, 64, { x: 3.5, y: 64, z: 3.5, haunt: {} })).toBe(false);
    expect(spikeHits(cell, 64, { x: 3.5, y: 64, z: 3.5, dead: true })).toBe(false);
  });
});

describe('Mantle', () => {
  it('shields every raider within 8 blocks, the caster included, and nobody else', () => {
    const me = raider(0, 0, { type: 'gloamweaver' });
    const near = raider(5, 5), edge = raider(8, 0), far = raider(9, 0), dead = raider(2, 2, { dead: true });
    const villager = { kind: 'mob', type: 'settler', x: 1, y: 64, z: 1, health: 20, maxHealth: 20, effects: {}, deathTime: 0, def: {} };
    const list = mantleTargets(me, [me, near, edge, far, dead, villager]);
    expect(list).toEqual([me, near, edge]);
    expect(mantleTargets(me, [near, me], 4)).toEqual([me]);
    expect(MANTLE.RANGE).toBe(8);
    expect(MANTLE.TICKS).toBe(120); // 6 seconds
  });
  it('is only worth casting when allies are near and hurt or engaged', () => {
    const me = raider(0, 0, { type: 'gloamweaver' });
    expect(shouldMantle(me, [me])).toBe(false);                                   // alone
    expect(shouldMantle(me, [me, raider(3, 0)])).toBe(false);                     // healthy, idle ally
    expect(shouldMantle(me, [me, raider(3, 0, { health: 10 })])).toBe(true);      // hurt
    expect(shouldMantle(me, [me, raider(3, 0, { target: 'player' })])).toBe(true); // in a fight
    expect(shouldMantle(me, [me, raider(3, 0, { prey: {} })])).toBe(true);        // hunting settlers
    expect(shouldMantle(me, [me, raider(12, 0, { health: 5 })])).toBe(false);     // too far
    expect(shouldMantle(me, [me, raider(3, 0, { health: 10, effects: { resistance: { amp: 0, ticks: 80 } } })])).toBe(false); // already shielded
    expect(needsMantle(raider(0, 0, { health: 23 }))).toBe(false);
  });
  it('knows a raider by flag, definition or kind', () => {
    expect(isRaider({ raider: true })).toBe(true);
    expect(isRaider({ def: { raider: true } })).toBe(true);
    expect(isRaider({ type: 'gloamweaver' })).toBe(true);
    expect(isRaider({ type: 'shambler', def: {} })).toBe(false);
    expect(isRaider(null)).toBe(false);
  });
});

describe('Haunt', () => {
  it('summons 2-3 bats that last 20 seconds', () => {
    const seen = new Set(), r = rng(5);
    for (let k = 0; k < 200; k++) seen.add(hauntCount(r));
    expect([...seen].sort()).toEqual([2, 3]);
    expect(HAUNT.TICKS).toBe(400);
    expect(typeof MOBS.flitter.ownAI).toBe('function'); // the Flitter hook
  });
});

describe('raids and patrols', () => {
  it('keeps existing wave sizes: casters take places inside a wave, never add to it', () => {
    for (let om = 1; om <= 5; om++) {
      for (let w = 1; w <= raidWaves(om); w++) {
        const count = waveSize(w, om);
        const types = Array.from({ length: count }, (_, i) => waveMemberType(i, w, count));
        expect(types.length).toBe(count);
        expect(types[0]).toBe('marauder'); // the banner carrier
        expect(types.filter((t) => t === 'gloamweaver').length).toBe(waveCasters(w, count));
        expect(types.filter((t) => t === 'marauder').length).toBeGreaterThanOrEqual(2 * types.filter((t) => t === 'gloamweaver').length);
      }
    }
  });
  it('joins from wave 3 on: none before, one at waves 3-4, two from wave 5', () => {
    for (const w of [1, 2]) expect(waveCasters(w, 12)).toBe(0);
    expect(waveCasters(3, 5)).toBe(1);
    expect(waveCasters(4, 6)).toBe(1);
    expect(waveCasters(5, 9)).toBe(2);
    expect(waveCasters(5, 4)).toBe(1);   // at most a third of a small wave
    expect(waveCasters(3, 2)).toBe(0);
    expect(waveMemberType(4, 3, 5)).toBe('gloamweaver');
    expect(waveMemberType(3, 3, 5)).toBe('marauder');
  });
  it('rarely swaps the last member of a patrol of three or more', () => {
    const r = rng(9);
    let hits = 0; const n = 4000;
    for (let k = 0; k < n; k++) { const i = patrolCasterIndex(4, r); if (i >= 0) { hits++; expect(i).toBe(3); } }
    expect(hits / n).toBeGreaterThan(0.06);
    expect(hits / n).toBeLessThan(0.14);
    for (let k = 0; k < 200; k++) expect(patrolCasterIndex(2, () => 0)).toBe(-1);
    expect(patrolCasterIndex(3, () => 0)).toBe(2);
  });
});

describe('behaviour in the game loop', () => {
  function setup() {
    const world = new MockWorld(64);
    const hurts = [], sounds = [];
    const player = { x: 8.5, y: 64, z: 0.5, eyeHeight: 1.62, dead: false, creative: false, hurt: (d, s) => { hurts.push([d, s]); return true; } };
    const g = {
      ticks: 0, world, player, sounds,
      audio: { play: (n) => sounds.push(n) },
      particles: { emit: () => {} },
      entities: { list: [] },
      spawner: { spawnMob: (type, x, y, z) => { const b = new Mob(type, x, y, z); b._game = g; if (b.def.onSpawn) b.def.onSpawn(b); g.entities.list.push(b); return b; } },
    };
    const m = new Mob('gloamweaver', 0.5, 64, 0.5); m._game = g; m.def.onSpawn(m); g.entities.list.push(m);
    m.canSee = () => true; m.acquire = () => true;
    return { g, m, player, hurts };
  }
  const tick = (g, m, p, n) => { for (let k = 0; k < n; k++) { g.ticks++; m.def.customAI(m, g, p, Math.hypot(p.x - m.x, p.z - m.z)); } };

  it('starts a windup (arms up, standing still), casts after 1.2 s and waits 6 s before the next', () => {
    const { g, m, player } = setup();
    m.castCd = 0;
    let began = -1, released = -1;
    for (let t = 1; t <= 400 && released < 0; t++) {
      tick(g, m, player, 1);
      if (began < 0 && m.castTicks > 0) began = t;
      if (began >= 0 && released < 0 && m.castTicks === 0 && m.castCd === CAST.COOLDOWN) released = t;
    }
    expect(began).toBeGreaterThan(0);
    expect(released - began).toBe(CAST.WINDUP);
    expect(m.castCd).toBe(CAST.COOLDOWN);
    expect(m.castSpell).toBe(null);
  });
  it('a Thornsnap spike hurts the player standing on its line for 5, once', () => {
    const { g, m, player, hurts } = setup();
    m.castCd = 0; m.castTicks = 1; m.castSpell = 'thornsnap'; // the windup ends on this tick
    tick(g, m, player, 1);
    expect(m.spikes.length).toBeGreaterThan(5);
    tick(g, m, player, 60);
    expect(hurts).toEqual([[THORN.DAMAGE, 'mob:Gloamweaver']]);
  });
  it('a Mantle gives Resistance to the raiders around it', () => {
    const { g, m, player } = setup();
    const ally = new Mob('marauder', 4.5, 64, 0.5); ally._game = g; ally.health = 5; g.entities.list.push(ally);
    m.castCd = 0; m.castTicks = 1; m.castSpell = 'mantle';
    tick(g, m, player, 1);
    expect(ally.effects.resistance).toBeTruthy();
    expect(m.effects.resistance).toBeTruthy();
    expect(ally.effects.resistance.ticks).toBeLessThanOrEqual(MANTLE.TICKS);
  });
  it('Haunt calls bats that sweep at the target and are gone after their 20 seconds', () => {
    const { g, m, player } = setup();
    m.castCd = 0; m.castTicks = 1; m.castSpell = 'haunt';
    tick(g, m, player, 1);
    const bats = g.entities.list.filter((e) => e.type === 'flitter');
    expect(bats.length).toBeGreaterThanOrEqual(2);
    expect(bats.length).toBeLessThanOrEqual(3);
    expect(bats[0].haunt.ticks).toBe(HAUNT.TICKS);
    // a plain Flitter still flutters
    const plain = new Mob('flitter', 20, 64, 20); plain._game = g;
    expect(plain.haunt).toBeFalsy();
  });
  it('backs away from a target that is too close', () => {
    const { g, m, player } = setup();
    m.castCd = 999; player.x = 3.5;
    tick(g, m, player, 3);
    expect(m.move && m.move.forward).toBeGreaterThan(0);
  });
});
