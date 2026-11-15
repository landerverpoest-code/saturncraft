import { describe, it, expect } from 'vitest';
import { blinkClosed, earTwitch, headTurn, deathTipAngle, deathSink, hurtLean, idleLook, tailWag, walkBob, breathe, hash01 } from '../src/mobs/mobAnim.js';

describe('mob animation maths', () => {
  it('blinks briefly and periodically, deterministically', () => {
    let closed = 0; const N = 6000;
    for (let i = 0; i < N; i++) if (blinkClosed(7, i / 100)) closed++;
    expect(closed / N).toBeGreaterThan(0.01); expect(closed / N).toBeLessThan(0.08);
    expect(blinkClosed(7, 12.34)).toBe(blinkClosed(7, 12.34));
    let diff = false; for (let i = 0; i < 600; i++) if (blinkClosed(1, i / 100) !== blinkClosed(2, i / 100)) diff = true;
    expect(diff).toBe(true);
  });
  it('twitches ears now and then, bounded, mirrored per side', () => {
    let nz = 0, max = 0;
    for (let i = 0; i < 4000; i++) { const a = earTwitch(3, i / 50); if (a) nz++; max = Math.max(max, Math.abs(a)); expect(earTwitch(3, i / 50, -1)).toBeCloseTo(-a); }
    expect(nz).toBeGreaterThan(0); expect(nz).toBeLessThan(1500); expect(max).toBeLessThanOrEqual(0.35 + 1e-9);
  });
  it('clamps head turns', () => {
    const [y, p] = headTurn(3, 10, 1); expect(y).toBeCloseTo(0.9); expect(Math.abs(p)).toBeLessThanOrEqual(0.45);
    expect(headTurn(-0.3, 0, 3)[0]).toBeCloseTo(-0.3);
    expect(headTurn(Math.PI * 2 + 0.2, 0, 3)[0]).toBeCloseTo(0.2);
    for (let i = 0; i < 200; i++) expect(Math.abs(idleLook(i, i * 0.37))).toBeLessThan(0.7);
  });
  it('tips over onto its side and sinks on death', () => {
    expect(deathTipAngle(1, 0)).toBeGreaterThan(0);
    expect(deathTipAngle(10, 0)).toBeCloseTo(Math.PI / 2);
    expect(deathTipAngle(30, 0)).toBeCloseTo(Math.PI / 2);
    expect(deathSink(0)).toBe(0); expect(deathSink(20, 0, 2)).toBeGreaterThan(deathSink(5, 0, 2));
  });
  it('small helpers stay in range', () => {
    expect(hurtLean(0)).toBe(0); expect(hurtLean(10)).toBeLessThan(0);
    expect(tailWag(1, 1, false, false)).toBe(0); expect(Math.abs(tailWag(1, 1, true, false))).toBeLessThanOrEqual(0.45);
    expect(walkBob(3, 0)).toBe(0); expect(walkBob(3, 1)).toBeLessThanOrEqual(0.035);
    expect(Math.abs(breathe(5, 3) - 1)).toBeLessThanOrEqual(0.015);
    const h = hash01(5, 9); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1);
  });
});
