// The hover tip shown under the crosshair for farmland, crops and Cooking Pots (ui/hud.js setAimTip):
// soil fertility, growth stage and season, greenhouse, and what is in a pot. Pure: it only reads the world.
import { B, BLOCKS, CROPS } from './blocks.js';
import { climate } from './seasons.js';
import { growthFactorFor, inGreenhouse, bestSeasons, CROP_TRAITS, lastCropOf, tirednessFor, moistureOf, YIELD_FACTOR, SOIL_CODE } from './farming.js';
import { DISHES } from './cooking.js';
import { isPot, kindsIn, KIND_NAMES, recipeFor, isReady, dishOf, servingsOf, stageOf, BREW_STAGES, hasHeat } from './cookingPot.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const nameOf = (id) => (BLOCKS[id] ? BLOCKS[id].name : '?');

/** Text for a block's soil: what last grew in it and how much the same crop would give again. */
export function soilLine(meta) {
  const last = lastCropOf(meta);
  if (!last) return 'Fresh soil';
  const t = tirednessFor(meta, last);
  return `Last grew ${nameOf(last)}: the same crop again gives ${pct(YIELD_FACTOR[t])} (rotate crops, rest the soil or use Bone Meal)`;
}

/** The tip for the block a player looks at (a raycast hit { x, y, z, id }), or null. */
export function aimTip(world, t) {
  if (!t) return null;
  const { x, y, z, id } = t;
  if (id === B.FARMLAND) {
    const m = world.getMeta(x, y, z);
    return `Farmland (${moistureOf(m) > 0 ? 'moist' : 'dry'}). ${soilLine(m)}`;
  }
  if (CROPS.has(id) || id === B.DEWBERRY_BRAMBLE) {
    const m = world.getMeta(x, y, z), bramble = id === B.DEWBERRY_BRAMBLE;
    const ripe = bramble ? (m & 3) >= 3 : (m & 7) >= 7;
    const parts = [nameOf(id), ripe ? 'ripe' : bramble ? `growing (${(m & 3) + 1}/4)` : `growing (${(m & 7) + 1}/8)`];
    const f = growthFactorFor(id), gh = inGreenhouse(world, x, y, z);
    if (climate.on) parts.push(`${pct(gh && f < 1 ? 1 : f)} growth now${gh ? ' (greenhouse)' : ''}`);
    if (CROP_TRAITS[id]) parts.push(`best in ${bestSeasons(id)}`);
    if (SOIL_CODE[id] && world.getBlock(x, y - 1, z) === B.FARMLAND) {
      const lvl = tirednessFor(world.getMeta(x, y - 1, z), id);
      if (lvl) parts.push(`tired soil: harvest ${pct(YIELD_FACTOR[Math.min(2, lvl)])}`);
    }
    return parts.join(', ');
  }
  if (isPot(id)) {
    const m = world.getMeta(x, y, z);
    if (id === B.COOKING_POT_BREW) {
      const dish = DISHES[dishOf(m)];
      if (isReady(m)) return `Cooking Pot: ${dish.name} ready, ${servingsOf(m)} left (${dish.bowl ? 'use a Bowl' : 'empty hand'})`;
      return `Cooking Pot: simmering ${dish.name} (${Math.round(stageOf(m) / BREW_STAGES * 100)}%)${hasHeat(world, x, y, z) ? '' : ', needs a fire below'}`;
    }
    if (!m) return 'Cooking Pot: empty. Put in ingredients, then stir with an empty hand';
    const r = recipeFor(m);
    return `Cooking Pot: ${kindsIn(m).map((k) => KIND_NAMES[k]).join(', ')}${r >= 0 ? ` (ready to cook${hasHeat(world, x, y, z) ? '' : ', needs a fire below'})` : ' (add more)'}`;
  }
  return null;
}
