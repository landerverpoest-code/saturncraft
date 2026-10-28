// Workstations: the Grindstone (repair two of a kind, strip enchantments for a
// little experience), the Stonecutter (one stone block into one of its cut
// shapes) and the Loom (one dye recolours up to eight wool or carpets). Pure
// functions, unit tested; the screens live in ui/screens.js.
import { B, BLOCKS, SHAPE, STONE_SETS, TOOL, COLOR_BLOCKS } from './blocks.js';
import { ITEMS, I, DYES, WOOL_ITEMS } from './items.js';
import { ENCHANTS } from './enchantments.js';

// ---- grindstone ---------------------------------------------------------------
/** Curses stay on an item through the grindstone (none exist yet; an enchantment opts in with `curse: true`). */
export const isCurse = (key) => !!(ENCHANTS[key] && ENCHANTS[key].curse);

/** Does the grindstone take this stack in one of its two inputs? */
export function grindstoneAccepts(st) {
  if (!st || !ITEMS[st.id]) return false;
  return !!ITEMS[st.id].durability || st.id === I.ENCHANTED_BOOK;
}

/** Split an enchantment map into the curses (kept) and the experience the rest are worth. */
function strip(ench) {
  let kept = null, worth = 0, removed = 0;
  for (const [k, l] of Object.entries(ench || {})) {
    if (!(l > 0)) continue;
    if (isCurse(k)) { (kept || (kept = {}))[k] = l; continue; }
    // worth: the lowest enchanting level that could have rolled it (the reference's minimum cost)
    worth += ENCHANTS[k] ? ENCHANTS[k].min(l) : l;
    removed++;
  }
  return { kept, worth, removed };
}

/**
 * Grindstone result for the two inputs (either may be empty), or null.
 * Two items of the same kind (with durability) merge: their remaining
 * durability plus a 5 % bonus. A single item, or the merged one, loses every
 * enchantment that is not a curse (an Enchanted Book left bare becomes a Book)
 * and its prior anvil work. Returns { result, xp: [min, max] } - taking the
 * result drops between half and all of what the removed enchantments were worth.
 */
export function grindstoneResult(a, b) {
  if (a && a.count !== 1) return null;
  if (b && b.count !== 1) return null;
  if (!a && !b) return null;
  if (a && b) {
    if (a.id !== b.id) return null;
    const dur = ITEMS[a.id] && ITEMS[a.id].durability;
    if (!dur) return null; // two books never merge
    const keep = (dur - (a.damage | 0)) + (dur - (b.damage | 0)) + Math.floor(dur * 5 / 100);
    const sa = strip(a.ench), sb = strip(b.ench);
    const kept = sa.kept || sb.kept ? { ...(sb.kept || {}), ...(sa.kept || {}) } : null;
    const result = { id: a.id, count: 1, damage: Math.max(0, dur - keep) };
    if (kept) result.ench = kept;
    const worth = sa.worth + sb.worth;
    return { result, xp: [Math.ceil(worth / 2), worth] };
  }
  const st = a || b;
  if (!grindstoneAccepts(st)) return null;
  const s = strip(st.ench);
  if (!s.removed) return null; // nothing to take off
  const result = { id: st.id, count: 1, damage: st.damage | 0 };
  if (s.kept) result.ench = s.kept;
  else if (st.id === I.ENCHANTED_BOOK) result.id = I.BOOK;
  return { result, xp: [Math.ceil(s.worth / 2), s.worth] };
}

/** Experience to drop for a grindstone result (rng: 0..1). */
export const grindstoneXp = (r, rng = Math.random) => (r ? r.xp[0] + Math.floor(rng() * (r.xp[1] - r.xp[0] + 1)) : 0);

// ---- stonecutter --------------------------------------------------------------
// Full-block variants a stone can be cut into (followed on: stone -> stone bricks -> chiseled)
const VARIANTS = new Map([
  [B.STONE, [B.STONE_BRICKS]],
  [B.STONE_BRICKS, [B.CHISELED_STONE_BRICKS]],
  [B.GRANITE, [B.POLISHED_GRANITE]],
  [B.DIORITE, [B.POLISHED_DIORITE]],
  [B.ANDESITE, [B.POLISHED_ANDESITE]],
  [B.HOLLOWSTONE, [B.HOLLOWSTONE_BRICKS]],
  [B.HOLLOWBRICK, [B.HOLLOWBRICK_PILLAR]],
]);
// Ashstone (the Proving Vaults' stone) is cut from Tuff
VARIANTS.set(B.TUFF, [B.POLISHED_ASHSTONE, B.ASHSTONE_BRICKS]);
VARIANTS.set(B.ASHSTONE_BRICKS, [B.ASHSTONE_TILES]);
const WALLS = new Map([[B.COBBLESTONE, B.COBBLESTONE_WALL], [B.MOSSY_COBBLESTONE, B.MOSSY_COBBLESTONE_WALL]]);
// slabs and stairs of every stone (the original sets, the extended ones and the Hollow's)
const SLABS = new Map(), STAIRS = new Map();
for (const [mat, slab, stairs] of [[B.COBBLESTONE, B.COBBLESTONE_SLAB, B.COBBLESTONE_STAIRS], [B.STONE_BRICKS, B.STONE_BRICK_SLAB, B.STONE_BRICK_STAIRS],
  [B.SANDSTONE, B.SANDSTONE_SLAB, B.SANDSTONE_STAIRS], [B.HOLLOWBRICK, B.HOLLOWBRICK_SLAB, B.HOLLOWBRICK_STAIRS], ...STONE_SETS]) {
  SLABS.set(mat, slab); STAIRS.set(mat, stairs);
}

/** Every block reachable from `id` by cutting (itself first). */
function family(id) {
  const out = [id];
  for (let k = 0; k < out.length; k++) for (const v of VARIANTS.get(out[k]) || []) if (!out.includes(v)) out.push(v);
  return out;
}

/** What one block of `id` can be cut into: [{ id, count }] (slabs come two to a block), [] if nothing. */
export function stonecutterOutputs(id) {
  const fam = family(id), out = [];
  for (const v of fam.slice(1)) out.push({ id: v, count: 1 });
  for (const v of fam) if (SLABS.has(v)) out.push({ id: SLABS.get(v), count: 2 });
  for (const v of fam) if (STAIRS.has(v)) out.push({ id: STAIRS.get(v), count: 1 });
  for (const v of fam) if (WALLS.has(v)) out.push({ id: WALLS.get(v), count: 1 });
  return out;
}

/** Inputs the stonecutter has anything for. */
export const STONECUTTER_INPUTS = BLOCKS.filter((b) => b && b.tool === TOOL.PICKAXE && b.shape === SHAPE.CUBE && stonecutterOutputs(b.id).length).map((b) => b.id);
export const stonecutterAccepts = (st) => !!st && stonecutterOutputs(st.id).length > 0;

// ---- loom ---------------------------------------------------------------------
/** Cloth the loom recolours: [colour-indexed item ids] for wool and for carpets. */
const CLOTH = [WOOL_ITEMS, COLOR_BLOCKS.carpet];
/** Colour (0-15) a dye gives at the loom; Bone Meal bleaches to white. -1 if not a dye. */
export function loomDyeColor(id) {
  if (id === I.BONE_MEAL) return 0;
  const c = DYES.indexOf(id);
  return c > 0 ? c : -1;
}
/** [kind, colour] of a cloth item, or null. */
function clothOf(id) {
  for (let k = 0; k < CLOTH.length; k++) { const c = CLOTH[k].indexOf(id); if (c >= 0) return [k, c]; }
  return null;
}
export const loomAcceptsCloth = (st) => !!st && !!clothOf(st.id);
export const loomAcceptsDye = (st) => !!st && loomDyeColor(st.id) >= 0;
/** Cloth one dye recolours at a time. */
export const LOOM_BATCH = 8;
/**
 * Loom result for a stack of cloth and a dye, or null: up to eight of the cloth
 * in the dye's colour, using one dye. Cloth already that colour is not taken.
 * Returns { result, cloth } - cloth is how many of the input are used.
 */
export function loomResult(cloth, dye) {
  if (!cloth || !dye || !(cloth.count > 0) || !(dye.count > 0)) return null;
  const k = clothOf(cloth.id), col = loomDyeColor(dye.id);
  if (!k || col < 0 || k[1] === col) return null;
  const n = Math.min(LOOM_BATCH, cloth.count);
  return { result: { id: CLOTH[k[0]][col], count: n, damage: 0 }, cloth: n };
}
