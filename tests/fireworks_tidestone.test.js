// Firework Stars of several colours, shapes and effects, Star Rockets with several stars, and the animated tidestone.
import { describe, it, expect } from 'vitest';
import { rng } from './helpers.js';
import { I, ITEMS, FIREWORK_STARS, STAR_ROCKETS } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';
import { COLORS } from '../src/world/colors.js';
import { craft } from '../src/player/crafting.js';
import { canStack, withExtras } from '../src/world/enchantments.js';
import { packEntity, unpackEntity, sameStack, copyStack } from '../src/net/protocol.js';
import { tooltipHTML } from '../src/ui/icons.js';
import {
  SHAPES, SHAPE_NAMES, MAX_STARS, cleanFw, cleanStar, craftStar, rocketOfStack, starOfStack, burstVelocities, burstDamage, fwLines,
  starOutline, faceOutline, FACE_ROWS,
} from '../src/world/fireworks.js';
import { SkyRocket, starDamage, STAR_DAMAGE, useSkyRocket } from '../src/entities/skyRocket.js';
import { TEX_NAMES, texId, texturePixels } from '../src/world/textures.js';
import { TIDE_FRAMES } from '../src/world/monumentTextures.js';
import '../src/world/dimensions/register.js'; // (the Sky Rocket recipe)

const S = (id, extra = {}) => ({ id, count: 1, ...extra });
const dye = (key) => S(I[key + '_DYE']);
const grid = (...cells) => { const g = new Array(9).fill(null); cells.forEach((c, i) => { g[i] = c; }); return g; };
const RED = 14, BLUE = 11, YELLOW = 4;

describe('Firework Stars: colours, shapes and effects', () => {
  it('keeps the original item ids (32 per-colour items after the Tattered Book) and adds no new ones', () => {
    expect(FIREWORK_STARS.length).toBe(16);
    expect(STAR_ROCKETS.length).toBe(16);
    expect(FIREWORK_STARS[0]).toBeGreaterThan(I.TATTERED_BOOK);
    expect(STAR_ROCKETS[15] - FIREWORK_STARS[0]).toBe(31);
    expect(ITEMS[FIREWORK_STARS[RED]].name).toBe('Red Firework Star');
  });

  it('one dye with blast powder is still the plain per-colour star (no extra data)', () => {
    const r = craft(grid(S(I.GUNPOWDER), dye('RED')), 3);
    expect(r).toEqual({ id: FIREWORK_STARS[RED], count: 1 });
    expect(r.fw).toBeUndefined();
    expect(craft(grid(S(I.GUNPOWDER), S(I.BONE_MEAL)), 2)).toEqual({ id: FIREWORK_STARS[0], count: 1 });
  });

  it('several dyes make a multi-colour star named after the first colour; duplicate dyes count once', () => {
    const r = craft(grid(S(I.GUNPOWDER), dye('BLUE'), dye('RED'), dye('YELLOW')), 2);
    expect(r.id).toBe(FIREWORK_STARS[BLUE]);
    expect(r.fw).toEqual({ c: [BLUE, RED, YELLOW], s: 0, t: 0, w: 0 });
    expect(craft(grid(S(I.GUNPOWDER), dye('RED'), dye('RED')), 2)).toEqual({ id: FIREWORK_STARS[RED], count: 1 });
    // eight different dyes fit a 3x3 grid next to the powder
    const eight = ['RED', 'BLUE', 'YELLOW', 'GREEN', 'ORANGE', 'PURPLE', 'PINK', 'CYAN'].map(dye);
    expect(craft(grid(S(I.GUNPOWDER), ...eight), 3).fw.c.length).toBe(8);
  });

  it('one shape ingredient picks the shape, a diamond adds a trail and glowshard dust a twinkle', () => {
    const shapeOf = (ing) => craft(grid(S(I.GUNPOWDER), dye('RED'), S(ing)), 3).fw.s;
    expect(SHAPES).toEqual(['ball', 'large', 'star', 'burst', 'face']);
    expect(shapeOf(I.FIRE_CHARGE)).toBe(1);
    expect(shapeOf(I.GOLD_NUGGET)).toBe(2);
    expect(shapeOf(I.FEATHER)).toBe(3);
    expect(shapeOf(B.CARVED_PUMPKIN)).toBe(4);
    const fx = craft(grid(S(I.GUNPOWDER), dye('RED'), S(I.DIAMOND), S(I.GLOWSHARD_DUST)), 3);
    expect(fx.fw).toEqual({ c: [RED], s: 0, t: 1, w: 1 });
    expect(fx.id).toBe(FIREWORK_STARS[RED]);
    expect(SHAPE_NAMES[4]).toBe('Fizzler Face');
  });

  it('rejects stars with no colour, two shapes, two powders, or something foreign', () => {
    expect(craftStar([I.GUNPOWDER, I.DIAMOND])).toBe(null);
    expect(craftStar([I.GUNPOWDER, I.IRON_INGOT])).toBe(null);
    expect(craftStar([I.GUNPOWDER, I.RED_DYE, I.FEATHER, I.GOLD_NUGGET])).toBe(null);
    expect(craftStar([I.GUNPOWDER, I.GUNPOWDER, I.RED_DYE])).toBe(null);
    expect(craftStar([I.RED_DYE, I.FEATHER])).toBe(null);
    expect(craft(grid(S(I.GUNPOWDER), dye('RED'), S(I.DIAMOND), S(I.DIAMOND)), 3)).toBe(null);
  });
});

describe('Star Rockets with several stars', () => {
  const star = (id, fw) => S(id, fw ? { fw } : {});
  it('paper, blast powder and one plain star still make three rockets of that colour (no extra data)', () => {
    const r = craft(grid(S(I.PAPER), S(I.GUNPOWDER), S(FIREWORK_STARS[5])), 3);
    expect(r).toEqual({ id: STAR_ROCKETS[5], count: 3 });
    // and the plain Sky Rocket recipe is untouched
    expect(craft(grid(S(I.PAPER), S(I.GUNPOWDER)), 2)).toMatchObject({ id: I.SKY_ROCKET, count: 3 });
  });

  it('carries every star with its colours, shape and effects, and keeps the flight', () => {
    const big = { c: [RED, YELLOW], s: 2, t: 1, w: 0 };
    const r = craft(grid(S(I.PAPER), S(I.GUNPOWDER), S(I.GUNPOWDER), star(FIREWORK_STARS[RED], big), S(FIREWORK_STARS[BLUE])), 3);
    expect(r.count).toBe(3);
    expect(r.id).toBe(STAR_ROCKETS[RED]);
    expect(r.fw.f).toBe(2);
    expect(r.fw.st).toEqual([big, { c: [BLUE], s: 0, t: 0, w: 0 }]);
    const info = rocketOfStack(r);
    expect(info.flight).toBe(2);
    expect(info.stars.length).toBe(2);
  });

  it('takes up to seven stars and three powders, no more', () => {
    const stars = (n) => Array.from({ length: n }, () => S(FIREWORK_STARS[YELLOW]));
    expect(craft(grid(S(I.PAPER), S(I.GUNPOWDER), ...stars(7)), 3).fw.st.length).toBe(MAX_STARS);
    expect(craft(grid(S(I.PAPER), S(I.GUNPOWDER), ...stars(8)), 3)).toBe(null);
    expect(craft(grid(S(I.PAPER), S(I.GUNPOWDER), S(I.GUNPOWDER), S(I.GUNPOWDER), S(FIREWORK_STARS[0])), 3).fw.f).toBe(3);
    expect(craft(grid(S(I.PAPER), S(I.GUNPOWDER), S(I.GUNPOWDER), S(I.GUNPOWDER), S(I.GUNPOWDER), S(FIREWORK_STARS[0])), 3)).toBe(null);
    // a longer flight on a plain rocket
    expect(craft(grid(S(I.PAPER), S(I.GUNPOWDER), S(I.GUNPOWDER)), 2)).toEqual({ id: I.SKY_ROCKET, count: 3, fw: { f: 2 } });
    // stars alone, or a stray item, make no rocket
    expect(craft(grid(S(I.PAPER), S(FIREWORK_STARS[0]), S(I.STICK)), 3)).toBe(null);
    expect(craft(grid(S(FIREWORK_STARS[0]), S(I.GUNPOWDER)), 2)).toBe(null);
  });

  it('shows the payload in the tooltip', () => {
    const r = craft(grid(S(I.PAPER), S(I.GUNPOWDER), star(FIREWORK_STARS[RED], { c: [RED, BLUE], s: 4, t: 1, w: 1 })), 3);
    const lines = fwLines(r);
    expect(lines).toContain('Flight Duration: 1');
    expect(lines.join('|')).toMatch(/Fizzler Face.*Red, Blue.*Trail.*Twinkle/);
    const html = tooltipHTML(S(FIREWORK_STARS[RED], { fw: { c: [RED, BLUE], s: 2, t: 0, w: 1 } }));
    expect(html).toContain('Star-shaped');
    expect(html).toContain('Twinkle');
  });
});

describe('firework data in stacks', () => {
  const fancy = { c: [RED, BLUE], s: 3, t: 1, w: 1 };
  it('cleans untrusted data', () => {
    expect(cleanStar({ c: [99, -1, 'x', 3, 3], s: 9, t: 5, w: 0 })).toEqual({ c: [3], s: 0, t: 1, w: 0 });
    expect(cleanStar({ c: [] })).toBe(null);
    expect(cleanStar('evil')).toBe(null);
    expect(cleanStar({ c: Array.from({ length: 20 }, (_, i) => i % 16) }).c.length).toBe(8);
    expect(cleanFw({ f: 9, st: Array.from({ length: 20 }, () => fancy) })).toMatchObject({ f: 3 });
    expect(cleanFw({ f: 9, st: Array.from({ length: 20 }, () => fancy) }).st.length).toBe(MAX_STARS);
    expect(cleanFw({ f: 1 })).toBe(null);
    expect(cleanFw(null)).toBe(null);
    expect(cleanFw(fancy)).toEqual(fancy);
  });

  it('is kept by withExtras and copyStack, and stops mismatched stacks merging', () => {
    const a = S(FIREWORK_STARS[RED], { fw: fancy });
    expect(copyStack(a).fw).toEqual(fancy);
    expect(withExtras({ id: a.id, count: 1 }, a).fw).toEqual(fancy);
    expect(canStack(a, S(FIREWORK_STARS[RED]))).toBe(false);
    expect(canStack(a, S(FIREWORK_STARS[RED], { fw: { ...fancy } }))).toBe(true);
    expect(canStack(a, S(FIREWORK_STARS[RED], { fw: { ...fancy, t: 0 } }))).toBe(false);
    expect(sameStack(a, copyStack(a))).toBe(true);
    expect(sameStack(a, S(FIREWORK_STARS[RED]))).toBe(false);
    expect(canStack(S(FIREWORK_STARS[RED]), S(FIREWORK_STARS[RED]))).toBe(true);
  });

  it('travels in the dropped item message (a new last element) and survives JSON', () => {
    const e = { kind: 'item', id: 5, x: 1, y: 2, z: 3, stack: S(STAR_ROCKETS[RED], { count: 3, fw: { f: 2, st: [fancy] } }), pickupDelay: 0 };
    const msg = JSON.parse(JSON.stringify(packEntity(e)));
    expect(msg.slice(0, 13)).toEqual(['i', 5, 1, 2, 3, STAR_ROCKETS[RED], 3, 0, 0, 0, 0, 0, 0]);
    expect(msg[14]).toEqual({ f: 2, st: [fancy] });
    expect(unpackEntity(msg).stack.fw).toEqual({ f: 2, st: [fancy] });
    // an older host's message has no such element
    expect(unpackEntity(msg.slice(0, 14)).stack.fw).toBeUndefined();
    // garbage is dropped
    msg[14] = { st: 'x', f: 'y' };
    expect(unpackEntity(msg).stack.fw).toBeUndefined();
  });

  it('describes the stars of the original items and of plain rockets', () => {
    expect(starOfStack(S(FIREWORK_STARS[BLUE]))).toEqual({ c: [BLUE], s: 0, t: 0, w: 0 });
    expect(starOfStack(S(I.STICK))).toBe(null);
    expect(rocketOfStack(S(STAR_ROCKETS[RED]))).toEqual({ flight: 1, stars: [{ c: [RED], s: 0, t: 0, w: 0 }] });
    expect(rocketOfStack(S(I.SKY_ROCKET))).toEqual({ flight: 1, stars: [] });
  });
});

describe('burst shapes', () => {
  const r = () => rng(7);
  const speed = ([x, y, z]) => Math.hypot(x, y, z);
  it('the small ball keeps its original 70 sparks, the large ball has more and flies farther', () => {
    const small = burstVelocities(0, r()), large = burstVelocities(1, r());
    expect(small.length).toBe(70);
    expect(large.length).toBeGreaterThan(small.length);
    const mean = (v) => v.reduce((s, x) => s + speed(x), 0) / v.length;
    expect(mean(large)).toBeGreaterThan(mean(small) * 1.3);
    for (const v of small) { expect(speed(v)).toBeGreaterThanOrEqual(0.25 - 1e-9); expect(speed(v)).toBeLessThanOrEqual(0.35 + 1e-9); }
  });
  it('the burst is a spray of very different speeds', () => {
    const v = burstVelocities(3, r()).map(speed);
    expect(Math.max(...v) / Math.min(...v)).toBeGreaterThan(5);
  });
  it('the star and the face lie in one vertical plane, whatever way they face', () => {
    for (const shape of [2, 4]) for (const yaw of [0, 0.7, 2.1, 4]) {
      const v = burstVelocities(shape, r(), yaw);
      // the plane's normal is (-sin yaw, 0, cos yaw): the sparks leave it by a hair at most
      const off = v.map(([x, , z]) => Math.abs(-Math.sin(yaw) * x + Math.cos(yaw) * z));
      expect(Math.max(...off)).toBeLessThan(0.011);
      const along = v.map(([x, , z]) => Math.abs(Math.cos(yaw) * x + Math.sin(yaw) * z));
      expect(Math.max(...along)).toBeGreaterThan(0.1);
    }
  });
  it('the star outline has five points and the face has two eyes, a nose and a mouth', () => {
    const o = starOutline();
    expect(o.length).toBe(80);
    const far = o.filter(([x, y]) => Math.hypot(x, y) > 0.99);
    expect(far.length).toBe(5);
    expect(FACE_ROWS.length).toBe(8);
    expect(FACE_ROWS.every((row) => row.length === 8)).toBe(true);
    const cells = FACE_ROWS.join('').split('#').length - 1;
    expect(faceOutline().length).toBe(cells * 2);
    // symmetric left to right
    const pts = faceOutline();
    expect(Math.abs(pts.reduce((s, [x]) => s + x, 0))).toBeLessThan(0.7);
  });
});

describe('Star Rocket bursts', () => {
  const mkGame = (mobs = [], net = null) => {
    const emitted = [], sounds = [];
    return {
      net, emitted, sounds,
      particles: { emit: (...a) => emitted.push(a) },
      audio: { play: (n) => sounds.push(n) },
      entities: { list: mobs, add: (e) => e },
      world: { getBlock: () => 0 },
      player: { gliding: false, x: 0, y: 0, z: 0 },
    };
  };
  const rocketWith = (stars, f = 1) => new SkyRocket(0, 10, 0, null, rng(3), null, { id: STAR_ROCKETS[stars[0].c[0]], count: 1, fw: { f, st: stars } });
  const ball = { c: [RED], s: 0, t: 0, w: 0 };

  it('every star puts out its own sparks, in its own colours', () => {
    const g = mkGame();
    const r = rocketWith([{ c: [RED, BLUE], s: 0, t: 0, w: 0 }, { c: [YELLOW], s: 1, t: 0, w: 0 }]);
    r.burst(g, rng(1));
    expect(g.emitted.length).toBe(70 + burstVelocities(1, rng(1)).length);
    expect(r.dead).toBe(true); // nothing followed
    const first = g.emitted.slice(0, 70).map(([, , , , , , cr, cg, cb]) => [cr, cg, cb]);
    // sparks lean to red or to blue (never yellow: that star is not aboard)
    const reds = first.filter(([cr, , cb]) => cr > cb).length;
    expect(reds).toBeGreaterThan(10);
    expect(reds).toBeLessThan(60);
  });

  it('a trail leaves sparks behind the followed sparks for a while, then ends', () => {
    const g = mkGame();
    const r = rocketWith([{ c: [RED], s: 0, t: 1, w: 0 }]);
    r.burst(g, rng(2));
    expect(r.dead).toBe(false);
    expect(r.heads.length).toBeGreaterThan(0);
    expect(r.heads.length).toBeLessThanOrEqual(16);
    const before = g.emitted.length;
    r.tick(g);
    expect(g.emitted.length - before).toBe(r.heads.length);
    for (let i = 0; i < 40; i++) r.tick(g);
    expect(r.dead).toBe(true);
    expect(g.sounds).not.toContain('rocket_twinkle');
  });

  it('a twinkle crackles white once the sparks have flown a while, with a sound', () => {
    const g = mkGame();
    const r = rocketWith([{ c: [BLUE], s: 0, t: 0, w: 1 }]);
    r.burst(g, rng(2));
    expect(r.heads.length).toBeGreaterThan(0);
    expect(r.heads.length).toBeLessThanOrEqual(12);
    const n = g.emitted.length, heads = r.heads.length;
    for (let i = 0; i < 40; i++) r.tick(g);
    const flashes = g.emitted.slice(n).filter((a) => a[6] === 1 && a[7] === 1);
    expect(flashes.length).toBe(heads * 4); // four white sparks per followed spark
    expect(g.sounds.filter((s) => s === 'rocket_twinkle').length).toBe(1);
    expect(r.dead).toBe(true);
  });

  it('a plain ball makes the old sound; large balls, stars and crowds of stars boom', () => {
    const play = (stars) => { const g = mkGame(); rocketWith(stars).burst(g, rng(1)); return g.sounds[0]; };
    expect(play([ball])).toBe('rocket_burst');
    expect(play([{ ...ball, s: 1 }])).toBe('rocket_blast');
    expect(play([{ ...ball, s: 2 }])).toBe('rocket_blast');
    expect(play([{ ...ball, s: 4 }])).toBe('rocket_burst');
    expect(play([ball, ball, ball])).toBe('rocket_blast');
    const plain = mkGame(); new SkyRocket(0, 0, 0, null, rng(3)).burst(plain); expect(plain.sounds[0]).toBe('rocket_burst');
  });

  it('hurts mobs by 5 + 2 per star, only on the host or a single player', () => {
    expect(burstDamage(1)).toBe(STAR_DAMAGE);
    expect(burstDamage(3)).toBe(11);
    expect(starDamage(1, 4)).toBe(13);
    expect(starDamage(6, 4)).toBe(0);
    expect(starDamage(0)).toBe(STAR_DAMAGE);
    const hits = [];
    const mob = { kind: 'mob', x: 1, y: 10, z: 0, height: 1, dead: false, deathTime: 0, hurt: (d, src) => { hits.push([d, src]); return true; } };
    rocketWith([ball, ball, ball]).burst(mkGame([mob]), rng(1));
    expect(hits).toEqual([[11, 'firework']]);
    hits.length = 0;
    rocketWith([ball]).burst(mkGame([mob], { isClient: true }), rng(1));
    expect(hits.length).toBe(0);
    new SkyRocket(0, 10, 0, null, rng(3)).burst(mkGame([mob]), rng(1)); // plain: never
    expect(hits.length).toBe(0);
  });

  it('a longer flight burns longer; a rocket launched with its stack carries the stars', () => {
    expect(rocketWith([ball], 3).life).toBeGreaterThan(rocketWith([ball], 1).life);
    expect(rocketWith([ball], 3).life).toBeGreaterThanOrEqual(40);
    const added = [];
    const g = { player: { gliding: false, x: 0, y: 0, z: 0 }, entities: { add: (e) => { added.push(e); return e; } }, audio: { play() {} } };
    const stack = S(STAR_ROCKETS[RED], { fw: { f: 2, st: [ball, { c: [BLUE], s: 4, t: 0, w: 0 }] } });
    expect(useSkyRocket(g, { x: 1, y: 2, z: 3, face: [0, 1, 0] }, null, stack)).toBe(true);
    expect(added[0].stars.length).toBe(2);
    expect(added[0].flight).toBe(2);
    expect(added[0].star).toBe(RED);
    // the old call shape still works
    useSkyRocket(g, { x: 1, y: 2, z: 3, face: [0, 1, 0] }, 6);
    expect(added[1].star).toBe(6);
    expect(added[1].stars).toEqual([{ c: [6], s: 0, t: 0, w: 0 }]);
  });

  it('the rocket stays until its followed sparks are gone and is hidden once burst', () => {
    const g = mkGame();
    const r = rocketWith([{ c: [RED], s: 0, t: 1, w: 0 }]);
    const m = { position: { set() {} }, visible: true };
    r.renderUpdate(m, 0, 0, 0);
    expect(m.visible).toBe(true);
    r.burst(g, rng(2));
    r.renderUpdate(m, 0, 0, 0);
    expect(m.visible).toBe(false);
    expect(r.dead).toBe(false);
  });
});

describe('sounds', () => {
  it('the new burst sounds are played by the audio engine and captioned', async () => {
    const fs = await import('node:fs');
    const audio = fs.readFileSync(new URL('../src/audio/audio.js', import.meta.url), 'utf8');
    const caps = fs.readFileSync(new URL('../src/ui/accessibility.js', import.meta.url), 'utf8');
    for (const n of ['rocket_blast', 'rocket_twinkle']) {
      expect(audio).toContain(`case '${n}'`);
      expect(caps).toContain(`${n}:`);
    }
  });
});

describe('animated tidestone', () => {
  const pix = (n) => Array.from(texturePixels(n));
  it('has TIDE_FRAMES pre-painted frames in consecutive texture layers, appended after the others', () => {
    expect(TIDE_FRAMES).toBeGreaterThanOrEqual(4);
    expect(TIDE_FRAMES).toBeLessThanOrEqual(16); // a small number of frames
    const f0 = texId('tidestone_f0');
    expect(f0).toBeGreaterThan(texId('tidestone'));
    for (let i = 0; i < TIDE_FRAMES; i++) expect(texId('tidestone_f' + i)).toBe(f0 + i);
    expect(TEX_NAMES[f0 + TIDE_FRAMES - 1]).toBe('tidestone_f' + (TIDE_FRAMES - 1));
    expect(texId('tidestone_f' + TIDE_FRAMES)).toBeUndefined();
    expect(texId('mangrove_propagule_hanging')).toBeLessThan(f0);
  });
  it('the still texture is frame 0, and the frames differ but are the same stone', () => {
    expect(pix('tidestone')).toEqual(pix('tidestone_f0'));
    const frames = Array.from({ length: TIDE_FRAMES }, (_, i) => pix('tidestone_f' + i));
    for (let i = 1; i < TIDE_FRAMES; i++) expect(frames[i]).not.toEqual(frames[0]);
    // every frame is fully opaque and close to the base mottling: the average colour barely moves
    const avg = (p) => [0, 1, 2].map((c) => { let s = 0; for (let i = c; i < p.length; i += 4) s += p[i]; return s / 256; });
    const a0 = avg(frames[0]);
    for (const f of frames) {
      for (let i = 3; i < f.length; i += 4) expect(f[i]).toBe(255);
      avg(f).forEach((v, c) => expect(Math.abs(v - a0[c])).toBeLessThan(10));
    }
    // consecutive frames are close to each other (a slow shimmer, not flicker), the loop closes smoothly
    const diff = (p, q) => p.reduce((s, v, i) => s + Math.abs(v - q[i]), 0) / p.length;
    for (let i = 0; i < TIDE_FRAMES; i++) expect(diff(frames[i], frames[(i + 1) % TIDE_FRAMES])).toBeLessThan(diff(frames[0], frames[TIDE_FRAMES / 2]) + 1e-9);
  });
  it('the other tidestone textures stay still', () => {
    expect(texId('tidestone_bricks_f0')).toBeUndefined();
    expect(texId('dark_tidestone_f0')).toBeUndefined();
  });
  it('the terrain shader swaps the frames from the time uniform, without remeshing', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../src/render/terrainMaterial.js', import.meta.url), 'utf8');
    expect(src).toContain('uTide: { value: texId(\'tidestone\') }');
    expect(src).toContain('uTideFrames: { value: texId(\'tidestone_f0\') }');
    expect(src).toMatch(/tile = uTideFrames \+ mod\(floor\(uTime \* 2\.0\)/);
    // the mesher keeps emitting the still tile (the swap happens per fragment)
    const mesher = fs.readFileSync(new URL('../src/world/mesher.js', import.meta.url), 'utf8');
    expect(mesher).not.toContain('tidestone_f');
  });
});
