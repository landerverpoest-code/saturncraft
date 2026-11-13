// The Echo Coffer: a chest whose 27 slots belong to the player, not to the block. Every Echo Coffer in every dimension opens
// the same store, and nobody else can reach it; the slots are saved with the player (world/save.js). Breaking a coffer drops
// the coffer and leaves the store untouched. Crafted from eight Obsidian around an Eye of the Void.
import { isBlockId } from '../world/blocks.js';
import { ITEMS } from '../world/items.js';

export const ECHO_SIZE = 27;

/** A valid store from saved data: 27 slots, each null or a stack of a known block or item. */
export function cleanEcho(raw) {
  const out = new Array(ECHO_SIZE).fill(null);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < ECHO_SIZE; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object' || !Number.isInteger(s.id) || !Number.isInteger(s.count) || s.count < 1) continue;
    if (!isBlockId(s.id) && !ITEMS[s.id]) continue;
    out[i] = { ...s, count: Math.min(s.count, 64) };
  }
  return out;
}

/** The player's store (made on first use). */
export function echoStore(player) {
  if (!Array.isArray(player.echo) || player.echo.length !== ECHO_SIZE) player.echo = cleanEcho(player.echo);
  return player.echo;
}
