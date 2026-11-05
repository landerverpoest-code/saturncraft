// Onboarding: contextual first-time hints and the short "First Steps" checklist.
//
// Hints are one-time tips that pop up the first time a situation comes up (first night, first hurt by a
// monster, first village...). Each is shown once per player (remembered in the browser under the player's
// name and in the world save), can be dismissed early, and all of them switch off with the Hints setting.
// First Steps is a five-item checklist in the HUD that ticks itself off from the Milestones and the
// inventory and that can be skipped at any time.
//
// Nothing here runs per frame: triggers are events (a hurt listener, an inventory change, a milestone)
// plus one cheap look at the game once a second (Onboarding.tick, called from the 20-tick pass).
import { B, SOLID } from '../world/blocks.js';
import { I, ITEMS } from '../world/items.js';
import { codeLabel, resolveBindings } from '../ui/bindings.js';
import { SPRINT_MIN_FOOD } from './survival.js';

/** Ticks a hint stays up, the quiet time between two hints, and how many may wait their turn. */
export const HINT_TICKS = 20 * 14;
export const HINT_GAP = 20 * 18;
export const HINT_QUEUE = 3;

/** Food at or below which the "hungry" hint shows (the point where sprinting stops). */
export const HUNGRY_AT = SPRINT_MIN_FOOD - 1;
/** Blocks from the spawn point beyond which a player without a compass or map counts as far from home. */
export const LOST_DISTANCE = 350;

/**
 * The hints. `text` may use {action} placeholders (use, attack, inventory, guide, help, pause, dismissHint,
 * sneak), replaced by the key, gamepad button or touch button that player really has (fillKeys).
 */
export const HINTS = {
  night: { title: 'Night falls', text: 'All three suns have set and monsters roam in the dark. Light torches, build a small shelter, or {use} a bed to sleep the night away.' },
  hurt: { title: 'Something hit you', text: 'Watch your hearts. Back away, hit it with a sword, or raise a shield. Hearts refill while your food bar is nearly full.' },
  village: { title: 'A village', text: 'Settlers live here. {use} one to see what they trade, and treat them well: a good name makes prices fairer. {help} has the details.' },
  trade: { title: 'Trading', text: 'Pick an offer, then take the result. A trade runs out after repeated use but settlers restock. Your standing with the village changes the prices.' },
  chest: { title: 'Containers', text: 'Chests keep your things safe. Shift-click a stack (the Quick tool on touch) to send it across, and break the chest to get everything back.' },
  hungry: { title: 'Getting hungry', text: 'Your food bar is low and you cannot sprint at this level. Hold food and {use} to eat. Cooked food fills you more than raw.' },
  toolbreak: { title: 'It broke', text: 'Tools wear out with use. Watch the bar under the item, keep a spare, and craft a new one at a workbench.' },
  cinnabar: { title: 'Cinnabar', text: 'Cinnabar carries signals. Lay dust as wire from a power source such as a lever to something that reacts. {help} explains the parts.' },
  potion: { title: 'Potions', text: '{use} a potion to drink it for a timed effect; splash ones are thrown. Active effects are listed on the screen and in your bag.' },
  lost: { title: 'Far from home?', text: 'A compass points to your spawn, and a map shows where you have been. A bed sets a new spawn closer to where you work.' },
  rain: { title: 'Rain', text: 'Rain waters crops and thins the fires. In a thunderstorm lightning finds open high ground, so shelter or stay low.' },
};
export const HINT_ORDER = Object.keys(HINTS);

/** Items that count as "a cinnabar part" for its hint. */
const CINNABAR_PARTS = [I.CINNABAR, B.LEVER, B.CINNABAR_TORCH, B.REPEATER, B.PISTON, B.STICKY_PISTON, B.CINNABAR_LAMP, B.STONE_BUTTON, B.WOODEN_PRESSURE_PLATE].filter((id) => id !== undefined);
const PICKAXES = ITEMS.filter((d) => d && d.tool && d.tool.type === 'pickaxe').map((d) => d.id);

// ---------------------------------------------------------------------------------------------
// Words for keys

const TOUCH_LABELS = { use: 'the Use button', attack: 'the Mine button', inventory: 'the Bag button', guide: 'the Guide button', help: 'Menu > Help', pause: 'the Menu button', sneak: 'the Sneak button', dismissHint: 'a tap on the tip' };
const MOUSE_LABELS = { attack: 'left click', use: 'right click' };

/** What to call an action for a player: 'key', 'pad' or 'touch' (ui/bindings.js table = resolveBindings result). */
export function actionLabel(table, action, mode = 'key') {
  if (mode === 'touch' && TOUCH_LABELS[action]) return TOUCH_LABELS[action];
  const row = (table && table[action]) || [];
  const pad = row[2] ? codeLabel(row[2]) : null;
  if (mode === 'pad' && pad) return pad;
  const key = row[0] || row[1];
  if (key) return codeLabel(key);
  if (MOUSE_LABELS[action]) return MOUSE_LABELS[action];
  return pad || 'its key';
}

/** Replace {action} placeholders in a hint with the player's own keys. Unknown words are left alone. */
export function fillKeys(text, table, mode = 'key') {
  return String(text).replace(/\{([a-zA-Z]+)\}/g, (all, a) => (table && (table[a] || TOUCH_LABELS[a] || MOUSE_LABELS[a]) ? actionLabel(table, a, mode) : all));
}

// ---------------------------------------------------------------------------------------------
// Which hints apply right now (pure: takes a snapshot of the situation)

/**
 * Hints whose situation holds, from a snapshot:
 * { creative, overworld, night, food, farFromSpawn, hasCompass, hasMap, raining }.
 */
export function situationHints(s) {
  const out = [];
  if (!s || !s.overworld) return out;
  if (s.night && !s.creative) out.push('night');
  if (!s.creative && s.food <= HUNGRY_AT && s.food >= 0) out.push('hungry');
  if (s.farFromSpawn && !s.hasCompass && !s.hasMap) out.push('lost');
  if (s.raining) out.push('rain');
  return out;
}

// ---------------------------------------------------------------------------------------------
// Shelter

/**
 * Is a spot (the player's feet at integer x, y, z) a shelter: a roof overhead and walls on all four sides
 * (anything solid within three blocks at feet or head height counts), so a hut, a hole dug into a hill or
 * a cabin all qualify. `getBlock(x, y, z)` gives block ids; `solid` is the SOLID table.
 */
export function isSheltered(getBlock, x, y, z, solid = SOLID) {
  const hard = (bx, by, bz) => solid[getBlock(bx, by, bz)] === 1;
  // a roof within four blocks above the head, over most of the 3x3 around the player
  let covered = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 2; dy <= 5; dy++) if (hard(x + dx, y + dy, z + dz)) { covered++; break; }
    }
  }
  if (covered < 8) return false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let wall = false;
    for (let d = 1; d <= 3 && !wall; d++) wall = hard(x + dx * d, y, z + dz * d) || hard(x + dx * d, y + 1, z + dz * d);
    if (!wall) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// First Steps

/**
 * The checklist. `ms`: milestone ids that complete the step (any of them); `inv`: item ids that complete it
 * when carried; `shelter`: completed by standing in a shelter once the workbench step is done.
 */
export const STEPS = [
  { id: 'wood', label: 'Gather wood', tip: 'Hold {attack} on a tree trunk until a log drops.', ms: ['wood'] },
  { id: 'bench', label: 'Craft a workbench', tip: 'Open your bag ({inventory}) and put four planks in the 2x2 grid.', ms: ['bench'] },
  { id: 'pick', label: 'Make a pickaxe', tip: 'At the workbench: planks and sticks make a pickaxe for mining stone.', ms: ['pick'], inv: PICKAXES },
  { id: 'shelter', label: 'Build a shelter', tip: 'Walls on every side and a roof over your head keep monsters out. Digging into a hill works too.', shelter: true },
  { id: 'bed', label: 'Make a bed', tip: 'Three wool and three planks make a bed. {use} it at night to sleep and set your spawn.', ms: ['sleep'], inv: [I.BED] },
];
export const STEP_IDS = STEPS.map((s) => s.id);
/** Once this milestone is done the player is past the beginning and the checklist retires by itself. */
export const STEPS_RETIRE_AT = 'iron';

// ---------------------------------------------------------------------------------------------
// Remembering what a player has seen

const STORE_PREFIX = 'saturncraft.hints.';
/** localStorage guarded for private windows, tests and the like. */
export function browserStore() {
  return {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
  };
}
/** Keep only known ids, once each. */
export function cleanIds(list, known) {
  const set = new Set(known);
  return [...new Set(Array.isArray(list) ? list : [])].filter((id) => typeof id === 'string' && set.has(id));
}

export class Onboarding {
  /** @param {object} game  @param {{store?: object, name?: string}} opts */
  constructor(game, opts = {}) {
    this.game = game;
    this.store = opts.store || browserStore();
    this.key = STORE_PREFIX + String(opts.name || 'player').slice(0, 24).toLowerCase();
    this.seen = new Set(cleanIds(this.readStore(), HINT_ORDER)); // hints this player has been shown
    this.steps = new Set();    // First Steps ticked off in this world
    this.finished = false;     // the checklist ran its course here
    this.queue = [];           // hints waiting for their turn
    this.active = null;        // { id, until }
    this.lastEnd = -Infinity;  // tick the last hint went away
    this.doneAt = -1;          // tick the checklist was completed
    this.stepsKey = '';        // what the HUD last drew
  }

  readStore() {
    try { return JSON.parse(this.store.get(this.key) || '[]'); } catch { return []; }
  }
  writeStore() { this.store.set(this.key, JSON.stringify([...this.seen])); }

  get settings() { return this.game.settings || {}; }
  get hintsOn() { return this.settings.hints !== false; }
  get stepsOn() { return this.settings.firstSteps !== false && !this.finished; }
  get ticks() { return this.game.ticks || 0; }
  /** How this player plays: touch buttons, a gamepad or the keyboard. */
  get mode() {
    const g = this.game;
    return g.touch ? 'touch' : g.input && g.input.pad && g.input.pad.connected ? 'pad' : 'key';
  }
  /** The player's resolved key table (ui/bindings.js), for the words in hints. */
  get table() { return resolveBindings(this.settings.keys); }

  // ---- hints -----------------------------------------------------------------------------------

  /** Ask for a hint. It shows now, waits its turn, or is dropped (off, already seen, unknown). */
  trigger(id) {
    if (!this.hintsOn || !HINTS[id] || this.seen.has(id)) return false;
    if ((this.active && this.active.id === id) || this.queue.includes(id)) return false;
    if (this.queue.length >= HINT_QUEUE) return false;
    this.queue.push(id);
    this.pump();
    return true;
  }

  /** Show the next waiting hint if nothing is up and it has been quiet for a while. */
  pump() {
    if (this.active || !this.queue.length) return;
    const g = this.game;
    if (this.ticks - this.lastEnd < HINT_GAP) return;
    if (g.ui && ['death', 'sleep', 'pause', 'chat'].includes(g.ui.open)) return;
    if (g.hud && g.hud.visible === false) return;
    const id = this.queue.shift();
    if (this.seen.has(id)) { this.pump(); return; }
    this.seen.add(id);
    this.writeStore();
    this.active = { id, until: this.ticks + HINT_TICKS };
    if (g.hud && g.hud.showHint) {
      const t = this.table, m = this.mode, h = HINTS[id];
      g.hud.showHint(h.title, fillKeys(h.text, t, m), `${actionLabel(t, 'dismissHint', m)}: got it · ${actionLabel(t, 'help', m)}: help`, id);
    }
  }

  /** The hint on screen goes away (the dismiss key, a tap, or its time ran out). */
  dismiss() {
    if (!this.active) return false;
    this.active = null;
    this.lastEnd = this.ticks;
    if (this.game.hud && this.game.hud.hideHint) this.game.hud.hideHint();
    return true;
  }

  /** Forget what this player has seen, so every hint can show again. */
  resetHints() {
    this.seen.clear(); this.queue.length = 0;
    this.writeStore();
    this.dismiss();
  }

  /** A snapshot of the situation for situationHints. */
  snapshot() {
    const g = this.game, p = g.player, w = g.world;
    const overworld = w.dimension === 'overworld';
    const inv = p.inventory;
    const sp = p.spawn || { x: p.x, z: p.z };
    const far = Math.hypot(p.x - sp.x, p.z - sp.z) > LOST_DISTANCE;
    return {
      creative: !!p.creative,
      overworld,
      night: g.sky.state.aboveCount === 0,
      food: p.hunger.food,
      farFromSpawn: far,
      hasCompass: far ? inv.count(I.COMPASS) > 0 : false,
      hasMap: far ? inv.count(I.FILLED_MAP) > 0 : false,
      raining: overworld && this.pending('rain') && typeof w.rainingAt === 'function' ? w.rainingAt(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) : false,
    };
  }

  /** Could this hint still show? (off, seen or already waiting all say no) */
  pending(id) { return this.hintsOn && !this.seen.has(id); }

  /** Once a second: expire the hint on screen, look at the situation, check the shelter. */
  tick() {
    const t = this.ticks;
    if (this.active && t >= this.active.until) this.dismiss();
    if (this.hintsOn && HINT_ORDER.some((id) => this.pending(id))) {
      for (const id of situationHints(this.snapshot())) this.trigger(id);
      this.pump();
    }
    if (this.stepsOn) {
      if (t % 100 === 0 && !this.steps.has('shelter') && this.steps.has('bench')) this.checkShelter();
      this.finishCheck();
    }
    if (this.doneAt >= 0 && t - this.doneAt > 20 * 6) { this.doneAt = -1; this.renderSteps(); }
  }

  /** The inventory changed: First Steps by item, and the cinnabar and potion hints. */
  inventory() {
    const inv = this.game.player && this.game.player.inventory;
    if (!inv) return;
    if (this.stepsOn) {
      for (const s of STEPS) if (s.inv && !this.steps.has(s.id) && s.inv.some((id) => inv.count(id) > 0)) this.completeStep(s.id);
    }
    if (this.pending('cinnabar') && CINNABAR_PARTS.some((id) => inv.count(id) > 0)) this.trigger('cinnabar');
    if (this.pending('potion') && inv.slots.some((st) => st && ITEMS[st.id] && ITEMS[st.id].potion)) this.trigger('potion');
  }

  /** A Milestone was reached (player/milestones.js calls this). */
  milestone(id) {
    if (id === 'village') this.trigger('village');
    if (this.stepsOn) for (const s of STEPS) if (s.ms && s.ms.includes(id)) this.completeStep(s.id);
    if (id === STEPS_RETIRE_AT && !this.finished) this.retire();
  }

  // ---- First Steps -----------------------------------------------------------------------------

  checkShelter() {
    const g = this.game, p = g.player, w = g.world;
    if (isSheltered((x, y, z) => w.getBlock(x, y, z), Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) this.completeStep('shelter');
  }

  completeStep(id) {
    if (this.steps.has(id) || !STEP_IDS.includes(id)) return;
    this.steps.add(id);
    this.finishCheck();
    this.renderSteps();
  }

  /** All five ticked off: say so, then let the card go after a few seconds. */
  finishCheck() {
    if (this.finished || this.steps.size < STEPS.length) return;
    this.finished = true;
    this.doneAt = this.ticks;
    if (this.game.hud && this.game.hud.toast) this.game.hud.toast('First Steps complete! Help is always one key away.', 3500);
    this.renderSteps();
  }

  /** Past the beginning: no need for a checklist any more. */
  retire() { this.finished = true; this.doneAt = -1; this.renderSteps(); }

  /** Hide the checklist for good (the Skip button, or the Help screen's switch). */
  skipSteps() {
    if (this.game.setSetting) this.game.setSetting('firstSteps', false);
    this.renderSteps();
  }
  /** Bring the checklist back (Help screen). Steps already done stay ticked. */
  showSteps() {
    this.finished = this.steps.size >= STEPS.length;
    if (this.game.setSetting) this.game.setSetting('firstSteps', true);
    this.renderSteps();
  }

  /** What the HUD draws: null (nothing) or { items, tip, complete }. */
  stepsView() {
    const showDone = this.finished && this.doneAt >= 0 && this.steps.size >= STEPS.length;
    if (this.settings.firstSteps === false || (this.finished && !showDone)) return null;
    const t = this.table, m = this.mode;
    const current = STEPS.find((s) => !this.steps.has(s.id));
    return {
      complete: showDone,
      items: STEPS.map((s) => ({ id: s.id, label: s.label, done: this.steps.has(s.id), current: current === s })),
      tip: current ? fillKeys(current.tip, t, m) : '',
      skip: `Skip: ${actionLabel(t, 'help', m)} > First Steps`,
    };
  }

  renderSteps() {
    const hud = this.game.hud;
    if (!hud || !hud.renderSteps) return;
    const view = this.stepsView();
    const key = view ? JSON.stringify(view) : '';
    if (key === this.stepsKey) return;
    this.stepsKey = key;
    hud.renderSteps(view);
  }

  /** Start-up: tick off what the world already knows (milestones) and draw the card. */
  syncFromMilestones() {
    const done = this.game.milestones ? this.game.milestones.done : new Set();
    for (const s of STEPS) if (s.ms && s.ms.some((m) => done.has(m))) this.steps.add(s.id);
    if (this.steps.size >= STEPS.length || done.has(STEPS_RETIRE_AT)) this.finished = true;
    this.renderSteps();
  }

  // ---- saving ----------------------------------------------------------------------------------

  save() { return { hints: [...this.seen], steps: [...this.steps], finished: this.finished }; }

  load(d) {
    const data = d && typeof d === 'object' ? d : {};
    for (const id of cleanIds(data.hints, HINT_ORDER)) this.seen.add(id);
    for (const id of cleanIds(data.steps, STEP_IDS)) this.steps.add(id);
    this.finished = data.finished === true;
    this.writeStore();
    this.syncFromMilestones();
  }
}
