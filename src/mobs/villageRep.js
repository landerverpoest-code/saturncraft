// Glue between the game and reputation.js: change a player's reputation in a village and make sure whoever it
// concerns hears of it. A guest's reputation lives on the host (the guest's stand-in object, net/remotePlayer.js);
// the host tells the guest of every change (net/session.js sendReputation).
import { addRep, getRep, REP } from './reputation.js';

/**
 * `who` (the local player, or a guest's stand-in on the host) did something the village of `key` takes note of.
 * Returns the new reputation. `kind` 'trade' stops raising it at the trade cap.
 */
export function repEvent(g, who, key, delta, kind = null) {
  if (!who || !key || !delta) return getRep(who, key);
  const v = addRep(who, key, delta, kind);
  if (who.remote && g && g.net && g.net.sendReputation) g.net.sendReputation(who, key, v);
  return v;
}

/** Someone hit (or, with `killed`, killed) a settler of the village `key`. */
export function settlerWronged(g, who, key, killed) {
  if (!who || !who.isPlayer || !key) return;
  const before = getRep(who, key);
  const v = repEvent(g, who, key, killed ? REP.kill : REP.hit);
  if (killed && who === g.player && g.hud && v < before) g.hud.toast('The village will remember this', 3000);
}
