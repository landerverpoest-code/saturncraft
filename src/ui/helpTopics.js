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
import { HELP } from './commands.js';
import { STEPS } from '../player/onboarding.js';
import { MAX_FOOD, MAX_HEALTH, SPRINT_MIN_FOOD } from '../player/survival.js';
import { RECIPES, SMELT_TIME } from '../player/crafting.js';
import { SEASON_KEYS, SEASON_NAMES, SEASON_DATA, DEFAULT_DAYS } from '../world/seasons.js';
import { EVENT_KINDS, EVENT_ORDER } from '../world/events.js';
import { STANDINGS, REP, REFUSE_BELOW, MAX_CUT, MAX_SURCHARGE } from '../mobs/reputation.js';
import { MAX_USES, LEVEL_NAMES, LEVEL_AT } from '../mobs/trades.js';

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

  add('events', 'World events', 'Systems', [
    { p: 'Now and then the world does something special. Each event lasts a few minutes and can be switched off with /gamerule doWorldEvents false.' },
    { list: EVENT_ORDER.map((k) => `${EVENT_KINDS[k].name}: ${EVENT_KINDS[k].desc}.`) },
  ]);

  add('cinnabar', 'Cinnabar and machines', 'Systems', [
    { p: 'Cinnabar Dust is mined from cinnabar ore. Lay it as wire to carry a signal from a power source (a lever, a button, a pressure plate, a cinnabar torch) to something that reacts, such as a lamp, a piston or a rail.' },
    { list: ['Repeaters boost and delay a signal.', 'Pistons push blocks when powered; sticky ones pull them back.'] },
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
    { list: ['Click the left stick to sprint, and keep pushing forward to keep sprinting.', 'On the pause screens, B or Back goes back and the D-pad scrolls; the bumpers change tabs.'] },
    ...controlRows(table, [2], { attack: 'Right trigger', use: 'Left trigger' }),
  ]);

  add('touch', 'Controls: touch', 'Controls', [
    { p: `${touch ? 'Touch controls are on. ' : 'Touch controls turn on by themselves on phones and tablets (pause menu > Touch controls). '}` },
    { list: [
      'Left thumb moves; push the stick far to sprint.',
      'Drag anywhere else to look around; hold to mine; tap to place or use.',
      'The Jump, Use, Mine and Sneak buttons are at the corners; Menu, Bag, Chat and Guide are along the top.',
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
