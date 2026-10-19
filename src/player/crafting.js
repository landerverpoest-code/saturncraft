// Shaped/shapeless crafting and furnace smelting recipes.
import { B } from '../world/blocks.js';
import { I, DYES, WOOL_ITEMS } from '../world/items.js';
import { COLOR } from '../world/colors.js';

const TAGS = {
  planks: [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS],
  log: [B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG],
  stone_mat: [B.COBBLESTONE, B.COBBLED_DEEPSTONE],
};

function matches(ing, id) {
  if (ing == null) return id == null;
  if (id == null) return false;
  if (typeof ing === 'string') return TAGS[ing].includes(id);
  return ing === id;
}

// pattern rows use single-character keys
export const RECIPES = [];
function shaped(pattern, key, result, count = 1) { RECIPES.push({ type: 'shaped', pattern, key, result, count }); }
function shapeless(ings, result, count = 1) { RECIPES.push({ type: 'shapeless', ings, result, count }); }

shapeless([B.OAK_LOG], B.OAK_PLANKS, 4);
shapeless([B.SPRUCE_LOG], B.SPRUCE_PLANKS, 4);
shapeless([B.BIRCH_LOG], B.BIRCH_PLANKS, 4);
shaped(['P', 'P'], { P: 'planks' }, I.STICK, 4);
shaped(['PP', 'PP'], { P: 'planks' }, B.WORKBENCH, 1);
shaped(['PPP', 'P P', 'PPP'], { P: 'planks' }, B.CHEST, 1);
shaped(['WWW'], { W: I.WHEAT }, I.BREAD, 1);
shaped(['SSS'], { S: B.SUGAR_CANE }, I.PAPER, 3);
shaped(['P', 'T'], { P: B.PUMPKIN, T: B.TORCH }, B.JACK_O_LANTERN, 1);
shaped(['SSS', 'SSS', 'SSS'], { S: I.MELON_SLICE }, B.MELON, 1);
shapeless([B.PUMPKIN, I.EGG], I.PUMPKIN_PIE, 1);
shapeless([I.PAPER, I.PAPER, I.PAPER, I.LEATHER], I.BOOK, 1);
shaped(['PPP', 'BBB', 'PPP'], { P: 'planks', B: I.BOOK }, B.BOOKSHELF, 1);
shaped(['BB', 'BB'], { B: I.BRICK }, B.BRICKS, 1);
shaped(['GGG', 'GGG'], { G: B.GLASS }, B.GLASS_PANE, 16);
// dyes: from bones, flowers, azurite and coal (black; the reference uses ink sacs), then mixed
const D = (c) => DYES[COLOR[c]];
shapeless([I.BONE], I.BONE_MEAL, 3);
shapeless([B.SUNPETAL], D('YELLOW'), 1);
shapeless([B.REDBLOOM], D('RED'), 1);
shapeless([I.AZURITE], D('BLUE'), 1);
shapeless([I.COAL], D('BLACK'), 1);
for (const [a, b, out, n] of [
  ['RED', 'YELLOW', 'ORANGE', 2], ['RED', 'WHITE', 'PINK', 2], ['BLUE', 'WHITE', 'LIGHT_BLUE', 2], ['RED', 'BLUE', 'PURPLE', 2],
  ['PURPLE', 'PINK', 'MAGENTA', 2], ['BLACK', 'WHITE', 'GRAY', 2], ['GRAY', 'WHITE', 'LIGHT_GRAY', 2], ['BLUE', 'GREEN', 'CYAN', 2],
  ['GREEN', 'WHITE', 'LIME', 2], ['RED', 'GREEN', 'BROWN', 2],
]) shapeless([a === 'WHITE' ? I.BONE_MEAL : D(a), b === 'WHITE' ? I.BONE_MEAL : D(b)], D(out), n);
// dyeing white wool
for (let c = 1; c < 16; c++) shapeless([DYES[c], B.WOOL], WOOL_ITEMS[c], 1);
shaped([' I', 'I '], { I: I.IRON_INGOT }, I.SHEARS, 1);
shapeless([I.IRON_INGOT, I.FLINT], I.FLINT_AND_STEEL);
for (const [planks, fence] of [[B.OAK_PLANKS, B.OAK_FENCE], [B.SPRUCE_PLANKS, B.SPRUCE_FENCE], [B.BIRCH_PLANKS, B.BIRCH_FENCE]]) shaped(['PSP', 'PSP'], { P: planks, S: I.STICK }, fence, 3);
shaped(['SPS', 'SPS'], { P: 'planks', S: I.STICK }, B.OAK_FENCE_GATE, 1);
shaped(['PPP'], { P: 'planks' }, B.OAK_SLAB, 6);
shaped(['P  ', 'PP ', 'PPP'], { P: 'planks' }, B.OAK_STAIRS, 4);
for (const [mat, slab, stairs] of [[B.COBBLESTONE, B.COBBLESTONE_SLAB, B.COBBLESTONE_STAIRS], [B.STONE_BRICKS, B.STONE_BRICK_SLAB, B.STONE_BRICK_STAIRS], [B.SANDSTONE, B.SANDSTONE_SLAB, B.SANDSTONE_STAIRS]]) {
  shaped(['XXX'], { X: mat }, slab, 6);
  shaped(['X  ', 'XX ', 'XXX'], { X: mat }, stairs, 4);
}
shaped(['PP', 'PP', 'PP'], { P: 'planks' }, I.OAK_DOOR, 3);
shaped(['P P', 'PPP'], { P: 'planks' }, I.OAK_BOAT, 1);
shaped(['WWW', 'PPP'], { W: B.WOOL, P: 'planks' }, I.BED, 1);
shaped(['S S', 'SSS', 'S S'], { S: I.STICK }, B.LADDER, 3);
shaped(['C', 'S'], { C: I.COAL, S: I.STICK }, B.TORCH, 4);
shaped(['CCC', 'C C', 'CCC'], { C: 'stone_mat' }, B.FURNACE, 1);
shaped(['SS', 'SS'], { S: B.STONE }, B.STONE_BRICKS, 4);
shaped(['SS', 'SS'], { S: B.SAND }, B.SANDSTONE, 1);
shaped(['SS', 'SS'], { S: I.STRING }, B.WOOL, 1);
shaped(['I I', ' I '], { I: I.IRON_INGOT }, I.BUCKET, 1);
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
shaped([' TS', 'T S', ' TS'], { T: I.STICK, S: I.STRING }, I.BOW, 1);
for (const [blk, it] of [[B.COAL_BLOCK, I.COAL], [B.IRON_BLOCK, I.IRON_INGOT], [B.GOLD_BLOCK, I.GOLD_INGOT], [B.DIAMOND_BLOCK, I.DIAMOND]]) {
  shaped(['XXX', 'XXX', 'XXX'], { X: it }, blk, 1);
  shapeless([blk], it, 9);
}
const TOOL_MATS = { wood: 'planks', stone: 'stone_mat', iron: I.IRON_INGOT, gold: I.GOLD_INGOT, diamond: I.DIAMOND };
for (const [mat, ing] of Object.entries(TOOL_MATS)) {
  shaped(['XXX', ' S ', ' S '], { X: ing, S: I.STICK }, I[`${mat}_pickaxe`.toUpperCase()]);
  shaped(['XX', 'XS', ' S'], { X: ing, S: I.STICK }, I[`${mat}_axe`.toUpperCase()]);
  shaped(['X', 'S', 'S'], { X: ing, S: I.STICK }, I[`${mat}_shovel`.toUpperCase()]);
  shaped(['X', 'X', 'S'], { X: ing, S: I.STICK }, I[`${mat}_sword`.toUpperCase()]);
  shaped(['XX', ' S', ' S'], { X: ing, S: I.STICK }, I[`${mat}_hoe`.toUpperCase()]);
}

const ARMOR_MATS = { leather: I.LEATHER, iron: I.IRON_INGOT, gold: I.GOLD_INGOT, diamond: I.DIAMOND };
for (const [mat, ing] of Object.entries(ARMOR_MATS)) {
  shaped(['XXX', 'X X'], { X: ing }, I[`${mat}_helmet`.toUpperCase()]);
  shaped(['X X', 'XXX', 'XXX'], { X: ing }, I[`${mat}_chestplate`.toUpperCase()]);
  shaped(['XXX', 'X X', 'X X'], { X: ing }, I[`${mat}_leggings`.toUpperCase()]);
  shaped(['X X', 'X X'], { X: ing }, I[`${mat}_boots`.toUpperCase()]);
}

/**
 * Find the crafting result for a grid.
 * @param {Array<{id:number}|null>} grid row-major
 * @param {number} w grid width (2 or 3)
 * @returns {{id:number,count:number}|null}
 */
export function craft(grid, w) {
  const h = grid.length / w;
  const ids = grid.map((s) => (s ? s.id : null));
  // bounding box of used cells
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ids[y * w + x] != null) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const cells = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push(ids[y * w + x]);
  const used = cells.filter((c) => c != null);
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (used.length !== r.ings.length) continue;
      const rem = used.slice();
      let ok = true;
      for (const ing of r.ings) {
        const k = rem.findIndex((id) => matches(ing, id));
        if (k < 0) { ok = false; break; }
        rem.splice(k, 1);
      }
      if (ok) return { id: r.result, count: r.count };
      continue;
    }
    const pw = Math.max(...r.pattern.map((row) => row.length)), ph = r.pattern.length;
    if (pw !== bw || ph !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) for (let x = 0; x < pw && ok; x++) {
        const ch = (r.pattern[y][mirror ? pw - 1 - x : x] || ' ');
        const ing = ch === ' ' ? null : r.key[ch];
        if (!matches(ing, cells[y * bw + x])) ok = false;
      }
      if (ok) return { id: r.result, count: r.count };
    }
  }
  return null;
}

// ---- recipe book helpers ----------------------------------------------------

/** Ingredient per grid cell (row-major, `w` wide) for laying a recipe out, or null if it does not fit. */
export function recipeLayout(r, w) {
  if (r.type === 'shapeless') {
    if (r.ings.length > w * w) return null;
    const cells = new Array(w * w).fill(null);
    r.ings.forEach((ing, i) => { cells[i] = ing; });
    return cells;
  }
  const pw = Math.max(...r.pattern.map((row) => row.length)), ph = r.pattern.length;
  if (pw > w || ph > w) return null;
  const cells = new Array(w * w).fill(null);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const ch = r.pattern[y][x] || ' ';
    if (ch !== ' ') cells[y * w + x] = r.key[ch];
  }
  return cells;
}

/**
 * Pick inventory items for each ingredient of a layout. `stacks` is a list of
 * {id, count} available; returns the chosen id per cell, or null if short.
 */
export function chooseIngredients(layout, stacks) {
  const left = new Map();
  for (const st of stacks) if (st) left.set(st.id, (left.get(st.id) || 0) + st.count);
  const out = layout.map(() => null);
  for (let i = 0; i < layout.length; i++) {
    const ing = layout[i];
    if (ing == null) continue;
    let pick = null;
    for (const [id, n] of left) if (n > 0 && matches(ing, id)) { pick = id; break; }
    if (pick == null) return null;
    left.set(pick, left.get(pick) - 1);
    out[i] = pick;
  }
  return out;
}

/** A representative item id for an ingredient (tags show their first member). */
export function ingredientIcon(ing) { return typeof ing === 'string' ? TAGS[ing][0] : ing; }

// Smelting: input -> output; 200 ticks per item (10 s)
export const SMELT_TIME = 200;
export const SMELTING = {
  [I.RAW_IRON]: I.IRON_INGOT, [I.RAW_GOLD]: I.GOLD_INGOT, [I.RAW_COPPER]: I.COPPER_INGOT,
  [B.IRON_ORE]: I.IRON_INGOT, [B.GOLD_ORE]: I.GOLD_INGOT,
  [B.SAND]: B.GLASS, [I.CLAY_BALL]: I.BRICK, [B.CLAY]: B.BRICKS, [B.CACTUS]: DYES[COLOR.GREEN], [B.COBBLESTONE]: B.STONE, [B.COBBLED_DEEPSTONE]: B.DEEPSTONE,
  [I.RAW_PORK]: I.COOKED_PORK, [I.RAW_BEEF]: I.STEAK, [I.RAW_CHICKEN]: I.COOKED_CHICKEN,
  [I.RAW_MUTTON]: I.COOKED_MUTTON, [B.OAK_LOG]: I.COAL, [B.SPRUCE_LOG]: I.COAL, [B.BIRCH_LOG]: I.COAL,
};
