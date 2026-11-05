// Visual UI QA round: the slot cursor (gamepad / keyboard navigation of inventory, chest, crafting, furnace and brewing grids),
// the gamepad ping chord, and guards for the layout fixes found by looking at every screen at 1280x720, 1024x600, 740x360 and 390x780.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  pickNext, menuIntent, startIndex, gridStep, slotActionFor, slotActionForKey, arrowDirection, inventoryKeyIsSlotAction,
  SLOT_ACTIONS, SLOT_PAD_BUTTONS, AUTOFOCUS_SCREENS, FOCUSABLE, MenuNav,
} from '../src/ui/menuNav.js';
import { applyChords, isChord } from '../src/ui/gamepad.js';
import { ACTIONS, resolveBindings, keyLists, codeLabel, setBinding, defaultTable } from '../src/ui/bindings.js';
import { Input } from '../src/ui/input.js';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const CSS = src('src/ui/style.css');
const SCREENS = src('src/ui/screens.js');
const GAME = src('src/game.js');

/** Slot rectangles of a grid: `cols` x `rows` of 44 px slots 2 px apart, top-left at (x, y). */
function grid(x, y, cols, rows, size = 44, gap = 2) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x + c * (size + gap), y: y + r * (size + gap), w: size, h: size });
  return out;
}

/** The inventory screen as it is laid out: armour column, 2x2 crafting, the result, 3 rows of bag and the hotbar. */
function inventoryLayout() {
  const armor = grid(640, 170, 1, 4);
  const craft = grid(712, 210, 2, 2);
  const result = [{ x: 873, y: 233, w: 44, h: 44 }];
  const main = grid(568, 352, 9, 3);
  const hot = grid(568, 496, 9, 1);
  const rects = [...armor, ...craft, ...result, ...main, ...hot];
  return { rects, armor: 0, craft: 4, result: 8, main: 9, hot: 9 + 27 };
}

describe('slot grid movement (the D-pad / arrow cursor)', () => {
  it('gridStep walks a row-major grid and stops at the edges without wrapping', () => {
    expect(gridStep(0, 9, 36, 'right')).toBe(1);
    expect(gridStep(8, 9, 36, 'right')).toBe(-1);
    expect(gridStep(0, 9, 36, 'left')).toBe(-1);
    expect(gridStep(9, 9, 36, 'left')).toBe(-1); // start of row 2 does not wrap to the end of row 1
    expect(gridStep(4, 9, 36, 'down')).toBe(13);
    expect(gridStep(31, 9, 36, 'down')).toBe(-1);
    expect(gridStep(4, 9, 36, 'up')).toBe(-1);
    expect(gridStep(13, 9, 36, 'up')).toBe(4);
    expect(gridStep(34, 9, 35, 'down')).toBe(-1); // a last row with fewer slots
  });

  it('every slot of the bag is reachable from the first one with the D-pad alone', () => {
    const L = inventoryLayout();
    const seen = new Set([L.main]);
    const queue = [L.main];
    while (queue.length) {
      const i = queue.pop();
      for (const d of ['up', 'down', 'left', 'right']) {
        const n = pickNext(L.rects, i, d);
        if (n >= 0 && !seen.has(n)) { seen.add(n); queue.push(n); }
      }
    }
    expect(seen.size).toBe(L.rects.length); // armour, crafting, result, bag and hotbar: nothing is a dead end
  });

  it('left / right stay in a row of the bag, down from the bag lands on the hotbar in the same column', () => {
    const L = inventoryLayout();
    const at = (r, c) => L.main + r * 9 + c;
    expect(pickNext(L.rects, at(1, 3), 'right')).toBe(at(1, 4));
    expect(pickNext(L.rects, at(1, 3), 'left')).toBe(at(1, 2));
    expect(pickNext(L.rects, at(1, 8), 'right')).toBe(-1);
    expect(pickNext(L.rects, at(0, 3), 'down')).toBe(at(1, 3));
    expect(pickNext(L.rects, at(2, 5), 'down')).toBe(L.hot + 5);
    expect(pickNext(L.rects, L.hot + 5, 'up')).toBe(at(2, 5));
    expect(pickNext(L.rects, L.hot + 8, 'down')).toBe(-1);
  });

  it('up from the bag reaches the crafting grid, and right across it reaches the result slot', () => {
    const L = inventoryLayout();
    const bagCol3 = L.main + 3;
    expect(pickNext(L.rects, bagCol3, 'up')).toBe(L.craft + 2); // bottom-left of the 2x2
    expect(pickNext(L.rects, L.craft + 3, 'right')).toBe(L.result);
    expect(pickNext(L.rects, L.craft + 2, 'right')).toBe(L.craft + 3);
    expect(pickNext(L.rects, L.craft + 3, 'left')).toBe(L.craft + 2);
    expect(pickNext(L.rects, L.craft, 'down')).toBe(L.craft + 2);
  });

  it('a chest screen (chest above the bag) moves between the two grids', () => {
    const chest = grid(500, 100, 9, 3), bag = grid(500, 280, 9, 3), hot = grid(500, 430, 9, 1);
    const rects = [...chest, ...bag, ...hot];
    expect(pickNext(rects, 18 + 4, 'down')).toBe(27 + 4); // bottom chest row -> top bag row
    expect(pickNext(rects, 27 + 4, 'up')).toBe(18 + 4);
    expect(pickNext(rects, 27 + 18 + 2, 'down')).toBe(27 + 27 + 2);
  });

  it('a furnace (input over fuel, output on the right) is a small cross of slots', () => {
    const rects = [{ x: 300, y: 100, w: 44, h: 44 }, { x: 300, y: 190, w: 44, h: 44 }, { x: 420, y: 145, w: 44, h: 44 }, ...grid(200, 300, 9, 3)];
    expect(pickNext(rects, 0, 'down')).toBe(1); // input -> fuel
    expect(pickNext(rects, 1, 'up')).toBe(0);
    expect(pickNext(rects, 0, 'right')).toBe(2); // input -> output
    expect(pickNext(rects, 2, 'left')).toBe(0); // (the nearer of the two in line)
    expect(pickNext(rects, 1, 'down')).toBeGreaterThanOrEqual(3); // fuel -> the bag
  });

  it('a brewing stand: three vials under the ingredient, fuel at the side', () => {
    const rects = [
      { x: 330, y: 100, w: 44, h: 44 }, // 0 ingredient
      { x: 270, y: 190, w: 44, h: 44 }, { x: 330, y: 190, w: 44, h: 44 }, { x: 390, y: 190, w: 44, h: 44 }, // 1..3 vials
      { x: 190, y: 100, w: 44, h: 44 }, // 4 fuel
      ...grid(200, 300, 9, 1),
    ];
    expect(pickNext(rects, 0, 'down')).toBe(2);
    expect(pickNext(rects, 2, 'up')).toBe(0);
    expect(pickNext(rects, 2, 'left')).toBe(1);
    expect(pickNext(rects, 2, 'right')).toBe(3);
    expect(pickNext(rects, 0, 'left')).toBe(4);
    expect(pickNext(rects, 4, 'left')).toBe(-1);
  });
});

describe('focus order and where the cursor starts', () => {
  it('starts on the flagged slot (the held hotbar slot), else the first one, never on a text field', () => {
    expect(startIndex([{}, {}, { start: true }, {}])).toBe(2);
    expect(startIndex([{}, {}, {}])).toBe(0);
    expect(startIndex([{ input: true }, {}, {}])).toBe(1);
    expect(startIndex([{ input: true, start: true }, {}])).toBe(1);
    expect(startIndex([])).toBe(-1);
  });

  it('the screens with slot grids open with the cursor on a slot (and chat never takes focus)', () => {
    for (const k of ['inventory', 'workbench', 'furnace', 'chest', 'brewing']) expect(AUTOFOCUS_SCREENS.has(k), k).toBe(true);
    for (const k of ['pause', 'trade', 'emotes', 'death', 'sleep']) expect(AUTOFOCUS_SCREENS.has(k), k).toBe(true); // still as before
    expect(AUTOFOCUS_SCREENS.has('chat')).toBe(false);
  });

  it("a crafting screen's cursor starts on its own grid, not the recipe book's checkbox beside it", () => {
    expect(src('src/ui/menuNav.js')).toMatch(/!e\.closest\('\.recipe-book'\)/);
  });

  it('slots are focusable programmatically but not part of the Tab order', () => {
    expect(FOCUSABLE).toContain('.slot[tabindex="-1"]');
    expect(SCREENS).toMatch(/s\.tabIndex = -1; s\.setAttribute\('role', 'button'\)/); // makeSlot
    expect(SCREENS).toMatch(/dataset\.padStart = '1'/); // the held hotbar slot is where the cursor starts
    expect(SCREENS).toMatch(/b\.tabIndex = -1; b\.setAttribute\('role', 'button'\)/); // stonecutter options
  });

  it('every slot says what is in it (a screen reader gets the name and the count)', () => {
    expect(SCREENS).toMatch(/s\.setAttribute\('aria-label', st && ITEMS\[st\.id\]/);
    expect(SCREENS).toMatch(/'Empty slot'/);
  });
});

describe('slot actions: A takes, X splits, Y quick-moves, B closes', () => {
  it('maps pad buttons to mouse presses', () => {
    expect(SLOT_ACTIONS.take).toEqual({ button: 0, shift: false });
    expect(SLOT_ACTIONS.split).toEqual({ button: 2, shift: false });
    expect(SLOT_ACTIONS.quick).toEqual({ button: 0, shift: true });
    expect(slotActionFor(new Set(['PadA']))).toBe('take');
    expect(slotActionFor(new Set(['PadX']))).toBe('split');
    expect(slotActionFor(new Set(['PadY']))).toBe('quick');
    expect(slotActionFor(new Set(['PadB']))).toBeNull();
    expect(slotActionFor(new Set())).toBeNull();
    expect(slotActionFor(new Set(['PadY', 'PadA']))).toBe('take'); // one action per frame
  });

  it('menuIntent carries the slot action, Y, and B / Back for closing', () => {
    const none = { lx: 0, ly: 0 };
    expect(menuIntent(new Set(['PadY']), none, null)).toMatchObject({ quick: true, slot: 'quick', press: false });
    expect(menuIntent(new Set(['PadX']), none, null)).toMatchObject({ pressMany: true, slot: 'split' });
    expect(menuIntent(new Set(['PadA']), none, null)).toMatchObject({ press: true, slot: 'take' });
    expect(menuIntent(new Set(['PadB']), none, null)).toMatchObject({ back: true, slot: null });
    expect(menuIntent(new Set(['PadLeft']), none, null).move).toBe('left');
  });

  it('the keyboard has the same: arrows, Enter / Space, Shift+Enter, X', () => {
    expect(arrowDirection('ArrowLeft')).toBe('left');
    expect(arrowDirection('ArrowDown')).toBe('down');
    expect(arrowDirection('KeyW')).toBeNull();
    expect(slotActionForKey('Enter')).toBe('take');
    expect(slotActionForKey('Space')).toBe('take');
    expect(slotActionForKey('Enter', true)).toBe('quick');
    expect(slotActionForKey('KeyX')).toBe('split');
    expect(slotActionForKey('KeyE')).toBeNull(); // E still closes the inventory
  });

  it('Y does not close the inventory while the cursor is on a slot, but a keyboard E (or the touch Bag button) still does', () => {
    const keys = ['KeyE', 'PadY'];
    expect(inventoryKeyIsSlotAction(keys, new Set(['PadY']))).toBe(true);
    expect(inventoryKeyIsSlotAction(keys, new Set(['KeyE']))).toBe(false);
    expect(inventoryKeyIsSlotAction(keys, new Set(['KeyE', 'PadY']))).toBe(false);
    expect(inventoryKeyIsSlotAction(keys, new Set(['PadY']), true)).toBe(false);
    expect(inventoryKeyIsSlotAction(keys, new Set())).toBe(false);
    expect(inventoryKeyIsSlotAction(['KeyE', 'PadLB'], new Set(['PadLB']))).toBe(false); // a bumper is not a slot button
    expect(SLOT_PAD_BUTTONS).toEqual(['PadA', 'PadX', 'PadY']);
    expect(GAME).toMatch(/inventoryKeyIsSlotAction\(inp\.keys\.inventory, inp\.pressed, inp\.vpressed\.has\('inventory'\)\)/);
  });
});

/** Just enough DOM to drive MenuNav: elements with a rectangle, focus, classes and recorded events. */
function fakeDom(rects, classes = 'slot') {
  const doc = { activeElement: null };
  class FakeMouseEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  class FakeEvent { constructor(type) { this.type = type; } }
  globalThis.document = doc;
  globalThis.MouseEvent = FakeMouseEvent;
  globalThis.Event = FakeEvent;
  const listeners = {};
  const items = rects.map((r, i) => {
    const cl = new Set(classes.split(' '));
    const el = {
      i, tagName: 'DIV', dataset: {}, offsetWidth: r.w, offsetHeight: r.h, events: [],
      classList: { contains: (c) => cl.has(c), add: (c) => cl.add(c), remove: (c) => cl.delete(c) },
      closest: () => null,
      getClientRects: () => [r],
      getBoundingClientRect: () => ({ left: r.x, top: r.y, width: r.w, height: r.h }),
      focus() { doc.activeElement = el; },
      scrollIntoView() {},
      dispatchEvent(e) { el.events.push(e); return true; },
    };
    return el;
  });
  const layer = {
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    contains: (e) => items.includes(e),
    querySelectorAll: () => items,
  };
  return { doc, items, layer, listeners };
}

describe('MenuNav over a slot grid (real code path with a fake DOM)', () => {
  let saved;
  beforeEach(() => { saved = { document: globalThis.document, MouseEvent: globalThis.MouseEvent, Event: globalThis.Event }; });
  afterEach(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } });

  const press = (...codes) => new Set(codes);
  const still = { lx: 0, ly: 0 };

  it('D-pad moves the cursor, the focused slot is ringed (pad-focus) and the ring leaves with the cursor', () => {
    const { doc, items, layer, listeners } = fakeDom(grid(0, 0, 3, 2));
    const nav = new MenuNav(layer);
    items[0].focus();
    nav.frame(press('PadRight'), still);
    expect(doc.activeElement).toBe(items[1]);
    expect(items[1].classList.contains('pad-focus')).toBe(true);
    nav.frame(press('PadDown'), still);
    expect(doc.activeElement).toBe(items[4]);
    nav.frame(press('PadLeft'), still);
    expect(doc.activeElement).toBe(items[3]);
    nav.frame(press('PadLeft'), still); // at the edge: stays
    expect(doc.activeElement).toBe(items[3]);
    for (const f of listeners.focusout || []) f({ target: items[3] });
    expect(items[3].classList.contains('pad-focus')).toBe(false);
  });

  it('A sends a left mousedown, X a right one, Y a shift mousedown, to the slot under the cursor', () => {
    const { items, layer } = fakeDom(grid(0, 0, 3, 1));
    const nav = new MenuNav(layer);
    items[1].focus();
    nav.frame(press('PadA'), still);
    nav.frame(press('PadX'), still);
    nav.frame(press('PadY'), still);
    const downs = items[1].events.filter((e) => e.type === 'mousedown');
    expect(downs.map((e) => [e.button, e.shiftKey])).toEqual([[0, false], [2, false], [0, true]]);
    expect(items[0].events.length + items[2].events.length).toBe(0);
  });

  it('B reports back so the screen closes (and returns the held stack), on a slot as anywhere else', () => {
    const { items, layer } = fakeDom(grid(0, 0, 2, 1));
    const nav = new MenuNav(layer);
    items[0].focus();
    expect(nav.frame(press('PadB'), still)).toBe('back');
    expect(nav.frame(press('PadBack'), still)).toBe('back');
    expect(nav.frame(press('PadA'), still)).toBeNull();
  });

  it('the left stick moves the cursor once per push, not every frame', () => {
    const { doc, items, layer } = fakeDom(grid(0, 0, 4, 1));
    const nav = new MenuNav(layer);
    items[0].focus();
    nav.frame(press(), { lx: 1, ly: 0 });
    expect(doc.activeElement).toBe(items[1]);
    nav.frame(press(), { lx: 1, ly: 0 }); // still held
    expect(doc.activeElement).toBe(items[1]);
    nav.frame(press(), still);
    nav.frame(press(), { lx: 1, ly: 0 });
    expect(doc.activeElement).toBe(items[2]);
  });

  it('keyboard: arrows move, Enter takes, Shift+Enter quick-moves, X splits; the game never sees those keys', () => {
    const { doc, items, layer, listeners } = fakeDom(grid(0, 0, 3, 1));
    const nav = new MenuNav(layer);
    items[0].focus();
    const key = (code, extra = {}) => {
      const e = { code, target: doc.activeElement, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      for (const f of listeners.keydown) f(e);
      return e;
    };
    const right = key('ArrowRight');
    expect(doc.activeElement).toBe(items[1]);
    expect(right.prevented && right.stopped).toBe(true);
    key('Enter');
    key('Enter', { shiftKey: true });
    key('KeyX');
    expect(items[1].events.map((e) => [e.button, e.shiftKey])).toEqual([[0, false], [0, true], [2, false]]);
    const other = key('KeyE'); // not ours: left for the game (it closes the inventory)
    expect(other.prevented || other.stopped).toBe(false);
    const ctrl = key('ArrowLeft', { ctrlKey: true });
    expect(ctrl.stopped).toBe(false);
    expect(nav.onSlot()).toBe(true);
  });
});

describe('the ping beacon on a gamepad: a chord, since every button is taken', () => {
  it('every pad button already has an action, so ping gets "hold Back, press the right bumper"', () => {
    const t = defaultTable();
    const padCodes = Object.values(t).map((r) => r[2]).filter((c) => c && !isChord(c));
    expect(new Set(padCodes).size).toBe(15); // every standard button but Start (always pause) is in use
    expect(t.ping[2]).toBe('PadBack+PadRB');
    expect(isChord(t.ping[2])).toBe(true);
    expect(codeLabel('PadBack+PadRB')).toBe('Back + Right bumper');
  });

  it('survives binding resolution and is listed for the input', () => {
    const table = resolveBindings(null);
    expect(table.ping).toEqual(['KeyB', null, 'PadBack+PadRB']);
    expect(keyLists(table).ping).toContain('PadBack+PadRB');
    expect(ACTIONS.find((a) => a.id === 'ping').def[2]).toBe('PadBack+PadRB');
    // rebinding it to a single button still works, and the chord can be restored by a reset
    const r = setBinding(table, 'ping', 2, 'PadL3');
    expect(r.table.ping[2]).toBe('PadL3');
  });

  it('fires only when the second button goes down while the first is held', () => {
    const chords = ['PadBack+PadRB'];
    let r = applyChords(['PadRB'], new Set(['PadBack', 'PadRB']), chords);
    expect(r.fired).toEqual(['PadBack+PadRB']);
    expect(r.swallow.has('PadRB')).toBe(true); // the bumper does not also change the hotbar slot
    expect(r.swallow.has('PadBack')).toBe(false);
    r = applyChords(['PadRB'], new Set(['PadRB']), chords); // Back not held: a plain bumper press
    expect(r.fired).toEqual([]);
    expect(r.swallow.size).toBe(0);
    r = applyChords(['PadBack'], new Set(['PadBack', 'PadRB']), chords); // the bumper was held first: no chord
    expect(r.fired).toEqual([]);
    r = applyChords(['PadBack', 'PadRB'], new Set(['PadBack', 'PadRB']), chords); // both in one poll
    expect(r.fired).toEqual(['PadBack+PadRB']);
    expect(r.swallow.has('PadBack') && r.swallow.has('PadRB')).toBe(true);
    expect(applyChords(['PadRB'], new Set(['PadBack', 'PadRB']), []).fired).toEqual([]);
  });

  it('Input turns the chord into a press of ping and keeps the bumper from also switching slots', () => {
    const realNav = globalThis.navigator;
    const pad = (codes) => {
      const names = ['PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT', 'PadBack', 'PadStart', 'PadL3', 'PadR3', 'PadUp', 'PadDown', 'PadLeft', 'PadRight'];
      return { connected: true, axes: [0, 0, 0, 0], buttons: names.map((n) => ({ pressed: codes.includes(n), value: codes.includes(n) ? 1 : 0 })) };
    };
    let current = pad([]);
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [current] }, configurable: true });
    const fakeWin = { addEventListener() {} };
    const savedWin = globalThis.window, savedDoc = globalThis.document;
    globalThis.window = fakeWin; globalThis.document = { addEventListener() {} };
    try {
      const inp = new Input({ addEventListener() {} });
      current = pad(['PadBack']);
      inp.beginFrame(0.016); inp.endFrame();
      current = pad(['PadBack', 'PadRB']);
      inp.beginFrame(0.016);
      expect(inp.wasPressed('ping')).toBe(true);
      expect(inp.wasPressed('hotbarNext')).toBe(false);
      inp.endFrame();
      current = pad(['PadBack']);
      inp.beginFrame(0.016);
      expect(inp.is('ping')).toBe(false); // released with the bumper
      inp.endFrame();
      current = pad(['PadRB']);
      inp.beginFrame(0.016);
      expect(inp.wasPressed('hotbarNext')).toBe(true); // a lone bumper still works
      expect(inp.wasPressed('ping')).toBe(false);
    } finally {
      if (realNav === undefined) delete globalThis.navigator; else Object.defineProperty(globalThis, 'navigator', { value: realNav, configurable: true });
      if (savedWin === undefined) delete globalThis.window; else globalThis.window = savedWin;
      if (savedDoc === undefined) delete globalThis.document; else globalThis.document = savedDoc;
    }
  });
});

describe('layout fixes found by looking at the screens', () => {
  it('the slot cursor is a gold ring plus a tint that also shows on a light panel and in high contrast', () => {
    expect(CSS).toMatch(/\.slot\[tabindex\]:focus-visible, \.slot\.pad-focus \{[^}]*outline: 3px solid #ffd34a/);
    expect(CSS).toMatch(/html\.high-contrast \.slot\[tabindex\]:focus-visible/);
  });

  it('explanatory lines under buttons wrap in a column (divided by the large-text zoom) instead of running edge to edge', () => {
    expect(CSS).toMatch(/\.screen p\.sub \{ max-width: min\(460px, calc\(\(100vw - 32px\) \/ var\(--tz, 1\)\)\); text-align: center; \}/);
  });

  it('on a phone in portrait the recipe book goes under the inventory instead of pushing it off screen', () => {
    expect(SCREENS).toMatch(/el\('<div class="cont-row"><\/div>'\)/);
    expect(CSS).toMatch(/@media \(max-width: 760px\) and \(orientation: portrait\) \{\s*\.cont-row \{ flex-direction: column;/);
  });

  it('the status bars share the width of a narrow screen (hearts and hunger icons shrink)', () => {
    expect(CSS).toMatch(/--icon: min\(18px, calc\(\(100vw - 28px\) \/ 20\)\)/);
    expect(CSS).toMatch(/#bars \{ width: max\(calc\(var\(--slot\) \* 9 \+ 8px\), calc\(20 \* \(var\(--icon\) \+ 1px\)\)\); \}/);
  });

  it('full-page menus hide the First Steps card and the milestone card above them, and are darker', () => {
    expect(CSS).toMatch(/body:has\(#screens > \.pause-screen\) :is\(#steps, \.milestone, #skyinfo, #raidbar, #bossbar\) \{ visibility: hidden; \}/);
    expect(CSS).toMatch(/\.pause-screen \{ background: rgba\(6, 6, 14, \.86\); \}/);
  });

  it('every full-page screen (Milestones too) is a pause-screen, so it gets the dark backdrop and the HUD cards stay behind it', () => {
    for (const title of ['Touch controls', 'Controls', 'Accessibility', 'Help', 'Statistics', 'Field Guide', 'Milestones']) {
      expect(SCREENS, title).toMatch(new RegExp(`class="screen pause-screen[^"]*"><h2>${title}\\b`));
    }
  });

  it('a hint card never covers a trade or crafting panel: beside it on a wide screen, hidden where there is no room', () => {
    expect(CSS).toMatch(/body:has\(#screens > \.screen:not\(\.pause-screen\)\) #hint-card \{ top: 8px; bottom: auto; left: auto; right: 8px;/);
    expect(CSS).toMatch(/@media \(max-width: 1100px\), \(max-height: 640px\) \{ body:has\(#screens > \.screen\) #hint-card \{ display: none; \} \}/);
    expect(CSS).toMatch(/html\.large-text body:has\(#screens > \.screen\) #hint-card \{ display: none; \}/);
  });

  it('the touch settings keep the preview buttons under the menu, with a lighter backdrop', () => {
    expect(SCREENS).toMatch(/class="screen pause-screen touch-settings"/);
    expect(CSS).toMatch(/#tc-ui\.preview \{ z-index: 19; \}/);
    expect(CSS).toMatch(/\.pause-screen\.touch-settings \{ background: rgba\(6, 6, 14, \.4\); \}/);
  });

  it('large text and high contrast keep a phone usable: slots shrink with the zoom, buttons keep a margin, trading wraps, guide pictures show', () => {
    expect(CSS).toMatch(/html\.large-text body\.touch-on \.screen \{ --slot: max\(22px, min\(calc\(8\.8vw \/ var\(--tz, 1\)\)/);
    expect(CSS).toMatch(/html\.large-text \.pause-screen > \.btn \{ min-width: min\(300px, calc\(\(100vw - 24px\) \/ var\(--tz, 1\)\)\); \}/);
    expect(CSS).toMatch(/@media \(max-width: 480px\) \{\s*\.trade-level \{ flex-wrap: wrap; \}/);
    expect(CSS).toMatch(/\.price-cue:empty \{ display: none; \}/);
    expect(CSS).toMatch(/html\.high-contrast \.guide-card img \{ background: #fff;/);
  });

  it('the armour column does not touch the bag grid in the inventory', () => {
    expect(SCREENS).toMatch(/class="inv-top-row"/);
    expect(CSS).toMatch(/\.inv-top-row \{[^}]*margin-bottom: 10px;/);
  });

  it('the title screen keeps the splash text off the subtitle on a narrow screen, and checkboxes beside their words', () => {
    expect(CSS).toMatch(/@media \(max-width: 860px\) \{\s*\.title-wrap \{ display: flex; flex-direction: column;/);
    expect(CSS).toMatch(/\.wm-grid label:has\(> input\[type=checkbox\]\) \{ justify-content: flex-start; \}/);
  });

  it('B closing a screen does not also drop the held item that frame', () => {
    expect(GAME).toMatch(/const menuAtStart = this\.ui\.blocking;/);
    expect(GAME).toMatch(/if \(!this\.ui\.blocking && !menuAtStart\) \{\s*const m = inp\.consumeMouse\(\);/);
  });

  it('the gamepad help topic explains the slot cursor and the ping chord', () => {
    const topics = src('src/ui/helpTopics.js');
    expect(topics).toMatch(/gold cursor over the slots: A picks up or puts down a stack, X splits it, Y moves it/);
    expect(topics).toMatch(/hold Back and press the right bumper/);
  });
});
