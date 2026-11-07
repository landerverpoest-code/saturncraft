// Visual QA regressions found in a live render: no ring of glass floating over the Lighthouse roof, the Wickling's flame standing on its
// head, and the raid / boss bars clearing the sky clock on a narrow window.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { B } from '../src/world/blocks.js';
import { lighthouseBlock } from '../src/world/lighthouse.js';
import { MODELS } from '../src/mobs/models.js';
import '../src/mobs/shoreMobs.js';

describe('Hermit\'s Lighthouse top', () => {
  const s = { seed: 980333941, dir: 3, cx: 0, cz: 0, y: 64 };

  it('has nothing but air above the lantern (no second glass ring hanging in the sky)', () => {
    for (let h = 22; h <= 24; h++) {
      for (let u = -8; u <= 8; u++) for (let v = -8; v <= 8; v++) {
        const r = lighthouseBlock(s, u, h, v);
        expect(r === null || r[0] === B.AIR, `h=${h} u=${u} v=${v}`).toBe(true);
      }
    }
  });

  it('still has its lamp room walls, roof and lantern', () => {
    expect(lighthouseBlock(s, 4, 14, 0)[0]).toBe(B.LEADED_GLASS);
    expect(lighthouseBlock(s, 0, 16, 0)[0]).toBe(B.RED_CONCRETE);
    expect(lighthouseBlock(s, 0, 21, 0)[0]).toBe(B.LANTERN);
    expect(lighthouseBlock(s, 0, 15, 0)[0]).toBe(B.LIGHTHOUSE_LENS);
  });
});

describe('Wickling model', () => {
  const part = (n) => MODELS.wickling.parts.find((p) => p[0] === n);
  const bottom = (p) => p[2][1] + p[3][1] - p[1][1] / 2;

  it('carries its flame on the crown of its head', () => {
    const head = part('head'), headTop = head[2][1] + head[3][1] + head[1][1] / 2;
    for (const k of ['wick', 'flame', 'flameCore']) {
      const gap = bottom(part(k)) - headTop;
      expect(gap, k).toBeGreaterThanOrEqual(-1);
      expect(gap, k).toBeLessThanOrEqual(1);
    }
    expect(bottom(part('flameCore'))).toBeGreaterThanOrEqual(bottom(part('flame')));
  });
});

describe('boss and raid bars', () => {
  const css = fs.readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');
  it('drop below the sky clock when the window is too narrow to fit beside it', () => {
    expect(css).toMatch(/@media \(max-width: 980px\)[^}]*#bossbar \{ top: 76px/);
  });
  it('are lowered in portrait touch layouts, where the sky clock sits lower', () => {
    expect(css).toMatch(/orientation: portrait[^\n]*body\.touch-on #bossbar \{ top: calc\(100px/);
  });
});
