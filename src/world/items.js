// Item registry. Item ids 0..255 are block items (id === block id); 256+ are
// pure items. Tool stats, food values and fuel times mirror the documented
// reference numbers.
import { BLOCKS, B, TOOL, TIER, isBlockId, EXT_BASE, DOOR_SETS, BOX_COLORS } from './blocks.js';
import { COLORS } from './colors.js';
import { POTIONS, POTION_KEYS, potionColor } from './potions.js';
import { SHERDS, POT_CLAY } from './sherds.js';

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
  if (id >= EXT_BASE) throw new Error('item ids ran into the extended block ids');
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
item('cinnabar', 'Cinnabar Dust', { places: B.CINNABAR_WIRE }); // laid down as Cinnabar Wire
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
item('raw_rabbit', 'Raw Rabbit', { food: { hunger: 3, saturation: 1.8 }, iconStyle: ['meat', { h: '#e8b0a0', w: '#fff0e8' }] });
item('cooked_rabbit', 'Cooked Rabbit', { food: { hunger: 5, saturation: 6 }, iconStyle: ['meat', { h: '#b87a4a', w: '#e8c8a0' }] });
item('rabbit_hide', 'Rabbit Hide', { iconStyle: ['lump', { h: '#c8a882' }] });
item('raw_salmon_bear', 'Bear Meat', { food: { hunger: 3, saturation: 1.8 }, iconStyle: ['meat', { h: '#c86a5a', w: '#f0d8d0' }] });
item('melon_seeds', 'Melon Seeds', { places: B.MELON_STEM, iconStyle: ['seeds', { h: '#2a2a20', H: '#4a4a30' }] });
item('pumpkin_seeds', 'Pumpkin Seeds', { places: B.PUMPKIN_STEM, iconStyle: ['seeds', { h: '#e8d8a0', H: '#c8b878' }] });
item('cocoa_beans', 'Cocoa Beans', { cocoa: true, iconStyle: ['seeds', { h: '#7a4a24', H: '#5a3418' }] });
item('cookie', 'Cookie', { food: { hunger: 2, saturation: 0.4 }, iconStyle: ['bread', { h: '#c8904a', H: '#e0b070', w: '#5a3418' }] });
item('ink_sac', 'Ink Sac', { iconStyle: ['lump', { h: '#1a1a24' }] });
item('item_frame', 'Item Frame', { itemFrame: true, iconStyle: ['frame', { h: '#c8a068', H: '#a7834e', s: '#6a4a28', w: '#c8a068' }] });
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
// the Shellback Helmet is made separately (from scutes), after the loop above, so item ids stay put
ARMOR_MATERIALS.turtle = { defense: [2, 0, 0, 0], durability: 25, toughness: 0, color: '#4a9a3a', name: 'Shellback' };

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

// Brewing (see world/potions.js, world/brewing.js); appended so earlier ids stay stable
item('gold_nugget', 'Gold Nugget', { iconStyle: ['nugget', { h: '#f1cc3a' }] });
item('glass_vial', 'Glass Vial', { iconStyle: ['vial', { g: '#dbe8f5', h: '#a9bfd6', H: '#e4eef8' }] });
item('sugar', 'Sugar', { iconStyle: ['dust', { h: '#f4f4f8' }] });
item('gilded_melon_slice', 'Gilded Melon Slice', { iconStyle: ['meat', { h: '#e8584a', w: '#f2cc3a' }] });
item('gilded_carrot', 'Gilded Carrot', { food: { hunger: 6, saturation: 14.4 }, iconStyle: ['carrot', { h: '#f2c23a', H: '#fff0a0', s: '#d8a020' }] });
item('ember_cream', 'Ember Cream', { iconStyle: ['pearl', { h: '#c8501e', H: '#ffb040' }] });
item('fermented_spider_eye', 'Fermented Skitterer Eye', { iconStyle: ['egg', { h: '#7a2a40' }] });
item('cinderroot', 'Cinderroot', { places: B.CINDERROOT, iconStyle: ['root', { h: '#a8202a', s: '#5a1018' }] });
item('wraith_tear', 'Wraith Tear', { iconStyle: ['tear', { h: '#d8f0f4' }] });
item('milk_bucket', 'Milk Bucket', { stack: 1, milk: true, iconStyle: ['bucket', { h: '#b8b8b8', w: '#f6f6f2' }] });
// one drinkable and one splash item per elixir kind
export const POTION_ITEM = {}, SPLASH_ITEM = {};
for (const kind of POTION_KEYS) {
  const p = POTIONS[kind], color = potionColor(kind);
  if (p.late) continue; // (registered at the end, below)
  POTION_ITEM[kind] = item(kind === 'water' ? 'water_vial' : 'elixir_' + kind, p.name, { stack: 1, potion: { kind, splash: false }, drink: true, iconStyle: ['vial', { g: '#c8dcf0', h: color }] }).id;
  SPLASH_ITEM[kind] = item(kind === 'water' ? 'splash_water_vial' : 'splash_elixir_' + kind, 'Splash ' + p.name, { stack: 1, potion: { kind, splash: true }, throwable: 'potion', iconStyle: ['splash', { g: '#c8dcf0', h: color }] }).id;
}

// maps: an empty map is filled in where it is first used (stack.map = id, mapX/mapZ = the 128-block square)
item('empty_map', 'Empty Map', { emptyMap: true, iconStyle: ['map', { p: '#e8dcb8', e: '#a89868', g: '#e8dcb8', w: '#e8dcb8' }] });
item('honeycomb', 'Honeycomb', { iconStyle: ['lump', { h: '#f0a828', H: '#ffd060', s: '#b87010' }] });
item('honey_bottle', 'Honey Bottle', { stack: 16, food: { hunger: 6, saturation: 1.2, leaves: 'vial', cures: 'poison' }, iconStyle: ['vial', { g: '#dbe8f5', h: '#f0a020', H: '#ffd060' }] });
item('scute', 'Shellback Scute', { iconStyle: ['lump', { h: '#4a9a3a', H: '#7ac860', s: '#2a6a2a' }] });
item('turtle_shell', 'Shellback Helmet', { stack: 1, durability: 275, armor: { slot: 0, piece: 'helmet', material: 'turtle', defense: 2, toughness: 0 } });
item('crag_horn', 'Crag Horn', { stack: 1, horn: true, iconStyle: ['horn', { h: '#c8bca0', H: '#e8dcc0', s: '#8a7a5a' }] });
item('filled_map', 'Map', { stack: 1, filledMap: true, iconStyle: ['map', { p: '#e8dcb8', e: '#a89868', g: '#5a9a3a', w: '#3a6ad8' }] });
// Tide Citadel loot (reference: prismarine shard / prismarine crystals); appended so earlier ids stay stable
item('tide_shard', 'Tide Shard', { iconStyle: ['shard', { h: '#5aa898', H: '#9adcc8', s: '#2f6a62' }] });
item('tide_crystal', 'Tide Crystals', { iconStyle: ['seeds', { h: '#d8f4ea', H: '#ffffff' }] });
// Caves content (world/caves.js); appended so earlier ids stay stable
item('violite_shard', 'Violite Shard', { iconStyle: ['gem', { h: '#9a6ae0', H: '#d4b8ff' }] });
item('farglass', 'Farglass', { stack: 1, spyglass: true, iconStyle: ['horn', { h: '#d47a4c', H: '#f0a070', s: '#5a2e8a' }] });

// Fuel for block items
for (const id of [B.MANGROVE_PLANKS, B.MANGROVE_LOG, B.MANGROVE_ROOTS, B.BLOSSOM_PLANKS, B.BLOSSOM_LOG, B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.JUNGLE_PLANKS, B.ACACIA_PLANKS, B.DARK_OAK_PLANKS, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG, B.WORKBENCH]) ITEMS[id].fuel = 300;
for (const id of [B.OAK_SAPLING, B.BIRCH_SAPLING, B.SPRUCE_SAPLING, B.JUNGLE_SAPLING, B.ACACIA_SAPLING, B.DARK_OAK_SAPLING, B.BLOSSOM_SAPLING, B.MANGROVE_PROPAGULE]) ITEMS[id].fuel = 100;
ITEMS[B.COAL_BLOCK].fuel = 16000;
ITEMS[B.DRIED_KELP_BLOCK].fuel = 4000;

export function itemDef(id) { return ITEMS[id]; }
export function maxStack(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }
export function isBlockItem(id) { return isBlockId(id); }

export const HAND = { type: null, speed: 1, tier: -1, damage: 1, attackSpeed: 4 };
export function toolOf(stack) {
  if (!stack) return HAND;
  const d = ITEMS[stack.id];
  return d && (d.tool || d.weapon) ? d.tool || d.weapon : HAND;
}

export const TOOL_TYPES = TOOL;

// ---- The Hollow's outer islands (appended so earlier ids stay stable) ----------------
// Templates for ui/icons.js (an iconStyle may carry its own 16x16 template)
const ICON_GLIDER = ['................', '.hh..........hh.', '.hHh........hHh.', '.hHhh......hhHh.', '.hHhhh....hhhHh.', '.hhHhhhsshhhHhh.', '..hhHhhsshhHhh..', '..hhhHhsshHhhh..', '...hhhhsshhhh...', '...hhhh..hhhh...', '....hhh..hhh....', '....hh....hh....', '.....h....h.....', '................', '................', '................'];
const ICON_ROCKET = ['................', '..........ww....', '.........whhw...', '.........hHhh...', '........hHhh....', '.......hHhh.....', '......hhhh......', '.....shhh.......', '....ss..........', '...ss...........', '..ss............', '.ss.............', '................', '................', '................', '................'];
const ICON_SHELL = ['................', '................', '....hhhhhhhh....', '...hHHHHHHHHh...', '..hHhhhhhhhhhh..', '..hhhhhhhhhhhh..', '..ssssssssssss..', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..', '...hhhhhhhhhh...', '....hhhhhhhh....', '................', '................', '................', '................', '................'];
// Voidwing (reference: elytra): worn in the chest slot, glides; 432 uses, repaired with Drift Membrane
ARMOR_MATERIALS.voidwing = { defense: [0, 0, 0, 0], durability: 27, toughness: 0, color: '#4a3a6a', name: 'Voidwing' };
item('gloomshell_husk', 'Gloomshell Husk', { iconStyle: [ICON_SHELL, { h: '#9a64a8', H: '#c896d4', s: '#3e2448' }] });
item('drift_membrane', 'Drift Membrane', { iconStyle: ['meat', { h: '#b8c8dc', w: '#8a9ab8' }] });
item('voidwing', 'Voidwing', {
  stack: 1, durability: 432, glider: true, repairWith: 'DRIFT_MEMBRANE',
  armor: { slot: 1, piece: 'chestplate', material: 'voidwing', defense: 0, toughness: 0, glider: true },
  iconStyle: [ICON_GLIDER, { h: '#5a4a86', H: '#9a8ad0', s: '#2a2040' }],
});
item('sky_rocket', 'Sky Rocket', { rocket: true, iconStyle: [ICON_ROCKET, { h: '#c8303a', H: '#f06a6a', w: '#f4f0e4', s: '#7a5a32' }] });
item('hushfruit', 'Hushfruit', { food: { hunger: 4, saturation: 2.4, always: true, teleport: true }, iconStyle: ['apple', { h: '#8a5aa0', H: '#b68ac8', s: '#4a3058', l: '#c8a8d8' }] });
item('popped_hushfruit', 'Popped Hushfruit', { iconStyle: ['potato', { h: '#c8a4d4', H: '#e4d0ec', s: '#8a6a98' }] });
// Crossbow: hold use to load an arrow (1.25 s), then click to fire it, harder and flatter than a bow
item('crossbow', 'Crossbow', { stack: 1, durability: 465, crossbow: true });
item('crossbow_loaded', 'Crossbow (Loaded)', { stack: 1, durability: 465, crossbow: true, loaded: true });
// Tidespear (reference: trident): a strong melee weapon that can be thrown (hold use, release);
// it lands as an item to pick back up. Dropped by Sodden Shamblers.
const ICON_SPEAR = ['................', '...........h.h.h', '...........hHhHh', '............hHh.', '...........hhh..', '..........ss....', '.........ss.....', '........ss......', '.......ss.......', '......ss........', '.....ss.........', '....ss..........', '...ss...........', '..ss............', '.ss.............', '................'];
item('tidespear', 'Tidespear', { stack: 1, durability: 250, spear: true, weapon: { type: 'spear', speed: 1, tier: -1, damage: 9, attackSpeed: 1.1 }, iconStyle: [ICON_SPEAR, { h: '#5aa898', H: '#9adcc8', s: '#3f7a72', S: '#6ab0a4' }] });
// Gilded Apple (reference: golden apple): always edible; Regeneration II for 5 s and Absorption for 2 min
item('gilded_apple', 'Gilded Apple', { food: { hunger: 4, saturation: 9.6, always: true, effects: [['regeneration', 100, 1], ['absorption', 2400, 0]] }, iconStyle: ['apple', { h: '#f2c23a', H: '#fff0a0', s: '#8a6a2a', l: '#3a8a2a' }] });
// Tipped arrows: eight arrows round a splash elixir; the hit lays an eighth of the elixir's effect
export const TIPPED_ARROW = {};
for (const kind of POTION_KEYS) {
  const p = POTIONS[kind];
  if (!p.effects.length || p.late) continue;
  TIPPED_ARROW[kind] = item('tipped_arrow_' + kind, p.name.replace('Elixir of', 'Arrow of'), { tipped: kind, gear: ['arrow', { tip: potionColor(kind) }] }).id;
}
// Charm of Undying (reference: totem of undying): saves its holder from death once (player/player.js)
const ICON_CHARM = ['................', '......hhhh......', '.....hHHHHh.....', '.....hHwwHh.....', '.....hwkkwh.....', '...hhhhhhhhhh...', '..hHhhhhhhhhHh..', '...hh.hHHh.hh...', '......hhhh......', '.....hHhhHh.....', '.....hhkkhh.....', '......hhhh......', '......h..h......', '.....hh..hh.....', '................', '................'];
item('charm_of_undying', 'Charm of Undying', { stack: 1, undying: true, iconStyle: [ICON_CHARM, { h: '#e8b83a', H: '#fff0a0', w: '#6ad8a8', k: '#2a6a4a' }] });
item('sweet_berries', 'Sweet Berries', { food: { hunger: 2, saturation: 0.4 }, places: B.SWEET_BERRY_BUSH, iconStyle: ['seeds', { h: '#c8202e', H: '#ff6a6a' }] });
// doors of the other woods (the oak door item came first)
BLOCKS[B.DOOR].doorItem = I.OAK_DOOR;
for (const [planks, door, , name, key] of DOOR_SETS.slice(1)) {
  if (BLOCKS[door].lateItem) continue; // (appended at the end, below)
  const d = item(key + '_door', `${name} Door`, { door: true, doorBlock: door, doorPlanks: planks });
  BLOCKS[door].doorItem = d.id;
}
// Music discs for the jukebox: each always plays the same composed piece (audio/music.js playDisc)
const ICON_DISC = ['................', '.....kkkkkk.....', '...kkddddddkk...', '..kddddddddddk..', '..kdddllllddk...', '.kdddlllllldddk.', '.kddlllwwllldk..', '.kddllw..wlldk..', '.kddllw..wlldk..', '.kddlllwwllldk..', '.kdddlllllldddk.', '..kdddllllddk...', '..kddddddddddk..', '...kkddddddkk...', '.....kkkkkk.....', '................'];
export const DISCS = [];
for (const [key, name, label, mood, root, bpm, rounds] of [
  ['three_suns', 'Three Suns', '#f2c23a', 'day', 52, 72, 3], ['ringfall', 'Ringfall', '#c8a878', 'day', 55, 66, 4], ['deepstone', 'Deepstone', '#6a6a7a', 'cave', 45, 54, 3],
  ['embers', 'Embers', '#e85a1a', 'night', 50, 64, 3], ['tidecall', 'Tidecall', '#3aa8c8', 'night', 53, 60, 4], ['hollow', 'Hollow', '#8a5ad8', 'cave', 47, 50, 3],
  ['blossom', 'Blossom', '#f0a2c0', 'day', 57, 76, 3], ['starlight', 'Starlight', '#d8e0ff', 'night', 48, 58, 4]]) {
  const d = item('disc_' + key, 'Music Disc: ' + name, { stack: 1, disc: { index: DISCS.length, seed: 0x5eed + DISCS.length * 7919, mood, root, bpm, rounds, title: name }, iconStyle: [ICON_DISC, { k: '#1a1a1e', d: '#2e2e34', l: label, w: '#f4f0e4', h: '#2e2e34' }] });
  DISCS.push(d.id);
}
item('dried_kelp', 'Dried Kelp', { food: { hunger: 1, saturation: 0.6, fast: true }, iconStyle: ['meat', { h: '#3a4a2a', w: '#2a3a1e' }] });
item('glow_berries', 'Glow Berries', { food: { hunger: 2, saturation: 0.4 }, places: B.CAVE_VINES, iconStyle: ['seeds', { h: '#ffb030', H: '#ffe080' }] });
item('iron_nugget', 'Iron Nugget', { iconStyle: ['nugget', { h: '#d8d8d8' }] });
// Suncore (the beacon's heart): from Elder Deepeyes and the Void Wyrm
const ICON_STAR = ['................', '.......hh.......', '.......hh.......', '......hHHh......', '..hh..hHHh..hh..', '...hhhHwwHhhh...', '....hHwwwwHh....', '..hhHwwwwwwHhh..', '..hhHwwwwwwHhh..', '....hHwwwwHh....', '...hhhHwwHhhh...', '..hh..hHHh..hh..', '......hHHh......', '.......hh.......', '.......hh.......', '................'];
item('suncore', 'Suncore', { iconStyle: [ICON_STAR, { h: '#e8a020', H: '#ffe070', w: '#fffbe8' }] });
// Armour Stand (entities/armorStand.js): wears armour and holds an item
const ICON_STAND = ['................', '.......ww.......', '.......ww.......', '...wwwwwwwwww...', '...w..w..w..w...', '...w..w..w..w...', '...w..w..w..w...', '......wwww......', '......w..w......', '......w..w......', '......w..w......', '......w..w......', '......w..w......', '..ssssssssssss..', '..SSSSSSSSSSSS..', '................'];
item('armor_stand', 'Armor Stand', { stack: 16, armorStand: true, iconStyle: [ICON_STAND, { w: '#b08850', s: '#b4b4b4', S: '#7a7a7a' }] });
// Fire Charge: lights a fire where it is used (used up); a Dispenser shoots it as a small fireball
item('fire_charge', 'Fire Charge', { igniter: true, charge: true, iconStyle: ['pearl', { h: '#4a2a14', H: '#ff8a20' }] });
// doors of woods added after the item list was laid out (blocks marked lateItem)
for (const [planks, door, , name, key] of DOOR_SETS) {
  if (!BLOCKS[door].lateItem) continue;
  BLOCKS[door].doorItem = item(key + '_door', `${name} Door`, { door: true, doorBlock: door, doorPlanks: planks }).id;
}
// Hush Shard: a sliver of a Hushkeeper's heart, found in the chests of the Deep Hush ruins
item('hush_shard', 'Hush Shard', { iconStyle: ['gem', { h: '#1a6a70', H: '#5ff8ec' }] });
// Utility items (appended so earlier ids stay stable): Lead (leashes animals, ties them to fence
// posts; entities/leash.js), Name Tag (stack.label; a named mob keeps its name and never despawns)
// and Bundle (stack.bundle: up to 64 weight of mixed items; world/bundles.js)
const ICON_LEAD = ['................', '.....hhhhh......', '....hH...Hh.....', '...hH.....hh....', '...h.......h....', '...h.......h....', '...hh.....hh....', '....hhhhhhh.....', '......k.........', '......h.........', '......hh........', '.......hh.......', '........hh......', '.........hh.....', '..........hk....', '................'];
const ICON_TAG = ['................', '................', '..........kk....', '.........k..k...', '........hhkkh...', '.......hHHHHHh..', '......hHHHHHh...', '.....hHHwwHh....', '....hHHwwHh.....', '...hHHHHHh......', '..hHHHHHh.......', '..hhHHHh........', '...hhHh.........', '....hh..........', '................', '................'];
const ICON_BUNDLE = ['................', '................', '......kkkk......', '.....k....k.....', '......kkkk......', '......hssh......', '.....hHHHHh.....', '....hHHHHHHh....', '...hHHHHHHHHh...', '...hHHHHHHHhh...', '...hHHHHHHhhh...', '...hhHHHHhhhh...', '....hhhhhhhh....', '.....hhhhhh.....', '................', '................'];
item('lead', 'Lead', { lead: true, iconStyle: [ICON_LEAD, { h: '#b08a5a', H: '#d8b88a', k: '#7a5a32' }] });
item('name_tag', 'Name Tag', { nameTag: true, iconStyle: [ICON_TAG, { h: '#8a6a3a', H: '#d8c8a0', w: '#f4ecd8', k: '#9a9aa0' }] });
item('bundle', 'Bundle', { stack: 1, bundle: true, iconStyle: [ICON_BUNDLE, { h: '#7a4a2a', H: '#a8683a', s: '#c8a068', k: '#e8dcc0' }] });
// Archaeology (world/archaeology.js): the Brush (hold use on Suspicious Sand or Gravel) and the Pottery Sherds it finds
const ICON_BRUSH = ['................', '...........hHh..', '..........hHHHh.', '.........hHHHHh.', '.........hhHHh..', '........cchhh...', '.......cCc......', '......sss.......', '.....ss.........', '....ss..........', '...ss...........', '..ss............', '.ss.............', '................', '................', '................'];
item('brush', 'Brush', { stack: 1, durability: 64, brush: true, iconStyle: [ICON_BRUSH, { h: '#e8e4dc', H: '#ffffff', c: '#c87a4a', C: '#f0a070', s: '#8a6034' }] });
const SHERD_SHAPE = ['................', '.....HHHHHH.....', '...HHhhhhhhhh...', '..Hhhhhhhhhhhh..', '..hhhhhhhhhhhhh.', '.Hhhhhhhhhhhhhh.', '.hhhhhhhhhhhhhh.', '.hhhhhhhhhhhhh..', '.hhhhhhhhhhhhh..', '..hhhhhhhhhhhs..', '..hhhhhhhhhhs...', '...hhhhhhhhhs...', '....hhhhhhss....', '.....hhhss......', '......ss........', '................'];
export const SHERD_ITEMS = [];
SHERDS.forEach((s, k) => {
  const tpl = SHERD_SHAPE.map((row, y) => [...row].map((ch, x) => (ch !== '.' && y >= 3 && y < 11 && x >= 4 && x < 12 && s.motif[y - 3][x - 4] === '#' ? 'k' : ch)).join(''));
  SHERD_ITEMS.push(item('sherd_' + s.key, s.name, { sherd: k, iconStyle: [tpl, { h: POT_CLAY.body, H: POT_CLAY.light, s: POT_CLAY.dark, k: POT_CLAY.line }] }).id);
});
ITEMS[B.DECORATED_POT].stack = 1; // a pot keeps its sherds in the item (stack.sherds)
ITEMS[B.GLOOMSHELL_BOX].stack = 1; // a box keeps its contents in the item (stack.contents), so it never stacks
// Lingering elixirs (appended so earlier ids stay stable; see entities/areaCloud.js): Hollow Breath, bottled
// from the Void Wyrm's breath clouds, turns a splash vial into a lingering one whose cloud lays a quarter of
// each effect. Then the vials and tipped arrows of the elixir kinds added later (POTIONS[kind].late).
item('hollow_breath', 'Hollow Breath', { iconStyle: ['vial', { g: '#dbe8f5', h: '#a04ad8', H: '#f0b8ff', w: '#e8c8ff' }] });
export const LINGERING_ITEM = {};
const tipName = (p) => p.name.replace('Elixir of', 'Arrow of');
for (const kind of POTION_KEYS) {
  const p = POTIONS[kind], color = potionColor(kind);
  if (p.late) {
    POTION_ITEM[kind] = item('elixir_' + kind, p.name, { stack: 1, potion: { kind, splash: false }, drink: true, iconStyle: ['vial', { g: '#c8dcf0', h: color }] }).id;
    SPLASH_ITEM[kind] = item('splash_elixir_' + kind, 'Splash ' + p.name, { stack: 1, potion: { kind, splash: true }, throwable: 'potion', iconStyle: ['splash', { g: '#c8dcf0', h: color }] }).id;
    if (p.effects.length) TIPPED_ARROW[kind] = item('tipped_arrow_' + kind, tipName(p), { tipped: kind, gear: ['arrow', { tip: color }] }).id;
  }
  LINGERING_ITEM[kind] = item(kind === 'water' ? 'lingering_water_vial' : 'lingering_elixir_' + kind, 'Lingering ' + p.name, { stack: 1, potion: { kind, splash: true, lingering: true }, throwable: 'potion', iconStyle: ['lingering', { g: '#c8dcf0', h: color }] }).id;
}
// Books you write in (world/books.js): a Writable Book keeps its pages on the stack (stack.pages);
// signed, it becomes a Written Book with a title and an author that can only be read
const ICON_QUILL_BOOK = ['................', '............kk..', '....hhhhhhhkk...', '...hHHHHHHHkw...', '...hhhhhhhkhw...', '...hhhhhhkhhw...', '...hhwwwkhhhw...', '...hhhhkhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhhw...', '...hhhhhhhhw....', '................', '................', '................', '................'];
item('writable_book', 'Writable Book', { stack: 1, writable: true, iconStyle: [ICON_QUILL_BOOK, { h: '#7a4a2a', H: '#9a6038', w: '#f0eadc', k: '#2a2a32' }] });
item('written_book', 'Written Book', { stack: 16, written: true, iconStyle: ['book', { h: '#2a5a7a', H: '#3a7aa0', w: '#f0eadc' }] });
for (const id of [B.CAKE, ...BOX_COLORS]) ITEMS[id].stack = 1; // a cake is carried whole; dyed boxes keep their contents too
ITEMS[I.MILK_BUCKET].craftRemainder = I.BUCKET; // the cake's milk leaves its buckets in the grid
BLOCKS[B.CAKE].iconStyle = [['................', '................', '................', '.......rr.......', '....wwwwwwww....', '..wwwwwwwwwwww..', '..WwwwwwwwwwwW..', '..ssWWwwwwWWss..', '..ssssWWWWssss..', '..hhhhhhhhhhhh..', '..ssssssssssss..', '..hhhhhhhhhhhh..', '..ssssssssssss..', '...hhhhhhhhhh...', '................', '................'], { w: '#f4f0ec', W: '#e0d8d0', s: '#c8884a', h: '#a8683a', r: '#d0283a' }];
BLOCKS[B.LECTERN].iconStyle = [['................', '................', '..wwwwwwwwwwww..', '..wppppppppppw..', '..wppppppppppw..', '..wwwwwwwwwwww..', '..ssssssssssss..', '......hhhh......', '......hHhh......', '......hHhh......', '......hHhh......', '......hhhh......', '...ssssssssss...', '..hhhhhhhhhhhh..', '..ssssssssssss..', '................'], { w: '#8a6034', p: '#e8dcc0', s: '#6e4a26', h: '#a07a45', H: '#b8905a' }];
// Proving Key (world/provingSystem.js): beaten Proving Spawner waves throw them out; used on a Vault it
// opens it once for each player
const ICON_PROVING_KEY = ['................', '...hhhh.........', '..hHHHHh........', '.hH.kk.Hh.......', '.hH.kk.Hh.......', '..hHHHHhh.......', '...hhhhhhh......', '........hhh.....', '.........hhh....', '..........hhh...', '.........shhh...', '........ss.hhh..', '.........s..hhs.', '.............ss.', '................', '................'];
item('proving_key', 'Proving Key', { provingKey: true, iconStyle: [ICON_PROVING_KEY, { h: '#c8794a', H: '#f4b27a', s: '#7a4a2c', k: '#2a1a10' }] });

/** Light level (0-15) an item gives when held: a torch, lantern or other light block; 0 for the rest. */
/** Is this item an arrow a bow can shoot (plain or tipped)? */
export const isArrow = (id) => id === I.ARROW || !!(ITEMS[id] && ITEMS[id].tipped);

export function heldLightLevel(id) {
  const d = id != null && ITEMS[id];
  if (!d) return 0;
  const b = BLOCKS[d.block ?? d.places];
  return b && b.emit ? b.emit : 0;
}
