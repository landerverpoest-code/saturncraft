// The world border (world/border.js).
import { describe, it, expect } from 'vitest';
import { WorldBorder, enforceBorder, borderCommand, borderAllows, BORDER_MAX, BORDER_GRACE } from '../src/world/border.js';
import { runCommand, CHEAT_COMMANDS, HELP } from '../src/ui/commands.js';
import { WORLD_COMMANDS } from '../src/net/protocol.js';
import { BYPASSES_ARMOR } from '../src/player/armor.js';
import { MobSpawner } from '../src/mobs/spawner.js';
import { CATEGORY } from '../src/mobs/mobTypes.js';
import { BIOME } from '../src/world/biomes.js';
import { B } from '../src/world/blocks.js';
import { Interaction } from '../src/player/interaction.js';

describe('world border', () => {
  it('is off by default and saves as nothing', () => {
    const b = new WorldBorder();
    expect(b.active).toBe(false);
    expect(b.save()).toBe(null);
    expect(enforceBorder(b, 1e6, -1e6, 0)).toEqual({ x: 1e6, z: -1e6, hurt: 0 });
  });

  it('measures, contains and clamps around its centre', () => {
    const b = new WorldBorder();
    b.setCenter(100, -50); b.set(40);
    expect(b.half).toBe(20);
    expect(b.contains(119, -31)).toBe(true);
    expect(b.contains(121, -50)).toBe(false);
    expect(b.outside(125, -50)).toBe(5);
    expect(b.outside(100, -50)).toBe(-20);
    expect(b.clamp(500, -500, 0.5)).toEqual([119.5, -69.5]);
  });

  it('moves to a new width over time, linearly', () => {
    const b = new WorldBorder();
    b.set(100);
    b.set(20, 4); // 80 ticks
    expect(b.moving).toBe(-1);
    for (let i = 0; i < 40; i++) b.tick();
    expect(b.size).toBeCloseTo(60, 6);
    for (let i = 0; i < 40; i++) b.tick();
    expect(b.size).toBe(20);
    expect(b.moving).toBe(0);
    b.tick();
    expect(b.size).toBe(20);
    b.set(30, 1);
    expect(b.moving).toBe(1);
  });

  it('stops a walker at the wall and hurts one it has closed over', () => {
    const b = new WorldBorder();
    b.set(20);
    expect(enforceBorder(b, 5, 5, 0)).toEqual({ x: 5, z: 5, hurt: 0 });
    const pushed = enforceBorder(b, 10.4, 3, 0);
    expect(pushed.x).toBeCloseTo(9.7, 6); expect(pushed.z).toBe(3); expect(pushed.hurt).toBe(0);
    const far = enforceBorder(b, 10 + BORDER_GRACE + 2, 0, 20);
    expect(far.x).toBe(10 + BORDER_GRACE + 2);
    expect(far.hurt).toBe(1);
    expect(enforceBorder(b, 10 + BORDER_GRACE + 2, 0, 21).hurt).toBe(0); // once a second
    expect(enforceBorder(b, 10 + 16, 0, 40).hurt).toBe(3);
    expect(WorldBorder.damage(0)).toBe(0);
    expect(BYPASSES_ARMOR.has('border')).toBe(true);
  });

  it('round-trips through a save, mid-move too, and shrugs off junk', () => {
    const b = new WorldBorder();
    b.setCenter(8, 9); b.set(200); b.set(50, 10);
    for (let i = 0; i < 30; i++) b.tick();
    const c = new WorldBorder();
    c.load(JSON.parse(JSON.stringify(b.save())));
    expect(c.size).toBeCloseTo(b.size, 9);
    expect([c.cx, c.cz, c.to, c.left]).toEqual([8, 9, 50, 170]);
    for (let i = 0; i < 170; i++) { b.tick(); c.tick(); }
    expect(c.size).toBe(50);
    const d = new WorldBorder();
    d.load({ cx: 'a', size: NaN, left: -4 });
    expect(d.active).toBe(false);
    d.load({ size: 0.001 });
    expect(d.size).toBe(1);
    d.load(null);
    expect(d.size).toBe(BORDER_MAX);
  });

  it('is run by /worldborder', () => {
    const b = new WorldBorder();
    expect(borderCommand(b, [])).toContain('no border');
    expect(borderCommand(b, ['set', '64'])).toContain('now 64 blocks wide');
    expect(b.size).toBe(64);
    expect(borderCommand(b, ['add', '-14'])).toContain('now 50');
    expect(borderCommand(b, ['center', 'here'], { x: 12.7, z: -3.2 })).toContain('12.5, -3.5');
    expect([b.cx, b.cz]).toEqual([12.5, -3.5]);
    expect(borderCommand(b, ['center', '5', 'x'])).toContain('Usage');
    expect(borderCommand(b, ['set', '10', '30'])).toContain('over 30 s');
    expect(borderCommand(b, ['get'])).toContain('closing in on 10');
    expect(borderCommand(b, ['set', '0'])).toContain('can be 1 to');
    expect(borderCommand(b, ['off'])).toContain('off');
    expect(b.active).toBe(false);
    expect(borderCommand(b, ['spin'])).toContain('Usage');
  });

  it('closing a border that was off starts just outside the caller', () => {
    const b = new WorldBorder();
    borderCommand(b, ['set', '20', '60'], { x: 300, z: 10 });
    expect(b.active).toBe(true);
    expect(b.contains(300, 10)).toBe(true);
    expect(b.size).toBeLessThan(1000);
    expect(b.to).toBe(20);
  });

  it('is a cheat and a world command, listed in the help', () => {
    expect(CHEAT_COMMANDS.has('worldborder')).toBe(true);
    expect(WORLD_COMMANDS.has('worldborder')).toBe(true);
    expect(HELP.join(' ')).toContain('/worldborder');
    const game = { border: new WorldBorder(), player: { x: 0, z: 0 }, settings: {}, allowCheats: true };
    expect(runCommand(game, '/worldborder set 32')).toContain('32 blocks wide');
    expect(game.border.size).toBe(32);
  });
});

describe('the border bounds the makers', () => {
  it('borderAllows: always without an active border, else only inside the wall', () => {
    const b = new WorldBorder();
    expect(borderAllows(b, 1e6, 1e6)).toBe(true);
    expect(borderAllows(null, 5, 5)).toBe(true);
    expect(borderAllows(undefined, 5, 5)).toBe(true);
    b.set(20);
    expect(borderAllows(b, 9.5, -9.5)).toBe(true);
    expect(borderAllows(b, 10.5, 0)).toBe(false);
    expect(borderAllows(b, 0, -40)).toBe(false);
  });

  it('natural spawning never picks a spot outside an active border', () => {
    const border = new WorldBorder();
    const spawned = [];
    const world = { dimension: 'overworld', heightAt: () => 63, getBlock: (x, y) => (y < 64 ? B.GRASS : B.AIR), biomeAt: () => BIOME.PLAINS, isLoaded: () => true };
    const game = { world, border, player: { x: -10, y: 64, z: 0 }, entities: { list: [] } };
    const sp = new MobSpawner(game);
    sp.validSpawn = () => true;
    sp.spawnMob = (type, x, y, z) => { spawned.push([x, z]); return { yaw: 0 }; };
    for (let i = 0; i < 400; i++) sp.attempt(2, 0, CATEGORY.CREATURE, true);
    expect(spawned.length).toBeGreaterThan(10); // without a border they spawn freely
    spawned.length = 0;
    border.set(80); // wall at x = 40, through the middle of chunk 2
    for (let i = 0; i < 400; i++) sp.attempt(2, 0, CATEGORY.CREATURE, true);
    expect(spawned.length).toBeGreaterThan(2);
    for (const [x, z] of spawned) expect(border.contains(x, z)).toBe(true);
    border.setCenter(1000, 1000); // the whole area is outside now
    spawned.length = 0;
    for (let i = 0; i < 100; i++) sp.attempt(2, 0, CATEGORY.CREATURE, true);
    expect(spawned.length).toBe(0);
  });

  it('a player can neither break nor place outside an active border', () => {
    const border = new WorldBorder(); border.set(20);
    const set = [];
    const world = { getBlock: () => B.DIRT, getMeta: () => 0, setBlockUrgent: (...a) => set.push(a) };
    const game = { world, border, player: { gamemode: 'creative', creative: true, inventory: { selectedStack: null }, sneaking: false }, audio: { play() {} }, particles: null, ticks: 0 };
    const ia = new Interaction(game);
    ia.target = { x: 30, y: 64, z: 0, id: B.DIRT, face: [0, 1, 0] };
    ia.mine();
    expect(set.length).toBe(0);
    expect(ia.use()).toBe(false);
    ia.target = { x: 9, y: 64, z: 0, id: B.DIRT, face: [1, 0, 0] }; // the cell beside it is at x 10: past the wall
    expect(ia.use()).toBe(false);
  });
});
