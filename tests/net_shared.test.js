// Multiplayer messages for shared entities, containers and commands (no network needed).
import { describe, it, expect } from 'vitest';
import {
  packEntity, unpackEntity, containerSlots, diffSlots, applySlotChanges, containerState, loadContainerState,
  sameStack, roomFor, WORLD_COMMANDS, commandName, encodeMessage, Reassembler,
} from '../src/net/protocol.js';
import { maxStack } from '../src/world/items.js';
import { I } from '../src/world/items.js';
import { B } from '../src/world/blocks.js';

const wire = (x) => JSON.parse(JSON.stringify(x));

describe('entity snapshots', () => {
  it('round-trips dropped items, orbs, arrows, boats and falling blocks', () => {
    const item = { kind: 'item', id: 7, x: 1.234, y: 70, z: -3, stack: { id: I.ARROW, count: 5, damage: 0 }, pickupDelay: 3 };
    expect(unpackEntity(wire(packEntity(item)))).toMatchObject({ kind: 'item', id: 7, x: 1.23, stack: { id: I.ARROW, count: 5 }, delayed: true });
    const orb = { kind: 'xp', id: 8, x: 0, y: 64, z: 0, value: 17 };
    expect(unpackEntity(wire(packEntity(orb)))).toMatchObject({ kind: 'xp', value: 17 });
    const arrow = { kind: 'arrow', id: 9, x: 2, y: 65, z: 2, vx: 0.5, vy: -0.25, vz: 0, stuck: true, pickup: true };
    expect(unpackEntity(wire(packEntity(arrow)))).toMatchObject({ kind: 'arrow', stuck: true, pickup: true, vy: -0.25 });
    const boat = { kind: 'boat', id: 10, x: 5, y: 62, z: 5, yaw: 1.5, hitTime: 4 };
    expect(unpackEntity(wire(packEntity(boat, () => 3)))).toMatchObject({ kind: 'boat', yaw: 1.5, hitTime: 4, rider: 3 });
    expect(unpackEntity(wire(packEntity(boat)))).toMatchObject({ rider: -1 });
    const sand = { kind: 'falling', id: 11, x: 5.5, y: 80, z: 5.5, blockId: B.SAND };
    expect(unpackEntity(wire(packEntity(sand)))).toMatchObject({ kind: 'falling', blockId: B.SAND });
  });
  it('wraps mobs and rejects garbage', () => {
    const mob = { kind: 'mob', id: 1000001, type: 'howler', x: 1, y: 64, z: 1, yaw: 0, headPitch: 0, health: 20, hurtTime: 0, deathTime: 0, body: { onGround: true }, tamed: true, sitting: true, woolColor: 0, fuse: 0, age: 0 };
    expect(unpackEntity(wire(packEntity(mob)))).toMatchObject({ kind: 'mob', id: 1000001, type: 'howler', tamed: true, sitting: true });
    expect(packEntity({ kind: 'eye' })).toBe(null);
    expect(unpackEntity(['z', 1])).toBe(null);
    expect(unpackEntity(['i', 1, 'x', 0, 0])).toBe(null);
  });
});

describe('shared chests and furnaces', () => {
  const chest = () => ({ x: 0, y: 64, z: 0, slots: Array.from({ length: 27 }, (_, i) => (i === 0 ? { id: B.COBBLESTONE, count: 10, damage: 0 } : null)) });

  it('diffs a click into slot changes the host can replay', () => {
    const c = chest();
    const before = containerSlots('chest', c);
    c.slots[0] = null; c.slots[5] = { id: B.COBBLESTONE, count: 10, damage: 0 };
    const ch = diffSlots(before, containerSlots('chest', c));
    expect(ch).toEqual([[0, { id: B.COBBLESTONE, count: 10, damage: 0 }, null], [5, null, { id: B.COBBLESTONE, count: 10, damage: 0 }]]);
    const host = chest();
    expect(applySlotChanges('chest', host, wire(ch))).toBe(true);
    expect(host.slots[0]).toBe(null);
    expect(host.slots[5]).toEqual({ id: B.COBBLESTONE, count: 10, damage: 0 });
  });

  it('refuses a change when someone else took the stack first (no duplication)', () => {
    const host = chest();
    const take = [[0, { id: B.COBBLESTONE, count: 10, damage: 0 }, null]];
    expect(applySlotChanges('chest', host, take)).toBe(true);   // player A takes the stack
    expect(applySlotChanges('chest', host, take)).toBe(false);  // player B saw it too: refused
    expect(host.slots.every((s) => s === null)).toBe(true);
  });

  it('applies all changes of a click or none', () => {
    const host = chest();
    const ok = applySlotChanges('chest', host, [[1, null, { id: B.DIRT, count: 1, damage: 0 }], [0, { id: B.DIRT, count: 3, damage: 0 }, null]]);
    expect(ok).toBe(false);
    expect(host.slots[1]).toBe(null);
    expect(applySlotChanges('chest', host, [[99, null, null]])).toBe(false);
    expect(applySlotChanges('chest', host, [[1, null, { id: B.DIRT, count: 999 }]])).toBe(false);
  });

  it('handles furnaces (input, fuel, output) and their progress', () => {
    const f = { input: { id: I.RAW_PORK ?? B.SAND, count: 2, damage: 0 }, fuel: null, output: null, burnTime: 50, burnTotal: 100, cookTime: 30 };
    expect(containerSlots('furnace', f).length).toBe(3);
    expect(applySlotChanges('furnace', f, [[1, null, { id: I.COAL, count: 4, damage: 0 }]])).toBe(true);
    expect(f.fuel).toEqual({ id: I.COAL, count: 4, damage: 0 });
    const mirror = { input: null, fuel: null, output: null };
    loadContainerState('furnace', mirror, wire(containerState('furnace', f)));
    expect(mirror.fuel).toEqual({ id: I.COAL, count: 4, damage: 0 });
    expect(mirror.cookTime).toBe(30);
    expect(mirror.burnTotal).toBe(100);
  });

  it('compares stacks', () => {
    expect(sameStack(null, undefined)).toBe(true);
    expect(sameStack({ id: 1, count: 2 }, { id: 1, count: 2, damage: 0 })).toBe(true);
    expect(sameStack({ id: 1, count: 2 }, { id: 1, count: 3 })).toBe(false);
  });
});

describe('pickups and commands', () => {
  it('computes room in an inventory before asking for an item', () => {
    const slots = new Array(36).fill({ id: B.DIRT, count: 64 });
    expect(roomFor(slots, { id: B.STONE }, maxStack)).toBe(0);
    slots[3] = { id: B.STONE, count: 60 };
    expect(roomFor(slots, { id: B.STONE }, maxStack)).toBe(4);
    slots[4] = null;
    expect(roomFor(slots, { id: B.STONE }, maxStack)).toBe(68);
    expect(roomFor(slots, { id: B.STONE }, maxStack, false)).toBe(64);
  });
  it('sends world commands to the host and keeps player commands local', () => {
    expect(commandName('/time set day')).toBe('time');
    expect(commandName('  Weather rain')).toBe('weather');
    for (const c of ['time', 'weather', 'gamerule', 'summon', 'dimension']) expect(WORLD_COMMANDS.has(c)).toBe(true);
    for (const c of ['give', 'tp', 'gamemode', 'kill', 'heal']) expect(WORLD_COMMANDS.has(c)).toBe(false);
  });
  it('carries a dimension switch with its edited chunks in one (fragmented) message', () => {
    const msg = { t: 'dim', dim: 'cinderdeep', x: 1, y: 64, z: 2, chunks: [[123, { blocks: { ty: 'Uint8Array', b: 'A'.repeat(200000) } }]] };
    const parts = encodeMessage(msg);
    expect(parts.length).toBeGreaterThan(1);
    const re = new Reassembler();
    let out = null;
    for (const p of parts) out = re.push(p) || out;
    expect(out).toEqual(msg);
  });
});
