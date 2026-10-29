// Recipes, smelting and milestones added by the Cinderdeep and the Hollow.
import { B } from '../blocks.js';
import { I, STAR_ROCKETS, DYES } from '../items.js';
import { RECIPES, SMELTING } from '../../player/crafting.js';
import { MILESTONES } from '../../player/milestones.js';

const shapeless = (ings, result, count = 1) => RECIPES.push({ type: 'shapeless', ings, result, count });
const shaped = (pattern, key, result, count = 1) => RECIPES.push({ type: 'shaped', pattern, key, result, count });

if (!RECIPES.some((r) => r.result === I.EYE_OF_THE_VOID)) {
  shapeless([I.EMBER_ROD], I.EMBER_POWDER, 2);
  shapeless([I.VOID_PEARL, I.EMBER_POWDER], I.EYE_OF_THE_VOID, 1);
  shaped(['GG', 'GG'], { G: I.GLOWSHARD_DUST }, B.GLOWSHARD, 1);
  shaped(['QQ', 'QQ'], { Q: I.EMBER_QUARTZ }, B.SCORCHED_BRICKS, 2);
}
// the outer islands: Hollowbrick from popped Hushfruit, its pillar, slabs and stairs, Hollowstone
// Bricks, Wisp Rods, Sky Rockets and the Gloomshell Box
if (!RECIPES.some((r) => r.result === B.GLOOMSHELL_BOX)) {
  shaped(['PP', 'PP'], { P: I.POPPED_HUSHFRUIT }, B.HOLLOWBRICK, 4);
  shaped(['S', 'S'], { S: B.HOLLOWBRICK_SLAB }, B.HOLLOWBRICK_PILLAR, 1);
  shaped(['XXX'], { X: B.HOLLOWBRICK }, B.HOLLOWBRICK_SLAB, 6);
  shaped(['X  ', 'XX ', 'XXX'], { X: B.HOLLOWBRICK }, B.HOLLOWBRICK_STAIRS, 4);
  shaped(['SS', 'SS'], { S: B.HOLLOWSTONE }, B.HOLLOWSTONE_BRICKS, 4);
  shaped(['R', 'P'], { R: I.EMBER_ROD, P: I.POPPED_HUSHFRUIT }, B.WISP_ROD, 4);
  shapeless([I.PAPER, I.GUNPOWDER], I.SKY_ROCKET, 3);
  // with a dye (bone meal for white) the rockets burst in that colour and hurt (entities/skyRocket.js)
  STAR_ROCKETS.forEach((id, c) => shapeless([I.PAPER, I.GUNPOWDER, c === 0 ? I.BONE_MEAL : DYES[c]], id, 3));
  shaped(['S', 'C', 'S'], { S: I.GLOOMSHELL_HUSK, C: B.CHEST }, B.GLOOMSHELL_BOX, 1);
}
SMELTING[I.HUSHFRUIT] = I.POPPED_HUSHFRUIT;
SMELTING[B.EMBERQUARTZ_ORE] = I.EMBER_QUARTZ;
SMELTING[B.CINDERSTONE] = B.SCORCHED_BRICKS;

const has = (g, id) => g.player.inventory.count(id) > 0;
for (const m of [
  { id: 'rift', title: 'Tear in the World', desc: 'Light a Rift portal', icon: B.OBSIDIAN, event: 'rift' },
  { id: 'cinderdeep', title: 'Into the Cinderdeep', desc: 'Travel to the Cinderdeep', icon: B.CINDERSTONE, event: 'enter_cinderdeep' },
  { id: 'ember', title: 'Ember Hunter', desc: 'Take an Ember Rod from an Ember Lord', icon: I.EMBER_ROD, inv: (g) => has(g, I.EMBER_ROD) },
  { id: 'eye', title: 'Eye in the Dark', desc: 'Make an Eye of the Void', icon: I.EYE_OF_THE_VOID, inv: (g) => has(g, I.EYE_OF_THE_VOID) },
  { id: 'hollow', title: 'The Hollow', desc: 'Enter the Hollow', icon: B.HOLLOWSTONE, event: 'enter_hollow' },
  { id: 'wyrm', title: 'Wyrmslayer', desc: 'Defeat the Void Wyrm', icon: B.WYRM_EGG, event: 'wyrm' },
  { id: 'far_gate', title: 'Beyond the Rim', desc: 'Step through the Far Gate to the outer islands', icon: B.FAR_GATE, event: 'far_gate' },
  { id: 'hollow_city', title: 'The City at the Edge', desc: 'Find a Hollow City', icon: B.HOLLOWBRICK, event: 'hollow_city' },
  { id: 'levitate', title: 'Lighter than Air', desc: 'Be lifted by a Drift Spark', icon: I.GLOOMSHELL_HUSK, event: 'levitate' },
  { id: 'voidwing', title: 'Wings of the Void', desc: 'Find a Voidwing', icon: I.VOIDWING, inv: (g) => has(g, I.VOIDWING) || (g.player.inventory.armor[1] && g.player.inventory.armor[1].id === I.VOIDWING) },
]) if (!MILESTONES.some((x) => x.id === m.id)) MILESTONES.push(m);
