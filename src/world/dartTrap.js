// Dart Trap: a block like a dispenser that has no inventory. It looks along its face (meta bits 0-2 = FACING6, bit 3 = triggered by power, see
// world/circuits.js) and on a rising edge of cinnabar power shoots one dart straight along it - an arrow that stings for a little and cannot be
// picked up again. The Sandvault's corridors are lined with them, fed by pressure plates and lines of Cinnabar Wire (world/sandvault.js); a
// player can lay one down too (it is placed like a dispenser: the face looks back at the player).
import { B, SOLID, OPAQUE } from './blocks.js';
import { FACING6 } from './circuitShapes.js';

export const DART = { SPEED: 1.0, WEAKEN: 0.8 };
export const isDartTrap = (id) => id === B.DART_TRAP;
export const dartFacing = (meta) => FACING6[meta & 7] || FACING6[2];

/** Fire the Dart Trap at x,y,z once. Returns 'dart', 'blocked' (a solid block in front) or 'fail' (not a Dart Trap here). */
export function fireDart(game, x, y, z, rng = Math.random) {
  const w = game.world;
  if (w.getBlock(x, y, z) !== B.DART_TRAP) return 'fail';
  const [dx, dy, dz] = dartFacing(w.getMeta(x, y, z));
  const front = w.getBlock(x + dx, y + dy, z + dz);
  const sound = (s) => { if (game.audio) game.audio.play(s, [x + 0.5, y + 0.5, z + 0.5]); };
  if (SOLID[front] && OPAQUE[front]) { sound('click'); return 'blocked'; }
  const j = () => (rng() - 0.5) * 0.04;
  const a = game.entities.spawnArrow(x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7, z + 0.5 + dz * 0.7, dx * DART.SPEED + j(), dy * DART.SPEED + j(), dz * DART.SPEED + j(), null, false, null, 0, 0, null);
  if (a) { a.pickup = false; a.dart = true; }
  sound('bow');
  return 'dart';
}
