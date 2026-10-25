// Milestones (the reference game's "advancements", with Saturncraft's own
// names): checked when the inventory changes, on game events and every few
// seconds; each pops a toast once and is saved with the world.
import { B } from '../world/blocks.js';
import { I } from '../world/items.js';
import { villagesNear } from '../world/villages.js';

const has = (g, ...ids) => ids.some((id) => g.player.inventory.count(id) > 0);

export const MILESTONES = [
  { id: 'wood', title: 'Timber!', desc: 'Get a log', icon: B.OAK_LOG, inv: (g) => has(g, B.OAK_LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.DARK_OAK_LOG, B.BLOSSOM_LOG, B.MANGROVE_LOG) },
  { id: 'bench', title: 'Workshop', desc: 'Make a workbench', icon: B.WORKBENCH, inv: (g) => has(g, B.WORKBENCH) },
  { id: 'stone', title: 'Stone Age', desc: 'Mine some cobblestone', icon: B.COBBLESTONE, inv: (g) => has(g, B.COBBLESTONE, B.COBBLED_DEEPSTONE) },
  { id: 'pick', title: 'Sharper Tools', desc: 'Make a stone pickaxe', icon: I.STONE_PICKAXE, inv: (g) => has(g, I.STONE_PICKAXE) },
  { id: 'furnace', title: 'Fire It Up', desc: 'Make a furnace', icon: B.FURNACE, inv: (g) => has(g, B.FURNACE) },
  { id: 'iron', title: 'Forged in Fire', desc: 'Get an iron ingot', icon: I.IRON_INGOT, inv: (g) => has(g, I.IRON_INGOT) },
  { id: 'armor', title: 'Dressed for Battle', desc: 'Wear a piece of armour', icon: I.IRON_CHESTPLATE, inv: (g) => g.player.inventory.armor.some(Boolean) },
  { id: 'diamond', title: 'Glittering Find', desc: 'Get a diamond', icon: I.DIAMOND, inv: (g) => has(g, I.DIAMOND) },
  { id: 'bread', title: 'Daily Bread', desc: 'Bake bread from wheat', icon: I.BREAD, inv: (g) => has(g, I.BREAD) },
  { id: 'plant', title: 'Green Fingers', desc: 'Plant a crop on farmland', icon: I.WHEAT_SEEDS, event: 'plant' },
  { id: 'kill', title: 'First Blood', desc: 'Defeat a monster', icon: I.IRON_SWORD, event: 'kill' },
  { id: 'breed', title: 'Growing Herd', desc: 'Breed two animals', icon: I.WHEAT, event: 'breed' },
  { id: 'sleep', title: 'Three Suns Later', desc: 'Sleep through a night', icon: I.BED, event: 'sleep' },
  { id: 'night', title: 'Total Eclipse', desc: 'See all three suns set', icon: B.TORCH, tick: (g) => g.sky.state.aboveCount === 0 },
  { id: 'deep', title: 'Into the Deep', desc: 'Go below y = 0', icon: B.DEEPSTONE, tick: (g) => g.player.y < 0 },
  { id: 'village', title: 'Neighbours', desc: 'Find a village', icon: B.DIRT_PATH, tick: (g) => g.world.dimension === 'overworld' && villagesNear(g.world.gen, g.player.x, g.player.z, g.player.x, g.player.z).some((v) => Math.hypot(v.cx - g.player.x, v.cz - g.player.z) < 40) },
  { id: 'tame', title: 'Best Friends', desc: 'Tame a Howler with a bone', icon: I.BONE, event: 'tame' },
  { id: 'golem', title: 'Heavy Metal', desc: 'Build an Ironguard', icon: B.IRON_BLOCK, event: 'golem' },
  { id: 'fish', title: 'Gone Fishing', desc: 'Catch something with a fishing rod', icon: I.FISHING_ROD, event: 'fish' },
  { id: 'tame_horse', title: 'Saddle Up', desc: 'Tame a Galloper by riding it', icon: I.SADDLE, event: 'tame_horse' },
  { id: 'trade', title: 'Fair Trade', desc: 'Trade with a Settler', icon: I.BERYL, event: 'trade' },
  { id: 'dungeon', title: 'Cage Breaker', desc: 'Break a monster spawner', icon: B.SPAWNER, event: 'spawner' },
  { id: 'enchanter', title: 'Spellbound', desc: 'Make an enchanting table', icon: B.ENCHANTING_TABLE, inv: (g) => has(g, B.ENCHANTING_TABLE) },
  { id: 'enchant', title: 'Words of Power', desc: 'Enchant an item at an enchanting table', icon: I.ENCHANTED_BOOK, event: 'enchant' },
  { id: 'anvil', title: 'Good as New', desc: 'Repair or combine gear at an anvil', icon: B.ANVIL, event: 'anvil' },
  { id: 'beacon', title: 'Light of Three Suns', desc: 'Give a beacon its power', icon: B.BEACON, event: 'beacon' },
  { id: 'raid', title: 'Shield of the Hamlet', desc: 'Win a raid and save a village', icon: I.CROSSBOW, event: 'raid' },
];

export class Milestones {
  constructor(game) {
    this.game = game;
    this.done = new Set();
  }

  unlock(m) {
    if (this.done.has(m.id)) return;
    this.done.add(m.id);
    this.game.hud.milestone(m);
    this.game.audio.play('levelup');
  }

  /** Inventory changed. */
  checkInventory() {
    for (const m of MILESTONES) if (m.inv && !this.done.has(m.id) && m.inv(this.game)) this.unlock(m);
  }

  /** A named game event happened. */
  event(name) {
    for (const m of MILESTONES) if (m.event === name) this.unlock(m);
  }

  /** Periodic checks (every 5 s). */
  tick() {
    for (const m of MILESTONES) if (m.tick && !this.done.has(m.id) && m.tick(this.game)) this.unlock(m);
  }

  save() { return [...this.done]; }
  load(list) { this.done = new Set(list || []); }
}

