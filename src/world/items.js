// Item registry. Item ids 0..255 are block items (id === block id); 256+ are
// pure items. Tool stats, food values and fuel times mirror the documented
// reference numbers.
import { BLOCKS, B, TOOL, TIER } from './blocks.js';

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
item('egg', 'Egg', { stack: 16 });

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

// Tools
for (const mat of Object.keys(MATERIALS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'sword']) {
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

// Fuel for block items
for (const id of [B.OAK_PLANKS, B.SPRUCE_PLANKS, B.BIRCH_PLANKS, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.WORKBENCH]) ITEMS[id].fuel = 300;
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
