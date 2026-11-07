// The Lodestone Charm (player/trinkets.js): dropped items and experience within its radius drift to the wearer.
// Alone or hosting, the drops are real entities here and are given a push; as a guest they are the host's, so a guest
// asks the host for what lies within 5 blocks with the usual `take` request (the host checks the distance and that
// the item is still there, so nothing is duplicated) and the host's copy vanishes when it is handed over.
import { ITEMS, maxStack } from '../world/items.js';
import { roomFor } from '../net/protocol.js';

export const PULL_SPEED = 0.16;     // blocks per tick at the edge of the radius
export const GUEST_TAKE_RANGE = 5;  // the host accepts takes up to 6 blocks from the guest

/** Push the drops in `radius` towards the player (every 2nd tick). */
export function lodestonePull(g, radius) {
  if (!radius) return;
  const p = g.player;
  if (!p || p.dead) return;
  const cx = p.x, cy = p.y + 0.9, cz = p.z, guest = !!(g.net && g.net.isClient);
  for (const e of g.entities.list) {
    if ((e.kind !== 'item' && e.kind !== 'xp') || e.dead) continue;
    if (e.kind === 'item' && e.pickupDelay > 0) continue;
    const dx = cx - e.x, dy = cy - e.y, dz = cz - e.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > radius * radius || d2 < 0.6) continue;
    if (e.netProxy) {
      if (!guest || d2 > GUEST_TAKE_RANGE * GUEST_TAKE_RANGE || (e.takeAt && g.ticks - e.takeAt < 10)) continue;
      let n = 1;
      if (e.kind === 'item') {
        n = Math.min(e.stack.count, roomFor(p.inventory.slots, e.stack, maxStack, !ITEMS[e.stack.id].durability));
        if (n <= 0) continue;
      }
      e.takeAt = g.ticks;
      g.net.send({ t: 'take', id: e.netId, n });
      continue;
    }
    const d = Math.sqrt(d2), k = PULL_SPEED * 2 * (1 - 0.5 * d / radius) / d; // (applied every other tick)
    e.body.vx += dx * k; e.body.vy += dy * k * 0.8 + 0.01; e.body.vz += dz * k;
    const v = Math.hypot(e.body.vx, e.body.vy, e.body.vz);
    if (v > 0.45) { e.body.vx *= 0.45 / v; e.body.vy *= 0.45 / v; e.body.vz *= 0.45 / v; }
  }
}
