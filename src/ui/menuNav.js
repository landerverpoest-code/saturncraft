// Menu navigation without a mouse. Keyboard users get the browser's own Tab order (see Input: Tab and Space are
// only swallowed while playing); this adds what a gamepad needs - the D-pad or left stick moves focus to the
// nearest control in that direction, A presses it, X presses it "with Shift" (trade as often as you can afford),
// B goes back - plus the roles and labels a screen reader needs on the screens built in ui/screens.js.
// The geometry (pickNext, stickDirection) is pure so the tests can run it without a DOM.

/** Elements a menu can focus, in the order the browser would Tab through them. */
export const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), .slot[tabindex="-1"]';

// ---- slot grids (inventory, chests, crafting, furnace, brewing, ...) -------------------------------------------------
// Every slot is focusable (tabindex -1, so the Tab key keeps its own order) and the D-pad moves a cursor over them with the same
// nearest-in-that-direction rule as the buttons. On a slot the pad buttons mean what a mouse button does there:
//   A takes the stack / puts it down (left click)      X splits it, or puts down one (right click)
//   Y quick-moves it (Shift-click)                      B closes the screen (the held stack goes back to the bag)
// The keyboard has the same: arrows move, Enter or Space is A, Shift+Enter is Y, X or the menu key is X.

/** What each slot action sends to a slot as a mousedown: { button, shift }. */
export const SLOT_ACTIONS = {
  take: { button: 0, shift: false },
  split: { button: 2, shift: false },
  quick: { button: 0, shift: true },
};
/** Pad buttons that mean a slot action while the cursor is on a slot. */
export const SLOT_PAD_BUTTONS = ['PadA', 'PadX', 'PadY'];

/** Which slot action a set of pressed pad codes asks for ('take' | 'split' | 'quick'), or null. A wins over X over Y when several arrive together. */
export function slotActionFor(pressed) {
  if (pressed.has('PadA')) return 'take';
  if (pressed.has('PadX')) return 'split';
  if (pressed.has('PadY')) return 'quick';
  return null;
}

/** Which slot action a key on a focused slot asks for: Enter / Space take (with Shift: quick-move), X or the menu key split. */
export function slotActionForKey(code, shift = false) {
  if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') return shift ? 'quick' : 'take';
  if (code === 'KeyX' || code === 'ContextMenu') return 'split';
  return null;
}

/** The direction an arrow key moves a cursor ('up' | 'down' | 'left' | 'right'), or null. */
export function arrowDirection(code) {
  return code === 'ArrowUp' ? 'up' : code === 'ArrowDown' ? 'down' : code === 'ArrowLeft' ? 'left' : code === 'ArrowRight' ? 'right' : null;
}

/**
 * Did the inventory key come only from a pad button the slot cursor needs (A, X or Y by default Y)? Then the screen is
 * not closed by it: with a cursor on a slot, Y quick-moves and B closes. `keyCodes`: the codes bound to the inventory action;
 * `pressed`: codes pressed this frame; `touched`: the touch button was pressed.
 */
export function inventoryKeyIsSlotAction(keyCodes, pressed, touched = false) {
  if (touched) return false;
  const hits = keyCodes.filter((c) => pressed.has(c));
  return hits.length > 0 && hits.every((c) => SLOT_PAD_BUTTONS.includes(c));
}

/**
 * The element a freshly opened slot screen starts its cursor on: one flagged `data-pad-start` (the inventory flags the selected
 * hotbar slot), else the first focusable in the order the screen lists them. `items`: [{ start: bool, input: bool }].
 */
export function startIndex(items) {
  let first = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i].input) continue;
    if (items[i].start) return i;
    if (first < 0) first = i;
  }
  return first;
}

/** Index of the slot in a row-major grid (`cols` wide) one step in `dir` from `i`, or -1 at the edge (no wrapping). The pure form of the D-pad over one grid. */
export function gridStep(i, cols, total, dir) {
  const r = Math.floor(i / cols), c = i % cols;
  let n = i;
  if (dir === 'left') n = c > 0 ? i - 1 : -1;
  else if (dir === 'right') n = c < cols - 1 ? i + 1 : -1;
  else if (dir === 'up') n = r > 0 ? i - cols : -1;
  else if (dir === 'down') n = i + cols < total ? i + cols : -1;
  return n >= 0 && n < total ? n : -1;
}

/**
 * The index of the rectangle to move focus to from rectangle `from` in direction 'up' | 'down' | 'left' |
 * 'right', or -1 when nothing lies that way. Candidates must be mostly in that direction; the nearest wins
 * (distance along the direction plus twice the sideways gap, so a control straight ahead beats a closer one off to the side).
 * rects: [{ x, y, w, h }].
 */
export function pickNext(rects, from, dir) {
  const r = rects[from];
  if (!r) return rects.length ? 0 : -1;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const vertical = dir === 'up' || dir === 'down';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  // sideways distance is the gap between the two controls' extents (0 when they overlap, as a full-width button does with
  // the half-width ones above it), so a control in line is never skipped for one further along
  const span = vertical ? r.w : r.h; // (only the middle half of each extent counts, so controls that merely touch corner to corner are not 'in line')
  const lo = (vertical ? r.x : r.y) + span / 4, hi = lo + span / 2;
  let best = -1, bestScore = Infinity;
  rects.forEach((o, i) => {
    if (i === from) return;
    const dx = o.x + o.w / 2 - cx, dy = o.y + o.h / 2 - cy;
    const along = (vertical ? dy : dx) * sign, centre = Math.abs(vertical ? dx : dy);
    const ospan = vertical ? o.w : o.h, olo = (vertical ? o.x : o.y) + ospan / 4, ohi = olo + ospan / 2;
    const gap = Math.max(0, olo - hi, lo - ohi);
    if (along <= 1 || along < centre * 0.35) return; // behind, level with, or mostly sideways
    const score = along + gap * 2 + centre * 0.05;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

export const STICK_PUSH = 0.6;
/** The direction a stick is pushed far enough to count as a D-pad press, or null. */
export function stickDirection(lx, ly) {
  if (Math.hypot(lx, ly) < STICK_PUSH) return null;
  if (Math.abs(ly) >= Math.abs(lx)) return ly < 0 ? 'up' : 'down';
  return lx < 0 ? 'left' : 'right';
}

/**
 * What a frame of gamepad input asks of the menu: { move: dir|null, press: bool, pressMany: bool, back: bool }.
 * `pressed` is the set of pad codes pressed this frame (input.pressed), `pad` the stick values, `prevStick` the
 * direction the stick was already held in (so a held push moves once).
 */
export function menuIntent(pressed, pad, prevStick) {
  const stick = stickDirection(pad ? pad.lx : 0, pad ? pad.ly : 0);
  let move = null;
  if (pressed.has('PadUp')) move = 'up';
  else if (pressed.has('PadDown')) move = 'down';
  else if (pressed.has('PadLeft')) move = 'left';
  else if (pressed.has('PadRight')) move = 'right';
  else if (stick && stick !== prevStick) move = stick;
  return { move, stick, press: pressed.has('PadA'), pressMany: pressed.has('PadX'), quick: pressed.has('PadY'), slot: slotActionFor(pressed), back: pressed.has('PadB') || pressed.has('PadBack') };
}

/** Controls that are currently shown (a hidden or collapsed one cannot take focus). */
export function visibleFocusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((e) => !e.closest('.hidden') && (e.offsetWidth > 0 || e.offsetHeight > 0 || e.getClientRects().length > 0));
}

/** Step a range input by `dir` ('left' / 'right'), firing the same events a drag would. */
export function stepRange(input, dir) {
  const step = +input.step || 1, min = input.min === '' ? 0 : +input.min, max = input.max === '' ? 100 : +input.max;
  const v = Math.max(min, Math.min(max, +input.value + (dir === 'right' ? step : -step)));
  if (v === +input.value) return false;
  input.value = String(v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

/** Screens that open with focus on their first control, so keyboard and gamepad users start somewhere. */
export const AUTOFOCUS_SCREENS = new Set(['pause', 'trade', 'emotes', 'death', 'sleep', 'inventory', 'workbench', 'furnace', 'chest', 'brewing']);

let uid = 0;
/**
 * Give the screens in `root` the roles a screen reader expects: a dialog named by its heading, sliders and
 * toggles named by their label, progress bars with values. Safe to run again on the same content.
 */
export function labelScreens(root) {
  for (const s of root.querySelectorAll('.screen')) {
    if (s.getAttribute('role')) continue;
    s.setAttribute('role', 'dialog');
    s.setAttribute('aria-modal', 'true');
    const h = s.querySelector('h1, h2');
    if (h) { if (!h.id) h.id = 'dlg-title-' + (++uid); s.setAttribute('aria-labelledby', h.id); }
  }
  for (const f of root.querySelectorAll('.field')) {
    const label = f.querySelector('label');
    const input = f.querySelector('input[type=range], input[type=text], select');
    if (!label || !input || input.getAttribute('aria-labelledby') || input.getAttribute('aria-label') || (input.id && f.querySelector(`label[for="${input.id}"]`))) continue;
    if (!label.id) label.id = 'lbl-' + (++uid);
    input.setAttribute('aria-labelledby', label.id);
  }
}

/**
 * Drives focus in the open screen from gamepad input. `layer` is the element holding the screens;
 * `ui` supplies `open`, `padBack`, `padScroll` and the actions it calls.
 */
export class MenuNav {
  constructor(layer) {
    this.layer = layer;
    this.stick = null;
    this.padFocused = null;
    layer.addEventListener('focusout', (e) => { if (e.target.classList) e.target.classList.remove('pad-focus'); });
    // the keyboard on a slot: arrows move the cursor, Enter / Space / X act on it (the game's own key handling never sees them)
    layer.addEventListener('keydown', (e) => {
      if (!e.target.classList || !e.target.classList.contains('slot') || e.ctrlKey || e.altKey || e.metaKey) return;
      const dir = arrowDirection(e.code), act = slotActionForKey(e.code, e.shiftKey);
      if (!dir && !act) return;
      e.preventDefault(); e.stopPropagation();
      if (dir) this.move(dir); else this.slotPress(act);
    });
  }

  /** Focus the first control of a freshly opened screen unless something inside already has focus. */
  autoFocus() {
    if (this.layer.contains(document.activeElement) && document.activeElement !== this.layer) return false;
    // (the recipe book beside a crafting screen is reached with the D-pad, but the cursor starts on the screen's own first control or slot)
    const list = visibleFocusables(this.layer).filter((e) => !(e.tagName === 'INPUT' && (e.type === 'text' || e.type === 'search')) && !e.closest('.recipe-book'));
    if (!list.length) return false;
    const at = startIndex(list.map((e) => ({ start: e.dataset && e.dataset.padStart !== undefined || e.classList.contains('sel') })));
    list[at < 0 ? 0 : at].focus({ preventScroll: true }); // (a long screen stays scrolled to its top: the first control or slot is not always the one in view)
    return true;
  }

  current() {
    const a = document.activeElement;
    return a && this.layer.contains(a) ? a : null;
  }

  focusEl(el) {
    el.classList.add('pad-focus');
    try { el.focus({ focusVisible: true }); } catch { el.focus(); }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** Move focus one control in `dir`. Returns true when focus moved. */
  move(dir) {
    const list = visibleFocusables(this.layer);
    if (!list.length) return false;
    const cur = this.current();
    const from = cur ? list.indexOf(cur) : -1;
    const el = cur && cur.tagName === 'INPUT' && cur.type === 'range' && (dir === 'left' || dir === 'right') ? cur : null;
    if (el) return stepRange(el, dir);
    if (from < 0) { this.focusEl(list[0]); return true; }
    const rects = list.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const to = pickNext(rects, from, dir);
    if (to < 0) return false;
    this.focusEl(list[to]);
    return true;
  }

  /** Is the cursor on a slot? */
  onSlot() {
    const el = this.current();
    return !!(el && el.classList.contains('slot'));
  }

  /** Do a slot action ('take' | 'split' | 'quick') on the slot under the cursor: the mouse press that does the same. */
  slotPress(action) {
    const el = this.current(), a = SLOT_ACTIONS[action];
    if (!el || !a || !el.classList.contains('slot')) return false;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: a.button, shiftKey: a.shift }));
    return true;
  }

  /** Press the focused control (`many`: as a Shift-click, e.g. trade as often as affordable). */
  press(many = false) {
    const el = this.current();
    if (!el) return false;
    if (el.classList.contains('slot')) return this.slotPress(many ? 'quick' : 'take');
    if (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'text' || el.type === 'search')) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: many }));
    return true;
  }

  /**
   * One frame. Returns 'back' when B / Back was pressed (the caller closes or returns), else null.
   * Does nothing while a text field has focus, so typing is never hijacked. `noMove`: the screen scrolls with the D-pad itself.
   */
  frame(pressed, pad, noMove = false) {
    const a = document.activeElement;
    const typing = a && this.layer.contains(a) && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && (a.type === 'text' || a.type === 'search')));
    const it = menuIntent(pressed, pad, this.stick);
    this.stick = it.stick;
    if (it.back) return 'back';
    if (typing) return null;
    if (it.move && !noMove) this.move(it.move);
    if (this.onSlot()) { if (it.slot) this.slotPress(it.slot); return null; }
    if (it.press || it.pressMany) this.press(it.pressMany);
    return null;
  }
}
