import { describe, it, expect } from 'vitest';
import {
  TOUCH_DEFAULTS, TOUCH_MODES, SIZE_RANGE, OPACITY_RANGE, STICK_RADIUS, STICK_DEADZONE, SPRINT_RATIO, TAP_SLOP, HOLD_MS, LOOK_GAIN,
  resolveTouchMode, detectTouch, normalizeTouch, nextTouchMode, touchModeFromQuery, wantTouch, stickVector, knobOffset, inStickZone,
  classifyGesture, lookDelta, swipeSlot, hotbarIndexAt, buttonScale, controlOpacity, toolsFor,
} from '../src/ui/touchMath.js';
import { Input } from '../src/ui/input.js';
import { DEFAULT_SETTINGS } from '../src/game.js';
import { MOUSE_RAD_PER_PX } from '../src/ui/gamepad.js';

/** An Input without a browser: the constructor only needs somewhere to hang listeners. */
function makeInput() {
  const noop = () => {};
  const g = globalThis;
  const keep = { window: g.window, document: g.document };
  g.window = { addEventListener: noop };
  g.document = { addEventListener: noop, pointerLockElement: null };
  try { return new Input({ addEventListener: noop }); } finally { g.window = keep.window; g.document = keep.document; if (keep.window === undefined) delete g.window; if (keep.document === undefined) delete g.document; }
}

describe('touch settings', () => {
  it('has defaults that are part of the game settings', () => {
    for (const k of Object.keys(TOUCH_DEFAULTS)) expect(DEFAULT_SETTINGS[k]).toEqual(TOUCH_DEFAULTS[k]);
    expect(TOUCH_DEFAULTS.touchMode).toBe('auto');
    expect(TOUCH_DEFAULTS.touchLeft).toBe(false);
  });

  it('force on / off beat the detection, auto follows it', () => {
    expect(resolveTouchMode('on', false)).toBe(true);
    expect(resolveTouchMode('off', true)).toBe(false);
    expect(resolveTouchMode('auto', true)).toBe(true);
    expect(resolveTouchMode('auto', false)).toBe(false);
    expect(resolveTouchMode('nonsense', false)).toBe(false);
  });

  it('detects phones and tablets but not a desktop or a touch laptop', () => {
    expect(detectTouch({ maxTouchPoints: 5, coarse: true, canHover: false })).toBe(true);
    expect(detectTouch({ maxTouchPoints: 0, coarse: false, canHover: true })).toBe(false);
    expect(detectTouch({ maxTouchPoints: 10, coarse: false, canHover: true })).toBe(false); // touch laptop: the mouse is primary
    expect(detectTouch({ maxTouchPoints: 5, canHover: false })).toBe(true); // no media queries available
    expect(detectTouch({ maxTouchPoints: 0 })).toBe(false);
    expect(detectTouch(null)).toBe(false);
  });

  it('normalises whatever was saved', () => {
    expect(normalizeTouch(undefined)).toEqual(TOUCH_DEFAULTS);
    expect(normalizeTouch({ touchMode: 'bogus', touchSize: 'big', touchOpacity: null, touchLeft: 1 })).toEqual({ touchMode: 'auto', touchSize: 100, touchOpacity: 65, touchLeft: true });
    expect(normalizeTouch({ touchSize: 1000, touchOpacity: -5 })).toMatchObject({ touchSize: SIZE_RANGE[1], touchOpacity: OPACITY_RANGE[0] });
    expect(normalizeTouch({ touchSize: 72.4 }).touchSize).toBe(72);
  });

  it('cycles auto -> on -> off', () => {
    expect(TOUCH_MODES).toEqual(['auto', 'on', 'off']);
    expect(nextTouchMode('auto')).toBe('on');
    expect(nextTouchMode('on')).toBe('off');
    expect(nextTouchMode('off')).toBe('auto');
    expect(nextTouchMode('?')).toBe('on');
  });

  it('?touch= in the address overrides the setting for that visit', () => {
    expect(touchModeFromQuery('?touch=1')).toBe('on');
    expect(touchModeFromQuery('?a=b&touch=0')).toBe('off');
    expect(touchModeFromQuery('?touch=maybe')).toBe(null);
    expect(touchModeFromQuery('')).toBe(null);
    const desktop = { maxTouchPoints: 0, coarse: false, canHover: true };
    expect(wantTouch({ touchMode: 'auto' }, '', desktop)).toBe(false);
    expect(wantTouch({ touchMode: 'auto' }, '?touch=1', desktop)).toBe(true);
    expect(wantTouch({ touchMode: 'on' }, '?touch=0', desktop)).toBe(false);
    expect(wantTouch({ touchMode: 'on' }, '', desktop)).toBe(true);
  });

  it('maps size and opacity to scale factors within limits', () => {
    expect(buttonScale(100)).toBe(1);
    expect(buttonScale(130)).toBe(1.3);
    expect(buttonScale(5)).toBe(SIZE_RANGE[0] / 100);
    expect(buttonScale(999)).toBe(SIZE_RANGE[1] / 100);
    expect(buttonScale(undefined)).toBe(1);
    expect(controlOpacity(50)).toBe(0.5);
    expect(controlOpacity(1)).toBe(OPACITY_RANGE[0] / 100);
    expect(controlOpacity(500)).toBe(1);
  });
});

describe('thumbstick maths', () => {
  const R = STICK_RADIUS;

  it('ignores the dead zone', () => {
    expect(stickVector(0, 0)).toMatchObject({ x: 0, y: 0, held: false, sprint: false });
    const inside = STICK_DEADZONE * R * 0.9;
    expect(stickVector(inside, 0).held).toBe(false);
    expect(stickVector(0, -inside).y).toBe(0);
  });

  it('ramps up from zero just outside the dead zone to full at the rim (no jump)', () => {
    const justOut = stickVector(0, -(STICK_DEADZONE * R + 0.5));
    expect(justOut.held).toBe(true);
    expect(-justOut.y).toBeGreaterThan(0);
    expect(-justOut.y).toBeLessThan(0.02);
    const half = stickVector(0, -R * 0.57);
    expect(-half.y).toBeGreaterThan(0.45);
    expect(-half.y).toBeLessThan(0.55);
    expect(stickVector(0, -R).y).toBeCloseTo(-1, 5);
  });

  it('uses the pad convention: up is negative y, right is positive x', () => {
    const v = stickVector(R, -R);
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBeLessThan(0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 5);
  });

  it('never exceeds 1 however far the thumb goes, and keeps its direction', () => {
    const v = stickVector(R * 5, -R * 5);
    expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(1 + 1e-9);
    expect(v.x / -v.y).toBeCloseTo(1, 5);
  });

  it('sprints only when pushed well past the rim and mostly forward', () => {
    expect(stickVector(0, -R).sprint).toBe(false);
    expect(stickVector(0, -R * (SPRINT_RATIO - 0.05)).sprint).toBe(false);
    expect(stickVector(0, -R * (SPRINT_RATIO + 0.05)).sprint).toBe(true);
    expect(stickVector(0, R * 2).sprint).toBe(false);               // backwards
    expect(stickVector(R * 2, 0).sprint).toBe(false);               // sideways
    expect(stickVector(R * 1.5, -R * 1.5).sprint).toBe(true);       // forward-right diagonal (45 degrees)
    expect(stickVector(R * 2, -R * 0.5).sprint).toBe(false);        // mostly sideways
  });

  it('scales with the radius (bigger buttons, bigger stick)', () => {
    expect(stickVector(60, 0, 120).x).toBeCloseTo(stickVector(30, 0, 60).x, 9);
    expect(stickVector(10, 0, 0)).toBeTruthy(); // a zero radius falls back to the default instead of dividing by zero
  });

  it('draws the knob inside the rim', () => {
    expect(knobOffset(10, 20, R)).toEqual({ x: 10, y: 20 });
    const k = knobOffset(R * 3, 0, R);
    expect(k.x).toBeCloseTo(R, 9);
    expect(k.y).toBeCloseTo(0, 9);
    expect(Math.hypot(knobOffset(300, -400, R).x, knobOffset(300, -400, R).y)).toBeCloseTo(R, 9);
    expect(knobOffset(0, 0, R)).toEqual({ x: 0, y: 0 });
  });

  it('puts the stick zone on the thumb side, left-handed mirrors it, the top strip is for buttons', () => {
    expect(inStickZone(100, 300, 800, 400, false)).toBe(true);
    expect(inStickZone(700, 300, 800, 400, false)).toBe(false);
    expect(inStickZone(700, 300, 800, 400, true)).toBe(true);
    expect(inStickZone(100, 300, 800, 400, true)).toBe(false);
    expect(inStickZone(100, 10, 800, 400, false)).toBe(false);
    expect(inStickZone(400, 300, 800, 400, false)).toBe(false);
  });
});

describe('gesture classifier (right side of the screen)', () => {
  it('is pending until something decides', () => {
    expect(classifyGesture({ travel: 0, duration: 50 })).toBe('pending');
    expect(classifyGesture({ travel: TAP_SLOP, duration: HOLD_MS - 1 })).toBe('pending');
  });
  it('a short press that lifts is a tap', () => {
    expect(classifyGesture({ travel: 2, duration: 120, released: true })).toBe('tap');
    expect(classifyGesture({ travel: 0, duration: HOLD_MS - 1, released: true })).toBe('tap');
  });
  it('a long press that stays put is a hold (mine)', () => {
    expect(classifyGesture({ travel: 3, duration: HOLD_MS })).toBe('hold');
    expect(classifyGesture({ travel: 3, duration: 2000, released: true })).toBe('hold');
  });
  it('moving past the slop is a drag, however long or short', () => {
    expect(classifyGesture({ travel: TAP_SLOP + 1, duration: 30 })).toBe('drag');
    expect(classifyGesture({ travel: TAP_SLOP + 1, duration: 5000, released: true })).toBe('drag');
  });
  it('turns finger pixels into mouse pixels with a gain, and the sensitivity setting scales them downstream', () => {
    expect(lookDelta(10, -4)).toEqual({ dx: 10 * LOOK_GAIN, dy: -4 * LOOK_GAIN });
    expect(lookDelta(10, 10, 2)).toEqual({ dx: 20, dy: 20 });
    // a 300 px swipe at 100 % sensitivity turns roughly the width of a phone's field of view
    const rad = lookDelta(300, 0).dx * 0.0022;
    expect(rad).toBeGreaterThan(0.8);
    expect(rad).toBeLessThan(1.6);
    expect(MOUSE_RAD_PER_PX).toBe(0.0022);
  });
});

describe('hotbar taps and swipes', () => {
  it('finds the slot under a tap', () => {
    expect(hotbarIndexAt(105, 100, 40)).toBe(0);
    expect(hotbarIndexAt(100 + 40 * 8 + 39, 100, 40)).toBe(8);
    expect(hotbarIndexAt(99, 100, 40)).toBe(-1);
    expect(hotbarIndexAt(100 + 40 * 9, 100, 40)).toBe(-1);
    expect(hotbarIndexAt(150, 100, 0)).toBe(-1);
  });
  it('slides the selection along with the finger, clamped to the bar', () => {
    expect(swipeSlot(4, 0, 40)).toBe(4);
    expect(swipeSlot(4, 45, 40)).toBe(5);
    expect(swipeSlot(4, -85, 40)).toBe(2);
    expect(swipeSlot(4, 9999, 40)).toBe(8);
    expect(swipeSlot(4, -9999, 40)).toBe(0);
    expect(swipeSlot(20, 0, 40)).toBe(8);
    expect(swipeSlot(3, 100, 0)).toBe(3);
  });
});

describe('tools bar on screens', () => {
  it('offers Close on any screen with a button of its own missing, and Split / Quick only where there are slots', () => {
    expect(toolsFor(null, true)).toEqual({ close: false, slots: false });
    expect(toolsFor('pause', true)).toEqual({ close: false, slots: false });
    expect(toolsFor('death', true)).toEqual({ close: false, slots: false });
    expect(toolsFor('inventory', true)).toEqual({ close: true, slots: true });
    expect(toolsFor('chest', true)).toEqual({ close: true, slots: true });
    expect(toolsFor('trade', true)).toEqual({ close: true, slots: true });
    expect(toolsFor('chat', true)).toEqual({ close: true, slots: false });
    expect(toolsFor('book', false)).toEqual({ close: true, slots: false });
  });
});

describe('touch feeds the shared Input', () => {
  it('held actions look like held keys, and a tap is seen for exactly one frame', () => {
    const inp = makeInput();
    expect(inp.is('jump')).toBe(false);
    inp.pressAction('jump');
    expect(inp.is('jump')).toBe(true);
    expect(inp.wasPressed('jump')).toBe(true);
    inp.endFrame();
    expect(inp.wasPressed('jump')).toBe(false);
    expect(inp.is('jump')).toBe(true);
    inp.releaseAction('jump');
    expect(inp.is('jump')).toBe(false);
    // pressed and released between two frames: still counts once
    inp.pressAction('inventory'); inp.releaseAction('inventory');
    expect(inp.is('inventory')).toBe(false);
    expect(inp.wasPressed('inventory')).toBe(true);
    inp.endFrame();
    expect(inp.wasPressed('inventory')).toBe(false);
  });

  it('double-tapping the jump button toggles flight, like the key', () => {
    const inp = makeInput();
    inp.pressAction('jump'); inp.releaseAction('jump');
    expect(inp.flyToggle).toBe(false);
    inp.pressAction('jump'); inp.releaseAction('jump');
    expect(inp.flyToggle).toBe(true);
  });

  it('a swing that comes and goes between frames still clicks once', () => {
    const inp = makeInput();
    inp.pressAction('attack'); inp.releaseAction('attack');
    inp.beginFrame(0.016, true);
    expect(inp.mouse.leftPressed).toBe(true);
    expect(inp.mouse.left).toBe(true);
    inp.endFrame();
    inp.beginFrame(0.016, true);
    expect(inp.mouse.left).toBe(false);
    // holding keeps the button down
    inp.pressAction('use');
    inp.beginFrame(0.016, true); inp.endFrame();
    inp.beginFrame(0.016, true);
    expect(inp.mouse.right).toBe(true);
    inp.releaseAction('use');
    inp.beginFrame(0.016, true);
    expect(inp.mouse.right).toBe(false);
  });

  it('no clicks while a screen is open', () => {
    const inp = makeInput();
    inp.pressAction('attack');
    inp.beginFrame(0.016, false);
    expect(inp.mouse.left).toBe(false);
  });

  it('the stick adds to movement, and the far push sprints only while moving forward', () => {
    const inp = makeInput();
    let v = stickVector(0, -STICK_RADIUS);
    inp.setTouchStick(v.x, v.y, v.sprint);
    let m = inp.movement();
    expect(m.forward).toBeCloseTo(1, 5);
    expect(m.strafe).toBeCloseTo(0, 5);
    expect(m.sprint).toBe(false);
    v = stickVector(STICK_RADIUS * 0.4, -STICK_RADIUS * 2);
    inp.setTouchStick(v.x, v.y, v.sprint);
    m = inp.movement();
    expect(m.sprint).toBe(true);
    expect(m.strafe).toBeGreaterThan(0);
    inp.setTouchStick(0, 0, false);
    m = inp.movement();
    expect(m).toMatchObject({ forward: 0, strafe: 0, sprint: false });
    // a sprint flag with nothing pushed does nothing
    inp.setTouchStick(0, 0, true);
    expect(inp.movement().sprint).toBe(false);
  });

  it('the sneak button works like the sneak key', () => {
    const inp = makeInput();
    inp.pressAction('sneak');
    expect(inp.movement().sneak).toBe(true);
    inp.releaseAction('sneak');
    expect(inp.movement().sneak).toBe(false);
  });

  it('never asks for pointer lock on touch', () => {
    const inp = makeInput();
    let asked = 0;
    inp.canvas = { requestPointerLock: () => { asked++; } };
    inp.noLock = true;
    inp.lock();
    expect(asked).toBe(0);
    inp.noLock = false;
    inp.lock();
    expect(asked).toBe(1);
  });
});
