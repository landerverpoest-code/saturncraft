// The Help screen's how-to topics (F1, or pause menu > Help). Everything that can change is generated
// from the systems it describes, so it cannot drift: the controls come from the binding table
// (ui/bindings.js, with the player's own rebinds), the commands from commands.js, the trading numbers
// from mobs/trades.js and reputation.js, the seasons from world/seasons.js, the events from
// world/events.js and the survival numbers from player/survival.js.
//
// A topic is { id, title, group, blocks, text } where blocks are rendered by screens.js:
//   { p: 'paragraph' }  { h: 'heading' }  { list: ['item', ...] }  { keys: [[name, keys], ...] }  { cmds: ['/cmd ...  (note)', ...] }
// `text` is everything searchable, lower case, built here so the search does no work per keystroke.
import { ACTIONS, GROUPS, codeLabel } from './bindings.js';
import { HELP, BUILD_HELP } from './commands.js';
import { DEFAULT_MAX_VOLUME, HISTORY_MAX_OPS, BLUEPRINT_MAX_COUNT, BLUEPRINT_MAX_DIM } from '../world/buildTools.js';
import { STEPS } from '../player/onboarding.js';
import { MAX_FOOD, MAX_HEALTH, SPRINT_MIN_FOOD } from '../player/survival.js';
import { RECIPES, SMELT_TIME } from '../player/crafting.js';
import { SEASON_KEYS, SEASON_NAMES, SEASON_DATA, DEFAULT_DAYS } from '../world/seasons.js';
import { EVENT_KINDS, EVENT_ORDER } from '../world/events.js';
import { STANDINGS, REP, REFUSE_BELOW, MAX_CUT, MAX_SURCHARGE } from '../mobs/reputation.js';
import { MAX_USES, LEVEL_NAMES, LEVEL_AT } from '../mobs/trades.js';
import { BLOCKS } from '../world/blocks.js';
import { ITEMS, I } from '../world/items.js';
import { EFFECTS } from '../player/effects.js';
import { CROP_TRAITS, bestSeasons, GREENHOUSE_LIGHT, GREENHOUSE_REACH, YIELD_FACTOR } from '../world/farming.js';
import { KIND_NAMES, KINDS } from '../world/cookingPot.js';
import { DISHES, KIND_ITEMS } from '../world/cooking.js';
import { CAMP_SLOTS, CAMP_COOK_TICKS, campCooked } from '../world/campfireCooking.js';
import { SMELTING } from '../player/crafting.js';
import { TEMPER_STEPS } from '../world/enchantments.js';
import { COLOSSUS } from '../mobs/slagColossus.js';
import { WEAPON_KINDS, STUN_TICKS, BACKSTAB_MULT, SWEEP_FRACTION, SWEEP_MAX, DISC_RANGE, DISC_RANGE_PER_FARFLIGHT } from '../world/weaponStats.js';
import { TRINKETS, TRINKET_SLOTS } from '../player/trinkets.js';
import { SETS } from '../player/setBonuses.js';
import { DEEP_TOP, TRENCH_MAX } from '../world/deepSea.js';
import { BEANSTALK_MAX } from '../world/randomTicks.js';
import { HELM_WEAR_TICKS, HELM_LIGHT } from '../player/diving.js';
import { lampScareRange } from '../mobs/oceanSky.js';
import { SEA_LEVEL } from '../world/constants.js';
import { VARIETY_STEP, VARIETY_MAX, VARIETY_WINDOW } from '../player/variety.js';
import { SNARE_RANGE, SNARE_HOLD } from '../world/snare.js';
import { PULSE_GATE_SETTINGS } from '../world/pulseGate.js';
import { CHAINS, MAX_ACTIVE, BOUNTIES_PER_BOARD } from '../player/quests.js';
import { LOOP_LIMIT, LOOP_FUSE, OBSERVE_PER_TICK, SCHEDULED_PER_TICK } from '../world/circuits.js';

export const GROUP_ORDER = ['Basics', 'Controls', 'Systems', 'Reference'];

const pct = (v) => `${Math.round(v * 100)}%`;
const keysOf = (table, id, slots) => slots.map((s) => table[id][s]).filter(Boolean).map(codeLabel).join(' or ');

/** Controls grouped as the Controls screen does: [[action label, keys], ...] per group. */
function controlRows(table, slots, mouse) {
  const out = [];
  for (const group of GROUPS) {
    const rows = [];
    for (const a of ACTIONS.filter((x) => x.group === group)) {
      let k = keysOf(table, a.id, slots);
      if (!k && mouse && mouse[a.id]) k = mouse[a.id];
      if (k) rows.push([a.label, k]);
    }
    if (rows.length) out.push({ h: group }, { keys: rows });
  }
  return out;
}

/**
 * All topics for a player.
 * @param {{table: object, touch?: boolean, pad?: boolean}} ctx  table = resolveBindings(settings.keys)
 */
export function buildTopics({ table, touch = false, pad = false } = {}) {
  const key = (id) => keysOf(table, id, [0, 1]) || codeLabel(table[id][2]);
  const first = (id) => codeLabel(table[id][0] || table[id][1] || table[id][2]);
  const T = [];
  const add = (id, title, group, blocks) => T.push({ id, title, group, blocks, text: '' });

  add('start', 'Getting started', 'Basics', [
    { p: 'Punch a tree to collect logs, turn them into planks, and craft a workbench. From there: a pickaxe, stone tools, a furnace, and a shelter before dark.' },
    { list: [
      `Move with ${['forward', 'left', 'back', 'right'].map(first).join(' ')}, jump with ${key('jump')}, open your bag with ${key('inventory')}.`,
      'Hold the attack button on a block to mine it; the use button places blocks, opens doors and chests, and eats held food.',
      `Press ${key('help')} any time for this screen, and ${key('guide')} for the Field Guide of everything you have found.`,
    ] },
    { h: 'The First Steps checklist' },
    { list: STEPS.map((s) => s.label) },
    { p: 'It sits at the top left of the game and ticks itself off as you go. You can skip it at any time from the topic "Hints and First Steps".' },
  ]);

  add('survival', 'Survival basics', 'Basics', [
    { p: `You have ${MAX_HEALTH / 2} hearts and ${MAX_FOOD / 2} food. Hearts refill by themselves while your food is nearly full; at zero food you slowly starve. You cannot sprint when your food is ${SPRINT_MIN_FOOD - 1} or lower, so eat before a long trip.` },
    { list: [
      'Eat by holding food and pressing the use button. Cooked food fills more than raw: smelt it in a furnace.',
      `Air runs out underwater and you start to drown; surface to breathe. Falls, fire and lava hurt too.`,
      'Three suns cross the sky, so days are long and nights are dark and busy with monsters. The sky dial at the top right shows the time.',
      'Beds set your spawn point and skip the night when you sleep in them. With no bed you return to the world spawn.',
      'If you die, everything you carried drops where you fell and most of your experience is lost: go back for it quickly.',
      'A world has rules of its own (/gamerule): keepInventory keeps your things through a death; fallDamage, drowningDamage and fireDamage switch those hurts off; naturalRegeneration, mobGriefing, doFireTick, doWeatherCycle, doMobLoot, doTileDrops and blastsLightFires change how the world behaves. A One Life world (More world options) is survival on Hard without cheats: when you die there, the world can only be watched.',
      'Monsters spawn in the dark, so torches keep an area safe. A shelter, a shield and armour help in a fight.',
    ] },
  ]);

  add('crafting', 'Crafting and smelting', 'Basics', [
    { p: `Your bag has a 2x2 crafting grid; a workbench gives a 3x3 grid. The recipe book beside every grid lists all ${RECIPES.length} recipes: green ones can be made with what you carry, and a click lays the ingredients into the grid (Shift-click for as many as possible).` },
    { list: [
      'Planks, sticks and a workbench come first, then wooden, stone, iron and diamond tools, each tier mining harder blocks and lasting longer.',
      `A furnace turns ore, sand, clay and raw food into ingots, glass, bricks and cooked meals. It needs fuel and takes ${SMELT_TIME / 20} seconds per item.`,
      'Shift-click on a crafting result makes as many as you can. Shift-click a stack in the bag to send it to the open container.',
    ] },
  ]);

  add('quests', 'Bounties and tales', 'Systems', [
    { p: `A Bounty Board stands beside the well of every new village (you can also craft one from planks, sticks and a book). Use it to read the day's ${BOUNTIES_PER_BOARD} bounties, which change every day and are the same for everyone in the world.` },
    { list: [
      'Kinds of bounty: gather items, slay monsters, deliver goods to the board of another village, find a structure, cook a dish in a Cooking Pot, cross a stretch of a biome, trade with settlers, craft items.',
      `Accept a bounty and it joins your Quest Journal (${keysOf(table, 'journal', [0, 1]) || 'K'}, or pause menu > Quest Journal). You can keep ${MAX_ACTIVE} at once. Progress is counted for you and your whole team (or for everybody if you are in no team); the journal credits each player's share.`,
      'When a bounty is finished, turn it in at the board of the village that posted it (a delivery is handed over at the board it is addressed to). Everyone who took part gets the reward: beryl, sometimes items, and reputation with that village.',
      'Items you drop yourself or find in a broken chest do not count towards "gather" bounties; things you mine, pick up from monsters or harvest do.',
    ] },
    { h: "The Elder's tales" },
    { p: "Each board also holds the Village Elder's tales: handcrafted quests of several steps that send you to far places and bosses. A tale is yours alone; claim its reward at any board when it is told." },
    { list: CHAINS.map((c) => `${c.title}: ${c.steps.length} steps, rewards the named ${c.reward.item.label}.`) },
    { p: 'In multiplayer the host keeps the books and every guest can use the board, accept, hand over and turn in.' },
  ]);

  add('trading', 'Trading and reputation', 'Systems', [
    { p: 'Settlers in villages trade items for beryl and beryl for items: use on one to open its offers. Pick an offer, then take the result.' },
    { list: [
      `Each trade can be done about ${MAX_USES} times before it runs out; settlers restock after a while.`,
      `Settlers level up as you trade with them (${LEVEL_NAMES.join(', ')}, from ${LEVEL_AT.slice(1).join(', ')} trades) and offer better goods.`,
      `Villages remember you. Your standing runs through ${STANDINGS.map((s) => s.name).join(', ')} and moves prices up to ${pct(MAX_CUT)} cheaper or ${pct(MAX_SURCHARGE)} dearer.`,
      `A fair trade is worth ${REP.trade} points, a useful gift ${REP.gift}, treasure ${REP.treasure} and winning a raid ${REP.raid}. Hitting a settler costs ${-REP.hit} and killing one ${-REP.kill}.`,
      `At ${REFUSE_BELOW} or lower they will not trade at all; a gift can win them back.`,
    ] },
  ]);

  add('seasons', 'Seasons', 'Systems', [
    { p: `The year has four seasons of ${DEFAULT_DAYS} days each by default: ${SEASON_KEYS.map((k) => SEASON_NAMES[k]).join(', ')}. The sky, the leaves and the weather follow them.` },
    { list: SEASON_KEYS.map((k) => `${SEASON_NAMES[k]}: crops grow at ${pct(SEASON_DATA[k].growth)} speed, animals breed with a ${pct(SEASON_DATA[k].breedCooldown)} wait${SEASON_DATA[k].frost > 0.5 ? ', and frost spreads' : ''}.`) },
    { p: 'Turn seasons off in the pause menu, or change their length with /season. The current season shows under the sky dial.' },
  ]);

  add('farming', 'Farming, soil and greenhouses', 'Systems', [
    { p: 'Till grass or dirt with a hoe, keep water within four blocks and plant seeds or roots on the farmland. Bone Meal ripens crops quickly; the Composter turns scraps into Bone Meal.' },
    { h: 'Wild crops' },
    { list: [
      'Frostroots grow wild in small plots on snowy plains and in taiga; village farms in cold lands sometimes grow them too.',
      'Dewberry Brambles stand on forest edges, in flower forests and in meadows, often ripe.',
      'Sungourds lie in patches on savanna, in jungles and on warm plains; warm villages sometimes plant the stem. Break a Sungourd for Gourd Wedges, craft a wedge into seeds.',
    ] },
    { h: 'Seasons and crops' },
    { list: [
      'Most crops grow at the season\'s speed (see Seasons): slow in winter, quick in spring.',
      ...Object.keys(CROP_TRAITS).map((id) => `${BLOCKS[id].name} grows best in ${bestSeasons(+id)}.`),
    ] },
    { h: 'Greenhouses' },
    { p: `A crop with glass, stained glass or a glass pane as the first block above it (within ${GREENHOUSE_REACH} blocks) and a light level of ${GREENHOUSE_LIGHT} or more never grows slower than usual: the winter stays outside. Light the roof's inside with torches if the nights are dark.` },
    { h: 'Soil fertility' },
    { p: `Taking the same crop again and again from the same farmland lowers the yield: ${pct(YIELD_FACTOR[1])} the second time, ${pct(YIELD_FACTOR[2])} after that (seeds are never reduced). Rotate between crops, let the farmland lie bare for a while, or use Bone Meal on bare farmland to restore it. Look at farmland or a crop and the tip under the crosshair tells you its state; worn-out soil also looks pale and cracked.` },
    { h: 'A varied diet' },
    { p: `Eating something different from your last ${VARIETY_WINDOW - 1} meals gives a little extra saturation: +${VARIETY_STEP} for each different food eaten since you last had it, at most +${VARIETY_MAX}. The same food twice in a row gives nothing.` },
  ]);

  add('cooking', 'Cooking Pot', 'Systems', [
    { p: `The Cooking Pot (iron and a bowl, see the recipe book) cooks stews, soups and pies. Stand it on a campfire, fire, lava or a lit furnace, smoker or blast furnace. Put ingredients in one at a time (one of each kind: ${KINDS.map((k) => KIND_NAMES[k].toLowerCase()).join(', ')}), then stir with an empty hand or a stick. When the mix is a dish it simmers for about 20 seconds; take a serving with a Bowl (soups) or an empty hand (pies). Sneak with an empty hand to tip the ingredients out.` },
    { h: 'Campfire cooking' },
    { p: `A campfire cooks raw food by itself: right-click it with raw meat, fish, a potato or a Frostroot to lay it on the fire (up to ${CAMP_SLOTS} at a time). Each piece takes ${Math.round(CAMP_COOK_TICKS / 20)} seconds and pops out cooked when it is done; right-click with an empty hand to take everything back off, and breaking the campfire drops what is on it. Cooks: ${Object.keys(SMELTING).map(Number).filter((id) => campCooked(id) !== undefined).map((id) => (ITEMS[id] || BLOCKS[id]).name).join(', ')}.` },
    { h: 'Ingredient kinds' },
    { list: KINDS.map((k) => `${KIND_NAMES[k]}: ${KIND_ITEMS[k].filter((id) => id !== undefined).map((id) => (ITEMS[id] || BLOCKS[id]).name).join(', ')}`) },
    { h: 'Dishes' },
    { list: DISHES.map((d) => {
      const fx = (ITEMS[d.id].food.effects || []).map(([t, ticks]) => `${EFFECTS[t].name} ${Math.round(ticks / 20)}s`).join(', ');
      return `${d.name}: ${d.kinds.map((k) => KIND_NAMES[k]).join(' + ')} (${d.servings} servings, ${ITEMS[d.id].food.hunger} food${fx ? ', ' + fx : ''})`;
    }) },
  ]);

  add('landmarks2', 'Lighthouses, shrines and observatories', 'Systems', [
    { p: 'Three newer ruins wait to be found (find them with /locate lighthouse, /locate mire or /locate observatory): a red-and-white Hermit\'s Lighthouse on a beach point, a Mire Shrine sunk in a swamp with a flooded crypt under its altar, and a Stargazer\'s Observatory with a mostly fallen glass dome on open hills. Each has chests, and one chest in each keeps a written log or chart you can read.' },
    { h: 'Building with what you find' },
    { list: [
      'Azure Mosaic (with slabs and stairs) and Sunburst Mosaic: smooth stone round azurite or gold nuggets.',
      'Leaded Glass, Leaded Glass Panes and the Rose Window: see-through glass in lead; the window takes a red, a blue and a yellow dye.',
      'Lighthouse Lens: a bright block that lets its light through; Chandeliers and Iron Braziers light a room from above or below.',
      'Rope Ladder: climb it like a ladder, hung on the side of a block. Made from string and a plank.',
      'Brinecrabs scuttle on beaches and mud (cook Raw Crab on a campfire); Wicklings, candle-headed ghouls whose touch sets you alight, come out at night in swamps and dark forests. Water and rain snuff them.',
    ] },
  ]);

  add('depths', 'The deep sea and the sky', 'Systems', [
    { p: `Under the ocean the floor falls away. Where it lies ${SEA_LEVEL - DEEP_TOP} or more blocks under the surface the biome is Deep Ocean, and the water goes dark with depth: the fog closes in and the colour drains out. Patches of the shallower floor are Kelp Forests, thick with tall kelp. There is no pressure down there and no need to equalise, only the dark (and the breath you hold).` },
    { h: 'Going down' },
    { list: [
      `Trenches wind across the deep floor, up to ${TRENCH_MAX} blocks deeper than the floor beside them. Gleamkelp glows on their floors, and Lanternfins school over them: their lures are the only light for a long way. Catch one for a Raw Lanternfin (a little Night Vision when eaten) and sometimes a Lantern Gland.`,
      `The Diver's Lamp (a Lantern Gland, a glass pane and iron) is a light you hold, lit under water. The Diver's Helm (iron, glass pane and a Lantern Gland) lets you breathe under water, wears one point every ${HELM_WEAR_TICKS / 20} seconds you are submerged and has a brow lamp (light ${HELM_LIGHT}). Repair it with a Lantern Gland at an anvil.`,
      `Abyssal Grottos are sea caves in rock domes on the deep floor (/locate grotto): Gleamkelp among the rocks, a tidestone dais with two chests and the wreck of a diving skiff with a third. Trenchmaws lurk in the dark: they lunge at swimmers, but keep ${lampScareRange(13)} blocks from a held Diver's Lamp and ${lampScareRange(HELM_LIGHT)} from a Diver's Helm.`,
      'Snowy ground hides hollows of Driftsnow: it looks like a snow field but gives way, slows you, and after seven seconds in it the frost starts to bite. Jump to climb out. Leather Boots carry you over it and any piece of leather armour keeps the frost off; a fall into it does not hurt. On ocean floors, glowing Scaldrock drags the still water above it down in a column of bubbles, and Mournsand lifts it: both give a diver air, and both work in your own builds (a Mournsand column is a lift, a Scaldrock column a drop). Scaldrock burns bare feet unless you sneak. The Echo Coffer (eight Obsidian around an Eye of the Void) opens your own 27 slots wherever one stands: every Echo Coffer shows the same store, and only to you.',
      'Under the ice of a cold sea the deep part is the Frozen Deep: the sheet breaks into floes of Packed Ice with dark leads of open water between them. Icebergs rise there (/locate iceberg), hollow inside: swim in through the tunnel under the waterline to a dry ledge, a pool and a chest. Icebound Hulks (/locate hulk) are spruce ships frozen stern-down into the sheet: dive through the hatch in the ice for the flooded hold.',
      'Fishing in the Deep Ocean turns up Lanternfins, Gleamkelp, Lantern Glands, Tide Shards and the odd Skybean.',
    ] },
    { h: 'Going up' },
    { list: [
      `Cloud Isles float high over the land (/locate isle): grass on pale Cirrusstone, a pond, an oak, an Aerie with two chests, a bean plot and veins of ore. A wild Beanstalk rises from the ground below to each one: climb it like a ladder.`,
      `A Skybean planted on dirt or grass grows a Beanstalk of its own, a segment at a time, up to ${BEANSTALK_MAX} blocks. Breaking a stalk brings the part above it down and now and then drops a Skybean.`,
      'Skyrays, broad pale gliders, circle the isles and never attack; they drop Drift Membrane, which mends a Voidwing, and feathers.',
    ] },
  ]);

  add('dunebog', 'Dunes, canyons and bogs', 'Systems', [
    { p: 'The dry and the wet corners of the map hide more (find them with /locate sandvault, /locate canyon or /locate haghut). In patches of the badlands the cliff bands are painted in bright Strata, and a sheer Slot Canyon is cut into some mesas: a pool at the bottom, a chest at the far tip, bridges across the top and Cliffkites riding the updrafts above.' },
    { h: 'The Sandvault' },
    { p: 'Only a Sun Glyph shows above the sand. Break it and climb down the rope ladder. The corridor to the burial hall is lined with Dart Traps fed by pressure plates and little lines of Cinnabar Wire: keep off the plates, or cut the wire to disarm a row. Two Dune Shamblers and three chests wait in the hall.' },
    { h: 'The Hag Hut' },
    { p: 'A cabin of Bog Planks on stilts, reached over bog bridges. Its chest holds the hag\'s recipe in riddles, and the Hag\'s Cauldron wants three things in the right order (a Peat Clot from a Peat Lurker, Tallow from a Wickling, a Slimeball, a Snapper Fang from a Sandsnapper). A wrong one curdles the brew; the right three give Bog Essence, which turns a Murky Elixir into an Elixir of the Marsh in the Alembic.' },
    { h: 'Tools and fishing' },
    { list: [
      'Farscope: a Farglass with a gold ring. Hold right mouse to look through it, scroll (or use the hotbar keys) to step the zoom, and read the range under the ring.',
      'Waymark Compass: points at the last Bounty Board you opened or the last place you marked (/waymark here, /wp add).',
      'Fishing rods can carry Lure (a quicker bite) and Haul (better finds and a second fish). Bogs give Bogcarp, dry lands Dunefin, and a Gilded Perch is rare. Cook them on a fire, or put any fish and wheat in the Cooking Pot for a Fish Pie.',
      'Sandsnappers wait buried in sand (sneak to pass nearer); Peat Lurkers lie in bog water with only their eyes showing; a struck Cliffkite stoops on whoever hit it.',
    ] },
  ]);

  add('events', 'World events', 'Systems', [
    { p: 'Now and then the world does something special. Each event lasts a few minutes and can be switched off with /gamerule doWorldEvents false.' },
    { list: EVENT_ORDER.map((k) => `${EVENT_KINDS[k].name}: ${EVENT_KINDS[k].desc}.`) },
  ]);

  add('cinnabar', 'Cinnabar and machines', 'Systems', [
    { p: 'Cinnabar Dust is mined from cinnabar ore. Lay it as wire to carry a signal from a power source (a lever, a button, a pressure plate, a cinnabar torch) to something that reacts, such as a lamp, a piston or a rail.' },
    { list: ['Repeaters boost and delay a signal.', 'Pistons push blocks when powered; sticky ones pull them back. Slime and Honey Blocks hold on to what touches them, so a piston moves the whole cluster.'] },
    { h: 'Reading and sensing' },
    { list: [
      'A Comparator compares or subtracts signal strength (right-click switches the mode). Behind a chest, barrel, hopper, dispenser, dropper, furnace, brewing stand or composter it reads how full that container is, from 0 to 15, also through one solid block; it reads a jukebox, a cake, a lectern and an item frame too.',
      'An Observer sends a short pulse out of its back whenever the block its face looks at changes.',
      'A Daylight Sensor gives 0 to 15 by the sky light and the three suns; right-click inverts it, so it is strongest at night.',
      `Two Snare Posts facing each other, up to ${SNARE_RANGE} blocks apart with Snare Cord between them, make a tripline: anything that touches the cord makes both posts send power, and for ${SNARE_HOLD / 20} s after it lets go. Cut the cord and the line goes quiet.`,
    ] },
    { h: 'Timing' },
    { list: [
      `The Pulse Gate has eight settings (right-click steps through them). As a Limiter it answers a rising signal with one clean pulse of ${PULSE_GATE_SETTINGS.slice(0, 4).map((s) => s.ticks / 20).join(', ')} s, ignores more edges until it has rested as long again, and gives only one pulse to a signal that stays on: a pulse extender, a pulse shortener and a rate cap in one. As a Metronome it beats on and off every ${PULSE_GATE_SETTINGS.slice(4).map((s) => s.ticks / 20).join(', ')} s while it is powered.`,
      'A cinnabar torch inverts the block it sits on; two of them facing each other remember a signal. Torches that are flipped too often burn out for a while.',
    ] },
    { h: 'Safety' },
    { list: [
      `Runaway loops cannot freeze the game: a block is updated at most ${LOOP_LIMIT} times in one tick (the rest waits for the next tick, and a loop that never calms down is given up after ${LOOP_FUSE} ticks), no more than ${OBSERVE_PER_TICK} Observers start a pulse in one tick, and at most ${SCHEDULED_PER_TICK} scheduled block updates run per tick.`,
      'Ideas to build: a T flip-flop (a latch of two torches steered by a Pulse Gate pulse), a pulse extender (a Pulse Gate on its longest Limiter setting in front of a piston) and an item sorter (a hopper filled with filler items, so only the wanted item fits, read by a Comparator that unlocks the hopper below).',
    ] },
  ]);

  add('building', 'Building tools', 'Systems', [
    { p: 'Creative players, ops and the host can shape the world quickly. Mark two corners with the Surveyor Wand (get it with /wand: left click is corner 1, right click corner 2, and a wireframe box shows the selection) or with /pos1 and /pos2, then fill, replace, clone, copy and paste.' },
    { list: [
      `One command may touch up to ${DEFAULT_MAX_VOLUME.toLocaleString('en-US')} blocks (change it with /gamerule maxBuildVolume). Big edits are done a little each moment, with a progress message, so the game keeps running; /build cancel stops one.`,
      `/undo and /redo walk back through your last ${HISTORY_MAX_OPS} edits, chests and signs included. Everything is saved with the world and shared with friends in a shared world.`,
      '/copy remembers a selection around where you stand; /rotate and /flip turn it before you /paste. Chest contents are left behind unless you add -c.',
      `/blueprint save keeps a selection under a name (up to ${BLUEPRINT_MAX_COUNT} per player, ${BLUEPRINT_MAX_DIM} blocks on a side); /blueprint export makes a file or a text you can share and /blueprint import checks it before keeping it.`,
      'Blocks are named like oak_planks; a pattern such as 60%stone,40%dirt mixes them, and a mask such as stone,dirt or !air picks what to replace.',
    ] },
    { cmds: BUILD_HELP },
  ]);

  add('endgame', 'Bosses, tempering and elixirs', 'Systems', [
    { p: 'Three fights wait for those who go furthest. The Void Wyrm guards the Hollow, the Hushkeeper answers noise in the Deep Hush, and the Slag Colossus sleeps in the Cinderdeep until you wake it. A bar across the top of the screen shows a boss health and its phases.' },
    { h: 'The Slag Colossus' },
    { list: [
      `Make a Slagheart Sigil (4 Slagsteel Ingots, 2 Ember Rods, a Dirge Crystal and 2 Obsidian) and use it inside the courtyard of a Cinderforge. Find one with /locate forge. Only the host can wake it in a shared world.`,
      `It has ${COLOSSUS.HEALTH} health and fights in three phases (below ${Math.round(COLOSSUS.PHASE_AT[0] * 100)}% and ${Math.round(COLOSSUS.PHASE_AT[1] * 100)}% it changes). Watch what it does with its arms: raised arms mean a slam is coming, and a shockwave spreads across the floor, so jump it. It cannot be hurt for a moment between phases.`,
      'Phase 2 adds lava pillars (a ring of flame on the floor, a second to leave it) and two Cinder Brutes. In phase 3 it charges in a straight line after pawing the ground: step aside and it may run into a wall and be stunned, which makes it take half again as much damage.',
      'A Colossus nobody is fighting withdraws after a minute and leaves the sigil behind. It drops a Colossus Core, Slagsteel, Dirge Crystals and Ember Rods, and sometimes a book of Sunmend.',
    ] },
    { h: 'Tempering gear' },
    { p: 'Put a sword, axe, spear, tool or piece of armour on the left of an anvil and a tempering material on the right. Each step needs the one before it:' },
    { list: [
      ...TEMPER_STEPS.map((s) => `Level ${s.level}: ${s.per} ${ITEMS[I[s.mat]].name} (${s.xp} levels, plus the anvil prior-work cost).`),
      'Forgebite (swords, axes, spears) adds a point of damage a level. Forgeward (armour) adds protection against fire, lava and blasts. Forgegrip (pickaxes, shovels, hoes) adds mining speed.',
      'Sunmend repairs gear you wear or hold from the experience you pick up, two points of wear for each point of experience.',
    ] },
    { h: 'More elixirs' },
    { list: ['Glowcap Spores brew Haste, Dirge Crystals brew Ironskin (Resistance) and a Gilded Apple brews Warding (Absorption) on a Murky Elixir, as other ingredients do; Cinnabar Dust lengthens them and Glowshard Dust strengthens them.'] },
  ]);

  add('gear', 'Weapons, trinkets and armour sets', 'Systems', [
    { p: 'Four new weapons play differently from the sword. Stone, iron and diamond versions of each are crafted at a workbench and can take the sword enchantments (Keen, Shove, Emberbrand, Plunder, Steadfast, Sunmend and the tempering ones).' },
    { list: [
      `Warhammer: slow (${WEAPON_KINDS.warhammer.tiers.iron.attackSpeed} swings a second) and heavy (${WEAPON_KINDS.warhammer.tiers.stone.damage}-${WEAPON_KINDS.warhammer.tiers.diamond.damage} damage). A full swing staggers a mob for ${STUN_TICKS / 20} s, and it splinters a raised shield like an axe. It wears twice as fast.`,
      `Dagger: fast (${WEAPON_KINDS.dagger.tiers.iron.attackSpeed} swings a second) with a short reach (${WEAPON_KINDS.dagger.reach} blocks). A blow from behind a mob does ${BACKSTAB_MULT} times the damage. Creep up on the ones that look away.`,
      `Glaive: a reach of ${WEAPON_KINDS.glaive.reach} blocks. The blow also sweeps up to ${SWEEP_MAX} more mobs in front of you for ${Math.round(SWEEP_FRACTION * 100)}% of its damage: made for crowds.`,
      `Returning Disc: right-click to throw it. It flies ${DISC_RANGE} blocks (${DISC_RANGE_PER_FARFLIGHT} more a level of Farflight), hitting what it passes, then comes back to you and is caught. A clean catch adds a point to the next throw (up to 3); a fumbled one costs a moment. Only one is in the air at a time.`,
    ] },
    { h: 'Trinkets' },
    { p: `The inventory screen has ${TRINKET_SLOTS} trinket slots beside the armour. A trinket works only while worn there, and two of the same kind count once. Find them in chests or craft them:` },
    { list: Object.values(TRINKETS).map((t) => `${t.name}: ${t.desc}`) },
    { h: 'Armour sets' },
    { p: 'Wear two, three or four pieces of one material for a bonus; the tooltip of every piece and the inventory screen show what you have reached. The Dirgestep Boots are the fourth piece of the Slagsteel set (Slagsteel Ingots make a helmet, chestplate and leggings).' },
    { list: Object.values(SETS).map((set) => `${set.name}: ${set.tiers.map((t) => `(${t.n}) ${t.text}`).join('; ')}.`) },
  ]);

  add('maps', "Maps and the Cartographer's Table", 'Systems', [
    { p: "An Empty Map (eight Paper round a Compass) fills in as you walk. A Cartographer's Table (a Compass, a Paper and four planks) is quicker for ground you have already been over: the game remembers every chunk you come within three of, and the table draws a map of the 128-block square it stands in, inking in only those chunks (a Paper and a Compass in your bag; the Compass is kept). Chunks you have left behind are charted from the lay of the land, structures in them are marked, and what you never visited stays blank. Holding a map and a Paper at the table makes a copy that shares the same picture." },
  ]);

  add('guide', 'Field Guide and Milestones', 'Systems', [
    { p: `Press ${key('guide')} for the Field Guide: creatures, biomes, structures and items you have found fill in as you play. Milestones (pause menu) are goals that pop up when reached; Statistics shows what you have done.` },
  ]);

  add('keyboard', 'Controls: keyboard and mouse', 'Controls', [
    { p: 'Change any of these in the pause menu under Controls.' },
    { keys: [['Mine / attack', 'Left mouse button'], ['Place / use / eat', 'Right mouse button'], ['Pick block into hand', 'Middle mouse button'], ['Pause', 'Esc'], ['Change hotbar slot', 'Mouse wheel']] },
    ...controlRows(table, [0, 1], null),
  ]);

  add('gamepad', 'Controls: gamepad', 'Controls', [
    { p: `${pad ? 'A gamepad is connected. ' : ''}Plug in a gamepad and press any button to use it. The left stick moves, the right stick looks and Start pauses.` },
    { list: ['Click the left stick to sprint, and keep pushing forward to keep sprinting.', 'On the pause screens, B or Back goes back and the D-pad scrolls; the bumpers change tabs.', 'In the bag, chests, crafting, furnace and brewing screens the D-pad moves a gold cursor over the slots: A picks up or puts down a stack, X splits it, Y moves it to the other side, B closes.', 'Every button already has a job, so pinging a spot for your team in a shared world is a chord: hold Back and press the right bumper. The Quest Journal is Back + X and marking a waypoint where you stand is Back + the left bumper.'] },
    ...controlRows(table, [2], { attack: 'Right trigger', use: 'Left trigger' }),
  ]);

  add('touch', 'Controls: touch', 'Controls', [
    { p: `${touch ? 'Touch controls are on. ' : 'Touch controls turn on by themselves on phones and tablets (pause menu > Touch controls). '}` },
    { list: [
      'Left thumb moves; push the stick far to sprint.',
      'Drag anywhere else to look around; hold to mine; tap to place or use.',
      'The Jump, Use, Mine and Sneak buttons are at the corners; Menu, Bag, Chat, Guide, Quests (the Quest Journal) and Mark (a waypoint where you stand) are along the top.',
      'Double-tap Jump to fly in creative mode. In bag screens, the Split and Quick tools change what the next tap does.',
      'Menu > Help opens this screen.',
    ] },
  ]);

  add('commands', 'Commands', 'Reference', [
    { p: `Open chat with ${key('chat')} (or ${key('command')} to start with a slash). Most commands change the world, so in a friend's game they run on the host.` },
    { cmds: HELP },
  ]);

  add('access', 'Accessibility and settings', 'Reference', [
    { list: [
      'Pause menu > Accessibility: sound captions with direction, reduced motion, reduced flashing and colour-blind friendly status bars.',
      'Pause menu > Controls: rebind every key and gamepad button, or reset them.',
      'Pause menu > Touch controls: size, opacity and a left-handed layout.',
      'Everything in the game can be reached with the keyboard, a gamepad or touch.',
    ] },
  ]);

  add('hints', 'Hints and First Steps', 'Reference', [
    { p: 'Small one-time tips pop up the first time something new happens, such as your first night or first village. Each shows once, can be dismissed early, and is remembered for you.' },
    { keys: [['Dismiss a tip', `${key('dismissHint')} or tap it`], ['Open this screen', key('help')]] },
    { p: 'Turn tips off, bring them back, or hide the First Steps checklist with the buttons below.' },
  ]);

  for (const t of T) t.text = topicText(t);
  return T;
}

/** Everything searchable in a topic as one lower-case string. */
export function topicText(t) {
  const parts = [t.title, t.group];
  for (const b of t.blocks) {
    if (b.p) parts.push(b.p);
    if (b.h) parts.push(b.h);
    if (b.list) parts.push(...b.list);
    if (b.keys) for (const [a, k] of b.keys) parts.push(a, k);
    if (b.cmds) parts.push(...b.cmds);
  }
  return parts.join(' \n ').toLowerCase();
}

/** Words of a query (lower case, letters and digits, `/` kept so "/time" finds commands). */
export function queryWords(q) { return String(q || '').toLowerCase().match(/[a-z0-9/]+/g) || []; }

/**
 * Topics matching a query, best first. Every word must appear somewhere; a title hit counts most, then a
 * heading, then the body. An empty query lists all topics in their group order.
 */
export function searchTopics(topics, query) {
  const words = queryWords(query);
  if (!words.length) return [...topics].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const scored = [];
  topics.forEach((t, i) => {
    const title = t.title.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (!t.text.includes(w)) { score = -1; break; }
      score += (title.startsWith(w) ? 12 : title.includes(w) ? 8 : 0) + (t.group.toLowerCase().includes(w) ? 2 : 0) + 1;
    }
    if (score > 0) scored.push({ t, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((e) => e.t);
}
