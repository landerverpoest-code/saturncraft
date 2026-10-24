// Shaped/shapeless crafting and furnace smelting recipes.
import { B, BLOCKS, WOOD_SETS, STONE_SETS, COLOR_BLOCKS, DOOR_SETS } from '../world/blocks.js';
import { I, ITEMS, DYES, WOOL_ITEMS, TIPPED_ARROW, SPLASH_ITEM } from '../world/items.js';
import { COLOR } from '../world/colors.js';

const TAGS = {
  planks: [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS, B.DARK_OAK_PLANKS, B.BLOSSOM_PLANKS],
  log: [B.OAK_LOG, B.SPRUCE_LOG, B.BIRCH_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG, B.BLOSSOM_LOG],
  stone_mat: [B.COBBLESTONE, B.COBBLED_DEEPSTONE],
  wood_slab: WOOD_SETS.map(([, slab]) => slab),
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
shapeless([B.JUNGLE_LOG], B.JUNGLE_PLANKS, 4);
shapeless([B.ACACIA_LOG], B.ACACIA_PLANKS, 4);
shapeless([B.BLOSSOM_LOG], B.BLOSSOM_PLANKS, 4);
shapeless([B.DARK_OAK_LOG], B.DARK_OAK_PLANKS, 4);
shapeless([B.RED_MUSHROOM, B.BROWN_MUSHROOM, I.BOWL], I.MUSHROOM_STEW);
shapeless([B.SKYBELL], DYES[COLOR.LIGHT_BLUE], 1);
shapeless([B.ROSETTE], DYES[COLOR.PINK], 1);
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
shaped([' B ', 'DOD', 'OOO'], { B: I.BOOK, D: I.DIAMOND, O: B.OBSIDIAN }, B.ENCHANTING_TABLE, 1);
shaped(['BBB', ' I ', 'III'], { B: B.IRON_BLOCK, I: I.IRON_INGOT }, B.ANVIL, 1);
shaped(['GGG', 'GGG'], { G: B.GLASS }, B.GLASS_PANE, 16);
// dyes: from bones, flowers, azurite and coal (black; the reference uses ink sacs), then mixed
const D = (c) => DYES[COLOR[c]];
shapeless([I.BONE], I.BONE_MEAL, 3);
shapeless([B.SUNPETAL], D('YELLOW'), 1);
shapeless([B.REDBLOOM], D('RED'), 1);
shapeless([I.AZURITE], D('BLUE'), 1);
shapeless([I.COAL], D('BLACK'), 1);
shapeless([I.INK_SAC], D('BLACK'), 1);
shapeless([I.COCOA_BEANS], D('BROWN'), 1);
shaped(['WCW'], { W: I.WHEAT, C: I.COCOA_BEANS }, I.COOKIE, 8);
shapeless([B.PUMPKIN], I.PUMPKIN_SEEDS, 4);
shaped(['HH', 'HH'], { H: I.RABBIT_HIDE }, I.LEATHER, 1);
shaped(['WWW', 'WWW', 'WWW'], { W: I.WHEAT }, B.HAY_BALE, 1);
shapeless([B.HAY_BALE], I.WHEAT, 9);
shapeless([I.MELON_SLICE], I.MELON_SEEDS, 1);
for (const [a, b, out, n] of [
  ['RED', 'YELLOW', 'ORANGE', 2], ['RED', 'WHITE', 'PINK', 2], ['BLUE', 'WHITE', 'LIGHT_BLUE', 2], ['RED', 'BLUE', 'PURPLE', 2],
  ['PURPLE', 'PINK', 'MAGENTA', 2], ['BLACK', 'WHITE', 'GRAY', 2], ['GRAY', 'WHITE', 'LIGHT_GRAY', 2], ['BLUE', 'GREEN', 'CYAN', 2],
  ['GREEN', 'WHITE', 'LIME', 2], ['RED', 'GREEN', 'BROWN', 2],
]) shapeless([a === 'WHITE' ? I.BONE_MEAL : D(a), b === 'WHITE' ? I.BONE_MEAL : D(b)], D(out), n);
// dyeing white wool
for (let c = 1; c < 16; c++) shapeless([DYES[c], B.WOOL], WOOL_ITEMS[c], 1);
shaped([' I', 'I '], { I: I.IRON_INGOT }, I.SHEARS, 1);
shapeless([I.IRON_INGOT, I.FLINT], I.FLINT_AND_STEEL);
shaped(['SS', 'SS'], { S: I.SNOWBALL }, B.SNOW_BLOCK, 1);
shaped(['GSG', 'SGS', 'GSG'], { G: I.GUNPOWDER, S: B.SAND }, B.TNT, 1);
shaped(['I I', 'I I', 'ISI'], { I: I.IRON_INGOT, S: I.STICK }, B.RAIL, 16);
shaped(['I I', 'III'], { I: I.IRON_INGOT }, I.MINECART, 1);
shaped([' S ', 'SCS', 'LLL'], { S: I.STICK, C: I.COAL, L: 'log' }, B.CAMPFIRE, 1);
shaped(['III', 'ITI', 'III'], { I: I.IRON_INGOT, T: B.TORCH }, B.LANTERN, 1);
shaped(['SSS', 'SWS', 'SSS'], { S: I.STICK, W: B.WOOL }, I.PAINTING, 1);
shaped(['SSS', 'SLS', 'SSS'], { S: I.STICK, L: I.LEATHER }, I.ITEM_FRAME, 1);
shaped(['PPP', 'PPP', ' S '], { P: 'planks', S: I.STICK }, I.SIGN, 3);
shaped([' I ', 'ICI', ' I '], { I: I.IRON_INGOT, C: I.CINNABAR }, I.COMPASS, 1);
shaped([' G ', 'GCG', ' G '], { G: I.GOLD_INGOT, C: I.CINNABAR }, I.CLOCK, 1);
shaped(['LLL', 'LIL'], { L: I.LEATHER, I: I.IRON_INGOT }, I.SADDLE, 1);
shaped(['PIP', 'PPP', ' P '], { P: 'planks', I: I.IRON_INGOT }, I.SHIELD, 1);
shaped(['  S', ' SW', 'S W'], { S: I.STICK, W: I.STRING }, I.FISHING_ROD, 1);
shaped(['CCC', 'CCC'], { C: B.COBBLESTONE }, B.COBBLESTONE_WALL, 6);
shaped(['CCC', 'CCC'], { C: B.MOSSY_COBBLESTONE }, B.MOSSY_COBBLESTONE_WALL, 6);
for (const [planks, , trap] of DOOR_SETS) shaped(['PPP', 'PPP'], { P: planks }, trap, 2);
shaped(['BBB'], { B: B.SNOW_BLOCK }, B.SNOW_LAYER, 6);
shaped(['P P', ' P '], { P: 'planks' }, I.BOWL, 4);
// Cinnabar circuitry (reference recipes; the lamp uses Glowshard for the glowing block)
shaped(['C', 'S'], { C: I.CINNABAR, S: I.STICK }, B.CINNABAR_TORCH, 1);
shaped(['S', 'C'], { S: I.STICK, C: B.COBBLESTONE }, B.LEVER, 1);
shapeless([B.STONE], B.STONE_BUTTON, 1);
shaped(['PP'], { P: 'planks' }, B.WOODEN_PRESSURE_PLATE, 1);
shaped([' C ', 'CGC', ' C '], { C: I.CINNABAR, G: B.GLOWSHARD }, B.CINNABAR_LAMP, 1);
shaped(['TCT', 'SSS'], { T: B.CINNABAR_TORCH, C: I.CINNABAR, S: B.STONE }, B.REPEATER, 1);
shaped(['PPP', 'CIC', 'CRC'], { P: 'planks', C: 'stone_mat', I: I.IRON_INGOT, R: I.CINNABAR }, B.PISTON, 1);
shaped(['S', 'P'], { S: I.SLIMEBALL, P: B.PISTON }, B.STICKY_PISTON, 1);
shaped(['PPP', 'PCP', 'PPP'], { P: 'planks', C: I.CINNABAR }, B.CHIME_BLOCK, 1);
shaped(['CCC', 'CCC', 'CCC'], { C: I.CINNABAR }, B.CINNABAR_BLOCK, 1);
shapeless([B.CINNABAR_BLOCK], I.CINNABAR, 9);
shapeless([I.BOWL, I.BEETROOT, I.BEETROOT, I.BEETROOT, I.BEETROOT, I.BEETROOT, I.BEETROOT], I.BEETROOT_SOUP);
for (const [planks, , , fence] of WOOD_SETS) shaped(['PSP', 'PSP'], { P: planks, S: I.STICK }, fence, 3);
shaped(['SPS', 'SPS'], { P: 'planks', S: I.STICK }, B.OAK_FENCE_GATE, 1);
for (const [planks, slab] of WOOD_SETS) shaped(['PPP'], { P: planks }, slab, 6);
shaped(['PSP', 'P P', 'PSP'], { P: 'planks', S: 'wood_slab' }, B.BARREL, 1);
shaped(['PPP', 'PCP', 'PPP'], { P: I.PAPER, C: I.COMPASS }, I.EMPTY_MAP, 1);
shaped(['SSS', 'S S'], { S: I.SCUTE }, I.TURTLE_SHELL, 1);
shaped(['I I', 'ICI', ' I '], { I: I.IRON_INGOT, C: B.CHEST }, B.HOPPER, 1);
shaped(['S S', 'S S', 'SSS'], { S: 'wood_slab' }, B.COMPOSTER, 1);
shaped(['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE }, I.GILDED_APPLE, 1);
for (const [kind, id] of Object.entries(TIPPED_ARROW)) shaped(['AAA', 'APA', 'AAA'], { A: I.ARROW, P: SPLASH_ITEM[kind] }, id, 8);
shaped(['PPP', 'HHH', 'PPP'], { P: 'planks', H: I.HONEYCOMB }, B.BEEHIVE, 1);
shapeless([I.HONEY_BOTTLE], I.SUGAR, 3);
// Tide Citadel blocks (reference prismarine recipes)
shaped(['SS', 'SS'], { S: I.TIDE_SHARD }, B.TIDESTONE, 1);
shaped(['SSS', 'SSS', 'SSS'], { S: I.TIDE_SHARD }, B.TIDESTONE_BRICKS, 1);
shaped(['SSS', 'SIS', 'SSS'], { S: I.TIDE_SHARD, I: I.INK_SAC }, B.DARK_TIDESTONE, 1);
shaped(['SCS', 'CCC', 'SCS'], { S: I.TIDE_SHARD, C: I.TIDE_CRYSTAL }, B.TIDE_LANTERN, 1);
for (const [planks, , stairs] of WOOD_SETS) shaped(['P  ', 'PP ', 'PPP'], { P: planks }, stairs, 4);
for (const [mat, slab, stairs] of [[B.COBBLESTONE, B.COBBLESTONE_SLAB, B.COBBLESTONE_STAIRS], [B.STONE_BRICKS, B.STONE_BRICK_SLAB, B.STONE_BRICK_STAIRS], [B.SANDSTONE, B.SANDSTONE_SLAB, B.SANDSTONE_STAIRS], ...STONE_SETS]) {
  shaped(['XXX'], { X: mat }, slab, 6);
  shaped(['X  ', 'XX ', 'XXX'], { X: mat }, stairs, 4);
}
for (const [planks, door] of DOOR_SETS) shaped(['PP', 'PP', 'PP'], { P: planks }, BLOCKS[door].doorItem, 3);
shaped(['P P', 'PPP'], { P: 'planks' }, I.OAK_BOAT, 1);
shaped(['WWW', 'PPP'], { W: B.WOOL, P: 'planks' }, I.BED, 1);
shaped(['S S', 'SSS', 'S S'], { S: I.STICK }, B.LADDER, 3);
shaped(['C', 'S'], { C: I.COAL, S: I.STICK }, B.TORCH, 4);
shaped(['CCC', 'C C', 'CCC'], { C: 'stone_mat' }, B.FURNACE, 1);
shaped([' L ', 'LFL', ' L '], { L: 'log', F: B.FURNACE }, B.SMOKER, 1);
shaped(['III', 'IFI', 'SSS'], { I: I.IRON_INGOT, F: B.FURNACE, S: B.SMOOTH_STONE }, B.BLAST_FURNACE, 1);
shaped(['SS', 'SS'], { S: B.STONE }, B.STONE_BRICKS, 4);
shaped(['SS', 'SS'], { S: B.SAND }, B.SANDSTONE, 1);
shaped(['SS', 'SS'], { S: I.STRING }, B.WOOL, 1);
shaped(['I I', ' I '], { I: I.IRON_INGOT }, I.BUCKET, 1);
shaped(['F', 'S', 'E'], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
shaped([' TS', 'T S', ' TS'], { T: I.STICK, S: I.STRING }, I.BOW, 1);
shaped(['TIT', 'SFS', ' T '], { T: I.STICK, I: I.IRON_INGOT, S: I.STRING, F: I.FLINT }, I.CROSSBOW, 1);
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

// Brewing: vials, nuggets and the potion ingredients that are crafted
shapeless([B.SUGAR_CANE], I.SUGAR, 1);
shapeless([I.GOLD_INGOT], I.GOLD_NUGGET, 9);
shaped(['NNN', 'NNN', 'NNN'], { N: I.GOLD_NUGGET }, I.GOLD_INGOT, 1);
shaped(['G G', ' G '], { G: B.GLASS }, I.GLASS_VIAL, 3);
shaped(['NNN', 'NMN', 'NNN'], { N: I.GOLD_NUGGET, M: I.MELON_SLICE }, I.GILDED_MELON_SLICE, 1);
shaped(['NNN', 'NCN', 'NNN'], { N: I.GOLD_NUGGET, C: I.CARROT }, I.GILDED_CARROT, 1);
shapeless([I.SLIMEBALL, I.EMBER_POWDER], I.EMBER_CREAM, 1);
shapeless([I.SPIDER_EYE, B.BROWN_MUSHROOM, I.SUGAR], I.FERMENTED_SPIDER_EYE, 1);
shaped([' R ', 'CCC'], { R: I.EMBER_ROD, C: 'stone_mat' }, B.BREWING_STAND, 1);

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

// Caves content: copper blocks and sealing, the Storm Rod, Violite, Shaded Glass, the Farglass, Seepstone
shaped(['CCC', 'CCC', 'CCC'], { C: I.COPPER_INGOT }, B.COPPER_BLOCK, 1);
shapeless([B.COPPER_BLOCK], I.COPPER_INGOT, 9);
[[B.COPPER_BLOCK, B.WAXED_COPPER_BLOCK], [B.DULLED_COPPER, B.WAXED_DULLED_COPPER], [B.TARNISHED_COPPER, B.WAXED_TARNISHED_COPPER], [B.VERDIGRIS_COPPER, B.WAXED_VERDIGRIS_COPPER]]
  .forEach(([plain, waxed]) => shapeless([plain, I.HONEYCOMB], waxed, 1));
shaped(['C', 'C', 'C'], { C: I.COPPER_INGOT }, B.STORM_ROD, 1);
shaped(['SS', 'SS'], { S: I.VIOLITE_SHARD }, B.VIOLITE_BLOCK, 1);
shaped([' S ', 'SGS', ' S '], { S: I.VIOLITE_SHARD, G: B.GLASS }, B.SHADED_GLASS, 2);
shaped(['S', 'C', 'C'], { S: I.VIOLITE_SHARD, C: I.COPPER_INGOT }, I.FARGLASS, 1);
shaped(['PP', 'PP'], { P: B.SEEPSTONE_SPIKE }, B.SEEPSTONE, 1);
COLOR_BLOCKS.glass.forEach((id, c) => shaped(['GGG', 'GDG', 'GGG'], { G: B.GLASS, D: DYES[c] }, id, 8));
COLOR_BLOCKS.pane.forEach((id, c) => shaped(['GGG', 'GGG'], { G: COLOR_BLOCKS.glass[c] }, id, 16));
COLOR_BLOCKS.carpet.forEach((id, c) => shaped(['WW'], { W: WOOL_ITEMS[c] }, id, 3));
shapeless([B.STONE_BRICKS, B.VINES], B.MOSSY_STONE_BRICKS, 1);
shaped(['S', 'S'], { S: B.STONE_BRICK_SLAB }, B.CHISELED_STONE_BRICKS, 1);
COLOR_BLOCKS.terracotta.forEach((id, c) => shaped(['TTT', 'TDT', 'TTT'], { T: B.TERRACOTTA, D: DYES[c] }, id, 8));
COLOR_BLOCKS.concrete.forEach((id, c) => shapeless([DYES[c], B.SAND, B.SAND, B.SAND, B.SAND, B.GRAVEL, B.GRAVEL, B.GRAVEL, B.GRAVEL], id, 8));
for (const [raw, polished] of [[B.GRANITE, B.POLISHED_GRANITE], [B.DIORITE, B.POLISHED_DIORITE], [B.ANDESITE, B.POLISHED_ANDESITE]]) shaped(['XX', 'XX'], { X: raw }, polished, 4);

// Smelting: input -> output; 200 ticks per item (10 s)
export const SMELT_TIME = 200;
const ORE_INPUTS = new Set([I.RAW_IRON, I.RAW_GOLD, I.RAW_COPPER, B.IRON_ORE, B.GOLD_ORE, B.COPPER_ORE, B.DEEP_COPPER_ORE, B.DEEP_IRON_ORE, B.DEEP_GOLD_ORE]);
/** Does a Smoker ('food') or Blast Furnace ('ore') cook this input fast? */
export function fastCook(kind, input) {
  if (kind === 'ore') return ORE_INPUTS.has(input);
  const out = SMELTING[input];
  return kind === 'food' && out !== undefined && !!(ITEMS[out] && ITEMS[out].food);
}
export const SMELTING = {
  [I.RAW_IRON]: I.IRON_INGOT, [I.RAW_GOLD]: I.GOLD_INGOT, [I.RAW_COPPER]: I.COPPER_INGOT,
  [B.IRON_ORE]: I.IRON_INGOT, [B.GOLD_ORE]: I.GOLD_INGOT, [B.COPPER_ORE]: I.COPPER_INGOT, [B.DEEP_COPPER_ORE]: I.COPPER_INGOT,
  [B.SAND]: B.GLASS, [I.CLAY_BALL]: I.BRICK, [B.CLAY]: B.BRICKS, [B.CACTUS]: DYES[COLOR.GREEN], [B.COBBLESTONE]: B.STONE, [B.COBBLED_DEEPSTONE]: B.DEEPSTONE,
  [I.RAW_PORK]: I.COOKED_PORK, [I.POTATO]: I.BAKED_POTATO, [I.RAW_RABBIT]: I.COOKED_RABBIT, [I.RAW_SILVERFIN]: I.COOKED_SILVERFIN, [I.RAW_REDFIN]: I.COOKED_REDFIN, [I.RAW_BEEF]: I.STEAK, [I.RAW_CHICKEN]: I.COOKED_CHICKEN,
  [I.RAW_MUTTON]: I.COOKED_MUTTON, [B.OAK_LOG]: I.COAL, [B.SPRUCE_LOG]: I.COAL, [B.BIRCH_LOG]: I.COAL,
  [B.JUNGLE_LOG]: I.COAL, [B.ACACIA_LOG]: I.COAL, [B.DARK_OAK_LOG]: I.COAL, [B.BLOSSOM_LOG]: I.COAL, [B.RED_SAND]: B.GLASS,
  [B.WET_SOAKMOSS]: B.SOAKMOSS, [B.STONE]: B.SMOOTH_STONE, [B.STONE_BRICKS]: B.CRACKED_STONE_BRICKS,
};
