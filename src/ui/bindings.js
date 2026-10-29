// Rebindable controls. Every action has three slots: a main key, a spare key and
// a gamepad button. Players only store what they changed (the "overrides"); the
// table everything else reads is `resolveBindings(overrides)`.
//
// Codes are KeyboardEvent.code values ("KeyW", "Space", "F3") for the key slots and
// "Pad..." names (ui/gamepad.js) for the button slot. The mouse buttons, the wheel and
// Escape / the Start button (pause) are fixed; they are never offered for rebinding.

export const SLOT_KINDS = ['key', 'key', 'pad'];
export const SLOT_NAMES = ['Key', 'Spare key', 'Gamepad'];

/** Codes no action may use: they always mean "pause" (and would trap the player in the menu). */
export const RESERVED = ['Escape', 'PadStart'];

/** [main key, spare key, gamepad button] defaults, in the order the controls screen lists them. */
export const ACTIONS = [
  { id: 'forward', label: 'Walk forward', group: 'Movement', def: ['KeyW', 'ArrowUp', null] },
  { id: 'back', label: 'Walk backward', group: 'Movement', def: ['KeyS', 'ArrowDown', null] },
  { id: 'left', label: 'Strafe left', group: 'Movement', def: ['KeyA', 'ArrowLeft', null] },
  { id: 'right', label: 'Strafe right', group: 'Movement', def: ['KeyD', 'ArrowRight', null] },
  { id: 'jump', label: 'Jump / swim up', group: 'Movement', def: ['Space', null, 'PadA'] },
  { id: 'sneak', label: 'Sneak', group: 'Movement', def: ['ShiftLeft', 'ShiftRight', 'PadR3'] },
  { id: 'sprint', label: 'Sprint', group: 'Movement', def: ['ControlLeft', 'KeyR', 'PadL3'] },
  { id: 'crawl', label: 'Crawl', group: 'Movement', def: ['KeyC', null, 'PadDown'] },
  { id: 'attack', label: 'Attack / mine', group: 'Actions', def: [null, null, 'PadRT'] },
  { id: 'use', label: 'Use / place', group: 'Actions', def: [null, null, 'PadLT'] },
  { id: 'inventory', label: 'Inventory', group: 'Actions', def: ['KeyE', null, 'PadY'] },
  { id: 'drop', label: 'Drop item', group: 'Actions', def: ['KeyQ', null, 'PadB'] },
  { id: 'hotbarPrev', label: 'Previous hotbar slot', group: 'Actions', def: [null, null, 'PadLB'] },
  { id: 'hotbarNext', label: 'Next hotbar slot', group: 'Actions', def: [null, null, 'PadRB'] },
  { id: 'chat', label: 'Open chat', group: 'Interface', def: ['KeyT', null, null] },
  { id: 'command', label: 'Open chat with /', group: 'Interface', def: ['Slash', null, null] },
  { id: 'perspective', label: 'Change camera', group: 'Interface', def: ['F5', null, 'PadUp'] },
  { id: 'hud', label: 'Hide / show HUD', group: 'Interface', def: ['F1', null, null] },
  { id: 'debug', label: 'Debug screen', group: 'Interface', def: ['F3', null, null] },
  { id: 'shaders', label: 'Shaders on / off', group: 'Interface', def: ['F7', null, null] },
  ...Array.from({ length: 9 }, (_, i) => ({ id: 'slot' + (i + 1), label: 'Hotbar slot ' + (i + 1), group: 'Hotbar', def: ['Digit' + (i + 1), null, null] })),
];
export const ACTION_IDS = ACTIONS.map((a) => a.id);
export const GROUPS = [...new Set(ACTIONS.map((a) => a.group))];

/** Always-on bindings that are not listed in the controls screen. */
export const FIXED = { pause: ['Escape', 'PadStart'] };

/** 'pad' for gamepad button codes, otherwise 'key'. */
export function codeKind(code) { return typeof code === 'string' && code.startsWith('Pad') ? 'pad' : 'key'; }

/** The defaults as a fresh {action: [k1, k2, pad]} table. */
export function defaultTable() {
  const t = {};
  for (const a of ACTIONS) t[a.id] = [...a.def];
  return t;
}

const valid = (code, kind) => typeof code === 'string' && code.length > 0 && code.length < 24 && codeKind(code) === kind && !RESERVED.includes(code);

/**
 * Merge saved overrides ({action: [k1, k2, pad]}, any slot may be null = unbound) over the defaults.
 * Unknown actions, wrong shapes and codes of the wrong kind are ignored, and a code can never sit
 * in two places: the first action in list order keeps it.
 */
export function resolveBindings(overrides) {
  const t = defaultTable();
  if (overrides && typeof overrides === 'object') {
    for (const id of ACTION_IDS) {
      const o = overrides[id];
      if (!Array.isArray(o)) continue;
      for (let s = 0; s < 3; s++) {
        if (o[s] === null) t[id][s] = null;
        else if (valid(o[s], SLOT_KINDS[s])) t[id][s] = o[s];
      }
    }
  }
  const seen = new Set();
  for (const id of ACTION_IDS) {
    for (let s = 0; s < 3; s++) {
      const c = t[id][s];
      if (c === null) continue;
      if (seen.has(c)) t[id][s] = null; else seen.add(c);
    }
  }
  return t;
}

/** Only the slots that differ from the defaults (what gets saved). */
export function toOverrides(table) {
  const out = {};
  for (const a of ACTIONS) {
    const row = table[a.id];
    if (row && row.some((c, s) => c !== a.def[s])) out[a.id] = [...row];
  }
  return out;
}

/** Which action and slot holds this code? */
export function findBinding(table, code, except = null) {
  for (const id of ACTION_IDS) {
    for (let s = 0; s < 3; s++) {
      if (table[id][s] === code && !(except && except.id === id && except.slot === s)) return { id, slot: s };
    }
  }
  return null;
}

/**
 * Put `code` (or null to unbind) into one slot. A code that is already used elsewhere swaps places
 * with the slot's old code, so nothing is left unbound by accident. Returns
 * { table, swapped: {id, slot} | null } or { error } (wrong kind of code, or a reserved one).
 */
export function setBinding(table, id, slot, code) {
  const row = table[id];
  if (!row || !(slot >= 0 && slot < 3)) return { error: 'No such control' };
  const next = {};
  for (const k of ACTION_IDS) next[k] = [...table[k]];
  if (code === null) { next[id][slot] = null; return { table: next, swapped: null }; }
  if (RESERVED.includes(code)) return { error: code === 'Escape' || code === 'PadStart' ? 'That one always pauses the game' : 'Reserved' };
  if (codeKind(code) !== SLOT_KINDS[slot]) return { error: SLOT_KINDS[slot] === 'pad' ? 'Press a gamepad button for this slot' : 'Press a keyboard key for this slot' };
  const old = next[id][slot];
  if (old === code) return { table: next, swapped: null };
  const other = findBinding(next, code, { id, slot });
  next[id][slot] = code;
  let swapped = null;
  if (other) { next[other.id][other.slot] = old; swapped = other; }
  return { table: next, swapped };
}

/** {action: [codes...]} with unbound slots dropped, plus the fixed pause keys: what the input reads. */
export function keyLists(table) {
  const out = {};
  for (const id of ACTION_IDS) out[id] = table[id].filter(Boolean);
  for (const [id, codes] of Object.entries(FIXED)) out[id] = [...codes];
  return out;
}

const NAMED = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home',
  PageUp: 'Page Up', PageDown: 'Page Down', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt',
  CapsLock: 'Caps Lock', Slash: '/', Backslash: '\\', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /',
  NumpadEnter: 'Num Enter', NumpadDecimal: 'Num .', ContextMenu: 'Menu', IntlBackslash: '<',
};
const PAD_NAMES = {
  PadA: 'A', PadB: 'B', PadX: 'X', PadY: 'Y', PadLB: 'Left bumper', PadRB: 'Right bumper', PadLT: 'Left trigger', PadRT: 'Right trigger',
  PadBack: 'Back', PadStart: 'Start', PadL3: 'Left stick click', PadR3: 'Right stick click',
  PadUp: 'D-pad up', PadDown: 'D-pad down', PadLeft: 'D-pad left', PadRight: 'D-pad right',
};

/** A short name a player recognises for a code ("KeyW" -> "W", "PadRT" -> "Right trigger"). */
export function codeLabel(code) {
  if (!code) return 'Unbound';
  if (PAD_NAMES[code]) return PAD_NAMES[code];
  if (NAMED[code]) return NAMED[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return 'Num ' + m[1];
  if (/^F\d{1,2}$/.test(code)) return code;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}
