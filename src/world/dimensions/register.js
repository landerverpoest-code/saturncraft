// Recipes, smelting and milestones added by the Cinderdeep and the Hollow.
import { B } from '../blocks.js';
import { I } from '../items.js';
import { RECIPES, SMELTING } from '../../player/crafting.js';
import { MILESTONES } from '../../player/milestones.js';
import { SUB } from './cinderBiomes.js';
import { forgesNear } from './cinderForge.js';
import { wyrmRibsNear } from './wyrmRibs.js';

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
  shaped(['S', 'C', 'S'], { S: I.GLOOMSHELL_HUSK, C: B.CHEST }, B.GLOOMSHELL_BOX, 1);
}
// the Cinderdeep's sub-biomes: Slagsteel from Slag Chunks, a Slagsteel Pickaxe, Dirgestep Boots and the Spore Lantern;
// Wyrmbone from the bones of the Hollow's Wyrm Ribs
if (!RECIPES.some((r) => r.result === I.SLAGSTEEL_PICKAXE)) {
  shaped(['XXX', ' S ', ' S '], { X: I.SLAGSTEEL_INGOT, S: I.STICK }, I.SLAGSTEEL_PICKAXE);
  shaped(['X X', 'X X'], { X: I.DIRGE_CRYSTAL }, I.DIRGESTEP_BOOTS);
  shaped(['SSS', 'SES', 'SSS'], { S: I.GLOWCAP_SPORES, E: I.EMBER_ROD }, B.SPORE_LANTERN, 2);
  shaped(['XX', 'XX'], { X: I.BONE }, B.WYRMBONE, 2);
}
// the Slagheart Sigil (mobs/slagColossus.js): wakes the Slag Colossus in a Cinderforge courtyard
if (!RECIPES.some((r) => r.result === I.SLAG_SIGIL)) {
  shaped(['ESE', 'SDS', 'OSO'], { E: I.EMBER_ROD, S: I.SLAGSTEEL_INGOT, D: I.DIRGE_CRYSTAL, O: B.OBSIDIAN }, I.SLAG_SIGIL);
}
SMELTING[I.SLAG_CHUNK] = I.SLAGSTEEL_INGOT;
SMELTING[B.SLAG_ORE] = I.SLAGSTEEL_INGOT;
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
  // the Cinderdeep's sub-biomes and the Hollow's Wyrm Ribs
  { id: 'glowcap', title: 'Light in the Dark', desc: 'Walk into a Glowcap Thicket', icon: B.GLOWCAP_CAP, tick: (g) => g.world.dimension === 'cinderdeep' && !!g.world.dimGenerator.subBiomeAt && g.world.dimGenerator.subBiomeAt(Math.floor(g.player.x), Math.floor(g.player.z)) === SUB.THICKET },
  { id: 'slagsteel', title: 'Slag and Steel', desc: 'Smelt a Slagsteel Ingot', icon: I.SLAGSTEEL_INGOT, inv: (g) => has(g, I.SLAGSTEEL_INGOT) },
  { id: 'dirgestep', title: 'Light on Mournsand', desc: 'Make Dirgestep Boots', icon: I.DIRGESTEP_BOOTS, inv: (g) => has(g, I.DIRGESTEP_BOOTS) || (g.player.inventory.armor[3] && g.player.inventory.armor[3].id === I.DIRGESTEP_BOOTS) },
  { id: 'cinderforge', title: 'Cold Anvils', desc: 'Find a Cinderforge', icon: B.SCORCHED_BRICKS, tick: (g) => g.world.dimension === 'cinderdeep' && forgesNear(g.world.dimGenerator, g.player.x - 14, g.player.z - 14, g.player.x + 14, g.player.z + 14).some((f) => Math.abs(f.y - g.player.y) < 20) },
  // the Slag Colossus and tempering (mobs/slagColossus.js, world/enchantments.js)
  { id: 'sigil', title: 'A Light in the Embers', desc: 'Make a Slagheart Sigil', icon: I.SLAG_SIGIL, inv: (g) => has(g, I.SLAG_SIGIL) },
  { id: 'colossus', title: 'Cold Forge', desc: 'Defeat the Slag Colossus', icon: I.COLOSSUS_CORE, event: 'colossus' },
  { id: 'temper', title: 'Tempered', desc: 'Temper a piece of gear at an anvil', icon: I.SLAGSTEEL_INGOT, event: 'temper' },
  { id: 'wyrm_ribs', title: 'What the Wyrm Left', desc: 'Find the Wyrm Ribs on an outer island', icon: B.WYRMBONE, tick: (g) => g.world.dimension === 'hollow' && wyrmRibsNear(g.world.dimGenerator, g.player.x - 14, g.player.z - 14, g.player.x + 14, g.player.z + 14).length > 0 },
]) if (!MILESTONES.some((x) => x.id === m.id)) MILESTONES.push(m);
