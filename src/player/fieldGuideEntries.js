// Field Guide entries, generated from the game's own data tables so the guide stays in sync by itself:
//  * creatures:  every key of MOBS (name, kind, drops, food, taming food; habitat from the spawn tables)
//  * biomes:     the BIOMES list (climate from temp / humid, features from its tints and what lives there)
//  * structures: the LANDMARK_KINDS the maps know (+ the Explorer Chart that finds one, if there is a chart)
//  * items:      what mobs drop, the Explorer Charts and a few finds worth a mention
// Everything is built lazily on first use and cached; nothing here runs per frame. Mobs register themselves
// into MOBS when their modules load, so the first call must come after the game's modules are in (the game
// and the tests both guarantee that).
import { MOBS, CATEGORY } from '../mobs/mobTypes.js';
import { SPAWN_TABLES } from '../mobs/spawnRules.js';
import { DIM_SPAWN_TABLES } from '../mobs/dimensionMobs.js';
import { SPECIAL_HABITATS } from '../mobs/fauna.js';
import { OCEAN_SKY_HABITATS } from '../mobs/oceanSky.js';
import { DUNE_HABITATS } from '../mobs/duneMobs.js';
import { BIOMES } from '../world/biomes.js';
import { LANDMARK_KINDS } from '../world/landmarkKinds.js';
import { ITEMS, I, CHARTS } from '../world/items.js';
import { B, BLOCKS } from '../world/blocks.js';
import { DISHES } from '../world/cooking.js';
import { TABS, countFound, recordOf, LEVEL } from './fieldGuide.js';

export const TAB_LABELS = { creatures: 'Creatures', biomes: 'Biomes', structures: 'Structures', items: 'Items of note' };
/** The names of the four tabs' completion milestones are in player/milestones.js. */

/** The name of an item or block id ('?' for an unknown one). */
export function itemName(id) {
  const d = ITEMS[id] || BLOCKS[id];
  return d && d.name ? d.name : '?';
}
const uniq = (a) => [...new Set(a)];
const named = (ids) => uniq(ids.filter((id) => id !== undefined && id !== null && (ITEMS[id] || BLOCKS[id])));

const KIND_LABEL = { [CATEGORY.CREATURE]: 'Creature', [CATEGORY.MONSTER]: 'Monster', [CATEGORY.AMBIENT]: 'Wildlife' };
const DIM_PLACES = {
  cinderdeep: 'The Cinderdeep', bastion: 'Cinderdeep bastions', hollow: 'The Hollow', hollowCity: 'Hollow cities',
  cinderThicket: 'Glowcap Thickets of the Cinderdeep', cinderDelta: 'The Slagfall Delta of the Cinderdeep', cinderVale: 'The Dirgevale of the Cinderdeep', cinderForge: 'Cinderforges',
};
/** Where a creature lives when no spawn table says so (looked up by key; anything else gets a general note by kind). */
const HABITAT_NOTES = {
  wobbler: 'Swamps and the dark underground of slime chunks',
  settler: 'Villages and igloo basements',
  hexwife: 'Swamp huts',
  ironguard: 'Built from iron blocks; guards villages',
  frostling: 'Built from snow blocks and a pumpkin',
  inkling: 'Deep water of oceans and rivers',
  silverfin: 'Oceans and rivers, in schools',
  reeffin: 'Warm oceans, in schools',
  dolphin: 'Open ocean',
  gillnewt: 'Lush cave pools',
  flitter: 'Dark caves',
  buzzling: 'Flowery lands, around hives',
  hoverling: 'Caged at Raider Outposts, drifting through Hollow cities',
  dune_strider: 'Desert villages and the open desert',
  dustmole: 'Hidden in the sand until it digs out',
  tarnling: 'Quiet ponds, tarns and waterholes',
  gloamlynx: 'Only at dusk and by night',
  brinecrab: 'Sand, mud and gravel along the shore',
  wickling: 'Swamps and dark forests by night; the Mire Shrine, Hag Huts, Observatory and Lighthouse',
  sandsnapper: 'Buried in desert and badlands sand; the first you know of one is its jaws',
  peat_lurker: 'Still bog water in swamps, lying submerged with only its eyes showing',
  cliffkite: 'High over the badlands and the Slot Canyons, riding the updrafts',
  lanternfin: 'The Deep Ocean floor and trenches, in schools; its lure is the only light down there',
  trenchmaw: 'Trenches and Abyssal Grottos; hates a bright lamp',
  skyray: 'Gliding round Cloud Isles high above the land',
  gustling: 'Proving Vaults',
  hushkeeper: 'The Deep Hush, called by noise',
  peddler: 'Wanders in with a caravan now and then',
  packhorn: 'Wanders in with the Roving Peddler',
  deepeye: 'Tide Citadels',
  elder_deepeye: 'Tide Citadels',
  gloomshell: 'Hollow cities',
  void_crystal: 'Pillars of the Hollow',
  void_wyrm: 'The Hollow',
  slag_colossus: 'Woken in a Cinderforge courtyard with a Slagheart Sigil',
  sodden_shambler: 'Oceans and rivers',
  rime_rattler: 'Snowy plains',
  dune_shambler: 'Deserts',
};

/** Biomes whose spawn table lists a mob type, as names; plus the dimension tables. */
function habitatOf(key, def) {
  const where = [];
  const defaultMonsters = (SPAWN_TABLES.monster.default || []).some((e) => e.type === key);
  if (defaultMonsters) where.push('Anywhere dark: caves and the night');
  for (const cat of ['creature', 'monster']) {
    for (const [bk, list] of Object.entries(SPAWN_TABLES[cat])) {
      if (bk === 'default' || !list.some((e) => e.type === key)) continue;
      if (cat === 'monster' && defaultMonsters) continue; // (already anywhere dark)
      const b = BIOMES.find((x) => x.key === bk);
      if (b) where.push(b.name);
    }
  }
  for (const bk of SPECIAL_HABITATS[key] || OCEAN_SKY_HABITATS[key] || DUNE_HABITATS[key] || []) { // placed by faunaTick rather than the tables (Dustmoles in the sand, Tarnlings in ponds)
    const b = BIOMES.find((x) => x.key === bk);
    if (b) where.push(b.name);
  }
  for (const [dk, list] of Object.entries(DIM_SPAWN_TABLES)) if (list.some((e) => e.type === key) && DIM_PLACES[dk]) where.push(DIM_PLACES[dk]);
  if (HABITAT_NOTES[key]) where.push(HABITAT_NOTES[key]);
  if (!where.length) where.push(def.aquatic ? 'The water' : def.category === CATEGORY.MONSTER ? 'Dark, remote places' : 'Seldom met; look in far places');
  return uniq(where);
}

/** Every item or block id a mob can drop. */
export function dropIds(def) {
  const ids = [];
  for (const d of def.drops || []) {
    if (d.oneOf) for (const [id] of d.oneOf) ids.push(id);
    else { ids.push(d.id); if (d.cooked) ids.push(d.cooked); }
  }
  if (def.rare) ids.push(...def.rare.ids);
  if (def.loot) for (const e of def.loot.entries) ids.push(e.id);
  return named(ids);
}

function foodOf(def) {
  const feeds = named(def.food || []);
  let tames = named([...(def.tameFood || []), ...((def.companion && def.companion.tameFood) || [])]);
  if (!tames.length && def.tameable && I.BONE !== undefined) tames = [I.BONE]; // Howlers are won over with a bone
  return { feeds, tames };
}

function creatureEntries() {
  return Object.entries(MOBS).map(([key, def]) => {
    const { feeds, tames } = foodOf(def);
    return {
      key, name: def.name || key, kind: KIND_LABEL[def.category] || 'Creature', category: def.category,
      habitat: habitatOf(key, def), drops: dropIds(def), feeds, tames,
      traits: [def.boss && 'Boss', def.neutral && 'Neutral until provoked', def.burnsInSun && 'Burns in sunlight', def.explosive && 'Explodes', def.ranged && 'Shoots from afar', def.flying && 'Flies', (def.aquatic || def.swimmer) && 'Swims', def.rideable && 'Can be ridden', def.tameable || def.companion ? 'Can be tamed' : false, def.burrower && 'Burrows in sand', def.shy && 'Shy: flees from light', def.bucketable && 'Can be caught in a bucket', def.spawnWhen === 'dusk' && 'Out at dusk and by night'].filter(Boolean),
    };
  });
}

/** Climate word from a biome's temperature (the weather line is 0.15: colder biomes get snow). */
export function climateOf(temp) {
  return temp < 0.15 ? 'Frozen' : temp < 0.4 ? 'Cold' : temp < 1.0 ? 'Temperate' : temp < 1.5 ? 'Warm' : 'Hot';
}

function biomeEntries() {
  return BIOMES.map((b) => {
    const wildlife = uniq([...(SPAWN_TABLES.creature[b.key] || []), ...(SPAWN_TABLES.monster[b.key] || [])]
      .filter((e) => MOBS[e.type] && !(SPAWN_TABLES.monster.default || []).some((d) => d.type === e.type)).map((e) => MOBS[e.type].name)
      .concat(Object.entries({ ...SPECIAL_HABITATS, ...OCEAN_SKY_HABITATS }).filter(([k, keys]) => MOBS[k] && keys.includes(b.key)).map(([k]) => MOBS[k].name)));
    const features = [
      b.temp < 0.15 ? 'Snow falls instead of rain' : b.dry ? 'Dry: no rain' : 'Rain falls',
      b.humid >= 0.8 ? 'Humid' : b.humid <= 0.2 ? 'Arid' : null,
      b.grass ? 'Its own grass and leaf colour' : null,
      b.water ? 'Tinted water' : null,
      b.key.includes('ocean') || b.key.includes('river') ? 'Water biome' : null,
    ].filter(Boolean);
    return { key: b.key, name: b.name, temp: b.temp, humid: b.humid, climate: climateOf(b.temp), features, wildlife };
  });
}

const STRUCTURE_NOTES = {
  village: 'Settlers live and trade here; farms, paths and a well, with a Bounty Board beside it where the day\'s bounties and the Elder\'s tales are given out.',
  temple: 'A trapped desert or jungle temple with hidden loot.',
  igloo: 'A snow hut with a hidden basement.',
  outpost: 'A Raider Outpost: Marauders keep watch from its tower.',
  hut: 'A swamp hut where a Hexwife brews.',
  wreck: 'A wrecked ship, sometimes with a map in its chest.',
  citadel: 'A great sea-floor citadel guarded by Deepeyes.',
  sunken: 'Ruined halls on the sea floor.',
  tomb: 'A pyramid tomb under the three suns.',
  skywatch: 'A tower that looks out over the land.',
  rimekeep: 'A frozen fortress in the cold.',
  sporehall: 'A hall grown among giant mushrooms.',
  lighthouse: 'A red-and-white tower on a beach point, its lens still waiting for a keeper.',
  mireshrine: 'A shrine sunk knee-deep in the bog, with a rose window and a flooded crypt.',
  observatory: 'A domed star-watching house on the hills, its glass mostly fallen.',
  sandvault: 'A trapped temple buried under the dunes: only a golden Sun Glyph shows. Dart Traps, pressure plates and a burial hall.',
  canyon: 'A sheer Slot Canyon cut into a Painted Mesa, with a pool on its floor, a chest at one end and plank bridges across.',
  haghut: 'A stilted cabin of Bog Planks reached by bog bridges, with a Hag\'s Cauldron and a recipe in riddles.',
  grotto: 'A sea cave in a rock dome on the deep floor: Gleamkelp, a tidestone dais with two chests and a wrecked diving skiff. Trenchmaws lurk inside; bring a lamp.',
  isle: 'A grassy island in the sky over pale Cirrusstone, with an Aerie of two chests, a bean plot and ore. A wild Beanstalk climbs to it from the ground below; Skyrays glide round it.',
  cinderforge: 'An abandoned smithy of Scorched Bricks in the Cinderdeep, with a lava pit and a Cinder Brute spawner. A Slagheart Sigil used in its courtyard wakes the Slag Colossus.',
  wyrmribs: 'The bleached ribcage of a Void Wyrm on an outer island of the Hollow.',
};

function structureEntries() {
  return LANDMARK_KINDS.map((k) => ({
    key: k.key, name: k.name, color: k.color, shape: k.shape,
    note: STRUCTURE_NOTES[k.key] || 'A landmark of the overworld.',
    chart: CHARTS[k.key] !== undefined ? itemName(CHARTS[k.key]) : null,
  }));
}

/** Finds worth a mention besides what mobs drop and the charts (by `I` key; ones that do not exist are skipped). */
const EXTRA_NOTABLE = ['DIAMOND', 'BERYL', 'VOID_PEARL', 'CHARM_OF_UNDYING', 'TIDESPEAR', 'ENCHANTED_BOOK', 'SADDLE', 'FROSTROOT', 'DEWBERRIES', 'SUNGOURD_SEEDS', 'GOURD_WEDGE', 'SLAG_SIGIL', 'COLOSSUS_CORE', 'SLAGSTEEL_INGOT', 'DIRGE_CRYSTAL', 'FARSCOPE', 'WAYMARK_COMPASS', 'BOG_ESSENCE', 'RAW_BOGCARP', 'RAW_DUNEFIN', 'GILDED_PERCH'];

/** Cinnabar contraption parts (block keys): sensors and timers a builder makes, listed so the guide notes the first one you hold. */
const CONTRAPTION_PARTS = ['COMPARATOR', 'OBSERVER', 'DAYLIGHT_SENSOR', 'SNARE_POST', 'SNARE_CORD', 'PULSE_GATE'];

const PACK5_BLOCKS = ['STRATA_RUST', 'SUN_GLYPH', 'DART_TRAP', 'BOG_PLANKS', 'HAG_CAULDRON'];
const PACK5_WHY = { STRATA_RUST: 'Painted Mesas', SUN_GLYPH: 'Sandvaults', DART_TRAP: 'Sandvaults (and crafted)', BOG_PLANKS: 'Hag Huts and bog bridges', HAG_CAULDRON: 'Hag Huts' };

function itemEntries() {
  const sources = new Map();
  const add = (id, why) => { if (!sources.has(id)) sources.set(id, []); if (why && !sources.get(id).includes(why)) sources.get(id).push(why); };
  for (const def of Object.values(MOBS)) for (const id of dropIds(def)) add(id, def.name);
  for (const id of Object.values(CHARTS)) add(id, 'Cartographers and wreck chests');
  for (const k of EXTRA_NOTABLE) if (I[k] !== undefined) add(I[k], null);
  if (B.BOUNTY_BOARD !== undefined) add(B.BOUNTY_BOARD, 'Villages and crafting (bounties and tales)');
  for (const k of CONTRAPTION_PARTS) if (B[k] !== undefined) add(B[k], 'Cinnabar and machines (crafted)'); // (world/circuits.js: the parts of cinnabar contraptions)
  for (const k of PACK5_BLOCKS) if (B[k] !== undefined) add(B[k], PACK5_WHY[k]); // the desert / bog pack's finds and traps
  for (const d of DISHES) add(d.id, 'Cooking Pot'); // every dish the Cooking Pot can make (world/cookingPot.js), so a new recipe joins the guide by itself
  return [...sources.entries()].sort((a, b) => a[0] - b[0]).map(([id, from]) => ({ key: String(id), id, name: itemName(id), from }));
}

const BUILDERS = { creatures: creatureEntries, biomes: biomeEntries, structures: structureEntries, items: itemEntries };
const cache = {};
/** The entries of a tab (built once, on first use). */
export function entriesOf(tab) {
  if (!BUILDERS[tab]) return [];
  return cache[tab] || (cache[tab] = BUILDERS[tab]());
}
/** Forget the built entries (tests that add mobs afterwards). */
export function resetGuideEntries() { for (const k of Object.keys(cache)) delete cache[k]; keySets.clear(); }

const keySets = new Map();
/** The set of keys a tab can show. */
export function keysOf(tab) {
  if (!keySets.has(tab)) keySets.set(tab, new Set(entriesOf(tab).map((e) => e.key)));
  return keySets.get(tab);
}

/** Is this item id one the guide tracks under "Items of note"? */
export const isNotableItem = (id) => keysOf('items').has(String(id));

/** [{ tab, label, found, total }] for the four tabs. */
export function guideProgress(guide) {
  return TABS.map((tab) => ({ tab, label: TAB_LABELS[tab], found: countFound(guide, tab, keysOf(tab)), total: keysOf(tab).size }));
}

/** Has every entry of a tab been discovered? (A tab with no entries never counts as complete.) */
export function tabComplete(guide, tab) {
  const total = keysOf(tab).size;
  return total > 0 && countFound(guide, tab, keysOf(tab)) >= total;
}

/** Rows for the statistics screen: [label, "found / total"]. */
export function guideRows(guide) {
  return guideProgress(guide).map((p) => [`Field Guide: ${p.label}`, `${p.found} / ${p.total}`]);
}

/** The name of an entry for a toast (null for a key the guide does not know). */
export function entryName(tab, key) {
  const e = entriesOf(tab).find((x) => x.key === String(key));
  return e ? e.name : null;
}

export { recordOf, LEVEL };
