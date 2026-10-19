export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 384;
export const MIN_Y = -64;
export const MAX_Y = MIN_Y + WORLD_HEIGHT - 1; // 319
export const SEA_LEVEL = 63;
export const SECTION_COUNT = WORLD_HEIGHT / 16; // 24
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

/** Index into a chunk's flat arrays: x + z*16 + (y-MIN_Y)*256 */
export function cidx(x, y, z) { return x | (z << 4) | ((y - MIN_Y) << 8); }

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
