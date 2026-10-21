import { describe, it, expect } from 'vitest';
import { B } from '../src/world/blocks.js';
import { mapOrigin, newMap, updateMap, encodeMap, decodeMap, MAP_SIZE } from '../src/world/maps.js';

const world = (h = (x, z) => 64, top = () => B.GRASS) => ({
  heightAt: h,
  getBlock: (x, y, z) => (y === h(x, z) ? top(x, z) : y < h(x, z) ? B.STONE : 0),
  biomeAt: () => 1,
});

describe('maps', () => {
  it('squares follow the reference grid', () => {
    expect(mapOrigin(0)).toBe(-64);
    expect(mapOrigin(63)).toBe(-64);
    expect(mapOrigin(64)).toBe(64);
    expect(mapOrigin(-65)).toBe(-192);
    const m = newMap(1, 100, -10);
    expect([m.x0, m.z0]).toEqual([64, -64]);
  });
  it('draws only within 64 blocks of the holder', () => {
    const m = newMap(1, 0, 0);
    updateMap(m, world(), -64, -64, MAP_SIZE * MAP_SIZE);
    expect(m.filled).toBeGreaterThan(3000);
    expect(m.filled).toBeLessThan(MAP_SIZE * MAP_SIZE / 2);
    const far = m.px.subarray((127 * MAP_SIZE + 127) * 3, (127 * MAP_SIZE + 127) * 3 + 3);
    expect([...far]).toEqual([0, 0, 0]);
  });
  it('slopes and water depth shade the colour', () => {
    const m = newMap(1, 0, 0);
    updateMap(m, world((x, z) => (z > 0 ? 70 : 64)), 0, 0, MAP_SIZE * MAP_SIZE);
    const at = (x, z) => m.px[((z + 64) * MAP_SIZE + x + 64) * 3 + 1];
    expect(at(0, 1)).toBeGreaterThan(at(0, 5)); // the step up towards the south is lit
    const w = newMap(2, 0, 0);
    const deep = (x) => (x > 0 ? 10 : 1);
    updateMap(w, { heightAt: () => 64, getBlock: (x, y) => (y <= 64 && y > 64 - deep(x) ? B.WATER : y <= 64 ? B.SAND : 0), biomeAt: () => 1 }, 0, 0, MAP_SIZE * MAP_SIZE);
    const blue = (x) => w.px[(64 * MAP_SIZE + x + 64) * 3 + 2];
    expect(blue(-5)).toBeGreaterThan(blue(5));
  });
  it('round-trips through the save format', () => {
    const m = newMap(77, 0, 0);
    updateMap(m, world(), 0, 0, 5000);
    const d = decodeMap(JSON.parse(JSON.stringify(encodeMap(m))));
    expect(d.id).toBe(77);
    expect(d.filled).toBe(m.filled);
    expect(Buffer.from(d.px).equals(Buffer.from(m.px))).toBe(true);
  });
});
