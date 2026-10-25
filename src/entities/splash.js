// A splash elixir breaking: a burst of coloured droplets, and its effects on
// every creature within 4 blocks, weaker with distance (see effects.js
// splashFactor). In multiplayer the host applies it (guests get theirs sent).
// A lingering elixir instead leaves an area-effect cloud (areaCloud.js).
import { ITEMS } from '../world/items.js';
import { POTIONS, potionColor } from '../world/potions.js';
import { splashFactor } from '../player/effects.js';
import { AreaCloud, cloudFloor } from './areaCloud.js';

const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/** Droplets and swirls (also used for the guest's copy of a host splash). */
export function splashParticles(game, x, y, z, potionId) {
  const d = ITEMS[potionId];
  const [r, g, b] = rgb(d && d.potion ? potionColor(d.potion.kind) : '#385dc6');
  const P = game.particles;
  if (!P) return;
  for (let k = 0; k < 40; k++) {
    const a = Math.random() * Math.PI * 2, s = 0.08 + Math.random() * 0.22;
    P.emit(x, y + 0.1, z, Math.cos(a) * s, 0.05 + Math.random() * 0.2, Math.sin(a) * s, r, g, b, 18 + Math.random() * 14, 0.012);
  }
  for (let k = 0; k < 14; k++) P.emit(x, y, z, (Math.random() - 0.5) * 0.15, Math.random() * 0.25, (Math.random() - 0.5) * 0.15, 0.85, 0.92, 1, 10, 0.03); // glass shards
  if (game.audio) game.audio.play('glass_break', [x, y, z]);
}

/**
 * Apply a splash at x,y,z. `direct` is the creature it hit (full strength), `shooter` who threw it.
 * Returns the list of [target, factor] it reached (for tests and the host's guest messages).
 */
export function splashPotion(game, x, y, z, potionId, direct = null, shooter = null) {
  const d = ITEMS[potionId];
  if (!d || !d.potion) return [];
  splashParticles(game, x, y, z, potionId);
  if (game.net && game.net.isClient) return []; // the host's copy of this splash does the work
  if (d.potion.lingering) {
    // a lingering elixir touches no one on impact: it leaves a cloud on the ground (areaCloud.js)
    const cy = game.world ? cloudFloor(game.world, x, y, z) : y;
    game.entities.add(new AreaCloud(x, cy, z, { potion: potionId, owner: shooter }));
    return [];
  }
  const effects = POTIONS[d.potion.kind].effects;
  const water = d.potion.kind === 'water';
  const reached = [];
  const consider = (t, apply) => {
    if (!t || t.dead || t.deathTime > 0) return;
    const dist = Math.hypot(t.x - x, t.y - y, t.z - z);
    const f = splashFactor(dist, !!direct && (t === direct || (t === game.player && direct === t.asTarget)));
    if (f <= 0) return;
    reached.push([t, f]);
    apply(t, f);
  };
  const p = game.player;
  // the local player
  consider(p, (t, f) => {
    if (water) { t.fireTicks = 0; return; }
    for (const [type, ticks, amp] of effects) t.applyEffect(type, ticks, amp, f);
  });
  // mobs
  for (const e of game.entities.list) {
    if (e.kind !== 'mob' || e.netProxy) continue;
    consider(e, (m, f) => {
      if (water) { m.fireTicks = 0; if (m.type === 'voidwalker') m.hurt(1, 'water'); return; }
      for (const [type, ticks, amp] of effects) m.applyEffect(type, ticks, amp, f, shooter);
    });
  }
  // other players (multiplayer host): their own game applies it
  if (game.net && game.net.isHost && game.net.splashRemote) {
    for (const t of game.net.remoteTargets(null)) consider(t, (rt, f) => game.net.splashRemote(rt, potionId, f));
  }
  return reached;
}
