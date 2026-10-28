import { describe, it, expect } from 'vitest';
import { PHYS } from '../src/physics/constants.js';
import { Body } from '../src/physics/body.js';
import { Player } from '../src/player/player.js';
import { roomFor, inputDirection, lowGapAhead, crawlNext, PROBE_AHEAD } from '../src/player/crawl.js';
import { packPlayerState, unpackPlayerState, packMob, unpackMob, PF } from '../src/net/protocol.js';
import { B } from '../src/world/blocks.js';
import { Mob } from '../src/mobs/mob.js';
import { MockWorld } from './helpers.js';

/** A floor at y = 64 with a tunnel (ceiling at y = 64 + height) from z = -3 to z = -10 along x = 0. */
function tunnelWorld(height = 1) {
  const w = new MockWorld(64);
  for (let z = -3; z >= -10; z--) for (let x = -2; x <= 2; x++) w.set(x, 64 + height, z, B.STONE);
  // walls beside the tunnel so it is a real passage
  for (let z = -3; z >= -10; z--) for (const x of [-1, 1]) for (let y = 64; y < 64 + height; y++) w.set(x, y, z, B.STONE);
  return w;
}
const spawn = (w, x = 0.5, z = 0.5) => {
  const p = new Player();
  p.setPosition(x, 64, z);
  for (let i = 0; i < 5; i++) p.tick(w, {});
  return p;
};
const walk = { forward: 1, strafe: 0, jump: false, sneak: false, sprint: false };

describe('crawl rules', () => {
  it('checks the room above a spot', () => {
    const w = tunnelWorld();
    expect(roomFor(w, 0.5, 64, 0.5, PHYS.PLAYER_HEIGHT)).toBe(true);
    expect(roomFor(w, 0.5, 64, -5.5, PHYS.PLAYER_HEIGHT)).toBe(false);
    expect(roomFor(w, 0.5, 64, -5.5, PHYS.PLAYER_SNEAK_HEIGHT)).toBe(false);
    expect(roomFor(w, 0.5, 64, -5.5, PHYS.PLAYER_CRAWL_HEIGHT)).toBe(true);
    expect(PHYS.PLAYER_CRAWL_HEIGHT).toBe(0.6);
    expect(PHYS.PLAYER_CRAWL_EYE).toBe(0.4);
  });
  it('turns the walking input into a direction', () => {
    expect(inputDirection(0, 0, 0)).toBe(null);
    const [fx, fz] = inputDirection(0, 1, 0);
    expect(fx).toBeCloseTo(0); expect(fz).toBeCloseTo(-1);
    const [rx, rz] = inputDirection(0, 0, 1);
    expect(rx).toBeCloseTo(1); expect(rz).toBeCloseTo(0);
    const [qx, qz] = inputDirection(Math.PI / 2, 1, 0);
    expect(qx).toBeCloseTo(-1); expect(qz).toBeCloseTo(0);
  });
  it('sees a gap too low to sneak through just ahead, only on the ground and when walking', () => {
    const w = tunnelWorld();
    const b = new Body(0.6, 1.8);
    b.setPos(0.5, 64, -0.5); // the mouth (the face of the block at z = -3) is at z = -2: more than a probe length ahead
    b.onGround = true;
    expect(lowGapAhead(w, b, 0, 1, 0)).toBe(false);
    b.z = -2 + PROBE_AHEAD + 0.15 - 0.3; // within a probe length of the mouth (the probe's box reaches into the tunnel)
    expect(lowGapAhead(w, b, 0, 1, 0)).toBe(true);
    expect(lowGapAhead(w, b, 0, 0, 0)).toBe(false);       // standing still
    expect(lowGapAhead(w, b, Math.PI, 1, 0)).toBe(false); // walking away from it
    b.onGround = false;
    expect(lowGapAhead(w, b, 0, 1, 0)).toBe(false);
    // a gap two blocks high is walkable; one with no room at all cannot be crawled either
    const open = tunnelWorld(2), none = tunnelWorld(0);
    b.onGround = true;
    expect(lowGapAhead(open, b, 0, 1, 0)).toBe(false);
    expect(lowGapAhead(none, b, 0, 1, 0)).toBe(false);
  });
  it('stays down while it cannot stand and never starts while blocked or in mid-air', () => {
    const w = tunnelWorld();
    const b = new Body(0.6, 0.6);
    b.setPos(0.5, 64, -6); b.onGround = true;
    const s = { crawling: true, key: false, forward: 0, strafe: 0, yaw: 0, blocked: false };
    expect(crawlNext(w, b, s)).toBe(true);
    b.z = 0.5; // out in the open
    expect(crawlNext(w, b, s)).toBe(false);
    expect(crawlNext(w, b, { ...s, crawling: false, key: true })).toBe(true);
    expect(crawlNext(w, b, { ...s, crawling: false, key: true, blocked: true })).toBe(false);
    b.onGround = false;
    expect(crawlNext(w, b, { ...s, crawling: false, key: true })).toBe(false); // no crawl in mid-air
  });
});

describe('a crawling player', () => {
  it('crawls while the key is held, and stands up when it is let go', () => {
    const w = new MockWorld(64), p = spawn(w);
    expect(p.crawling).toBe(false);
    p.tick(w, { crawl: true });
    expect(p.crawling).toBe(true);
    expect(p.body.height).toBe(PHYS.PLAYER_CRAWL_HEIGHT);
    expect(p.eyeHeight).toBe(PHYS.PLAYER_CRAWL_EYE);
    expect(p.sneaking).toBe(false);
    p.tick(w, {});
    expect(p.crawling).toBe(false);
    expect(p.body.height).toBe(PHYS.PLAYER_HEIGHT);
    expect(p.eyeHeight).toBe(PHYS.PLAYER_EYE);
  });
  it('is as slow as sneaking, cannot sprint and cannot jump', () => {
    const dist = (extra, n = 60) => {
      const w = new MockWorld(64), p = spawn(w);
      const z0 = p.z;
      for (let i = 0; i < n; i++) p.tick(w, { ...walk, ...extra });
      return z0 - p.z;
    };
    const walking = dist({}), crawling = dist({ crawl: true }), sneaking = dist({ sneak: true });
    expect(crawling / walking).toBeLessThan(0.4);
    expect(crawling / walking).toBeGreaterThan(0.2);
    expect(crawling / sneaking).toBeCloseTo(1, 1);
    const w = new MockWorld(64), p = spawn(w);
    for (let i = 0; i < 20; i++) p.tick(w, { ...walk, crawl: true, sprint: true, jump: true });
    expect(p.sprinting).toBe(false);
    expect(p.body.y).toBe(64); // no jump
  });
  it('crawls by itself into a gap one block high, through it, and stands up on the far side', () => {
    const w = tunnelWorld(), p = spawn(w);
    let crawledAt = null;
    for (let i = 0; i < 400 && p.z > -12.5; i++) {
      p.tick(w, walk);
      if (p.crawling && crawledAt === null) crawledAt = p.z;
      // never inside a block
      expect(w.boxCollides(p.body.x - 0.3, p.body.y, p.body.z - 0.3, p.body.x + 0.3, p.body.y + p.body.height, p.body.z + 0.3)).toBe(false);
    }
    expect(crawledAt).not.toBeNull();
    expect(crawledAt).toBeGreaterThan(-2.2); // down just before the mouth (the first ceiling block spans z -3 to -2)
    expect(crawledAt).toBeLessThan(-0.5);
    expect(p.z).toBeLessThan(-10.3);         // came out of the other end
    expect(p.crawling).toBe(false);
    expect(p.body.height).toBe(PHYS.PLAYER_HEIGHT);
  });
  it('is stopped by the same gap when only walking upright', () => {
    const w = tunnelWorld();
    const b = new Body(0.6, 1.8);
    b.setPos(0.5, 64, 0.5);
    for (let i = 0; i < 200; i++) b.travel(w, { forward: 1, yaw: 0 });
    expect(b.z).toBeGreaterThan(-3);
  });
  it('stays down in a gap even with the key released, and does not crawl while another pose is in charge', () => {
    const w = tunnelWorld(), p = spawn(w, 0.5, -6.5);
    p.crawling = true;
    p.tick(w, {});
    expect(p.crawling).toBe(true);
    const open = new MockWorld(64), f = spawn(open);
    f.swimming = true; // another pose is in charge (swimming, gliding, flying, riding, sleeping)
    f.tick(open, { ...walk, crawl: true });
    expect(f.crawling).toBe(false);
  });
  it('lowers the eyes, so mobs and cameras see a low crawler', () => {
    const w = new MockWorld(64), p = spawn(w);
    expect(p.eyePos()[1] - p.y).toBeCloseTo(1.62);
    p.tick(w, { crawl: true });
    expect(p.eyePos()[1] - p.y).toBeCloseTo(0.4);
  });
});

describe('crawling in multiplayer', () => {
  it('rides in the player state flags without moving anything else', () => {
    const p = { x: 1, y: 2, z: 3, yaw: 0.5, pitch: 0.1, crawling: true, sneaking: false, hurtTime: 0, inventory: { armor: [null, null, null, null] } };
    const a = packPlayerState(p, 5, 7);
    expect(a.length).toBe(12);
    expect(a.slice(0, 6)).toEqual([1, 2, 3, 0.5, 0.1, 5]);
    expect(a[6] & PF.CRAWL).toBe(PF.CRAWL);
    expect(a[7]).toBe(7);
    const u = unpackPlayerState(JSON.parse(JSON.stringify(a)));
    expect(u.crawling).toBe(true);
    expect(u.sneaking).toBe(false);
    p.crawling = false; p.sneaking = true;
    const b = unpackPlayerState(packPlayerState(p, null, 0));
    expect(b.crawling).toBe(false);
    expect(b.sneaking).toBe(true);
    // the older flags keep their bits
    expect(PF).toMatchObject({ SNEAK: 1, DEAD: 2, SLEEP: 4, CREATIVE: 8, HURT: 16, RIDING: 32, INVISIBLE: 64 });
    expect(unpackPlayerState([0, 0, 0, 0, 0, -1, PF.SNEAK | PF.DEAD, 0]).crawling).toBe(false);
  });
  it('leaves the mob snapshot indices alone', () => {
    const m = new Mob('shambler', 1, 64, 2);
    m.crawling = true; // a stray flag on a mob changes nothing on the wire
    const a = packMob(m);
    expect(a.length).toBe(24);
    expect([a[0], a[1], a[2], a[3], a[4]]).toEqual([m.id, 'shambler', 1, 64, 2]);
    expect(unpackMob(JSON.parse(JSON.stringify(a)))).toMatchObject({ type: 'shambler', x: 1, y: 64, z: 2, heldItem: 0, passenger: -1 });
  });
});
