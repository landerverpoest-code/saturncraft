// Touch controls, the pure part: settings, device detection, the thumbstick maths, the
// gesture classifier for the look area and the hotbar swipe. No DOM in here, so the tests (and
// ui/touch.js, which owns the DOM) share it. The stick reuses the gamepad dead zone so a thumb
// and a gamepad feel the same.
import { applyDeadzone } from './gamepad.js';

export const TOUCH_MODES = ['auto', 'on', 'off'];
export const TOUCH_MODE_LABELS = { auto: 'Auto', on: 'On', off: 'Off' };
export const TOUCH_DEFAULTS = { touchMode: 'auto', touchSize: 100, touchOpacity: 65, touchLeft: false };
export const SIZE_RANGE = [60, 160];
export const OPACITY_RANGE = [20, 100];

/** Thumbstick radius in CSS pixels at 100 % button size. */
export const STICK_RADIUS = 58;
/** Stick dead zone (a little wider than the pad's: thumbs rest, they do not centre). */
export const STICK_DEADZONE = 0.14;
/** Pushing the thumb this many radii from where it landed (and mostly forward) sprints. */
export const SPRINT_RATIO = 1.3;
/** How far from straight ahead (cosine of the angle) the push may be and still sprint. */
export const SPRINT_FORWARD = 0.5;
/** Pixels of finger travel before a touch in the look area is a drag rather than a tap or hold. */
export const TAP_SLOP = 10;
/** A press this long without travelling is a hold (mine), a shorter one is a tap (a single swing). */
export const HOLD_MS = 280;
/** Look drag gain: mouse-pixel equivalents per finger pixel (the sensitivity setting scales it further). */
export const LOOK_GAIN = 1.7;
/** Share of the screen width (from the stick's side) in which a touch becomes the thumbstick. */
export const STICK_ZONE = 0.42;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Should touch controls be on? `mode` is 'auto' | 'on' | 'off'; `detected` is what the device looks like. */
export function resolveTouchMode(mode, detected) {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return !!detected;
}

/**
 * Does this look like a touch-first device? env: { maxTouchPoints, coarse (primary pointer is coarse),
 * canHover (primary input can hover) }. A touch laptop (fine pointer, hover) stays a desktop.
 */
export function detectTouch(env) {
  if (!env || !(env.maxTouchPoints > 0)) return false;
  if (env.coarse === undefined) return true; // no media queries: trust the touch points
  return !!env.coarse && !env.canHover;
}

/** `?touch=1` / `?touch=0` in the URL forces the controls on / off for that visit (not saved). Returns 'on' | 'off' | null. */
export function touchModeFromQuery(search) {
  const m = /[?&]touch=([^&#]*)/.exec(search || '');
  if (!m) return null;
  if (m[1] === '1' || m[1] === 'on') return 'on';
  if (m[1] === '0' || m[1] === 'off') return 'off';
  return null;
}

/** Final answer: are touch controls wanted for these settings, URL query and device? */
export function wantTouch(settings, search, env) {
  const mode = touchModeFromQuery(search) || normalizeTouch(settings).touchMode;
  return resolveTouchMode(mode, detectTouch(env));
}

/** Reads the real environment (browser only). */
export function readTouchEnv() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const mm = typeof matchMedia === 'function' ? (q) => matchMedia(q).matches : null;
  return { maxTouchPoints: nav.maxTouchPoints || 0, coarse: mm ? mm('(pointer: coarse)') : undefined, canHover: mm ? mm('(hover: hover)') : false };
}

/** Sanitised touch settings: unknown mode -> 'auto', size / opacity clamped, the rest booleans. */
export function normalizeTouch(s) {
  const o = s || {};
  const num = (v, d, [lo, hi]) => (Number.isFinite(+v) && v !== null && v !== '' ? clamp(Math.round(+v), lo, hi) : d);
  return {
    touchMode: TOUCH_MODES.includes(o.touchMode) ? o.touchMode : TOUCH_DEFAULTS.touchMode,
    touchSize: num(o.touchSize, TOUCH_DEFAULTS.touchSize, SIZE_RANGE),
    touchOpacity: num(o.touchOpacity, TOUCH_DEFAULTS.touchOpacity, OPACITY_RANGE),
    touchLeft: !!o.touchLeft,
  };
}

/** Next mode when the setting button is pressed. */
export function nextTouchMode(mode) { return TOUCH_MODES[(Math.max(0, TOUCH_MODES.indexOf(mode)) + 1) % TOUCH_MODES.length]; }

/**
 * The thumbstick for a thumb at offset (dx, dy) pixels from where it landed. Returns
 * { x, y, sprint, held }: x / y in -1..1 with the dead zone removed and y negative for "up" (the same
 * convention as the gamepad stick, so input.js adds both), sprint when pushed well past the rim
 * and mostly forward, held = the thumb is outside the dead zone.
 */
export function stickVector(dx, dy, radius = STICK_RADIUS) {
  const r = radius > 0 ? radius : STICK_RADIUS;
  const nx = dx / r, ny = dy / r;
  const raw = Math.hypot(nx, ny);
  const k = raw > 1 ? 1 / raw : 1;
  const [x, y] = applyDeadzone(nx * k, ny * k, STICK_DEADZONE);
  const held = x !== 0 || y !== 0;
  const forward = raw > 0 ? -ny / raw : 0;
  const sprint = held && raw >= SPRINT_RATIO && forward >= SPRINT_FORWARD;
  return { x, y, sprint, held };
}

/** Where the stick knob is drawn: the thumb offset kept inside the rim. */
export function knobOffset(dx, dy, radius = STICK_RADIUS) {
  const len = Math.hypot(dx, dy);
  if (len <= radius || len === 0) return { x: dx, y: dy };
  return { x: (dx / len) * radius, y: (dy / len) * radius };
}

/** Is a touch at (x, y) in a w x h screen inside the thumbstick's zone? Left-handed play mirrors it. */
export function inStickZone(x, y, w, h, leftHanded = false) {
  if (y < h * 0.18) return false; // keep the top strip for the buttons
  return leftHanded ? x > w * (1 - STICK_ZONE) : x < w * STICK_ZONE;
}

/**
 * What a touch in the look area has become so far. travel = pixels moved since it landed,
 * duration = ms since it landed, released = the finger came up.
 * 'drag' (turning the view), 'hold' (mine), 'tap' (one swing, only once released) or 'pending'.
 */
export function classifyGesture({ travel, duration, released = false }) {
  if (travel > TAP_SLOP) return 'drag';
  if (duration >= HOLD_MS) return 'hold';
  return released ? 'tap' : 'pending';
}

/** A look drag as mouse-movement pixels (ui/input.js multiplies by the sensitivity setting, like for the mouse). */
export function lookDelta(dx, dy, gain = LOOK_GAIN) { return { dx: dx * gain, dy: dy * gain }; }

/** Hotbar swipe: the slot (0..8) selected after sliding the finger dx pixels from slot `start`. */
export function swipeSlot(start, dx, slotWidth) {
  if (!(slotWidth > 0)) return clamp(start, 0, 8);
  return clamp(start + Math.round(dx / slotWidth), 0, 8);
}

/** Which hotbar slot (0..8) is under x, given the bar's left edge and the slot pitch? -1 outside. */
export function hotbarIndexAt(x, left, pitch) {
  if (!(pitch > 0)) return -1;
  const i = Math.floor((x - left) / pitch);
  return i >= 0 && i < 9 ? i : -1;
}

/** Scale factor for the on-screen buttons from the size setting (100 = 1). */
export function buttonScale(size) { return clamp(Math.round(+size || 100), SIZE_RANGE[0], SIZE_RANGE[1]) / 100; }
/** Opacity 0..1 for the controls from the setting. */
export function controlOpacity(op) { return clamp(Math.round(+op || TOUCH_DEFAULTS.touchOpacity), OPACITY_RANGE[0], OPACITY_RANGE[1]) / 100; }

/** Screens whose Close / Split / Quick-move tools make no sense (they have their own buttons). */
export const NO_TOOLS = new Set(['pause', 'death', 'sleep']);
/** Which screens get the touch tools bar: any open screen but those. */
export function toolsFor(open, hasSlots) {
  if (!open || NO_TOOLS.has(open)) return { close: false, slots: false };
  return { close: true, slots: !!hasSlots && open !== 'chat' };
}
