// Recipes, smelting and milestones added by the Cinderdeep and the Hollow.
import { B } from '../blocks.js';
import { I } from '../items.js';
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
]) if (!MILESTONES.some((x) => x.id === m.id)) MILESTONES.push(m);
