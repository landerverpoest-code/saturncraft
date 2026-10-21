// Block registry. Numbers (hardness, blast resistance, light emission, tool
// requirements) follow the reference values documented on the public wiki.
// Names are Saturncraft's own.

export const TOOL = { NONE: null, PICKAXE: 'pickaxe', AXE: 'axe', SHOVEL: 'shovel', SWORD: 'sword', HOE: 'hoe' };

// Harvest tiers: -1 = no tool required, 0 = wood/gold, 1 = stone, 2 = iron, 3 = diamond
export const TIER = { ANY: -1, WOOD: 0, STONE: 1, IRON: 2, DIAMOND: 3 };

// Render shapes understood by the mesher
export const SHAPE = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3, TORCH: 4, CACTUS: 5, CROP: 6, DOOR: 7, LADDER: 8, BED: 9, SLAB: 10, STAIRS: 11, FENCE: 12, GATE: 13, PANE: 14, FIRE: 15, PAD: 16, SNOW: 17, WALL: 18, TRAPDOOR: 19, RAIL: 20, BOXES: 21, PAINTING: 22,
  // Cinnabar circuitry (ids from 30 to stay clear of other shapes): flat wire, and parts drawn from boxes (world/circuitShapes.js)
  WIRE: 30, CIRCUIT: 31,
  // Caves content (world/caves.js): crossed sprites pointing along meta's facing (crystal buds, Seepstone spikes)
  CRYSTAL: 40 };

// Render layers
export const LAYER = { OPAQUE: 0, CUTOUT: 1, TRANSLUCENT: 2 };

export const B = {
  AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLESTONE: 4, OAK_PLANKS: 5, BEDROCK: 6,
  WATER: 7, LAVA: 8, SAND: 9, GRAVEL: 10, OAK_LOG: 11, OAK_LEAVES: 12, BIRCH_LOG: 13,
  BIRCH_LEAVES: 14, SPRUCE_LOG: 15, SPRUCE_LEAVES: 16, GLASS: 17, COAL_ORE: 18,
  IRON_ORE: 19, COPPER_ORE: 20, GOLD_ORE: 21, CINNABAR_ORE: 22, AZURITE_ORE: 23,
  DIAMOND_ORE: 24, BERYL_ORE: 25, DEEPSTONE: 26, COBBLED_DEEPSTONE: 27,
  DEEP_COAL_ORE: 28, DEEP_IRON_ORE: 29, DEEP_COPPER_ORE: 30, DEEP_GOLD_ORE: 31,
  DEEP_CINNABAR_ORE: 32, DEEP_AZURITE_ORE: 33, DEEP_DIAMOND_ORE: 34, SANDSTONE: 35,
  SNOW_BLOCK: 36, ICE: 37, CLAY: 38, CACTUS: 39, TALL_GRASS: 40, SUNPETAL: 41,
  REDBLOOM: 42, DEAD_BUSH: 43, WORKBENCH: 44, FURNACE: 45, FURNACE_LIT: 46, TORCH: 47,
  OBSIDIAN: 48, WOOL: 49, COAL_BLOCK: 50, IRON_BLOCK: 51, GOLD_BLOCK: 52,
  DIAMOND_BLOCK: 53, GRANITE: 54, DIORITE: 55, ANDESITE: 56, TUFF: 57, SNOWY_GRASS: 58,
  SPRUCE_PLANKS: 59, BIRCH_PLANKS: 60, STONE_BRICKS: 61, CHEST: 62,
  FARMLAND: 63, WHEAT: 64, DOOR: 65, LADDER: 66, BED: 67,
  OAK_SLAB: 68, COBBLESTONE_SLAB: 69, STONE_BRICK_SLAB: 70, SANDSTONE_SLAB: 71,
  OAK_STAIRS: 72, COBBLESTONE_STAIRS: 73, STONE_BRICK_STAIRS: 74, SANDSTONE_STAIRS: 75,
  CARROTS: 76, OAK_FENCE: 77, SPRUCE_FENCE: 78, BIRCH_FENCE: 79, OAK_FENCE_GATE: 80,
  SPAWNER: 81, MOSSY_COBBLESTONE: 82, SUGAR_CANE: 83, BOOKSHELF: 84, BRICKS: 85, GLASS_PANE: 86, DIRT_PATH: 87,
  PUMPKIN: 88, JACK_O_LANTERN: 89, MELON: 90, FIRE: 91,
  OAK_SAPLING: 92, BIRCH_SAPLING: 93, SPRUCE_SAPLING: 94, POTATOES: 95, BEETROOTS: 96,
  JUNGLE_LOG: 97, JUNGLE_LEAVES: 98, JUNGLE_PLANKS: 99, JUNGLE_SAPLING: 100,
  ACACIA_LOG: 101, ACACIA_LEAVES: 102, ACACIA_PLANKS: 103, ACACIA_SAPLING: 104,
  DARK_OAK_LOG: 105, DARK_OAK_LEAVES: 106, DARK_OAK_PLANKS: 107, DARK_OAK_SAPLING: 108,
  RED_SAND: 109, TERRACOTTA: 110, ORANGE_TERRACOTTA: 111, YELLOW_TERRACOTTA: 112, WHITE_TERRACOTTA: 113,
  BROWN_TERRACOTTA: 114, RED_TERRACOTTA: 115, LIGHT_GRAY_TERRACOTTA: 116,
  VINES: 117, LILY_PAD: 118, BROWN_MUSHROOM: 119, RED_MUSHROOM: 120,
  BROWN_MUSHROOM_BLOCK: 121, RED_MUSHROOM_BLOCK: 122, MUSHROOM_STEM: 123, MYCELIUM: 124,
  SKYBELL: 125, ROSETTE: 126,
  // Other dimensions (ids from 160 up, see world/dimensions/): the Cinderdeep and the Hollow
  SNOW_LAYER: 130, COBBLESTONE_WALL: 131, MOSSY_COBBLESTONE_WALL: 132, OAK_TRAPDOOR: 133, RAIL: 140, COBWEB: 141, TNT: 142, CAMPFIRE: 150, LANTERN: 151, PAINTING: 152, PAINTING_B: 153, OAK_SIGN: 154, OAK_WALL_SIGN: 155, ITEM_FRAME: 156, COCOA: 157, MELON_STEM: 158, PUMPKIN_STEM: 159, HAY_BALE: 171, BARREL: 127, BEE_NEST: 128, BEEHIVE: 129, TURTLE_EGG: 136,
  SNOW_LAYER: 130, COBBLESTONE_WALL: 131, MOSSY_COBBLESTONE_WALL: 132, OAK_TRAPDOOR: 133,
  ENCHANTING_TABLE: 134, ANVIL: 135,
  BREWING_STAND: 143, CINDERROOT: 144,
  CINDERSTONE: 160, GLOWSHARD: 161, MOURNSAND: 162, EMBERQUARTZ_ORE: 163, SCORCHED_BRICKS: 164, RIFT: 165,
  HOLLOWSTONE: 166, HOLLOW_FRAME: 167, HOLLOW_FRAME_EYE: 168, HOLLOW_GATE: 169, WYRM_EGG: 170,
  // Cinnabar circuitry (see world/circuits.js)
  CINNABAR_WIRE: 175, LEVER: 176, STONE_BUTTON: 177, WOODEN_PRESSURE_PLATE: 178, CINNABAR_TORCH: 179, CINNABAR_TORCH_OFF: 180,
  CINNABAR_LAMP: 181, CINNABAR_LAMP_ON: 182, REPEATER: 183, PISTON: 184, STICKY_PISTON: 185, PISTON_HEAD: 186,
  CHIME_BLOCK: 187, CINNABAR_BLOCK: 188,
  // Caves content (see world/caves.js): copper weathering, Violite geodes, Seepstone
  COPPER_BLOCK: 231, DULLED_COPPER: 232, TARNISHED_COPPER: 233, VERDIGRIS_COPPER: 234,
  WAXED_COPPER_BLOCK: 235, WAXED_DULLED_COPPER: 236, WAXED_TARNISHED_COPPER: 237, WAXED_VERDIGRIS_COPPER: 238,
  STORM_ROD: 239, VIOLITE_BLOCK: 240, BUDDING_VIOLITE: 241, SMALL_VIOLITE_BUD: 242, MEDIUM_VIOLITE_BUD: 243,
  LARGE_VIOLITE_BUD: 244, VIOLITE_CLUSTER: 245, CHALKSTONE: 246, SMOOTH_BASALT: 247, SHADED_GLASS: 248,
  SEEPSTONE: 249, SEEPSTONE_SPIKE: 250,
};

const defaults = {
  hardness: 1, resistance: 1, tool: null, tier: TIER.ANY, solid: true, opaque: true,
  shape: SHAPE.CUBE, layer: LAYER.OPAQUE, emit: 0, opacity: 15, gravity: false,
  replaceable: false, tint: null, flammable: false, drops: 'self', tex: null,
  stack: 64, sound: 'stone', slipperiness: 0.6, fluid: null, needsSupport: false, speedFactor: 1,
};

export const BLOCKS = [];

function def(id, name, props) {
  const d = { ...defaults, ...props, id, name };
  if (!d.tex) d.tex = { all: name.toLowerCase().replace(/ /g, '_') };
  if (d.tex.all) d.tex = { top: d.tex.all, bottom: d.tex.all, side: d.tex.all };
  if (!d.tex.front) d.tex.front = null;
  if (!d.opaque && props.opacity === undefined) d.opacity = 0;
  BLOCKS[id] = d;
  return d;
}

const plant = { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.CROSS, layer: LAYER.CUTOUT, replaceable: false, sound: 'grass', needsSupport: true };

def(B.AIR, 'Air', { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.NONE, replaceable: true, drops: null });
def(B.STONE, 'Stone', { hardness: 1.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD, drops: B.COBBLESTONE });
def(B.GRASS, 'Grass Block', { hardness: 0.6, resistance: 0.6, tool: TOOL.SHOVEL, drops: B.DIRT, sound: 'grass', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, tint: 'grass' });
def(B.DIRT, 'Dirt', { hardness: 0.5, resistance: 0.5, tool: TOOL.SHOVEL, sound: 'gravel' });
def(B.COBBLESTONE, 'Cobblestone', { hardness: 2, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.OAK_PLANKS, 'Oak Planks', { hardness: 2, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true });
def(B.BEDROCK, 'Bedrock', { hardness: -1, resistance: 3600000, drops: null });
def(B.WATER, 'Water', { hardness: 100, resistance: 100, solid: false, opaque: false, opacity: 1, shape: SHAPE.LIQUID, layer: LAYER.TRANSLUCENT, replaceable: true, drops: null, fluid: 'water' });
def(B.LAVA, 'Lava', { hardness: 100, resistance: 100, solid: false, opaque: false, opacity: 1, shape: SHAPE.LIQUID, layer: LAYER.OPAQUE, replaceable: true, drops: null, emit: 15, fluid: 'lava' });
def(B.SAND, 'Sand', { hardness: 0.5, resistance: 0.5, tool: TOOL.SHOVEL, gravity: true, sound: 'sand' });
def(B.GRAVEL, 'Gravel', { hardness: 0.6, resistance: 0.6, tool: TOOL.SHOVEL, gravity: true, sound: 'gravel', drops: 'gravel' });
def(B.OAK_LOG, 'Oak Log', { hardness: 2, resistance: 2, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' } });
const leaves = { hardness: 0.2, resistance: 0.2, tool: TOOL.HOE, opaque: false, opacity: 1, layer: LAYER.CUTOUT, sound: 'grass', flammable: true, tint: 'foliage' };
def(B.OAK_LEAVES, 'Oak Leaves', { ...leaves, drops: 'oak_leaves' });
def(B.BIRCH_LOG, 'Birch Log', { hardness: 2, resistance: 2, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log' } });
def(B.BIRCH_LEAVES, 'Birch Leaves', { ...leaves, tint: 'birch', drops: 'leaves' });
def(B.SPRUCE_LOG, 'Spruce Log', { hardness: 2, resistance: 2, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'spruce_log_top', bottom: 'spruce_log_top', side: 'spruce_log' } });
def(B.SPRUCE_LEAVES, 'Spruce Leaves', { ...leaves, tint: 'spruce', drops: 'leaves' });
def(B.GLASS, 'Glass', { hardness: 0.3, resistance: 0.3, opaque: false, layer: LAYER.CUTOUT, drops: null, sound: 'glass' });
const ore = (tier, drops) => ({ hardness: 3, resistance: 3, tool: TOOL.PICKAXE, tier, drops });
const deepOre = (tier, drops) => ({ hardness: 4.5, resistance: 3, tool: TOOL.PICKAXE, tier, drops });
def(B.COAL_ORE, 'Coal Ore', ore(TIER.WOOD, 'coal'));
def(B.IRON_ORE, 'Iron Ore', ore(TIER.STONE, 'raw_iron'));
def(B.COPPER_ORE, 'Copper Ore', ore(TIER.STONE, 'raw_copper'));
def(B.GOLD_ORE, 'Gold Ore', ore(TIER.IRON, 'raw_gold'));
def(B.CINNABAR_ORE, 'Cinnabar Ore', { ...ore(TIER.IRON, 'cinnabar'), emit: 0 });
def(B.AZURITE_ORE, 'Azurite Ore', ore(TIER.STONE, 'azurite'));
def(B.DIAMOND_ORE, 'Diamond Ore', ore(TIER.IRON, 'diamond'));
def(B.BERYL_ORE, 'Beryl Ore', ore(TIER.IRON, 'beryl'));
def(B.DEEPSTONE, 'Deepstone', { hardness: 3, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD, drops: B.COBBLED_DEEPSTONE, tex: { top: 'deepstone_top', bottom: 'deepstone_top', side: 'deepstone' } });
def(B.COBBLED_DEEPSTONE, 'Cobbled Deepstone', { hardness: 3.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.DEEP_COAL_ORE, 'Deep Coal Ore', deepOre(TIER.WOOD, 'coal'));
def(B.DEEP_IRON_ORE, 'Deep Iron Ore', deepOre(TIER.STONE, 'raw_iron'));
def(B.DEEP_COPPER_ORE, 'Deep Copper Ore', deepOre(TIER.STONE, 'raw_copper'));
def(B.DEEP_GOLD_ORE, 'Deep Gold Ore', deepOre(TIER.IRON, 'raw_gold'));
def(B.DEEP_CINNABAR_ORE, 'Deep Cinnabar Ore', deepOre(TIER.IRON, 'cinnabar'));
def(B.DEEP_AZURITE_ORE, 'Deep Azurite Ore', deepOre(TIER.STONE, 'azurite'));
def(B.DEEP_DIAMOND_ORE, 'Deep Diamond Ore', deepOre(TIER.IRON, 'diamond'));
def(B.SANDSTONE, 'Sandstone', { hardness: 0.8, resistance: 0.8, tool: TOOL.PICKAXE, tier: TIER.WOOD, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' } });
def(B.SNOW_BLOCK, 'Snow Block', { hardness: 0.2, resistance: 0.2, tool: TOOL.SHOVEL, tier: TIER.WOOD, sound: 'snow', drops: 'snowballs' });
// Walls connect to walls, gates and full blocks (1.5-high collision); trapdoors: meta bits 0-1 hinge side, 4 open, 8 upper half.
def(B.COBBLESTONE_WALL, 'Cobblestone Wall', { hardness: 2, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD, opaque: false, shape: SHAPE.WALL, tex: { all: 'cobblestone' } });
def(B.MOSSY_COBBLESTONE_WALL, 'Mossy Cobblestone Wall', { hardness: 2, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD, opaque: false, shape: SHAPE.WALL, tex: { all: 'mossy_cobblestone' } });
def(B.OAK_TRAPDOOR, 'Oak Trapdoor', { hardness: 3, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true, opaque: false, shape: SHAPE.TRAPDOOR, layer: LAYER.CUTOUT, tex: { all: 'oak_trapdoor' } });
def(B.TNT, 'TNT', { hardness: 0, resistance: 0, sound: 'grass', flammable: true, tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' } });
// Campfires: logs with a fire on top (light 15, smoke, burns what stands in it); lanterns: light 15, standing or hanging (meta 1).
def(B.CAMPFIRE, 'Campfire', { hardness: 2, resistance: 2, tool: TOOL.AXE, sound: 'wood', opaque: false, shape: SHAPE.BOXES, layer: LAYER.CUTOUT, emit: 15, drops: 'campfire', tex: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' } });
def(B.LANTERN, 'Lantern', { hardness: 3.5, resistance: 3.5, tool: TOOL.PICKAXE, sound: 'metal', opaque: false, shape: SHAPE.BOXES, layer: LAYER.CUTOUT, emit: 15, tex: { top: 'lantern_top', bottom: 'lantern_top', side: 'lantern' } });
// Signs: standing (meta = side it faces) or on a wall (meta = side of the wall); text in game.signs
def(B.OAK_SIGN, 'Oak Sign', { hardness: 1, resistance: 1, tool: TOOL.AXE, sound: 'wood', flammable: true, solid: false, opaque: false, shape: SHAPE.BOXES, needsSupport: true, drops: 'sign', tex: { all: 'oak_planks' } });
def(B.OAK_WALL_SIGN, 'Oak Sign', { hardness: 1, resistance: 1, tool: TOOL.AXE, sound: 'wood', flammable: true, solid: false, opaque: false, shape: SHAPE.BOXES, needsSupport: true, drops: 'sign', tex: { all: 'oak_planks' } });
def(B.BARREL, 'Barrel', { hardness: 2.5, resistance: 2.5, tool: TOOL.AXE, sound: 'wood', flammable: true, container: true, tex: { top: 'barrel_top', bottom: 'barrel_bottom', side: 'barrel_side' } });
// bee nests and hives: meta bits 0-1 the front, bits 2-4 the honey level (0-5)
def(B.BEE_NEST, 'Bee Nest', { hardness: 0.3, resistance: 0.3, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'nest_top', bottom: 'nest_top', side: 'nest_side', front: 'nest_front' } });
def(B.BEEHIVE, 'Beehive', { hardness: 0.6, resistance: 0.6, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'hive_top', bottom: 'hive_top', side: 'hive_side', front: 'hive_front' } });
// Shellback eggs: meta bits 0-1 = eggs - 1, bits 2-3 = how cracked (they hatch after the third crack)
def(B.TURTLE_EGG, 'Shellback Egg', { hardness: 0.5, resistance: 0.5, sound: 'stone', opaque: false, shape: SHAPE.BOXES, layer: LAYER.CUTOUT, drops: null, tex: { all: 'turtle_egg' } });
def(B.HAY_BALE, 'Hay Bale', { hardness: 0.5, resistance: 0.5, tool: TOOL.HOE, sound: 'grass', flammable: true, tex: { top: 'hay_top', bottom: 'hay_top', side: 'hay_side' } });
// Cocoa pods: meta bits 0-1 the side of the jungle log they hang on, 2-3 the age (0-2)
def(B.COCOA, 'Cocoa', { hardness: 0.2, resistance: 3, tool: TOOL.AXE, sound: 'wood', solid: false, opaque: false, shape: SHAPE.BOXES, needsSupport: true, drops: 'cocoa', tex: { top: 'cocoa_top', bottom: 'cocoa_top', side: 'cocoa' } });
// Item frames: meta bits 0-1 the wall side, 2-4 the item's rotation; the item is in game.frames
def(B.ITEM_FRAME, 'Item Frame', { hardness: 0, resistance: 0, sound: 'wood', solid: false, opaque: false, shape: SHAPE.BOXES, needsSupport: true, drops: 'item_frame', tex: { all: 'item_frame' } });
// Paintings: parts of a picture hung on a wall (see world/paintings.js)
def(B.PAINTING, 'Painting', { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.PAINTING, sound: 'wood', needsSupport: true, drops: 'painting', tex: { all: 'painting_back' } });
def(B.PAINTING_B, 'Painting', { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.PAINTING, sound: 'wood', needsSupport: true, drops: 'painting', tex: { all: 'painting_back' } });
// Cobwebs slow anything inside them to a crawl; swords and shears cut them for string.
def(B.COBWEB, 'Cobweb', { hardness: 4, resistance: 4, tool: TOOL.SWORD, solid: false, opaque: false, shape: SHAPE.CROSS, layer: LAYER.CUTOUT, drops: 'cobweb', sound: 'wool' });
// Rails: meta = shape (see world/rails.js); minecarts ride on them.
def(B.RAIL, 'Rail', { hardness: 0.7, resistance: 0.7, tool: TOOL.PICKAXE, sound: 'metal', solid: false, opaque: false, shape: SHAPE.RAIL, layer: LAYER.CUTOUT, needsSupport: true, tex: { all: 'rail' } });
// Snow layers: meta = layers - 1 (1..8 layers of 2/16 block); falls in cold biomes while it snows.
def(B.SNOW_LAYER, 'Snow', { hardness: 0.1, resistance: 0.1, tool: TOOL.SHOVEL, tier: TIER.WOOD, sound: 'snow', opaque: false, shape: SHAPE.SNOW, replaceable: true, needsSupport: true, drops: 'snow_layer', tex: { all: 'snow_block' } });
def(B.ICE, 'Ice', { hardness: 0.5, resistance: 0.5, tool: TOOL.PICKAXE, opaque: false, opacity: 1, layer: LAYER.TRANSLUCENT, drops: null, slipperiness: 0.98, sound: 'glass' });
def(B.CLAY, 'Clay', { hardness: 0.6, resistance: 0.6, tool: TOOL.SHOVEL, drops: 'clay', sound: 'gravel' });
def(B.CACTUS, 'Cactus', { hardness: 0.4, resistance: 0.4, opaque: false, shape: SHAPE.CACTUS, layer: LAYER.CUTOUT, sound: 'wool', needsSupport: true, tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' } });
def(B.TALL_GRASS, 'Tall Grass', { ...plant, replaceable: true, tint: 'grass', drops: 'seeds' });
def(B.SUNPETAL, 'Sunpetal', plant);
def(B.REDBLOOM, 'Redbloom', plant);
def(B.DEAD_BUSH, 'Dead Bush', { ...plant, replaceable: true, drops: 'dead_bush' });
def(B.WORKBENCH, 'Workbench', { hardness: 2.5, resistance: 2.5, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'workbench_top', bottom: 'oak_planks', side: 'workbench_side' } });
def(B.FURNACE, 'Furnace', { hardness: 3.5, resistance: 3.5, tool: TOOL.PICKAXE, tier: TIER.WOOD, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_front' } });
def(B.FURNACE_LIT, 'Lit Furnace', { hardness: 3.5, resistance: 3.5, tool: TOOL.PICKAXE, tier: TIER.WOOD, emit: 13, drops: B.FURNACE, tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_front_lit' } });
def(B.TORCH, 'Torch', { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.TORCH, layer: LAYER.CUTOUT, emit: 14, sound: 'wood', needsSupport: true });
def(B.OBSIDIAN, 'Obsidian', { hardness: 50, resistance: 1200, tool: TOOL.PICKAXE, tier: TIER.DIAMOND });
def(B.WOOL, 'Wool', { hardness: 0.8, resistance: 0.8, sound: 'wool', flammable: true, drops: 'wool' }); // meta = colour
const metal = { hardness: 5, resistance: 6, tool: TOOL.PICKAXE, sound: 'metal' };
def(B.COAL_BLOCK, 'Coal Block', { ...metal, tier: TIER.WOOD, flammable: true });
def(B.IRON_BLOCK, 'Iron Block', { ...metal, tier: TIER.STONE });
def(B.GOLD_BLOCK, 'Gold Block', { ...metal, hardness: 3, tier: TIER.IRON });
def(B.DIAMOND_BLOCK, 'Diamond Block', { ...metal, tier: TIER.IRON });
def(B.GRANITE, 'Granite', { hardness: 1.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.DIORITE, 'Diorite', { hardness: 1.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.ANDESITE, 'Andesite', { hardness: 1.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.TUFF, 'Tuff', { hardness: 1.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.SNOWY_GRASS, 'Snowy Grass Block', { hardness: 0.6, resistance: 0.6, tool: TOOL.SHOVEL, drops: B.DIRT, sound: 'snow', tex: { top: 'snow_block', bottom: 'dirt', side: 'snowy_grass_side' } });
def(B.SPRUCE_PLANKS, 'Spruce Planks', { hardness: 2, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true });
def(B.BIRCH_PLANKS, 'Birch Planks', { hardness: 2, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true });
def(B.STONE_BRICKS, 'Stone Bricks', { hardness: 1.5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
// tex.front: shown on the side facing the player when placed (meta 0..3)
def(B.CHEST, 'Chest', { hardness: 2.5, resistance: 2.5, tool: TOOL.AXE, sound: 'wood', flammable: true, container: true, tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' } });

// Farmland: meta = moisture 0..7 (moist when > 0). Wheat: meta = growth stage 0..7.
def(B.FARMLAND, 'Farmland', { hardness: 0.6, resistance: 0.6, tool: TOOL.SHOVEL, drops: B.DIRT, sound: 'gravel', tex: { top: 'farmland', bottom: 'dirt', side: 'dirt' } });
def(B.WHEAT, 'Wheat Crops', { ...plant, shape: SHAPE.CROP, drops: 'wheat', tex: { all: 'wheat_7' } });
def(B.CARROTS, 'Carrots', { ...plant, shape: SHAPE.CROP, drops: 'carrots', tex: { all: 'carrots_3' } });
def(B.POTATOES, 'Potatoes', { ...plant, shape: SHAPE.CROP, drops: 'potatoes', tex: { all: 'potatoes_3' } });
def(B.BEETROOTS, 'Beetroots', { ...plant, shape: SHAPE.CROP, drops: 'beetroots', tex: { all: 'beetroots_3' } });
def(B.MELON_STEM, 'Melon Stem', { ...plant, shape: SHAPE.CROP, drops: 'melon_stem', tex: { all: 'stem_7' } });
def(B.PUMPKIN_STEM, 'Pumpkin Stem', { ...plant, shape: SHAPE.CROP, drops: 'pumpkin_stem', tex: { all: 'stem_7' } });
export const CROPS = new Set([B.WHEAT, B.CARROTS, B.POTATOES, B.BEETROOTS, B.MELON_STEM, B.PUMPKIN_STEM]);
export const STEM_FRUIT = { [B.MELON_STEM]: B.MELON, [B.PUMPKIN_STEM]: B.PUMPKIN };

// Door: two blocks, meta bits in shapes.js. Ladder: meta = side of its wall.
def(B.DOOR, 'Oak Door', { hardness: 3, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true, opaque: false, shape: SHAPE.DOOR, layer: LAYER.CUTOUT, drops: 'door', needsSupport: true, tex: { all: 'door_lower' } });
def(B.LADDER, 'Ladder', { hardness: 0.4, resistance: 0.4, tool: TOOL.AXE, sound: 'wood', flammable: true, solid: false, opaque: false, shape: SHAPE.LADDER, layer: LAYER.CUTOUT, needsSupport: true });
// Bed: two blocks; meta bits 0-1 = side the head lies towards, bit 3 = head half.
def(B.BED, 'Bed', { hardness: 0.2, resistance: 0.2, sound: 'wool', flammable: true, opaque: false, shape: SHAPE.BED, layer: LAYER.CUTOUT, drops: 'bed', needsSupport: true, tex: { top: 'bed_foot_top_0', bottom: 'oak_planks', side: 'bed_side' } });

// Slabs (meta 0 bottom, 1 top, 2 double) and stairs (meta bits 0-1 facing, bit 2 upside down)
// copy their material's textures and stats. They block light like full blocks.
for (const [slab, stairs, base, name] of [
  [B.OAK_SLAB, B.OAK_STAIRS, B.OAK_PLANKS, 'Oak'], [B.COBBLESTONE_SLAB, B.COBBLESTONE_STAIRS, B.COBBLESTONE, 'Cobblestone'],
  [B.STONE_BRICK_SLAB, B.STONE_BRICK_STAIRS, B.STONE_BRICKS, 'Stone Brick'], [B.SANDSTONE_SLAB, B.SANDSTONE_STAIRS, B.SANDSTONE, 'Sandstone'],
]) {
  const m = BLOCKS[base];
  const common = { hardness: m.hardness, resistance: m.resistance, tool: m.tool, tier: m.tier, sound: m.sound, flammable: m.flammable, opaque: false, opacity: 15, tex: { ...m.tex }, base };
  def(slab, `${name} Slab`, { ...common, shape: SHAPE.SLAB, drops: 'slab' });
  def(stairs, `${name} Stairs`, { ...common, shape: SHAPE.STAIRS });
}

// Fences connect to fences, gates and full blocks; gates: meta bits 0-1 facing, bit 2 open.
const wood = { hardness: 2, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true, opaque: false };
def(B.OAK_FENCE, 'Oak Fence', { ...wood, shape: SHAPE.FENCE, tex: { all: 'oak_planks' } });
def(B.SPRUCE_FENCE, 'Spruce Fence', { ...wood, shape: SHAPE.FENCE, tex: { all: 'spruce_planks' } });
def(B.BIRCH_FENCE, 'Birch Fence', { ...wood, shape: SHAPE.FENCE, tex: { all: 'birch_planks' } });
def(B.OAK_FENCE_GATE, 'Oak Fence Gate', { ...wood, shape: SHAPE.GATE, tex: { all: 'oak_planks' } });

// Monster spawner: meta = mob kind (0 Shambler, 1 Rattler, 2 Skitterer); found in dungeons.
def(B.SPAWNER, 'Monster Spawner', { hardness: 5, resistance: 5, tool: TOOL.PICKAXE, tier: TIER.WOOD, opaque: false, layer: LAYER.CUTOUT, drops: null, sound: 'metal' });
def(B.MOSSY_COBBLESTONE, 'Mossy Cobblestone', { hardness: 2, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });

// Sugar cane: meta = growth age 0..15 (grows a block when it reaches 15, up to 3 tall).
def(B.SUGAR_CANE, 'Sugar Cane', { ...plant, sound: 'grass' });
def(B.BOOKSHELF, 'Bookshelf', { hardness: 1.5, resistance: 1.5, tool: TOOL.AXE, sound: 'wood', flammable: true, drops: 'bookshelf', tex: { top: 'oak_planks', bottom: 'oak_planks', side: 'bookshelf' } });
def(B.DIRT_PATH, 'Dirt Path', { hardness: 0.65, resistance: 0.65, tool: TOOL.SHOVEL, drops: B.DIRT, sound: 'gravel', tex: { top: 'dirt_path', bottom: 'dirt', side: 'dirt_path_side' } });
def(B.PUMPKIN, 'Pumpkin', { hardness: 1, resistance: 1, tool: TOOL.AXE, sound: 'wood', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' } });
def(B.JACK_O_LANTERN, 'Pumpkin Lantern', { hardness: 1, resistance: 1, tool: TOOL.AXE, sound: 'wood', emit: 15, tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_lantern' } });
def(B.MELON, 'Melon', { hardness: 1, resistance: 1, tool: TOOL.AXE, sound: 'wood', drops: 'melon', tex: { top: 'melon_top', bottom: 'melon_top', side: 'melon_side' } });
def(B.BRICKS, 'Bricks', { hardness: 2, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
// Saplings: meta = growth stage (0/1); the second successful growth tick grows the tree.
def(B.OAK_SAPLING, 'Oak Sapling', { ...plant });
def(B.BIRCH_SAPLING, 'Birch Sapling', { ...plant });
def(B.SPRUCE_SAPLING, 'Spruce Sapling', { ...plant });
// Fire: meta = age 0..15; spreads to and burns flammable blocks (see fire.js).
def(B.FIRE, 'Fire', { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.FIRE, layer: LAYER.CUTOUT, emit: 15, replaceable: true, drops: null, sound: 'wool', tex: { all: 'fire' } });

// Biome blocks: jungle / acacia / dark oak wood, badlands terracotta, swamp and mushroom plants.
const logDef = (name, key) => ({ hardness: 2, resistance: 2, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: key + '_log_top', bottom: key + '_log_top', side: key + '_log' } });
const plankDef = { hardness: 2, resistance: 3, tool: TOOL.AXE, sound: 'wood', flammable: true };
def(B.JUNGLE_LOG, 'Jungle Log', logDef('Jungle', 'jungle'));
def(B.JUNGLE_LEAVES, 'Jungle Leaves', { ...leaves, drops: 'leaves' });
def(B.JUNGLE_PLANKS, 'Jungle Planks', plankDef);
def(B.JUNGLE_SAPLING, 'Jungle Sapling', { ...plant });
def(B.ACACIA_LOG, 'Acacia Log', logDef('Acacia', 'acacia'));
def(B.ACACIA_LEAVES, 'Acacia Leaves', { ...leaves, drops: 'leaves' });
def(B.ACACIA_PLANKS, 'Acacia Planks', plankDef);
def(B.ACACIA_SAPLING, 'Acacia Sapling', { ...plant });
def(B.DARK_OAK_LOG, 'Dark Oak Log', logDef('Dark Oak', 'dark_oak'));
// thick canopies: dark oak leaves let less light through
def(B.DARK_OAK_LEAVES, 'Dark Oak Leaves', { ...leaves, opacity: 2, drops: 'oak_leaves' });
def(B.DARK_OAK_PLANKS, 'Dark Oak Planks', plankDef);
def(B.DARK_OAK_SAPLING, 'Dark Oak Sapling', { ...plant });
def(B.RED_SAND, 'Red Sand', { hardness: 0.5, resistance: 0.5, tool: TOOL.SHOVEL, gravity: true, sound: 'sand' });
const clayStone = { hardness: 1.25, resistance: 4.2, tool: TOOL.PICKAXE, tier: TIER.WOOD };
def(B.TERRACOTTA, 'Terracotta', clayStone);
for (const c of ['ORANGE', 'YELLOW', 'WHITE', 'BROWN', 'RED', 'LIGHT_GRAY']) {
  def(B[c + '_TERRACOTTA'], c.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') + ' Terracotta', clayStone);
}
// Vines hang on the side (meta, like ladders) of a log or leaves, or below another vine; climbable.
def(B.VINES, 'Vines', { hardness: 0.2, resistance: 0.2, tool: TOOL.HOE, solid: false, opaque: false, shape: SHAPE.LADDER, layer: LAYER.CUTOUT, sound: 'grass', flammable: true, replaceable: true, needsSupport: true, tint: 'foliage', drops: null });
def(B.LILY_PAD, 'Lily Pad', { hardness: 0, resistance: 0, solid: false, opaque: false, shape: SHAPE.PAD, layer: LAYER.CUTOUT, sound: 'grass', needsSupport: true });
def(B.BROWN_MUSHROOM, 'Brown Mushroom', { ...plant, emit: 1 });
def(B.RED_MUSHROOM, 'Red Mushroom', { ...plant });
const shroom = { hardness: 0.2, resistance: 0.2, tool: TOOL.AXE, sound: 'wood' };
def(B.BROWN_MUSHROOM_BLOCK, 'Brown Mushroom Block', { ...shroom, drops: 'brown_mushroom_block' });
def(B.RED_MUSHROOM_BLOCK, 'Red Mushroom Block', { ...shroom, drops: 'red_mushroom_block' });
def(B.MUSHROOM_STEM, 'Mushroom Stem', { ...shroom, drops: null, tex: { top: 'mushroom_stem_top', bottom: 'mushroom_stem_top', side: 'mushroom_stem' } });
def(B.MYCELIUM, 'Mycelium', { hardness: 0.6, resistance: 0.6, tool: TOOL.SHOVEL, drops: B.DIRT, sound: 'grass', tex: { top: 'mycelium_top', bottom: 'dirt', side: 'mycelium_side' } });
def(B.SKYBELL, 'Skybell', plant);
def(B.ROSETTE, 'Rosette', plant);
def(B.GLASS_PANE, 'Glass Pane', { hardness: 0.3, resistance: 0.3, opaque: false, shape: SHAPE.PANE, layer: LAYER.CUTOUT, drops: null, sound: 'glass', tex: { all: 'glass' } });

// Enchanting table (3/4 tall, a floating book above it) and the anvil (falls like sand;
// meta bit 0 = long axis along z, bits 1-2 = wear 0..2). Both are drawn from shapes.js BLOCK_BOXES.
def(B.ENCHANTING_TABLE, 'Enchanting Table', { hardness: 5, resistance: 1200, tool: TOOL.PICKAXE, tier: TIER.WOOD, opaque: false, shape: SHAPE.BOXES, emit: 7, tex: { top: 'enchanting_table_top', bottom: 'obsidian', side: 'enchanting_table_side' } });
def(B.ANVIL, 'Anvil', { hardness: 5, resistance: 1200, tool: TOOL.PICKAXE, tier: TIER.WOOD, opaque: false, shape: SHAPE.BOXES, gravity: true, sound: 'metal', tex: { top: 'anvil_top', bottom: 'anvil_side', side: 'anvil_side' } });

// Brewing Alembic (reference: brewing stand): a cobblestone base with an ember rod; drawn from shapes.js BLOCK_BOXES.
def(B.BREWING_STAND, 'Brewing Alembic', { hardness: 0.5, resistance: 0.5, tool: TOOL.PICKAXE, tier: TIER.ANY, opaque: false, shape: SHAPE.BOXES, emit: 1, sound: 'metal', container: true, tex: { top: 'brewing_stand_top', bottom: 'brewing_stand_base', side: 'brewing_stand_side' },
  iconStyle: ['alembic', { r: '#ffb030', R: '#ffe080', i: '#3a3236', v: '#dbe8f5', w: '#eef4fa', h: '#c8304a', c: '#7b7b7e', C: '#a0a0a3' }] });
// Cinderroot (reference: nether wart): grows on Mournsand in the Cinderdeep, meta = age 0..3.
def(B.CINDERROOT, 'Cinderroot', { ...plant, shape: SHAPE.CROP, drops: 'cinderroot', tex: { all: 'cinderroot_3' } });

// The Cinderdeep (fiery underworld) and the Hollow (void dimension); see world/dimensions/.
def(B.CINDERSTONE, 'Cinderstone', { hardness: 0.4, resistance: 0.4, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.GLOWSHARD, 'Glowshard', { hardness: 0.3, resistance: 0.3, emit: 15, sound: 'glass', drops: { item: 'GLOWSHARD_DUST', min: 2, max: 4 } });
def(B.MOURNSAND, 'Mournsand', { hardness: 0.5, resistance: 0.5, tool: TOOL.SHOVEL, sound: 'sand', speedFactor: 0.4 });
def(B.EMBERQUARTZ_ORE, 'Emberquartz Ore', { ...ore(TIER.WOOD, { item: 'EMBER_QUARTZ', min: 1, max: 1 }), tex: { all: 'emberquartz_ore' } });
def(B.SCORCHED_BRICKS, 'Scorched Bricks', { hardness: 2, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD });
// Rift: the portal sheet inside a lit obsidian frame; meta 0 = spans x, 1 = spans z.
def(B.RIFT, 'Rift', { hardness: -1, resistance: 0, solid: false, opaque: false, opacity: 0, layer: LAYER.TRANSLUCENT, emit: 11, drops: null, sound: 'glass' });
def(B.HOLLOWSTONE, 'Hollowstone', { hardness: 3, resistance: 9, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.HOLLOW_FRAME, 'Hollow Frame', { hardness: -1, resistance: 3600000, emit: 1, drops: null, tex: { top: 'hollow_frame_top', bottom: 'hollowstone', side: 'hollow_frame_side' } });
def(B.HOLLOW_FRAME_EYE, 'Hollow Frame with Eye', { hardness: -1, resistance: 3600000, emit: 1, drops: null, tex: { top: 'hollow_frame_eye', bottom: 'hollowstone', side: 'hollow_frame_side' } });
// Hollow Gate: the starry gateway to and from the Hollow (not solid; you fall in).
def(B.HOLLOW_GATE, 'Hollow Gate', { hardness: -1, resistance: 3600000, solid: false, opaque: false, opacity: 0, emit: 15, drops: null, sound: 'glass' });
def(B.WYRM_EGG, 'Wyrm Egg', { hardness: 3, resistance: 9, emit: 1, tex: { top: 'wyrm_egg_top', bottom: 'wyrm_egg_top', side: 'wyrm_egg' } });

// Cinnabar circuitry (world/circuits.js). Power levels live in meta: wire = level 0..15;
// lever / button: bits 0-2 attachment (0 floor, 1-4 wall side+1, 5 ceiling), bit 3 on, bit 4 turned
// a quarter; plate: bit 0 pressed; torches: as torches; repeater: bits 0-1 output side, 2-3 delay-1,
// bit 4 powered; pistons: bits 0-2 facing (0 down, 1 up, 2 -z, 3 +z, 4 -x, 5 +x), bit 3 extended
// (head: bit 3 sticky); chime block: bits 0-4 pitch, bit 5 powered. `hidden` keeps a block out of
// the creative catalogue.
const part = { hardness: 0, resistance: 0, solid: false, opaque: false, layer: LAYER.CUTOUT, needsSupport: true, circuitPart: true, sound: 'wood' };
def(B.CINNABAR_WIRE, 'Cinnabar Wire', { ...part, shape: SHAPE.WIRE, sound: 'stone', hidden: true, drops: { item: 'CINNABAR', min: 1, max: 1 }, tex: { all: 'cinnabar_wire' } });
def(B.LEVER, 'Lever', { ...part, hardness: 0.5, resistance: 0.5, shape: SHAPE.CIRCUIT, sound: 'stone', tex: { all: 'lever' } });
def(B.STONE_BUTTON, 'Stone Button', { ...part, hardness: 0.5, resistance: 0.5, shape: SHAPE.CIRCUIT, sound: 'stone', tex: { all: 'stone' } });
def(B.WOODEN_PRESSURE_PLATE, 'Wooden Pressure Plate', { ...part, hardness: 0.5, resistance: 0.5, tool: TOOL.AXE, flammable: true, shape: SHAPE.CIRCUIT, tex: { all: 'oak_planks' } });
def(B.CINNABAR_TORCH, 'Cinnabar Torch', { ...part, shape: SHAPE.TORCH, emit: 7, tex: { all: 'cinnabar_torch' } });
def(B.CINNABAR_TORCH_OFF, 'Cinnabar Torch', { ...part, shape: SHAPE.TORCH, hidden: true, drops: B.CINNABAR_TORCH, tex: { all: 'cinnabar_torch_off' } });
def(B.CINNABAR_LAMP, 'Cinnabar Lamp', { hardness: 0.3, resistance: 0.3, sound: 'glass' });
def(B.CINNABAR_LAMP_ON, 'Cinnabar Lamp', { hardness: 0.3, resistance: 0.3, sound: 'glass', emit: 15, hidden: true, drops: B.CINNABAR_LAMP, tex: { all: 'cinnabar_lamp_on' } });
def(B.REPEATER, 'Repeater', { ...part, shape: SHAPE.CIRCUIT, sound: 'stone', tex: { top: 'repeater', bottom: 'smooth_stone', side: 'smooth_stone' } });
const piston = { hardness: 1.5, resistance: 1.5, tool: TOOL.PICKAXE, opaque: false, opacity: 15, shape: SHAPE.CIRCUIT, sound: 'stone' };
def(B.PISTON, 'Piston', { ...piston, tex: { top: 'piston_top', bottom: 'piston_bottom', side: 'piston_side' } });
def(B.STICKY_PISTON, 'Sticky Piston', { ...piston, tex: { top: 'piston_top_sticky', bottom: 'piston_bottom', side: 'piston_side' } });
def(B.PISTON_HEAD, 'Piston Head', { ...piston, hidden: true, drops: null, tex: { top: 'piston_top', bottom: 'piston_top', side: 'piston_side' } });
def(B.CHIME_BLOCK, 'Chime Block', { hardness: 0.8, resistance: 0.8, tool: TOOL.AXE, sound: 'wood', flammable: true, tex: { top: 'chime_block_top', bottom: 'oak_planks', side: 'chime_block' } });
def(B.CINNABAR_BLOCK, 'Cinnabar Block', { hardness: 5, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.WOOD, sound: 'metal' });

// Caves content (world/caves.js). Copper weathers fresh -> dulled -> tarnished -> verdigris on random
// ticks unless sealed with honeycomb (the waxed ids look the same). Storm Rod: meta 0 standing, 1 hanging.
// Buds, clusters and spikes (SHAPE.CRYSTAL): meta bits 0-2 = facing (0 up, 1 down, 2 -z, 3 +z, 4 -x, 5 +x);
// spikes only point up or down and keep their thickness in bits 3-4 (0 tip, 1 frustum, 2 middle, 3 base).
const copper = { hardness: 3, resistance: 6, tool: TOOL.PICKAXE, tier: TIER.STONE, sound: 'metal' };
def(B.COPPER_BLOCK, 'Copper Block', copper);
def(B.DULLED_COPPER, 'Dulled Copper', copper);
def(B.TARNISHED_COPPER, 'Tarnished Copper', copper);
def(B.VERDIGRIS_COPPER, 'Verdigris Copper', copper);
def(B.WAXED_COPPER_BLOCK, 'Sealed Copper Block', { ...copper, tex: { all: 'copper_block' } });
def(B.WAXED_DULLED_COPPER, 'Sealed Dulled Copper', { ...copper, tex: { all: 'dulled_copper' } });
def(B.WAXED_TARNISHED_COPPER, 'Sealed Tarnished Copper', { ...copper, tex: { all: 'tarnished_copper' } });
def(B.WAXED_VERDIGRIS_COPPER, 'Sealed Verdigris Copper', { ...copper, tex: { all: 'verdigris_copper' } });
def(B.STORM_ROD, 'Storm Rod', { ...copper, solid: false, opaque: false, shape: SHAPE.BOXES, flatIcon: true, tex: { all: 'storm_rod' } });
const violite = { hardness: 1.5, resistance: 1.5, tool: TOOL.PICKAXE, sound: 'glass' };
def(B.VIOLITE_BLOCK, 'Violite Block', violite);
def(B.BUDDING_VIOLITE, 'Budding Violite', { ...violite, drops: null, noSilk: true });
const bud = { ...violite, solid: false, opaque: false, shape: SHAPE.CRYSTAL, layer: LAYER.CUTOUT, needsSupport: true, crystal: true, flatIcon: true, silkSelf: true, drops: null };
def(B.SMALL_VIOLITE_BUD, 'Small Violite Bud', { ...bud, emit: 1 });
def(B.MEDIUM_VIOLITE_BUD, 'Medium Violite Bud', { ...bud, emit: 2 });
def(B.LARGE_VIOLITE_BUD, 'Large Violite Bud', { ...bud, emit: 4 });
def(B.VIOLITE_CLUSTER, 'Violite Cluster', { ...bud, emit: 5, drops: 'violite_cluster' });
def(B.CHALKSTONE, 'Chalkstone', { hardness: 0.75, resistance: 0.75, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.SMOOTH_BASALT, 'Smooth Basalt', { hardness: 1.25, resistance: 4.2, tool: TOOL.PICKAXE, tier: TIER.WOOD });
// Shaded Glass: see-through but blocks light completely
def(B.SHADED_GLASS, 'Shaded Glass', { hardness: 0.3, resistance: 0.3, opaque: false, opacity: 15, layer: LAYER.TRANSLUCENT, sound: 'glass' });
def(B.SEEPSTONE, 'Seepstone', { hardness: 1.5, resistance: 1, tool: TOOL.PICKAXE, tier: TIER.WOOD });
def(B.SEEPSTONE_SPIKE, 'Seepstone Spike', { hardness: 1.5, resistance: 3, tool: TOOL.PICKAXE, opaque: false, shape: SHAPE.CRYSTAL, layer: LAYER.CUTOUT, flatIcon: true, crystal: true, drops: B.SEEPSTONE_SPIKE, tex: { all: 'seepstone_spike_0' } });

export const NUM_BLOCKS = BLOCKS.length;

// Flat lookup tables used by hot loops (mesher, lighting, physics) and workers.
export const SOLID = new Uint8Array(256);
export const OPAQUE = new Uint8Array(256);
export const OPACITY = new Uint8Array(256);
export const EMIT = new Uint8Array(256);
export const SHAPES = new Uint8Array(256);
export const LAYERS = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  const d = BLOCKS[i];
  if (!d) { SOLID[i] = 1; OPAQUE[i] = 1; OPACITY[i] = 15; continue; }
  SOLID[i] = d.solid ? 1 : 0;
  OPAQUE[i] = d.opaque ? 1 : 0;
  OPACITY[i] = d.opaque ? 15 : d.opacity;
  EMIT[i] = d.emit;
  SHAPES[i] = d.shape;
  LAYERS[i] = d.layer;
}

export function isFluid(id) { return id === B.WATER || id === B.LAVA; }

// Deepstone variants of ores, used by the generator.
export const DEEP_VARIANT = {
  [B.COAL_ORE]: B.DEEP_COAL_ORE, [B.IRON_ORE]: B.DEEP_IRON_ORE, [B.COPPER_ORE]: B.DEEP_COPPER_ORE,
  [B.GOLD_ORE]: B.DEEP_GOLD_ORE, [B.CINNABAR_ORE]: B.DEEP_CINNABAR_ORE,
  [B.AZURITE_ORE]: B.DEEP_AZURITE_ORE, [B.DIAMOND_ORE]: B.DEEP_DIAMOND_ORE,
};
