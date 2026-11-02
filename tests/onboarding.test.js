import { describe, it, expect } from 'vitest';
import {
  HINTS, HINT_ORDER, HINT_TICKS, HINT_GAP, HINT_QUEUE, HUNGRY_AT, LOST_DISTANCE, STEPS, STEP_IDS, STEPS_RETIRE_AT,
  actionLabel, fillKeys, situationHints, isSheltered, cleanIds, Onboarding,
} from '../src/player/onboarding.js';
import { buildTopics, searchTopics, queryWords, topicText, GROUP_ORDER } from '../src/ui/helpTopics.js';
import { ACTIONS, ACTION_IDS, resolveBindings, defaultTable, setBinding } from '../src/ui/bindings.js';
import { HELP } from '../src/ui/commands.js';
import { MILESTONES, Milestones } from '../src/player/milestones.js';
import { Inventory } from '../src/player/inventory.js';
import { DEFAULT_SETTINGS } from '../src/game.js';
import { B, SOLID } from '../src/world/blocks.js';
import { I, POTION_ITEM } from '../src/world/items.js';
import { SPRINT_MIN_FOOD } from '../src/player/survival.js';
import { EVENT_KINDS } from '../src/world/events.js';
import { STANDINGS } from '../src/mobs/reputation.js';
import { SEASON_NAMES } from '../src/world/seasons.js';
import { MockWorld } from './helpers.js';

const FORBIDDEN = /minecraft|nether|redstone|\bend\b/i;

/** A memory-backed store like localStorage. */
function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, String(v)), remove: (k) => m.delete(k), m };
}

/** Just enough of a Game for Onboarding: a clock, settings, a HUD that records what it was asked to draw. */
function fakeGame(settings = {}) {
  const log = { hints: [], hidden: 0, steps: [], toasts: [] };
  const g = {
    ticks: 1000,
    settings: { hints: true, firstSteps: true, keys: {}, ...settings },
    ui: { open: null },
    input: { pad: { connected: false } },
    touch: null,
    player: { inventory: new Inventory(), x: 0, y: 70, z: 0, spawn: { x: 0, y: 70, z: 0 }, creative: false, hunger: { food: 20 } },
    world: { dimension: 'overworld', getBlock: () => 0, rainingAt: () => false },
    sky: { state: { aboveCount: 2 } },
    milestones: { done: new Set() },
    hud: {
      visible: true, log,
      showHint(title, text, foot, id) { log.hints.push({ title, text, foot, id }); },
      hideHint() { log.hidden++; },
      renderSteps(view) { log.steps.push(view); },
      toast(m) { log.toasts.push(m); },
    },
    setSetting(k, v) { g.settings[k] = v; },
  };
  return g;
}
const make = (settings, init) => { const g = fakeGame(settings); const store = memStore(init); const o = new Onboarding(g, { store, name: 'Tester' }); g.onboarding = o; return { g, o, store }; };

describe('controls: Help gets F1', () => {
  it('help is F1 and the HUD toggle moved to F2 so no default code is shared', () => {
    const t = defaultTable();
    expect(t.help[0]).toBe('F1');
    expect(t.hud[0]).toBe('F2');
    expect(t.dismissHint).toEqual(['KeyH', null, 'PadBack']);
    const seen = new Set();
    for (const a of ACTIONS) for (const c of a.def) { if (c) { expect(seen.has(c)).toBe(false); seen.add(c); } }
    expect(ACTION_IDS).toContain('help');
  });

  it('a player who rebound the HUD to F1 keeps it and Help loses the clash', () => {
    const t = resolveBindings({ hud: ['F1', null, null] });
    expect(t.hud[0]).toBe('F1');
    expect(t.help[0]).toBeNull();
  });

  it('the new settings are defaults', () => {
    expect(DEFAULT_SETTINGS.hints).toBe(true);
    expect(DEFAULT_SETTINGS.firstSteps).toBe(true);
  });
});

describe('key words in hints', () => {
  const table = defaultTable();
  it('names the key, the gamepad button or the touch button', () => {
    expect(actionLabel(table, 'inventory', 'key')).toBe('E');
    expect(actionLabel(table, 'inventory', 'pad')).toBe('Y');
    expect(actionLabel(table, 'inventory', 'touch')).toBe('the Bag button');
    expect(actionLabel(table, 'help', 'key')).toBe('F1');
    expect(actionLabel(table, 'help', 'touch')).toBe('Menu > Help');
  });

  it('actions with no key fall back to the mouse button, and to the pad when keys are gone', () => {
    expect(actionLabel(table, 'use', 'key')).toBe('right click');
    expect(actionLabel(table, 'attack', 'key')).toBe('left click');
    expect(actionLabel(table, 'use', 'pad')).toBe('Left trigger');
    expect(actionLabel(table, 'jump', 'pad')).toBe('A');
  });

  it('follows rebinding', () => {
    const r = setBinding(table, 'inventory', 0, 'KeyI');
    expect(fillKeys('Open your bag ({inventory}).', r.table)).toBe('Open your bag (I).');
  });

  it('fillKeys leaves unknown words alone', () => {
    expect(fillKeys('{nothing} here', table)).toBe('{nothing} here');
  });

  it('every hint and step tip resolves in every mode, with no placeholder left over', () => {
    for (const mode of ['key', 'pad', 'touch']) {
      for (const id of HINT_ORDER) expect(fillKeys(HINTS[id].text, table, mode)).not.toMatch(/[{}]/);
      for (const s of STEPS) expect(fillKeys(s.tip, table, mode)).not.toMatch(/[{}]/);
    }
  });
});

describe('the hints themselves', () => {
  it('cover every situation asked for', () => {
    for (const id of ['night', 'hurt', 'village', 'trade', 'chest', 'hungry', 'toolbreak', 'cinnabar', 'potion', 'lost', 'rain']) expect(HINTS[id]).toBeTruthy();
  });

  it('are short, titled and free of forbidden words', () => {
    for (const id of HINT_ORDER) {
      const h = HINTS[id];
      expect(h.title.length).toBeGreaterThan(2);
      expect(h.text.length).toBeGreaterThan(30);
      expect(h.text.length).toBeLessThan(260);
      expect(`${h.title} ${h.text}`).not.toMatch(FORBIDDEN);
    }
    for (const s of STEPS) expect(`${s.label} ${s.tip}`).not.toMatch(FORBIDDEN);
  });

  it('situationHints: night, hunger, lost, rain', () => {
    const base = { overworld: true, creative: false, night: false, food: 20, farFromSpawn: false, hasCompass: false, hasMap: false, raining: false };
    expect(situationHints(base)).toEqual([]);
    expect(situationHints({ ...base, night: true })).toEqual(['night']);
    expect(situationHints({ ...base, food: HUNGRY_AT })).toEqual(['hungry']);
    expect(situationHints({ ...base, food: HUNGRY_AT + 1 })).toEqual([]);
    expect(HUNGRY_AT).toBe(SPRINT_MIN_FOOD - 1);
    expect(situationHints({ ...base, farFromSpawn: true })).toEqual(['lost']);
    expect(situationHints({ ...base, farFromSpawn: true, hasCompass: true })).toEqual([]);
    expect(situationHints({ ...base, farFromSpawn: true, hasMap: true })).toEqual([]);
    expect(situationHints({ ...base, raining: true })).toEqual(['rain']);
  });

  it('situationHints: nothing in other dimensions, no night or hunger tips in creative', () => {
    const base = { overworld: false, night: true, food: 0, farFromSpawn: true, raining: true };
    expect(situationHints(base)).toEqual([]);
    expect(situationHints({ ...base, overworld: true, creative: true })).toEqual(['lost', 'rain']);
    expect(situationHints(null)).toEqual([]);
  });
});

describe('shelter detection', () => {
  /** A 3x3 floor-level room around (0, 64, 0) with walls two high and a roof at y+3. */
  function hut({ roof = true, gap = false } = {}) {
    const w = new MockWorld(64);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (edge) { w.set(dx, 64, dz, B.COBBLESTONE); w.set(dx, 65, dz, B.COBBLESTONE); }
      if (roof) w.set(dx, 66, dz, B.COBBLESTONE);
    }
    if (gap) { w.set(2, 64, 0, B.AIR); w.set(2, 65, 0, B.AIR); }
    return w;
  }
  const test = (w) => isSheltered((x, y, z) => w.getBlock(x, y, z), 0, 64, 0, SOLID);

  it('open ground is not a shelter', () => { expect(test(new MockWorld(64))).toBe(false); });
  it('walls and a roof are', () => { expect(test(hut())).toBe(true); });
  it('a hut without a roof is not', () => { expect(test(hut({ roof: false }))).toBe(false); });
  it('a hut with a doorway left open is not', () => {
    const w = hut({ gap: true });
    // the doorway is open on that side but a wall further out would still count: clear all of it
    for (let d = 1; d <= 3; d++) { w.set(d, 64, 0, B.AIR); w.set(d, 65, 0, B.AIR); }
    expect(test(w)).toBe(false);
  });
  it('a door-sized gap that is plugged again counts', () => {
    const w = hut({ gap: true });
    w.set(2, 64, 0, B.OAK_PLANKS);
    expect(test(w)).toBe(true);
  });
});

describe('hint display', () => {
  it('shows a hint once, fills in the key names and remembers it per player', () => {
    const { g, o, store } = make();
    expect(o.trigger('night')).toBe(true);
    expect(g.hud.log.hints).toHaveLength(1);
    expect(g.hud.log.hints[0].id).toBe('night');
    expect(g.hud.log.hints[0].text).toContain('right click');
    expect(g.hud.log.hints[0].text).not.toMatch(/[{}]/);
    expect(g.hud.log.hints[0].foot).toMatch(/H: got it/);
    expect(JSON.parse(store.get('saturncraft.hints.tester'))).toEqual(['night']);
    o.dismiss();
    g.ticks += HINT_GAP + 1;
    expect(o.trigger('night')).toBe(false);
    expect(g.hud.log.hints).toHaveLength(1);
  });

  it('a second player in the same browser starts fresh, the first is remembered', () => {
    const { store } = make();
    store.set('saturncraft.hints.tester', JSON.stringify(['night', 'bogus']));
    const g2 = fakeGame();
    const again = new Onboarding(g2, { store, name: 'Tester' });
    expect([...again.seen]).toEqual(['night']);
    const other = new Onboarding(fakeGame(), { store, name: 'Someone Else' });
    expect(other.seen.size).toBe(0);
  });

  it('unknown ids and a switched-off setting show nothing', () => {
    const { g, o } = make();
    expect(o.trigger('nope')).toBe(false);
    g.settings.hints = false;
    expect(o.trigger('hurt')).toBe(false);
    expect(g.hud.log.hints).toHaveLength(0);
    expect(o.seen.size).toBe(0);
  });

  it('a hint that is switched off is not marked as seen, so it can show after turning hints back on', () => {
    const { g, o } = make({ hints: false });
    o.trigger('hurt');
    g.settings.hints = true;
    expect(o.trigger('hurt')).toBe(true);
  });

  it('one at a time: the next waits for the gap, the queue is capped', () => {
    const { g, o } = make();
    o.trigger('night');
    o.trigger('hurt');
    expect(g.hud.log.hints.map((h) => h.id)).toEqual(['night']);
    expect(o.queue).toEqual(['hurt']);
    o.tick();
    expect(g.hud.log.hints).toHaveLength(1);
    g.ticks += HINT_TICKS; o.tick();     // expires
    expect(g.hud.log.hidden).toBe(1);
    expect(g.hud.log.hints).toHaveLength(1); // still inside the quiet time
    g.ticks += HINT_GAP; o.tick();
    expect(g.hud.log.hints.map((h) => h.id)).toEqual(['night', 'hurt']);
    for (const id of ['village', 'trade', 'chest', 'hungry', 'toolbreak']) o.trigger(id);
    expect(o.queue.length).toBeLessThanOrEqual(HINT_QUEUE);
  });

  it('dismissing hides the card and starts the quiet time', () => {
    const { g, o } = make();
    o.trigger('hurt');
    expect(o.dismiss()).toBe(true);
    expect(g.hud.log.hidden).toBe(1);
    expect(o.dismiss()).toBe(false);
    o.trigger('chest');
    expect(g.hud.log.hints).toHaveLength(1); // waits for the gap
    g.ticks += HINT_GAP; o.tick();
    expect(g.hud.log.hints).toHaveLength(2);
  });

  it('does not pop up over the death, sleep or pause screens or when the HUD is hidden', () => {
    const { g, o } = make();
    for (const open of ['death', 'sleep', 'pause', 'chat']) { g.ui.open = open; o.trigger('hurt'); expect(g.hud.log.hints).toHaveLength(0); o.queue.length = 0; o.seen.clear(); }
    g.ui.open = null; g.hud.visible = false; o.trigger('hurt');
    expect(g.hud.log.hints).toHaveLength(0);
    g.hud.visible = true; o.tick();
    expect(g.hud.log.hints).toHaveLength(1);
  });

  it('works over the inventory and chest screens', () => {
    const { g, o } = make();
    g.ui.open = 'chest';
    o.trigger('chest');
    expect(g.hud.log.hints).toHaveLength(1);
  });

  it('uses gamepad or touch words for that player', () => {
    const a = make(); a.g.input.pad.connected = true; a.o.trigger('night');
    expect(a.g.hud.log.hints[0].text).toContain('Left trigger');
    const b = make(); b.g.touch = {}; b.o.trigger('night');
    expect(b.g.hud.log.hints[0].text).toContain('the Use button');
    expect(b.g.hud.log.hints[0].foot).toContain('Menu > Help');
  });

  it('resetHints brings everything back', () => {
    const { g, o, store } = make();
    o.trigger('hurt');
    o.resetHints();
    expect(o.seen.size).toBe(0);
    expect(JSON.parse(store.get('saturncraft.hints.tester'))).toEqual([]);
    g.ticks += HINT_GAP;
    expect(o.trigger('hurt')).toBe(true);
  });
});

describe('situations through tick and events', () => {
  it('night, hunger and rain show from the once-a-second look', () => {
    const { g, o } = make();
    g.sky.state.aboveCount = 0; o.tick();
    expect(g.hud.log.hints.map((h) => h.id)).toEqual(['night']);
    g.player.hunger.food = 3; g.world.rainingAt = () => true;
    for (let i = 0; i < 4; i++) { g.ticks += HINT_GAP + HINT_TICKS; o.tick(); }
    expect(g.hud.log.hints.map((h) => h.id).sort()).toEqual(['hungry', 'night', 'rain']);
  });

  it('getting lost needs distance and no compass or map', () => {
    const { g, o } = make();
    g.player.x = LOST_DISTANCE + 10;
    g.player.inventory.add({ id: I.COMPASS, count: 1, damage: 0 });
    o.tick();
    expect(g.hud.log.hints).toHaveLength(0);
    g.player.inventory.clear();
    o.tick();
    expect(g.hud.log.hints.map((h) => h.id)).toEqual(['lost']);
  });

  it('nothing is looked at once every hint has been seen', () => {
    const { g, o } = make();
    for (const id of HINT_ORDER) o.seen.add(id);
    g.sky = null; // would throw if the snapshot were taken
    expect(() => o.tick()).not.toThrow();
  });

  it('the village milestone shows its hint', () => {
    const { g, o } = make();
    o.milestone('village');
    expect(g.hud.log.hints[0].id).toBe('village');
  });

  it('first cinnabar part and first potion come from the inventory', () => {
    const { g, o } = make();
    g.player.inventory.add({ id: I.CINNABAR, count: 3, damage: 0 });
    o.inventory();
    expect(g.hud.log.hints.map((h) => h.id)).toEqual(['cinnabar']);
    const pot = make();
    const vial = Object.values(POTION_ITEM);
    pot.g.player.inventory.add({ id: vial[0], count: 1, damage: 0 });
    pot.o.inventory();
    expect(pot.g.hud.log.hints.map((h) => h.id)).toEqual(['potion']);
  });

  it('a broken tool fires the break listener', () => {
    const inv = new Inventory();
    let broke = 0;
    inv.breakListeners.push(() => { broke++; });
    inv.add({ id: I.WOOD_PICKAXE, count: 1, damage: 58 });
    inv.selected = inv.slots.findIndex(Boolean);
    expect(inv.damageSelected(1)).toBe(true);
    expect(broke).toBe(1);
    inv.add({ id: I.WOOD_PICKAXE, count: 1, damage: 0 });
    inv.selected = inv.slots.findIndex(Boolean);
    expect(inv.damageSelected(1)).toBe(false);
    expect(broke).toBe(1);
  });
});

describe('First Steps', () => {
  it('has the five asked-for steps and every milestone id it names exists', () => {
    expect(STEP_IDS).toEqual(['wood', 'bench', 'pick', 'shelter', 'bed']);
    const ids = new Set(MILESTONES.map((m) => m.id));
    for (const s of STEPS) for (const m of s.ms || []) expect(ids.has(m)).toBe(true);
    expect(ids.has(STEPS_RETIRE_AT)).toBe(true);
  });

  it('ticks off from milestone events, in any order', () => {
    const { g, o } = make();
    o.milestone('wood');
    o.milestone('bench');
    expect([...o.steps]).toEqual(['wood', 'bench']);
    const view = o.stepsView();
    expect(view.items.map((i) => i.done)).toEqual([true, true, false, false, false]);
    expect(view.items.find((i) => i.current).id).toBe('pick');
    expect(view.tip.length).toBeGreaterThan(5);
    expect(g.hud.log.steps.at(-1)).toEqual(view);
  });

  it('a wooden pickaxe or a bed in the bag completes their steps', () => {
    const { g, o } = make();
    g.player.inventory.add({ id: I.WOOD_PICKAXE, count: 1, damage: 0 });
    o.inventory();
    expect(o.steps.has('pick')).toBe(true);
    g.player.inventory.add({ id: I.BED, count: 1, damage: 0 });
    o.inventory();
    expect(o.steps.has('bed')).toBe(true);
  });

  it('the shelter step is only checked after the workbench and completes in a built room', () => {
    const { g, o } = make();
    const w = new MockWorld(64);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) === 2 || Math.abs(dz) === 2) { w.set(dx, 64, dz, B.COBBLESTONE); w.set(dx, 65, dz, B.COBBLESTONE); }
      w.set(dx, 66, dz, B.COBBLESTONE);
    }
    g.world.getBlock = (x, y, z) => w.getBlock(x, y, z);
    g.player.y = 64;
    g.ticks = 1000; o.tick();
    expect(o.steps.has('shelter')).toBe(false); // no workbench yet
    o.milestone('bench');
    g.ticks = 1100; o.tick();
    expect(o.steps.has('shelter')).toBe(true);
  });

  it('finishing everything toasts once, shows the card for a few seconds, then hides it', () => {
    const { g, o } = make();
    o.milestone('wood'); o.milestone('bench'); o.milestone('pick'); o.milestone('sleep');
    expect(o.finished).toBe(false);
    o.completeStep('shelter');
    expect(o.finished).toBe(true);
    expect(g.hud.log.toasts).toHaveLength(1);
    expect(o.stepsView().complete).toBe(true);
    g.ticks += 20 * 7; o.tick();
    expect(o.stepsView()).toBeNull();
    expect(g.hud.log.steps.at(-1)).toBeNull();
    o.completeStep('shelter');
    expect(g.hud.log.toasts).toHaveLength(1);
  });

  it('skipping hides it through the setting, and the Help switch brings it back', () => {
    const { g, o } = make();
    o.milestone('wood');
    o.skipSteps();
    expect(g.settings.firstSteps).toBe(false);
    expect(o.stepsView()).toBeNull();
    o.showSteps();
    expect(g.settings.firstSteps).toBe(true);
    expect(o.stepsView().items[0].done).toBe(true);
  });

  it('retires by itself once the player has iron', () => {
    const { o } = make();
    o.milestone(STEPS_RETIRE_AT);
    expect(o.finished).toBe(true);
    expect(o.stepsView()).toBeNull();
  });

  it('picks up what an existing world already did', () => {
    const { g, o } = make();
    g.milestones.done = new Set(['wood', 'bench', 'pick']);
    o.syncFromMilestones();
    expect([...o.steps].sort()).toEqual(['bench', 'pick', 'wood']);
    const old = make();
    old.g.milestones.done = new Set(['wood', 'bench', 'pick', 'iron']);
    old.o.syncFromMilestones();
    expect(old.o.stepsView()).toBeNull();
  });

  it('does nothing while First Steps is switched off', () => {
    const { o } = make({ firstSteps: false });
    o.inventory();
    expect(o.stepsView()).toBeNull();
  });

  it('wording follows the key bindings and the input mode', () => {
    const { g, o } = make();
    expect(o.stepsView().tip).toContain('left click');
    expect(o.stepsView().skip).toContain('F1');
    g.touch = {};
    expect(o.stepsView().tip).toContain('the Mine button');
    expect(o.stepsView().skip).toContain('Menu > Help');
  });
});

describe('saving', () => {
  it('round-trips hints, steps and the finished flag', () => {
    const { o } = make();
    o.trigger('night');
    o.milestone('wood');
    const data = JSON.parse(JSON.stringify(o.save()));
    const fresh = make();
    fresh.o.load(data);
    expect([...fresh.o.seen]).toEqual(['night']);
    expect([...fresh.o.steps]).toEqual(['wood']);
    expect(fresh.o.finished).toBe(false);
  });

  it('survives missing and junk data', () => {
    const { o } = make();
    expect(() => o.load(undefined)).not.toThrow();
    expect(() => o.load({ hints: 'x', steps: [1, null, 'wood', 'wood', 'zzz'], finished: 'yes' })).not.toThrow();
    expect([...o.steps]).toEqual(['wood']);
    expect(o.finished).toBe(false);
    expect(cleanIds(['a', 'a', 'b', 3], ['a'])).toEqual(['a']);
  });

  it('a hint seen in another world is not repeated in this one', () => {
    const a = make();
    a.o.trigger('hurt');
    const b = new Onboarding(fakeGame(), { store: a.store, name: 'Tester' });
    b.load({});
    expect(b.seen.has('hurt')).toBe(true);
  });
});

describe('milestones tell onboarding', () => {
  it('unlocking a milestone calls Onboarding.milestone', () => {
    const calls = [];
    const game = { hud: { milestone() {} }, audio: { play() {} }, onboarding: { milestone: (id) => calls.push(id) }, player: { inventory: new Inventory() } };
    const ms = new Milestones(game);
    ms.event('sleep');
    expect(calls).toEqual(['sleep']);
    ms.event('sleep');
    expect(calls).toEqual(['sleep']);
  });

  it('and works without it', () => {
    const game = { hud: { milestone() {} }, audio: { play() {} } };
    expect(() => new Milestones(game).event('kill')).not.toThrow();
  });
});

describe('Help topics', () => {
  const table = defaultTable();
  const topics = buildTopics({ table });
  const byId = (id) => topics.find((t) => t.id === id);

  it('cover controls, survival, crafting, trading, seasons, events and commands', () => {
    for (const id of ['start', 'survival', 'crafting', 'trading', 'seasons', 'events', 'commands', 'keyboard', 'gamepad', 'touch', 'hints']) expect(byId(id)).toBeTruthy();
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length);
    for (const t of topics) { expect(GROUP_ORDER).toContain(t.group); expect(t.blocks.length).toBeGreaterThan(0); expect(t.text).toBe(topicText(t)); }
  });

  it('are free of forbidden words', () => {
    for (const t of topics) expect(t.text).not.toMatch(FORBIDDEN);
  });

  it('keyboard controls come from the binding table, including rebinds', () => {
    const keyRows = byId('keyboard').blocks.filter((b) => b.keys).flatMap((b) => b.keys);
    expect(keyRows.find(([n]) => n === 'Walk forward')[1]).toBe('W or Up');
    expect(keyRows.find(([n]) => n === 'Inventory')[1]).toBe('E');
    expect(keyRows.find(([n]) => n === 'Help and how-to topics')[1]).toBe('F1');
    const re = buildTopics({ table: setBinding(table, 'inventory', 0, 'KeyI').table });
    const rows = re.find((t) => t.id === 'keyboard').blocks.filter((b) => b.keys).flatMap((b) => b.keys);
    expect(rows.find(([n]) => n === 'Inventory')[1]).toBe('I');
    expect(re.find((t) => t.id === 'start').text).toContain('open your bag with i');
  });

  it('lists every action that has a key, once', () => {
    const rows = byId('keyboard').blocks.filter((b) => b.keys).flatMap((b) => b.keys);
    for (const a of ACTIONS) {
      const hasKey = a.def[0] || a.def[1];
      expect(rows.filter(([n]) => n === a.label).length).toBe(hasKey ? 1 : 0);
    }
  });

  it('gamepad controls come from the pad slots', () => {
    const rows = byId('gamepad').blocks.filter((b) => b.keys).flatMap((b) => b.keys);
    expect(rows.find(([n]) => n === 'Jump / swim up')[1]).toBe('A');
    expect(rows.find(([n]) => n === 'Attack / mine')[1]).toBe('Right trigger');
    expect(rows.find(([n]) => n === 'Walk forward')).toBeUndefined(); // sticks, not buttons
  });

  it('the touch topic points at the Menu button and the pad flag shows in the gamepad topic', () => {
    expect(byId('touch').text).toContain('menu > help');
    expect(buildTopics({ table, pad: true }).find((t) => t.id === 'gamepad').text).toContain('a gamepad is connected');
    expect(buildTopics({ table, touch: true }).find((t) => t.id === 'touch').text).toContain('touch controls are on');
  });

  it('the commands topic is the real command list', () => {
    const cmds = byId('commands').blocks.find((b) => b.cmds).cmds;
    expect(cmds).toEqual(HELP);
    expect(byId('commands').text).toContain('/gamerule');
  });

  it('trading, seasons and events are generated from their systems', () => {
    const trade = byId('trading').text;
    for (const s of STANDINGS) expect(trade).toContain(s.name.toLowerCase());
    const seasons = byId('seasons').text;
    for (const n of Object.values(SEASON_NAMES)) expect(seasons).toContain(n.toLowerCase());
    const events = byId('events').text;
    for (const k of Object.values(EVENT_KINDS)) expect(events).toContain(k.name.toLowerCase());
  });

  it('survival uses the real sprint threshold', () => {
    expect(byId('survival').text).toContain(`${SPRINT_MIN_FOOD - 1} or lower`);
  });

  it('the start topic lists the First Steps', () => {
    for (const s of STEPS) expect(byId('start').text).toContain(s.label.toLowerCase());
  });
});

describe('Help search', () => {
  const topics = buildTopics({ table: defaultTable() });

  it('an empty query lists everything in group order', () => {
    const all = searchTopics(topics, '');
    expect(all).toHaveLength(topics.length);
    const groups = all.map((t) => GROUP_ORDER.indexOf(t.group));
    expect([...groups].sort((a, b) => a - b)).toEqual(groups);
  });

  it('finds topics by title, body and command names', () => {
    expect(searchTopics(topics, 'seasons')[0].id).toBe('seasons');
    expect(searchTopics(topics, 'reputation')[0].id).toBe('trading');
    expect(searchTopics(topics, 'sprint').map((t) => t.id)).toContain('survival');
    expect(searchTopics(topics, '/time').map((t) => t.id)).toContain('commands');
    expect(searchTopics(topics, 'workbench').map((t) => t.id)).toContain('crafting');
    expect(searchTopics(topics, 'bed').map((t) => t.id)).toContain('survival');
    expect(searchTopics(topics, 'lever').map((t) => t.id)).toContain('cinnabar');
  });

  it('needs every word, ignores case and punctuation, and returns nothing for gibberish', () => {
    expect(searchTopics(topics, 'TRADING reputation').map((t) => t.id)).toEqual(['trading']);
    expect(searchTopics(topics, 'crafting, ').length).toBeGreaterThan(0);
    expect(searchTopics(topics, 'zzzqqq')).toEqual([]);
    expect(searchTopics(topics, 'crafting zzzqqq')).toEqual([]);
    expect(queryWords('  Hello, /Time! 42 ')).toEqual(['hello', '/time', '42']);
  });

  it('title hits rank above body hits', () => {
    const r = searchTopics(topics, 'touch');
    expect(r[0].id).toBe('touch');
  });

  it('every topic can be found by its own title', () => {
    for (const t of topics) expect(searchTopics(topics, t.title).map((x) => x.id)).toContain(t.id);
  });
});
