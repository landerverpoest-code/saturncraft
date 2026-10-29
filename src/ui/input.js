// Keyboard + mouse + gamepad input with pointer lock. Which code triggers which action comes
// from the rebindable table in ui/bindings.js; gamepad buttons arrive as pseudo key codes
// ("PadA", ...) so they flow through the same `is` / `wasPressed` checks.
import { resolveBindings, keyLists, codeKind } from './bindings.js';
import { readPad, firstPad, buttonEdges, lookPixels } from './gamepad.js';

/** Keys that would scroll or open browser UI if left alone while playing. */
const NO_DEFAULT = /^(F\d{1,2}|Tab|Space|Slash|Backquote|ContextMenu)$/;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();   // keys pressed since last consume
    this.mouse = { left: false, right: false, middle: false, leftPressed: false, rightPressed: false, middlePressed: false };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    this.sensitivity = 0.0022;
    this.locked = false;
    this.lastForwardTap = 0;
    this.lastJumpTap = 0;
    this.flyToggle = false;     // double-tapped jump (creative flight)
    this.doubleTapSprint = false;
    this.onKey = null;
    this.keys = keyLists(resolveBindings(null));
    this.capture = null;        // while the controls screen waits for a key / button: fn(code)
    this.padPrev = new Set();   // gamepad buttons held at the last poll
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, connected: false };
    this.sprintLatch = false;   // a clicked stick keeps sprinting until you stop pushing forward
    this.virtualAttack = false; this.virtualUse = false;

    window.addEventListener('keydown', (e) => {
      if (this.capture) { e.preventDefault(); if (!e.repeat) this.capture(e.code); return; }
      if (e.repeat) { if (this.locked) e.preventDefault(); return; }
      if (NO_DEFAULT.test(e.code) || (e.ctrlKey && e.code === 'KeyW')) e.preventDefault();
      this.noteDown(e.code);
      if (this.onKey) this.onKey(e);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (this.keys.forward.includes(e.code)) this.doubleTapSprint = false;
    });
    window.addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = this.mouse.middle = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX; this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftPressed = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightPressed = true; }
      if (e.button === 1) { this.mouse.middle = true; this.mouse.middlePressed = true; e.preventDefault(); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
      if (e.button === 1) this.mouse.middle = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  /** Use a new {action: [k1, k2, pad]} table (ui/bindings.js resolveBindings). */
  setBindings(table) { this.keys = keyLists(table); }

  /** Is `code` one of the codes bound to `action`? */
  matches(action, code) { return (this.keys[action] || []).includes(code); }

  /** Shared by keys and pad buttons: double taps, latches, and the pressed / held sets. */
  noteDown(code) {
    if (this.keys.jump.includes(code)) {
      const now = performance.now();
      if (now - this.lastJumpTap < 280) { this.flyToggle = true; this.lastJumpTap = 0; } else this.lastJumpTap = now;
    }
    if (this.keys.forward.includes(code)) {
      const now = performance.now();
      if (now - this.lastForwardTap < 280) this.doubleTapSprint = true;
      this.lastForwardTap = now;
    }
    if (codeKind(code) === 'pad' && this.keys.sprint.includes(code)) this.sprintLatch = true;
    this.down.add(code);
    this.pressed.add(code);
  }

  /**
   * Once per frame, before anything reads the input: poll the first connected gamepad (buttons become
   * codes, the right stick becomes look movement), and turn "attack" / "use" bound to any key or button
   * into mouse clicks. `playing` is false while a screen is open (no clicks then).
   */
  beginFrame(dt, playing = true) {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const snap = nav && nav.getGamepads ? readPad(firstPad(nav.getGamepads())) : null;
    if (snap) {
      const { down, up } = buttonEdges(this.padPrev, snap.buttons);
      for (const c of down) { if (this.capture) this.capture(c); else this.noteDown(c); }
      for (const c of up) this.down.delete(c);
      this.padPrev = snap.buttons;
      this.pad = { lx: snap.lx, ly: snap.ly, rx: snap.rx, ry: snap.ry, connected: true };
      if (playing && !this.capture && (snap.rx || snap.ry)) {
        const l = lookPixels(snap.rx, snap.ry, dt);
        this.dx += l.dx; this.dy += l.dy;
      }
    } else if (this.pad.connected) {
      for (const c of this.padPrev) this.down.delete(c);
      this.padPrev = new Set();
      this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, connected: false };
      this.sprintLatch = false;
    }
    const atk = playing && this.is('attack'), use = playing && this.is('use');
    if (atk && !this.virtualAttack) { this.mouse.left = true; this.mouse.leftPressed = true; }
    if (!atk && this.virtualAttack) this.mouse.left = false;
    if (use && !this.virtualUse) { this.mouse.right = true; this.mouse.rightPressed = true; }
    if (!use && this.virtualUse) this.mouse.right = false;
    this.virtualAttack = atk; this.virtualUse = use;
  }

  lock() {
    if (this.locked || !this.canvas.requestPointerLock) return;
    // Browsers refuse to re-lock for ~1 s after Esc; the next click locks instead.
    try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch { /* ignored */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  is(action) { return this.keys[action].some((k) => this.down.has(k)); }
  wasPressed(action) { return this.keys[action].some((k) => this.pressed.has(k)); }
  codePressed(code) { return this.pressed.has(code); }

  consumeMouse() {
    const r = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0; this.dy = 0; this.wheel = 0;
    return r;
  }
  endFrame() {
    this.pressed.clear();
    this.mouse.leftPressed = this.mouse.rightPressed = this.mouse.middlePressed = false;
  }

  movement() {
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    const forward = clamp((this.is('forward') ? 1 : 0) - (this.is('back') ? 1 : 0) - this.pad.ly); // stick up is negative
    const strafe = clamp((this.is('right') ? 1 : 0) - (this.is('left') ? 1 : 0) + this.pad.lx);
    if (forward <= 0) this.sprintLatch = false;
    return {
      forward, strafe,
      jump: this.is('jump'),
      sneak: this.is('sneak'),
      crawl: this.is('crawl'),
      sprint: this.is('sprint') || this.doubleTapSprint || this.sprintLatch,
    };
  }
}
