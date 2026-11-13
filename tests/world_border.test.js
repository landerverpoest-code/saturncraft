// The world border (world/border.js).
import { describe, it, expect } from 'vitest';
import { WorldBorder, enforceBorder, borderCommand, BORDER_MAX, BORDER_GRACE } from '../src/world/border.js';
import { runCommand, CHEAT_COMMANDS, HELP } from '../src/ui/commands.js';
import { WORLD_COMMANDS } from '../src/net/protocol.js';
import { BYPASSES_ARMOR } from '../src/player/armor.js';

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
