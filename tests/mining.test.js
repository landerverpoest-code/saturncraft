import { describe, it, expect } from 'vitest';
import { breakTicks, canHarvest } from '../src/world/mining.js';
import { B, BLOCKS } from '../src/world/blocks.js';
import { ITEMS, I, HAND } from '../src/world/items.js';

const tool = (key) => ITEMS[I[key.toUpperCase()]].tool;
const secs = (id, t, ctx) => breakTicks(id, t, ctx) / 20;

describe('hardness values', () => {
  it('match the documented table', () => {
    const h = (id) => BLOCKS[id].hardness;
    expect(h(B.STONE)).toBe(1.5); expect(h(B.COBBLESTONE)).toBe(2); expect(h(B.DIRT)).toBe(0.5);
    expect(h(B.GRASS)).toBe(0.6); expect(h(B.SAND)).toBe(0.5); expect(h(B.GRAVEL)).toBe(0.6);
    expect(h(B.OAK_LOG)).toBe(2); expect(h(B.OAK_PLANKS)).toBe(2); expect(h(B.OAK_LEAVES)).toBe(0.2);
    expect(h(B.COAL_ORE)).toBe(3); expect(h(B.DEEP_DIAMOND_ORE)).toBe(4.5); expect(h(B.DEEPSTONE)).toBe(3);
    expect(h(B.OBSIDIAN)).toBe(50); expect(h(B.BEDROCK)).toBe(-1); expect(h(B.GLASS)).toBe(0.3);
    expect(h(B.WORKBENCH)).toBe(2.5); expect(h(B.FURNACE)).toBe(3.5); expect(h(B.TORCH)).toBe(0);
  });
});

describe('break times (seconds)', () => {
  it('stone', () => {
    expect(secs(B.STONE, HAND)).toBe(7.5);
    expect(secs(B.STONE, tool('wood_pickaxe'))).toBe(1.15);
    expect(secs(B.STONE, tool('stone_pickaxe'))).toBe(0.6);
    expect(secs(B.STONE, tool('iron_pickaxe'))).toBe(0.4);
    expect(secs(B.STONE, tool('diamond_pickaxe'))).toBe(0.3);
    expect(secs(B.STONE, tool('gold_pickaxe'))).toBe(0.2);
  });
  it('dirt, logs, obsidian, instant blocks', () => {
    expect(secs(B.DIRT, HAND)).toBe(0.75);
    expect(secs(B.DIRT, tool('wood_shovel'))).toBe(0.4);
    expect(secs(B.OAK_LOG, HAND)).toBe(3);
    expect(secs(B.OAK_LOG, tool('iron_axe'))).toBe(0.5);
    expect(secs(B.OBSIDIAN, tool('diamond_pickaxe'))).toBe(9.4);
    expect(secs(B.OBSIDIAN, tool('iron_pickaxe'))).toBe(41.7); // wrong tier: /100 divisor
    expect(breakTicks(B.TORCH, HAND)).toBe(0);
    expect(breakTicks(B.TALL_GRASS, HAND)).toBe(0);
    expect(breakTicks(B.BEDROCK, tool('diamond_pickaxe'))).toBe(Infinity);
  });
  it('wrong tool type gets no speed bonus', () => {
    expect(secs(B.DIRT, tool('diamond_pickaxe'))).toBe(0.75);
  });
  it('airborne and underwater mining are 5x slower', () => {
    expect(breakTicks(B.DIRT, HAND, { onGround: false })).toBe(75);
    expect(breakTicks(B.DIRT, HAND, { inWater: true, onGround: false })).toBe(375);
  });
  it('swords cut leaves faster', () => {
    expect(breakTicks(B.OAK_LEAVES, tool('iron_sword'))).toBeLessThan(breakTicks(B.OAK_LEAVES, HAND));
  });
  it('harvest tiers', () => {
    expect(canHarvest(B.OBSIDIAN, tool('iron_pickaxe'))).toBe(false);
    expect(canHarvest(B.OBSIDIAN, tool('diamond_pickaxe'))).toBe(true);
    expect(canHarvest(B.GOLD_ORE, tool('stone_pickaxe'))).toBe(false);
    expect(canHarvest(B.GOLD_ORE, tool('iron_pickaxe'))).toBe(true);
    expect(canHarvest(B.COAL_ORE, tool('gold_pickaxe'))).toBe(true);
  });
});

describe('tools', () => {
  it('durability and damage', () => {
    expect(ITEMS[I.WOOD_PICKAXE].durability).toBe(59);
    expect(ITEMS[I.STONE_PICKAXE].durability).toBe(131);
    expect(ITEMS[I.IRON_PICKAXE].durability).toBe(250);
    expect(ITEMS[I.GOLD_PICKAXE].durability).toBe(32);
    expect(ITEMS[I.DIAMOND_PICKAXE].durability).toBe(1561);
    expect(tool('diamond_sword').damage).toBe(7);
    expect(tool('iron_sword').damage).toBe(6);
    expect(tool('wood_sword').attackSpeed).toBe(1.6);
    expect(HAND.damage).toBe(1);
  });
});
