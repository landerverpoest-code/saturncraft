// Entity lighting: mobs and player models are lit by the scene lights (the suns and the sky),
// which are dim at night, so block light would not reach them. entityGlow gives the extra
// light an entity shows by itself (as its materials' emissive colour).
import * as THREE from 'three';

const TORCH_TINT = [1.0, 0.82, 0.6];
const scratch = new THREE.Color();
/**
 * Light an entity gives off by itself so the scene lights (dim at night) do not leave it black:
 * torch and block light in its warm tint, a little moonlight under open sky at night, and the
 * dimension's floor. Returns `out` (a THREE.Color) set to the emissive factor.
 */
export function entityGlow(game, x, y, z, out = scratch) {
  const l = game.world.getLight(Math.floor(x), Math.floor(y), Math.floor(z));
  let blk = (l & 15) / 15;
  if (game.handLight > 0 && game.player) { const p = game.player, d = Math.hypot(x - p.x, y - p.y - 1.5, z - p.z); blk = Math.max(blk, Math.max(0, game.handLight - d * 1.1) / 15); }
  for (const s of game.remoteLights || []) blk = Math.max(blk, Math.max(0, s.level - Math.hypot(x - s.x, y - s.y, z - s.z) * 1.1) / 15);
  const curve = (f) => { const b = f / (4 - 3 * f); return b * 0.45 + (1 - Math.pow(1 - b, 4)) * 0.55; };
  const night = 1 - Math.min(1, (game.sky && game.sky.state.combined) || 0);
  const moon = curve((l >> 4) / 15) * night * 0.14 + Math.max(0.03, (game.nightVision || 0) * 0.6);
  const b = curve(blk) * 0.75 * (1 - curve((l >> 4) / 15) * (1 - night)); // in daylight the sun already lights it
  return out.setRGB(b * TORCH_TINT[0] + moon, b * TORCH_TINT[1] + moon, b * TORCH_TINT[2] + moon * 1.1);
}

