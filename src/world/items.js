// Item registry. Item ids 0..255 are block items (id === block id); 256+ are
// pure items. Tool stats, food values and fuel times mirror the documented
// reference numbers.
import { BLOCKS, B, TOOL, TIER } from './blocks.js';
import { COLORS } from './colors.js';

export const ITEMS = [];
export const I = {};

// Tool material stats: mining speed multiplier, durability, harvest tier.
export const MATERIALS = {
  wood:    { speed: 2,  durability: 59,   tier: TIER.WOOD,    color: '#a07a45' },
  stone:   { speed: 4,  durability: 131,  tier: TIER.STONE,   color: '#8a8a8a' },
  iron:    { speed: 6,  durability: 250,  tier: TIER.IRON,    color: '#dcdcdc' },
  gold:    { speed: 12, durability: 32,   tier: TIER.WOOD,    color: '#f2d24b' },
  diamond: { speed: 8,  durability: 1561, tier: TIER.DIAMOND, color: '#5fe6dc' },
};

// [attack damage, attack speed] per tool type and material
const TOOL_COMBAT = {
  sword:   { wood: [4, 1.6], stone: [5, 1.6], iron: [6, 1.6], gold: [4, 1.6], diamond: [7, 1.6] },
  axe:     { wood: [7, 0.8], stone: [9, 0.8], iron: [9, 0.9], gold: [7, 1.0], diamond: [9, 1.0] },
  pickaxe: { wood: [2, 1.2], stone: [3, 1.2], iron: [4, 1.2], gold: [2, 1.2], diamond: [5, 1.2] },
  shovel:  { wood: [2.5, 1], stone: [3.5, 1], iron: [4.5, 1], gold: [2.5, 1], diamond: [5.5, 1] },
  hoe:     { wood: [1, 1],   stone: [1, 2],   iron: [1, 3],   gold: [1, 1],   diamond: [1, 4] },
};

let nextId = 256;
function item(key, name, props = {}) {
  const id = nextId++;
  const d = { id, key, name, stack: 64, icon: key, ...props };
  ITEMS[id] = d;
  I[key.toUpperCase()] = id;
  return d;
}

// Block items
for (const b of BLOCKS) {
  if (!b || b.id === B.AIR) continue;
  ITEMS[b.id] = { id: b.id, key: b.name.toLowerCase().replace(/ /g, '_'), name: b.name, stack: 64, block: b.id };
}

// Materials
item('stick', 'Stick', { fuel: 100 });
item('coal', 'Coal', { fuel: 1600 });
item('raw_iron', 'Raw Iron');
item('iron_ingot', 'Iron Ingot');
item('raw_copper', 'Raw Copper');
item('copper_ingot', 'Copper Ingot');
item('raw_gold', 'Raw Gold');
item('gold_ingot', 'Gold Ingot');
item('cinnabar', 'Cinnabar Dust');
item('azurite', 'Azurite');
item('diamond', 'Diamond');
item('beryl', 'Beryl');
item('flint', 'Flint');
item('clay_ball', 'Clay Ball');
item('leather', 'Leather');
item('feather', 'Feather');
item('string', 'String');
item('bone', 'Bone');
item('arrow', 'Arrow');
item('gunpowder', 'Blast Powder');
item('void_pearl', 'Void Pearl', { stack: 16 });
item('egg', 'Egg', { stack: 16, throwable: 'egg' });

// Food: hunger points restored and saturation points (absolute) as documented.
item('raw_pork', 'Raw Pork Chop', { food: { hunger: 3, saturation: 1.8 } });
item('cooked_pork', 'Roast Pork Chop', { food: { hunger: 8, saturation: 12.8 } });
item('raw_beef', 'Raw Beef', { food: { hunger: 3, saturation: 1.8 } });
item('steak', 'Steak', { food: { hunger: 8, saturation: 12.8 } });
item('raw_chicken', 'Raw Fowl', { food: { hunger: 2, saturation: 1.2, effect: { type: 'hunger', chance: 0.3, ticks: 600 } } });
item('cooked_chicken', 'Roast Fowl', { food: { hunger: 6, saturation: 7.2 } });
item('raw_mutton', 'Raw Mutton', { food: { hunger: 2, saturation: 1.2 } });
item('cooked_mutton', 'Roast Mutton', { food: { hunger: 6, saturation: 9.6 } });
item('rotten_flesh', 'Rotten Flesh', { food: { hunger: 4, saturation: 0.8, effect: { type: 'hunger', chance: 0.8, ticks: 600 } } });
item('spider_eye', 'Skitterer Eye', { food: { hunger: 2, saturation: 3.2, effect: { type: 'poison', chance: 1, ticks: 100 } } });
item('apple', 'Apple', { food: { hunger: 4, saturation: 2.4 } });

item('bucket', 'Bucket', { stack: 16 });
item('water_bucket', 'Water Bucket', { stack: 1, places: B.WATER });
item('lava_bucket', 'Lava Bucket', { stack: 1, places: B.LAVA, fuel: 20000 });
item('bow', 'Bow', { stack: 1, durability: 384, bow: true });
item('wheat_seeds', 'Wheat Seeds', { places: B.WHEAT });
item('oak_door', 'Oak Door', { door: true });
item('bed', 'Bed', { stack: 1, bed: true });
item('oak_boat', 'Oak Boat', { stack: 1, boat: true });
item('wheat', 'Wheat');
item('bread', 'Bread', { food: { hunger: 5, saturation: 6 } });
item('carrot', 'Carrot', { food: { hunger: 3, saturation: 3.6 }, places: B.CARROTS });
item('potato', 'Potato', { food: { hunger: 1, saturation: 0.6 }, places: B.POTATOES });
item('baked_potato', 'Baked Potato', { food: { hunger: 5, saturation: 6 } });
item('poisonous_potato', 'Poisonous Potato', { food: { hunger: 2, saturation: 1.2, effect: { type: 'poison', chance: 0.6, ticks: 100 } } });
item('beetroot', 'Beetroot', { food: { hunger: 1, saturation: 1.2 } });
item('beetroot_seeds', 'Beetroot Seeds', { places: B.BEETROOTS });
item('bowl', 'Bowl');
item('beetroot_soup', 'Beetroot Soup', { stack: 1, food: { hunger: 6, saturation: 7.2, leaves: 'bowl' } });
item('shears', 'Shears', { stack: 1, durability: 238, shears: true });
item('flint_and_steel', 'Flint and Steel', { stack: 1, durability: 64, igniter: true });
item('compass', 'Compass', { stack: 1, dial: 'compass' });
item('clock', 'Clock', { stack: 1, dial: 'clock' });
item('sign', 'Oak Sign', { stack: 16, sign: true, iconStyle: ['sign', { h: '#a7834e', H: '#c8a068', s: '#6a4a28' }] });
item('painting', 'Painting', { painting: true, iconStyle: ['frame', { h: '#6ab0e8', H: '#3a7a3a', s: '#5a3a1e', w: '#ffe08a' }] });
item('saddle', 'Saddle', { stack: 1, saddle: true, iconStyle: ['saddle', { h: '#7a4a2a', H: '#9a6238', s: '#c8c8cc' }] });
item('shield', 'Shield', { stack: 1, durability: 336, shield: true, iconStyle: ['shield', { h: '#8a6034', H: '#a87a48', s: '#9a9aa0', w: '#5a3d1e' }] });
item('minecart', 'Minecart', { stack: 1, minecart: true, iconStyle: ['cart', { h: '#8a8a90', H: '#b8b8c0', s: '#2a2a2e' }] });
item('fishing_rod', 'Fishing Rod', { stack: 1, durability: 64, rod: true, iconStyle: ['rod', { s: '#7a5a32', w: '#dddddd', h: '#c8302a' }] });
item('raw_silverfin', 'Raw Silverfin', { food: { hunger: 2, saturation: 0.4 }, iconStyle: ['fish', { h: '#9aa8b0', H: '#c8d4dc', s: '#5a6a74' }] });
item('cooked_silverfin', 'Cooked Silverfin', { food: { hunger: 5, saturation: 6 }, iconStyle: ['fish', { h: '#c89a5a', H: '#e8c088', s: '#7a5a32' }] });
item('raw_redfin', 'Raw Redfin', { food: { hunger: 2, saturation: 0.4 }, iconStyle: ['fish', { h: '#c8504a', H: '#e8807a', s: '#6a3a3a' }] });
item('cooked_redfin', 'Cooked Redfin', { food: { hunger: 6, saturation: 9.6 }, iconStyle: ['fish', { h: '#d8804a', H: '#f0a870', s: '#8a4a2a' }] });
item('spinefish', 'Spinefish', { food: { hunger: 1, saturation: 0.2, effect: { type: 'poison', chance: 1, ticks: 300 } }, iconStyle: ['fish', { h: '#d8c040', H: '#f0e070', s: '#7a6a20' }] });
item('glimmerfin', 'Glimmerfin', { food: { hunger: 1, saturation: 0.2 }, iconStyle: ['fish', { h: '#40b8d8', H: '#f0a030', s: '#2a5a7a' }] });
item('slimeball', 'Slimeball', { iconStyle: ['pearl', { h: '#7ac850' }] });
item('snowball', 'Snowball', { stack: 16, throwable: 'snowball' });
item('paper', 'Paper');
item('book', 'Book');
item('brick', 'Brick');
item('bone_meal', 'Bone Meal', { boneMeal: true });
item('melon_slice', 'Melon Slice', { food: { hunger: 2, saturation: 1.2 } });
item('pumpkin_pie', 'Pumpkin Pie', { food: { hunger: 8, saturation: 4.8 } });
// dyes and coloured wool (white wool is the plain Wool block item)
export const DYES = [], WOOL_ITEMS = [];
COLORS.forEach(([key, name], c) => {
  DYES[c] = c === 0 ? null : item(`${key}_dye`, `${name} Dye`, { dye: c }).id;
  WOOL_ITEMS[c] = c === 0 ? B.WOOL : item(`${key}_wool`, `${name} Wool`, { places: B.WOOL, placeMeta: c, woolColor: c }).id;
});

// Tools
for (const mat of Object.keys(MATERIALS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
    const m = MATERIALS[mat];
    const [damage, attackSpeed] = TOOL_COMBAT[type][mat];
    const name = `${mat === 'wood' ? 'Wooden' : mat === 'gold' ? 'Golden' : mat[0].toUpperCase() + mat.slice(1)} ${type[0].toUpperCase() + type.slice(1)}`;
    item(`${mat}_${type}`, name, {
      stack: 1,
      tool: { type, material: mat, speed: m.speed, tier: m.tier, damage, attackSpeed },
      durability: m.durability,
      fuel: mat === 'wood' ? 200 : undefined,
    });
  }
}

// Armour: defence per piece (helmet, chestplate, leggings, boots), durability
// multiplier (x 11/16/15/13) and toughness, as documented for the reference game.
export const ARMOR_MATERIALS = {
  leather: { defense: [1, 3, 2, 1], durability: 5, toughness: 0, color: '#9a5f32', name: 'Leather' },
  gold:    { defense: [2, 5, 3, 1], durability: 7, toughness: 0, color: '#f2d24b', name: 'Golden' },
  iron:    { defense: [2, 6, 5, 2], durability: 15, toughness: 0, color: '#dcdcdc', name: 'Iron' },
  diamond: { defense: [3, 8, 6, 3], durability: 33, toughness: 2, color: '#5fe6dc', name: 'Diamond' },
};
const ARMOR_PIECES = [['helmet', 'Helmet', 11], ['chestplate', 'Chestplate', 16], ['leggings', 'Leggings', 15], ['boots', 'Boots', 13]];
for (const [mat, m] of Object.entries(ARMOR_MATERIALS)) {
  ARMOR_PIECES.forEach(([piece, pname, base], slot) => {
    item(`${mat}_${piece}`, `${m.name} ${pname}`, {
      stack: 1, durability: base * m.durability,
      armor: { slot, piece, material: mat, defense: m.defense[slot], toughness: m.toughness },
    });
  });
}

// Added after the armour so earlier item ids stay stable for old saves
item('mushroom_stew', 'Mushroom Stew', { stack: 1, food: { hunger: 6, saturation: 7.2, leaves: 'bowl' } });
// Cinderdeep / Hollow items (iconStyle: [template, colours] for ui/icons.js)
item('ember_rod', 'Ember Rod', { fuel: 2400, iconStyle: ['stick', { s: '#ffb030' }] });
item('ember_powder', 'Ember Powder', { iconStyle: ['dust', { h: '#ff9a20' }] });
item('ember_quartz', 'Ember Quartz', { iconStyle: ['gem', { h: '#f0d8c8' }] });
item('glowshard_dust', 'Glowshard Dust', { iconStyle: ['dust', { h: '#ffd860' }] });
item('eye_of_the_void', 'Eye of the Void', { stack: 16, voidEye: true, iconStyle: ['pearl', { h: '#3aa88a', H: '#c8ff6a' }] });
// Enchanted book: carries stack.ench, applied to gear at an anvil (see world/enchantments.js)
item('enchanted_book', 'Enchanted Book', { stack: 1, enchBook: true, iconStyle: ['book', { h: '#7a2a8a', H: '#a050c0', w: '#f0e4c8' }] });

// Fuel for block items
for (const id of [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS, B.DARK_OAK_PLANKS, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG, B.WORKBENCH]) ITEMS[id].fuel = 300;
for (const id of [B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING, B.JUNGLE_SAPLING, B.ACACIA_SAPLING, B.DARK_OAK_SAPLING]) ITEMS[id].fuel = 100;
ITEMS[B.COAL_BLOCK].fuel = 16000;

export function itemDef(id) { return ITEMS[id]; }
export function maxStack(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }
export function isBlockItem(id) { return id > 0 && id < 256; }

export const HAND = { type: null, speed: 1, tier: -1, damage: 1, attackSpeed: 4 };
export function toolOf(stack) {
  if (!stack) return HAND;
  const d = ITEMS[stack.id];
  return d && d.tool ? d.tool : HAND;
}

export const TOOL_TYPES = TOOL;
