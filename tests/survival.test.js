import { describe, it, expect } from 'vitest';
import { HungerManager, EXHAUSTION } from '../src/player/survival.js';
import { ITEMS, I } from '../src/world/items.js';

function fakePlayer(health = 20) {
  return { health, heal(n) { this.health = Math.min(20, this.health + n); }, hurt(n) { this.health -= n; } };
}

describe('hunger', () => {
  it('starts at 20 food / 5 saturation', () => {
    const h = new HungerManager();
    expect(h.food).toBe(20); expect(h.saturation).toBe(5);
  });
  it('exhaustion above 4 drains saturation first, then food', () => {
    const h = new HungerManager();
    const p = fakePlayer();
    h.saturation = 1;
    h.addExhaustion(4.1); h.tick(p);
    expect(h.saturation).toBe(0); expect(h.food).toBe(20);
    h.addExhaustion(4.1); h.tick(p);
    expect(h.food).toBe(19);
  });
  it('exhaustion costs match the documented values', () => {
    expect(EXHAUSTION.SPRINT_PER_M).toBe(0.1);
    expect(EXHAUSTION.JUMP).toBe(0.05);
    expect(EXHAUSTION.SPRINT_JUMP).toBe(0.2);
    expect(EXHAUSTION.ATTACK).toBe(0.1);
    expect(EXHAUSTION.REGEN).toBe(6);
    expect(EXHAUSTION.BREAK_BLOCK).toBe(0.005);
  });
  it('heals 1 HP per 80 ticks when food >= 18 and saturation is empty', () => {
    const h = new HungerManager();
    h.food = 18; h.saturation = 0;
    const p = fakePlayer(10);
    for (let i = 0; i < 79; i++) h.tick(p);
    expect(p.health).toBe(10);
    h.tick(p);
    expect(p.health).toBe(11);
    expect(h.exhaustion).toBe(6); // consumed in 4-point steps on later ticks
  });
  it('saturated full food heals fast (every 10 ticks)', () => {
    const h = new HungerManager();
    h.food = 20; h.saturation = 20;
    const p = fakePlayer(10);
    for (let i = 0; i < 10; i++) h.tick(p);
    expect(p.health).toBe(11);
  });
  it('does not heal below 18 food', () => {
    const h = new HungerManager();
    h.food = 17; h.saturation = 0;
    const p = fakePlayer(10);
    for (let i = 0; i < 400; i++) h.tick(p);
    expect(p.health).toBe(10);
  });
  it('starvation stops at half a heart on Normal', () => {
    const h = new HungerManager();
    h.food = 0; h.saturation = 0;
    const p = fakePlayer(5);
    for (let i = 0; i < 80 * 10; i++) h.tick(p);
    expect(p.health).toBe(1);
  });
  it('eating restores hunger and caps saturation at the food level', () => {
    const h = new HungerManager();
    h.food = 2; h.saturation = 0;
    const steak = ITEMS[I.STEAK].food;
    h.eat(steak.hunger, steak.saturation);
    expect(h.food).toBe(10);
    expect(h.saturation).toBe(10);
  });
  it('food values', () => {
    expect(ITEMS[I.STEAK].food).toMatchObject({ hunger: 8, saturation: 12.8 });
    expect(ITEMS[I.COOKED_PORK].food).toMatchObject({ hunger: 8, saturation: 12.8 });
    expect(ITEMS[I.APPLE].food).toMatchObject({ hunger: 4, saturation: 2.4 });
    expect(ITEMS[I.ROTTEN_FLESH].food).toMatchObject({ hunger: 4, saturation: 0.8 });
    expect(ITEMS[I.ROTTEN_FLESH].food.effect.chance).toBe(0.8);
    expect(ITEMS[I.RAW_CHICKEN].food.effect.chance).toBe(0.3);
  });
});
