import { describe, it, expect } from 'vitest';
import { B, BLOCKS, SHAPE, STONE_SETS, WALL_SETS, BLOCK_LIMIT } from '../src/world/blocks.js';
import { craft } from '../src/player/crafting.js';
import { stonecutterOutputs } from '../src/world/workstations.js';
import { SHAPED_COLLISION, collisionBoxes } from '../src/world/shapes.js';
import { GHOST_TICKS, GHOST_SIZE, ghostPose, ghostFacePixels } from '../src/ui/ghostFace.js';
import { needsFatigue, FATIGUE_AMP, FATIGUE_TICKS } from '../src/mobs/oceanMobs.js';

const S = (id) => ({ id, count: 1 });
const grid = (...cells) => cells.map((c) => (c == null ? null : S(c)));

describe('tidestone slabs, stairs and walls', () => {
  const sets = [['TIDESTONE', 'TIDESTONE', 'Tidestone'], ['TIDESTONE_BRICK', 'TIDESTONE_BRICKS', 'Tidestone Brick'], ['DARK_TIDESTONE', 'DARK_TIDESTONE', 'Dark Tidestone']];
  it('appends nine new ids after the existing blocks and keeps them consecutive', () => {
    const ids = sets.flatMap(([k]) => [B[k + '_SLAB'], B[k + '_STAIRS'], B[k + '_WALL']]);
    expect(ids[0]).toBe(B.CALIBRATED_HUSH_SENSOR + 1);
    ids.forEach((id, i) => { expect(id).toBe(ids[0] + i); expect(id).toBeLessThan(BLOCK_LIMIT); });
    expect(B.CALIBRATED_HUSH_SENSOR).toBeGreaterThan(B.OMINOUS_SPAWNER); // earlier ids did not move
  });
  it('copies the stone material and gets the right shapes', () => {
    for (const [k, baseKey, name] of sets) {
      const base = BLOCKS[B[baseKey]];
      for (const [suffix, shape] of [['_SLAB', SHAPE.SLAB], ['_STAIRS', SHAPE.STAIRS], ['_WALL', SHAPE.WALL]]) {
        const d = BLOCKS[B[k + suffix]];
        expect(d.shape).toBe(shape);
        expect(d.hardness).toBe(base.hardness);
        expect(d.tool).toBe(base.tool);
        expect(d.tex.top).toBe(base.tex.top);
        expect(d.name.startsWith(name)).toBe(true);
        expect(SHAPED_COLLISION[d.id]).toBe(1);
      }
      expect(BLOCKS[B[k + '_SLAB']].drops).toBe('slab');
    }
    expect(STONE_SETS.some((s) => s[1] === B.DARK_TIDESTONE_SLAB && s[2] === B.DARK_TIDESTONE_STAIRS)).toBe(true);
    expect(WALL_SETS.length).toBe(3);
  });
  it('walls have a tall post collision box and slabs a half block', () => {
    const w = collisionBoxes(B.TIDESTONE_WALL, 0, null, 0, 0, 0);
    expect(Math.max(...w.map((b) => b[4]))).toBeCloseTo(1.5);
    const s = collisionBoxes(B.TIDESTONE_SLAB, 0, null, 0, 0, 0);
    expect(s[0][4]).toBeCloseTo(0.5);
  });
  it('craft 6 slabs, 4 stairs and 6 walls', () => {
    for (const [mat, slab, stairs] of [[B.TIDESTONE, B.TIDESTONE_SLAB, B.TIDESTONE_STAIRS], [B.TIDESTONE_BRICKS, B.TIDESTONE_BRICK_SLAB, B.TIDESTONE_BRICK_STAIRS], [B.DARK_TIDESTONE, B.DARK_TIDESTONE_SLAB, B.DARK_TIDESTONE_STAIRS]]) {
      expect(craft(grid(mat, mat, mat, null, null, null, null, null, null), 3)).toEqual({ id: slab, count: 6 });
      expect(craft(grid(mat, null, null, mat, mat, null, mat, mat, mat), 3)).toEqual({ id: stairs, count: 4 });
    }
    expect(craft(grid(B.TIDESTONE, B.TIDESTONE, B.TIDESTONE, B.TIDESTONE, B.TIDESTONE, B.TIDESTONE, null, null, null), 3)).toEqual({ id: B.TIDESTONE_WALL, count: 6 });
    expect(craft(grid(B.DARK_TIDESTONE, B.DARK_TIDESTONE, B.DARK_TIDESTONE, B.DARK_TIDESTONE, B.DARK_TIDESTONE, B.DARK_TIDESTONE, null, null, null), 3)).toEqual({ id: B.DARK_TIDESTONE_WALL, count: 6 });
  });
  it('the stonecutter cuts tidestone into bricks, slabs, stairs and walls', () => {
    const out = stonecutterOutputs(B.TIDESTONE);
    const ids = out.map((o) => o.id);
    for (const id of [B.TIDESTONE_BRICKS, B.TIDESTONE_SLAB, B.TIDESTONE_BRICK_SLAB, B.TIDESTONE_STAIRS, B.TIDESTONE_BRICK_STAIRS, B.TIDESTONE_WALL, B.TIDESTONE_BRICK_WALL]) expect(ids).toContain(id);
    expect(out.find((o) => o.id === B.TIDESTONE_SLAB).count).toBe(2);
    expect(stonecutterOutputs(B.DARK_TIDESTONE).map((o) => o.id)).toEqual([B.DARK_TIDESTONE_SLAB, B.DARK_TIDESTONE_STAIRS, B.DARK_TIDESTONE_WALL]);
  });
});

describe("Elder Deepeye's ghost face", () => {
  it('the pose rushes in, grows, trembles and fades out within 60 ticks', () => {
    expect(GHOST_TICKS).toBe(60);
    expect(ghostPose(-1).alpha).toBe(0);
    expect(ghostPose(GHOST_TICKS).alpha).toBe(0);
    expect(ghostPose(0).alpha).toBe(0);
    const early = ghostPose(5), mid = ghostPose(30), late = ghostPose(58);
    expect(mid.alpha).toBeGreaterThan(0.8);
    expect(early.alpha).toBeGreaterThan(0);
    expect(late.alpha).toBeLessThan(mid.alpha);
    expect(mid.scale).toBeGreaterThan(early.scale);
    expect(late.scale).toBeGreaterThan(mid.scale);
    for (let t = 0; t < GHOST_TICKS; t++) { const p = ghostPose(t); expect(p.alpha).toBeLessThanOrEqual(1); expect(Math.abs(p.dx)).toBeLessThan(0.02); }
  });
  it('the face map is a mirrored picture with an eye in the middle', () => {
    const px = ghostFacePixels(), N = GHOST_SIZE;
    expect(px.length).toBe(N * N);
    let filled = 0, mirrored = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (px[y * N + x]) filled++;
      if ((px[y * N + x] === 0) === (px[y * N + (N - 1 - x)] === 0)) mirrored++;
    }
    expect(filled).toBeGreaterThan(N * N * 0.3);
    expect(mirrored / (N * N)).toBeGreaterThan(0.9);
    expect(px[0]).toBe(0);                       // the corner stays clear
    expect(px[23 * N + 24]).toBe(8);             // the pupil
    expect(px[23 * N + 24 - 8]).toBe(6);         // the white of the eye
    expect(ghostFacePixels()).toBe(px);          // drawn once
  });
  it('only a curse that lands (not on creative players, not while level III runs) shows it', () => {
    expect(needsFatigue({}, false)).toBe(true);
    expect(needsFatigue({}, true)).toBe(false);
    expect(needsFatigue({ mining_fatigue: { amp: FATIGUE_AMP, ticks: FATIGUE_TICKS } }, false)).toBe(false);
  });
});

describe('wording', () => {
  it('uses none of the forbidden words in the new names', () => {
    const names = WALL_SETS.map((w) => BLOCKS[w[1]].name);
    const banned = new RegExp(['mine' + 'craft', 'neth' + 'er', 'red' + 'stone'].join('|'), 'i');
    for (const n of names) expect(banned.test(n)).toBe(false);
  });
});
