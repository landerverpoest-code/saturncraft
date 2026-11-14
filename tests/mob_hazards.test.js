// Mobs in the pack-7 ground hazards: Driftsnow frost and Scaldrock heat (mobs/mob.js hazardTick).
import { describe, it, expect } from 'vitest';
import { Mob } from '../src/mobs/mob.js';
import '../src/mobs/cinderMobs.js'; // registers the Capwalker
import { MOBS } from '../src/mobs/mobTypes.js';
import { B } from '../src/world/blocks.js';
import { FROST } from '../src/world/coldCurrents.js';

const gameOn = (floor) => ({ ticks: 0, world: { getBlock: (x, y, z) => (y < 64 ? floor : B.AIR) } });
const mobIn = (type) => { const m = new Mob(type, 0.5, 64, 0.5); m.body.onGround = true; m.health = m.maxHp = 100; return m; };
/** Run `n` ticks of the hazards and return the damage the mob took. */
function run(m, g, n) {
  const before = m.health;
  for (let i = 0; i < n; i++) { g.ticks++; if (m.invulnerable > 0) m.invulnerable--; m.hazardTick(g); }
  return before - m.health;
}
const plain = () => Object.keys(MOBS).find((k) => !MOBS[k].fireImmune && !MOBS[k].flying && !MOBS[k].coldProof);

describe('mobs in Driftsnow', () => {
  it('build frost, and bite once every FROST.every ticks once it is full', () => {
    const m = mobIn(plain()); m.body.inDrift = true;
    const g = gameOn(B.STONE);
    expect(run(m, g, FROST.full - 5)).toBe(0);
    expect(m.frost).toBeLessThan(FROST.full);
    run(m, g, 5); // frost is full now
    expect(m.frost).toBe(FROST.full);
    const hit = run(m, g, FROST.every * 3);
    expect(hit).toBeGreaterThanOrEqual(2);
    expect(hit).toBeLessThanOrEqual(3);
  });

  it('thaw outside', () => {
    const m = mobIn(plain()); m.frost = 40; m.body.inDrift = false;
    run(m, gameOn(B.STONE), 30);
    expect(m.frost).toBe(0);
  });

  it('spare the snow and ice creatures', () => {
    for (const t of ['frostling', 'frostbear', 'rime_rattler']) {
      expect(MOBS[t].coldProof).toBe(true);
      const m = mobIn(t); m.body.inDrift = true;
      expect(run(m, gameOn(B.STONE), 400)).toBe(0);
      expect(m.frost).toBe(0);
    }
  });
});

describe('mobs on Scaldrock', () => {
  it('burn their feet for 1 a second', () => {
    const m = mobIn(plain());
    expect(run(m, gameOn(B.SCALDROCK), 100)).toBe(5);
  });

  it('are fine on plain stone, in the air, or with Fire Resistance', () => {
    const m = mobIn(plain());
    expect(run(m, gameOn(B.STONE), 100)).toBe(0);
    m.body.onGround = false;
    expect(run(m, gameOn(B.SCALDROCK), 100)).toBe(0);
    m.body.onGround = true; m.effects.fire_resistance = { ticks: 600, level: 0 };
    expect(run(m, gameOn(B.SCALDROCK), 100)).toBe(0);
  });

  it('are spared when fireImmune (the Capwalker, a Cinderdeep creature)', () => {
    expect(MOBS.capwalker.fireImmune).toBe(true);
    const m = mobIn('capwalker');
    expect(run(m, gameOn(B.SCALDROCK), 100)).toBe(0);
  });
});
