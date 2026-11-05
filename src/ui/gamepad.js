// Gamepad support: turns the browser's Gamepad snapshot (standard mapping) into the same
// pseudo key codes the keyboard bindings use ("PadA", "PadRT", ...), plus two analog sticks.
// Pure functions only; ui/input.js polls navigator.getGamepads() and feeds them in.

/** Standard-mapping button index -> code. */
export const PAD_BUTTONS = [
  'PadA', 'PadB', 'PadX', 'PadY', 'PadLB', 'PadRB', 'PadLT', 'PadRT',
  'PadBack', 'PadStart', 'PadL3', 'PadR3', 'PadUp', 'PadDown', 'PadLeft', 'PadRight',
];

export const STICK_DEADZONE = 0.18;
export const TRIGGER_THRESHOLD = 0.35;
/** Look speed at 100 % mouse sensitivity, in radians per second at full stick deflection. */
export const LOOK_RATE = 3.1;
/** Radians per mouse pixel at 100 % sensitivity (the same constant game.js uses). */
export const MOUSE_RAD_PER_PX = 0.0022;

/**
 * Radial dead zone with the live range rescaled to 0..1 so there is no jump when the stick
 * leaves the zone. Returns [x, y].
 */
export function applyDeadzone(x, y, dz = STICK_DEADZONE) {
  const len = Math.hypot(x, y);
  if (!(len > dz)) return [0, 0];
  const scaled = Math.min(1, (len - dz) / (1 - dz));
  return [(x / len) * scaled, (y / len) * scaled];
}

/** A response curve that keeps small movements precise: output = |v|^1.6 with the sign kept. */
export function lookCurve(v) { return Math.sign(v) * Math.pow(Math.abs(v), 1.6); }

/**
 * Reads a Gamepad-like object ({buttons: [{pressed, value}], axes: []}) into
 * { buttons: Set of codes, lx, ly, rx, ry } with dead zones applied. Returns null for no pad.
 */
export function readPad(pad) {
  if (!pad || !pad.buttons) return null;
  const buttons = new Set();
  for (let i = 0; i < PAD_BUTTONS.length && i < pad.buttons.length; i++) {
    const b = pad.buttons[i];
    if (!b) continue;
    const analog = i === 6 || i === 7;
    if (analog ? (b.value ?? (b.pressed ? 1 : 0)) > TRIGGER_THRESHOLD : b.pressed) buttons.add(PAD_BUTTONS[i]);
  }
  const ax = pad.axes || [];
  const [lx, ly] = applyDeadzone(ax[0] || 0, ax[1] || 0);
  const [rx, ry] = applyDeadzone(ax[2] || 0, ax[3] || 0);
  return { buttons, lx, ly, rx, ry };
}

/**
 * The right stick as mouse-movement pixels for this frame, so the usual sensitivity setting (and the
 * steadier aim through a Farglass) apply to it too. At 100 % sensitivity, full deflection turns
 * LOOK_RATE radians per second. Positive dx turns right, positive dy looks down.
 */
export function lookPixels(rx, ry, dt) {
  const k = (LOOK_RATE / MOUSE_RAD_PER_PX) * dt;
  return { dx: lookCurve(rx) * k, dy: lookCurve(ry) * k };
}

/**
 * Diff two button sets: which codes went down and which came up since the last poll.
 */
export function buttonEdges(prev, cur) {
  const down = [], up = [];
  for (const c of cur) if (!prev.has(c)) down.push(c);
  for (const c of prev) if (!cur.has(c)) up.push(c);
  return { down, up };
}

/** The first connected pad in a navigator.getGamepads() style list, or null. */
export function firstPad(list) {
  if (!list) return null;
  for (const p of list) if (p && p.connected !== false && p.buttons && p.buttons.length >= 4) return p;
  return null;
}

/**
 * Chords: a code of two pad buttons joined by "+" ("PadBack+PadRB"): hold the first, press the second. Every button on the
 * pad already means something, so a chord gives an action (pinging a spot for the team) a place without taking one away.
 */
export function isChord(code) { return typeof code === 'string' && code.includes('+'); }

/**
 * Which chords did this poll complete, and which buttons they used up? `down`: codes that went down since the last poll,
 * `held`: every code now held, `chords`: the chord codes that are bound. A chord fires when its second button goes down
 * while its first is held (or both go down together); the second button then does not also act on its own (the first was
 * already down, so its own action has happened). Returns { fired: [chord codes], swallow: Set of codes to ignore }.
 */
export function applyChords(down, held, chords) {
  const fired = [], swallow = new Set();
  for (const ch of chords) {
    const [a, b] = ch.split('+');
    if (!a || !b || a === b) continue;
    const bNew = down.includes(b), aNew = down.includes(a);
    if (!bNew || !(held.has(a) || aNew) || !held.has(b)) continue;
    fired.push(ch);
    swallow.add(b);
    if (aNew) swallow.add(a);
  }
  return { fired, swallow };
}
